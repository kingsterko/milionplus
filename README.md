# MilionPlus (web) — Next.js + Supabase + Vercel

Toto je "graduovaná" verzia appky — rovnaká logika ako v pôvodnej Streamlit
appke (value tipy, isté tipy, dvojšanca, Nad/Pod 2.5 gólu, vážený xG model
s dôrazom na posledné zápasy), ale s plnou kontrolou nad dizajnom a s
trvalou databázou (Supabase namiesto súboru).

Celý postup nižšie sa dá spraviť **len cez prehliadač**, bez inštalácie
čohokoľvek na počítač.

## 1. Založ Supabase projekt (databáza)

1. Choď na **supabase.com** → "Start your project" → prihlás sa cez GitHub.
2. "New project" → daj mu meno (napr. `milionplus`) → zvoľ heslo pre databázu
   (ulož si ho, ale reálne ho nebudeš potrebovať zadávať appke) → "Create".
3. Počkaj cca minútu, kým sa projekt vytvorí.
4. V ľavom menu choď na **"SQL Editor"** → "New query".
5. Otvor súbor `supabase/schema.sql` z tohto priečinka, skopíruj celý obsah,
   vlož do editora → klikni **"Run"**. Vytvorí to tabuľky `bankroll_log`
   a `tips` s počiatočným bankom €10.
6. V ľavom menu choď na **"Project Settings" → "API"**. Tu nájdeš:
   - **Project URL** (napr. `https://xxxxx.supabase.co`)
   - **service_role key** (v sekcii "Project API keys" — POZOR, nie
     "anon public" kľúč, ale ten druhý, "service_role secret")
   Oba si skopíruj, budeš ich potrebovať v kroku 4.

## 2. Nahraj kód na GitHub

1. Na **github.com** → "New repository" → meno napr. `milionplus-web` → Public
   → "Create repository".
2. "uploading an existing file" → nahraj **všetky súbory a priečinky**
   z tohto priečinka (`app/`, `lib/`, `supabase/`, `package.json`,
   `tsconfig.json`, `next.config.js`, `tailwind.config.js`,
   `postcss.config.js`, `.gitignore`) — zachovaj štruktúru priečinkov
   (GitHub webové rozhranie to pri drag&drop celého priečinka zvládne).
3. "Commit changes".

## 3. Nasaď na Vercel

1. Choď na **vercel.com** → "Sign Up" → prihlás sa cez GitHub.
2. "Add New..." → "Project" → vyber repozitár `milionplus-web` → "Import".
3. Vercel automaticky rozpozná Next.js — nič meniť netreba, len klikni
   na sekciu **"Environment Variables"** pred nasadením (alebo ich pridaj
   po nasadení cez Settings → Environment Variables) a vlož:

   | Name | Value |
   |---|---|
   | `ODDS_API_KEY` | tvoj kľúč z theoddsapi.com |
   | `FOOTBALL_DATA_API_KEY` | tvoj kľúč z football-data.org (voliteľné) |
   | `SUPABASE_URL` | Project URL zo Supabase (krok 1.6) |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key zo Supabase (krok 1.6) |

4. Klikni **"Deploy"**. O 1-2 minúty appka pobeží na verejnej adrese
   (napr. `milionplus-web.vercel.app`).

## Dôležité bezpečnostné poznámky

- `SUPABASE_SERVICE_ROLE_KEY` má plný prístup k databáze — nikdy ho
  nevkladaj do kódu ani ho nikomu neposielaj. Vo Vercel je bezpečne
  uložený ako server-only premenná prostredia (rovnako ako `ODDS_API_KEY`).
- Appka tento kľúč používa len v serverových častiach kódu (Server
  Components, Server Actions) — nikdy sa neposiela do prehliadača.

## Čo appka vie

- **⚽ Zápasy** — value tipy, isté tipy (favorit + dvojšanca + Nad/Pod
  2.5 gólu), diagnostika edge, zoznam všetkých zápasov a kurzov.
- **📊 História & Bank** — graf vývoja banku, otvorené tipy na
  vysporiadanie, história vysporiadaných tipov. Dáta sú teraz **trvalé**
  (Supabase, nie súbor v appke) — prežijú aj opätovné nasadenie appky.

## Čo je iné oproti Streamlit verzii (zjednodušenia v tejto prvej verzii)

- Vlastný model sa zapína automaticky, ak je nastavený `FOOTBALL_DATA_API_KEY`
  (zatiaľ bez prepínača v UI).
- Minimálna istota pre "favorit" tip je pevná (55%), zatiaľ bez posuvníka.

Obe sa dajú doplniť ako ďalší krok, ak sa appka osvedčí.
