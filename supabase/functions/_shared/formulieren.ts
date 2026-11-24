// Forms on bonisa.nl (contact, Nodig ons uit, magazine, volunteers, change of
// address). Explanation in Dutch: docs/formulieren.md
//
// Which fields each form has. The website may send fewer optional fields, but
// never other ones: unknown fields are ignored. Name, e-mail and phone are
// columns of their own; everything else goes into "gegevens" (jsonb).
import { env, log, rpc } from "./algemeen.ts";
import { verstuurMail } from "./mail.ts";
import { aanmeldenNieuwsbrief } from "./nieuwsbrief.ts";

export type Soort = "contact" | "uitnodiging" | "magazine" | "vrijwilliger" | "adreswijziging";
type Veld = { naam: string; label: string; verplicht?: boolean; max?: number; keuzes?: string[] };

const adres: Veld[] = [
  { naam: "straat", label: "Straat en huisnummer", verplicht: true, max: 150 },
  { naam: "postcode", label: "Postcode", verplicht: true, max: 10 },
  { naam: "plaats", label: "Plaats", verplicht: true, max: 100 },
];

export const FORMULIEREN: Record<Soort, { titel: string; telefoonVerplicht?: boolean; velden: Veld[] }> = {
  contact: {
    titel: "Contactformulier",
    velden: [
      { naam: "onderwerp", label: "Onderwerp", max: 150 },
      { naam: "bericht", label: "Bericht", verplicht: true, max: 5000 },
    ],
  },
  uitnodiging: {
    titel: "Nodig ons uit",
    telefoonVerplicht: true,
    velden: [
      { naam: "organisatie", label: "School, kerk of vereniging", verplicht: true, max: 150 },
      { naam: "soort_organisatie", label: "Soort", keuzes: ["school", "kerk", "vereniging", "bedrijf", "anders"] },
      { naam: "plaats", label: "Plaats", verplicht: true, max: 100 },
      { naam: "datum", label: "Gewenste datum of periode", max: 150 },
      { naam: "groep", label: "Groep en aantal deelnemers", max: 150 },
      { naam: "bericht", label: "Toelichting", max: 5000 },
    ],
  },
  magazine: {
    titel: "Magazine aanvragen",
    velden: [...adres, { naam: "aantal", label: "Aantal exemplaren", max: 3 }],
  },
  vrijwilliger: {
    titel: "Vrijwilliger worden",
    velden: [
      { naam: "woonplaats", label: "Woonplaats", max: 100 },
      { naam: "interesse", label: "Waar wilt u bij helpen?", max: 500 },
      { naam: "bericht", label: "Toelichting", max: 5000 },
    ],
  },
  adreswijziging: {
    titel: "Adreswijziging",
    velden: [
      { naam: "oud_adres", label: "Oude adres", max: 300 },
      ...adres,
      { naam: "ingangsdatum", label: "Vanaf", max: 30 },
    ],
  },
};

export const isSoort = (s: string): s is Soort => Object.hasOwn(FORMULIEREN, s);

// Checks the fields. Returns the extra fields for "gegevens", or null.
export function controleerFormulier(soort: Soort, v: Record<string, string>): Record<string, string> | null {
  const kort = (naam: string, max: number, verplicht = true) => {
    const w = (v[naam] ?? "").trim();
    return (verplicht ? w.length > 0 : true) && w.length <= max;
  };
  if (!kort("voornaam", 100) || !kort("achternaam", 100)) return null;
  const email = (v.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return null;
  const def = FORMULIEREN[soort];
  if (!kort("telefoon", 30, def.telefoonVerplicht ?? false)) return null;
  if ((v.telefoon ?? "").trim() && !/^[0-9+()\-\s]{6,30}$/.test(v.telefoon.trim())) return null;

  const gegevens: Record<string, string> = {};
  for (const veld of def.velden) {
    const w = (v[veld.naam] ?? "").trim();
    if (veld.verplicht && !w) return null;
    if (w.length > (veld.max ?? 150)) return null;
    if (veld.keuzes && w && !veld.keuzes.includes(w)) return null;
    if (w) gegevens[veld.naam] = w;
  }
  return gegevens;
}

// Where office receives the mail: FORMULIEREN_MAIL_NAAR, or per form
// FORMULIEREN_MAIL_NAAR_<SOORT> (for example the "Nodig ons uit" requests to
// the address for presentations).
export function mailadresKantoor(soort: Soort): string {
  return env(`FORMULIEREN_MAIL_NAAR_${soort.toUpperCase()}`, false) || env("FORMULIEREN_MAIL_NAAR", false);
}

const ontsnap = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function maakKantoormail(soort: Soort, p: {
  voornaam: string; achternaam: string; email: string; telefoon: string; gegevens: Record<string, string>;
  nieuwsbrief: boolean;
}) {
  const def = FORMULIEREN[soort];
  const regels: [string, string][] = [
    ["Naam", `${p.voornaam} ${p.achternaam}`],
    ["E-mail", p.email],
    ...(p.telefoon ? [["Telefoon", p.telefoon] as [string, string]] : []),
    ...def.velden.filter((v) => p.gegevens[v.naam]).map((v) => [v.label, p.gegevens[v.naam]] as [string, string]),
    ["Nieuwsbrief", p.nieuwsbrief ? "ja" : "nee"],
  ];
  const tekst = `${def.titel} via de website\n\n${regels.map(([k, w]) => `${k}: ${w}`).join("\n")}\n\n` +
    "Beantwoorden kan met 'Beantwoorden' in uw mailprogramma. Alle berichten staan ook op /beheer/ → Formulieren.";
  const html = `<!doctype html><html lang="nl"><body style="font-family:Arial,sans-serif;color:#1c1f1a">
<h1 style="font-size:20px">${ontsnap(def.titel)} via de website</h1>
<table style="border-collapse:collapse">${regels.map(([k, w]) =>
    `<tr><th style="text-align:left;vertical-align:top;padding:4px 12px 4px 0">${ontsnap(k)}</th>` +
    `<td style="padding:4px 0;white-space:pre-wrap">${ontsnap(w)}</td></tr>`).join("")}</table>
<p style="color:#3d4639">Beantwoorden kan met "Beantwoorden" in uw mailprogramma. Alle berichten staan ook op /beheer/ → Formulieren.</p>
</body></html>`;
  return { onderwerp: `${def.titel}: ${p.voornaam} ${p.achternaam}`.slice(0, 200), html, tekst };
}

// Mail to office and newsletter sign-up. A failure here never loses the form:
// it is already saved, and office sees it on /beheer/.
export async function naVerzenden(id: string, soort: Soort, p: Parameters<typeof maakKantoormail>[1]) {
  const naar = mailadresKantoor(soort);
  if (naar) {
    try {
      const mail = maakKantoormail(soort, p);
      await verstuurMail({
        aan: naar,
        naam: "Kantoor Bonisa",
        ...mail,
        afzender: {
          email: env("FORMULIEREN_MAIL_FROM", false) || env("GIFTEN_MAIL_FROM"),
          naam: "Website Bonisa",
          // "Reply" in office's mail program goes straight to the sender.
          antwoordAan: p.email,
        },
      });
      await rpc("formulier_mail_verstuurd", { p_id: id });
    } catch (e) {
      log("formuliermail_mislukt", { formulier_id: id, fout: String(e) });
    }
  }
  if (p.nieuwsbrief) {
    try {
      await aanmeldenNieuwsbrief(id,
        { claim: "formulier_nieuwsbrief_claim", mislukt: "formulier_nieuwsbrief_mislukt", parameter: "p_formulier_id" });
    } catch (e) {
      log("nieuwsbrief_mislukt", { formulier_id: id, fout: String(e) });
    }
  }
}
