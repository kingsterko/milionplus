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
