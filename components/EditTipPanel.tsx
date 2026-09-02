"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editTipAction } from "@/lib/actions";

export default function EditTipPanel({
  tipId,
  odds,
  stake,
}: {
  tipId: number;
  odds: number;
  stake: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await editTipAction(formData);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary
        className="btn inline-flex items-center list-none [&::-webkit-details-marker]:hidden cursor-pointer mt-1"
        style={{ borderColor: "#8A908866", color: "#8A9088" }}
      >
        ✏️ Upraviť skutočný kurz/stávku
      </summary>
      <div className="mt-3 p-3 rounded border border-border bg-bg/50">
        <p className="text-[11px] text-muted mb-2">
          Ak sa reálny kurz alebo suma u bookmakera líšili od toho, čo appka pôvodne ukázala,
          uprav to tu — bank sa pri vysporiadaní prepočíta podľa týchto hodnôt.
        </p>
        <form action={handleSubmit} className="grid grid-cols-2 gap-3">
          <input type="hidden" name="id" value={tipId} />
          <label className="text-xs">
            <span className="block text-muted mb-1">Skutočný kurz</span>
            <input
              type="number"
              name="odds"
              step="0.01"
              min="1.01"
              defaultValue={odds}
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
              defaultValue={stake}
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-green"
            />
          </label>
          <button className="btn-primary col-span-2 disabled:opacity-50" type="submit" disabled={isPending}>
            {isPending ? "Ukladám…" : "💾 Uložiť zmenu"}
          </button>
        </form>
      </div>
    </details>
  );
}
