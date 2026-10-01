-- Shared construction schedules: Auth + row-level project permissions + audit history.
-- Apply this migration to a new Supabase project before configuring config.js.

create extension if not exists pgcrypto;

do $$ begin
  create type public.project_role as enum ('owner','editor','viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 120),
  manager text not null default '',
  start_date date not null,
  deadline date,
  holidays date[] not null default '{}',
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  role public.project_role not null,
  invited_by uuid not null references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id,email),
  unique(project_id,user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  code text not null check (char_length(code) between 1 and 12),
  trade text not null default '',
  name text not null check (char_length(name) between 1 and 160),
  company text not null default '',
  duration_days integer not null default 1 check (duration_days between 1 and 365),
  dependencies uuid[] not null default '{}',
  blocked_dates date[] not null default '{}',
  status text not null default '未着手' check (status in ('未着手','進行中','完了','遅延')),
  notes text not null default '' check (char_length(notes) <= 500),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,code)
);

create table if not exists public.project_history (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null default '',
  entity_type text not null check (entity_type in ('project','task','member')),
  entity_id text not null,
  action text not null check (action in ('create','update','delete')),
  summary text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_members_user_id_idx on public.project_members(user_id);
create index if not exists project_members_project_id_idx on public.project_members(project_id);
create index if not exists project_members_email_idx on public.project_members(lower(email));
create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists history_project_id_created_idx on public.project_history(project_id,created_at desc);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.project_role_for(p_project_id uuid)
returns public.project_role
language sql
security definer
set search_path=''
stable
as $$
  select role from public.project_members
  where project_id=p_project_id and user_id=(select auth.uid())
  limit 1
$$;

create or replace function private.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path=''
stable
as $$
  select exists(
    select 1 from public.project_members
    where project_id=p_project_id and user_id=(select auth.uid())
  )
$$;

revoke execute on function private.project_role_for(uuid) from public;
revoke execute on function private.is_project_member(uuid) from public;
grant execute on function private.project_role_for(uuid),private.is_project_member(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,lower(coalesce(new.email,'')),coalesce(new.raw_user_meta_data->>'display_name',''))
  on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,updated_at=now();
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email,raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id,email,display_name)
select id,lower(coalesce(email,'')),coalesce(raw_user_meta_data->>'display_name','') from auth.users
on conflict(id) do nothing;

create or replace function public.claim_project_invitations()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare claimed integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.project_members
  set user_id=auth.uid(),accepted_at=coalesce(accepted_at,now())
  where user_id is null
    and lower(email)=lower(coalesce(auth.jwt()->>'email',''));
  get diagnostics claimed=row_count;
  return claimed;
end $$;

create or replace function public.create_project(p_name text,p_start_date date)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare project_id uuid; user_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(trim(p_name)) not between 1 and 120 then raise exception 'invalid project name'; end if;
  select email into user_email from public.profiles where id=auth.uid();
  insert into public.projects(owner_id,name,manager,start_date)
  values(auth.uid(),trim(p_name),(select display_name from public.profiles where id=auth.uid()),p_start_date)
  returning id into project_id;
  insert into public.project_members(project_id,user_id,email,role,invited_by,accepted_at)
  values(project_id,auth.uid(),user_email,'owner',auth.uid(),now());
  return project_id;
end $$;

create or replace function public.invite_project_member(p_project_id uuid,p_email text,p_role public.project_role)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare member_id uuid; matched_user uuid; normalized_email text:=lower(trim(p_email));
begin
  if private.project_role_for(p_project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  if p_role='owner' then raise exception 'owner role cannot be invited'; end if;
  if normalized_email='' then raise exception 'email required'; end if;
  select id into matched_user from public.profiles where lower(email)=normalized_email limit 1;
  insert into public.project_members(project_id,user_id,email,role,invited_by,accepted_at)
  values(p_project_id,matched_user,normalized_email,p_role,auth.uid(),case when matched_user is null then null else now() end)
  on conflict(project_id,email) do update set
    role=excluded.role,
    user_id=coalesce(public.project_members.user_id,excluded.user_id),
    accepted_at=coalesce(public.project_members.accepted_at,excluded.accepted_at)
  returning id into member_id;
  return member_id;
end $$;

revoke all on function public.claim_project_invitations(),public.create_project(text,date),public.invite_project_member(uuid,text,public.project_role) from public;
grant execute on function public.claim_project_invitations(),public.create_project(text,date),public.invite_project_member(uuid,text,public.project_role) to authenticated;

create or replace function private.guard_project()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.owner_id<>old.owner_id then raise exception 'owner_id is immutable'; end if;
  if tg_op='UPDATE' then
    new.id=old.id;new.created_at=old.created_at;new.revision=old.revision+1;
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists guard_project on public.projects;
create trigger guard_project before update on public.projects for each row execute function private.guard_project();

create or replace function private.guard_member()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
  select owner_id into owner from public.projects where id=coalesce(new.project_id,old.project_id);
  if tg_op='DELETE' and old.user_id=owner then raise exception 'owner membership cannot be deleted'; end if;
  if tg_op='UPDATE' and old.user_id=owner and (new.role<>'owner' or new.user_id is distinct from old.user_id) then raise exception 'owner membership cannot be changed'; end if;
  if tg_op<>'DELETE' and new.role='owner' and new.user_id is distinct from owner then raise exception 'only the project owner can have owner role'; end if;
  if tg_op<>'DELETE' then new.email=lower(trim(new.email)); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard_member on public.project_members;
create trigger guard_member before insert or update or delete on public.project_members for each row execute function private.guard_member();

create or replace function private.guard_task()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.project_id<>old.project_id then raise exception 'project_id is immutable'; end if;
  if new.id=any(new.dependencies) then raise exception 'task cannot depend on itself'; end if;
  if tg_op='UPDATE' then
    new.id=old.id;new.created_by=old.created_by;new.created_at=old.created_at;new.version=old.version+1;
  end if;
  new.updated_by=auth.uid();new.updated_at=now();
  return new;
end $$;
drop trigger if exists guard_task on public.tasks;
create trigger guard_task before insert or update on public.tasks for each row execute function private.guard_task();

create or replace function private.validate_task_dependencies()
returns trigger language plpgsql security definer set search_path='' as $$
declare dependency uuid;
begin
  foreach dependency in array new.dependencies loop
    if not exists(select 1 from public.tasks where id=dependency and project_id=new.project_id) then
      raise exception 'dependency must belong to the same project';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists validate_task_dependencies on public.tasks;
create constraint trigger validate_task_dependencies after insert or update on public.tasks
deferrable initially deferred for each row execute function private.validate_task_dependencies();

create or replace function private.write_history()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare pid uuid; eid text; label text; before_row jsonb; after_row jsonb;
begin
  before_row=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row=case when tg_op='DELETE' then null else to_jsonb(new) end;
  if tg_table_name='projects' then
    pid=coalesce(new.id,old.id);eid=pid::text;label=coalesce(new.name,old.name);
  elsif tg_table_name='tasks' then
    pid=coalesce(new.project_id,old.project_id);eid=coalesce(new.id,old.id)::text;label=coalesce(new.name,old.name);
  else
    pid=coalesce(new.project_id,old.project_id);eid=coalesce(new.id,old.id)::text;label=coalesce(new.email,old.email);
  end if;
  insert into public.project_history(project_id,actor_id,actor_email,entity_type,entity_id,action,summary,before_data,after_data)
  values(pid,auth.uid(),coalesce(auth.jwt()->>'email','system'),
    case tg_table_name when 'projects' then 'project' when 'tasks' then 'task' else 'member' end,
    eid,case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,label,before_row,after_row);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists audit_project on public.projects;
drop trigger if exists audit_task on public.tasks;
drop trigger if exists audit_member on public.project_members;
create trigger audit_project after update on public.projects for each row execute function private.write_history();
create trigger audit_task after insert or update or delete on public.tasks for each row execute function private.write_history();
create trigger audit_member after insert or update or delete on public.project_members for each row execute function private.write_history();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.project_history enable row level security;

revoke all on table public.profiles,public.projects,public.project_members,public.tasks,public.project_history from anon,authenticated;
grant select,update(display_name) on public.profiles to authenticated;
grant select,update,delete on public.projects to authenticated;
grant select,update,delete on public.project_members to authenticated;
grant select,insert,update,delete on public.tasks to authenticated;
grant select on public.project_history to authenticated;
grant usage,select on sequence public.project_history_id_seq to authenticated;

drop policy if exists profiles_read_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));

drop policy if exists projects_read_member on public.projects;
drop policy if exists projects_update_owner on public.projects;
drop policy if exists projects_delete_owner on public.projects;
create policy projects_read_member on public.projects for select to authenticated using (private.is_project_member(id));
create policy projects_update_owner on public.projects for update to authenticated using (private.project_role_for(id)='owner') with check (private.project_role_for(id)='owner');
create policy projects_delete_owner on public.projects for delete to authenticated using (private.project_role_for(id)='owner');

drop policy if exists members_read_member on public.project_members;
drop policy if exists members_update_owner on public.project_members;
drop policy if exists members_delete_owner on public.project_members;
create policy members_read_member on public.project_members for select to authenticated using (private.is_project_member(project_id));
create policy members_update_owner on public.project_members for update to authenticated using (private.project_role_for(project_id)='owner') with check (private.project_role_for(project_id)='owner');
create policy members_delete_owner on public.project_members for delete to authenticated using (private.project_role_for(project_id)='owner');

drop policy if exists tasks_read_member on public.tasks;
drop policy if exists tasks_insert_editor on public.tasks;
drop policy if exists tasks_update_editor on public.tasks;
drop policy if exists tasks_delete_editor on public.tasks;
create policy tasks_read_member on public.tasks for select to authenticated using (private.is_project_member(project_id));
create policy tasks_insert_editor on public.tasks for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor'));
create policy tasks_update_editor on public.tasks for update to authenticated using (private.project_role_for(project_id) in ('owner','editor')) with check (private.project_role_for(project_id) in ('owner','editor'));
create policy tasks_delete_editor on public.tasks for delete to authenticated using (private.project_role_for(project_id) in ('owner','editor'));

drop policy if exists history_read_member on public.project_history;
create policy history_read_member on public.project_history for select to authenticated using (private.is_project_member(project_id));

create or replace view public.project_overview
with (security_invoker=true)
as
select p.*,
  private.project_role_for(p.id) as current_role,
  (select count(*)::integer from public.tasks t where t.project_id=p.id) as task_count,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.status='完了') as completed_count
from public.projects p;

revoke all on public.project_overview from anon,authenticated;
grant select on public.project_overview to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.project_members;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.project_history;
exception when duplicate_object then null; end $$;
