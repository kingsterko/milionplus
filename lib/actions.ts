"use server";

import { revalidatePath } from "next/cache";
import * as db from "./db";

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
  revalidatePath("/");
}

export async function settleTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  const won = String(formData.get("won")) === "true";

  await db.settleTip(id, won);
  revalidatePath("/");
  revalidatePath("/history");
}

export async function deleteTipAction(formData: FormData) {
  const id = parseInt(String(formData.get("id")), 10);
  await db.deleteTip(id);
  revalidatePath("/");
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
  revalidatePath("/");
  revalidatePath("/history");
}

export async function updateBankAction(formData: FormData) {
  const value = parseFloat(String(formData.get("bank")));
  if (Number.isNaN(value) || value < 0) return;

  await db.setBank(value, "manuálna úprava");
  revalidatePath("/");
  revalidatePath("/history");
}

export async function refreshAction() {
  revalidatePath("/");
}
