import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('schedule change requests are persistent, member-readable and owner-reviewed',async()=>{
  const migration=await readFile(new URL('supabase/migrations/202609290001_field_operations.sql',root),'utf8');
  assert.match(migration,/create table if not exists public\.schedule_change_requests/);
  assert.match(migration,/change_type text not null check \(change_type in \('duration_delay'\)\)/);
  assert.match(migration,/status text not null default 'pending' check \(status in \('pending','approved','rejected'\)\)/);
  assert.match(migration,/alter table public\.schedule_change_requests enable row level security/);
  assert.match(migration,/change_requests_read_member[\s\S]*?private\.is_project_member\(project_id\)/);
  assert.match(migration,/change_requests_insert_editor[\s\S]*?proposed_by=auth\.uid\(\)/);
  assert.match(migration,/change_requests_update_owner[\s\S]*?project_role_for\(project_id\)='owner'/);
  assert.match(migration,/revoke update,delete on public\.schedule_change_requests from authenticated/);
});

test('review RPC locks a pending request and applies an approved duration atomically',async()=>{
  const migration=await readFile(new URL('supabase/migrations/202609290001_field_operations.sql',root),'utf8');
  assert.match(migration,/function public\.submit_schedule_change_request\(/);
  assert.match(migration,/function public\.review_schedule_change_request\(/);
  assert.match(migration,/from public\.schedule_change_requests where id=p_request_id for update/);
  assert.match(migration,/current_task\.version<>request_row\.expected_task_version/);
  assert.match(migration,/update public\.tasks set duration_days=requested_duration,version=version\+1,updated_by=auth\.uid\(\)/);
  assert.match(migration,/status=p_decision,reviewed_by=auth\.uid\(\),reviewed_at=now\(\)/);
  assert.match(migration,/security definer set search_path=''/);
  assert.match(migration,/revoke all on function[\s\S]*?submit_schedule_change_request[\s\S]*?from public,anon/);
});

test('data service loads, submits, reviews and subscribes to change requests',async()=>{
  const service=await readFile(new URL('data-service.js',root),'utf8');
  assert.match(service,/export async function loadScheduleChangeRequests\(projectId\)/);
  assert.match(service,/export async function submitScheduleChangeRequest\(projectId,taskId,expectedVersion,days,reason,impactData\)/);
  assert.match(service,/p_proposed_patch:\{duration_days:Number\(days\)\}/);
  assert.match(service,/export async function reviewScheduleChangeRequest\(requestId,decision,reviewComment=''\)/);
  assert.match(service,/table:'schedule_change_requests'/);
  assert.match(service,/changeRequests:changeRequests\|\|\[\]/);
});
