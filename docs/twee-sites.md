# Twee sites, één achterkant

Voor het technisch aanspreekpunt en een opvolger. Laatst bijgewerkt: 24 november 2026.

Stichting Bonisa heeft twee websites, elk in een eigen repository in de GitHub-organisatie **Stichting-Bonisa**. Ze delen één achterkant: één Supabase-project in Frankfurt en één Mollie-account (besluiten 20, 39, 70 en 71).

| | jongerenzang.nl | bonisa.nl |
| --- | --- | --- |
| Repository | `Bonisa-Youth-Club` (deze; nu nog `hugoreijersen/bonisa-youth-club`) | `Stichting-Bonisa/Bonisa` |
| Voorkant | Homepage, tickets, scanpagina, **beheerpagina** | Homepage, projecten en giften, Ontmoetingsreis, nieuws, activiteiten, magazine, formulieren, ANBI, contact |
| Achterkant (`supabase/`) | **Hier**: alle migraties, functies en tests | Geen eigen achterkant; roept de functies hiernaast aan |
| Bewerkscherm | Pages CMS op deze repository | Pages CMS op die repository |
| Cloudflare | Eigen Worker (statische bestanden) | Eigen Worker (statische bestanden) |
| Mollie-websiteprofiel | Tickets (`MOLLIE_API_KEY`) | Giften (`MOLLIE_GIFTEN_API_KEY`) |

## Waarom de achterkant hier staat

- Er is één database. Twee mappen met migraties voor dezelfde database zouden elkaar in de weg zitten: Supabase houdt per project één lijst met uitgevoerde migraties bij.
- De code en alle tests van tickets, giften en formulieren staan hier al en zijn hier getest.
- Wie aan de achterkant werkt, doet dat dus altijd in deze repository, ook als het om giften of formulieren van bonisa.nl gaat. `npx supabase@3.0.0 db push --remote` en `functions deploy` alleen vanuit hier.

Verhuizen naar de repository van bonisa.nl kan later in één keer (map `supabase/` verplaatsen, `npm run`-opdrachten meenemen), als dat handiger blijkt. Nooit in beide tegelijk.

## Hoe bonisa.nl de achterkant gebruikt

- De site van bonisa.nl krijgt dezelfde bouwvariabelen als jongerenzang.nl: `FUNCTIES_URL` (adres van de functies) en, als er ingelogd wordt, `SUPABASE_PUBLIEKE_SLEUTEL`.
- De functies accepteren alleen verzoeken van sites in de secret `SITE_ORIGINS`; daar moeten `https://bonisa.nl` en `https://www.bonisa.nl` bij.
- Giften: `GIFTEN_SITE_URL` wijst naar bonisa.nl. De functie `create-gift` haalt daar de projectenlijst op (`/geven/projecten.json`), die de site van bonisa.nl publiceert uit `site/_data/projecten.json`.
- Formulieren: functie `formulier` (zie [formulieren.md](formulieren.md)).
- Lokaal: start de achterkant vanuit deze repository (`npm run db:start`, `npm run functies`, `npm run nep`) en de site van bonisa.nl in de andere map met `npm start`. Beide gebruiken http://localhost:8080; draai één site tegelijk.

## De beheerpagina

Kantoor beheert tickets, giften, formulieren en accounts op één pagina: `/beheer/` op jongerenzang.nl (besluit 73). Inloggen geldt per site, dus één plek is het eenvoudigst. Als kantoor liever op bonisa.nl werkt, kan de pagina later verhuizen (`site/beheer.njk`, `site/welkom.njk` en hun scripts); niet op twee sites tegelijk bijhouden.

## Wat er nog verhuist

De geefpagina's (`site/geven/`) en de sponsorpagina's van de Ontmoetingsreis (`site/ontmoetingsreis/`) zijn hier gebouwd, achter `GIFTEN_PAGINAS=aan`. Ze staan nu ook in de repository van bonisa.nl. Zodra die online is, gaan ze hier weg, met `projecten.json`, `ontmoetingsreis.json`, `giften.js` en de scripts `geven*.js` en `delen.js` (besluit 74).
