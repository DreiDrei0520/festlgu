-- ═════════════════════════════════════════════════════════════════════════════
-- FestivaLGU — Supabase schema, RLS, and seed data
--
-- 3 municipalities · 3 festivals:
--   • Bayenos Festival  → Bay, Laguna
--   • Banamos Festival  → Calauan, Laguna
--   • Pinya Festival    → Los Baños, Laguna
--
-- HOW TO USE:
--   1. Create a project at https://supabase.com
--   2. Auth → Providers → Email → turn ON "Confirm email" (optional)
--   3. Auth → Settings → enable "Custom SMTP" (host smtp.gmail.com, port 587)
--      if you want emails delivered. Make sure the password-reset email
--      template (Auth → Emails) includes the {{ .Token }} 6-digit code.
--   4. Open the SQL Editor (or `supabase db query --file supabase-schema.sql`)
--      and run this whole file.
--   5. Copy your Project URL + anon key into the app's .env file.
--
-- SAFE TO RE-RUN: the script is fully idempotent. It ALTERs existing tables to
-- add any missing columns, resolves demo users by email (creating accounts that
-- are missing, reviving passwords/metadata on existing ones), and upserts every
-- seed row to deterministic values. After a structural change, re-run this file
-- then refresh the PostgREST schema cache:
--     NOTIFY pgrst, 'reload schema';
-- ═════════════════════════════════════════════════════════════════════════════

-- ── tables (idempotent: adds new columns to existing tables) ─────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  fullname text not null default '',
  email text not null default '',
  role text not null default 'tourist' check (role in ('admin','organizer','msme','tourist')),
  profile_photo text,
  birthdate date,
  municipality text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists municipality text;

create table if not exists public.tourist_points (
  tourist_id uuid primary key references public.profiles (id) on delete cascade,
  points int not null default 0
);

create table if not exists public.festivals (
  id serial primary key,
  title text not null,
  slug text,
  municipality text,
  tagline text,
  description text,
  banner text,
  logo text,
  location text,
  start_date date,
  end_date date
);

alter table public.festivals add column if not exists slug text;
alter table public.festivals add column if not exists municipality text;
alter table public.festivals add column if not exists tagline text;
alter table public.festivals add column if not exists logo text;

create table if not exists public.events (
  id serial primary key,
  festival_id int references public.festivals (id) on delete cascade,
  title text not null,
  description text,
  venue text,
  start_time timestamptz,
  end_time timestamptz,
  organizer_id uuid references public.profiles (id) on delete set null
);

create table if not exists public.msmes (
  id serial primary key,
  owner uuid references public.profiles (id) on delete cascade,
  business_name text not null,
  logo text,
  description text,
  category text,
  municipality text,
  status text not null default 'pending',
  contact_number text,
  address text,
  business_type text,
  registration_code text,
  registration_fee numeric not null default 0,
  registration_date timestamptz
);

alter table public.msmes add column if not exists category text;
alter table public.msmes add column if not exists municipality text;
alter table public.msmes add column if not exists status text not null default 'pending';
alter table public.msmes add column if not exists contact_number text;
alter table public.msmes add column if not exists address text;
alter table public.msmes add column if not exists business_type text;
alter table public.msmes add column if not exists registration_code text;
alter table public.msmes add column if not exists registration_fee numeric not null default 0;
alter table public.msmes add column if not exists registration_date timestamptz;

create table if not exists public.products (
  id serial primary key,
  msme_id int not null references public.msmes (id) on delete cascade,
  product_name text not null,
  image text,
  description text,
  price numeric not null default 0,
  stock int not null default 0,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- msme product listings must be approved by the municipality before they show
alter table public.products add column if not exists approved boolean;

create table if not exists public.reward_qr (
  id serial primary key,
  product_id int references public.products (id) on delete cascade,
  qr_code text not null unique,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.guide_items (
  id serial primary key,
  section text not null check (section in ('maps','transportation','hotels','restaurants','emergency')),
  title text not null default '',
  subtitle text,
  body text,
  meta text,
  tag text,
  image text,
  is_map_image boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  msme_id int references public.msmes (id) on delete set null,
  qr_id int references public.reward_qr (id) on delete set null,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.rewards (
  id serial primary key,
  reward_name text not null,
  required_points int not null default 0,
  required_days int not null default 1,
  festival_id int references public.festivals (id) on delete set null,
  msme_id int references public.msmes (id) on delete set null,
  product_id int references public.products (id) on delete set null,
  image text,
  description text
);

alter table public.rewards add column if not exists required_days int not null default 1;
alter table public.rewards add column if not exists description text;
alter table public.rewards add column if not exists festival_id int references public.festivals (id) on delete set null;
alter table public.rewards add column if not exists msme_id int references public.msmes (id) on delete set null;
alter table public.rewards add column if not exists product_id int references public.products (id) on delete set null;

create table if not exists public.redeemed_rewards (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  reward_id int references public.rewards (id) on delete cascade,
  msme_id int references public.msmes (id) on delete set null,
  product_id int references public.products (id) on delete set null,
  redeemed_date timestamptz not null default now()
);

alter table public.redeemed_rewards add column if not exists msme_id int references public.msmes (id) on delete set null;
alter table public.redeemed_rewards add column if not exists product_id int references public.products (id) on delete set null;

create table if not exists public.feedback (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  rating int not null default 5,
  comment text not null default '',
  suggestion text,
  feedback_type text not null default 'festival',
  municipality text,
  festival_id int references public.festivals (id) on delete set null,
  msme_id int references public.msmes (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.feedback add column if not exists feedback_type text not null default 'festival';
alter table public.feedback add column if not exists municipality text;
alter table public.feedback add column if not exists festival_id int references public.festivals (id) on delete set null;
alter table public.feedback add column if not exists msme_id int references public.msmes (id) on delete set null;

create table if not exists public.announcements (
  id serial primary key,
  title text not null,
  description text not null default '',
  image text,
  festival_id int references public.festivals (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.announcements add column if not exists festival_id int references public.festivals (id) on delete set null;

create table if not exists public.saved_events (
  tourist_id uuid not null references public.profiles (id) on delete cascade,
  event_id int not null references public.events (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (tourist_id, event_id)
);

-- MSME registration payment records (registration fee → e-receipt)
create table if not exists public.registration_payments (
  id serial primary key,
  msme_id int references public.msmes (id) on delete cascade,
  amount numeric not null default 0,
  method text,
  status text not null default 'unpaid',
  reference text,
  receipt_no text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.registration_payments add column if not exists paid_at timestamptz;
alter table public.registration_payments drop constraint if exists registration_payments_method_check;
alter table public.registration_payments
  add constraint registration_payments_method_check
  check (method in ('e-wallet','debit','credit','GCash','Maya / PayMaya','Bank Transfer','Over-the-Counter','Bank Deposit'));

-- Attendance QR codes generated by municipality admins (printed at entrances)
create table if not exists public.attendance_qr (
  id serial primary key,
  festival_id int references public.festivals (id) on delete cascade,
  qr_code text not null unique,
  label text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Attendance scan log — one scan per tourist per QR per day (fraud guard)
create table if not exists public.attendance_logs (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  qr_id int references public.attendance_qr (id) on delete cascade,
  festival_id int references public.festivals (id) on delete set null,
  scan_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (tourist_id, qr_id, scan_date)
);

-- ── row level security ────────────────────────────────────────────────────────
-- Public content: anyone can read. Writes require an authenticated user.
-- User data: any authenticated user may read; writes also require auth.
-- Cross-municipality isolation is enforced in the application layer (each
-- municipality admin/organizer filters every query by their own town).

alter table public.profiles         enable row level security;
alter table public.tourist_points   enable row level security;
alter table public.festivals        enable row level security;
alter table public.events           enable row level security;
alter table public.msmes            enable row level security;
alter table public.products         enable row level security;
alter table public.reward_qr        enable row level security;
alter table public.transactions     enable row level security;
alter table public.rewards          enable row level security;
alter table public.redeemed_rewards enable row level security;
alter table public.feedback         enable row level security;
alter table public.announcements    enable row level security;
alter table public.saved_events     enable row level security;
alter table public.guide_items      enable row level security;
alter table public.registration_payments enable row level security;
alter table public.attendance_qr    enable row level security;
alter table public.attendance_logs  enable row level security;

-- Auto-create a profile row when a new user signs up via the app. Role and
-- municipality come from auth user_metadata (the Register form sends these).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, fullname, role, municipality)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'fullname', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'tourist'),
    new.raw_user_meta_data ->> 'municipality'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- reads: anon + authenticated for content tables
drop policy if exists "public read festivals" on public.festivals;
create policy "public read festivals" on public.festivals for select using (true);
drop policy if exists "public read events" on public.events;
create policy "public read events" on public.events for select using (true);
drop policy if exists "public read msmes" on public.msmes;
create policy "public read msmes" on public.msmes for select using (true);
drop policy if exists "public read products" on public.products;
create policy "public read products" on public.products for select using (true);
drop policy if exists "public read rewards" on public.rewards;
create policy "public read rewards" on public.rewards for select using (true);
drop policy if exists "public read announcements" on public.announcements;
create policy "public read announcements" on public.announcements for select using (true);
drop policy if exists "public read reward_qr" on public.reward_qr;
create policy "public read reward_qr" on public.reward_qr for select using (true);
drop policy if exists "public read guide_items" on public.guide_items;
create policy "public read guide_items" on public.guide_items for select using (true);
drop policy if exists "public read attendance_qr" on public.attendance_qr;
create policy "public read attendance_qr" on public.attendance_qr for select using (true);

-- reads: authenticated for user data
drop policy if exists "auth read profiles" on public.profiles;
create policy "auth read profiles" on public.profiles for select using (auth.role() = 'authenticated');
drop policy if exists "auth read tourist_points" on public.tourist_points;
create policy "auth read tourist_points" on public.tourist_points for select using (auth.role() = 'authenticated');
drop policy if exists "auth read transactions" on public.transactions;
create policy "auth read transactions" on public.transactions for select using (auth.role() = 'authenticated');
drop policy if exists "auth read redeemed_rewards" on public.redeemed_rewards;
create policy "auth read redeemed_rewards" on public.redeemed_rewards for select using (auth.role() = 'authenticated');
drop policy if exists "auth read feedback" on public.feedback;
create policy "auth read feedback" on public.feedback for select using (auth.role() = 'authenticated');
drop policy if exists "auth read saved_events" on public.saved_events;
create policy "auth read saved_events" on public.saved_events for select using (auth.role() = 'authenticated');
drop policy if exists "auth read registration_payments" on public.registration_payments;
create policy "auth read registration_payments" on public.registration_payments for select using (auth.role() = 'authenticated');
drop policy if exists "auth read attendance_logs" on public.attendance_logs;
create policy "auth read attendance_logs" on public.attendance_logs for select using (auth.role() = 'authenticated');

-- writes: any authenticated user
drop policy if exists "auth write profiles" on public.profiles;
create policy "auth write profiles" on public.profiles for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write tourist_points" on public.tourist_points;
create policy "auth write tourist_points" on public.tourist_points for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write festivals" on public.festivals;
create policy "auth write festivals" on public.festivals for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write events" on public.events;
create policy "auth write events" on public.events for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write msmes" on public.msmes;
create policy "auth write msmes" on public.msmes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write products" on public.products;
create policy "auth write products" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write reward_qr" on public.reward_qr;
create policy "auth write reward_qr" on public.reward_qr for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write transactions" on public.transactions;
create policy "auth write transactions" on public.transactions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write rewards" on public.rewards;
create policy "auth write rewards" on public.rewards for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write redeemed_rewards" on public.redeemed_rewards;
create policy "auth write redeemed_rewards" on public.redeemed_rewards for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write feedback" on public.feedback;
create policy "auth write feedback" on public.feedback for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write announcements" on public.announcements;
create policy "auth write announcements" on public.announcements for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write saved_events" on public.saved_events;
create policy "auth write saved_events" on public.saved_events for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write guide_items" on public.guide_items;
create policy "auth write guide_items" on public.guide_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write registration_payments" on public.registration_payments;
create policy "auth write registration_payments" on public.registration_payments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write attendance_qr" on public.attendance_qr;
create policy "auth write attendance_qr" on public.attendance_qr for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write attendance_logs" on public.attendance_logs;
create policy "auth write attendance_logs" on public.attendance_logs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ═════════════════════════════════════════════════════════════════════════════
-- ── SEED ──────────────────────────────────────────────────────────────────────
--
-- Self-healing demo bootstrap. For every demo account:
--   1. Resolve by email. If the account already exists in auth.users (even with
--      a different id), adopt its real id and revive password + role metadata.
--   2. If it does not exist, create it with a fixed UUID.
-- Accounts are SEPARATE per role: 3 admins, 3 organizers, 3 approved MSME owners
-- + 1 pending applicant, and 4 tourists — one staff account per municipality per role.
-- The resolved ids are reused for every seed row below, so this file can be
-- re-run over an existing database without FK or duplicate-key errors.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  -- parallel demo-account lists (index i): email, fullname, role, municipality('' = none), fixed uuid
  emails text[] := array[
    'admin@festivalglu.ph',            'calauan.admin@festivalglu.ph',    'losbanos.admin@festivalglu.ph',
    'organizer@festivalglu.ph',        'calauan.organizer@festivalglu.ph','losbanos.organizer@festivalglu.ph',
    'msme@festivalglu.ph',             'msme2@festivalglu.ph',            'msme3@festivalglu.ph',
    'msme4@festivalglu.ph',            'tourist@festivalglu.ph',          'ana@festivalglu.ph',
    'jose@festivalglu.ph',             'lina@festivalglu.ph'];
  fnames text[] := array[
    'Admin Rivera',      'Aling Nena Reyes', 'Ka Mario Cruz',
    'Carlos Mendoza',    'Rosa Villanueva',  'Lito Salvador',
    'Elena Cruz',        'Rico Dalisay',     'Diana Lopez',
    'Nilda Torres',      'Maria Santos',     'Ana Reyes',
    'Jose Tan',          'Lina Bautista'];
  roles text[] := array[
    'admin','admin','admin','organizer','organizer','organizer',
    'msme','msme','msme','msme','tourist','tourist','tourist','tourist'];
  munis text[] := array[
    'bay','calauan','los-banos','bay','calauan','los-banos',
    'bay','calauan','los-banos','bay','','','',''];
  fids text[] := array[
    '11111111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222', 'aaaa2222-2222-2222-2222-222222222222', 'bbbb2222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555',
    'aaaa5555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777',
    '88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999'];
  id_map jsonb := '{}'::jsonb;
  u_meta jsonb;
  v uuid;
  i int;
  admin_id uuid; calauan_admin_id uuid; lbs_admin_id uuid;
  bay_org_id uuid; calauan_org_id uuid; lbs_org_id uuid;
  bay_msme_id uuid; calauan_msme_id uuid; lbs_msme_id uuid; pending_msme_id uuid;
  tourist1_id uuid; tourist2_id uuid; tourist3_id uuid; tourist4_id uuid;
begin
  for i in 1..array_length(emails, 1) loop
    u_meta := jsonb_build_object('fullname', fnames[i], 'role', roles[i])
      || case when munis[i] <> '' then jsonb_build_object('municipality', munis[i]) else '{"municipality":null}'::jsonb end;

    v := null;
    select id into v from auth.users where email = emails[i] limit 1;

    if v is null then
      insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
         reauthentication_token, email_change, phone_change, email_change_confirm_status,
         is_sso_user, is_anonymous,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-000000000000', fids[i]::uuid, 'authenticated', 'authenticated', emails[i],
         crypt('Festival@2025', gen_salt('bf')), now(),
         '', '', '', '',
         '', '', '', 0,
         false, false,
         '{"provider":"email","providers":["email"]}', u_meta, now(), now())
      on conflict do nothing
      returning id into v;
      if v is null then
        select id into v from auth.users where email = emails[i] limit 1;
      end if;
      if v is not null then
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (v, v, v, jsonb_build_object('sub', v, 'email', emails[i]), 'email', now(), now(), now())
        on conflict do nothing;
      end if;
    else
      -- account already exists: standardize password, confirmation, and role metadata
      update auth.users set
        encrypted_password = crypt('Festival@2025', gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_user_meta_data = u_meta
      where id = v;
    end if;

    if v is not null then
      id_map := jsonb_set(id_map, array[emails[i]], to_jsonb(v::text));
    end if;
  end loop;

  admin_id          := (id_map->>'admin@festivalglu.ph')::uuid;
  calauan_admin_id  := (id_map->>'calauan.admin@festivalglu.ph')::uuid;
  lbs_admin_id      := (id_map->>'losbanos.admin@festivalglu.ph')::uuid;
  bay_org_id        := (id_map->>'organizer@festivalglu.ph')::uuid;
  calauan_org_id    := (id_map->>'calauan.organizer@festivalglu.ph')::uuid;
  lbs_org_id        := (id_map->>'losbanos.organizer@festivalglu.ph')::uuid;
  bay_msme_id       := (id_map->>'msme@festivalglu.ph')::uuid;
  calauan_msme_id   := (id_map->>'msme2@festivalglu.ph')::uuid;
  lbs_msme_id       := (id_map->>'msme3@festivalglu.ph')::uuid;
  pending_msme_id   := (id_map->>'msme4@festivalglu.ph')::uuid;
  tourist1_id       := (id_map->>'tourist@festivalglu.ph')::uuid;
  tourist2_id       := (id_map->>'ana@festivalglu.ph')::uuid;
  tourist3_id       := (id_map->>'jose@festivalglu.ph')::uuid;
  tourist4_id       := (id_map->>'lina@festivalglu.ph')::uuid;

  -- ── seed: profiles ──────────────────────────────────────────────────────────

  insert into public.profiles (id, fullname, email, role, municipality, created_at) values
    (admin_id,          'Admin Rivera',       'admin@festivalglu.ph',             'admin',     'bay',        now() - interval '90 days'),
    (calauan_admin_id,  'Aling Nena Reyes',   'calauan.admin@festivalglu.ph',     'admin',     'calauan',    now() - interval '80 days'),
    (lbs_admin_id,      'Ka Mario Cruz',      'losbanos.admin@festivalglu.ph',    'admin',     'los-banos',  now() - interval '80 days'),
    (bay_org_id,        'Carlos Mendoza',     'organizer@festivalglu.ph',         'organizer', 'bay',        now() - interval '90 days'),
    (calauan_org_id,    'Rosa Villanueva',    'calauan.organizer@festivalglu.ph', 'organizer', 'calauan',    now() - interval '80 days'),
    (lbs_org_id,        'Lito Salvador',      'losbanos.organizer@festivalglu.ph','organizer', 'los-banos',  now() - interval '80 days'),
    (bay_msme_id,       'Elena Cruz',         'msme@festivalglu.ph',              'msme',      'bay',        now() - interval '90 days'),
    (calauan_msme_id,   'Rico Dalisay',       'msme2@festivalglu.ph',             'msme',      'calauan',    now() - interval '90 days'),
    (lbs_msme_id,       'Diana Lopez',        'msme3@festivalglu.ph',             'msme',      'los-banos',  now() - interval '90 days'),
    (pending_msme_id,   'Nilda Torres',       'msme4@festivalglu.ph',             'msme',      'bay',        now() - interval '20 days'),
    (tourist1_id,       'Maria Santos',       'tourist@festivalglu.ph',           'tourist',   null,         now() - interval '90 days'),
    (tourist2_id,       'Ana Reyes',          'ana@festivalglu.ph',               'tourist',   null,         now() - interval '90 days'),
    (tourist3_id,       'Jose Tan',           'jose@festivalglu.ph',              'tourist',   null,         now() - interval '90 days'),
    (tourist4_id,       'Lina Bautista',      'lina@festivalglu.ph',              'tourist',   null,         now() - interval '90 days')
  on conflict (id) do update
    set fullname = excluded.fullname, email = excluded.email, role = excluded.role,
        municipality = excluded.municipality;

  -- ── seed: festivals (3 municipalities) ────────────────────────────────────────

  insert into public.festivals (id, title, slug, municipality, tagline, description, banner, logo, location, start_date, end_date) values
    (1, 'Bayenos Festival', 'bayenos', 'bay',
       'Bay''s thanksgiving for a bountiful harvest from the lake and fields.',
       'The Bayenos Festival is Bay, Laguna''s annual celebration honoring San Isidro Labrador. Expect street dancing, a colorful agro-fair, lake-inspired floats, and the warm hospitality of the Bayeños. Native dishes, fresh catch, and handcrafted goodness fill the town plaza for five memorable days.',
       'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=400&h=400&fit=crop',
       'Bay, Laguna',
       (current_date + interval '2 days')::date, (current_date + interval '6 days')::date),
    (2, 'Banamos Festival', 'banamos', 'calauan',
       'A sweeter-than-honey celebration of Calauan''s banana and rice harvest.',
       'Calauan is the banana capital of Laguna, and the Banamos Festival proudly celebrates it. Streets fill with banana-leaf costumes, floats shaped like the town''s prized fruits, and a lively trade fair offering the sweetest lakatan and saba products in the province.',
       'https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop',
       'Calauan, Laguna',
       (current_date + interval '12 days')::date, (current_date + interval '16 days')::date),
    (3, 'Pinya Festival', 'pinya', 'los-banos',
       'Los Baños crowns the king of tropical fruits with the sweetest harvest festival.',
       'Los Baños — home of UPLB and a mountain of fruits — celebrates its crown jewel, the pineapple. The Pinya Festival is a five-day fiesta of golden floats, dance competitions, research-backed farming exhibits, and the freshest tropical fruits straight from the slopes of Mount Makiling.',
       'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1558945529-0e4c8ec6b5c2?w=400&h=400&fit=crop',
       'Los Baños, Laguna',
       (current_date + interval '26 days')::date, (current_date + interval '30 days')::date)
  on conflict (id) do update set title = excluded.title, slug = excluded.slug, municipality = excluded.municipality,
    tagline = excluded.tagline, description = excluded.description, banner = excluded.banner,
    logo = excluded.logo, location = excluded.location;

  -- ── seed: events (Day 1 → final day, per festival) ───────────────────────────

  insert into public.events (id, festival_id, title, description, venue, start_time, end_time, organizer_id) values
    -- Bayenos Festival (5 days)
    (1, 1, 'Opening & Street Dance Parade', 'Grand opening parade as the Bayeños dance their way through the town center.', 'Bay Municipal Plaza', now() + interval '2 days 8 hours', now() + interval '2 days 12 hours', bay_org_id),
    (2, 1, 'Agro-Fair & Food Village Day', 'MSME booths, fresh catch, and Bay''s famous dishes open all day.', 'Bay Public Market', now() + interval '3 days 9 hours', now() + interval '3 days 20 hours', bay_org_id),
    (3, 1, 'Float & Costume Competition', 'Lake-inspired floats parade towards the plaza.', 'National Highway, Bay', now() + interval '4 days 16 hours', now() + interval '4 days 19 hours', bay_org_id),
    (4, 1, 'Rural & Folk Dance Night', 'Cultural performances under the stars.', 'Bay Municipal Grounds', now() + interval '5 days 18 hours', now() + interval '5 days 21 hours', bay_org_id),
    (5, 1, 'Grand Bayenos Thanksgiving', 'Ang pagtatapos ng bayanihan — closing feast and awarding ceremonies.', 'Bay Municipal Plaza', now() + interval '6 days 9 hours', now() + interval '6 days 13 hours', bay_org_id),
    -- Banamos Festival (5 days)
    (6, 2, 'Banamos Kick-off Parade', 'Bananas everywhere — the sweetest parade in Laguna.', 'Calauan Municipal Plaza', now() + interval '12 days 8 hours', now() + interval '12 days 12 hours', calauan_org_id),
    (7, 2, 'Banana Trade Fair & Tasting', 'Saba, lakatan, latundan — taste Calauan''s best.', 'Calauan Public Market', now() + interval '13 days 9 hours', now() + interval '13 days 19 hours', calauan_org_id),
    (8, 2, 'Banamos Street Dance Fest', 'Dancers in banana-leaf costumes fill the roads.', 'Roads of Calauan', now() + interval '14 days 15 hours', now() + interval '14 days 18 hours', calauan_org_id),
    (9, 2, 'Harvest Night Concert', 'Live bands and local performers.', 'Calauan Covered Court', now() + interval '15 days 18 hours', now() + interval '15 days 22 hours', calauan_org_id),
    (10, 2, 'Banamos Grand Finals', 'Champion contingents, fireworks, and the closing program.', 'Calauan Municipal Plaza', now() + interval '16 days 18 hours', now() + interval '16 days 21 hours', calauan_org_id),
    -- Pinya Festival (5 days)
    (11, 3, 'Pinya Parade & Agro Exhibits', 'Golden pineapple floats open the festival.', 'Los Baños Municipal Plaza', now() + interval '26 days 8 hours', now() + interval '26 days 12 hours', lbs_org_id),
    (12, 3, 'Fruit Harvest Fair', 'Fresh produce and UPLB research booths.', 'Los Baños Public Market', now() + interval '27 days 9 hours', now() + interval '27 days 19 hours', lbs_org_id),
    (13, 3, 'Makiling Street Dance Showdown', 'Festival queens and dancers contending.', 'Roads around the plaza', now() + interval '28 days 15 hours', now() + interval '28 days 18 hours', lbs_org_id),
    (14, 3, 'Pinya Fiesta Night', 'Cultural shows, food stalls, and main-stage performances.', 'Los Baños Municipal Grounds', now() + interval '29 days 18 hours', now() + interval '29 days 22 hours', lbs_org_id),
    (15, 3, 'Pinya Grand Closing', 'Champion declaration, raffle, and fireworks finale.', 'Los Baños Municipal Plaza', now() + interval '30 days 18 hours', now() + interval '30 days 21 hours', lbs_org_id)
  on conflict (id) do update set festival_id = excluded.festival_id, title = excluded.title,
    description = excluded.description, venue = excluded.venue, start_time = excluded.start_time,
    end_time = excluded.end_time, organizer_id = excluded.organizer_id;

  -- ── seed: MSMEs (one per town + one pending for the approval flow) ───────────

  insert into public.msmes (id, owner, business_name, logo, description, category, municipality, status, contact_number, address, business_type, registration_code, registration_fee, registration_date) values
    (1, bay_msme_id,       'Elena''s Delicacies',    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop', 'Authentic Bay pasalubong, kiping-inspired treats, and handcrafted local delicacies.',    'Food & Delicacies',    'bay',  'approved', '0917-111-2233', 'Brgy. San Antonio, Bay, Laguna',      'Food Stall',    'BAY-2026-001', 500, now() - interval '60 days'),
    (2, calauan_msme_id,   'Kultura Crafts',         'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&h=400&fit=crop', 'Handwoven textiles, woven bags, and banana-fiber souvenirs from Calauan.',                'Handicrafts & Souvenirs', 'calauan', 'approved', '0917-222-3344', 'Poblacion, Calauan, Laguna',          'Craft Booth',   'CAL-2026-014',  500, now() - interval '60 days'),
    (3, lbs_msme_id,       'Makiling Fruit & Coffee Co.', 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=600&h=400&fit=crop', 'Single-origin Mount Makiling coffee and the freshest pineapple produce.',                  'Coffee & Farm Produce', 'los-banos', 'approved', '0917-333-4455', 'Brgy. Malinta, Los Baños, Laguna',    'Farm Booth',   'LBS-2026-007', 500, now() - interval '55 days'),
    (4, pending_msme_id,   'Bagong Bayan Pasalubong', 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&h=400&fit=crop', 'New home-based pasalubong shop waiting for municipal approval.',                           'Food & Delicacies',    'bay',  'pending',  '0917-444-5566', 'Brgy. San Isidro, Bay, Laguna',       'Home-Based',   'BAY-2026-021', 500, now() - interval '3 days')
  on conflict (id) do update set owner = excluded.owner, business_name = excluded.business_name,
    logo = excluded.logo, description = excluded.description, category = excluded.category,
    municipality = excluded.municipality, status = excluded.status, contact_number = excluded.contact_number,
    address = excluded.address, business_type = excluded.business_type, registration_code = excluded.registration_code,
    registration_fee = excluded.registration_fee, registration_date = excluded.registration_date;

  insert into public.products (id, msme_id, product_name, image, description, price, stock, approved) values
    (1,  1, 'Elena''s Buko Pie',       null, 'Classic coconut custard pie.',                     350, 40,  true),
    (2,  1, 'Bay Pasalubong Pack',     null, 'Assorted longganisa and rice cakes.',               280, 60,  true),
    (3,  2, 'Banana Fiber Tote Bag',   null, 'Durable woven tote from banana fiber.',             450, 45,  true),
    (4,  2, 'Tribal Keychains',        null, 'Miniature woven crafts.',                            60, 300, true),
    (5,  3, 'Makiling Arabica (250g)', null, 'Single-origin local roast.',                       420, 80,  true),
    (6,  3, 'Pinya Merch Pack',        null, 'Pineapple-themed shirts and totes.',               500, 35,  true),
    (7,  1, 'Kipeks Rice Cracker',     null, 'Colorful edible harvest decoration.',               120, 120, true)
  on conflict (id) do update set msme_id = excluded.msme_id, product_name = excluded.product_name,
    image = excluded.image, description = excluded.description, price = excluded.price,
    stock = excluded.stock, approved = true;

  -- ── seed: rewards (milestone / stamp-card, no points) ────────────────────────

  insert into public.rewards (id, reward_name, required_points, required_days, festival_id, msme_id, product_id, image, description) values
    (1, 'Festival T-Shirt',      0, 5, null, 1, 1, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop', 'Official festival commemorative shirt. Visit all 5 festival days to claim it at participating MSME stalls.'),
    (2, 'Free Umbrella',         0, 3, null, 2, 4, 'https://images.unsplash.com/photo-1519058082700-08a0b56da9b4?w=400&h=300&fit=crop', 'Beat the heat or the rain! Attend 3 festival days and redeem a free umbrella.'),
    (3, 'Pasalubong Basket',     0, 4, null, 3, 6, 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=300&fit=crop', 'A basket of local treats from the harvest fair — yours after 4 days of attendance.'),
    (4, 'Handwoven Tote Bag',    0, 2, null, 2, 3, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=300&fit=crop', 'Eco-friendly banana-fiber tote, redeemable after 2 festival days.'),
    (5, 'Souvenir Fridge Magnet', 0, 1, null, 1, 2, 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=300&fit=crop', 'A small keepsake for your very first scanned festival day.')
  on conflict (id) do update set reward_name = excluded.reward_name, required_days = excluded.required_days,
    msme_id = excluded.msme_id, product_id = excluded.product_id, image = excluded.image,
    description = excluded.description;

  -- ── seed: registration payments (approved MSMEs) ─────────────────────────────

  insert into public.registration_payments (id, msme_id, amount, method, status, reference, receipt_no, created_at) values
    (1, 1, 500, 'e-wallet', 'paid', 'EWP-8821-3344', 'REC-BAY-2026-001', now() - interval '58 days'),
    (2, 2, 500, 'debit',    'paid', 'DBT-2271-9987', 'REC-CAL-2026-014', now() - interval '58 days'),
    (3, 3, 500, 'credit',   'paid', 'CRD-1290-5566', 'REC-LBS-2026-007', now() - interval '53 days')
  on conflict (id) do update set msme_id = excluded.msme_id, amount = excluded.amount,
    method = excluded.method, status = excluded.status, reference = excluded.reference,
    receipt_no = excluded.receipt_no;

  -- ── seed: attendance QR codes (admin-generated, printed at entrances) ────────

  insert into public.attendance_qr (id, festival_id, qr_code, label, created_by, created_at) values
    (1, 1, 'ATT-BAY-D1-MAIN',   'Day 1 — Main Entrance',        admin_id, now() - interval '6 days'),
    (2, 1, 'ATT-BAY-D2-PLAZA',  'Day 2 — Municipal Plaza',      admin_id, now() - interval '6 days'),
    (3, 2, 'ATT-CAL-D1-GATE',   'Day 1 — Town Gate',            calauan_admin_id, now() - interval '6 days'),
    (4, 3, 'ATT-LBS-D1-ENTRANCE','Day 1 — Main Entrance',       lbs_admin_id, now() - interval '6 days')
  on conflict (id) do update set festival_id = excluded.festival_id, qr_code = excluded.qr_code,
    label = excluded.label, created_by = excluded.created_by;

  -- ── seed: attendance logs (demo scans over past days) ───────────────────────

  insert into public.attendance_logs (tourist_id, qr_id, festival_id, scan_date, created_at) values
    (tourist1_id, 1, 1, current_date - 1, now() - interval '1 day'),
    (tourist1_id, 2, 1, current_date - 2, now() - interval '2 days'),
    (tourist2_id, 1, 1, current_date - 1, now() - interval '1 day'),
    (tourist2_id, 3, 2, current_date - 3, now() - interval '3 days'),
    (tourist3_id, 3, 2, current_date - 2, now() - interval '2 days')
  on conflict (tourist_id, qr_id, scan_date) do nothing;

  -- ── seed: announcements (scoped to festivals) ────────────────────────────────

  insert into public.announcements (id, title, description, image, festival_id, created_by, created_at) values
    (1, 'Bayenos 2026 Registration Open', 'Vendors, performers, and tourists can now register for Bayenos Festival.', null, 1, admin_id, now() - interval '2 days'),
    (2, 'Banamos Trade Fair Venues Announced', 'Calauan''s banana trade fair will open at the public market daily.', null, 2, calauan_admin_id, now() - interval '5 days'),
    (3, 'Call for Pinya Festival Performers', 'Cultural groups and dancers are invited to join the Grand Parade.', null, 3, lbs_admin_id, now() - interval '8 days'),
    (4, 'QR Attendance Stations Active', 'Scan the printed QR codes at every venue entrance — one scan per day counts toward your stamp card.', null, 1, bay_org_id, now() - interval '1 day')
  on conflict (id) do update set title = excluded.title, description = excluded.description,
    image = excluded.image, festival_id = excluded.festival_id, created_by = excluded.created_by;

  -- ── seed: feedback (both types, municipality-scoped) ─────────────────────────

  insert into public.feedback (id, tourist_id, rating, comment, suggestion, feedback_type, municipality, festival_id, msme_id, created_at) values
    (1, tourist1_id, 5, 'The Bayenos street parade was unforgettable!', 'More seating along the parade route.', 'festival', 'bay', 1, null, now() - interval '5 days'),
    (2, tourist2_id, 4, 'Loved the handwoven bags at this booth.', 'Richer color selection would be great.', 'msme',     'calauan', 2, 2, now() - interval '3 days'),
    (3, tourist3_id, 5, 'The QR attendance stamp card is brilliant — easy and fun!', null, 'festival', 'los-banos', 3, null, now() - interval '1 day')
  on conflict (id) do update set tourist_id = excluded.tourist_id, rating = excluded.rating,
    comment = excluded.comment, suggestion = excluded.suggestion, feedback_type = excluded.feedback_type,
    municipality = excluded.municipality, festival_id = excluded.festival_id, msme_id = excluded.msme_id;

  -- ── legacy seed (kept for compatibility with older builds) ───────────────────

  insert into public.tourist_points (tourist_id, points) values
    (tourist1_id, 415),
    (tourist2_id, 250),
    (tourist3_id, 380),
    (tourist4_id, 640)
  on conflict (tourist_id) do update set points = excluded.points;

  insert into public.reward_qr (id, product_id, qr_code, points, created_at) values
    (1, 1, 'FTLGU-DEMO-0001', 50,  now() - interval '1 day'),
    (2, 4, 'FTLGU-DEMO-0002', 100, now() - interval '1 day'),
    (3, 5, 'FTLGU-DEMO-0003', 75,  now() - interval '1 day')
  on conflict (id) do update set product_id = excluded.product_id, qr_code = excluded.qr_code,
    points = excluded.points;

  insert into public.transactions (id, tourist_id, msme_id, qr_id, points, created_at) values
    (1, tourist1_id, 1, 1, 50,  now() - interval '30 days'),
    (2, tourist1_id, 2, 2, 100, now() - interval '24 days'),
    (3, tourist2_id, 1, 1, 50,  now() - interval '12 days')
  on conflict (id) do update set tourist_id = excluded.tourist_id, msme_id = excluded.msme_id,
    qr_id = excluded.qr_id, points = excluded.points;

  insert into public.redeemed_rewards (id, tourist_id, reward_id, msme_id, product_id, redeemed_date) values
    (1, tourist1_id, 5, 1, 2, now() - interval '2 days')
  on conflict (id) do update set tourist_id = excluded.tourist_id, reward_id = excluded.reward_id,
    msme_id = excluded.msme_id, product_id = excluded.product_id;

  -- ── tourist guide (maps, transport, stays, food, emergency) ──────────────────

  insert into public.guide_items (id, section, title, subtitle, body, meta, tag, image, is_map_image, sort_order) values
    (1,  'maps',           'Festival Venue Map',        'Town Plaza',             'Download the official festival map at the LGU Tourism Office or visit any info booth on site.', null, null, 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=700&fit=crop', true,  0),
    (2,  'maps',           'Town Plaza & Main Stage',   'Main venue',             'Grand parades, nightly shows, and the festival opening.',            null, null, null, false, 1),
    (3,  'maps',           'Parade Route',              '2 km route',              'Follows the national road through the town center.',                 null, null, null, false, 2),
    (4,  'maps',           'MSME Trade Fair',           'Open daily',              'Local products, crafts, and pasalubong stalls.',                      null, null, null, false, 3),
    (5,  'maps',           'Food Village',              'All weekend',             'Authentic local dishes and festival food.',                           null, null, null, false, 4),
    (6,  'maps',           'Info Booth',                'Help desk',               'Tourist assistance, maps, and free bag counters.',                    null, null, null, false, 5),
    (7,  'transportation', 'Jeepney',                   null,                      'Main public transport around town and nearby barangays.',             '₱13 – ₱25', 'Every 10 min', null, false, 0),
    (8,  'transportation', 'Tricycle',                  null,                      'Best for short hops and getting to festival venues quickly.',         '₱20 – ₱50', 'On demand', null, false, 1),
    (9,  'transportation', 'Vans / UV Express',         null,                      'Comfortable shuttle between Laguna towns.',                            '₱35 – ₱90', 'Every 30 min', null, false, 2),
    (10, 'transportation', 'Pedicab',                   null,                      'Eco-friendly rides perfect for the parade route.',                    '₱15 – ₱40', 'Daytime', null, false, 3),
    (11, 'hotels',         'Villa Esperanza Resort',    'Resort',                  'Relaxing resort with pool and gardens by the lake.',                  '₱2,800/night', '4.4 ★ • 1.2 km from plaza', 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&h=400&fit=crop', false, 0),
    (12, 'hotels',         'Town Plaza Lodge',          'Budget Inn',              'Simple, clean rooms in the heart of town.',                           '₱950/night',  '4.1 ★ • 0.1 km from plaza', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=600&h=400&fit=crop', false, 1),
    (13, 'hotels',         'Laguna Farmhouse Stay',     'Homestay',                'Cozy family-run farm stay with home-style meals.',                    '₱1,400/night', '4.6 ★ • 3 km from plaza', 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&h=400&fit=crop', false, 2),
    (14, 'hotels',         'Makiling View Inn',         'Inn',                     'Quiet rooms with views of beautiful Mount Makiling.',                 '₱1,200/night', '4.2 ★ • 1.8 km from plaza', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop', false, 3),
    (15, 'hotels',         'Traveler''s Haven Hostel',  'Hostel',                  'Affordable shared and private rooms.',                                '₱550/bed',    '4.0 ★ • 0.8 km from plaza', 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600&h=400&fit=crop', false, 4),
    (16, 'hotels',         'Sampaguita Inn',            'Inn',                     'Cozy family-run inn with home-style meals.',                          '₱1,200/night', '4.2 ★ • 1.8 km from plaza', 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&h=400&fit=crop', false, 5),
    (17, 'restaurants',    'Kusina ng Bayan',           'Filipino Favorites',      null, '₱₱', 'Best: Boodle Fight Sets', 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop', false, 0),
    (18, 'restaurants',    'Sari-Sari Eatery',          'Home-style Dishes',       null, '₱',   'Best: Local Breakfast', 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&h=400&fit=crop', false, 1),
    (19, 'restaurants',    'The Harvest Table',         'Organic & Farm-to-Table', null, '₱₱₱', 'Best: Fresh Fruit Salads & Grills', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop', false, 2),
    (20, 'restaurants',    'Lutong Bahay',              'Laguna Delicacies',       null, '₱₱', 'Best: Pandesal & Local Coffee', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&h=400&fit=crop', false, 3),
    (21, 'restaurants',    'Kapihan sa Plaza',          'Coffee & Pastries',       null, '₱',   'Best: Barako Coffee & Ensaymada', 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&h=400&fit=crop', false, 4),
    (22, 'restaurants',    'Garden Bistro',             'International',           null, '₱₱₱', 'Best: Wood-fired Pizza', 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&h=400&fit=crop', false, 5),
    (23, 'emergency',      'Police Station',            'Report incidents, lost & found',        '0916-123-4567', null, null, null, false, 0),
    (24, 'emergency',      'Fire Station',              'Fire emergencies & hotline 160',        '0917-234-5678', null, null, null, false, 1),
    (25, 'emergency',      'Medical / Hospital',        '24/7 emergency care',                   '0918-345-6789', null, null, null, false, 2),
    (26, 'emergency',      'LGU Tourism Office',        'Information & assistance',              '0919-456-7890', null, null, null, false, 3),
    (27, 'emergency',      'Tourist Assistance',        'Tourist helpline',                      '1-800-FESTIVAL', null, null, null, false, 4),
    (28, 'emergency',      'Emergency Hotline',         'National emergency line',                '911', null, null, null, false, 5)
  on conflict (id) do update set section = excluded.section, title = excluded.title,
    subtitle = excluded.subtitle, body = excluded.body, meta = excluded.meta, tag = excluded.tag,
    image = excluded.image, is_map_image = excluded.is_map_image, sort_order = excluded.sort_order;

  -- normalize legacy rows that predate these columns
  update public.msmes set status = coalesce(status, 'pending') where status is null;
  update public.products set approved = coalesce(approved, false) where approved is null;
end $$;