import { getCurrentBank, getBankrollHistory, listOpenTips, listAllTips, getPerformanceByMarket } from "@/lib/db";
import { settleTipAction, updateBankAction, deleteTipAction } from "@/lib/actions";
import EditTipPanel from "@/components/EditTipPanel";
import ActionForm from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const bank = await getCurrentBank();
  const bankHistory = await getBankrollHistory();
  const openTips = await listOpenTips();
  const allTips = await listAllTips();
  const settled = allTips.filter((t) => t.status === "settled");
  const performance = await getPerformanceByMarket();

  const maxBank = Math.max(...bankHistory.map((b) => b.bank), bank, 1);
  const minBank = Math.min(...bankHistory.map((b) => b.bank), bank, 0);
  const range = Math.max(maxBank - minBank, 0.01);

  return (
    <div className="space-y-8 mt-4">
      <section className="card">
        <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Aktuálny bank</p>
        <p className="text-3xl font-mono font-bold text-green mb-4">€{bank.toFixed(2)}</p>

        {bankHistory.length > 1 && (
          <div className="flex items-end gap-1 h-24 mb-4">
            {bankHistory.map((b, i) => {
              const heightPct = ((b.bank - minBank) / range) * 100;
              return (
                <div
                  key={i}
                  title={`€${b.bank.toFixed(2)} — ${b.note ?? ""}`}
                  className="flex-1 bg-green/70 hover:bg-green rounded-t"
                  style={{ height: `${Math.max(heightPct, 3)}%` }}
                />
              );
            })}
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm">✏️ Ručne upraviť bank</summary>
          <ActionForm action={updateBankAction} className="flex items-center gap-2 mt-2">
            <input
              type="number"
              name="bank"
              step="0.5"
              min="0"
              defaultValue={bank}
              className="bg-bg border border-border rounded px-2 py-1 text-sm font-mono w-28"
            />
            <button className="btn" type="submit">
              Uložiť
            </button>
          </ActionForm>
        </details>
      </section>

      <section>
        <h2 className="text-xl font-display font-semibold mb-1">📈 Presnosť a výkonnosť podľa stratégie</h2>
        <p className="text-xs text-muted mb-3">
          Value tipy, isté tipy a tikety majú úplne inú logiku — miešať ich dokopy by skrylo,
          ktorá stratégia reálne funguje. ROI hovorí o skutočnom zisku/strate; kalibrácia (nižšie,
          po rozkliknutí) o tom, či percentá, čo appka tvrdí, sedia s realitou.
        </p>
        {performance.length === 0 ? (
          <p className="text-sm text-muted">Zatiaľ žiadne vysporiadané tipy na vyhodnotenie.</p>
        ) : (
          <div className="space-y-3">
            {performance.map((p) => (
              <div key={p.market} className="card">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium">{p.label}</p>
                  <span className="text-xs text-muted">{p.totalCount} tipov</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-1">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted">Úspešnosť</p>
                    <p className="font-mono text-lg">{p.winRatePct?.toFixed(1) ?? "—"}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted">Zisk/strata</p>
                    <p className={`font-mono text-lg ${p.totalProfit >= 0 ? "text-green" : "text-red"}`}>
                      {p.totalProfit >= 0 ? "+" : ""}€{p.totalProfit.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted">ROI</p>
                    <p className={`font-mono text-lg ${(p.roiPct ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                      {p.roiPct != null ? `${p.roiPct >= 0 ? "+" : ""}${p.roiPct.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted">🔍 Kalibrácia podľa pásma istoty</summary>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="text-muted text-left">
                          <th className="pr-4 py-1">pásmo</th>
                          <th className="pr-4">počet</th>
                          <th className="pr-4">priem. predikcia</th>
                          <th className="pr-4">skutočná úspešnosť</th>
                          <th>rozdiel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.buckets.map((b) => {
                          const diff =
                            b.avgPredicted != null && b.actualHitRate != null
                              ? Math.round((b.actualHitRate - b.avgPredicted) * 10) / 10
                              : null;
                          return (
                            <tr key={b.label} className="border-t border-border">
                              <td className="pr-4 py-1.5">{b.label}</td>
                              <td className="pr-4">{b.count}</td>
                              <td className="pr-4">{b.avgPredicted != null ? `${b.avgPredicted.toFixed(1)}%` : "—"}</td>
                              <td className="pr-4">{b.actualHitRate != null ? `${b.actualHitRate.toFixed(1)}%` : "—"}</td>
                              <td className={diff == null ? "" : diff >= 0 ? "text-green" : "text-red"}>
                                {diff == null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`}
                                {b.count > 0 && b.count < 5 && <span className="text-muted ml-1">(málo dát)</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-display font-semibold mb-3">Otvorené tipy</h2>
        {openTips.length === 0 ? (
          <p className="text-sm text-muted">Žiadne otvorené tipy. Zaznamenaj tip v záložke Zápasy.</p>
        ) : (
          <div className="space-y-3">
            {openTips.map((tip) => (
              <div key={tip.id} className="card">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="font-medium text-sm">{tip.match}</p>
                  <span className="badge badge-muted shrink-0">{tip.market}</span>
                </div>
                <p className="text-xs text-muted mb-3">{tip.outcome}</p>

                <div className="flex items-center gap-4 mb-3 font-mono text-sm">
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-muted block">Kurz</span>
                    {tip.odds.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-muted block">Stávka</span>
                    €{tip.stake.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-muted block">Možná výhra</span>
                    <span className="text-green">€{(tip.stake * tip.odds).toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-1">
                  <ActionForm action={settleTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="true" />
                    <button className="btn" type="submit">
                      ✅ Vyhral
                    </button>
                  </ActionForm>
                  <ActionForm action={settleTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="false" />
                    <button className="btn" type="submit" style={{ borderColor: "#E23D2866", color: "#E23D28" }}>
                      ❌ Prehral
                    </button>
                  </ActionForm>
                  <ActionForm action={deleteTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <button
                      className="btn"
                      type="submit"
                      style={{ borderColor: "#8A908866", color: "#8A9088" }}
                      title="Zmaž, ak si sa preklikol a zaznamenal tip omylom"
                    >
                      🗑️ Zmazať
                    </button>
                  </ActionForm>
                </div>

                <EditTipPanel tipId={tip.id} odds={tip.odds} stake={tip.stake} />
              </div>
            ))}
          </div>
        )}
      </section>

      {settled.length > 0 && (
        <section>
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">
              📋 História vysporiadaných tipov ({settled.length})
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted text-left">
                    <th className="pr-3 py-1">zápas</th>
                    <th className="pr-3">výsledok</th>
                    <th className="pr-3">kurz</th>
                    <th className="pr-3">stávka</th>
                    <th className="pr-3">výsledok tipu</th>
                    <th className="pr-3">zisk/strata</th>
                    <th>dátum</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="pr-3 py-1">{t.match}</td>
                      <td className="pr-3">{t.outcome}</td>
                      <td className="pr-3">{t.odds.toFixed(2)}</td>
                      <td className="pr-3">€{t.stake.toFixed(2)}</td>
                      <td className="pr-3">{t.result === "won" ? "✅ výhra" : "❌ prehra"}</td>
                      <td className={`pr-3 ${(t.profit ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                        {(t.profit ?? 0) >= 0 ? "+" : ""}
                        {t.profit?.toFixed(2)}
                      </td>
                      <td>{t.settled_at?.slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
