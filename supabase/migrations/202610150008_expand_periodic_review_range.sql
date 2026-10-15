-- Allow user-selected reviews across several years. Application-side batching
-- still caps a single generation job to keep processing time and cost bounded.
create or replace function public.start_periodic_review(
  p_kind text,
  p_start_date date,
  p_end_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.periodic_reviews%rowtype;
  v_entry_count integer;
  v_exists boolean := false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('half_year', 'custom', 'year') then raise exception 'invalid_review_kind'; end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then raise exception 'invalid_date_range'; end if;
  if p_end_date - p_start_date > 3653 then raise exception 'date_range_too_large'; end if;

  select * into v_review
  from public.periodic_reviews
  where user_id = v_user_id and kind = p_kind and start_date = p_start_date and end_date = p_end_date
  for update;
  v_exists := found;

  if v_exists and v_review.status = 'completed' then
    return jsonb_build_object(
      'status', 'completed', 'reviewId', v_review.id, 'entryCount', v_review.entry_count,
      'result', v_review.result, 'createdAt', v_review.created_at, 'updatedAt', v_review.updated_at
    );
  end if;

  if v_exists and v_review.status = 'running'
     and v_review.started_at > pg_catalog.now() - interval '5 minutes' then
    return jsonb_build_object(
      'status', 'running', 'reviewId', v_review.id, 'entryCount', v_review.entry_count,
      'createdAt', v_review.created_at, 'updatedAt', v_review.updated_at
    );
  end if;

  select count(*)::integer into v_entry_count
  from public.entries
  where user_id = v_user_id and status = 'active'
    and local_date >= p_start_date and local_date <= p_end_date;

  if v_exists then
    update public.periodic_reviews
    set status = 'running', entry_count = v_entry_count, attempts = attempts + 1,
        provider = null, model = null, prompt_version = null, result = null,
        last_error_code = null, started_at = pg_catalog.now(), completed_at = null,
        updated_at = pg_catalog.now()
    where id = v_review.id
    returning * into v_review;
  else
    insert into public.periodic_reviews (
      user_id, kind, start_date, end_date, entry_count, status, attempts, started_at
    ) values (
      v_user_id, p_kind, p_start_date, p_end_date, v_entry_count, 'running', 1, pg_catalog.now()
    ) returning * into v_review;
  end if;

  return jsonb_build_object(
    'status', 'started', 'reviewId', v_review.id, 'entryCount', v_review.entry_count,
    'createdAt', v_review.created_at, 'updatedAt', v_review.updated_at
  );
end;
$$;

revoke execute on function public.start_periodic_review(text, date, date) from public, anon;
grant execute on function public.start_periodic_review(text, date, date) to authenticated;
