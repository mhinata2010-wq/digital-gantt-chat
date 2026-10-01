-- Architect-facing schedule inputs from the reference workbook.
-- Keeps productivity, staffing, cost weighting and planning assumptions editable.

alter table public.projects
  add column if not exists structure_scale text not null default '' check(char_length(structure_scale)<=240),
  add column if not exists holiday_policy text not null default '' check(char_length(holiday_policy)<=240),
  add column if not exists weather_allowance jsonb not null default '{}'::jsonb check(jsonb_typeof(weather_allowance)='object'),
  add column if not exists network_grouping_mode text not null default 'auto' check(network_grouping_mode in ('auto','building','floor','building_floor','none')),
  add column if not exists preflight_completed text[] not null default '{}';

alter table public.tasks
  add column if not exists quantity numeric check(quantity is null or quantity>=0),
  add column if not exists unit text not null default '' check(char_length(unit)<=24),
  add column if not exists daily_output numeric check(daily_output is null or daily_output>=0),
  add column if not exists crew_count integer check(crew_count is null or crew_count between 0 and 999),
  add column if not exists people_per_crew numeric check(people_per_crew is null or people_per_crew between 0 and 999),
  add column if not exists cost_thousands numeric check(cost_thousands is null or cost_thousands>=0);

revoke update on public.tasks from authenticated;
grant update(position,code,trade,name,company,duration_days,dependencies,blocked_dates,notes,version,archived_at,
  building,floor,quantity,unit,daily_output,crew_count,people_per_crew,cost_thousands) on public.tasks to authenticated;

create or replace view public.project_overview with (security_invoker=true) as
select p.id,p.owner_id,p.name,p.manager,p.start_date,p.deadline,p.holidays,p.revision,p.created_at,p.updated_at,
  private.project_role_for(p.id) as current_role,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null) as task_count,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null and (t.status='完了' or t.progress_percent=100)) as completed_count,
  p.site_name,p.client_name,p.designer,p.contractor,p.approver,
  p.structure_scale,p.holiday_policy,p.weather_allowance,p.network_grouping_mode,p.preflight_completed,
  (select coalesce(round(avg(t.progress_percent)),0)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null) as progress_percent,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null and t.progress_percent<100 and coalesce(t.planned_finish,p.deadline)<current_date) as delayed_count,
  (select count(*)::integer from public.management_items i where i.project_id=p.id and i.status<>'完了' and i.due_date<current_date) as overdue_item_count,
  (select max(t.last_reported_at) from public.tasks t where t.project_id=p.id and t.archived_at is null) as last_reported_at,
  (select count(*)::integer from public.schedule_change_requests r where r.project_id=p.id and r.status='pending') as pending_change_count,
  (select count(*)::integer from public.notifications n where n.project_id=p.id and n.user_id=auth.uid() and n.read_at is null) as unread_count
from public.projects p;

create or replace function public.apply_schedule_import(p_project_id uuid,p_source_name text,p_source_kind text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item jsonb; imported_id uuid; created_id uuid; id_map jsonb='{}'::jsonb; dependency_ids uuid[]; count_rows integer;
  item_code text; item_name text; item_duration integer;
begin
  if private.project_role_for(p_project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'rows must be an array'; end if;
  select coalesce(jsonb_object_agg(upper(code),id::text),'{}'::jsonb) into id_map from public.tasks where project_id=p_project_id and archived_at is null;
  count_rows=jsonb_array_length(p_rows);
  if count_rows<1 or count_rows>500 then raise exception 'import row count must be between 1 and 500'; end if;
  if p_source_kind not in ('excel','csv','tsv','pdf-reader','ai','manual') then raise exception 'unsupported source kind'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    item_code=upper(trim(item->>'code'));item_name=trim(item->>'name');item_duration=(item->>'duration_days')::integer;
    if item_code='' or char_length(item_code)>12 or item_name='' or item_duration not between 1 and 365 then raise exception 'invalid import row: %',item;end if;
    if id_map ? item_code or exists(select 1 from public.tasks where project_id=p_project_id and archived_at is null and upper(code)=item_code) then raise exception 'duplicate task code: %',item_code;end if;
    created_id=gen_random_uuid();id_map=id_map||jsonb_build_object(item_code,created_id::text);
  end loop;
  insert into public.schedule_imports(project_id,source_name,source_kind,row_count)
  values(p_project_id,left(coalesce(p_source_name,''),240),p_source_kind,count_rows) returning id into imported_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    item_code=upper(trim(item->>'code'));created_id=(id_map->>item_code)::uuid;
    insert into public.tasks(id,project_id,position,code,trade,name,company,duration_days,dependencies,status,notes,
      planned_start,planned_finish,building,floor,quantity,unit,daily_output,crew_count,people_per_crew,cost_thousands,source_kind,source_ref)
    values(created_id,p_project_id,coalesce((item->>'position')::integer,0),item_code,left(coalesce(item->>'trade',''),80),trim(item->>'name'),
      left(coalesce(item->>'company',''),160),(item->>'duration_days')::integer,'{}','未着手',
      left('取込元: '||coalesce(p_source_name,'')||' / 行: '||coalesce(item->>'source_row',''),500),
      nullif(item->>'start_date','')::date,nullif(item->>'finish_date','')::date,left(coalesce(item->>'building',''),80),
      left(coalesce(item->>'floor',''),80),nullif(item->>'quantity','')::numeric,left(coalesce(item->>'unit',''),24),
      nullif(item->>'daily_output','')::numeric,nullif(item->>'crew_count','')::integer,nullif(item->>'people_per_crew','')::numeric,
      nullif(item->>'cost_thousands','')::numeric,p_source_kind,left(coalesce(item->>'source_row',''),120));
  end loop;
  for item in select value from jsonb_array_elements(p_rows) loop
    item_code=upper(trim(item->>'code'));
    select coalesce(array_agg((id_map->>upper(value))::uuid),'{}'::uuid[]) into dependency_ids
      from jsonb_array_elements_text(coalesce(item->'predecessor_codes','[]'::jsonb)) where id_map ? upper(value);
    update public.tasks set dependencies=dependency_ids where id=(id_map->>item_code)::uuid;
  end loop;
  return jsonb_build_object('import_id',imported_id,'count',count_rows);
end $$;
revoke all on function public.apply_schedule_import(uuid,text,text,jsonb) from public,anon;
grant execute on function public.apply_schedule_import(uuid,text,text,jsonb) to authenticated;

-- Restore every schedule-defining field while deliberately preserving live reports,
-- actual dates and attachments for tasks that already exist.
create or replace function private.restore_schedule_version_rows(p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid; snapshot record;
begin
  select project_id into pid from public.schedule_versions where id=p_version_id;
  update public.tasks set archived_at=now() where project_id=pid and archived_at is null;
  for snapshot in select * from public.schedule_version_tasks where version_id=p_version_id order by position loop
    insert into public.tasks(id,project_id,position,code,trade,name,company,duration_days,dependencies,blocked_dates,status,notes,version,created_by,updated_by,created_at,updated_at,
      planned_start,planned_finish,actual_start,actual_finish,progress_percent,remaining_days,delay_reason,delay_category,next_action,last_reporter,last_reported_at,inspection_status,notify_next,archived_at,
      building,floor,quantity,unit,daily_output,crew_count,people_per_crew,cost_thousands,source_kind,source_ref)
    values(snapshot.task_id,snapshot.project_id,snapshot.position,
      snapshot.task_snapshot->>'code',coalesce(snapshot.task_snapshot->>'trade',''),snapshot.task_snapshot->>'name',coalesce(snapshot.task_snapshot->>'company',''),
      (snapshot.task_snapshot->>'duration_days')::integer,coalesce(array(select jsonb_array_elements_text(snapshot.task_snapshot->'dependencies'))::uuid[],'{}'),
      coalesce(array(select jsonb_array_elements_text(snapshot.task_snapshot->'blocked_dates'))::date[],'{}'),
      coalesce(snapshot.task_snapshot->>'status','未着手'),coalesce(snapshot.task_snapshot->>'notes',''),1,auth.uid(),auth.uid(),now(),now(),
      snapshot.planned_start,snapshot.planned_finish,snapshot.actual_start,snapshot.actual_finish,coalesce((snapshot.task_snapshot->>'progress_percent')::integer,0),
      (snapshot.task_snapshot->>'remaining_days')::integer,coalesce(snapshot.task_snapshot->>'delay_reason',''),coalesce(snapshot.task_snapshot->>'delay_category','未分類'),
      coalesce(snapshot.task_snapshot->>'next_action',''),null,null,coalesce(snapshot.task_snapshot->>'inspection_status','未確認'),coalesce((snapshot.task_snapshot->>'notify_next')::boolean,false),null,
      coalesce(snapshot.task_snapshot->>'building',''),coalesce(snapshot.task_snapshot->>'floor',''),nullif(snapshot.task_snapshot->>'quantity','')::numeric,
      coalesce(snapshot.task_snapshot->>'unit',''),nullif(snapshot.task_snapshot->>'daily_output','')::numeric,nullif(snapshot.task_snapshot->>'crew_count','')::integer,
      nullif(snapshot.task_snapshot->>'people_per_crew','')::numeric,nullif(snapshot.task_snapshot->>'cost_thousands','')::numeric,
      coalesce(snapshot.task_snapshot->>'source_kind','manual'),coalesce(snapshot.task_snapshot->>'source_ref',''))
    on conflict(id) do update set
      position=excluded.position,code=excluded.code,trade=excluded.trade,name=excluded.name,company=excluded.company,
      duration_days=excluded.duration_days,dependencies=excluded.dependencies,blocked_dates=excluded.blocked_dates,status=excluded.status,
      notes=excluded.notes,planned_start=excluded.planned_start,planned_finish=excluded.planned_finish,archived_at=null,
      building=excluded.building,floor=excluded.floor,quantity=excluded.quantity,unit=excluded.unit,daily_output=excluded.daily_output,
      crew_count=excluded.crew_count,people_per_crew=excluded.people_per_crew,cost_thousands=excluded.cost_thousands,
      source_kind=excluded.source_kind,source_ref=excluded.source_ref;
  end loop;
end $$;
revoke all on function private.restore_schedule_version_rows(uuid) from public,anon,authenticated;
