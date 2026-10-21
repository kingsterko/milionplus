import { recordApiQuota, getCachedOdds, setCachedOdds } from "./db";

/**
 * Kurze pre NHL z The Odds API.
 *
 * Hromadny request /odds (2 trhy: h2h + totals = 2 kredity):
 * - h2h: moneyline (2-cestny, vratane predlzenia/najazdov)
 * - totals: Nad/Pod
 *
 * Trh "h2h_3_way" (vitaz po RIADNEJ hracej dobe, vratane remizy) je podla
 * dokumentacie "additional market" - hromadny /odds ho odmieta (422
 * INVALID_MARKET). Da sa pytat len po jednom zapase cez
 * /events/{id}/odds. Cena: 1 kredit za trh a region, odpovede BEZ dat sa
 * neuctuju. Preto sa to robi len pri skutocnom stahovani (prazdna cache
 * alebo klik na "Obnovit"), len pre najblizsich REGULATION_MAX_EVENTS zapasov,
 * a prva chyba zastavi vsetky dalsie volania. Vypnutie: premenna prostredia
 * NHL_REGULATION_MARKET=off (Vercel -> Settings -> Environment Variables).
 *
 * Najvyssia cena jedneho obnovenia: 2 + REGULATION_MAX_EVENTS kreditov.
 */

const SPORT_KEY = "icehockey_nhl";
const SPORT_BASE = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}`;
const TOTALS_LINE = 6.5; // bezna hranica pre NHL (na rozdiel od futbalovych 2.5)
const CACHE_KEY = "nhl:icehockey_nhl";
const STATUS_KEY = "nhl:regulation_status";
export const REGULATION_MAX_EVENTS = 10;
const REGULATION_DELAY_MS = 250;

export function isRegulationEnabled(): boolean {
  return process.env.NHL_REGULATION_MARKET !== "off";
}

async function trackQuota(resp: Response): Promise<void> {
  const remainingRaw = resp.headers.get("x-requests-remaining");
  const usedRaw = resp.headers.get("x-requests-used");
  const remaining = remainingRaw != null ? parseInt(remainingRaw, 10) : null;
  const used = usedRaw != null ? parseInt(usedRaw, 10) : null;
  await recordApiQuota(remaining, used);
}

export interface NhlMatch {
  id?: string;
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
    markets: "h2h,totals",
    oddsFormat: "decimal",
  });

  const resp = await fetch(`${SPORT_BASE}/odds?${params.toString()}`, { cache: "no-store" });
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

    matches.push({
      id: event.id,
      home,
      away,
      commenceTime: event.commence_time,
      bookmakers,
      odds,
      regulationBookmakers: [],
      regulationOdds: [],
      totalsBookmakers,
      totalsOdds,
    });
  }
  return matches;
}

/** Vytiahne kurzy 3-cestneho trhu z odpovede /events/{id}/odds. Remiza = vysledok pomenovany "Draw"/"Tie". */
export function parseRegulationEvent(
  ev: any,
  home: string,
  away: string
): { bookmakers: string[]; odds: { home: number; draw: number; away: number }[] } {
  const bookmakers: string[] = [];
  const odds: { home: number; draw: number; away: number }[] = [];

  for (const bm of ev?.bookmakers ?? []) {
    const market = (bm.markets ?? []).find((m: any) => m.key === "h2h_3_way");
    if (!market) continue;

    let h: number | undefined, d: number | undefined, a: number | undefined;
    for (const o of market.outcomes ?? []) {
      const name = String(o.name);
      if (name === home) h = o.price;
      else if (name === away) a = o.price;
      else if (name.toLowerCase() === "draw" || name.toLowerCase() === "tie") d = o.price;
    }
    if (h != null && d != null && a != null) {
      bookmakers.push(bm.title ?? "?");
      odds.push({ home: h, draw: d, away: a });
    }
  }
  return { bookmakers, odds };
}

type RegulationResult =
  | { ok: true; bookmakers: string[]; odds: { home: number; draw: number; away: number }[] }
  | { ok: false; error: string };

async function fetchRegulationForEvent(apiKey: string, m: NhlMatch, region: string): Promise<RegulationResult> {
  const params = new URLSearchParams({
    apiKey,
    regions: region,
    markets: "h2h_3_way",
    oddsFormat: "decimal",
  });

  try {
    const resp = await fetch(`${SPORT_BASE}/events/${m.id}/odds?${params.toString()}`, { cache: "no-store" });
    await trackQuota(resp);
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `status ${resp.status}: ${text.slice(0, 160)}` };
    }
    const ev = await resp.json();
    return { ok: true, ...parseRegulationEvent(ev, m.home, m.away) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Doplni kurzy riadnej doby k najblizsim zapasom. Vrati poznamku pre UI
 * (null = vsetko prebehlo bez problemu). Prva chyba zastavi dalsie volania.
 */
export async function enrichWithRegulation(apiKey: string, matches: NhlMatch[], region: string): Promise<string | null> {
  if (!isRegulationEnabled()) return null;

  const nowMs = Date.now();
  const targets = matches
    .filter((m) => m.id && new Date(m.commenceTime).getTime() >= nowMs)
    .sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0))
    .slice(0, REGULATION_MAX_EVENTS);

  let note: string | null = null;
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, REGULATION_DELAY_MS));
    const r = await fetchRegulationForEvent(apiKey, targets[i], region);
    if (!r.ok) {
      note = `Kurzy riadnej doby sa nepodarilo načítať (${r.error}). Ďalšie volania sa zastavili.`;
      break;
    }
    targets[i].regulationBookmakers = r.bookmakers;
    targets[i].regulationOdds = r.odds;
  }

  if (!note && targets.length > 0 && !targets.some((m) => m.regulationOdds.length > 0)) {
    note = "Bookmakeri pre NHL trh „riadna doba“ momentálne žiadne kurzy neponúkajú (alebo ich API pre túto súťaž nevracia).";
  }
  return note;
}

function normalize(matches: NhlMatch[]): NhlMatch[] {
  return matches.map((m) => ({
    ...m,
    regulationBookmakers: m.regulationBookmakers ?? [],
    regulationOdds: m.regulationOdds ?? [],
  }));
}

export async function fetchNhlOdds(apiKey: string, region = "us"): Promise<NhlMatch[]> {
  const cached = await getCachedOdds(CACHE_KEY);
  if (cached && Array.isArray(cached.data)) {
    // Starsia cache nemusi mat riadnu dobu - doplni sa prazdna, nova platba sa NEspusti sama (len cez "Obnovit").
    return normalize(cached.data as NhlMatch[]);
  }

  const fresh = await fetchFreshNhlOdds(apiKey, region);
  const note = await enrichWithRegulation(apiKey, fresh, region);
  await setCachedOdds(CACHE_KEY, fresh);
  await setCachedOdds(STATUS_KEY, { note });
  return fresh;
}

export async function getNhlRegulationStatus(): Promise<{ enabled: boolean; note: string | null }> {
  const cached = await getCachedOdds(STATUS_KEY);
  const note = cached && cached.data && typeof cached.data.note === "string" ? cached.data.note : null;
  return { enabled: isRegulationEnabled(), note };
}
