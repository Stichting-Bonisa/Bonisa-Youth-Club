// End-to-end tests for the forms of bonisa.nl, against a local Supabase and the
// fake MailerSend/MailerLite. How to run: docs/formulieren.md ("Testen").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { start as startNepDiensten } from "./nep-diensten.mjs";

const lokaal = () => Object.fromEntries(
  execSync("npx --yes supabase@3.0.0 status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n").map((r) => r.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const sleutels = process.env.SUPABASE_SERVICE_ROLE_KEY ? {} : lokaal();
const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? sleutels.SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY ?? sleutels.ANON_KEY;
const F = `${API}/functions/v1`;
const NEP = "http://127.0.0.1:54399";

if (!SERVICE || !ANON) throw new Error("Local Supabase not running: npm run db:start");

let nep;
before(async () => { nep = await startNepDiensten(); });
after(() => nep?.close());

const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const lees = async (pad) => (await fetch(`${API}/rest/v1/${pad}`, { headers: h })).json();
const rij = async (email) => (await lees(`formulieren?email=eq.${encodeURIComponent(email)}&select=*&order=aangemaakt_op.desc`))[0];
const mails = async () => (await fetch(`${NEP}/__mails`)).json();
const aanmeldingen = async () => (await fetch(`${NEP}/__aanmeldingen`)).json();

let teller = 0;
const nieuwAdres = () => `afzender${Date.now()}-${teller++}@voorbeeld.nl`;
const basis = (extra = {}) => ({
  soort: "contact", voornaam: "Test", achternaam: "Afzender", email: nieuwAdres(), telefoon: "",
  onderwerp: "Vraag", bericht: "Hoe kan ik helpen?", website: "", terug: "/contact/", ...extra,
});
const verstuurJson = (g) => fetch(`${F}/formulier`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" }, body: JSON.stringify(g),
});
const verstuurFormulier = (g) => fetch(`${F}/formulier`, {
  method: "POST", body: new URLSearchParams(g), redirect: "manual", headers: { Origin: "http://localhost:8080" },
});

test("contact: opgeslagen en gemaild naar kantoor, met antwoordadres van de afzender", async () => {
  const g = basis({ bericht: "Regel 1\n<b>geen html</b>" });
  const r = await verstuurJson(g);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { verzonden: true });

  const f = await rij(g.email);
  assert.equal(f.soort, "contact");
  assert.equal(f.gegevens.bericht, "Regel 1\n<b>geen html</b>");
  assert.ok(f.mail_verstuurd_op);
  assert.equal(f.nieuwsbrief, false);

  const mail = (await mails()).find((m) => m.reply_to?.email === g.email);
  assert.ok(mail, "mail naar kantoor");
  assert.equal(mail.to[0].email, "kantoor@voorbeeld.nl");
  assert.match(mail.subject, /^Contactformulier: Test Afzender/);
  assert.ok(mail.html.includes("&lt;b&gt;geen html&lt;/b&gt;"), "html is ontsnapt");
  assert.ok(!mail.html.includes("<b>geen html"));
});

test("werkt zonder JavaScript: doorsturen naar de pagina met ?verzonden=1 of ?fout=", async () => {
  const goed = await verstuurFormulier(basis());
  assert.equal(goed.status, 303);
  assert.equal(goed.headers.get("location"), "http://localhost:8080/contact/?verzonden=1");

  const fout = await verstuurFormulier(basis({ bericht: "" }));
  assert.equal(fout.status, 303);
  assert.equal(fout.headers.get("location"), "http://localhost:8080/contact/?fout=ongeldige_gegevens");

  // A return address on another site is never used.
  const vreemd = await verstuurFormulier(basis({ terug: "//kwaadaardig.example/" }));
  assert.equal(vreemd.headers.get("location"), "http://localhost:8080/?verzonden=1");
});

test("verplichte velden per formulier en onbekende velden worden genegeerd", async () => {
  // Nodig ons uit: phone, organisation and place are required.
  assert.equal((await verstuurJson(basis({ soort: "uitnodiging", organisatie: "De Rank", plaats: "Lisse" }))).status, 400);
  const g = basis({
    soort: "uitnodiging", telefoon: "06 12345678", organisatie: "CBS De Rank", soort_organisatie: "school",
    plaats: "Lisse", datum: "maart 2027", groep: "groep 7 en 8, 50 leerlingen", bericht: "", extra_veld: "weg",
  });
  assert.equal((await verstuurJson(g)).status, 200);
  const f = await rij(g.email);
  assert.equal(f.soort, "uitnodiging");
  assert.equal(f.telefoon, "06 12345678");
  assert.deepEqual(f.gegevens, {
    organisatie: "CBS De Rank", soort_organisatie: "school", plaats: "Lisse", datum: "maart 2027",
    groep: "groep 7 en 8, 50 leerlingen",
  });

  assert.equal((await verstuurJson(basis({ soort: "uitnodiging", telefoon: "06 1", organisatie: "X", plaats: "Y", soort_organisatie: "café" }))).status, 400);
  assert.equal((await verstuurJson(basis({ soort: "magazine", straat: "Grachtweg 20", postcode: "", plaats: "Lisse" }))).status, 400);
  assert.equal((await verstuurJson(basis({ soort: "magazine", straat: "Grachtweg 20", postcode: "2161 HN", plaats: "Lisse" }))).status, 200);
  assert.equal((await verstuurJson(basis({ soort: "bestelling" }))).status, 400);
  assert.equal((await verstuurJson(basis({ email: "geen-adres" }))).status, 400);
  assert.equal((await verstuurJson(basis({ bericht: "x".repeat(5001) }))).status, 400);
  assert.equal((await verstuurJson(basis({ telefoon: "bel me" }))).status, 400);
});

test("spamveld: lijkt gelukt, maar niets opgeslagen of gemaild", async () => {
  const g = basis({ website: "http://spam.example" });
  const r = await verstuurJson(g);
  assert.equal(r.status, 200);
  assert.equal(await rij(g.email), undefined);
});

test("maximaal 5 formulieren per e-mailadres per uur", async () => {
  const email = nieuwAdres();
  for (let i = 0; i < 5; i++) assert.equal((await verstuurJson(basis({ email }))).status, 200);
  const zesde = await verstuurJson(basis({ email: email.toUpperCase() }));
  assert.equal(zesde.status, 429);
  assert.equal((await zesde.json()).fout, "te_veel_formulieren");
});

test("nieuwsbrief alleen met het vinkje", async () => {
  const zonder = basis({ soort: "vrijwilliger", interesse: "Inpakken" });
  await verstuurJson(zonder);
  const met = basis({ soort: "vrijwilliger", interesse: "Inpakken", nieuwsbrief: "on" });
  await verstuurJson(met);
  const lijst = (await aanmeldingen()).map((a) => a.email);
  assert.ok(lijst.includes(met.email));
  assert.ok(!lijst.includes(zonder.email));
  assert.ok((await rij(met.email)).nieuwsbrief_verwerkt_op);
});

test("mail mislukt: het formulier blijft bewaard", async () => {
  await fetch(`${NEP}/__mailstoring`, { method: "POST", body: JSON.stringify({ aan: true }) });
  try {
    const g = basis();
    assert.equal((await verstuurJson(g)).status, 200);
    const f = await rij(g.email);
    assert.ok(f);
    assert.equal(f.mail_verstuurd_op, null);
  } finally {
    await fetch(`${NEP}/__mailstoring`, { method: "POST", body: JSON.stringify({ aan: false }) });
  }
});

// --- management page --------------------------------------------------------
async function maakAccount(rol) {
  const email = `${rol}${Date.now()}${teller++}@voorbeeld.nl`;
  const wachtwoord = "testwachtwoord-123";
  const user = await (await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST", headers: h, body: JSON.stringify({ email, password: wachtwoord, email_confirm: true }),
  })).json();
  await fetch(`${API}/rest/v1/beheerders`, { method: "POST", headers: h, body: JSON.stringify({ user_id: user.id, rol }) });
  const token = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: wachtwoord }),
  })).json()).access_token;
  return token;
}
const beheer = (token, actie, extra = {}) => fetch(`${F}/beheer`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ actie, ...extra }),
});

test("beheer: lijst per soort, afhandelen en verwijderen; alleen kantoor", async () => {
  const kantoor = await maakAccount("kantoor");
  const scanner = await maakAccount("scanner");
  const g = basis({ soort: "adreswijziging", straat: "Nieuweweg 1", postcode: "1234 AB", plaats: "Hillegom", bericht: "" });
  await verstuurJson(g);
  const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

  assert.equal((await beheer(scanner, "formulieren", { van: vandaag, tot: vandaag })).status, 403);
  assert.equal((await beheer(kantoor, "formulieren", { van: vandaag, tot: "2000-01-01" })).status, 400);
  assert.equal((await beheer(kantoor, "formulieren", { van: vandaag, tot: vandaag, soort: "onzin" })).status, 400);

  const lijst = await (await beheer(kantoor, "formulieren", { van: vandaag, tot: vandaag, soort: "adreswijziging" })).json();
  const f = lijst.find((x) => x.email === g.email);
  assert.ok(f);
  assert.ok(lijst.every((x) => x.soort === "adreswijziging"));
  assert.equal(f.gegevens.plaats, "Hillegom");
  assert.equal(f.afgehandeld_op, null);

  assert.equal((await beheer(kantoor, "formulier_afhandelen", { id: f.id })).status, 200);
  assert.ok((await rij(g.email)).afgehandeld_op);
  await beheer(kantoor, "formulier_afhandelen", { id: f.id, klaar: false });
  assert.equal((await rij(g.email)).afgehandeld_op, null);

  assert.equal((await beheer(kantoor, "formulier_verwijderen", { id: f.id })).status, 200);
  assert.equal(await rij(g.email), undefined);
  assert.equal((await beheer(kantoor, "formulier_verwijderen", { id: f.id })).status, 404);
});

test("bezoekers (anon-sleutel) kunnen formulieren niet lezen of aanmaken", async () => {
  const a = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };
  const r = await fetch(`${API}/rest/v1/formulieren?select=*`, { headers: a });
  assert.ok(r.status === 401 || r.status === 403 || (r.ok && (await r.json()).length === 0));
  const maak = await fetch(`${API}/rest/v1/rpc/maak_formulier`, { method: "POST", headers: a, body: "{}" });
  assert.ok(maak.status >= 400);
  const lijst = await fetch(`${API}/rest/v1/rpc/formulieren_lijst`, { method: "POST", headers: a, body: "{}" });
  assert.ok(lijst.status >= 400);
});
