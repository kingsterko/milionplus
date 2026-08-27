import { getCurrentBank, getBankrollHistory, listOpenTips, listAllTips, getCalibrationBuckets } from "@/lib/db";
import { settleTipAction, updateBankAction, deleteTipAction, editTipAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const bank = await getCurrentBank();
  const bankHistory = await getBankrollHistory();
  const openTips = await listOpenTips();
  const allTips = await listAllTips();
  const settled = allTips.filter((t) => t.status === "settled");
  const calibration = await getCalibrationBuckets();

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
          <form action={updateBankAction} className="flex items-center gap-2 mt-2">
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
          </form>
        </details>
      </section>

      <section>
        <h2 className="text-xl font-display font-semibold mb-1">📈 Presnosť modelu</h2>
        <p className="text-xs text-muted mb-3">
          Porovnáva, čo model tvrdil (predikovaná %), s tým, čo sa reálne stalo (skutočná
          úspešnosť) — len z už vysporiadaných tipov. Ak model funguje dobre, oba stĺpce by mali
          byť blízko seba. Pásma s menej než 5 tipmi sú zatiaľ len orientačné — je to príliš
          malá vzorka na vyvodzovanie záverov.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted text-left">
                <th className="pr-4 py-1">pásmo</th>
                <th className="pr-4">počet tipov</th>
                <th className="pr-4">priem. predikcia</th>
                <th className="pr-4">skutočná úspešnosť</th>
                <th>rozdiel</th>
              </tr>
            </thead>
            <tbody>
              {calibration.map((b) => {
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
                  <form action={settleTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="true" />
                    <button className="btn" type="submit">
                      ✅ Vyhral
                    </button>
                  </form>
                  <form action={settleTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="false" />
                    <button className="btn" type="submit" style={{ borderColor: "#E23D2866", color: "#E23D28" }}>
                      ❌ Prehral
                    </button>
                  </form>
                  <form action={deleteTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <button
                      className="btn"
                      type="submit"
                      style={{ borderColor: "#8A908866", color: "#8A9088" }}
                      title="Zmaž, ak si sa preklikol a zaznamenal tip omylom"
                    >
                      🗑️ Zmazať
                    </button>
                  </form>
                </div>

                <details className="group/edit">
                  <summary
                    className="btn inline-flex items-center list-none [&::-webkit-details-marker]:hidden cursor-pointer mt-1"
                    style={{ borderColor: "#8A908866", color: "#8A9088" }}
                  >
                    ✏️ Upraviť skutočný kurz/stávku
                  </summary>
                  <div className="mt-3 p-3 rounded border border-border bg-bg/50">
                    <p className="text-[11px] text-muted mb-2">
                      Ak sa reálny kurz alebo suma u bookmakera líšili od toho, čo appka pôvodne
                      ukázala, uprav to tu — bank sa pri vysporiadaní prepočíta podľa týchto hodnôt.
                    </p>
                    <form action={editTipAction} className="grid grid-cols-2 gap-3">
                      <input type="hidden" name="id" value={tip.id} />
                      <label className="text-xs">
                        <span className="block text-muted mb-1">Skutočný kurz</span>
                        <input
                          type="number"
                          name="odds"
                          step="0.01"
                          min="1.01"
                          defaultValue={tip.odds}
                          className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-green"
                        />
                      </label>
                      <label className="text-xs">
                        <span className="block text-muted mb-1">Skutočná stávka (€)</span>
                        <input
                          type="number"
                          name="stake"
                          step="0.01"
                          min="0.01"
                          defaultValue={tip.stake}
                          className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-green"
                        />
                      </label>
                      <button className="btn-primary col-span-2" type="submit">
                        💾 Uložiť zmenu
                      </button>
                    </form>
                  </div>
                </details>
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
