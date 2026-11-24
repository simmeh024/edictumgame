import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {runWall,EVENT,HEADLINE,ARTICLE} from '../tools/admin/dhaluun-wall.mjs';
const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
/* the section alone: later sections (the research edicts) follow it */
const section=html.slice(html.indexOf('/* Dhaluun: a manually activated Cloudspine event */'),html.indexOf('} /* end Dhaluun event */')+'} /* end Dhaluun event */'.length);
function game(){
  const N=256,nbr=new Int32Array(N*6).fill(-1);nbr[0]=1;nbr[6+3]=0;nbr[6+1]=2;nbr[12+4]=1;
  const cities=[{id:'cap',cap:true,b:['fortress']},{id:'n0',cap:false,b:['farm']}];
  const ctx=vm.createContext({Date,Map,Set,WeakMap,Number,Array,Error,Math,REG:{id:'cloudspine'},MAP_VER:5,TERR_AT:null,DAY:864e5,HEX_R:10,
    HCX:Array.from({length:6},(_,k)=>Math.cos((60*k-30)*Math.PI/180)),HCY:Array.from({length:6},(_,k)=>Math.sin((60*k-30)*Math.PI/180)),
    MAP:{N,T:new Uint8Array(N).fill(2),nbr,cx:Float64Array.from({length:N},(_,i)=>i*18),cy:new Float64Array(N)},window:{EDICTUM_PROBE:()=>{}},
    grow:()=>{},collectConquests:()=>({sig:'base'}),cvIndex:()=>({all:[],k:'base'}),cvKey:(by,op)=>by+op.id,connect:async()=>{},S:{},
    npcCities:()=>cities,cityEpochKey:()=>'cities',dcWallGeo:()=>({ordinary:true}),DISPATCH_SOURCES:[],dspIn:(c,t)=>t>=c.from&&t<c.to&&t<=c.now,
    passForget:()=>{},terrCache:new Map(),atlasCache:new Map(),dspMemo:new Map(),dspXRev:0,
    allNations:()=>[],territory:()=>{},cityState:()=>{},cityDefMult:()=>1,dcWalls:()=>{}});
  vm.runInContext(section,ctx);
  const base={v:1,reg:'cloudspine',by:'npc-cloudspine-dhaluun',map:5,t:Date.now()-1000,land:Array.from({length:120},(_,i)=>i+10),targets:[{id:'player',nm:'Playerland'}]};
  const wall={v:1,t:Date.now()-500,h:HEADLINE,b:ARTICLE};
  return {ctx,base,wall,api:ctx.window.EDICTUM_PROBE.dhaluunWall,cities};
}
test('the completed wall is added once to Dhaluun’s capital and never mutates cached NPC cities',()=>{
  const {ctx,base,wall,api,cities}=game();api.install(base);assert.equal(api.active(),null);assert.equal(api.cities(base.by)[0].b.includes('wall'),false);
  api.install({...base,wall});const built=api.cities(base.by);assert.equal(built[0].b.filter(k=>k==='wall').length,1);assert.equal(api.cities(base.by)[0].b.filter(k=>k==='wall').length,1);
  assert.deepEqual(cities[0].b,['fortress']);assert.equal(built[1].b.includes('wall'),false);assert.equal(api.cities('npc-other'),cities);
  assert.match(ctx.cityEpochKey(Date.now()),/dhaluun-wall/);
  ctx.TERR_AT=wall.t-1;assert.equal(api.cities(base.by)[0].b.includes('wall'),false);assert.equal(ctx.cityEpochKey(Date.now()),'cities');
  ctx.REG.id='meridian';ctx.TERR_AT=null;assert.equal(api.active(),null);
});
test('the special geometry includes every exterior edge, coast and foreign border, and no internal edge',()=>{
  const {ctx,base,wall,api}=game();api.install({...base,wall});
  const T={list:[{id:base.by},{id:'player'}],owner:new Int16Array(ctx.MAP.N).fill(-1)};T.owner[0]=0;T.owner[1]=0;T.owner[2]=1;
  const geo=ctx.dcWallGeo(T,0);assert.equal(geo.lines.length,10);assert.equal(geo.cells.size,2);assert.ok(geo.cells.has(0)&&geo.cells.has(1));assert.equal(ctx.dcWallGeo(T,0),geo);
  assert.equal(ctx.dcWallGeo(T,1).ordinary,true);ctx.TERR_AT=wall.t-1;assert.equal(ctx.dcWallGeo(T,0).ordinary,true);
});
test('the sourced report appears once in its Cloudspine edition, with the purpose left unknown',()=>{
  const {ctx,base,wall,api}=game();api.install({...base,wall});
  const C={reg:'cloudspine',from:wall.t-1,to:wall.t+864e5,now:Date.now()},stories=ctx.DISPATCH_SOURCES.flatMap(f=>f(C));
  assert.equal(stories.length,1);assert.equal(stories[0].h,HEADLINE);assert.equal(stories[0].b,ARTICLE);assert.match(stories[0].b,/Sources say/);assert.match(stories[0].b,/none could say what/);
  assert.equal(stories[0].who[0],base.by);assert.equal(api.story({...C,reg:'meridian'}).length,0);assert.equal(api.story({...C,to:wall.t}).length,0);assert.equal(api.story({...C,from:wall.t+1}).length,0);
  api.install({...base,wall:{...wall,t:Date.now()+60000}});assert.equal(api.active(),null);assert.equal(ctx.window.EDICTUM_PROBE.dhaluun.index().all.length,1,'invalid wall data does not remove the original spy event');
});
function database(initial){
  const saved=new Map(initial?[[`worldEvents/${EVENT}`,structuredClone(initial)]]:[]),writes=[];
  const snapshot=path=>({exists:saved.has(path),data:()=>saved.get(path)}),ref=path=>({path,get:async()=>snapshot(path)});
  return {saved,writes,doc:ref,runTransaction:async f=>{const pending=[];const result=await f({get:async r=>snapshot(r.path),update:(r,d)=>pending.push([r.path,{...saved.get(r.path),...d}]),create:(r,d)=>pending.push([r.path,d])});for(const [p,d] of pending){saved.set(p,d);writes.push(p);}return result;}};
}
test('the operator previews without writes, atomically publishes wall and article, and cannot replay or alter the earlier event',async()=>{
  const {base}=game(),db=database(base);assert.equal((await runWall(db)).status,'plan');assert.equal(db.writes.length,0);
  assert.equal((await runWall(db,{apply:true})).status,'applied');assert.equal(db.writes.length,2);
  const event=db.saved.get(`worldEvents/${EVENT}`),{wall,...old}=event;assert.deepEqual(old,base);assert.equal(wall.h,HEADLINE);assert.equal(wall.b,ARTICLE);
  assert.ok(db.saved.has('adminAudit/dhaluun-wall-v1'));assert.equal((await runWall(db,{apply:true})).status,'already-applied');assert.equal(db.writes.length,2);
  await assert.rejects(runWall(database(),{apply:true}),/must be active first/);
});
