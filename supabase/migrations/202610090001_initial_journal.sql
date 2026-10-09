create table if not exists public.entries (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  current_revision integer not null default 1 check (current_revision >= 1),
  occurred_at timestamptz not null,
  source text not null check (source in ('iphone', 'mac_web', 'ipad_web', 'import')),
  mode text not null check (mode in ('record_only', 'record_and_analyze')),
  status text not null default 'active' check (status in ('active', 'deleted')),
  ai_policy jsonb not null default '{"instant":true,"reviews":true}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entries_user_timeline_idx
  on public.entries (user_id, occurred_at desc, id desc);

create table if not exists public.entry_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  content_format text not null default 'plain_text' check (content_format = 'plain_text'),
  created_at timestamptz not null default now(),
  unique (entry_id, revision)
);

create index if not exists entry_revisions_entry_idx
  on public.entry_revisions (entry_id, revision desc);

create table if not exists public.analysis_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  entry_revision integer not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, entry_revision)
);

create table if not exists public.client_operations (
  user_id uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null,
  operation_type text not null,
  entity_id uuid not null,
  request_hash text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.entries enable row level security;
alter table public.entry_revisions enable row level security;
alter table public.analysis_requests enable row level security;
alter table public.client_operations enable row level security;

revoke all on table public.entries, public.entry_revisions, public.analysis_requests, public.client_operations from anon, authenticated;
grant select on table public.entries, public.entry_revisions, public.analysis_requests to authenticated;

create policy "Read own entries" on public.entries for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own revisions" on public.entry_revisions for select to authenticated using (user_id = (select auth.uid()));

create policy "Read own analysis requests" on public.analysis_requests for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.create_entry(
  p_entry_id uuid,
  p_operation_id uuid,
  p_occurred_at timestamptz,
  p_source text,
  p_mode text,
  p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_source not in ('iphone', 'mac_web', 'ipad_web', 'import') then raise exception 'invalid_source'; end if;
  if p_mode not in ('record_only', 'record_and_analyze') then raise exception 'invalid_mode'; end if;
  if char_length(btrim(p_content)) not between 1 and 20000 then raise exception 'invalid_content'; end if;

  v_hash := md5(jsonb_build_object(
    'entry_id', p_entry_id, 'occurred_at', p_occurred_at, 'source', p_source,
    'mode', p_mode, 'content', btrim(p_content)
  )::text);

  -- Serialize retries carrying the same user/operation pair before checking the ledger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_operation_id::text, 0)
  );

  select request_hash, response_json into v_existing_hash, v_existing_response
  from public.client_operations
  where user_id = v_user_id and operation_id = p_operation_id;

  if found then
    if v_existing_hash <> v_hash then raise exception 'operation_id_conflict'; end if;
    return v_existing_response;
  end if;

  insert into public.entries (id, user_id, occurred_at, source, mode)
  values (p_entry_id, v_user_id, p_occurred_at, p_source, p_mode);

  insert into public.entry_revisions (entry_id, user_id, revision, content)
  values (p_entry_id, v_user_id, 1, btrim(p_content));

  if p_mode = 'record_and_analyze' then
    insert into public.analysis_requests (user_id, entry_id, entry_revision)
    values (v_user_id, p_entry_id, 1);
  end if;

  v_response := jsonb_build_object('entry_id', p_entry_id, 'revision', 1);
  insert into public.client_operations (user_id, operation_id, operation_type, entity_id, request_hash, response_json)
  values (v_user_id, p_operation_id, 'create_entry', p_entry_id, v_hash, v_response);
  return v_response;
end;
$$;

revoke execute on function public.create_entry(uuid, uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.create_entry(uuid, uuid, timestamptz, text, text, text) to authenticated;
