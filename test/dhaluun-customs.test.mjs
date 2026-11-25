import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {chooseRoutes,runCustoms,MESSAGE,BY,DAY,EVENT,AGREEMENT} from '../tools/admin/dhaluun-customs.mjs';
const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const end='} /* end Dhaluun customs */';
const code=html.slice(html.indexOf('/* Dhaluun: imperial customs notice */'),html.indexOf(end)+end.length);
function game(){
  const route={id:'trade-1',a:'member-a',b:BY,t:DAY},t=10*DAY;
  const ctx={now:t+DAY/2,REG:{id:'cloudspine'},DAY,S:{world:{},nation:null},window:{EDICTUM_PROBE:()=>{}},base:1,
    Date:{now:()=>ctx.now},econMemo:{v:null},passForget:()=>{},trMemo:{},alIdOf:n=>n.id,
    trFlow:d=>{d.bk=ctx.base;return ctx.base;},trStatus:()=>[],connect:async()=>{},
    economy:()=>ctx.econMemo.v||(ctx.econMemo.v={id:Math.random()}),
    stockRates:n=>{ctx.economy();return {goods:10*ctx.trFlow(route)};},
    whAccrue:(n,st,at,now,rt)=>({goods:Math.min(400,st.goods+rt.goods*(now-at)/DAY)}),
    fmtDate:String,fmtTime:String};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const api=ctx.window.EDICTUM_PROBE.customs,data={v:1,reg:'cloudspine',by:BY,aid:'agreement',t,u:t+DAY,factor:0.5,routes:[{id:route.id,a:route.a,b:route.b,dt:route.t}]};
  api.install(data);return {ctx,api,data,route,n:{id:'member-a'}};
}
test('selected signed routes lose exactly 50% for 24 hours, including any blockade multiplier',()=>{
  const {ctx,api,data,route}=game();assert.equal(api.flow(route),0.5);assert.equal(route.bk,0.5);
  ctx.base=0.75;assert.equal(api.flow(route),0.375);
  assert.equal(api.flow({...route,id:'untouched'}),0.75);assert.equal(api.flow({...route,t:route.t+1}),0.75);
  ctx.now=data.t-1;assert.equal(api.flow(route),0.75);ctx.now=data.u;assert.equal(api.flow(route),0.75);assert.equal(route.dhCustoms,undefined);
  ctx.now=data.t+1;ctx.REG.id='meridian';assert.equal(api.flow(route),0.75);
});
test('stock accrual splits at start and expiry instead of backdating or skipping the disruption for offline players',()=>{
  const {ctx,api,data,n}=game();
  assert.equal(api.stock(n,{goods:0},data.t-DAY,ctx.now,{goods:5}).goods,12.5);
  ctx.now=data.u+DAY;assert.equal(api.stock(n,{goods:0},data.t-DAY,ctx.now,{goods:10}).goods,25);
  assert.equal(api.stock(n,{goods:398},data.t-DAY,ctx.now,{goods:10}).goods,400);
  assert.equal(api.stock({id:'unaffected'},{goods:0},data.t-DAY,ctx.now,{goods:10}).goods,30);
  assert.equal(api.state.clock,null);assert.equal(api.state.busy,false);assert.equal(api.rates(n).goods,10);
});
test('expiry invalidates the economy cache and the route status explains the reduction',()=>{
  const {ctx,api,data,route}=game();const on=api.economy();assert.match(api.status({d:route},ctx.now)[0],/50%/);
  ctx.now=data.u;assert.notEqual(api.economy(),on);assert.equal(api.status({d:route},ctx.now).length,0);
  assert.equal(api.read({...data,u:data.u+1}),null);assert.equal(api.read({...data,factor:0}),null);
  assert.equal(api.read({...data,routes:[data.routes[0],data.routes[0]]}),null);
});
test('route allocation caps every member at two, counting a shared route for both endpoints',()=>{
  const d=(id,a,b,t)=>({id,a,b,t,fa:1,fb:1});
  const active=[d('a-npc','a',BY,1),d('ab','a','b',2),d('b-npc','b',BY,1),d('b-npc-2','b',BY,2),d('c-npc','c',BY,1),d('c-other','c','npc-other',2),{...d('war','a',BY,3),sus:true},{...d('empty','a',BY,4),fa:0}];
  const p=chooseRoutes(active,['a','b','c']);assert.deepEqual(p.counts,{a:2,b:2,c:2});assert.equal(p.routes.length,5);
  assert.ok(p.routes.some(d=>d.id==='ab'));assert.ok(!p.routes.some(d=>d.id==='war'||d.id==='empty'));
});
test('the approved wording is exact and the warning decoration requires its reserved identity in each alliance renderer',()=>{
  assert.equal(MESSAGE,'To the signatories of the Western Dhaluun Free Trade Agreement:\n\nHis Imperial Loftiness has reviewed your arrangements. Several trade routes have been suspended pending clarification of the word “Free.”\n\nConsider this your first customs notice.\n\n— The Throne of All Heights');
  for(const name of ['alChannelHTML','rgcLine']){const at=html.indexOf('function '+name+'('),part=html.slice(at,html.indexOf('\n}',at));assert.match(part,/m\.id==='dhaluun-customs-v1'&&m\.a==='npc-cloudspine-dhaluun'/);assert.match(part,/dh-warning/);assert.match(part,/Imperial customs notice/);}
});
function database(){
  const data=new Map([
    ['alliances/agreement',{name:AGREEMENT,reg:'cloudspine',ty:'trade',mem:{'player-a':{},'player-b':{}}}],
    ['nations/player-a',{reg:'cloudspine',j:JSON.stringify({name:'A',reg:'cloudspine'})}],
    ['nations/player-b',{reg:'cloudspine',j:JSON.stringify({name:'B',reg:'cloudspine'})}],
    ['worldEvents/dhaluun-cloudspine-v1',{v:1}]
  ]),versions=new Map(),writes=[];
  const doc=path=>({path,get:async()=>snap(path)});
  const snap=path=>{const d=data.get(path),v=versions.get(path)||0;return {id:path.split('/').at(-1),ref:doc(path),exists:data.has(path),data:()=>d,get:k=>d?.[k],updateTime:{v,isEqual:o=>o.v===v}};};
  const collection=path=>({where:(k,op,v)=>({get:async()=>{const docs=[...data.keys()].filter(p=>p.startsWith(path+'/')&&p.slice(path.length+1).indexOf('/')<0&&data.get(p)?.[k]===v).map(snap);return {docs,size:docs.length,empty:docs.length===0};}})});
  return {data,writes,doc,collection,getAll:async(...refs)=>refs.map(r=>snap(r.path)),change:p=>versions.set(p,(versions.get(p)||0)+1),
    runTransaction:async f=>{const pending=[];const result=await f({get:async r=>r.get(),create:(r,d)=>pending.push([r.path,d])});for(const [p,d] of pending){assert.ok(!data.has(p));data.set(p,d);writes.push(p);}return result;}};
}
const planned=()=>({v:1,reg:'cloudspine',by:BY,t:Date.now(),u:Date.now()+DAY,factor:0.5,routes:[{id:'a-route',a:'player-a',b:BY,dt:1},{id:'b-route',a:'player-b',b:BY,dt:1}],counts:{'player-a':1,'player-b':1}});
test('publication is atomic and idempotent, posts the exact private alliance message, and starts a fresh 24-hour timer',async()=>{
  const db=database(),opts={planner:async()=>planned()};assert.equal((await runCustoms(db,opts)).status,'plan');assert.equal(db.writes.length,0);
  const result=await runCustoms(db,{...opts,apply:true});assert.equal(result.status,'applied');assert.equal(db.writes.length,3);
  const event=db.data.get('worldEvents/'+EVENT),message=db.data.get('alliances/agreement/chat/'+EVENT);
  assert.equal(event.u-event.t,DAY);assert.equal(event.factor,0.5);assert.equal(message.x,MESSAGE);assert.equal(message.a,BY);assert.equal(message.nm,'Dhaluun');assert.equal(message.t,event.t);
  assert.ok(db.writes.every(p=>!p.startsWith('nations/')));assert.equal((await runCustoms(db,{...opts,apply:true})).status,'already-applied');assert.equal(db.writes.length,3);
});
test('a change to the agreement or routes during planning cannot leave a message or partial attack behind',async()=>{
  const db=database();await assert.rejects(runCustoms(db,{apply:true,planner:async()=>{db.change('nations/player-a');return planned();}}),/changed during planning/);assert.equal(db.writes.length,0);
});
