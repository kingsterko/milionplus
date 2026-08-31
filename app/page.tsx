import Link from "next/link";
import { getDashboardData, getMixTicketData, getTodayDashboardData, getLiveDashboardData } from "@/lib/dashboard";
import { recordTipAction, refreshAction, refreshLiveAction } from "@/lib/actions";
import { LEAGUES, DEFAULT_LEAGUE_ID, getLeague } from "@/lib/leagues";
import { formatKickoff, formatDayHeading, dayKey, isToday } from "@/lib/format";
import { listOpenTips } from "@/lib/db";
import { buildSafestTicket, LEG_OPTIONS } from "@/lib/ticket";
import TicketTabs from "@/components/TicketTabs";

export const dynamic = "force-dynamic";

const CONFIDENCE_OPTIONS = [50, 55, 60, 65, 70, 75, 80];
const DEFAULT_MIN_CONFIDENCE = 55;
const MIX_ID = "mix";
const TODAY_ID = "today";
const LIVE_ID = "live";

function LeagueSwitcher({ activeId }: { activeId: string }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Link
        href={`/?league=${LIVE_ID}`}
        className={`badge ${activeId === LIVE_ID ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
      >
        🔴 LIVE
      </Link>
      <Link
        href={`/?league=${TODAY_ID}`}
        className={`badge ${activeId === TODAY_ID ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
      >
        📅 DNES
      </Link>
      {LEAGUES.map((l) => (
        <Link
          key={l.id}
          href={`/?league=${l.id}`}
          className={`badge ${l.id === activeId ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
        >
          {l.label}
        </Link>
      ))}
      <Link
        href={`/?league=${MIX_ID}`}
        className={`badge ${activeId === MIX_ID ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
      >
        🎲 MIX
      </Link>
    </div>
  );
}

function ConfidenceSwitcher({ leagueId, active }: { leagueId: string; active: number }) {
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Min. istota:</span>
      {CONFIDENCE_OPTIONS.map((n) => (
        <Link
          key={n}
          href={`/?league=${leagueId}&minConfidence=${n}`}
          className={`badge ${n === active ? "badge-green" : "badge-muted"} hover:border-green transition-colors`}
        >
          {n}%
        </Link>
      ))}
    </div>
  );
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { league?: string; minConfidence?: string };
}) {
  const leagueId = searchParams.league ?? DEFAULT_LEAGUE_ID;
  const minConfidence = CONFIDENCE_OPTIONS.includes(Number(searchParams.minConfidence))
    ? Number(searchParams.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;

  if (leagueId === LIVE_ID) {
    let liveData;
    try {
      liveData = await getLiveDashboardData(minConfidence);
    } catch (e: unknown) {
      const message =
        (e as any)?.message || (typeof e === "object" ? JSON.stringify(e, null, 2) : String(e));
      return (
        <div className="space-y-4 mt-4">
          <LeagueSwitcher activeId={LIVE_ID} />
          <div className="card">
            <p className="text-red font-medium">Chyba pri načítaní dát</p>
            <pre className="text-xs text-muted mt-2 whitespace-pre-wrap break-words">{message}</pre>
          </div>
        </div>
      );
    }

    const { bank, liveMatches, leagueErrors } = liveData;
    const openTips = await listOpenTips();
    const openKeys = new Set(openTips.map((t) => `${t.match}|${t.market}|${t.outcome}`));
    const isRecorded = (match: string, market: string, outcome: string) => openKeys.has(`${match}|${market}|${outcome}`);

    return (
      <div className="space-y-8 mt-4">
        <LeagueSwitcher activeId={LIVE_ID} />
        <ConfidenceSwitcher leagueId={LIVE_ID} active={minConfidence} />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            🔴 {liveMatches.length} naživo bežiacich zápasov · bank €{bank.toFixed(2)}
          </p>
          <form action={refreshLiveAction}>
            <button className="btn-primary" type="submit">
              🔄 Obnoviť skóre
            </button>
          </form>
        </div>

        <p className="text-xs text-muted">
          Odhad uplynutých minút je približný (čas od výkopu podľa API, nie presný živý stav
          zápasu — polčasová prestávka a nadstavený čas nie sú zohľadnené). Predikcia sa počíta
          len pre zápasy, kde máme aj predpasový model.
        </p>

        {leagueErrors.length > 0 && (
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">
              ⚠️ {leagueErrors.length} lig(a) sa nepodarilo načítať
            </summary>
            <ul className="mt-2 space-y-1">
              {leagueErrors.map((e, i) => (
                <li key={i} className="text-xs text-muted">
                  <span className="font-medium">{e.league}:</span> {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {liveMatches.length === 0 ? (
          <p className="text-sm text-muted">Momentálne nikde naživo nehrajú.</p>
        ) : (
          <div className="space-y-3">
            {liveMatches.map((m, i) => (
              <div key={i} className="card-today">
                <div className="flex items-center justify-between mb-1">
                  <span className="badge badge-muted">{m.league}</span>
                  <span className="text-[10px] font-mono text-red font-semibold">🔴 {m.elapsedMinutes}'</span>
                </div>
                <div className="flex items-center justify-between mt-2 mb-2">
                  <p className="font-medium">{m.match}</p>
                  <p className="font-mono text-xl font-bold">
                    {m.homeScore} : {m.awayScore}
                  </p>
                </div>

                {!m.hasModel ? (
                  <p className="text-xs text-muted">
                    Bez vlastného modelu pre tento zápas (nedostatok dát tímov) — len skóre, bez predikcie.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-2 text-center font-mono text-xs">
                      <div className="border border-border rounded p-1.5">
                        <p className="text-muted text-[9px] uppercase">Domáci</p>
                        {m.liveProbs!.h.toFixed(0)}%
                      </div>
                      <div className="border border-border rounded p-1.5">
                        <p className="text-muted text-[9px] uppercase">Remíza</p>
                        {m.liveProbs!.d.toFixed(0)}%
                      </div>
                      <div className="border border-border rounded p-1.5">
                        <p className="text-muted text-[9px] uppercase">Hostia</p>
                        {m.liveProbs!.a.toFixed(0)}%
                      </div>
                    </div>

                    {m.confidence && (
                      <p className="text-xs text-muted mb-2">
                        Aktuálny favorit: <span className="text-text font-medium">{m.confidence.outcome}</span> ({m.confidence.modelProb.toFixed(0)}%)
                      </p>
                    )}

                    {m.valueTips.length === 0 ? (
                      <p className="text-xs text-muted">Momentálne žiadny live value tip.</p>
                    ) : (
                      m.valueTips.map((t, j) => (
                        <div key={j} className="border-t border-border pt-2 mt-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm">
                              <span className="font-medium">{t.outcome}</span> @ {t.bookmaker} · kurz {t.odds.toFixed(2)}
                            </p>
                            <span className="badge badge-green shrink-0">+{t.edge.toFixed(1)}%</span>
                          </div>
                          <p className="text-xs mt-1">
                            Odporúčaná stávka: <span className="font-mono text-green">€{t.stake.toFixed(2)}</span>
                          </p>
                          {isRecorded(t.match, "value", t.outcome) ? (
                            <span className="text-xs text-green">✅ Už zaznamenané</span>
                          ) : (
                            <form action={recordTipAction} className="mt-1">
                              <input type="hidden" name="match" value={t.match} />
                              <input type="hidden" name="market" value="value" />
                              <input type="hidden" name="outcome" value={t.outcome} />
                              <input type="hidden" name="bookmaker" value={t.bookmaker} />
                              <input type="hidden" name="odds" value={t.odds} />
                              <input type="hidden" name="edge" value={t.edge} />
                              <input type="hidden" name="predictedProb" value={t.consensusProb} />
                              <input type="hidden" name="stake" value={t.stake} />
                              <button className="btn" type="submit">
                                📝 Zaznamenať
                              </button>
                            </form>
                          )}
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (leagueId === TODAY_ID) {
    let todayData;
    try {
      todayData = await getTodayDashboardData(minConfidence);
    } catch (e: unknown) {
      const message =
        (e as any)?.message || (typeof e === "object" ? JSON.stringify(e, null, 2) : String(e));
      return (
        <div className="space-y-4 mt-4">
          <LeagueSwitcher activeId={TODAY_ID} />
          <div className="card">
            <p className="text-red font-medium">Chyba pri načítaní dát</p>
            <pre className="text-xs text-muted mt-2 whitespace-pre-wrap break-words">{message}</pre>
          </div>
        </div>
      );
    }

    const { bank, matches: todayMatches, valueTips, confidenceEntries, totalsConfidenceEntries, leagueErrors } = todayData;
    const openTips = await listOpenTips();
    const openKeys = new Set(openTips.map((t) => `${t.match}|${t.market}|${t.outcome}`));
    const isRecorded = (match: string, market: string, outcome: string) => openKeys.has(`${match}|${market}|${outcome}`);

    return (
      <div className="space-y-8 mt-4">
        <LeagueSwitcher activeId={TODAY_ID} />
        <ConfidenceSwitcher leagueId={TODAY_ID} active={minConfidence} />

        <p className="text-xs text-muted">
          📅 Dnes hrá sa {todayMatches.length} zápasov naprieč {LEAGUES.length} ligami · bank €{bank.toFixed(2)}
        </p>

        {leagueErrors.length > 0 && (
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">
              ⚠️ {leagueErrors.length} lig(a) sa nepodarilo načítať
            </summary>
            <ul className="mt-2 space-y-1">
              {leagueErrors.map((e, i) => (
                <li key={i} className="text-xs text-muted">
                  <span className="font-medium">{e.league}:</span> {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {todayMatches.length === 0 ? (
          <p className="text-sm text-muted">Dnes sa v žiadnej zo sledovaných líg nehrá.</p>
        ) : (
          <>
            <section>
              <h2 className="text-xl font-display font-semibold">💡 Value tipy dnes</h2>
              {valueTips.length === 0 ? (
                <p className="text-sm text-muted mt-2">Žiadny dnešný zápas neprešiel prahom pre value tip.</p>
              ) : (
                <div className="space-y-3 mt-3">
                  {valueTips.map((t, i) => (
                    <div key={i} className="card">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{t.match}</p>
                          <p className="text-xs text-muted">
                            {t.league && <span className="text-green">{t.league} · </span>}
                            {t.outcome} @ {t.bookmaker} · kurz {t.odds.toFixed(2)}
                          </p>
                        </div>
                        <span className="badge badge-green shrink-0">+{t.edge.toFixed(1)}%</span>
                      </div>
                      <p className="text-sm mt-2">
                        Odporúčaná stávka: <span className="font-mono text-green">€{t.stake.toFixed(2)}</span>
                      </p>
                      {isRecorded(t.match, "value", t.outcome) ? (
                        <span className="text-xs text-green">✅ Už zaznamenané</span>
                      ) : (
                        <form action={recordTipAction} className="mt-2">
                          <input type="hidden" name="match" value={t.match} />
                          <input type="hidden" name="market" value="value" />
                          <input type="hidden" name="outcome" value={t.outcome} />
                          <input type="hidden" name="bookmaker" value={t.bookmaker} />
                          <input type="hidden" name="odds" value={t.odds} />
                          <input type="hidden" name="edge" value={t.edge} />
                          <input type="hidden" name="predictedProb" value={t.consensusProb} />
                          <input type="hidden" name="stake" value={t.stake} />
                          <button className="btn" type="submit">
                            📝 Zaznamenať
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold">🎯 Isté tipy dnes</h2>
              {confidenceEntries.length === 0 && totalsConfidenceEntries.length === 0 ? (
                <p className="text-sm text-muted mt-2">Žiadny dnešný zápas nemá dostatočne istého favorita.</p>
              ) : (
                <div className="space-y-3 mt-3">
                  {confidenceEntries.map((entry, i) => (
                    <div key={i} className="card">
                      <p className="font-medium">
                        {entry.match}
                        {entry.league && <span className="text-muted font-normal"> · {entry.league}</span>}
                      </p>
                      {entry.confidence ? (
                        <>
                          <p className="text-sm mt-1">
                            <span className="font-medium">{entry.confidence.outcome}</span> @{" "}
                            {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                          </p>
                          <p className="text-xs text-muted">Šanca podľa modelu: {entry.confidence.modelProb.toFixed(0)}%</p>
                          {isRecorded(entry.match, "istota", entry.confidence.outcome) ? (
                            <span className="text-xs text-green">✅ Už zaznamenané</span>
                          ) : (
                            <form action={recordTipAction} className="mt-2">
                              <input type="hidden" name="match" value={entry.match} />
                              <input type="hidden" name="market" value="istota" />
                              <input type="hidden" name="outcome" value={entry.confidence.outcome} />
                              <input type="hidden" name="bookmaker" value={entry.confidence.bookmaker} />
                              <input type="hidden" name="odds" value={entry.confidence.odds} />
                              <input type="hidden" name="edge" value={entry.confidence.edge} />
                              <input type="hidden" name="predictedProb" value={entry.confidence.modelProb} />
                              <input type="hidden" name="stake" value={Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5)} />
                              <button className="btn" type="submit">
                                📝 Zaznamenať
                              </button>
                            </form>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted mt-1">Žiadny favorit nedosahuje minimálnu istotu.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    );
  }

  if (leagueId === MIX_ID) {
    let mixData;
    try {
      mixData = await getMixTicketData(minConfidence);
    } catch (e: unknown) {
      const message =
        (e as any)?.message || (typeof e === "object" ? JSON.stringify(e, null, 2) : String(e));
      return (
        <div className="space-y-4 mt-4">
          <LeagueSwitcher activeId={MIX_ID} />
          <div className="card">
            <p className="text-red font-medium">Chyba pri načítaní dát</p>
            <pre className="text-xs text-muted mt-2 whitespace-pre-wrap break-words">{message}</pre>
          </div>
        </div>
      );
    }

    const { bank, confidenceEntries, totalsConfidenceEntries, leagueErrors } = mixData;
    const openTips = await listOpenTips();
    const openTicketKeys = openTips
      .filter((t) => t.market === "tiket")
      .map((t) => `${t.match}|${t.market}|${t.outcome}`);

    const ticketsByLegs: Record<number, ReturnType<typeof buildSafestTicket>> = {};
    for (const n of LEG_OPTIONS) {
      ticketsByLegs[n] = buildSafestTicket(confidenceEntries, totalsConfidenceEntries, n, bank);
    }

    return (
      <div className="space-y-8 mt-4">
        <LeagueSwitcher activeId={MIX_ID} />
        <ConfidenceSwitcher leagueId={MIX_ID} active={minConfidence} />

        <p className="text-xs text-muted">
          🎲 MIX · isté tipy zo všetkých {LEAGUES.length} líg naraz · bank €{bank.toFixed(2)}
        </p>

        {leagueErrors.length > 0 && (
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">
              ⚠️ {leagueErrors.length} lig(a) sa nepodarilo načítať (ostatné pokračujú normálne)
            </summary>
            <ul className="mt-2 space-y-1">
              {leagueErrors.map((e, i) => (
                <li key={i} className="text-xs text-muted">
                  <span className="font-medium">{e.league}:</span> {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        <details open className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold">🎫 MIX tiket istoty</h2>
            <span className="text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p className="text-xs text-muted mt-1 mb-3">
            Poskladá najistejšie tipy naprieč všetkými ligami (max. jedna noha na zápas). Rovnaká
            logika ako tiket pre jednu ligu, len s oveľa väčším výberom zápasov.
          </p>
          <TicketTabs ticketsByLegs={ticketsByLegs} recordedKeys={openTicketKeys} />
        </details>
      </div>
    );
  }

  const league = getLeague(leagueId);

  let data;
  try {
    data = await getDashboardData(leagueId, minConfidence);
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

  function isTodayMatch(matchLabel: string): boolean {
    const base = matchLabel.replace(/ \(Nad\/Pod\)$/, "");
    const iso = kickoffByMatch[base];
    return iso ? isToday(iso) : false;
  }

  const ticketsByLegs: Record<number, ReturnType<typeof buildSafestTicket>> = {};
  for (const n of LEG_OPTIONS) {
    ticketsByLegs[n] = buildSafestTicket(confidenceEntries, totalsConfidenceEntries, n, bank);
  }
  const openTicketKeys = openTips
    .filter((t) => t.market === "tiket")
    .map((t) => `${t.match}|${t.market}|${t.outcome}`);

  return (
    <div className="space-y-8 mt-4">
      <LeagueSwitcher activeId={league.id} />
      <ConfidenceSwitcher leagueId={league.id} active={minConfidence} />

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
      <details open className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
          <h2 className="text-xl font-display font-semibold">💡 Value tipy</h2>
          <span className="text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
        </summary>
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
                <div key={i} className={isTodayMatch(t.match) ? "card-today" : "card"}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{t.match}</p>
                      <p className="text-xs text-muted">
                        {t.outcome} @ {t.bookmaker} · kurz {t.odds.toFixed(2)}
                      </p>
                      {kickoffFor(t.match) && (
                        <p className="text-[10px] font-mono mt-0.5 text-muted">🕐 {kickoffFor(t.match)}</p>
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
                    <input type="hidden" name="edge" value={t.edge} /><input type="hidden" name="predictedProb" value={t.consensusProb} />
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
      </details>

      {/* ---------- Tiket istoty (kombinacia viacerych tipov) ---------- */}
      <details open className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
          <h2 className="text-xl font-display font-semibold">🎫 Tiket istoty</h2>
          <span className="text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <p className="text-xs text-muted mt-1 mb-3">
          Automaticky poskladá najistejšie tipy z rôznych zápasov do jedného tiketu (max. jedna
          noha na zápas). Kombinovaná pravdepodobnosť = súčin jednotlivých — klesá rýchlejšie,
          než by človek čakal.
        </p>
        <TicketTabs ticketsByLegs={ticketsByLegs} recordedKeys={openTicketKeys} />
      </details>

      {/* ---------- Iste tipy ---------- */}
      <details open className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
          <h2 className="text-xl font-display font-semibold">🎯 Isté tipy</h2>
          <span className="text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <p className="text-xs text-muted mt-1 mb-3">
          Hľadá výsledky s najvyššou šancou na trafenie, aj keď kurz je menší.
        </p>
        {confidenceEntries.length === 0 && totalsConfidenceEntries.length === 0 ? (
          <p className="text-sm text-muted">Žiadny zápas zatiaľ nemá dostatočne istého favorita.</p>
        ) : (
          <div className="space-y-3">
            {confidenceEntries.map((entry, i) => (
              <div key={i} className={isTodayMatch(entry.match) ? "card-today" : "card"}>
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
                          <input type="hidden" name="predictedProb" value={entry.confidence.modelProb} />
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
                  <div key={i} className={isTodayMatch(entry.match) ? "card-today mb-2" : "card mb-2"}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm">
                        <span className="font-medium">{entry.match}</span>: {entry.confidence.outcome} @{" "}
                        {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                      </p>
                      {kickoffFor(entry.match) && (
                        <span className="text-[10px] font-mono shrink-0 ml-2 text-muted">
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
                      <input type="hidden" name="predictedProb" value={entry.confidence.modelProb} />
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
      </details>

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
              {isToday(dayMatches[0].commenceTime) ? (
                <span className="badge badge-green mb-2 inline-block">🔴 {formatDayHeading(dayMatches[0].commenceTime)}</span>
              ) : (
                <p className="text-[10px] uppercase tracking-widest text-muted font-mono mb-2">
                  {formatDayHeading(dayMatches[0].commenceTime)}
                </p>
              )}
              <div className="space-y-2">
                {dayMatches.map((m, i) => (
                  <details key={i} className={isToday(m.commenceTime) ? "card-today" : "card"}>
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
