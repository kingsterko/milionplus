import { getCachedOdds, setCachedOdds } from "./db";

/**
 * Cache nad Supabase (tabulka cached_odds) s vlastnou definiciou "cerstve".
 * Pouziva sa pre bezplatne zdroje (football-data.org, NHL standings), aby sa
 * nespoliehali na Next.js fetch-cache, ktoreho spravanie na Vercel nie je
 * spolahlive - a aby sa velke JSON-y nestahovali pri kazdom nacitani stranky.
 *
 * - zaznam je cerstvy (isFresh) -> vrati sa bez volania loaderu
 * - loader zlyha (napr. limit 429) a existuje starsi zaznam -> vrati sa ten
 *   (zastarane data su lepsie nez chyba)
 * - chyba CITANIA cache sa tu zamerne prepise dalej (getCachedOdds hadze) a
 *   NEPREKLOPI sa na "stiahni znova"
 * - chyba ZAPISU cache neznehodnoti uz stiahnuty vysledok
 */
export async function cachedJson<T>(
  key: string,
  isFresh: (fetchedAt: Date) => boolean,
  loader: () => Promise<T>
): Promise<T> {
  const cached = await getCachedOdds(key);
  if (cached && isFresh(new Date(cached.fetchedAt))) return cached.data as T;

  try {
    const fresh = await loader();
    try {
      await setCachedOdds(key, fresh);
    } catch {
      // zapis cache nie je kriticky pre tuto poziadavku
    }
    return fresh;
  } catch (e) {
    if (cached) return cached.data as T;
    throw e;
  }
}
