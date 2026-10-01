export function categorizeFieldTasks(today,tasks,nodes){
  const items=(tasks||[]).map(task=>({task,node:nodes.get(task.id)})).filter(item=>item.node);
  const unfinished=items.filter(item=>item.task.status!=='完了');
  return {
    delayed:unfinished.filter(({task,node})=>task.status==='遅延'||node.endDate<today),
    current:unfinished.filter(({task,node})=>task.status!=='遅延'&&node.startDate<=today&&node.endDate>=today),
    upcoming:unfinished.filter(({node})=>node.startDate>today).sort((a,b)=>a.node.startDate.localeCompare(b.node.startDate)).slice(0,4)
  };
}
