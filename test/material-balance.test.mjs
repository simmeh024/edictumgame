// The 23 November balance: founding stores, guaranteed city income, and quoted/kept material prices.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>'));
const fns=new Map(),vars=new Map();
(function walk(n){
  if(!n||typeof n!=='object')return;
  if(n.type==='FunctionDeclaration'&&!fns.has(n.id.name))fns.set(n.id.name,code.slice(n.start,n.end));
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init&&!vars.has(n.id.name))vars.set(n.id.name,`const ${n.id.name}=${code.slice(n.init.start,n.init.end)};`);
  for(const [k,v] of Object.entries(n))if(k!=='start'&&k!=='end'){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
})(parse(code,{ecmaVersion:'latest'}));
const plain=v=>JSON.parse(JSON.stringify(v)),eq=(a,b)=>assert.deepEqual(plain(a),b);
const RES=['food','timber','iron','oil','goods'],DAY=864e5;
function prices(k=1){
  const c=vm.createContext({RES,cabFx:()=>({cost:k,build:1}),cxBuildK:()=>1});
  const constants=['START_STOCK','CITY_BASE_INCOME','BUILDINGS','BTIER','CX_UG','CX_UG_MAX','CX_WALL','WH_HOURS','WH_UP_K',
    'EL_COST','EL_GROW_C','EL_H','EL_GROW_H','EL_H_MAX'];
  const functions=['bMaterialCost','bCost','bHours','bTier','bTierList','cxUpList','ugIron','cxUpQuote','cxWallList','cxWallQuote','elList','elQuote','tierQuote','whQuote','paidClean','bPaid'];
  vm.runInContext([...constants.map(n=>vars.get(n)),...functions.map(n=>fns.get(n)),
    source.match(/^BUILDINGS\.warehouse=.*$/m)[0],
    'this.start=START_STOCK;this.base=CITY_BASE_INCOME;'].join('\n'),c);
  return c;
}
test('founding stocks give 60 goods and keep the other four resources',()=>{
  eq(prices().start,{food:60,timber:45,iron:25,oil:10,goods:60});
});
test('actual building quotes increase food, timber and oil, leaving iron and goods alone',()=>{
  const c=prices();
  eq(c.bCost({},'farm'),{timber:12,goods:8});
  eq(c.bCost({},'sawmill'),{food:15,goods:8});
  eq(c.bCost({},'factory'),{timber:18,iron:6});
  eq(c.bCost({},'spaceport'),{iron:60,oil:36,goods:60});
  eq(prices(.7).bCost({},'factory'),{timber:14,iron:4});
});
test('upgrades raise the final timber price once, after its existing iron split',()=>{
  const c=prices();
  eq(c.cxUpQuote({},{},'factory',1).cost,{timber:8,iron:5});
  eq(c.cxUpQuote({},{},'factory',5).cost,{timber:28,iron:23});
  eq(c.cxUpQuote({},{},'factory',5,2).cost,{timber:54,iron:46});
  eq(c.cxUpList('factory',5,0,2),plain(c.cxUpQuote({},{},'factory',5,2).cost));
  eq(c.whQuote({},1).cost,{timber:87,iron:48,goods:36});
  eq(c.elQuote({},{},'market',1).cost,{timber:27,goods:22});
  eq(c.elList('market',1),plain(c.elQuote({},{},'market',1).cost));
});
test('retools and city walls agree with the caps used to preserve paid costs',()=>{
  const c=prices();
  eq(c.tierQuote({},{},'factory',2).cost,{timber:216,iron:80,oil:48,goods:30});
  eq(c.bTierList('factory',2),plain(c.tierQuote({},{},'factory',2).cost));
  eq(c.cxWallQuote({},{},1).cost,{timber:24,iron:10});
  eq(c.cxWallList(1),plain(c.cxWallQuote({},{},1).cost));
  // A price paid before this change is kept; repricing does not invent extra refund materials.
  eq(c.bPaid({},{k:'factory',p:{timber:15,iron:6}}),{timber:15,iron:6});
});
test('space buildings include the surcharge on their displayed material and shipping quote',()=>{
  const c=prices();
  c.SP_BLDS={moon:{farm:{cost:{food:80,goods:40}}}};
  c.spShip=()=>({oil:20});
  vm.runInContext(fns.get('spCost'),c);
  eq(c.spCost({id:'moon'},'farm',null),{food:96,goods:40,oil:24});
});

function income(count=1,npc=false){
  const n={npc,stock:{food:60,timber:45,iron:25,oil:10,goods:60},stockAt:1000};
  const zero=()=>Object.fromEntries(RES.map(r=>[r,[0]]));
  const a={cities:count,add:Object.fromEntries(RES.map(r=>[r,0])),up:Object.fromEntries(RES.map(r=>[r,0]))};
  const T={list:[{n,pop:5}],owner:[],byId:{me:0}},E={T,byDoc:new Map([[n,0]]),prod:zero(),exp:zero(),sup:zero(),dem:zero()};
  const c=vm.createContext({RES,DAY,economy:()=>E,cityState:()=>({agg:[a],all:[]}),foodSpoilAt:()=>.2,
    popNow:()=>0,num0:v=>v||0,stockCap:()=>400,stockRates:()=>({food:0,timber:0,iron:0,oil:0,goods:7}),
    RES_POL:{},POLICIES:{},CELL_RES:{},MAP:{N:0},econSize:()=>0,DEMAND:Object.fromEntries(RES.map(r=>[r,0])),FOOD_SPOIL:.2,
    fmt0:String,fmtAmt:String,gbPopGoods:()=>0,whEntries:()=>[],whCapFrom:()=>400});
  vm.runInContext(vars.get('CITY_BASE_INCOME')+'\n'+vars.get('START_STOCK')+'\n'+vars.get('GB')+'\nconst GB_MIN={};',c);
  const begin=source.indexOf('stockRates=(f=>function(n){',source.indexOf('const GB=')),end=source.indexOf('})(stockRates);',begin)+15;
  vm.runInContext(source.slice(begin,end)+'\n'+fns.get('whAccrue')+'\n'+fns.get('stockNow')+'\n'+fns.get('rbdParts'),c);
  return {c,n,a,E};
}
test('each held active city adds the full daily income after food spoilage, including cities with no buildings',()=>{
  for(const count of [0,1,2,3]){
    const {c,n}=income(count);
    eq(c.stockRates(n),{food:2*count,timber:count,iron:0,oil:0,goods:7+count});
    eq(c.stockRates(n),plain(c.stockRates(n))); // repeated reads never accumulate the bonus
  }
  const {c,n}=income(3,true);
  eq(c.stockRates(n),{food:0,timber:0,iron:0,oil:0,goods:7});
});
test('offline stocks accrue the city income for two and three days and respect storage capacity',()=>{
  const {c,n}=income();
  eq(c.stockNow(n,1000+2*DAY),{food:64,timber:47,iron:25,oil:10,goods:76});
  eq(c.stockNow(n,1000+3*DAY),{food:66,timber:48,iron:25,oil:10,goods:84});
  assert.equal(c.stockNow(n,1000+100*DAY).goods,400);
});
test('the resource explanation identifies city income and sums to the actual daily total',()=>{
  const {c,n}=income(2);
  for(const r of ['food','timber','goods']){
    const p=c.rbdParts(n,r),base=p.stock.find(([label])=>label.startsWith('City base income'));
    assert.ok(base);
    assert.equal(base[1],r==='food'?4:2);
    assert.ok(Math.abs(p.stock.reduce((v,row)=>v+row[1],0)-p.tot)<1e-9);
  }
});
