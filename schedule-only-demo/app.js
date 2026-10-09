const $ = id => document.getElementById(id);
const KEY = 'snake_schedule_only_v1';
const compactLandscape = () => window.matchMedia('(max-width: 900px) and (orientation: landscape) and (max-height: 650px)').matches;
const portraitPhone = () => window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
const WIDTH = () => compactLandscape() ? Math.max(26,Math.min(38,Math.floor((window.innerWidth-224)/state.days))) : window.innerWidth <= 780 ? 38 : 48;
const todayISO = () => {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const weekdays = ['日','月','火','水','木','金','土'];
let state, editing = null, dragging = false;

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
function clean(input){if(!input || typeof input!=='object' || !Array.isArray(input.tasks) || input.tasks.length>200 || typeof input.name!=='string' || input.name.length>80 || !validDate(input.viewStart) || ![14,28].includes(input.days))throw Error('工程表データを読み取れませんでした');return {name:input.name,viewStart:input.viewStart,days:input.days,tasks:input.tasks.map(task=>{if(!task || typeof task.name!=='string' || !task.name.trim() || task.name.length>80 || typeof task.company!=='string' || task.company.length>80 || !validDate(task.start) || !Number.isInteger(task.days) || task.days<1 || task.days>365)throw Error('工程の内容を確認してください');return {id:typeof task.id==='string'?task.id:newId(),name:task.name,company:task.company,start:task.start,days:task.days,complete:task.complete===true}})}}
try{state=clean(JSON.parse(localStorage.getItem(KEY)))}catch{state=example()}
let saveTimer;
function save(){localStorage.setItem(KEY,JSON.stringify(state));$('saveState').textContent='この端末に保存しました';clearTimeout(saveTimer);saveTimer=setTimeout(()=>$('saveState').textContent='この端末に保存しました',2000)}
function announce(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3200)}
function render(){const first=state.viewStart,days=state.days,w=WIDTH(),width=days*w,dates=Array.from({length:days},(_,i)=>plus(first,i)),last=dates.at(-1),today=todayISO();
 $('projectName').value=state.name;$('displayName').textContent=state.name||'名称未設定の工程表';$('viewStart').value=state.viewStart;$('periodLabel').textContent=`${short(first)} – ${short(last)}`;$('todayLabel').textContent=state.tasks.length?`${state.tasks.length}工程 · 暦日で表示`:'工程を追加してください';$('projectMeta').textContent='工程を追加して、予定を組みましょう。';document.querySelectorAll('[data-days]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.days===days)));
 $('homeProjectName').textContent=state.name||'名称未設定の工程表';$('homePeriod').innerHTML=`${short(first)} – ${short(last)} <b aria-hidden="true">↗</b>`;$('boardProjectName').textContent=state.name;
 $('homeTasks').innerHTML=state.tasks.length?state.tasks.map(task=>`<button type="button" class="home-task ${task.complete?'complete':''}" data-home-edit="${text(task.id)}"><span><strong>${text(task.name)}</strong><small>${text(task.company||'担当未設定')} · ${short(task.start)}から${task.days}日</small></span><em>${task.complete?'✓ 完了':'未完了'}</em></button>`).join(''):'<p class="home-empty">工程がありません。右上の「＋ 追加」から登録してください。</p>';
 const monthGroups=[];for(let i=0;i<days;){let j=i+1;while(j<days&&dates[i].slice(0,7)===dates[j].slice(0,7))j++;monthGroups.push(`<span class="month-span" style="width:${(j-i)*w}px">${+dates[i].slice(5,7)}月　${dates[i].slice(0,4)}</span>`);i=j}
 const lines=dates.map((date,i)=>`<span class="day-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" aria-label="${date}"></span>`).join('');
 const header=dates.map((date,i)=>`<span class="date-cell ${[0,6].includes(dayDate(date).getUTCDay())?'off':''} ${date===today?'today':''}" style="left:${i*w}px;width:${w}px" title="${date}">${+date.slice(8)}<span class="weekday">${weekdays[dayDate(date).getUTCDay()]}</span></span>`).join('');
 let body=state.tasks.map((task,i)=>{let left=distance(task.start,first)*w,span=task.days*w,visibleStart=Math.max(0,left),visibleEnd=Math.min(width,left+span),visible=visibleEnd>visibleStart;return `<div class="board-row" data-row="${text(task.id)}"><div class="task-label"><span class="drag-handle" title="工程を並べ替え" aria-hidden="true">⠿</span><button type="button" class="task-name" data-edit="${text(task.id)}"><strong>${text(task.name)}</strong><small>${text(task.company||'担当未設定')} · ${short(task.start)}から${task.days}日</small></button><div class="move-buttons"><button type="button" data-up="${text(task.id)}" aria-label="${text(task.name)}を上へ" ${i===0?'disabled':''}>⌃</button><button type="button" data-down="${text(task.id)}" aria-label="${text(task.name)}を下へ" ${i===state.tasks.length-1?'disabled':''}>⌄</button></div></div><div class="timeline" style="width:${width}px">${lines}${visible?`<div class="bar ${task.complete?'done':''}" role="button" tabindex="0" data-bar="${text(task.id)}" aria-label="${text(task.name)} ${short(task.start)}から${task.days}日、${task.complete?'完了':'未完了'}。クリックして編集" style="left:${visibleStart+3}px;width:${Math.max(1,visibleEnd-visibleStart-6)}px">${task.complete?'✓ ':''}${text(task.name)}</div>`:''}</div></div>`}).join('');
 if(!body)body='<div class="empty-row">まだ工程はありません。「＋ 工程を追加」から始めましょう。</div>';
 $('boardGrid').innerHTML=`<div class="board-row month-row"><div class="task-label date-label">工程 / 担当</div><div style="width:${width}px;white-space:nowrap">${monthGroups.join('')}</div></div><div class="board-row date-row"><div class="task-label date-label"><strong>日付</strong></div><div class="timeline" style="height:54px;width:${width}px">${header}</div></div>${body}`;
 document.querySelectorAll('.board-row[data-row]').forEach(row=>{const handle=row.querySelector('.drag-handle');handle.draggable=window.innerWidth>780;handle.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',row.dataset.row);e.dataTransfer.effectAllowed='move'});row.addEventListener('dragover',e=>{e.preventDefault()});row.addEventListener('drop',e=>{e.preventDefault();let source=e.dataTransfer.getData('text/plain'),from=state.tasks.findIndex(t=>t.id===source),to=state.tasks.findIndex(t=>t.id===row.dataset.row);if(from<0||to<0||from===to)return;state.tasks.splice(to,0,state.tasks.splice(from,1)[0]);save();render()})});
}
function taskFor(id){return state.tasks.find(task=>task.id===id)}
function editTask(id){editing=id||null;const task=taskFor(id)||{name:'',company:'',start:state.viewStart,days:1,complete:false};$('dialogTitle').textContent=id?'工程を編集':'工程を追加';const form=$('taskForm');for(const key of ['name','company','start','days'])form.elements.namedItem(key).value=task[key];form.elements.namedItem('complete').checked=task.complete;$('deleteTask').hidden=!id;$('taskDialog').showModal();form.elements.namedItem('name').focus()}
$('addTask').onclick=()=>editTask(null);$('closeDialog').onclick=()=>$('taskDialog').close();
$('homeAddTask').onclick=()=>editTask(null);
$('homeTasks').onclick=e=>{const button=e.target.closest('[data-home-edit]');if(button)editTask(button.dataset.homeEdit)};
function setView(view){document.body.dataset.view=view;document.querySelectorAll('[data-view-button]').forEach(button=>{if(button.dataset.viewButton===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})}
document.querySelectorAll('[data-view-button]').forEach(button=>button.onclick=()=>setView(button.dataset.viewButton));
$('openSchedule').onclick=()=>setView('schedule');
setView(portraitPhone()?'home':'schedule');
$('taskForm').onsubmit=e=>{e.preventDefault();const f=e.target,days=Number(f.elements.namedItem('days').value),start=f.elements.namedItem('start').value,name=f.elements.namedItem('name').value.trim(),company=f.elements.namedItem('company').value.trim();if(!name||!validDate(start)||!Number.isInteger(days)||days<1||days>365){announce('工程名、開始日、所要日数を確認してください');return}let current=taskFor(editing);if(current)Object.assign(current,{name,company,start,days,complete:f.elements.namedItem('complete').checked});else state.tasks.push({id:newId(),name,company,start,days,complete:f.elements.namedItem('complete').checked});$('taskDialog').close();save();render();announce('工程を反映しました')};
$('deleteTask').onclick=()=>{const task=taskFor(editing);if(!task||!confirm(`「${task.name}」を削除しますか？`))return;state.tasks=state.tasks.filter(item=>item.id!==editing);$('taskDialog').close();save();render()};
$('projectName').onchange=e=>{state.name=e.target.value.trim()||'名称未設定の工程表';save();render()};
$('viewStart').onchange=e=>{if(!validDate(e.target.value)){announce('表示開始日を確認してください');return}state.viewStart=e.target.value;save();render()};
document.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{state.days=+button.dataset.days;save();render()});
$('prev').onclick=()=>{state.viewStart=plus(state.viewStart,-state.days);save();render()};$('next').onclick=()=>{state.viewStart=plus(state.viewStart,state.days);save();render()};$('today').onclick=()=>{state.viewStart=startOfWeek(todayISO());save();render()};
$('boardGrid').onclick=e=>{if(dragging){dragging=false;return}const button=e.target.closest('[data-edit],[data-up],[data-down],[data-bar]');if(!button)return;let id=button.dataset.edit||button.dataset.up||button.dataset.down||button.dataset.bar;if(button.dataset.up||button.dataset.down){const from=state.tasks.findIndex(t=>t.id===id),to=from+(button.dataset.up?-1:1);if(to<0||to>=state.tasks.length)return;[state.tasks[from],state.tasks[to]]=[state.tasks[to],state.tasks[from]];save();render()}else editTask(id)};
$('boardGrid').onkeydown=e=>{const bar=e.target.closest('[data-bar]');if(bar&&(e.key==='Enter'||e.key===' ')){e.preventDefault();editTask(bar.dataset.bar)}};
let pointer=null;$('boardGrid').addEventListener('pointerdown',e=>{const bar=e.target.closest('[data-bar]');if(!bar)return;pointer={id:bar.dataset.bar,startX:e.clientX,original:taskFor(bar.dataset.bar).start,moved:false,element:bar,unit:WIDTH()};bar.setPointerCapture(e.pointerId)});
$('boardGrid').addEventListener('pointermove',e=>{if(!pointer)return;const delta=Math.round((e.clientX-pointer.startX)/pointer.unit);if(Math.abs(e.clientX-pointer.startX)>6)pointer.moved=true;if(!pointer.moved)return;pointer.element.classList.add('dragging');pointer.element.style.transform=`translateX(${delta*pointer.unit}px)`});
function endDrag(e){if(!pointer)return;const current=pointer;pointer=null;current.element.classList.remove('dragging');current.element.style.transform='';if(!current.moved)return;dragging=true;const delta=Math.round((e.clientX-current.startX)/current.unit);if(delta){taskFor(current.id).start=plus(current.original,delta);save();render();announce(`${taskFor(current.id).name}の開始日を${short(taskFor(current.id).start)}に変更しました`)}setTimeout(()=>dragging=false,50)}
$('boardGrid').addEventListener('pointerup',endDrag);$('boardGrid').addEventListener('pointercancel',endDrag);
$('print').onclick=()=>window.print();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`工程表-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};
$('import').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>300000)throw Error('ファイルが大きすぎます');const imported=clean(JSON.parse(await file.text()));if(!confirm(`「${imported.name}」を読み込みますか？現在の工程表はこの端末から置き換わります。`))return;state=imported;save();render();announce('工程表を読み込みました')}catch(error){announce(error.message)}finally{e.target.value=''}};
$('newProject').onclick=()=>{if(!confirm('新しい工程表を作成しますか？現在の工程表は「データを保存」で控えを取ってください。'))return;state={name:'新しい工程表',viewStart:startOfWeek(todayISO()),days:14,tasks:[]};save();render()};
let previousOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';
window.addEventListener('resize',()=>{const nextOrientation=portraitPhone()?'portrait':compactLandscape()?'landscape':'desktop';if(nextOrientation!==previousOrientation){previousOrientation=nextOrientation;setView(nextOrientation==='portrait'?'home':'schedule')}render()});render();
