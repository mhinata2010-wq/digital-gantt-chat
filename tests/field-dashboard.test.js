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
  const result=categorizeFieldTasks('2026-09-29',tasks,nodes);
  assert.deepEqual(result.current,[]);assert.deepEqual(result.delayed,[]);assert.deepEqual(result.upcoming,[]);
});

test('dashboard horizon expands from today to seven days',()=>{
  const tasks=[{id:'week',status:'進行中',progress_percent:10,company:'工務店'}],nodes=new Map([['week',{startDate:'2026-10-03',endDate:'2026-10-04'}]]);
  assert.equal(categorizeFieldTasks('2026-09-29',tasks,nodes,1).current.length,0);
  assert.equal(categorizeFieldTasks('2026-09-29',tasks,nodes,7).current.length,1);
});

test('dashboard groups are mutually exclusive',()=>{
  const tasks=[
    {id:'attention',status:'未着手',progress_percent:0,company:'工務店'},
    {id:'delay',status:'遅延',progress_percent:20,company:'工務店'}
  ];
  const nodes=new Map([
    ['attention',{startDate:'2026-09-29',endDate:'2026-10-02'}],
    ['delay',{startDate:'2026-09-28',endDate:'2026-10-03'}]
  ]);
  const result=categorizeFieldTasks('2026-09-29',tasks,nodes,7);
  const ids=[...result.delayed,...result.attention,...result.current,...result.upcoming].map(item=>item.task.id);
  assert.equal(ids.length,new Set(ids).size);
  assert.deepEqual(result.attention.map(item=>item.task.id),['attention']);
  assert.deepEqual(result.delayed.map(item=>item.task.id),['delay']);
});
