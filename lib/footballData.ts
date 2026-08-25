/**
 * Port povodneho football_data_client.py. Stahuje jednotlive zapasy PL
 * (aktualna + minula sezona) a pocita vazeny priemer golov s dorazom na
 * posledne zapasy (exponencialny uhyb) - nie plochy priemer za celu sezonu.
 */

import type { TeamVenueStats } from "./poisson";

const BASE_URL = "https://api.football-data.org/v4";
const PREMIER_LEAGUE_CODE = "PL";

export const MAX_MATCHES_PER_VENUE = 8;
export const RECENCY_DECAY = 0.9;
export const MIN_MATCHES_PER_VENUE = 3;

export class FootballDataError extends Error {}

interface RawMatch {
  home_team: string;
  away_team: string;
  home_goals: number;
  away_goals: number;
  date: string;
}

interface VenueMatch {
  scored: number;
  conceded: number;
  date: string;
}

export type MatchIndex = Record<string, { home: VenueMatch[]; away: VenueMatch[] }>;

function normalizeTeamName(name: string): string {
  let n = name.toLowerCase().trim();
  for (const suffix of [" fc", " afc", " football club", " f.c."]) {
    if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  }
  return n.trim();
}

function matchTeam(target: string, available: string[]): string | null {
  const norm = normalizeTeamName(target);
  for (const name of available) {
    if (normalizeTeamName(name) === norm) return name;
  }
  for (const name of available) {
    const n = normalizeTeamName(name);
    if (norm.includes(n) || n.includes(norm)) return name;
  }
  return null;
}

export async function fetchSeasonMatches(apiKey: string, season: number): Promise<RawMatch[]> {
  const url = `${BASE_URL}/competitions/${PREMIER_LEAGUE_CODE}/matches?season=${season}&status=FINISHED`;
  const resp = await fetch(url, { headers: { "X-Auth-Token": apiKey }, next: { revalidate: 6 * 3600 } });

  if (resp.status === 401 || resp.status === 403) {
    throw new FootballDataError(`Neplatný kľúč (status ${resp.status}).`);
  }
  if (resp.status === 429) {
    throw new FootballDataError("Prekročený limit 10 requestov/minútu, skús o chvíľu znova.");
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new FootballDataError(`Neočakávaná odpoveď (status ${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const out: RawMatch[] = [];
  for (const m of data.matches ?? []) {
    const ft = m?.score?.fullTime;
    if (ft?.home == null || ft?.away == null) continue;
    out.push({
      home_team: m.homeTeam.name,
      away_team: m.awayTeam.name,
      home_goals: ft.home,
      away_goals: ft.away,
      date: m.utcDate ?? "",
    });
  }
  return out;
}

export function buildMatchIndex(matches: RawMatch[]): MatchIndex {
  const idx: MatchIndex = {};
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? 1 : -1)); // najnovsi prvy

  for (const m of sorted) {
    if (!idx[m.home_team]) idx[m.home_team] = { home: [], away: [] };
    if (!idx[m.away_team]) idx[m.away_team] = { home: [], away: [] };
    idx[m.home_team].home.push({ scored: m.home_goals, conceded: m.away_goals, date: m.date });
    idx[m.away_team].away.push({ scored: m.away_goals, conceded: m.home_goals, date: m.date });
  }
  return idx;
}

function weightedAvg(matches: VenueMatch[], key: "scored" | "conceded", decay: number): number {
  const weights = matches.map((_, i) => Math.pow(decay, i));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const sum = matches.reduce((acc, m, i) => acc + weights[i] * m[key], 0);
  return sum / totalW;
}

export function weightedStatsForTeam(
  index: MatchIndex,
  teamName: string,
  maxMatches: number = MAX_MATCHES_PER_VENUE,
  decay: number = RECENCY_DECAY,
  minMatches: number = MIN_MATCHES_PER_VENUE
): TeamVenueStats | null {
  const match = matchTeam(teamName, Object.keys(index));
  if (!match) return null;

  const home = index[match].home.slice(0, maxMatches);
  const away = index[match].away.slice(0, maxMatches);
  if (home.length < minMatches || away.length < minMatches) return null;

  return {
    scored_home: weightedAvg(home, "scored", decay),
    conceded_home: weightedAvg(home, "conceded", decay),
    scored_away: weightedAvg(away, "scored", decay),
    conceded_away: weightedAvg(away, "conceded", decay),
    sample_home: home.length,
    sample_away: away.length,
  };
}
