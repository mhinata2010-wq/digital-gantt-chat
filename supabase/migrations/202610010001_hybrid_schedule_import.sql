-- Hybrid schedule import and user-adjustable network layout.
-- OCR/AI results stay reviewable until apply_schedule_import is called.

alter table public.tasks
  add column if not exists building text not null default '',
  add column if not exists floor text not null default '',
  add column if not exists source_kind text not null default 'manual',
  add column if not exists source_ref text not null default '';

create table if not exists public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_name text not null default '',
  source_kind text not null check(source_kind in ('excel','csv','tsv','pdf-reader','ai','manual')),
  row_count integer not null default 0 check(row_count between 0 and 500),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.network_task_layouts (
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid primary key references public.tasks(id) on delete cascade,
  x numeric not null,
  y numeric not null,
  pinned boolean not null default true,
  updated_by uuid not null default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now(),
  check(x between 0 and 20000 and y between 0 and 20000)
);
create index if not exists schedule_imports_project_idx on public.schedule_imports(project_id,created_at desc);
create index if not exists network_task_layouts_project_idx on public.network_task_layouts(project_id);

alter table public.schedule_imports enable row level security;
alter table public.network_task_layouts enable row level security;
revoke all on public.schedule_imports,public.network_task_layouts from public,anon;
grant select on public.schedule_imports to authenticated;
grant select,insert,update,delete on public.network_task_layouts to authenticated;

drop policy if exists schedule_imports_read_member on public.schedule_imports;
create policy schedule_imports_read_member on public.schedule_imports for select to authenticated using(private.is_project_member(project_id));
drop policy if exists network_layout_read_member on public.network_task_layouts;
drop policy if exists network_layout_insert_editor on public.network_task_layouts;
drop policy if exists network_layout_update_editor on public.network_task_layouts;
drop policy if exists network_layout_delete_editor on public.network_task_layouts;
create policy network_layout_read_member on public.network_task_layouts for select to authenticated using(private.is_project_member(project_id));
create policy network_layout_insert_editor on public.network_task_layouts for insert to authenticated with check(private.project_role_for(project_id) in ('owner','editor'));
create policy network_layout_update_editor on public.network_task_layouts for update to authenticated using(private.project_role_for(project_id) in ('owner','editor')) with check(private.project_role_for(project_id) in ('owner','editor'));
create policy network_layout_delete_editor on public.network_task_layouts for delete to authenticated using(private.project_role_for(project_id) in ('owner','editor'));

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
      planned_start,planned_finish,building,floor,source_kind,source_ref)
    values(created_id,p_project_id,coalesce((item->>'position')::integer,0),item_code,left(coalesce(item->>'trade',''),80),trim(item->>'name'),
      left(coalesce(item->>'company',''),160),(item->>'duration_days')::integer,'{}','未着手',
      left('取込元: '||coalesce(p_source_name,'')||' / 行: '||coalesce(item->>'source_row',''),500),
      nullif(item->>'start_date','')::date,nullif(item->>'finish_date','')::date,left(coalesce(item->>'building',''),80),
      left(coalesce(item->>'floor',''),80),p_source_kind,left(coalesce(item->>'source_row',''),120));
  end loop;

  for item in select value from jsonb_array_elements(p_rows) loop
    item_code=upper(trim(item->>'code'));
    select coalesce(array_agg((id_map->>upper(value))::uuid),'{}'::uuid[]) into dependency_ids
      from jsonb_array_elements_text(coalesce(item->'predecessor_codes','[]'::jsonb)) where id_map ? upper(value);
    update public.tasks set dependencies=dependency_ids where id=(id_map->>item_code)::uuid;
  end loop;
  return jsonb_build_object('import_id',imported_id,'count',count_rows);
end $$;
revoke all on function public.apply_schedule_import(uuid,text,text,jsonb) from public;
grant execute on function public.apply_schedule_import(uuid,text,text,jsonb) to authenticated;

create or replace function public.reset_network_layout(p_project_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if private.project_role_for(p_project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501';end if;
  delete from public.network_task_layouts where project_id=p_project_id;get diagnostics removed=row_count;return removed;
end $$;
revoke all on function public.reset_network_layout(uuid) from public;
grant execute on function public.reset_network_layout(uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.network_task_layouts;exception when duplicate_object then null;end $$;
