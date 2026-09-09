"use server";

import { revalidateTag } from "next/cache";
import * as nhlDb from "./nhlDb";

/**
 * Rovnaky princip ako lib/actions.ts - akcie upravujuce len Supabase data
 * (tipy, bank) NEVOLAJU revalidatePath, aby nezneplatnili cache NHL kurzov.
 * UI aktualizuje klient cez router.refresh() (components/ActionForm.tsx).
 */

export async function recordNhlTipAction(formData: FormData) {
  const match = String(formData.get("match"));
  const market = String(formData.get("market"));
  const outcome = String(formData.get("outcome"));
  const bookmaker = String(formData.get("bookmaker"));
  const odds = parseFloat(String(formData.get("odds")));
  const edge = parseFloat(String(formData.get("edge")));
  const predictedProb = parseFloat(String(formData.get("predictedProb")));
  const stake = parseFloat(String(formData.get("stake")));

  await nhlDb.logTip(match, market, outcome, bookmaker, odds, edge, predictedProb, stake);
}

export async function settleNhlTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  const won = String(formData.get("won")) === "true";
  await nhlDb.settleTip(id, won);
}

export async function deleteNhlTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  await nhlDb.deleteTip(id);
}

export async function editNhlTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  if (Number.isNaN(id)) return;
  const odds = parseFloat(String(formData.get("odds")));
  const stake = parseFloat(String(formData.get("stake")));
  await nhlDb.updateTip(id, {
    odds: Number.isNaN(odds) ? undefined : odds,
    stake: Number.isNaN(stake) ? undefined : stake,
  });
}

export async function updateNhlBankAction(formData: FormData) {
  const value = parseFloat(String(formData.get("bank")));
  if (Number.isNaN(value) || value < 0) return;
  await nhlDb.setBank(value, "manuálna úprava");
}

export async function refreshNhlAction() {
  revalidateTag("nhl_odds");
  revalidateTag("nhl_stats");
}
