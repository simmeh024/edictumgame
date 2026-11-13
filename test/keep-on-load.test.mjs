// Keep what a newer build saved (2026-11-13): an older tab used to drop, at load, every field and achievement its build
// did not know, and its next save wiped them (Eternia's new Claims Commissioner, a province peak written back by hand).
// Now an unknown achievement is kept as it was, and so is any field no code reads at load (game/edictum.html, normalize:
// n._fk), saved into the private half (src/shim.js, splitNation). Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const DAY = 864e5, NOW = 1.8e12, plain = x => JSON.parse(JSON.stringify(x)); // objects made in a vm context have its prototypes

test('achievements: unknown ids stay, known ones as before, nonsense goes', () => {
  const i = src.indexOf('const ACH_KEEP_EXTRA='), j = src.indexOf('\n});', i) + 4;
  const ctx = vm.createContext({ NORM_HOOKS: [], ACH: [{ id: 'a1' }, { id: 'a2' }], ACH_BY_ID: { a1: {}, a2: {} }, DAY, Date: { now: () => NOW } });
  vm.runInContext(src.slice(i, j).replace(/\bconst (ACH_KEEP_EXTRA)/, 'var $1'), ctx);
  const n = {}; ctx.NORM_HOOKS[0](n, { ach: { a1: 5, 'land-claim150': 7, a2: NOW + 5 * DAY, 'Bad Id!': 9, 'x-y': 'soon', 'zz-new': 0 } });
  assert.deepEqual(plain(n.ach), { a1: 5, 'land-claim150': 7, a2: NOW + DAY });
  const many = {}; for (let k = 0; k < ctx.ACH_KEEP_EXTRA + 50; k++) many['new-' + k] = 1;
  const m = {}; ctx.NORM_HOOKS[0](m, { ach: { ...many, a1: 1 } });
  assert.equal(Object.keys(m.ach).filter(k => k.startsWith('new-')).length, ctx.ACH_KEEP_EXTRA, 'bounded');
  assert.equal(m.ach.a1, 1, 'a known one is never pushed out by unknown ones ahead of it');
});

/* normalize with a stand-in loader that reads name, pop and old, and keeps name and pop */
function norm() {
  const i = src.indexOf('const FWD_MAX='), j = src.indexOf('\n}', src.indexOf('function normalize(d){', i)) + 2;
  const ctx = vm.createContext({ remapLegacy: d => d, normalizeR2: d => { const n = { name: d.name, pop: d.pop }; void d.old; if ('asked' in d) n.asked = 1; return n; }, JSON, Proxy, Reflect, Set });
  vm.runInContext(src.slice(i, j).replace(/\bconst (FWD_MAX)/, 'var $1'), ctx);
  return ctx;
}
test('fields no code reads are kept as they were and listed; read-and-dropped ones are not', () => {
  const k = norm(), d = { name: 'Isles', pop: 5, old: 3, asked: 0, prpk: 24, future: { a: [1, 2] }, _ts: 9, asmLocal: { h: [] } };
  const n = k.normalize(d);
  assert.deepEqual(plain(n), { name: 'Isles', pop: 5, asked: 1, prpk: 24, future: { a: [1, 2] }, _fk: ['prpk', 'future'] });
  assert.notEqual(n.future, d.future, 'a copy, not the record\'s own object');
  assert.equal(k.normalize({ name: 'x', pop: 1 })._fk, undefined, 'nothing unknown: no list');
  const p = k.normalize(JSON.parse('{"name":"x","pop":1,"__proto__":{"evil":1},"constructor":2}'));
  assert.equal(p.evil, undefined); assert.equal(p._fk, undefined);
});
test('bounded by count and size', () => {
  const k = norm(), d = { name: 'x', pop: 1 };
  for (let i = 0; i < k.FWD_MAX + 10; i++) d['f' + i] = i;
  assert.equal(k.normalize(d)._fk.length, k.FWD_MAX);
  const big = { name: 'x', pop: 1, huge: 'y'.repeat(k.FWD_SIZE + 1), small: 1 };
  assert.deepEqual(plain(k.normalize(big)._fk), ['small']);
});

test('the save puts kept fields in the private half, never _fk; loading joins them back', () => {
  const a = shim.indexOf('  function isObj('), b = shim.indexOf('\n', a);
  const i = shim.indexOf('  var NX_KEYS'), j = shim.indexOf('  function nationText(');
  const ctx = vm.createContext({});
  vm.runInContext(shim.slice(a, b) + '\n' + shim.slice(i, j) + '\nthis.splitNation=splitNation;this.joinNation=joinNation;', ctx);
  const d = { name: 'Isles', pop: 5, prpk: 24, future: 1, _fk: ['prpk', 'future'], _rev: 3, _dirty: true };
  const [pub, ext] = ctx.splitNation(d);
  assert.equal('prpk' in pub || 'future' in pub || '_fk' in pub, false, 'none of it in the shared half');
  assert.equal(ext.prpk, 24); assert.equal(ext.future, 1); assert.equal('_fk' in ext, false);
  const back = ctx.joinNation(pub, ext, null);
  assert.equal(back.prpk, 24); assert.equal(back.future, 1); assert.equal(back.name, 'Isles');
  const [pub2] = ctx.splitNation({ name: 'x', prpk: 24 });
  assert.equal(pub2.prpk, 24, 'a field this build knows as shared stays shared');
});
