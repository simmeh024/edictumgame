// Iron harder to get, oil a little harder (2026-11-17, the owner: "nerf iron, needs to be harder to get, but not as hard as
// to get oil, oil also needs a small nerf"). Land iron ×0.85, oil deposits 5 → 4.5, Iron Mine and Ore Pits 25% less and
// burning 1 timber a day, Oil Wells +125%, and 30% of an upgrade's timber asked in iron instead.
// Run with: node --test test/iron-oil-nerf.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const has=s=>assert.ok(source.includes(s),s);

test('land yields: iron ×0.85 on every terrain and deposit, oil deposits 4.5',()=>{
  has('Y=[null,null,[2.4,0.6,0.17],[1,1.4,0.68],[0.2,0.3,1.87]]');
  has('const IRON_DEP_YIELD=3.5;');
  has('o.oil[i]=4.5;');
});

test('the mines yield 25% less and burn timber, the Oil Wells +125%',()=>{
  has("res:{iron:[0.75,1.1]},need:'hills',up:{timber:1}}");
  has("res:{iron:[0.375,0.75]},need:'flat',up:{timber:1}}");
  has("d:'Oil from deposits around the city +125%.'");
  has("res:{oil:[1.25,0]},need:'oil'}");
});

test('30% of an upgrade’s timber is asked in iron, nothing else moves',()=>{
  const a=source.indexOf('function ugIron('),b=source.indexOf('return c;}',a);
  const ctx={Math};vm.createContext(ctx);vm.runInContext(source.slice(a,b+10),ctx);
  assert.deepEqual({...ctx.ugIron({timber:22,goods:18})},{timber:15,goods:18,iron:7});
  assert.deepEqual({...ctx.ugIron({timber:10,iron:4})},{timber:7,iron:7});
  assert.deepEqual({...ctx.ugIron({goods:9})},{goods:9},'no timber, nothing moves');
  assert.deepEqual({...ctx.ugIron({timber:1})},{timber:1},'a single timber stays timber');
});
