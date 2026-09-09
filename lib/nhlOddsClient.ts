import { recordApiQuota } from "./db";

/**
 * Kurze pre NHL z The Odds API. Na rozdiel od futbalu je h2h trh DVOJCESTNY
 * (ziadna remiza - hokej sa vzdy dohrava do vitaza cez predlzenie/najazdy).
 * Vlastny cache tag ("nhl_odds"), aby manualne obnovenie NHL casti
 * neovplyvnilo (a nezneplatnilo) futbalovu cache kurzov a naopak.
 */

const SPORT_KEY = "icehockey_nhl";
const BASE_URL = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`;
const TOTALS_LINE = 6.5; // bezna hranica pre NHL (na rozdiel od futbalovych 2.5)
const CACHE_SECONDS = 900;

async function trackQuota(resp: Response): Promise<void> {
  const remainingRaw = resp.headers.get("x-requests-remaining");
  const usedRaw = resp.headers.get("x-requests-used");
  const remaining = remainingRaw != null ? parseInt(remainingRaw, 10) : null;
  const used = usedRaw != null ? parseInt(usedRaw, 10) : null;
  await recordApiQuota(remaining, used);
}

export interface NhlMatch {
  home: string;
  away: string;
  commenceTime: string;
  bookmakers: string[];
  odds: { home: number; away: number }[];
  totalsBookmakers: string[];
  totalsOdds: { over: number; under: number }[];
}

export async function fetchNhlOdds(apiKey: string, region = "us"): Promise<NhlMatch[]> {
  const params = new URLSearchParams({
    apiKey,
    regions: region,
    markets: "h2h,totals",
    oddsFormat: "decimal",
  });

  const resp = await fetch(`${BASE_URL}?${params.toString()}`, {
    next: { revalidate: CACHE_SECONDS, tags: ["nhl_odds"] },
  });
  await trackQuota(resp);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`The Odds API (NHL) chyba (status ${resp.status}): ${text.slice(0, 200)}`);
  }
  const events = await resp.json();

  const matches: NhlMatch[] = [];
  for (const event of events) {
    const home = event.home_team as string;
    const away = event.away_team as string;
    const bookmakers: string[] = [];
    const odds: { home: number; away: number }[] = [];
    const totalsBookmakers: string[] = [];
    const totalsOdds: { over: number; under: number }[] = [];

    for (const bm of event.bookmakers ?? []) {
      const title = bm.title ?? "?";

      const h2h = (bm.markets ?? []).find((m: any) => m.key === "h2h");
      if (h2h) {
        const outcomes: Record<string, number> = {};
        for (const o of h2h.outcomes) outcomes[o.name] = o.price;
        if (outcomes[home] != null && outcomes[away] != null) {
          bookmakers.push(title);
          odds.push({ home: outcomes[home], away: outcomes[away] });
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

    matches.push({ home, away, commenceTime: event.commence_time, bookmakers, odds, totalsBookmakers, totalsOdds });
  }
  return matches;
}
