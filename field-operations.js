import {addDays} from './schedule-engine.js';

export const PROGRESS_STEPS=[0,25,50,75,100];
export const INSPECTION_STATES=['未確認','自主検査済み','監理者確認済み','是正あり','是正完了'];
export const DELAY_CATEGORIES=['未分類','天候','資材','人員','設計・承認','前工程','品質・是正','施主都合','その他'];

export function progressOf(task){
  if(Number.isInteger(task?.progress_percent))return Math.max(0,Math.min(100,task.progress_percent));
  return task?.status==='完了'?100:task?.status==='進行中'?25:0;
}

export function taskState(task){
  const progress=progressOf(task);
  if(progress===100||task.status==='完了')return '完了';
  if(progress>0||task.actual_start)return '進行中';
  return '未着手';
}

export function scheduleState(task,node,today){
  if(taskState(task)==='完了')return '予定内';
  const plannedFinish=task.planned_finish||node?.endDate;
  if(task.status==='遅延'||(plannedFinish&&plannedFinish<today))return '遅延';
  if(!plannedFinish)return '要確認';
  const plannedStart=task.planned_start||node?.startDate;
  if(plannedStart&&plannedStart<=today&&progressOf(task)===0)return '要確認';
  return '予定内';
}

export function validateProgressReport(values){
  const progress=Number(values.progress_percent);
  if(!Number.isInteger(progress)||progress<0||progress>100)throw new Error('進捗率は0〜100の整数で入力してください。');
  if(values.actual_finish&&progress!==100)throw new Error('実績完了日を入れる場合は進捗率を100%にしてください。');
  if(values.actual_start&&values.actual_finish&&values.actual_finish<values.actual_start)throw new Error('実績完了日は実績開始日以降にしてください。');
  if(progress===100&&!values.actual_finish)throw new Error('完了報告には実績完了日が必要です。');
  if(progress<100&&values.actual_finish)throw new Error('完了を解除する場合は実績完了日を空にしてください。');
  const remaining=values.remaining_days===''||values.remaining_days==null?null:Number(values.remaining_days);
  if(remaining!==null&&(!Number.isInteger(remaining)||remaining<0||remaining>3650))throw new Error('残り日数は0〜3650の整数で入力してください。');
  return {...values,progress_percent:progress,remaining_days:progress===100?0:remaining,actual_finish:progress===100?values.actual_finish:null};
}

export function dashboardWindow(today,days=1){return {from:today,to:addDays(today,Math.max(1,days)-1)}}

export function compareVersionTasks(currentTasks,versionRows){
  const current=new Map((currentTasks||[]).map(task=>[task.id,task]));
  const previous=new Map((versionRows||[]).map(row=>[row.task_id,row.task_snapshot||row]));
  const ids=new Set([...current.keys(),...previous.keys()]);
  return [...ids].map(id=>{
    const now=current.get(id),before=previous.get(id);
    if(!before)return {id,type:'added',name:now?.name||'',current:now,previous:null};
    if(!now)return {id,type:'removed',name:before.name||'',current:null,previous:before};
    const fields=['name','company','duration_days','planned_start','planned_finish','actual_start','actual_finish','progress_percent'];
    const changes=fields.filter(field=>String(now[field]??'')!==String(before[field]??'')).map(field=>({field,before:before[field]??null,after:now[field]??null}));
    return {id,type:changes.length?'changed':'same',name:now.name,current:now,previous:before,changes};
  }).filter(item=>item.type!=='same');
}

export function utf8Csv(headers,rows){
  const safeCell=value=>{
    const text=String(value??'');
    return typeof value==='string'&&(/^[\u0000-\u001f]/.test(text)||/^[\s\u00a0]*[=+@-]/u.test(text))?`'${text}`:text;
  };
  const quote=value=>`"${safeCell(value).replaceAll('"','""')}"`;
  return '\uFEFF'+[headers,...rows].map(row=>row.map(quote).join(',')).join('\r\n');
}
