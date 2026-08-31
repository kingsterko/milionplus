-- Migracia pre UZ EXISTUJUCU databazu (appka uz beží, tabulky uz existuju).
-- Spusti v Supabase -> SQL Editor -> New query -> vloz -> Run.
-- Bezpecne spustit aj viackrat.

create table if not exists api_quota (
    id smallint primary key default 1,
    updated_at timestamptz not null default now(),
    requests_remaining integer,
    requests_used integer,
    constraint single_row check (id = 1)
);

alter table api_quota enable row level security;
