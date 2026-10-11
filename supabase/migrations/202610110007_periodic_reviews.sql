-- Persist model-independent period reviews with source-grounded evidence.

create table if not exists public.periodic_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('half_year', 'custom', 'year')),
  start_date date not null,
  end_date date not null,
  entry_count integer not null default 0 check (entry_count >= 0),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider text,
  model text,
  prompt_version text,
  result jsonb,
  last_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint periodic_reviews_date_order check (start_date <= end_date),
  constraint periodic_reviews_result_shape check (result is null or jsonb_typeof(result) = 'object'),
  constraint periodic_reviews_scope_unique unique (user_id, kind, start_date, end_date)
);

create index if not exists periodic_reviews_user_created_idx
  on public.periodic_reviews (user_id, created_at desc);

alter table public.periodic_reviews enable row level security;
revoke all on table public.periodic_reviews from anon, authenticated;
grant select on table public.periodic_reviews to authenticated;

drop policy if exists "Read own periodic reviews" on public.periodic_reviews;
create policy "Read own periodic reviews" on public.periodic_reviews
  for select to authenticated using (user_id = (select auth.uid()));

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
  if p_end_date - p_start_date > 370 then raise exception 'date_range_too_large'; end if;

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

create or replace function public.complete_periodic_review(
  p_review_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.periodic_reviews%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  if char_length(p_provider) not between 1 and 80 then raise exception 'invalid_provider'; end if;
  if char_length(p_model) not between 1 and 160 then raise exception 'invalid_model'; end if;
  if char_length(p_prompt_version) not between 1 and 80 then raise exception 'invalid_prompt_version'; end if;

  update public.periodic_reviews
  set status = 'completed', provider = p_provider, model = p_model,
      prompt_version = p_prompt_version, result = p_result, last_error_code = null,
      completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_review_id and user_id = v_user_id
  returning * into v_review;
  if not found then raise exception 'periodic_review_not_found'; end if;

  return jsonb_build_object(
    'status', 'completed', 'reviewId', v_review.id, 'entryCount', v_review.entry_count,
    'result', v_review.result, 'createdAt', v_review.created_at, 'updatedAt', v_review.updated_at
  );
end;
$$;

create or replace function public.fail_periodic_review(p_review_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(p_error_code) not between 1 and 80 then raise exception 'invalid_error_code'; end if;

  update public.periodic_reviews
  set status = 'failed', last_error_code = p_error_code, updated_at = pg_catalog.now()
  where id = p_review_id and user_id = v_user_id;
  if not found then raise exception 'periodic_review_not_found'; end if;
end;
$$;

revoke execute on function public.start_periodic_review(text, date, date) from public, anon;
revoke execute on function public.complete_periodic_review(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.fail_periodic_review(uuid, text) from public, anon;
grant execute on function public.start_periodic_review(text, date, date) to authenticated;
grant execute on function public.complete_periodic_review(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.fail_periodic_review(uuid, text) to authenticated;
