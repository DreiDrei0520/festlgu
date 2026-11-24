-- Product ratings and comments
alter table public.feedback add column if not exists product_id int references public.products (id) on delete cascade;
alter table public.feedback add column if not exists sale_id bigint references public.sales (id) on delete cascade;
create index if not exists feedback_product_created_idx on public.feedback (product_id, created_at desc);
create unique index if not exists feedback_sale_product_unique
  on public.feedback (sale_id, product_id, tourist_id)
  where product_id is not null;

-- Public directory can show product ratings/comments.
drop policy if exists "public read product feedback" on public.feedback;
create policy "public read product feedback" on public.feedback
  for select using (feedback_type = 'msme' and product_id is not null);

-- Allow the existing receipt feedback RPC to rate individual purchased products.
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
    'items', coalesce((
      select json_agg(json_build_object(
        'product_id', i.product_id,
        'name', i.product_name,
        'quantity', i.quantity,
        'line_total', i.line_total,
        'rated', exists (
          select 1 from public.feedback f
          where f.sale_id = s.id and f.product_id = i.product_id and f.tourist_id = auth.uid()
        )
      ) order by i.id)
      from public.sale_items i where i.sale_id = s.id
    ), '[]'::json)
  );
end;
$$;

drop function if exists public.submit_sale_feedback(text, int, text, text);

create or replace function public.submit_sale_feedback(
  p_code text,
  p_rating int,
  p_comment text,
  p_suggestion text default null,
  p_product_id int default null
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_tourist();
  s public.sales;
  v_fid int;
  v_bonus constant int := 10;
  v_balance int;
  v_award_bonus boolean := false;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be from 1 to 5.'; end if;
  if nullif(trim(coalesce(p_comment, '')), '') is null then raise exception 'Please write a short comment.'; end if;

  select * into s from public.sales where claim_code = upper(trim(p_code)) for update;
  if s.id is null then raise exception 'Receipt not found.'; end if;
  perform public.credit_sale_to_tourist(s, v_uid);

  if p_product_id is not null and not exists (
    select 1 from public.sale_items i
    where i.sale_id = s.id and i.product_id = p_product_id
  ) then
    raise exception 'This product is not on the receipt.';
  end if;

  if exists (
    select 1 from public.feedback f
    where f.sale_id = s.id and f.product_id = p_product_id and f.tourist_id = v_uid
  ) then
    raise exception 'Feedback was already submitted for this product.';
  end if;

  insert into public.feedback (
    tourist_id, rating, comment, suggestion, feedback_type,
    municipality, festival_id, msme_id, product_id, sale_id
  ) values (
    v_uid, p_rating, trim(p_comment), nullif(trim(coalesce(p_suggestion, '')), ''), 'msme',
    s.municipality, s.festival_id, s.msme_id, p_product_id, s.id
  ) returning id into v_fid;

  if s.feedback_id is null then
    v_award_bonus := true;
    update public.sales set feedback_id = v_fid, bonus_points = v_bonus where id = s.id;
  else
    update public.sales set feedback_id = coalesce(feedback_id, v_fid) where id = s.id;
  end if;

  if v_award_bonus then
    insert into public.tourist_points (tourist_id, points) values (v_uid, v_bonus)
      on conflict (tourist_id) do update set points = public.tourist_points.points + excluded.points;
    insert into public.transactions (
      tourist_id, msme_id, points, transaction_type, reference_no, description,
      amount, status, municipality, festival_id
    ) values (
      v_uid, s.msme_id, v_bonus, 'feedback_bonus', s.receipt_no,
      'Product feedback bonus', 0, 'completed', s.municipality, s.festival_id
    );
  end if;

  select points into v_balance from public.tourist_points where tourist_id = v_uid;
  return json_build_object(
    'bonus', case when v_award_bonus then v_bonus else 0 end,
    'balance', coalesce(v_balance, 0),
    'feedback_id', v_fid
  );
end;
$$;
