-- Vlastna, plne kontrolovana cache pre kurze (namiesto spoliehania sa na
-- Next.js/Vercel fetch-cache, ktoreho realne spravanie sa neda zvonka
-- overit). Appka si kurze ulozi sem a NIKDY sa sama od seba nevrati na
-- The Odds API - len ked uzivatel klikne "Obnovit".
-- Spusti v Supabase -> SQL Editor -> New query -> vloz -> Run.

create table if not exists cached_odds (
    sport_key text primary key,
    data jsonb not null,
    fetched_at timestamptz not null default now()
);

alter table cached_odds enable row level security;
