-- Remove an entry from the active timeline without physically destroying its history.

create or replace function public.delete_entry(p_entry_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;

  update public.entries
  set status = 'deleted', deleted_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_entry_id and user_id = v_user_id and status = 'active';

  if not found then
    if exists (
      select 1 from public.entries
      where id = p_entry_id and user_id = v_user_id and status = 'deleted'
    ) then
      return jsonb_build_object('id', p_entry_id, 'status', 'deleted');
    end if;
    raise exception 'entry_not_found';
  end if;

  update public.analysis_requests
  set status = 'cancelled', updated_at = pg_catalog.now()
  where entry_id = p_entry_id and user_id = v_user_id and status in ('queued', 'running');

  update public.reflection_conversations
  set status = 'closed', pending_user_message_id = null, pending_started_at = null, updated_at = pg_catalog.now()
  where entry_id = p_entry_id and user_id = v_user_id and status = 'active';

  return jsonb_build_object('id', p_entry_id, 'status', 'deleted');
end;
$$;

revoke execute on function public.delete_entry(uuid) from public, anon;
grant execute on function public.delete_entry(uuid) to authenticated;
