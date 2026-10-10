-- Multi-turn reflection conversations remain separate from immutable journal revisions.

create table if not exists public.reflection_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  entry_revision integer not null check (entry_revision >= 1),
  status text not null default 'active' check (status in ('active', 'closed')),
  pending_user_message_id uuid,
  pending_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, entry_revision)
);

create table if not exists public.reflection_messages (
  id uuid primary key,
  conversation_id uuid not null references public.reflection_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  sequence integer not null check (sequence >= 1),
  reply_to_message_id uuid references public.reflection_messages (id) on delete set null,
  provider text,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence)
);

create unique index if not exists reflection_messages_reply_idx
  on public.reflection_messages (reply_to_message_id)
  where reply_to_message_id is not null;
create index if not exists reflection_messages_conversation_idx
  on public.reflection_messages (conversation_id, sequence);

alter table public.reflection_conversations enable row level security;
alter table public.reflection_messages enable row level security;
revoke all on table public.reflection_conversations, public.reflection_messages from anon, authenticated;
grant select on table public.reflection_conversations, public.reflection_messages to authenticated;

create policy "Read own reflection conversations" on public.reflection_conversations
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Read own reflection messages" on public.reflection_messages
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.start_reflection_turn(
  p_entry_id uuid,
  p_message_id uuid,
  p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision integer;
  v_entry_content text;
  v_analysis jsonb;
  v_conversation public.reflection_conversations%rowtype;
  v_sequence integer;
  v_existing_role text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(btrim(p_content)) not between 1 and 4000 then raise exception 'invalid_message'; end if;

  select e.current_revision, er.content, ar.result
  into v_revision, v_entry_content, v_analysis
  from public.entries e
  join public.entry_revisions er on er.entry_id = e.id and er.revision = e.current_revision
  join public.analysis_requests aq on aq.entry_id = e.id and aq.entry_revision = e.current_revision and aq.status = 'completed'
  join public.analysis_results ar on ar.request_id = aq.id
  where e.id = p_entry_id and e.user_id = v_user_id and e.status = 'active';

  if not found then raise exception 'completed_analysis_required'; end if;

  insert into public.reflection_conversations (user_id, entry_id, entry_revision)
  values (v_user_id, p_entry_id, v_revision)
  on conflict (entry_id, entry_revision) do nothing;

  select * into v_conversation
  from public.reflection_conversations
  where entry_id = p_entry_id and entry_revision = v_revision and user_id = v_user_id
  for update;

  if v_conversation.status <> 'active' then raise exception 'conversation_closed'; end if;
  if v_conversation.pending_user_message_id is not null
     and v_conversation.pending_user_message_id <> p_message_id
     and v_conversation.pending_started_at > pg_catalog.now() - interval '90 seconds' then
    raise exception 'conversation_busy';
  end if;

  select role into v_existing_role from public.reflection_messages
  where id = p_message_id and conversation_id = v_conversation.id and user_id = v_user_id;

  if found then
    if v_existing_role <> 'user' then raise exception 'message_id_conflict'; end if;
    if exists (select 1 from public.reflection_messages where reply_to_message_id = p_message_id) then
      return jsonb_build_object('status', 'completed', 'conversationId', v_conversation.id);
    end if;
  else
    select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.reflection_messages where conversation_id = v_conversation.id;
    insert into public.reflection_messages (id, conversation_id, user_id, role, content, sequence)
    values (p_message_id, v_conversation.id, v_user_id, 'user', btrim(p_content), v_sequence);
  end if;

  update public.reflection_conversations
  set pending_user_message_id = p_message_id, pending_started_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = v_conversation.id;

  return jsonb_build_object(
    'status', 'started', 'conversationId', v_conversation.id,
    'entryContent', v_entry_content, 'analysis', v_analysis
  );
end;
$$;

create or replace function public.complete_reflection_turn(
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_content text,
  p_provider text,
  p_model text,
  p_prompt_version text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.reflection_conversations%rowtype;
  v_sequence integer;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(btrim(p_content)) not between 1 and 4000 then raise exception 'invalid_message'; end if;

  select * into v_conversation from public.reflection_conversations
  where id = p_conversation_id and user_id = v_user_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if exists (select 1 from public.reflection_messages where reply_to_message_id = p_user_message_id) then return; end if;
  if v_conversation.pending_user_message_id <> p_user_message_id then raise exception 'turn_not_pending'; end if;

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.reflection_messages where conversation_id = p_conversation_id;
  insert into public.reflection_messages (
    id, conversation_id, user_id, role, content, sequence, reply_to_message_id, provider, model, prompt_version
  ) values (
    p_assistant_message_id, p_conversation_id, v_user_id, 'assistant', btrim(p_content), v_sequence,
    p_user_message_id, p_provider, p_model, p_prompt_version
  );
  update public.reflection_conversations
  set pending_user_message_id = null, pending_started_at = null, updated_at = pg_catalog.now()
  where id = p_conversation_id;
end;
$$;

create or replace function public.fail_reflection_turn(p_conversation_id uuid, p_user_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  update public.reflection_conversations
  set pending_user_message_id = null, pending_started_at = null, updated_at = pg_catalog.now()
  where id = p_conversation_id and user_id = v_user_id and pending_user_message_id = p_user_message_id;
end;
$$;

revoke execute on function public.start_reflection_turn(uuid, uuid, text) from public, anon;
revoke execute on function public.complete_reflection_turn(uuid, uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.fail_reflection_turn(uuid, uuid) from public, anon;
grant execute on function public.start_reflection_turn(uuid, uuid, text) to authenticated;
grant execute on function public.complete_reflection_turn(uuid, uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.fail_reflection_turn(uuid, uuid) to authenticated;
