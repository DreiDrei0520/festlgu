-- ═════════════════════════════════════════════════════════════════════════════
-- FestivaLGU — Supabase schema, RLS, and seed data
--
-- HOW TO USE:
--   1. Create a project at https://supabase.com
--   2. Auth → Providers → Email → turn ON "Confirm email" (optional)
--   3. Auth → Settings → enable "Custom SMTP" and enter your Gmail SMTP
--      (host smtp.gmail.com, port 587, username + App Password) if you want
--      emails delivered via Gmail. Also make sure the password-reset email
--      template (Auth → Emails) includes the {{ .Token }} 6-digit code.
--   4. Open the SQL Editor and paste / run this whole file ONCE.
--   5. Copy your Project URL + anon key into the app's .env file.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── demo users (auth) ─────────────────────────────────────────────────────────
-- Fixed UUIDs so seed data below can reference owners / tourists.
DO $$
DECLARE
  admin_id     uuid := '11111111-1111-1111-1111-111111111111';
  org_id       uuid := '22222222-2222-2222-2222-222222222222';
  msme1_id     uuid := '33333333-3333-3333-3333-333333333333';
  msme2_id     uuid := '44444444-4444-4444-4444-444444444444';
  msme3_id     uuid := '55555555-5555-5555-5555-555555555555';
  tourist1_id  uuid := '66666666-6666-6666-6666-666666666666';
  tourist2_id  uuid := '77777777-7777-7777-7777-777777777777';
  tourist3_id  uuid := '88888888-8888-8888-8888-888888888888';
  tourist4_id  uuid := '99999999-9999-9999-9999-999999999999';
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', admin_id,    'authenticated', 'authenticated', 'admin@festivalglu.ph',     crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Admin Rivera","role":"admin"}',     now(), now()),
    ('00000000-0000-0000-0000-000000000000', org_id,      'authenticated', 'authenticated', 'organizer@festivalglu.ph',  crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Carlos Mendoza","role":"organizer"}',now(), now()),
    ('00000000-0000-0000-0000-000000000000', msme1_id,    'authenticated', 'authenticated', 'msme@festivalglu.ph',       crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Elena Cruz","role":"msme"}',       now(), now()),
    ('00000000-0000-0000-0000-000000000000', msme2_id,    'authenticated', 'authenticated', 'msme2@festivalglu.ph',      crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Rico Dalisay","role":"msme"}',     now(), now()),
    ('00000000-0000-0000-0000-000000000000', msme3_id,    'authenticated', 'authenticated', 'msme3@festivalglu.ph',      crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Diana Lopez","role":"msme"}',      now(), now()),
    ('00000000-0000-0000-0000-000000000000', tourist1_id, 'authenticated', 'authenticated', 'tourist@festivalglu.ph',    crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Maria Santos","role":"tourist"}',  now(), now()),
    ('00000000-0000-0000-0000-000000000000', tourist2_id, 'authenticated', 'authenticated', 'ana@festivalglu.ph',        crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Ana Reyes","role":"tourist"}',     now(), now()),
    ('00000000-0000-0000-0000-000000000000', tourist3_id, 'authenticated', 'authenticated', 'jose@festivalglu.ph',       crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Jose Tan","role":"tourist"}',      now(), now()),
    ('00000000-0000-0000-0000-000000000000', tourist4_id, 'authenticated', 'authenticated', 'lina@festivalglu.ph',       crypt('Festival@2025', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"fullname":"Lina Bautista","role":"tourist"}', now(), now());

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES
    (admin_id,    admin_id,    admin_id,    jsonb_build_object('sub', admin_id,    'email', 'admin@festivalglu.ph'),    'email', now(), now(), now()),
    (org_id,      org_id,      org_id,      jsonb_build_object('sub', org_id,      'email', 'organizer@festivalglu.ph'), 'email', now(), now(), now()),
    (msme1_id,    msme1_id,    msme1_id,    jsonb_build_object('sub', msme1_id,    'email', 'msme@festivalglu.ph'),      'email', now(), now(), now()),
    (msme2_id,    msme2_id,    msme2_id,    jsonb_build_object('sub', msme2_id,    'email', 'msme2@festivalglu.ph'),     'email', now(), now(), now()),
    (msme3_id,    msme3_id,    msme3_id,    jsonb_build_object('sub', msme3_id,    'email', 'msme3@festivalglu.ph'),     'email', now(), now(), now()),
    (tourist1_id, tourist1_id, tourist1_id, jsonb_build_object('sub', tourist1_id,'email', 'tourist@festivalglu.ph'),   'email', now(), now(), now()),
    (tourist2_id, tourist2_id, tourist2_id, jsonb_build_object('sub', tourist2_id,'email', 'ana@festivalglu.ph'),       'email', now(), now(), now()),
    (tourist3_id, tourist3_id, tourist3_id, jsonb_build_object('sub', tourist3_id,'email', 'jose@festivalglu.ph'),      'email', now(), now(), now()),
    (tourist4_id, tourist4_id, tourist4_id, jsonb_build_object('sub', tourist4_id,'email', 'lina@festivalglu.ph'),      'email', now(), now(), now());
END $$;

-- ── tables ────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  fullname text not null default '',
  email text not null default '',
  role text not null default 'tourist' check (role in ('admin','organizer','msme','tourist')),
  profile_photo text,
  birthdate date,
  created_at timestamptz not null default now()
);

create table if not exists public.tourist_points (
  tourist_id uuid primary key references public.profiles (id) on delete cascade,
  points int not null default 0
);

create table if not exists public.festivals (
  id serial primary key,
  title text not null,
  description text,
  banner text,
  location text,
  start_date date,
  end_date date
);

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
  category text
);

create table if not exists public.products (
  id serial primary key,
  msme_id int references public.msmes (id) on delete cascade,
  product_name text not null,
  image text,
  description text,
  price numeric not null default 0,
  stock int not null default 0
);

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
  image text,
  description text
);

create table if not exists public.redeemed_rewards (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  reward_id int references public.rewards (id) on delete cascade,
  redeemed_date timestamptz not null default now()
);

create table if not exists public.feedback (
  id serial primary key,
  tourist_id uuid references public.profiles (id) on delete cascade,
  rating int not null default 5,
  comment text not null default '',
  suggestion text,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id serial primary key,
  title text not null,
  description text not null default '',
  image text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_events (
  tourist_id uuid not null references public.profiles (id) on delete cascade,
  event_id int not null references public.events (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (tourist_id, event_id)
);

-- ── row level security ────────────────────────────────────────────────────────
-- Public content: anyone can read. Writes require an authenticated user.
-- User data: any authenticated user may read; writes also require auth.
-- (Fine-grained "owner-only" rules can be added later — this keeps the demo app
--  fully usable out of the box, including the admin dashboards.)

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

-- ── seed data (dates relative to today so events stay "upcoming") ─────────────

insert into public.profiles (id, fullname, email, role, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'Admin Rivera',     'admin@festivalglu.ph',    'admin',     now() - interval '90 days'),
  ('22222222-2222-2222-2222-222222222222', 'Carlos Mendoza',   'organizer@festivalglu.ph', 'organizer', now() - interval '90 days'),
  ('33333333-3333-3333-3333-333333333333', 'Elena Cruz',       'msme@festivalglu.ph',      'msme',      now() - interval '90 days'),
  ('44444444-4444-4444-4444-444444444444', 'Rico Dalisay',     'msme2@festivalglu.ph',     'msme',      now() - interval '90 days'),
  ('55555555-5555-5555-5555-555555555555', 'Diana Lopez',      'msme3@festivalglu.ph',     'msme',      now() - interval '90 days'),
  ('66666666-6666-6666-6666-666666666666', 'Maria Santos',     'tourist@festivalglu.ph',   'tourist',   now() - interval '90 days'),
  ('77777777-7777-7777-7777-777777777777', 'Ana Reyes',        'ana@festivalglu.ph',       'tourist',   now() - interval '90 days'),
  ('88888888-8888-8888-8888-888888888888', 'Jose Tan',         'jose@festivalglu.ph',      'tourist',   now() - interval '90 days'),
  ('99999999-9999-9999-9999-999999999999', 'Lina Bautista',    'lina@festivalglu.ph',      'tourist',   now() - interval '90 days')
on conflict (id) do nothing;

insert into public.festivals (id, title, description, banner, location, start_date, end_date) values
  (1, 'Kadayawan Festival', 'A week-long thanksgiving celebration of life, nature, and the bountiful harvests of Davao City — featuring street dancing, floral floats, and tribal rituals.', 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=600&fit=crop', 'Davao City', (current_date + interval '4 days')::date, (current_date + interval '8 days')::date),
  (2, 'Oro, Meta, Mano Festival', 'Cagayan de Oro''s grand festival celebrating the city''s culture and heritage with colorful street parades and exciting competitions.', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=600&fit=crop', 'Cagayan de Oro', (current_date + interval '18 days')::date, (current_date + interval '20 days')::date),
  (3, 'MassKara Festival', 'Bacolod''s famed festival of smiles — dazzling masked dancers, vibrant costumes, and street parties that light up the city of smiles.', 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200&h=600&fit=crop', 'Bacolod City', (current_date + interval '62 days')::date, (current_date + interval '70 days')::date),
  (4, 'Giant Lantern Festival', 'The dazzling ''parol'' capital of the Philippines shines with giant, handcrafted lanterns in the spectacular Christmas festival of San Fernando.', 'https://images.unsplash.com/photo-1482517967863-00e15c9b44be?w=1200&h=600&fit=crop', 'San Fernando, Pampanga', (current_date + interval '130 days')::date, (current_date + interval '131 days')::date),
  (5, 'Pahiyas Festival', 'Lucban''s vibrant thanksgiving celebration where homes are decorated with colorful kiping and fresh harvest in honor of San Isidro Labrador.', 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&h=600&fit=crop', 'Lucban, Quezon', (current_date - interval '87 days')::date, (current_date - interval '85 days')::date),
  (6, 'Ati-Atihan Festival', 'The country''s oldest festival — an intense street celebration of painted faces, tribal costumes, and pounding drums in honor of the Santo Niño.', 'https://images.unsplash.com/photo-1561043433-aaf687c47438?w=1200&h=600&fit=crop', 'Kalibo, Aklan', (current_date + interval '157 days')::date, (current_date + interval '160 days')::date)
on conflict (id) do nothing;

insert into public.events (id, festival_id, title, description, venue, start_time, end_time, organizer_id) values
  (1, 1, 'Indak-Indak sa Kadalanan (Street Dance)', 'The grand highlight of Kadayawan — tribal street dancing along the city''s main thoroughfares.', 'San Pedro Street, Davao City', now() + interval '5 days 8 hours', now() + interval '5 days 12 hours', '22222222-2222-2222-2222-222222222222'),
  (2, 1, 'Floral Float Parade', 'A stunning procession of floats decorated with fresh flowers and fruit.', 'Roxas Avenue, Davao City', now() + interval '6 days 15 hours', now() + interval '6 days 18 hours', '22222222-2222-2222-2222-222222222222'),
  (3, 1, 'Kadayawan Trade Fair', 'Local MSMEs showcase produce, crafts, and delicacies.', 'People''s Park, Davao City', now() + interval '7 days 9 hours', now() + interval '7 days 20 hours', '22222222-2222-2222-2222-222222222222'),
  (4, 2, 'Street Dancing Competition', 'Colorful contingents battle it out on the streets of Cagayan de Oro.', 'Capitol Grounds, Cagayan de Oro', now() + interval '19 days 9 hours', now() + interval '19 days 17 hours', '22222222-2222-2222-2222-222222222222'),
  (5, 3, 'MassKara Grand Parade', 'Thousands of masked dancers in the world-famous parade of smiles.', 'Lacson Street, Bacolod', now() + interval '63 days 9 hours', now() + interval '63 days 17 hours', '22222222-2222-2222-2222-222222222222'),
  (6, 3, 'Electric MassKara Street Party', 'An electrifying night celebration under the stars.', 'Bacolod Public Plaza', now() + interval '66 days 18 hours', now() + interval '66 days 23 hours', '22222222-2222-2222-2222-222222222222'),
  (7, 5, 'Grand Parade & Kiping Decor Contest', 'Homes compete in decorating facades with kiping and produce.', 'Lucban Town Plaza', now() - interval '86 days 8 hours', now() - interval '86 days 16 hours', '22222222-2222-2222-2222-222222222222'),
  (8, 5, 'Food & Crafts Fair', 'A showcase of Lucban''s famous delicacies and local crafts.', 'Lucban Public Market', now() - interval '85 days 9 hours', now() - interval '85 days 17 hours', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.msmes (id, owner, business_name, logo, description, category) values
  (1, '33333333-3333-3333-3333-333333333333', 'Elena''s Delicacies',   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop', 'Authentic Lucban longganisa, kiping, and handcrafted local delicacies.', 'Food & Delicacies'),
  (2, '44444444-4444-4444-4444-444444444444', 'Kultura Crafts',        'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&h=400&fit=crop', 'Handwoven textiles, woven bags, and indigenous souvenirs.', 'Handicrafts & Souvenirs'),
  (3, '55555555-5555-5555-5555-555555555555', 'Harvest Coffee Co.',    'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=600&h=400&fit=crop', 'Single-origin local coffee beans and freshly brewed specialty drinks.', 'Coffee & Drinks'),
  (4, '44444444-4444-4444-4444-444444444444', 'Barrio Threads',       'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&h=400&fit=crop', 'Modern streetwear and apparel inspired by Filipino cultural patterns.', 'Fashion & Apparel'),
  (5, '55555555-5555-5555-5555-555555555555', 'Sari-Sari Snacks',     'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&h=400&fit=crop', 'Local snacks, pasalubong packs, and festival-ready treats.', 'Food & Delicacies'),
  (6, '33333333-3333-3333-3333-333333333333', 'Araw Pottery Studio',  'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=600&h=400&fit=crop', 'Handmade pottery and ceramic art pieces from local artisans.', 'Handicrafts & Souvenirs')
on conflict (id) do nothing;

insert into public.products (id, msme_id, product_name, image, description, price, stock) values
  (1,  1, 'Lucban Longganisa',    null, 'Sweet & garlicky hometown sausage.', 280, 60),
  (2,  1, 'Kiping Pack',          null, 'Colorful edible rice-leaf decor.', 120, 120),
  (3,  1, 'Buko Pie',             null, 'Classic coconut custard pie.', 350, 25),
  (4,  2, 'Handwoven Tote Bag',   null, 'Durable abaca & rattan weave.', 450, 40),
  (5,  2, 'Tribal Keychains',     null, 'Miniature woven crafts.', 60, 300),
  (6,  3, 'Arabica Beans (250g)', null, 'Single-origin local roast.', 420, 80),
  (7,  3, 'Iced Barako Latte',    null, 'Bold & smooth brewed coffee.', 130, 150),
  (8,  4, 'Sinulog Graphic Tee',  null, 'Festival-inspired streetwear.', 450, 55),
  (9,  5, 'Pasalubong Box',       null, 'Assorted local treats box.', 500, 35),
  (10, 6, 'Ceramic Vase',         null, 'Hand-thrown local pottery.', 650, 20)
on conflict (id) do nothing;

insert into public.rewards (id, reward_name, required_points, image, description) values
  (1, 'Festival T-Shirt',        500, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop', 'Official festival commemorative shirt.'),
  (2, 'Free Event Pass',         1000, 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&h=300&fit=crop', 'Complimentary entry to any festival event.'),
  (3, 'Local Delicacy Basket',   750, 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=300&fit=crop', 'Assorted handcrafted local treats.'),
  (4, 'Handwoven Tote Bag',      300, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=300&fit=crop', 'Durable abaca & rattan woven tote.'),
  (5, 'VIP Parade Seat',         1500, 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=400&h=300&fit=crop', 'Reserved premium seat at the Grand Parade.')
on conflict (id) do nothing;

insert into public.announcements (id, title, description, image, created_by, created_at) values
  (1, 'Registration Now Open for Kadayawan 2026', 'Vendors, organizers, and tourists can now register for the upcoming festival season.', null, '11111111-1111-1111-1111-111111111111', now() - interval '2 days'),
  (2, 'New QR Reward System Launched', 'Earn points by scanning QR codes at participating MSMEs and redeem exciting rewards.', null, '11111111-1111-1111-1111-111111111111', now() - interval '6 days'),
  (3, 'Call for Festival Performers', 'Cultural groups and performers are invited to join the Grand Parade and Street Dance.', null, '22222222-2222-2222-2222-222222222222', now() - interval '9 days'),
  (4, 'MSME Bazaar Booth Application Open', 'Local businesses may apply for stalls at the festival trade fair now.', null, '11111111-1111-1111-1111-111111111111', now() - interval '14 days')
on conflict (id) do nothing;

insert into public.reward_qr (id, product_id, qr_code, points, created_at) values
  (1, 1, 'FTLGU-DEMO-0001', 50,  now() - interval '1 day'),
  (2, 4, 'FTLGU-DEMO-0002', 100, now() - interval '1 day'),
  (3, 6, 'FTLGU-DEMO-0003', 75,  now() - interval '1 day'),
  (4, 8, 'FTLGU-DEMO-0004', 150, now() - interval '1 day')
on conflict (id) do nothing;

insert into public.transactions (id, tourist_id, msme_id, qr_id, points, created_at) values
  (1, '66666666-6666-6666-6666-666666666666', 1, 1, 50,  now() - interval '30 days'),
  (2, '66666666-6666-6666-6666-666666666666', 2, 2, 100, now() - interval '24 days'),
  (3, '66666666-6666-6666-6666-666666666666', 3, 3, 75,  now() - interval '18 days'),
  (4, '66666666-6666-6666-6666-666666666666', 4, 4, 150, now() - interval '10 days'),
  (5, '66666666-6666-6666-6666-666666666666', 5, null, 40, now() - interval '4 days'),
  (6, '77777777-7777-7777-7777-777777777777', 1, 1, 50,  now() - interval '12 days'),
  (7, '88888888-8888-8888-8888-888888888888', 3, 3, 75,  now() - interval '7 days'),
  (8, '99999999-9999-9999-9999-999999999999', 2, 2, 100, now() - interval '3 days')
on conflict (id) do nothing;

insert into public.tourist_points (tourist_id, points) values
  ('66666666-6666-6666-6666-666666666666', 415),
  ('77777777-7777-7777-7777-777777777777', 250),
  ('88888888-8888-8888-8888-888888888888', 380),
  ('99999999-9999-9999-9999-999999999999', 640)
on conflict (tourist_id) do nothing;

insert into public.redeemed_rewards (id, tourist_id, reward_id, redeemed_date) values
  (1, '66666666-6666-6666-6666-666666666666', 4, now() - interval '6 days'),
  (2, '99999999-9999-9999-9999-999999999999', 1, now() - interval '2 days')
on conflict (id) do nothing;

insert into public.feedback (id, tourist_id, rating, comment, suggestion, created_at) values
  (1, '66666666-6666-6666-6666-666666666666', 5, 'The festival experience was unforgettable! The street parade was world-class.', 'More seating for the parade route.', now() - interval '5 days'),
  (2, '77777777-7777-7777-7777-777777777777', 4, 'Loved the MSME booths. The local food was amazing.', 'Longer trade fair hours.', now() - interval '3 days'),
  (3, '88888888-8888-8888-8888-888888888888', 5, 'The QR reward system is brilliant — easy and fun to earn points!', null, now() - interval '1 day')
on conflict (id) do nothing;

insert into public.guide_items (id, section, title, subtitle, body, meta, tag, image, is_map_image, sort_order) values
  (1,  'maps',           'Festival Venue Map',        'Town Plaza',             'Download the official festival map at the LGU Tourism Office or visit any info booth on site.', null, null, 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=700&fit=crop', true,  0),
  (2,  'maps',           'Town Plaza & Main Stage',   'Main venue',             'Grand parades, nightly shows, and the festival opening.',            null, null, null, false, 1),
  (3,  'maps',           'Parade Route',              '2 km route',              'Follows the national road through the town center.',                 null, null, null, false, 2),
  (4,  'maps',           'MSME Trade Fair',           'Open daily',              'Local products, crafts, and pasalubong stalls.',                      null, null, null, false, 3),
  (5,  'maps',           'Food Village',              'All weekend',             'Authentic local dishes and festival food.',                           null, null, null, false, 4),
  (6,  'maps',           'Info Booth',                'Help desk',               'Tourist assistance, maps, and free bag counters.',                    null, null, null, false, 5),
  (7,  'transportation', 'Jeepney',                   null,                      'Main public transport around town and nearby barangays.',             '₱13 – ₱25', 'Every 10 min', null, false, 0),
  (8,  'transportation', 'Tricycle',                  null,                      'Best for short hops and getting to festival venues quickly.',         '₱20 – ₱50', 'On demand', null, false, 1),
  (9,  'transportation', 'Vans / UV Express',         null,                      'Comfortable shuttle between the city and festival grounds.',          '₱35 – ₱90', 'Every 30 min', null, false, 2),
  (10, 'transportation', 'Pedicab',                   null,                      'Eco-friendly rides perfect for the parade route.',                    '₱15 – ₱40', 'Daytime', null, false, 3),
  (11, 'hotels',         'Rizal Heritage Hotel',      'Boutique Hotel',          'Historic boutique hotel near the plaza.',                             '₱2,400/night', '4.6 ★ • 0.3 km from plaza', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop', false, 0),
  (12, 'hotels',         'Town Plaza Lodge',          'Budget Inn',              'Simple, clean rooms in the heart of town.',                           '₱950/night',  '4.1 ★ • 0.1 km from plaza', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=600&h=400&fit=crop', false, 1),
  (13, 'hotels',         'Casa Luna Suites',          'Hotel & Spa',             'Comfortable suites with spa services.',                               '₱3,200/night', '4.8 ★ • 1.2 km from plaza', 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop', false, 2),
  (14, 'hotels',         'Villa Isabel Resort',       'Resort',                  'Relaxing resort with pool and gardens.',                              '₱2,800/night', '4.4 ★ • 3.5 km from plaza', 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&h=400&fit=crop', false, 3),
  (15, 'hotels',         'Traveler''s Haven',         'Hostel',                  'Affordable shared and private rooms.',                                '₱550/bed',    '4.0 ★ • 0.8 km from plaza', 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600&h=400&fit=crop', false, 4),
  (16, 'hotels',         'Sampaguita Inn',            'Inn',                     'Cozy family-run inn with home-style meals.',                          '₱1,200/night', '4.2 ★ • 1.8 km from plaza', 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&h=400&fit=crop', false, 5),
  (17, 'restaurants',    'Kusina ng Bayan',           'Filipino Favorites',      null, '₱₱', 'Best: Kare-Kare & Adobo', 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop', false, 0),
  (18, 'restaurants',    'Sari-Sari Eatery',          'Home-style Dishes',       null, '₱',   'Best: Boodle Fight Sets', 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&h=400&fit=crop', false, 1),
  (19, 'restaurants',    'The Harvest Table',         'Organic & Farm-to-Table', null, '₱₱₱', 'Best: Fresh Salads & Grills', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop', false, 2),
  (20, 'restaurants',    'Lutong Bahay',              'Local Delicacies',        null, '₱₱', 'Best: Pansit Habhab & Lucban Longganisa', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&h=400&fit=crop', false, 3),
  (21, 'restaurants',    'Kapihan sa Plaza',          'Coffee & Pastries',       null, '₱',   'Best: Barako Coffee & Ensaymada', 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&h=400&fit=crop', false, 4),
  (22, 'restaurants',    'Garden Bistro',             'International',           null, '₱₱₱', 'Best: Wood-fired Pizza', 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&h=400&fit=crop', false, 5),
  (23, 'emergency',      'Police Station',            'Report incidents, lost & found',        '0916-123-4567', null, null, null, false, 0),
  (24, 'emergency',      'Fire Station',              'Fire emergencies & hotline 160',        '0917-234-5678', null, null, null, false, 1),
  (25, 'emergency',      'Medical / Hospital',        '24/7 emergency care',                   '0918-345-6789', null, null, null, false, 2),
  (26, 'emergency',      'LGU Tourism Office',        'Information & assistance',              '0919-456-7890', null, null, null, false, 3),
  (27, 'emergency',      'Tourist Assistance',        'Tourist helpline',                      '1-800-FESTIVAL', null, null, null, false, 4),
  (28, 'emergency',      'Emergency Hotline',         'National emergency line',                '911', null, null, null, false, 5)
on conflict (id) do nothing;
