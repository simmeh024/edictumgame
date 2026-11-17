// Building upgrades 20% dearer (2026-11-16, the owner: "Make upgrades of buildings 20% more expensive"): the five coloured
// upgrades, the Warehouse's four tiers and the economy levels after gold all cost 1.2 times what they did. Build times,
// what the upgrades give and the buildings' own prices are unchanged.
// Run with: node --test test/upgrades-dearer.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b+to.length);};
const OLD_UG=[0.4,0.6,0.9,1.3,1.8],OLD_EL=1.5;

/* the price functions, on made-up buildings (a keep and a tower whose prices floating point trips on) */
function load(){
  const ctx={Math,Object,BUILDINGS:{hall:{cost:{timber:25,iron:10,goods:7}},keep:{cost:{timber:225}},tower:{cost:{timber:50}},warehouse:{cost:{timber:30,iron:20,goods:15}}},
    bCost:(n,k)=>({...ctx.BUILDINGS[k].cost}),bHours:()=>4,cxBuildK:()=>1,cabFx:()=>({build:1})};
  vm.createContext(ctx);
  vm.runInContext([cut('const CX_UG=[','\n];'),line('const CX_UG_MAX='),line('function cxUpList('),line('function cxUpQuote('),
    line('const EL_FX='),line('function elList('),line('function elQuote(')+'\n  return {cost:c};}',
    line('const WH_BONUS='),line('function whQuote(')].join('\n').replace(/^(const|let) /gm,'var '),ctx);
  return ctx;
}

/* since 2026-11-17 30% of an upgrade's timber is asked in iron instead (ugIron): the prices below are the timber-only ones, moved */
const ug=c=>{c={...c};const t=c.timber||0;if(t>=2){const x=Math.round(t*0.3);c.timber=t-x;c.iron=(c.iron||0)+x;}return c;};
test('the five coloured upgrades cost 1.2 times what they did',()=>{
  const G=load();
  assert.deepEqual([...G.CX_UG].map(u=>u.cost),[0.48,0.72,1.08,1.56,2.16]);
  G.CX_UG.forEach((u,i)=>assert.ok(Math.abs(u.cost-OLD_UG[i]*1.2)<1e-12,u.c));
  assert.deepEqual([...G.CX_UG].map(u=>u.h),[0.5,0.8,1.2,1.7,2.4],'build times unchanged');
  assert.deepEqual([...G.CX_UG].map(u=>u.fx),[0.1,0.15,0.2,0.25,0.3],'what they give unchanged');
});

test('prices round up to whole units, without floating-point dust adding one',()=>{
  const G=load();
  assert.deepEqual({...G.cxUpQuote({},{},'hall',3).cost},ug({timber:27,iron:11,goods:8}));
  /* 225 × 1.08 is 243.00000000000003 and 50 × 1.8 × 1.3 is 117.00000000000001 in floating point: 243 and 117, not one more */
  assert.deepEqual({...G.cxUpQuote({},{},'keep',3).cost},ug({timber:243}));assert.deepEqual({...G.cxUpList('keep',3)},ug({timber:243}));
  assert.deepEqual({...G.elList('tower',2)},{timber:117});assert.deepEqual({...G.elQuote({},{},'tower',2).cost},{timber:117});
  assert.deepEqual({...G.cxUpList('hall',3)},ug({timber:27,iron:11,goods:8}),'the refund cap matches the price');
  assert.deepEqual({...G.cxUpQuote({},{},'hall',5).cost},ug({timber:54,iron:22,goods:16}));
});

test('the economy levels after gold start at 1.8 times the building, up from 1.5',()=>{
  const G=load();
  assert.equal(G.EL_COST,1.8);assert.ok(Math.abs(G.EL_COST-OLD_EL*1.2)<1e-12);
  assert.deepEqual({...G.elList('hall',1)},{timber:45,iron:18,goods:13});
  assert.deepEqual({...G.elQuote({},{},'hall',1).cost},{...G.elList('hall',1)});
  assert.deepEqual({...G.elList('hall',2)},{timber:59,iron:24,goods:17},'each level 1.3 times the last, as before');
});

test('the Warehouse’s tiers cost 1.2 times what they did',()=>{
  const G=load();
  assert.equal(G.WH_UP_K,1.2);
  for(let to=1;to<=4;to++)assert.deepEqual({...G.whQuote({},to).cost},{timber:36*2**to,iron:24*2**to,goods:18*2**to},`tier ${to+1}`);
});
