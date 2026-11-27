// The Hall of Edicts (game/edictum.html, halTally and its rewards): the region's fourth wonder, after the Great Dam.
// Twenty-five phases and 35,000 resources (food 8,000, goods 10,000, timber 6,500, iron 6,500, oil 4,000), at least four
// nations per phase (30% cap), 2 land credits for every finished phase a nation gave 5% of, 20/15/10/5/3 more for the top
// five at the opening, and once open the region's Assembly rulebook holds one resolution more, on the page and in the
// server's Assembly engine (functions/assembly-engine.js, built by tools/build-civic.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemblyEngine } from '../functions/assembly-engine.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const core0 = html.indexOf('/* hall-core */'), core1 = html.indexOf('/* hall-core end */');
const from = html.indexOf('const HAL_LAND='), to = html.indexOf('\nlandEarned=(f=>function(n){return f.apply(this,arguments)+halLand(n);})(landEarned);');
assert.ok(core0 > 0 && core1 > core0 && from > core1 && to > from, 'the hall code is found');

function hall(nations, damOpen = true) {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], REG: { id: 'meridian' }, regText: s => s,
    num0: v => Number(v) || 0, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), list: nations, DAM_N: 20, WND_HAP_JOIN: 3600e3,
    damState: () => ({ done: damOpen ? 20 : 19, end: damOpen ? 5 : 0, ft: [] }), fmt0: v => String(v), cap1: s => s.charAt(0).toUpperCase() + s.slice(1),
    asmT0: c => c * 1000, asmBookPlus: null });
  vm.runInContext(html.slice(core0, core1) + html.slice(from, to) + '\nconst allNations=()=>list;Object.assign(this,{state:halState,PH:HAL_PH,N:HAL_N,cap:halCapOf,share:halShareOf,raise:halRaise,land:halLand,top:halTop,keep:halKeep,open:halOpen,TOTAL:HAL_TOTAL,tally:halTally});', ctx);
  return ctx;
}
const rec = (id, p, ph = 0, extra = {}) => ({ id, n: { name: id, hal: { r: 'meridian', p, ph, t: 1, t0: 1, ...extra } } });

test('twenty-five phases, 35,000 in all, and every phase needs four nations', () => {
  const H = hall([]);
  assert.equal(H.N, 25);
  const by = {};
  for (const p of H.PH) for (const [r, v] of Object.entries(p[2])) by[r] = (by[r] || 0) + v;
  assert.equal(JSON.stringify(by, Object.keys(by).sort()), JSON.stringify({ food: 8000, goods: 10000, iron: 6500, oil: 4000, timber: 6500 }));
  assert.equal(H.TOTAL, 35000);
  for (let i = 0; i < H.N; i++) {
    const tot = Object.values(H.PH[i][2]).reduce((a, b) => a + b, 0);
    assert.ok(3 * H.cap(i) < tot, `three nations at the cap cannot fill phase ${i + 1}`);
    assert.ok(4 * H.cap(i) >= tot, `four can fill phase ${i + 1}`);
    assert.equal(H.share(i), Math.ceil(tot * 0.05));
  }
});

test('four nations finish a phase, three cannot', () => {
  const need = { food: 300, timber: 100, goods: 500 };
  const four = hall([rec('a', { 0: { goods: 270 } }), rec('b', { 0: { goods: 230, food: 40 } }), rec('c', { 0: { food: 260, timber: 10 } }), rec('d', { 0: { timber: 90 } })]).state();
  assert.equal(four.done, 1);
  const three = hall([rec('a', { 0: need }), rec('b', { 0: { food: 1 } }), rec('c', { 0: { goods: 1 } })]).state();
  assert.equal(three.done, 0);
  assert.equal(three.hands, 3);
});

test('closed until the dam is open, unless someone has already given', () => {
  assert.equal(hall([], false).open(), false);
  assert.equal(hall([], true).open(), true);
  assert.equal(hall([rec('a', { 0: { food: 5 } })], false).open(), true);
});

test('2 land credits for every finished phase a nation gave 5% of, noted once each', () => {
  const H = hall([]);
  /* phase 1 (900) needs 45, phase 2 (900) 45, phase 3 (1,100) 55 */
  const n = { hal: { r: 'meridian', p: { 0: { goods: 45 }, 1: { food: 44 }, 2: { iron: 60 } }, ph: 0 }, log: [] };
  const got = H.raise(n, 3, 9);
  assert.equal(got.length, 2, 'phases 1 and 3, not 2 (44 of 45)');
  assert.deepEqual(n.log.map(l => l.k + ':' + l.a), ['halr:2', 'halr:0']);
  assert.equal(H.land(n), 4);
  assert.equal(H.raise(n, 3, 10).length, 0, 'paid once');
  n.hal.p[3] = { goods: 1000 };
  H.raise(n, 4, 11);
  assert.equal(H.land(n), 6);
});

test('the top five at the opening are placed 1 to 5; the sixth is marked lower, once', () => {
  const big = i => { const p = {}; for (let d = 0; d < 25; d++) p[d] = { goods: 200 - i }; return p; };
  const L = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ ...rec(id, big(i), 25), me: false }));
  for (let i = 0; i < 6; i++) {
    L.forEach((x, j) => { x.me = j === i; });
    const H = hall(L), n = JSON.parse(JSON.stringify(L[i].n));
    n.hal.ph = 24; n.log = [];
    H.raise(n, 25, 7);
    assert.equal(H.top(n), i < 5 ? i + 1 : 0, `place ${i + 1}`);
    assert.equal(n.hal.kn || 0, i < 5 ? 0 : 1);
    assert.equal(n.log.filter(l => l.k === 'halk').length, i < 5 ? 1 : 0);
    assert.equal(H.raise(n, 25, 8).length, 0, 'placed once');
  }
});

test('the top five earn 20, 15, 10, 5 and 3 land credits on top of their phases', () => {
  const big = i => { const p = {}; for (let d = 0; d < 25; d++) p[d] = { goods: 200 - i }; return p; };
  const L = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ ...rec(id, big(i), 25), me: false }));
  const H0 = hall(L);
  for (let i = 0; i < 6; i++) {
    L.forEach((x, j) => { x.me = j === i; });
    const H = hall(L), n = JSON.parse(JSON.stringify(L[i].n));
    n.hal.ph = 0; n.log = [];
    H.raise(n, 25, 7);
    const phases = Array.from({ length: 25 }, (_, d) => d).filter(d => 200 - i >= H0.share(d)).length;
    assert.equal(H.land(n), 2 * phases + [20, 15, 10, 5, 3, 0][i], `place ${i + 1}: ${phases} phases`);
  }
});

test('a nation that moves keeps what it earned at the old hall', () => {
  const H = hall([]);
  const n = { hal: { r: 'meridian', p: { 0: { goods: 100 }, 1: { goods: 100 } }, ph: 25, k: 2 } };
  assert.equal(H.land(n), 4 + 15);
  H.keep(n); n.hal = { r: 'greywater', p: {}, ph: 0 };
  assert.equal(H.land(n), 19);
  assert.equal(H.top(n), 2);
});

test('the opening: dated at the finishing gift, and the page’s rulebook holds one more from that cycle', () => {
  const p = {}; for (let d = 0; d < 25; d++) p[d] = { goods: 1 };
  const L = [rec('a', p, 25, { fx: { 24: 5500 }, t: 6000 })];
  const H = hall(L);
  assert.equal(H.state().at, 5500);
  /* asmT0(c) is c × 1000 here: cycle 4 closes at 5,000, before the opening; cycle 5 closes at 6,000, after it */
  assert.equal(H.asmBookPlus(4), false);
  assert.equal(H.asmBookPlus(5), true);
  assert.equal(hall([rec('a', { 0: { goods: 900 } }, 1)]).state().at, 0, 'not open while building');
});

test('the server’s Assembly engine keeps six resolutions once the region’s hall is open, five before', () => {
  const cats = ['env', 'trade', 'rights', 'tax', 'sci', 'decency', 'borders'];
  const bk = cats.slice(0, 6).map((cat, i) => ({ k: 'k' + i, c: i, ti: 'T' + i, cat, g: 0, by: 'x' }));
  const lock = c => ({ c, f: 1, ok: 1, k: 'k6', ti: 'T6', cat: cats[6] });
  const p = {}; for (let d = 0; d < 25; d++) p[d] = { goods: 1 };
  const T0 = Date.UTC(2026, 0, 5), P = 3 * 86400000;
  const opened = T0 + 100 * P + 5000;
  const recs = hal => [{ id: 'u1', n: { name: 'A', reg: 'meridian', founded: 1, s: {}, flag: {}, gw: {}, civicAt: 1, lastSave: 1, asm: { r: 'meridian', e: [], s: [], v: [] }, ...(hal ? { hal } : {}) } }];
  const before = assemblyEngine('meridian', recs(null));
  assert.equal(before.bookStep(bk.slice(0, 5), lock(100)).bk.length, 5, 'no hall: five');
  const open = assemblyEngine('meridian', recs({ r: 'meridian', p, ph: 25, t: opened, fx: { 24: opened } }));
  assert.equal(open.bookStep(bk.slice(0, 5), lock(99)).bk.length, 5, 'a cycle that closed before the opening: five');
  const six = open.bookStep(bk.slice(0, 5), lock(100));
  assert.equal(six.bk.length, 6, 'the cycle the hall opened in: six');
  assert.equal(six.bx.length, 0, 'nothing retired');
  assert.equal(open.bookStep(bk, lock(101)).bk.length, 6, 'a seventh retires the oldest');
  const other = assemblyEngine('meridian', recs({ r: 'greywater', p, ph: 25, t: opened, fx: { 24: opened } }));
  assert.equal(other.bookStep(bk.slice(0, 5), lock(100)).bk.length, 5, 'another region’s hall does not count');
  const junk = assemblyEngine('meridian', recs({ r: 'meridian', p: 'x', ph: 'y', fx: 7 }));
  assert.equal(junk.bookStep(bk.slice(0, 5), lock(100)).bk.length, 5, 'a broken record is ignored');
});

test('the hall edicts: one every five phases, purple, never drawn at random, after every other edict', () => {
  const ids = [...html.matchAll(/\{id:'(hall-[a-z]+)',c:'[a-z]+',hal:1,at:(\d+)/g)].map(m => [m[1], +m[2]]);
  assert.deepEqual(ids.map(x => x[1]), [5, 10, 15, 20, 25]);
  assert.match(html, /for\(const is of HAL_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\)/, 'kept out of the random draw (fo)');
  assert.match(html, /\.issue-item:has\(\.edict-hall\) \.issue-card\{border-color:var\(--hall-purple\)/);
  /* after every older edict; only the sacking edicts (27 November, sacking-edicts.test.mjs) come after the hall's */
  const sk = html.indexOf('/* ───────── sacking edicts:'), pushes = [...html.matchAll(/ISSUES\.push\(/g)].map(m => m.index).filter(i => sk < 0 || i < sk);
  assert.equal(pushes[pushes.length - 1], html.indexOf('for(const is of HAL_ISSUES){is.fo=1;ISSUES.push(is)') + 'for(const is of HAL_ISSUES){is.fo=1;'.length, 'the last edicts added before the sacking edicts');
  if (sk >= 0) assert.ok(html.indexOf('for(const is of HAL_ISSUES)') < sk, 'the sacking edicts come after the hall');
});

test('the generated Assembly engine carries the same hall tally as the page', () => {
  const engine = fs.readFileSync(new URL('../functions/assembly-engine.js', import.meta.url), 'utf8');
  assert.ok(engine.includes(html.slice(core0, core1)), 'run node tools/build-civic.mjs');
  assert.match(engine, /const asmBookPlus=c=>HALL_AT>0&&HALL_AT<asmT0\(c\+1\);/);
});
