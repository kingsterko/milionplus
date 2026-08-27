import { fetchLeagueOdds, OddsMatch } from "./oddsClient";
import { fetchSeasonMatches, buildMatchIndex, weightedStatsForTeam, FootballDataError } from "./footballData";
import { predictMatch } from "./poisson";
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
const MIX_LEAGUE_THROTTLE_MS = 700; // respekt k football-data.org limitu 10 req/min

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

/**
 * Stiahne a analyzuje zapasy JEDNEJ ligy - zdielana logika pre getDashboardData
 * (jedna liga na strankach Zapasy) aj getMixTicketData (vsetky ligy naraz pre MIX).
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

  const useOwnModel = Boolean(footballApiKey) && Boolean(league.footballDataCode);
  let matchIndex: ReturnType<typeof buildMatchIndex> = {};
  let modelError: string | null = null;

  if (useOwnModel && footballApiKey && league.footballDataCode) {
    try {
      const season = currentSeasonStart();
      const current = await fetchSeasonMatches(footballApiKey, season, league.footballDataCode);
      const previous = await fetchSeasonMatches(footballApiKey, season - 1, league.footballDataCode);
      matchIndex = buildMatchIndex([...current, ...previous]);
    } catch (e) {
      modelError = e instanceof FootballDataError ? e.message : String(e);
    }
  }

  const valueTips: ValueTip[] = [];
  const confidenceEntries: ConfidenceEntry[] = [];
  const totalsConfidenceEntries: TotalsConfidenceEntry[] = [];
  const modelWarnings: string[] = [];
  const diagnostics: DiagnosticRow[] = [];

  for (const m of matches) {
    let ownProbs: ReturnType<typeof predictMatch> | null = null;

    if (useOwnModel && Object.keys(matchIndex).length > 0) {
      const homeStats = weightedStatsForTeam(matchIndex, m.home);
      const awayStats = weightedStatsForTeam(matchIndex, m.away);
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
      valueTips.push(...tips);

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
      valueTips.push(...tTips);

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

export interface MixTicketData {
  bank: number;
  confidenceEntries: ConfidenceEntry[];
  totalsConfidenceEntries: TotalsConfidenceEntry[];
  kickoffByMatch: Record<string, string>;
  leagueErrors: { league: string; message: string }[];
}

/**
 * Prejde VSETKY ligy postupne (s malou pauzou medzi kazdou kvoli limitu
 * football-data.org 10 req/min) a spoji ich isté tipy do jedneho spolocneho
 * poolu pre MIX tiket. Ak jedna liga zlyha, ostatne pokracuju normalne.
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

  const confidenceEntries: ConfidenceEntry[] = [];
  const totalsConfidenceEntries: TotalsConfidenceEntry[] = [];
  const kickoffByMatch: Record<string, string> = {};
  const leagueErrors: { league: string; message: string }[] = [];

  for (const league of LEAGUES) {
    try {
      const result = await fetchAndAnalyzeLeague(league, oddsApiKey, footballApiKey, bank, minConfidence);
      confidenceEntries.push(...result.confidenceEntries);
      totalsConfidenceEntries.push(...result.totalsConfidenceEntries);
      Object.assign(kickoffByMatch, result.kickoffByMatch);
    } catch (e: any) {
      leagueErrors.push({ league: league.label, message: e?.message || String(e) });
    }
    await new Promise((r) => setTimeout(r, MIX_LEAGUE_THROTTLE_MS));
  }

  return { bank, confidenceEntries, totalsConfidenceEntries, kickoffByMatch, leagueErrors };
}
