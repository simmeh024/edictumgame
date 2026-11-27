import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chatDelegates } from '../functions/chat-delegates.js';
import { assemblyEngine } from '../functions/assembly-engine.js';
import DATA from '../functions/civic-data.json' with { type: 'json' };

const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const CHAT_DEL_COLORS='),html.indexOf('function portalOk('));
const regions=new Set(DATA.regions.map(r=>r.id));
function database(homes){return {doc:path=>path,getAll:async(...paths)=>paths.map(path=>{const id=path.split('/')[1];return {id,exists:id in homes,get:k=>k==='reg'?homes[id]:undefined};})};}

test('the callable entry gate admits delegate lookups and rejects unknown operations',()=>{
  const civic=fs.readFileSync(new URL('../functions/civic.js',import.meta.url),'utf8');
  const constants=civic.slice(civic.indexOf('const ASSEMBLY_ACTS ='),civic.indexOf('/* One vCPU'));
  const gate=civic.match(/^  if \(!CIVIC_OPS\.has\(op\).+$/m)[0];
  const context=vm.createContext({HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},...Object.fromEntries(['isAllianceOp','isTreatyOp','isBorderOp','isFlagOp','isRegionChatOp','isAmbOp','isSupplyOp','isLandOp','isVentureOp','isRiddleOp'].map(k=>[k,()=>false]))});
  vm.runInContext(constants+'\nthis.admit=op=>{'+gate+'};',context);
  assert.doesNotThrow(()=>context.admit('chatDelegates'));
  assert.throws(()=>context.admit('notAnOperation'),/Unknown request/);
});

test('the real runtime request wrapper allows delegate reads while observing and keeps writes blocked',async()=>{
  const shim=fs.readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  const start=shim.indexOf('  async function call(name, data)'),end=shim.indexOf('  /* battles are rolled',start);
  for(const mode of ['player','observe','preview']){
    const requests=[],A={auth:{currentUser:{getIdToken:async()=> 'test-token'}},fn:'http://test.invalid'};
    const call=new Function('A','isObj','pviewing','observing','readOnly','mapError','within','fetch',shim.slice(start,end)+'\nreturn call;')(
      A,v=>v&&typeof v==='object',()=>mode==='preview',()=>mode!=='player',()=>new Error('read_only'),e=>new Error(e.message||e.code),p=>p,
      async(url,init)=>{requests.push({url,data:JSON.parse(init.body).data});return {ok:true,json:async()=>({result:{badges:{delegate:'meridian'}}})};});
    assert.deepEqual(await call('civic',{op:'chatDelegates',ids:['delegate']}),{badges:{delegate:'meridian'}});
    assert.equal(requests.length,1,mode+' reaches the callable');
    if(mode!=='player')for(const op of ['vote','endorse','authorizeSave'])await assert.rejects(call('civic',{op}),/read_only/);
  }
});

test('the server derives office from the current region, once per region, and returns no private records',async()=>{
  const called=[],db=database({a:'meridian',b:'meridian',c:'frostmarch',moved:'frostmarch',closed:'unknown'});
  const out=await chatDelegates(db,['a','b','c','moved','closed','gone','a'],regions,async r=>{called.push(r);return r==='meridian'?'a':'c';});
  assert.deepEqual(out,{badges:{a:'meridian',b:'',c:'frostmarch',moved:'',closed:'',gone:''}});
  assert.deepEqual(called.sort(),['frostmarch','meridian']);
});

test('a chair changes on old messages when endorsements change; public history cannot grant it',async()=>{
  const now=Date.now(),day=86400000;
  const record=id=>({id,n:{name:id,reg:'meridian',founded:now-3*day,civicAt:now-2*day,s:{civil:0,econ:0,pol:0},asm:{r:'meridian',e:[],s:[],v:[]}}});
  const recs=['a','b','v1','v2'].map(record),db=database(Object.fromEntries(recs.map(r=>[r.id,'meridian'])));
  const chair=async()=>assemblyEngine('meridian',recs).delegate(recs,now).D?.id||'';
  for(const r of recs.slice(2))r.n.asm.e=[{i:'a',t:now-100}];
  const first=await chatDelegates(db,['a','b'],regions,chair);assert.equal(first.badges.a,'meridian');assert.equal(first.badges.b,'');
  for(const r of recs.slice(2))r.n.asm.e=[{i:'b',t:now-50}];
  const next=await chatDelegates(db,['a','b'],regions,chair);assert.equal(next.badges.a,'');assert.equal(next.badges.b,'meridian');
  recs[1].n.lastSave=now-15*day;
  const absent=await chatDelegates(db,['b'],regions,chair);assert.equal(absent.badges.b,'');
});

test('invalid and excessive author requests are rejected before database reads',async()=>{
  for(const ids of [undefined,'a',['../private'],['a/b'],Array(81).fill('a'),[null]]){
    await assert.rejects(chatDelegates(null,ids,regions,()=>{}),{code:'invalid-argument'});
  }
  assert.deepEqual(await chatDelegates(null,[],regions,()=>{}),{badges:{}});
});

function client(){
  let now=100000,reply={a:'meridian',b:'frostmarch'},calls=[];
  const ctx=vm.createContext({Date:{now:()=>now},Map,Set,console,
    S:{uid:'viewer',db:{},mode:'world'},REG_BY_ID:Object.fromEntries(DATA.regions.map(r=>[r.id,r])),NPC_SET:new Set(['npc-one']),
    esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),isOffice:id=>id==='office',dmIsGroup:id=>id.startsWith('group:'),
    setTimeout:()=>1,setInterval:()=>{},document:{querySelectorAll:()=>[]},
    window:{claude:{use:async()=>({request:async d=>{calls.push(d);return {badges:reply};}})}}});
  vm.runInContext(source+'\nthis.X={CHAT_DEL,CHAT_DEL_COLORS,chatDelegateBadge,chatDelegateMark,chatDelegateLoad};',ctx);
  return {ctx,X:ctx.X,calls,setNow:v=>now=v,setReply:v=>reply=v};
}

test('all regions have distinct stable colours; the approved seat has an accessible region label',async()=>{
  const {X}=client();
  assert.equal(Object.keys(X.CHAT_DEL_COLORS).length,regions.size);
  assert.equal(new Set(Object.values(X.CHAT_DEL_COLORS)).size,regions.size);
  for(const r of regions)assert.match(X.CHAT_DEL_COLORS[r],/^#[\da-f]{6}$/);
  X.chatDelegateBadge('a');X.chatDelegateBadge('b');await X.chatDelegateLoad();
  const seat=X.chatDelegateMark('a');assert.match(seat,/role="img" aria-label="WAC Delegate · Meridian Reach"/);
  assert.match(seat,/--delegate-color:#7760ad/);assert.doesNotMatch(seat,/staff-pill|<circle|<ellipse/);
  assert.match(X.chatDelegateMark('b'),/--delegate-color:#438ca9/);
});

test('requests batch authors and refresh expired office instead of keeping a former delegate marked',async()=>{
  const c=client(),{X}=c;
  X.chatDelegateBadge('a');X.chatDelegateBadge('a');X.chatDelegateBadge('b');await X.chatDelegateLoad();
  assert.equal(c.calls.length,1);assert.deepEqual([...c.calls[0].ids],['a','b']);
  X.chatDelegateBadge('a');assert.equal(X.CHAT_DEL.pending.size,0);
  c.setNow(160001);assert.equal(X.chatDelegateMark('a'),'');
  c.setReply({a:'',b:'meridian'});X.chatDelegateBadge('a');X.chatDelegateBadge('b');await X.chatDelegateLoad();
  assert.equal(X.chatDelegateMark('a'),'');assert.match(X.chatDelegateMark('b'),/Meridian Reach/);
  c.ctx.S.uid='another-account';X.chatDelegateBadge('a');assert.equal(X.chatDelegateMark('b'),'');
});

test('offline, NPC, office and group senders never request an office badge',()=>{
  const {X,ctx}=client();
  for(const id of ['npc-one','office','group:one','bad/path'])X.chatDelegateBadge(id);
  assert.equal(X.CHAT_DEL.pending.size,0);
  ctx.S.mode='local';X.chatDelegateBadge('a');assert.equal(X.CHAT_DEL.pending.size,0);
});
