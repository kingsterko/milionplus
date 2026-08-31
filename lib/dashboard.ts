import { fetchLeagueOdds, fetchLeagueScores, OddsMatch, LiveScore } from "./oddsClient";
import { fetchSeasonMatches, buildMatchIndex, weightedStatsForTeam, computeLeagueAverage, FootballDataError } from "./footballData";
import { predictMatch, inPlayProbabilities, expectedGoals, MatchProbabilities } from "./poisson";
import {
  analyzeMatch1x2,
  analyzeMarketGeneric,
  perOutcomeAnalysis,
  perOutcomeAnalysis as perOutcomeAnalysisTotals,
  confidencePick,
  doubleChancePick,
  TOTALS_LABEL,
  OUTCOME_LABEL,
  ValueTip,
  ConfidencePick,
  DoubleChancePick,
} from "./model";
import { getCurrentBank } from "./db";
import { getLeague, LEAGUES, LeagueConfig } from "./leagues";

const DEFAULT_MIN_CONFIDENCE = 55;
const MAX_MATCHES = 10;
const LEAGUE_CONCURRENCY = 4; // max sucasne bezicich lig pri MIX/DNES - kompromis medzi rychlostou a football-data.org limitom 10 req/min

export interface ConfidenceEntry {
  match: string;
  league?: string;
  confidence: ConfidencePick | null;
  doubleChance: DoubleChancePick | null;
}

export interface TotalsConfidenceEntry {
  match: string;
  league?: string;
  confidence: ConfidencePick;
}

export interface DiagnosticRow {
  match: string;
  trh: string;
  vysledok: string;
  kurz: number;
  bookmaker: string;
  trhPct: number;
  modelPct: number;
  edge: number;
  prah: number;
  presiel: boolean;
}

export interface DashboardData {
  matches: OddsMatch[];
  bank: number;
  valueTips: ValueTip[];
  confidenceEntries: ConfidenceEntry[];
  totalsConfidenceEntries: TotalsConfidenceEntry[];
  modelWarnings: string[];
  diagnostics: DiagnosticRow[];
  modelError: string | null;
  useOwnModel: boolean;
  kickoffByMatch: Record<string, string>;
}

function currentSeasonStart(): number {
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  return month >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}

/** Spusti fn nad polozkami s najviac `limit` sucasne beziacimi volaniami naraz (namiesto full paralelizmu alebo cisto sekvencneho behu). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface LeagueAnalysis {
  matches: OddsMatch[];
  valueTips: ValueTip[];
  confidenceEntries: ConfidenceEntry[];
  totalsConfidenceEntries: TotalsConfidenceEntry[];
  modelWarnings: string[];
  diagnostics: DiagnosticRow[];
  modelError: string | null;
  useOwnModel: boolean;
  kickoffByMatch: Record<string, string>;
}

interface LeagueModelBase {
  matchIndex: ReturnType<typeof buildMatchIndex>;
  leagueAvg: ReturnType<typeof computeLeagueAverage>;
  useOwnModel: boolean;
  modelError: string | null;
}

/** Zdielane naprieč predpasovym aj live modulom - stiahnutie a spracovanie football-data.org historie. */
async function getLeagueModelBase(league: LeagueConfig, footballApiKey: string | undefined): Promise<LeagueModelBase> {
  const useOwnModel = Boolean(footballApiKey) && Boolean(league.footballDataCode);
  let matchIndex: ReturnType<typeof buildMatchIndex> = {};
  let leagueAvg = { scored_home: 1.5, conceded_home: 1.1, scored_away: 1.1, conceded_away: 1.5 };
  let modelError: string | null = null;

  if (useOwnModel && footballApiKey && league.footballDataCode) {
    try {
      const season = currentSeasonStart();
      const [current, previous] = await Promise.all([
        fetchSeasonMatches(footballApiKey, season, league.footballDataCode),
        fetchSeasonMatches(footballApiKey, season - 1, league.footballDataCode),
      ]);
      matchIndex = buildMatchIndex([...current, ...previous]);
      leagueAvg = computeLeagueAverage(matchIndex);
    } catch (e) {
      modelError = e instanceof FootballDataError ? e.message : String(e);
    }
  }

  return { matchIndex, leagueAvg, useOwnModel, modelError };
}

/**
 * Stiahne a analyzuje zapasy JEDNEJ ligy - zdielana logika pre getDashboardData
 * (jedna liga na strankach Zapasy) aj pre MIX/DNES (vsetky ligy naraz).
 */
async function fetchAndAnalyzeLeague(
  league: LeagueConfig,
  oddsApiKey: string,
  footballApiKey: string | undefined,
  bank: number,
  minConfidence: number
): Promise<LeagueAnalysis> {
  let matches: OddsMatch[];
  try {
    matches = await fetchLeagueOdds(oddsApiKey, league.oddsSportKey);
  } catch (e: any) {
    throw new Error(`[The Odds API] ${e?.message || JSON.stringify(e)}`);
  }

  const nowMs = Date.now();
  matches = matches
    .filter((m) => new Date(m.commenceTime).getTime() >= nowMs)
    .sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0))
    .slice(0, MAX_MATCHES);

  const kickoffByMatch: Record<string, string> = {};
  for (const m of matches) kickoffByMatch[`${m.home} vs ${m.away}`] = m.commenceTime;

  const { matchIndex, leagueAvg, useOwnModel, modelError } = await getLeagueModelBase(league, footballApiKey);

  const valueTips: ValueTip[] = [];
  const confidenceEntries: ConfidenceEntry[] = [];
  const totalsConfidenceEntries: TotalsConfidenceEntry[] = [];
  const modelWarnings: string[] = [];
  const diagnostics: DiagnosticRow[] = [];

  for (const m of matches) {
    let ownProbs: ReturnType<typeof predictMatch> | null = null;

    if (useOwnModel && Object.keys(matchIndex).length > 0) {
      const homeStats = weightedStatsForTeam(matchIndex, m.home, leagueAvg);
      const awayStats = weightedStatsForTeam(matchIndex, m.away, leagueAvg);
      if (homeStats && awayStats) {
        ownProbs = predictMatch(homeStats, awayStats);
      } else {
        modelWarnings.push(
          `${m.home} vs ${m.away}: nedostatok odohraných zápasov (aktuálna aj minulá sezóna spolu) — napr. novo postúpený tím. Použil sa fallback.`
        );
      }
    }

    const matchLabel = `${m.home} vs ${m.away}`;

    if (m.odds.length >= 3) {
      const tips = analyzeMatch1x2(m.home, m.away, m.odds, m.bookmakers, bank, ownProbs);
      valueTips.push(...tips.map((t) => ({ ...t, league: league.label })));

      const { perOutcome, market } = perOutcomeAnalysis(ownProbs, m.odds, m.bookmakers);
      const conf = confidencePick(perOutcome, minConfidence);
      const dc = doubleChancePick(perOutcome, market);
      if (conf || dc) confidenceEntries.push({ match: matchLabel, league: league.label, confidence: conf, doubleChance: dc });

      for (const [k, info] of Object.entries(perOutcome)) {
        diagnostics.push({
          match: matchLabel,
          trh: "1X2",
          vysledok: OUTCOME_LABEL[k] ?? k,
          kurz: info.odds,
          bookmaker: info.bookmaker,
          trhPct: info.marketProb,
          modelPct: info.modelProb,
          edge: info.edge,
          prah: info.threshold,
          presiel: info.edge >= info.threshold,
        });
      }
    }

    if (m.totalsOdds.length >= 3) {
      const ownTotals = ownProbs ? { over: ownProbs.over, under: ownProbs.under } : null;
      const tTips = analyzeMarketGeneric(
        `${matchLabel} (Nad/Pod)`,
        m.totalsOdds,
        m.totalsBookmakers,
        bank,
        ["over", "under"],
        TOTALS_LABEL,
        ownTotals
      );
      valueTips.push(...tTips.map((t) => ({ ...t, league: league.label })));

      const { perOutcome: tPerOutcome } = perOutcomeAnalysisTotals(ownTotals, m.totalsOdds, m.totalsBookmakers, ["over", "under"]);
      const tConf = confidencePick(tPerOutcome, minConfidence, TOTALS_LABEL);
      if (tConf) totalsConfidenceEntries.push({ match: matchLabel, league: league.label, confidence: tConf });

      for (const [k, info] of Object.entries(tPerOutcome)) {
        diagnostics.push({
          match: matchLabel,
          trh: "Nad/Pod",
          vysledok: TOTALS_LABEL[k],
          kurz: info.odds,
          bookmaker: info.bookmaker,
          trhPct: info.marketProb,
          modelPct: info.modelProb,
          edge: info.edge,
          prah: info.threshold,
          presiel: info.edge >= info.threshold,
        });
      }
    }
  }

  return { matches, valueTips, confidenceEntries, totalsConfidenceEntries, modelWarnings, diagnostics, modelError, useOwnModel, kickoffByMatch };
}

export async function getDashboardData(leagueId: string, minConfidence: number = DEFAULT_MIN_CONFIDENCE): Promise<DashboardData> {
  const league = getLeague(leagueId);
  const oddsApiKey = process.env.ODDS_API_KEY;
  const footballApiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!oddsApiKey) {
    throw new Error("Chýba ODDS_API_KEY v premenných prostredia (nastav vo Vercel -> Settings -> Environment Variables).");
  }

  let bank: number;
  try {
    bank = await getCurrentBank();
  } catch (e: any) {
    throw new Error(`[Supabase] ${e?.message || JSON.stringify(e)}`);
  }

  const result = await fetchAndAnalyzeLeague(league, oddsApiKey, footballApiKey, bank, minConfidence);
  return { ...result, bank };
}

interface LeagueErrorEntry {
  league: string;
  message: string;
}

/**
 * Prejde VSETKY ligy s obmedzenou suSbeznostou (max LEAGUE_CONCURRENCY naraz)
 * namiesto plne sekvencneho behu s umelou pauzou. Ak jedna liga zlyha, ostatne
 * pokracuju normalne - chyba sa zaznamena, nie je fatalna pre cely vysledok.
 */
async function analyzeAllLeagues(
  oddsApiKey: string,
  footballApiKey: string | undefined,
  bank: number,
  minConfidence: number
): Promise<{ results: (LeagueAnalysis & { league: LeagueConfig })[]; leagueErrors: LeagueErrorEntry[] }> {
  const leagueErrors: LeagueErrorEntry[] = [];

  const outcomes = await mapWithConcurrency(LEAGUES, LEAGUE_CONCURRENCY, async (league) => {
    try {
      const result = await fetchAndAnalyzeLeague(league, oddsApiKey, footballApiKey, bank, minConfidence);
      return { ok: true as const, league, result };
    } catch (e: any) {
      return { ok: false as const, league, message: e?.message || String(e) };
    }
  });

  const results: (LeagueAnalysis & { league: LeagueConfig })[] = [];
  for (const o of outcomes) {
    if (o.ok) results.push({ ...o.result, league: o.league });
    else leagueErrors.push({ league: o.league.label, message: o.message });
  }

  return { results, leagueErrors };
}

export interface MixTicketData {
  bank: number;
  confidenceEntries: ConfidenceEntry[];
  totalsConfidenceEntries: TotalsConfidenceEntry[];
  kickoffByMatch: Record<string, string>;
  leagueErrors: LeagueErrorEntry[];
}

/**
 * Prejde vsetky ligy naraz (s obmedzenou suSbeznostou) a spoji ich iste tipy
 * do jedneho spolocneho poolu pre MIX tiket.
 */
export async function getMixTicketData(minConfidence: number = DEFAULT_MIN_CONFIDENCE): Promise<MixTicketData> {
  const oddsApiKey = process.env.ODDS_API_KEY;
  const footballApiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!oddsApiKey) {
    throw new Error("Chýba ODDS_API_KEY v premenných prostredia (nastav vo Vercel -> Settings -> Environment Variables).");
  }

  let bank: number;
  try {
    bank = await getCurrentBank();
  } catch (e: any) {
    throw new Error(`[Supabase] ${e?.message || JSON.stringify(e)}`);
  }

  const { results, leagueErrors } = await analyzeAllLeagues(oddsApiKey, footballApiKey, bank, minConfidence);

  const confidenceEntries: ConfidenceEntry[] = [];
  const totalsConfidenceEntries: TotalsConfidenceEntry[] = [];
  const kickoffByMatch: Record<string, string> = {};

  for (const r of results) {
    confidenceEntries.push(...r.confidenceEntries);
    totalsConfidenceEntries.push(...r.totalsConfidenceEntries);
    Object.assign(kickoffByMatch, r.kickoffByMatch);
  }

  return { bank, confidenceEntries, totalsConfidenceEntries, kickoffByMatch, leagueErrors };
}

export interface TodayDashboardData {
  bank: number;
  matches: OddsMatch[];
  valueTips: ValueTip[];
  confidenceEntries: ConfidenceEntry[];
  totalsConfidenceEntries: TotalsConfidenceEntry[];
  kickoffByMatch: Record<string, string>;
  leagueErrors: LeagueErrorEntry[];
}

/**
 * Prejde vsetky ligy naraz (s obmedzenou suSbeznostou) a poskladá vsetko
 * (zapasy, value tipy, iste tipy), co sa hra DNES, naprieč nimi.
 */
export async function getTodayDashboardData(minConfidence: number = DEFAULT_MIN_CONFIDENCE): Promise<TodayDashboardData> {
  const oddsApiKey = process.env.ODDS_API_KEY;
  const footballApiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!oddsApiKey) {
    throw new Error("Chýba ODDS_API_KEY v premenných prostredia (nastav vo Vercel -> Settings -> Environment Variables).");
  }

  let bank: number;
  try {
    bank = await getCurrentBank();
  } catch (e: any) {
    throw new Error(`[Supabase] ${e?.message || JSON.stringify(e)}`);
  }

  const { results, leagueErrors } = await analyzeAllLeagues(oddsApiKey, footballApiKey, bank, minConfidence);

  const matches: OddsMatch[] = [];
  const valueTips: ValueTip[] = [];
  const confidenceEntries: ConfidenceEntry[] = [];
  const totalsConfidenceEntries: TotalsConfidenceEntry[] = [];
  const kickoffByMatch: Record<string, string> = {};

  const isTodayIso = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const baseMatchLabel = (label: string) => label.replace(/ \(Nad\/Pod\)$/, "");

  for (const r of results) {
    const todayMatches = r.matches.filter((m) => isTodayIso(m.commenceTime));
    if (todayMatches.length === 0) continue;
    const todayLabels = new Set(todayMatches.map((m) => `${m.home} vs ${m.away}`));

    matches.push(...todayMatches);
    valueTips.push(...r.valueTips.filter((t) => todayLabels.has(baseMatchLabel(t.match))));
    confidenceEntries.push(...r.confidenceEntries.filter((e) => todayLabels.has(e.match)));
    totalsConfidenceEntries.push(...r.totalsConfidenceEntries.filter((e) => todayLabels.has(e.match)));
    Object.assign(kickoffByMatch, r.kickoffByMatch);
  }

  matches.sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0));

  return { bank, matches, valueTips, confidenceEntries, totalsConfidenceEntries, kickoffByMatch, leagueErrors };
}

// ---------- LIVE / IN-PLAY ----------

const LIVE_MATCH_WINDOW_MS = 130 * 60 * 1000; // poistka: zapas starsi nez 130 min od vykopu uz zjavne skoncil

export interface LiveMatchEntry {
  match: string;
  league: string;
  homeScore: number;
  awayScore: number;
  elapsedMinutes: number;
  commenceTime: string;
  hasModel: boolean;
  liveProbs: MatchProbabilities | null;
  valueTips: ValueTip[];
  confidence: ConfidencePick | null;
  doubleChance: DoubleChancePick | null;
}

export interface LiveDashboardData {
  bank: number;
  liveMatches: LiveMatchEntry[];
  leagueErrors: LeagueErrorEntry[];
}

/**
 * Naziva analyza jednej ligy: zoberie uz aj tak cachovane kurze (fetchLeagueOdds
 * vracia aj prave bezice zapasy, nielen buduce), spari ich s aktualnym skore
 * (samostatny /scores endpoint), a pre zapasy kde mame predpasovy model
 * prepocita pravdepodobnost na zvysny cas + aktualne skore (inPlayProbabilities).
 * Vysledne "live" pravdepodobnosti sa porovnaju s aktualne ponukanymi (live)
 * kurzami rovnakym sposobom ako pri predpasovej analyze.
 */
async function fetchAndAnalyzeLiveLeague(
  league: LeagueConfig,
  oddsApiKey: string,
  footballApiKey: string | undefined,
  bank: number,
  minConfidence: number
): Promise<{ liveMatches: LiveMatchEntry[] }> {
  let allOdds: OddsMatch[];
  try {
    allOdds = await fetchLeagueOdds(oddsApiKey, league.oddsSportKey);
  } catch (e: any) {
    throw new Error(`[The Odds API] ${e?.message || JSON.stringify(e)}`);
  }

  const nowMs = Date.now();
  const liveOddsMatches = allOdds.filter((m) => {
    const t = new Date(m.commenceTime).getTime();
    return t <= nowMs && nowMs - t <= LIVE_MATCH_WINDOW_MS;
  });

  if (liveOddsMatches.length === 0) return { liveMatches: [] };

  let scores: LiveScore[];
  try {
    scores = await fetchLeagueScores(oddsApiKey, league.oddsSportKey);
  } catch (e: any) {
    throw new Error(`[The Odds API - scores] ${e?.message || JSON.stringify(e)}`);
  }

  const { matchIndex, leagueAvg, useOwnModel } = await getLeagueModelBase(league, footballApiKey);

  const liveMatches: LiveMatchEntry[] = [];

  for (const m of liveOddsMatches) {
    const scoreEntry = scores.find((s) => s.home === m.home && s.away === m.away);
    if (!scoreEntry || scoreEntry.completed) continue;
    if (scoreEntry.homeScore == null || scoreEntry.awayScore == null) continue;

    const elapsedMinutes = Math.min(Math.round((nowMs - new Date(m.commenceTime).getTime()) / 60000), 95);
    const matchLabel = `${m.home} vs ${m.away}`;

    let liveProbs: MatchProbabilities | null = null;
    let hasModel = false;

    if (useOwnModel && Object.keys(matchIndex).length > 0) {
      const homeStats = weightedStatsForTeam(matchIndex, m.home, leagueAvg);
      const awayStats = weightedStatsForTeam(matchIndex, m.away, leagueAvg);
      if (homeStats && awayStats) {
        const [preHomeExp, preAwayExp] = expectedGoals(
          homeStats.scored_home,
          homeStats.conceded_home,
          awayStats.scored_away,
          awayStats.conceded_away
        );
        liveProbs = inPlayProbabilities(preHomeExp, preAwayExp, elapsedMinutes, scoreEntry.homeScore, scoreEntry.awayScore);
        hasModel = true;
      }
    }

    let valueTips: ValueTip[] = [];
    let confidence: ConfidencePick | null = null;
    let doubleChance: DoubleChancePick | null = null;

    if (hasModel && liveProbs && m.odds.length >= 3) {
      const tips = analyzeMatch1x2(m.home, m.away, m.odds, m.bookmakers, bank, liveProbs);
      valueTips = tips.map((t) => ({ ...t, league: league.label }));

      const { perOutcome, market } = perOutcomeAnalysis(liveProbs, m.odds, m.bookmakers);
      confidence = confidencePick(perOutcome, minConfidence);
      doubleChance = doubleChancePick(perOutcome, market);
    }

    liveMatches.push({
      match: matchLabel,
      league: league.label,
      homeScore: scoreEntry.homeScore,
      awayScore: scoreEntry.awayScore,
      elapsedMinutes,
      commenceTime: m.commenceTime,
      hasModel,
      liveProbs,
      valueTips,
      confidence,
      doubleChance,
    });
  }

  return { liveMatches };
}

/** Prejde vsetky ligy naraz (s obmedzenou suSbeznostou) a poskladá vsetky naziva bezice zapasy naprieč nimi. */
export async function getLiveDashboardData(minConfidence: number = DEFAULT_MIN_CONFIDENCE): Promise<LiveDashboardData> {
  const oddsApiKey = process.env.ODDS_API_KEY;
  const footballApiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!oddsApiKey) {
    throw new Error("Chýba ODDS_API_KEY v premenných prostredia (nastav vo Vercel -> Settings -> Environment Variables).");
  }

  let bank: number;
  try {
    bank = await getCurrentBank();
  } catch (e: any) {
    throw new Error(`[Supabase] ${e?.message || JSON.stringify(e)}`);
  }

  const leagueErrors: LeagueErrorEntry[] = [];

  const outcomes = await mapWithConcurrency(LEAGUES, LEAGUE_CONCURRENCY, async (league) => {
    try {
      const result = await fetchAndAnalyzeLiveLeague(league, oddsApiKey, footballApiKey, bank, minConfidence);
      return { ok: true as const, league, result };
    } catch (e: any) {
      return { ok: false as const, league, message: e?.message || String(e) };
    }
  });

  const liveMatches: LiveMatchEntry[] = [];
  for (const o of outcomes) {
    if (o.ok) liveMatches.push(...o.result.liveMatches);
    else leagueErrors.push({ league: o.league.label, message: o.message });
  }

  liveMatches.sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0));

  return { bank, liveMatches, leagueErrors };
}
