// Food spoilage (2026-11-12): a share of the food spoils on its way to the stockpile, so food gains are a little smaller.
// It is taken after the state's share (which would otherwise top a small surplus straight back up) and before the
// top-up while food is low; growth, trade and the other resources are untouched. The game's own code, piece by piece.
// Run with: node --test test/food-spoil.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b+to.length);};
const RES=['food','timber','iron','oil','goods'];
const N={stock:{food:200,timber:200,iron:200,oil:200,goods:200}};

/* the base rate (what is left over) and the "goods and iron, balanced" wrapper around it, with a one-nation economy */
function load({prod,dem}){
  const E={byDoc:new Map([[N,0]]),prod:{},exp:{},sup:{},dem:{}};
  for(const r of RES){E.prod[r]=[prod[r]];E.exp[r]=[0];E.sup[r]=[prod[r]];E.dem[r]=[dem[r]];}
  const ctx={RES,economy:()=>E,START_STOCK:{food:60,timber:45,iron:25,oil:10,goods:40},CITY_COST:{food:30,timber:30,goods:20},
    BUILDINGS:{mine:{cost:{timber:20,food:10}},well:{cost:{timber:10,iron:5,oil:0}}},MILESTONES:[],popNow:()=>0,Math};
  vm.createContext(ctx);
  vm.runInContext([line('const FOOD_SPOIL='),line('const num0='),line('function stockRates('),
    cut('const GB={','})(stockRates);')].join('\n').replace(/^const /gm,'var '),ctx);
  return ctx;
}

test('a small share of a big food surplus spoils, nothing else does',()=>{
  const c=load({prod:{food:100,timber:10,iron:5,oil:4,goods:8},dem:{food:20,timber:4,iron:2,oil:1,goods:3}});
  assert.ok(c.FOOD_SPOIL>0&&c.FOOD_SPOIL<=0.15,'a tiny nerf, not a big one');
  const rt=c.stockRates(N);
  assert.ok(Math.abs(rt.food-80*(1-c.FOOD_SPOIL))<1e-9,`food ${rt.food}`);
  assert.deepEqual([rt.timber,rt.iron,rt.oil,rt.goods],[6,3,3,5]);
});

test('the state’s share does not undo it: a nation living on the share loses the same tenth',()=>{
  const c=load({prod:{food:50,timber:0,iron:0,oil:0,goods:0},dem:{food:42,timber:0,iron:0,oil:0,goods:0}});
  const rt=c.stockRates(N);
  assert.ok(Math.abs(rt.food-c.GB.SHARE*50*(1-c.FOOD_SPOIL))<1e-9,`food ${rt.food}`);
});

test('the top-up while food is low still gives its full amount',()=>{
  const c=load({prod:{food:0,timber:0,iron:0,oil:0,goods:0},dem:{food:0,timber:0,iron:0,oil:0,goods:0}});
  const low={stock:{...N.stock,food:2}};c.economy().byDoc.set(low,0);
  assert.equal(c.stockRates(low).food,c.GB.TRICKLE);
});

test('the breakdown and Help both name the spoilage, and the breakdown takes it after the state’s share',()=>{
  const share=source.indexOf('add(`Top-up to the state’s share'),spoil=source.indexOf('stock.push([`Spoils on the way (${Math.round(FOOD_SPOIL*100)}%)`,-sp])'),low=source.indexOf("add('State top-up while it is low'");
  assert.ok(share>0&&spoil>share&&low>spoil,'share, then spoilage, then the low-food top-up');
  assert.match(source,/\(\$\{Math\.round\(FOOD_SPOIL\*100\)\}% of the food spoils on the way\)/);
});
