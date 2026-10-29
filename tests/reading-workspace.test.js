import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
const names=['dayDate','plus','distance','short','rangeLabel','taskEnd','tasksInPeriod','tradeCategory','taskFacets','filterScheduleTasks'];
const context=vm.createContext({});
for(const name of names){const start=source.indexOf(`function ${name}(`);const rest=source.slice(start);const firstLine=rest.split('\n')[0];const fn=firstLine.endsWith('}')?firstLine:rest.slice(0,rest.indexOf('\n}')+2);vm.runInContext(fn,context);}
const task=(id,start,days)=>({id,start,days,name:'内装工事①',group:'3階 / A棟',company:'内装会社'});
test('period filtering includes overlapping and boundary tasks, excludes offscreen work',()=>{
 const tasks=[task('before','2021-01-01',5),task('overlap','2021-01-30',4),task('start','2021-02-14',1),task('after','2021-02-15',1)];
 assert.equal(context.tasksInPeriod(tasks,'2021-02-01','2021-02-14').map(t=>t.id).join(','),'overlap,start');
});
test('date labels disambiguate schedules spanning years',()=>{
 assert.equal(context.rangeLabel(task('year','2021-12-30',4)),'2021/12/30 → 2022/1/2');
 assert.equal(context.rangeLabel(task('same','2022-06-01',3)),'6/1 → 6/3');
});
test('construction filters combine location, work category and normalized search',()=>{
 const tasks=[task('wanted','2022-06-01',3),{...task('other','2022-06-01',3),group:'4階 / B棟'}];
 assert.equal(context.filterScheduleTasks(tasks,{query:'内装',building:'A棟',floor:'3階',trade:'内装'}).map(t=>t.id).join(','),'wanted');
 assert.equal(context.tradeCategory({name:'タワークレーン設置期間'}),'仮設・揚重');
});
