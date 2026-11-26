import {test} from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../functions/civic-data.json' with {type:'json'};
import {assemblyEngine} from '../functions/assembly-engine.js';
import {runNorth,EVENT,AUDIT,HEADLINE,ARTICLE} from '../tools/admin/dhaluun-north.mjs';
const now=Date.now(),base={v:1,reg:'cloudspine',by:'npc-cloudspine-dhaluun',map:6,t:now-864e5,land:Array.from({length:120},(_,i)=>i+1),targets:[{id:'kesara',nm:'Kesara'}],wall:{v:1,t:now-1,h:'Wall',b:'Wall'}};
function database(){
 const data=new Map([['worldEvents/'+EVENT,structuredClone(base)],['nations/kesara',{reg:'cloudspine',j:JSON.stringify({name:'Kesara',reg:'cloudspine'})}],['assemblyRegions/cloudspine',{rev:42,startCycle:108,other:'kept'}]]),versions=new Map(),writes=[];
 const doc=path=>({path,get:async()=>snap(path)}),snap=path=>{const v=versions.get(path)||0;return {id:path.split('/').at(-1),ref:doc(path),exists:data.has(path),data:()=>structuredClone(data.get(path)),get:k=>data.get(path)?.[k],updateTime:{v,isEqual:o=>v===o.v}};};
 const collection=path=>({where:(k,op,v)=>({get:async()=>{const docs=[...data.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&data.get(p)?.[k]===v).map(snap);return {docs,size:docs.length,empty:!docs.length};}})});
 return {data,writes,doc,collection,getAll:async(...refs)=>refs.map(r=>snap(r.path)),change:p=>versions.set(p,(versions.get(p)||0)+1),runTransaction:async f=>{
  const staged=[],tx={get:r=>r.get(),getAll:async(...refs)=>refs.map(r=>snap(r.path)),update:(r,d)=>staged.push([r.path,{...data.get(r.path),...d}]),set:(r,d,o)=>staged.push([r.path,o?.merge?{...data.get(r.path),...d}:d]),create:(r,d)=>{assert.ok(!data.has(r.path));staged.push([r.path,d]);}};
  const result=await f(tx);for(const [p,d] of staged){data.set(p,d);writes.push(p);}return result;
 }};
}
const plan=()=>({north:{v:1,t:now,land:[555,556],city:{id:'imperial-survey-1',c:555,nm:'Imperial Survey Station No. 1'},scandal:{id:'dhaluun-north-scandal-v1',tg:'kesara',tn:'Kesara',is:'scn-shed'}},haalesh:{v:1,t:now,h:HEADLINE,b:ARTICLE},before:188,after:190,city:'Imperial Survey Station No. 1',category:'Corrupt Dictatorship',pact:'The Pact of Eternal Snows'});
test('one atomic activation preserves the original event and Assembly state while adding the northern city, scandal and purchased cabinet',async()=>{
 const db=database(),opts={planner:async()=>plan()};assert.equal((await runNorth(db,opts)).status,'plan');assert.equal(db.writes.length,0);
 const result=await runNorth(db,{...opts,apply:true});assert.equal(result.status,'applied');assert.equal(db.writes.length,3);
 const d=db.data.get('worldEvents/'+EVENT),{north,haalesh,...old}=d;assert.deepEqual(old,base);assert.equal(north.t,haalesh.t);assert.equal(haalesh.h,HEADLINE);assert.equal(haalesh.b,ARTICLE);
 const root=db.data.get('assemblyRegions/cloudspine');assert.equal(root.rev,43);assert.equal(root.other,'kept');assert.equal(root.startCycle,108);assert.equal(root.haalesh.t,north.t);
 assert.ok(db.data.has('adminAudit/'+AUDIT));assert.ok(db.writes.every(p=>!p.startsWith('nations/')&&!p.includes('/cycles/')&&!p.includes('/actors/')));
 assert.equal((await runNorth(db,{...opts,apply:true})).status,'already-applied');assert.equal(db.writes.length,3);
});
test('a concurrent nation change or partial existing stage prevents every activation write',async()=>{
 const db=database();await assert.rejects(runNorth(db,{apply:true,planner:async()=>{db.change('nations/kesara');return plan();}}),/changed during planning/);assert.equal(db.writes.length,0);
 db.data.get('worldEvents/'+EVENT).north=plan().north;await assert.rejects(runNorth(db,{apply:true}),/Partial escalation/);assert.equal(db.writes.length,0);
});
test('the new Haalesh values affect future Assembly backing while a cycle that began before the takeover retains its original values',()=>{
 const E=assemblyEngine('cloudspine',[]),c=E.cycle(now),start=E.t0(c),newStart=E.t0(c+1),at=start+1000;
 const make=(id,s)=>({id,n:{name:id,reg:'cloudspine',civicAt:start-864e5,founded:start-2*864e5,s,asm:{r:'cloudspine',e:[],v:[]}}});
 const original=DATA.regions.find(r=>r.id==='cloudspine').npcs.find(n=>n.id===DATA.dhaluun.id),records=[make('old',original.s),make('new',{...original.s,...DATA.dhaluun.s})];
 const backing=(t,story)=>assemblyEngine('cloudspine',records,[],story).state(t).DD.npc.find(x=>x.x.id===original.id).r.id;
 assert.equal(backing(at+1000,{v:1,t:at}),'old');assert.equal(backing(newStart+1000,{v:1,t:at}),'new');assert.equal(backing(newStart+1000,null),'old');
});
