-- NHL modul - uplne samostatne tabulky, oddelene od futbaloveho banku/tipov.
-- Spusti v Supabase -> SQL Editor -> New query -> vloz -> Run.

create table if not exists nhl_bankroll_log (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    bank numeric not null,
    note text
);

create table if not exists nhl_tips (
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

insert into nhl_bankroll_log (bank, note)
select 10.0, 'počiatočný NHL bank'
where not exists (select 1 from nhl_bankroll_log);

alter table nhl_bankroll_log enable row level security;
alter table nhl_tips enable row level security;
