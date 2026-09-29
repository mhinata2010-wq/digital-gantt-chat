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
