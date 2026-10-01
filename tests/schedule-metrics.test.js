import test from 'node:test';
import assert from 'node:assert/strict';
import {taskWeight,weightedProgress,plannedProgressSeries} from '../schedule-metrics.js';

test('進捗の重みは金額、人工、日数の順で選ぶ',()=>{
  assert.deepEqual(taskWeight({cost_thousands:120,duration_days:3,crew_count:2,people_per_crew:4}),{value:120,basis:'cost'});
  assert.deepEqual(taskWeight({duration_days:3,crew_count:2,people_per_crew:4}),{value:24,basis:'labor'});
  assert.deepEqual(taskWeight({duration_days:3}),{value:3,basis:'duration'});
});

test('混在する工程を金額・人工・日数で加重集計する',()=>{
  const tasks=[{progress:50,cost_thousands:100,duration_days:2},{progress:100,duration_days:5,crew_count:2,people_per_crew:5}];
  assert.deepEqual(weightedProgress(tasks,task=>task.progress),{percent:67,total:150,basis:'mixed'});
});

test('予定累積曲線は着工0%、完成100%になる',()=>{
  const tasks=[{id:'a',duration_days:2},{id:'b',duration_days:2}],schedule={total:4,nodes:new Map([['a',{es:0,duration:2}],['b',{es:2,duration:2}]])};
  const points=plannedProgressSeries(tasks,schedule);
  assert.equal(points[0].percent,0);assert.equal(points.at(-1).percent,100);assert.equal(points[2].percent,50);
});
