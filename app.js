import {configured,client,session,signUp,signIn,signOut,sendPasswordReset,claimInvitations,loadProfile,loadProjects,createProject,loadProject,updateProject,createTask,updateTask,deleteTask,loadMembers,inviteMember,changeMemberRole,removeMember,loadHistory,importProject,subscribe} from './data-service.js';
import {computeSchedule,compareSchedules,projectMargin,dateRange,workdayChecker,parseDates} from './schedule-engine.js';
import {discoverLegacy,markMigrated,dismissMigration,migrationDismissed} from './legacy-migration.js';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(`${value}T12:00:00`)):'—';
const formatDateTime=value=>new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const roleLabel={owner:'責任者',editor:'編集者',viewer:'閲覧者'};
let authMode='login',profile=null,projects=[],currentProject=null,tasks=[],activeView='gantt',stopRealtime=null,reloadTimer=null,pendingImpact=null,toastTimer=null;

function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3200)}
function setConnection(state,label){const node=$('#connectionState');node.dataset.state=state;node.textContent=label}
function showError(error,target='#toast'){
  console.error(error);
  const message=error?.message||'処理に失敗しました。';
  if(target==='#toast')toast(message);else $(target).textContent=message;
}
function setBusy(button,busy,label='処理中…'){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.textContent;button.textContent=label}else if(button.dataset.label){button.textContent=button.dataset.label;delete button.dataset.label}}
function canEdit(){return ['owner','editor'].includes(currentProject?.current_role)}
function isOwner(){return currentProject?.current_role==='owner'}

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
  $('#authView').hidden=true;$('#application').hidden=false;await showProjects();
}

async function showProjects(){
  stopRealtime?.();stopRealtime=null;currentProject=null;tasks=[];location.hash='projects';
  $('#projectView').hidden=true;$('#projectsView').hidden=false;setConnection('online','同期済み');
  projects=await loadProjects();renderProjects();renderMigration();
}

function renderProjects(){
  $('#projectGrid').innerHTML=projects.length?projects.map(project=>{
    const total=project.task_count||0,done=project.completed_count||0,percent=total?Math.round(done/total*100):0;
    return `<article class="project-card" data-project-id="${project.id}" tabindex="0" role="button" aria-label="${esc(project.name)}を開く">
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
    activeView='gantt';renderProject();startRealtime(id);setConnection('online','同期済み');
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
  $('#membersButton').hidden=!owner;$('#addTaskButton').hidden=!editable;$('#impactButton').hidden=!editable;
  $('#projectSettings').hidden=!owner;$('#projectNameInput').value=currentProject.name;$('#managerInput').value=currentProject.manager||'';
  $('#startDateInput').value=currentProject.start_date;$('#deadlineInput').value=currentProject.deadline||'';$('#holidaysInput').value=(currentProject.holidays||[]).join(', ');
  switchView(activeView,false);renderScheduleViews();renderTaskList();
}

function switchView(view,scroll=true){
  activeView=view;
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-current',button.dataset.view===view?'page':'false'));
  for(const name of ['gantt','network','tasks'])$(`#${name}View`).hidden=name!==view;
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
    $('#scheduleSummary').innerHTML='';$('#ganttChart').innerHTML='<div class="empty-state"><b>工程がまだありません</b><span>「工程を編集」から最初の工程を作成してください。</span></div>';$('#networkDiagram').innerHTML='';return;
  }
  const result=scheduleResult();if(!result)return;
  const margin=projectMargin(currentProject,result),critical=[...result.nodes.values()].filter(node=>node.tf===0).length,done=tasks.filter(task=>task.status==='完了').length;
  $('#scheduleSummary').innerHTML=`<div><span>所要工期</span><strong>${result.total}日</strong><small>実働日</small></div><div><span>完了予定</span><strong>${formatDate(result.finish)}</strong><small>${currentProject.deadline?`契約 ${formatDate(currentProject.deadline)}`:'契約日未設定'}</small></div><div><span>契約までの余裕</span><strong>${margin===null?'—':margin>=0?`＋${margin}日`:`${margin}日`}</strong><small>実働日</small></div><div><span>進捗</span><strong>${done}/${tasks.length}</strong><small>重要工程 ${critical}件</small></div>`;
  renderGantt(result);renderNetwork(result);
}

function renderGantt(result){
  const dates=dateRange(currentProject,result,10),unit=24,width=dates.length*unit,isWorkday=workdayChecker(currentProject),months=[];
  for(let index=0;index<dates.length;){const month=dates[index].slice(0,7);let end=index;while(end<dates.length&&dates[end].startsWith(month))end++;months.push(`<span style="left:${index*unit}px;width:${(end-index)*unit}px">${Number(month.slice(5))}月 <small>${month.slice(0,4)}</small></span>`);index=end}
  const shades=dates.map((date,index)=>isWorkday(date)?'':`<i class="off" style="left:${index*unit}px;width:${unit}px"></i>`).join('');
  const rows=tasks.map(task=>{const node=result.nodes.get(task.id),start=dates.indexOf(node.startDate),end=dates.indexOf(node.endDate);return `<div class="gantt-row"><div class="gantt-label"><b>${esc(task.code)} ${esc(task.name)}</b><small>${esc(task.company||'担当未設定')} ・ ${formatDate(node.startDate)}〜${formatDate(node.endDate)}</small></div><div class="gantt-track" style="width:${width}px">${shades}<button class="gantt-bar ${node.tf===0?'critical':''} ${task.status==='完了'?'complete':''}" data-toggle-task="${task.id}" style="left:${start*unit+2}px;width:${Math.max((end-start+1)*unit-4,42)}px" ${canEdit()?'':'disabled'}>${task.status==='完了'?'✓ ':''}${esc(task.name)}</button></div></div>`}).join('');
  $('#ganttChart').innerHTML=`<div class="gantt-inner"><div class="gantt-head"><div class="gantt-label">工程 / 担当</div><div class="gantt-months" style="width:${width}px">${months.join('')}</div></div>${rows}</div>`;
}

function renderNetwork(result){
  const nodes=[...result.nodes.values()],levels=Math.max(...nodes.map(node=>node.level))+1,positions=new Map();let maxRows=1;
  for(let level=0;level<levels;level++){const group=nodes.filter(node=>node.level===level);maxRows=Math.max(maxRows,group.length);group.forEach((node,index)=>positions.set(node.id,{x:30+level*265,y:35+index*145}))}
  const width=Math.max(900,levels*265+40),height=Math.max(390,maxRows*145+40);let svg='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker></defs>';
  for(const node of nodes)for(const dependency of node.dependencies){const from=positions.get(dependency),to=positions.get(node.id),previous=result.nodes.get(dependency),hot=node.tf===0&&previous.tf===0&&previous.ef===node.es;svg+=`<path class="edge ${hot?'hot':''}" d="M${from.x+215} ${from.y+50} C${from.x+240} ${from.y+50},${to.x-25} ${to.y+50},${to.x-7} ${to.y+50}" marker-end="url(#arrow)"/>`}
  for(const node of nodes){const point=positions.get(node.id),label=node.name.length>15?`${node.name.slice(0,14)}…`:node.name;svg+=`<g class="node ${node.tf===0?'hot':''}" transform="translate(${point.x},${point.y})"><rect width="215" height="105" rx="6"/><text x="13" y="23" class="node-code">${esc(node.code)} ${esc(node.trade)}</text><text x="13" y="48" class="node-name">${esc(label)}</text><path d="M13 62 H202" class="node-rule"/><text x="13" y="81" class="node-numbers">EST ${node.es}  EFT ${node.ef}</text><text x="13" y="97" class="node-numbers">LST ${node.ls}  LFT ${node.lf}  TF ${node.tf}</text></g>`}
  const diagram=$('#networkDiagram');diagram.setAttribute('viewBox',`0 0 ${width} ${height}`);diagram.setAttribute('width',width);diagram.setAttribute('height',height);diagram.innerHTML=svg;
}

function renderTaskList(){
  $('#taskList').innerHTML=tasks.length?tasks.map(task=>{
    const dependencies=(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean).join('、')||'なし';
    return `<article class="task-row" data-task-id="${task.id}" ${canEdit()?'tabindex="0" role="button"':''}><span class="task-code">${esc(task.code)}</span><div class="task-main"><b>${esc(task.name)}</b><small>${esc(task.trade||'工種未設定')}</small></div><div class="task-cell"><b>${esc(task.company||'担当未設定')}</b><small>担当会社</small></div><div class="task-cell"><b>${task.duration_days}日</b><small>所要日数</small></div><div class="task-cell"><b>${esc(dependencies)}</b><small>前提工程</small></div><span class="status-badge ${task.status}">${esc(task.status)}</span></article>`;
  }).join(''):'<div class="empty-state"><b>工程がありません</b><span>右上の「工程を作る」から追加してください。</span></div>';
}

function openTaskEditor(task=null){
  if(!canEdit())return;const form=$('#taskForm');form.reset();$('#taskFormMessage').textContent='';
  $('#taskDialogTitle').textContent=task?'工程を編集':'工程を作る';form.elements.id.value=task?.id||'';form.elements.version.value=task?.version||'';
  for(const field of ['code','trade','name','company','duration_days','status','notes'])form.elements[field].value=task?.[field]??(field==='duration_days'?1:field==='status'?'未着手':'');
  form.elements.blocked_dates.value=(task?.blocked_dates||[]).join(', ');
  form.elements.dependencies.innerHTML=tasks.filter(item=>item.id!==task?.id).map(item=>`<option value="${item.id}" ${(task?.dependencies||[]).includes(item.id)?'selected':''}>${esc(item.code)} ${esc(item.name)}</option>`).join('');
  $('#deleteTaskButton').hidden=!task;$('#taskDialog').showModal();
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
  try{await updateTask(task,{status:task.status==='完了'?'未着手':'完了'});await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}
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
  try{const members=await loadMembers(currentProject.id);$('#memberList').innerHTML=members.map(member=>`<div class="member-row" data-member-id="${member.id}"><div><b>${esc(member.email)}</b><small>${member.accepted_at?'参加済み':'招待待ち'}</small></div><select data-member-role ${member.role==='owner'?'disabled':''}><option value="editor" ${member.role==='editor'?'selected':''}>編集者</option><option value="viewer" ${member.role==='viewer'?'selected':''}>閲覧者</option><option value="owner" ${member.role==='owner'?'selected':''}>責任者</option></select>${member.role==='owner'?'':`<button class="button danger compact" data-remove-member type="button">削除</button>`}</div>`).join('')}catch(error){showError(error,'#inviteMessage')}
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

function openImpact(){
  if(!canEdit()||!tasks.length)return;pendingImpact=null;$('#applyImpactButton').hidden=true;
  $('#delayTaskSelect').innerHTML=tasks.map(task=>`<option value="${task.id}">${esc(task.code)} ${esc(task.name)}</option>`).join('');
  $('#impactResult').textContent='工程と遅延日数を選択してください。日程は確認するまで変更されません。';$('#impactDialog').showModal();
}
function calculateImpact(){
  try{
    const taskId=$('#delayTaskSelect').value,days=Math.max(1,Math.min(365,Number($('#delayDaysInput').value)||1));pendingImpact={taskId,days,...compareSchedules(currentProject,tasks,taskId,days)};
    const task=tasks.find(item=>item.id===taskId),affected=pendingImpact.changes.filter(change=>change.task.id!==taskId);
    $('#impactResult').innerHTML=`<strong>「${esc(task.name)}」が${days}実働日遅れる場合</strong><br>${affected.length?`後続の ${affected.map(change=>esc(change.task.name)).join('、')} に影響します。`:'後続工程の開始日は変わりません。'} 完了予定は ${formatDate(pendingImpact.after.finish)}（${pendingImpact.finishShift?`${pendingImpact.finishShift}実働日後ろ倒し`:'変更なし'}）です。`;
    $('#applyImpactButton').hidden=false;
  }catch(error){showError(error);pendingImpact=null;$('#applyImpactButton').hidden=true}
}
async function applyImpact(){
  if(!pendingImpact)return;const task=tasks.find(item=>item.id===pendingImpact.taskId),button=$('#applyImpactButton');setBusy(button,true);
  try{await updateTask(task,{duration_days:task.duration_days+pendingImpact.days});$('#impactDialog').close();toast('確認した変更案を工程表へ反映しました');await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function boot(){
  setAuthMode('login');
  if(!configured){$('#setupNotice').hidden=false;$('#authView').hidden=false;$('#authForm').querySelectorAll('input,button').forEach(node=>node.disabled=true);return}
  try{const current=await session();if(current)await enterApplication();else $('#authView').hidden=false}catch(error){$('#authView').hidden=false;showError(error,'#authMessage')}
}

$('#authForm').addEventListener('submit',handleAuth);$('#authSwitch').addEventListener('click',()=>setAuthMode(authMode==='login'?'register':'login'));
$('#resetPassword').addEventListener('click',async()=>{const email=$('#authEmail').value.trim();if(!email){$('#authMessage').textContent='メールアドレスを入力してください。';return}try{await sendPasswordReset(email);$('#authMessage').textContent='パスワード再設定メールを送りました。'}catch(error){showError(error,'#authMessage')}});
$('#logoutButton').addEventListener('click',async()=>{await signOut();stopRealtime?.();location.hash='';$('#application').hidden=true;$('#authView').hidden=false;setAuthMode('login')});
$('#backButton').addEventListener('click',showProjects);$('#brandLink').addEventListener('click',event=>{event.preventDefault();showProjects()});
$('#newProjectButton').addEventListener('click',()=>{const form=$('#projectForm');form.reset();form.elements.start_date.value=new Date().toISOString().slice(0,10);$('#projectDialog').showModal()});
$('#projectForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),data=new FormData(form);setBusy(button,true);try{const id=await createProject(data.get('name'),data.get('start_date'));$('#projectDialog').close();await openProject(id)}catch(error){showError(error)}finally{setBusy(button,false)}});
$('#projectGrid').addEventListener('click',event=>{const card=event.target.closest('[data-project-id]');if(card)openProject(card.dataset.projectId)});$('#projectGrid').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){const card=event.target.closest('[data-project-id]');if(card){event.preventDefault();openProject(card.dataset.projectId)}}});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
$('#addTaskButton').addEventListener('click',()=>openTaskEditor());$('#taskForm').addEventListener('submit',saveTask);$('#deleteTaskButton').addEventListener('click',removeCurrentTask);
$('#taskList').addEventListener('click',event=>{const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))});$('#taskList').addEventListener('keydown',event=>{if(event.key==='Enter'){const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))}});
$('#ganttChart').addEventListener('click',event=>{const button=event.target.closest('[data-toggle-task]');if(button)toggleTask(button.dataset.toggleTask)});
$('#saveProjectButton').addEventListener('click',saveProjectSettings);$('#membersButton').addEventListener('click',openMembers);$('#inviteForm').addEventListener('submit',invite);
$('#memberList').addEventListener('change',async event=>{const select=event.target.closest('[data-member-role]');if(!select)return;try{await changeMemberRole(select.closest('[data-member-id]').dataset.memberId,select.value);toast('権限を変更しました');await renderMembers()}catch(error){showError(error);await renderMembers()}});
$('#memberList').addEventListener('click',async event=>{const button=event.target.closest('[data-remove-member]');if(!button)return;try{await removeMember(button.closest('[data-member-id]').dataset.memberId);toast('メンバーを削除しました');await renderMembers()}catch(error){showError(error)}});
$('#historyButton').addEventListener('click',showHistory);$('#impactButton').addEventListener('click',openImpact);$('#calculateImpactButton').addEventListener('click',calculateImpact);$('#applyImpactButton').addEventListener('click',applyImpact);$('#printButton').addEventListener('click',()=>window.print());
$('#migrateButton').addEventListener('click',migrateLegacy);$('#dismissMigration').addEventListener('click',()=>{dismissMigration(profile.id);$('#migrationBanner').hidden=true});
document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
window.addEventListener('online',()=>setConnection('connecting','再接続中'));window.addEventListener('offline',()=>setConnection('offline','オフライン'));
client?.auth.onAuthStateChange((event,current)=>{if(event==='SIGNED_OUT'&&!current){profile=null;projects=[];currentProject=null}});
boot();
