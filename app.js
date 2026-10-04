import {configured,client,session,signUp,signIn,signOut,sendPasswordReset,claimInvitations,loadProfile,updateProfileName,loadProjects,createProject,loadProject,updateProject,createTask,updateTask,deleteTask,loadMembers,inviteMember,changeMemberRole,removeMember,loadHistory,importProject,subscribe,reportTaskProgress,syncPlannedDates,loadTaskActivity,createComment,uploadTaskFiles,saveAttachmentRecords,removeUploadedFiles,signedAttachmentUrl,createManagementItem,updateManagementItem,deleteManagementItem,saveManagementAttachmentRecords,createScheduleVersion,loadVersionTasks,restoreScheduleVersion,submitScheduleChangeRequest,reviewScheduleChangeRequest,createInvitation,listInvitations,revokeInvitation,acceptInvitation,loadNotifications,markNotificationRead,markAllNotificationsRead,loadNotificationPreferences,saveNotificationPreferences,applyScheduleImport,saveNetworkLayout,resetNetworkLayout,saveNetworkEventLayout,resetNetworkEventLayout} from './data-service.js';
import {computeSchedule,compareTaskChange,projectMargin,dateRange,workdayChecker,parseDates,addDays} from './schedule-engine.js';
import {discoverLegacy,markMigrated,dismissMigration,migrationDismissed} from './legacy-migration.js';
import {categorizeFieldTasks} from './field-dashboard.js';
import {progressOf,taskState,scheduleState,validateProgressReport,compareVersionTasks,utf8Csv} from './field-operations.js';
import {cacheProject,readCachedProject,queueProgress,pendingOperations,removeOperation,clearOfflineUser} from './offline-store.js';
import {parseDelimited,buildImportCandidates,toImportRows} from './schedule-import.js';
import {buildEventNetwork,relationRows} from './network-diagram.js';
import {weightedProgress,plannedProgressSeries} from './schedule-metrics.js';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate=value=>value?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(`${value}T12:00:00`)):'—';
const formatDateTime=value=>new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const todayISO=()=>{const value=new Date(),pad=number=>String(number).padStart(2,'0');return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`};
const roleLabel={owner:'責任者',editor:'編集者',viewer:'閲覧者'};
const PREFLIGHT_ITEMS=[
  ['design','設計図書・仕様書がそろっている'],['rfi','図面の不整合・質疑を整理した'],['contract','契約工期・部分引渡しを確認した'],['inspection','中間・完了検査日を確認した'],
  ['access','搬入経路・揚重計画を確認した'],['site','地盤・埋設物・既設設備を確認した'],['permit','申請・届出・許認可を確認した'],['constraint','騒音・振動・作業時間などの制約を確認した'],
  ['occupied','居ながら工事・動線分離を確認した'],['season','季節・天候リスクを見込んだ'],['holiday','休日・長期休暇を設定した'],['wbs','工種と作業を適切な細かさに分けた'],
  ['productivity','数量・歩掛・班数から日数を確認した'],['dependency','先行・後続関係とイベント番号を確認した'],['resource','同じ人員・重機の重複を確認した'],['procurement','長納期品・製作図・承認日を入れた'],
  ['subcontractor','協力会社と着手可能日を確認した'],['coordination','建築・設備の取り合いを確認した'],['close_inspection','消防・完了検査・是正期間を確保した'],['handover','試運転・清掃・書類・引渡しを入れた']
];
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
let authMode='login',profile=null,projects=[],currentProject=null,tasks=[],managementItems=[],versions=[],baselineTasks=[],historyItems=[],changeRequests=[],networkLayouts=[],networkEventLayouts=[],fieldOperations=false,activeView='today',todayHorizon=1,todayCompany='all',networkMode='simple',networkStructure='event',networkLayoutEditing=false,importCandidates=[],importSource=null,stopRealtime=null,reloadTimer=null,pendingImpact=null,offlineConflict=null,toastTimer=null,ganttUnit=savedGanttUnit(),lastSchedule=null,lastInviteUrl='';

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
  if(/apply_schedule_import|reset_network_layout|network_(task|event)_layouts|schema cache/i.test(message))return '工程取込・配置調整機能のデータベース更新がまだ反映されていません。SETUP.mdの最新マイグレーションを適用してください。';
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
function nullableNumber(value){const text=String(value??'').trim();return text===''?null:Number(text)}
function weatherAllowanceText(value){return Object.entries(value||{}).sort(([a],[b])=>Number(a)-Number(b)).map(([month,days])=>`${month}:${days}`).join(', ')}
function parseWeatherAllowance(value){const result={};for(const part of String(value||'').split(/[、,\n]+/).map(item=>item.trim()).filter(Boolean)){const match=part.match(/^(\d{1,2})\s*[:：]\s*(\d+(?:\.\d+)?)$/);if(!match||Number(match[1])<1||Number(match[1])>12)throw new Error('月別の天候余裕日は「10:2, 11:3」の形式で入力してください。');result[String(Number(match[1]))]=Number(match[2])}return result}
function renderPreflight(){const completed=new Set(currentProject?.preflight_completed||[]);$('#preflightChecklist').innerHTML=PREFLIGHT_ITEMS.map(([key,label],index)=>`<label><input type="checkbox" value="${key}" ${completed.has(key)?'checked':''}><span>${index+1}. ${esc(label)}</span></label>`).join('')}
function companyFilterKey(projectId=currentProject?.id){return `snake-today-company:${profile?.id||'anonymous'}:${projectId||'none'}`}
function loadCompanyFilter(projectId){try{return localStorage.getItem(companyFilterKey(projectId))||'all'}catch{return 'all'}}
function saveCompanyFilter(){try{localStorage.setItem(companyFilterKey(),todayCompany)}catch{}}
function todayTasks(){return todayCompany==='all'?tasks:todayCompany==='__unassigned__'?tasks.filter(task=>!String(task.company||'').trim()):tasks.filter(task=>task.company===todayCompany)}
function renderCompanyFilter(){
  const select=$('#todayCompanyFilter'),companies=[...new Set(tasks.map(task=>String(task.company||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja')),hasUnassigned=tasks.some(task=>!String(task.company||'').trim());
  const valid=todayCompany==='all'||todayCompany==='__unassigned__'&&hasUnassigned||companies.includes(todayCompany);if(!valid)todayCompany='all';
  select.innerHTML=`<option value="all">すべての会社</option>${companies.map(company=>`<option value="${esc(company)}">${esc(company)}</option>`).join('')}${hasUnassigned?'<option value="__unassigned__">担当未設定</option>':''}`;select.value=todayCompany;
}

function setAuthMode(mode){
  authMode=mode;const register=mode==='register';
  $('#displayNameField').hidden=!register;$('#displayName').required=register;
  $('#authPassword').autocomplete=register?'new-password':'current-password';
  $('#authTitle').textContent=register?'現場工程表のアカウントを作成':'現場工程表にログイン';
  $('#authDescription').textContent=register?'登録後に案件を作るか、招待された案件へ参加できます。':'参加している案件と最新の工程を開きます。';
  $('#authSubmit').textContent=register?'アカウントを作成':'ログイン';
  $('#authSwitch').textContent=register?'すでにアカウントをお持ちの方':'新しいアカウントを作る';
  $('#authMessage').textContent='';
}

function showLanding(target='home'){
  showPublicAuth('login');
}

function showPublicAuth(mode='login'){
  setAuthMode(mode);const landing=$('#landingView');if(landing)landing.hidden=true;$('#application').hidden=true;$('#authView').hidden=false;
  $('#setupNotice').hidden=configured;$('#authForm').querySelectorAll('input,button').forEach(node=>node.disabled=!configured);
  if(!location.hash.startsWith('#invite='))history.replaceState(null,'',`#${mode}`);
  requestAnimationFrame(()=>mode==='register'?$('#displayName').focus():$('#authEmail').focus());
}

function switchDemo(view,focus=false){document.querySelectorAll('[data-demo-view]').forEach(button=>{const selected=button.dataset.demoView===view;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus()});document.querySelectorAll('[data-demo-panel]').forEach(panel=>panel.hidden=panel.dataset.demoPanel!==view)}
function completeDemoTask(){const button=$('#demoCompleteTask'),done=button.dataset.done==='true';button.dataset.done=String(!done);button.textContent=done?'完了を報告':'✓ 完了報告済み';$('#demoProgressBar').style.width=done?'80%':'100%';$('#demoProgressValue').textContent=done?'62%':'64%';$('#demoSyncState').textContent=done?'操作デモ':'デモで反映';toast(done?'デモの完了報告を戻しました':'デモ上で完了報告を反映しました。実データは変更していません。')}
function showDemoImpact(){$('#demoImpact').hidden=false;$('#demoImpact').scrollIntoView({behavior:'smooth',block:'nearest'})}
function confirmDemoImpact(){const button=$('#demoConfirmImpact'),confirmed=button.dataset.confirmed==='true';button.dataset.confirmed=String(!confirmed);button.textContent=confirmed?'責任者として確定を試す':'✓ 責任者が確定';$('#demoImpactStatus').textContent=confirmed?'確定するまで正式日程は変わりません。':'変更案が正式日程になりました（操作デモ）。';toast('責任者だけが変更案を正式日程として確定します。')}

async function handleAuth(event){
  event.preventDefault();if(!configured)return;
  const inviteToken=location.hash.match(/^#invite=([a-f0-9]{64})$/i)?.[1];if(inviteToken)sessionStorage.setItem('snake-pending-invite',inviteToken);
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
  const inviteToken=location.hash.match(/^#invite=([a-f0-9]{64})$/i)?.[1]||sessionStorage.getItem('snake-pending-invite');
  if(inviteToken){try{const projectId=await acceptInvitation(inviteToken);sessionStorage.removeItem('snake-pending-invite');location.hash=`project=${projectId}`}catch(error){sessionStorage.setItem('snake-pending-invite',inviteToken);toast(friendlyErrorMessage(error))}}
  $('#userName').textContent=profile.display_name||profile.email;$('#userInitial').textContent=(profile.display_name||profile.email||'?').slice(0,1).toUpperCase();
  const landing=$('#landingView');if(landing)landing.hidden=true;$('#authView').hidden=true;$('#application').hidden=false;
  const requestedProject=location.hash.match(/^#project=([0-9a-f-]+)$/i)?.[1];
  if(requestedProject)await openProject(requestedProject);else if(location.hash==='#projects')await showProjects();else if(location.hash==='#profile')showProfile();else await showHome();
  if(navigator.onLine)syncOfflineQueue();
}

async function showProjects(){
  stopRealtime?.();stopRealtime=null;currentProject=null;tasks=[];managementItems=[];versions=[];changeRequests=[];networkLayouts=[];networkEventLayouts=[];todayCompany='all';fieldOperations=false;location.hash='projects';
  $('#projectView').hidden=true;$('#profileView').hidden=true;$('#homeView').hidden=true;$('#projectsView').hidden=false;setConnection('online','同期済み');
  setFieldNav('projects');
  projects=await loadProjects();renderProjects();renderMigration();
}

function setFieldNav(active){
  for(const [name,id] of Object.entries({projects:'navProjects',home:'navToday',profile:'navProfile'})){
    const button=$(`#${id}`);button?.setAttribute('aria-current',name===active?'page':'false');
  }
}

function showProfile(){
  if(!profile)return;$('#projectsView').hidden=true;$('#projectView').hidden=true;$('#homeView').hidden=true;$('#profileView').hidden=false;location.hash='profile';
  const name=profile.display_name||profile.email||'—';$('#profileAvatar').textContent=name.slice(0,1).toUpperCase();$('#profileName').value=profile.display_name||'';$('#profileEmail').value=profile.email||'';$('#profileAccount').textContent=profile.email||'—';$('#profileProjects').textContent=`${projects.length}件`;
  $('#profileMessage').textContent='';setFieldNav('profile');$('#profileView').focus();
}

async function showHome(){
  if(!profile)return;$('#projectsView').hidden=true;$('#projectView').hidden=true;$('#profileView').hidden=true;$('#homeView').hidden=false;location.hash='home';setFieldNav('home');
  if(!projects.length)projects=await loadProjects();
  $('#homeDate').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());$('#homeProjectCount').textContent=`${projects.length}現場`;
  $('#homeProjectGrid').innerHTML=projects.length?projects.map(project=>`<button class="home-project-card" data-home-project="${project.id}" type="button"><span>${esc(project.manager||'責任者未設定')}</span><b>${esc(project.name)}</b><small>${Number(project.completed_count||0)}/${Number(project.task_count||0)}工程 完了</small></button>`).join(''):'<p class="home-empty">参加中の現場はありません。</p>';
  $('#homeAgenda').innerHTML='<p class="home-empty">予定を読み込んでいます。</p>';
  const plans=(await Promise.all(projects.map(async project=>{try{const loaded=await loadProject(project.id),schedule=computeSchedule(loaded.project,loaded.tasks);return loaded.tasks.filter(task=>progressOf(task)<100).map(task=>({project,task,node:schedule.nodes.get(task.id)})).filter(item=>item.node)}catch{return []}}))).flat(),today=todayISO();
  const current=plans.filter(item=>item.node.startDate<=today&&item.node.endDate>=today).sort((a,b)=>a.node.endDate.localeCompare(b.node.endDate))[0],upcoming=plans.filter(item=>item.node.startDate>today).sort((a,b)=>a.node.startDate.localeCompare(b.node.startDate)).slice(0,5);
  const nowCard=$('#homeNowCard');$('#homeNowTitle').textContent=current?current.task.name:'今日予定されている作業はありません';$('#homeNowMeta').textContent=current?`${current.project.name} ・ ${current.task.company||'担当未設定'}`:'次の作業を下に表示しています';nowCard.dataset.projectId=current?.project.id||'';nowCard.tabIndex=current?0:-1;nowCard.classList.toggle('is-openable',Boolean(current));nowCard.setAttribute('aria-label',current?`${current.task.name}の現場を開く`:'今日の作業はありません');
  $('#homeAgenda').innerHTML=upcoming.length?upcoming.map(item=>`<button class="home-agenda-item" data-home-project="${item.project.id}" type="button"><time>${formatDate(item.node.startDate)}</time><span><b>${esc(item.task.name)}</b><small>${esc(item.project.name)} ・ ${esc(item.task.company||'担当未設定')}</small></span><i>›</i></button>`).join(''):'<p class="home-empty">次に予定されている作業はありません。</p>';
  $('#homeView').focus();
}

function renderProjects(){
  const search=($('#projectSearch')?.value||'').trim().toLowerCase(),filter=$('#projectFilter')?.value||'all',sort=$('#projectSort')?.value||'updated',today=todayISO();
  $('#projectControls').hidden=!projects.some(project=>Object.hasOwn(project,'progress_percent'));
  let visible=projects.filter(project=>!search||`${project.name} ${project.manager||''}`.toLowerCase().includes(search)).filter(project=>{
    if(filter==='delayed')return Number(project.delayed_count)>0;
    if(filter==='attention')return Number(project.delayed_count)>0||Number(project.overdue_item_count)>0;
    if(filter==='before')return project.start_date>today;
    if(filter==='complete')return Number(project.task_count)>0&&Number(project.completed_count)===Number(project.task_count);
    if(filter==='active')return project.start_date<=today&&Number(project.completed_count)<Number(project.task_count);
    return true;
  });
  visible.sort((a,b)=>sort==='delay'?Number(b.delayed_count||0)-Number(a.delayed_count||0):sort==='progress'?Number(a.progress_percent||0)-Number(b.progress_percent||0):sort==='name'?a.name.localeCompare(b.name,'ja'):String(b.updated_at).localeCompare(String(a.updated_at)));
  $('#projectGrid').innerHTML=visible.length?visible.map((project,index)=>{
    const total=project.task_count||0,done=project.completed_count||0,percent=Object.hasOwn(project,'progress_percent')?Number(project.progress_percent||0):(total?Math.round(done/total*100):0),alerts=Number(project.delayed_count||0)+Number(project.overdue_item_count||0);
    return `<article class="project-card" data-project-id="${project.id}" tabindex="0" role="button" aria-label="${esc(project.name)}を開く" style="--item-delay:${Math.min(index*45,360)}ms">
      <div class="project-card-top"><span class="role-pill ${project.current_role}">${roleLabel[project.current_role]}</span><time>${formatDateTime(project.updated_at)}</time></div>
      <h2>${esc(project.name)}</h2><p>${esc(project.manager||'責任者未設定')}</p>
      ${alerts?`<p class="project-alert">要対応 ${alerts}件（遅延 ${Number(project.delayed_count||0)}件）</p>`:''}<div class="progress"><i style="width:${percent}%"></i></div><div class="project-card-foot"><span>${percent}% ・ ${done}/${total}完了</span><span>${project.unread_count?`未読 ${project.unread_count}`:`${total}工程`}</span></div>
    </article>`;
  }).join(''):`<div class="empty-state"><b>${projects.length?'条件に合う案件はありません':'参加している案件はありません'}</b><span>${projects.length?'検索や絞り込みを変更してください。':'「新しい案件」から最初の工程表を作成できます。'}</span></div>`;
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
    const loaded=await loadProject(id);currentProject=loaded.project;tasks=loaded.tasks;managementItems=loaded.managementItems||[];versions=loaded.versions||[];changeRequests=loaded.changeRequests||[];networkLayouts=loaded.networkLayouts||[];networkEventLayouts=loaded.networkEventLayouts||[];fieldOperations=Boolean(loaded.fieldOperations);todayCompany=loadCompanyFilter(id);
    await cacheProject(profile.id,loaded).catch(()=>{});await hydrateBaseline();
    $('#projectsView').hidden=true;$('#profileView').hidden=true;$('#homeView').hidden=true;$('#projectView').hidden=false;location.hash=`project=${id}`;
    activeView='today';renderProject();startRealtime(id);setConnection('online','同期済み');
  }catch(error){const cached=profile?await readCachedProject(profile.id,id).catch(()=>null):null;if(!cached){showError(error);await showProjects();return}const loaded=cached.payload;currentProject=loaded.project;tasks=loaded.tasks;managementItems=loaded.managementItems||[];versions=loaded.versions||[];changeRequests=loaded.changeRequests||[];networkLayouts=loaded.networkLayouts||[];networkEventLayouts=loaded.networkEventLayouts||[];fieldOperations=Boolean(loaded.fieldOperations);todayCompany=loadCompanyFilter(id);$('#projectsView').hidden=true;$('#profileView').hidden=true;$('#homeView').hidden=true;$('#projectView').hidden=false;location.hash=`project=${id}`;activeView='today';renderProject();setConnection('offline',`オフライン・最終同期 ${formatDateTime(cached.cachedAt)}`);toast('保存済みの工程表を表示しています')}
}

function startRealtime(projectId){
  stopRealtime?.();
  stopRealtime=subscribe(projectId,()=>{
    setConnection('connecting','更新を受信');clearTimeout(reloadTimer);
    reloadTimer=setTimeout(()=>refreshCurrentProject(true),250);
  },status=>setConnection(status==='SUBSCRIBED'?'online':status==='CHANNEL_ERROR'?'offline':'connecting',status==='SUBSCRIBED'?'リアルタイム':'再接続中'),fieldOperations);
}

async function refreshCurrentProject(silent=false){
  if(!currentProject)return;
  try{const loaded=await loadProject(currentProject.id);currentProject=loaded.project;tasks=loaded.tasks;managementItems=loaded.managementItems||[];versions=loaded.versions||[];changeRequests=loaded.changeRequests||[];networkLayouts=loaded.networkLayouts||[];networkEventLayouts=loaded.networkEventLayouts||[];fieldOperations=Boolean(loaded.fieldOperations);await cacheProject(profile.id,loaded).catch(()=>{});await hydrateBaseline();renderProject();setConnection('online','同期済み');if(!silent)toast('最新の工程表を読み込みました')}catch(error){setConnection('offline','同期エラー');showError(error)}
}

async function hydrateBaseline(){const baseline=versions.find(version=>version.is_baseline);baselineTasks=baseline?await loadVersionTasks(baseline.id).catch(()=>[]):[]}

function renderProject(){
  const role=currentProject.current_role,editable=canEdit(),owner=isOwner();
  $('#projectTitle').textContent=currentProject.name;$('#projectMeta').textContent=`${formatDate(currentProject.start_date)} 着工 ・ ${tasks.length}工程`;
  $('#projectRole').className=`role-pill ${role}`;$('#projectRole').textContent=roleLabel[role];
  $('#membersButton').hidden=!owner;$('#addTaskButton').hidden=!editable;$('#importScheduleButton').hidden=!editable;$('#networkLayoutButton').hidden=!editable;$('#resetNetworkLayoutButton').hidden=!editable;$('#impactButton').hidden=!editable;$('#ganttGestureHelp').querySelectorAll('.edit-only').forEach(node=>node.hidden=!editable);
  document.querySelectorAll('.field-feature').forEach(node=>node.hidden=!fieldOperations);$('#notificationsButton').hidden=!fieldOperations;
  $('#versionsButton').hidden=!fieldOperations||!owner;renderCompanyFilter();
  $('#projectSettings').hidden=!owner;$('#projectNameInput').value=currentProject.name;$('#managerInput').value=currentProject.manager||'';
  $('#startDateInput').value=currentProject.start_date;$('#deadlineInput').value=currentProject.deadline||'';$('#holidaysInput').value=(currentProject.holidays||[]).join(', ');
  $('#structureScaleInput').value=currentProject.structure_scale||'';$('#holidayPolicyInput').value=currentProject.holiday_policy||'';$('#networkGroupingInput').value=currentProject.network_grouping_mode||'auto';$('#weatherAllowanceInput').value=weatherAllowanceText(currentProject.weather_allowance);renderPreflight();
  if(fieldOperations){$('#siteNameInput').value=currentProject.site_name||'';$('#clientNameInput').value=currentProject.client_name||'';$('#designerInput').value=currentProject.designer||'';$('#contractorInput').value=currentProject.contractor||'';$('#approverInput').value=currentProject.approver||'';refreshNotificationBadge()}
  switchView(activeView,false);renderScheduleViews();renderTaskList();
}

function switchView(view,scroll=true){
  activeView=view;
  if(currentProject)setFieldNav('today');
  const tabs=document.querySelector('.view-tabs');if(tabs)tabs.dataset.active=view;
  document.querySelectorAll('[data-view]').forEach(button=>{
    const selected=button.dataset.view===view;
    button.setAttribute('aria-current',selected?'page':'false');button.setAttribute('aria-selected',String(selected));
  });
  for(const name of ['today','gantt','network','tasks'])$(`#${name}View`).hidden=name!==view;
  const target=$(`#${view}View`);target.classList.remove('view-enter');void target.offsetWidth;target.classList.add('view-enter');
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}

function scheduleResult(delay){
  try{return computeSchedule(currentProject,tasks,delay)}catch(error){
    $('#ganttChart').innerHTML=`<div class="empty-state"><b>工程を計算できません</b><span>${esc(error.message)}</span></div>`;
    $('#networkDiagram').innerHTML='';$('#networkRelationList').innerHTML='';return null;
  }
}

function renderScheduleViews(){
  renderMasterScheduleMeta();
  if(!tasks.length){
    $('#scheduleSummary').innerHTML='';$('#ganttChart').innerHTML='<div class="empty-state"><b>工程がまだありません</b><span>画面上部の「＋ 工程」から最初の工程を作成してください。</span></div>';$('#progressCurve').innerHTML='';$('#networkDiagram').innerHTML='';$('#networkRelationList').innerHTML='';renderToday(null);return;
  }
  const result=scheduleResult();if(!result)return;lastSchedule=result;
  const margin=projectMargin(currentProject,result),critical=[...result.nodes.values()].filter(node=>node.tf===0).length,done=tasks.filter(task=>progressOf(task)===100).length,weighted=weightedProgress(tasks,progressOf),basis={cost:'金額',labor:'人工',duration:'日数',mixed:'金額・人工・日数'}[weighted.basis];
  $('#scheduleSummary').innerHTML=`<div><span>所要工期</span><strong>${result.total}日</strong><small>実働日</small></div><div><span>完了予定</span><strong>${formatDate(result.finish)}</strong><small>${currentProject.deadline?`契約 ${formatDate(currentProject.deadline)}`:'契約日未設定'}</small></div><div><span>契約までの余裕</span><strong>${margin===null?'—':margin>=0?`＋${margin}日`:`${margin}日`}</strong><small>実働日</small></div><div><span>加重進捗</span><strong>${weighted.percent}%</strong><small>${basis}基準・${done}/${tasks.length}完了・重要 ${critical}件</small></div>`;
  renderToday(result);renderGantt(result);renderProgressCurve(result,weighted);renderNetwork(result);
}

function renderMasterScheduleMeta(){
  const project=currentProject;if(!project){$('#masterScheduleMeta').innerHTML='';return}
  const facts=[['建築主',project.client_name||'未設定'],['構造・規模',project.structure_scale||'未設定'],['設計',project.designer||'未設定'],['施工者',project.contractor||'未設定'],['着工',project.start_date||'未設定'],['竣工',project.deadline||'未設定']];
  $('#masterScheduleMeta').innerHTML=`<div class="master-title"><small>${esc(project.site_name||'PROJECT MASTER SCHEDULE')}</small><b>${esc(project.name)}　総合工程表</b><span>作成日 ${formatDate(todayISO())}　責任者 ${esc(project.manager||'未設定')}</span></div><div class="master-facts">${facts.map(([label,value])=>`<div><span>${label}</span><b>${esc(value)}</b></div>`).join('')}</div>`;
}

function renderProgressCurve(result,actual){
  const points=plannedProgressSeries(tasks,result),width=760,height=190,left=46,right=20,top=18,bottom=34,plotWidth=width-left-right,plotHeight=height-top-bottom,total=Math.max(1,result.total),path=points.map((point,index)=>`${index?'L':'M'} ${left+point.day/total*plotWidth} ${top+(100-point.percent)/100*plotHeight}`).join(' '),isWorkday=workdayChecker(currentProject);let cursor=currentProject.start_date,workday=0,guard=0;while(cursor<todayISO()&&workday<result.total&&guard++<2000){if(isWorkday(cursor))workday++;cursor=addDays(cursor,1)}const actualX=left+Math.min(total,workday)/total*plotWidth,actualY=top+(100-actual.percent)/100*plotHeight,basis={cost:'金額',labor:'人工',duration:'日数',mixed:'金額・人工・日数'}[actual.basis];
  $('#progressCurve').innerHTML=`<div class="progress-curve-head"><div><b>累積進捗曲線</b><small>予定は工程期間へ重みを配分。実績は今日時点の報告値です。</small></div><span>${basis}基準</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="予定累積進捗と今日の実績 ${actual.percent}%"><path class="curve-grid" d="M${left} ${top}V${height-bottom}H${width-right} M${left} ${top+plotHeight/2}H${width-right}"/><text x="8" y="${top+4}">100%</text><text x="18" y="${top+plotHeight/2+4}">50%</text><text x="25" y="${height-bottom+4}">0%</text><path class="curve-plan" d="${path}"/><line class="curve-today" x1="${actualX}" x2="${actualX}" y1="${top}" y2="${height-bottom}"/><circle class="curve-actual" cx="${actualX}" cy="${actualY}" r="6"/><text class="curve-actual-label" x="${Math.min(width-110,actualX+9)}" y="${Math.max(top+12,actualY-8)}">実績 ${actual.percent}%</text><text x="${left}" y="${height-9}">着工</text><text x="${width-right}" y="${height-9}" text-anchor="end">完成予定</text></svg>`;
}

function todayTaskCard(task,node,tone='normal'){
  const editable=canEdit(),progress=progressOf(task),complete=progress===100,state=taskState(task),timing=scheduleState(task,node,todayISO());
  return `<article class="field-task ${tone} ${complete?'is-complete':''}">
    <button class="field-task-main" data-edit-task="${task.id}" type="button">
      <span class="field-task-code">${esc(task.code)}</span><span><b>${esc(task.name)}</b><small>${esc(task.company||'担当未設定')} ・ ${formatDate(node.startDate)}〜${formatDate(node.endDate)}</small><span class="card-progress"><i style="width:${progress}%"></i></span></span><i>›</i>
    </button>
    <div class="field-task-actions"><span class="status-badge ${state}">${esc(state)} ${progress}%</span>${timing!=='予定内'?`<span class="timing-badge ${timing}">${timing}</span>`:''}${tone==='delay'&&editable?`<button class="button quiet compact" data-impact-task="${task.id}" type="button">影響を見る</button>`:''}${editable?`<button class="complete-action ${complete?'done':''}" data-toggle-task="${task.id}" type="button" aria-label="${esc(task.name)}を${complete?'未完了に戻す':'完了報告する'}">${complete?'✓ 完了':'○ 報告'}</button>`:''}</div>
  </article>`;
}

function renderToday(result){
  const visible=todayTasks(),today=todayISO(),date=new Date(`${today}T12:00:00`),done=visible.filter(task=>progressOf(task)===100).length;
  $('#todayDateLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(date);
  $('#todayProgress').innerHTML=visible.length?`<b>${done}<span> / ${visible.length}</span></b><small>${todayCompany==='all'?'工程完了':'表示中の工程'}</small>`:'';
  renderChangeRequestBoard();
  if(!result||!tasks.length){$('#fieldDashboard').innerHTML='<div class="empty-state"><b>工程がまだありません</b><span>「＋ 工程」から追加すると、今日の作業がここに表示されます。</span></div>';return}
  if(!visible.length){$('#fieldDashboard').innerHTML='<div class="empty-state"><b>該当する工程がありません</b><span>担当会社を「すべての会社」に戻すと案件全体を確認できます。</span></div>';renderAttentionBoard();return}
  const {current,delayed,attention,upcoming,unassigned}=categorizeFieldTasks(today,visible,result.nodes,todayHorizon);
  const title=todayHorizon===1?'今日の作業':`${todayHorizon}日間の作業`,section=(label,list,tone)=>list.length?`<section class="field-group ${tone}"><div class="field-group-head"><h3>${label}</h3><span>${list.length}件</span></div><div class="field-task-list">${list.map(({task,node})=>todayTaskCard(task,node,tone)).join('')}</div></section>`:'';
  const daysToStart=Math.ceil((new Date(`${currentProject.start_date}T12:00:00`)-date)/86400000),prestart=daysToStart>0?`<section class="prestart-card"><span>着工まで</span><b>あと${daysToStart}日</b><small>担当未設定 ${unassigned.length}工程。工程・発注・承認の準備を確認してください。</small></section>`:'';
  const cards=section('遅れている作業',delayed,'delay')+section('今日判断が必要',attention,'attention')+section(title,current,'today')+section('次の作業',upcoming,'next');
  $('#fieldDashboard').innerHTML=prestart+(cards||'<div class="compact-empty">現在、表示期間内の要対応工程はありません。</div>');renderAttentionBoard();
}

function renderChangeRequestBoard(){
  const board=$('#changeRequestBoard');if(!fieldOperations){board.hidden=true;board.innerHTML='';return}
  const pending=changeRequests.filter(request=>request.status==='pending'),latestVersion=versions[0];
  if(!pending.length&&!latestVersion){board.hidden=true;board.innerHTML='';return}
  const official=latestVersion?`正式 第${latestVersion.version_number}版・${formatDateTime(latestVersion.confirmed_at||latestVersion.created_at)}`:'正式版はまだ未確定';
  board.hidden=false;board.innerHTML=`<div class="change-request-head"><div><h3>${pending.length?isOwner()?'確認待ちの変更案':'責任者の確認待ち':'確認待ちの変更案はありません'}</h3><small>${esc(official)}</small></div>${pending.length?`<span>${pending.length}件</span>`:''}</div>${pending.map(request=>{
    const task=tasks.find(item=>item.id===request.task_id),before=Number(request.before_data?.duration_days||task?.duration_days||0),after=Number(request.proposed_patch?.duration_days||before),delay=Math.max(0,after-before),shift=Number(request.impact_data?.finishShift||0);
    const cause=request.impact_data?.cause||'工程変更',weather=(request.impact_data?.weather_dates||[]).map(formatDate).join('、');return `<article class="change-request-row" data-change-request="${request.id}"><div><b>${esc(cause)}｜${esc(task?.name||request.before_data?.name||'工程')}：${before}日 → ${after}日</b><small>${esc(request.reason||'理由未入力')}${weather?` ・ 休工 ${esc(weather)}`:''} ・ 遅れ ${delay}日${shift?` ・ 完了予定 ${shift}日後ろ倒し`:''}</small></div>${isOwner()?'<div class="change-request-actions"><button class="button quiet compact" data-review-change="rejected" type="button">却下</button><button class="button primary compact" data-review-change="approved" type="button">正式日程に反映</button></div>':'<span class="status-badge">確認待ち</span>'}</article>`
  }).join('')}`;
}

async function reviewChangeRequest(requestId,decision){
  if(!isOwner())return;const request=changeRequests.find(item=>item.id===requestId),button=$(`[data-change-request="${requestId}"] [data-review-change="${decision}"]`);setBusy(button,true,decision==='approved'?'反映中…':'却下中…');
  try{await reviewScheduleChangeRequest(requestId,decision);toast(decision==='approved'?'変更案を正式日程へ反映しました':'変更案を却下しました');await refreshCurrentProject(true);if(decision==='approved'){await syncCurrentPlan();await refreshCurrentProject(true);await createScheduleVersion(currentProject.id,`変更確定 ${todayISO()}`,request?.reason||'変更案を承認','変更案の承認により自動作成',false);await refreshCurrentProject(true)}}catch(error){showError(error);await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

function renderAttentionBoard(){
  if(!fieldOperations)return;const today=todayISO(),limit=new Date(`${today}T12:00:00`);limit.setDate(limit.getDate()+14);const end=limit.toISOString().slice(0,10);
  const open=managementItems.filter(item=>item.status!=='完了'&&item.due_date&&item.due_date<=end).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  $('#attentionItems').innerHTML=open.length?open.slice(0,6).map(item=>`<button class="attention-item" data-open-management="${item.id}" type="button"><span class="priority ${item.priority}">${esc(item.priority)}</span><b>${esc(item.title)}</b><small>${esc(item.item_type)} ・ ${formatDate(item.due_date)}${item.company?` ・ ${esc(item.company)}`:''}${item.assignee_name?` / ${esc(item.assignee_name)}`:''}${item.due_date<today?' 期限超過':''}</small></button>`).join(''):'<p class="compact-empty">14日以内に期限を迎える管理項目はありません。</p>';
}

function taskConnectionSummary(task){
  const before=(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean),after=tasks.filter(item=>(item.dependencies||[]).includes(task.id)).map(item=>item.code);
  return {before,after,label:`${before.length?`← ${before.join('・')}`:'← 着手'}　${task.code}　${after.length?`→ ${after.join('・')}`:'→ 完了'}`};
}
function taskGroupLabel(task){const mode=currentProject?.network_grouping_mode||'auto',building=String(task?.building||'').trim(),floor=String(task?.floor||'').trim();if(mode==='none')return '';if(mode==='building')return building;if(mode==='floor')return floor;if(mode==='building_floor')return [building,floor].filter(Boolean).join(' / ');return [building,floor].filter(Boolean).join(' / ')}

function renderGantt(result,range='all'){
  const allDates=dateRange(currentProject,result,10),today=todayISO(),rangeEnd=range==='week'?addDays(today,6):range==='month'?addDays(today,30):null,dates=range==='all'?allDates:allDates.filter(date=>date>=today&&date<=rangeEnd),unit=ganttUnit,width=dates.length*unit,isWorkday=workdayChecker(currentProject),months=[],weekdays=['日','月','火','水','木','金','土'];
  for(let index=0;index<dates.length;){const month=dates[index].slice(0,7);let end=index;while(end<dates.length&&dates[end].startsWith(month))end++;months.push(`<span class="gantt-month" data-month-start="${index}" data-month-end="${end}" style="left:${index*unit}px;width:${(end-index)*unit}px">${Number(month.slice(5))}月 <small>${month.slice(0,4)}</small><button class="gantt-scale-handle" data-scale-boundary="${end}" type="button" role="slider" aria-label="カレンダーを拡大・縮小" aria-valuemin="${GANTT_MIN_UNIT}" aria-valuemax="${GANTT_MAX_UNIT}" aria-valuenow="${Math.round(unit)}"></button></span>`);index=end}
  const dayLabels=dates.map((date,index)=>{const day=Number(date.slice(8)),weekday=weekdays[new Date(`${date}T12:00:00`).getDay()];return `<span class="gantt-day ${!isWorkday(date)?'holiday':''} ${date===today?'today':''}" data-header-day-index="${index}" style="left:${index*unit}px;width:${unit}px"><b>${day}</b><small>${weekday}</small></span>`}).join('');
  const shades=dates.map((date,index)=>isWorkday(date)?'':`<i class="off" data-day-index="${index}" style="left:${index*unit}px;width:${unit}px"></i>`).join(''),monthBands=months.map(month=>{const index=Number(month.match(/data-month-start="(\d+)"/)?.[1]||0);return `<i class="month-boundary" data-month-boundary="${index}" style="left:${index*unit}px"></i>`}).join('');let lastGroup='';
  const rows=tasks.filter(task=>{const node=result.nodes.get(task.id);return range==='all'||(node.endDate>=today&&node.startDate<=rangeEnd)}).map((task,index)=>{const node=result.nodes.get(task.id),links=taskConnectionSummary(task),group=taskGroupLabel(task)||task.trade||'主要工程',groupRow=group!==lastGroup?`<div class="gantt-group-row"><div>${esc(group)}</div><span data-master-grid style="width:${width}px"></span></div>`:'';lastGroup=group;const start=Math.max(0,dates.findIndex(date=>date>=node.startDate)),rawEnd=dates.findIndex(date=>date>=node.endDate),end=rawEnd<0?dates.length-1:rawEnd,barWidth=Math.max((end-start+1)*unit-4,42),editable=canEdit(),progress=progressOf(task),complete=progress===100,actualStart=Math.max(0,dates.findIndex(date=>date>=task.actual_start)),actualEnd=dates.findIndex(date=>date>=String(task.actual_finish||today)),baseline=baselineTasks.find(row=>row.task_id===task.id),baselineStart=baseline?.planned_start?Math.max(0,dates.findIndex(date=>date>=baseline.planned_start)):-1,baselineEnd=baseline?.planned_finish?dates.findIndex(date=>date>=baseline.planned_finish):-1;const actual=task.actual_start&&actualStart>=0?`<i class="gantt-actual" title="実績 ${formatDate(task.actual_start)}〜${formatDate(task.actual_finish)}" style="left:${actualStart*unit+2}px;width:${Math.max(((actualEnd>=actualStart?actualEnd:actualStart)-actualStart+1)*unit-4,8)}px"></i>`:'',baselineBar=baselineStart>=0?`<i class="gantt-baseline" title="当初工程 ${formatDate(baseline.planned_start)}〜${formatDate(baseline.planned_finish)}" style="left:${baselineStart*unit+2}px;width:${Math.max(((baselineEnd>=baselineStart?baselineEnd:baselineStart)-baselineStart+1)*unit-4,8)}px"></i>`:'';return `${groupRow}<div class="gantt-row" style="--row-delay:${Math.min(index*24,220)}ms"><div class="gantt-label"><b>${esc(task.code)} ${esc(task.name)}</b><small>${esc(task.company||'担当未設定')} ・ ${formatDate(node.startDate)}〜${formatDate(node.endDate)} ・ ${progress}%</small><span class="gantt-links" title="前工程と後続工程">${esc(links.label)}</span>${editable?`<button class="gantt-change-button" data-impact-task="${task.id}" type="button">天候・工程変更</button>`:''}</div><div class="gantt-track" style="width:${width}px">${monthBands}${shades}${baselineBar}${actual}<div class="gantt-task ${editable?'can-edit':''}" data-gantt-task="${task.id}" data-duration="${task.duration_days}" data-start-index="${start}" data-end-index="${end}" style="left:${start*unit+2}px;width:${barWidth}px"><button class="gantt-bar ${node.tf===0?'critical':''} ${complete?'complete':''}" data-edit-task="${task.id}" type="button"><i class="gantt-progress" style="width:${progress}%"></i><span>${complete?'✓ ':''}${esc(task.name)}</span><small>${progress}%</small></button>${editable?`<button class="gantt-complete-toggle ${complete?'done':''}" data-toggle-task="${task.id}" type="button" aria-label="${esc(task.name)}を${complete?'未完了に戻す':'完了報告する'}">✓</button><button class="gantt-resize-handle" data-resize-task="${task.id}" type="button" role="slider" aria-label="${esc(task.name)}の所要日数" aria-valuemin="1" aria-valuemax="365" aria-valuenow="${task.duration_days}"><i></i></button>`:''}</div></div></div>`}).join('');
  $('#ganttChart').innerHTML=`<div class="gantt-inner" data-total-days="${dates.length}" style="--gantt-unit:${unit}px"><div class="gantt-head"><div class="gantt-label">工程 / 担当</div><div class="gantt-months" style="width:${width}px">${months.join('')}${dayLabels}</div></div>${rows}</div>`;
}

function applyGanttScale(value){
  ganttUnit=Math.max(GANTT_MIN_UNIT,Math.min(GANTT_MAX_UNIT,value));const inner=$('#ganttChart .gantt-inner');if(!inner)return;
  const total=Number(inner.dataset.totalDays),width=total*ganttUnit;inner.style.setProperty('--gantt-unit',`${ganttUnit}px`);
  inner.querySelector('.gantt-months').style.width=`${width}px`;
  inner.querySelectorAll('.gantt-month').forEach(month=>{const start=Number(month.dataset.monthStart),end=Number(month.dataset.monthEnd);month.style.left=`${start*ganttUnit}px`;month.style.width=`${(end-start)*ganttUnit}px`});
  inner.querySelectorAll('.gantt-track').forEach(track=>track.style.width=`${width}px`);
  inner.querySelectorAll('[data-master-grid]').forEach(track=>track.style.width=`${width}px`);
  inner.querySelectorAll('[data-month-boundary]').forEach(line=>line.style.left=`${Number(line.dataset.monthBoundary)*ganttUnit}px`);
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
  try{await updateTask(task,{duration_days:next});toast(`${task.name}を${next}日に変更しました`);await refreshCurrentProject(true);await syncCurrentPlan();await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}
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

function renderTaskNetwork(result){
  const nodes=[...result.nodes.values()],levels=Math.max(...nodes.map(node=>node.level))+1,positions=new Map();let maxRows=1;
  for(let level=0;level<levels;level++){const group=nodes.filter(node=>node.level===level).sort((a,b)=>taskGroupLabel(a).localeCompare(taskGroupLabel(b),'ja')||(a.position??0)-(b.position??0));maxRows=Math.max(maxRows,group.length);group.forEach((node,index)=>positions.set(node.id,{x:30+level*265,y:35+index*145}))}
  for(const layout of networkLayouts){if(positions.has(layout.task_id))positions.set(layout.task_id,{x:Number(layout.x),y:Number(layout.y)})}
  const width=Math.max(620,levels*265+40,...[...positions.values()].map(point=>point.x+255)),height=Math.max(190,maxRows*145+40,...[...positions.values()].map(point=>point.y+145));let svg='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker></defs>';
  for(const node of nodes)for(const dependency of node.dependencies){const from=positions.get(dependency),to=positions.get(node.id),previous=result.nodes.get(dependency),hot=node.tf===0&&previous.tf===0&&previous.ef===node.es;svg+=`<path class="edge ${hot?'hot':''}" d="M${from.x+215} ${from.y+50} C${from.x+240} ${from.y+50},${to.x-25} ${to.y+50},${to.x-7} ${to.y+50}" marker-end="url(#arrow)"/>`}
  for(const node of nodes){const point=positions.get(node.id),group=taskGroupLabel(node),label=node.name.length>15?`${node.name.slice(0,14)}…`:node.name,critical=node.tf===0,details=networkMode==='expert'?`<text x="13" y="81" class="node-numbers">EST ${node.es}  EFT ${node.ef}</text><text x="13" y="97" class="node-numbers">LST ${node.ls}  LFT ${node.lf}  TF ${node.tf}</text>`:`<text x="13" y="81" class="node-numbers">予定 ${formatDate(node.startDate)} → ${formatDate(node.endDate)}</text><text x="13" y="97" class="node-numbers">遅らせられる日数 ${node.tf}日</text>`;svg+=`<g class="node ${critical?'hot':''}" data-edit-task="${node.id}" tabindex="0" role="button" aria-label="${esc(node.name)}の詳細を開く。${critical?'全体工期に影響する重要工程':'余裕 '+node.tf+'日'}" transform="translate(${point.x},${point.y})"><rect width="215" height="105" rx="6"/><text x="13" y="23" class="node-code">${esc(node.code)} ${esc(node.trade)}${group?` / ${esc(group)}`:''}</text>${critical?'<text x="202" y="22" text-anchor="end" class="node-critical">◆ 重要</text>':''}<text x="13" y="48" class="node-name"><title>${esc(node.name)}</title>${esc(label)}</text><path d="M13 62 H202" class="node-rule"/>${details}</g>`}
  const diagram=$('#networkDiagram');diagram.setAttribute('viewBox',`0 0 ${width} ${height}`);diagram.setAttribute('width',width);diagram.setAttribute('height',height);diagram.innerHTML=svg;
  diagram.classList.toggle('layout-editing',networkLayoutEditing);
}

function eventPath(from,to){const startX=from.x+20,endX=to.x-20,middle=(startX+endX)/2;return from.y===to.y?`M${startX} ${from.y} L${endX} ${to.y}`:`M${startX} ${from.y} L${middle} ${from.y} L${middle} ${to.y} L${endX} ${to.y}`}

function renderEventNetwork(result){
  const groupedTasks=[...tasks].sort((a,b)=>taskGroupLabel(a).localeCompare(taskGroupLabel(b),'ja')||(a.position??0)-(b.position??0)),network=buildEventNetwork(groupedTasks,result),positions=new Map(network.events.map(event=>[event.id,{x:55+event.level*205,y:65+event.row*110}])),width=Math.max(620,network.maxLevel*205+120),height=Math.max(190,network.rows*110+70);let svg='<defs><marker id="eventArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker></defs>';
  for(const layout of networkEventLayouts)if(positions.has(layout.event_key))positions.set(layout.event_key,{x:Number(layout.x),y:Number(layout.y)});
  for(const edge of network.edges){const from=positions.get(edge.from),to=positions.get(edge.to);if(!from||!to)continue;const path=eventPath(from,to),midX=(from.x+to.x)/2,midY=(from.y+to.y)/2-8;if(edge.kind==='dummy'){svg+=`<path class="event-edge dummy ${edge.critical?'hot':''}" d="${path}" marker-end="url(#eventArrow)"><title>ダミー：${esc(tasks.find(task=>task.id===edge.predecessorId)?.code||'')} → ${esc(tasks.find(task=>task.id===edge.taskId)?.code||'')}</title></path>`;continue}const task=tasks.find(item=>item.id===edge.taskId),group=taskGroupLabel(task),details=networkMode==='expert'?`${edge.duration}日 / TF ${edge.tf} / FF ${edge.ff}`:`${edge.duration}日${group?` / ${group}`:''}`;svg+=`<g class="event-work ${edge.critical?'hot':''}" data-edit-task="${edge.taskId}" role="button" tabindex="0"><path class="event-edge work ${edge.critical?'hot':''}" d="${path}" marker-end="url(#eventArrow)"/><rect x="${midX-78}" y="${midY-22}" width="156" height="38" rx="7"/><text x="${midX}" y="${midY-7}" text-anchor="middle" class="event-work-name">${esc(`${edge.code} ${edge.name.length>13?`${edge.name.slice(0,12)}…`:edge.name}`)}</text><text x="${midX}" y="${midY+8}" text-anchor="middle" class="event-work-detail">${esc(details)}</text><title>${esc(edge.name)}${group?`（${esc(group)}）`:''}を編集</title></g>`}
  for(const event of network.events){const point=positions.get(event.id),detail=networkMode==='expert'?`<text x="0" y="35" text-anchor="middle" class="event-time">${event.kind==='start'?'EST':'EFT'} ${event.time} / ${event.kind==='start'?'LST':'LFT'} ${event.late}</text>`:'';svg+=`<g class="event-node" data-event-key="${event.id}" transform="translate(${point.x},${point.y})"><circle cx="0" cy="0" r="20"/><text x="0" y="5" text-anchor="middle">${event.number}</text>${detail}</g>`}
  const diagram=$('#networkDiagram'),diagramWidth=Math.max(width,...[...positions.values()].map(point=>point.x+70)),diagramHeight=Math.max(height,...[...positions.values()].map(point=>point.y+70));diagram.classList.toggle('layout-editing',networkLayoutEditing);diagram.setAttribute('viewBox',`0 0 ${diagramWidth} ${diagramHeight}`);diagram.setAttribute('width',diagramWidth);diagram.setAttribute('height',diagramHeight);diagram.innerHTML=svg;
  const rows=relationRows(groupedTasks,result,network);$('#networkRelationList').innerHTML=`<div class="network-relation-head"><div><b>工程とイベントの対応</b><small>矢線をクリックすると、日数・前工程・担当を修正できます。</small></div><span>${network.edges.filter(edge=>edge.kind==='dummy').length}本のダミー</span></div><div class="network-relation-table"><div class="network-relation-row heading"><span>工程</span><span>イベント</span><span>前工程</span><span>後続</span><span>日数</span><span>余裕</span><span></span></div>${rows.map(row=>`<button class="network-relation-row ${row.critical?'critical':''}" data-edit-task="${row.task.id}" type="button"><b>${esc(row.task.code)} ${esc(row.task.name)}${taskGroupLabel(row.task)?`<small>${esc(taskGroupLabel(row.task))}</small>`:''}</b><span>${row.from} → ${row.to}</span><span>${esc(row.predecessors.join('・')||'なし')}</span><span>${esc(row.successors.join('・')||'完了')}</span><span>${row.duration}日</span><span>TF ${row.tf} / FF ${row.ff}</span><span>編集 ›</span></button>`).join('')}</div>`;
}

function renderNetwork(result){
  const eventMode=networkStructure==='event';$('#networkLayoutButton').hidden=!canEdit();$('#resetNetworkLayoutButton').hidden=!canEdit();
  if(eventMode)renderEventNetwork(result);else{renderTaskNetwork(result);$('#networkRelationList').innerHTML=''}
}

function openScheduleImport(){
  importCandidates=[];importSource=null;$('#scheduleImportFile').value='';$('#scheduleImportPreview').innerHTML='';$('#scheduleImportSummary').textContent='ファイルを選択してください。';$('#scheduleImportMessage').textContent='';$('#applyScheduleImport').disabled=true;$('#scheduleImportDialog').showModal();
}

function renderImportPreview(){
  const valid=importCandidates.filter(row=>row.accepted).length,warnings=importCandidates.length-valid;
  $('#scheduleImportSummary').textContent=`${importCandidates.length}件を検出・追加可能 ${valid}件・要確認 ${warnings}件。要確認の行は登録されません。`;
  $('#scheduleImportPreview').innerHTML=importCandidates.length?`<table><thead><tr><th>追加</th><th>記号</th><th>工種／作業名</th><th>期間</th><th>日数</th><th>前工程</th><th>判定</th></tr></thead><tbody>${importCandidates.map((row,index)=>`<tr class="${row.issues.length?'has-issue':''}"><td><input type="checkbox" data-import-row="${index}" ${row.accepted?'checked':'disabled'} aria-label="${esc(row.name||`${row.sourceRow}行目`)}を追加"></td><td>${esc(row.code)}</td><td><b>${esc(row.name||'名称なし')}</b><small>${esc(row.trade||'工種未設定')}${row.building||row.floor?`・${esc(`${row.building} ${row.floor}`.trim())}`:''}</small></td><td>${esc(row.start||'—')}<br>${esc(row.finish||'—')}</td><td>${esc(row.duration||'—')}</td><td>${esc(row.predecessorCodes.join('、')||'なし')}</td><td>${row.issues.length?`<span class="import-warning">${esc(row.issues.join('／'))}</span>`:'<span class="import-ok">追加可能</span>'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><b>工程候補が見つかりません</b><span>見出しに「作業名」と「開始日」または「所要日数」があるシートを確認してください。</span></div>';
  $('#applyScheduleImport').disabled=!valid;
}

async function analyzeScheduleFile(){
  const file=$('#scheduleImportFile').files[0],button=$('#analyzeScheduleFile');if(!file){$('#scheduleImportMessage').textContent='先にExcel、CSVまたはTSVを選択してください。';return}setBusy(button,true,'解析中…');$('#scheduleImportMessage').textContent='';
  try{
    const extension=file.name.split('.').pop().toLowerCase();let matrix=[],sheetName='';
    if(['xlsx','xlsm','xls'].includes(extension)){
      if(!window.XLSX)throw new Error('Excel読取部品を読み込めません。CSVまたはTSVでお試しください。');
      const workbook=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});sheetName=workbook.SheetNames.find(name=>/^03/.test(name))||workbook.SheetNames.find(name=>/作業|工程一覧/.test(name))||workbook.SheetNames[0];matrix=window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:''});
    }else matrix=parseDelimited(await file.text());
    const result=buildImportCandidates(matrix,{sheetName,existingTasks:tasks});importCandidates=result.candidates;importSource={name:file.name,kind:['xlsx','xlsm','xls'].includes(extension)?'excel':extension==='tsv'||extension==='txt'?'pdf-reader':'csv'};
    if(result.issues.length)$('#scheduleImportMessage').textContent=result.issues.join(' ');renderImportPreview();
  }catch(error){showError(error,'#scheduleImportMessage')}finally{setBusy(button,false)}
}

async function commitScheduleImport(){
  const selected=new Set([...document.querySelectorAll('[data-import-row]:checked')].map(input=>Number(input.dataset.importRow))),rows=toImportRows(importCandidates.map((row,index)=>({...row,accepted:row.accepted&&selected.has(index)}))),button=$('#applyScheduleImport');if(!rows.length)return;
  setBusy(button,true,'追加中…');$('#scheduleImportMessage').textContent='';
  try{const result=await applyScheduleImport(currentProject.id,importSource.name,importSource.kind,rows);$('#scheduleImportDialog').close();toast(`${result.count||rows.length}件の工程を追加しました`);await refreshCurrentProject(true);await syncCurrentPlan();await refreshCurrentProject(true)}catch(error){showError(error,'#scheduleImportMessage')}finally{setBusy(button,false)}
}

function beginNetworkDrag(event){
  const eventMode=networkStructure==='event',node=event.target.closest(eventMode?'[data-event-key]':'[data-edit-task]');if(!networkLayoutEditing||!node||!canEdit())return;event.preventDefault();const diagram=$('#networkDiagram'),viewBox=diagram.viewBox.baseVal,box=diagram.getBoundingClientRect(),matrix=node.transform.baseVal.consolidate()?.matrix,start={x:matrix?.e||0,y:matrix?.f||0},pointer={x:event.clientX,y:event.clientY};let moved=false;node.setPointerCapture?.(event.pointerId);
  const move=moveEvent=>{const x=Math.max(0,start.x+(moveEvent.clientX-pointer.x)*viewBox.width/box.width),y=Math.max(0,start.y+(moveEvent.clientY-pointer.y)*viewBox.height/box.height);moved=moved||Math.abs(moveEvent.clientX-pointer.x)>3||Math.abs(moveEvent.clientY-pointer.y)>3;node.setAttribute('transform',`translate(${x},${y})`);node.dataset.layoutX=String(x);node.dataset.layoutY=String(y)};
  const finish=async upEvent=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.releasePointerCapture?.(upEvent.pointerId);if(!moved)return;node.dataset.dragged='true';try{if(eventMode){const saved=await saveNetworkEventLayout(currentProject.id,node.dataset.eventKey,Number(node.dataset.layoutX),Number(node.dataset.layoutY));networkEventLayouts=networkEventLayouts.filter(item=>item.event_key!==saved.event_key).concat(saved)}else{const saved=await saveNetworkLayout(currentProject.id,node.dataset.editTask,Number(node.dataset.layoutX),Number(node.dataset.layoutY));networkLayouts=networkLayouts.filter(item=>item.task_id!==saved.task_id).concat(saved)}renderNetwork(lastSchedule);toast('配置を保存しました')}catch(error){showError(error);renderNetwork(lastSchedule)}};
  node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish,{once:true});
}

function toggleNetworkLayout(){networkLayoutEditing=!networkLayoutEditing;$('#networkLayoutButton').setAttribute('aria-pressed',String(networkLayoutEditing));$('#networkLayoutButton').textContent=networkLayoutEditing?'調整を終了':'配置を調整';if(lastSchedule)renderNetwork(lastSchedule);toast(networkLayoutEditing?(networkStructure==='event'?'番号付きの丸をドラッグして配置を調整できます':'工程をドラッグして配置を調整できます'):'配置調整を終了しました')}
async function clearNetworkLayout(){const eventMode=networkStructure==='event',layouts=eventMode?networkEventLayouts:networkLayouts;if(!layouts.length)return;if(!confirm('保存した手動配置を消して、自動配置へ戻しますか？'))return;try{if(eventMode){await resetNetworkEventLayout(currentProject.id);networkEventLayouts=[]}else{await resetNetworkLayout(currentProject.id);networkLayouts=[]}renderNetwork(lastSchedule);toast('自動配置に戻しました')}catch(error){showError(error)}}

function renderTaskList(){
  $('#taskList').innerHTML=tasks.length?tasks.map(task=>{
    const node=lastSchedule?.nodes.get(task.id),dependencies=(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean).join('、')||'なし',progress=progressOf(task),state=taskState(task),timing=scheduleState(task,node,todayISO());
    const quantity=task.quantity!==null&&task.quantity!==undefined?`${task.quantity}${esc(task.unit||'')}`:'数量未設定',place=[task.building,task.floor].filter(Boolean).join(' ');
    return `<article class="task-row" data-task-id="${task.id}" tabindex="0" role="button"><span class="task-code">${esc(task.code)}</span><div class="task-main"><b>${esc(task.name)}</b><small>${esc(task.trade||'工種未設定')} ・ ${esc(task.company||'担当未設定')}${place?` ・ ${esc(place)}`:''}</small><small>${node?`${formatDate(node.startDate)}〜${formatDate(node.endDate)}`:'予定未計算'} ・ ${quantity}</small></div><div class="task-cell"><b>${progress}%</b><small>${state}${timing!=='予定内'?`・${timing}`:''}</small></div><div class="task-cell"><b>${task.duration_days}日</b><small>残り ${task.remaining_days??'—'}日</small></div><div class="task-cell"><b>${esc(dependencies)}</b><small>前工程</small></div>${canEdit()?`<button class="complete-action ${progress===100?'done':''}" data-toggle-task="${task.id}" type="button">${progress===100?'✓ 完了':'○ 報告'}</button>`:`<span class="status-badge ${state}">${esc(state)}</span>`}</article>`;
  }).join(''):'<div class="empty-state"><b>工程がありません</b><span>右上の「工程を作る」から追加してください。</span></div>';
}

function openTaskEditor(task=null){
  const editable=canEdit();if(!task&&!editable)return;const form=$('#taskForm');form.reset();$('#taskFormMessage').textContent='';
  $('#taskDialogTitle').textContent=task?(editable?'工程を編集':'工程詳細'):'工程を作る';form.elements.id.value=task?.id||'';form.elements.version.value=task?.version||'';
  for(const field of ['code','trade','name','company','duration_days','status','notes','building','floor','quantity','unit','daily_output','crew_count','people_per_crew','cost_thousands'])form.elements[field].value=task?.[field]??(field==='code'?nextTaskCode():field==='duration_days'?1:field==='status'?'未着手':'');
  if(fieldOperations){
    for(const field of ['progress_percent','actual_start','actual_finish','remaining_days','delay_reason','delay_category','next_action'])form.elements[field].value=task?.[field]??(field==='progress_percent'?0:field==='delay_category'?'未分類':'');
    $('#progressOutput').textContent=`${progressOf(task||{})}%`;form.elements.progress_percent.value=progressOf(task||{});
  }
  form.elements.blocked_dates.value=(task?.blocked_dates||[]).join(', ');
  form.elements.dependencies.innerHTML=tasks.filter(item=>item.id!==task?.id).map(item=>`<option value="${item.id}" ${(task?.dependencies||[]).includes(item.id)?'selected':''}>${esc(item.code)} ${esc(item.name)}</option>`).join('');
  form.querySelectorAll('input,select,textarea,[data-duration-step]').forEach(node=>node.disabled=!editable);
  if(fieldOperations){for(const name of ['status','progress_percent','actual_start','actual_finish','remaining_days','delay_reason','delay_category','next_action'])if(form.elements[name])form.elements[name].disabled=true}
  $('#deleteTaskButton').hidden=!task||!editable;$('#taskSaveButton').hidden=!editable;$('#reportFromTaskButton').hidden=!task||!editable||!fieldOperations;$('#taskDialog').showModal();
  if(fieldOperations&&task)renderTaskActivity(task.id);else $('#taskActivityContent').innerHTML='';
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
  const values={position:form.elements.id.value?(tasks.find(item=>item.id===form.elements.id.value)?.position??0):tasks.length,
    code:form.elements.code.value.trim().toUpperCase(),trade:form.elements.trade.value.trim(),name:form.elements.name.value.trim(),company:form.elements.company.value.trim(),
    duration_days:Number(form.elements.duration_days.value),building:form.elements.building.value.trim(),floor:form.elements.floor.value.trim(),
    quantity:nullableNumber(form.elements.quantity.value),unit:form.elements.unit.value.trim(),daily_output:nullableNumber(form.elements.daily_output.value),crew_count:nullableNumber(form.elements.crew_count.value),people_per_crew:nullableNumber(form.elements.people_per_crew.value),cost_thousands:nullableNumber(form.elements.cost_thousands.value),
    dependencies:[...form.elements.dependencies.selectedOptions].map(option=>option.value),blocked_dates:parseDates(form.elements.blocked_dates.value),notes:form.elements.notes.value.trim()};
  if(!fieldOperations)values.status=form.elements.status.value;
  return values;
}

async function syncCurrentPlan(){
  if(!fieldOperations||!canEdit()||!tasks.length)return;const schedule=computeSchedule(currentProject,tasks),dates=tasks.map(task=>{const node=schedule.nodes.get(task.id);return {id:task.id,version:task.version,planned_start:node.startDate,planned_finish:node.endDate}});await syncPlannedDates(currentProject.id,dates);
}

async function saveTask(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');$('#taskFormMessage').textContent='';setBusy(button,true);
  try{
    const values=taskValues(form),id=form.elements.id.value;
    if(id){const task=tasks.find(item=>item.id===id);await updateTask(task,values)}else await createTask(currentProject.id,values);
    $('#taskDialog').close();toast('工程を保存しました');await refreshCurrentProject(true);await syncCurrentPlan();await refreshCurrentProject(true);
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
  if(fieldOperations){openReportDialog(task,progressOf(task));return}
  const complete=task.status!=='完了';setConnection('connecting',complete?'完了を保存中':'状態を保存中');
  try{await updateTask(task,{status:complete?'完了':'未着手'});toast(complete?`「${task.name}」を完了にしました`:`「${task.name}」を未完了に戻しました`);await refreshCurrentProject(true)}catch(error){showError(error);await refreshCurrentProject(true)}
}

function openReportDialog(task,progress=progressOf(task)){
  const form=$('#reportForm');form.reset();form.elements.task_id.value=task.id;form.elements.offline_operation_id.value='';form.elements.progress_percent.value=progress;form.elements.actual_start.value=task.actual_start||((progress>0&&progress<100)?todayISO():'');form.elements.actual_finish.value=progress===100?(task.actual_finish||todayISO()):'';form.elements.remaining_days.value=progress===100?0:(task.remaining_days??Math.max(0,task.duration_days));form.elements.inspection_status.value=task.inspection_status||'未確認';form.elements.notify_next.checked=Boolean(task.notify_next);form.elements.schedule_condition.value=task.status==='遅延'||task.delay_reason?'delayed':'ontrack';form.elements.delay_reason.value=task.delay_reason||'';form.elements.delay_category.value=task.delay_category||'未分類';form.elements.next_action.value=task.next_action||'';updateReportDelayFields(form);$('#reportTitle').textContent=progress===100?'完了報告':progressOf(task)===100?'完了を取り消す':'進捗を報告';$('#reportMessage').textContent='';$('#reportDialog').showModal();
}

function updateReportDelayFields(form=$('#reportForm')){const delayed=form.elements.schedule_condition.value==='delayed';$('#reportDelayFields').hidden=!delayed;form.elements.delay_reason.required=delayed}

async function saveProgressReport(event){
  event.preventDefault();const form=event.currentTarget,task=tasks.find(item=>item.id===form.elements.task_id.value),button=$('#reportSubmit');if(!task)return;setBusy(button,true,'保存中…');$('#reportMessage').textContent='';let uploaded=[];
  try{
    const delayed=form.elements.schedule_condition.value==='delayed',delayReason=form.elements.delay_reason.value.trim();if(delayed&&!delayReason)throw new Error('遅れ・着手不可の場合は理由を入力してください。');
    const values=validateProgressReport({progress_percent:Number(form.elements.progress_percent.value),actual_start:form.elements.actual_start.value||null,actual_finish:form.elements.actual_finish.value||null,remaining_days:form.elements.remaining_days.value,comment:form.elements.comment.value.trim(),delay_reason:delayed?delayReason:'',delay_category:delayed?form.elements.delay_category.value:'未分類',next_action:delayed?form.elements.next_action.value.trim():'',inspection_status:form.elements.inspection_status.value,notify_next:form.elements.notify_next.checked});
    const files=[...form.elements.files.files];
    if(!navigator.onLine&&form.elements.offline_operation_id.value)throw new Error('競合した報告の再保存には通信接続が必要です。元の未同期報告は端末に残っています。');
    if(!navigator.onLine){if(files.length)throw new Error('オフライン中は写真を保存できません。接続後にもう一度報告してください。');await queueProgress(profile.id,currentProject.id,task,values);Object.assign(task,values,{status:values.progress_percent===100?'完了':values.progress_percent>0?'進行中':'未着手'});$('#reportDialog').close();setConnection('offline','オフライン・未同期1件以上');renderProject();toast('報告を端末内へ一時保存しました。再接続時に同期します');return}
    if(files.length){$('#reportMessage').textContent=`写真・資料をアップロード中（${files.length}件）…`;uploaded=await uploadTaskFiles(currentProject.id,task.id,files)}
    await reportTaskProgress(task,values);if(form.elements.offline_operation_id.value)await removeOperation(form.elements.offline_operation_id.value);
    if(uploaded.length)await saveAttachmentRecords(currentProject.id,task.id,uploaded);
    $('#reportDialog').close();toast(values.progress_percent===100?'完了報告を保存しました':'進捗報告を保存しました');await refreshCurrentProject(true);
  }catch(error){if(uploaded.length)await removeUploadedFiles(uploaded.map(item=>item.storage_path)).catch(()=>{});showError(error,'#reportMessage');if(error.code==='40001'||error.code==='CONFLICT')await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function syncOfflineQueue(){
  if(!profile||!navigator.onLine)return;const operations=await pendingOperations(profile.id).catch(()=>[]);if(!operations.length)return;setConnection('connecting',`未同期 ${operations.length}件`);
  for(const operation of operations){try{const loaded=await loadProject(operation.projectId),task=loaded.tasks.find(item=>item.id===operation.taskId);if(!task||task.version!==operation.baseVersion){showOfflineConflict(operation,task);break}await reportTaskProgress(task,operation.values);await removeOperation(operation.id)}catch(error){if(error.code==='40001'||/conflict/i.test(error.message)){showOfflineConflict(operation,null);break}else break}}
  const remaining=await pendingOperations(profile.id).catch(()=>[]);setConnection(remaining.length?'offline':'online',remaining.length?`要確認 ${remaining.length}件`:'同期済み');if(currentProject)await refreshCurrentProject(true)
}

function showOfflineConflict(operation,serverTask){
  offlineConflict={operation,serverTask};const local=operation.values||{},server=serverTask||{};
  $('#offlineConflictDetails').innerHTML=`<section><b>この端末の報告</b><span>進捗 ${esc(local.progress_percent)}%</span><span>実績開始 ${esc(local.actual_start||'未設定')}</span><span>実績完了 ${esc(local.actual_finish||'未設定')}</span><span>残り ${esc(local.remaining_days??'未設定')}日</span></section><section><b>サーバーの最新値</b><span>進捗 ${esc(progressOf(server))}%</span><span>実績開始 ${esc(server.actual_start||'未設定')}</span><span>実績完了 ${esc(server.actual_finish||'未設定')}</span><span>残り ${esc(server.remaining_days??'未設定')}日</span></section>`;
  if(!$('#offlineConflictDialog').open)$('#offlineConflictDialog').showModal();toast(`「${operation.taskName}」は別の人が更新済みです。内容を確認してください。`)
}

async function discardOfflineConflict(){if(!offlineConflict)return;await removeOperation(offlineConflict.operation.id);offlineConflict=null;$('#offlineConflictDialog').close();toast('端末側の未同期報告を破棄しました。');await syncOfflineQueue()}
async function reopenOfflineConflict(){
  if(!offlineConflict)return;const {operation}=offlineConflict;$('#offlineConflictDialog').close();if(currentProject?.id!==operation.projectId)await openProject(operation.projectId);else await refreshCurrentProject(true);const task=tasks.find(item=>item.id===operation.taskId);offlineConflict=null;if(!task){toast('工程が削除されているため再編集できません。未同期報告は端末に残しています。');return}openReportDialog(task,operation.values.progress_percent);const form=$('#reportForm');form.elements.offline_operation_id.value=operation.id;for(const name of ['actual_start','actual_finish','remaining_days','comment','inspection_status','delay_reason','delay_category','next_action'])if(form.elements[name]&&operation.values[name]!=null)form.elements[name].value=operation.values[name];form.elements.schedule_condition.value=operation.values.delay_reason?'delayed':'ontrack';updateReportDelayFields(form);form.elements.notify_next.checked=Boolean(operation.values.notify_next)
}

async function renderTaskActivity(taskId,mode='reports'){
  const box=$('#taskActivityContent');box.innerHTML='<p class="compact-empty">読み込み中…</p>';document.querySelectorAll('[data-activity]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.activity===mode)));
  try{
    const [activity,members]=await Promise.all([loadTaskActivity(taskId),mode==='comments'?loadMembers(currentProject.id):Promise.resolve([])]);
    if(mode==='reports')box.innerHTML=activity.reports.length?activity.reports.map(report=>`<article class="activity-entry"><b>${report.progress_percent}%・${esc(report.report_type==='complete'?'完了報告':report.report_type==='reopen'?'完了取消':'進捗報告')}</b><small>${formatDateTime(report.created_at)}・${esc(report.reporter_email)}</small>${report.comment?`<p>${esc(report.comment)}</p>`:''}</article>`).join(''):'<p class="compact-empty">報告はまだありません。</p>';
    if(mode==='comments')box.innerHTML=`${activity.comments.map(comment=>`<article class="activity-entry"><p>${esc(comment.body)}</p><small>${formatDateTime(comment.created_at)}${comment.edited_at?'・編集済み':''}</small></article>`).join('')||'<p class="compact-empty">コメントはまだありません。</p>'}${canEdit()?`<form id="commentForm" class="comment-form" data-task-id="${taskId}"><label><span>コメントを追加</span><textarea name="body" required maxlength="4000" rows="2"></textarea></label><label><span>通知するメンバー</span><select name="mentions" multiple size="3">${members.filter(member=>member.user_id&&member.user_id!==profile.id).map(member=>`<option value="${member.user_id}">${esc(member.email)}</option>`).join('')}</select></label><label><span>写真・資料</span><input name="files" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label><button class="button primary compact" type="submit">投稿</button></form>`:''}`;
    if(mode==='files')box.innerHTML=activity.attachments.length?`<div class="attachment-grid">${activity.attachments.map(file=>`<button type="button" data-open-attachment="${esc(file.storage_path)}"><b>${esc(file.original_name)}</b><small>${Math.ceil(file.byte_size/1024)}KB</small></button>`).join('')}</div>`:'<p class="compact-empty">写真・資料はまだありません。</p>';
  }catch(error){box.innerHTML=`<p class="form-message">${esc(friendlyErrorMessage(error))}</p>`}
}

async function saveProjectSettings(){
  const button=$('#saveProjectButton');setBusy(button,true);
  try{
    const values={name:$('#projectNameInput').value.trim(),manager:$('#managerInput').value.trim(),start_date:$('#startDateInput').value,deadline:$('#deadlineInput').value||null,holidays:parseDates($('#holidaysInput').value)};
    if(Object.hasOwn(currentProject,'structure_scale'))Object.assign(values,{structure_scale:$('#structureScaleInput').value.trim(),holiday_policy:$('#holidayPolicyInput').value.trim(),network_grouping_mode:$('#networkGroupingInput').value,weather_allowance:parseWeatherAllowance($('#weatherAllowanceInput').value),preflight_completed:[...$('#preflightChecklist').querySelectorAll('input:checked')].map(input=>input.value)});
    if(fieldOperations)Object.assign(values,{site_name:$('#siteNameInput').value.trim(),client_name:$('#clientNameInput').value.trim(),designer:$('#designerInput').value.trim(),contractor:$('#contractorInput').value.trim(),approver:$('#approverInput').value.trim()});
    await updateProject(currentProject,values);toast('案件設定を保存しました');await refreshCurrentProject(true);await syncCurrentPlan();await refreshCurrentProject(true);
  }catch(error){showError(error);if(error.code==='CONFLICT')await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function openMembers(){
  if(!isOwner())return;$('#inviteMessage').textContent='';$('#membersDialog').showModal();await renderMembers();
}
async function renderMembers(){
  try{const members=await loadMembers(currentProject.id);$('#memberList').innerHTML=members.map(member=>`<div class="member-row" data-member-id="${member.id}"><div><b>${esc(member.email)}</b><small>${member.accepted_at?'参加済み':'招待待ち'}</small></div>${member.role==='owner'?'<span class="member-role owner">責任者</span>':`<select data-member-role aria-label="${esc(member.email)}の権限"><option value="editor" ${member.role==='editor'?'selected':''}>編集者</option><option value="viewer" ${member.role==='viewer'?'selected':''}>閲覧者</option></select><button class="button danger compact" data-remove-member type="button">削除</button>`}</div>`).join('');if(fieldOperations)await renderInvitations()}catch(error){showError(error,'#inviteMessage')}
}
async function invite(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),data=new FormData(form);setBusy(button,true);$('#inviteMessage').textContent='';
  try{
    const email=String(data.get('email')).trim().toLowerCase(),role=data.get('role');
    if(!fieldOperations){await inviteMember(currentProject.id,email,role);form.reset();toast('招待を追加しました');await renderMembers();return}
    const invitation=await createInvitation(currentProject.id,email,role,7),root=new URL('./',location.href);root.hash='';root.search='';lastInviteUrl=`${root.href}#invite=${invitation.token}`;$('#inviteLink').textContent=lastInviteUrl;$('#inviteShare').hidden=false;renderInviteQr(lastInviteUrl);
    try{const {error}=await client.functions.invoke('send-invitation',{body:{invitationId:invitation.invitation_id,inviteUrl:lastInviteUrl}});if(error)throw error;$('#inviteDeliveryState').textContent='招待メールを送信しました。'}catch{$('#inviteDeliveryState').textContent='メール送信サービスが未設定です。リンクをコピーして安全な方法で相手へ渡してください。'}
    form.reset();toast('期限7日の招待リンクを作成しました');await renderInvitations();
  }catch(error){showError(error,'#inviteMessage')}finally{setBusy(button,false)}
}

function renderInviteQr(url){const node=$('#inviteQr');node.innerHTML='';if(typeof window.qrcode!=='function'){node.textContent='QRコード部品が読み込めません。招待リンクを使用してください。';return}const qr=window.qrcode(0,'M');qr.addData(url);qr.make();node.innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true})}
async function renderInvitations(){const invitations=await listInvitations(currentProject.id),now=new Date();$('#invitationList').innerHTML=invitations.length?`<h3>招待履歴</h3>${invitations.map(invite=>{const state=invite.revoked_at?'取消済み':invite.accepted_at?'使用済み':new Date(invite.expires_at)<=now?'期限切れ':'招待待ち';return `<div class="member-row" data-invitation-id="${invite.id}"><div><b>${esc(invite.email)}</b><small>${state}・${formatDateTime(invite.expires_at)}まで</small></div><span class="member-role">${roleLabel[invite.role]}</span>${state==='招待待ち'?'<button class="button danger compact" data-revoke-invitation type="button">取消</button>':''}</div>`}).join('')}`:''}

async function showHistory(){
  $('#historyDialog').showModal();$('#historyList').innerHTML='<div class="empty-state">読み込み中…</div>';
  try{historyItems=await loadHistory(currentProject.id);renderHistory()}catch(error){showError(error)}
}
function renderHistory(){const entity=$('#historyEntityFilter').value,action=$('#historyActionFilter').value,query=$('#historySearch').value.trim().toLowerCase(),rows=historyItems.filter(item=>(entity==='all'||item.entity_type===entity)&&(action==='all'||item.action===action)&&(!query||`${item.actor_email} ${item.summary} ${historyText(item)}`.toLowerCase().includes(query)));$('#historyList').innerHTML=rows.length?rows.map(item=>`<article class="history-item"><time>${formatDateTime(item.created_at)}</time><div><b>${esc(historyText(item))}</b><small>${esc(item.summary)}</small>${historyDiff(item)}</div><small>${esc(item.actor_email)}</small></article>`).join(''):'<div class="empty-state">条件に一致する履歴はありません。</div>'}
function historyText(item){const entity={project:'案件',task:'工程',member:'メンバー',report:'進捗報告',comment:'コメント',attachment:'添付',management_item:'管理項目',schedule_version:'工程版',version:'工程版',schedule_change_request:'日程変更案'}[item.entity_type]||item.entity_type,action={create:'を追加',update:'を変更',delete:'を削除'}[item.action]||item.action;return `${entity}${action}`}

function historyDiff(item){if(item.action!=='update'||!item.before_data||!item.after_data)return '';const labels={duration_days:'所要日数',company:'担当会社',planned_finish:'予定完了',progress_percent:'進捗率',dependencies:'前工程',status:'状態',role:'権限',due_date:'期限'};const rows=Object.keys(labels).filter(key=>JSON.stringify(item.before_data[key])!==JSON.stringify(item.after_data[key])).map(key=>`<li><b>${labels[key]}</b>：${esc(item.before_data[key]??'未設定')} → ${esc(item.after_data[key]??'未設定')}</li>`);return rows.length?`<ul class="history-diff">${rows.join('')}</ul>`:''}

function openManagement(selectedId=''){$('#managementForm').reset();$('#managementForm').elements.id.value='';$('#managementForm').elements.task_id.innerHTML='<option value="">なし</option>'+tasks.map(task=>`<option value="${task.id}">${esc(task.code)} ${esc(task.name)}</option>`).join('');renderManagementList();$('#managementDialog').showModal();if(selectedId){const item=managementItems.find(value=>value.id===selectedId);if(item)fillManagementForm(item)}}
function fillManagementForm(item){const form=$('#managementForm');for(const field of ['id','item_type','title','task_id','due_date','assignee_name','company','status','priority','comment'])form.elements[field].value=item[field]??''}
function renderManagementList(){const today=todayISO();$('#managementList').innerHTML=managementItems.length?managementItems.map(item=>`<article class="management-row ${item.status!=='完了'&&item.due_date&&item.due_date<today?'overdue':''}" data-management-id="${item.id}"><button type="button" data-edit-management><span class="priority ${item.priority}">${esc(item.priority)}</span><b>${esc(item.title)}</b><small>${esc(item.item_type)}・${formatDate(item.due_date)}・${esc(item.status)}</small></button>${isOwner()?'<button class="icon-button" data-delete-management type="button" aria-label="削除">×</button>':''}</article>`).join(''):'<p class="compact-empty">管理項目はまだありません。</p>'}
async function saveManagement(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),values={project_id:currentProject.id,item_type:form.elements.item_type.value,title:form.elements.title.value.trim(),task_id:form.elements.task_id.value||null,due_date:form.elements.due_date.value||null,assignee_name:form.elements.assignee_name.value.trim(),company:form.elements.company.value.trim(),status:form.elements.status.value,priority:form.elements.priority.value,comment:form.elements.comment.value.trim(),completed_at:form.elements.status.value==='完了'?todayISO():null},files=[...form.elements.files.files];setBusy(button,true);let uploaded=[];try{const item=form.elements.id.value?await updateManagementItem(form.elements.id.value,values):await createManagementItem(values);if(files.length){uploaded=await uploadTaskFiles(currentProject.id,`management-${item.id}`,files);await saveManagementAttachmentRecords(currentProject.id,item.id,uploaded)}toast('管理項目を保存しました');await refreshCurrentProject(true);openManagement()}catch(error){if(uploaded.length)await removeUploadedFiles(uploaded.map(value=>value.storage_path)).catch(()=>{});showError(error)}finally{setBusy(button,false)}}

function openVersions(){renderVersionList();$('#versionsDialog').showModal()}
function renderVersionList(){const baseline=versions.find(version=>version.is_baseline);$('#versionList').innerHTML=versions.length?versions.map(version=>`<article class="version-row" data-version-id="${version.id}"><div><b>第${version.version_number}版 ${esc(version.name)}${version.is_baseline?'（当初工程）':''}</b><small>${formatDateTime(version.confirmed_at)}・${esc(version.reason||'変更理由なし')}</small></div><button class="button quiet compact" data-compare-version type="button">現在と比較</button>${isOwner()?'<button class="button danger compact" data-restore-version type="button">復元</button>':''}</article>`).join(''):'<p class="compact-empty">確定済みの工程版はありません。</p>';$('#versionCompare').innerHTML=baseline?`<p>当初工程：第${baseline.version_number}版 ${esc(baseline.name)}</p>`:''}
async function saveVersion(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');setBusy(button,true,'確定中…');try{await createScheduleVersion(currentProject.id,form.elements.name.value.trim(),form.elements.reason.value.trim(),form.elements.comment.value.trim(),form.elements.is_baseline.checked);form.reset();toast('現在の工程を版として確定しました');await refreshCurrentProject(true);renderVersionList()}catch(error){showError(error)}finally{setBusy(button,false)}}
async function compareVersion(id){const rows=await loadVersionTasks(id),changes=compareVersionTasks(tasks,rows),version=versions.find(item=>item.id===id);$('#versionCompare').innerHTML=`<h3>第${version.version_number}版と現在の比較</h3><p class="help-text">復元するのは予定・順序・前工程です。進捗報告と実績日は保持されます。</p>${changes.length?changes.map(item=>`<article><b>${esc(item.name)}</b><span>${item.type==='added'?'現在版で追加':item.type==='removed'?'現在版で削除':item.changes.map(change=>`${esc(change.field)}: ${esc(change.before)} → ${esc(change.after)}`).join(' / ')}</span></article>`).join(''):'<p>変更はありません。</p>'}`}

async function openNotifications(){
  const [list,preferences]=await Promise.all([loadNotifications(),loadNotificationPreferences()]),form=$('#notificationPreferences');
  for(const name of ['in_app','email','browser','line'])form.elements[name].checked=Boolean(preferences[name]);
  $('#notificationCount').textContent=String(list.filter(item=>!item.read_at).length);$('#notificationList').innerHTML=list.length?list.map(item=>`<button class="notification-item ${item.read_at?'':'unread'}" data-notification-id="${item.id}" data-target="${esc(item.target_hash)}" type="button"><b>${esc(item.title)}</b><span>${esc(item.body)}</span><small>${formatDateTime(item.created_at)}</small></button>`).join(''):'<p class="compact-empty">通知はありません。</p>';$('#notificationsDialog').showModal()
}
async function saveNotificationSettings(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');setBusy(button,true);
  try{
    let browser=form.elements.browser.checked;
    if(browser){
      if(!('Notification' in window)){browser=false;form.elements.browser.checked=false;toast('このブラウザは通知に対応していません。')}
      else if(Notification.permission!=='granted'){browser=(await Notification.requestPermission())==='granted';form.elements.browser.checked=browser;if(!browser)toast('ブラウザ通知が許可されませんでした。')}
    }
    await saveNotificationPreferences({in_app:form.elements.in_app.checked,email:form.elements.email.checked,browser,line:form.elements.line.checked});
    toast('通知設定を保存しました。メール・LINEは配信サービスを設定した場合だけ送信されます。');
  }catch(error){showError(error)}finally{setBusy(button,false)}
}
async function refreshNotificationBadge(){try{const list=await loadNotifications(),count=list.filter(item=>!item.read_at).length;$('#notificationCount').textContent=String(count);$('#notificationsButton').classList.toggle('has-unread',count>0)}catch{}}

function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const EXPORT_HEADERS=['工程記号','工種','工程名','数量','単位','1日量','班数','人/班','所要日数','前工程','後続','担当会社','備考','金額(千円)','棟','階','予定開始','予定完了','実績開始','実績完了','進捗率','状態','遅延判定','遅延理由'];
function exportRows(){return tasks.map(task=>{const node=lastSchedule?.nodes.get(task.id),successors=tasks.filter(item=>(item.dependencies||[]).includes(task.id)).map(item=>item.code).join('・');return [task.code,task.trade,task.name,task.quantity??'',task.unit||'',task.daily_output??'',task.crew_count??'',task.people_per_crew??'',task.duration_days,(task.dependencies||[]).map(id=>tasks.find(item=>item.id===id)?.code).filter(Boolean).join('・'),successors,task.company,task.notes||'',task.cost_thousands??'',task.building||'',task.floor||'',node?.startDate||task.planned_start||'',node?.endDate||task.planned_finish||'',task.actual_start||'',task.actual_finish||'',progressOf(task),taskState(task),scheduleState(task,node,todayISO()),task.delay_reason||'']})}
function exportCsv(){downloadBlob(new Blob([utf8Csv(EXPORT_HEADERS,exportRows())],{type:'text/csv;charset=utf-8'}),`${currentProject.name}-工程一覧.csv`)}
function exportXlsx(){if(!window.XLSX){toast('Excel出力部品を読み込めません。CSV出力をご利用ください。');return}const workbook=window.XLSX.utils.book_new(),add=(name,rows)=>window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.aoa_to_sheet(rows),name);add('案件情報',[['案件名',currentProject.name],['現場名',currentProject.site_name||''],['発注者',currentProject.client_name||''],['責任者',currentProject.manager||''],['構造・規模',currentProject.structure_scale||''],['着工日',currentProject.start_date],['契約完成日',currentProject.deadline||''],['休日方針',currentProject.holiday_policy||''],['月別天候余裕',weatherAllowanceText(currentProject.weather_allowance)]]);add('工程一覧',[EXPORT_HEADERS,...exportRows()]);add('準備チェック',[['No.','確認項目','状態'],...PREFLIGHT_ITEMS.map(([key,label],index)=>[index+1,label,(currentProject.preflight_completed||[]).includes(key)?'確認済':'未確認'])]);add('管理項目',[['種別','件名','関連工程','担当者','担当会社','期限','状態','優先度'],...managementItems.map(item=>[item.item_type,item.title,tasks.find(task=>task.id===item.task_id)?.name||'',item.assignee_name,item.company,item.due_date,item.status,item.priority])]);add('工程比較',[['版','確定日時','変更理由'],...versions.map(version=>[version.name,version.confirmed_at,version.reason])]);window.XLSX.writeFile(workbook,`${currentProject.name}-工程管理.xlsx`)}

function openImpact(taskId=null){
  if(!canEdit()||!tasks.length)return;pendingImpact=null;$('#applyImpactButton').hidden=true;
  $('#delayTaskSelect').innerHTML=tasks.map(task=>`<option value="${task.id}">${esc(task.code)} ${esc(task.name)}</option>`).join('');
  if(taskId&&tasks.some(task=>task.id===taskId))$('#delayTaskSelect').value=taskId;
  $('#impactCause').value='天候';$('#delayDaysInput').value='0';$('#weatherDatesInput').value='';$('#impactReasonInput').value='';updateImpactCause();$('#impactResult').textContent='原因・工程・休工日または遅延日数を入力してください。日程は確認するまで変更されません。';$('#impactDialog').showModal();
}
function updateImpactCause(){const weather=$('#impactCause').value==='天候';$('#weatherDatesField').hidden=!weather;$('#weatherDatesInput').disabled=!weather;if(!weather&&Number($('#delayDaysInput').value)===0)$('#delayDaysInput').value='1'}
function calculateImpact(){
  try{
    const taskId=$('#delayTaskSelect').value,cause=$('#impactCause').value,days=Math.max(0,Math.min(365,Number($('#delayDaysInput').value)||0)),blockedDates=cause==='天候'?parseDates($('#weatherDatesInput').value):[];if(!days&&!blockedDates.length)throw new Error('休工日または追加する遅れ日数を入力してください。');pendingImpact={taskId,days,cause,blockedDates,...compareTaskChange(currentProject,tasks,taskId,{delayDays:days,blockedDates})};
    const task=tasks.find(item=>item.id===taskId),links=taskConnectionSummary(task),affected=pendingImpact.changes.filter(change=>change.task.id!==taskId),rows=affected.map(change=>`<li><b>${esc(change.task.code)} ${esc(change.task.name)}</b><span>${formatDate(change.before.startDate)} → ${formatDate(change.after.startDate)}（${change.after.es-change.before.es}実働日後）</span></li>`).join('');
    $('#impactResult').innerHTML=`<div class="impact-flow"><span>${links.before.length?`前工程 ${esc(links.before.join('・'))}`:'着手工程'}</span><i>→</i><strong>${esc(task.code)} ${esc(task.name)}<small>${esc(cause)}による変更</small></strong><i>→</i><span>${links.after.length?`後続 ${esc(links.after.join('・'))}`:'完了'}</span></div><p>${blockedDates.length?`休工日 ${blockedDates.map(formatDate).join('、')}。`:''}${days?`所要日数を${days}実働日追加。`:''} 完了予定は <b>${formatDate(pendingImpact.after.finish)}</b>（${pendingImpact.finishShift?`${pendingImpact.finishShift}実働日後ろ倒し`:'変更なし'}）です。</p>${rows?`<ul class="impact-affected"><li class="heading">影響がつながる工程</li>${rows}</ul>`:'<p>後続工程の開始日に変更はありません。</p>'}${isOwner()?'':'<small>変更案の確定は責任者が行います。</small>'}`;
    $('#applyImpactButton').hidden=false;$('#applyImpactButton').textContent=isOwner()?'責任者として正式日程に反映':'変更案を責任者へ提出';
  }catch(error){showError(error);pendingImpact=null;$('#applyImpactButton').hidden=true}
}
async function applyImpact(){
  if(!pendingImpact||!canEdit())return;const task=tasks.find(item=>item.id===pendingImpact.taskId),button=$('#applyImpactButton'),detail=$('#impactReasonInput').value.trim(),reason=`${pendingImpact.cause}${detail?`：${detail}`:''}`;if(!detail){toast('変更理由の詳細を入力してください。');$('#impactReasonInput').focus();return}setBusy(button,true,isOwner()?'反映中…':'提出中…');
  try{
    if(fieldOperations){
      const impactData={cause:pendingImpact.cause,weather_dates:pendingImpact.blockedDates,finishBefore:pendingImpact.before.finish,finishAfter:pendingImpact.after.finish,finishShift:pendingImpact.finishShift,connections:taskConnectionSummary(task),affected:pendingImpact.changes.filter(change=>change.task.id!==task.id).map(change=>({task_id:change.task.id,before_start:change.before?.startDate,before_finish:change.before?.endDate,after_start:change.after?.startDate,after_finish:change.after?.endDate}))};
      const changeType=pendingImpact.cause==='天候'?'weather_delay':'duration_delay',proposedPatch=changeType==='weather_delay'?pendingImpact.patch:{duration_days:pendingImpact.patch.duration_days},request=await submitScheduleChangeRequest(currentProject.id,task.id,task.version,changeType,proposedPatch,reason,impactData);
      if(isOwner())await reviewScheduleChangeRequest(request.id,'approved','責任者が影響を確認して反映');
      $('#impactDialog').close();toast(isOwner()?'変更案を正式日程へ反映しました':'変更案を責任者へ提出しました');await refreshCurrentProject(true);if(isOwner()){await syncCurrentPlan();await refreshCurrentProject(true);await createScheduleVersion(currentProject.id,`変更確定 ${todayISO()}`,reason,'変更案の承認により自動作成',false);await refreshCurrentProject(true)}
    }else if(isOwner()){await updateTask(task,pendingImpact.patch);$('#impactDialog').close();toast('確認した変更案を工程表へ反映しました');await refreshCurrentProject(true)}
  }catch(error){showError(error);await refreshCurrentProject(true)}finally{setBusy(button,false)}
}

async function boot(){
  setAuthMode('login');
  if(!configured){$('#authForm').querySelectorAll('input,button').forEach(node=>node.disabled=true);showPublicAuth('login');return}
  $('#setupNotice').hidden=true;
  $('#authView').querySelectorAll('input,button').forEach(node=>node.disabled=false);
  try{const current=await session();if(current)await enterApplication();else showPublicAuth(location.hash==='#register'?'register':'login')}catch(error){showPublicAuth('login');showError(error,'#authMessage')}
}

$('#authForm').addEventListener('submit',handleAuth);$('#authSwitch').addEventListener('click',()=>showPublicAuth(authMode==='login'?'register':'login'));$('.auth-brand').addEventListener('click',event=>{event.preventDefault();showPublicAuth('login')});
for(const id of ['publicLogin','heroLogin','footerLogin'])$(`#${id}`)?.addEventListener('click',()=>showPublicAuth('login'));$('#publicRegister')?.addEventListener('click',()=>showPublicAuth('register'));
document.querySelectorAll('[data-demo-view]').forEach(button=>button.addEventListener('click',()=>switchDemo(button.dataset.demoView)));$('.demo-tabs')?.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-demo-view]')],current=tabs.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;switchDemo(tabs[next].dataset.demoView,true)});$('#demoCompleteTask')?.addEventListener('click',completeDemoTask);$('#demoShowImpact')?.addEventListener('click',showDemoImpact);$('#demoConfirmImpact')?.addEventListener('click',confirmDemoImpact);
$('#resetPassword').addEventListener('click',async()=>{const email=$('#authEmail').value.trim();if(!email){$('#authMessage').textContent='メールアドレスを入力してください。';return}try{await sendPasswordReset(email);$('#authMessage').textContent='パスワード再設定メールを送りました。'}catch(error){showError(error,'#authMessage')}});
$('#logoutButton').addEventListener('click',async()=>{const userId=profile?.id,pending=userId?await pendingOperations(userId).catch(()=>[]):[];if(pending.length){toast(`未同期の報告が${pending.length}件あります。接続して同期してからログアウトしてください。`);return}await signOut();if(userId)await clearOfflineUser(userId).catch(()=>{});stopRealtime?.();profile=null;projects=[];currentProject=null;showLanding('home')});
$('#backButton').addEventListener('click',showProjects);$('#brandLink').addEventListener('click',event=>{event.preventDefault();showProjects()});
$('#navProjects').addEventListener('click',showProjects);$('#navToday').addEventListener('click',showHome);$('#navProfile').addEventListener('click',showProfile);
$('#homeAllProjects').addEventListener('click',showProjects);$('#homeProjectGrid').addEventListener('click',event=>{const card=event.target.closest('[data-home-project]');if(card)openProject(card.dataset.homeProject)});$('#homeAgenda').addEventListener('click',event=>{const item=event.target.closest('[data-home-project]');if(item)openProject(item.dataset.homeProject)});$('#homeNowCard').addEventListener('click',event=>{const projectId=event.currentTarget.dataset.projectId;if(projectId)openProject(projectId)});$('#homeNowCard').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.currentTarget.dataset.projectId){event.preventDefault();openProject(event.currentTarget.dataset.projectId)}});
$('#profileForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,name=form.elements.display_name.value.trim(),button=form.querySelector('[type="submit"]');if(!name){$('#profileMessage').textContent='お名前を入力してください。';return}setBusy(button,true,'保存中');try{profile=await updateProfileName(name);$('#userName').textContent=profile.display_name||profile.email;$('#userInitial').textContent=(profile.display_name||profile.email||'?').slice(0,1).toUpperCase();$('#profileAvatar').textContent=$('#userInitial').textContent;$('#profileMessage').textContent='保存しました。'}catch(error){showError(error,'#profileMessage')}finally{setBusy(button,false)}});$('#profileLogout').addEventListener('click',()=>$('#logoutButton').click());
$('#newProjectButton').addEventListener('click',()=>{const form=$('#projectForm');form.reset();form.elements.start_date.value=new Date().toISOString().slice(0,10);$('#projectDialog').showModal()});
$('#projectForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),data=new FormData(form);setBusy(button,true,'案件を作成中…');try{const id=await createProject(data.get('name'),data.get('start_date'));if(data.has('use_template'))await addStandardTemplate(id,button);$('#projectDialog').close();await openProject(id);if(data.has('use_template'))toast('標準工程を作成しました。日数や順序は自由に編集できます。')}catch(error){showError(error)}finally{setBusy(button,false)}});
$('#projectGrid').addEventListener('click',event=>{const card=event.target.closest('[data-project-id]');if(card)openProject(card.dataset.projectId)});$('#projectGrid').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){const card=event.target.closest('[data-project-id]');if(card){event.preventDefault();openProject(card.dataset.projectId)}}});
['projectSearch','projectFilter','projectSort'].forEach(id=>document.getElementById(id)?.addEventListener(id==='projectSearch'?'input':'change',renderProjects));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
$('#horizonTabs').addEventListener('click',event=>{const button=event.target.closest('[data-horizon]');if(!button)return;todayHorizon=Number(button.dataset.horizon);$('#horizonTabs').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderToday(lastSchedule)});
$('#todayCompanyFilter').addEventListener('change',event=>{todayCompany=event.target.value;saveCompanyFilter();renderToday(lastSchedule)});
$('#addTaskButton').addEventListener('click',()=>openTaskEditor());$('#taskForm').addEventListener('submit',saveTask);$('#deleteTaskButton').addEventListener('click',removeCurrentTask);
$('#importScheduleButton').addEventListener('click',openScheduleImport);$('#analyzeScheduleFile').addEventListener('click',analyzeScheduleFile);$('#applyScheduleImport').addEventListener('click',commitScheduleImport);
$('#reportFromTaskButton').addEventListener('click',()=>{const task=tasks.find(item=>item.id===$('#taskForm').elements.id.value);if(task){$('#taskDialog').close();openReportDialog(task,progressOf(task))}});
$('#taskForm').addEventListener('click',event=>{const step=event.target.closest('[data-duration-step]');if(!step)return;const input=event.currentTarget.elements.duration_days;input.value=Math.max(1,Math.min(365,Number(input.value||1)+Number(step.dataset.durationStep)))});
$('#taskForm').addEventListener('input',event=>{if(event.target.name==='progress_percent')$('#progressOutput').textContent=`${event.target.value}%`});$('#taskForm').addEventListener('click',event=>{const button=event.target.closest('[data-progress]');if(!button)return;event.currentTarget.elements.progress_percent.value=button.dataset.progress;$('#progressOutput').textContent=`${button.dataset.progress}%`;if(button.dataset.progress==='100'&&!event.currentTarget.elements.actual_finish.value)event.currentTarget.elements.actual_finish.value=todayISO()});
$('#taskList').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-task]');if(toggle){event.stopPropagation();toggleTask(toggle.dataset.toggleTask);return}const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))});$('#taskList').addEventListener('keydown',event=>{if(event.key==='Enter'){const row=event.target.closest('[data-task-id]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.taskId))}});
$('#fieldDashboard').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-task]');if(toggle){toggleTask(toggle.dataset.toggleTask);return}const impact=event.target.closest('[data-impact-task]');if(impact){openImpact(impact.dataset.impactTask);return}const edit=event.target.closest('[data-edit-task]');if(edit)openTaskEditor(tasks.find(task=>task.id===edit.dataset.editTask))});
$('#attentionBoard').addEventListener('click',event=>{const item=event.target.closest('[data-open-management]');if(item)openManagement(item.dataset.openManagement)});$('#openManagementFromToday').addEventListener('click',()=>openManagement());
$('#ganttChart').addEventListener('click',event=>{const impact=event.target.closest('[data-impact-task]');if(impact){event.stopPropagation();openImpact(impact.dataset.impactTask);return}const toggle=event.target.closest('[data-toggle-task]');if(toggle){event.stopPropagation();toggleTask(toggle.dataset.toggleTask);return}const button=event.target.closest('[data-edit-task]');if(button)openTaskEditor(tasks.find(task=>task.id===button.dataset.editTask))});
$('#networkDiagram').addEventListener('pointerdown',beginNetworkDrag);
$('#networkDiagram').addEventListener('click',event=>{const node=event.target.closest('[data-edit-task]');if(node&&!networkLayoutEditing&&!node.dataset.dragged)openTaskEditor(tasks.find(task=>task.id===node.dataset.editTask));if(node)delete node.dataset.dragged});
$('#networkDiagram').addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key))return;const node=event.target.closest('[data-edit-task]');if(node){event.preventDefault();openTaskEditor(tasks.find(task=>task.id===node.dataset.editTask))}});
let networkScrollTimer;
$('#networkShell').addEventListener('wheel',event=>{
  const shell=event.currentTarget;if(window.innerWidth<701||networkLayoutEditing||Math.abs(event.deltaY)<=Math.abs(event.deltaX)||shell.scrollWidth<=shell.clientWidth)return;
  event.preventDefault();shell.scrollLeft+=event.deltaY;shell.classList.add('is-scrolling');clearTimeout(networkScrollTimer);networkScrollTimer=setTimeout(()=>shell.classList.remove('is-scrolling'),180);
},{passive:false});
document.querySelectorAll('[data-network-mode]').forEach(button=>button.addEventListener('click',()=>{networkMode=button.dataset.networkMode;document.querySelectorAll('[data-network-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));if(lastSchedule)renderNetwork(lastSchedule)}));
document.querySelectorAll('[data-network-structure]').forEach(button=>button.addEventListener('click',()=>{networkStructure=button.dataset.networkStructure;networkLayoutEditing=false;document.querySelectorAll('[data-network-structure]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));$('#networkLayoutButton').setAttribute('aria-pressed','false');$('#networkLayoutButton').textContent='配置を調整';if(lastSchedule)renderNetwork(lastSchedule)}));
$('#networkRelationList').addEventListener('click',event=>{const row=event.target.closest('[data-edit-task]');if(row)openTaskEditor(tasks.find(task=>task.id===row.dataset.editTask))});
$('#networkLayoutButton').addEventListener('click',toggleNetworkLayout);$('#resetNetworkLayoutButton').addEventListener('click',clearNetworkLayout);
$('#ganttChart').addEventListener('pointerdown',beginGanttScale);
$('#ganttChart').addEventListener('pointerdown',beginGanttResize);
$('#ganttChart').addEventListener('keydown',event=>{const scale=event.target.closest('[data-scale-boundary]');if(scale&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();applyGanttScale(ganttUnit+(event.key==='ArrowRight'?2:-2));try{localStorage.setItem('snake-gantt-day-width',String(ganttUnit))}catch{}return}const handle=event.target.closest('[data-resize-task]');if(!handle||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const task=tasks.find(item=>item.id===handle.dataset.resizeTask);resizeTaskDuration(task.id,task.duration_days+(event.key==='ArrowRight'?1:-1),handle.closest('.gantt-task'))});
$('#resetGanttScale').addEventListener('click',()=>{applyGanttScale(GANTT_DEFAULT_UNIT);try{localStorage.setItem('snake-gantt-day-width',String(GANTT_DEFAULT_UNIT))}catch{}toast('カレンダーの表示幅を標準に戻しました')});
$('#ganttZoomOut').addEventListener('click',()=>applyGanttScale(ganttUnit-4));$('#ganttZoomIn').addEventListener('click',()=>applyGanttScale(ganttUnit+4));$('#ganttTodayButton').addEventListener('click',()=>{$('#ganttChart .gantt-day.today')?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'})});
$('#saveProjectButton').addEventListener('click',saveProjectSettings);$('#membersButton').addEventListener('click',openMembers);$('#inviteForm').addEventListener('submit',invite);
$('#copyInviteLink').addEventListener('click',async()=>{if(!lastInviteUrl)return;await navigator.clipboard.writeText(lastInviteUrl);toast('招待リンクをコピーしました')});
$('#invitationList').addEventListener('click',async event=>{const button=event.target.closest('[data-revoke-invitation]');if(!button)return;await revokeInvitation(button.closest('[data-invitation-id]').dataset.invitationId);toast('招待を取り消しました');await renderInvitations()});
$('#memberList').addEventListener('change',async event=>{const select=event.target.closest('[data-member-role]');if(!select)return;try{await changeMemberRole(select.closest('[data-member-id]').dataset.memberId,select.value);toast('権限を変更しました');await renderMembers()}catch(error){showError(error);await renderMembers()}});
$('#memberList').addEventListener('click',async event=>{const button=event.target.closest('[data-remove-member]');if(!button)return;try{await removeMember(button.closest('[data-member-id]').dataset.memberId);toast('メンバーを削除しました');await renderMembers()}catch(error){showError(error)}});
$('#reportForm').addEventListener('submit',saveProgressReport);$('#reportForm').addEventListener('change',event=>{if(event.target.name==='schedule_condition')updateReportDelayFields(event.currentTarget)});$('#reportForm').addEventListener('click',event=>{const button=event.target.closest('[data-report-progress]');if(!button)return;const form=event.currentTarget;form.elements.progress_percent.value=button.dataset.reportProgress;if(button.dataset.reportProgress==='100')form.elements.actual_finish.value=form.elements.actual_finish.value||todayISO();else form.elements.actual_finish.value=''});
$('#changeRequestBoard').addEventListener('click',event=>{const button=event.target.closest('[data-review-change]'),row=event.target.closest('[data-change-request]');if(button&&row)reviewChangeRequest(row.dataset.changeRequest,button.dataset.reviewChange)});
$('#taskActivity').addEventListener('click',async event=>{const mode=event.target.closest('[data-activity]');if(mode){const id=$('#taskForm').elements.id.value;if(id)renderTaskActivity(id,mode.dataset.activity);return}const file=event.target.closest('[data-open-attachment]');if(file){window.open(await signedAttachmentUrl(file.dataset.openAttachment),'_blank','noopener')}});$('#taskActivity').addEventListener('submit',async event=>{if(event.target.id!=='commentForm')return;event.preventDefault();const form=event.target,button=form.querySelector('button'),mentions=[...form.elements.mentions.selectedOptions].map(option=>option.value),files=[...form.elements.files.files];setBusy(button,true);let uploaded=[];try{if(files.length)uploaded=await uploadTaskFiles(currentProject.id,form.dataset.taskId,files);const comment=await createComment(currentProject.id,form.dataset.taskId,form.elements.body.value.trim(),mentions);if(uploaded.length)await saveAttachmentRecords(currentProject.id,form.dataset.taskId,uploaded,null,comment.id);await renderTaskActivity(form.dataset.taskId,'comments');toast('コメントを投稿しました')}catch(error){if(uploaded.length)await removeUploadedFiles(uploaded.map(item=>item.storage_path)).catch(()=>{});showError(error)}finally{setBusy(button,false)}});
$('#managementButton').addEventListener('click',()=>openManagement());$('#managementForm').addEventListener('submit',saveManagement);$('#managementList').addEventListener('click',async event=>{const row=event.target.closest('[data-management-id]');if(!row)return;if(event.target.closest('[data-delete-management]')){if(confirm('この管理項目を削除しますか？')){await deleteManagementItem(row.dataset.managementId);await refreshCurrentProject(true);renderManagementList()}return}if(event.target.closest('[data-edit-management]'))fillManagementForm(managementItems.find(item=>item.id===row.dataset.managementId))});
$('#versionsButton').addEventListener('click',openVersions);$('#versionForm').addEventListener('submit',saveVersion);$('#versionList').addEventListener('click',async event=>{const row=event.target.closest('[data-version-id]');if(!row)return;if(event.target.closest('[data-compare-version]'))await compareVersion(row.dataset.versionId);if(event.target.closest('[data-restore-version]')&&confirm('現在の予定を自動バックアップして、この版の予定・順序へ復元しますか？ 進捗報告と実績日は保持されます。')){await restoreScheduleVersion(row.dataset.versionId);$('#versionsDialog').close();toast('予定工程を復元しました（実績は保持）');await refreshCurrentProject(true)}});
$('#notificationsButton').addEventListener('click',openNotifications);$('#notificationPreferences').addEventListener('submit',saveNotificationSettings);$('#readAllNotifications').addEventListener('click',async()=>{await markAllNotificationsRead();await openNotifications()});$('#notificationList').addEventListener('click',async event=>{const item=event.target.closest('[data-notification-id]');if(!item)return;await markNotificationRead(item.dataset.notificationId);$('#notificationsDialog').close();const project=item.dataset.target.match(/project=([^&]+)/)?.[1];if(project)await openProject(project)});
$('#discardOfflineReport').addEventListener('click',discardOfflineConflict);$('#reopenOfflineReport').addEventListener('click',reopenOfflineConflict);
$('#historyButton').addEventListener('click',showHistory);$('#impactButton').addEventListener('click',openImpact);$('#impactCause').addEventListener('change',updateImpactCause);$('#calculateImpactButton').addEventListener('click',calculateImpact);$('#applyImpactButton').addEventListener('click',applyImpact);$('#printButton').addEventListener('click',()=>$('#exportDialog').showModal());$('#printSchedule').addEventListener('click',()=>{const form=$('#exportForm'),paper=form.elements.paper.value,range=form.elements.range.value,style=document.getElementById('printPageRule')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'printPageRule'}));style.textContent=`@page{size:${paper} landscape;margin:10mm}`;$('#ganttView').dataset.printTitle=`${currentProject.name}｜${range==='week'?'週間':range==='month'?'月間':'全体'}工程｜作成 ${todayISO()}｜責任者 ${currentProject.manager||'未設定'}`;renderGantt(lastSchedule,range);window.print()});window.addEventListener('afterprint',()=>{if(lastSchedule)renderGantt(lastSchedule)});$('#csvExport').addEventListener('click',exportCsv);$('#xlsxExport').addEventListener('click',exportXlsx);
for(const selector of ['#historyEntityFilter','#historyActionFilter','#historySearch'])$(selector).addEventListener('input',renderHistory);
$('#migrateButton').addEventListener('click',migrateLegacy);$('#dismissMigration').addEventListener('click',()=>{dismissMigration(profile.id);$('#migrationBanner').hidden=true});
document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
window.addEventListener('online',()=>{setConnection('connecting','再接続中');syncOfflineQueue()});window.addEventListener('offline',()=>setConnection('offline','オフライン'));
client?.auth.onAuthStateChange((event,current)=>{if(event==='SIGNED_OUT'&&!current){profile=null;projects=[];currentProject=null}});
boot();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
