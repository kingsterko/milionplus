-- Migracia pre UZ EXISTUJUCU databazu (appka uz beží, tabulky uz existuju).
-- Spusti v Supabase -> SQL Editor -> New query -> vloz -> Run.
-- Bezpecne spustit aj viackrat (IF NOT EXISTS).

alter table tips add column if not exists predicted_prob numeric;
