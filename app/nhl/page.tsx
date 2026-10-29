import Link from "next/link";
import { getNhlDashboardData } from "@/lib/nhlDashboard";
import { recordNhlTipAction, refreshNhlAction, refreshNhlRegulationAction } from "@/lib/nhlActions";
import { isDuplicateOpenTip, listOpenTips } from "@/lib/nhlDb";
import ActionForm from "@/components/ActionForm";
import { formatAge } from "@/lib/format";
import NhlRefreshButton from "@/components/NhlRefreshButton";

export const dynamic = "force-dynamic";
// Obnovenie riadnej doby vola API po jednom zapase (az 10 volani za sebou), preto dlhsi limit.
export const maxDuration = 60;

export default async function NhlPage() {
  let data;
  try {
    data = await getNhlDashboardData();
  } catch (e: unknown) {
    const message =
      (e as any)?.message || (typeof e === "object" ? JSON.stringify(e, null, 2) : String(e));
    return (
      <div className="card mt-6">
        <p className="text-red font-medium">Chyba pri načítaní dát</p>
        <pre className="text-xs text-muted mt-2 whitespace-pre-wrap break-words">{message}</pre>
      </div>
    );
  }

  const { bank, matches, valueTips, confidenceEntries, regulationConfidenceEntries, totalsConfidenceEntries, modelWarnings, useOwnModel, statsError, regulationStatus } = data;

  const openTips = await listOpenTips();
  const openKeys = new Set(openTips.map((t) => `${t.match}|${t.market}|${t.outcome}`));
  const isRecorded = (match: string, market: string, outcome: string) => openKeys.has(`${match}|${market}|${outcome}`);

  return (
    <div className="space-y-8 mt-4">
      <div className="flex gap-2">
        <Link href="/nhl" className="badge badge-green">🏒 Zápasy</Link>
        <Link href="/nhl/history" className="badge badge-muted hover:border-green transition-colors">📊 História &amp; Bank</Link>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          🏒 NHL · {matches.length} zápasov · bank €{bank.toFixed(2)}
          {matches[0]?.fetchedAt ? ` · kurzy ${formatAge(matches[0].fetchedAt)}` : ""}
        </p>
        <NhlRefreshButton
          action={refreshNhlAction}
          label="🔄 Obnoviť moneyline · 2 kr."
          busyLabel="Obnovujem…"
          title="Stiahne moneyline a Nad/Pod (2 kredity). Kurzy riadnej doby sa neobnovujú."
        />
      </div>

      {regulationStatus.enabled ? (
        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Riadna doba:{" "}
              {regulationStatus.loaded > 0
                ? `použiteľné kurzy pre ${regulationStatus.loaded} z ${matches.length} zápasov`
                : "zatiaľ nenačítané"}
              {regulationStatus.fetchedAt ? ` · načítané ${regulationStatus.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
            </p>
            <NhlRefreshButton
              action={refreshNhlRegulationAction}
              label={`🔄 Obnoviť riadnu dobu · až ${regulationStatus.maxCost} kr.`}
              busyLabel="Načítavam…"
              className="btn shrink-0"
              title="Stiahne len kurzy riadnej doby (1 kredit za zápas s dátami). Moneyline sa neobnovuje."
            />
          </div>
          {regulationStatus.note && <p className="text-xs text-amber mt-2">{regulationStatus.note}</p>}
          {regulationStatus.loaded === 0 && !regulationStatus.note && (
            <p className="text-xs text-muted mt-2">
              Klikni na tlačidlo — stojí najviac {regulationStatus.maxCost} kreditov (1 za každý zápas, pre ktorý bookmakeri
              trh ponúkajú; prázdne odpovede sa podľa dokumentácie neúčtujú).
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">Trh „riadna doba“ je vypnutý (NHL_REGULATION_MARKET=off).</p>
      )}

      {!useOwnModel && (
        <div className="card">
          <p className="text-sm text-amber">
            {statsError
              ? `Vlastný model sa nepodarilo načítať (${statsError}) — appka porovnáva len bookmakerov.`
              : "Sezóna ešte nezačala / žiadne štatistiky zatiaľ nie sú k dispozícii — appka porovnáva len bookmakerov."}
          </p>
        </div>
      )}

      {modelWarnings.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">
            ⚠️ {modelWarnings.length} zápas(y) bez vlastného modelu
          </summary>
          <ul className="mt-2 space-y-1">
            {modelWarnings.map((w, i) => (
              <li key={i} className="text-xs text-muted">{w}</li>
            ))}
          </ul>
        </details>
      )}

      {matches.length === 0 ? (
        <p className="text-sm text-muted">Žiadne nadchádzajúce zápasy NHL sa nenašli.</p>
      ) : (
        <>
          <section>
            <h2 className="text-xl font-display font-semibold">💡 Value tipy</h2>
            <p className="text-xs text-muted mt-1 mb-3">
              Hľadá kurzy, ktoré platia viac, než hovorí odhadovaná pravdepodobnosť.
            </p>
            {valueTips.length === 0 ? (
              <p className="text-sm text-muted">Momentálne žiadny zápas neprešiel prahom pre value tip.</p>
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
                      </div>
                      <span className="badge badge-green shrink-0">+{t.edge.toFixed(1)}%</span>
                    </div>
                    <p className="text-sm mt-2">
                      Odporúčaná stávka: <span className="font-mono text-green">€{t.stake.toFixed(2)}</span>
                    </p>
                    {isRecorded(t.match, "value", t.outcome) ? (
                      <span className="text-xs text-green">✅ Už zaznamenané</span>
                    ) : (
                      <ActionForm action={recordNhlTipAction} className="mt-2">
                        <input type="hidden" name="match" value={t.match} />
                        <input type="hidden" name="market" value="value" />
                        <input type="hidden" name="outcome" value={t.outcome} />
                        <input type="hidden" name="bookmaker" value={t.bookmaker} />
                        <input type="hidden" name="odds" value={t.odds} />
                        <input type="hidden" name="edge" value={t.edge} />
                        <input type="hidden" name="predictedProb" value={t.consensusProb} />
                        <input type="hidden" name="stake" value={t.stake} />
                        <button className="btn" type="submit">📝 Zaznamenať</button>
                      </ActionForm>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">🎯 Isté tipy</h2>
            <p className="text-xs text-muted mt-1 mb-3">
              Hľadá výsledky s najvyššou šancou na trafenie, aj keď kurz je menší. Moneyline = víťaz vrátane predĺženia a nájazdov (len domáci alebo hostia). Riadna doba = víťaz po 60 minútach, zápas môže skončiť aj remízou — preto vyššie kurzy, ale menšia istota. Kurzy riadnej doby sa sťahujú osobitne, len po kliknutí na „Obnoviť riadnu dobu“, a stoja kredity navyše.
            </p>
            {confidenceEntries.length === 0 && regulationConfidenceEntries.length === 0 && totalsConfidenceEntries.length === 0 ? (
              <p className="text-sm text-muted">Žiadny zápas zatiaľ nemá dostatočne istého favorita.</p>
            ) : (
              <div className="space-y-3">
                {confidenceEntries.map((entry, i) => (
                  <div key={i} className="card">
                    <p className="font-medium mb-1">{entry.match}</p>
                    {entry.confidence && (
                      <>
                        <p className="text-sm">
                          <span className="font-medium">{entry.confidence.outcome}</span> @{" "}
                          {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                        </p>
                        <p className="text-xs text-muted">Šanca podľa modelu: {entry.confidence.modelProb.toFixed(0)}%</p>
                        {isRecorded(entry.match, "istota", entry.confidence.outcome) ? (
                          <span className="text-xs text-green">✅ Už zaznamenané</span>
                        ) : (
                          <ActionForm action={recordNhlTipAction} className="mt-2">
                            <input type="hidden" name="match" value={entry.match} />
                            <input type="hidden" name="market" value="istota" />
                            <input type="hidden" name="outcome" value={entry.confidence.outcome} />
                            <input type="hidden" name="bookmaker" value={entry.confidence.bookmaker} />
                            <input type="hidden" name="odds" value={entry.confidence.odds} />
                            <input type="hidden" name="edge" value={entry.confidence.edge} />
                            <input type="hidden" name="predictedProb" value={entry.confidence.modelProb} />
                            <input type="hidden" name="stake" value={Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5)} />
                            <button className="btn" type="submit">📝 Zaznamenať</button>
                          </ActionForm>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {regulationConfidenceEntries.map((entry, i) => (
                  <div key={`r-${i}`} className="card">
                    <p className="font-medium mb-1">{entry.match}</p>
                    {entry.confidence && (
                      <>
                        <p className="text-sm">
                          <span className="font-medium">{entry.confidence.outcome}</span> @{" "}
                          {entry.confidence.odds.toFixed(2)} ({entry.confidence.bookmaker})
                        </p>
                        <p className="text-xs text-muted">Šanca podľa modelu: {entry.confidence.modelProb.toFixed(0)}%</p>
                        {isRecorded(entry.match, "istota", entry.confidence.outcome) ? (
                          <span className="text-xs text-green">✅ Už zaznamenané</span>
                        ) : (
                          <ActionForm action={recordNhlTipAction} className="mt-2">
                            <input type="hidden" name="match" value={entry.match} />
                            <input type="hidden" name="market" value="istota" />
                            <input type="hidden" name="outcome" value={entry.confidence.outcome} />
                            <input type="hidden" name="bookmaker" value={entry.confidence.bookmaker} />
                            <input type="hidden" name="odds" value={entry.confidence.odds} />
                            <input type="hidden" name="edge" value={entry.confidence.edge} />
                            <input type="hidden" name="predictedProb" value={entry.confidence.modelProb} />
                            <input type="hidden" name="stake" value={Math.max(Math.round(bank * 0.02 * 100) / 100, 0.5)} />
                            <button className="btn" type="submit">📝 Zaznamenať</button>
                          </ActionForm>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {totalsConfidenceEntries.map((entry, i) => (
                  <div key={`t-${i}`} className="card">
                    <p className="text-sm">
                      <span className="font-medium">{entry.match}</span>: {entry.confidence?.outcome} @{" "}
                      {entry.confidence?.odds.toFixed(2)} ({entry.confidence?.bookmaker})
                    </p>
                    <p className="text-xs text-muted">Šanca podľa modelu: {entry.confidence?.modelProb.toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold mb-3">📋 Všetky zápasy a kurzy</h2>
            <div className="space-y-2">
              {matches.map((m, i) => (
                <details key={i} className="card">
                  <summary className="cursor-pointer text-sm font-medium">
                    {m.home} vs {m.away} — {m.commenceTime.slice(0, 16).replace("T", " ")}
                  </summary>
                  <div className="mt-2 space-y-2 text-xs">
                    {m.odds.length > 0 && (
                      <div>
                        <p className="text-muted mb-1">Moneyline (víťaz vrátane predĺženia/nájazdov):</p>
                        {m.bookmakers.map((bm, j) => (
                          <p key={j} className="font-mono">{bm}: Domáci={m.odds[j].home.toFixed(2)} Hostia={m.odds[j].away.toFixed(2)}</p>
                        ))}
                      </div>
                    )}
                    {m.regulationOdds.length > 0 && (
                      <div>
                        <p className="text-muted mb-1">Riadna doba (3-cestný):</p>
                        {m.regulationBookmakers.map((bm, j) => (
                          <p key={j} className="font-mono">
                            {bm}: Domáci={m.regulationOdds[j].home.toFixed(2)} Remíza={m.regulationOdds[j].draw.toFixed(2)} Hostia={m.regulationOdds[j].away.toFixed(2)}
                          </p>
                        ))}
                      </div>
                    )}
                    {m.totalsOdds.length > 0 && (
                      <div>
                        <p className="text-muted mb-1">Nad/Pod:</p>
                        {m.totalsBookmakers.map((bm, j) => (
                          <p key={j} className="font-mono">{bm}: Nad={m.totalsOdds[j].over.toFixed(2)} Pod={m.totalsOdds[j].under.toFixed(2)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
