import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('field UI keeps one task creation entry and one shared editor',async()=>{
  const [html,app,css]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('style.css',root),'utf8')]);
  assert.equal((html.match(/id="addTaskButton"/g)||[]).length,1);
  assert.doesNotMatch(html,/quickTaskForm|ganttAddTaskButton/);
  assert.match(html,/data-view="today"/);
  assert.match(html,/data-view="gantt"/);
  assert.match(html,/data-view="network"/);
  assert.match(html,/data-view="tasks"/);
  assert.match(app,/function openTaskEditor\(task=null\)/);
  assert.match(app,/data-edit-task/);
  assert.match(css,/\.gantt-row>\.gantt-label\{[\s\S]*?background:#fff/);
  assert.match(html,/class="view-tabs" data-active="today"/);
  assert.match(app,/tabs\.dataset\.active=view/);
  assert.match(css,/\.view-tabs::before\{[\s\S]*?transform:translateX/);
});

test('database policies and optimistic locking protect shared editing',async()=>{
  const [migration,service]=await Promise.all([readFile(new URL('supabase/migrations/202609280001_collaboration.sql',root),'utf8'),readFile(new URL('data-service.js',root),'utf8')]);
  assert.match(migration,/tasks_read_member/);
  assert.match(migration,/tasks_update_editor/);
  assert.match(migration,/history_read_member/);
  assert.match(migration,/alter publication supabase_realtime add table public\.tasks/);
  assert.match(service,/\.eq\('version',task\.version\)/);
  assert.match(service,/code:'CONFLICT'/);
});

test('field operations migration secures reports versions files invitations and notifications',async()=>{
  const migration=await readFile(new URL('supabase/migrations/202609290001_field_operations.sql',root),'utf8');
  for(const table of ['task_reports','task_comments','task_attachments','schedule_versions','schedule_version_tasks','management_items','notifications','project_invitations'])assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration,/progress_percent integer not null default 0/);
  assert.match(migration,/token_hash text not null unique/);
  assert.match(migration,/digest\(raw_token,'sha256'\)/);
  assert.match(migration,/values\('project-files','project-files',false/);
  assert.match(migration,/project_files_read_member/);
  assert.match(migration,/task version conflict/);
  assert.match(migration,/tasks_active_project_code_idx/);
  assert.match(migration,/revoke delete on public\.tasks from authenticated/);
  assert.match(migration,/revoke all on function private\.restore_schedule_version_rows/);
  assert.doesNotMatch(migration,/delete from public\.tasks where project_id=pid/);
});

test('completion uses a report dialog and mobile UI retains field details',async()=>{
  const [html,app,css]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('style.css',root),'utf8')]);
  assert.match(html,/id="reportDialog"/);assert.match(html,/data-report-progress="100"/);assert.match(html,/accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.match(app,/function openReportDialog/);assert.match(app,/uploadTaskFiles/);assert.match(app,/reportTaskProgress/);assert.match(app,/queueProgress/);
  assert.match(css,/@media\(max-width:620px\)[\s\S]*?\.task-row \.task-cell\{display:block!important/);
  assert.match(html,/data-network-mode="simple"/);assert.match(html,/id="xlsxExport"/);
  assert.match(html,/id="offlineConflictDialog"/);assert.match(app,/function showOfflineConflict/);assert.match(app,/function reopenOfflineConflict/);
  assert.match(html,/id="notificationPreferences"/);assert.match(app,/saveNotificationPreferences/);
  assert.match(html,/id="historyEntityFilter"/);assert.match(app,/function renderHistory/);
});

test('public entry explains the product and offers a login-free working demo',async()=>{
  const [html,app,css]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('style.css',root),'utf8')]);
  assert.match(html,/id="landingView"/);assert.match(html,/登録なしで操作を試す/);assert.match(html,/工程変更を、/);
  assert.match(html,/data-demo-view="today"/);assert.match(html,/data-demo-view="gantt"/);assert.match(html,/data-demo-view="network"/);
  assert.match(html,/責任者として確定を試す/);assert.match(html,/お問い合わせ・不具合報告/);
  assert.match(app,/function showLanding/);assert.match(app,/function completeDemoTask/);assert.match(app,/function confirmDemoImpact/);
  assert.match(css,/\.landing-hero/);assert.match(css,/@media\(max-width:700px\)/);
});

test('hybrid import requires human review and stores manual network layout securely',async()=>{
  const [html,app,service,migration,worker]=await Promise.all([
    readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('data-service.js',root),'utf8'),
    readFile(new URL('supabase/migrations/202610010001_hybrid_schedule_import.sql',root),'utf8'),readFile(new URL('sw.js',root),'utf8')
  ]);
  assert.match(html,/id="scheduleImportDialog"/);assert.match(html,/既存工程は上書きしません/);assert.match(html,/id="networkLayoutButton"/);
  assert.match(app,/buildImportCandidates/);assert.match(app,/要確認の行は登録されません/);assert.match(app,/toImportRows/);assert.match(app,/function beginNetworkDrag/);
  assert.match(service,/apply_schedule_import/);assert.match(service,/network_task_layouts/);
  assert.match(migration,/security definer/);assert.match(migration,/editor permission required/);assert.match(migration,/network_layout_update_editor/);assert.match(migration,/duplicate task code/);
  assert.match(worker,/schedule-import\.js/);
});

test('weather changes stay inside the selected schedule and show dependency impact',async()=>{
  const [html,app,migration]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('supabase/migrations/202610010002_weather_schedule_changes.sql',root),'utf8')]);
  assert.match(html,/id="impactCause"/);assert.match(html,/天候による休工日/);assert.match(app,/compareTaskChange/);assert.match(app,/taskConnectionSummary/);assert.match(app,/data-impact-task/);
  assert.match(migration,/weather_delay/);assert.match(migration,/blocked_dates/);assert.match(migration,/owner permission required/);
});

test('construction network uses numbered events work arrows dummy links and editable relations',async()=>{
  const [html,app,migration]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('supabase/migrations/202610010003_event_network_layout.sql',root),'utf8')]);
  assert.match(html,/data-network-structure="event"/);assert.match(html,/番号付きの丸はイベント/);assert.match(html,/id="networkRelationList"/);
  assert.match(app,/buildEventNetwork/);assert.match(app,/event-edge dummy/);assert.match(app,/saveNetworkEventLayout/);
  assert.match(migration,/network_event_layouts/);assert.match(migration,/event_layout_update_editor/);
});

test('architect workbook fields stay editable importable exportable and protected',async()=>{
  const [html,app,parser,migration]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('schedule-import.js',root),'utf8'),readFile(new URL('supabase/migrations/202610010005_architect_schedule_fields.sql',root),'utf8')]);
  for(const name of ['quantity','unit','daily_output','crew_count','people_per_crew','cost_thousands','building','floor'])assert.match(html,new RegExp(`name="${name}"`));
  assert.match(html,/id="preflightChecklist"/);assert.match(html,/id="weatherAllowanceInput"/);assert.match(app,/PREFLIGHT_ITEMS/);assert.match(app,/weightedProgress/);assert.match(app,/EXPORT_HEADERS/);
  assert.match(parser,/dailyOutput/);assert.match(parser,/costThousands/);assert.match(migration,/preflight_completed/);assert.match(migration,/grant update\([\s\S]*cost_thousands/);assert.match(migration,/apply_schedule_import/);assert.match(migration,/restore_schedule_version_rows/);assert.match(migration,/quantity=excluded\.quantity/);
});

test('master schedule mirrors the reference hierarchy without removing editing controls',async()=>{
  const [html,app,css]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('app.js',root),'utf8'),readFile(new URL('style.css',root),'utf8')]);
  assert.match(html,/id="masterScheduleMeta"/);assert.match(html,/総合工程表/);
  assert.match(app,/function renderMasterScheduleMeta/);assert.match(app,/gantt-group-row/);assert.match(app,/data-month-boundary/);
  assert.match(app,/data-impact-task/);assert.match(app,/data-resize-task/);assert.match(css,/\.master-schedule-meta/);assert.match(css,/\.gantt-group-row/);
});
