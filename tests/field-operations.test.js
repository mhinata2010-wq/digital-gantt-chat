import test from 'node:test';
import assert from 'node:assert/strict';
import {progressOf,taskState,scheduleState,validateProgressReport,compareVersionTasks,utf8Csv} from '../field-operations.js';

test('legacy status and new progress share one consistent state',()=>{
  assert.equal(progressOf({status:'完了'}),100);
  assert.equal(taskState({status:'遅延',progress_percent:50}),'進行中');
  assert.equal(scheduleState({status:'未着手',progress_percent:0},{startDate:'2026-09-01',endDate:'2026-09-05'},'2026-09-06'),'遅延');
  assert.equal(scheduleState({status:'完了',progress_percent:100},{endDate:'2026-09-05'},'2026-09-06'),'予定内');
});

test('progress report rejects contradictory actual dates',()=>{
  assert.throws(()=>validateProgressReport({progress_percent:75,actual_start:'2026-09-01',actual_finish:'2026-09-02',remaining_days:1}),/100%/);
  assert.throws(()=>validateProgressReport({progress_percent:100,actual_start:'2026-09-03',actual_finish:'2026-09-02',remaining_days:0}),/以降/);
  assert.equal(validateProgressReport({progress_percent:100,actual_start:'2026-09-01',actual_finish:'2026-09-02',remaining_days:3}).remaining_days,0);
});

test('version comparison distinguishes added removed and changed tasks',()=>{
  const result=compareVersionTasks([{id:'a',name:'基礎',duration_days:5},{id:'b',name:'建方'}],[{task_id:'a',task_snapshot:{id:'a',name:'基礎',duration_days:3}},{task_id:'c',task_snapshot:{id:'c',name:'旧工程'}}]);
  assert.deepEqual(result.map(item=>item.type).sort(),['added','changed','removed']);
});

test('CSV is UTF-8 BOM prefixed and escapes Japanese values',()=>{
  const value=utf8Csv(['工程名','備考'],[['基礎','改行\nあり']]);
  assert.equal(value.charCodeAt(0),0xfeff);
  assert.match(value,/"基礎"/);
});
