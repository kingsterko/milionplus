-- EDGE XI - schema pre Supabase (Postgres)
-- Spusti toto cele v Supabase dashboarde: "SQL Editor" -> "New query" -> vloz -> "Run"

create table if not exists bankroll_log (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    bank numeric not null,
    note text
);

create table if not exists tips (
    id bigint generated always as identity primary key,
    placed_at timestamptz not null default now(),
    match text not null,
    market text not null,
    outcome text not null,
    bookmaker text,
    odds numeric not null,
    edge numeric,
    predicted_prob numeric,
    stake numeric not null,
    status text not null default 'open',
    result text,
    profit numeric,
    settled_at timestamptz
);

-- Pociatocny bank €10, len ak tabulka este nema ziadny zaznam
insert into bankroll_log (bank, note)
select 10.0, 'počiatočný bank'
where not exists (select 1 from bankroll_log);

-- RLS (Row Level Security) je v Supabase defaultne zapnute pre nove projekty.
-- Appka pristupuje k databaze cez Service Role kluc (server-only), ktory RLS
-- obchadza, takze pre funkcnost appky nie je potrebne RLS vypinat ani
-- nastavovat policies. Ak by si k tymto tabulkam chcel pristupovat aj z
-- klienta (napr. cez anon kluc), budes musiet policies doplnit.
alter table bankroll_log enable row level security;
alter table tips enable row level security;
