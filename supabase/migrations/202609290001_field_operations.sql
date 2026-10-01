-- Field operations expansion: progress, reports, versions, files, issues, invitations and notifications.
-- Additive migration. Apply after 202609280001_collaboration.sql.

create extension if not exists pgcrypto;

alter table public.projects
  add column if not exists site_name text not null default '',
  add column if not exists client_name text not null default '',
  add column if not exists designer text not null default '',
  add column if not exists contractor text not null default '',
  add column if not exists approver text not null default '';

alter table public.tasks
  add column if not exists planned_start date,
  add column if not exists planned_finish date,
  add column if not exists actual_start date,
  add column if not exists actual_finish date,
  add column if not exists progress_percent integer not null default 0,
  add column if not exists remaining_days integer,
  add column if not exists delay_reason text not null default '',
  add column if not exists delay_category text not null default '未分類',
  add column if not exists next_action text not null default '',
  add column if not exists last_reporter uuid references public.profiles(id) on delete set null,
  add column if not exists last_reported_at timestamptz,
  add column if not exists inspection_status text not null default '未確認',
  add column if not exists notify_next boolean not null default false,
  add column if not exists archived_at timestamptz;

-- Soft deletion preserves reports, comments and files when a schedule version is restored.
alter table public.tasks drop constraint if exists tasks_project_id_code_key;
create unique index if not exists tasks_active_project_code_idx on public.tasks(project_id,code) where archived_at is null;

do $$ begin
  alter table public.tasks add constraint tasks_progress_percent_check check (progress_percent between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_remaining_days_check check (remaining_days is null or remaining_days between 0 and 3650);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_actual_dates_check check (actual_finish is null or actual_start is null or actual_finish >= actual_start);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_planned_dates_check check (planned_finish is null or planned_start is null or planned_finish >= planned_start);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_delay_category_check check (delay_category in ('未分類','天候','資材','人員','設計・承認','前工程','品質・是正','施主都合','その他'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_inspection_status_check check (inspection_status in ('未確認','自主検査済み','監理者確認済み','是正あり','是正完了'));
exception when duplicate_object then null; end $$;

update public.tasks
set progress_percent=case when status='完了' then 100 when status='進行中' then 25 else progress_percent end,
    remaining_days=case when status='完了' then 0 else coalesce(remaining_days,duration_days) end
where progress_percent=0 or remaining_days is null;

create table if not exists public.task_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  report_type text not null check (report_type in ('progress','complete','reopen')),
  progress_percent integer not null check (progress_percent between 0 and 100),
  actual_start date,
  actual_finish date,
  remaining_days integer check (remaining_days is null or remaining_days between 0 and 3650),
  comment text not null default '' check (char_length(comment)<=2000),
  delay_reason text not null default '' check (char_length(delay_reason)<=1000),
  delay_category text not null default '未分類',
  next_action text not null default '' check (char_length(next_action)<=1000),
  inspection_status text not null default '未確認',
  notify_next boolean not null default false,
  reporter_id uuid not null default auth.uid() references public.profiles(id),
  reporter_email text not null default coalesce(auth.jwt()->>'email',''),
  created_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  mentioned_user_ids uuid[] not null default '{}',
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  report_id uuid references public.task_reports(id) on delete set null,
  comment_id uuid references public.task_comments(id) on delete set null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  created_by uuid not null default auth.uid() references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null check (version_number>0),
  name text not null check (char_length(trim(name)) between 1 and 120),
  reason text not null default '' check (char_length(reason)<=1000),
  comment text not null default '' check (char_length(comment)<=2000),
  project_snapshot jsonb not null,
  is_baseline boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  confirmed_by uuid not null default auth.uid() references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(project_id,version_number)
);

create table if not exists public.schedule_version_tasks (
  version_id uuid not null references public.schedule_versions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null,
  position integer not null,
  task_snapshot jsonb not null,
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  primary key(version_id,task_id)
);

-- A proposal is deliberately separate from the live task. Editors can describe a
-- schedule change, but only the project owner can apply it to the canonical task.
create table if not exists public.schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  expected_task_version bigint not null check (expected_task_version>0),
  change_type text not null check (change_type in ('duration_delay')),
  proposed_patch jsonb not null check (jsonb_typeof(proposed_patch)='object'),
  before_data jsonb not null default '{}'::jsonb check (jsonb_typeof(before_data)='object'),
  impact_data jsonb not null default '{}'::jsonb check (jsonb_typeof(impact_data)='object'),
  reason text not null default '' check (char_length(reason)<=2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proposed_by uuid not null default auth.uid() references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_comment text not null default '' check (char_length(review_comment)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='pending' and reviewed_by is null and reviewed_at is null) or
         (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null))
);

create table if not exists public.management_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  item_type text not null check (item_type in ('資材発注','納品','施工図','承認図','質疑','施主承認','行政検査','社内検査','監理者検査','是正','その他')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  assignee_name text not null default '',
  company text not null default '',
  due_date date,
  status text not null default '未着手' check (status in ('未着手','対応中','確認待ち','承認済み','完了','保留')),
  priority text not null default '通常' check (priority in ('低','通常','高','緊急')),
  comment text not null default '' check (char_length(comment)<=2000),
  completed_at date,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.management_item_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  management_item_id uuid not null references public.management_items(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  created_by uuid not null default auth.uid() references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  management_item_id uuid references public.management_items(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null default '',
  severity text not null default 'normal' check (severity in ('normal','important','urgent')),
  target_hash text not null default '',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on public.notifications(user_id,dedupe_key) where dedupe_key is not null;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  in_app boolean not null default true,
  email boolean not null default false,
  browser boolean not null default false,
  line boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  role public.project_role not null check (role<>'owner'),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists project_invitations_active_email_idx on public.project_invitations(project_id,lower(email)) where accepted_at is null and revoked_at is null;

create table if not exists public.user_project_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(user_id,project_id)
);

create index if not exists task_reports_task_created_idx on public.task_reports(task_id,created_at desc);
create index if not exists task_comments_task_created_idx on public.task_comments(task_id,created_at desc) where deleted_at is null;
create index if not exists task_attachments_task_created_idx on public.task_attachments(task_id,created_at desc) where deleted_at is null;
create index if not exists schedule_versions_project_idx on public.schedule_versions(project_id,version_number desc);
create index if not exists schedule_change_requests_project_status_idx on public.schedule_change_requests(project_id,status,created_at desc);
create index if not exists schedule_change_requests_task_status_idx on public.schedule_change_requests(task_id,status,created_at desc);
create index if not exists management_items_project_due_idx on public.management_items(project_id,due_date,status);
create index if not exists management_item_attachments_item_idx on public.management_item_attachments(management_item_id,created_at desc) where deleted_at is null;
create index if not exists notifications_user_unread_idx on public.notifications(user_id,read_at,created_at desc);
create index if not exists invitations_project_idx on public.project_invitations(project_id,created_at desc);

create or replace function private.guard_task()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.project_id<>old.project_id then raise exception 'project_id is immutable'; end if;
  if new.id=any(new.dependencies) then raise exception 'task cannot depend on itself'; end if;
  if new.actual_finish is not null and new.progress_percent<>100 then raise exception 'actual finish requires 100 percent progress'; end if;
  if new.actual_finish is not null and new.actual_start is null then new.actual_start=new.actual_finish; end if;
  if new.progress_percent=100 then
    new.status='完了';new.remaining_days=0;
  elsif new.status='完了' then
    new.progress_percent=100;new.remaining_days=0;
  elsif new.actual_start is not null and new.status='未着手' then new.status='進行中';
  end if;
  if tg_op='UPDATE' then
    new.id=old.id;new.created_by=old.created_by;new.created_at=old.created_at;new.version=old.version+1;
  end if;
  new.updated_by=auth.uid();new.updated_at=now();
  return new;
end $$;

create or replace function private.validate_task_dependencies()
returns trigger language plpgsql security definer set search_path='' as $$
declare dependency uuid; has_cycle boolean;
begin
  if new.archived_at is not null then
    if exists(select 1 from public.tasks t where t.project_id=new.project_id and t.archived_at is null and t.id<>new.id and new.id=any(t.dependencies)) then
      raise exception 'task is still required by an active task';
    end if;
    return new;
  end if;
  foreach dependency in array new.dependencies loop
    if not exists(select 1 from public.tasks where id=dependency and project_id=new.project_id and archived_at is null) then
      raise exception 'dependency must belong to the same active project';
    end if;
  end loop;
  with recursive walk(id,path,cycle) as (
    select first_step.id,array[new.id,first_step.id],first_step.id=new.id from unnest(new.dependencies) as first_step(id)
    union all
    select next_step.id,walk.path||next_step.id,next_step.id=any(walk.path)
    from walk join public.tasks task_row on task_row.id=walk.id and task_row.project_id=new.project_id and task_row.archived_at is null
    cross join lateral unnest(task_row.dependencies) as next_step(id) where not walk.cycle
  ) select coalesce(bool_or(cycle),false) into has_cycle from walk;
  if has_cycle then raise exception 'circular task dependency'; end if;
  return new;
end $$;

create or replace function private.guard_schedule_change_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare current_task public.tasks; requested_duration integer;
begin
  if tg_op='INSERT' then
    if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
    select * into current_task from public.tasks where id=new.task_id and archived_at is null for share;
    if not found then raise exception 'active task not found'; end if;
    if new.project_id is distinct from current_task.project_id then raise exception 'task must belong to project'; end if;
    if private.project_role_for(current_task.project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501'; end if;
    if new.proposed_by is distinct from auth.uid() then raise exception 'proposed_by must be current user' using errcode='42501'; end if;
    if new.status<>'pending' or new.reviewed_by is not null or new.reviewed_at is not null or new.review_comment<>'' then
      raise exception 'new request must be pending and unreviewed';
    end if;
    if new.expected_task_version<>current_task.version then raise exception 'task version conflict' using errcode='40001'; end if;
    if new.change_type='duration_delay' then
      if not (new.proposed_patch ? 'duration_days') or exists(
        select 1 from jsonb_object_keys(new.proposed_patch) as patch_key(key_name) where key_name<>'duration_days'
      ) then raise exception 'duration_delay only accepts duration_days'; end if;
      begin requested_duration=(new.proposed_patch->>'duration_days')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid duration_days'; end;
      if requested_duration not between 1 and 365 then raise exception 'duration_days must be between 1 and 365'; end if;
    else
      raise exception 'unsupported schedule change type';
    end if;
    new.before_data=to_jsonb(current_task);
    new.updated_at=now();
    return new;
  end if;

  if new.project_id is distinct from old.project_id or new.task_id is distinct from old.task_id or
     new.expected_task_version is distinct from old.expected_task_version or new.change_type is distinct from old.change_type or
     new.proposed_patch is distinct from old.proposed_patch or new.before_data is distinct from old.before_data or
     new.impact_data is distinct from old.impact_data or new.reason is distinct from old.reason or
     new.proposed_by is distinct from old.proposed_by or new.created_at is distinct from old.created_at then
    raise exception 'proposal fields are immutable after submission';
  end if;
  if private.project_role_for(old.project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  if old.status<>'pending' or new.status not in ('approved','rejected') then raise exception 'only a pending request can be reviewed'; end if;
  new.id=old.id;new.reviewed_by=auth.uid();new.reviewed_at=now();new.updated_at=now();
  return new;
end $$;

drop trigger if exists guard_schedule_change_request on public.schedule_change_requests;
create trigger guard_schedule_change_request before insert or update on public.schedule_change_requests
for each row execute function private.guard_schedule_change_request();
revoke all on function private.guard_schedule_change_request() from public,anon,authenticated;

create or replace function private.guard_task_child_project()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.task_id is not null and not exists(
    select 1 from public.tasks t where t.id=new.task_id and t.project_id=new.project_id
  ) then raise exception 'task must belong to the same project'; end if;
  if tg_table_name='task_attachments' then
    if new.report_id is not null and not exists(
      select 1 from public.task_reports r where r.id=new.report_id and r.project_id=new.project_id and r.task_id=new.task_id
    ) then raise exception 'report must belong to the same project and task'; end if;
    if new.comment_id is not null and not exists(
      select 1 from public.task_comments c where c.id=new.comment_id and c.project_id=new.project_id and c.task_id=new.task_id
    ) then raise exception 'comment must belong to the same project and task'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_task_child_project() from public,anon,authenticated;
drop trigger if exists guard_task_child_project on public.task_reports;
create trigger guard_task_child_project before insert or update on public.task_reports for each row execute function private.guard_task_child_project();
drop trigger if exists guard_task_child_project on public.task_comments;
create trigger guard_task_child_project before insert or update on public.task_comments for each row execute function private.guard_task_child_project();
drop trigger if exists guard_task_child_project on public.task_attachments;
create trigger guard_task_child_project before insert or update on public.task_attachments for each row execute function private.guard_task_child_project();
drop trigger if exists guard_task_child_project on public.management_items;
create trigger guard_task_child_project before insert or update on public.management_items for each row execute function private.guard_task_child_project();

create or replace function public.report_task_progress(
  p_task_id uuid,p_expected_version bigint,p_progress integer,p_actual_start date,p_actual_finish date,
  p_remaining_days integer,p_comment text,p_delay_reason text,p_delay_category text,p_next_action text,
  p_inspection_status text,p_notify_next boolean
) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare current_task public.tasks; updated_task public.tasks; report_kind text;
begin
  select * into current_task from public.tasks where id=p_task_id;
  if not found then raise exception 'task not found'; end if;
  if private.project_role_for(current_task.project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501'; end if;
  if current_task.version<>p_expected_version then raise exception 'task version conflict' using errcode='40001'; end if;
  if p_progress not between 0 and 100 then raise exception 'progress must be between 0 and 100'; end if;
  if p_actual_finish is not null and p_progress<>100 then raise exception 'actual finish requires 100 percent progress'; end if;
  report_kind=case when p_progress=100 then 'complete' when current_task.progress_percent=100 and p_progress<100 then 'reopen' else 'progress' end;
  update public.tasks set
    progress_percent=p_progress,actual_start=p_actual_start,
    actual_finish=case when p_progress=100 then coalesce(p_actual_finish,current_date) else null end,
    remaining_days=case when p_progress=100 then 0 else p_remaining_days end,
    delay_reason=coalesce(p_delay_reason,''),delay_category=coalesce(p_delay_category,'未分類'),
    next_action=coalesce(p_next_action,''),inspection_status=coalesce(p_inspection_status,'未確認'),
    notify_next=coalesce(p_notify_next,false),last_reporter=auth.uid(),last_reported_at=now(),
    status=case when p_progress=100 then '完了' when coalesce(p_delay_reason,'')<>'' then '遅延' when coalesce(p_actual_start,current_task.actual_start) is not null or p_progress>0 then '進行中' else '未着手' end
  where id=p_task_id and version=p_expected_version returning * into updated_task;
  if not found then raise exception 'task version conflict' using errcode='40001'; end if;
  insert into public.task_reports(project_id,task_id,report_type,progress_percent,actual_start,actual_finish,remaining_days,comment,delay_reason,delay_category,next_action,inspection_status,notify_next)
  values(updated_task.project_id,updated_task.id,report_kind,updated_task.progress_percent,updated_task.actual_start,updated_task.actual_finish,updated_task.remaining_days,coalesce(p_comment,''),updated_task.delay_reason,updated_task.delay_category,updated_task.next_action,updated_task.inspection_status,updated_task.notify_next);
  return updated_task;
end $$;

create or replace function public.sync_task_planned_dates(p_project_id uuid,p_dates jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if private.project_role_for(p_project_id) not in ('owner','editor') then raise exception 'editor permission required' using errcode='42501'; end if;
  with supplied as (
    select id,version,planned_start,planned_finish from jsonb_to_recordset(p_dates) as x(id uuid,version bigint,planned_start date,planned_finish date)
  )
  select count(*) into changed from supplied s left join public.tasks t on t.id=s.id and t.project_id=p_project_id
  where t.id is null or t.version<>s.version;
  if changed>0 then raise exception 'task version conflict' using errcode='40001'; end if;
  with supplied as (
    select id,version,planned_start,planned_finish from jsonb_to_recordset(p_dates) as x(id uuid,version bigint,planned_start date,planned_finish date)
  )
  update public.tasks t set planned_start=s.planned_start,planned_finish=s.planned_finish
  from supplied s where t.id=s.id and t.project_id=p_project_id and t.version=s.version and (t.planned_start,t.planned_finish) is distinct from (s.planned_start,s.planned_finish);
  get diagnostics changed=row_count;return changed;
end $$;

create or replace function public.submit_schedule_change_request(
  p_project_id uuid,p_task_id uuid,p_expected_version bigint,p_change_type text,
  p_proposed_patch jsonb,p_impact_data jsonb,p_reason text
) returns public.schedule_change_requests
language plpgsql security definer set search_path='' as $$
declare submitted public.schedule_change_requests;
begin
  -- The guard trigger derives before_data from the locked task and validates role,
  -- project membership, task version, and the allow-listed patch fields.
  insert into public.schedule_change_requests(
    project_id,task_id,expected_task_version,change_type,proposed_patch,impact_data,reason,proposed_by
  ) values(
    p_project_id,p_task_id,p_expected_version,p_change_type,p_proposed_patch,
    coalesce(p_impact_data,'{}'::jsonb),coalesce(p_reason,''),auth.uid()
  ) returning * into submitted;
  return submitted;
end $$;

create or replace function public.review_schedule_change_request(
  p_request_id uuid,p_decision text,p_review_comment text default ''
) returns public.schedule_change_requests
language plpgsql security definer set search_path='' as $$
declare request_row public.schedule_change_requests; current_task public.tasks; reviewed public.schedule_change_requests; requested_duration integer;
begin
  if p_decision not in ('approved','rejected') then raise exception 'decision must be approved or rejected'; end if;
  select * into request_row from public.schedule_change_requests where id=p_request_id for update;
  if not found then raise exception 'schedule change request not found'; end if;
  if private.project_role_for(request_row.project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  if request_row.status<>'pending' then raise exception 'schedule change request is already reviewed' using errcode='40001'; end if;

  if p_decision='approved' then
    select * into current_task from public.tasks
    where id=request_row.task_id and project_id=request_row.project_id and archived_at is null for update;
    if not found then raise exception 'active task not found'; end if;
    if current_task.version<>request_row.expected_task_version then raise exception 'task version conflict' using errcode='40001'; end if;
    if request_row.change_type='duration_delay' then
      begin requested_duration=(request_row.proposed_patch->>'duration_days')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid duration_days'; end;
      if requested_duration not between 1 and 365 then raise exception 'duration_days must be between 1 and 365'; end if;
      update public.tasks set duration_days=requested_duration,version=version+1,updated_by=auth.uid()
      where id=current_task.id and version=request_row.expected_task_version;
      if not found then raise exception 'task version conflict' using errcode='40001'; end if;
    else
      raise exception 'unsupported schedule change type';
    end if;
  end if;

  update public.schedule_change_requests set
    status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
    review_comment=coalesce(p_review_comment,''),updated_at=now()
  where id=request_row.id returning * into reviewed;
  return reviewed;
end $$;

create or replace function public.create_schedule_version(p_project_id uuid,p_name text,p_reason text,p_comment text,p_is_baseline boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; next_number integer;
begin
  if private.project_role_for(p_project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  select coalesce(max(version_number),0)+1 into next_number from public.schedule_versions where project_id=p_project_id;
  if p_is_baseline then update public.schedule_versions set is_baseline=false where project_id=p_project_id; end if;
  insert into public.schedule_versions(project_id,version_number,name,reason,comment,project_snapshot,is_baseline)
  select id,next_number,trim(p_name),coalesce(p_reason,''),coalesce(p_comment,''),to_jsonb(p),p_is_baseline from public.projects p where id=p_project_id returning id into result;
  insert into public.schedule_version_tasks(version_id,project_id,task_id,position,task_snapshot,planned_start,planned_finish,actual_start,actual_finish)
  select result,project_id,id,position,to_jsonb(t),planned_start,planned_finish,actual_start,actual_finish from public.tasks t where project_id=p_project_id and archived_at is null;
  return result;
end $$;

create or replace function private.restore_schedule_version_rows(p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid; snapshot record;
begin
  select project_id into pid from public.schedule_versions where id=p_version_id;
  update public.tasks set archived_at=now() where project_id=pid and archived_at is null;
  for snapshot in select * from public.schedule_version_tasks where version_id=p_version_id order by position loop
    insert into public.tasks(id,project_id,position,code,trade,name,company,duration_days,dependencies,blocked_dates,status,notes,version,created_by,updated_by,created_at,updated_at,planned_start,planned_finish,actual_start,actual_finish,progress_percent,remaining_days,delay_reason,delay_category,next_action,last_reporter,last_reported_at,inspection_status,notify_next,archived_at)
    values(snapshot.task_id,snapshot.project_id,snapshot.position,
      snapshot.task_snapshot->>'code',coalesce(snapshot.task_snapshot->>'trade',''),snapshot.task_snapshot->>'name',coalesce(snapshot.task_snapshot->>'company',''),
      (snapshot.task_snapshot->>'duration_days')::integer,coalesce(array(select jsonb_array_elements_text(snapshot.task_snapshot->'dependencies'))::uuid[],'{}'),
      coalesce(array(select jsonb_array_elements_text(snapshot.task_snapshot->'blocked_dates'))::date[],'{}'),
      coalesce(snapshot.task_snapshot->>'status','未着手'),coalesce(snapshot.task_snapshot->>'notes',''),1,auth.uid(),auth.uid(),now(),now(),
      snapshot.planned_start,snapshot.planned_finish,snapshot.actual_start,snapshot.actual_finish,coalesce((snapshot.task_snapshot->>'progress_percent')::integer,0),
      (snapshot.task_snapshot->>'remaining_days')::integer,coalesce(snapshot.task_snapshot->>'delay_reason',''),coalesce(snapshot.task_snapshot->>'delay_category','未分類'),
      coalesce(snapshot.task_snapshot->>'next_action',''),null,null,coalesce(snapshot.task_snapshot->>'inspection_status','未確認'),coalesce((snapshot.task_snapshot->>'notify_next')::boolean,false),null)
    on conflict(id) do update set
      position=excluded.position,code=excluded.code,trade=excluded.trade,name=excluded.name,company=excluded.company,
      duration_days=excluded.duration_days,dependencies=excluded.dependencies,blocked_dates=excluded.blocked_dates,status=excluded.status,
      notes=excluded.notes,planned_start=excluded.planned_start,planned_finish=excluded.planned_finish,archived_at=null;
  end loop;
end $$;

create or replace function public.restore_schedule_version(p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid; backup_name text;
begin
  select project_id into pid from public.schedule_versions where id=p_version_id;
  if pid is null then raise exception 'version not found'; end if;
  if private.project_role_for(pid)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  perform 1 from public.projects where id=pid for update;
  perform 1 from public.tasks where project_id=pid and archived_at is null order by id for update;
  backup_name='復元前バックアップ '||to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI');
  perform public.create_schedule_version(pid,backup_name,'版復元前の自動バックアップ','',false);
  perform private.restore_schedule_version_rows(p_version_id);
end $$;

revoke all on function private.restore_schedule_version_rows(uuid) from public;

create or replace function public.create_project_invitation(p_project_id uuid,p_email text,p_role public.project_role,p_valid_days integer default 7)
returns table(invitation_id uuid,token text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare raw_token text; normalized text:=lower(trim(p_email)); created_id uuid; expiry timestamptz;
begin
  if private.project_role_for(p_project_id)<>'owner' then raise exception 'owner permission required' using errcode='42501'; end if;
  if p_role='owner' or normalized='' then raise exception 'invalid invitation'; end if;
  raw_token=encode(gen_random_bytes(32),'hex');expiry=now()+make_interval(days=>greatest(1,least(p_valid_days,30)));
  update public.project_invitations set revoked_at=now(),updated_at=now() where project_id=p_project_id and lower(email)=normalized and accepted_at is null and revoked_at is null;
  insert into public.project_invitations(project_id,email,role,token_hash,expires_at)
  values(p_project_id,normalized,p_role,encode(digest(raw_token,'sha256'),'hex'),expiry) returning id into created_id;
  invitation_id=created_id;token=raw_token;expires_at=expiry;return next;
end $$;

create or replace function public.accept_project_invitation(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.project_invitations; member_id uuid; normalized text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.project_invitations where token_hash=encode(digest(p_token,'sha256'),'hex') for update;
  if not found or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception 'invitation is invalid or expired'; end if;
  if lower(invitation.email)<>normalized then raise exception 'invitation email does not match signed in user' using errcode='42501'; end if;
  insert into public.project_members(project_id,user_id,email,role,invited_by,accepted_at)
  values(invitation.project_id,auth.uid(),normalized,invitation.role,invitation.created_by,now())
  on conflict(project_id,email) do update set user_id=auth.uid(),role=excluded.role,accepted_at=now() returning id into member_id;
  update public.project_invitations set accepted_at=now(),updated_at=now() where id=invitation.id;
  return invitation.project_id;
end $$;

create or replace function private.new_task_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.archived_at is null and (new.progress_percent,new.planned_start,new.planned_finish,new.status) is distinct from (old.progress_percent,old.planned_start,old.planned_finish,old.status) then
    insert into public.notifications(user_id,project_id,task_id,notification_type,title,body,severity,target_hash,dedupe_key)
    select m.user_id,new.project_id,new.id,
      case when new.progress_percent=100 then 'task_completed' else 'task_changed' end,
      case when new.progress_percent=100 then '工程が完了しました' else '工程が更新されました' end,
      new.code||' '||new.name,case when new.status='遅延' then 'important' else 'normal' end,
      'project='||new.project_id||'&task='||new.id,
      'task:'||new.id||':'||new.version||':'||m.user_id
    from public.project_members m where m.project_id=new.project_id and m.user_id is not null and m.user_id<>auth.uid()
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end $$;
drop trigger if exists notify_task_change on public.tasks;
create trigger notify_task_change after update on public.tasks for each row execute function private.new_task_notification();

create or replace function private.new_comment_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,project_id,task_id,notification_type,title,body,severity,target_hash,dedupe_key)
  select m.user_id,new.project_id,new.task_id,'comment_mention','コメントで呼ばれています',left(new.body,240),'important',
    'project='||new.project_id||'&task='||new.task_id,'mention:'||new.id||':'||m.user_id
  from public.project_members m where m.project_id=new.project_id and m.user_id=any(new.mentioned_user_ids) and m.user_id<>auth.uid()
  on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
drop trigger if exists notify_comment_mention on public.task_comments;
create trigger notify_comment_mention after insert on public.task_comments for each row execute function private.new_comment_notification();

create or replace function private.new_management_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'完了' and new.due_date is not null and new.due_date<=current_date+7 then
    insert into public.notifications(user_id,project_id,task_id,management_item_id,notification_type,title,body,severity,target_hash,dedupe_key)
    select m.user_id,new.project_id,new.task_id,new.id,'management_due',
      case when new.due_date<current_date then '管理項目の期限を超過しています' else '管理項目の期限が近づいています' end,
      new.item_type||'：'||new.title,case when new.due_date<current_date then 'urgent' else 'important' end,
      'project='||new.project_id||'&management='||new.id,'management:'||new.id||':'||new.updated_at||':'||m.user_id
    from public.project_members m where m.project_id=new.project_id and m.user_id is not null
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;return new;
end $$;
drop trigger if exists notify_management_due on public.management_items;
create trigger notify_management_due after insert or update on public.management_items for each row execute function private.new_management_notification();

create or replace function private.new_version_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,project_id,notification_type,title,body,severity,target_hash,dedupe_key)
  select m.user_id,new.project_id,'schedule_version','工程表が確定されました','第'||new.version_number||'版 '||new.name,'important',
    'project='||new.project_id,'version:'||new.id||':'||m.user_id
  from public.project_members m where m.project_id=new.project_id and m.user_id is not null and m.user_id<>auth.uid()
  on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
drop trigger if exists notify_schedule_version on public.schedule_versions;
create trigger notify_schedule_version after insert on public.schedule_versions for each row execute function private.new_version_notification();

do $$ begin
  alter table public.project_history drop constraint project_history_entity_type_check;
exception when undefined_object then null; end $$;
alter table public.project_history add constraint project_history_entity_type_check
  check (entity_type in ('project','task','member','report','comment','attachment','version','schedule_change_request','management_item','invitation','notification'));

create or replace function private.write_field_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; old_data jsonb; pid uuid; eid text; entity text; label text;
begin
  row_data=case when tg_op='DELETE' then null else to_jsonb(new) end;old_data=case when tg_op='INSERT' then null else to_jsonb(old) end;
  if tg_table_name='project_invitations' then row_data=row_data-'token_hash';old_data=old_data-'token_hash';end if;
  pid=coalesce((row_data->>'project_id')::uuid,(old_data->>'project_id')::uuid);eid=coalesce(row_data->>'id',old_data->>'id');
  entity=case tg_table_name when 'task_reports' then 'report' when 'task_comments' then 'comment' when 'task_attachments' then 'attachment' when 'management_item_attachments' then 'attachment' when 'schedule_versions' then 'version' when 'schedule_change_requests' then 'schedule_change_request' when 'management_items' then 'management_item' when 'project_invitations' then 'invitation' else tg_table_name end;
  label=coalesce(row_data->>'title',row_data->>'name',row_data->>'original_name',row_data->>'report_type',old_data->>'title',old_data->>'name',old_data->>'original_name',old_data->>'report_type',entity);
  insert into public.project_history(project_id,actor_id,actor_email,entity_type,entity_id,action,summary,before_data,after_data)
  values(pid,auth.uid(),coalesce(auth.jwt()->>'email','system'),entity,eid,case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,label,old_data,row_data);
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['task_reports','task_comments','task_attachments','schedule_versions','schedule_change_requests','management_items','management_item_attachments','project_invitations'] loop
    execute format('drop trigger if exists audit_field_change on public.%I',table_name);
    execute format('create trigger audit_field_change after insert or update or delete on public.%I for each row execute function private.write_field_history()',table_name);
  end loop;
end $$;

alter table public.task_reports enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.schedule_version_tasks enable row level security;
alter table public.schedule_change_requests enable row level security;
alter table public.management_items enable row level security;
alter table public.management_item_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.project_invitations enable row level security;
alter table public.user_project_reads enable row level security;

grant select on public.task_reports to authenticated;
revoke insert,update,delete on public.task_reports from authenticated;
grant select,insert,update on public.task_comments to authenticated;
grant select,insert,update on public.task_attachments to authenticated;
grant select on public.schedule_versions,public.schedule_version_tasks to authenticated;
revoke all on table public.schedule_change_requests from public,anon;
grant select,insert on public.schedule_change_requests to authenticated;
grant select,insert,update,delete on public.management_items to authenticated;
grant select,insert,update on public.management_item_attachments to authenticated;
grant select,update on public.notifications to authenticated;
grant select,insert,update on public.notification_preferences to authenticated;
grant select,update on public.project_invitations to authenticated;
grant select,insert,update on public.user_project_reads to authenticated;
revoke delete on public.tasks from authenticated;
revoke update on public.tasks from authenticated;
grant update(position,code,trade,name,company,duration_days,dependencies,blocked_dates,notes,version,archived_at) on public.tasks to authenticated;
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
revoke update on public.project_invitations from authenticated;
grant update(revoked_at) on public.project_invitations to authenticated;
revoke update,delete on public.schedule_change_requests from authenticated;
drop policy if exists tasks_delete_editor on public.tasks;

create policy reports_read_member on public.task_reports for select to authenticated using (private.is_project_member(project_id));
create policy reports_insert_editor on public.task_reports for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor') and reporter_id=auth.uid());
create policy comments_read_member on public.task_comments for select to authenticated using (private.is_project_member(project_id));
create policy comments_insert_editor on public.task_comments for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor') and created_by=auth.uid());
create policy comments_update_author_owner on public.task_comments for update to authenticated using (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner')) with check (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner'));
create policy attachments_read_member on public.task_attachments for select to authenticated using (private.is_project_member(project_id));
create policy attachments_insert_editor on public.task_attachments for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor') and created_by=auth.uid());
create policy attachments_update_author_owner on public.task_attachments for update to authenticated using (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner')) with check (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner'));
create policy versions_read_member on public.schedule_versions for select to authenticated using (private.is_project_member(project_id));
create policy version_tasks_read_member on public.schedule_version_tasks for select to authenticated using (private.is_project_member(project_id));
create policy change_requests_read_member on public.schedule_change_requests for select to authenticated using (private.is_project_member(project_id));
create policy change_requests_insert_editor on public.schedule_change_requests for insert to authenticated with check (
  private.project_role_for(project_id) in ('owner','editor') and proposed_by=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null
);
-- Direct UPDATE is intentionally not granted: this owner-only policy is defense in
-- depth, while review_schedule_change_request performs the atomic task update.
create policy change_requests_update_owner on public.schedule_change_requests for update to authenticated
  using (private.project_role_for(project_id)='owner') with check (private.project_role_for(project_id)='owner');
create policy items_read_member on public.management_items for select to authenticated using (private.is_project_member(project_id));
create policy items_insert_editor on public.management_items for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor'));
create policy items_update_editor on public.management_items for update to authenticated using (private.project_role_for(project_id) in ('owner','editor')) with check (private.project_role_for(project_id) in ('owner','editor'));
create policy items_delete_owner on public.management_items for delete to authenticated using (private.project_role_for(project_id)='owner');
create policy item_attachments_read_member on public.management_item_attachments for select to authenticated using (private.is_project_member(project_id));
create policy item_attachments_insert_editor on public.management_item_attachments for insert to authenticated with check (private.project_role_for(project_id) in ('owner','editor') and created_by=auth.uid());
create policy item_attachments_update_author_owner on public.management_item_attachments for update to authenticated using (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner')) with check (private.is_project_member(project_id) and (created_by=auth.uid() or private.project_role_for(project_id)='owner'));
create policy notifications_read_self on public.notifications for select to authenticated using (user_id=auth.uid() and private.is_project_member(project_id));
create policy notifications_update_self on public.notifications for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy preferences_self on public.notification_preferences for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy invitations_read_owner_self on public.project_invitations for select to authenticated using (private.project_role_for(project_id)='owner' or lower(email)=lower(coalesce(auth.jwt()->>'email','')));
create policy invitations_update_owner on public.project_invitations for update to authenticated using (private.project_role_for(project_id)='owner') with check (private.project_role_for(project_id)='owner');
create policy reads_self on public.user_project_reads for all to authenticated using (user_id=auth.uid() and private.is_project_member(project_id)) with check (user_id=auth.uid() and private.is_project_member(project_id));

revoke all on function public.report_task_progress(uuid,bigint,integer,date,date,integer,text,text,text,text,text,boolean),public.sync_task_planned_dates(uuid,jsonb),public.submit_schedule_change_request(uuid,uuid,bigint,text,jsonb,jsonb,text),public.review_schedule_change_request(uuid,text,text),public.create_schedule_version(uuid,text,text,text,boolean),public.restore_schedule_version(uuid),public.create_project_invitation(uuid,text,public.project_role,integer),public.accept_project_invitation(text) from public,anon;
grant execute on function public.report_task_progress(uuid,bigint,integer,date,date,integer,text,text,text,text,text,boolean),public.sync_task_planned_dates(uuid,jsonb),public.submit_schedule_change_request(uuid,uuid,bigint,text,jsonb,jsonb,text),public.review_schedule_change_request(uuid,text,text),public.create_schedule_version(uuid,text,text,text,boolean),public.restore_schedule_version(uuid),public.create_project_invitation(uuid,text,public.project_role,integer),public.accept_project_invitation(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-files','project-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.storage_project_id(p_name text)
returns uuid language plpgsql immutable set search_path='' as $$
begin return split_part(p_name,'/',1)::uuid;exception when others then return null;end $$;

drop policy if exists project_files_read_member on storage.objects;
drop policy if exists project_files_insert_editor on storage.objects;
drop policy if exists project_files_update_editor on storage.objects;
drop policy if exists project_files_delete_editor on storage.objects;
create policy project_files_read_member on storage.objects for select to authenticated using (bucket_id='project-files' and private.is_project_member(private.storage_project_id(name)));
create policy project_files_insert_editor on storage.objects for insert to authenticated with check (bucket_id='project-files' and private.project_role_for(private.storage_project_id(name)) in ('owner','editor'));
create policy project_files_update_editor on storage.objects for update to authenticated using (bucket_id='project-files' and private.project_role_for(private.storage_project_id(name)) in ('owner','editor')) with check (bucket_id='project-files' and private.project_role_for(private.storage_project_id(name)) in ('owner','editor'));
create policy project_files_delete_editor on storage.objects for delete to authenticated using (bucket_id='project-files' and private.project_role_for(private.storage_project_id(name)) in ('owner','editor'));

create or replace view public.project_overview with (security_invoker=true) as
select p.id,p.owner_id,p.name,p.manager,p.start_date,p.deadline,p.holidays,p.revision,p.created_at,p.updated_at,
  private.project_role_for(p.id) as current_role,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null) as task_count,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null and (t.status='完了' or t.progress_percent=100)) as completed_count,
  p.site_name,p.client_name,p.designer,p.contractor,p.approver,
  (select coalesce(round(avg(t.progress_percent)),0)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null) as progress_percent,
  (select count(*)::integer from public.tasks t where t.project_id=p.id and t.archived_at is null and t.progress_percent<100 and coalesce(t.planned_finish,p.deadline)<current_date) as delayed_count,
  (select count(*)::integer from public.management_items i where i.project_id=p.id and i.status<>'完了' and i.due_date<current_date) as overdue_item_count,
  (select max(t.last_reported_at) from public.tasks t where t.project_id=p.id and t.archived_at is null) as last_reported_at,
  (select count(*)::integer from public.schedule_change_requests r where r.project_id=p.id and r.status='pending') as pending_change_count,
  (select count(*)::integer from public.notifications n where n.project_id=p.id and n.user_id=auth.uid() and n.read_at is null) as unread_count
from public.projects p;

do $$ declare table_name text; begin
  foreach table_name in array array['task_reports','task_comments','task_attachments','schedule_versions','schedule_change_requests','management_items','notifications'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',table_name);exception when duplicate_object then null;end;
  end loop;
end $$;
