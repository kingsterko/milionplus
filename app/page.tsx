import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import { recordTipAction, refreshAction } from "@/lib/actions";
import { LEAGUES, DEFAULT_LEAGUE_ID, getLeague } from "@/lib/leagues";
import { formatKickoff, formatDayHeading, dayKey } from "@/lib/format";
import { listOpenTips } from "@/lib/db";
import { buildSafestTicket } from "@/lib/ticket";

export const dynamic = "force-dynamic";

const LEG_OPTIONS = [2, 3, 4, 5, 6];

function LeagueSwitcher({ activeId }: { activeId: string }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {LEAGUES.map((l) => (
        <Link
          key={l.id}
          href={`/?league=${l.id}`}
          className={`badge ${l.id === activeId ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { league?: string; legs?: string };
}) {
  const leagueId = searchParams.league ?? DEFAULT_LEAGUE_ID;
  const league = getLeague(leagueId);
  const numLegs = LEG_OPTIONS.includes(Number(searchParams.legs)) ? Number(searchParams.legs) : 3;

  let data;
  try {
    data = await getDashboardData(leagueId);
  } catch (e: unknown) {
    const message =
      (e as any)?.message ||
      (typeof e === "object" ? JSON.stringify(e, null, 2) : String(e));
    return (
      <div className="space-y-4 mt-4">
        <LeagueSwitcher activeId={league.id} />
        <div className="card">
          <p className="text-red font-medium">Chyba pri načítaní dát</p>
          <pre className="text-xs text-muted mt-2 whitespace-pre-wrap break-words">{message}</pre>
        </div>
      </div>
    );
  }

  const { matches, bank, valueTips, confidenceEntries, totalsConfidenceEntries, modelWarnings, diagnostics, kickoffByMatch } = data;

  const openTips = await listOpenTips();
  const openKeys = new Set(openTips.map((t) => `${t.match}|${t.market}|${t.outcome}`));
  function isRecorded(match: string, market: string, outcome: string): boolean {
    return openKeys.has(`${match}|${market}|${outcome}`);
  }

  function kickoffFor(matchLabel: string): string | null {
    const base = matchLabel.replace(/ \(Nad\/Pod\)$/, "");
    const iso = kickoffByMatch[base];
    return iso ? formatKickoff(iso) : null;
  }

  const ticket = buildSafestTicket(confidenceEntries, totalsConfidenceEntries, numLegs, bank);
  const ticketRecorded = ticket
    ? isRecorded(`Tiket (${ticket.legs.length}x)`, "tiket", ticket.legs.map((l) => `${l.match}: ${l.outcome}`).join(" | "))
    : false;

  return (
    <div className="space-y-8 mt-4">
      <LeagueSwitcher activeId={league.id} />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {league.label} · najbližších {matches.length} zápasov · bank €{bank.toFixed(2)}
        </p>
        <form action={refreshAction}>
          <button className="btn-primary" type="submit">
            🔄 Obnoviť
          </button>
        </form>
      </div>

      {modelWarnings.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">
            ⚠️ {modelWarnings.length} zápas(y) bez vlastného modelu (fallback)
          </summary>
          <ul className="mt-2 space-y-1">
            {modelWarnings.map((w, i) => (
              <li key={i} className="text-xs text-muted">
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ---------- Value tipy ---------- */}
      <section>
        <h2 className="text-xl font-display font-semibold">💡 Value tipy</h2>
        <p className="text-xs text-muted mt-1 mb-3">
          Hľadá kurzy, ktoré platia viac, než hovorí odhadovaná pravdepodobnosť.
        </p>
        {valueTips.length === 0 ? (
          <p className="text-sm text-muted">
            Momentálne žiadny zápas neprešiel prahom pre value tip — trh je efektívne ocenený.
          </p>
        ) : (
          <div className="space-y-3">
            {valueTips.map((t, i) => (
                <div key={i} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{t.match}</p>
                      <p className="text-xs text-muted">
                        {t.outcome} @ {t.bookmaker} · kurz {t.odds.toFixed(2)}
                      </p>
                      {kickoffFor(t.match) && (
                        <p className="text-[10px] font-mono text-muted mt-0.5">🕐 {kickoffFor(t.match)}</p>
                      )}
                    </div>
                    <span className="badge badge-green shrink-0">
                      +{t.edge.toFixed(1)}% (prah {t.threshold.toFixed(1)}%)
                    </span>
                  </div>
                  <p className="text-sm mt-2">
                    Odporúčaná stávka: <span className="font-mono text-green">€{t.stake.toFixed(2)}</span>{" "}
                    <span className="text-muted">({((t.stake / bank) * 100).toFixed(1)}% banku)</span>
                  </p>
                  <form action={recordTipAction} className="mt-2">
                    <input type="hidden" name="match" value={t.match} />
                    <input type="hidden" name="market" value="value" />
                    <input type="hidden" name="outcome" value={t.outcome} />
                    <input type="hidden" name="bookmaker" value={t.bookmaker} />
                    <input type="hidden" name="odds" value={t.odds} />
                    <input type="hidden" name="edge" value={t.edge} />
                    <input type="hidden" name="stake" value={t.stake} />
                    {isRecorded(t.match, "value", t.outcome) ? (
                      <span className="text-xs text-green">✅ Už zaznamenané (viď História)</span>
                    ) : (
                      <button className="btn" type="submit">
                        📝 Zaznamenať
                      </button>
                    )}
                  </form>
                </div>
              ))}
          </div>
        )}

        <details className="card mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            🔍 Diagnostika — čísla za každým výsledkom
          </summary>
          <p className="text-xs text-muted mt-2 mb-2">
            Ak sú edge a prah blízko seba, bookmakeri sú si medzi sebou blízki (bežné pri PL).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-muted text-left">
                  <th className="pr-3 py-1">zápas</th>
                  <th className="pr-3">trh</th>
                  <th className="pr-3">výsledok</th>
                  <th className="pr-3">kurz</th>
                  <th className="pr-3">trh %</th>
                  <th className="pr-3">model %</th>
                  <th className="pr-3">edge</th>
                  <th className="pr-3">prah</th>
                  <th>✓</th>
                </tr>
              </thead>
              <tbody>
                {[...diagnostics]
                  .sort((a, b) => b.edge - b.prah - (a.edge - a.prah))
                  .map((d, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="pr-3 py-1">{d.match}</td>
                      <td className="pr-3">{d.trh}</td>
                      <td className="pr-3">{d.vysledok}</td>
                      <td className="pr-3">{d.kurz.toFixed(2)}</td>
                      <td className="pr-3">{d.trhPct.toFixed(1)}</td>
                      <td className="pr-3">{d.modelPct.toFixed(1)}</td>
                      <td className="pr-3">{d.edge.toFixed(1)}</td>
                      <td className="pr-3">{d.prah.toFixed(1)}</td>
                      <td>{d.presiel ? "✅" : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ---------- Tiket istoty (kombinacia viacerych tipov) ---------- */}
      <section>
        <h2 className="text-xl font-display font-semibold">🎫 Tiket istoty</h2>
        <p className="text-xs text-muted mt-1 mb-3">
          Automaticky poskladá {numLegs} najistejších tipov z rôznych zápasov do jedného tiketu
          (max. jedna noha na zápas). Kombinovaná pravdepodobnosť = súčin jednotlivých — klesá
          rýchlejšie, než by človek čakal.
        </p>

        <div className="flex gap-2 mb-3">
          {LEG_OPTIONS.map((n) => (
            <Link
              key={n}
              href={`/?league=${leagueId}&legs=${n}`}
              className={`badge ${n === numLegs ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
            >
              {n} nohy
            </Link>
          ))}
        </div>

        {!ticket ? (
          <p className="text-sm text-muted">
            Nedostatok istých tipov na zloženie {numLegs}-nohého tiketu z najbližších zápasov —
            skús menej nôh, alebo počkaj na ďalšie zápasy.
          </p>
        ) : (
          <div className="card">
            <div className="space-y-2 mb-3">
              {ticket.legs.map((leg, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
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
              Stávka <span className="font-mono text-green">€{ticket.stake.toFixed(2)}</span> → výhra{" "}
              <span className="font-mono">€{ticket.potentialPayout.toFixed(2)}</span>{" "}
              <span className="text-muted">
                (šanca {ticket.combinedProb.toFixed(0)}%, že vyhráš presne toto — nie viac)
              </span>
            </p>

            <form action={recordTipAction}>
              <input type="hidden" name="match" value={`Tiket (${ticket.legs.length}x)`} />
              <input type="hidden" name="market" value="tiket" />
              <input type="hidden" name="outcome" value={ticket.legs.map((l) => `${l.match}: ${l.outcome}`).join(" | ")} />
              <input type="hidden" name="bookmaker" value={ticket.legs.map((l) => l.bookmaker).join(", ")} />
              <input type="hidden" name="odds" value={ticket.combinedOdds} />
              <input type="hidden" name="edge" value={0} />
              <input type="hidden" name="stake" value={ticket.stake} />
              {ticketRecorded ? (
                <span className="text-xs text-green">✅ Už zaznamenané</span>
              ) : (
                <button className="btn" type="submit">
                  📝 Zaznamenať tiket
                </button>
              )}
            </form>
          </div>
        )}
      </section>

      {/* ---------- Iste tipy ---------- */}
      <section>
        <h2 className="text-xl font-display font-semibold">🎯 Isté tipy</h2>
        <p className="text-xs text-muted mt-1 mb-3">
          Hľadá výsledky s najvyššou šancou na trafenie, aj keď kurz je menší.
        </p>
        {confidenceEntries.length === 0 && totalsConfidenceEntries.length === 0 ? (
          <p className="text-sm text-muted">Žiadny zápas zatiaľ nemá dostatočne istého favorita.</p>
        ) : (
          <div className="space-y-3">
            {confidenceEntries.map((entry, i) => (
              <div key={i} className="card">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">{entry.match}</p>
                  {kickoffFor(entry.match) && (
                    <span className="text-[10px] font-mono text-muted">🕐 {kickoffFor(entry.match)}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Favorit</p>
                    {entry.confidence ? (
                      <>
                        <p className="text-sm">
                          <span className="font-medium">{entry.confidence.outcome}</span> @{" "}
                          {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                        </p>
                        <p className="text-xs text-muted">
                          Šanca: {entry.confidence.modelProb.toFixed(0)}% · edge{" "}
                          {entry.confidence.edge >= 0 ? "+" : ""}
                          {entry.confidence.edge.toFixed(1)}%
                        </p>
                        <form action={recordTipAction} className="mt-2">
                          <input type="hidden" name="match" value={entry.match} />
                          <input type="hidden" name="market" value="istota" />
                          <input type="hidden" name="outcome" value={entry.confidence.outcome} />
                          <input type="hidden" name="bookmaker" value={entry.confidence.bookmaker} />
                          <input type="hidden" name="odds" value={entry.confidence.odds} />
                          <input type="hidden" name="edge" value={entry.confidence.edge} />
                          <input type="hidden" name="stake" value={Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5)} />
                          {isRecorded(entry.match, "istota", entry.confidence.outcome) ? (
                            <span className="text-xs text-green">✅ Už zaznamenané</span>
                          ) : (
                            <button className="btn" type="submit">
                              📝 Zaznamenať
                            </button>
                          )}
                        </form>
                      </>
                    ) : (
                      <p className="text-xs text-muted">Nedosahuje minimálnu istotu.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Dvojšanca</p>
                    {entry.doubleChance ? (
                      <>
                        <p className="text-sm">
                          <span className="font-medium">{entry.doubleChance.label}</span> —{" "}
                          {entry.doubleChance.description}
                        </p>
                        <p className="text-xs text-muted">
                          Šanca: {entry.doubleChance.modelProb.toFixed(0)}% · odh. kurz ~
                          {entry.doubleChance.estimatedOdds.toFixed(2)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted">Nepodarilo sa odhadnúť.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {totalsConfidenceEntries.length > 0 && (
              <div>
                <p className="text-sm font-medium mt-4 mb-2">⚽ Nad/Pod 2.5 gólu</p>
                {totalsConfidenceEntries.map((entry, i) => (
                  <div key={i} className="card mb-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm">
                        <span className="font-medium">{entry.match}</span>: {entry.confidence.outcome} @{" "}
                        {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                      </p>
                      {kickoffFor(entry.match) && (
                        <span className="text-[10px] font-mono text-muted shrink-0 ml-2">
                          🕐 {kickoffFor(entry.match)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      Šanca: {entry.confidence.modelProb.toFixed(0)}% · edge{" "}
                      {entry.confidence.edge >= 0 ? "+" : ""}
                      {entry.confidence.edge.toFixed(1)}%
                    </p>
                    <form action={recordTipAction} className="mt-2">
                      <input type="hidden" name="match" value={entry.match} />
                      <input type="hidden" name="market" value="istota" />
                      <input type="hidden" name="outcome" value={entry.confidence.outcome} />
                      <input type="hidden" name="bookmaker" value={entry.confidence.bookmaker} />
                      <input type="hidden" name="odds" value={entry.confidence.odds} />
                      <input type="hidden" name="edge" value={entry.confidence.edge} />
                      <input type="hidden" name="stake" value={Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5)} />
                      {isRecorded(entry.match, "istota", entry.confidence.outcome) ? (
                        <span className="text-xs text-green">✅ Už zaznamenané</span>
                      ) : (
                        <button className="btn" type="submit">
                          📝 Zaznamenať
                        </button>
                      )}
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------- Vsetky zapasy (zoskupene podla dna) ---------- */}
      <section>
        <h2 className="text-xl font-display font-semibold mb-3">📋 Najbližších {matches.length} zápasov</h2>
        <div className="space-y-4">
          {Object.entries(
            matches.reduce<Record<string, typeof matches>>((groups, m) => {
              const key = dayKey(m.commenceTime);
              (groups[key] ??= []).push(m);
              return groups;
            }, {})
          ).map(([key, dayMatches]) => (
            <div key={key}>
              <p className="text-[10px] uppercase tracking-widest text-green font-mono mb-2">
                {formatDayHeading(dayMatches[0].commenceTime)}
              </p>
              <div className="space-y-2">
                {dayMatches.map((m, i) => (
                  <details key={i} className="card">
                    <summary className="cursor-pointer text-sm font-medium flex items-center justify-between gap-2">
                      <span>
                        {m.home} vs {m.away}
                      </span>
                      <span className="text-[10px] font-mono text-muted shrink-0">
                        {new Date(m.commenceTime).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 text-xs">
                      {m.odds.length > 0 && (
                        <div>
                          <p className="text-muted mb-1">1X2:</p>
                          {m.bookmakers.map((bm, j) => (
                            <p key={j} className="font-mono">
                              {bm}: 1={m.odds[j].h.toFixed(2)} X={m.odds[j].d.toFixed(2)} 2={m.odds[j].a.toFixed(2)}
                            </p>
                          ))}
                        </div>
                      )}
                      {m.totalsOdds.length > 0 && (
                        <div>
                          <p className="text-muted mb-1">Nad/Pod 2.5:</p>
                          {m.totalsBookmakers.map((bm, j) => (
                            <p key={j} className="font-mono">
                              {bm}: Nad={m.totalsOdds[j].over.toFixed(2)} Pod={m.totalsOdds[j].under.toFixed(2)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
