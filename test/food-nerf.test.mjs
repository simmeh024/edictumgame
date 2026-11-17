// Food nerf (2026-11-17, the owner picked "land ×0.85" and "eating grows with population"): every food yield of the land
// is 0.85 of what it was, and the people out on the land eat 10% more a hex at each of 10, 25, 50, 100 and 200M people.
// Run with: node --test test/food-nerf.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a));};
const near=(a,b,e=1e-9)=>Math.abs(a-b)<e;
const ctx={Math};vm.createContext(ctx);
vm.runInContext([line('const FOOD_EAT='),line('const foodEaten='),line('const FOOD_LAND=')].join('\n').replace(/(^|;)const /gm,'$1var '),ctx);

test('eating steps up by a tenth at 10, 25, 50, 100 and 200M people',()=>{
  for(const [pop,k] of [[0,1],[undefined,1],[9.9,1],[10,1.1],[24,1.1],[25,1.2],[57,1.3],[100,1.4],[250,1.5]])
    assert.ok(near(ctx.foodTier(pop),k),`${pop}M: ${ctx.foodTier(pop)}`);
  assert.ok(near(ctx.foodEaten(400,21,57),1.4*1.3*379));
  assert.equal(ctx.foodEaten(20,21,57),0,'nothing beyond the core, nothing eaten');
});

test('land grows 0.85 of the food it did, and the factor written into CELL_RES matches FOOD_LAND',()=>{
  assert.equal(ctx.FOOD_LAND,0.85);
  const a=source.indexOf('const CELL_RES=(()=>{'),b=source.indexOf('})();',a);
  assert.match(source.slice(a,b),/o\.food\[i\]\*=0\.85;/);
  assert.match(source,/CELL_RES\.food\[i\]\+=RV\.bonus\[i\]\*FOOD_LAND/,'river valleys too');
  assert.match(source,/CELL_RES\.food\[c\]=3\.4\*FOOD_LAND/,'reclaimed land too');
});

test('the breakdown names the step, and the economy passes the population in',()=>{
  assert.match(source,/eat\[i\]=foodEaten\(held\[i\],z,x\.pop\)/);
  assert.match(source,/t=foodTier\(x\.pop\)/);
});
