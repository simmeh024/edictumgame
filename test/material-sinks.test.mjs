// Food, timber and iron sinks (2026-11-22, the owner picked ideas 1, 2, 3, 4, 6, 13 and 14): big cities eat (CITY_EAT),
// the Cannery cans only food nothing else needs (CAN_FOOD, CAN_RATE), field rations are priced in days of the
// stockpile's gain, famines fall once a week on one computer nation, statues cost more for each one standing, and a
// road relaid as a railway costs MP_RAIL_UP a hex. The game's own code, run on small worlds.
// Run with: node --test test/material-sinks.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b+to.length);};
const RES=['food','timber','iron','oil','goods'];
const near=(a,b,e=1e-9)=>Math.abs(a-b)<e;
const zero=()=>({food:0,timber:0,iron:0,oil:0,goods:0});
const DAY=864e5;

/* one nation (pop in millions) holding `land` hexes that each grow `food` food, with cities of the given populations
   (millions) and canneries able to take `can` food a day */
function world({pop=10,land=400,food=2.4,cities=[],can=0,npc=false}){
  const N=land+5,T=new Uint8Array(N),owner=new Int32Array(N).fill(-1);
  const C={food:new Float32Array(N),timber:new Float32Array(N),iron:new Float32Array(N),oil:new Float32Array(N)};
  for(let c=0;c<land;c++){T[c]=2;owner[c]=0;C.food[c]=food;C.timber[c]=0.6;}
  const nation={name:'Testland',s:{econ:50,sci:40},policies:{}};
  const Tr={list:[{id:'a',n:nation,pop,cm:1,npc}],owner,byId:{a:0}};
  const agg={add:zero(),up:zero(),army:0,prosper:0,growth:0};if(can)agg.can=can;
  const ctx={Math,Float64Array,Map,Object,Date,RES,MAP:{N,T},CELL_RES:C,S:{nation,world:{}},GB:{SHARE:0.3},
    territory:()=>Tr,politics:()=>{},polMemo:{k:''},cityEpochKey:()=>'',collectDeals:()=>({active:[],pending:[]}),
    cityState:()=>({agg:[agg],all:cities.map(p=>({active:true,hi:0,population:p}))}),cabFx:()=>({army:0,prosper:0,growth:0}),
    BFX_HAND:null,RES_POL:{},atWar:()=>false,c3Frozen:()=>false,alSame:()=>false,tyOf:()=>false};
  vm.createContext(ctx);
  vm.runInContext([line('const clamp = '),line('const budgetOf='),line('const CORE_HEXES='),line('const DEMAND='),line('const FOOD_EAT='),
    line('const foodEaten='),line('const foodGrowth='),line('const TIMBER_BURN='),line('const timberBurnt='),line('const CITY_EAT='),
    line('const cityEaten='),line('const CAN_FOOD='),line('let econMemo='),line('function econSize('),cut('function economy(){','  return v;\n}')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  return {ctx,E:ctx.economy(),nation};
}

test('a city past its first million residents eats 1.5 food a day for every million more',()=>{
  const {ctx,E}=world({cities:[5,0.8,1,2.5]});
  assert.equal(ctx.CITY_EAT,1.5);
  assert.ok(near(E.ceat[0],1.5*(4+1.5)),'5M and 2.5M cities eat; the 0.8M and 1M ones do not');
  const {E:E0}=world({cities:[]});
  assert.ok(near(E.dem.food[0]-E0.dem.food[0],E.ceat[0]),'on top of what the nation already eats');
  for(const r of ['timber','iron','oil','goods'])assert.ok(near(E.dem[r][0],E0.dem[r][0]),`${r} is untouched`);
});

test('computer nations’ cities eat nothing extra',()=>{
  const {E}=world({cities:[6,4],npc:true});
  assert.equal(E.ceat[0],0);
});

test('fed big cities leave growth alone; hungry ones slow it, never speed it up',()=>{
  const fed=world({land:400,cities:[]}),big=world({land:400,cities:[8,6]});
  assert.ok(near(fed.E.eff[0].growth,big.E.eff[0].growth),'plenty of food: the same pace');
  const lean=world({land:400,food:1.6,cities:[]}),leanBig=world({land:400,food:1.6,cities:[30,20]});
  assert.ok(leanBig.E.eff[0].growth<lean.E.eff[0].growth,'short of food, the cities slow growth');
  assert.ok(leanBig.E.eff[0].growth<=lean.E.eff[0].growth);
});

test('a Cannery cans spare food into goods at four to one, out of what reaches the stockpile',()=>{
  const plain=world({land:400}),canned=world({land:400,can:20});
  assert.ok(near(canned.E.can[0],20),'a big surplus: the full 20');
  assert.ok(near(canned.E.sup.food[0],plain.E.sup.food[0]-20));
  assert.ok(near(canned.E.prod.goods[0],plain.E.prod.goods[0]+5),'20 food makes 5 goods');
  assert.ok(near(canned.E.eff[0].growth,plain.E.eff[0].growth),'growth never feels it');
  assert.ok(near(canned.E.dem.food[0],plain.E.dem.food[0]),'nor what the people eat');
});

test('a Cannery takes only what growth at its best and the state’s share leave over, and stops when food runs short',()=>{
  /* a lowland nation of 21 natural hexes on 200 hexes: a little over the state's share to spare */
  const tight=world({pop:10,land:200,food:2.4,can:200}),plain=world({pop:10,land:200,food:2.4});
  const E=tight.E,P=plain.E,d0=P.dem.food[0]-P.eat[0],fl=0.3*P.prod.food[0];
  const room=Math.max(0,Math.min(P.sup.food[0]-Math.max(1.5*d0,P.dem.food[0]),P.sup.food[0]-P.dem.food[0]-fl));
  assert.ok(room>1&&room<50,`some room (${room})`);
  assert.ok(near(E.can[0],room,1e-6),`takes ${room}, not the 200 it could`);
  assert.ok(near(E.sup.food[0]-E.dem.food[0],fl,1e-6),'down to the state’s share and no further');
  assert.ok(near(E.eff[0].growth,P.eff[0].growth),'growth unchanged');
  /* on 40 hexes the state's share already tops up what reaches the stockpile: canning would cost nothing, so none */
  assert.equal(world({pop:10,land:40,food:2.4,can:200}).E.can[0],0);
  const hungry=world({pop:10,land:400,food:1.2,can:50});
  assert.equal(hungry.E.can[0],0,'a hungry nation cans nothing');
});

test('famines fall once a week, three days each, on one computer nation, the same for every viewer',()=>{
  const ctx={Math,DAY,REG:{id:'meridian'},allNations:()=>['npc-b','npc-a','p1','npc-c'].map(id=>({id,npc:id.startsWith('npc')}))};
  vm.createContext(ctx);
  vm.runInContext([line('function hash(str)'),line('const FAM='),cut('function famAt(now){','\n}')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  const t0=Date.UTC(2026,10,22,12),seen=new Set();let on=0;
  for(let h=0;h<24*28;h++){const F=ctx.famAt(t0+h*36e5);assert.ok(['npc-a','npc-b','npc-c'].includes(F.id));assert.ok(ctx.FAM.need.includes(F.need));
    assert.equal(F.end-F.start,3*DAY);assert.equal(F.on,t0+h*36e5<F.end);if(F.on)on++;seen.add(F.w);}
  assert.equal(seen.size>=4&&seen.size<=5,true,'four weeks');
  assert.ok(Math.abs(on-12*24)<=72,`a famine three days in seven (${on} hours of 672)`);
  const a=ctx.famAt(t0),b=ctx.famAt(t0+36e5);if(a.w===b.w)assert.deepEqual([a.id,a.need,a.start],[b.id,b.need,b.start]);
});

test('field rations cost two days of the food stockpile’s gain, at least 60 and never more than most of the stores',()=>{
  const ctx={Math,DAY,gain:0,cap:400,stockRates:()=>({food:ctx.gain}),stockCap:()=>ctx.cap};
  vm.createContext(ctx);
  vm.runInContext([line('const clamp = '),line('const RAT='),line('function ratPrice(')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  ctx.gain=5;assert.equal(ctx.ratPrice({}),60);
  ctx.gain=100;assert.equal(ctx.ratPrice({}),200);
  ctx.gain=500;assert.equal(ctx.ratPrice({}),360,'90% of a 400 cap');
  ctx.cap=5000;assert.equal(ctx.ratPrice({}),1000);
  assert.equal(ctx.RAT.k*ctx.RAT.max,0.09,'+9% at most');
});

test('each statue costs half as much again as the first for every one standing, in iron and timber',()=>{
  const ctx={Math,Object};vm.createContext(ctx);
  vm.runInContext([cut('const STA_FIN={','\n};'),line('const STA_MAX='),line('function staCost(')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  for(const f of Object.keys(ctx.STA_FIN)){const c=ctx.staCost(0,f);assert.ok(c.iron>0&&c.timber>0,`${f} asks iron and timber`);}
  assert.deepEqual({...ctx.staCost(0,'iron')},{iron:60,timber:40});
  assert.deepEqual({...ctx.staCost(2,'iron')},{iron:120,timber:80});
  assert.ok(ctx.staCost(0,'gilded').goods>ctx.staCost(0,'bronze').goods,'finer finishes cost more');
  assert.equal(ctx.STA_MAX,8);
});

test('railways: sleepers cost timber, a relaid road pays timber and iron a hex, and track takes iron to keep up',()=>{
  const ctx={};vm.createContext(ctx);
  vm.runInContext([line('const MP_TYPES='),line('const MP_RAIL_UP=')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  assert.deepEqual({...ctx.MP_TYPES.rail.cost},{timber:2,iron:3,goods:2});
  assert.deepEqual({...ctx.MP_RAIL_UP},{timber:2,iron:3});
  assert.equal(ctx.MP_RAIL_IRON,0.1);
});

test('the new buildings and records are wired in',()=>{
  assert.match(source,/brewery:\{n:'Brewery',c:'soc',ugx:1,mood:6,/);
  assert.match(source,/cannery:\{n:'Cannery',c:'prod',ugx:1,can:CAN_FOOD,/);
  assert.match(source,/add\(7,'brewery'\);add\(8\.5,'cannery'\);/);
  for(const k of ['d.rat','d.fam','d.sta'])assert.ok(source.includes(k),`loading reads ${k}, so it stays in the shared half`);
  assert.ok(source.includes("famDeal(S.nation,id):1)*2)/2;"),'computer nations ask less of those who fed them');
});
