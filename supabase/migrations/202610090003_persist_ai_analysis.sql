-- Persist model-independent AI analysis results and expose narrow, user-scoped RPCs.

alter table public.analysis_requests add column if not exists last_error_code text;
alter table public.analysis_requests add column if not exists started_at timestamptz;
alter table public.analysis_requests add column if not exists completed_at timestamptz;

create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null unique references public.analysis_requests (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  entry_revision integer not null check (entry_revision >= 1),
  provider text not null check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 160),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists analysis_results_user_entry_idx
  on public.analysis_results (user_id, entry_id, created_at desc);

alter table public.analysis_results enable row level security;
revoke all on table public.analysis_results from anon, authenticated;
grant select on table public.analysis_results to authenticated;

drop policy if exists "Read own analysis results" on public.analysis_results;
create policy "Read own analysis results" on public.analysis_results
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.start_analysis(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.analysis_requests%rowtype;
  v_content text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;

  select * into v_request
  from public.analysis_requests
  where entry_id = p_entry_id and user_id = v_user_id
  for update;

  if not found then raise exception 'analysis_not_requested'; end if;

  if v_request.status = 'completed' then
    select result into v_result from public.analysis_results where request_id = v_request.id;
    return jsonb_build_object(
      'status', 'completed', 'requestId', v_request.id, 'entryId', v_request.entry_id,
      'revision', v_request.entry_revision, 'result', v_result
    );
  end if;

  if v_request.status = 'running'
     and v_request.started_at > pg_catalog.now() - interval '90 seconds' then
    return jsonb_build_object(
      'status', 'running', 'requestId', v_request.id, 'entryId', v_request.entry_id,
      'revision', v_request.entry_revision
    );
  end if;

  select content into v_content
  from public.entry_revisions
  where entry_id = v_request.entry_id
    and user_id = v_user_id
    and revision = v_request.entry_revision;

  if v_content is null then raise exception 'entry_revision_not_found'; end if;

  update public.analysis_requests
  set status = 'running', attempts = attempts + 1, last_error_code = null,
      started_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'started', 'requestId', v_request.id, 'entryId', v_request.entry_id,
    'revision', v_request.entry_revision, 'content', v_content
  );
end;
$$;

create or replace function public.complete_analysis(
  p_request_id uuid,
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
  v_request public.analysis_requests%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  if char_length(p_provider) not between 1 and 80 then raise exception 'invalid_provider'; end if;
  if char_length(p_model) not between 1 and 160 then raise exception 'invalid_model'; end if;
  if char_length(p_prompt_version) not between 1 and 80 then raise exception 'invalid_prompt_version'; end if;

  select * into v_request
  from public.analysis_requests
  where id = p_request_id and user_id = v_user_id
  for update;
  if not found then raise exception 'analysis_not_found'; end if;

  insert into public.analysis_results (
    user_id, request_id, entry_id, entry_revision, provider, model, prompt_version, result
  ) values (
    v_user_id, v_request.id, v_request.entry_id, v_request.entry_revision,
    p_provider, p_model, p_prompt_version, p_result
  ) on conflict (request_id) do nothing;

  update public.analysis_requests
  set status = 'completed', completed_at = pg_catalog.now(), updated_at = pg_catalog.now(),
      last_error_code = null
  where id = v_request.id;

  return p_result;
end;
$$;

create or replace function public.fail_analysis(p_request_id uuid, p_error_code text)
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

  update public.analysis_requests
  set status = 'failed', last_error_code = p_error_code, updated_at = pg_catalog.now()
  where id = p_request_id and user_id = v_user_id;
  if not found then raise exception 'analysis_not_found'; end if;
end;
$$;

revoke execute on function public.start_analysis(uuid) from public, anon;
revoke execute on function public.complete_analysis(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.fail_analysis(uuid, text) from public, anon;
grant execute on function public.start_analysis(uuid) to authenticated;
grant execute on function public.complete_analysis(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.fail_analysis(uuid, text) to authenticated;
