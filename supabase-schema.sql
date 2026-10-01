-- ═════════════════════════════════════════════════════════════════════════════
-- FestivaLGU — Supabase schema, RLS, and seed data
--
-- 3 municipalities · 3 festivals:
--   • Bayeños Festival  → Bay, Laguna
--   • Bañamos Festival  → Los Baños, Laguna
--   • Pinya Festival    → Calauan, Laguna
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
alter table public.profiles add column if not exists municipality_access text[];

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

-- MSME status lifecycle: unpaid (submitted, fee not paid) → pending (fee paid,
-- awaiting LGU approval) → approved (active). rejected allows resubmission.
alter table public.msmes drop constraint if exists msmes_status_check;
update public.msmes set status = 'approved' where status = 'registered';
alter table public.msmes
  add constraint msmes_status_check
  check (status in ('unpaid','pending','approved','rejected'));

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

alter table public.transactions add column if not exists transaction_type text not null default 'reward_redemption';
alter table public.transactions add column if not exists reference_no text;
alter table public.transactions add column if not exists description text;
alter table public.transactions add column if not exists amount numeric not null default 0;
alter table public.transactions add column if not exists status text not null default 'completed';
alter table public.transactions add column if not exists municipality text;
alter table public.transactions add column if not exists festival_id int references public.festivals (id) on delete set null;

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
-- link_view: the in-app page an announcement deep-links to (events|msmes|guide|contact|home)
alter table public.announcements add column if not exists link_view text;

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

-- Attendance QR codes generated by municipality admins (printed at entrances).
-- Canonical code format: FLGU-{FestivalName}-{UniqueCode} e.g. FLGU-Bayeños-ENTRANCE
--   Bayeños → Bay, Bañamos → Los Baños, Pinya → Calauan.
-- Each code can be tied to a specific venue/event (venue_id) or the whole
-- festival (venue_id null); is_active + expires_at control scan eligibility.
create table if not exists public.attendance_qr (
  id serial primary key,
  festival_id int references public.festivals (id) on delete cascade,
  venue_id int references public.events (id) on delete set null,
  qr_code_string text not null default '',
  label text,
  municipality_id text,
  generated_by uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── attendance_qr migration (older builds used qr_code/municipality/created_by/status) ──
do $$
declare
  has_status bool;
  has_qr_code bool;
  has_municipality bool;
  has_created_by bool;
begin
  alter table public.attendance_qr add column if not exists qr_code_string text;
  alter table public.attendance_qr add column if not exists municipality_id text;
  alter table public.attendance_qr add column if not exists generated_by uuid references public.profiles (id) on delete set null;
  alter table public.attendance_qr add column if not exists is_active boolean not null default true;
  alter table public.attendance_qr add column if not exists expires_at timestamptz;

  has_qr_code       := exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_qr' and column_name='qr_code');
  has_status        := exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_qr' and column_name='status');
  has_municipality  := exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_qr' and column_name='municipality');
  has_created_by    := exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_qr' and column_name='created_by');

  if has_qr_code then
    update public.attendance_qr set qr_code_string = qr_code where qr_code_string is null or qr_code_string = '';
    alter table public.attendance_qr drop column qr_code;
  end if;
  if has_status then
    update public.attendance_qr set is_active = (status = 'active');
    alter table public.attendance_qr drop column status;
  end if;
  if has_municipality then
    update public.attendance_qr set municipality_id = municipality where municipality_id is null;
    alter table public.attendance_qr drop column municipality;
  end if;
  if has_created_by then
    update public.attendance_qr set generated_by = created_by where generated_by is null;
    alter table public.attendance_qr drop column created_by;
  end if;

  -- Canonical codes are stored UPPERCASE ASCII: FLGU-BANAMOS-XXXXXXXX.
  -- (Normalizes Ñ→N so phones/typing/copy-paste behave identically on all
  -- devices; the scanner accepts the ñ spelling and maps it to this form.)
  update public.attendance_qr set qr_code_string = replace(upper(qr_code_string), 'Ñ', 'N')
    where qr_code_string <> replace(upper(qr_code_string), 'Ñ', 'N');

  alter table public.attendance_qr alter column qr_code_string set not null;
  -- never allow duplicate QR codes (keep the lowest id on any legacy dup)
  delete from public.attendance_qr a using public.attendance_qr b
    where a.qr_code_string = b.qr_code_string and a.id > b.id;
  create unique index if not exists attendance_qr_qr_code_string_uq on public.attendance_qr (qr_code_string);
end $$;

-- Attendance scan log — one scan per tourist per QR per day (fraud guard)
create table if not exists public.attendance_logs (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  qr_id int references public.attendance_qr (id) on delete cascade,
  venue_id int references public.events (id) on delete set null,
  festival_id int references public.festivals (id) on delete set null,
  scan_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (tourist_id, qr_id, scan_date)
);

alter table public.attendance_logs add column if not exists venue_id int references public.events (id) on delete set null;

-- Enforce one attendance stamp per tourist per VENUE per day (in addition to the
-- per-QR guard above) — a tourist cannot re-scan a different code at the same site.
drop index if exists attendance_logs_tourist_venue_date_unique;
create unique index attendance_logs_tourist_venue_date_unique
  on public.attendance_logs (tourist_id, venue_id, scan_date)
  where venue_id is not null;

-- Municipal LGUs — public contact details shown on the Contact page
create table if not exists public.municipalities (
  id text primary key,
  name text not null,
  email text not null,
  phone text not null,
  address text not null,
  hours text,
  facebook text,
  created_at timestamptz not null default now()
);

alter table public.municipalities add column if not exists office_name text;
alter table public.municipalities add column if not exists contact_person text;

create table if not exists public.activity_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name text,
  user_email text,
  municipality text,
  action_type text not null,
  record_type text not null,
  record_id text,
  description text not null default ''
);

create index if not exists activity_logs_municipality_created_idx on public.activity_logs (municipality, created_at desc);

create or replace function public.fill_activity_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  select fullname, email, municipality into new.user_name, new.user_email, new.municipality
  from public.profiles where id = new.user_id;
  return new;
end;
$$;
drop trigger if exists activity_identity on public.activity_logs;
create trigger activity_identity before insert on public.activity_logs for each row execute function public.fill_activity_identity();

-- Interactive map points per festival (plaza, market, stages, entrances)
create table if not exists public.map_venues (
  id serial primary key,
  festival_id int references public.festivals (id) on delete cascade,
  municipality text,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  area text,
  sort_order int not null default 0,
  capacity int,
  qr_code_data text,
  created_at timestamptz not null default now()
);

alter table public.map_venues add column if not exists municipality text;
alter table public.map_venues add column if not exists area text;
alter table public.map_venues add column if not exists capacity int;
alter table public.map_venues add column if not exists qr_code_data text;

-- One venue per festival+name, so the demo seed below stays idempotent even
-- though map_venues.id is a serial (older runs duplicated rows every re-run).
delete from public.map_venues mv
  using public.map_venues old
  where old.festival_id = mv.festival_id
    and old.name = mv.name
    and old.id > mv.id;
create unique index if not exists map_venues_fest_name_uq
  on public.map_venues (festival_id, name);

-- Contact-form submissions routed to the selected municipality
create table if not exists public.contact_messages (
  id serial primary key,
  municipality text not null,
  name text not null,
  email text not null,
  subject text not null default '',
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
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
alter table public.municipalities   enable row level security;
alter table public.map_venues       enable row level security;
alter table public.contact_messages enable row level security;
alter table public.activity_logs enable row level security;

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
drop policy if exists "public read municipalities" on public.municipalities;
create policy "public read municipalities" on public.municipalities for select using (true);
drop policy if exists "public read map_venues" on public.map_venues;
create policy "public read map_venues" on public.map_venues for select using (true);
drop policy if exists "auth read activity_logs" on public.activity_logs;
create policy "auth read activity_logs" on public.activity_logs for select using (
  auth.role() = 'authenticated' and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.municipality = activity_logs.municipality)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.municipality is null)
  )
);
drop policy if exists "auth insert activity_logs" on public.activity_logs;
create policy "auth insert activity_logs" on public.activity_logs for insert with check (auth.role() = 'authenticated');
drop policy if exists "immutable activity_logs" on public.activity_logs;
create policy "immutable activity_logs" on public.activity_logs for update using (false);
drop policy if exists "immutable activity_logs delete" on public.activity_logs;
create policy "immutable activity_logs delete" on public.activity_logs for delete using (false);

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
drop policy if exists "auth read contact_messages" on public.contact_messages;
create policy "auth read contact_messages" on public.contact_messages for select using (auth.role() = 'authenticated');

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
drop policy if exists "auth write municipalities" on public.municipalities;
create policy "auth write municipalities" on public.municipalities for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth write map_venues" on public.map_venues;
create policy "auth write map_venues" on public.map_venues for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- anyone (guest or signed-in) may submit the PUBLIC contact form; only
-- authenticated users may read messages and toggle read/delete them.
drop policy if exists "auth write contact_messages" on public.contact_messages;
drop policy if exists "public insert contact_messages" on public.contact_messages;
drop policy if exists "auth update contact_messages" on public.contact_messages;
drop policy if exists "auth delete contact_messages" on public.contact_messages;
create policy "public insert contact_messages" on public.contact_messages
  for insert with check (true);
create policy "auth update contact_messages" on public.contact_messages
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth delete contact_messages" on public.contact_messages
  for delete using (auth.role() = 'authenticated');

-- Staff writes are restricted to their assigned municipality. Tourist/MSME
-- self-service writes remain governed by the existing user policies above.
create or replace function public.can_manage_municipality(target_municipality text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','organizer')
      and (p.municipality = target_municipality or p.municipality_access @> array[target_municipality])
  );
$$;

drop policy if exists "auth write festivals" on public.festivals;
create policy "auth write festivals" on public.festivals for all using (public.can_manage_municipality(municipality)) with check (public.can_manage_municipality(municipality));
drop policy if exists "auth write events" on public.events;
create policy "auth write events" on public.events for all using (exists (select 1 from public.festivals f where f.id = events.festival_id and public.can_manage_municipality(f.municipality))) with check (exists (select 1 from public.festivals f where f.id = events.festival_id and public.can_manage_municipality(f.municipality)));
drop policy if exists "auth write msmes" on public.msmes;
create policy "auth write msmes" on public.msmes for all using (owner = auth.uid() or public.can_manage_municipality(municipality)) with check (owner = auth.uid() or public.can_manage_municipality(municipality));
drop policy if exists "auth write municipalities" on public.municipalities;
create policy "auth write municipalities" on public.municipalities for all using (public.can_manage_municipality(id)) with check (public.can_manage_municipality(id));
drop policy if exists "auth write map_venues" on public.map_venues;
create policy "auth write map_venues" on public.map_venues for all using (public.can_manage_municipality(municipality)) with check (public.can_manage_municipality(municipality));

insert into public.municipalities (id, name, office_name, contact_person, email, phone, address, hours)
values
 ('bay', 'Bay', 'Bay Tourism Office', '', '', '', 'Bay Municipal Hall, Poblacion, Bay, Laguna', 'Monday–Friday, 8:00 AM–5:00 PM'),
 ('los-banos', 'Los Baños', 'Los Baños Tourism Office', '', '', '', 'Los Baños Municipal Hall, Brgy. Batong Malake, Laguna', 'Monday–Friday, 8:00 AM–5:00 PM'),
 ('calauan', 'Calauan', 'Calauan Tourism Office', '', '', '', 'Calauan Municipal Hall, Poblacion, Calauan, Laguna', 'Monday–Friday, 8:00 AM–5:00 PM')
on conflict (id) do nothing;

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

  -- dedupe: keep only the three canonical festivals (older builds seeded
  -- all-caps duplicates like "PINYA FESTIVAL" — those cascade clean up their events)
  delete from public.festivals where id not in (1, 2, 3);

  insert into public.festivals (id, title, slug, municipality, tagline, description, banner, logo, location, start_date, end_date) values
    (1, 'Bayeños Festival', 'bayenos', 'bay',
       'Bay''s thanksgiving for a bountiful harvest from the lake and fields.',
       'The Bayeños Festival is Bay, Laguna''s annual celebration honoring San Isidro Labrador. Expect street dancing, a colorful agro-fair, lake-inspired floats, and the warm hospitality of the Bayeños. Native dishes, fresh catch, and handcrafted goodness fill the town plaza for five memorable days.',
       'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=400&h=400&fit=crop',
       'Bay, Laguna',
       (current_date + interval '2 days')::date, (current_date + interval '6 days')::date),
    (2, 'Bañamos Festival', 'banamos', 'los-banos',
       'A sweeter-than-honey celebration of Los Baños'' banana and rice harvest.',
       'Los Baños marks the banana harvest with the Bañamos Festival — the sweetest feast in Laguna. Streets fill with banana-leaf costumes, floats shaped like the town''s prized fruits, and a lively trade fair offering the sweetest lakatan and saba products in the province.',
       'https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop',
       'Los Baños, Laguna',
       (current_date + interval '12 days')::date, (current_date + interval '16 days')::date),
    (3, 'Pinya Festival', 'pinya', 'calauan',
       'Calauan crowns the king of tropical fruits with the sweetest harvest festival.',
       'Calauan is famous for its sweet, golden pineapples, and the Pinya Festival proudly celebrates it. A five-day fiesta of fruit-shaped floats, dance competitions, farming exhibits, and the freshest tropical fruits straight from the fields of Laguna.',
       'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=1600&h=700&fit=crop',
       'https://images.unsplash.com/photo-1558945529-0e4c8ec6b5c2?w=400&h=400&fit=crop',
       'Calauan, Laguna',
       (current_date + interval '26 days')::date, (current_date + interval '30 days')::date)
  on conflict (id) do update set title = excluded.title, slug = excluded.slug, municipality = excluded.municipality,
    tagline = excluded.tagline, description = excluded.description, banner = excluded.banner,
    logo = excluded.logo, location = excluded.location;

  -- Enforce consistent festival naming per town — blocks case-insensitive
  -- duplicates like "Pinya Festival" vs "PINYA FESTIVAL" at the DB level.
  -- (Runs AFTER the dedupe above so legacy all-caps rows are removed first.)
  create unique index if not exists festivals_title_uq
    on public.festivals (municipality, lower(title));

  -- ── seed: events (Day 1 → final day, per festival) ───────────────────────────

  insert into public.events (id, festival_id, title, description, venue, start_time, end_time, organizer_id) values
    -- Bayeños Festival (5 days)
    (1, 1, 'Opening & Street Dance Parade', 'Grand opening parade as the Bayeños dance their way through the town center.', 'Bay Municipal Plaza', now() + interval '2 days 8 hours', now() + interval '2 days 12 hours', bay_org_id),
    (2, 1, 'Agro-Fair & Food Village Day', 'MSME booths, fresh catch, and Bay''s famous dishes open all day.', 'Bay Public Market', now() + interval '3 days 9 hours', now() + interval '3 days 20 hours', bay_org_id),
    (3, 1, 'Float & Costume Competition', 'Lake-inspired floats parade towards the plaza.', 'National Highway, Bay', now() + interval '4 days 16 hours', now() + interval '4 days 19 hours', bay_org_id),
    (4, 1, 'Rural & Folk Dance Night', 'Cultural performances under the stars.', 'Bay Municipal Grounds', now() + interval '5 days 18 hours', now() + interval '5 days 21 hours', bay_org_id),
    (5, 1, 'Grand Bayeños Thanksgiving', 'The grand finale — a closing feast, community thanksgiving, and awarding ceremonies for all contingents.', 'Bay Municipal Plaza', now() + interval '6 days 9 hours', now() + interval '6 days 13 hours', bay_org_id),
    -- Bañamos Festival (5 days) — Los Baños
    (6, 2, 'Bañamos Kick-off Parade', 'Bananas everywhere — the sweetest parade in Laguna.', 'Los Baños Municipal Plaza', now() + interval '12 days 8 hours', now() + interval '12 days 12 hours', lbs_org_id),
    (7, 2, 'Banana Trade Fair & Tasting', 'Saba, lakatan, latundan — taste Los Baños'' best.', 'Los Baños Public Market', now() + interval '13 days 9 hours', now() + interval '13 days 19 hours', lbs_org_id),
    (8, 2, 'Bañamos Street Dance Fest', 'Dancers in banana-leaf costumes fill the roads of Los Baños.', 'Roads of Los Baños', now() + interval '14 days 15 hours', now() + interval '14 days 18 hours', lbs_org_id),
    (9, 2, 'Harvest Night Concert', 'Live bands and local performers under the Makiling sky.', 'Los Baños Covered Court', now() + interval '15 days 18 hours', now() + interval '15 days 22 hours', lbs_org_id),
    (10, 2, 'Bañamos Grand Finals', 'Champion contingents, fireworks, and the closing program.', 'Los Baños Municipal Plaza', now() + interval '16 days 18 hours', now() + interval '16 days 21 hours', lbs_org_id),
    -- Pinya Festival (5 days) — Calauan
    (11, 3, 'Pinya Parade & Agro Exhibits', 'Golden pineapple floats open the festival.', 'Calauan Municipal Plaza', now() + interval '26 days 8 hours', now() + interval '26 days 12 hours', calauan_org_id),
    (12, 3, 'Fruit Harvest Fair', 'Fresh produce and farming research booths.', 'Calauan Public Market', now() + interval '27 days 9 hours', now() + interval '27 days 19 hours', calauan_org_id),
    (13, 3, 'Pinya Street Dance Showdown', 'Festival queens and dancers contending.', 'Roads of Calauan', now() + interval '28 days 15 hours', now() + interval '28 days 18 hours', calauan_org_id),
    (14, 3, 'Pinya Fiesta Night', 'Cultural shows, food stalls, and main-stage performances.', 'Calauan Municipal Grounds', now() + interval '29 days 18 hours', now() + interval '29 days 22 hours', calauan_org_id),
    (15, 3, 'Pinya Grand Closing', 'Champion declaration, raffle, and fireworks finale.', 'Calauan Municipal Plaza', now() + interval '30 days 18 hours', now() + interval '30 days 21 hours', calauan_org_id)
  on conflict (id) do update set festival_id = excluded.festival_id, title = excluded.title,
    description = excluded.description, venue = excluded.venue, start_time = excluded.start_time,
    end_time = excluded.end_time, organizer_id = excluded.organizer_id;

  -- ── seed: MSMEs (one per town + one unpaid applicant for the payment flow) ──

  insert into public.msmes (id, owner, business_name, logo, description, category, municipality, status, contact_number, address, business_type, registration_code, registration_fee, registration_date) values
    (1, bay_msme_id,       'Elena''s Delicacies',    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop', 'Authentic Bay pasalubong, kiping-inspired treats, and handcrafted local delicacies.',    'Food & Delicacies',    'bay',  'approved', '0917-111-2233', 'Brgy. San Antonio, Bay, Laguna',      'Food Stall',    'BAY-2026-001', 500, now() - interval '60 days'),
    (2, calauan_msme_id,   'Kultura Crafts',         'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&h=400&fit=crop', 'Handwoven textiles, woven bags, and banana-fiber souvenirs from Calauan.',                'Handicrafts & Souvenirs', 'calauan', 'approved', '0917-222-3344', 'Poblacion, Calauan, Laguna',          'Craft Booth',   'CAL-2026-014',  500, now() - interval '60 days'),
    (3, lbs_msme_id,       'Makiling Fruit & Coffee Co.', 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=600&h=400&fit=crop', 'Single-origin Mount Makiling coffee and the freshest pineapple produce.',                  'Coffee & Farm Produce', 'los-banos', 'approved', '0917-333-4455', 'Brgy. Malinta, Los Baños, Laguna',    'Farm Booth',   'LBS-2026-007', 500, now() - interval '55 days'),
    (4, pending_msme_id,   'Bagong Bayan Pasalubong', 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&h=400&fit=crop', 'New home-based pasalubong shop — application submitted, registration fee not yet paid.',                           'Food & Delicacies',    'bay',  'unpaid',   '0917-444-5566', 'Brgy. San Isidro, Bay, Laguna',       'Home-Based',   'BAY-2026-021', 500, now() - interval '3 days')
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
    (1, 'Festival T-Shirt',      0, 5, 1, 1, 1, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop', 'Official festival commemorative shirt. Visit all 5 festival days to claim it at participating MSME stalls.'),
    (2, 'Free Umbrella',         0, 3, 3, 2, 4, 'https://images.unsplash.com/photo-1519058082700-08a0b56da9b4?w=400&h=300&fit=crop', 'Beat the heat or the rain! Attend 3 festival days and redeem a free umbrella.'),
    (3, 'Pasalubong Basket',     0, 4, 2, 3, 6, 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=300&fit=crop', 'A basket of local treats from the harvest fair — yours after 4 days of attendance.'),
    (4, 'Handwoven Tote Bag',    0, 2, 3, 2, 3, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=300&fit=crop', 'Eco-friendly banana-fiber tote, redeemable after 2 festival days.'),
    (5, 'Souvenir Fridge Magnet', 0, 1, 1, 1, 2, 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=300&fit=crop', 'A small keepsake for your very first scanned festival day.')
  on conflict (id) do update set reward_name = excluded.reward_name, required_days = excluded.required_days,
    msme_id = excluded.msme_id, product_id = excluded.product_id, image = excluded.image,
    description = excluded.description, festival_id = excluded.festival_id;

  -- ── seed: registration payments (approved MSMEs) ─────────────────────────────

  insert into public.registration_payments (id, msme_id, amount, method, status, reference, receipt_no, created_at) values
    (1, 1, 500, 'e-wallet', 'paid', 'EWP-8821-3344', 'REC-BAY-2026-001', now() - interval '58 days'),
    (2, 2, 500, 'debit',    'paid', 'DBT-2271-9987', 'REC-CAL-2026-014', now() - interval '58 days'),
    (3, 3, 500, 'credit',   'paid', 'CRD-1290-5566', 'REC-LBS-2026-007', now() - interval '53 days'),
    (4, 4, 500, 'e-wallet', 'pending', 'EWP-7721-0100', null, now() - interval '1 day')
  on conflict (id) do update set msme_id = excluded.msme_id, amount = excluded.amount,
    method = excluded.method, status = excluded.status, reference = excluded.reference,
    receipt_no = excluded.receipt_no;

  -- ── seed: attendance QR codes (admin-generated, printed at entrances) ────────
  -- Pre-registered codes follow the canonical format FLGU-{Festival}-{Unique}.

  insert into public.attendance_qr (id, festival_id, venue_id, qr_code_string, label, municipality_id, is_active, expires_at, generated_by, created_at) values
    (1, 1, 1,  'FLGU-BAYENOS-ENTRANCE',  'Day 1 — Main Entrance',       'bay',       true, now() + interval '6 days',  admin_id, now() - interval '6 days'),
    (2, 1, 5,  'FLGU-BAYENOS-MAINSTAGE', 'Day 5 — Thanksgiving Plaza',  'bay',       true, now() + interval '6 days',  admin_id, now() - interval '6 days'),
    (3, 2, 6,  'FLGU-BANAMOS-TOWNGATE',  'Day 1 — Town Gate',           'los-banos', true, now() + interval '16 days', lbs_admin_id, now() - interval '6 days'),
    (4, 3, 14, 'FLGU-PINYA-ENTRANCE',    'Day 4 — Municipal Grounds',   'calauan',   true, now() + interval '30 days', calauan_admin_id, now() - interval '6 days'),
    (5, 2, 7,  'FLGU-BANAMOS-MARKET9',   'Day 2 — Public Market',       'los-banos', true, now() + interval '16 days', lbs_admin_id, now() - interval '5 days')
  on conflict (id) do update set festival_id = excluded.festival_id, venue_id = excluded.venue_id,
    qr_code_string = excluded.qr_code_string, label = excluded.label, municipality_id = excluded.municipality_id,
    is_active = excluded.is_active, expires_at = excluded.expires_at, generated_by = excluded.generated_by;

  -- clean up codes from pre-FLGU builds (e.g. ATT-…); only the canonical
  -- registered codes above (plus LGU-generated FLGU-… codes) may be scanned.
  delete from public.attendance_qr where qr_code_string not like 'FLGU-%';

  -- remove codes from interim builds that embedded the event id in the token
  -- (FLGU-{Festival}-{eventId}-{suffix}), which the scanner legitimately rejects.
  delete from public.attendance_qr where qr_code_string ~ '^FLGU-[^-]+-[0-9]+-';

  -- ── seed: attendance logs (demo scans over past days) ───────────────────────

  insert into public.attendance_logs (tourist_id, qr_id, venue_id, festival_id, scan_date, created_at) values
    (tourist1_id, 1, 1,  1, current_date - 1, now() - interval '1 day'),
    (tourist1_id, 2, 5,  1, current_date - 2, now() - interval '2 days'),
    (tourist2_id, 1, 1,  1, current_date - 1, now() - interval '1 day'),
    (tourist2_id, 3, 6, 2, current_date - 3, now() - interval '3 days'),
    (tourist3_id, 3, 6, 2, current_date - 2, now() - interval '2 days')
  on conflict (tourist_id, qr_id, scan_date) do nothing;

  -- ── seed: municipalities (public LGU contact details) ────────────────────────

  insert into public.municipalities (id, name, email, phone, address, hours, facebook) values
    ('bay',       'LGU Bay',        'tourism@bay.gov.ph',          '(049) 536-0001', 'Municipal Hall, Poblacion, Bay, Laguna',        'Mon–Fri 8:00 AM – 5:00 PM', 'fb.com/LGUBayLaguna'),
    ('los-banos', 'LGU Los Baños',  'tourism@losbanos.gov.ph',     '(049) 536-0002', 'Municipal Hall, Poblacion, Los Baños, Laguna', 'Mon–Sat 8:00 AM – 6:00 PM', 'fb.com/LGULosBanos'),
    ('calauan',   'LGU Calauan',    'tourism@calauan.gov.ph',      '(049) 536-0003', 'Municipal Hall, Poblacion, Calauan, Laguna',    'Mon–Fri 8:00 AM – 5:00 PM', 'fb.com/LGUCalauan')
  on conflict (id) do update set name = excluded.name, email = excluded.email,
    phone = excluded.phone, address = excluded.address, hours = excluded.hours,
    facebook = excluded.facebook;

  -- ── seed: interactive map venues (plaza, market, stages) ────────────────────

  insert into public.map_venues (festival_id, municipality, name, address, lat, lng, area, sort_order, capacity, qr_code_data) values
    (1, 'bay',       'Bay Municipal Plaza',       'Poblacion, Bay, Laguna',        14.1819, 121.2854, 'plaza',  0, 2500, 'FLGU-BAYENOS-ENTRANCE'),
    (1, 'bay',       'Bay Public Market',         'Brgy. San Antonio, Bay, Laguna', 14.1828, 121.2867, 'market', 1, 800,  'FLGU-BAYENOS-MAINSTAGE'),
    (1, 'bay',       'Bay Municipal Grounds',     'Brgy. Dila, Bay, Laguna',        14.1846, 121.2831, 'stage',  2, 3000, null),
    (2, 'los-banos', 'Los Baños Municipal Plaza', 'Poblacion, Los Baños, Laguna',   14.1784, 121.2221, 'plaza',  0, 2200, 'FLGU-BANAMOS-TOWNGATE'),
    (2, 'los-banos', 'Los Baños Public Market',   'Poblacion, Los Baños, Laguna',   14.1773, 121.2241, 'market', 1, 750,  'FLGU-BANAMOS-MARKET9'),
    (2, 'los-banos', 'Municipal Grounds (Stadium)','Poblacion, Los Baños, Laguna',  14.1787, 121.2188, 'stage',  2, 3500, null),
    (3, 'calauan',   'Calauan Municipal Plaza',   'Poblacion, Calauan, Laguna',     14.1446, 121.3164, 'plaza',  0, 2000, null),
    (3, 'calauan',   'Calauan Public Market',     'Poblacion, Calauan, Laguna',     14.1438, 121.3175, 'market', 1, 700,  null),
    (3, 'calauan',   'Calauan Municipal Grounds', 'Poblacion, Calauan, Laguna',     14.1462, 121.3145, 'stage',  2, 2800, 'FLGU-PINYA-ENTRANCE')
  on conflict (festival_id, name) do update set municipality = excluded.municipality,
    address = excluded.address, lat = excluded.lat, lng = excluded.lng,
    area = excluded.area, sort_order = excluded.sort_order,
    capacity = excluded.capacity, qr_code_data = excluded.qr_code_data;

  -- ── seed: contact messages (one inbound demo inquiry) ────────────────────────

  insert into public.contact_messages (municipality, name, email, subject, message, read, created_at) values
    ('bay', 'Jose Tan', 'jose@festivalglu.ph', 'Parking for the Grand Parade', 'Where can tourists park on the day of the Grand Bayeños Thanksgiving?', false, now() - interval '1 day')
  on conflict do nothing;

  -- ── seed: announcements (scoped to festivals) ────────────────────────────────

  insert into public.announcements (id, title, description, image, festival_id, link_view, created_by, created_at) values
    (1, 'Bayeños 2026 Registration Open', 'Vendors, performers, and tourists can now register for the Bayeños Festival.', null, 1, 'events', admin_id, now() - interval '2 days'),
    (2, 'Bañamos Trade Fair Venues Announced', 'Los Baños'' banana trade fair will open at the public market daily.', null, 2, 'msmes', lbs_admin_id, now() - interval '5 days'),
    (3, 'Call for Pinya Festival Performers', 'Cultural groups and dancers are invited to join the Grand Parade.', null, 3, 'events', calauan_admin_id, now() - interval '8 days'),
    (4, 'QR Attendance Stations Active', 'Scan the printed QR codes at every venue entrance — one scan per venue per day counts toward your stamp card.', null, 1, 'guide', bay_org_id, now() - interval '1 day')
  on conflict (id) do update set title = excluded.title, description = excluded.description,
    image = excluded.image, festival_id = excluded.festival_id, link_view = excluded.link_view,
    created_by = excluded.created_by;

  -- ── seed: feedback (both types, municipality-scoped) ─────────────────────────

  insert into public.feedback (id, tourist_id, rating, comment, suggestion, feedback_type, municipality, festival_id, msme_id, created_at) values
    (1, tourist1_id, 5, 'The Bayenos street parade was unforgettable!', 'More seating along the parade route.', 'festival', 'bay', 1, null, now() - interval '5 days'),
    (2, tourist2_id, 4, 'Loved the handwoven bags at this booth.', 'Richer color selection would be great.', 'msme',     'calauan', 2, 2, now() - interval '3 days'),
    (3, tourist3_id, 5, 'The QR attendance stamp card is brilliant — easy and fun!', null, 'festival', 'calauan', 3, null, now() - interval '1 day'),
    (4, tourist4_id, 4, 'The food village in Los Baños was amazing.', 'Open more stalls earlier in the day.', 'festival', 'los-banos', 2, null, now() - interval '2 days')
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
  update public.msmes set status = coalesce(status, 'unpaid') where status is null;
  update public.msmes set status = 'approved' where status = 'registered';
  update public.products set approved = coalesce(approved, false) where approved is null;
end $$;

-- ── cleanup: removed partner-LGU demo accounts ─────────────────────────────
-- Earlier builds seeded sample towns beyond the 3 canonical ones (Santa Cruz,
-- San Pablo). If this script ever ran against that schema, those accounts are
-- removed now. Cascade FKs clean up their msmes/products/payments.
delete from auth.users
  where email in ('santacruz.admin@festivalglu.ph','sanpablo.admin@festivalglu.ph',
                  'santacruz.organizer@festivalglu.ph','sanpablo.organizer@festivalglu.ph',
                  'msme5@festivalglu.ph','kiko@festivalglu.ph');

-- ═════════════════════════════════════════════════════════════════════════════
-- Included from supabase-update-2026-10.sql (keep the two in sync).
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- FestivaLGU — October 2026 update (adviser revisions)
--
--   • Detailed MSME sign-up (personal info · business info · account)
--   • Business requirements (DTI/SEC/CDA, TIN, permits, uploaded documents)
--   • LGU default registration fees by business size (auto-applied)
--   • Proof-of-payment upload → LGU verification → approval
--   • MSME Point of Sale (cash / e-wallet) with live stock deduction
--   • Receipt QR → tourist collects purchase points (+ bonus for feedback)
--   • Points-based reward redemption
--
-- HOW TO APPLY (existing database — keeps all current data):
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   It is idempotent (safe to re-run) and does NOT reseed or reset anything.
--   `supabase-schema.sql` also includes this file's contents at the end, so a
--   fresh install only needs that one file.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── id sequences ─────────────────────────────────────────────────────────────
-- The seed inserts rows with explicit ids, which leaves each serial sequence
-- behind — the next app insert then collides ("duplicate key msmes_pkey").
-- Point every sequence past the current max id. Runs again at the end so the
-- new tables are covered too.
create or replace function public.sync_id_sequences()
returns void language plpgsql as $$
declare
  t text;
  seq text;
begin
  for t in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
           where n.nspname = 'public' and c.relkind = 'r' loop
    seq := pg_get_serial_sequence(format('public.%I', t), 'id');
    if seq is not null then
      execute format('select setval(%L, coalesce((select max(id) from public.%I), 0) + 1, false)', seq, t);
    end if;
  end loop;
end;
$$;
select public.sync_id_sequences();

-- ── helpers ──────────────────────────────────────────────────────────────────

-- True when the signed-in user is the LGU admin of the given municipality.
create or replace function public.is_town_admin(target_municipality text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
      and (p.municipality = target_municipality or p.municipality_access @> array[target_municipality])
  );
$$;

-- ── msmes: owner personal info, business info, requirements ─────────────────

alter table public.msmes add column if not exists owner_name text;
alter table public.msmes add column if not exists owner_birthdate date;
alter table public.msmes add column if not exists owner_sex text;
alter table public.msmes add column if not exists owner_contact text;
alter table public.msmes add column if not exists owner_email text;
alter table public.msmes add column if not exists owner_address text;
alter table public.msmes add column if not exists owner_city text;
alter table public.msmes add column if not exists owner_province text;
alter table public.msmes add column if not exists years_in_operation int;
alter table public.msmes add column if not exists employee_count int;
alter table public.msmes add column if not exists business_size text;
alter table public.msmes add column if not exists business_reg_no text;
alter table public.msmes add column if not exists dti_sec_cda_no text;
alter table public.msmes add column if not exists tin text;
alter table public.msmes add column if not exists capitalization numeric;
alter table public.msmes add column if not exists requirements_submitted_at timestamptz;
alter table public.msmes add column if not exists rejection_reason text;

alter table public.msmes drop constraint if exists msmes_business_size_check;
update public.msmes set business_size = lower(business_size) where business_size is not null;
update public.msmes set business_size = null where business_size not in ('micro','small','medium','large');
alter table public.msmes
  add constraint msmes_business_size_check
  check (business_size is null or business_size in ('micro','small','medium','large'));

-- Uploaded requirement documents (image or PDF, stored as data URLs).
-- Kept out of `msmes` so list queries stay small.
create table if not exists public.msme_documents (
  id serial primary key,
  msme_id int not null references public.msmes (id) on delete cascade,
  doc_type text not null check (doc_type in (
    'valid_id','proof_of_ownership','business_permit',
    'fire_safety','sanitary_permit','occupancy_permit','environmental_clearance')),
  file_name text,
  file_data text not null,
  uploaded_at timestamptz not null default now(),
  unique (msme_id, doc_type)
);

alter table public.msme_documents enable row level security;
drop policy if exists "msme_documents read" on public.msme_documents;
create policy "msme_documents read" on public.msme_documents for select using (
  exists (select 1 from public.msmes m where m.id = msme_documents.msme_id
          and (m.owner = auth.uid() or public.can_manage_municipality(m.municipality)))
);
drop policy if exists "msme_documents owner write" on public.msme_documents;
create policy "msme_documents owner write" on public.msme_documents for all
  using (exists (select 1 from public.msmes m where m.id = msme_documents.msme_id and m.owner = auth.uid()))
  with check (exists (select 1 from public.msmes m where m.id = msme_documents.msme_id and m.owner = auth.uid()));

-- ── LGU default registration fees (per municipality × business size) ─────────

create table if not exists public.registration_fee_rates (
  municipality text not null,
  business_size text not null check (business_size in ('micro','small','medium','large')),
  amount numeric not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (municipality, business_size)
);

insert into public.registration_fee_rates (municipality, business_size, amount)
select t.m, s.size, s.amount
from (values ('bay'), ('calauan'), ('los-banos')) as t(m)
cross join (values ('micro', 500), ('small', 700), ('medium', 1000), ('large', 1500)) as s(size, amount)
on conflict (municipality, business_size) do nothing;

alter table public.registration_fee_rates enable row level security;
drop policy if exists "public read registration_fee_rates" on public.registration_fee_rates;
create policy "public read registration_fee_rates" on public.registration_fee_rates for select using (true);
drop policy if exists "admin write registration_fee_rates" on public.registration_fee_rates;
create policy "admin write registration_fee_rates" on public.registration_fee_rates for all
  using (public.is_town_admin(municipality)) with check (public.is_town_admin(municipality));

-- ── registration payments: proof of payment + LGU verification ───────────────

alter table public.registration_payments add column if not exists proof_file text;
alter table public.registration_payments add column if not exists proof_file_name text;
alter table public.registration_payments add column if not exists submitted_at timestamptz;
alter table public.registration_payments add column if not exists verified_by uuid references public.profiles (id) on delete set null;
alter table public.registration_payments add column if not exists verified_at timestamptz;
alter table public.registration_payments add column if not exists review_note text;

-- statuses: unpaid → submitted (proof uploaded) → paid (LGU verified) | rejected
update public.registration_payments set status = 'submitted' where status = 'pending';

alter table public.registration_payments drop constraint if exists registration_payments_method_check;
alter table public.registration_payments
  add constraint registration_payments_method_check
  check (method is null or method in ('e-wallet','debit','credit','GCash','Maya / PayMaya','Bank Transfer','Over-the-Counter','Bank Deposit','Cash'));

-- ── guards: owners can't self-approve, change their fee, or mark fees paid ───

create or replace function public.msmes_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean;
  v_locked boolean := false;
  v_size_changed boolean := true;
  v_rate numeric;
begin
  if tg_op = 'INSERT' then
    v_staff := auth.uid() is null or public.can_manage_municipality(new.municipality);
    if not v_staff then
      new.status := 'unpaid';
      new.rejection_reason := null;
    end if;
  else
    v_size_changed := new.business_size is distinct from old.business_size
                      or new.municipality is distinct from old.municipality;
    v_staff := auth.uid() is null or public.can_manage_municipality(old.municipality);
    if not v_staff then
      if new.status = 'approved' and old.status is distinct from 'approved' then
        raise exception 'Only the LGU can approve a business registration.';
      end if;
      new.registration_fee := old.registration_fee;   -- fees come from LGU rates only
      new.rejection_reason := old.rejection_reason;
    end if;
    select exists (
      select 1 from public.registration_payments p
      where p.msme_id = new.id and p.status in ('submitted','paid')
    ) into v_locked;
  end if;

  -- Auto-apply the LGU's default fee for the chosen business size (until a
  -- payment has been submitted — then the amount is locked in).
  if not v_locked and v_size_changed and new.business_size is not null and new.municipality is not null then
    select amount into v_rate from public.registration_fee_rates
      where municipality = new.municipality and business_size = new.business_size;
    if v_rate is not null then new.registration_fee := v_rate; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists msmes_before_write on public.msmes;
create trigger msmes_before_write before insert or update on public.msmes
  for each row execute function public.msmes_before_write();

create or replace function public.registration_payments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fee numeric;
begin
  if auth.uid() is null or exists (
    select 1 from public.msmes m
    where m.id = new.msme_id and public.can_manage_municipality(m.municipality)
  ) then
    return new;
  end if;
  if not exists (select 1 from public.msmes m where m.id = new.msme_id and m.owner = auth.uid()) then
    raise exception 'You can only submit payments for your own business.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then
    raise exception 'This payment was already verified by the LGU.';
  end if;
  if new.status not in ('unpaid','submitted') then
    raise exception 'Payments are verified by the LGU — upload your proof of payment instead.';
  end if;
  select registration_fee into v_fee from public.msmes where id = new.msme_id;
  new.amount := coalesce(v_fee, 0);
  new.verified_by := null;
  new.verified_at := null;
  new.paid_at := null;
  if tg_op = 'UPDATE' then
    new.receipt_no := old.receipt_no;
    new.review_note := old.review_note;
  else
    new.receipt_no := null;
    new.review_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists registration_payments_guard on public.registration_payments;
create trigger registration_payments_guard before insert or update on public.registration_payments
  for each row execute function public.registration_payments_guard();

-- When the LGU changes a rate, every application that hasn't paid yet follows it.
create or replace function public.registration_fee_rates_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.msmes m set registration_fee = new.amount
  where m.municipality = new.municipality
    and m.business_size = new.business_size
    and m.status <> 'approved'
    and not exists (select 1 from public.registration_payments p
                    where p.msme_id = m.id and p.status in ('submitted','paid'));
  return new;
end;
$$;

drop trigger if exists registration_fee_rates_apply on public.registration_fee_rates;
create trigger registration_fee_rates_apply after insert or update on public.registration_fee_rates
  for each row execute function public.registration_fee_rates_apply();

-- LGU admin reviews an application in one atomic step.
--   approve         → payment verified (paid + official receipt) and business approved
--   reject_payment  → proof rejected; the owner re-uploads a valid proof
--   reject          → application rejected (with reason)
create or replace function public.lgu_review_registration(p_msme_id int, p_action text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  m public.msmes;
  p public.registration_payments;
  v_receipt text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into m from public.msmes where id = p_msme_id for update;
  if m.id is null then raise exception 'Business not found.'; end if;
  if not public.is_town_admin(m.municipality) then
    raise exception 'Only this municipality''s LGU admin can review this business.';
  end if;
  select * into p from public.registration_payments where msme_id = m.id order by id desc limit 1 for update;

  if p_action = 'approve' then
    if p.id is null or not (p.status = 'paid' or (p.status = 'submitted' and p.proof_file is not null)) then
      raise exception 'Cannot approve yet — the business has not uploaded a proof of payment.';
    end if;
    v_receipt := coalesce(p.receipt_no,
      'OR-' || upper(left(replace(coalesce(m.municipality, 'LGU'), '-', ''), 3)) || '-'
      || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' || lpad(p.id::text, 5, '0'));
    update public.registration_payments
      set status = 'paid', verified_by = auth.uid(), verified_at = now(),
          paid_at = coalesce(paid_at, now()), receipt_no = v_receipt, review_note = null
      where id = p.id;
    update public.msmes
      set status = 'approved', rejection_reason = null, registration_date = coalesce(registration_date, now())
      where id = m.id;
  elsif p_action = 'reject_payment' then
    if p.id is null then raise exception 'There is no payment to reject.'; end if;
    if p.status = 'paid' then raise exception 'This payment was already verified.'; end if;
    update public.registration_payments set status = 'rejected', review_note = v_note where id = p.id;
    update public.msmes set status = 'unpaid', rejection_reason = v_note
      where id = m.id and status <> 'approved';
  elsif p_action = 'reject' then
    update public.msmes set status = 'rejected', rejection_reason = v_note where id = m.id;
  else
    raise exception 'Unknown review action: %', p_action;
  end if;

  return json_build_object('ok', true, 'receipt_no', v_receipt);
end;
$$;

-- ── Point of Sale ─────────────────────────────────────────────────────────────

create table if not exists public.sales (
  id bigserial primary key,
  msme_id int not null references public.msmes (id) on delete cascade,
  municipality text,
  festival_id int references public.festivals (id) on delete set null,
  receipt_no text not null unique,
  claim_code text not null unique,
  total numeric not null check (total >= 0),
  item_count int not null default 0,
  payment_method text not null check (payment_method in ('cash','e-wallet')),
  ewallet_provider text,
  ewallet_ref text,
  amount_tendered numeric,
  change_due numeric not null default 0,
  points_earned int not null default 0,
  bonus_points int not null default 0,
  customer_id uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  feedback_id int references public.feedback (id) on delete set null,
  cashier_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sales_msme_created_idx on public.sales (msme_id, created_at desc);
create index if not exists sales_municipality_created_idx on public.sales (municipality, created_at desc);
create index if not exists sales_customer_idx on public.sales (customer_id);

create table if not exists public.sale_items (
  id bigserial primary key,
  sale_id bigint not null references public.sales (id) on delete cascade,
  product_id int references public.products (id) on delete set null,
  product_name text not null,
  unit_price numeric not null,
  quantity int not null check (quantity > 0),
  line_total numeric not null
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

-- Sales are written only through pos_create_sale (no insert/update policies).
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
drop policy if exists "sales read" on public.sales;
create policy "sales read" on public.sales for select using (
  customer_id = auth.uid()
  or exists (select 1 from public.msmes m where m.id = sales.msme_id and m.owner = auth.uid())
  or public.can_manage_municipality(sales.municipality)
);
drop policy if exists "sale_items read" on public.sale_items;
create policy "sale_items read" on public.sale_items for select using (
  exists (select 1 from public.sales s where s.id = sale_items.sale_id)
);

-- Points rules: 1 point per ₱10 spent, +10 bonus for leaving feedback.
create or replace function public.purchase_points(p_total numeric)
returns int language sql immutable as $$ select floor(coalesce(p_total, 0) / 10)::int; $$;

create or replace function public.random_code(p_len int)
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
begin
  for i in 1..p_len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- Records a sale atomically: validates the cart, locks and deducts stock, and
-- issues a receipt number plus the claim code printed as the receipt QR.
-- p_items: [{"product_id": 1, "quantity": 2}, ...]
create or replace function public.pos_create_sale(
  p_msme_id int,
  p_items jsonb,
  p_method text,
  p_tendered numeric default null,
  p_ewallet_provider text default null,
  p_ewallet_ref text default null
)
returns public.sales language plpgsql security definer set search_path = public as $$
declare
  m public.msmes;
  r record;
  prod public.products;
  v_total numeric := 0;
  v_count int := 0;
  v_change numeric := 0;
  v_fest int;
  s public.sales;
  v_try int := 0;
begin
  select * into m from public.msmes where id = p_msme_id;
  if m.id is null then raise exception 'Business not found.'; end if;
  if m.owner is distinct from auth.uid() then raise exception 'Only the business owner can record sales.'; end if;
  if m.status <> 'approved' then raise exception 'Your business must be approved by the LGU before you can record sales.'; end if;
  if p_method not in ('cash','e-wallet') then raise exception 'Payment method must be Cash or E-Wallet.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty.';
  end if;

  -- validate every line and lock the product rows (ordered to avoid deadlocks)
  for r in
    select (e->>'product_id')::int as pid, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.pid is null or r.qty is null or r.qty <= 0 then raise exception 'Invalid cart item.'; end if;
    select * into prod from public.products where id = r.pid and msme_id = p_msme_id for update;
    if prod.id is null then raise exception 'A product in the cart no longer exists.'; end if;
    if prod.stock < r.qty then
      raise exception 'Not enough stock for "%" — only % left.', prod.product_name, prod.stock;
    end if;
    v_total := v_total + prod.price * r.qty;
    v_count := v_count + r.qty;
  end loop;

  if p_method = 'cash' then
    if p_tendered is null or p_tendered < v_total then
      raise exception 'Cash received (₱%) is less than the total (₱%).', coalesce(p_tendered, 0), v_total;
    end if;
    v_change := p_tendered - v_total;
  else
    if nullif(trim(coalesce(p_ewallet_ref, '')), '') is null then
      raise exception 'Enter the e-wallet reference number.';
    end if;
  end if;

  select id into v_fest from public.festivals where municipality = m.municipality order by id limit 1;

  loop
    begin
      insert into public.sales (msme_id, municipality, festival_id, receipt_no, claim_code, total, item_count,
                                payment_method, ewallet_provider, ewallet_ref, amount_tendered, change_due,
                                points_earned, cashier_id)
      values (m.id, m.municipality, v_fest,
              'SI-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDD') || '-' || public.random_code(6),
              public.random_code(10), v_total, v_count,
              p_method,
              case when p_method = 'e-wallet' then nullif(trim(coalesce(p_ewallet_provider, '')), '') end,
              case when p_method = 'e-wallet' then trim(p_ewallet_ref) end,
              case when p_method = 'cash' then p_tendered else v_total end,
              v_change, public.purchase_points(v_total), auth.uid())
      returning * into s;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;

  for r in
    select (e->>'product_id')::int as pid, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select * into prod from public.products where id = r.pid;
    insert into public.sale_items (sale_id, product_id, product_name, unit_price, quantity, line_total)
      values (s.id, prod.id, prod.product_name, prod.price, r.qty, prod.price * r.qty);
    update public.products set stock = stock - r.qty where id = prod.id;
  end loop;

  return s;
end;
$$;

-- Public receipt lookup for the claim page (works before signing in).
create or replace function public.sale_receipt_lookup(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  s public.sales;
  v_name text;
begin
  select * into s from public.sales where claim_code = upper(trim(p_code));
  if s.id is null then return null; end if;
  select business_name into v_name from public.msmes where id = s.msme_id;
  return json_build_object(
    'receipt_no', s.receipt_no,
    'business_name', v_name,
    'municipality', s.municipality,
    'created_at', s.created_at,
    'total', s.total,
    'payment_method', s.payment_method,
    'points_earned', s.points_earned,
    'bonus_points', s.bonus_points,
    'claimed', s.customer_id is not null,
    'claimed_by_me', s.customer_id is not null and s.customer_id = auth.uid(),
    'feedback_given', s.feedback_id is not null,
    'items', coalesce((select json_agg(json_build_object('name', i.product_name, 'quantity', i.quantity, 'line_total', i.line_total) order by i.id)
                       from public.sale_items i where i.sale_id = s.id), '[]'::json)
  );
end;
$$;

-- Internal: attach a sale to a tourist and credit its points (idempotent).
create or replace function public.credit_sale_to_tourist(p_sale public.sales, p_uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if p_sale.customer_id is not null then
    if p_sale.customer_id <> p_uid then
      raise exception 'These points were already collected by another account.';
    end if;
    return false;
  end if;
  select business_name into v_name from public.msmes where id = p_sale.msme_id;
  update public.sales set customer_id = p_uid, claimed_at = now() where id = p_sale.id;
  insert into public.tourist_points (tourist_id, points) values (p_uid, p_sale.points_earned)
    on conflict (tourist_id) do update set points = public.tourist_points.points + excluded.points;
  insert into public.transactions (tourist_id, msme_id, points, transaction_type, reference_no, description, amount, status, municipality, festival_id)
    values (p_uid, p_sale.msme_id, p_sale.points_earned, 'purchase_points', p_sale.receipt_no,
            'Purchase at ' || coalesce(v_name, 'MSME'), p_sale.total, 'completed', p_sale.municipality, p_sale.festival_id);
  return true;
end;
$$;

create or replace function public.require_tourist()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in with your tourist account first.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'tourist') then
    raise exception 'Only tourist accounts can collect purchase points.';
  end if;
  return v_uid;
end;
$$;

create or replace function public.claim_sale_points(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_tourist();
  s public.sales;
  v_new boolean;
  v_balance int;
begin
  select * into s from public.sales where claim_code = upper(trim(p_code)) for update;
  if s.id is null then raise exception 'Receipt not found. Check the code and try again.'; end if;
  v_new := public.credit_sale_to_tourist(s, v_uid);
  select points into v_balance from public.tourist_points where tourist_id = v_uid;
  return json_build_object('newly_claimed', v_new, 'points', s.points_earned, 'balance', coalesce(v_balance, 0));
end;
$$;

create or replace function public.submit_sale_feedback(p_code text, p_rating int, p_comment text, p_suggestion text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_tourist();
  s public.sales;
  v_fid int;
  v_bonus constant int := 10;
  v_balance int;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be from 1 to 5.'; end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then raise exception 'Please write a short comment.'; end if;
  select * into s from public.sales where claim_code = upper(trim(p_code)) for update;
  if s.id is null then raise exception 'Receipt not found.'; end if;
  perform public.credit_sale_to_tourist(s, v_uid);
  if s.feedback_id is not null then raise exception 'Feedback was already submitted for this receipt.'; end if;

  insert into public.feedback (tourist_id, rating, comment, suggestion, feedback_type, municipality, festival_id, msme_id)
    values (v_uid, p_rating, trim(p_comment), nullif(trim(coalesce(p_suggestion, '')), ''), 'msme', s.municipality, s.festival_id, s.msme_id)
    returning id into v_fid;
  update public.sales set feedback_id = v_fid, bonus_points = v_bonus where id = s.id;
  insert into public.tourist_points (tourist_id, points) values (v_uid, v_bonus)
    on conflict (tourist_id) do update set points = public.tourist_points.points + excluded.points;
  insert into public.transactions (tourist_id, msme_id, points, transaction_type, reference_no, description, amount, status, municipality, festival_id)
    values (v_uid, s.msme_id, v_bonus, 'feedback_bonus', s.receipt_no, 'Feedback bonus', 0, 'completed', s.municipality, s.festival_id);
  select points into v_balance from public.tourist_points where tourist_id = v_uid;
  return json_build_object('bonus', v_bonus, 'balance', coalesce(v_balance, 0));
end;
$$;

-- Redeem a reward by spending purchase points (rewards with required_points > 0).
create or replace function public.redeem_reward_with_points(p_reward_id int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_tourist();
  rw public.rewards;
  v_balance int;
  v_muni text;
begin
  select * into rw from public.rewards where id = p_reward_id;
  if rw.id is null then raise exception 'Reward not found.'; end if;
  if coalesce(rw.required_points, 0) <= 0 then raise exception 'This reward is unlocked by attendance days, not points.'; end if;
  if exists (select 1 from public.redeemed_rewards where tourist_id = v_uid and reward_id = rw.id) then
    raise exception 'You already redeemed this reward.';
  end if;
  select points into v_balance from public.tourist_points where tourist_id = v_uid for update;
  if coalesce(v_balance, 0) < rw.required_points then
    raise exception 'Not enough points — you need % more.', rw.required_points - coalesce(v_balance, 0);
  end if;
  select municipality into v_muni from public.festivals where id = rw.festival_id;
  update public.tourist_points set points = points - rw.required_points where tourist_id = v_uid;
  insert into public.redeemed_rewards (tourist_id, reward_id, msme_id, product_id, redeemed_date)
    values (v_uid, rw.id, rw.msme_id, rw.product_id, now());
  insert into public.transactions (tourist_id, msme_id, points, transaction_type, reference_no, description, amount, status, municipality, festival_id)
    values (v_uid, rw.msme_id, -rw.required_points, 'points_redemption', 'RW-' || rw.id, 'Redeemed: ' || rw.reward_name, 0, 'completed', v_muni, rw.festival_id);
  return json_build_object('balance', coalesce(v_balance, 0) - rw.required_points);
end;
$$;

grant execute on function public.sale_receipt_lookup(text) to anon, authenticated;
revoke execute on function public.credit_sale_to_tourist(public.sales, uuid) from public, anon, authenticated;

-- Live admin dashboards: stream new sales.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;

-- ── sign-up: create the MSME application from the registration form ──────────
-- The MSME register form sends personal + business info in user metadata, so the
-- business row exists immediately (even when email confirmation is required).

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := coalesce(md ->> 'role', 'tourist');
  v_size text := lower(nullif(md ->> 'business_size', ''));
begin
  insert into public.profiles (id, email, fullname, role, municipality, birthdate)
  values (
    new.id,
    new.email,
    coalesce(md ->> 'fullname', split_part(new.email, '@', 1)),
    v_role,
    md ->> 'municipality',
    case when (md ->> 'birthdate') ~ '^\d{4}-\d{2}-\d{2}$' then (md ->> 'birthdate')::date end
  )
  on conflict (id) do nothing;

  if v_role = 'msme' and nullif(trim(coalesce(md ->> 'business_name', '')), '') is not null then
    begin
      insert into public.msmes (
        owner, business_name, municipality, status,
        owner_name, owner_birthdate, owner_sex, owner_contact, owner_email,
        owner_address, owner_city, owner_province,
        business_type, category, address, contact_number,
        years_in_operation, employee_count, business_size, business_reg_no,
        registration_code)
      values (
        new.id, trim(md ->> 'business_name'), md ->> 'municipality', 'unpaid',
        md ->> 'fullname',
        case when (md ->> 'birthdate') ~ '^\d{4}-\d{2}-\d{2}$' then (md ->> 'birthdate')::date end,
        nullif(md ->> 'sex', ''), nullif(md ->> 'contact_number', ''), coalesce(nullif(md ->> 'personal_email', ''), new.email),
        nullif(md ->> 'residential_address', ''), nullif(md ->> 'city', ''), nullif(md ->> 'province', ''),
        nullif(md ->> 'business_type', ''), nullif(md ->> 'category', ''), nullif(md ->> 'business_address', ''),
        nullif(md ->> 'contact_number', ''),
        case when (md ->> 'years_in_operation') ~ '^\d+$' then (md ->> 'years_in_operation')::int end,
        case when (md ->> 'employee_count') ~ '^\d+$' then (md ->> 'employee_count')::int end,
        case when v_size in ('micro','small','medium','large') then v_size end,
        nullif(md ->> 'business_reg_no', ''),
        'MB-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 10))
      );
    exception when others then
      -- never block account creation; the owner can still register from Business Profile
      raise warning 'MSME application for % not created: %', new.email, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

select public.sync_id_sequences();

notify pgrst, 'reload schema';
