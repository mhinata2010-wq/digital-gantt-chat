import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../schedule-only-demo/app.js',import.meta.url),'utf8');
function line(prefix){return source.split('\n').find(value=>value.startsWith(prefix))}
test('schedule JSON round trip preserves dependencies and receipt settings',()=>{
 const context=vm.createContext({crypto:{randomUUID:()=> 'generated'}});
 for(const prefix of ['function dayDate(', 'function validDate(', 'function newId(', 'function predecessors(', 'function hasDependencyCycle(', 'function clean('])vm.runInContext(line(prefix),context);
 const task={id:'a',name:'基礎',company:'担当',start:'2026-10-28',days:2,complete:null};
 context.input={name:'工事',viewStart:'2026-10-28',days:14,tasks:[task,{...task,id:'b',predecessorId:'a',receiptRequired:true,receiptReviewed:true}]};
 const result=vm.runInContext('clean(JSON.parse(JSON.stringify(clean(input))))',context);
 assert.deepEqual(Array.from(result.tasks[1].predecessorIds),['a']);
 assert.equal(result.tasks[1].receiptRequired,true);
 assert.equal(result.tasks[1].receiptReviewed,true);
});
test('receipt requirement changes stay in draft until task form submission',()=>{
 const task={id:'a',name:'基礎',company:'担当',start:'2026-10-28',days:2,complete:false,receiptRequired:true,receiptReviewed:true};
 const elements={receiptRequired:{},taskForm:{},taskDialog:{close(){}}};
 let saves=0;
 const context=vm.createContext({$:id=>elements[id],editing:'a',receiptRequiredDraft:true,taskFor:()=>task,renderReceiptPanel(){},save(){saves++},render(){},announce(){},validDate:()=>true});
 vm.runInContext(line("$('receiptRequired').onchange="),context);
 elements.receiptRequired.onchange({target:{checked:false}});
 assert.equal(task.receiptRequired,true);
 assert.equal(task.receiptReviewed,true);
 assert.equal(saves,0);
 // Closing/cancelling without submitting leaves the stored task untouched.
 elements.taskDialog.close();
 assert.equal(task.receiptRequired,true);
 vm.runInContext(line("$('taskForm').onsubmit="),context);
 const values={name:'基礎',company:'担当',start:'2026-10-28',days:'2',status:'open'};
 elements.taskForm.onsubmit({preventDefault(){},target:{elements:{namedItem:key=>({value:values[key]})}}});
 assert.equal(task.receiptRequired,false);
 assert.equal(task.receiptReviewed,false);
 assert.equal(saves,1);
});
test('published receipt sources match the demo',()=>{
 for(const file of ['app.js','receipts.js','index.html','style.css','design.css']){
 assert.equal(readFileSync(new URL('../docs/'+file,import.meta.url),'utf8'),readFileSync(new URL('../schedule-only-demo/'+file,import.meta.url),'utf8'));
 }
});
