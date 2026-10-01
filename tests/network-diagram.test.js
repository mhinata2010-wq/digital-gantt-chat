import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSchedule} from '../schedule-engine.js';
import {buildEventNetwork,relationRows} from '../network-diagram.js';

const project={start_date:'2026-10-05',holidays:[]};
const task=(id,code,duration,dependencies=[],position=0)=>({id,code,name:`工程${code}`,duration_days:duration,dependencies,blocked_dates:[],position});

test('event network renders work as arrows and dependencies as dummy arrows',()=>{
  const tasks=[task('a','A',2,[],0),task('b','B',2,['a'],1),task('c','C',1,['a'],2),task('d','D',1,['b','c'],3)],schedule=computeSchedule(project,tasks),network=buildEventNetwork(tasks,schedule);
  assert.equal(network.edges.filter(edge=>edge.kind==='task').length,4);assert.equal(network.edges.filter(edge=>edge.kind==='dummy').length,4);
  assert.ok(network.events.every((event,index)=>event.number===index+1));
  const rows=relationRows(tasks,schedule,network);assert.deepEqual(rows.find(row=>row.task.code==='D').predecessors,['B','C']);assert.deepEqual(rows.find(row=>row.task.code==='A').successors,['B','C']);
});
