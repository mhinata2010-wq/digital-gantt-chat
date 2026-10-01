export function buildEventNetwork(tasks,schedule){
  const ordered=[...tasks].sort((a,b)=>(a.position??0)-(b.position??0)),events=[],edges=[],eventMap=new Map(),rowByTask=new Map(ordered.map((task,index)=>[task.id,index]));
  const event=(id,taskId,kind,level,row,time,late)=>{if(!eventMap.has(id)){const value={id,taskId,kind,level,row,time,late};eventMap.set(id,value);events.push(value)}return eventMap.get(id)};
  for(const task of ordered){
    const node=schedule.nodes.get(task.id);if(!node)continue;const row=rowByTask.get(task.id),start=event(`start:${task.id}`,task.id,'start',node.level*2,row,node.es,node.ls),finish=event(`finish:${task.id}`,task.id,'finish',node.level*2+1,row,node.ef,node.lf);
    edges.push({id:`task:${task.id}`,kind:'task',taskId:task.id,from:start.id,to:finish.id,code:task.code,name:task.name,duration:node.duration,tf:node.tf,ff:node.ff,critical:node.tf===0});
    for(const predecessorId of task.dependencies||[]){const previous=schedule.nodes.get(predecessorId);edges.push({id:`dummy:${predecessorId}:${task.id}`,kind:'dummy',predecessorId,taskId:task.id,from:`finish:${predecessorId}`,to:start.id,critical:Boolean(previous&&previous.tf===0&&node.tf===0&&previous.ef===node.es)})}
  }
  events.sort((a,b)=>a.level-b.level||a.row-b.row||a.kind.localeCompare(b.kind));events.forEach((item,index)=>item.number=index+1);
  return {events,edges,eventMap:new Map(events.map(item=>[item.id,item])),maxLevel:Math.max(0,...events.map(item=>item.level)),rows:Math.max(1,ordered.length)};
}

export function relationRows(tasks,schedule,eventNetwork){
  const numberById=new Map(eventNetwork.events.map(event=>[event.id,event.number]));
  return [...tasks].sort((a,b)=>(a.position??0)-(b.position??0)).map(task=>{const node=schedule.nodes.get(task.id);return {task,from:numberById.get(`start:${task.id}`),to:numberById.get(`finish:${task.id}`),predecessors:(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean),successors:tasks.filter(item=>(item.dependencies||[]).includes(task.id)).map(item=>item.code),tf:node?.tf??0,ff:node?.ff??0,duration:node?.duration??task.duration_days,critical:node?.tf===0}});
}
