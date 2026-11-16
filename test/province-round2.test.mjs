// Provinces, round two (game/edictum.html, 16 November 2026): seven achievements for running provinces well
// (every governor Devoted, Home Rule kept a week, full councils, an island province, a province of a million and of
// ten million people), and the date a division's autonomy last changed (q.at), which Home Rule counts from.
// The achievement section runs here as written, against made-up divisions; prvNorm runs as written too.
//   node --test test/province-round2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const START = '/* provinces, round two (16 November 2026)', END = '/* provinces, round two: end */';
const at = html.indexOf(START), end = html.indexOf(END, at);
assert.ok(at > 0 && end > at, 'the section beside the other province achievements');
const BLOCK = html.slice(at, end);
const DAY = 86400000, NOW = Date.UTC(2026, 10, 16, 12);

/* a nation of made-up divisions: each p has q (the saved division), cells, pop, a loyalty and maybe dorm */
function world() {
  const A = {}, W = { N: null, I: { id: new Map(), main: -1 }, on: true };
  const ctx = vm.createContext({
    Math, Object, Array, Number, DAY, W,
    achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
    achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), achYes: v => v ? 1 : 0,
    prvOnRec: n => !!(n && n.prov && n.prov.on && W.on), territory: () => ({}), prvIdx: () => 0,
    prvNatWith: () => W.N, prvPops: (T, N) => N, prvLoy: (n, p) => p.loy, seaIsles: () => W.I
  });
  vm.runInContext(BLOCK, ctx);
  return { A, W };
}
const X = world();
const gov = (o = {}) => ({ nm: 'Ada Vell', tr: [], ...o });
const prov = (id, o = {}) => ({ id, cells: o.cells || [id * 10, id * 10 + 1], pop: o.pop ?? 1, loy: o.loy ?? 50, dorm: !!o.dorm, q: { id, nm: 'P' + id, g: 'g' in o ? o.g : gov(), a: o.a, at: o.at, c: o.c } });
const set = list => { X.W.N = { prov: list }; };
const val = (id, n = { prov: { on: 1 } }) => +X.A[id].f({ n, id: 'me', me: true, npc: false, now: NOW, m: {} }) || 0;
const earned = id => val(id) >= X.A[id].g;

test('seven new achievements, all in the land group, with a tier and words of their own', () => {
  const ids = ['prv-devoted', 'prv-home', 'prv-council1', 'prv-council5', 'prv-isle', 'prv-pop1', 'prv-pop10'];
  assert.deepEqual(Object.keys(X.A).sort(), ids.slice().sort());
  for (const id of ids) { const a = X.A[id]; assert.equal(a.c, 'land', id); assert.ok(['b', 's', 'g'].includes(a.t), id); assert.ok(a.n && a.d.length > 20, id); }
  assert.equal(X.A['prv-devoted'].t, 'g');
  assert.equal(X.A['prv-pop1'].o.fm, 'pop'); assert.equal(X.A['prv-pop1'].g, 1); assert.equal(X.A['prv-pop10'].g, 10);
  assert.equal(X.A['prv-home'].g, 7); assert.equal(X.A['prv-council5'].g, 5);
});

test('nothing counts while provinces are off, for a computer nation, or without a record of them', () => {
  set([prov(1, { loy: 90, pop: 50, a: 3, at: NOW - 9 * DAY, c: [gov(), gov(), gov()] })]);
  X.W.on = false;
  for (const id of Object.keys(X.A)) assert.equal(val(id), 0, id);
  X.W.on = true;
  assert.equal(+X.A['prv-pop1'].f({ n: { prov: { on: 1 } }, npc: true, now: NOW, m: {} }), 0);
});

test('Devoted Federation: five or more provinces, every governor in office at loyalty 70 or more', () => {
  const five = o => [1, 2, 3, 4, 5].map(i => prov(i, { loy: 80, ...o }));
  set(five().slice(0, 4)); assert.equal(earned('prv-devoted'), false, 'four are not enough');
  set(five()); assert.equal(earned('prv-devoted'), true);
  set(five().map((p, i) => i === 2 ? { ...p, loy: 69 } : p)); assert.equal(earned('prv-devoted'), false, 'one Steady governor spoils it');
  set(five().map((p, i) => i === 0 ? { ...p, q: { ...p.q, g: gov({ ac: 1 }) } } : p)); assert.equal(earned('prv-devoted'), false, 'an acting governor is not Devoted');
  set(five().map((p, i) => i === 0 ? { ...p, q: { ...p.q, g: null } } : p)); assert.equal(earned('prv-devoted'), false, 'nor is an empty seat');
  set(five().concat([prov(6, { loy: 10, dorm: true }), prov(7, { loy: 10, cells: [] })])); assert.equal(earned('prv-devoted'), true, 'dormant and empty divisions do not count');
  set([70, 70, 71, 95, 100].map((l, i) => prov(i + 1, { loy: l }))); assert.equal(earned('prv-devoted'), true, '70 is Devoted');
});

test('Home Rule: whole days since the autonomy last changed, while it stays at Home Rule', () => {
  set([prov(1, { a: 3, at: NOW - 3.5 * DAY })]); assert.equal(val('prv-home'), 3);
  set([prov(1, { a: 3, at: NOW - 7 * DAY })]); assert.equal(val('prv-home'), 7); assert.equal(earned('prv-home'), true);
  set([prov(1, { a: 3, at: NOW - 40 * DAY })]); assert.equal(val('prv-home'), 7, 'capped at the goal');
  set([prov(1, { a: 2, at: NOW - 40 * DAY })]); assert.equal(val('prv-home'), 0, 'Autonomous is not Home Rule');
  set([prov(1, { a: 3 })]); assert.equal(val('prv-home'), 7, 'Home Rule set before its date was kept counts as a week');
  set([prov(1, { a: 3, at: NOW - 9 * DAY, dorm: true }), prov(2, { a: 3, at: NOW - 2 * DAY })]); assert.equal(val('prv-home'), 2, 'a dormant division does not count');
  set([prov(1, { a: 3, at: NOW + DAY })]); assert.equal(val('prv-home'), 0, 'a date ahead of the clock counts nothing');
});

test('full councils: Treasurer, Constable and Planner all seated', () => {
  const full = [gov(), gov(), gov()];
  set([prov(1, { c: full }), prov(2, { c: [gov(), 0, gov()] }), prov(3)]); assert.equal(val('prv-council1'), 1); assert.equal(earned('prv-council1'), true); assert.equal(earned('prv-council5'), false);
  set([1, 2, 3, 4, 5].map(i => prov(i, { c: full }))); assert.equal(val('prv-council5'), 5); assert.equal(earned('prv-council5'), true);
  set([1, 2, 3, 4, 5].map(i => prov(i, { c: full, dorm: i === 5 }))); assert.equal(val('prv-council5'), 4, 'a dormant division does not count');
});

test('Island Province: every hex of one division off the capital’s island', () => {
  X.W.I = { id: new Map([[10, 1], [11, 1], [20, 1], [21, 2], [30, 2], [31, 2]]), main: 1 };
  set([prov(1), prov(2), prov(3)]); assert.equal(earned('prv-isle'), true, 'division 3 lies wholly on island 2');
  set([prov(1), prov(2)]); assert.equal(earned('prv-isle'), false, 'division 2 straddles the strait');
  set([prov(3)]); assert.equal(earned('prv-isle'), false, 'one division alone is not an island province');
  X.W.I = { id: new Map(), main: -1 }; set([prov(1), prov(3)]); assert.equal(earned('prv-isle'), false, 'no capital island known, no award');
});

test('a province of a million, and of ten million people (population in millions, like the census)', () => {
  set([prov(1, { pop: 0.4 }), prov(2, { pop: 0.95 })]); assert.equal(earned('prv-pop1'), false);
  set([prov(1, { pop: 0.4 }), prov(2, { pop: 1.2 })]); assert.equal(val('prv-pop1'), 1.2); assert.equal(earned('prv-pop1'), true); assert.equal(earned('prv-pop10'), false);
  set([prov(1, { pop: 12 }), prov(2, { pop: 30, dorm: true })]); assert.equal(val('prv-pop10'), 12, 'the largest live division'); assert.equal(earned('prv-pop10'), true);
});

/* ── q.at: kept with the autonomy, set when it changes ── */
const grab = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
function norm(d) {
  const src = [/function prvGovNorm\(g\)\{[\s\S]*?\n\}/, /function prvNorm\(d,n\)\{[\s\S]*?\n\}/, /const PRV_TERMS=\{.*\};/, /const PRV_MAXL=.*;/, /const PRV_FA=\{.*\};/, /const PRV_FAK=.*;/].map(grab).join('\n');
  const ctx = vm.createContext({ Math, Object, Array, Number, Set, isFinite, Date, DAY, REG: { id: 'r1' }, MAP: { N: 100, T: new Array(100).fill(3) }, PRV_GT: {},
    czText: (v, k) => typeof v === 'string' ? v.slice(0, k) : '', prvFlagNorm: () => null, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
  vm.runInContext(src + '\nthis.prvNorm=prvNorm;', ctx);
  return ctx.prvNorm(d, { reg: 'r1' });
}
test('the record keeps the date of the last autonomy change only beside an autonomy, and only a sane one', () => {
  const t = Date.UTC(2026, 10, 10);
  const one = q => norm({ on: 1, l: [{ id: 1, nm: 'A', s: 5, ...q }] }).l[0];
  assert.equal(one({ a: 3, at: t }).at, t);
  assert.equal(one({ at: t }).at, undefined, 'no autonomy, no date');
  assert.equal(one({ a: 2, at: 'yesterday' }).at, undefined);
  assert.equal(one({ a: 2, at: 12 }).at, undefined, 'a date before the game existed');
  assert.equal(one({ a: 1, at: Date.now() + 9 * DAY }).at, undefined, 'a date far ahead');
  assert.equal(one({ a: 3, at: t + 0.4 }).at, t, 'whole milliseconds');
});
test('raising or lowering the autonomy, by hand or by an edict, stamps the date', () => {
  const setAut = grab(/function prvSetAut\(id,a\)\{[\s\S]*?\n\}/), eff = grab(/function prvEffect\(n,spec,iss\)\{[\s\S]*?\n\}/);
  assert.match(setAut, /if\(a\)\{q\.a=a;q\.at=Date\.now\(\);\}else\{delete q\.a;delete q\.at;\}/);
  assert.match(eff, /if\(v\)\{q\.a=v;q\.at=now;\}else\{delete q\.a;delete q\.at;\}/);
});
