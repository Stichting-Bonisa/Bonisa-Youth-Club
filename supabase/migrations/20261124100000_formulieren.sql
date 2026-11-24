-- Forms on bonisa.nl: contact, "Nodig ons uit", magazine, volunteers and
-- change of address. Every message is stored here and mailed to office.
-- Explanation in Dutch: docs/formulieren.md
--
-- Same security model as tickets and gifts: Row Level Security without
-- policies, and only the service role (the edge functions) may call the
-- functions below. Which fields each form has is checked in the edge function
-- (_shared/formulieren.ts); here only the limits that must always hold.

create type public.formulier_soort as enum (
  'contact',         -- general question
  'uitnodiging',     -- "Nodig ons uit": presentation or guest lesson
  'magazine',        -- free subscription to the magazine (by post)
  'vrijwilliger',    -- wants to help as a volunteer
  'adreswijziging'   -- new address for the magazine and mailings
);

create table public.formulieren (
  id                       uuid primary key default gen_random_uuid(),
  soort                    public.formulier_soort not null,
  voornaam                 text not null check (char_length(voornaam) between 1 and 100),
  achternaam               text not null check (char_length(achternaam) between 1 and 100),
  email                    text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  telefoon                 text check (char_length(telefoon) <= 30),
  -- The other fields of the form (message, organisation, address, ...).
  gegevens                 jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(gegevens) = 'object' and octet_length(gegevens::text) <= 10000),
  nieuwsbrief              boolean not null default false,
  nieuwsbrief_verwerkt_op  timestamptz,
  mail_verstuurd_op        timestamptz,
  afgehandeld_op           timestamptz,
  aangemaakt_op            timestamptz not null default now()
);

create index formulieren_email_tijd on public.formulieren (lower(email), aangemaakt_op);
create index formulieren_tijd on public.formulieren (aangemaakt_op desc);

alter table public.formulieren enable row level security;
revoke all on public.formulieren from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saving a form
-- ---------------------------------------------------------------------------
create or replace function public.maak_formulier(
  p_soort       text,
  p_voornaam    text,
  p_achternaam  text,
  p_email       text,
  p_telefoon    text,
  p_gegevens    jsonb,
  p_nieuwsbrief boolean
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_email  text := lower(trim(p_email));
  v_recent integer;
  v_id     uuid;
begin
  if p_soort is null or p_soort not in ('contact', 'uitnodiging', 'magazine', 'vrijwilliger', 'adreswijziging') then
    raise exception 'onbekend_formulier';
  end if;

  -- Simple protection against floods: max 5 forms per e-mail address per hour.
  select count(*) into v_recent
  from public.formulieren
  where lower(email) = v_email and aangemaakt_op > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'te_veel_formulieren';
  end if;

  insert into public.formulieren (soort, voornaam, achternaam, email, telefoon, gegevens, nieuwsbrief)
  values (p_soort::public.formulier_soort, trim(p_voornaam), trim(p_achternaam), v_email,
          nullif(trim(coalesce(p_telefoon, '')), ''), coalesce(p_gegevens, '{}'::jsonb), coalesce(p_nieuwsbrief, false))
  returning id into v_id;
  return v_id;
exception
  when check_violation or not_null_violation then
    raise exception 'ongeldige_gegevens';
end;
$$;

create or replace function public.formulier_mail_verstuurd(p_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.formulieren set mail_verstuurd_op = now() where id = p_id;
$$;

-- Newsletter: same sign-up as tickets and gifts (_shared/nieuwsbrief.ts).
create or replace function public.formulier_nieuwsbrief_claim(p_formulier_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  update public.formulieren
  set nieuwsbrief_verwerkt_op = now()
  where id = p_formulier_id and nieuwsbrief and nieuwsbrief_verwerkt_op is null
  returning jsonb_build_object('email', email, 'voornaam', voornaam, 'achternaam', achternaam);
$$;

create or replace function public.formulier_nieuwsbrief_mislukt(p_formulier_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.formulieren set nieuwsbrief_verwerkt_op = null where id = p_formulier_id;
$$;

-- ---------------------------------------------------------------------------
-- Management page (/beheer/, role kantoor)
-- ---------------------------------------------------------------------------
-- Forms of one kind (or all) received between two dates, newest first.
create or replace function public.formulieren_lijst(p_soort text, p_van date, p_tot date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'soort', f.soort,
    'datum', f.aangemaakt_op,
    'voornaam', f.voornaam,
    'achternaam', f.achternaam,
    'email', f.email,
    'telefoon', f.telefoon,
    'gegevens', f.gegevens,
    'nieuwsbrief', f.nieuwsbrief,
    'mail_verstuurd', f.mail_verstuurd_op is not null,
    'afgehandeld_op', f.afgehandeld_op
  ) order by f.aangemaakt_op desc), '[]'::jsonb)
  from public.formulieren f
  where (p_soort is null or p_soort = '' or f.soort::text = p_soort)
    and f.aangemaakt_op >= (p_van::timestamp at time zone 'Europe/Amsterdam')
    and f.aangemaakt_op <  ((p_tot + 1)::timestamp at time zone 'Europe/Amsterdam');
$$;

-- Mark as handled (or back to open with p_klaar = false).
create or replace function public.formulier_afhandelen(p_id uuid, p_klaar boolean)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with bijgewerkt as (
    update public.formulieren
    set afgehandeld_op = case when p_klaar then coalesce(afgehandeld_op, now()) else null end
    where id = p_id
    returning id
  )
  select exists (select 1 from bijgewerkt);
$$;

-- Office deletes a form, for example when someone asks to be forgotten.
create or replace function public.formulier_verwijderen(p_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with weg as (delete from public.formulieren where id = p_id returning id)
  select exists (select 1 from weg);
$$;

-- ---------------------------------------------------------------------------
-- Only the service role (the edge functions) may call these functions.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.maak_formulier(text, text, text, text, text, jsonb, boolean),
  public.formulier_mail_verstuurd(uuid),
  public.formulier_nieuwsbrief_claim(uuid),
  public.formulier_nieuwsbrief_mislukt(uuid),
  public.formulieren_lijst(text, date, date),
  public.formulier_afhandelen(uuid, boolean),
  public.formulier_verwijderen(uuid)
from public, anon, authenticated;

grant execute on function
  public.maak_formulier(text, text, text, text, text, jsonb, boolean),
  public.formulier_mail_verstuurd(uuid),
  public.formulier_nieuwsbrief_claim(uuid),
  public.formulier_nieuwsbrief_mislukt(uuid),
  public.formulieren_lijst(text, date, date),
  public.formulier_afhandelen(uuid, boolean),
  public.formulier_verwijderen(uuid)
to service_role;
