-- Security hardening found during the 2026-10-01 application audit.
-- Apply after 202610010003_event_network_layout.sql.

-- Weather changes were added after the original one-value CHECK constraint.
alter table public.schedule_change_requests
  drop constraint if exists schedule_change_requests_change_type_check;
alter table public.schedule_change_requests
  add constraint schedule_change_requests_change_type_check
  check(change_type in ('duration_delay','weather_delay'));

-- Never trust actor columns supplied through the public Data API.
create or replace function private.force_task_creator()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if tg_op='INSERT' then new.created_by=auth.uid();else new.created_by=old.created_by;end if;
  return new;
end $$;
revoke all on function private.force_task_creator() from public,anon,authenticated;
drop trigger if exists force_task_creator on public.tasks;
create trigger force_task_creator before insert or update on public.tasks
for each row execute function private.force_task_creator();

create or replace function private.force_management_actor()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if tg_op='INSERT' then
    new.created_by=auth.uid();new.created_at=now();
  else
    new.created_by=old.created_by;new.created_at=old.created_at;
  end if;
  new.updated_by=auth.uid();new.updated_at=now();
  return new;
end $$;
revoke all on function private.force_management_actor() from public,anon,authenticated;
drop trigger if exists force_management_actor on public.management_items;
create trigger force_management_actor before insert or update on public.management_items
for each row execute function private.force_management_actor();

create or replace function private.guard_network_task_layout()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if not exists(select 1 from public.tasks t where t.id=new.task_id and t.project_id=new.project_id and t.archived_at is null) then
    raise exception 'layout task must belong to the same active project';
  end if;
  if tg_op='UPDATE' then new.task_id=old.task_id;end if;
  new.updated_by=auth.uid();new.updated_at=now();return new;
end $$;
revoke all on function private.guard_network_task_layout() from public,anon,authenticated;
drop trigger if exists guard_network_task_layout on public.network_task_layouts;
create trigger guard_network_task_layout before insert or update on public.network_task_layouts
for each row execute function private.guard_network_task_layout();

create or replace function private.guard_network_event_layout()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if char_length(new.event_key) not between 1 and 120 then raise exception 'invalid event key';end if;
  if tg_op='UPDATE' then new.project_id=old.project_id;new.event_key=old.event_key;end if;
  new.updated_by=auth.uid();new.updated_at=now();return new;
end $$;
revoke all on function private.guard_network_event_layout() from public,anon,authenticated;
drop trigger if exists guard_network_event_layout on public.network_event_layouts;
create trigger guard_network_event_layout before insert or update on public.network_event_layouts
for each row execute function private.guard_network_event_layout();

-- File bytes must now pass through upload-project-file before reaching Storage.
-- Members retain read access through short-lived signed URLs.
drop policy if exists project_files_insert_editor on storage.objects;
drop policy if exists project_files_update_editor on storage.objects;
drop policy if exists project_files_delete_editor on storage.objects;
