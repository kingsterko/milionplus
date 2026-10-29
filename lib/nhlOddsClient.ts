import { recordApiQuota, getCachedOdds, setCachedOdds } from "./db";

/**
 * Kurze pre NHL z The Odds API - dve NEZAVISLE casti, kazda s vlastnou cache
 * a vlastnym tlacidlom "Obnovit":
 *
 * 1) Moneyline + Nad/Pod (hromadny /odds, markets=h2h,totals = 2 kredity).
 *    Cache "nhl:icehockey_nhl". Stiahne sa pri prazdnej cache alebo po
 *    kliknuti na "Obnovit moneyline".
 *
 * 2) Riadna doba (trh "h2h_3_way"). Je to "additional market" - hromadny
 *    /odds ho odmieta (422 INVALID_MARKET), da sa pytat len po jednom zapase
 *    cez /events/{id}/odds. Cena: 1 kredit za zapas s datami, odpovede BEZ
 *    dat sa neuctuju. Cache "nhl:regulation". Stiahne sa VYHRADNE po
 *    kliknuti na "Obnovit riadnu dobu" - nikdy pri nacitani stranky ani pri
 *    obnoveni moneyline. Najviac REGULATION_MAX_EVENTS kreditov, prva chyba
 *    zastavi dalsie volania. Vypnutie: NHL_REGULATION_MARKET=off.
 *
 * Kurzy riadnej doby sa k zapasom pripajaju pri citani podla ID zapasu, takze
 * prezivaju aj obnovenie moneylinu.
 */

const SPORT_KEY = "icehockey_nhl";
const SPORT_BASE = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}`;
const TOTALS_LINE = 6.5; // bezna hranica pre NHL (na rozdiel od futbalovych 2.5)
const CACHE_KEY = "nhl:icehockey_nhl";
const REG_KEY = "nhl:regulation";
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
  fetchedAt?: string;
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

interface RegulationEntry {
  bookmakers: string[];
  odds: { home: number; draw: number; away: number }[];
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
export function parseRegulationEvent(ev: any, home: string, away: string): RegulationEntry {
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

type RegulationResult = ({ ok: true } & RegulationEntry) | { ok: false; error: string };

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
 * (null = bez problemu) a zoznam ID zapasov, na ktore sa API realne pytalo
 * (aby sa dalo rozlisit "prazdna odpoved" od "nedosiahnute"). Prva chyba
 * zastavi dalsie volania.
 */
export async function enrichWithRegulation(
  apiKey: string,
  matches: NhlMatch[],
  region: string
): Promise<{ note: string | null; queried: string[] }> {
  if (!isRegulationEnabled()) return { note: null, queried: [] };

  const nowMs = Date.now();
  const targets = matches
    .filter((m) => m.id && new Date(m.commenceTime).getTime() >= nowMs)
    .sort((a, b) => (a.commenceTime < b.commenceTime ? -1 : a.commenceTime > b.commenceTime ? 1 : 0))
    .slice(0, REGULATION_MAX_EVENTS);

  const queried: string[] = [];
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
    queried.push(targets[i].id as string);
  }

  if (!note && targets.length > 0 && !targets.some((m) => m.regulationOdds.length > 0)) {
    note = "Bookmakeri pre NHL trh „riadna doba“ momentálne žiadne kurzy neponúkajú (alebo ich API pre túto súťaž nevracia).";
  }
  return { note, queried };
}

function normalize(matches: NhlMatch[]): NhlMatch[] {
  return matches.map((m) => ({
    ...m,
    regulationBookmakers: m.regulationBookmakers ?? [],
    regulationOdds: m.regulationOdds ?? [],
  }));
}

/** Moneyline + Nad/Pod z vlastnej cache (stiahne len ak je prazdna) + kurzy riadnej doby z ich vlastnej cache. */
export async function fetchNhlOdds(apiKey: string, region = "us"): Promise<NhlMatch[]> {
  const cached = await getCachedOdds(CACHE_KEY);
  let matches: NhlMatch[];
  if (cached && Array.isArray(cached.data)) {
    matches = normalize(cached.data as NhlMatch[]);
  } else {
    matches = await fetchFreshNhlOdds(apiKey, region);
    await setCachedOdds(CACHE_KEY, matches);
  }

  const stampedAt = cached && Array.isArray(cached.data) ? cached.fetchedAt : new Date().toISOString();
  matches = matches.map((m) => ({ ...m, fetchedAt: stampedAt }));

  const reg = await getCachedOdds(REG_KEY);
  const byEventId: Record<string, RegulationEntry> = (reg && reg.data && reg.data.byEventId) || {};
  return matches.map((m) =>
    m.id && byEventId[m.id]
      ? { ...m, regulationBookmakers: byEventId[m.id].bookmakers, regulationOdds: byEventId[m.id].odds }
      : m
  );
}

/** Tlacidlo "Obnovit riadnu dobu": jedine miesto, kde sa trh h2h_3_way sťahuje. Moneyline sa tu NEOBNOVUJE. */
export async function refreshNhlRegulation(apiKey: string, region = "us"): Promise<void> {
  if (!isRegulationEnabled()) return;

  const prevCached = await getCachedOdds(REG_KEY);
  const prev: Record<string, RegulationEntry> = (prevCached && prevCached.data && prevCached.data.byEventId) || {};
  const prevFetchedAt: string | null = (prevCached && prevCached.data && prevCached.data.fetchedAt) || null;

  const keepPrevWithNote = async (note: string) =>
    setCachedOdds(REG_KEY, { byEventId: prev, note, fetchedAt: prevFetchedAt });

  const base = await getCachedOdds(CACHE_KEY);
  if (!base || !Array.isArray(base.data) || base.data.length === 0) {
    await keepPrevWithNote("Najprv načítaj základné kurzy (tlačidlo Obnoviť moneyline) — bez nich nepoznáme zápasy.");
    return;
  }
  const matches = normalize(base.data as NhlMatch[]);
  if (!matches.some((m) => m.id)) {
    await keepPrevWithNote("Uložené základné kurzy sú zo staršej verzie bez ID zápasov — klikni najprv Obnoviť moneyline.");
    return;
  }

  const { note, queried } = await enrichWithRegulation(apiKey, matches, region);
  const queriedSet = new Set(queried);

  const byEventId: Record<string, RegulationEntry> = {};
  for (const m of matches) {
    if (!m.id) continue;
    if (queriedSet.has(m.id)) {
      if (m.regulationOdds.length > 0) byEventId[m.id] = { bookmakers: m.regulationBookmakers, odds: m.regulationOdds };
    } else if (prev[m.id]) {
      byEventId[m.id] = prev[m.id]; // nedosiahnute (chyba/limit) - ponechaj predchadzajuce kurzy
    }
  }
  await setCachedOdds(REG_KEY, { byEventId, note, fetchedAt: new Date().toISOString() });
}

export async function getNhlRegulationStatus(): Promise<{ enabled: boolean; note: string | null; fetchedAt: string | null }> {
  const cached = await getCachedOdds(REG_KEY);
  const d = cached && cached.data ? cached.data : null;
  return {
    enabled: isRegulationEnabled(),
    note: d && typeof d.note === "string" ? d.note : null,
    fetchedAt: d && typeof d.fetchedAt === "string" ? d.fetchedAt : null,
  };
}
