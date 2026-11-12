// Food spoilage (2026-11-12): a share of the food spoils on its way to the stockpile, so food gains are a little smaller.
// It is taken after the state's share (which would otherwise top a small surplus straight back up) and before the
// top-up while food is low; growth, trade and the other resources are untouched. A Granary (one per nation) cuts the
// spoilage, each of its upgrades cuts it further, and a gold one stops it. The game's own code, piece by piece.
// Run with: node --test test/food-spoil.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b+to.length);};
/* from one place in the game to the end of the line that starts with last */
const through=(from,last)=>cut(from,last)+line(last).slice(last.length);
const RES=['food','timber','iron','oil','goods'];
const N={stock:{food:200,timber:200,iron:200,oil:200,goods:200}};
const near=(a,b)=>Math.abs(a-b)<1e-9;

/* the base rate (what is left over), the "goods and iron, balanced" wrapper around it and the Granary section, with a
   one-nation economy whose city aggregate holds a Granary at level gran (undefined: none) */
function load({prod,dem,gran}){
  const E={T:{},byDoc:new Map([[N,0]]),prod:{},exp:{},sup:{},dem:{}};
  for(const r of RES){E.prod[r]=[prod[r]];E.exp[r]=[0];E.sup[r]=[prod[r]];E.dem[r]=[dem[r]];}
  const ctx={RES,economy:()=>E,cityState:T=>{assert.equal(T,E.T,'the territory economy() worked from');return {agg:[gran===undefined?{}:{gran}]};},
    START_STOCK:{food:60,timber:45,iron:25,oil:10,goods:40},CITY_COST:{food:30,timber:30,goods:20},
    BUILDINGS:{mine:{cost:{timber:20,food:10}},well:{cost:{timber:10,iron:5,oil:0}}},MILESTONES:[{p:6,b:['mine']}],popNow:()=>0,Math,
    DC_GLYPH:{},nbCity(a,ct){a.seen=(a.seen||0)+1;}};
  vm.createContext(ctx);
  vm.runInContext([line('const FOOD_SPOIL='),line('const GRANARY_LEFT='),line('function foodSpoilAt('),line('const spoilPct='),line('const num0='),
    line('function stockRates('),through('const GB={','const granaryLine=')].join('\n').replace(/^const /gm,'var '),ctx);
  return ctx;
}
const flat={prod:{food:100,timber:10,iron:5,oil:4,goods:8},dem:{food:20,timber:4,iron:2,oil:1,goods:3}};

test('a small share of a big food surplus spoils, nothing else does',()=>{
  const c=load(flat);
  assert.ok(c.FOOD_SPOIL>0&&c.FOOD_SPOIL<=0.15,'a tiny nerf, not a big one');
  const rt=c.stockRates(N);
  assert.ok(near(rt.food,80*(1-c.FOOD_SPOIL)),`food ${rt.food}`);
  assert.deepEqual([rt.timber,rt.iron,rt.oil,rt.goods],[6,3,3,5]);
});

test('the state’s share does not undo it: a nation living on the share loses the same tenth',()=>{
  const c=load({prod:{food:50,timber:0,iron:0,oil:0,goods:0},dem:{food:42,timber:0,iron:0,oil:0,goods:0}});
  assert.ok(near(c.stockRates(N).food,c.GB.SHARE*50*(1-c.FOOD_SPOIL)));
});

test('the top-up while food is low still gives its full amount',()=>{
  const c=load({prod:{food:0,timber:0,iron:0,oil:0,goods:0},dem:{food:0,timber:0,iron:0,oil:0,goods:0}});
  const low={stock:{...N.stock,food:2}};c.economy().byDoc.set(low,0);
  assert.equal(c.stockRates(low).food,c.GB.TRICKLE);
});

test('a Granary cuts the spoilage, each upgrade cuts it more, and gold stops it',()=>{
  const spoil=[undefined,0,1,2,3,4,5].map(gran=>{const c=load({...flat,gran});return 1-c.stockRates(N).food/80;});
  assert.ok(near(spoil[0],0.1),'10% without one');
  assert.deepEqual(spoil.slice(1).map(v=>Math.round(v*1000)/10),[6,5,4,3,2,0]);
  for(let k=1;k<spoil.length;k++)assert.ok(spoil[k]<spoil[k-1],'every step helps');
});

test('the Granary: one per nation, unlocked at 6 million, upgradable, its best level recorded per nation',()=>{
  const c=load(flat),B=c.BUILDINGS.granary;
  assert.equal(B.one,1);assert.equal(B.c,'prod');assert.equal(B.icon,'silo');assert.ok(c.DC_GLYPH.silo);
  assert.ok(c.MILESTONES[0].b.includes('granary'));
  assert.match(B.d,/6% instead of 10%\. Each upgrade cuts it further \(5%, 4%, 3%, 2%\), and at gold none spoils at all\. One per nation\./);
  const a={};c.nbCity(a,{done:['farm']});assert.equal(a.gran,undefined,'no Granary, no level');
  c.nbCity(a,{done:['granary'],ug:{}});assert.equal(a.gran,0);
  c.nbCity(a,{done:['granary'],ug:{granary:3}});c.nbCity(a,{done:['granary'],ug:{granary:1}});assert.equal(a.gran,3,'the best one counts');
  assert.equal(a.seen,4,'the other city hooks still run');
  assert.equal(c.granaryLine(0),'6% of your food spoils instead of 10%');assert.equal(c.granaryLine(5),'no food spoils at all');
  const up=new Function('BUILDINGS',line('function cxUpgradable(')+';return cxUpgradable;')(c.BUILDINGS);
  assert.ok(up('granary'),'its upgrades can be fitted');
});

test('the breakdown, the building row and Help all name the spoilage, and the breakdown takes it after the state’s share',()=>{
  const share=source.indexOf('add(`Top-up to the state’s share'),spoil=source.indexOf('Spoils on the way (${spoilPct(f)}%'),low=source.indexOf("add('State top-up while it is low'");
  assert.ok(share>0&&spoil>share&&low>spoil,'share, then spoilage, then the low-food top-up');
  assert.match(source,/\(\$\{spoilPct\(FOOD_SPOIL\)\}% of the food spoils on the way: a Granary cuts that, and a gold one stops it\)/);
  assert.match(source,/if\(k==='granary'\)xs\.push\(\{t:granaryLine\(/);
  assert.match(source,/All five upgrades done: \$\{k==='granary'\?'no food spoils at all'/);
});
