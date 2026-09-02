"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Nahrada za '<form action={serverAkcia}>' vsade tam, kde akcia iba upravuje
 * data v Supabase (tipy, bank) a NECHCEME kvoli tomu zneplatnit cache kurzov.
 *
 * router.refresh() znovu vykona render aktualnej stranky (takze cerstvo
 * nacita zoznam tipov/bank zo Supabase), ale kedze sme nezneplatnili ziadny
 * "next.tags" fetch, kurze z The Odds API sa vratia z cache (ak su este
 * v okne cachovania) namiesto noveho, plateneho requestu.
 */
export default function ActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await action(formData);
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className={className} aria-busy={isPending}>
      {children}
    </form>
  );
}
