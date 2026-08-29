/**
 * Port povodneho odds_client.py. Stahuje kurzy 1X2 a Nad/Pod 2.5 golu
 * od viacerych bookmakerov cez The Odds API.
 *
 * DOLEZITE - kredity: The Odds API pocita cenu ako (pocet trhov) x (pocet
 * regionov) za KAZDY request. My ziadame 2 trhy (h2h + totals) x 1 region
 * = 2 kredity na jedno volanie. Pri free planu (500 kreditov/mesiac) to je
 * len 250 volani celkovo. Preto MUSIME cachovat - bez cachovania kazde
 * jednotlive otvorenie/reload stranky minie kredity odznova, aj pri MIX/DNES
 * (7 lig x 2 kredity = 14 naraz). S cachovanim (15 min) sa viacero navstev
 * v ramci tohto okna podeli o jedno stiahnutie.
 */

const BASE_URL_TEMPLATE = (sportKey: string) => `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`;
const TOTALS_LINE = 2.5;
const CACHE_SECONDS = 900; // 15 minut - rozumny kompromis medzi ceerstvostou a setrenim kreditov

export interface OddsMatch {
  home: string;
  away: string;
  commenceTime: string;
  bookmakers: string[];
  odds: { h: number; d: number; a: number }[];
  totalsBookmakers: string[];
  totalsOdds: { over: number; under: number }[];
}

export async function fetchLeagueOdds(apiKey: string, sportKey: string, region = "uk"): Promise<OddsMatch[]> {
  const params = new URLSearchParams({
    apiKey,
    regions: region,
    markets: "h2h,totals",
    oddsFormat: "decimal",
  });

  const resp = await fetch(`${BASE_URL_TEMPLATE(sportKey)}?${params.toString()}`, {
    next: { revalidate: CACHE_SECONDS, tags: ["odds"] },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`The Odds API chyba (status ${resp.status}): ${text.slice(0, 200)}`);
  }
  const events = await resp.json();

  const matches: OddsMatch[] = [];
  for (const event of events) {
    const home = event.home_team as string;
    const away = event.away_team as string;
    const bookmakers: string[] = [];
    const odds: { h: number; d: number; a: number }[] = [];
    const totalsBookmakers: string[] = [];
    const totalsOdds: { over: number; under: number }[] = [];

    for (const bm of event.bookmakers ?? []) {
      const title = bm.title ?? "?";

      const h2h = (bm.markets ?? []).find((m: any) => m.key === "h2h");
      if (h2h) {
        const outcomes: Record<string, number> = {};
        for (const o of h2h.outcomes) outcomes[o.name] = o.price;
        if (outcomes[home] != null && outcomes[away] != null && outcomes["Draw"] != null) {
          bookmakers.push(title);
          odds.push({ h: outcomes[home], d: outcomes["Draw"], a: outcomes[away] });
        }
      }

      const totals = (bm.markets ?? []).find((m: any) => m.key === "totals");
      if (totals) {
        const lineOutcomes: Record<string, number> = {};
        for (const o of totals.outcomes) {
          if (o.point === TOTALS_LINE) lineOutcomes[o.name] = o.price;
        }
        if (lineOutcomes["Over"] != null && lineOutcomes["Under"] != null) {
          totalsBookmakers.push(title);
          totalsOdds.push({ over: lineOutcomes["Over"], under: lineOutcomes["Under"] });
        }
      }
    }

    matches.push({
      home,
      away,
      commenceTime: event.commence_time,
      bookmakers,
      odds,
      totalsBookmakers,
      totalsOdds,
    });
  }
  return matches;
}
