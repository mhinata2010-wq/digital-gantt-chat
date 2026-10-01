-- Weather-aware schedule changes. Keeps the proposal/review flow atomic.

create or replace function private.guard_schedule_change_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare current_task public.tasks;requested_duration integer;blocked_value text;
begin
  if tg_op='INSERT' then
    if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
    select * into current_task from public.tasks where id=new.task_id and archived_at is null for share;
    if not found then raise exception 'active task not found';end if;
    if new.project_id is distinct from current_task.project_id then raise exception 'task must belong to project';end if;
    if private.project_role_for(current_task.project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501';end if;
    if new.proposed_by is distinct from auth.uid() then raise exception 'proposed_by must be current user' using errcode='42501';end if;
    if new.status<>'pending' or new.reviewed_by is not null or new.reviewed_at is not null or new.review_comment<>'' then raise exception 'new request must be pending and unreviewed';end if;
    if new.expected_task_version<>current_task.version then raise exception 'task version conflict' using errcode='40001';end if;
    if new.change_type not in ('duration_delay','weather_delay') then raise exception 'unsupported schedule change type';end if;
    if not(new.proposed_patch ? 'duration_days') or exists(select 1 from jsonb_object_keys(new.proposed_patch) as p(key_name) where p.key_name not in ('duration_days','blocked_dates')) then raise exception 'unsupported schedule patch';end if;
    if new.change_type='duration_delay' and new.proposed_patch ? 'blocked_dates' then raise exception 'duration delay cannot change blocked dates';end if;
    begin requested_duration=(new.proposed_patch->>'duration_days')::integer;exception when others then raise exception 'invalid duration_days';end;
    if requested_duration not between 1 and 365 then raise exception 'duration_days must be between 1 and 365';end if;
    if new.change_type='weather_delay' then
      if jsonb_typeof(coalesce(new.proposed_patch->'blocked_dates','[]'::jsonb))<>'array' then raise exception 'blocked_dates must be an array';end if;
      for blocked_value in select value from jsonb_array_elements_text(coalesce(new.proposed_patch->'blocked_dates','[]'::jsonb)) loop begin perform blocked_value::date;exception when others then raise exception 'invalid blocked date';end;end loop;
    end if;
    new.before_data=to_jsonb(current_task);new.updated_at=now();return new;
  end if;
  if new.project_id is distinct from old.project_id or new.task_id is distinct from old.task_id or new.expected_task_version is distinct from old.expected_task_version or new.change_type is distinct from old.change_type or new.proposed_patch is distinct from old.proposed_patch or new.before_data is distinct from old.before_data or new.impact_data is distinct from old.impact_data or new.reason is distinct from old.reason or new.proposed_by is distinct from old.proposed_by or new.created_at is distinct from old.created_at then raise exception 'proposal fields are immutable after submission';end if;
  if private.project_role_for(old.project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501';end if;
  if old.status<>'pending' or new.status not in ('approved','rejected') then raise exception 'only a pending request can be reviewed';end if;
  new.id=old.id;new.reviewed_by=auth.uid();new.reviewed_at=now();new.updated_at=now();return new;
end $$;
revoke all on function private.guard_schedule_change_request() from public,anon,authenticated;

create or replace function public.review_schedule_change_request(p_request_id uuid,p_decision text,p_review_comment text default '')
returns public.schedule_change_requests language plpgsql security definer set search_path='' as $$
declare request_row public.schedule_change_requests;current_task public.tasks;reviewed public.schedule_change_requests;requested_duration integer;requested_blocked date[];
begin
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected';end if;
  select * into request_row from public.schedule_change_requests where id=p_request_id for update;
  if not found then raise exception 'schedule change request not found';end if;
  if private.project_role_for(request_row.project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501';end if;
  if request_row.status<>'pending' then raise exception 'schedule change request is already reviewed' using errcode='40001';end if;
  if p_decision='approved' then
    select * into current_task from public.tasks where id=request_row.task_id and project_id=request_row.project_id and archived_at is null for update;
    if not found then raise exception 'active task not found';end if;
    if current_task.version<>request_row.expected_task_version then raise exception 'task version conflict' using errcode='40001';end if;
    requested_duration=(request_row.proposed_patch->>'duration_days')::integer;
    if request_row.change_type='weather_delay' then select coalesce(array_agg(value::date),'{}'::date[]) into requested_blocked from jsonb_array_elements_text(coalesce(request_row.proposed_patch->'blocked_dates','[]'::jsonb));else requested_blocked=current_task.blocked_dates;end if;
    update public.tasks set duration_days=requested_duration,blocked_dates=requested_blocked,version=version+1,updated_by=auth.uid() where id=current_task.id and version=request_row.expected_task_version;
    if not found then raise exception 'task version conflict' using errcode='40001';end if;
  end if;
  update public.schedule_change_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_comment=coalesce(p_review_comment,''),updated_at=now() where id=request_row.id returning * into reviewed;
  return reviewed;
end $$;
revoke all on function public.review_schedule_change_request(uuid,text,text) from public,anon;
grant execute on function public.review_schedule_change_request(uuid,text,text) to authenticated;
