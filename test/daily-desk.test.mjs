// The daily desk, the presence streak and the quick first building, as the game's save hooks run them.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  let i=source.indexOf('{',start),depth=0;
  for(;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)break;}
  return source.slice(start,i+1);
}
const NOW=new Date(2026,9,30,12,0,0).getTime(),DAY=864e5,BASE=10;
/* objects made inside the sandbox have its prototypes: compare what they hold */
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),eq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);
function desk(over={}){
  const start=source.indexOf('const DD_GIFT='),end=source.indexOf('/* ── the desk on the edicts page ── */',start);
  assert.ok(start>0&&end>start);
  const ctx=vm.createContext({window:{},NORM_HOOKS:[],COMMIT_HOOKS:[],UNLOCK_SOURCES:[],MP_NET_MAX:24,FREQ_DEF:30,
    allNations:()=>[{me:true},{me:false}],cellOf:v=>Number.isInteger(v)?v:-1,asmState:()=>null,asmMemberAt:()=>true,pgAvailable:()=>false,
    cityList:n=>n.cities||[],landCredits:()=>0,landEarned:()=>BASE,earnedAt:()=>BASE,stockNow:n=>({...n.stock}),stockLimit:(n,r,v)=>Math.min(400,v),
    num0:v=>Number.isFinite(v)?v:0,roundStock:s=>({...s}),resName:r=>r,czHas:(o,k)=>Object.hasOwn(o,k),
    BUILDINGS:{farm:{n:'Farm Estates'},sawmill:{n:'Sawmill'},market:{n:'Market Hall'}},...over});
  vm.runInContext(fn('hash')+'\n'+fn('rng')+'\n'+fn('tallyOf')+'\n'+source.slice(start,end)+
    '\nthis.T={ddRoll,ddDay,DD_TASKS,STK_UNLOCKS,earned:n=>landEarned(n),src:UNLOCK_SOURCES};',ctx);
  return {...ctx.T,
    save(n,old,now=NOW){const out=[];for(const h of ctx.COMMIT_HOOKS){const m=h(n,old,now);if(m)out.push(...m);}return out;},
    reload(n){const d=JSON.parse(JSON.stringify(n)),o={...d};for(const k of ['dd','ddc','stk','ffb'])delete o[k];for(const h of ctx.NORM_HOOKS)h(o,d);return o;}};
}
const nation=over=>({name:'Deskland',seed:'s1',loc:5,freq:30,stock:{food:20,timber:20,oil:20,iron:20,goods:20},tly:{iss:5,claim:2},cities:[{id:'cap',c:5,b:[]}],...over});
const fixedDesk=(D,day)=>({d:D.ddDay(day||NOW),q:[['iss',2,'timber','iron'],['dm',1,'oil','goods'],['visit',1,'timber','goods']],c:[0,0,0],p:[0,0,0]});
const next=(n,f)=>{const old=structuredClone(n),m=structuredClone(n);f(m);return [m,old];};

test('three tasks a day, fixed by seed and date, each paying two different resources',()=>{
  const D=desk(),n=nation(),a=D.ddRoll(n,'2026-10-30');
  eq(a,D.ddRoll(n,'2026-10-30'));assert.equal(a.length,3);
  assert.equal(new Set(a.map(q=>q[0])).size,3);
  for(const [k,v,r1,r2] of a){assert.ok(D.DD_TASKS[k]);assert.ok(v>=1&&v<=5);assert.notEqual(r1,r2);}
  const days=new Set(Array.from({length:10},(x,i)=>JSON.stringify(D.ddRoll(n,'2026-11-'+String(i+1).padStart(2,'0')))));
  assert.ok(days.size>5,'the draw changes from day to day');
  for(let i=0;i<40;i++)assert.ok(!D.ddRoll(n,'2027-01-'+String(i%28+1).padStart(2,'0')).some(q=>q[0]==='vote'),'no Assembly task without an open vote');
});

test('an edict target never asks for more than the edict pace allows',()=>{
  const D=desk(),n=nation({freq:1440});
  for(let i=1;i<=28;i++){const q=D.ddRoll(n,'2026-02-'+String(i).padStart(2,'0')).find(q=>q[0]==='iss');if(q)assert.equal(q[1],1);}
});

test('tasks count from the tallies a save adds, and each pays once',()=>{
  const D=desk();let n=nation();n.dd=fixedDesk(D);n.stk={n:1,d:D.ddDay(NOW)}; // today's presence is already counted
  let [m,old]=next(n,x=>{x.tly.iss=6;});eq(D.save(m,old),[]);eq(m.dd.c,[1,0,0]);
  [m,old]=next(m,x=>{x.tly.iss=7;});const notes=D.save(m,old);
  assert.equal(notes.length,1);assert.match(notes[0],/Desk task done: Answer 2 edicts\. \+3 timber and \+3 iron/);
  assert.equal(m.stock.timber,23);assert.equal(m.stock.iron,23);eq(m.dd.p,[1,0,0]);
  [m,old]=next(m,x=>{x.tly.iss=9;});eq(D.save(m,old),[]);assert.equal(m.stock.timber,23,'a done task never pays again');
});

test('a visit marks itself once, and clearing all three pays one land credit',()=>{
  const D=desk();let n=nation();n.dd=fixedDesk(D);n.stk={n:1,d:D.ddDay(NOW)}; // today's presence is already counted
  let [m,old]=next(n,x=>{x._ddm='visit';x.tly.dm=1;x.tly.iss=7;});const notes=D.save(m,old);
  assert.equal(m._ddm,undefined);eq(m.dd.p,[1,1,1]);assert.equal(m.ddc,1);
  assert.match(notes.at(-1),/Today’s desk is clear: \+1 land credit/);assert.equal(D.earned(m),BASE+1);
  [m,old]=next(m,x=>{x._ddm='visit';x.tly.iss=12;});eq(D.save(m,old),[]);assert.equal(m.ddc,1);
  m=D.reload(m);assert.equal(m.ddc,1);assert.equal(m.dd.w,1);
});

test('a new day draws new tasks and keeps the credits already earned',()=>{
  const D=desk();let n=nation({ddc:4});n.dd={...fixedDesk(D,NOW-DAY),p:[1,1,1],c:[2,1,1],w:1};
  const [m,old]=next(n,()=>{});D.save(m,old);
  assert.equal(m.dd.d,D.ddDay(NOW));eq(m.dd.c,[0,0,0]);assert.equal(m.dd.w,undefined);assert.equal(m.ddc,4);
});

test('nothing counts against another nation or a record without tallies',()=>{
  const D=desk();let n=nation();n.dd=fixedDesk(D);
  let [m]=next(n,x=>{x.tly.iss=20;});D.save(m,{...structuredClone(n),name:'Otherland'});eq(m.dd.c,[0,0,0]);
  [m]=next(n,x=>{x.tly.iss=20;});D.save(m,null);eq(m.dd.c,[0,0,0]);assert.equal(m.stk,undefined);
});

test('presence counts once a day, pauses over a missed day, and unlocks three rewards',()=>{
  const D=desk();let n=nation();
  let [m,old]=next(n,x=>{x.tly.iss=6;});assert.ok(D.save(m,old).some(t=>/^Day 1 of your presence: the Enacted stamp in indigo ink/.test(t)));eq(m.stk,{n:1,d:D.ddDay(NOW)});
  [m,old]=next(m,x=>{x.tly.iss=7;});D.save(m,old);assert.equal(m.stk.n,1,'once a day');
  [m,old]=next(m,()=>{});D.save(m,old,NOW+DAY);assert.equal(m.stk.n,1,'opening the game alone does not count');
  [m,old]=next(m,x=>{x.tly.claim=3;});assert.ok(D.save(m,old,NOW+DAY).some(t=>/^Day 2 .*cartouche/.test(t)));
  [m,old]=next(m,x=>{x.tly.iss=8;});assert.ok(D.save(m,old,NOW+3*DAY).some(t=>/^Day 3 .*pennant/.test(t)));assert.equal(m.stk.n,3,'a missed day only paused it');
  eq([...D.src[0].earned(m)],[...D.STK_UNLOCKS]);
  [m,old]=next(m,x=>{x.tly.iss=9;});assert.ok(!D.save(m,old,NOW+4*DAY).some(t=>/presence/.test(t)));assert.equal(m.stk.n,4);
  assert.match(D.src[0].how('pn-pennant'),/3 different days/);
});

test('the quick first building brings its first cart once, if it still stands',()=>{
  const D=desk(),s=NOW-4*60000,d=NOW-60000;
  let n=nation({ffb:{k:'farm',c:'cap',s,d},cities:[{id:'cap',c:5,b:[{k:'farm',s,d}]}]});
  let [m,old]=next(n,()=>{});const notes=D.save(m,old);
  assert.equal(m.stock.food,32);assert.equal(m.ffb.p,1);assert.ok(notes.some(t=>/The Farm Estates are working: the first cart brings 12 food/.test(t)));
  [m,old]=next(m,()=>{});D.save(m,old);assert.equal(m.stock.food,32);
  n=nation({ffb:{k:'sawmill',c:'cap',s,d},cities:[{id:'cap',c:5,b:[]}]});[m,old]=next(n,()=>{});D.save(m,old);
  assert.equal(m.ffb.p,1);assert.equal(m.stock.timber,20,'a cancelled build brings nothing');
  n=nation({ffb:{k:'market',c:'cap',s:NOW,d:NOW+FFB()},cities:[{id:'cap',c:5,b:[{k:'market',s:NOW,d:NOW+FFB()}]}]});[m,old]=next(n,()=>{});D.save(m,old);
  assert.equal(m.ffb.p,undefined);assert.equal(m.stock.goods,20);
  function FFB(){return 3*60000;}
});

test('the browser tests can turn the desk off, leaving presence and the first building',()=>{
  const D=desk({window:{EDICTUM_NO_DESK:true}});let n=nation();
  const [m,old]=next(n,x=>{x.tly.iss=9;x.tly.dm=4;});const notes=D.save(m,old);
  eq(m.dd,undefined);assert.equal(m.stock.timber,20);assert.equal(m.stk.n,1);assert.ok(notes.every(t=>!/Desk task/.test(t)));
});

test('saved records keep only well-formed desks, counts and builds',()=>{
  const D=desk(),ok=D.reload({dd:{d:'2026-10-30',q:[['iss',3,'oil','iron']],c:[2],p:[0]},ddc:3,stk:{n:2,d:'2026-10-29'},ffb:{k:'farm',c:'cap',s:1,d:2,p:1}});
  eq(ok.dd,{d:'2026-10-30',q:[['iss',3,'oil','iron']],c:[2],p:[0]});assert.equal(ok.ddc,3);eq(ok.stk,{n:2,d:'2026-10-29'});eq(ok.ffb,{k:'farm',c:'cap',s:1,d:2,p:1});
  for(const bad of [{dd:{d:'30/10/2026',q:[['iss',3,'oil','iron']]}},{dd:{d:'2026-10-30',q:[['nap',1,'oil','iron']]}},{dd:{d:'2026-10-30',q:[['iss',3,'oil','oil']]}},{dd:{d:'2026-10-30',q:[['iss',99,'oil','iron']]}},
    {ddc:-1},{ddc:1.5},{stk:{n:0,d:'2026-10-30'}},{stk:{n:2,d:'yesterday'}},{ffb:{k:'wonder',c:'cap',s:1,d:2}},{ffb:{k:'farm',c:'cap',s:5,d:2}}]){
    const o=D.reload(bad);for(const k of ['dd','ddc','stk','ffb'])assert.equal(o[k],undefined,JSON.stringify(bad));}
});
