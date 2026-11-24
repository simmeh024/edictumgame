import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planEvent,runEvent,decodeNation,EVENT,MESSAGE} from '../tools/admin/dhaluun-event.mjs';
import {deflateNation} from '../functions/nationtext.js';
import fs from 'node:fs';
import {mapKit} from '../scripts/bake-maps.mjs';
test('the planner decodes compressed live nations and legacy JSON with the adapter’s public metadata',()=>{
  const j=JSON.stringify({name:'Playerland',reg:'cloudspine'});
  for(const payload of [{j},{z:deflateNation(j)}]){
    const d={...payload,pop:12,army:8,cl:10,rev:4,storageV:1,ts:{toMillis:()=>123}};
    const n=decodeNation({id:'player',get:k=>d[k]});assert.equal(n.name,'Playerland');assert.equal(n._pop,12);assert.equal(n._ts,123);assert.equal(n._rev,4);assert.equal(n.whv,1);
  }
  assert.throws(()=>decodeNation({id:'broken',get:()=>undefined}),/Cannot decode nation/);
});
test('the real Cloudspine map gains exactly 120 land hexes',async()=>{
  const p=await planEvent([]);assert.equal(p.after-p.before,120);assert.equal(p.event.targets.length,5);
  assert.equal(p.event.by,'npc-cloudspine-dhaluun');assert.equal(p.event.reg,'cloudspine');
});
test('a player and a hidden nation keep their real map borders; only the visible player is targeted',async()=>{
  const baseline=await planEvent([]),html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
  const map=mapKit(html,'cloudspine').generate(),now=Date.now();
  const player=(id,cell,hidden)=>({id,hidden,n:{name:id,reg:'cloudspine',loc:{c:cell%map.COLS,r:Math.floor(cell/map.COLS),m:baseline.event.map},founded:now-10*864e5,updatedAt:now,popAt:now,pop:10,claims:[]}});
  const plan=await planEvent([player('visible-player',baseline.event.land[0],false),player('hidden-player',baseline.event.land[90],true)]);
  assert.equal(plan.after-plan.before,120);assert.ok(plan.event.targets.some(x=>x.id==='visible-player'));
  assert.ok(!plan.event.targets.some(x=>x.id==='hidden-player'));
});
function database(){
  const saved=new Map(),writes=[];
  const ref=path=>({path,get:async()=>({exists:saved.has(path)}),doc:()=>ref(path+'/audit')});
  const nations={empty:true,size:0,docs:[]},query={get:async()=>nations};
  return {saved,writes,doc:ref,collection:path=>path==='nations'?{where:()=>query}:ref(path),
    runTransaction:async f=>{const pending=[];const out=await f({get:async r=>r===query?nations:{exists:saved.has(r.path)},create:(r,d)=>pending.push([r.path,d])});for(const [p,d] of pending){assert.ok(!saved.has(p));saved.set(p,d);writes.push(p);}return out;}};
}
test('dry run writes nothing; activation atomically creates one event, chat line and audit, and cannot replay',async()=>{
  const db=database();assert.equal((await runEvent(db)).status,'plan');assert.equal(db.writes.length,0);
  const result=await runEvent(db,{apply:true});assert.equal(result.status,'applied');assert.equal(result.after-result.before,120);
  assert.equal(db.writes.length,3);const event=db.saved.get('worldEvents/'+EVENT),line=db.saved.get('rchat/cloudspine/chat/'+EVENT);
  assert.equal(line.a,event.by);assert.equal(line.nm,'Dhaluun');assert.equal(line.x,MESSAGE);assert.ok(line.t>event.t);assert.equal(line.st,undefined);
  assert.equal((await runEvent(db,{apply:true})).status,'already-applied');assert.equal(db.writes.length,3);
});
