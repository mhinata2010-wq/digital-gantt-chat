import {configured,client,session,signUp,signIn,signOut,sendPasswordReset,claimInvitations,loadProfile,loadProjects,createProject,loadProject,updateProject,createTask,updateTask,deleteTask,loadMembers,inviteMember,changeMemberRole,removeMember,loadHistory,importProject,subscribe} from './data-service.js';
import {computeSchedule,compareSchedules,projectMargin,dateRange,workdayChecker,parseDates} from './schedule-engine.js';
import {discoverLegacy,markMigrated,dismissMigration,migrationDismissed} from './legacy-migration.js';
import {categorizeFieldTasks} from './field-dashboard.js';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(`${value}T12:00:00`)):'—';
const formatDateTime=value=>new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const todayISO=()=>{const value=new Date(),pad=number=>String(number).padStart(2,'0');return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`};
const roleLabel={owner:'責任者',editor:'編集者',viewer:'閲覧者'};
const STANDARD_TASK_TEMPLATE=[
  {key:'A',trade:'基礎',name:'基礎掘削・地業',duration_days:4,after:[]},
  {key:'B',trade:'基礎',name:'配筋・型枠工事',duration_days:4,after:['A']},
  {key:'C',trade:'基礎',name:'基礎コンクリート',duration_days:3,after:['B']},
  {key:'D',trade:'木工事',name:'土台・床組み',duration_days:2,after:['C']},
  {key:'E',trade:'木工事',name:'建方・上棟',duration_days:3,after:['D']},
  {key:'F',trade:'屋根',name:'屋根工事',duration_days:4,after:['E']},
  {key:'G',trade:'外装',name:'外壁工事',duration_days:7,after:['E']},
  {key:'H',trade:'設備',name:'電気・給排水配管',duration_days:5,after:['E']},
  {key:'I',trade:'内装',name:'断熱・内装下地',duration_days:6,after:['F','G','H']},
  {key:'J',trade:'内装',name:'内装仕上げ',duration_days:7,after:['I']},
  {key:'K',trade:'設備',name:'住宅設備・器具取付',duration_days:4,after:['J']},
  {key:'L',trade:'外構',name:'外構工事',duration_days:5,after:['G']},
  {key:'M',trade:'検査',name:'完了検査・手直し',duration_days:3,after:['K','L']},
  {key:'N',trade:'完成',name:'引渡し・完成',duration_days:1,after:['M']}
];
const GANTT_MIN_UNIT=20,GANTT_DEFAULT_UNIT=24,GANTT_MAX_UNIT=48;
function savedGanttUnit(){try{const stored=localStorage.getItem('snake-gantt-day-width');if(stored===null)return GANTT_DEFAULT_UNIT;const value=Number(stored);return Number.isFinite(value)?Math.max(GANTT_MIN_UNIT,Math.min(GANTT_MAX_UNIT,value)):GANTT_DEFAULT_UNIT}catch{return GANTT_DEFAULT_UNIT}}
let authMode='login',profile=null,projects=[],currentProject=null,tasks=[],activeView='today',stopRealtime=null,reloadTimer=null,pendingImpact=null,toastTimer=null,ganttUnit=savedGanttUnit();

function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3200)}
function setConnection(state,label){const node=$('#connectionState');node.dataset.state=state;node.textContent=label}
function friendlyErrorMessage(error){
  const message=error?.message||'';
  if(error?.status===429||error?.code==='over_email_send_rate_limit'||/only request this after/i.test(message)){
    return '確認メールの送信回数制限に達しました。すでに登録済みの場合は受信メール（迷惑メールも含む）の確認リンクを開いてください。届いていない場合は、しばらく待ってからもう一度お試しください。';
  }
  if(/user already registered/i.test(message))return 'このメールアドレスは登録済みです。「すでにアカウントをお持ちの方」からログインしてください。';
  if(/password should be at least/i.test(message))return 'パスワードは6文字以上で入力してください。';
  if(/invalid login credentials/i.test(message))return 'メールアドレスまたはパスワードが正しくありません。確認メールをまだ開いていない場合は、先にメール内のリンクを開いてください。';
  if(/email not confirmed/i.test(message))return 'メールアドレスの確認が完了していません。受信メール内の確認リンクを開いてください。';
  return message||'処理に失敗しました。';
}
function showError(error,target='#toast'){
  console.error(error);
  const message=friendlyErrorMessage(error);
  if(target==='#toast')toast(message);else $(target).textContent=message;
}
function setBusy(button,busy,label='処理中…'){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.textContent;button.textContent=label}else if(button.dataset.label){button.textContent=button.dataset.label;delete button.dataset.label}}
function canEdit(){return ['owner','editor'].includes(currentProject?.current_role)}
function isOwner(){return currentProject?.current_role==='owner'}
function taskCodeAt(index){let value=index+1,code='';while(value>0){value--;code=String.fromCharCode(65+value%26)+code;value=Math.floor(value/26)}return code}
function nextTaskCode(){const used=new Set(tasks.map(task=>String(task.code).toUpperCase()));let index=0,code='A';while(used.has(code)){index++;code=taskCodeAt(index)}return code}

function setAuthMode(mode){
  authMode=mode;const register=mode==='register';
  $('#displayNameField').hidden=!register;$('#displayName').required=register;
  $('#authPassword').autocomplete=register?'new-password':'current-password';
  $('#authTitle').textContent=register?'アカウントを作成':'ログイン';
  $('#authDescription').textContent=register?'安全な共同編集を開始します。':'参加している案件を開きます。';
  $('#authSubmit').textContent=register?'アカウントを作成':'ログイン';
  $('#authSwitch').textContent=register?'すでにアカウントをお持ちの方':'新しいアカウントを作る';
  $('#authMessage').textContent='';
}

async function handleAuth(event){
  event.preventDefault();if(!configured)return;
  const button=$('#authSubmit'),email=$('#authEmail').value.trim().toLowerCase(),password=$('#authPassword').value;
  $('#authMessage').textContent='';setBusy(button,true);
  try{
    if(authMode==='register'){
      const result=await signUp(email,password,$('#displayName').value.trim());
      if(!result.session){setBusy(button,false);setAuthMode('login');$('#authMessage').textContent='確認メールを送りました。メール内のリンクを開いてからログインしてください。';return}
    }else await signIn(email,password);
    await enterApplication();
  }catch(error){showError(error,'#authMessage')}finally{setBusy(button,false)}
}

async function enterApplication(){
  await claimInvitations();profile=await loadProfile();
  $('#userName').textContent=profile.display_name||profile.email;$('#userInitial').textContent=(profile.display_name||profile.email||'?').slice(0,1).toUpperCase();
  $('#authView').hidden=true;$('#application').hidden=false;
  const requestedProject=location.hash.match(/^#project=([0-9a-f-]+)$/i)?.[1];
  if(requestedProject)await openProject(requestedProject);else await showProjects();
}

async function showProjects(){
  stopRealtime?.();stopRealtime=null;currentProject=null;tasks=[];location.hash='projects';
  $('#projectView').hidden=true;$('#projectsView').hidden=false;setConnection('online','同期済み');
  projects=await loadProjects();renderProjects();renderMigration();
}

function renderProjects(){
  $('#projectGrid').innerHTML=projects.length?projects.map((project,index)=>{
    const total=project.task_count||0,done=project.completed_count||0,percent=total?Math.round(done/total*100):0;
    return `<article class="project-card" data-project-id="${project.id}" tabindex="0" role="button" aria-label="${esc(project.name)}を開く" style="--item-delay:${Math.min(index*45,360)}ms">
      <div class="project-card-top"><span class="role-pill ${project.current_role}">${roleLabel[project.current_role]}</span><time>${formatDateTime(project.updated_at)}</time></div>
      <h2>${esc(project.name)}</h2><p>${esc(project.manager||'責任者未設定')}</p>
      <div class="progress"><i style="width:${percent}%"></i></div><div class="project-card-foot"><span>${total}工程</span><span>${done}/${total} 完了</span></div>
    </article>`;
  }).join(''):`<div class="empty-state"><b>参加している案件はありません</b><span>「新しい案件」から最初の工程表を作成できます。</span></div>`;
}

function renderMigration(){
  const found=discoverLegacy(profile.email,profile.id);
  $('#migrationBanner').hidden=!found.length||migrationDismissed(profile.id);
  $('#migrationBanner').dataset.count=String(found.length);
}

async function migrateLegacy(){
  const button=$('#migrateButton'),found=discoverLegacy(profile.email,profile.id);if(!found.length)return;
  setBusy(button,true,`0/${found.length} 移行中`);
  try{
    for(let index=0;index<found.length;index++){
      button.textContent=`${index+1}/${found.length} 移行中`;
      const item=found[index];await importProject(item.name,item.start_date,item.values,item.tasks);
    }
    markMigrated(profile.id);toast(`${found.length}件の工程表を移行しました。元の端末内データは残しています。`);await showProjects();
  }catch(error){showError(error)}finally{setBusy(button,false)}
}

async function openProject(id){
  try{
    setConnection('connecting','読込中');
    const loaded=await loadProject(id);currentProject=loaded.project;tasks=loaded.tasks;
    $('#projectsView').hidden=true;$('#projectView').hidden=false;location.hash=`project=${id}`;
    activeView='today';renderProject();startRealtime(id);setConnection('online','同期済み');
  }catch(error){showError(error);await showProjects()}
}

function startRealtime(projectId){
  stopRealtime?.();
  stopRealtime=subscribe(projectId,()=>{
    setConnection('connecting','更新を受信');clearTimeout(reloadTimer);
    reloadTimer=setTimeout(()=>refreshCurrentProject(true),250);
  },status=>setConnection(status==='SUBSCRIBED'?'online':status==='CHANNEL_ERROR'?'offline':'connecting',status==='SUBSCRIBED'?'リアルタイム':'再接続中'));
}

async function refreshCurrentProject(silent=false){
  if(!currentProject)return;
  try{const loaded=await loadProject(currentProject.id);currentProject=loaded.project;tasks=loaded.tasks;renderProject();setConnection('online','同期済み');if(!silent)toast('最新の工程表を読み込みました')}catch(error){setConnection('offline','同期エラー');showError(error)}
}

function renderProject(){
  const role=currentProject.current_role,editable=canEdit(),owner=isOwner();
  $('#projectTitle').textContent=currentProject.name;$('#projectMeta').textContent=`${formatDate(currentProject.start_date)} 着工 ・ ${tasks.length}工程`;
  $('#projectRole').className=`role-pill ${role}`;$('#projectRole').textContent=roleLabel[role];
  $('#membersButton').hidden=!owner;$('#addTaskButton').hidden=!editable;$('#impactButton').hidden=!editable;$('#ganttGestureHelp').querySelectorAll('.edit-only').forEach(node=>node.hidden=!editable);
  $('#projectSettings').hidden=!owner;$('#projectNameInput').value=currentProject.name;$('#managerInput').value=currentProject.manager||'';
  $('#startDateInput').value=currentProject.start_date;$('#deadlineInput').value=currentProject.deadline||'';$('#holidaysInput').value=(currentProject.holidays||[]).join(', ');
  switchView(activeView,false);renderScheduleViews();renderTaskList();
}

function switchView(view,scroll=true){
  activeView=view;
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-current',button.dataset.view===view?'page':'false'));
  for(const name of ['today','gantt','network','tasks'])$(`#${name}View`).hidden=name!==view;
  const target=$(`#${view}View`);target.classList.remove('view-enter');void target.offsetWidth;target.classList.add('view-enter');
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}

function scheduleResult(delay){
  try{return computeSchedule(currentProject,tasks,delay)}catch(error){
    $('#ganttChart').innerHTML=`<div class="empty-state"><b>工程を計算できません</b><span>${esc(error.message)}</span></div>`;
    $('#networkDiagram').innerHTML='';return null;
  }
}

function renderScheduleViews(){
  if(!tasks.length){
    $('#scheduleSummary').innerHTML='';$('#ganttChart').innerHTML='<div class="empty-state"><b>工程がまだありません</b><span>画面上部の「＋ 工程」から最初の工程を作成してください。</span></div>';$('#networkDiagram').innerHTML='';renderToday(null);return;
  }
  const result=scheduleResult();if(!result)return;
  const margin=projectMargin(currentProject,result),critical=[...result.nodes.values()].filter(node=>node.tf===0).length,done=tasks.filter(task=>task.status==='完了').length;
  $('#scheduleSummary').innerHTML=`<div><span>所要工期</span><strong>${result.total}日</strong><small>実働日</small></div><div><span>完了予定</span><strong>${formatDate(result.finish)}</strong><small>${currentProject.deadline?`契約 ${formatDate(currentProject.deadline)}`:'契約日未設定'}</small></div><div><span>契約までの余裕</span><strong>${margin===null?'—':margin>=0?`＋${margin}日`:`${margin}日`}</strong><small>実働日</small></div><div><span>進捗</span><strong>${done}/${tasks.length}</strong><small>重要工程 ${critical}件</small></div>`;
  renderToday(result);renderGantt(result);renderNetwork(result);
}

function todayTaskCard(task,node,tone='normal'){
  const editable=canEdit(),complete=task.status==='完了';
  return `<article class="field-task ${tone} ${complete?'is-complete':''}">
    <button class="field-task-main" data-edit-task="${task.id}" type="button">
      <span class="field-task-code">${esc(task.code)}</span><span><b>${esc(task.name)}</b><small>${esc(task.company||'担当未設定')} ・ ${formatDate(node.startDate)}〜${formatDate(node.endDate)}</small></span><i>›</i>
    </button>
    <div class="field-task-actions"><span class="status-badge ${task.status}">${esc(task.status)}</span>${tone==='delay'&&editable?`<button class="button quiet compact" data-impact-task="${task.id}" type="button">影響を見る</button>`:''}${editable?`<button class="complete-action ${complete?'done':''}" data-toggle-task="${task.id}" type="button" aria-label="${esc(task.name)}を${complete?'未完了に戻す':'完了にする'}">${complete?'✓ 完了':'○ 完了報告'}</button>`:''}</div>
  </article>`;
}

function renderToday(result){
  const today=todayISO(),date=new Date(`${today}T12:00:00`),done=tasks.filter(task=>task.status==='完了').length;
  $('#todayDateLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(date);
  $('#todayProgress').innerHTML=tasks.length?`<b>${done}<span> / ${tasks.length}</span></b><small>工程完了</small>`:'';
  if(!result||!tasks.length){$('#fieldDashboard').innerHTML='<div class="empty-state"><b>工程がまだありません</b><span>「＋ 工程」から追加すると、今日の作業がここに表示されます。</span></div>';return}
  const {current,delayed,upcoming}=categorizeFieldTasks(today,tasks,result.nodes);
  const section=(title,count,list,tone,empty)=>`<section class="field-group ${tone}"><div class="field-group-head"><h3>${title}</h3><span>${count}件</span></div><div class="field-task-list">${list.length?list.map(({task,node})=>todayTaskCard(task,node,tone)).join(''):`<p class="field-empty">${empty}</p>`}</div></section>`;
  $('#fieldDashboard').innerHTML=section('今日の作業',current.length,current,'today','今日予定されている作業はありません。')+section('遅れている作業',delayed.length,delayed,'delay','遅れている作業はありません。')+section('次の作業',upcoming.length,upcoming,'next','次に予定されている作業はありません。');
}

function renderGantt(result){
  const dates=dateRange(currentProject,result,10),unit=ganttUnit,width=dates.length*unit,isWorkday=workdayChecker(currentProject),months=[],weekdays=['日','月','火','水','木','金','土'],today=todayISO();
  for(let index=0;index<dates.length;){const month=dates[index].slice(0,7);let end=index;while(end<dates.length&&dates[end].startsWith(month))end++;months.push(`<span class="gantt-month" data-month-start="${index}" data-month-end="${end}" style="left:${index*unit}px;width:${(end-index)*unit}px">${Number(month.slice(5))}月 <small>${month.slice(0,4)}</small><button class="gantt-scale-handle" data-scale-boundary="${end}" type="button" role="slider" aria-label="カレンダーを拡大・縮小" aria-valuemin="${GANTT_MIN_UNIT}" aria-valuemax="${GANTT_MAX_UNIT}" aria-valuenow="${Math.round(unit)}"></button></span>`);index=end}
  const dayLabels=dates.map((date,index)=>{const day=Number(date.slice(8)),weekday=weekdays[new Date(`${date}T12:00:00`).getDay()];return `<span class="gantt-day ${!isWorkday(date)?'holiday':''} ${date===today?'today':''}" data-header-day-index="${index}" style="left:${index*unit}px;width:${unit}px"><b>${day}</b><small>${weekday}</small></span>`}).join('');
  const shades=dates.map((date,index)=>isWorkday(date)?'':`<i class="off" data-day-index="${index}" style="left:${index*unit}px;width:${unit}px"></i>`).join('');
  const rows=tasks.map((task,index)=>{const node=result.nodes.get(task.id),start=dates.indexOf(node.startDate),end=dates.indexOf(node.endDate),barWidth=Math.max((end-start+1)*unit-4,42),editable=canEdit(),complete=task.status==='完了';return `<div class="gantt-row" style="--row-delay:${Math.min(index*32,280)}ms"><div class="gantt-label"><b>${esc(task.code)} ${esc(task.name)}</b><small>${esc(task.company||'担当未設定')} ・ ${formatDate(node.startDate)}〜${formatDate(node.endDate)}</small></div><div class="gantt-track" style="width:${width}px">${shades}<div class="gantt-task ${editable?'can-edit':''}" data-gantt-task="${task.id}" data-duration="${task.duration_days}" data-start-index="${start}" data-end-index="${end}" style="left:${start*unit+2}px;width:${barWidth}px"><button class="gantt-bar ${node.tf===0?'critical':''} ${complete?'complete':''}" data-edit-task="${task.id}" type="button"><span>${complete?'✓ ':''}${esc(task.name)}</span><small>${task.duration_days}日</small></button>${editable?`<button class="gantt-complete-toggle ${complete?'done':''}" data-toggle-task="${task.id}" type="button" aria-label="${esc(task.name)}を${complete?'未完了に戻す':'完了にする'}">✓</button><button class="gantt-resize-handle" data-resize-task="${task.id}" type="button" role="slider" aria-label="${esc(task.name)}の所要日数" aria-valuemin="1" aria-valuemax="365" aria-valuenow="${task.duration_days}"><i></i></button>`:''}</div></div></div>`}).join('');
  $('#ganttChart').innerHTML=`<div class="gantt-inner" data-total-days="${dates.length}" style="--gantt-unit:${unit}px"><div class="gantt-head"><div class="gantt-label">工程 / 担当</div><div class="gantt-months" style="width:${width}px">${months.join('')}${dayLabels}</div></div>${rows}</div>`;
}

function applyGanttScale(value){
  ganttUnit=Math.max(GANTT_MIN_UNIT,Math.min(GANTT_MAX_UNIT,value));const inner=$('#ganttChart .gantt-inner');if(!inner)return;
  const total=Number(inner.dataset.totalDays),width=total*ganttUnit;inner.style.setProperty('--gantt-unit',`${ganttUnit}px`);
  inner.querySelector('.gantt-months').style.width=`${width}px`;
  inner.querySelectorAll('.gantt-month').forEach(month=>{const start=Number(month.dataset.monthStart),end=Number(month.dataset.monthEnd);month.style.left=`${start*ganttUnit}px`;month.style.width=`${(end-start)*ganttUnit}px`});
  inner.querySelectorAll('.gantt-track').forEach(track=>track.style.width=`${width}px`);
  inner.querySelectorAll('.off[data-day-index]').forEach(day=>{const index=Number(day.dataset.dayIndex);day.style.left=`${index*ganttUnit}px`;day.style.width=`${ganttUnit}px`});
  inner.querySelectorAll('.gantt-day[data-header-day-index]').forEach(day=>{const index=Number(day.dataset.headerDayIndex);day.style.left=`${index*ganttUnit}px`;day.style.width=`${ganttUnit}px`});
  inner.querySelectorAll('.gantt-task').forEach(task=>{const start=Number(task.dataset.startIndex),end=Number(task.dataset.endIndex);task.style.left=`${start*ganttUnit+2}px`;task.style.width=`${Math.max((end-start+1)*ganttUnit-4,42)}px`});
  inner.querySelectorAll('[data-scale-boundary]').forEach(handle=>handle.setAttribute('aria-valuenow',Math.round(ganttUnit)));
}

function beginGanttScale(event){
  const handle=event.target.closest('[data-scale-boundary]');if(!handle)return;
  event.preventDefault();event.stopPropagation();
  const boundary=Math.max(1,Number(handle.dataset.scaleBoundary)),startX=event.clientX,startUnit=ganttUnit;handle.classList.add('dragging');handle.setPointerCapture?.(event.pointerId);
  const move=moveEvent=>applyGanttScale(startUnit+(moveEvent.clientX-startX)/boundary);
  const finish=upEvent=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.releasePointerCapture?.(upEvent.pointerId);handle.classList.remove('dragging');try{localStorage.setItem('snake-gantt-day-width',String(ganttUnit))}catch{}toast(`カレンダー幅を${Math.round(ganttUnit)}px／日に変更しました`)};
  const cancel=cancelEvent=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.releasePointerCapture?.(cancelEvent.pointerId);applyGanttScale(startUnit)};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);
}

async function resizeTaskDuration(taskId,duration,preview=null){
  const task=tasks.find(item=>item.id===taskId),next=Math.max(1,Math.min(365,Number(duration)));if(!task||!canEdit()||next===task.duration_days){renderScheduleViews();return}
  preview?.classList.add('saving');setConnection('connecting','日数を保存中');
  try{await updateTask(task,{duration_days:next});toast(`${task.name}を${next}日に変更しました`);await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}
}

function beginGanttResize(event){
  const handle=event.target.closest('[data-resize-task]');if(!handle||!canEdit())return;
  event.preventDefault();event.stopPropagation();
  const task=tasks.find(item=>item.id===handle.dataset.resizeTask),wrapper=handle.closest('.gantt-task'),bar=wrapper.querySelector('.gantt-bar'),startX=event.clientX,startWidth=wrapper.getBoundingClientRect().width,startDuration=task.duration_days,unit=ganttUnit;
  let nextDuration=startDuration,moved=false;wrapper.classList.add('resizing');handle.setPointerCapture?.(event.pointerId);
  const move=moveEvent=>{const delta=Math.round((moveEvent.clientX-startX)/unit);nextDuration=Math.max(1,Math.min(365,startDuration+delta));moved=moved||Math.abs(moveEvent.clientX-startX)>4;wrapper.style.width=`${Math.max(42,startWidth+(nextDuration-startDuration)*unit)}px`;bar.querySelector('small').textContent=`${nextDuration}日`;handle.setAttribute('aria-valuenow',nextDuration)};
  const finish=upEvent=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.releasePointerCapture?.(upEvent.pointerId);wrapper.classList.remove('resizing');if(moved&&nextDuration!==startDuration)resizeTaskDuration(task.id,nextDuration,wrapper);else renderScheduleViews()};
  const cancel=cancelEvent=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.releasePointerCapture?.(cancelEvent.pointerId);renderScheduleViews()};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);
}

function renderNetwork(result){
  const nodes=[...result.nodes.values()],levels=Math.max(...nodes.map(node=>node.level))+1,positions=new Map();let maxRows=1;
  for(let level=0;level<levels;level++){const group=nodes.filter(node=>node.level===level);maxRows=Math.max(maxRows,group.length);group.forEach((node,index)=>positions.set(node.id,{x:30+level*265,y:35+index*145}))}
  const width=Math.max(900,levels*265+40),height=Math.max(390,maxRows*145+40);let svg='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker></defs>';
  for(const node of nodes)for(const dependency of node.dependencies){const from=positions.get(dependency),to=positions.get(node.id),previous=result.nodes.get(dependency),hot=node.tf===0&&previous.tf===0&&previous.ef===node.es;svg+=`<path class="edge ${hot?'hot':''}" d="M${from.x+215} ${from.y+50} C${from.x+240} ${from.y+50},${to.x-25} ${to.y+50},${to.x-7} ${to.y+50}" marker-end="url(#arrow)"/>`}
  for(const node of nodes){const point=positions.get(node.id),label=node.name.length>15?`${node.name.slice(0,14)}…`:node.name;svg+=`<g class="node ${node.tf===0?'hot':''}" data-edit-task="${node.id}" tabindex="0" role="button" aria-label="${esc(node.name)}の詳細を開く" transform="translate(${point.x},${point.y})"><rect width="215" height="105" rx="6"/><text x="13" y="23" class="node-code">${esc(node.code)} ${esc(node.trade)}</text><text x="13" y="48" class="node-name">${esc(label)}</text><path d="M13 62 H202" class="node-rule"/><text x="13" y="81" class="node-numbers">EST ${node.es}  EFT ${node.ef}</text><text x="13" y="97" class="node-numbers">LST ${node.ls}  LFT ${node.lf}  TF ${node.tf}</text></g>`}
  const diagram=$('#networkDiagram');diagram.setAttribute('viewBox',`0 0 ${width} ${height}`);diagram.setAttribute('width',width);diagram.setAttribute('height',height);diagram.innerHTML=svg;
}

function renderTaskList(){
  $('#taskList').innerHTML=tasks.length?tasks.map(task=>{
    const dependencies=(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean).join('、')||'なし';
    return `<article class="task-row" data-task-id="${task.id}" tabindex="0" role="button"><span class="task-code">${esc(task.code)}</span><div class="task-main"><b>${esc(task.name)}</b><small>${esc(task.trade||'工種未設定')}</small></div><div class="task-cell"><b>${esc(task.company||'担当未設定')}</b><small>担当会社</small></div><div class="task-cell"><b>${task.duration_days}日</b><small>所要日数</small></div><div class="task-cell"><b>${esc(dependencies)}</b><small>前提工程</small></div>${canEdit()?`<button class="complete-action ${task.status==='完了'?'done':''}" data-toggle-task="${task.id}" type="button">${task.status==='完了'?'✓ 完了':'○ 完了報告'}</button>`:`<span class="status-badge ${task.status}">${esc(task.status)}</span>`}</article>`;
  }).join(''):'<div class="empty-state"><b>工程がありません</b><span>右上の「工程を作る」から追加してください。</span></div>';
}

function openTaskEditor(task=null){
  const editable=canEdit();if(!task&&!editable)return;const form=$('#taskForm');form.reset();$('#taskFormMessage').textContent='';
  $('#taskDialogTitle').textContent=task?(editable?'工程を編集':'工程詳細'):'工程を作る';form.elements.id.value=task?.id||'';form.elements.version.value=task?.version||'';
  for(const field of ['code','trade','name','company','duration_days','status','notes'])form.elements[field].value=task?.[field]??(field==='code'?nextTaskCode():field==='duration_days'?1:field==='status'?'未着手':'');
  form.elements.blocked_dates.value=(task?.blocked_dates||[]).join(', ');
  form.elements.dependencies.innerHTML=tasks.filter(item=>item.id!==task?.id).map(item=>`<option value="${item.id}" ${(task?.dependencies||[]).includes(item.id)?'selected':''}>${esc(item.code)} ${esc(item.name)}</option>`).join('');
  form.querySelectorAll('input,select,textarea,[data-duration-step]').forEach(node=>node.disabled=!editable);
  $('#deleteTaskButton').hidden=!task||!editable;$('#taskSaveButton').hidden=!editable;$('#taskDialog').showModal();
}

async function addStandardTemplate(projectId,button){
  const created=new Map();
  for(let index=0;index<STANDARD_TASK_TEMPLATE.length;index++){
    const item=STANDARD_TASK_TEMPLATE[index];button.textContent=`工程を作成中 ${index+1}/${STANDARD_TASK_TEMPLATE.length}`;
    const task=await createTask(projectId,{position:index,code:item.key,trade:item.trade,name:item.name,company:'',duration_days:item.duration_days,status:'未着手',dependencies:item.after.map(key=>created.get(key)),blocked_dates:[],notes:'標準工程テンプレート'});
    created.set(item.key,task.id);
  }
}

function taskValues(form){
  return {position:form.elements.id.value?(tasks.find(item=>item.id===form.elements.id.value)?.position??0):tasks.length,
    code:form.elements.code.value.trim().toUpperCase(),trade:form.elements.trade.value.trim(),name:form.elements.name.value.trim(),company:form.elements.company.value.trim(),
    duration_days:Number(form.elements.duration_days.value),status:form.elements.status.value,
    dependencies:[...form.elements.dependencies.selectedOptions].map(option=>option.value),blocked_dates:parseDates(form.elements.blocked_dates.value),notes:form.elements.notes.value.trim()};
}

async function saveTask(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');$('#taskFormMessage').textContent='';setBusy(button,true);
  try{
    const values=taskValues(form),id=form.elements.id.value;
    if(id){const task=tasks.find(item=>item.id===id);await updateTask(task,values)}else await createTask(currentProject.id,values);
    $('#taskDialog').close();toast('工程を保存しました');await refreshCurrentProject(true);
  }catch(error){showError(error,'#taskFormMessage');if(error.code==='CONFLICT')await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function removeCurrentTask(){
  const id=$('#taskForm').elements.id.value,task=tasks.find(item=>item.id===id);if(!task)return;
  if(tasks.some(item=>(item.dependencies||[]).includes(id))){showError(new Error('この工程を前提にしている工程があります。先に依存関係を外してください。'),'#taskFormMessage');return}
  if(!confirm(`「${task.name}」を削除しますか？`))return;
  try{await deleteTask(task);$('#taskDialog').close();toast('工程を削除しました');await refreshCurrentProject(true)}catch(error){showError(error,'#taskFormMessage');if(error.code==='CONFLICT')await refreshCurrentProject(true)}
}

async function toggleTask(id){
  if(!canEdit())return;const task=tasks.find(item=>item.id===id);if(!task)return;
  const complete=task.status!=='完了';setConnection('connecting',complete?'完了を保存中':'状態を保存中');
  try{await updateTask(task,{status:complete?'完了':'未着手'});toast(complete?`「${task.name}」を完了にしました`:`「${task.name}」を未完了に戻しました`);await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}
}

async function saveProjectSettings(){
  const button=$('#saveProjectButton');setBusy(button,true);
  try{
    await updateProject(currentProject,{name:$('#projectNameInput').value.trim(),manager:$('#managerInput').value.trim(),start_date:$('#startDateInput').value,deadline:$('#deadlineInput').value||null,holidays:parseDates($('#holidaysInput').value)});
    toast('案件設定を保存しました');await refreshCurrentProject(true);
  }catch(error){showError(error);if(error.code==='CONFLICT')await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function openMembers(){
  if(!isOwner())return;$('#inviteMessage').textContent='';$('#membersDialog').showModal();await renderMembers();
}
async function renderMembers(){
  try{const members=await loadMembers(currentProject.id);$('#memberList').innerHTML=members.map(member=>`<div class="member-row" data-member-id="${member.id}"><div><b>${esc(member.email)}</b><small>${member.accepted_at?'参加済み':'招待待ち'}</small></div>${member.role==='owner'?'<span class="member-role owner">責任者</span>':`<select data-member-role aria-label="${esc(member.email)}の権限"><option value="editor" ${member.role==='editor'?'selected':''}>編集者</option><option value="viewer" ${member.role==='viewer'?'selected':''}>閲覧者</option></select><button class="button danger compact" data-remove-member type="button">削除</button>`}</div>`).join('')}catch(error){showError(error,'#inviteMessage')}
}
async function invite(event){
  event.preventDefault();const button=event.currentTarget.querySelector('button'),data=new FormData(event.currentTarget);setBusy(button,true);$('#inviteMessage').textContent='';
  try{await inviteMember(currentProject.id,String(data.get('email')).trim().toLowerCase(),data.get('role'));event.currentTarget.reset();toast('招待を追加しました');await renderMembers()}catch(error){showError(error,'#inviteMessage')}finally{setBusy(button,false)}
}

async function showHistory(){
  $('#historyDialog').showModal();$('#historyList').innerHTML='<div class="empty-state">読み込み中…</div>';
  try{const history=await loadHistory(currentProject.id);$('#historyList').innerHTML=history.length?history.map(item=>`<article class="history-item"><time>${formatDateTime(item.created_at)}</time><div><b>${esc(historyText(item))}</b><small>${esc(item.summary)}</small></div><small>${esc(item.actor_email)}</small></article>`).join(''):'<div class="empty-state">変更履歴はまだありません。</div>'}catch(error){showError(error)}
}
function historyText(item){const entity={project:'案件',task:'工程',member:'メンバー'}[item.entity_type]||item.entity_type,action={create:'を追加',update:'を変更',delete:'を削除'}[item.action]||item.action;return `${entity}${action}`}

function openImpact(taskId=null){
  if(!canEdit()||!tasks.length)return;pendingImpact=null;$('#applyImpactButton').hidden=true;
  $('#delayTaskSelect').innerHTML=tasks.map(task=>`<option value="${task.id}">${esc(task.code)} ${esc(task.name)}</option>`).join('');
  if(taskId&&tasks.some(task=>task.id===taskId))$('#delayTaskSelect').value=taskId;
  $('#impactResult').textContent='工程と遅延日数を選択してください。日程は確認するまで変更されません。';$('#impactDialog').showModal();
}
function calculateImpact(){
  try{
    const taskId=$('#delayTaskSelect').value,days=Math.max(1,Math.min(365,Number($('#delayDaysInput').value)||1));pendingImpact={taskId,days,...compareSchedules(currentProject,tasks,taskId,days)};
    const task=tasks.find(item=>item.id===taskId),affected=pendingImpact.changes.filter(change=>change.task.id!==taskId);
    $('#impactResult').innerHTML=`<strong>「${esc(task.name)}」が${days}実働日遅れる場合</strong><br>${affected.length?`後続の ${affected.map(change=>esc(change.task.name)).join('、')} に影響します。`:'後続工程の開始日は変わりません。'} 完了予定は ${formatDate(pendingImpact.after.finish)}（${pendingImpact.finishShift?`${pendingImpact.finishShift}実働日後ろ倒し`:'変更なし'}）です。${isOwner()?'':'<br><small>変更案の確定は責任者が行います。</small>'}`;
    $('#applyImpactButton').hidden=!isOwner();
  }catch(error){showError(error);pendingImpact=null;$('#applyImpactButton').hidden=true}
}
async function applyImpact(){
  if(!pendingImpact||!isOwner())return;const task=tasks.find(item=>item.id===pendingImpact.taskId),button=$('#applyImpactButton');setBusy(button,true);
  try{await updateTask(task,{duration_days:task.duration_days+pendingImpact.days});$('#impactDialog').close();toast('確認した変更案を工程表へ反映しました');await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function boot(){
  setAuthMode('login');
  if(!configured){$('#setupNotice').hidden=false;$('#authView').hidden=false;$('#authForm').querySelectorAll('input,button').forEach(node=>node.disabled=true);return}
  $('#setupNotice').hidden=true;
  $('#authView').querySelectorAll('input,button').forEach(node=>node.disabled=false);
  try{const current=await session();if(current)await enterApplication();else $('#authView').hidden=false}catch(error){$('#authView').hidden=false;showError(error,'#authMessage')}
}

$('#authForm').addEventListener('submit',handleAuth);$('#authSwitch').addEventListener('click',()=>setAuthMode(authMode==='login'?'register':'login'));
$('#resetPassword').addEventListener('click',async()=>{const email=$('#authEmail').value.trim();if(!email){$('#authMessage').textContent='メールアドレスを入力してください。';return}try{await sendPasswordReset(email);$('#authMessage').textContent='パスワード再設定メールを送りました。'}catch(error){showError(error,'#authMessage')}});
$('#logoutButton').addEventListener('click',async()=>{await signOut();stopRealtime?.();location.hash='';$('#application').hidden=true;$('#authView').hidden=false;setAuthMode('login')});
$('#backButton').addEventListener('click',showProjects);$('#brandLink').addEventListener('click',event=>{event.preventDefault();showProjects()});
$('#newProjectButton').addEventListener('click',()=>{const form=$('#projectForm');form.reset();form.elements.start_date.value=new Date().toISOString().slice(0,10);$('#projectDialog').showModal()});
$('#projectForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),data=new FormData(form);setBusy(button,true,'案件を作成中…');try{const id=await createProject(data.get('name'),data.get('start_date'));if(data.has('use_template'))await addStandardTemplate(id,button);$('#projectDialog').close();await openProject(id);if(data.has('use_template'))toast('標準工程を作成しました。日数や順序は自由に編集できます。')}catch(error){showError(error)}finally{setBusy(button,false)}});
$('#projectGrid').addEventListener('click',event=>{const card=event.target.closest('[data-project-id]');if(card)openProject(card.dataset.projectId)});$('#projectGrid').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){const card=event.target.closest('[data-project-id]');if(card){event.preventDefault();openProject(card.dataset.projectId)}}});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
$('#addTaskButton').addEventListener('click',()=>openTaskEditor());$('#taskForm').addEventListener('submit',saveTask);$('#deleteTaskButton').addEventListener('click',removeCurrentTask);
$('#taskForm').addEventListener('click',event=>{const step=event.target.closest('[data-duration-step]');if(!step)return;const input=event.currentTarget.elements.duration_days;input.value=Math.max(1,Math.min(365,Number(input.value||1)+Number(step.dataset.durationStep)))});
$('#taskList').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-task]');if(toggle){event.stopPropagation();toggleTask(toggle.dataset.toggleTask);return}const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))});$('#taskList').addEventListener('keydown',event=>{if(event.key==='Enter'){const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))}});
$('#fieldDashboard').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-task]');if(toggle){toggleTask(toggle.dataset.toggleTask);return}const impact=event.target.closest('[data-impact-task]');if(impact){openImpact(impact.dataset.impactTask);return}const edit=event.target.closest('[data-edit-task]');if(edit)openTaskEditor(tasks.find(task=>task.id===edit.dataset.editTask))});
$('#ganttChart').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-task]');if(toggle){event.stopPropagation();toggleTask(toggle.dataset.toggleTask);return}const button=event.target.closest('[data-edit-task]');if(button)openTaskEditor(tasks.find(task=>task.id===button.dataset.editTask))});
$('#networkDiagram').addEventListener('click',event=>{const node=event.target.closest('[data-edit-task]');if(node)openTaskEditor(tasks.find(task=>task.id===node.dataset.editTask))});
$('#networkDiagram').addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key))return;const node=event.target.closest('[data-edit-task]');if(node){event.preventDefault();openTaskEditor(tasks.find(task=>task.id===node.dataset.editTask))}});
$('#ganttChart').addEventListener('pointerdown',beginGanttScale);
$('#ganttChart').addEventListener('pointerdown',beginGanttResize);
$('#ganttChart').addEventListener('keydown',event=>{const scale=event.target.closest('[data-scale-boundary]');if(scale&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();applyGanttScale(ganttUnit+(event.key==='ArrowRight'?2:-2));try{localStorage.setItem('snake-gantt-day-width',String(ganttUnit))}catch{}return}const handle=event.target.closest('[data-resize-task]');if(!handle||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const task=tasks.find(item=>item.id===handle.dataset.resizeTask);resizeTaskDuration(task.id,task.duration_days+(event.key==='ArrowRight'?1:-1),handle.closest('.gantt-task'))});
$('#resetGanttScale').addEventListener('click',()=>{applyGanttScale(GANTT_DEFAULT_UNIT);try{localStorage.setItem('snake-gantt-day-width',String(GANTT_DEFAULT_UNIT))}catch{}toast('カレンダーの表示幅を標準に戻しました')});
$('#saveProjectButton').addEventListener('click',saveProjectSettings);$('#membersButton').addEventListener('click',openMembers);$('#inviteForm').addEventListener('submit',invite);
$('#memberList').addEventListener('change',async event=>{const select=event.target.closest('[data-member-role]');if(!select)return;try{await changeMemberRole(select.closest('[data-member-id]').dataset.memberId,select.value);toast('権限を変更しました');await renderMembers()}catch(error){showError(error);await renderMembers()}});
$('#memberList').addEventListener('click',async event=>{const button=event.target.closest('[data-remove-member]');if(!button)return;try{await removeMember(button.closest('[data-member-id]').dataset.memberId);toast('メンバーを削除しました');await renderMembers()}catch(error){showError(error)}});
$('#historyButton').addEventListener('click',showHistory);$('#impactButton').addEventListener('click',openImpact);$('#calculateImpactButton').addEventListener('click',calculateImpact);$('#applyImpactButton').addEventListener('click',applyImpact);$('#printButton').addEventListener('click',()=>window.print());
$('#migrateButton').addEventListener('click',migrateLegacy);$('#dismissMigration').addEventListener('click',()=>{dismissMigration(profile.id);$('#migrationBanner').hidden=true});
document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
window.addEventListener('online',()=>setConnection('connecting','再接続中'));window.addEventListener('offline',()=>setConnection('offline','オフライン'));
client?.auth.onAuthStateChange((event,current)=>{if(event==='SIGNED_OUT'&&!current){profile=null;projects=[];currentProject=null}});
boot();
