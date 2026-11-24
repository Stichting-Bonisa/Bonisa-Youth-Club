// Where the ticket system (Supabase) can be reached. Set these in the
// Cloudflare build settings, under Settings -> Build -> Build variables and
// secrets (docs/ticketsysteem.md):
//   FUNCTIES_URL                 https://<project-ref>.supabase.co/functions/v1
//   SUPABASE_PUBLIEKE_SLEUTEL    the "publishable" key (sb_publishable_...);
//                                public by design: it only allows logging in
// Without them, the local test environment is used (npm run db:start).
//
// The address is cleaned up (spaces, a trailing "/" or "." are removed) and
// checked. On Cloudflare (Workers Builds sets WORKERS_CI) the build stops with
// a clear message if FUNCTIES_URL is missing or wrong, instead of quietly
// building a site that cannot reach the ticket system.
function leesFunctiesUrl() {
  const ruw = (process.env.FUNCTIES_URL || "").trim().replace(/[\/.\s]+$/, "");
  if (!ruw) {
    if (process.env.WORKERS_CI) {
      throw new Error("FUNCTIES_URL ontbreekt in de bouwvariabelen van Cloudflare (docs/ticketsysteem.md).");
    }
    return "http://127.0.0.1:54321/functions/v1";
  }
  let url;
  try {
    url = new URL(ruw);
  } catch {
    throw new Error(`FUNCTIES_URL is geen geldig adres: "${ruw}"`);
  }
  url.hostname = url.hostname.replace(/\.$/, "");
  const lokaal = ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !lokaal) || !url.pathname.endsWith("/functions/v1")) {
    throw new Error(`FUNCTIES_URL moet lijken op https://<project-ref>.supabase.co/functions/v1, niet "${ruw}"`);
  }
  return `${url.origin}${url.pathname}`;
}

export default function () {
  const functiesUrl = leesFunctiesUrl();
  const herkomst = new URL(functiesUrl).origin;
  return {
    functiesUrl,
    herkomst,
    authUrl: `${herkomst}/auth/v1`,
    // Local default key of every Supabase CLI install (not a secret).
    publiekeSleutel: process.env.SUPABASE_PUBLIEKE_SLEUTEL || "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
    evenement: process.env.EVENEMENT || "jongerenzang-2027",
  };
}
