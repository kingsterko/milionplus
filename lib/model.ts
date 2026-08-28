/**
 * Port povodnej Python model.py logiky do TypeScript. Rovnaka matematika:
 * - implicitna pravdepodobnost z kurzu (vig-odstranena)
 * - trhovy konsenzus naprieč bookmakermi
 * - "shrinkage": dovera vo vlastny model klesa pri vyssich kurzoch
 * - dynamicky prah edge podla kurzu
 * - 1/4 Kelly criterion, zastropovane na % banku, s minimalnou stavkou
 */

export type OutcomeKey = "h" | "d" | "a" | "over" | "under";

export interface BookmakerOdds {
  [key: string]: number;
}

export const OUTCOME_LABEL: Record<string, string> = { h: "Domáci", d: "Remíza", a: "Hostia" };
export const TOTALS_LABEL: Record<string, string> = { over: "Nad 2.5 gólu", under: "Pod 2.5 gólu" };

export function impliedProbs(odds: BookmakerOdds): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const k of Object.keys(odds)) {
    raw[k] = 1 / odds[k];
    sum += raw[k];
  }
  const result: Record<string, number> = {};
  for (const k of Object.keys(raw)) result[k] = (raw[k] / sum) * 100;
  return result;
}

export function consensusProbs(oddsList: BookmakerOdds[], keys: string[] = ["h", "d", "a"]): Record<string, number> {
  const sums: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const odds of oddsList) {
    const probs = impliedProbs(odds);
    for (const k of keys) sums[k] += probs[k];
  }
  const n = oddsList.length;
  const result: Record<string, number> = {};
  for (const k of keys) result[k] = sums[k] / n;
  return result;
}

export interface BestPriceInfo {
  odds: number;
  bookmaker: string;
}

export function bestPrice(
  oddsList: BookmakerOdds[],
  names: string[],
  keys: string[] = ["h", "d", "a"]
): Record<string, BestPriceInfo> {
  const best: Record<string, BestPriceInfo> = {};
  for (const k of keys) {
    let maxIdx = 0;
    for (let i = 1; i < oddsList.length; i++) {
      if (oddsList[i][k] > oddsList[maxIdx][k]) maxIdx = i;
    }
    best[k] = { odds: oddsList[maxIdx][k], bookmaker: names[maxIdx] };
  }
  return best;
}

export function trustFactor(odds: number): number {
  const t = 1 - Math.max(0, odds - 1.5) * 0.09;
  return Math.min(1, Math.max(0.3, t));
}

export function adjustedProb(modelPct: number, marketPct: number, odds: number): number {
  const trust = trustFactor(odds);
  return marketPct + (modelPct - marketPct) * trust;
}

export function minEdgeForOdds(odds: number): number {
  return 3 + Math.max(0, odds - 2) * 2;
}

export function recommendStake(
  edgePct: number,
  odds: number,
  modelProbPct: number,
  bank: number,
  kellyFraction = 0.25,
  capPct = 0.1,
  minStake = 0.5
): number {
  const threshold = minEdgeForOdds(odds);
  if (edgePct < threshold) return 0;

  const p = modelProbPct / 100;
  const b = odds - 1;
  if (b <= 0) return 0;
  const kelly = (b * p - (1 - p)) / b;
  if (kelly <= 0) return 0;

  const rawStake = Math.min(kelly * kellyFraction * bank, bank * capPct);
  if (rawStake <= 0) return 0;
  const stake = Math.max(rawStake, minStake);
  return Math.round(Math.min(stake, bank * capPct, bank) * 100) / 100;
}

export interface ValueTip {
  match: string;
  league?: string;
  outcome: string;
  bookmaker: string;
  odds: number;
  consensusProb: number;
  edge: number;
  threshold: number;
  stake: number;
}

export function analyzeMarketGeneric(
  matchLabel: string,
  oddsList: BookmakerOdds[],
  names: string[],
  bank: number,
  keys: string[],
  labels: Record<string, string>,
  ownModelProbs: Record<string, number> | null = null
): ValueTip[] {
  if (oddsList.length < 3) return [];

  const market = consensusProbs(oddsList, keys);
  const best = bestPrice(oddsList, names, keys);

  const tips: ValueTip[] = [];
  for (const k of keys) {
    const odds = best[k].odds;
    const impliedSingle = (1 / odds) * 100;
    const modelProb = ownModelProbs ? adjustedProb(ownModelProbs[k], market[k], odds) : market[k];
    const edge = modelProb - impliedSingle;
    const threshold = minEdgeForOdds(odds);
    if (edge < threshold) continue;
    const stake = recommendStake(edge, odds, modelProb, bank);
    if (stake <= 0) continue;
    tips.push({
      match: matchLabel,
      outcome: labels[k],
      bookmaker: best[k].bookmaker,
      odds,
      consensusProb: Math.round(modelProb * 10) / 10,
      edge: Math.round(edge * 10) / 10,
      threshold: Math.round(threshold * 10) / 10,
      stake,
    });
  }
  return tips;
}

export interface PerOutcomeInfo {
  odds: number;
  bookmaker: string;
  marketProb: number;
  modelProb: number;
  edge: number;
  threshold: number;
}

export function perOutcomeAnalysis(
  ownModelProbs: Record<string, number> | null,
  oddsList: BookmakerOdds[],
  names: string[],
  keys: string[] = ["h", "d", "a"]
): { perOutcome: Record<string, PerOutcomeInfo>; market: Record<string, number> } {
  const market = consensusProbs(oddsList, keys);
  const best = bestPrice(oddsList, names, keys);

  const perOutcome: Record<string, PerOutcomeInfo> = {};
  for (const k of keys) {
    const odds = best[k].odds;
    const impliedSingle = (1 / odds) * 100;
    const modelProb = ownModelProbs ? adjustedProb(ownModelProbs[k], market[k], odds) : market[k];
    perOutcome[k] = {
      odds,
      bookmaker: best[k].bookmaker,
      marketProb: Math.round(market[k] * 10) / 10,
      modelProb: Math.round(modelProb * 10) / 10,
      edge: Math.round((modelProb - impliedSingle) * 10) / 10,
      threshold: Math.round(minEdgeForOdds(odds) * 10) / 10,
    };
  }
  return { perOutcome, market };
}

export interface ConfidencePick extends PerOutcomeInfo {
  key: string;
  outcome: string;
}

export function confidencePick(
  perOutcome: Record<string, PerOutcomeInfo>,
  minConfidence = 55,
  labels: Record<string, string> = OUTCOME_LABEL
): ConfidencePick | null {
  const keys = Object.keys(perOutcome);
  let bestKey = keys[0];
  for (const k of keys) {
    if (perOutcome[k].modelProb > perOutcome[bestKey].modelProb) bestKey = k;
  }
  const info = perOutcome[bestKey];
  if (info.modelProb < minConfidence) return null;
  return { key: bestKey, outcome: labels[bestKey], ...info };
}

export interface DoubleChancePick {
  label: string;
  description: string;
  modelProb: number;
  estimatedOdds: number;
}

const DOUBLE_CHANCE_LABEL: Record<string, string> = {
  "1X": "Domáci alebo remíza",
  "12": "Domáci alebo hostia",
  X2: "Remíza alebo hostia",
};
const DOUBLE_CHANCE_COMBOS: Record<string, [string, string]> = {
  "1X": ["h", "d"],
  "12": ["h", "a"],
  X2: ["d", "a"],
};

export function doubleChancePick(
  perOutcome: Record<string, PerOutcomeInfo>,
  market: Record<string, number>
): DoubleChancePick | null {
  let bestLabel: string | null = null;
  let bestProb = -1;
  for (const [label, [k1, k2]] of Object.entries(DOUBLE_CHANCE_COMBOS)) {
    const prob = perOutcome[k1].modelProb + perOutcome[k2].modelProb;
    if (prob > bestProb) {
      bestProb = prob;
      bestLabel = label;
    }
  }
  if (!bestLabel) return null;

  const [k1, k2] = DOUBLE_CHANCE_COMBOS[bestLabel];
  const marketSum = market[k1] + market[k2];
  if (marketSum <= 0) return null;

  return {
    label: bestLabel,
    description: DOUBLE_CHANCE_LABEL[bestLabel],
    modelProb: Math.round(Math.min(bestProb, 99) * 10) / 10,
    estimatedOdds: Math.round((100 / marketSum) * 100) / 100,
  };
}

// --- 1X2-specifické priame volania (rovnake ako povodne analyze_match / analyze_match_with_model) ---

export function analyzeMatch1x2(
  home: string,
  away: string,
  oddsList: BookmakerOdds[],
  names: string[],
  bank: number,
  ownModelProbs: Record<string, number> | null = null
): ValueTip[] {
  return analyzeMarketGeneric(`${home} vs ${away}`, oddsList, names, bank, ["h", "d", "a"], OUTCOME_LABEL, ownModelProbs);
}
