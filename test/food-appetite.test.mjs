// People eat the land they live on (2026-11-15): on top of what a nation's natural size eats, every hex of land it holds
// beyond that size eats FOOD_EAT food a day, so a nation that holds far more land than its population needs no longer
// drowns in food. Growth never gets faster for it: a fed nation keeps the food bonus it had, and only a nation that cannot
// feed the people on its land grows more slowly. The game's own economy(), run on a one-nation world.
// Run with: node --test test/food-appetite.test.mjs
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

/* one nation (pop in millions, claims or not) holding `land` hexes of land that each grow `yieldOf` food, plus `lakes`
   hexes of water; policies and building upkeep as given */
function world({pop=10,land=400,yieldOf=2.4,lakes=0,cm=1,budget,policies={},up={}}){
  const N=land+lakes+5,T=new Uint8Array(N),owner=new Int32Array(N).fill(-1);
  const C={food:new Float32Array(N),timber:new Float32Array(N),iron:new Float32Array(N),oil:new Float32Array(N)};
  for(let c=0;c<land;c++){T[c]=2;owner[c]=0;C.food[c]=typeof yieldOf==='function'?yieldOf(c):yieldOf;C.timber[c]=0.6;}
  for(let c=land;c<land+lakes;c++){T[c]=1;owner[c]=0;}
  const nation={name:'Testland',s:{econ:50,sci:40},policies};
  const Tr={list:[{id:'a',n:nation,pop,cm,budget}],owner,byId:{a:0}};
  const ctx={Math,Float64Array,Map,Object,Date,RES,MAP:{N,T},CELL_RES:C,S:{nation,world:{}},
    territory:()=>Tr,politics:()=>{},polMemo:{k:''},cityEpochKey:()=>'',collectDeals:()=>({active:[],pending:[]}),
    cityState:()=>({agg:[{add:zero(),up:{...zero(),...up},army:0,prosper:0,growth:0}]}),cabFx:()=>({army:0,prosper:0,growth:0}),
    BFX_HAND:null,RES_POL:{farmSubsidies:{food:1.15}},atWar:()=>false,c3Frozen:()=>false,alSame:()=>false,tyOf:()=>false};
  vm.createContext(ctx);
  vm.runInContext([line('const clamp = '),line('const budgetOf='),line('const CORE_HEXES='),line('const DEMAND='),line('const FOOD_EAT='),
    line('const foodEaten='),line('const foodGrowth='),line('const TIMBER_BURN='),line('const timberBurnt='),line('let econMemo='),line('function econSize('),cut('function economy(){','  return v;\n}')]
    .join('\n').replace(/^(const|let) /gm,'var '),ctx);
  return {ctx,E:ctx.economy(),nation};
}
/* the growth from food before the change: supply against what the natural size eats, ×1.25 at one and a half times it */
const oldGrowth=(E,ctx)=>{const d=E.dem.food[0]-E.eat[0];return ctx.clamp(0.5+0.5*Math.min(E.sup.food[0]/d,1.5),0.5,1.25);};

test('the people on every hex of land beyond the natural size eat 1.4 food a day',()=>{
  const {ctx,E}=world({pop:10,land:400});
  assert.equal(ctx.FOOD_EAT,1.4);
  const z=ctx.budgetOf(10);assert.equal(z,21,'a 10M nation’s natural size');
  assert.equal(E.held[0],400);
  assert.ok(near(E.eat[0],1.54*(400-z)),'1.4, and 10% more at 10M people');
  assert.ok(near(E.dem.food[0],z*ctx.DEMAND.food+1.54*(400-z)),'on top of what the natural size eats');
  for(const r of ['iron','oil','goods'])assert.ok(near(E.dem[r][0],z*ctx.DEMAND[r]),`${r} is untouched`);
  /* 960 grown, 48 + 584 eaten: about 330 spare, where it used to be over 900 */
  assert.ok(near(E.sup.food[0]-E.dem.food[0],960-48.3-583.66,1e-3));
});

test('a nation with no land beyond its natural size eats what it always did',()=>{
  for(const [pop,land,cm,budget] of [[10,21,1],[1,16,1],[1,9,1],[30,40,0,40]]){
    const {E}=world({pop,land,cm,budget});
    assert.equal(E.eat[0],0,`${land} hexes at ${pop}M`);
  }
  const npc=world({pop:30,land:40,cm:0,budget:40});assert.ok(near(npc.E.dem.food[0],40*2.3),'a nation without claims is sized by its budget');
});

test('only land eats: lakes held are not counted',()=>{
  const {E}=world({pop:10,land:100,lakes:30});
  assert.equal(E.held[0],100);assert.ok(near(E.eat[0],1.54*(100-21)));
});

test('a fed nation keeps its growth, and nobody grows faster than before',()=>{
  for(const yieldOf of [3.4,2.4,2.16,1.8,1.68,1.4,1.2,1,0.6,0.2])for(const [pop,land] of [[1,16],[5,81],[10,400],[27,561],[1000,800]]){
    const {ctx,E}=world({pop,land,yieldOf}),g=E.eff[0].growth,g0=oldGrowth(E,ctx);
    assert.ok(g<=g0+1e-12,`never faster: ${yieldOf} a hex, ${land} hexes, ${pop}M: ${g} > ${g0}`);
    if(E.ratio.food[0]>=1)assert.ok(near(g,g0),`a fed nation keeps its pace (${yieldOf}, ${land})`);
    assert.ok(g>=0.5,'never below half');
  }
});

test('average land stays fed at the full bonus; mountains go hungry and grow slower',()=>{
  const avg=world({pop:10,land:400,yieldOf:2.16*0.85});
  assert.ok(avg.E.ratio.food[0]>1.1&&avg.E.ratio.food[0]<1.25,`average land: ${avg.E.ratio.food[0]}`);
  assert.equal(avg.E.eff[0].growth,1.25);
  const hills=world({pop:10,land:400,yieldOf:1}),g=hills.E.eff[0].growth;
  assert.ok(hills.E.ratio.food[0]<0.75,'hills cannot feed their people');
  assert.ok(g<1.05&&g>0.9,`hungry: ${g} (it was ${oldGrowth(hills.E,hills.ctx)})`);
  const rock=world({pop:10,land:400,yieldOf:0.2});assert.ok(rock.E.eff[0].growth<0.65,'bare rock: barely grows');
});

test('Strategic Reserves still soften a shortage, and food policies still feed the land',()=>{
  const plain=world({pop:10,land:400,yieldOf:1}),res=world({pop:10,land:400,yieldOf:1,policies:{strategicReserves:1}});
  assert.ok(res.E.eff[0].growth>plain.E.eff[0].growth);
  const sub=world({pop:10,land:400,yieldOf:1,policies:{farmSubsidies:1}});
  assert.ok(sub.E.ratio.food[0]>plain.E.ratio.food[0]);
});

test('building upkeep is still eaten on top',()=>{
  const {E}=world({pop:10,land:400,up:{food:3}});
  assert.ok(near(E.dem.food[0],21*2.3+1.54*379+3));
});

test('the breakdown, the slow-food hint and Help all tell the player',()=>{
  assert.match(source,/used\.push\(\[`People out on your land \(\$\{fmt0\(k\)\} hex/);
  assert.match(source,/the people out on your land eat \$\{fmtAmt\(FOOD_EAT\)\} a hex a day, more than hills and mountains grow/);
  assert.match(source,/every hex of land you hold eats \$\{fmtAmt\(FOOD_EAT\)\} a day, \$\{Math\.round\(FOOD_TIER_K\*100\)\}% more at each of/);
  const brk=source.indexOf("used.push(['Your people'"),eat=source.indexOf('used.push([`People out on your land'),upk=source.indexOf("used.push(['Building upkeep'");
  assert.ok(brk>0&&eat>brk&&upk>eat,'your people, then the land, then upkeep');
});
