import { fetchNhlOdds, NhlMatch } from "./nhlOddsClient";
import { fetchNhlTeamStats, getNhlTeamStats, computeNhlLeagueAverage, NhlStatsError } from "./nhlStatsClient";
import { nhlExpectedGoals, predictNhlMatch, NHL_TOTALS_LINE } from "./nhlModel";
import { analyzeMarketGeneric, perOutcomeAnalysis, confidencePick, ValueTip, ConfidencePick } from "./model";
import { getCurrentBank } from "./nhlDb";

const MAX_MATCHES = 10;
const MIN_GAMES_PLAYED = 3; // pod tento pocet odohranych zapasov je priemer golov nespolahlivy
const DEFAULT_MIN_CONFIDENCE = 55;

const HOME_AWAY_LABEL: Record<string, string> = { home: "Domáci", away: "Hostia" };
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
  totalsConfidenceEntries: NhlConfidenceEntry[];
  modelWarnings: string[];
  useOwnModel: boolean;
  statsError: string | null;
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

  let allStats: Record<string, ReturnType<typeof computeNhlLeagueAverage> extends never ? never : any> = {};
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
  const totalsConfidenceEntries: NhlConfidenceEntry[] = [];
  const modelWarnings: string[] = [];

  for (const m of matches) {
    let ownProbs: ReturnType<typeof predictNhlMatch> | null = null;

    if (useOwnModel) {
      const homeStats = getNhlTeamStats(allStats, m.home);
      const awayStats = getNhlTeamStats(allStats, m.away);
      if (homeStats && awayStats && homeStats.gamesPlayed >= MIN_GAMES_PLAYED && awayStats.gamesPlayed >= MIN_GAMES_PLAYED) {
        const { home, away } = nhlExpectedGoals(homeStats, awayStats, leagueAvg);
        ownProbs = predictNhlMatch(home, away);
      } else {
        modelWarnings.push(`${m.home} vs ${m.away}: nedostatok odohraných zápasov tento sezónu, použil sa fallback.`);
      }
    }

    const matchLabel = `${m.home} vs ${m.away}`;

    if (m.odds.length >= 3) {
      const oddsForModel = m.odds.map((o) => ({ home: o.home, away: o.away }));
      const ownHomeAway = ownProbs ? { home: ownProbs.home, away: ownProbs.away } : null;

      const tips = analyzeMarketGeneric(matchLabel, oddsForModel, m.bookmakers, bank, ["home", "away"], HOME_AWAY_LABEL, ownHomeAway);
      valueTips.push(...tips);

      const { perOutcome } = perOutcomeAnalysis(ownHomeAway, oddsForModel, m.bookmakers, ["home", "away"]);
      const conf = confidencePick(perOutcome, minConfidence, HOME_AWAY_LABEL);
      if (conf) confidenceEntries.push({ match: matchLabel, confidence: conf });
    }

    if (m.totalsOdds.length >= 3) {
      const ownTotals = ownProbs ? { over: ownProbs.over, under: ownProbs.under } : null;
      const tTips = analyzeMarketGeneric(`${matchLabel} (Nad/Pod)`, m.totalsOdds, m.totalsBookmakers, bank, ["over", "under"], TOTALS_LABEL, ownTotals);
      valueTips.push(...tTips);

      const { perOutcome: tPerOutcome } = perOutcomeAnalysis(ownTotals, m.totalsOdds, m.totalsBookmakers, ["over", "under"]);
      const tConf = confidencePick(tPerOutcome, minConfidence, TOTALS_LABEL);
      if (tConf) totalsConfidenceEntries.push({ match: matchLabel, confidence: tConf });
    }
  }

  return { bank, matches, valueTips, confidenceEntries, totalsConfidenceEntries, modelWarnings, useOwnModel, statsError };
}
