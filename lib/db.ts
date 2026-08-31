import getSupabase from "./supabase";

/**
 * Port povodneho db.py, teraz nad Supabase (Postgres) namiesto SQLite -
 * data prezivaju aj opatovne nasadenie appky.
 */

const DEFAULT_BANK = 10.0;

export interface Tip {
  id: number;
  placed_at: string;
  match: string;
  market: string;
  outcome: string;
  bookmaker: string | null;
  odds: number;
  edge: number | null;
  predicted_prob: number | null;
  stake: number;
  status: "open" | "settled";
  result: "won" | "lost" | null;
  profit: number | null;
  settled_at: string | null;
}

export interface BankrollEntry {
  timestamp: string;
  bank: number;
  note: string | null;
}

export async function getCurrentBank(): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bankroll_log")
    .select("bank")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await setBank(DEFAULT_BANK, "počiatočný bank");
    return DEFAULT_BANK;
  }
  return data.bank;
}

export async function setBank(value: number, note = "manuálna úprava"): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("bankroll_log")
    .insert({ timestamp: new Date().toISOString(), bank: Math.round(value * 100) / 100, note });
  if (error) throw error;
}

export async function getBankrollHistory(): Promise<BankrollEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bankroll_log")
    .select("timestamp, bank, note")
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function logTip(
  match: string,
  market: string,
  outcome: string,
  bookmaker: string,
  odds: number,
  edge: number,
  predictedProb: number,
  stake: number
): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tips")
    .insert({
      placed_at: new Date().toISOString(),
      match,
      market,
      outcome,
      bookmaker,
      odds,
      edge,
      predicted_prob: predictedProb,
      stake,
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function listOpenTips(): Promise<Tip[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tips")
    .select("*")
    .eq("status", "open")
    .order("id", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllTips(limit = 50): Promise<Tip[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("tips").select("*").order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function settleTip(tipId: number, won: boolean): Promise<void> {
  const supabase = getSupabase();
  const { data: tip, error: fetchErr } = await supabase.from("tips").select("*").eq("id", tipId).single();
  if (fetchErr) throw fetchErr;
  if (!tip) return;

  const profit = won ? Math.round(tip.stake * (tip.odds - 1) * 100) / 100 : -tip.stake;

  const { error: updateErr } = await supabase
    .from("tips")
    .update({
      status: "settled",
      result: won ? "won" : "lost",
      profit,
      settled_at: new Date().toISOString(),
    })
    .eq("id", tipId);
  if (updateErr) throw updateErr;

  const currentBank = await getCurrentBank();
  const newBank = Math.round((currentBank + profit) * 100) / 100;
  const note = `${won ? "výhra" : "prehra"}: ${tip.match} (${tip.outcome})`;
  await setBank(newBank, note);
}

export async function updateTip(tipId: number, updates: { odds?: number; stake?: number }): Promise<void> {
  const supabase = getSupabase();
  const patch: Record<string, number> = {};
  if (updates.odds != null && updates.odds > 1) patch.odds = Math.round(updates.odds * 100) / 100;
  if (updates.stake != null && updates.stake > 0) patch.stake = Math.round(updates.stake * 100) / 100;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("tips").update(patch).eq("id", tipId).eq("status", "open");
  if (error) throw error;
}

export interface CalibrationBucket {
  label: string;
  minPct: number;
  maxPct: number;
  count: number;
  avgPredicted: number | null;
  actualHitRate: number | null;
}

const CALIBRATION_BUCKETS = [
  { label: "50-60%", min: 50, max: 60 },
  { label: "60-70%", min: 60, max: 70 },
  { label: "70-80%", min: 70, max: 80 },
  { label: "80-90%", min: 80, max: 90 },
  { label: "90-100%", min: 90, max: 100 },
];

const MARKET_LABELS: Record<string, string> = {
  value: "💡 Value tipy",
  istota: "🎯 Isté tipy",
  tiket: "🎫 Tikety",
};

export interface MarketPerformance {
  market: string;
  label: string;
  totalCount: number;
  wonCount: number;
  winRatePct: number | null;
  totalStaked: number;
  totalProfit: number;
  roiPct: number | null;
  buckets: CalibrationBucket[];
}

function buildBuckets(rows: { predicted_prob: number; result: "won" | "lost" }[]): CalibrationBucket[] {
  return CALIBRATION_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.predicted_prob >= b.min && r.predicted_prob < b.max);
    if (inBucket.length === 0) {
      return { label: b.label, minPct: b.min, maxPct: b.max, count: 0, avgPredicted: null, actualHitRate: null };
    }
    const avgPredicted = inBucket.reduce((acc, r) => acc + r.predicted_prob, 0) / inBucket.length;
    const won = inBucket.filter((r) => r.result === "won").length;
    return {
      label: b.label,
      minPct: b.min,
      maxPct: b.max,
      count: inBucket.length,
      avgPredicted: Math.round(avgPredicted * 10) / 10,
      actualHitRate: Math.round((won / inBucket.length) * 1000) / 10,
    };
  });
}

/**
 * Rozdeli vykonnost podla TYPU strategie (value / istota / tiket) - kazdy typ
 * ma uplne inu logiku (hladanie value vs. hladanie pravdepodobnosti), takze
 * ich miesat dokopy skryva, ktora stratégia realne funguje. Pre kazdy typ:
 * - kalibracia (predikovana % vs skutocna uspesnost) z ulozenej predicted_prob
 * - realny vysledok v peniazoch (ROI) - to hovori o zisku/strate, kalibracia
 *   sama o sebe hovori len o presnosti odhadu pravdepodobnosti, nie o zisku
 */
export async function getPerformanceByMarket(): Promise<MarketPerformance[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tips")
    .select("market, predicted_prob, result, stake, profit")
    .eq("status", "settled");
  if (error) throw error;

  const rows = (data ?? []) as {
    market: string;
    predicted_prob: number | null;
    result: "won" | "lost";
    stake: number;
    profit: number | null;
  }[];

  const markets = Array.from(new Set(rows.map((r) => r.market))).sort();

  return markets.map((market) => {
    const marketRows = rows.filter((r) => r.market === market);
    const withProb = marketRows.filter((r): r is typeof r & { predicted_prob: number } => r.predicted_prob != null);

    const wonCount = marketRows.filter((r) => r.result === "won").length;
    const totalStaked = marketRows.reduce((acc, r) => acc + (r.stake ?? 0), 0);
    const totalProfit = marketRows.reduce((acc, r) => acc + (r.profit ?? 0), 0);

    return {
      market,
      label: MARKET_LABELS[market] ?? market,
      totalCount: marketRows.length,
      wonCount,
      winRatePct: marketRows.length ? Math.round((wonCount / marketRows.length) * 1000) / 10 : null,
      totalStaked: Math.round(totalStaked * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      roiPct: totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 1000) / 10 : null,
      buckets: buildBuckets(withProb),
    };
  });
}

export async function isDuplicateOpenTip(match: string, market: string, outcome: string): Promise<boolean> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("tips")
    .select("id", { count: "exact", head: true })
    .eq("match", match)
    .eq("market", market)
    .eq("outcome", outcome)
    .eq("status", "open");
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function deleteTip(tipId: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("tips").delete().eq("id", tipId).eq("status", "open");
  if (error) throw error;
}

export interface ApiQuota {
  remaining: number | null;
  used: number | null;
  updatedAt: string;
}

/**
 * Ulozi najnovsi znamy stav kreditov The Odds API (z hlaviciek x-requests-remaining
 * a x-requests-used, ktore API posiela pri KAZDEJ odpovedi, aj z cache). Chyba
 * pri zapise sa zamerne prehltne - toto je len telemetria, nesmie zhodit hlavny beh appky.
 */
export async function recordApiQuota(remaining: number | null, used: number | null): Promise<void> {
  if (remaining == null && used == null) return;
  try {
    const supabase = getSupabase();
    await supabase.from("api_quota").upsert({
      id: 1,
      updated_at: new Date().toISOString(),
      requests_remaining: remaining,
      requests_used: used,
    });
  } catch {
    // telemetria - ticho ignorovat
  }
}

export async function getApiQuota(): Promise<ApiQuota | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("api_quota").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return null;
    return { remaining: data.requests_remaining, used: data.requests_used, updatedAt: data.updated_at };
  } catch {
    return null;
  }
}
