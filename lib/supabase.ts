import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase klient. Pouziva Service Role kluc (NIE anon kluc) -
 * ten ma plny pristup k databaze a NIKDY sa nesmie dostat do prehliadaca.
 * Preto tento subor pouzivaju len Server Components a Server Actions,
 * nikdy 'use client' komponenty.
 */
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY v premenných prostredia.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export default getSupabase;
