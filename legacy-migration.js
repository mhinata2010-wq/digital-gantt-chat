import {parseDates} from './schedule-engine.js';

const KEYS={accounts:'snake_accounts_v1',projects:'snake_projects_v1',network:'snake_network_schedule_v1'};
const read=key=>{try{return JSON.parse(localStorage.getItem(key))}catch{return null}};
const uuid=()=>crypto.randomUUID();
const safeDates=value=>{try{return parseDates(value)}catch{return []}};

function mapLinearProject(project){
  const ids=(project.tasks||[]).map(()=>uuid());
  const tasks=(project.tasks||[]).map((task,index)=>({
    id:ids[index],position:index,code:String.fromCharCode(65+(index%26)),trade:'',
    name:String(task.name||'名称未設定の工程'),company:String(task.company||''),
    duration_days:Math.max(1,Math.min(365,Number(task.days)||1)),
    dependencies:index?[ids[index-1]]:[],blocked_dates:safeDates(task.blocked),
    status:['未着手','進行中','完了','遅延'].includes(task.status)?task.status:'未着手',notes:''
  }));
  return {
    name:String(project.name||'以前の工程表'),start_date:String(project.start||'2026-08-01'),
    values:{manager:String(project.manager||''),deadline:null,holidays:[]},tasks
  };
}

function mapNetworkProject(project){
  const byCode=new Map((project.tasks||[]).map(task=>[String(task.code),uuid()]));
  return {
    name:String(project.name||'以前のネットワーク工程表'),start_date:String(project.start||'2026-08-01'),
    values:{manager:'',deadline:project.deadline||null,holidays:safeDates(project.holidays)},
    tasks:(project.tasks||[]).map((task,index)=>({
      id:byCode.get(String(task.code)),position:index,code:String(task.code||String.fromCharCode(65+(index%26))),
      trade:String(task.trade||''),name:String(task.name||'名称未設定の工程'),company:String(task.company||''),
      duration_days:Math.max(1,Math.min(365,Number(task.days)||1)),
      dependencies:(task.deps||[]).map(code=>byCode.get(String(code))).filter(Boolean),
      blocked_dates:safeDates(task.blocked),status:task.complete?'完了':'未着手',notes:String(task.notes||'')
    }))
  };
}

export function discoverLegacy(email,userId){
  if(localStorage.getItem(`snake_collab_migrated_v1:${userId}`)==='done')return [];
  const accounts=read(KEYS.accounts)||[],projects=read(KEYS.projects)||[];
  const localAccount=accounts.find(account=>String(account.email||'').toLowerCase()===String(email||'').toLowerCase());
  const found=localAccount?projects.filter(project=>project.ownerId===localAccount.id).map(mapLinearProject):[];
  const network=read(KEYS.network);
  if(network?.tasks?.length)found.push(mapNetworkProject(network));
  return found;
}

export function markMigrated(userId){localStorage.setItem(`snake_collab_migrated_v1:${userId}`,'done')}
export function dismissMigration(userId){localStorage.setItem(`snake_collab_migrated_v1:${userId}`,'dismissed')}
export function migrationDismissed(userId){return localStorage.getItem(`snake_collab_migrated_v1:${userId}`)==='dismissed'}
