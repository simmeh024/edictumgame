// The Great Dam (game/edictum.html, damState and its rewards): the region's third wonder, after the lighthouse. Twenty
// phases and 22,100 resources (food 7,000, goods 5,600, iron 3,500, oil 3,000, timber 3,000), at least three nations per
// phase, 4 land credits for a nation that gives a twentieth of the whole, and 5/4/3/2/1 more for the top five at the opening.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = html.indexOf('const DAM_PH=['), to = html.indexOf('\nlandEarned=(f=>function(n){return f.apply(this,arguments)+damLand(n);})(landEarned);');
assert.ok(from > 0 && to > from, 'the dam code is found');

function dam(nations, lit = true) {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], REG: { id: 'meridian' }, regText: s => s,
    num0: v => Number(v) || 0, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), list: nations, LTH_N: 12, WND_HAP_JOIN: 3600e3,
    lthState: () => ({ done: lit ? 12 : 11, end: lit ? 5 : 0 }), fmt0: v => String(v), cap1: s => s.charAt(0).toUpperCase() + s.slice(1) });
  vm.runInContext(html.slice(from, to) + '\nconst allNations=()=>list;Object.assign(this,{state:damState,PH:DAM_PH,N:DAM_N,cap:damCapOf,raise:damRaise,share:damShareCheck,land:damLand,top:damTop,open:damOpen,SHARE_AT:DAM_SHARE_AT,TOTAL:DAM_TOTAL});', ctx);
  return ctx;
}
const rec = (id, p, ph = 0, extra = {}) => ({ id, n: { name: id, dam: { r: 'meridian', p, ph, t: 1, t0: 1, ...extra } } });

test('twenty phases, 22,100 in all, heavy in food, timber and oil', () => {
  const D = dam([]);
  assert.equal(D.N, 20);
  const by = {};
  for (const p of D.PH) for (const [r, v] of Object.entries(p[2])) by[r] = (by[r] || 0) + v;
  assert.equal(JSON.stringify(by, Object.keys(by).sort()), JSON.stringify({ food: 7000, goods: 5600, iron: 3500, oil: 3000, timber: 3000 }));
  assert.equal(D.TOTAL, 22100);
  assert.equal(D.SHARE_AT, 1105, 'a twentieth of the dam');
  const early = D.PH.slice(0, 8).reduce((s, p) => s + (p[2].food || 0) + (p[2].timber || 0), 0), late = D.PH.slice(12).reduce((s, p) => s + (p[2].food || 0) + (p[2].timber || 0), 0);
  assert.ok(early > 2 * late, 'food and timber come early');
  for (let i = 0; i < D.N; i++) assert.ok(2 * D.cap(i) < Object.values(D.PH[i][2]).reduce((a, b) => a + b, 0), `two nations at the cap cannot fill phase ${i + 1}`);
});

test('three nations finish a phase, two cannot', () => {
  const need = { timber: 300, goods: 100, food: 500 };
  assert.equal(dam([rec('a', { 0: { food: 360 } }), rec('b', { 0: { food: 140, timber: 220 } }), rec('c', { 0: { timber: 80, goods: 100 } })]).state().done, 1);
  const two = dam([rec('a', { 0: need }), rec('b', { 0: { food: 1 } })]).state();
  assert.equal(two.done, 0);
  assert.equal(two.hands, 2);
});

test('closed until the lighthouse is lit, unless someone has already given', () => {
  assert.equal(dam([], false).open(), false);
  assert.equal(dam([], true).open(), true);
  assert.equal(dam([rec('a', { 0: { food: 5 } })], false).open(), true);
});

test('4 land credits once a nation has given 1,105 in all, noted once', () => {
  const D = dam([]);
  const n = { dam: { r: 'meridian', p: { 0: { food: 300 }, 1: { food: 300 }, 2: { food: 400 } } }, log: [] };
  assert.deepEqual([...D.share(n, 9)], []);
  assert.equal(D.land(n), 0);
  n.dam.p[3] = { food: 105 };
  assert.equal(D.share(n, 9).length, 1);
  assert.equal(n.dam.s, 1);
  assert.equal(D.share(n, 10).length, 0, 'paid once');
  assert.equal(D.land(n), 4);
  assert.equal(n.log[0].k, 'damr');
});

test('the top five at the opening earn 5, 4, 3, 2 and 1 more', () => {
  const big = i => { const p = {}; for (let d = 0; d < 20; d++) p[d] = { goods: 100 - i }; return p; };
  const L = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ ...rec(id, big(i), 20), me: false }));
  for (let i = 0; i < 6; i++) {
    L.forEach((x, j) => { x.me = j === i; });
    const D = dam(L), n = JSON.parse(JSON.stringify(L[i].n));
    n.dam.ph = 19; n.dam.s = 1; n.log = [];
    D.raise(n, 20, 7);
    assert.equal(D.top(n), i < 5 ? i + 1 : 0, `place ${i + 1}`);
    assert.equal(D.land(n), 4 + [5, 4, 3, 2, 1, 0][i]);
  }
});

test('the dam edicts: one every five phases, blue, never drawn at random', () => {
  const ids = [...html.matchAll(/\{id:'(dam-[a-z]+)',c:'[a-z]+',dam:1,at:(\d+)/g)].map(m => [m[1], +m[2]]);
  assert.deepEqual(ids.map(x => x[1]), [5, 10, 15, 20]);
  assert.match(html, /for\(const is of DAM_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\)/, 'kept out of the random draw (fo)');
  assert.match(html, /\.issue-item:has\(\.edict-dam\) \.issue-card\{border-color:var\(--dam-blue\)/);
});
