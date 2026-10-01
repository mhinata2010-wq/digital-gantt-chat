-- Shared manual positioning for numbered events in the construction network.
create table if not exists public.network_event_layouts(
  project_id uuid not null references public.projects(id) on delete cascade,
  event_key text not null,
  x numeric not null check(x between 0 and 20000),
  y numeric not null check(y between 0 and 20000),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(project_id,event_key)
);
alter table public.network_event_layouts enable row level security;
revoke all on public.network_event_layouts from public,anon;
grant select,insert,update,delete on public.network_event_layouts to authenticated;
create policy event_layout_read_member on public.network_event_layouts for select to authenticated using(private.is_project_member(project_id));
create policy event_layout_insert_editor on public.network_event_layouts for insert to authenticated with check(private.project_role_for(project_id) in ('owner','editor'));
create policy event_layout_update_editor on public.network_event_layouts for update to authenticated using(private.project_role_for(project_id) in ('owner','editor')) with check(private.project_role_for(project_id) in ('owner','editor'));
create policy event_layout_delete_editor on public.network_event_layouts for delete to authenticated using(private.project_role_for(project_id) in ('owner','editor'));
do $$ begin alter publication supabase_realtime add table public.network_event_layouts;exception when duplicate_object then null;end $$;
