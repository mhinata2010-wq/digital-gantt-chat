const $ = id => document.getElementById(id);
const KEY = 'snake_schedule_only_v1';
const PROJECTS_KEY = 'snake_schedule_projects_v2';
const SATO_ID = 'sato-master-2021';
const compactLandscape = () => window.matchMedia('(max-width: 900px) and (orientation: landscape) and (max-height: 650px)').matches;
const portraitPhone = () => window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
const LABEL_WIDTH = () => compactLandscape() ? 175 : window.innerWidth <= 780 ? 183 : 310;
const WIDTH = () => state.scale === 'month' ? (compactLandscape()?1.65:window.innerWidth<=780?1.8:2.15) : compactLandscape() ? Math.max(26,Math.min(48,Math.floor((window.innerWidth-62-LABEL_WIDTH()-8)/state.days))) : window.innerWidth <= 780 ? 38 : Math.max(48,Math.min(80,Math.floor((window.innerWidth > 900 ? $('boardScroll').clientWidth-LABEL_WIDTH()-2 : 48*state.days)/state.days)));
const todayISO = () => {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const weekdays = ['日','月','火','水','木','金','土'];
let state, projects, activeId, editing = null, dragging = false;
const FAVORITES_KEY = 'snake_schedule_favorites_v1';
let favorites = new Set();
try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY)); if (Array.isArray(saved)) favorites = new Set(saved.filter(id => typeof id === 'string')); } catch {}

function dayDate(value){return new Date(`${value}T12:00:00Z`)}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayDate(value).valueOf()) && dayDate(value).toISOString().slice(0,10)===value}
function plus(value,amount){let date=dayDate(value);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
function distance(a,b){return Math.round((dayDate(a)-dayDate(b))/86400000)}
function short(value){return `${+value.slice(5,7)}/${+value.slice(8)}`}
function startOfWeek(value){const d=dayDate(value);return plus(value,-((d.getUTCDay()+6)%7))}
function newId(){return crypto.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(16).slice(2)}`}
function text(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function example(){const monday=startOfWeek(todayISO());return {name:'サンプル工事',viewStart:monday,days:14,tasks:[
 {id:newId(),name:'土木工事',company:'土木業者',start:monday,days:4,complete:true},
 {id:newId(),name:'基礎工事',company:'基礎業者',start:plus(monday,4),days:3,complete:false},
 {id:newId(),name:'躯体工事',company:'大工・建方業者',start:plus(monday,7),days:7,complete:false},
 {id:newId(),name:'電気配線',company:'電気業者',start:plus(monday,10),days:4,complete:false},
 {id:newId(),name:'内装工事',company:'内装業者',start:plus(monday,14),days:5,complete:false}
]}}
function clean(input){if(!input || typeof input!=='object' || !Array.isArray(input.tasks) || input.tasks.length>200 || typeof input.name!=='string' || input.name.length>80 || !validDate(input.viewStart) || ![14,28].includes(input.days))throw Error('工程表データを読み取れませんでした');return {name:input.name,viewStart:input.viewStart,days:input.days,scale:input.scale==='month'?'month':'day',source:typeof input.source==='string'?input.source.slice(0,250):'',tasks:input.tasks.map(task=>{if(!task || typeof task.name!=='string' || !task.name.trim() || task.name.length>80 || typeof task.company!=='string' || task.company.length>80 || !validDate(task.start) || !Number.isInteger(task.days) || task.days<1 || task.days>365)throw Error('工程の内容を確認してください');return {id:typeof task.id==='string'?task.id:newId(),name:task.name,company:task.company,group:typeof task.group==='string'?task.group.slice(0,60):'',note:typeof task.note==='string'?task.note.slice(0,100):'',start:task.start,days:task.days,complete:task.complete===null?null:task.complete===true}})}}
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
function render(){const monthScale=state.scale==='month',today=todayISO(),starts=state.tasks.map(task=>task.start),ends=state.tasks.map(task=>plus(task.start,task.days-1)),minDate=starts.length?starts.sort()[0]:state.viewStart,maxDate=ends.length?ends.sort().at(-1):plus(state.viewStart,27),first=monthScale?`${minDate.slice(0,7)}-01`:state.viewStart,last=monthScale?plus(`${maxDate.slice(0,7)}-01`,new Date(Date.UTC(+maxDate.slice(0,4),+maxDate.slice(5,7),0)).getUTCDate()-1):plus(first,state.days-1),days=distance(last,first)+1,w=WIDTH(),width=days*w,dates=Array.from({length:days},(_,i)=>plus(first,i));
 document.body.classList.toggle('month-scale',monthScale);
 $('projectName').value=state.name;$('displayName').textContent=state.name||'名称未設定の工程表';$('viewStart').value=state.viewStart;$('periodLabel').textContent=monthScale?`${first.slice(0,4)}/${+first.slice(5,7)} – ${last.slice(0,4)}/${+last.slice(5,7)}`:`${short(first)} – ${short(last)}`;$('todayLabel').textContent=state.tasks.length?`${state.tasks.length}工程 · ${monthScale?'全期間を月単位で表示':'暦日で表示'}`:'工程を追加してください';$('projectMeta').textContent=state.source?'佐藤さんの総合工程表を再構成した試作です。':'工程を追加して、予定を組みましょう。';$('openSato').hidden=activeId===SATO_ID||!projects.some(project=>project.id===SATO_ID);document.querySelectorAll('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(!monthScale&&+button.dataset.days===state.days)));$('allPeriod').setAttribute('aria-pressed',String(monthScale));$('sourceNote').hidden=!state.source;$('sourceNote').textContent=state.source||'';$('boardInstruction').textContent=monthScale?'工程名または線を押すと内容を確認・編集できます。':'線を左右に動かすと開始日を変更できます。';
 $('homeProjectName').textContent=state.name||'名称未設定の工程表';$('homePeriod').textContent=monthScale?`${first.slice(0,7)} – ${last.slice(0,7)} の予定を見る`:`${short(first)} – ${short(last)} の予定を見る`;$('boardProjectName').textContent=state.name;$('sheetProjectName').textContent=state.name||'名称未設定の工程表';$('sheetRange').textContent=`${first} 〜 ${last} / ${state.tasks.length}工程`;document.documentElement.style.setProperty('--sheet-print-scale',String(Math.min(1.2,1040/(LABEL_WIDTH()+width))));$('projectPicker').innerHTML=projects.map(project=>`<option value="${text(project.id)}">${text(project.schedule.name)}</option>`).join('');$('projectPicker').value=activeId;
 $('homeTasks').innerHTML=projects.map(project=>`<div class="project-tile"><button type="button" class="project-open" data-open-project="${text(project.id)}" aria-label="${text(project.schedule.name||'名称未設定の工程表')}の工程表を開く"><span class="project-tile-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="project-tile-copy"><strong>${text(project.schedule.name||'名称未設定の工程表')}</strong><small>${project.schedule.tasks.length}工程 · ${short(project.schedule.viewStart)}から</small></span></button><button type="button" class="favorite-button ${favorites.has(project.id)?'is-favorite':''}" data-favorite="${text(project.id)}" aria-pressed="${favorites.has(project.id)}" aria-label="${text(project.schedule.name||'名称未設定の工程表')}を${favorites.has(project.id)?'お気に入りから外す':'お気に入りに追加'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/></svg></button></div>`).join('');
 const yearGroups=[];for(let i=0;i<days;){let j=i+1;while(j<days&&dates[i].slice(0,4)===dates[j].slice(0,4))j++;yearGroups.push(`<span class="year-span" style="width:${(j-i)*w}px">${dates[i].slice(0,4)}年</span>`);i=j}
 const monthGroups=[];for(let i=0;i<days;){let j=i+1;while(j<days&&dates[i].slice(0,7)===dates[j].slice(0,7))j++;monthGroups.push(`<span class="month-span" style="width:${(j-i)*w}px">${+dates[i].slice(5,7)}月</span>`);i=j}
 const lines=monthScale?dates.filter(date=>date.slice(8)==='01').map(date=>`<span class="day-cell month-start ${[1,4,7,10].includes(+date.slice(5,7))?'quarter-start':''}" style="left:${distance(date,first)*w}px;width:1px" aria-label="${date.slice(0,7)}"></span>`).join(''):dates.map((date,i)=>`<span class="day-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${dayDate(date).getUTCDay()===1?'week-start':''} ${date.slice(8)==='01'?'month-start':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" aria-label="${date}"></span>`).join('');
 const header=monthScale?'':dates.map((date,i)=>`<span class="date-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" title="${date}">${+date.slice(8)}<span class="weekday">${weekdays[dayDate(date).getUTCDay()]}</span></span>`).join('');
 let previousGroup='',body=state.tasks.map((task,i)=>{
  const left=distance(task.start,first)*w,span=task.days*w,visibleStart=Math.max(0,left),visibleEnd=Math.min(width,left+span),visible=visibleEnd>visibleStart,status=task.complete===true?'完了':task.complete===false?'未完了':'実績未確認';
  const group=monthScale&&task.group&&task.group!==previousGroup?`<div class="board-row group-row"><div class="task-label">${text(task.group)}</div><div class="timeline" style="width:${width}px">${lines}</div></div>`:'';
  previousGroup=task.group||'';
  return `${group}<div class="board-row" data-row="${text(task.id)}"><div class="task-label"><span class="row-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><span class="drag-handle" title="工程を並べ替え" aria-hidden="true">⠿</span><button type="button" class="task-name" data-edit="${text(task.id)}"><strong>${text(task.name)}</strong><small>${text(task.company||'担当未設定')} · ${short(task.start)}から${task.days}日</small></button><span class="status-badge ${task.complete===true?'is-done':task.complete===null?'is-unknown':''}">${status}</span><div class="move-buttons"><button type="button" data-up="${text(task.id)}" aria-label="${text(task.name)}を上へ" ${i===0?'disabled':''}>⌃</button><button type="button" data-down="${text(task.id)}" aria-label="${text(task.name)}を下へ" ${i===state.tasks.length-1?'disabled':''}>⌄</button></div></div><div class="timeline" style="width:${width}px">${lines}${visible?`<div class="bar ${task.complete===true?'done':''} ${monthScale&&task.days===1?'milestone':''}" role="button" tabindex="0" data-bar="${text(task.id)}" aria-label="${text(task.name)} ${task.start}から${task.days}日、${status}。クリックして編集" title="${text(task.name)}｜${task.start}〜${plus(task.start,task.days-1)}｜${text(task.note||'')}" style="left:${visibleStart+(monthScale?0:3)}px;width:${Math.max(monthScale?task.days===1?12:4:1,visibleEnd-visibleStart-(monthScale?0:6))}px">${monthScale?'':task.complete===true?'✓ ':''}${monthScale?'':text(task.name)}</div>`:''}</div></div>`;
 }).join('');
 if(!body)body='<div class="empty-row">まだ工程はありません。「＋ 工程を追加」から始めましょう。</div>';
 $('boardGrid').innerHTML=`<div class="board-row year-row"><div class="task-label date-label">工種・工程 / 担当</div><div style="width:${width}px;white-space:nowrap">${yearGroups.join('')}</div></div><div class="board-row month-row"><div class="task-label date-label">表示期間</div><div style="width:${width}px;white-space:nowrap">${monthGroups.join('')}</div></div><div class="board-row date-row"><div class="task-label date-label"><strong>工程名</strong></div><div class="timeline" style="height:42px;width:${width}px">${header}</div></div>${body}`;
 document.querySelectorAll('.board-row[data-row]').forEach(row=>{const handle=row.querySelector('.drag-handle');handle.draggable=window.innerWidth>780;handle.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',row.dataset.row);e.dataTransfer.effectAllowed='move'});row.addEventListener('dragover',e=>{e.preventDefault()});row.addEventListener('drop',e=>{e.preventDefault();let source=e.dataTransfer.getData('text/plain'),from=state.tasks.findIndex(t=>t.id===source),to=state.tasks.findIndex(t=>t.id===row.dataset.row);if(from<0||to<0||from===to)return;state.tasks.splice(to,0,state.tasks.splice(from,1)[0]);save();render()})});
}
function taskFor(id){return state.tasks.find(task=>task.id===id)}
function editTask(id){editing=id||null;const task=taskFor(id)||{name:'',company:'',start:state.viewStart,days:1,complete:null};$('dialogTitle').textContent=id?'工程を編集':'工程を追加';const form=$('taskForm');for(const key of ['name','company','start','days'])form.elements.namedItem(key).value=task[key];form.elements.namedItem('status').value=task.complete===true?'done':task.complete===false?'open':'unknown';$('deleteTask').hidden=!id;$('taskDialog').showModal();form.elements.namedItem('name').focus()}
$('addTask').onclick=()=>editTask(null);$('closeDialog').onclick=()=>$('taskDialog').close();
$('homeAddTask').onclick=()=>$('projectDialog').showModal();
$('homeTasks').onclick=e=>{const star=e.target.closest('[data-favorite]');if(star){const id=star.dataset.favorite;if(favorites.has(id))favorites.delete(id);else favorites.add(id);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));render();return}const button=e.target.closest('[data-open-project]');if(button)openProject(button.dataset.openProject)};
$('projectPicker').onchange=e=>openProject(e.target.value);
function setView(view){document.body.dataset.view=view;document.querySelectorAll('[data-view-button]').forEach(button=>{if(button.dataset.viewButton===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})}
document.querySelectorAll('[data-view-button]').forEach(button=>button.onclick=()=>{setView(button.dataset.viewButton);if(button.dataset.viewButton==='home'){try{screen.orientation?.unlock?.()}catch{}if(document.fullscreenElement)document.exitFullscreen().catch(()=>{})}});
$('openSchedule').onclick=()=>openProject(activeId);
async function openProject(id){
 const project=projects.find(item=>item.id===id);if(!project)return;
 const url=new URL(location.href);if(url.searchParams.has('project')){url.searchParams.delete('project');history.replaceState(null,'',url)}
 activeId=id;state=project.schedule;save();render();setView('schedule');
 if(!portraitPhone())return;
 try{
  if(!screen.orientation?.lock)throw Error('orientation unsupported');
  if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
  await screen.orientation.lock('landscape');
 }catch{
  if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
  announce('工程表を開きました。端末を横向きにすると広く見られます');
 }
}
$('closeProjectDialog').onclick=()=>$('projectDialog').close();
$('projectForm').onsubmit=e=>{
 e.preventDefault();const name=$('newProjectName').value.trim();if(!name)return;
 if(projects.length>=50){announce('登録できる工程表は50件までです');return}
 const id=newId();const schedule={name,viewStart:startOfWeek(todayISO()),days:14,tasks:[]};
 projects.push({id,schedule});activeId=id;state=schedule;$('projectDialog').close();e.target.reset();save();render();setView('schedule');announce('工程表を作成しました');
};
setView(portraitPhone()?'home':'schedule');
$('taskForm').onsubmit=e=>{e.preventDefault();const f=e.target,days=Number(f.elements.namedItem('days').value),start=f.elements.namedItem('start').value,name=f.elements.namedItem('name').value.trim(),company=f.elements.namedItem('company').value.trim(),status=f.elements.namedItem('status').value,complete=status==='done'?true:status==='open'?false:null;if(!name||!validDate(start)||!Number.isInteger(days)||days<1||days>365){announce('工程名、開始日、所要日数を確認してください');return}let current=taskFor(editing);if(current)Object.assign(current,{name,company,start,days,complete});else state.tasks.push({id:newId(),name,company,start,days,complete});$('taskDialog').close();save();render();announce('工程を反映しました')};
$('deleteTask').onclick=()=>{const task=taskFor(editing);if(!task||!confirm(`「${task.name}」を削除しますか？`))return;state.tasks=state.tasks.filter(item=>item.id!==editing);$('taskDialog').close();save();render()};
$('projectName').onchange=e=>{state.name=e.target.value.trim()||'名称未設定の工程表';save();render()};
$('viewStart').onchange=e=>{if(!validDate(e.target.value)){announce('表示開始日を確認してください');return}state.viewStart=e.target.value;state.scale='day';save();render()};
document.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{state.days=+button.dataset.days;state.scale='day';save();render()});
$('allPeriod').onclick=()=>{state.scale='month';save();render()};
$('prev').onclick=()=>{state.viewStart=plus(state.viewStart,-state.days);save();render()};$('next').onclick=()=>{state.viewStart=plus(state.viewStart,state.days);save();render()};$('today').onclick=()=>{state.viewStart=startOfWeek(todayISO());save();render()};
$('boardGrid').onclick=e=>{if(dragging){dragging=false;return}const button=e.target.closest('[data-edit],[data-up],[data-down],[data-bar]');if(!button)return;let id=button.dataset.edit||button.dataset.up||button.dataset.down||button.dataset.bar;if(button.dataset.up||button.dataset.down){const from=state.tasks.findIndex(t=>t.id===id),to=from+(button.dataset.up?-1:1);if(to<0||to>=state.tasks.length)return;[state.tasks[from],state.tasks[to]]=[state.tasks[to],state.tasks[from]];save();render()}else editTask(id)};
$('boardGrid').onkeydown=e=>{const bar=e.target.closest('[data-bar]');if(bar&&(e.key==='Enter'||e.key===' ')){e.preventDefault();editTask(bar.dataset.bar)}};
let pointer=null;$('boardGrid').addEventListener('pointerdown',e=>{const bar=e.target.closest('[data-bar]');if(!bar||state.scale==='month')return;pointer={id:bar.dataset.bar,startX:e.clientX,original:taskFor(bar.dataset.bar).start,moved:false,element:bar,unit:WIDTH()};bar.setPointerCapture(e.pointerId)});
$('boardGrid').addEventListener('pointermove',e=>{if(!pointer)return;const delta=Math.round((e.clientX-pointer.startX)/pointer.unit);if(Math.abs(e.clientX-pointer.startX)>6)pointer.moved=true;if(!pointer.moved)return;pointer.element.classList.add('dragging');pointer.element.style.transform=`translateX(${delta*pointer.unit}px)`});
function endDrag(e){if(!pointer)return;const current=pointer;pointer=null;current.element.classList.remove('dragging');current.element.style.transform='';if(!current.moved)return;dragging=true;const delta=Math.round((e.clientX-current.startX)/current.unit);if(delta){taskFor(current.id).start=plus(current.original,delta);save();render();announce(`${taskFor(current.id).name}の開始日を${short(taskFor(current.id).start)}に変更しました`)}setTimeout(()=>dragging=false,50)}
$('boardGrid').addEventListener('pointerup',endDrag);$('boardGrid').addEventListener('pointercancel',endDrag);
$('print').onclick=()=>window.print();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`工程表-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};
$('import').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>300000)throw Error('ファイルが大きすぎます');const imported=clean(JSON.parse(await file.text()));if(!confirm(`「${imported.name}」を読み込みますか？現在の工程表はこの端末から置き換わります。`))return;state=imported;save();render();announce('工程表を読み込みました')}catch(error){announce(error.message)}finally{e.target.value=''}};
$('newProject').onclick=()=>$('projectDialog').showModal();
let previousOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';
window.addEventListener('resize',()=>{const nextOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';if(nextOrientation!==previousOrientation){previousOrientation=nextOrientation;if(nextOrientation==='landscape')setView('schedule')}render()});render();
