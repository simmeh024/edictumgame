// Firewood, and a dearer city (2026-11-15, the owner picked ideas 1 and 8 to nerf timber "a tiny bit"): the people out on a
// nation's land beyond its core burn TIMBER_BURN timber a hex a day, the same rule as the food they eat (FOOD_EAT), and
// founding a city costs 35 timber instead of 30. The game's own economy(), run on a one-nation world.
// Run with: node --test test/timber-firewood.test.mjs
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

/* one nation (pop in millions) holding `land` hexes of land that each grow `timber` timber and 2.4 food, plus `lakes`
   hexes of water */
function world({pop=10,land=400,timber=0.6,lakes=0,cm=1,budget,up={}}){
  const N=land+lakes+5,T=new Uint8Array(N),owner=new Int32Array(N).fill(-1);
  const C={food:new Float32Array(N),timber:new Float32Array(N),iron:new Float32Array(N),oil:new Float32Array(N)};
  for(let c=0;c<land;c++){T[c]=2;owner[c]=0;C.food[c]=2.4;C.timber[c]=timber;}
  for(let c=land;c<land+lakes;c++){T[c]=1;owner[c]=0;}
  const nation={name:'Testland',s:{econ:50,sci:40},policies:{}};
  const Tr={list:[{id:'a',n:nation,pop,cm,budget}],owner,byId:{a:0}};
  const ctx={Math,Float64Array,Map,Object,Date,RES,MAP:{N,T},CELL_RES:C,S:{nation,world:{}},
    territory:()=>Tr,politics:()=>{},polMemo:{k:''},cityEpochKey:()=>'',collectDeals:()=>({active:[],pending:[]}),
    cityState:()=>({agg:[{add:zero(),up:{...zero(),...up},army:0,prosper:0,growth:0}]}),cabFx:()=>({army:0,prosper:0,growth:0}),
    BFX_HAND:null,RES_POL:{},atWar:()=>false,c3Frozen:()=>false,alSame:()=>false,tyOf:()=>false};
  vm.createContext(ctx);
  vm.runInContext([line('const clamp = '),line('const budgetOf='),line('const CORE_HEXES='),line('const DEMAND='),line('const FOOD_EAT='),
    line('const foodEaten='),line('const foodGrowth='),line('const TIMBER_BURN='),line('const timberBurnt='),line('let econMemo='),
    line('function econSize('),cut('function economy(){','  return v;\n}')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  return {ctx,E:ctx.economy(),nation};
}
/* timber banked a day before any of this: what the land grows less what the natural size uses */
const spare=(E,i=0)=>E.sup.timber[i]-E.dem.timber[i];

test('the people on every hex of land beyond the natural size burn 0.1 timber a day',()=>{
  const {ctx,E}=world({pop:10,land:400});
  assert.equal(ctx.TIMBER_BURN,0.1);
  const z=ctx.budgetOf(10);assert.equal(z,21);
  assert.ok(near(E.burn[0],0.1*(400-z)));
  assert.ok(near(E.dem.timber[0],z*ctx.DEMAND.timber+0.1*(400-z)),'on top of what the natural size uses');
  assert.ok(near(E.eat[0],1.4*(400-z)),'the food the same people eat is unchanged');
  for(const r of ['iron','oil','goods'])assert.ok(near(E.dem[r][0],z*ctx.DEMAND[r]),`${r} is untouched`);
});

test('a nation with no land beyond its natural size burns nothing',()=>{
  for(const [pop,land,cm,budget] of [[10,21,1],[1,16,1],[1,9,1],[30,40,0,40]]){
    const {E}=world({pop,land,cm,budget});
    assert.equal(E.burn[0],0,`${land} hexes at ${pop}M`);
  }
});

test('lakes burn no firewood',()=>{
  const {E}=world({pop:10,land:100,lakes:30});
  assert.ok(near(E.burn[0],0.1*(100-21)));
});

test('a tiny nerf: about a seventh less banked on average land, and prosperity barely moves',()=>{
  /* Eternia-sized: 561 hexes at 27M people, 0.7 timber a hex on average */
  const {ctx,E}=world({pop:27,land:561,timber:0.7}),z=ctx.budgetOf(27);
  const before=561*0.7-z*ctx.DEMAND.timber,after=spare(E),cut=1-after/before;
  assert.ok(cut>0.1&&cut<0.18,`banked ${before.toFixed(1)} → ${after.toFixed(1)} a day (−${(cut*100).toFixed(1)}%)`);
  /* prosperity's timber term (0.04 × the ratio, up to 1.5): unchanged on lowland, average and hill land; only land of
     nothing but mountains (0.3 a hex) feels it, and by less than 1.5% of prosperity */
  for(const [pop,land] of [[1,16],[5,81],[10,400],[27,561],[1000,800]])for(const timber of [0.3,0.6,0.7,1.4]){
    const w=world({pop,land,timber}),r=w.E.ratio.timber[0],r0=w.E.sup.timber[0]/(w.E.dem.timber[0]-w.E.burn[0]);
    const q=Math.min(r,1.5),q0=Math.min(r0,1.5);
    assert.ok(q<=q0+1e-12,'never more prosperous');
    if(timber>=0.6)assert.ok(near(q,q0),`${land} hexes of ${timber}: ${r0} → ${r}`);
    else assert.ok(0.04*(q0-q)<0.015,`all mountains, ${land} hexes: ${r0} → ${r}`);
  }
});

test('building upkeep is still used on top',()=>{
  const {E}=world({pop:10,land:400,up:{timber:2}});
  assert.ok(near(E.dem.timber[0],21*0.8+0.1*379+2));
});

test('a city costs 35 timber, and a new nation can still pay for one from its starting stock',()=>{
  const obj=k=>new vm.Script('('+line(`const ${k}=`).slice(k.length+7).replace(/;$/,'')+')').runInNewContext(),cost=obj('CITY_COST');
  assert.deepEqual({...cost},{food:30,timber:35,goods:20});
  const start=obj('START_STOCK');
  for(const r in cost)assert.ok(start[r]>=cost[r],`${r}: ${start[r]} in hand, ${cost[r]} needed`);
});

test('the breakdown, the slow-timber hint and Help all tell the player',()=>{
  assert.match(source,/used\.push\(\[`Firewood for the people out on your land \(\$\{fmt0\(k\)\} hex\$\{k===1\?'':'es'\} beyond your core of \$\{fmt0\(econSize\(x\)\)\}, \$\{fmtAmt\(TIMBER_BURN\)\} each\)`,-E\.burn\[i\]\]\)/);
  assert.match(source,/timber:`A Sawmill or forest land helps \(the people out on your land burn \$\{fmtAmt\(TIMBER_BURN\)\} a hex a day as firewood\)\.`/);
  assert.match(source,/The same people burn \$\{fmtAmt\(TIMBER_BURN\)\} timber a hex a day as firewood, less than any land grows \(lowland 0\.6, hills 1\.4, mountains 0\.3\)\./);
  const brk=source.indexOf("used.push(['Your people'"),eat=source.indexOf('used.push([`People out on your land'),burn=source.indexOf('used.push([`Firewood for'),upk=source.indexOf("used.push(['Building upkeep'");
  assert.ok(brk>0&&eat>brk&&burn>eat&&upk>burn,'your people, the land, its firewood, then upkeep');
});
