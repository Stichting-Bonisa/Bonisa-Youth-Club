# Formulieren voor bonisa.nl

Voor het technisch aanspreekpunt en een opvolger. Laatst bijgewerkt: 24 november 2026.

De formulieren op bonisa.nl (contact, nodig ons uit, magazine aanvragen, vrijwilliger worden, adreswijziging) gaan naar één functie in Supabase (Frankfurt). Elk bericht wordt bewaard in de database en per mail naar kantoor gestuurd. Kantoor ziet alle berichten ook op `/beheer/` → **Formulieren** (besluit 72). Er draait niets bij Cloudflare.

## 1. Hoe een bericht loopt

```
Bezoeker op bonisa.nl (bijv. /contact/)
   │  formulier: soort, naam, e-mail, eventueel telefoon, de velden van dat formulier, nieuwsbrief-vinkje
   v
formulier  (Supabase-functie, Frankfurt)
   │  1. spamveld gevuld? → doet alsof het gelukt is, bewaart niets
   │  2. controleert de velden per formulier (_shared/formulieren.ts); onbekende velden vallen weg
   │  3. maak_formulier() in de database (max. 5 per e-mailadres per uur)
   │  4. mail naar kantoor via MailerSend, met "Beantwoorden" naar de afzender
   │  5. nieuwsbrief: alleen met het vinkje, naar MailerLite
   v
Terug naar de pagina: ?verzonden=1  of  ?fout=<code>    (met JavaScript: JSON)
```

Lukt de mail niet, dan blijft het bericht bewaard (kolom `mail_verstuurd_op` blijft leeg) en staat het gewoon op `/beheer/`.

## 2. De formulieren

| `soort` | Formulier | Verplicht (naast voornaam, achternaam, e-mail) | Overige velden |
| --- | --- | --- | --- |
| `contact` | Contact | `bericht` | `onderwerp`, `telefoon` |
| `uitnodiging` | Nodig ons uit (presentatie of gastles) | `telefoon`, `organisatie`, `plaats` | `soort_organisatie` (school, kerk, vereniging, bedrijf, anders), `datum`, `groep`, `bericht` |
| `magazine` | Magazine gratis aanvragen | `straat`, `postcode`, `plaats` | `aantal`, `telefoon` |
| `vrijwilliger` | Vrijwilliger worden | | `woonplaats`, `interesse`, `bericht`, `telefoon` |
| `adreswijziging` | Adreswijziging | `straat`, `postcode`, `plaats` | `oud_adres`, `ingangsdatum`, `telefoon` |

Verder altijd: `terug` (de pagina om naar terug te gaan, bijvoorbeeld `/contact/`), `website` (verborgen spamveld, leeg laten) en `nieuwsbrief` (vinkje, standaard uit).

**Formulier toevoegen of een veld erbij:** pas de lijst `FORMULIEREN` aan in `supabase/functions/_shared/formulieren.ts`. Een nieuwe soort moet ook in de migratie (type `formulier_soort`), in de controle van de actie `formulieren` in `functions/beheer/index.ts` en in de keuzelijst op `/beheer/`. Voeg een test toe.

## 3. De onderdelen

| Onderdeel | Wat het doet |
| --- | --- |
| `supabase/migrations/20261124100000_formulieren.sql` | Tabel `formulieren` en de SQL-functies; bezoekers en ingelogde accounts kunnen er niets mee (RLS, getest) |
| `supabase/functions/formulier` | Ontvangt de formulieren. Werkt ook zonder JavaScript |
| `supabase/functions/_shared/formulieren.ts` | Velden per formulier, controle, mail naar kantoor, nieuwsbrief |
| `supabase/functions/beheer` | Acties `formulieren` (lijst per soort en periode), `formulier_afhandelen`, `formulier_verwijderen` (alleen rol kantoor) |
| `site/beheer.njk`, `site/assets/js/beheer.js` | Blok **Formulieren** op `/beheer/`: lijst, afgehandeld, verwijderen, export (CSV) |

De pagina's met de formulieren zelf staan in de repository van bonisa.nl (zie [twee-sites.md](twee-sites.md)).

## 4. Instellingen (secrets in Supabase)

| Naam | Wat |
| --- | --- |
| `FORMULIEREN_MAIL_NAAR` | Adres van kantoor dat elk bericht krijgt (bijvoorbeeld info@bonisa.nl). Leeg = geen mail |
| `FORMULIEREN_MAIL_NAAR_<SOORT>` | Ander adres voor één formulier, bijvoorbeeld `FORMULIEREN_MAIL_NAAR_UITNODIGING=voorlichting@bonisa.nl` |
| `FORMULIEREN_MAIL_FROM` | Afzender; leeg = `GIFTEN_MAIL_FROM`. Moet op een domein staan dat in MailerSend geverifieerd is |
| `FORMULIEREN_SITE_URL` | Waar een bezoeker zonder JavaScript naar terug gaat als het adres van de site niet herkend wordt; leeg = `GIFTEN_SITE_URL` |

Het adres van bonisa.nl moet in `SITE_ORIGINS` staan, net als voor de giften.

## 5. Testen

Zoals bij het ticketsysteem: `npm run db:start`, `.env.example` kopiëren naar `.env.local`, `npm run functies`, en dan:

```
npm run test:formulieren
```

De tests controleren: opslaan en mail naar kantoor (met ontsnapte HTML en antwoordadres), werken zonder JavaScript, geen terugsturen naar een andere site, verplichte velden per formulier, onbekende velden, het spamveld, het maximum per uur, de nieuwsbrief, een mislukte mail, de acties op `/beheer/` en dat bezoekers niets kunnen lezen. Stand op 24 november 2026: 9 geslaagd. Niet tegelijk draaien met `test:tickets` of `test:giften`.

## 6. Voor kantoor

- Elk bericht komt per mail binnen. Klik op **Beantwoorden** om de afzender te mailen.
- Op `/beheer/` → **Formulieren** staan alle berichten van een periode. Zet een bericht op **Afgehandeld** als het klaar is.
- **Verwijderen** (twee keer klikken) wist het bericht voorgoed, bijvoorbeeld als iemand vraagt om zijn gegevens te verwijderen. Verwijder dan ook de mail.
- **Exporteer (CSV)** geeft de berichten van de gekozen periode, bijvoorbeeld de magazine-aanvragen voor de adreslijst. Verwijder de export na gebruik uit de map Downloads.
