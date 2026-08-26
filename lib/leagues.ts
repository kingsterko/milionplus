/**
 * Zoznam podporovanych lig. Kazda liga potrebuje:
 * - sport kluc pre The Odds API (kurzy)
 * - kod sutaze pre football-data.org (vlastny model) - null ak nie je dostupny
 *
 * Pridanie dalsej ligy = pridat jeden riadok sem (ak ju obe API podporuju).
 * Ceska liga (Fortuna/Chance liga) NIE JE podporovana The Odds API (overene
 * v ich kompletnom zozname sportov), preto tu chyba.
 */

export interface LeagueConfig {
  id: string;
  label: string;
  oddsSportKey: string;
  footballDataCode: string | null;
}

export const LEAGUES: LeagueConfig[] = [
  { id: "epl", label: "Premier League", oddsSportKey: "soccer_epl", footballDataCode: "PL" },
  { id: "laliga", label: "La Liga", oddsSportKey: "soccer_spain_la_liga", footballDataCode: "PD" },
  { id: "bundesliga", label: "Bundesliga", oddsSportKey: "soccer_germany_bundesliga", footballDataCode: "BL1" },
  { id: "seriea", label: "Serie A", oddsSportKey: "soccer_italy_serie_a", footballDataCode: "SA" },
  { id: "ligue1", label: "Ligue 1", oddsSportKey: "soccer_france_ligue_one", footballDataCode: "FL1" },
  { id: "eredivisie", label: "Eredivisie", oddsSportKey: "soccer_netherlands_eredivisie", footballDataCode: "DED" },
  { id: "primeira", label: "Primeira Liga", oddsSportKey: "soccer_portugal_primeira_liga", footballDataCode: "PPL" },
];

export const DEFAULT_LEAGUE_ID = "epl";

export function getLeague(id: string | undefined): LeagueConfig {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES.find((l) => l.id === DEFAULT_LEAGUE_ID)!;
}
