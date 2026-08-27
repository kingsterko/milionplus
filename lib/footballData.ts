/**
 * Port povodneho football_data_client.py. Stahuje jednotlive zapasy PL
 * (aktualna + minula sezona) a pocita vazeny priemer golov s dorazom na
 * posledne zapasy (exponencialny uhyb) - nie plochy priemer za celu sezonu.
 */

import type { TeamVenueStats } from "./poisson";

const BASE_URL = "https://api.football-data.org/v4";

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

/**
 * Kazdy riadok = viacero znamych variantov nazvu (bookmaker styl aj oficialny
 * styl football-data.org), vsetky namapovane na jeden spolocny kanonicky kod.
 * Nezalezi teda, ktora strana (Odds API / football-data.org) pouzije ktory
 * variant - obe sa nakoniec zidu na tom istom kode.
 *
 * Zoznam NIE JE vycerpavajuci a niektore mena mozu byt tymto konkretnym
 * datumom uz neaktualne (postupy/zostupy medzi ligami). Ak narazis na dalsi
 * nespojeny tim (a viac ako tento zoznam), napis mi presny nazov a pridame ho.
 */
const NAME_VARIANTS: Record<string, string> = {
  // La Liga
  "athletic bilbao": "athletic-bilbao",
  "athletic club": "athletic-bilbao",
  "athletic club bilbao": "athletic-bilbao",
  "celta vigo": "celta-vigo",
  "celta de vigo": "celta-vigo",
  "rc celta de vigo": "celta-vigo",
  "rc celta": "celta-vigo",
  "ca osasuna": "osasuna",
  "club atletico osasuna": "osasuna",
  "club atletico de osasuna": "osasuna",
  "osasuna": "osasuna",
  "real racing club de santander": "racing-santander",
  "racing de santander": "racing-santander",
  "racing santander": "racing-santander",
  "real racing club": "racing-santander",
  "atletico madrid": "atletico-madrid",
  "atletico de madrid": "atletico-madrid",
  "club atletico de madrid": "atletico-madrid",
  "malaga": "malaga",
  "malaga cf": "malaga",
  "deportivo la coruna": "deportivo-coruna",
  "deportivo de la coruna": "deportivo-coruna",
  "rc deportivo la coruna": "deportivo-coruna",
  "rc deportivo": "deportivo-coruna",
  "real betis": "real-betis",
  "real betis balompie": "real-betis",
  "rayo vallecano": "rayo-vallecano",
  "rayo vallecano de madrid": "rayo-vallecano",

  // Premier League
  "brighton and hove albion": "brighton",
  "brighton & hove albion": "brighton",
  "brighton hove albion": "brighton",
  "wolves": "wolverhampton",
  "wolverhampton wanderers": "wolverhampton",
  "spurs": "tottenham",
  "tottenham hotspur": "tottenham",
  "man united": "man-utd",
  "man utd": "man-utd",
  "manchester united": "man-utd",
  "man city": "man-city",
  "manchester city": "man-city",
  "newcastle": "newcastle",
  "newcastle united": "newcastle",

  // Bundesliga
  "bayern munich": "bayern",
  "bayern munchen": "bayern",
  "fc bayern munchen": "bayern",
  "1. fc koln": "koln",
  "1 fc koln": "koln",
  "fc koln": "koln",
  "koln": "koln",
  "tsg hoffenheim": "hoffenheim",
  "tsg 1899 hoffenheim": "hoffenheim",
  "hoffenheim": "hoffenheim",
  "bayer leverkusen": "leverkusen",
  "bayer 04 leverkusen": "leverkusen",
  "rb leipzig": "leipzig",
  "rasenballsport leipzig": "leipzig",
  "borussia monchengladbach": "gladbach",
  "vfl borussia monchengladbach": "gladbach",
  "fsv mainz 05": "mainz",
  "1. fsv mainz 05": "mainz",
  "mainz 05": "mainz",
  "sc paderborn": "paderborn",
  "sc paderborn 07": "paderborn",
  "augsburg": "augsburg",
  "fc augsburg": "augsburg",
  "fc schalke 04": "schalke",
  "schalke 04": "schalke",
  "elversberg": "elversberg",
  "sv elversberg": "elversberg",

  // Serie A
  "ac milan": "milan",
  "milan": "milan",
  "inter milan": "inter",
  "internazionale": "inter",
  "internazionale milano": "inter",
  "fc internazionale milano": "inter",
  "venezia": "venezia",
  "venezia fc": "venezia",
  "fiorentina": "fiorentina",
  "acf fiorentina": "fiorentina",
  "frosinone": "frosinone",
  "frosinone calcio": "frosinone",
  "monza": "monza",
  "ac monza": "monza",
  "udinese": "udinese",
  "udinese calcio": "udinese",
  "cagliari": "cagliari",
  "cagliari calcio": "cagliari",

  // Ligue 1
  "paris saint germain": "psg",
  "paris saint-germain": "psg",
  "strasbourg": "strasbourg",
  "rc strasbourg alsace": "strasbourg",
  "rc lens": "lens",
  "racing club de lens": "lens",
  "lens": "lens",
  "lorient": "lorient",
  "fc lorient": "lorient",
  "troyes": "troyes",
  "estac troyes": "troyes",
  "rennes": "rennes",
  "stade rennais": "rennes",
  "le mans fc": "le-mans",
  "le mans": "le-mans",
};

// Bezne "vypln" slova v nazvoch klubov, ktore sa preskocia pri fuzzy
// (token-based) porovnavani ako posledny zachranny pokus. NEOBSAHUJE slova
// ako "real", "athletic", "atletico", "united", "city" - tie su casto
// jedinou vecou, co odlisi dva rozdielne kluby v tej istej lige (napr. Real
// Madrid vs Real Sociedad), takze ich vynechanie by mohlo sposobit false match.
const FUZZY_STOPWORDS = new Set([
  "fc", "cf", "afc", "ac", "sc", "sd", "ud", "cd", "rc", "ca", "ss", "ssc", "as",
  "de", "la", "le", "les", "and", "the", "club", "calcio", "football",
]);

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeTeamName(name: string): string {
  let n = stripDiacritics(name.toLowerCase().trim());
  for (const suffix of [" fc", " afc", " football club", " f.c."]) {
    if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  }
  n = n.trim();
  return NAME_VARIANTS[n] ?? n;
}

/** Vrati "jadrove" slova nazvu (bez cisel a bez bezneho vyplnu) - posledny zachranny pokus pri parovani. */
function coreTokens(normalized: string): string[] {
  return normalized
    .split(/[\s.-]+/)
    .filter((t) => t.length >= 4 && !FUZZY_STOPWORDS.has(t) && !/^\d+$/.test(t));
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

  // Posledny zachranny pokus: zhoda aspon jedneho dost dlheho "jadroveho" slova.
  const targetTokens = new Set(coreTokens(norm));
  if (targetTokens.size > 0) {
    for (const name of available) {
      const nTokens = coreTokens(normalizeTeamName(name));
      if (nTokens.some((t) => targetTokens.has(t))) return name;
    }
  }

  return null;
}

export async function fetchSeasonMatches(apiKey: string, season: number, competitionCode: string): Promise<RawMatch[]> {
  const url = `${BASE_URL}/competitions/${competitionCode}/matches?season=${season}&status=FINISHED`;
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
