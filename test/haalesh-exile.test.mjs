import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {armExile,runExileTimer,prepareExileOutcome,writeExileOutcome,EVENT,EXILE_TITLE,EXILE_TEXT,EXILE_THREAT,EXILE_SATISFIED} from '../functions/haalesh-exile.js';
import {assemblyEngine} from '../functions/assembly-engine.js';
import {createExileWorld,allocateExileHomeland} from '../functions/exile-world.js';
import {EXILE_ID,exileDefinition} from '../functions/exile-npc.js';
const now=Date.now(),E=assemblyEngine('cloudspine',[]),current=E.cycle(now),PUB='worldEvents/'+EVENT,PRIVATE='serverEvents/'+EVENT,ROOT='assemblyRegions/cloudspine';
function database(){
 const data=new Map([['worldEvents/dhaluun-cloudspine-v1',{haalesh:{v:1,t:now-864e5}}],[ROOT,{rev:10,haalesh:{v:1,t:now-864e5}}],[ROOT+'/cycles/'+current,{c:current,k:'player-current',ti:'Current vote'}],[ROOT+'/cycles/'+(current+1),{c:current+1,k:'dhaluun-condemnation-v1',ti:'Existing condemnation'}]]),writes=[];
 const doc=path=>({path,get:async()=>snap(path),collection:k=>collection(path+'/'+k)}),snap=path=>({id:path.split('/').at(-1),ref:doc(path),exists:data.has(path),get:k=>data.get(path)?.[k],data:()=>structuredClone(data.get(path))});
 const collection=(path,filters=[],sort=null,limit=Infinity)=>({path,query:true,doc:id=>doc(path+'/'+id),where:(k,op,v)=>collection(path,filters.concat([[k,v]]),sort,limit),orderBy:(k,dir)=>collection(path,filters,[k,dir],limit),limit:n=>collection(path,filters,sort,n),get:async()=>{let docs=[...data.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&filters.every(([k,v])=>data.get(p)?.[k]===v)).map(snap);if(sort)docs.sort((a,b)=>(a.get(sort[0])-b.get(sort[0]))*(sort[1]==='desc'?-1:1));docs=docs.slice(0,limit);return {docs,size:docs.length,empty:!docs.length};}});
 return {data,writes,doc,collection,runTransaction:async fn=>{const pending=[],tx={get:r=>r.get(),getAll:async(...r)=>Promise.all(r.map(x=>{assert.equal(x.query,undefined,'getAll receives document refs only');return x.get();})),create:(r,d)=>{assert.ok(!data.has(r.path));pending.push([r.path,d]);},set:(r,d,o)=>pending.push([r.path,o?.merge?{...data.get(r.path),...d}:d]),update:(r,d)=>{assert.ok(data.has(r.path));pending.push([r.path,{...data.get(r.path),...d}]);}};
  const result=await fn(tx);for(const [p,d] of pending){data.set(p,d);writes.push(p);}return result;}};
}
test('the 25-hour server delay writes no public request or nation early, and arming is idempotent',async()=>{
 const db=database(),publishAt=now+25*3600e3;
 assert.equal((await armExile(db,{publishAt,now})).status,'plan');assert.equal(db.writes.length,0);
 assert.equal((await armExile(db,{publishAt,now,apply:true})).status,'armed');assert.equal(db.data.get(PRIVATE).publishAt,publishAt);assert.equal(db.data.has(PUB),false);
 let calls=0;assert.equal((await runExileTimer(db,{now:publishAt-1,settle:async()=>calls++})).status,'waiting');assert.equal(calls,0);assert.equal(db.data.has(PUB),false);
 const count=db.writes.length;assert.equal((await armExile(db,{publishAt,now:publishAt+1000,apply:true})).status,'already-armed');assert.equal(db.writes.length,count);
});
test('the server publishes once at the due time and preserves both the current vote and the queued condemnation',async()=>{
 const db=database(),publishAt=now+25*3600e3,old=structuredClone(db.data.get(ROOT+'/cycles/'+current)),next=structuredClone(db.data.get(ROOT+'/cycles/'+(current+1)));
 await armExile(db,{publishAt,now,apply:true});let calls=0;await runExileTimer(db,{now:publishAt,settle:async()=>calls++});
 const event=db.data.get(PUB);assert.equal(event.phase,'published');assert.equal(event.c,current+2);assert.equal(event.nation,undefined);assert.equal(calls,1);
 assert.deepEqual(db.data.get(ROOT+'/cycles/'+current),old);assert.deepEqual(db.data.get(ROOT+'/cycles/'+(current+1)),next);
 const L=db.data.get(ROOT+'/cycles/'+event.c);assert.equal(L.cat,'exilepetition');assert.equal(L.tx,EXILE_TEXT);assert.equal(L.ti,EXILE_TITLE);assert.ok(!('ok' in L));
 const count=db.writes.length;await runExileTimer(db,{now:publishAt+1000,settle:async()=>calls++});assert.equal(db.writes.length,count);assert.equal(calls,1);
});
function closing(db,ok,{at=now,c=current-1,y=ok?2:0,n=ok?1:2}={}){
 const ends=E.t0(c+1),L={c,k:EVENT,cat:'exilepetition',by:'npc-cloudspine-saaveri',r:'cloudspine',f:at,ok,y,n,dt:'AsmDebate'+String(c).padStart(11,'0')};
 db.data.set(PUB,{v:1,reg:'cloudspine',phase:'published',t:E.t0(c),c,ends});db.data.set(PRIVATE,{v:1,phase:'published',c,ends});db.data.set('cb/cloudspine/posts/'+L.dt,{rc:0});
 return {locks:[L],pending:[],worldNations:[],haalesh:{v:1,t:now-864e5},root:db.doc(ROOT)};
}
for(const [label,y,n] of [['rejection',0,2],['tie',1,1]])test(label+' creates no NPC or territory and posts only Dhaluun’s satisfied reaction, once',async()=>{
 const db=database(),ctx=closing(db,0,{y,n});let allocated=0;
 await db.runTransaction(async tx=>{const out=await prepareExileOutcome(tx,db,ctx,now,{allocate:async()=>allocated++});assert.ok(out);assert.equal(out.nation,null);writeExileOutcome(tx,db,ctx,out,now);});
 assert.equal(allocated,0);assert.equal(db.data.get(PUB).phase,'rejected');assert.equal(db.data.get(PUB).nation,undefined);assert.equal(db.data.get('rchat/cloudspine/chat/'+EVENT+'-result').x,EXILE_SATISFIED);assert.equal(ctx.haalesh.exile,undefined);
 const count=db.writes.length;await db.runTransaction(async tx=>assert.equal(await prepareExileOutcome(tx,db,ctx,now),null));assert.equal(db.writes.length,count);assert.ok(db.writes.every(p=>!p.startsWith('nations/')));
});
test('passage creates the protected NPC descriptor and Haalesh’s threat only after the deadline, once',async()=>{
 const db=database(),ctx=closing(db,1),nation={id:EXILE_ID,map:5,t:now,cap:1,land:[1,2,3,4,5,6,7]};let count=0;
 await db.runTransaction(async tx=>{const out=await prepareExileOutcome(tx,db,ctx,now,{allocate:async()=>{count++;return nation;}});writeExileOutcome(tx,db,ctx,out,now);});
 assert.equal(count,1);assert.equal(db.data.get(PUB).phase,'passed');assert.deepEqual(db.data.get(PUB).nation,nation);assert.equal(ctx.haalesh.exile.id,EXILE_ID);assert.equal(db.data.get('rchat/cloudspine/chat/'+EVENT+'-result').x,EXILE_THREAT);
 await db.runTransaction(async tx=>assert.equal(await prepareExileOutcome(tx,db,ctx,now),null));assert.equal(count,1);
 const early=database(),futureCtx=closing(early,1,{c:current,at:E.t0(current+1)});await early.runTransaction(async tx=>assert.equal(await prepareExileOutcome(tx,early,futureCtx,now,{allocate:async()=>{throw new Error('Must not allocate early.');}}),null));
});
const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),source=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')).replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Offline trusted world test. */');
test('the exact server game model creates seven hexes and a capital, keeps every existing owner and city, and creates nothing for pending or rejected requests',async()=>{
 const world=createExileWorld({rows:[],dhaluun:null},{now,source});await world.verify(null);const before=world.snapshot(),c=current-1,event={v:1,reg:'cloudspine',c,t:E.t0(c),ends:E.t0(c+1)};
 assert.equal(before.ids.includes(EXILE_ID),false);world.install({...event,phase:'published'});assert.equal(world.snapshot().ids.includes(EXILE_ID),false);world.install({...event,phase:'rejected'});assert.deepEqual(world.snapshot().owner,before.owner);
 const nation={...world.plan(),t:now};world.install({...event,phase:'passed',nation});const after=world.snapshot();assert.equal(after.ids.filter(id=>id===EXILE_ID).length,1);assert.equal(after.owner.filter(o=>after.ids[o]===EXILE_ID).length,7);assert.ok(after.cities.some(c=>c.fid===EXILE_ID&&c.nm==='Refuge'));
 for(let c=0;c<before.owner.length;c++)if(before.owner[c]>=0)assert.equal(after.ids[after.owner[c]],before.ids[before.owner[c]]);for(const city of before.cities)assert.ok(after.cities.some(c=>c.fid===city.fid&&c.id===city.id&&c.c===city.c));
 world.install({...event,phase:'passed',nation});assert.equal(world.snapshot().ids.filter(id=>id===EXILE_ID).length,1);
 const cold=createExileWorld({rows:[],dhaluun:null,exile:{...event,phase:'passed',nation}},{now,source});assert.deepEqual(cold.snapshot().cities,after.cities);
 const def=exileDefinition(nation);assert.equal(def.name,'Free Haalesh');const future=current+1,L={...event,c:future,k:'later-vote',cat:'trade',by:'npc-cloudspine-dhaluun',g:0};
 const eng=assemblyEngine('cloudspine',[],[],{exile:nation});assert.equal(eng.tally({...L,c:current-1},current-1,[],now,null).rows.some(r=>r.id===EXILE_ID),false);assert.equal(eng.tally(L,future,[],E.t0(future+1)-1,null).rows.some(r=>r.id===EXILE_ID),true);
});
test('the real server allocator validates the new territory before returning its immutable descriptor',async()=>{
 const tx={getAll:async()=>[]},db={doc:path=>({path})},c=current-1,event={v:1,reg:'cloudspine',phase:'published',c,t:E.t0(c),ends:E.t0(c+1)};
 const n=await allocateExileHomeland(tx,db,{rows:[],dhaluun:null,publicKey:null},event,now,{source});assert.equal(n.id,EXILE_ID);assert.equal(n.land.length,7);assert.ok(n.land.includes(n.cap));
});
