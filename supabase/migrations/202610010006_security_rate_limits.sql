-- Durable upload accounting and invitation-delivery throttling.
-- Apply after 202610010005_architect_schedule_fields.sql.

create table if not exists public.file_upload_reservations (
  storage_path text primary key check (char_length(storage_path) between 1 and 500),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('task','management')),
  scope_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  byte_size bigint not null check (byte_size between 1 and 10485760),
  status text not null default 'reserved' check (status in ('reserved','stored','claimed','deleting')),
  created_at timestamptz not null default now()
);
create index if not exists file_upload_reservations_project_created_idx
  on public.file_upload_reservations(project_id,created_at desc);
create index if not exists file_upload_reservations_actor_created_idx
  on public.file_upload_reservations(created_by,created_at desc);
alter table public.file_upload_reservations enable row level security;
revoke all on public.file_upload_reservations from public,anon,authenticated;

create or replace function public.reserve_project_file_upload(
  p_project_id uuid,p_scope_kind text,p_scope_id uuid,p_storage_path text,p_byte_size bigint,p_created_by uuid
) returns void
language plpgsql security definer set search_path='' as $$
declare project_bytes bigint; actor_bytes bigint; actor_hour_count integer; project_hour_count integer; project_object_count integer; actor_object_count integer;
begin
  if p_created_by is null or p_byte_size not between 1 and 10485760 or
     p_scope_kind not in ('task','management') or p_storage_path is null or
     split_part(p_storage_path,'/',1)<>p_project_id::text then
    raise exception 'invalid upload reservation';
  end if;
  if not exists(
    select 1 from public.project_members m
    where m.project_id=p_project_id and m.user_id=p_created_by and m.role in ('owner','editor')
  ) then raise exception 'editor permission required' using errcode='42501';end if;
  if p_scope_kind='task' and not exists(
    select 1 from public.tasks t where t.id=p_scope_id and t.project_id=p_project_id and t.archived_at is null
  ) then raise exception 'active task must belong to project';end if;
  if p_scope_kind='management' and not exists(
    select 1 from public.management_items i where i.id=p_scope_id and i.project_id=p_project_id
  ) then raise exception 'management item must belong to project';end if;

  perform pg_advisory_xact_lock(hashtextextended('upload-user:'||p_created_by::text,0));
  perform pg_advisory_xact_lock(hashtextextended('upload-project:'||p_project_id::text,0));
  select count(*)::integer into actor_hour_count from public.file_upload_reservations
    where created_by=p_created_by and created_at>now()-interval '1 hour';
  select count(*)::integer into project_hour_count from public.file_upload_reservations
    where project_id=p_project_id and created_at>now()-interval '1 hour';
  select coalesce(sum(byte_size),0)::bigint into project_bytes from public.file_upload_reservations
    where project_id=p_project_id;
  select coalesce(sum(byte_size),0)::bigint,count(*)::integer into actor_bytes,actor_object_count
    from public.file_upload_reservations where created_by=p_created_by;
  select count(*)::integer into project_object_count from public.file_upload_reservations
    where project_id=p_project_id;
  if actor_hour_count>=100 or project_hour_count>=300 then
    raise exception 'upload rate limit exceeded' using errcode='54000';
  end if;
  if project_object_count>=5000 or actor_object_count>=10000 then
    raise exception 'upload object limit exceeded' using errcode='54000';
  end if;
  if project_bytes+p_byte_size>5368709120 or actor_bytes+p_byte_size>10737418240 then
    raise exception 'project upload quota exceeded' using errcode='54000';
  end if;
  insert into public.file_upload_reservations(storage_path,project_id,scope_kind,scope_id,created_by,byte_size)
  values(p_storage_path,p_project_id,p_scope_kind,p_scope_id,p_created_by,p_byte_size);
end $$;
revoke all on function public.reserve_project_file_upload(uuid,text,uuid,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.reserve_project_file_upload(uuid,text,uuid,text,bigint,uuid) to service_role;

create or replace function public.claim_project_file_cleanup(p_project_id uuid,p_paths text[],p_created_by uuid)
returns void
language plpgsql security definer set search_path='' as $$
declare expected_count integer; claimed_count integer;
begin
  expected_count=coalesce(array_length(p_paths,1),0);
  if expected_count<1 or expected_count>20 or p_created_by is null then raise exception 'invalid cleanup request';end if;
  perform 1 from public.file_upload_reservations r
    where r.storage_path=any(p_paths) order by r.storage_path for update;
  select count(*)::integer into claimed_count from public.file_upload_reservations r
    where r.storage_path=any(p_paths) and r.project_id=p_project_id and r.created_by=p_created_by and r.status='stored';
  if claimed_count<>expected_count then raise exception 'file cleanup permission required' using errcode='42501';end if;
  update public.file_upload_reservations set status='deleting'
    where storage_path=any(p_paths) and project_id=p_project_id and created_by=p_created_by and status='stored';
end $$;
revoke all on function public.claim_project_file_cleanup(uuid,text[],uuid) from public,anon,authenticated;
grant execute on function public.claim_project_file_cleanup(uuid,text[],uuid) to service_role;

create or replace function private.claim_attachment_upload()
returns trigger language plpgsql security definer set search_path='' as $$
declare reservation public.file_upload_reservations;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  select * into reservation from public.file_upload_reservations
    where storage_path=new.storage_path for update;
  if not found or reservation.status<>'stored' or reservation.project_id<>new.project_id or
     reservation.created_by<>auth.uid() or reservation.byte_size<>new.byte_size then
    raise exception 'attachment upload reservation mismatch' using errcode='42501';
  end if;
  if tg_table_name='task_attachments' and
     (reservation.scope_kind<>'task' or reservation.scope_id<>new.task_id) then
    raise exception 'attachment task scope mismatch' using errcode='42501';
  end if;
  if tg_table_name='task_attachments' and not exists(
    select 1 from public.tasks t where t.id=new.task_id and t.project_id=new.project_id and t.archived_at is null
  ) then raise exception 'attachment task must remain active' using errcode='42501';end if;
  if tg_table_name='management_item_attachments' and
     (reservation.scope_kind<>'management' or reservation.scope_id<>new.management_item_id) then
    raise exception 'attachment management scope mismatch' using errcode='42501';
  end if;
  new.created_by=auth.uid();
  update public.file_upload_reservations set status='claimed' where storage_path=new.storage_path;
  return new;
end $$;
revoke all on function private.claim_attachment_upload() from public,anon,authenticated;
drop trigger if exists claim_task_attachment_upload on public.task_attachments;
create trigger claim_task_attachment_upload before insert on public.task_attachments
for each row execute function private.claim_attachment_upload();
drop trigger if exists claim_management_attachment_upload on public.management_item_attachments;
create trigger claim_management_attachment_upload before insert on public.management_item_attachments
for each row execute function private.claim_attachment_upload();

create table if not exists public.invitation_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.project_invitations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  recipient_email text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_status integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists invitation_email_recipient_created_idx
  on public.invitation_email_deliveries(lower(recipient_email),created_at desc);
create index if not exists invitation_email_actor_created_idx
  on public.invitation_email_deliveries(created_by,created_at desc);
create index if not exists invitation_email_project_recipient_created_idx
  on public.invitation_email_deliveries(project_id,lower(recipient_email),created_at desc);
alter table public.invitation_email_deliveries enable row level security;
revoke all on public.invitation_email_deliveries from public,anon,authenticated;

create or replace function public.claim_invitation_email_delivery(p_invitation_id uuid,p_token_hash text)
returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation public.project_invitations; delivery_id uuid; normalized_email text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  select * into invitation from public.project_invitations where id=p_invitation_id for update;
  if not found then raise exception 'invitation not found';end if;
  if private.project_role_for(invitation.project_id)<>'owner' then
    raise exception 'owner permission required' using errcode='42501';
  end if;
  if invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now() then
    raise exception 'invitation inactive';
  end if;
  if invitation.token_hash<>p_token_hash then raise exception 'invitation token mismatch';end if;
  normalized_email=lower(trim(invitation.email));
  perform pg_advisory_xact_lock(hashtextextended('invite-sender:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('invite-recipient:'||normalized_email,0));
  perform pg_advisory_xact_lock(hashtextextended('invite-project-recipient:'||invitation.project_id::text||':'||normalized_email,0));
  if exists(select 1 from public.invitation_email_deliveries d
    where d.project_id=invitation.project_id and lower(d.recipient_email)=normalized_email
      and d.created_at>now()-interval '5 minutes') then
    raise exception 'invitation email cooldown';
  end if;
  if (select count(*) from public.invitation_email_deliveries d
      where d.created_by=auth.uid() and d.created_at>now()-interval '1 hour')>=20 then
    raise exception 'sender email rate limit exceeded';
  end if;
  if (select count(*) from public.invitation_email_deliveries d
      where lower(d.recipient_email)=normalized_email and d.created_at>now()-interval '1 hour')>=5 then
    raise exception 'recipient email rate limit exceeded';
  end if;
  if (select count(*) from public.invitation_email_deliveries d where d.invitation_id=invitation.id)>=10 then
    raise exception 'invitation email limit exceeded';
  end if;
  insert into public.invitation_email_deliveries(invitation_id,project_id,recipient_email,created_by)
  values(invitation.id,invitation.project_id,normalized_email,auth.uid()) returning id into delivery_id;
  return delivery_id;
end $$;

create or replace function public.complete_invitation_email_delivery(p_delivery_id uuid,p_status text,p_provider_status integer default null)
returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_status not in ('sent','failed') then raise exception 'invalid delivery status';end if;
  update public.invitation_email_deliveries
  set status=p_status,provider_status=p_provider_status,completed_at=now()
  where id=p_delivery_id and created_by=auth.uid() and status='pending';
  if not found then raise exception 'delivery claim not found';end if;
end $$;

revoke all on function public.claim_invitation_email_delivery(uuid,text),public.complete_invitation_email_delivery(uuid,text,integer) from public,anon;
grant execute on function public.claim_invitation_email_delivery(uuid,text),public.complete_invitation_email_delivery(uuid,text,integer) to authenticated;
