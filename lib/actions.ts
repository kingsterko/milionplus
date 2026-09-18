"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import * as db from "./db";

/**
 * DOLEZITE: tieto akcie (zaznamenat/vysporiadat/zmazat/upravit tip, upravit bank)
 * NEVOLAJU revalidatePath("/") - to by zneplatnilo VSETKY cachovane data
 * pouzite pri renderovani tej stranky, vratane draho cachovanych kurzov z
 * The Odds API (kazde kliknutie by tak vynutilo novy, zbytocny, platený
 * request).
 *
 * NAMIESTO toho volaju revalidatePath("/history") - to JE bezpecne, lebo
 * stranka /history nikdy nesťahuje kurze (ziadny "odds" tag sa tam
 * nepouziva), takze zneplatnenie jej cache sa kreditov vobec netyka. Tento
 * krok zaroven vyriesi oneskorenie/zastaranu verziu Histórie po akcii
 * spustenej na hlavnej stranke (Next.js klientska Router Cache by inak
 * mohla na chvilu ukazat starsi stav /history).
 *
 * UI na aktualnej stranke sa navyse aktualizuje aj cez router.refresh()
 * (components/ActionForm.tsx) - Supabase citania su vzdy cerstve, lebo
 * nejdu cez Next.js fetch-cache system.
 */

export async function recordTipAction(formData: FormData) {
  const match = String(formData.get("match"));
  const market = String(formData.get("market"));
  const outcome = String(formData.get("outcome"));
  const bookmaker = String(formData.get("bookmaker"));
  const odds = parseFloat(String(formData.get("odds")));
  const edge = parseFloat(String(formData.get("edge")));
  const predictedProb = parseFloat(String(formData.get("predictedProb")));
  const stake = parseFloat(String(formData.get("stake")));

  await db.logTip(match, market, outcome, bookmaker, odds, edge, predictedProb, stake);
  revalidatePath("/history");
}

export async function settleTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  const won = String(formData.get("won")) === "true";

  await db.settleTip(id, won);
  revalidatePath("/history");
}

export async function deleteTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  await db.deleteTip(id);
  revalidatePath("/history");
}

export async function editTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  if (Number.isNaN(id)) return;

  const odds = parseFloat(String(formData.get("odds")));
  const stake = parseFloat(String(formData.get("stake")));

  await db.updateTip(id, {
    odds: Number.isNaN(odds) ? undefined : odds,
    stake: Number.isNaN(stake) ? undefined : stake,
  });
  revalidatePath("/history");
}

export async function updateBankAction(formData: FormData) {
  const value = parseFloat(String(formData.get("bank")));
  if (Number.isNaN(value) || value < 0) return;

  await db.setBank(value, "manuálna úprava");
  revalidatePath("/history");
}

// Tieto DVE akcie su jedine, kde CHCEME zneplatnit cache kurzov - to je cely
// ich zmysel (manualne vynutene obnovenie na uzivatelovu ziadost).
export async function refreshAction() {
  revalidateTag("odds");
  revalidatePath("/");
}

export async function refreshLiveAction() {
  revalidateTag("live");
  revalidateTag("odds");
  revalidatePath("/");
}
