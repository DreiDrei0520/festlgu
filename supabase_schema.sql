-- ============================================================
-- FestivaLGU — Full Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- Enable UUID extension (usually pre-enabled on Supabase)
create extension if not exists "uuid-ossp";

-- ── Profiles (extends Supabase auth.users) ───────────────────
create table if not exists public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  fullname      text not null,
  email         text not null,
  role          text not null default 'tourist'
                  check (role in ('admin','organizer','msme','tourist')),
  profile_photo text,
  created_at    timestamptz default now()
);

-- Auto-create a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, fullname, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'fullname', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'tourist')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Tourist Points ────────────────────────────────────────────
create table if not exists public.tourist_points (
  tourist_id  uuid references public.profiles(id) on delete cascade primary key,
  points      int not null default 0
);

-- ── Festivals ─────────────────────────────────────────────────
create table if not exists public.festivals (
  id          serial primary key,
  title       text not null,
  description text,
  banner      text,
  location    text,
  start_date  date,
  end_date    date,
  created_at  timestamptz default now()
);

-- ── Events ────────────────────────────────────────────────────
create table if not exists public.events (
  id            serial primary key,
  festival_id   int references public.festivals(id) on delete cascade,
  title         text not null,
  description   text,
  venue         text,
  start_time    timestamptz,
  end_time      timestamptz,
  organizer_id  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz default now()
);

-- ── MSMEs ─────────────────────────────────────────────────────
create table if not exists public.msmes (
  id            serial primary key,
  owner         uuid references public.profiles(id) on delete cascade,
  business_name text not null,
  logo          text,
  description   text,
  created_at    timestamptz default now()
);

-- ── Products ──────────────────────────────────────────────────
create table if not exists public.products (
  id           serial primary key,
  msme_id      int references public.msmes(id) on delete cascade,
  product_name text not null,
  image        text,
  description  text,
  price        numeric(10,2) not null default 0,
  stock        int not null default 0,
  created_at   timestamptz default now()
);

-- ── Reward QR ─────────────────────────────────────────────────
create table if not exists public.reward_qr (
  id          serial primary key,
  product_id  int references public.products(id) on delete cascade,
  qr_code     text unique not null,
  points      int not null default 50,
  created_at  timestamptz default now()
);

-- ── Transactions ──────────────────────────────────────────────
create table if not exists public.transactions (
  id          serial primary key,
  tourist_id  uuid references public.profiles(id) on delete cascade,
  msme_id     int references public.msmes(id) on delete set null,
  qr_id       int references public.reward_qr(id) on delete set null,
  points      int not null default 0,
  created_at  timestamptz default now()
);

-- Automatically add points to tourist_points on transaction insert
create or replace function public.add_points_on_transaction()
returns trigger language plpgsql security definer as $$
begin
  insert into public.tourist_points (tourist_id, points)
  values (new.tourist_id, new.points)
  on conflict (tourist_id) do update
    set points = tourist_points.points + new.points;
  return new;
end;
$$;

drop trigger if exists on_transaction_insert on public.transactions;
create trigger on_transaction_insert
  after insert on public.transactions
  for each row execute procedure public.add_points_on_transaction();

-- ── Rewards ───────────────────────────────────────────────────
create table if not exists public.rewards (
  id              serial primary key,
  reward_name     text not null,
  required_points int not null default 500,
  image           text,
  created_at      timestamptz default now()
);

-- ── Redeemed Rewards ──────────────────────────────────────────
create table if not exists public.redeemed_rewards (
  id             serial primary key,
  tourist_id     uuid references public.profiles(id) on delete cascade,
  reward_id      int references public.rewards(id) on delete cascade,
  redeemed_date  timestamptz default now()
);

-- ── Feedback ──────────────────────────────────────────────────
create table if not exists public.feedback (
  id          serial primary key,
  tourist_id  uuid references public.profiles(id) on delete cascade,
  rating      int not null check (rating between 1 and 5),
  comment     text not null,
  suggestion  text,
  created_at  timestamptz default now()
);

-- ── Announcements ─────────────────────────────────────────────
create table if not exists public.announcements (
  id          serial primary key,
  title       text not null,
  description text,
  image       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now()
);

-- ── Market Analysis ───────────────────────────────────────────
create table if not exists public.market_analysis (
  id             serial primary key,
  report         jsonb,
  generated_date timestamptz default now()
);

-- ── Saved Events (Tourist favorites) ─────────────────────────
create table if not exists public.saved_events (
  tourist_id uuid references public.profiles(id) on delete cascade,
  event_id   int references public.events(id) on delete cascade,
  primary key (tourist_id, event_id)
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

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
alter table public.market_analysis  enable row level security;
alter table public.saved_events     enable row level security;

-- Profiles: users can read all, edit own
create policy "profiles_select_all"   on public.profiles for select using (true);
create policy "profiles_update_own"   on public.profiles for update using (auth.uid() = id);

-- Tourist points: read own
create policy "points_select_own"     on public.tourist_points for select using (auth.uid() = tourist_id);
create policy "points_insert_system"  on public.tourist_points for insert with check (true);
create policy "points_update_system"  on public.tourist_points for update using (true);

-- Festivals: public read, admin write
create policy "festivals_public_read" on public.festivals for select using (true);
create policy "festivals_admin_write" on public.festivals for all using (
  (select role from public.profiles where id = auth.uid()) = 'admin'
);

-- Events: public read, organizer/admin write
create policy "events_public_read"    on public.events for select using (true);
create policy "events_org_write"      on public.events for all using (
  (select role from public.profiles where id = auth.uid()) in ('admin','organizer')
);

-- MSMEs: public read, msme owner manages own, admin all
create policy "msmes_public_read"     on public.msmes for select using (true);
create policy "msmes_owner_write"     on public.msmes for all using (
  owner = auth.uid() or
  (select role from public.profiles where id = auth.uid()) = 'admin'
);

-- Products: public read, msme owner manages own
create policy "products_public_read"  on public.products for select using (true);
create policy "products_msme_write"   on public.products for all using (
  (select owner from public.msmes where id = msme_id) = auth.uid() or
  (select role from public.profiles where id = auth.uid()) = 'admin'
);

-- Reward QR: msme owner manages own
create policy "qr_public_read"        on public.reward_qr for select using (true);
create policy "qr_msme_write"         on public.reward_qr for all using (
  (select role from public.profiles where id = auth.uid()) in ('admin','msme')
);

-- Transactions: tourist inserts own, admin reads all
create policy "tx_select"             on public.transactions for select using (
  tourist_id = auth.uid() or
  (select role from public.profiles where id = auth.uid()) = 'admin'
);
create policy "tx_insert"             on public.transactions for insert with check (tourist_id = auth.uid());

-- Rewards: public read, admin write
create policy "rewards_public_read"   on public.rewards for select using (true);
create policy "rewards_admin_write"   on public.rewards for all using (
  (select role from public.profiles where id = auth.uid()) = 'admin'
);

-- Redeemed rewards: tourist manages own
create policy "redeemed_own"          on public.redeemed_rewards for all using (tourist_id = auth.uid());

-- Feedback: tourists insert own, admin reads all
create policy "feedback_select"       on public.feedback for select using (
  tourist_id = auth.uid() or
  (select role from public.profiles where id = auth.uid()) = 'admin'
);
create policy "feedback_insert"       on public.feedback for insert with check (tourist_id = auth.uid());

-- Announcements: public read, admin/organizer write
create policy "ann_public_read"       on public.announcements for select using (true);
create policy "ann_write"             on public.announcements for all using (
  (select role from public.profiles where id = auth.uid()) in ('admin','organizer')
);

-- Saved events: tourist manages own
create policy "saved_own"             on public.saved_events for all using (tourist_id = auth.uid());

-- Market analysis: admin only
create policy "market_admin"          on public.market_analysis for all using (
  (select role from public.profiles where id = auth.uid()) = 'admin'
);

-- ============================================================
-- Seed Data (optional — remove if you want a clean start)
-- ============================================================

insert into public.festivals (title, description, banner, location, start_date, end_date) values
  ('Pahiyas Festival', 'A vibrant thanksgiving celebration featuring colorful kiping decorations.', null, 'Lucban, Quezon', '2025-05-15', '2025-05-17'),
  ('Sinulog Festival', 'The grandest festival in Cebu honoring the Santo Niño with colorful street dancing.', null, 'Cebu City', '2025-01-19', '2025-01-21'),
  ('Kadayawan Festival', 'A week-long celebration of life, nature, and the bountiful harvests of Davao.', null, 'Davao City', '2025-08-14', '2025-08-18')
on conflict do nothing;

insert into public.rewards (reward_name, required_points, image) values
  ('Festival T-Shirt', 500, null),
  ('Free Event Pass', 1000, null),
  ('Local Delicacy Basket', 750, null)
on conflict do nothing;

insert into public.announcements (title, description) values
  ('Registration Now Open for Pahiyas 2025', 'Vendors, organizers, and tourists can now register for the upcoming Pahiyas Festival 2025.'),
  ('New QR Reward System Launched', 'Earn points by scanning QR codes at participating MSMEs and redeem exciting rewards.'),
  ('Call for Festival Performers', 'Cultural groups and performers are invited to join the Grand Parade and Folk Dance Competition.')
on conflict do nothing;
