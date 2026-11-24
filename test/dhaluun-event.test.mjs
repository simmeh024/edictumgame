import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('/* Dhaluun: a manually activated Cloudspine event */'),html.lastIndexOf("if(hot&&typeof hot.snapshot==='function')"));
function game(){
  const W=160,H=8,N=W*H,cx=Float64Array.from({length:N},(_,c)=>c%W),cy=Float64Array.from({length:N},(_,c)=>Math.floor(c/W));
  const nbrFlat=new Int32Array(N*6).fill(-1);
  for(let c=0;c<N;c++)for(const [i,[dx,dy]] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]].entries()){
    const x=c%W+dx,y=Math.floor(c/W)+dy;if(x>=0&&x<W&&y>=0&&y<H)nbrFlat[c*6+i]=y*W+x;
  }
  const ctx=vm.createContext({Date,Map,Set,Number,Array,Error,REG:{id:'cloudspine'},MAP_VER:6,TERR_AT:null,DAY:864e5,
    MAP:{N,T:new Uint8Array(N).fill(2),cx,cy,nbrFlat},window:{},
    grow:(list,over)=>new Map(over),collectConquests:()=>({list:[],sig:'base'}),cvIndex:()=>({all:[],k:'base'}),cvKey:(by,op)=>by+op.id,
    connect:async()=>{},S:{},allNations:()=>[{id:'npc-cloudspine-dhaluun',n:{name:'Dhaluun'}},{id:'player',n:{name:'Playerland'}},{id:'npc-other',n:{name:'Other'}}]});
  vm.runInContext(source.replace('} /* end Dhaluun event */','this.eventState=DHALUUN;} /* end Dhaluun event */'),ctx);
  const cap=3*W+145,owner=new Int16Array(N).fill(-1);owner[cap]=0;owner[cap-1]=0;
  // Another nation blocks a western hex; the plan must go around it.
  owner[cap-2]=1;
  ctx.T={byId:{'npc-cloudspine-dhaluun':0},list:[{id:'npc-cloudspine-dhaluun',cap},{id:'player',cap:cap-2}],owner};
  return ctx;
}
test('inactive until explicitly installed; 120 connected western hexes, preserving occupied land',()=>{
  const g=game();assert.equal(g.dhaluunActive(),null);const plan=g.dhaluunPlan(g.T);
  assert.equal(plan.land.length,120);assert.equal(new Set(plan.land).size,120);
  const held=new Set([g.T.list[0].cap,g.T.list[0].cap-1]);
  for(const c of plan.land){assert.equal(g.T.owner[c],-1);assert.ok(g.MAP.cx[c]<g.MAP.cx[g.T.list[0].cap]);assert.ok([...held].some(h=>Array.from(g.MAP.nbrFlat.slice(h*6,h*6+6)).includes(c)));held.add(c);}
  assert.equal(plan.targets.length,2);assert.ok(plan.targets.every(x=>x.id!=='npc-cloudspine-dhaluun'));
  g.eventState.data=g.dhaluunRead(plan);
  const over=new Map([[plan.land[0],1]]),out=g.grow(g.T.list,over);
  assert.equal(out.get(plan.land[0]),1,'explicit claims retain ownership');assert.equal(out.size,120);
  assert.equal(over.size,1,'the caller’s reservations are unchanged');
});
test('all snapshot targets fail and are exposed once per read; future and other-region nations are untouched',()=>{
  const g=game(),plan=g.dhaluunPlan(g.T);g.eventState.data=g.dhaluunRead(plan);
  const first=g.cvIndex();assert.equal(first.all.length,2);assert.equal(g.cvIndex().all.length,2);
  for(const e of first.all){assert.equal(e.ok,false);assert.equal(e.ex,true);assert.equal(e.op.p,0);assert.equal(e.op.x,1);assert.equal(e.op.k,'g');}
  g.allNations=()=>[{id:'newcomer',n:{name:'New nation'}}];assert.equal(g.cvIndex().all.length,2);
  g.TERR_AT=plan.t-1;assert.equal(g.grow(g.T.list,new Map()).size,0,'no annexation in the earlier atlas');
  assert.equal(g.collectConquests(plan.t-1).sig,'base');assert.match(g.collectConquests(plan.t).sig,/dhaluun/);
  g.REG.id='meridian';assert.equal(g.cvIndex().all.length,0);assert.equal(g.grow(g.T.list,new Map()).size,0);
});
test('invalid or future event data cannot change the map',()=>{
  const g=game(),p=g.dhaluunPlan(g.T);
  assert.ok(g.dhaluunRead(p));
  for(const bad of [{...p,map:99},{...p,t:Date.now()+60000},{...p,land:p.land.slice(1)},{...p,land:Array(120).fill(1)},{...p,targets:[{id:'bad/path',nm:'Bad'}]},{...p,targets:[p.targets[0],p.targets[0]]}])assert.equal(g.dhaluunRead(bad),null);
  g.MAP.T.fill(0);assert.throws(()=>g.dhaluunPlan(g.T),/fewer than 120/);
});
