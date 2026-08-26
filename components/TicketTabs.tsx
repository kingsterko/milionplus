"use client";

import { useState } from "react";
import { recordTipAction } from "@/lib/actions";
import { LEG_OPTIONS } from "@/lib/ticket";
import type { Ticket } from "@/lib/ticket";

export default function TicketTabs({
  ticketsByLegs,
  recordedKeys,
  defaultLegs = 3,
}: {
  ticketsByLegs: Record<number, Ticket | null>;
  recordedKeys: string[];
  defaultLegs?: number;
}) {
  const [legs, setLegs] = useState(defaultLegs);
  const ticket = ticketsByLegs[legs];
  const recordedSet = new Set(recordedKeys);

  const ticketKey = ticket
    ? `Tiket (${ticket.legs.length}x)|tiket|${ticket.legs.map((l) => `${l.match}: ${l.outcome}`).join(" | ")}`
    : "";
  const isRecorded = recordedSet.has(ticketKey);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {LEG_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLegs(n)}
            className={`badge ${n === legs ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
          >
            {n} nohy
          </button>
        ))}
      </div>

      {!ticket ? (
        <p className="text-sm text-muted">
          Nedostatok istých tipov na zloženie {legs}-nohého tiketu z najbližších zápasov — skús
          menej nôh, alebo počkaj na ďalšie zápasy.
        </p>
      ) : (
        <div className="card">
          <div className="space-y-2 mb-3">
            {ticket.legs.map((leg, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <div>
                  <p className="font-medium">{leg.match}</p>
                  <p className="text-xs text-muted">
                    {leg.outcome} ({leg.market}) @ {leg.odds.toFixed(2)} · {leg.bookmaker}
                  </p>
                </div>
                <span className="badge badge-muted shrink-0">{leg.modelProb.toFixed(0)}%</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted">Kombinovaný kurz</p>
              <p className="font-mono text-lg text-green">{ticket.combinedOdds.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted">Kombinovaná šanca</p>
              <p className="font-mono text-lg">{ticket.combinedProb.toFixed(1)}%</p>
            </div>
          </div>

          <p className="text-sm mb-3">
            Stávka <span className="font-mono text-green">€{ticket.stake.toFixed(2)}</span> →
            výhra <span className="font-mono">€{ticket.potentialPayout.toFixed(2)}</span>{" "}
            <span className="text-muted">
              (šanca {ticket.combinedProb.toFixed(0)}%, že vyhráš presne toto — nie viac)
            </span>
          </p>

          <form action={recordTipAction}>
            <input type="hidden" name="match" value={`Tiket (${ticket.legs.length}x)`} />
            <input type="hidden" name="market" value="tiket" />
            <input
              type="hidden"
              name="outcome"
              value={ticket.legs.map((l) => `${l.match}: ${l.outcome}`).join(" | ")}
            />
            <input type="hidden" name="bookmaker" value={ticket.legs.map((l) => l.bookmaker).join(", ")} />
            <input type="hidden" name="odds" value={ticket.combinedOdds} />
            <input type="hidden" name="edge" value={0} />
            <input type="hidden" name="stake" value={ticket.stake} />
            {isRecorded ? (
              <span className="text-xs text-green">✅ Už zaznamenané</span>
            ) : (
              <button className="btn" type="submit">
                📝 Zaznamenať tiket
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
