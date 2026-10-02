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
--   • Access hardening (private profiles, roles can't be self-assigned,
--     points are written only by the database)
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

-- ── catch-up: September 2026 schema (commit 1e5c707) ────────────────────────
-- Databases set up before that update are missing these; everything below
-- depends on them, so they are (re)applied here. All idempotent.

alter table public.profiles add column if not exists municipality_access text[];
-- the sign-up trigger below writes it; without the column every sign-up fails
alter table public.profiles add column if not exists birthdate date;

alter table public.transactions add column if not exists transaction_type text not null default 'reward_redemption';
alter table public.transactions add column if not exists reference_no text;
alter table public.transactions add column if not exists description text;
alter table public.transactions add column if not exists amount numeric not null default 0;
alter table public.transactions add column if not exists status text not null default 'completed';
alter table public.transactions add column if not exists municipality text;
alter table public.transactions add column if not exists festival_id int references public.festivals (id) on delete set null;

alter table public.registration_payments add column if not exists paid_at timestamptz;
alter table public.redeemed_rewards add column if not exists msme_id int references public.msmes (id) on delete set null;
alter table public.redeemed_rewards add column if not exists product_id int references public.products (id) on delete set null;
alter table public.feedback add column if not exists feedback_type text not null default 'festival';
alter table public.feedback add column if not exists municipality text;
alter table public.feedback add column if not exists festival_id int references public.festivals (id) on delete set null;
alter table public.feedback add column if not exists msme_id int references public.msmes (id) on delete set null;

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

alter table public.activity_logs enable row level security;
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
  -- Self sign-up (through Supabase Auth) can only create tourist or MSME
  -- accounts — the role is sent by the browser, so it must not be trusted.
  -- Staff accounts are created from the SQL editor (see supabase-schema.sql).
  if session_user = 'supabase_auth_admin' and v_role not in ('tourist','msme') then
    v_role := 'tourist';
  end if;

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

-- ── access hardening ─────────────────────────────────────────────────────────
-- Accounts: profiles (name, email, role) were readable without signing in on
-- older databases, and any signed-in user could rewrite any profile —
-- including their own role. Drop whatever policies exist (older databases
-- carry extra, permissive ones) and recreate the intended set.
do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', r.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "auth read profiles" on public.profiles for select using (auth.role() = 'authenticated');
create policy "own insert profiles" on public.profiles for insert with check (id = auth.uid());
create policy "own update profiles" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin delete profiles" on public.profiles for delete using (public.is_town_admin(municipality));

-- A signed-in user can edit their own name/photo/email, but never their role
-- or town. The SQL editor and the sign-up trigger (no signed-in user) are exempt.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.role not in ('tourist','msme') then new.role := 'tourist'; end if;
    new.municipality_access := null;
  else
    new.role := old.role;
    new.municipality := old.municipality;
    new.municipality_access := old.municipality_access;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- Points and their ledger are written only by the database functions
-- (claim_sale_points, submit_sale_feedback, redeem_reward_with_points) —
-- otherwise a tourist could simply set their own balance.
do $$
declare
  r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('tourist_points','transactions') and cmd <> 'SELECT' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
alter table public.tourist_points enable row level security;
alter table public.transactions enable row level security;

-- Older databases also carry a trigger that adds every transaction's points to
-- the balance a second time — the functions above already do that, so each
-- purchase, feedback bonus and redemption was counted twice. Remove it.
drop trigger if exists on_transaction_insert on public.transactions;
drop function if exists public.add_points_on_transaction();

-- Registration payments (and their proof-of-payment files) are visible only to
-- the business owner and that town's LGU staff.
drop policy if exists "auth read registration_payments" on public.registration_payments;
create policy "auth read registration_payments" on public.registration_payments for select using (
  exists (select 1 from public.msmes m where m.id = registration_payments.msme_id
          and (m.owner = auth.uid() or public.can_manage_municipality(m.municipality)))
);

-- ── personal details shown in Account Settings ───────────────────────────────
-- Kept out of `profiles` (which every signed-in user can read for names) so a
-- person's contact number and address are visible only to them and LGU admins.
create table if not exists public.profile_details (
  id uuid primary key references public.profiles (id) on delete cascade,
  sex text,
  contact_number text,
  address text,
  city text,
  province text,
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

alter table public.profile_details enable row level security;
drop policy if exists "profile_details own" on public.profile_details;
create policy "profile_details own" on public.profile_details for all
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profile_details admin read" on public.profile_details;
create policy "profile_details admin read" on public.profile_details for select using (public.is_admin());

select public.sync_id_sequences();

notify pgrst, 'reload schema';
