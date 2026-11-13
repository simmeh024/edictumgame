// Land credits for provinces (game/edictum.html): each province beyond the first is worth PRV_CREDITS land credits,
// counted on the most ever held so merging and re-adding earns nothing; five achievements follow the same count.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src.match(/const PRV_CREDITS=3;\n[^\n]*\n[^\n]*/)[0] + '\nglobalThis.G={prvPeak,prvCredits,PRV_CREDITS};', ctx);
const { prvPeak, prvCredits } = ctx.G;
const nat = k => ({ prov: { on: 1, l: Array.from({ length: k }, (_, i) => ({ id: i + 1 })) } });

test('one province earns nothing, each added one earns 3', () => {
  assert.equal(prvCredits(nat(1)), 0);
  assert.equal(prvCredits(nat(2)), 3);
  assert.equal(prvCredits(nat(6)), 15);
  assert.equal(prvCredits({}), 0);
  assert.equal(prvCredits({ npc: 1, prov: nat(5).prov }), 0);
});
test('peak is kept after a merge, so re-adding pays nothing more', () => {
  const n = nat(4); assert.equal(prvCredits(n), 9); assert.equal(n.prpk, 4);
  n.prov.l.pop(); assert.equal(prvCredits(n), 9);
  n.prov.l.push({ id: 9 }); assert.equal(prvCredits(n), 9);
  n.prov.l.push({ id: 10 }); assert.equal(prvCredits(n), 12);
  n.prov.on = 0; assert.equal(prvPeak(n), 5);
});
test('a loaded record keeps its peak (it was dropped on every load until 13 Nov 2026)', () => {
  const hook = src.match(/const PRV_PEAK_MAX=(\d+);\nNORM_HOOKS\.push\([^\n]*\);/);
  assert.ok(hook, 'the peak has a NORM hook beside prvCredits');
  assert.equal(Number(hook[1]), Number(src.match(/PRV_MAXL=(\d+)/)[1]), 'the cap is the most provinces a nation can hold');
  const k = vm.createContext({ NORM_HOOKS: [] }); vm.runInContext(hook[0], k);
  const load = d => { const n = {}; for (const h of k.NORM_HOOKS) h(n, d); return n; };
  assert.equal(load({ prpk: 24 }).prpk, 24, 'The Wandering Isles: 24 provinces at its peak, 6 now');
  assert.equal(load({ prpk: 999 }).prpk, 48, 'a doctored peak is held to the cap');
  for (const bad of [{}, { prpk: 0 }, { prpk: -3 }, { prpk: 2.5 }, { prpk: '24' }]) assert.equal(load(bad).prpk, undefined, JSON.stringify(bad));
  const n = { ...load({ prpk: 24 }), prov: nat(6).prov };
  assert.equal(prvCredits(n), 69, 'credits are paid on the kept peak, not the 6 held now');
  assert.match(src, /for\(const h of NORM_HOOKS\)\{try\{h\(n,d\);\}catch\(e\)\{\}\}/, 'normalize runs the hooks');
});
test('landEarned counts province credits and the achievements exist', () => {
  assert.match(src, /function landEarned\(n\)\{[^\n]*\+prvCredits\(n\)/);
  for (const id of ['prv-add1', 'prv-add4', 'prv-add8', 'prv-add15', 'prv-add23']) assert.ok(src.includes(`'${id}'`), id);
});
