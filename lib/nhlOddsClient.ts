import { recordApiQuota, getCachedOdds, setCachedOdds } from "./db";

/**
 * Kurze pre NHL z The Odds API. Stahujeme TRI trhy naraz:
 * - h2h: moneyline (2-cestny, vratane predlzenia/najazdov) - bezny trh
 * - h2h_3_way: vitaz po RIADNEJ hracej dobe, vratane remizy (vyssie kurze)
 * - totals: Nad/Pod
 *
 * POZOR kredity: The Odds API pocita cenu ako (trhy x regiony) - 3 trhy x 1 region
 * = 3 kredity za jedno stiahnutie NHL kurzov (oproti 2 pred pridanim h2h_3_way).
 *
 * Rovnaka vlastna Supabase cache ako pri futbale (viz oddsClient.ts) -
 * appka NIKDY sama od seba nevola API znova, len na explicitne "Obnovit".
 */

const SPORT_KEY = "icehockey_nhl";
const BASE_URL = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`;
const TOTALS_LINE = 6.5; // bezna hranica pre NHL (na rozdiel od futbalovych 2.5)
const CACHE_KEY = "nhl:icehockey_nhl";

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
  regulationBookmakers: string[];
  regulationOdds: { home: number; draw: number; away: number }[];
  totalsBookmakers: string[];
  totalsOdds: { over: number; under: number }[];
}

async function fetchFreshNhlOdds(apiKey: string, region: string): Promise<NhlMatch[]> {
  const params = new URLSearchParams({
    apiKey,
    regions: region,
    markets: "h2h,h2h_3_way,totals",
    oddsFormat: "decimal",
  });

  const resp = await fetch(`${BASE_URL}?${params.toString()}`, { cache: "no-store" });
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
    const regulationBookmakers: string[] = [];
    const regulationOdds: { home: number; draw: number; away: number }[] = [];
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

      const threeWay = (bm.markets ?? []).find((m: any) => m.key === "h2h_3_way");
      if (threeWay) {
        const outcomes: Record<string, number> = {};
        for (const o of threeWay.outcomes) outcomes[o.name] = o.price;
        if (outcomes[home] != null && outcomes[away] != null && outcomes["Draw"] != null) {
          regulationBookmakers.push(title);
          regulationOdds.push({ home: outcomes[home], draw: outcomes["Draw"], away: outcomes[away] });
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
      regulationBookmakers,
      regulationOdds,
      totalsBookmakers,
      totalsOdds,
    });
  }
  return matches;
}

export async function fetchNhlOdds(apiKey: string, region = "us"): Promise<NhlMatch[]> {
  const cached = await getCachedOdds(CACHE_KEY);
  // Stara cache (pred pridanim 3-way trhu) nema pole regulationOdds - ber ju ako neplatnu a stiahni nanovo.
  if (cached && Array.isArray(cached.data) && (cached.data.length === 0 || "regulationOdds" in cached.data[0])) {
    return cached.data as NhlMatch[];
  }

  const fresh = await fetchFreshNhlOdds(apiKey, region);
  await setCachedOdds(CACHE_KEY, fresh);
  return fresh;
}
