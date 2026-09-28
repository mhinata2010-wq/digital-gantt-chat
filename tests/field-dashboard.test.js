import test from 'node:test';
import assert from 'node:assert/strict';
import {categorizeFieldTasks} from '../field-dashboard.js';

test('field dashboard separates today, delayed and upcoming work',()=>{
  const tasks=[
    {id:'done',status:'完了'},
    {id:'late-date',status:'未着手'},
    {id:'late-status',status:'遅延'},
    {id:'today',status:'進行中'},
    {id:'next-later',status:'未着手'},
    {id:'next-first',status:'未着手'}
  ];
  const nodes=new Map([
    ['done',{startDate:'2026-09-20',endDate:'2026-09-21'}],
    ['late-date',{startDate:'2026-09-22',endDate:'2026-09-26'}],
    ['late-status',{startDate:'2026-09-28',endDate:'2026-09-30'}],
    ['today',{startDate:'2026-09-28',endDate:'2026-09-30'}],
    ['next-later',{startDate:'2026-10-05',endDate:'2026-10-06'}],
    ['next-first',{startDate:'2026-10-01',endDate:'2026-10-02'}]
  ]);
  const result=categorizeFieldTasks('2026-09-29',tasks,nodes);
  assert.deepEqual(result.current.map(item=>item.task.id),['today']);
  assert.deepEqual(result.delayed.map(item=>item.task.id),['late-date','late-status']);
  assert.deepEqual(result.upcoming.map(item=>item.task.id),['next-first','next-later']);
});

test('completed work is not shown as actionable field work',()=>{
  const tasks=[{id:'done',status:'完了'}],nodes=new Map([['done',{startDate:'2026-09-29',endDate:'2026-09-29'}]]);
  assert.deepEqual(categorizeFieldTasks('2026-09-29',tasks,nodes),{current:[],delayed:[],upcoming:[]});
});
