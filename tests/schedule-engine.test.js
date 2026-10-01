import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSchedule,compareSchedules,projectMargin,parseDates} from '../schedule-engine.js';

const project={start_date:'2026-09-28',deadline:'2026-10-16',holidays:[]};
const task=(id,name,duration,dependencies=[],position=0)=>({id,code:id.toUpperCase(),name,trade:'',company:'',duration_days:duration,dependencies,blocked_dates:[],status:'未着手',position});

test('one task dataset drives parallel and joined schedules',()=>{
  const tasks=[task('a','準備',2,[],0),task('b','設備',3,['a'],1),task('c','外装',2,['a'],2),task('d','検査',1,['b','c'],3)];
  const result=computeSchedule(project,tasks);
  assert.equal(result.nodes.get('a').es,0);
  assert.equal(result.nodes.get('b').es,2);
  assert.equal(result.nodes.get('c').es,2);
  assert.equal(result.nodes.get('d').es,5);
  assert.equal(result.total,6);
  assert.equal(result.nodes.get('b').tf,0);
  assert.equal(result.nodes.get('c').tf,1);
});

test('delay preview does not mutate tasks and reports downstream impact',()=>{
  const tasks=[task('a','準備',2),task('b','躯体',3,['a'],1),task('c','検査',1,['b'],2)];
  const snapshot=structuredClone(tasks),comparison=compareSchedules(project,tasks,'b',2);
  assert.deepEqual(tasks,snapshot);
  assert.equal(comparison.finishShift,2);
  assert.deepEqual(comparison.changes.map(change=>change.task.id),['b','c']);
});

test('cycles and missing dependencies are rejected',()=>{
  assert.throws(()=>computeSchedule(project,[task('a','A',1,['b']),task('b','B',1,['a'])]),/循環/);
  assert.throws(()=>computeSchedule(project,[task('a','A',1,['missing'])]),/見つかりません/);
});

test('weekends, holidays and margin use workdays',()=>{
  const holidayProject={...project,start_date:'2026-10-09',deadline:'2026-10-15',holidays:['2026-10-12']};
  const result=computeSchedule(holidayProject,[task('a','作業',2)]);
  assert.equal(result.finish,'2026-10-13');
  assert.equal(projectMargin(holidayProject,result),2);
  assert.deepEqual(parseDates('2026-10-12, 2026-10-14、2026-10-12'),['2026-10-12','2026-10-14']);
});
