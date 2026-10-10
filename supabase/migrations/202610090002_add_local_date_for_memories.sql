-- Upgrade databases created before local calendar dates were introduced.
-- Existing records belong to the user's current Asia/Shanghai-based journal;
-- future writes persist their actual IANA timezone per entry.

alter table public.entries add column if not exists local_date date;
alter table public.entries add column if not exists timezone text;

update public.entries
set
  timezone = coalesce(timezone, 'Asia/Shanghai'),
  local_date = coalesce(local_date, (occurred_at at time zone 'Asia/Shanghai')::date)
where timezone is null or local_date is null;

alter table public.entries alter column local_date set not null;
alter table public.entries alter column timezone set not null;

alter table public.entries drop constraint if exists entries_timezone_check;
alter table public.entries add constraint entries_timezone_check
  check (char_length(timezone) between 1 and 100);

drop function if exists public.create_entry(uuid, uuid, timestamptz, text, text, text);

create or replace function public.create_entry(
  p_entry_id uuid,
  p_operation_id uuid,
  p_occurred_at timestamptz,
  p_local_date date,
  p_timezone text,
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
  if char_length(p_timezone) not between 1 and 100 then raise exception 'invalid_timezone'; end if;
  if char_length(btrim(p_content)) not between 1 and 20000 then raise exception 'invalid_content'; end if;

  v_hash := md5(jsonb_build_object(
    'entry_id', p_entry_id, 'occurred_at', p_occurred_at, 'local_date', p_local_date,
    'timezone', p_timezone, 'source', p_source, 'mode', p_mode, 'content', btrim(p_content)
  )::text);

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

  insert into public.entries (id, user_id, occurred_at, local_date, timezone, source, mode)
  values (p_entry_id, v_user_id, p_occurred_at, p_local_date, p_timezone, p_source, p_mode);

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

revoke execute on function public.create_entry(uuid, uuid, timestamptz, date, text, text, text, text) from public, anon;
grant execute on function public.create_entry(uuid, uuid, timestamptz, date, text, text, text, text) to authenticated;
