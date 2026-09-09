/**
 * NHL statistiky timov - verejne, bez klucu (api-web.nhle.com).
 *
 * Na rozdiel od football-data.org, NHL "standings" endpoint neposkytuje
 * rozdelenie na domace/vonkajsie zapasy - len sezonne sucty. Preto pouzivame
 * CELKOVY priemer golov (nie oddeleny doma/vonku) a v modeli aplikujeme
 * pevnu konstantu "domaci lad" (bezne zname zvyhodnenie domaceho timu
 * v hokeji), namiesto empiricky odmeranej hodnoty ako pri futbale.
 *
 * Vyhoda: JEDNO volanie stiahne udaje o VSETKYCH timoch naraz.
 */

const STANDINGS_URL = "https://api-web.nhle.com/v1/standings/now";

export interface NhlTeamStats {
  scoredAvg: number;
  concededAvg: number;
  gamesPlayed: number;
}

export class NhlStatsError extends Error {}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().trim();
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

export async function fetchNhlTeamStats(): Promise<Record<string, NhlTeamStats>> {
  const resp = await fetch(STANDINGS_URL, { next: { revalidate: 6 * 3600, tags: ["nhl_stats"] } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new NhlStatsError(`NHL standings chyba (status ${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();

  const stats: Record<string, NhlTeamStats> = {};
  for (const row of data.standings ?? []) {
    const name = row.teamName?.default ?? row.teamAbbrev?.default;
    const gamesPlayed = row.gamesPlayed ?? 0;
    if (!name || gamesPlayed === 0) continue;
    stats[name] = {
      scoredAvg: (row.goalFor ?? 0) / gamesPlayed,
      concededAvg: (row.goalAgainst ?? 0) / gamesPlayed,
      gamesPlayed,
    };
  }
  return stats;
}

export function getNhlTeamStats(allStats: Record<string, NhlTeamStats>, teamName: string): NhlTeamStats | null {
  const match = matchTeam(teamName, Object.keys(allStats));
  return match ? allStats[match] : null;
}

export function computeNhlLeagueAverage(allStats: Record<string, NhlTeamStats>): { scoredAvg: number; concededAvg: number } {
  const values = Object.values(allStats);
  if (values.length === 0) return { scoredAvg: 3.0, concededAvg: 3.0 };
  return {
    scoredAvg: values.reduce((acc, s) => acc + s.scoredAvg, 0) / values.length,
    concededAvg: values.reduce((acc, s) => acc + s.concededAvg, 0) / values.length,
  };
}
