import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),code=source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>'));
const tree=parse(code,{ecmaVersion:'latest'}),functions=new Map();let issues;
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration')functions.set(node.id.name,code.slice(node.start,node.end));if(node.type==='VariableDeclarator'&&node.id?.name==='ISSUES')issues=node.init;for(const [k,v] of Object.entries(node))if(k!=='start'&&k!=='end'){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}
walk(tree);
const edictNodes=issues.elements.filter(n=>n?.properties?.some(p=>p.key?.name==='id'&&['warehouse-racking','warehouse-archives'].includes(p.value?.value)));
const NOW=1800000000000,DAY=864e5,RES=['food','timber','iron','oil','goods'];
const json=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const n={name:'Storeland',seed:'one',founded:1,loc:0,stock:Object.fromEntries(RES.map(r=>[r,0])),stockAt:NOW-DAY,cities:[],policies:{},s:{econ:50,safety:50,culture:50,sci:50,tax:50,weird:50},log:[],lcb:0},other={name:'Otherland',seed:'two',founded:2,cities:[],policies:{}};
 const world={list:[{id:'me',n},{id:'other',n:other}],byId:{me:0,other:1},owner:new Int16Array(30).fill(0),occ:new Uint8Array(30)};
 class FixedDate extends Date{static now(){return NOW;}}
 const c=vm.createContext({Date:FixedDate,DAY,RES,MAX_CITIES:14,STOCK_CAP:400,START_STOCK:n.stock,BUILDINGS:{},POLICIES:{},NORM_HOOKS:[],COMMIT_HOOKS:[],HELP_EXT:[],document:{addEventListener(){}},
  num0:v=>typeof v==='number'&&Number.isFinite(v)?v:0,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),cityList:n=>n.cities||[],territory:()=>world,b1Mine:x=>x.seed===n.seed,myId:()=> 'me',b1Now:()=>NOW,
  bCost:()=>({timber:30,iron:20,goods:15}),cabFx:()=>({build:1}),cityLabel:(n,c)=>c.nm||'Capital',conflictsOf:()=>[],setMonarchy(){},stockRates:()=>Object.fromEntries(RES.map(r=>[r,400]))});
 const start=source.indexOf('const WH_BONUS='),end=source.indexOf('/* ── navigation memory,',start);assert(start>0&&end>start);
 vm.runInContext(source.slice(start,end)+'\nthis.bonuses=WH_BONUS;',c);
 vm.runInContext(functions.get('stockNow')+'\n'+functions.get('applyEffects')+'\nthis.edicts=['+edictNodes.map(n=>code.slice(n.start,n.end)).join(',')+'];',c);
 const warehouse=(cell,more={})=>{const b={k:'warehouse',s:NOW-3*DAY,d:NOW-2*DAY,a:1,...more};n.cities.push({id:'c'+cell,c:cell,nm:'City '+cell,b:[b]});return b;};
 return {n,other,world,c,warehouse};
}
test('a nation without a warehouse retains 400 capacity',()=>{const {n,c}=fixture();assert.equal(c.stockCap(n,NOW),400);assert.equal(c.whHasOwn(n),false);});
test('construction grants no storage before completion',()=>{const {n,c,warehouse}=fixture();warehouse(0,{d:NOW+1000});assert.equal(c.stockCap(n,NOW),400);assert.equal(c.whHasOwn(n),false);});
test('warehouse tiers add 400, 1200, 2400, 4400 and 7400 per resource',()=>{const {n,c,warehouse}=fixture(),b=warehouse(0);for(let i=0;i<5;i++){b.wl=i;assert.equal(c.stockCap(n,NOW),400+[400,1200,2400,4400,7400][i]);}});
test('different city warehouses add together without double counting duplicate cities',()=>{const {n,c,warehouse}=fixture();warehouse(0,{wl:2});warehouse(5,{wl:1});n.cities.push({...n.cities[0]});assert.equal(c.stockCap(n,NOW),400+2400+1200);});
test('lost warehouses stop contributing and captured warehouses work for their holder',()=>{const {n,other,world,c,warehouse}=fixture();warehouse(0,{wl:1});world.owner[0]=1;world.occ[0]=1;assert.equal(c.stockCap(n,NOW),400);assert.equal(c.stockCap(other,NOW),1600);});
test('unfinished upgrade retains the previous tier until its timer ends',()=>{const {n,c,warehouse}=fixture();warehouse(0,{wl:0,wu:{l:1,s:NOW-3600000,d:NOW+3600000,c:{timber:60}}});assert.equal(c.stockCap(n,NOW),800);assert.equal(c.stockCap(n,NOW+3600000),1600);});
test('upgrade material prices double at each tier, with increasing times',()=>{const {n,c}=fixture();let hours=0;for(let i=1;i<=4;i++){const q=c.whQuote(n,i);assert.deepEqual(json(q.cost),{timber:30*2**i,iron:20*2**i,goods:15*2**i});assert(q.hours>hours);hours=q.hours;}});
test('offline production cannot use a warehouse before it completes',()=>{const {n,c,warehouse}=fixture();warehouse(0,{d:NOW-DAY/2});const stock=c.stockNow(n,NOW);assert.equal(stock.food,400);n.stock.food=350;assert.equal(c.stockNow(n,NOW).food,600);});
test('offline accrual splits an upgrade at its actual completion time',()=>{const {n,c,warehouse}=fixture();n.stock.food=700;warehouse(0,{wl:0,wu:{l:1,s:NOW-2*DAY,d:NOW-DAY/2,c:{timber:60}}});assert.equal(c.stockNow(n,NOW).food,1000);});
test('final upgrade awards two credits once, including after serializing and reloading',()=>{const {n,c,warehouse}=fixture();const b=warehouse(0,{wl:3,wu:{l:4,s:NOW-DAY,d:NOW-1000,c:{timber:480}}});c.whSync(n,NOW);assert.equal(n.lcb,2);assert.equal(b.wl,4);assert.equal(b.wr,1);assert(!b.wu);c.whSync(n,NOW);assert.equal(n.lcb,2);const loaded=json(n);c.whSync(loaded,NOW);assert.equal(loaded.lcb,2);});
test('each separate warehouse can award its own final-tier credits',()=>{const {n,c,warehouse}=fixture();warehouse(0,{wl:4});warehouse(5,{wl:4});c.whSync(n,NOW);assert.equal(n.lcb,4);c.whSync(n,NOW);assert.equal(n.lcb,4);});
test('stored resources survive capacity loss without generating more over the cap',()=>{const {n,c,warehouse}=fixture();warehouse(0,{wl:4});n.stock.food=7000;n.whPeak=7800;n.cities=[];assert.equal(c.stockCap(n,NOW),400);assert.equal(c.stockNow(n,NOW).food,7000);assert.equal(c.whLoadCap(n),7800);assert.equal(c.stockLimit(n,'food',7100),7000);});
test('refunds and gifts can fill the expanded capacity',()=>{const {n,c,warehouse}=fixture();warehouse(0);n.stock.iron=450;assert.equal(c.stockLimit(n,'iron',600),600);assert.equal(c.stockLimit(n,'iron',999),800);});
test('malformed upgrades and tier jumps cannot survive normalization',()=>{const {c}=fixture();for(const wu of [{l:4,s:NOW,d:NOW+DAY,c:{iron:5}},{l:1,s:NOW,d:NOW,c:{iron:5}},{l:1,s:NaN,d:NOW+DAY,c:{iron:5}}])assert(!c.whExtras({k:'warehouse',wl:0,d:NOW-DAY,wu}).wu);assert.equal(c.whExtras({k:'warehouse',wl:999}).wl,4);assert.deepEqual(json(c.whExtras({k:'farm',wl:4})),{});});
test('valid pending upgrades and final reward markers round-trip',()=>{const {c}=fixture(),b={k:'warehouse',d:NOW-DAY,wl:2,wr:1,wu:{l:3,s:NOW,d:NOW+DAY,c:{timber:240,iron:160}}};assert.deepEqual(json(c.whExtras(b)),{wl:2,wr:1,wu:b.wu});});
test('two real warehouse edicts are gated by a completed, held warehouse',()=>{const {n,c,warehouse,world}=fixture();assert.equal(c.edicts.length,2);assert(c.edicts.every(e=>!e.req(n)));const b=warehouse(0,{d:NOW+1000});assert(c.edicts.every(e=>!e.req(n)));b.d=NOW-1000;assert(c.edicts.every(e=>e.req(n)));world.owner[0]=1;assert(c.edicts.every(e=>!e.req(n)));});
test('edict choices add or remove exactly 200 capacity and do not multiply per warehouse',()=>{const {n,c,warehouse}=fixture();warehouse(0);warehouse(5);const cap=c.stockCap(n,NOW);c.applyEffects(n,c.edicts[0].o[0].e);assert.equal(c.stockCap(n,NOW),cap+200);c.applyEffects(n,c.edicts[1].o[0].e);assert.equal(c.stockCap(n,NOW),cap);c.applyEffects(n,c.edicts[0].o[1].e);assert.equal(c.stockCap(n,NOW),cap-200);});

test('warehouse credit rewards extend the bonus limit and survive normalization',()=>{const {n,c,warehouse}=fixture();n.lcb=30;warehouse(0,{wl:4});c.whSync(n,NOW);assert.equal(n.lcb,32);assert.equal(c.whCreditCap(n),32);const loaded={cities:[]};for(const hook of c.NORM_HOOKS)hook(loaded,json(n));assert.equal(loaded.whLc,2);assert.equal(c.whCreditCap(loaded),32);assert.equal(c.whCreditCap({whLc:Infinity}),30);});

test('withdrawing a Games bid refunds into expanded Warehouse storage',()=>{const {n,c,warehouse}=fixture();warehouse(0);n.stock.iron=600;n.stockAt=NOW;n.games={bids:[{e:2}]};Object.assign(c,{S:{nation:n},edOf:()=>1,c3MyBid:()=>n.games.bids[0],c3Back:()=>({iron:50}),clone:json,roundStock:json,edName:()=> 'Games',commit:v=>{c.saved=v;},render(){},costText:()=> '50 iron',toast(){}});vm.runInContext(functions.get('c3Withdraw'),c);c.c3Withdraw();assert.equal(c.saved.stock.iron,650);assert.equal(c.saved.games.bids.length,0);});
