import type { Metadata } from "next";
import Link from "next/link";
import { getApiQuota } from "@/lib/db";
import "./globals.css";

export const metadata: Metadata = {
  title: "MilionPlus",
  description: "Premier League value betting dashboard",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const quota = await getApiQuota();

  let quotaColor = "text-muted";
  let quotaLabel = "kredity neznáme";
  if (quota?.remaining != null) {
    quotaLabel = `${quota.remaining} kreditov`;
    if (quota.remaining < 20) quotaColor = "text-red";
    else if (quota.remaining < 100) quotaColor = "text-amber";
    else quotaColor = "text-green";
  }

  return (
    <html lang="sk">
      <body className="font-sans">
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-4">
          <div className="flex items-baseline justify-between">
            <h1 className="text-3xl font-display font-bold tracking-tight">
              Milion<span className="text-green">Plus</span>
            </h1>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted block">
                Premier League
              </span>
              <span
                className={`text-[10px] font-mono ${quotaColor}`}
                title="Zostávajúce kredity The Odds API tento mesiac (aktualizuje sa pri každom stiahnutí kurzov)"
              >
                📊 {quotaLabel}
              </span>
            </div>
          </div>
          <nav className="flex gap-6 mt-4 border-b border-border">
            <Link
              href="/"
              className="pb-3 text-sm font-medium text-muted hover:text-text transition-colors"
            >
              ⚽ Zápasy
            </Link>
            <Link
              href="/history"
              className="pb-3 text-sm font-medium text-muted hover:text-text transition-colors"
            >
              📊 História &amp; Bank
            </Link>
          </nav>
        </div>
        <main className="max-w-2xl mx-auto px-4 pb-16">{children}</main>
      </body>
    </html>
  );
}
