const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value){
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(!ISO_DATE.test(String(value)))throw new Error(`日付の形式が正しくありません: ${value}`);
  return String(value);
}

export function addDays(value,days){
  const date=new Date(`${isoDate(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

export function parseDates(value){
  const dates=Array.isArray(value)?value:String(value||'').split(/[\s,、]+/).filter(Boolean);
  return [...new Set(dates.map(isoDate))];
}

function calendar(project){
  const holidays=new Set(parseDates(project.holidays||[]));
  const isWorkday=(value,blocked=new Set())=>{
    const day=new Date(`${value}T12:00:00Z`).getUTCDay();
    return day!==0&&day!==6&&!holidays.has(value)&&!blocked.has(value);
  };
  const nthWorkday=index=>{
    let value=isoDate(project.start_date),count=0,guard=0;
    while(guard++<5000){
      if(isWorkday(value)){if(count===index)return value;count++}
      value=addDays(value,1);
    }
    throw new Error('工期が長すぎます。日程または休日を確認してください。');
  };
  const place=(startIndex,duration,blockedDates=[])=>{
    const blocked=new Set(parseDates(blockedDates));
    let index=startIndex,worked=0,first=null,guard=0;
    while(worked<duration&&guard++<5000){
      const day=nthWorkday(index);
      if(!blocked.has(day)){if(first===null)first=index;worked++}
      index++;
    }
    if(worked<duration)throw new Error('工程を配置できません。稼働不可日を確認してください。');
    return {actualStart:first??startIndex,endIndex:index};
  };
  return {isWorkday,nthWorkday,place};
}

export function computeSchedule(project,tasks,delay={taskId:null,days:0}){
  const items=(tasks||[]).map(task=>({...task,dependencies:[...(task.dependencies||[])],blocked_dates:[...(task.blocked_dates||[])]}));
  if(!items.length)return {nodes:new Map(),order:[],total:0,finish:project.start_date};
  const map=new Map(items.map(task=>[task.id,task]));
  if(map.size!==items.length)throw new Error('工程IDが重複しています。');
  for(const task of items){
    if(!task.id)throw new Error('工程IDがありません。');
    const duration=Number(task.duration_days);
    if(!Number.isInteger(duration)||duration<1||duration>365)throw new Error(`「${task.name}」の日数を1〜365で入力してください。`);
    for(const dependency of task.dependencies){
      if(!map.has(dependency))throw new Error(`「${task.name}」の前提工程が見つかりません。`);
      if(dependency===task.id)throw new Error(`「${task.name}」を自分自身の前提工程にはできません。`);
    }
  }
  const work=calendar(project),nodes=new Map(),pending=new Set(map.keys()),order=[];
  while(pending.size){
    const ready=[...pending].filter(id=>map.get(id).dependencies.every(dependency=>nodes.has(dependency)));
    if(!ready.length)throw new Error('前提工程が循環しています。依存関係を確認してください。');
    ready.sort((a,b)=>(map.get(a).position??0)-(map.get(b).position??0));
    for(const id of ready){
      const task=map.get(id);
      const es=Math.max(0,...task.dependencies.map(dependency=>nodes.get(dependency).ef));
      const duration=Number(task.duration_days)+(id===delay.taskId?Math.max(0,Number(delay.days)||0):0);
      const placement=work.place(es,duration,task.blocked_dates);
      const level=task.dependencies.length?Math.max(...task.dependencies.map(dependency=>nodes.get(dependency).level))+1:0;
      nodes.set(id,{...task,duration,es,ef:placement.endIndex,actualStart:placement.actualStart,span:placement.endIndex-es,level});
      pending.delete(id);order.push(id);
    }
  }
  const total=Math.max(...[...nodes.values()].map(node=>node.ef));
  for(const id of [...order].reverse()){
    const node=nodes.get(id),following=[...nodes.values()].filter(item=>item.dependencies.includes(id));
    node.lf=following.length?Math.min(...following.map(item=>item.ls)):total;
    node.ls=node.lf-node.span;
    node.tf=node.ls-node.es;
    node.ff=following.length?Math.min(...following.map(item=>item.es))-node.ef:total-node.ef;
    node.startDate=work.nthWorkday(node.actualStart);
    node.endDate=work.nthWorkday(node.ef-1);
  }
  return {nodes,order,total,finish:work.nthWorkday(total-1)};
}

export function compareSchedules(project,tasks,taskId,days){
  const before=computeSchedule(project,tasks);
  const after=computeSchedule(project,tasks,{taskId,days});
  const changes=tasks.map(task=>{
    const previous=before.nodes.get(task.id),next=after.nodes.get(task.id);
    return {task,before:previous,after:next,moved:previous.es!==next.es||previous.ef!==next.ef};
  }).filter(change=>change.task.id===taskId||change.moved);
  return {before,after,changes,finishShift:after.total-before.total};
}

export function compareTaskChange(project,tasks,taskId,{delayDays=0,blockedDates=[]}={}){
  const before=computeSchedule(project,tasks),normalizedBlocked=parseDates(blockedDates),patched=tasks.map(task=>task.id===taskId?{
    ...task,duration_days:Number(task.duration_days)+Math.max(0,Number(delayDays)||0),blocked_dates:[...new Set([...(task.blocked_dates||[]),...normalizedBlocked])]
  }:task),after=computeSchedule(project,patched);
  const changes=tasks.map(task=>{const previous=before.nodes.get(task.id),next=after.nodes.get(task.id);return {task,before:previous,after:next,moved:previous.es!==next.es||previous.ef!==next.ef}}).filter(change=>change.task.id===taskId||change.moved);
  return {before,after,changes,finishShift:after.total-before.total,patch:{duration_days:patched.find(task=>task.id===taskId).duration_days,blocked_dates:patched.find(task=>task.id===taskId).blocked_dates}};
}

export function projectMargin(project,schedule){
  if(!project.deadline||!schedule.total)return null;
  const work=calendar(project);let cursor,amount=0;
  if(schedule.finish<=project.deadline){
    cursor=addDays(schedule.finish,1);
    while(cursor<=project.deadline&&amount<5000){if(work.isWorkday(cursor))amount++;cursor=addDays(cursor,1)}
    return amount;
  }
  cursor=addDays(project.deadline,1);
  while(cursor<=schedule.finish&&amount<5000){if(work.isWorkday(cursor))amount++;cursor=addDays(cursor,1)}
  return -amount;
}

export function dateRange(project,schedule,padding=7){
  if(!schedule.total)return [];
  const end=addDays(schedule.finish,padding),dates=[];let cursor=project.start_date;
  while(cursor<=end&&dates.length<1000){dates.push(cursor);cursor=addDays(cursor,1)}
  return dates;
}

export function workdayChecker(project){return calendar(project).isWorkday}
