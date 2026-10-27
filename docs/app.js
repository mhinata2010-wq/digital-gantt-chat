const $ = id => document.getElementById(id);
const KEY = 'snake_schedule_only_v1';
const PROJECTS_KEY = 'snake_schedule_projects_v2';
const SATO_ID = 'sato-master-2021';
const compactLandscape = () => window.matchMedia('(max-width: 900px) and (orientation: landscape) and (max-height: 650px)').matches;
const portraitPhone = () => window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
const LABEL_WIDTH = () => window.innerWidth <= 600 ? 164 : 280;
const WIDTH = () => state.scale === 'month' ? Math.max(.12,(document.querySelector('.board').clientWidth-LABEL_WIDTH()-18)/overviewDays()) : compactLandscape() ? Math.max(26,Math.min(48,Math.floor((window.innerWidth-62-LABEL_WIDTH()-8)/state.days))) : window.innerWidth <= 780 ? 38 : Math.max(48,Math.min(80,Math.floor((window.innerWidth > 900 ? $('boardScroll').clientWidth-LABEL_WIDTH()-2 : 48*state.days)/state.days)));
const todayISO = () => {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const weekdays = ['日','月','火','水','木','金','土'];
let state, projects, activeId, editing = null, dragging = false;
let editingMode=false, detailTaskId=null;
let listView=window.innerWidth<=600, periodOnly=true;
function overviewDays(){const starts=state.tasks.map(t=>t.start).sort(),ends=state.tasks.map(t=>taskEnd(t)).sort();if(!starts.length)return 31;const first=starts[0].slice(0,7)+'-01',last=ends.at(-1);return distance(plus(last.slice(0,7)+'-01',new Date(Date.UTC(+last.slice(0,4),+last.slice(5,7),0)).getUTCDate()-1),first)+1}
function tradeCategory(task){const value=task.name+' '+(task.group||'');if(/内装/.test(value))return '内装';if(/足場|クレーン|エレベーター|仮設/.test(value))return '仮設・揚重';if(/外構|駐車|フェンス|調整池/.test(value))return '外構';if(/検査|確認会|内覧|竣工|引渡/.test(value))return '検査・引渡し';if(/設備|配線|配管|EV/.test(value))return '設備';if(/防水|外装|塗装|屋根/.test(value))return '外装・防水';if(/躯体|床|養生|CON|打設/.test(value))return '躯体';if(/基礎|掘削|山留|埋戻|土|準備/.test(value))return '土工・基礎';return 'その他'}
document.body.classList.add('reading-mode');
let receiptCounts = new Map(), receiptLoadFailed = new Set(), receiptPreviewURLs = [];
const FAVORITES_KEY = 'snake_schedule_favorites_v1';
let favorites = new Set();
try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY)); if (Array.isArray(saved)) favorites = new Set(saved.filter(id => typeof id === 'string')); } catch {}

function dayDate(value){return new Date(`${value}T12:00:00Z`)}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayDate(value).valueOf()) && dayDate(value).toISOString().slice(0,10)===value}
function plus(value,amount){let date=dayDate(value);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
function distance(a,b){return Math.round((dayDate(a)-dayDate(b))/86400000)}
function rangeLabel(task){const end=taskEnd(task);return task.start.slice(0,4)===end.slice(0,4)?`${short(task.start)} → ${short(end)}`:`${task.start.slice(0,4)}/${short(task.start)} → ${end.slice(0,4)}/${short(end)}`}
function short(value){return `${+value.slice(5,7)}/${+value.slice(8)}`}
function startOfWeek(value){const d=dayDate(value);return plus(value,-((d.getUTCDay()+6)%7))}
function newId(){return crypto.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(16).slice(2)}`}
function text(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function example(){const monday=startOfWeek(todayISO()),ids=Array.from({length:5},newId);return {name:'サンプル工事',viewStart:monday,days:14,tasks:[
 {id:ids[0],name:'土木工事',company:'土木業者',start:monday,days:4,complete:true},
 {id:ids[1],name:'基礎工事',company:'基礎業者',start:plus(monday,4),days:3,complete:false,predecessorIds:[ids[0]]},
 {id:ids[2],name:'躯体工事',company:'大工・建方業者',start:plus(monday,7),days:7,complete:false,predecessorIds:[ids[1]]},
 {id:ids[3],name:'電気配線',company:'電気業者',start:plus(monday,14),days:4,complete:false,predecessorIds:[ids[2]]},
 {id:ids[4],name:'内装工事',company:'内装業者',start:plus(monday,18),days:5,complete:false,predecessorIds:[ids[3]]}
]}}
function predecessors(task){return Array.isArray(task.predecessorIds)?task.predecessorIds:typeof task.predecessorId==='string'&&task.predecessorId?[task.predecessorId]:[]}
function hasDependencyCycle(tasks,id,predecessorId){const seen=new Set(),stack=[predecessorId];while(stack.length){const next=stack.pop();if(next===id)return true;if(seen.has(next))continue;seen.add(next);stack.push(...predecessors(tasks.find(task=>task.id===next)||{}))}return false}
function clean(input){if(!input || typeof input!=='object' || !Array.isArray(input.tasks) || input.tasks.length>200 || typeof input.name!=='string' || input.name.length>80 || !validDate(input.viewStart) || ![14,28].includes(input.days))throw Error('工程表データを読み取れませんでした');const tasks=input.tasks.map(task=>{if(!task || typeof task.name!=='string' || !task.name.trim() || task.name.length>80 || typeof task.company!=='string' || task.company.length>80 || !validDate(task.start) || !Number.isInteger(task.days) || task.days<1 || task.days>365)throw Error('工程の内容を確認してください');return {id:typeof task.id==='string'?task.id:newId(),name:task.name,company:task.company,group:typeof task.group==='string'?task.group.slice(0,60):'',note:typeof task.note==='string'?task.note.slice(0,100):'',start:task.start,days:task.days,complete:task.complete===null?null:task.complete===true,receiptRequired:task.receiptRequired===true,receiptReviewed:task.receiptReviewed===true,predecessorIds:[...new Set(predecessors(task).filter(id=>typeof id==='string'))]}});const ids=new Set(tasks.map(task=>task.id));for(const task of tasks){const wanted=task.predecessorIds;task.predecessorIds=[];for(const id of wanted)if(ids.has(id)&&!hasDependencyCycle(tasks,task.id,id))task.predecessorIds.push(id)}return {name:input.name,viewStart:input.viewStart,days:input.days,scale:input.scale==='month'?'month':'day',source:typeof input.source==='string'?input.source.slice(0,250):'',tasks}}
const existingProjects = !!localStorage.getItem(PROJECTS_KEY);
const existingLegacy = !!localStorage.getItem(KEY);
try{
 const data=JSON.parse(localStorage.getItem(PROJECTS_KEY));
 if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>51)throw Error('invalid projects');
 const ids=new Set();
 projects=data.projects.map(item=>{if(!item||typeof item.id!=='string'||ids.has(item.id))throw Error('invalid project');ids.add(item.id);return {id:item.id,schedule:clean(item.schedule)}});
 activeId=ids.has(data.activeId)?data.activeId:projects[0].id;
}catch{
 let initial;try{initial=clean(JSON.parse(localStorage.getItem(KEY)))}catch{initial=example()}
 activeId=newId();projects=[{id:activeId,schedule:initial}];
}
if(typeof SATO_SCHEDULE!=='undefined' && !projects.some(project=>project.id===SATO_ID) && projects.length<51){
 projects.unshift({id:SATO_ID,schedule:clean(SATO_SCHEDULE)});
 if(!existingProjects&&!existingLegacy)activeId=SATO_ID;
 localStorage.setItem(PROJECTS_KEY,JSON.stringify({activeId,projects}));
}
if(new URL(location.href).searchParams.get('project')===SATO_ID && projects.some(project=>project.id===SATO_ID))activeId=SATO_ID;
state=projects.find(project=>project.id===activeId).schedule;
let saveTimer;
function save(){projects.find(project=>project.id===activeId).schedule=state;localStorage.setItem(PROJECTS_KEY,JSON.stringify({activeId,projects}));$('saveState').textContent='この端末に保存しました';clearTimeout(saveTimer);saveTimer=setTimeout(()=>$('saveState').textContent='この端末に保存しました',2000)}
function announce(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3200)}
function receiptStatus(task){
 if(!task.receiptRequired)return null;
 if(receiptLoadFailed.has(task.id))return {kind:'error',label:'領収書を読めません'};
 const count=receiptCounts.get(task.id);
 if(count===undefined)return {kind:'loading',label:'領収書を確認中'};
 if(!count)return {kind:'missing',label:'領収書が未添付'};
 return task.receiptReviewed?{kind:'reviewed',label:`領収書${count}枚・確認済み`}:{kind:'attached',label:`領収書${count}枚・確認待ち`};
}
async function loadReceiptCounts(){
 const projectId=activeId, tasks=[...state.tasks];receiptCounts=new Map();receiptLoadFailed=new Set();
 await Promise.all(tasks.filter(task=>task.receiptRequired).map(async task=>{
  try{const photos=await receiptStore.list(projectId,task.id);if(projectId===activeId)receiptCounts.set(task.id,photos.length)}
  catch{if(projectId===activeId)receiptLoadFailed.add(task.id)}
 }));
 if(projectId===activeId)render();
}
function releaseReceiptURLs(){receiptPreviewURLs.forEach(url=>URL.revokeObjectURL(url));receiptPreviewURLs=[]}
async function renderReceiptPanel(){
 const projectId=activeId,taskId=editing,task=taskFor(taskId);if(!task||!$('taskDialog').open)return;
 const required=task.receiptRequired===true;
 $('receiptRequired').checked=required;$('receiptActions').hidden=!required;
 $('receiptList').replaceChildren();releaseReceiptURLs();
 if(!required){$('receiptState').textContent='対象外';return}
 $('receiptState').textContent='読み込み中…';$('receiptReview').disabled=true;
 try{
  const photos=await receiptStore.list(projectId,taskId);
  if(activeId!==projectId||editing!==taskId||!$('taskDialog').open)return;
  receiptCounts.set(taskId,photos.length);receiptLoadFailed.delete(taskId);render();
  $('receiptState').textContent=receiptStatus(task).label;
  $('receiptReview').disabled=!photos.length;$('receiptReview').textContent=task.receiptReviewed?'確認済みを取り消す':'確認済みにする';
  photos.forEach(photo=>{
   const url=URL.createObjectURL(photo.blob);receiptPreviewURLs.push(url);
   const li=document.createElement('li'),preview=document.createElement('a'),remove=document.createElement('button');
   preview.href=url;preview.target='_blank';preview.rel='noopener';preview.textContent=photo.name||'領収書の写真';
   remove.type='button';remove.textContent='削除';remove.dataset.receiptId=photo.id;remove.setAttribute('aria-label',`${photo.name||'領収書'}を削除`);
   li.append(preview,remove);$('receiptList').append(li);
  });
 }catch{
  if(activeId!==projectId||editing!==taskId)return;
  receiptLoadFailed.add(taskId);$('receiptState').textContent='写真を読み込めませんでした';render();
 }
}
const scheduleFilters = {query:'', building:'', floor:'', trade:''};
function taskFacets(task){
 const group=(task.group||'').normalize('NFKC'), name=task.name.normalize('NFKC');
 const building=group.match(/[^\s/]+棟/)?.[0]||'未設定・共通';
 const floor=group.match(/(?:地下\d+階|\d+階(?:床)?|屋上)/)?.[0]||'階指定なし';
 const trade=tradeCategory(task);

 return {building,floor,trade};
}
function filterScheduleTasks(tasks,filters){
 const words=filters.query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return tasks.filter(task=>{const facets=taskFacets(task),haystack=[task.name,task.company,task.group,task.note].join(' ').normalize('NFKC').toLocaleLowerCase();return ['building','floor','trade'].every(key=>!filters[key]||filters[key]===facets[key])&&words.every(word=>haystack.includes(word))});
}
function tasksInPeriod(tasks,first,last){return tasks.filter(task=>task.start<=last&&taskEnd(task)>=first)}
function taskEnd(task){return plus(task.start,task.days-1)}
function isWeatherSensitive(task){return /コンクリ|打設|掘削|土工|基礎|杭|防水|屋根|外構|足場|塗装|舗装|解体|埋戻/i.test(`${task.name} ${task.group||''}`)}
function activeDashboardProjects(){const current=projects.filter(project=>!project.schedule.source);return current.length?current:projects}
function dashboardTasks(){return activeDashboardProjects().flatMap(project=>project.schedule.tasks.map(task=>({project,task})))}
function homeItem(entry,kind){
 const {project,task}=entry,end=taskEnd(task),projectName=project.schedule.name||'名称未設定の工程表';
 const labels={today:'今日',late:'遅延',review:'確認待ち',weather:'天候確認',upcoming:short(task.start)};
 const details={today:`${short(task.start)}〜${short(end)}`,late:`${short(end)}までの予定`,review:'内容を確認してください',weather:`${short(task.start)}〜${short(end)}`,upcoming:`${projectName} · ${task.company||'担当未設定'}`};
 return `<button type="button" class="home-list-item is-${kind}" data-open-project="${text(project.id)}" data-open-task="${text(task.id)}"><span class="home-item-mark">${text(labels[kind])}</span><span class="home-item-copy"><strong>${text(task.name)}</strong><small>${text(details[kind])}</small></span><svg aria-hidden="true"><use href="#icon-arrow"/></svg></button>`;
}
function homeEmpty(message){return `<p class="home-empty">${text(message)}</p>`}
function renderHomeDashboard(){
 const today=todayISO(),all=dashboardTasks(),unfinished=all.filter(({task})=>task.complete!==true);
 const urgent=unfinished.filter(({task})=>task.start<=today&&taskEnd(task)>=today).sort((a,b)=>a.task.start.localeCompare(b.task.start));
 const late=unfinished.filter(({task})=>taskEnd(task)<today).sort((a,b)=>taskEnd(a.task).localeCompare(taskEnd(b.task)));
 const waiting=unfinished.filter(({task})=>task.receiptRequired&&!task.receiptReviewed&&taskEnd(task)>=today);
 const review=[...late.map(entry=>({...entry,kind:'late'})),...waiting.filter(entry=>!late.some(item=>item.task.id===entry.task.id&&item.project.id===entry.project.id)).map(entry=>({...entry,kind:'review'}))].slice(0,3);
 const weather=unfinished.filter(({task})=>task.start>=today&&isWeatherSensitive(task)).sort((a,b)=>a.task.start.localeCompare(b.task.start)).slice(0,3);
 const upcoming=unfinished.filter(({task})=>task.start>today).sort((a,b)=>a.task.start.localeCompare(b.task.start)).slice(0,3);
 const date=dayDate(today);$('homeDate').textContent=`${date.getUTCFullYear()}年${date.getUTCMonth()+1}月${date.getUTCDate()}日（${weekdays[date.getUTCDay()]}）`;
 $('homeUrgentCount').textContent=urgent.length?`${urgent.length}件`:'';$('homeReviewCount').textContent=review.length?`${review.length}件`:'';
 $('homeUrgent').innerHTML=urgent.length?urgent.slice(0,3).map(entry=>homeItem(entry,'today')).join(''):homeEmpty('今日、対応が必要な工程はありません。');
 $('homeReview').innerHTML=review.length?review.map(entry=>homeItem(entry,entry.kind)).join(''):homeEmpty('遅延・確認待ちの工程はありません。');
 $('homeWeather').innerHTML=weather.length?weather.map(entry=>homeItem(entry,'weather')).join(''):homeEmpty('天候の影響を確認する工程はありません。');
 $('homeUpcoming').innerHTML=upcoming.length?upcoming.map(entry=>homeItem(entry,'upcoming')).join(''):homeEmpty('次の予定は登録されていません。');
 $('homeProjects').innerHTML=projects.map(project=>`<div class="project-tile"><button type="button" class="project-open" data-open-project="${text(project.id)}" aria-label="${text(project.schedule.name||'名称未設定の工程表')}の工程表を開く"><span class="project-tile-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="project-tile-copy"><strong>${text(project.schedule.name||'名称未設定の工程表')}</strong><small>${project.schedule.tasks.length}工程 · ${short(project.schedule.viewStart)}から</small></span></button><button type="button" class="favorite-button ${favorites.has(project.id)?'is-favorite':''}" data-favorite="${text(project.id)}" aria-pressed="${favorites.has(project.id)}" aria-label="${text(project.schedule.name||'名称未設定の工程表')}を${favorites.has(project.id)?'お気に入りから外す':'お気に入りに追加'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/></svg></button></div>`).join('');
}
function refreshScheduleFilters(){
 for(const key of ['building','floor','trade']){
  const select=$('filter'+key[0].toUpperCase()+key.slice(1)),values=[...new Set(state.tasks.map(task=>taskFacets(task)[key]))].sort((a,b)=>a.localeCompare(b,'ja',{numeric:true}));
  if(scheduleFilters[key]&&!values.includes(scheduleFilters[key]))scheduleFilters[key]='';
  select.innerHTML='<option value="">すべて</option>'+values.map(value=>`<option value="${text(value)}">${text(value)}</option>`).join('');select.value=scheduleFilters[key];
 }
 const filtered=filterScheduleTasks(state.tasks,scheduleFilters);
 $('filterCount').textContent=`${filtered.length} / ${state.tasks.length}工程`;$('filterSummaryCount').textContent=Object.values(scheduleFilters).some(Boolean)?`${filtered.length} / ${state.tasks.length}工程`:'';
 $('clearFilters').disabled=!Object.values(scheduleFilters).some(Boolean);
 return filtered;
}
$('filterQuery').oninput=e=>{scheduleFilters.query=e.target.value;connectingSource=null;render()};
for(const key of ['building','floor','trade'])$('filter'+key[0].toUpperCase()+key.slice(1)).onchange=e=>{scheduleFilters[key]=e.target.value;connectingSource=null;render()};
$('clearFilters').onclick=()=>{Object.keys(scheduleFilters).forEach(key=>scheduleFilters[key]='');$('filterQuery').value='';connectingSource=null;render()};
function render(){const matchingTasks=refreshScheduleFilters();const monthScale=state.scale==='month',today=todayISO(),starts=state.tasks.map(task=>task.start),ends=state.tasks.map(task=>plus(task.start,task.days-1)),minDate=starts.length?starts.sort()[0]:state.viewStart,maxDate=ends.length?ends.sort().at(-1):plus(state.viewStart,27),first=monthScale?`${minDate.slice(0,7)}-01`:state.viewStart,last=monthScale?plus(`${maxDate.slice(0,7)}-01`,new Date(Date.UTC(+maxDate.slice(0,4),+maxDate.slice(5,7),0)).getUTCDate()-1):plus(first,state.days-1),days=distance(last,first)+1,w=WIDTH(),width=days*w,dates=Array.from({length:days},(_,i)=>plus(first,i));
 const filteredTasks=monthScale||!periodOnly?matchingTasks:tasksInPeriod(matchingTasks,first,last);
 $('jumpDate').value=first;$('periodOnly').checked=periodOnly;$('periodOnly').disabled=monthScale;
 $('overviewPeriod').textContent=state.tasks.length?`${minDate.replaceAll('-','/')} — ${maxDate.replaceAll('-','/')}`:'工程を登録すると、日程がここに表示されます';
 $('overviewTotal').textContent=state.tasks.length;$('overviewVisible').textContent=filteredTasks.length;
 $('overviewVisibleLabel').textContent=monthScale?'表示中':'期間内・表示中';
 $('sourceBadge').textContent=state.source?'参考工程表':'この端末の工程表';
 $('overviewContext').textContent=state.source?'過去資料を再構成した試作です':'端末内に保存・他の端末へは同期されません';
 $('filterCount').textContent=`${filteredTasks.length}件を表示 / 全${state.tasks.length}工程`;
 $('activeConditions').textContent=[scheduleFilters.building,scheduleFilters.floor,scheduleFilters.trade].filter(Boolean).join(' · ');
 $('scheduleList').hidden=!listView;$('boardScroll').hidden=listView;
 $('showList').setAttribute('aria-pressed',String(listView));$('showTimeline').setAttribute('aria-pressed',String(!listView));
 $('scheduleList').innerHTML=filteredTasks.map(task=>`<button type="button" class="schedule-card" data-open-detail="${text(task.id)}"><span class="schedule-card-category">${text(task.group||tradeCategory(task))}</span><strong>${text(task.name)}</strong><span class="schedule-card-dates">${rangeLabel(task)}<small>${task.days}日間</small></span><span class="schedule-card-bottom">${text(task.company||'担当未設定')}<span>${task.complete===true?'✓ 完了':'予定を確認 →'}</span></span></button>`).join('')||`<div class="list-empty"><strong>${state.tasks.length?'この条件・期間の工程はありません':'工程はまだありません'}</strong><p>日付や絞り込みを変えるか、全期間から探せます。</p><button type="button" data-reset-view>全期間で見る</button></div>`;
 document.body.classList.toggle('month-scale',monthScale);
 $('projectName').value=state.name;$('displayName').textContent=state.name||'名称未設定の工程表';$('viewStart').value=state.viewStart;$('periodLabel').textContent=monthScale?`${first.slice(0,4)}/${+first.slice(5,7)} – ${last.slice(0,4)}/${+last.slice(5,7)}`:`${first.slice(0,4)}年 ${short(first)} – ${short(last)}`;$('todayLabel').textContent=state.tasks.length?`${state.tasks.length}工程 · ${monthScale?'全期間を月単位で表示':'暦日で表示'}`:'工程を追加してください';$('projectMeta').textContent=state.source?'佐藤さんの総合工程表を再構成した試作です。':'工程を追加して、予定を組みましょう。';$('openSato').hidden=activeId===SATO_ID||!projects.some(project=>project.id===SATO_ID);document.querySelectorAll('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(!monthScale&&+button.dataset.days===state.days)));$('allPeriod').setAttribute('aria-pressed',String(monthScale));$('readerAll').setAttribute('aria-pressed',String(monthScale));$('sourceDetails').hidden=!state.source;$('sourceNote').textContent=state.source||'';$('boardInstruction').textContent=monthScale?'棒の端の丸から次の工程へ引くと、矢印でつながります。':'棒を左右にスワイプすると開始日を変更できます。端の丸から次の工程へ引くと矢印でつながります。';
 if(!editingMode)$('boardInstruction').textContent='工程名・工程線をタップすると開始日と終了日を確認できます。';
 $('boardProjectName').textContent=state.name;$('sheetProjectName').textContent=state.name||'名称未設定の工程表';$('sheetRange').textContent=`${first} 〜 ${last} / ${filteredTasks.length} / ${state.tasks.length}工程${Object.values(scheduleFilters).some(Boolean)?"（絞り込み中）":""}`;document.documentElement.style.setProperty('--sheet-print-scale',String(Math.min(1.2,1040/(LABEL_WIDTH()+width))));$('projectPicker').innerHTML=projects.map(project=>`<option value="${text(project.id)}">${text(project.schedule.name)}</option>`).join('');$('projectPicker').value=activeId;
 renderHomeDashboard();
 const yearGroups=[];for(let i=0;i<days;){let j=i+1;while(j<days&&dates[i].slice(0,4)===dates[j].slice(0,4))j++;yearGroups.push(`<span class="year-span" style="width:${(j-i)*w}px">${dates[i].slice(0,4)}年</span>`);i=j}
 const monthGroups=[];for(let i=0;i<days;){let j=i+1;while(j<days&&dates[i].slice(0,7)===dates[j].slice(0,7))j++;monthGroups.push(`<span class="month-span" style="width:${(j-i)*w}px">${+dates[i].slice(5,7)}月</span>`);i=j}
 const lines=monthScale?dates.filter(date=>date.slice(8)==='01').map(date=>`<span class="day-cell month-start ${[1,4,7,10].includes(+date.slice(5,7))?'quarter-start':''}" style="left:${distance(date,first)*w}px;width:1px" aria-label="${date.slice(0,7)}"></span>`).join(''):dates.map((date,i)=>`<span class="day-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${dayDate(date).getUTCDay()===1?'week-start':''} ${date.slice(8)==='01'?'month-start':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" aria-label="${date}"></span>`).join('');
 const header=monthScale?'':dates.map((date,i)=>`<span class="date-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" title="${date}">${+date.slice(8)}<span class="weekday">${weekdays[dayDate(date).getUTCDay()]}</span></span>`).join('');
 let previousGroup='',body=filteredTasks.map(task=>{
  const i=state.tasks.indexOf(task);
  const left=distance(task.start,first)*w,span=task.days*w,visibleStart=Math.max(0,left),visibleEnd=Math.min(width,left+span),visible=visibleEnd>visibleStart,status=task.complete===true?'完了':task.complete===false?'未完了':'実績未確認';
  const receipt=receiptStatus(task),receiptLabel=receipt?`、${receipt.label}`:'',dependencyNames=predecessors(task).map(id=>taskFor(id)?.name).filter(Boolean),dependencyLabel=dependencyNames.length?`、${dependencyNames.join('・')}の後に開始`:'';
  // Keep the receipt status at the start of the visible bar, clear of the link handle at its end.
  const receiptLeft=Math.max(2,Math.min(width-17,visibleStart-20));
  const connector=visible&&left+span<=width?`<button type="button" class="link-handle ${connectingSource===task.id?'is-connecting':''}" data-connect="${text(task.id)}" style="left:${visibleEnd-9}px" aria-label="${text(task.name)}から次の工程へ矢印を引く" title="次の工程へドラッグしてつなぐ"><span aria-hidden="true">＋</span></button>`:'';
  const group=task.group&&task.group!==previousGroup?`<div class="board-row group-row"><div class="task-label">${text(task.group)}</div><div class="timeline" style="width:${width}px">${lines}</div></div>`:'';
  previousGroup=task.group||'';
  return `${group}<div class="board-row" data-row="${text(task.id)}"><div class="task-label"><span class="row-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><span class="drag-handle" title="工程を並べ替え" aria-hidden="true">⠿</span><button type="button" class="task-name" data-edit="${text(task.id)}"><strong>${text(task.name)}</strong><small class="task-dates">${rangeLabel(task)}<span>${text(task.company||'')}</span></small></button><span class="status-badge ${task.complete===true?'is-done':task.complete===null?'is-unknown':''}">${status}</span><div class="move-buttons"><button type="button" data-up="${text(task.id)}" aria-label="${text(task.name)}を上へ" ${i===0?'disabled':''}>⌃</button><button type="button" data-down="${text(task.id)}" aria-label="${text(task.name)}を下へ" ${i===state.tasks.length-1?'disabled':''}>⌄</button></div></div><div class="timeline" style="width:${width}px">${lines}${visible?`<div class="bar ${task.complete===true?'done':''} ${monthScale&&task.days===1?'milestone':''}" role="button" tabindex="0" data-bar="${text(task.id)}" aria-label="${text(task.name)} ${task.start}から${task.days}日、${status}${dependencyLabel}${receiptLabel}。押して内容を確認" title="${text(task.name)}｜${task.start}〜${plus(task.start,task.days-1)}${dependencyLabel}${receiptLabel}" style="left:${visibleStart+(monthScale?0:3)}px;width:${Math.max(monthScale?task.days===1?12:4:1,visibleEnd-visibleStart-(monthScale?0:6))}px">${monthScale?'':task.complete===true?'✓ ':''}${monthScale?'':text(task.name)}</div>${receipt?`<span class="receipt-pin receipt-${receipt.kind}" aria-hidden="true" title="${text(receipt.label)}" style="left:${receiptLeft}px">${receipt.kind==='reviewed'?'✓':receipt.kind==='missing'?'!':receipt.kind==='attached'?'●':'?'}</span>`:''}`:''}${connector}</div></div>`;
 }).join('');
 if(!body)body=state.tasks.length?'<div class="empty-row"><strong>この条件・期間の工程はありません</strong><p>日付・絞り込みを変更してください。</p><button type="button" data-reset-view>全期間で見る</button></div>':'<div class="empty-row">まだ工程はありません。「＋ 工程を追加」から始めましょう。</div>';
 $('boardGrid').innerHTML=`<div class="board-row year-row"><div class="task-label date-label">工種・工程 / 担当</div><div style="width:${width}px;white-space:nowrap">${yearGroups.join('')}</div></div><div class="board-row month-row"><div class="task-label date-label">表示期間</div><div style="width:${width}px;white-space:nowrap">${monthGroups.join('')}</div></div><div class="board-row date-row"><div class="task-label date-label"><strong>工程名</strong></div><div class="timeline" style="height:42px;width:${width}px">${header}</div></div>${body}`;
 document.querySelectorAll('.board-row[data-row]').forEach(row=>{const handle=row.querySelector('.drag-handle');handle.draggable=editingMode&&window.innerWidth>780;handle.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',row.dataset.row);e.dataTransfer.effectAllowed='move'});row.addEventListener('dragover',e=>{e.preventDefault()});row.addEventListener('drop',e=>{e.preventDefault();let source=e.dataTransfer.getData('text/plain'),from=state.tasks.findIndex(t=>t.id===source),to=state.tasks.findIndex(t=>t.id===row.dataset.row);if(from<0||to<0||from===to)return;state.tasks.splice(to,0,state.tasks.splice(from,1)[0]);save();render()})});
 drawDependencyArrows();
}
function taskFor(id){return state.tasks.find(task=>task.id===id)}
function drawDependencyArrows(){
 const grid=$('boardGrid'),bars=new Map([...grid.querySelectorAll('[data-bar]')].map(bar=>[bar.dataset.bar,bar]));
 if(!state.tasks.some(task=>predecessors(task).some(id=>bars.has(task.id)&&bars.has(id))))return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),bounds=grid.getBoundingClientRect();
 svg.setAttribute('class','dependency-layer');svg.setAttribute('width',grid.scrollWidth);svg.setAttribute('height',grid.scrollHeight);
 const defs=document.createElementNS(ns,'defs');
 for(const kind of ['normal','conflict']){const marker=document.createElementNS(ns,'marker'),tip=document.createElementNS(ns,'path');marker.setAttribute('id',`dependency-${kind}`);marker.setAttribute('viewBox','0 0 8 8');marker.setAttribute('refX','7');marker.setAttribute('refY','4');marker.setAttribute('markerWidth','7');marker.setAttribute('markerHeight','7');marker.setAttribute('orient','auto');tip.setAttribute('d','M 1 1 L 7 4 L 1 7 Z');tip.setAttribute('fill',kind==='conflict'?'#aa653c':'#24764f');marker.append(tip);defs.append(marker)}svg.append(defs);
 for(const task of state.tasks)for(const id of predecessors(task)){const before=taskFor(id),source=bars.get(id),target=bars.get(task.id);if(!before||!source||!target)continue;
  const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),x1=a.right-bounds.left,y1=a.bottom-bounds.top-2,x2=b.left-bounds.left-3,y2=b.bottom-bounds.top-2;
  const conflict=task.start<=plus(before.start,before.days-1),path=document.createElementNS(ns,'path');
  path.setAttribute('d',`M ${x1} ${y1} H ${x1+6} V ${y2+9} H ${x2-8} V ${y2} H ${x2}`);path.setAttribute('class',conflict?'dependency-path is-conflict':'dependency-path');path.setAttribute('marker-end',`url(#dependency-${conflict?'conflict':'normal'})`);svg.append(path);
 }
 grid.append(svg);
}
let editingPredecessors=new Set(),connectingSource=null,linkGesture=null;
function renderDependencyEditor(){
 const selected=[...editingPredecessors].map(taskFor).filter(Boolean);
 $('selectedDependencies').innerHTML=selected.length?selected.map(task=>`<button type="button" data-remove-dependency="${text(task.id)}" aria-label="${text(task.name)}を前提工程から外す">${text(task.name)} <span aria-hidden="true">×</span></button>`).join(''):'<span>指定なし</span>';
 const query=$('dependencySearch').value.trim().toLocaleLowerCase(),matches=state.tasks.filter(task=>task.id!==editing&&`${task.name} ${task.company} ${task.group||''}`.toLocaleLowerCase().includes(query)),shown=matches.slice(0,30);
 $('dependencyOptions').innerHTML=shown.map(task=>{const blocked=!!editing&&hasDependencyCycle(state.tasks,editing,task.id)&&!editingPredecessors.has(task.id);return `<label class="dependency-choice"><input type="checkbox" data-predecessor="${text(task.id)}" ${editingPredecessors.has(task.id)?'checked':''} ${blocked?'disabled':''}><span><strong>${text(task.name)}</strong><small>${text(task.group||task.company||'担当未設定')}</small></span></label>`}).join('')+(matches.length>30?'<small class="dependency-more">候補を絞り込むには工程名を入力してください</small>':!matches.length?'<small class="dependency-more">一致する工程がありません</small>':'');
}
function openTask(id){
 if(editingMode){editTask(id);return}const task=taskFor(id);if(!task)return;detailTaskId=id;
 $('detailTitle').textContent=task.name;$('detailGroup').textContent=task.group||'';
 $('detailStart').textContent=task.start.replaceAll('-','/');$('detailEnd').textContent=plus(task.start,task.days-1).replaceAll('-','/');$('detailDays').textContent=`${task.days}日（暦日）`;
 $('detailCompany').textContent=task.company||'担当未設定';$('detailBefore').textContent=predecessors(task).map(taskFor).filter(Boolean).map(t=>t.name).join('、')||'指定なし';$('detailNote').textContent=task.note||'';$('taskDetail').showModal();
}
$('closeDetail').onclick=()=>$('taskDetail').close();
$('editFromDetail').onclick=()=>{const id=detailTaskId;$('taskDetail').close();if(taskFor(id))editTask(id)};
$('toggleEditing').onclick=()=>{editingMode=!editingMode;connectingSource=null;clearLinkGesture();document.body.classList.toggle('reading-mode',!editingMode);$('toggleEditing').setAttribute('aria-pressed',String(editingMode));$('toggleEditing').textContent=editingMode?'閲覧に戻る':'編集する';render()};
$('readerAll').onclick=()=>{state.scale='month';save();render();resetScroll()};
function editTask(id){editing=id||null;const task=taskFor(id)||{name:'',company:'',start:state.viewStart,days:1,complete:null};$('dialogTitle').textContent=id?'工程を編集':'工程を追加';const form=$('taskForm');for(const key of ['name','company','start','days'])form.elements.namedItem(key).value=task[key];editingPredecessors=new Set(predecessors(task));$('dependencySearch').value='';renderDependencyEditor();form.elements.namedItem('status').value=task.complete===true?'done':task.complete===false?'open':'unknown';$('deleteTask').hidden=!id;$('receiptSection').hidden=!id;$('taskDialog').showModal();if(id)renderReceiptPanel();form.elements.namedItem('name').focus()}
$('dependencySearch').oninput=renderDependencyEditor;
$('dependencyOptions').onchange=e=>{const id=e.target.dataset.predecessor;if(!id)return;if(e.target.checked)editingPredecessors.add(id);else editingPredecessors.delete(id);renderDependencyEditor()};
$('selectedDependencies').onclick=e=>{const button=e.target.closest('[data-remove-dependency]');if(!button)return;editingPredecessors.delete(button.dataset.removeDependency);renderDependencyEditor()};
$('addTask').onclick=()=>editTask(null);$('navAddTask').onclick=()=>{setView('schedule');editTask(null)};$('closeDialog').onclick=()=>$('taskDialog').close();
$('taskDialog').addEventListener('close',releaseReceiptURLs);
$('receiptRequired').onchange=e=>{const task=taskFor(editing);if(!task)return;task.receiptRequired=e.target.checked;task.receiptReviewed=false;save();render();renderReceiptPanel()};
$('receiptInput').onchange=async e=>{
 const file=e.target.files?.[0],projectId=activeId,taskId=editing;e.target.value='';if(!file||!taskId)return;
 if(!file.type.startsWith('image/')||file.size>8*1024*1024){announce('画像を8MB以内で選んでください');return}
 try{
  const photos=await receiptStore.list(projectId,taskId);
  if(photos.length>=5){announce('1工程につき写真は5枚までです');return}
  await receiptStore.add(projectId,taskId,file);
  const task=taskFor(taskId);if(projectId===activeId&&task){task.receiptReviewed=false;save();await renderReceiptPanel();announce('領収書の写真を保存しました')}
 }catch{announce('写真を保存できませんでした。端末の空き容量とブラウザの設定を確認してください')}
};
$('receiptReview').onclick=()=>{const task=taskFor(editing);if(!task||!receiptCounts.get(editing))return;task.receiptReviewed=!task.receiptReviewed;save();render();renderReceiptPanel()};
$('receiptList').onclick=async e=>{const button=e.target.closest('[data-receipt-id]');if(!button)return;const taskId=editing,projectId=activeId;try{await receiptStore.remove(button.dataset.receiptId);const task=taskFor(taskId);if(activeId===projectId&&task){task.receiptReviewed=false;save();await renderReceiptPanel();announce('写真を削除しました')}}catch{announce('写真を削除できませんでした')}};
$('homeAddTask').onclick=()=>$('projectDialog').showModal();
$('mobileHome').onclick=e=>{const star=e.target.closest('[data-favorite]');if(star){const id=star.dataset.favorite;if(favorites.has(id))favorites.delete(id);else favorites.add(id);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));render();return}const button=e.target.closest('[data-open-project]');if(!button)return;openProject(button.dataset.openProject).then(()=>{const task=button.dataset.openTask;if(task&&taskFor(task))openTask(task)})};
$('projectPicker').onchange=e=>openProject(e.target.value);
const PROFILE_KEY='snake_local_profile_v1';
let localProfile={};
try { const saved=JSON.parse(localStorage.getItem(PROFILE_KEY));if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const key of ['name','company','role','email','phone'])if(typeof saved[key]==='string')localProfile[key]=saved[key].slice(0,key==='email'?254:key==='phone'?40:80); } catch {}
function renderProfile(){
 $('profileDisplayName').textContent=localProfile.name||'名前が未登録です';
 $('profileInitial').textContent=Array.from(localProfile.name||'人')[0];
 $('profileAffiliation').textContent=[localProfile.company,localProfile.role].filter(Boolean).join(' / ')||'所属・役割を登録できます';
 for(const key of ['name','company','role','email','phone'])$('profile'+key[0].toUpperCase()+key.slice(1)+'Value').textContent=localProfile[key]||'未登録';
}
$('editProfile').onclick=()=>{for(const key of ['name','company','role','email','phone'])$('profileForm').elements.namedItem(key).value=localProfile[key]||'';$('profileDialog').showModal()};
$('cancelProfile').onclick=()=>$('profileDialog').close();
$('profileForm').onsubmit=e=>{e.preventDefault();const next={};for(const key of ['name','company','role','email','phone'])next[key]=e.target.elements.namedItem(key).value.trim();try{localStorage.setItem(PROFILE_KEY,JSON.stringify(next))}catch{announce('保存できませんでした。ブラウザの保存設定・空き容量を確認してください');return}localProfile=next;renderProfile();$('profileDialog').close();announce('プロフィールを保存しました')};
renderProfile();
function positionNavIndicator(){
 const nav=document.querySelector('.mobile-nav'),indicator=nav?.querySelector('.mobile-nav-indicator'),selected=nav?.querySelector('[data-view-button][aria-current="page"]');
 if(!nav||!indicator||!selected)return;
 requestAnimationFrame(()=>{
  const navBox=nav.getBoundingClientRect(),buttonBox=selected.getBoundingClientRect();
  indicator.style.setProperty('--nav-indicator-x',`${Math.round(buttonBox.left-navBox.left)}px`);
  indicator.style.setProperty('--nav-indicator-y',`${Math.round(buttonBox.top-navBox.top)}px`);
  indicator.style.setProperty('--nav-indicator-width',`${Math.round(buttonBox.width)}px`);
  indicator.style.setProperty('--nav-indicator-height',`${Math.round(buttonBox.height)}px`);
  requestAnimationFrame(()=>nav.dataset.indicatorReady='true');
 });
}
function setView(view){document.body.dataset.view=view;$('profileScreen').hidden=view!=='profile';if(view==='profile')renderProfile();if(view==='settings')$('projectSettings').open=true;document.querySelectorAll('[data-view-button]').forEach(button=>{if(button.dataset.viewButton===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});positionNavIndicator()}
document.querySelectorAll('[data-view-button]').forEach(button=>button.onclick=()=>{setView(button.dataset.viewButton);if(button.dataset.viewButton==='home'){try{screen.orientation?.unlock?.()}catch{}if(document.fullscreenElement)document.exitFullscreen().catch(()=>{})}});
async function openProject(id){
 const project=projects.find(item=>item.id===id);if(!project)return;
 const url=new URL(location.href);if(url.searchParams.has('project')){url.searchParams.delete('project');history.replaceState(null,'',url)}
 Object.keys(scheduleFilters).forEach(key=>scheduleFilters[key]='');$('filterQuery').value='';activeId=id;state=project.schedule;connectingSource=null;receiptCounts=new Map();save();render();loadReceiptCounts();setView('schedule');
 resetScroll();
}
$('closeProjectDialog').onclick=()=>$('projectDialog').close();
$('projectForm').onsubmit=e=>{
 e.preventDefault();const name=$('newProjectName').value.trim();if(!name)return;
 if(projects.length>=50){announce('登録できる工程表は50件までです');return}
 const id=newId();const schedule={name,viewStart:startOfWeek(todayISO()),days:14,tasks:[]};
 projects.push({id,schedule});activeId=id;state=schedule;$('projectDialog').close();e.target.reset();save();render();setView('schedule');announce('工程表を作成しました');
};
setView('schedule');
$('taskForm').onsubmit=e=>{e.preventDefault();const f=e.target,days=Number(f.elements.namedItem('days').value),start=f.elements.namedItem('start').value,name=f.elements.namedItem('name').value.trim(),company=f.elements.namedItem('company').value.trim(),predecessorIds=[...editingPredecessors],status=f.elements.namedItem('status').value,complete=status==='done'?true:status==='open'?false:null;if(!name||!validDate(start)||!Number.isInteger(days)||days<1||days>365){announce('工程名、開始日、所要日数を確認してください');return}if(predecessorIds.some(id=>!taskFor(id)||editing&&hasDependencyCycle(state.tasks,editing,id))){announce('前提工程を確認してください。循環する指定はできません');return}let current=taskFor(editing);if(current){Object.assign(current,{name,company,start,days,complete,predecessorIds});delete current.predecessorId}else state.tasks.push({id:newId(),name,company,start,days,complete,predecessorIds});$('taskDialog').close();save();render();announce('工程を反映しました')};
$('deleteTask').onclick=async()=>{const task=taskFor(editing);if(!task||!confirm(`「${task.name}」を削除しますか？`))return;try{await receiptStore.removeTask(activeId,task.id)}catch{announce('写真を削除できないため、工程を削除できませんでした');return}state.tasks=state.tasks.filter(item=>item.id!==editing);for(const item of state.tasks){item.predecessorIds=predecessors(item).filter(id=>id!==editing);delete item.predecessorId}$('taskDialog').close();save();render()};
$('projectName').onchange=e=>{state.name=e.target.value.trim()||'名称未設定の工程表';save();render()};
$('viewStart').onchange=e=>{if(!validDate(e.target.value)){announce('表示開始日を確認してください');return}state.viewStart=e.target.value;state.scale='day';save();render()};
document.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{state.days=+button.dataset.days;state.scale='day';save();render();resetScroll()});
$('allPeriod').onclick=()=>{state.scale='month';save();render();resetScroll()};
$('prev').onclick=()=>{state.viewStart=plus(state.viewStart,-state.days);save();render()};$('next').onclick=()=>{state.viewStart=plus(state.viewStart,state.days);save();render()};$('today').onclick=()=>{state.viewStart=startOfWeek(todayISO());state.scale='day';save();render();resetScroll()};
$('boardGrid').onclick=e=>{if(dragging){dragging=false;return}if(e.target.closest('[data-connect]'))return;if(e.target.closest('[data-reset-view]')){resetScheduleView();return}const button=e.target.closest('[data-edit],[data-up],[data-down],[data-bar]');if(!button)return;let id=button.dataset.edit||button.dataset.up||button.dataset.down||button.dataset.bar;if(connectingSource){connectTasks(connectingSource,id);return}if(button.dataset.up||button.dataset.down){const from=state.tasks.findIndex(t=>t.id===id),to=from+(button.dataset.up?-1:1);if(to<0||to>=state.tasks.length)return;[state.tasks[from],state.tasks[to]]=[state.tasks[to],state.tasks[from]];save();render()}else openTask(id)};
$('boardGrid').onkeydown=e=>{const bar=e.target.closest('[data-bar]');if(bar&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openTask(bar.dataset.bar)}};
function connectTasks(sourceId,targetId){
 const source=taskFor(sourceId),target=taskFor(targetId);
 if(!source||!target){connectingSource=null;return}
 if(sourceId===targetId){announce('別の工程を選んでください');return}
 if(predecessors(target).includes(sourceId)){connectingSource=null;render();announce('この矢印はすでにあります。解除は工程の「前提工程」からできます');return}
 if(hasDependencyCycle(state.tasks,targetId,sourceId)){announce('工程が循環するため接続できません');return}
 target.predecessorIds=[...predecessors(target),sourceId];delete target.predecessorId;connectingSource=null;save();render();announce(`${source.name} → ${target.name} をつなぎました`);
}
function clearLinkGesture(){
 if(!linkGesture)return;linkGesture.preview.remove();linkGesture.highlight?.classList.remove('link-target');linkGesture=null;
}
$('boardGrid').addEventListener('pointerdown',e=>{
 const handle=e.target.closest('[data-connect]');if(!editingMode||!handle)return;
 e.preventDefault();clearLinkGesture();const grid=$('boardGrid'),gridRect=grid.getBoundingClientRect(),rect=handle.getBoundingClientRect(),ns='http://www.w3.org/2000/svg',preview=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 preview.setAttribute('class','link-preview-layer');preview.setAttribute('width',grid.scrollWidth);preview.setAttribute('height',grid.scrollHeight);path.setAttribute('class','link-preview-path');preview.append(path);grid.append(preview);
 linkGesture={id:handle.dataset.connect,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:rect.left+rect.width/2-gridRect.left,y:rect.top+rect.height/2-gridRect.top,preview,path,moved:false,highlight:null};
 handle.setPointerCapture(e.pointerId);
});
$('boardGrid').addEventListener('pointermove',e=>{
 const link=linkGesture;if(!link||link.pointerId!==e.pointerId)return;
 if(Math.hypot(e.clientX-link.startX,e.clientY-link.startY)>8)link.moved=true;
 if(!link.moved)return;
 const bounds=$('boardGrid').getBoundingClientRect();link.path.setAttribute('d',`M ${link.x} ${link.y} L ${e.clientX-bounds.left} ${e.clientY-bounds.top}`);
 const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-row]');link.highlight?.classList.remove('link-target');link.highlight=row?.dataset.row!==link.id?row:null;link.highlight?.classList.add('link-target');
});
$('boardGrid').addEventListener('pointerup',e=>{
 const link=linkGesture;if(!link||link.pointerId!==e.pointerId)return;
 const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-row]'),targetId=row?.dataset.row,sourceId=link.id,moved=link.moved;clearLinkGesture();
 if(moved&&targetId&&targetId!==sourceId){dragging=true;connectTasks(sourceId,targetId);setTimeout(()=>dragging=false,50)}
 else if(!moved){connectingSource=connectingSource===sourceId?null:sourceId;render();announce(connectingSource?'次の工程の棒か工程名をタップしてください':'接続を中止しました')}
 else announce('接続先の工程の上で指を離してください');
});
$('boardGrid').addEventListener('pointercancel',e=>{if(linkGesture?.pointerId===e.pointerId)clearLinkGesture()});
let pointer=null;$('boardGrid').addEventListener('pointerdown',e=>{const bar=e.target.closest('[data-bar]');if(!editingMode||!bar||e.target.closest('[data-connect]')||connectingSource||state.scale==='month')return;pointer={id:bar.dataset.bar,startX:e.clientX,startY:e.clientY,original:taskFor(bar.dataset.bar).start,moved:false,element:bar,unit:WIDTH()};bar.setPointerCapture(e.pointerId)});
$('boardGrid').addEventListener('pointermove',e=>{if(!pointer)return;const dx=e.clientX-pointer.startX,dy=e.clientY-pointer.startY;if(!pointer.moved&&Math.abs(dy)>Math.abs(dx))return;if(!pointer.moved&&Math.abs(dx)>8)pointer.moved=true;if(!pointer.moved)return;const delta=Math.round(dx/pointer.unit);pointer.element.classList.add('dragging');pointer.element.style.transform=`translateX(${delta*pointer.unit}px)`});
function endDrag(e){if(!pointer)return;const current=pointer;pointer=null;current.element.classList.remove('dragging');current.element.style.transform='';if(!current.moved)return;dragging=true;const delta=Math.round((e.clientX-current.startX)/current.unit);if(delta){taskFor(current.id).start=plus(current.original,delta);save();render();announce(`${taskFor(current.id).name}の開始日を${short(taskFor(current.id).start)}に変更しました`)}setTimeout(()=>dragging=false,50)}
$('boardGrid').addEventListener('pointerup',endDrag);$('boardGrid').addEventListener('pointercancel',()=>{if(!pointer)return;pointer.element.classList.remove('dragging');pointer.element.style.transform='';pointer=null});
$('print').onclick=()=>window.print();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`工程表-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};
$('import').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>300000)throw Error('ファイルが大きすぎます');const imported=clean(JSON.parse(await file.text()));if(!confirm(`「${imported.name}」を読み込みますか？現在の工程表はこの端末から置き換わります。写真はJSONから復元されません。`))return;state=imported;save();render();loadReceiptCounts();announce('工程表を読み込みました')}catch(error){announce(error.message)}finally{e.target.value=''}};
$('newProject').onclick=()=>$('projectDialog').showModal();
function resetScroll(){$('boardScroll').scrollTop=0;$('boardScroll').scrollLeft=0}
function resetScheduleView(){Object.keys(scheduleFilters).forEach(key=>scheduleFilters[key]='');$('filterQuery').value='';state.scale='month';save();render();resetScroll()}
$('jumpDate').onchange=e=>{if(!validDate(e.target.value))return;state.viewStart=e.target.value;state.scale='day';save();render();resetScroll()};
$('periodOnly').onchange=e=>{periodOnly=e.target.checked;render();resetScroll()};
$('showTimeline').onclick=()=>{listView=false;render()};$('showList').onclick=()=>{listView=true;render()};
$('scheduleList').onclick=e=>{if(e.target.closest('[data-reset-view]')){resetScheduleView();return}const button=e.target.closest('[data-open-detail]');if(button)openTask(button.dataset.openDetail)};
$('focusTask').onclick=()=>{const task=taskFor(detailTaskId);if(!task)return;$('taskDetail').close();state.scale='day';state.viewStart=task.start;state.days=task.days>14?28:14;save();render();resetScroll();const row=[...document.querySelectorAll('[data-row],[data-open-detail]')].find(el=>(listView?el.dataset.openDetail:el.dataset.row)===task.id);row?.scrollIntoView({block:'nearest',behavior:'smooth'})};
let previousOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';
window.addEventListener('resize',()=>{const nextOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';if(nextOrientation!==previousOrientation){previousOrientation=nextOrientation;if(nextOrientation==='landscape')setView('schedule')}render();positionNavIndicator()});render();loadReceiptCounts();
