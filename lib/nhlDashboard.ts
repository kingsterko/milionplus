import { fetchNhlOdds, getNhlRegulationStatus, REGULATION_MAX_EVENTS, NhlMatch } from "./nhlOddsClient";
import { fetchNhlTeamStats, getNhlTeamStats, computeNhlLeagueAverage, NhlStatsError, NhlTeamStats } from "./nhlStatsClient";
import { nhlExpectedGoals, buildNhlGrid, moneylineFromGrid, regulationFromGrid, NhlMatchProbabilities, NhlRegulationProbabilities, NHL_TOTALS_LINE } from "./nhlModel";
import { analyzeMarketGeneric, perOutcomeAnalysis, confidencePick, ValueTip, ConfidencePick } from "./model";
import { getCurrentBank } from "./nhlDb";

const MAX_MATCHES = 10;
const MIN_GAMES_PLAYED = 3; // pod tento pocet odohranych zapasov je priemer golov nespolahlivy
const DEFAULT_MIN_CONFIDENCE = 55;

const HOME_AWAY_LABEL: Record<string, string> = { home: "Domáci (vrátane predĺženia)", away: "Hostia (vrátane predĺženia)" };
const REGULATION_LABEL: Record<string, string> = { home: "Domáci (riadna doba)", draw: "Remíza (riadna doba)", away: "Hostia (riadna doba)" };
const TOTALS_LABEL: Record<string, string> = { over: `Nad ${NHL_TOTALS_LINE} gólu`, under: `Pod ${NHL_TOTALS_LINE} gólu` };

export interface NhlConfidenceEntry {
  match: string;
  confidence: ConfidencePick | null;
}

export interface NhlDashboardData {
  bank: number;
  matches: NhlMatch[];
  valueTips: ValueTip[];
  confidenceEntries: NhlConfidenceEntry[];
  regulationConfidenceEntries: NhlConfidenceEntry[];
  totalsConfidenceEntries: NhlConfidenceEntry[];
  modelWarnings: string[];
  useOwnModel: boolean;
  statsError: string | null;
  regulationStatus: { enabled: boolean; note: string | null; loaded: number; maxCost: number; fetchedAt: string | null };
}

export async function getNhlDashboardData(minConfidence: number = DEFAULT_MIN_CONFIDENCE): Promise<NhlDashboardData> {
  const oddsApiKey = process.env.ODDS_API_KEY;
  if (!oddsApiKey) {
    throw new Error("Chýba ODDS_API_KEY v premenných prostredia.");
  }

  let bank: number;
  try {
    bank = await getCurrentBank();
  } catch (e: any) {
    throw new Error(`[Supabase] ${e?.message || JSON.stringify(e)}`);
  }

  let matches: NhlMatch[];
  try {
    matches = await fetchNhlOdds(oddsApiKey);
  } catch (e: any) {
    throw new Error(`[The Odds API] ${e?.message || JSON.stringify(e)}`);
  }

  const nowMs = Date.now();
  matches = matches
    .filter((m) => new Date(m.commenceTime).getTime() >= nowMs)
    .sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0))
    .slice(0, MAX_MATCHES);

  const regStatus = await getNhlRegulationStatus();
  const regulationStatus = {
    enabled: regStatus.enabled,
    note: regStatus.note,
    loaded: matches.filter((m) => m.regulationOdds.length >= 3).length,
    maxCost: REGULATION_MAX_EVENTS,
    fetchedAt: regStatus.fetchedAt,
  };

  let allStats: Record<string, NhlTeamStats> = {};
  let statsError: string | null = null;
  let useOwnModel = false;

  try {
    allStats = await fetchNhlTeamStats();
    useOwnModel = Object.keys(allStats).length > 0;
  } catch (e) {
    statsError = e instanceof NhlStatsError ? e.message : String(e);
  }

  const leagueAvg = computeNhlLeagueAverage(allStats);

  const valueTips: ValueTip[] = [];
  const confidenceEntries: NhlConfidenceEntry[] = [];
  const regulationConfidenceEntries: NhlConfidenceEntry[] = [];
  const totalsConfidenceEntries: NhlConfidenceEntry[] = [];
  const modelWarnings: string[] = [];

  for (const m of matches) {
    let moneylineProbs: NhlMatchProbabilities | null = null;
    let regulationProbs: NhlRegulationProbabilities | null = null;

    if (useOwnModel) {
      const homeStats = getNhlTeamStats(allStats, m.home);
      const awayStats = getNhlTeamStats(allStats, m.away);
      if (homeStats && awayStats && homeStats.gamesPlayed >= MIN_GAMES_PLAYED && awayStats.gamesPlayed >= MIN_GAMES_PLAYED) {
        const { home, away } = nhlExpectedGoals(homeStats, awayStats, leagueAvg);
        const grid = buildNhlGrid(home, away); // mriezka sa pocita raz, odvodia sa z nej oba trhy
        moneylineProbs = moneylineFromGrid(grid, home, away);
        regulationProbs = regulationFromGrid(grid);
      } else {
        modelWarnings.push(`${m.home} vs ${m.away}: nedostatok odohraných zápasov tento sezónu, použil sa fallback.`);
      }
    }

    const matchLabel = `${m.home} vs ${m.away}`;

    // --- Moneyline (2-cestny, vratane predlzenia/najazdov) ---
    if (m.odds.length >= 3) {
      const oddsForModel = m.odds.map((o) => ({ home: o.home, away: o.away }));
      const ownHomeAway = moneylineProbs ? { home: moneylineProbs.home, away: moneylineProbs.away } : null;

      const tips = analyzeMarketGeneric(matchLabel, oddsForModel, m.bookmakers, bank, ["home", "away"], HOME_AWAY_LABEL, ownHomeAway);
      valueTips.push(...tips);

      const { perOutcome } = perOutcomeAnalysis(ownHomeAway, oddsForModel, m.bookmakers, ["home", "away"]);
      const conf = confidencePick(perOutcome, minConfidence, HOME_AWAY_LABEL);
      if (conf) confidenceEntries.push({ match: matchLabel, confidence: conf });
    }

    // --- Riadna hracia doba (3-cestny, s remizou) - vyssie kurzy ---
    if (m.regulationOdds.length >= 3) {
      const regLabel = `${matchLabel} (Riadna doba)`;
      const oddsForModel = m.regulationOdds.map((o) => ({ home: o.home, draw: o.draw, away: o.away }));
      const ownReg = regulationProbs ? { home: regulationProbs.home, draw: regulationProbs.draw, away: regulationProbs.away } : null;
      const keys = ["home", "draw", "away"];

      const rTips = analyzeMarketGeneric(regLabel, oddsForModel, m.regulationBookmakers, bank, keys, REGULATION_LABEL, ownReg);
      valueTips.push(...rTips);

      const { perOutcome: rPerOutcome } = perOutcomeAnalysis(ownReg, oddsForModel, m.regulationBookmakers, keys);
      const rConf = confidencePick(rPerOutcome, minConfidence, REGULATION_LABEL);
      if (rConf) regulationConfidenceEntries.push({ match: regLabel, confidence: rConf });
    }

    // --- Nad/Pod ---
    if (m.totalsOdds.length >= 3) {
      const ownTotals = moneylineProbs ? { over: moneylineProbs.over, under: moneylineProbs.under } : null;
      const tTips = analyzeMarketGeneric(`${matchLabel} (Nad/Pod)`, m.totalsOdds, m.totalsBookmakers, bank, ["over", "under"], TOTALS_LABEL, ownTotals);
      valueTips.push(...tTips);

      const { perOutcome: tPerOutcome } = perOutcomeAnalysis(ownTotals, m.totalsOdds, m.totalsBookmakers, ["over", "under"]);
      const tConf = confidencePick(tPerOutcome, minConfidence, TOTALS_LABEL);
      if (tConf) totalsConfidenceEntries.push({ match: matchLabel, confidence: tConf });
    }
  }

  return { bank, matches, valueTips, confidenceEntries, regulationConfidenceEntries, totalsConfidenceEntries, modelWarnings, useOwnModel, statsError, regulationStatus };
}
