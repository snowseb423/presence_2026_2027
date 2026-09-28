-- =====================================================================
-- Présence — schéma
--
-- Tables, sécurité (RLS réservée aux adresses de allowed_emails),
-- fonctions de synchronisation last-write-wins, garde d'inscription
-- et publication temps réel.
--
-- Principe : attendance_overrides ne contient que les journées qui
-- s'écartent du statut par défaut. Le défaut (week-end, férié,
-- travaillé) est recalculé côté client à partir du calendrier et de
-- la table holidays.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.allowed_emails (
  email        text primary key
               constraint allowed_emails_email_format
               check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text check (display_name is null or char_length(display_name) <= 60),
  user_id      uuid unique references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.allowed_emails is
  'Adresses autorisées : seules ces personnes peuvent se connecter, lire et écrire.';

create table public.settings (
  id                smallint primary key default 1
                    constraint settings_single_row check (id = 1),
  hourly_rate       numeric(10, 2) not null default 170 check (hourly_rate >= 0),
  hours_per_day     numeric(5, 2)  not null default 3   check (hours_per_day > 0 and hours_per_day <= 24),
  transport_per_day numeric(10, 2) not null default 48  check (transport_per_day >= 0),
  -- Jours de prestation, numérotation ISO : 1 = lundi … 7 = dimanche.
  work_days         smallint[]     not null default '{1,2,3,4,5}'
                    check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(work_days) between 1 and 7),
  period_start      date not null default '2026-09-01',
  period_end        date not null default '2027-12-31',
  employee_name     text not null default '' check (char_length(employee_name) <= 60),
  updated_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  constraint settings_period_order  check (period_end >= period_start),
  constraint settings_period_length check (period_end - period_start <= 3660)
);
comment on table public.settings is 'Paramètres de calcul (ligne unique, id = 1).';

create table public.status_rules (
  code           text primary key check (code ~ '^[a-z][a-z_]*$'),
  label          text not null check (char_length(label) between 1 and 40),
  paid_hours     numeric(5, 2) not null check (paid_hours >= 0 and paid_hours <= 24),
  transport_paid boolean not null default false,
  color_token    text not null check (color_token ~ '^[a-z][a-z0-9-]*$'),
  sort_order     integer not null default 0,
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);
comment on table public.status_rules is
  'Effet de chaque statut sur le montant dû : heures payées et transport.';

create table public.holidays (
  date       date primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  note       text check (note is null or char_length(note) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.holidays is 'Jours fériés (éditables depuis l''app).';

create table public.attendance_overrides (
  date           date primary key,
  status_code    text not null references public.status_rules (code)
                 on update cascade on delete restrict,
  hours_override numeric(5, 2)
                 check (hours_override is null or (hours_override >= 0 and hours_override <= 24)),
  comment        text check (comment is null or char_length(comment) <= 500),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);
comment on table public.attendance_overrides is
  'Journées qui s''écartent du statut par défaut. updated_at = heure de la saisie (last-write-wins).';
comment on column public.attendance_overrides.hours_override is
  'Remplace les heures du statut, sans toucher au transport.';

-- Technique : horodatage des remises au défaut, pour qu'une saisie hors
-- ligne plus ancienne rejouée plus tard ne ressuscite pas la journée.
create table public.attendance_tombstones (
  date       date primary key,
  deleted_at timestamptz not null,
  deleted_by uuid references auth.users (id) on delete set null
);
comment on table public.attendance_tombstones is
  'Dernière remise au défaut de chaque journée (résolution des conflits).';


-- ---------------------------------------------------------------------
-- Contrôle d'accès
-- ---------------------------------------------------------------------

-- L'utilisateur du JWT fait-il partie des comptes autorisés ?
-- security definer : lit allowed_emails sans repasser par sa propre RLS.
create function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_emails a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;


-- ---------------------------------------------------------------------
-- Triggers d'horodatage et de résolution des conflits
-- ---------------------------------------------------------------------

-- Renseigne l'auteur et plafonne l'horodatage fourni par le téléphone
-- à l'heure du serveur (une horloge en avance ne gagne pas tous les
-- conflits). Argument 'monotonic' : updated_at ne recule jamais (tables
-- modifiées par champs, sans last-write-wins sur la ligne).
create function public.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := least(coalesce(new.updated_at, now()), now());
  if tg_op = 'UPDATE' and tg_nargs > 0 and tg_argv[0] = 'monotonic' then
    new.updated_at := greatest(new.updated_at, old.updated_at);
  end if;
  return new;
end;
$$;

-- Last-write-wins : une mise à jour plus ancienne que la ligne en base
-- est ignorée silencieusement.
create function public.lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

-- Les triggers BEFORE s'exécutent par ordre alphabétique de nom :
-- d'abord *_a_stamp, puis *_b_lww.
create trigger settings_a_stamp
  before insert or update on public.settings
  for each row execute function public.stamp_row('monotonic');

create trigger status_rules_a_stamp
  before insert or update on public.status_rules
  for each row execute function public.stamp_row('monotonic');

create trigger holidays_a_stamp
  before insert or update on public.holidays
  for each row execute function public.stamp_row();

create trigger holidays_b_lww
  before update on public.holidays
  for each row execute function public.lww_guard();

create trigger attendance_overrides_a_stamp
  before insert or update on public.attendance_overrides
  for each row execute function public.stamp_row();

create trigger attendance_overrides_b_lww
  before update on public.attendance_overrides
  for each row execute function public.lww_guard();


-- ---------------------------------------------------------------------
-- Comptes : normalisation et liaison avec auth.users
-- ---------------------------------------------------------------------

create function public.normalize_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.display_name := nullif(btrim(new.display_name), '');
  -- user_id n'est jamais fourni par le client (pas de droit sur la
  -- colonne) : il est déduit de auth.users à l'ajout ou au changement
  -- d'adresse, puis mis à jour par link_member() à l'inscription.
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.user_id := (
      select u.id from auth.users u where lower(u.email) = new.email limit 1
    );
  end if;
  return new;
end;
$$;

create trigger allowed_emails_normalize
  before insert or update on public.allowed_emails
  for each row execute function public.normalize_allowed_email();

-- Refuse la création d'un compte dont l'adresse n'est pas autorisée.
create function public.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_emails a
    where a.email = lower(coalesce(new.email, ''))
  ) then
    raise exception 'Adresse non autorisée pour cette application.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Relie allowed_emails.user_id au compte, pour afficher « qui a modifié ».
create function public.link_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.allowed_emails a
     set user_id = new.id
   where a.email = lower(coalesce(new.email, ''));
  return new;
end;
$$;

-- Les triggers sur auth.users sont le schéma documenté par Supabase ; si
-- un environnement les interdit, les données restent protégées par la RLS.
do $$
begin
  create trigger presence_guard_signup
    before insert on auth.users
    for each row execute function public.guard_signup();
  create trigger presence_link_member
    after insert or update of email on auth.users
    for each row execute function public.link_member();
exception
  when insufficient_privilege then
    raise notice 'Triggers sur auth.users non autorisés : garde d''inscription désactivée (la RLS protège toujours les données).';
end;
$$;


-- ---------------------------------------------------------------------
-- Synchronisation des saisies (last-write-wins + pierres tombales)
-- ---------------------------------------------------------------------

-- Enregistre le statut d'une journée. Ignoré si la base contient une
-- saisie ou une remise au défaut plus récente. Renvoie l'état final de
-- la journée (null = statut par défaut).
create function public.set_attendance(
  p_date           date,
  p_status_code    text,
  p_hours_override numeric default null,
  p_comment        text default null,
  p_updated_at     timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_at  timestamptz := least(coalesce(p_updated_at, now()), now());
  v_row public.attendance_overrides;
begin
  if not public.is_allowed() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attendance_tombstones t
    where t.date = p_date and t.deleted_at > v_at
  ) then
    insert into public.attendance_overrides as a
      (date, status_code, hours_override, comment, updated_by, updated_at)
    values
      (p_date, p_status_code, p_hours_override, nullif(btrim(p_comment), ''), auth.uid(), v_at)
    on conflict (date) do update
      set status_code    = excluded.status_code,
          hours_override = excluded.hours_override,
          comment        = excluded.comment,
          updated_by     = excluded.updated_by,
          updated_at     = excluded.updated_at
      where a.updated_at <= excluded.updated_at;

    delete from public.attendance_tombstones t
    where t.date = p_date and t.deleted_at <= v_at;
  end if;

  select * into v_row from public.attendance_overrides a where a.date = p_date;
  if not found then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Remet une journée à son statut par défaut, sauf si une saisie plus
-- récente existe. Renvoie l'état final de la journée.
create function public.clear_attendance(
  p_date       date,
  p_updated_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_at  timestamptz := least(coalesce(p_updated_at, now()), now());
  v_row public.attendance_overrides;
begin
  if not public.is_allowed() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  delete from public.attendance_overrides a
  where a.date = p_date and a.updated_at <= v_at;

  insert into public.attendance_tombstones as t (date, deleted_at, deleted_by)
  values (p_date, v_at, auth.uid())
  on conflict (date) do update
    set deleted_at = excluded.deleted_at,
        deleted_by = excluded.deleted_by
    where t.deleted_at < excluded.deleted_at;

  select * into v_row from public.attendance_overrides a where a.date = p_date;
  if not found then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.set_attendance(date, text, numeric, text, timestamptz) from public, anon;
revoke all on function public.clear_attendance(date, timestamptz) from public, anon;
grant execute on function public.set_attendance(date, text, numeric, text, timestamptz) to authenticated;
grant execute on function public.clear_attendance(date, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.allowed_emails        enable row level security;
alter table public.settings              enable row level security;
alter table public.status_rules          enable row level security;
alter table public.holidays              enable row level security;
alter table public.attendance_overrides  enable row level security;
alter table public.attendance_tombstones enable row level security;

-- Personne d'autre que les membres, même pas le rôle anonyme.
revoke all on table
  public.allowed_emails, public.settings, public.status_rules,
  public.holidays, public.attendance_overrides, public.attendance_tombstones
from anon, authenticated;

grant select, insert, delete on public.allowed_emails to authenticated;
grant update (display_name) on public.allowed_emails to authenticated;
grant select on public.settings to authenticated;
grant update (hourly_rate, hours_per_day, transport_per_day, work_days,
              period_start, period_end, employee_name, updated_at)
  on public.settings to authenticated;
grant select on public.status_rules to authenticated;
grant update (paid_hours, transport_paid, updated_at) on public.status_rules to authenticated;
grant select, insert, update, delete on public.holidays to authenticated;
grant select, insert, update, delete on public.attendance_overrides to authenticated;
grant select, insert, update, delete on public.attendance_tombstones to authenticated;

-- allowed_emails
create policy "membres : lecture des comptes" on public.allowed_emails
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : ajout d'un compte" on public.allowed_emails
  for insert to authenticated with check ((select public.is_allowed()));
create policy "membres : renommage d'un compte" on public.allowed_emails
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "membres : retrait d'un autre compte" on public.allowed_emails
  for delete to authenticated
  using ((select public.is_allowed()) and email <> lower(coalesce((select auth.jwt()) ->> 'email', '')));

-- settings
create policy "membres : lecture des réglages" on public.settings
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : modification des réglages" on public.settings
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- status_rules
create policy "membres : lecture des statuts" on public.status_rules
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : modification des statuts" on public.status_rules
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));

-- holidays
create policy "membres : lecture des fériés" on public.holidays
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : ajout de fériés" on public.holidays
  for insert to authenticated with check ((select public.is_allowed()));
create policy "membres : modification des fériés" on public.holidays
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "membres : suppression de fériés" on public.holidays
  for delete to authenticated using ((select public.is_allowed()));

-- attendance_overrides
create policy "membres : lecture des saisies" on public.attendance_overrides
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : ajout de saisies" on public.attendance_overrides
  for insert to authenticated with check ((select public.is_allowed()));
create policy "membres : modification des saisies" on public.attendance_overrides
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "membres : suppression de saisies" on public.attendance_overrides
  for delete to authenticated using ((select public.is_allowed()));

-- attendance_tombstones (utilisée par les fonctions ci-dessus)
create policy "membres : lecture des remises au défaut" on public.attendance_tombstones
  for select to authenticated using ((select public.is_allowed()));
create policy "membres : ajout de remises au défaut" on public.attendance_tombstones
  for insert to authenticated with check ((select public.is_allowed()));
create policy "membres : modification des remises au défaut" on public.attendance_tombstones
  for update to authenticated
  using ((select public.is_allowed())) with check ((select public.is_allowed()));
create policy "membres : suppression des remises au défaut" on public.attendance_tombstones
  for delete to authenticated using ((select public.is_allowed()));


-- ---------------------------------------------------------------------
-- Temps réel
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['settings', 'status_rules', 'holidays', 'attendance_overrides', 'allowed_emails'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
