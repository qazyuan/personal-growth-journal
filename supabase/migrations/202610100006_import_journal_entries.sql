create table if not exists public.import_batches (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_file_name text not null check (char_length(source_file_name) between 1 and 255),
  source_file_sha256 text not null check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  total_rows integer not null check (total_rows between 0 and 1000),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, source_file_sha256)
);

create table if not exists public.entry_import_sources (
  entry_id uuid primary key references public.entries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  source_kind text not null default 'excel_diary_tab_3' check (source_kind = 'excel_diary_tab_3'),
  source_row integer not null check (source_row >= 2),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_updated_at timestamptz,
  address text,
  tags text,
  imported_at timestamptz not null default now(),
  unique (user_id, source_fingerprint)
);

create index if not exists entry_import_sources_user_idx
  on public.entry_import_sources (user_id, imported_at desc);

alter table public.import_batches enable row level security;
alter table public.entry_import_sources enable row level security;

revoke all on table public.import_batches, public.entry_import_sources from anon, authenticated;
grant select on table public.import_batches, public.entry_import_sources to authenticated;

create policy "Read own import batches" on public.import_batches
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Read own import sources" on public.entry_import_sources
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.import_journal_entries(
  p_batch_id uuid,
  p_source_file_name text,
  p_source_file_sha256 text,
  p_timezone text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.import_batches%rowtype;
  v_row jsonb;
  v_entry_id uuid;
  v_total integer;
  v_imported integer := 0;
  v_duplicate integer := 0;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_batch_id is null then raise exception 'invalid_batch_id'; end if;
  if char_length(p_source_file_name) not between 1 and 255 then raise exception 'invalid_source_file_name'; end if;
  if p_source_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_source_hash'; end if;
  if char_length(p_timezone) not between 1 and 100 then raise exception 'invalid_timezone'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total not between 1 and 1000 then raise exception 'invalid_row_count'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':journal-import:' || p_source_file_sha256, 0)
  );

  select * into v_existing
  from public.import_batches
  where user_id = v_user_id and source_file_sha256 = p_source_file_sha256;

  if found then
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'total_rows', v_existing.total_rows,
      'imported_rows', v_existing.imported_rows,
      'duplicate_rows', v_existing.duplicate_rows,
      'replayed', true
    );
  end if;

  insert into public.import_batches (
    id, user_id, source_file_name, source_file_sha256, total_rows
  ) values (
    p_batch_id, v_user_id, p_source_file_name, p_source_file_sha256, v_total
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row->>'fingerprint', '') !~ '^[0-9a-f]{64}$'
      or char_length(btrim(coalesce(v_row->>'content', ''))) not between 1 and 20000
      or coalesce((v_row->>'source_row')::integer, 0) < 2
    then
      raise exception 'invalid_import_row';
    end if;

    if exists (
      select 1 from public.entry_import_sources
      where user_id = v_user_id and source_fingerprint = v_row->>'fingerprint'
    ) then
      v_duplicate := v_duplicate + 1;
      continue;
    end if;

    begin
      v_entry_id := pg_catalog.gen_random_uuid();
      insert into public.entries (
        id, user_id, occurred_at, local_date, timezone, source, mode
      ) values (
        v_entry_id,
        v_user_id,
        (v_row->>'occurred_at')::timestamptz,
        (v_row->>'local_date')::date,
        p_timezone,
        'import',
        'record_only'
      );

      insert into public.entry_revisions (entry_id, user_id, revision, content)
      values (v_entry_id, v_user_id, 1, btrim(v_row->>'content'));

      insert into public.entry_import_sources (
        entry_id, user_id, batch_id, source_row, source_fingerprint,
        source_updated_at, address, tags
      ) values (
        v_entry_id,
        v_user_id,
        p_batch_id,
        (v_row->>'source_row')::integer,
        v_row->>'fingerprint',
        case when nullif(v_row->>'source_updated_at', '') is null then null else (v_row->>'source_updated_at')::timestamptz end,
        nullif(v_row->>'address', ''),
        nullif(v_row->>'tags', '')
      );
      v_imported := v_imported + 1;
    exception when unique_violation then
      v_duplicate := v_duplicate + 1;
    end;
  end loop;

  update public.import_batches
  set imported_rows = v_imported, duplicate_rows = v_duplicate
  where id = p_batch_id and user_id = v_user_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'total_rows', v_total,
    'imported_rows', v_imported,
    'duplicate_rows', v_duplicate,
    'replayed', false
  );
end;
$$;

revoke execute on function public.import_journal_entries(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.import_journal_entries(uuid, text, text, text, jsonb) to authenticated;
