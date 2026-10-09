-- FestivaLGU — MSME-managed redeemable rewards
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor
-- (after supabase-update-2026-10.sql). Never run the full supabase-schema.sql on live.
--
-- Model: tourists earn points from purchases; each MSME sets how many points a
-- product earns (products.points) and publishes its own rewards (rewards.msme_id)
-- that tourists redeem with those points. The MSME then marks each redemption
-- claimed or rejected (a rejection refunds the points and the stock).

-- ── columns ──────────────────────────────────────────────────────────────────
alter table public.products add column if not exists points int not null default 0;
alter table public.products drop constraint if exists products_points_check;
alter table public.products add constraint products_points_check check (points >= 0);

alter table public.rewards add column if not exists stock int;           -- null = unlimited
alter table public.rewards add column if not exists active boolean not null default true;
alter table public.rewards drop constraint if exists rewards_stock_check;
alter table public.rewards add constraint rewards_stock_check check (stock is null or stock >= 0);

-- Existing redemptions predate statuses: count them as claimed, new ones start pending.
alter table public.redeemed_rewards add column if not exists status text not null default 'claimed';
alter table public.redeemed_rewards alter column status set default 'pending';
alter table public.redeemed_rewards drop constraint if exists redeemed_rewards_status_check;
alter table public.redeemed_rewards add constraint redeemed_rewards_status_check
  check (status in ('pending','claimed','rejected'));
alter table public.redeemed_rewards add column if not exists points_spent int not null default 0;
alter table public.redeemed_rewards add column if not exists status_updated_at timestamptz;

-- ── RLS: who may write rewards ───────────────────────────────────────────────
-- Was: any signed-in user. Now: the owning MSME, or LGU staff of the festival's town.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'rewards' and cmd <> 'SELECT' loop
    execute format('drop policy %I on public.rewards', r.policyname);
  end loop;
end $$;

create or replace function public.can_write_reward(p_msme int, p_festival int)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (p_msme is not null and exists (select 1 from public.msmes m where m.id = p_msme and m.owner = auth.uid()))
    or (p_festival is not null and exists (select 1 from public.festivals f
          where f.id = p_festival and public.can_manage_municipality(f.municipality)));
$$;

drop policy if exists "rewards write" on public.rewards;
create policy "rewards write" on public.rewards for all
  using (public.can_write_reward(msme_id, festival_id))
  with check (public.can_write_reward(msme_id, festival_id));

-- ── points per product at checkout ───────────────────────────────────────────
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
  v_pts int := 0;
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
    v_pts := v_pts + coalesce(prod.points, 0) * r.qty;
  end loop;

  -- Points are set per product by the MSME; a cart with none set keeps the
  -- default rule (purchase_points) so existing products still earn points.
  if v_pts > 0 then
    update public.sales set points_earned = v_pts where id = s.id returning * into s;
  end if;

  return s;
end;
$$;

-- ── redeem with points: stock, active flag, status, atomic ──────────────────
create or replace function public.redeem_reward_with_points(p_reward_id int)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_tourist();
  rw public.rewards;
  v_balance int;
  v_muni text;
begin
  -- lock the reward row: concurrent redemptions queue up, so stock can't go below 0
  select * into rw from public.rewards where id = p_reward_id for update;
  if rw.id is null then raise exception 'Reward not found.'; end if;
  if not rw.active then raise exception 'This reward is no longer available.'; end if;
  if coalesce(rw.required_points, 0) <= 0 then raise exception 'This reward is unlocked by attendance days, not points.'; end if;
  if rw.stock is not null and rw.stock <= 0 then raise exception 'Sorry, this reward is out of stock.'; end if;
  if exists (select 1 from public.redeemed_rewards
             where tourist_id = v_uid and reward_id = rw.id and status <> 'rejected') then
    raise exception 'You already redeemed this reward.';
  end if;
  select points into v_balance from public.tourist_points where tourist_id = v_uid for update;
  if coalesce(v_balance, 0) < rw.required_points then
    raise exception 'Not enough points — you need % more.', rw.required_points - coalesce(v_balance, 0);
  end if;
  select coalesce(
           (select municipality from public.festivals where id = rw.festival_id),
           (select municipality from public.msmes where id = rw.msme_id)) into v_muni;
  update public.tourist_points set points = points - rw.required_points where tourist_id = v_uid;
  if rw.stock is not null then update public.rewards set stock = stock - 1 where id = rw.id; end if;
  insert into public.redeemed_rewards (tourist_id, reward_id, msme_id, product_id, redeemed_date, status, points_spent)
    values (v_uid, rw.id, rw.msme_id, rw.product_id, now(), 'pending', rw.required_points);
  insert into public.transactions (tourist_id, msme_id, points, transaction_type, reference_no, description, amount, status, municipality, festival_id)
    values (v_uid, rw.msme_id, -rw.required_points, 'points_redemption', 'RW-' || rw.id, 'Redeemed: ' || rw.reward_name, 0, 'completed', v_muni, rw.festival_id);
  return json_build_object('balance', coalesce(v_balance, 0) - rw.required_points);
end;
$$;

-- ── MSME: list redemptions of my rewards ─────────────────────────────────────
create or replace function public.msme_redemptions(p_msme int)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.msmes where id = p_msme and owner = auth.uid()) then
    raise exception 'Not your business.';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', x.id, 'reward_name', rw.reward_name, 'tourist_name', coalesce(p.fullname, 'Tourist'),
      'points_spent', x.points_spent, 'status', x.status,
      'redeemed_date', x.redeemed_date, 'status_updated_at', x.status_updated_at
    ) order by x.redeemed_date desc)
    from public.redeemed_rewards x
    join public.rewards rw on rw.id = x.reward_id
    left join public.profiles p on p.id = x.tourist_id
    where x.msme_id = p_msme
  ), '[]'::json);
end;
$$;

-- ── MSME: mark a redemption claimed / rejected (reject refunds) ──────────────
create or replace function public.msme_set_redemption_status(p_id int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.redeemed_rewards;
  rw public.rewards;
  v_muni text;
begin
  if p_status not in ('claimed','rejected') then raise exception 'Bad status.'; end if;
  select * into x from public.redeemed_rewards where id = p_id for update;
  if x.id is null then raise exception 'Redemption not found.'; end if;
  if not exists (select 1 from public.msmes where id = x.msme_id and owner = auth.uid()) then
    raise exception 'Not your business.';
  end if;
  if x.status <> 'pending' then raise exception 'This redemption is already %.', x.status; end if;

  update public.redeemed_rewards set status = p_status, status_updated_at = now() where id = x.id;

  if p_status = 'rejected' and x.points_spent > 0 then
    select * into rw from public.rewards where id = x.reward_id for update;
    insert into public.tourist_points (tourist_id, points) values (x.tourist_id, x.points_spent)
      on conflict (tourist_id) do update set points = public.tourist_points.points + excluded.points;
    if rw.id is not null and rw.stock is not null then
      update public.rewards set stock = stock + 1 where id = rw.id;
    end if;
    select coalesce((select municipality from public.festivals where id = rw.festival_id),
                    (select municipality from public.msmes where id = x.msme_id)) into v_muni;
    insert into public.transactions (tourist_id, msme_id, points, transaction_type, reference_no, description, amount, status, municipality, festival_id)
      values (x.tourist_id, x.msme_id, x.points_spent, 'points_refund', 'RW-' || x.reward_id,
              'Refund: ' || coalesce(rw.reward_name, 'reward'), 0, 'completed', v_muni, rw.festival_id);
  end if;
end;
$$;

grant execute on function public.msme_redemptions(int) to authenticated;
grant execute on function public.msme_set_redemption_status(int, text) to authenticated;

select public.sync_id_sequences();
notify pgrst, 'reload schema';
