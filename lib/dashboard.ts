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
import { getLeague } from "./leagues";

const MIN_CONFIDENCE = 55;

export interface ConfidenceEntry {
  match: string;
  confidence: ConfidencePick | null;
  doubleChance: DoubleChancePick | null;
}

export interface TotalsConfidenceEntry {
  match: string;
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
}

function currentSeasonStart(): number {
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  return month >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}

export async function getDashboardData(leagueId: string): Promise<DashboardData> {
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

  let matches: OddsMatch[];
  try {
    matches = await fetchLeagueOdds(oddsApiKey, league.oddsSportKey);
  } catch (e: any) {
    throw new Error(`[The Odds API] ${e?.message || JSON.stringify(e)}`);
  }

  // Zoradene podla casu vykopu (najblizsi zapas prvy) - vsetko nizsie (tipy, istota)
  // sa poklada v tomto poradi, takze zdedi rovnaku chronologicku strukturu.
  matches = [...matches].sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0));

  const useOwnModel = Boolean(footballApiKey) && Boolean(league.footballDataCode);
  let matchIndex: ReturnType<typeof buildMatchIndex> = {};
  let modelError: string | null = null;

  if (useOwnModel && footballApiKey && league.footballDataCode) {
    try {
      const season = currentSeasonStart();
      const [current, previous] = await Promise.all([
        fetchSeasonMatches(footballApiKey, season, league.footballDataCode),
        fetchSeasonMatches(footballApiKey, season - 1, league.footballDataCode),
      ]);
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
      const conf = confidencePick(perOutcome, MIN_CONFIDENCE);
      const dc = doubleChancePick(perOutcome, market);
      if (conf || dc) confidenceEntries.push({ match: matchLabel, confidence: conf, doubleChance: dc });

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
      const tConf = confidencePick(tPerOutcome, MIN_CONFIDENCE, TOTALS_LABEL);
      if (tConf) totalsConfidenceEntries.push({ match: matchLabel, confidence: tConf });

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

  return {
    matches,
    bank,
    valueTips,
    confidenceEntries,
    totalsConfidenceEntries,
    modelWarnings,
    diagnostics,
    modelError,
    useOwnModel,
  };
}
