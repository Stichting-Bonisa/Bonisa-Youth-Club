// formulier: saves a form from bonisa.nl and mails it to office.
// Explanation in Dutch: docs/formulieren.md
//
// Accepts a normal form post (works without JavaScript: answers with a
// redirect back to the page, ?verzonden=1 or ?fout=<code>) or JSON (answers
// with JSON). Required: soort, voornaam, achternaam, email. The other fields
// per form are in _shared/formulieren.ts.
import { corsHeaders, DatabaseFout, doorsturen, env, json, log, rpc } from "../_shared/algemeen.ts";
import { controleerFormulier, isSoort, naVerzenden } from "../_shared/formulieren.ts";

const MELDINGEN: Record<string, string> = {
  onbekend_formulier: "Dit formulier bestaat niet.",
  ongeldige_gegevens: "Niet alle verplichte velden zijn goed ingevuld.",
  te_veel_formulieren: "U heeft het afgelopen uur al vaak een formulier verstuurd. Probeer het later opnieuw.",
  fout: "Er ging iets mis. Probeer het opnieuw of mail ons.",
};

// Only our own websites; anything else goes to the main site of bonisa.nl.
function siteVoor(req: Request): string {
  const herkomst = req.headers.get("origin") ?? "";
  const toegestaan = env("SITE_ORIGINS", false).split(",").map((s) => s.trim()).filter(Boolean);
  if (toegestaan.includes(herkomst)) return herkomst;
  return (env("FORMULIEREN_SITE_URL", false) || env("GIFTEN_SITE_URL")).replace(/\/$/, "");
}

// The page to return to: only a path on our own site ("/contact/").
const terugPad = (pad: string) => /^\/[a-z0-9\-/]{0,100}$/.test(pad) && !pad.startsWith("//") ? pad : "/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { fout: "methode" }, 405);

  let wilJson = false;
  let terug = "/";
  const antwoord = (code: string | null, status = 400) => {
    if (wilJson) return code ? json(req, { fout: code, melding: MELDINGEN[code] ?? MELDINGEN.fout }, status) : json(req, { verzonden: true });
    return doorsturen(`${siteVoor(req)}${terug}?${code ? `fout=${code}` : "verzonden=1"}`);
  };

  try {
    const v: Record<string, string> = {};
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      wilJson = true;
      for (const [k, w] of Object.entries((await req.json()) ?? {})) v[k] = String(w ?? "");
    } else {
      for (const [k, w] of (await req.formData()).entries()) v[k] = typeof w === "string" ? w : "";
    }
    terug = terugPad(v.terug ?? "/");

    // Hidden field that people don't see but spam bots fill in. Answer as if
    // it worked, so the bot learns nothing.
    if ((v.website ?? "").trim() !== "") {
      log("spam_geweigerd");
      return antwoord(null);
    }

    const soort = v.soort ?? "";
    if (!isSoort(soort)) return antwoord("onbekend_formulier");
    const gegevens = controleerFormulier(soort, v);
    if (!gegevens) return antwoord("ongeldige_gegevens");

    const p = {
      voornaam: v.voornaam.trim(),
      achternaam: v.achternaam.trim(),
      email: v.email.trim().toLowerCase(),
      telefoon: (v.telefoon ?? "").trim(),
      gegevens,
      nieuwsbrief: ["on", "true", "1", "ja"].includes((v.nieuwsbrief ?? "").toLowerCase()),
    };

    let id: string;
    try {
      id = await rpc<string>("maak_formulier", {
        p_soort: soort, p_voornaam: p.voornaam, p_achternaam: p.achternaam, p_email: p.email,
        p_telefoon: p.telefoon, p_gegevens: gegevens, p_nieuwsbrief: p.nieuwsbrief,
      });
    } catch (e) {
      if (!(e instanceof DatabaseFout)) throw e;
      const code = Object.keys(MELDINGEN).find((c) => e.message.includes(c)) ?? "fout";
      log("formulier_geweigerd", { code });
      return antwoord(code, code === "te_veel_formulieren" ? 429 : code === "fout" ? 500 : 400);
    }

    log("formulier_ontvangen", { formulier_id: id, soort });
    await naVerzenden(id, soort, p);
    return antwoord(null);
  } catch (e) {
    log("onverwachte_fout", { fout: String(e) });
    return antwoord("fout", 500);
  }
});
