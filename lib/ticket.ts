import { ConfidenceEntry, TotalsConfidenceEntry } from "./dashboard";

/**
 * Sklada "tiket istoty" z najistejsich tipov (favorit 1X2 alebo Nad/Pod) -
 * najviac JEDNA noha na zapas (kombinovanie dvoch trhov z toho isteho
 * zapasu by porusilo predpoklad nezavislosti, na ktorom stoji vypocet
 * kombinovanej pravdepodobnosti).
 *
 * DOLEZITE: kombinovana pravdepodobnost = sucin jednotlivych pravdepodobnosti,
 * takze klesa OVELA rychlejsie, nez by clovek cakal (4 tipy po 80% = len 41%
 * sanca, ze vyjdu vsetky naraz). Toto appka priamo ukazuje v UI, nie je to
 * skryte v pozadi.
 */

export interface TicketLeg {
  match: string;
  outcome: string;
  market: string;
  odds: number;
  modelProb: number;
  bookmaker: string;
}

export interface Ticket {
  legs: TicketLeg[];
  combinedOdds: number;
  combinedProb: number;
  stake: number;
  potentialPayout: number;
}

export function buildSafestTicket(
  confidenceEntries: ConfidenceEntry[],
  totalsConfidenceEntries: TotalsConfidenceEntry[],
  numLegs: number,
  bank: number
): Ticket | null {
  const pool = new Map<string, TicketLeg>();

  for (const e of confidenceEntries) {
    if (!e.confidence) continue;
    pool.set(e.match, {
      match: e.match,
      outcome: e.confidence.outcome,
      market: "1X2",
      odds: e.confidence.odds,
      modelProb: e.confidence.modelProb,
      bookmaker: e.confidence.bookmaker,
    });
  }

  for (const e of totalsConfidenceEntries) {
    const existing = pool.get(e.match);
    if (!existing || e.confidence.modelProb > existing.modelProb) {
      pool.set(e.match, {
        match: e.match,
        outcome: e.confidence.outcome,
        market: "Nad/Pod",
        odds: e.confidence.odds,
        modelProb: e.confidence.modelProb,
        bookmaker: e.confidence.bookmaker,
      });
    }
  }

  const candidates = [...pool.values()].sort((a, b) => b.modelProb - a.modelProb);
  const legs = candidates.slice(0, numLegs);
  if (legs.length < numLegs) return null; // nedostatok istych tipov na pozadovany pocet nôh

  const combinedOdds = legs.reduce((acc, l) => acc * l.odds, 1);
  const combinedProb = legs.reduce((acc, l) => acc * (l.modelProb / 100), 1) * 100;

  // Rovnaka "flat" logika ako pri jednotlivych istota-tipoch (2 % banku,
  // min. €0.50) - nie plny Kelly, lebo cielom tiketu je istota/zabava
  // pri malej stavke, nie hladanie value (kombinovany kurz takmer vzdy
  // stráca voci nasej prahovej Kelly logike kvoli zlozenym maržiam).
  const stake = Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5);

  return {
    legs,
    combinedOdds: Math.round(combinedOdds * 100) / 100,
    combinedProb: Math.round(combinedProb * 10) / 10,
    stake,
    potentialPayout: Math.round(stake * combinedOdds * 100) / 100,
  };
}
