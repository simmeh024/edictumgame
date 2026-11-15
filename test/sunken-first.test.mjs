// A newcomer who has chosen no region starts in the Sunken Kingdoms, which also leads the founding lists (the owner,
// 15 Nov 2026: not the crowded Meridian Reach). Local test hosts keep Meridian, as do nations saved before regions.
// Runs the game's own FIRST_REG, HOME_REG and regionsForFounding.
//   node --test test/sunken-first.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const IDS = ['meridian', 'frostmarch', 'greywater', 'sunkenkingdoms', 'saffron'];

function game({ host, store = {}, modes = {} } = {}) {
  const ctx = vm.createContext({
    localStorage: { getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
    ...(host ? { location: { hostname: host } } : {}),
  });
  vm.runInContext(`
    const REGIONS=${JSON.stringify(IDS)}.map(id=>({id})),REG_BY_ID=Object.fromEntries(REGIONS.map(r=>[r.id,r]));
    const MODES=${JSON.stringify(modes)};function regMode(id){return MODES[id]||'enabled';}
    ${cut('/* the region a newcomer who has chosen none starts in', '/* Observer mode')}
    ${src.match(/^function regionsByAvail\(\)\{[^\n]*/m)[0]}
    ${src.match(/^function regionsForFounding\(\)\{[^\n]*/m)[0]}
    this.G={FIRST_REG,home:HOME_REG.id,list:()=>JSON.stringify(regionsForFounding().map(R=>R.id))};`, ctx);
  return ctx.G;
}

test('a newcomer on the live site starts in the Sunken Kingdoms', () => {
  const G = game({ host: 'edictumgame.com' });
  assert.equal(G.FIRST_REG, 'sunkenkingdoms');
  assert.equal(G.home, 'sunkenkingdoms');
});

test('local test hosts and a page without location keep Meridian', () => {
  for (const host of ['127.0.0.1', 'localhost', undefined]) {
    const G = game({ host });
    assert.equal(G.FIRST_REG, 'meridian', String(host));
    assert.equal(G.home, 'meridian', String(host));
  }
});

test('a chosen region and a saved nation still win', () => {
  assert.equal(game({ host: 'edictumgame.com', store: { 'statehood.region': 'frostmarch' } }).home, 'frostmarch');
  assert.equal(game({ host: 'edictumgame.com', store: { 'statehood.region': 'nowhere' } }).home, 'sunkenkingdoms');
  const nation = reg => JSON.stringify({ name: 'Ostria', ...(reg ? { reg } : {}) });
  assert.equal(game({ host: 'edictumgame.com', store: { 'statehood.nation.v1': nation('greywater') } }).home, 'greywater');
  assert.equal(game({ host: 'edictumgame.com', store: { 'statehood.nation.v1': nation('meridian') } }).home, 'meridian');
  assert.equal(game({ host: 'edictumgame.com', store: { 'statehood.nation.v1': nation() } }).home, 'meridian', 'a nation saved before regions lives in Meridian');
});

test('the founding lists start with the Sunken Kingdoms while it is open', () => {
  assert.deepEqual(JSON.parse(game({ host: 'edictumgame.com' }).list()), ['sunkenkingdoms', 'meridian', 'frostmarch', 'greywater', 'saffron']);
  assert.deepEqual(JSON.parse(game({ host: 'edictumgame.com', modes: { frostmarch: 'maintenance' } }).list()), ['sunkenkingdoms', 'meridian', 'greywater', 'saffron', 'frostmarch']);
  assert.deepEqual(JSON.parse(game({ host: 'edictumgame.com', modes: { sunkenkingdoms: 'maintenance' } }).list()), ['meridian', 'frostmarch', 'greywater', 'saffron', 'sunkenkingdoms']);
  assert.deepEqual(JSON.parse(game({ host: '127.0.0.1' }).list()), IDS);
});
