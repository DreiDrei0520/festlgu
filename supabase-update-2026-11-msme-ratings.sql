-- Public store ratings: aggregated feedback per MSME.
-- A SECURITY DEFINER function is used because feedback rows are private by RLS,
-- but the directory needs to show each shop's average rating and review count.
create or replace function public.msme_rating_stats()
returns table (msme_id int, average_rating numeric, rating_count bigint)
language sql stable security definer set search_path = public as $$
  select f.msme_id, round(avg(f.rating)::numeric, 1), count(*)
  from public.feedback f
  where f.msme_id is not null and f.feedback_type = 'msme'
  group by f.msme_id
$$;

grant execute on function public.msme_rating_stats() to anon, authenticated;
