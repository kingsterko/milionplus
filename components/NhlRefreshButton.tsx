"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Tlacidlo na obnovenie jednej casti NHL dat. Kym akcia bezi, je zablokovane
 * (ochrana pred dvojitym kliknutim, ktore by znova spotrebovalo kredity).
 */
export default function NhlRefreshButton({
  action,
  label,
  busyLabel,
  title,
  className = "btn-primary",
}: {
  action: () => Promise<void>;
  label: string;
  busyLabel: string;
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={`${className} disabled:opacity-50`} onClick={onClick} disabled={busy} title={title}>
      {busy ? busyLabel : label}
    </button>
  );
}
