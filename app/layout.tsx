import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "EDGE XI",
  description: "Premier League value betting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body className="font-sans">
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-4">
          <div className="flex items-baseline justify-between">
            <h1 className="text-3xl font-display font-bold tracking-tight">
              EDGE<span className="text-green">XI</span>
            </h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted">
              Premier League
            </span>
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
