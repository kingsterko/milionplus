import Link from "next/link";
import { getCurrentBank, getBankrollHistory, listOpenTips, listAllTips, getPerformanceByMarket } from "@/lib/nhlDb";
import { settleNhlTipAction, updateNhlBankAction, deleteNhlTipAction } from "@/lib/nhlActions";
import ActionForm from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function NhlHistoryPage() {
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
      <div className="flex gap-2">
        <Link href="/nhl" className="badge badge-muted hover:border-green transition-colors">🏒 Zápasy</Link>
        <Link href="/nhl/history" className="badge badge-green">📊 História &amp; Bank</Link>
      </div>

      <section className="card">
        <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Aktuálny NHL bank</p>
        <p className="text-3xl font-mono font-bold text-green mb-4">€{bank.toFixed(2)}</p>

        {bankHistory.length > 1 && (
          <div className="flex items-end gap-1 h-24 mb-4">
            {bankHistory.map((b, i) => {
              const heightPct = ((b.bank - minBank) / range) * 100;
              return (
                <div key={i} title={`€${b.bank.toFixed(2)} — ${b.note ?? ""}`} className="flex-1 bg-green/70 hover:bg-green rounded-t" style={{ height: `${Math.max(heightPct, 3)}%` }} />
              );
            })}
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm">✏️ Ručne upraviť bank</summary>
          <ActionForm action={updateNhlBankAction} className="flex items-center gap-2 mt-2">
            <input type="number" name="bank" step="0.01" min="0" defaultValue={bank} className="bg-bg border border-border rounded px-2 py-1 text-sm font-mono w-28" />
            <button className="btn" type="submit">Uložiť</button>
          </ActionForm>
        </details>
      </section>

      <section>
        <h2 className="text-xl font-display font-semibold mb-1">📈 Presnosť a výkonnosť</h2>
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
                <div className="grid grid-cols-3 gap-3">
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
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-display font-semibold mb-3">Otvorené tipy</h2>
        {openTips.length === 0 ? (
          <p className="text-sm text-muted">Žiadne otvorené tipy.</p>
        ) : (
          <div className="space-y-3">
            {openTips.map((tip) => (
              <div key={tip.id} className="card">
                <p className="text-sm">
                  <span className="font-medium">{tip.match}</span> — {tip.outcome} ({tip.market}) @ {tip.odds.toFixed(2)} · €{tip.stake.toFixed(2)}
                </p>
                <div className="flex gap-2 mt-2">
                  <ActionForm action={settleNhlTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="true" />
                    <button className="btn" type="submit">✅ Vyhral</button>
                  </ActionForm>
                  <ActionForm action={settleNhlTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <input type="hidden" name="won" value="false" />
                    <button className="btn" type="submit" style={{ borderColor: "#E23D2866", color: "#E23D28" }}>❌ Prehral</button>
                  </ActionForm>
                  <ActionForm action={deleteNhlTipAction}>
                    <input type="hidden" name="id" value={tip.id} />
                    <button className="btn" type="submit" style={{ borderColor: "#8A908866", color: "#8A9088" }}>🗑️ Zmazať</button>
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {settled.length > 0 && (
        <section>
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">📋 História vysporiadaných tipov ({settled.length})</summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted text-left">
                    <th className="pr-3 py-1">zápas</th><th className="pr-3">výsledok</th><th className="pr-3">kurz</th>
                    <th className="pr-3">stávka</th><th className="pr-3">výsledok tipu</th><th className="pr-3">zisk/strata</th><th>dátum</th>
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
                        {(t.profit ?? 0) >= 0 ? "+" : ""}{t.profit?.toFixed(2)}
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
