import { createClient } from "@supabase/supabase-js";
 
/**
 * Server-only Supabase klient. Pouziva Service Role kluc (NIE anon kluc) -
 * ten ma plny pristup k databaze a NIKDY sa nesmie dostat do prehliadaca.
 * Preto tento subor pouzivaju len Server Components a Server Actions,
 * nikdy 'use client' komponenty.
 */
function getSupabase() {
  const rawUrl = process.env.SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !rawKey) {
    throw new Error("Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY v premenných prostredia.");
  }
 
  const url = rawUrl.trim().replace(/\/+$/, "");
  const key = rawKey.trim();
 
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error(
      `SUPABASE_URL nevyzerá správne (začína "${url.slice(0, 15)}...", dĺžka ${url.length} znakov). ` +
      `Očakávaný formát: https://xxxxxxxxxxx.supabase.co — over si vo Vercel, že hodnota neobsahuje ` +
      `úvodzovky, medzery navyše, ani lomítko na konci. Skús premennú zmazať a znova pridať.`
    );
  }
  if (key.length < 30) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY vyzerá príliš krátky (${key.length} znakov) — over si, že si ` +
      `neomylom vložil iný kľúč (napr. "anon public" namiesto "service_role").`
    );
  }
 
  return createClient(url, key, { auth: { persistSession: false } });
}
 
export default getSupabase;
 
