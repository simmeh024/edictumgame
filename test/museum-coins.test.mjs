// Coins of the Reach (game/edictum.html, COL_SETS): its eight coins were Meridian's computer nations, which no other region
// has, so the set could never be finished outside Meridian. A region's own computer nations each give one instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = html.indexOf('const COL_RAR='), to = html.indexOf('\n', html.indexOf('for(const s of COL_SETS){COL_SET_BY_ID[s.id]=s;'));
assert.ok(from > 0 && to > from, 'the museum sets are found');

function museum(mer, npcs) {
  const tally = {};
  const ctx = vm.createContext({ REG_MER: mer, NPCS: npcs, DAY: 864e5, YEAR_MS: 365 * 864e5, tally,
    tallyOf: (n, k) => tally[k] || 0 });
  /* anything else the set definitions name is only called when an artefact is checked: a stand-in will do */
  const src = html.slice(from, to);
  const names = new Set([...src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const declared = new Set([...src.matchAll(/\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
  const stand = [...names].filter(x => !declared.has(x) && !(x in ctx) && !(x in globalThis) && !/^(if|for|while|switch|return|function|catch|typeof|new)$/.test(x));
  vm.runInContext(stand.map(x => `var ${x}=()=>0;`).join('') + src + '\nthis.sets=COL_SET_BY_ID;', ctx);
  return ctx;
}
const frost = [{ id: 'npc-frostmarch-brimvik', name: 'Brimvik' }, { id: 'npc-frostmarch-tvaborg', name: 'Tvaborg' }, { id: 'npc-frostmarch-a', name: 'Askvoll' },
  { id: 'npc-frostmarch-b', name: 'Borrnes' }, { id: 'npc-frostmarch-c', name: 'Corrvik' }, { id: 'npc-frostmarch-d', name: 'Dunhaugen' }];

test('outside Meridian, each of the region’s computer nations gives a coin, and the set can be finished', () => {
  const M = museum(false, frost), coins = [...M.sets.coins.items];
  const npcCoins = coins.filter(a => /^Trade with /.test(a.h));
  assert.deepEqual(npcCoins.map(a => a.n), ['The Brimvik Mark', 'The Tvaborg Crown', 'The Askvoll Florin', 'The Borrnes Thaler', 'The Corrvik Ducat', 'The Dunhaugen Shilling']);
  assert.ok(!coins.some(a => /Vellmark|Oskaloo/.test(a.n + a.h)), 'no Meridian coins');
  assert.deepEqual(npcCoins.map(a => a.id), ['co-vellmark', 'co-oskaloo', 'co-brennoch', 'co-karvesk', 'co-lucanto', 'co-tarrow'], 'under the same keys, in order');
  assert.equal(npcCoins[1].q.f({}), false);
  M.tally['dm:npc-frostmarch-tvaborg'] = 1;
  assert.equal(npcCoins[1].q.f({}), true, 'writing to Tvaborg earns its coin');
  assert.equal(coins[0].id, 'co-own', 'the nation’s own coin still comes first');
});

test('in Meridian the set is as it was', () => {
  const M = museum(true, []), coins = [...M.sets.coins.items];
  assert.ok(coins.some(a => a.n === 'The Vellmark Mark'));
  assert.equal(coins.filter(a => /^Trade with /.test(a.h)).length, 8);
});
