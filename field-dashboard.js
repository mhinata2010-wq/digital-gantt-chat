import {addDays} from './schedule-engine.js';
import {progressOf,scheduleState} from './field-operations.js';

export function categorizeFieldTasks(today,tasks,nodes,horizon=1){
  const items=(tasks||[]).map(task=>({task,node:nodes.get(task.id)})).filter(item=>item.node);
  const unfinished=items.filter(item=>progressOf(item.task)<100);
  const end=addDays(today,Math.max(1,horizon)-1);
  const delayed=unfinished.filter(({task,node})=>scheduleState(task,node,today)==='遅延');
  const delayedIds=new Set(delayed.map(({task})=>task.id));
  const attention=unfinished.filter(({task,node})=>!delayedIds.has(task.id)&&scheduleState(task,node,today)==='要確認');
  const attentionIds=new Set(attention.map(({task})=>task.id));
  const current=unfinished.filter(({task,node})=>!delayedIds.has(task.id)&&!attentionIds.has(task.id)&&node.startDate<=end&&node.endDate>=today);
  const shownIds=new Set([...delayedIds,...attentionIds,...current.map(({task})=>task.id)]);
  return {
    delayed,
    attention,
    current,
    upcoming:unfinished.filter(({task,node})=>!shownIds.has(task.id)&&node.startDate>end).sort((a,b)=>a.node.startDate.localeCompare(b.node.startDate)).slice(0,6),
    unassigned:unfinished.filter(({task})=>!String(task.company||'').trim())
  };
}
