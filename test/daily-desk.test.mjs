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
  const ctx=vm.createContext({window:{},NORM_HOOKS:[],COMMIT_HOOKS:[],UNLOCK_SOURCES:[],NOTIF_SOURCES:[],MP_NET_MAX:24,FREQ_DEF:30,
    allNations:()=>[{me:true},{me:false}],cellOf:v=>Number.isInteger(v)?v:-1,asmState:()=>null,asmMemberAt:()=>true,pgAvailable:()=>false,
    cityList:n=>n.cities||[],landCredits:()=>0,landEarned:()=>BASE,earnedAt:()=>BASE,stockNow:n=>({...n.stock}),stockLimit:(n,r,v)=>Math.min(400,v),
    num0:v=>Number.isFinite(v)?v:0,roundStock:s=>({...s}),resName:r=>r,czHas:(o,k)=>Object.hasOwn(o,k),
    BUILDINGS:{farm:{n:'Farm Estates'},sawmill:{n:'Sawmill'},market:{n:'Market Hall'}},...over});
  vm.runInContext(fn('hash')+'\n'+fn('rng')+'\n'+fn('tallyOf')+'\n'+source.slice(start,end)+
    '\nthis.T={ddRoll,ddRare,ddDay,ddFresh,ddxReady,ddDelta,ddWeekOf,ddLegAt,ddLegRoll,ddLegOn,DD_LEG,DD_TASKS,DD_RARE,STK_UNLOCKS,earned:n=>landEarned(n),src:UNLOCK_SOURCES,notes:(n,t)=>NOTIF_SOURCES.flatMap(h=>h(n,t))};',ctx);
  return {...ctx.T,
    save(n,old,now=NOW){const out=[];for(const h of ctx.COMMIT_HOOKS){const m=h(n,old,now);if(m)out.push(...m);}return out;},
    reload(n){const d=JSON.parse(JSON.stringify(n)),o={...d};for(const k of ['dd','ddc','ddr','stk','ffb'])delete o[k];for(const h of ctx.NORM_HOOKS)h(o,d);return o;}};
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
  assert.equal(notes.length,1);assert.match(notes[0],/Desk task done: Answer 2 edicts\. \+3 timber and \+5 iron/); // iron and goods pay 2 more (goods balance)
  assert.equal(m.stock.timber,23);assert.equal(m.stock.iron,25);eq(m.dd.p,[1,0,0]);
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

test('in a nation’s first week a cleared desk pays two land credits, and after it one',()=>{
  const D=desk();let n=nation({founded:NOW-2*DAY});n.dd=fixedDesk(D);n.stk={n:1,d:D.ddDay(NOW)};
  let [m,old]=next(n,x=>{x._ddm='visit';x.tly.dm=1;x.tly.iss=7;});let notes=D.save(m,old);
  assert.equal(m.ddc,1);assert.equal(m.ddw,1);assert.match(notes.at(-1),/Today’s desk is clear: \+2 land credits in your first week/);
  assert.equal(D.earned(m),BASE+2);
  [m,old]=next(m,x=>{x.tly.iss=12;});eq(D.save(m,old),[]);assert.equal(D.earned(m),BASE+2,'paid once');
  m=D.reload(m);assert.equal(m.ddw,1);assert.equal(D.earned(m),BASE+2,'kept on reload');
  /* a week and a day after founding the desk pays its ordinary credit */
  const late=NOW+6*DAY;m.dd=fixedDesk(D,late);m.stk={n:2,d:D.ddDay(late)};
  [m,old]=next(m,x=>{x._ddm='visit';x.tly.dm=2;x.tly.iss=20;});notes=D.save(m,old,late);
  assert.equal(m.ddc,2);assert.equal(m.ddw,1);assert.match(notes.at(-1),/Today’s desk is clear: \+1 land credit to spend/);
  assert.equal(D.earned(m),BASE+3);
  for(const bad of [0,-1,1.5,9,'2'])assert.equal(D.reload({ddw:bad}).ddw,undefined,String(bad));
  assert.equal(D.reload({ddw:8}).ddw,8);
});

test('a new day draws new tasks and keeps the credits already earned',()=>{
  const D=desk();let n=nation({ddc:4});n.dd={...fixedDesk(D,NOW-DAY),p:[1,1,1],c:[2,1,1],w:1};
  const [m,old]=next(n,()=>{});D.save(m,old);
  assert.equal(m.dd.d,D.ddDay(NOW));eq(m.dd.c,[0,0,0]);assert.equal(m.dd.w,undefined);assert.equal(m.ddc,4);
});

test('two devices in different time zones share one desk: the day only moves on',()=>{
  /* a phone already in tomorrow (a time zone further east) clears the desk; a laptop still in today then saves */
  const D=desk();let n=nation();n.dd=fixedDesk(D,NOW+DAY);n.stk={n:1,d:D.ddDay(NOW+DAY)};
  let [m,old]=next(n,x=>{x._ddm='visit';x.tly.dm=1;x.tly.iss=7;});D.save(m,old,NOW+DAY);
  assert.equal(m.ddc,1);eq(m.dd.p,[1,1,1]);
  [m,old]=next(m,x=>{x._ddm='visit';x.tly.dm=2;x.tly.iss=9;});const notes=D.save(m,old,NOW);
  assert.equal(m.dd.d,D.ddDay(NOW+DAY),'the later day’s desk is kept');eq(m.dd.p,[1,1,1]);
  assert.equal(m.ddc,1,'and its land credit is not paid again: '+notes.join(' | '));
  assert.equal(m.stk.n,1,'nor does the earlier date count as another day of presence');
  /* the next desk comes once the laptop's date passes the desk's */
  [m,old]=next(m,x=>{x.tly.iss=10;});D.save(m,old,NOW+2*DAY);assert.equal(m.dd.d,D.ddDay(NOW+2*DAY));assert.equal(m.dd.w,undefined,'a fresh desk');assert.equal(m.ddc,1);
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

test('a rare task every day, harder than the three and not one of them where it can be, paying resources and 3 land credits',()=>{
  const D=desk(),n=nation();
  for(let i=1;i<=28;i++){const day='2026-11-'+String(i).padStart(2,'0'),q=D.ddRoll(n,day),r=D.ddRare(n,day,q);
    assert.ok(r&&D.DD_RARE[r.k],'there is always a rare task');eq(r,D.ddRare(n,day,q),'fixed by seed and date');
    assert.ok(!q.some(x=>x[0]===r.k),'not one of the three');assert.ok(r.g>=D.DD_RARE[r.k][0]&&r.g<=D.DD_RARE[r.k][1]);}
  let m=nation();m.dd={...fixedDesk(D),r:{k:'iss',g:3,c:0,p:0}};m.stk={n:1,d:D.ddDay(NOW)};
  let [a,old]=next(m,x=>{x.tly.iss=7;});D.save(a,old);assert.equal(a.dd.r.c,2);assert.equal(a.dd.r.p,0);
  [a,old]=next(a,x=>{x.tly.iss=8;});const notes=D.save(a,old);
  assert.ok(notes.some(s=>/Rare task done: Answer 3 edicts\. \+5 iron, \+10 oil, \+20 timber, \+30 food and \+3 land credits/.test(s)),notes.join(' | '));
  assert.equal(a.dd.r.p,1);assert.equal(a.ddr,1);assert.equal(D.earned(a),BASE+3,'three land credits');
  [a,old]=next(a,x=>{x.tly.iss=12;});D.save(a,old);assert.equal(a.ddr,1,'paid once');
  eq(D.reload(a).dd.r,{k:'iss',g:3,c:3,p:1});assert.equal(D.reload(a).ddr,1);
});
test('a desk drawn before the rare task existed gains one at its next save',()=>{
  const D=desk(),n=nation();n.dd=fixedDesk(D);n.stk={n:1,d:D.ddDay(NOW)};const [a,old]=next(n,()=>{});D.save(a,old);assert.ok(a.dd.r&&D.DD_RARE[a.dd.r.k]);
});

test('the weekly reset: a fresh desk on the same day pays another land credit, then waits seven days',()=>{
  const D=desk();let n=nation();n.dd=fixedDesk(D);n.dd.p=[1,1,1];n.dd.c=[2,1,1];n.dd.w=1;n.ddc=1;n.stk={n:1,d:D.ddDay(NOW)};
  assert.ok(D.ddxReady(n,NOW));
  const day=D.ddDay(NOW),f=D.ddFresh(n,day,':x'+NOW);assert.equal(f.d,day);eq(f.p,[0,0,0]);assert.ok(!f.w);
  n.dd={...fixedDesk(D),d:day};n.ddx=NOW;
  let [m,old]=next(n,x=>{x.tly.iss=7;x.tly.dm=1;});D.save(m,old);
  [m,old]=next(m,x=>{x._ddm='visit';});D.save(m,old);
  assert.equal(m.dd.w,1);assert.equal(m.ddc,2,'the reset desk earns its own credit');
  assert.ok(!D.ddxReady(m,NOW+6*864e5));assert.ok(D.ddxReady(m,NOW+7*864e5));
  assert.equal(D.reload(m).ddx,NOW,'the reset time survives a reload');
});

// ── the outfitters on the desk: an upgrade, a building that helps explorers, and (rare only) a lost place ──
const outfit=(ok=true)=>({xuDeskOk:()=>ok,xuNeeds:()=>ok?['outfit']:[],xuLostOk:()=>ok,xuByB:()=>({outfit:[],farm:[],warehouse:[]}),
  cxBldExtras:b=>({uu:b.uu}),whExtras:b=>({wu:b.wu}),SITES:[{c:1,k:'falls'},{c:2,k:'cove',lost:1}]});
const days=k=>Array.from({length:k},(x,i)=>new Date(2026,10,1+i).getFullYear()+'-'+String(new Date(2026,10,1+i).getMonth()+1).padStart(2,'0')+'-'+String(new Date(2026,10,1+i).getDate()).padStart(2,'0'));

test('the outfitters’ tasks join the draw when the nation can do them, and a lost place only as the rare task',()=>{
  const D=desk(outfit(true)),n=nation(),drawn=new Set(),rare=new Set();
  for(const day of days(90)){const q=D.ddRoll(n,day);for(const x of q)drawn.add(x[0]);const r=D.ddRare(n,day,q);if(r)rare.add(r.k);}
  assert.ok(drawn.has('xu')&&drawn.has('xpb'),'an upgrade and a building for explorers are among the three');
  assert.ok(!drawn.has('lost'),'a lost place is never one of the three');
  assert.ok(rare.has('lost')&&rare.has('xu')&&rare.has('xpb'),'all three can be the rare task');
  assert.equal(D.DD_TASKS.xu.t(1),'Start an upgrade at the outfitters');assert.equal(D.DD_TASKS.xu.t(2),'Start 2 upgrades at the outfitters');
  assert.equal(D.DD_TASKS.xpb.t(1),'Start a building or upgrade that helps your explorers');
  assert.equal(D.DD_TASKS.lost.t(1),'Send an expedition to a lost place');
});

test('nobody is asked for what they cannot do: no upgrade open, nothing to build, no lost place in reach',()=>{
  const D=desk(outfit(false)),n=nation();
  for(const day of days(60)){const q=D.ddRoll(n,day),r=D.ddRare(n,day,q);
    assert.ok(!q.some(x=>['xu','xpb','lost'].includes(x[0])),day);assert.ok(!r||!['xu','xpb','lost'].includes(r.k),day);}
});

test('an upgrade counts when one goes into the workshop',()=>{
  const D=desk(outfit()),old=nation(),n=structuredClone(old);
  assert.equal(D.ddDelta(n,old,'xu'),0);
  n.xuw={k:'gear',u:1,s:NOW,d:NOW+3600e3};assert.equal(D.ddDelta(n,old,'xu'),1);
  assert.equal(D.ddDelta(structuredClone(n),n,'xu'),0,'the same one does not count twice');
});

test('a building that helps explorers counts when it is started, or upgraded, or a Warehouse raised a level',()=>{
  const D=desk(outfit()),old=nation({cities:[{id:'cap',c:5,b:[{k:'farm',d:NOW-1},{k:'warehouse',d:NOW-1}]}]});
  let n=structuredClone(old);n.cities[0].b.push({k:'outfit',s:NOW,d:NOW+3600e3});assert.equal(D.ddDelta(n,old,'xpb'),1,'an Outfitters’ Guild');
  n=structuredClone(old);n.cities[0].b.push({k:'theatre',s:NOW,d:NOW+3600e3});assert.equal(D.ddDelta(n,old,'xpb'),0,'a theatre opens nothing');
  n=structuredClone(old);n.cities[0].b[0].uu={u:2,s:NOW,d:NOW+3600e3};assert.equal(D.ddDelta(n,old,'xpb'),1,'Farm Estates upgraded');
  n=structuredClone(old);n.cities[0].b[1].wu={l:1,s:NOW,d:NOW+3600e3};assert.equal(D.ddDelta(n,old,'xpb'),1,'a Warehouse raised a level');
  assert.equal(D.ddDelta(structuredClone(n),n,'xpb'),0,'and only once');
});

test('a lost place counts when an expedition, either team, sets out for one',()=>{
  const D=desk(outfit()),old=nation();
  let n=structuredClone(old);n.exp={s:0,t0:NOW,t1:NOW+1};assert.equal(D.ddDelta(n,old,'lost'),0,'an ordinary site');
  n=structuredClone(old);n.exp2={s:1,t0:NOW,t1:NOW+1};assert.equal(D.ddDelta(n,old,'lost'),1,'a pirate cove, by the second team');
  assert.equal(D.ddDelta(n,old,'exp'),1,'and it is an expedition too');
});

test('a desk of outfitters’ tasks is cleared by them, and reloads',()=>{
  const D=desk(outfit());let n=nation();n.stk={n:1,d:D.ddDay(NOW)};
  n.dd={d:D.ddDay(NOW),q:[['xu',1,'timber','iron'],['xpb',1,'oil','goods'],['visit',1,'timber','goods']],c:[0,0,0],p:[0,0,0],r:{k:'lost',g:1,c:0,p:0}};
  let [m,old]=next(n,x=>{x.xuw={k:'gear',u:1,s:NOW,d:NOW+3600e3};x.cities[0].b.push({k:'outfit',s:NOW,d:NOW+3600e3});x.exp={s:1,t0:NOW,t1:NOW+1};});
  const notes=D.save(m,old);
  eq(m.dd.p,[1,1,0]);assert.equal(m.dd.r.p,1,'the rare task, a lost place');
  assert.ok(notes.some(t=>/Desk task done: Start an upgrade at the outfitters/.test(t)));assert.ok(notes.some(t=>/Rare task done: Send an expedition to a lost place/.test(t)));
  const back=D.reload(m);eq(back.dd.q.map(q=>q[0]),['xu','xpb','visit']);assert.equal(back.dd.r.k,'lost');
});

// ── more tasks: fleeting parties, building upgrades, survey caches, field digs and (rare only) a new city ──
const more=(ok=true)=>({...outfit(ok),ddFleetOk:()=>ok,ddUpOk:()=>ok,ddSvcLeft:()=>ok?2:0,ddDigOk:()=>ok,ddCityOk:()=>ok,ddRumourOk:()=>ok,svcOpen:()=>ok?[[1],[2]]:[],
  RES:['food','timber','iron','oil','goods'],fmtWait:ms=>Math.round(ms/36e5)+' h',stockCap:()=>400});

test('the new everyday tasks are drawn among the three; a new city only as the rare task, and the legend-only ones never',()=>{
  const D=desk(more(true)),n=nation(),drawn=new Set(),rare=new Set();
  for(const day of days(120)){const q=D.ddRoll(n,day);for(const x of q)drawn.add(x[0]);const r=D.ddRare(n,day,q);if(r)rare.add(r.k);}
  for(const k of ['fleet','ugb','svc','dig'])assert.ok(drawn.has(k),k+' is among the three');
  for(const k of ['city','lost','desk','first'])assert.ok(!drawn.has(k),k+' is never among the three');
  for(const k of ['city','fleet','ugb','svc'])assert.ok(rare.has(k),k+' can be the rare task');
  assert.ok(!rare.has('desk')&&!rare.has('first'),'the legend-only tasks are never the rare one');
});

test('the new tasks count what a save adds',()=>{
  const D=desk(more()),old=nation({fl:[{k:'a',s:1}],dig:[{s:0,t0:1}],svc:{d:5,c:[[1,'food',3,1],[2,'iron',2,0]]},cities:[{id:'cap',c:5,b:[{k:'farm',d:NOW-1}]}],tly:{iss:5,claim:2,cities:1,first:0}});
  let n=structuredClone(old);n.fl.push({k:'b',s:2});assert.equal(D.ddDelta(n,old,'fleet'),1,'a party');
  n=structuredClone(old);n.cities[0].b[0].uu={u:1,s:NOW,d:NOW+1};assert.equal(D.ddDelta(n,old,'ugb'),1,'an upgrade');
  n=structuredClone(old);n.cities[0].b.push({k:'theatre',s:NOW,d:NOW+1});assert.equal(D.ddDelta(n,old,'ugb'),0,'a new building is not an upgrade');
  n=structuredClone(old);n.svc.c[1][3]=1;assert.equal(D.ddDelta(n,old,'svc'),1,'a cache dug today');
  n=structuredClone(old);n.svc={d:6,c:[[3,'food',3,0],[4,'oil',2,0]]};assert.equal(D.ddDelta(n,old,'svc'),0,'a new day’s caches, not yet dug');
  n=structuredClone(old);n.dig.push({s:1,t0:2});assert.equal(D.ddDelta(n,old,'dig'),1,'a field dig');
  n=structuredClone(old);n.tly.cities=2;assert.equal(D.ddDelta(n,old,'city'),1,'a new city');
  n=structuredClone(old);n.ddc=3;assert.equal(D.ddDelta(n,{...old,ddc:2},'desk'),1,'a desk cleared');
  n=structuredClone(old);n.tly.first=2;assert.equal(D.ddDelta(n,old,'first'),2,'two first discoveries');
});

test('a task with two survey caches never asks for more caches than the day has',()=>{
  const D=desk({...more(true),ddSvcLeft:()=>1,svcOpen:()=>[[1]]}),n=nation();
  for(const day of days(120)){const q=D.ddRoll(n,day).find(x=>x[0]==='svc');if(q)assert.equal(q[1],1,day);}
});

// ── the legendary task ──
const veteran=over=>nation({founded:NOW-30*DAY,...over});
const DDAY=(D,t)=>D.ddDay(t);

test('the week’s legendary task: one moment a week, fixed by the seed, hidden until then',()=>{
  const D=desk(more()),n=veteran(),W=D.ddWeekOf(NOW);
  assert.equal(W.k,'2026-10-26','the week starts on its Monday');
  const a=D.ddLegAt(n,W);assert.ok(a>=W.t&&a<W.t+7*DAY,'inside the week');assert.equal(a,D.ddLegAt(n,W),'fixed');
  const others=new Set(['s2','s3','s4','s5','s6'].map(seed=>D.ddLegAt(veteran({seed}),W)));assert.ok(others.size>=4,'a moment of its own for each nation');
  const L=D.ddLegRoll(n,W,a);assert.ok(L&&D.DD_LEG[L.k]);assert.equal(L.e,a+7*DAY,'seven days');
  assert.ok(L.g>=D.DD_LEG[L.k][0]&&L.g<=D.DD_LEG[L.k][1]||L.k==='iss');
  const m={...n,ddl:L};assert.equal(D.ddLegOn(m,a-1),null,'not before it appears');assert.ok(D.ddLegOn(m,a+1));assert.equal(D.ddLegOn(m,a+7*DAY+1),null,'and gone after seven days');
});

test('it appears at the first save after its moment, with a note and a bell, and only once that week',()=>{
  const D=desk(more()),n=veteran(),W=D.ddWeekOf(NOW),a=D.ddLegAt(n,W);
  let [m,old]=next(n,()=>{});const t0=W.t+1;if(t0<a){D.save(m,old,t0);assert.equal(m.ddl,undefined,'nothing to see before its moment');}
  [m,old]=next(m,()=>{});const notes=D.save(m,old,a+1000);
  assert.ok(m.ddl&&m.ddl.w===W.k&&m.ddl.a===a,'it is on the desk');assert.ok(notes.some(t=>/^A legendary task is on your desk: /.test(t)&&/\+15 land credits and 300 of every resource/.test(t)));
  assert.equal(D.notes(m,a+2000).length,1,'and in the bell');
  const k=m.ddl.k;[m,old]=next(m,()=>{});assert.ok(!D.save(m,old,a+3000).some(t=>/legendary task is on/.test(t)),'only once');assert.equal(m.ddl.k,k);
});

test('done in time it pays 15 land credits and 300 of every resource, even above the storage limit',()=>{
  const D=desk(more()),W=D.ddWeekOf(NOW),n=veteran({stock:{food:390,timber:20,oil:20,iron:20,goods:20}}),a=D.ddLegAt(n,W);
  n.ddl={w:W.k,k:'iss',g:3,c:0,p:0,a,e:a+7*DAY};
  let [m,old]=next(n,x=>{x.tly.iss+=2;});D.save(m,old,a+1000);assert.equal(m.ddl.c,2);assert.equal(m.ddl.p,0);
  const before=D.earned(m);
  [m,old]=next(m,x=>{x.tly.iss+=1;});const notes=D.save(m,old,a+2000);
  assert.equal(m.ddl.p,1);assert.equal(m.ddlc,1);assert.ok(notes.some(t=>/^Legendary task done: /.test(t)));
  assert.equal(m.stock.food,690,'300 more food, above a limit of 400');assert.equal(m.stock.goods,320);
  assert.equal(D.earned(m)-before,15,'15 land credits');
  assert.ok((m.ddk||[]).includes('iss'),'the kind of task is on record');
  [m,old]=next(m,x=>{x.tly.iss+=5;});D.save(m,old,a+3000);assert.equal(m.ddlc,1,'it pays once');
  assert.equal(D.notes(m,a+4000).length,0,'no bell once it is done');
  const back=D.reload(m);assert.equal(back.ddl.p,1);assert.equal(back.ddlc,1);
});

test('too late it pays nothing, and the task is gone',()=>{
  const D=desk(more()),W=D.ddWeekOf(NOW),n=veteran(),a=D.ddLegAt(n,W);n.ddl={w:W.k,k:'iss',g:3,c:2,p:0,a,e:a+7*DAY};
  const [m,old]=next(n,x=>{x.tly.iss+=5;});D.save(m,old,a+7*DAY+1000);
  assert.ok(!m.ddlc,'no credit after the seven days');assert.equal(D.ddLegOn(m,a+7*DAY+1000),null);
});

test('one at a time: a week whose moment falls while the last one is open waits for it',()=>{
  const D=desk(more()),W=D.ddWeekOf(NOW),W2=D.ddWeekOf(W.t+7*DAY+3600e3),n=veteran(),a1=W.t+6*DAY;n.ddl={w:W.k,k:'iss',g:30,c:0,p:0,a:a1,e:a1+7*DAY};
  const a2=D.ddLegAt(n,W2);
  if(a2<a1+7*DAY){let [m,old]=next(n,()=>{});D.save(m,old,Math.max(a2,W2.t)+1000);assert.equal(m.ddl.w,W.k,'the open one stays');
    [m,old]=next(m,()=>{});D.save(m,old,a1+7*DAY+1000);assert.equal(m.ddl.w,W2.k,'the next one comes when it ends');assert.ok(m.ddl.a>=a1+7*DAY-1,'with its seven days in full');}
  else{const [m,old]=next(n,()=>{});D.save(m,old,a2+1000);assert.equal(m.ddl.w,W2.k);}
});

test('none in a nation’s first week',()=>{
  const D=desk(more()),W=D.ddWeekOf(NOW),n=nation({founded:NOW-2*DAY});
  const [m,old]=next(n,()=>{});D.save(m,old,W.t+7*DAY-1);assert.equal(m.ddl,undefined);
});

test('the desk’s new achievements, with one obsidian',()=>{
  const A=[...source.matchAll(/achDef\('found','((?:desk|obs-desk)[a-z0-9-]*)','([bsgpxo])'/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(A,[['desk-compass','b'],['desk-kinds12','s'],['desk-rare10','s'],['desk-rare50','g'],['desk-leg1','g'],['desk-leg5','p'],['obs-desk','o']]);
  assert.match(source,/achDef\('found','obs-desk','o','Myth and Minutes','Finish 25 legendary desk tasks\.',25,x=>ddlcOf\(x\.n\),\{sec:OBS_HINT\}\);/);
});

// ── over the storage limit: a reward may overflow it; income adds nothing more until there is room ──
test('the legendary reward overflows the storage limit, and the overflow is on record, shrinking as it is used',()=>{
  const D=desk({...more(),stockCap:()=>400}),W=D.ddWeekOf(NOW),n=veteran({stock:{food:390,timber:20,oil:20,iron:20,goods:20}}),a=D.ddLegAt(n,W);
  n.ddl={w:W.k,k:'iss',g:1,c:0,p:0,a,e:a+7*DAY};
  let [m,old]=next(n,x=>{x.tly.iss+=1;});const notes=D.save(m,old,a+1000);
  assert.equal(m.stock.food,690);assert.equal(m.xs,290,'290 over a limit of 400');
  assert.ok(notes.some(t=>/over your storage: those resources earn nothing more until you use some, or a Warehouse makes room/.test(t)));
  [m,old]=next(m,x=>{x.stock.food=500;});D.save(m,old,a+2000);assert.equal(m.xs,100,'it follows the stock down');
  [m,old]=next(m,x=>{x.stock.food=380;});D.save(m,old,a+3000);assert.equal(m.xs,undefined,'and goes when nothing is over');
});

test('a reward that stays under the limit leaves no overflow on record',()=>{
  const D=desk({...more(),stockCap:()=>4000}),W=D.ddWeekOf(NOW),n=veteran(),a=D.ddLegAt(n,W);n.ddl={w:W.k,k:'iss',g:1,c:0,p:0,a,e:a+7*DAY};
  const [m,old]=next(n,x=>{x.tly.iss+=1;});D.save(m,old,a+1000);assert.equal(m.stock.food,320);assert.equal(m.xs,undefined);
});

test('the overflow on record is never more than the rewards could have given',()=>{
  const D=desk({...more(),stockCap:()=>400}),n=veteran({ddlc:1,xs:9999,stock:{food:5000,timber:20,oil:20,iron:20,goods:20}});
  assert.equal(D.reload(n).xs,300,'one legendary task: 300 at most');
  assert.equal(D.reload({...n,ddlc:2}).xs,600);
  assert.equal(D.reload({...n,ddlc:0}).xs,undefined,'none without one');
});

test('the load check allows stock above the limit by the overflow on record',()=>{
  const body=fn('auditNation');
  assert.match(body,/const lim=whLoadCap\(n\)\+xsOf\(n\)/);
  assert.match(body,/if\(num0\(n\.stock\[r\]\)>lim\)\{n\.stock\[r\]=lim;over=true;\}/);
  assert.match(source,/m\.m50=1;xsMark\(m,st,now\);/,'the fiftieth player’s gift is counted too');
});

test('income adds nothing to a resource over the limit, and fills the others up to it',()=>{
  const ctx=vm.createContext({RES:['food','timber','iron','oil','goods'],num0:v=>Number.isFinite(v)?v:0,DAY,whEntries:()=>[],whExtras:()=>({}),whCapFrom:()=>400});
  vm.runInContext(fn('whAccrue')+'\nthis.f=whAccrue;',ctx);
  const out=ctx.f({},{food:700,timber:100,iron:390,oil:0,goods:0},0,DAY,{food:50,timber:50,iron:50,oil:0,goods:0});
  assert.equal(out.food,700,'over the limit: no income, and nothing taken away');
  assert.equal(out.timber,150);assert.equal(out.iron,400,'up to the limit and no further');
});
