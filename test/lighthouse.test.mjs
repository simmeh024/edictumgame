// The Great Lighthouse (game/edictum.html, lthState and its rewards): the region's second wonder, summed phase by phase from
// every player nation's own record. A phase needs all its resources from at least three nations, finished phases stay
// finished, a finished phase pays its land credits only to nations that gave at least 5% of it, and the three biggest givers
// keep their place (gold, silver, bronze) in their own record when they see the lamp lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = html.indexOf('const LTH_PH=['), to = html.indexOf('\nlandEarned=(f=>function(n){return f.apply(this,arguments)+lthLand(n);})(landEarned);');
assert.ok(from > 0 && to > from, 'the lighthouse code is found');

function lighthouse(nations, statueDone = 10) {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], REG: { id: 'meridian' }, regText: s => s,
    num0: v => Number(v) || 0, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), list: nations, WND_N: 10, WND_HAP_JOIN: 3600e3,
    wndState: () => ({ done: statueDone }), wndMine: () => false, cap1: s => s.charAt(0).toUpperCase() + s.slice(1) });
  vm.runInContext(html.slice(from, to) + '\nconst allNations=()=>list;Object.assign(this,{state:lthState,PH:LTH_PH,N:LTH_N,share:lthShareOf,cap:lthCapOf,raise:lthRaise,rewarded:lthRewarded,land:lthLand,top:lthTop,open:lthOpen});', ctx);
  return ctx;
}
const rec = (id, p, ph = 0, extra = {}) => ({ id, n: { name: id, lth: { r: 'meridian', p, ph, t: 1, t0: 1, ...extra } } });
const causeway = { timber: 200, iron: 80, food: 60 };

test('twelve phases, twice the statue: 7,000 in all, with a 5% share and a 40% cap per phase', () => {
  const L = lighthouse([]);
  assert.equal(L.N, 12);
  const total = L.PH.reduce((s, p) => s + Object.values(p[2]).reduce((a, b) => a + b, 0), 0);
  assert.equal(total, 7000);
  assert.equal(L.share(0), 17, '5% of the causeway’s 340');
  assert.equal(L.cap(0), 136, '40% of it');
  for (let i = 0; i < L.N; i++) assert.ok(2 * L.cap(i) < Object.values(L.PH[i][2]).reduce((a, b) => a + b, 0), `two nations at the cap cannot fill phase ${i + 1}`);
});

test('three nations that give all a phase needs finish it', () => {
  const L = lighthouse([rec('a', { 0: { timber: 136 } }), rec('b', { 0: { timber: 64, iron: 72 } }), rec('c', { 0: { iron: 8, food: 60 } })]);
  const st = L.state();
  assert.equal(st.done, 1);
  assert.equal(st.hands, 0, 'nobody has given to the foundations yet');
  assert.deepEqual({ ...st.need }, { timber: 160, iron: 160, goods: 80 });
});

test('two nations are not enough, even with everything given', () => {
  const L = lighthouse([rec('a', { 0: { timber: 200 } }), rec('b', { 0: { iron: 80, food: 60 } })]);
  const st = L.state();
  assert.equal(st.done, 0, 'the causeway waits for a third nation');
  assert.equal(st.hands, 2);
  assert.equal(st.frac, 1);
});

test('finished phases stay finished when a giver leaves (the highest phase a record has seen)', () => {
  const L = lighthouse([rec('b', { 0: { timber: 64 } }, 3)]);
  assert.equal(L.state().done, 3);
});

test('closed until the statue is finished, unless someone has already given', () => {
  assert.equal(lighthouse([], 9).open(), false);
  assert.equal(lighthouse([], 10).open(), true);
  assert.equal(lighthouse([rec('a', { 0: { timber: 5 } })], 4).open(), true);
});

test('a finished phase pays 4 land credits to each nation that gave at least 5% of it, and nothing below that', () => {
  const L = lighthouse([]);
  const n = { name: 'Giver', lth: { r: 'meridian', p: { 0: { timber: 17 }, 1: { iron: 19 } }, ph: 0, t: 1 } };
  const texts = L.raise(n, 2, 1000);
  assert.equal(JSON.stringify(L.rewarded(n)), '[0]', 'the causeway (17 of 17) pays, the foundations (19 of 20) do not');
  assert.equal(L.land(n), 4);
  assert.equal(texts.length, 1);
  assert.equal(JSON.stringify(n.log.map(l => [l.k, l.a])), '[["lthr","0"]]');
  assert.equal(L.raise(n, 2, 2000).length, 0, 'paid once');
  assert.equal(L.land({ ...n, lthx: { l: 8 } }), 12, 'with what was kept from another region’s lighthouse');
});

test('the three biggest givers keep their place when they see the lamp lit', () => {
  const gifts = (k) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, { goods: k }]));
  const me = rec('me', gifts(30), 11), list = [rec('a', gifts(40), 11), me, rec('b', gifts(35), 11), rec('c', gifts(10), 12)];
  me.me = true;
  const L = lighthouse(list);
  const texts = L.raise(me.n, 12, 5000);
  assert.equal(me.n.lth.k, 3, 'third: behind a (480) and b (420)');
  assert.ok(texts.some(t => /bronze/.test(t)), texts.join(' | '));
  assert.equal(L.top(me.n), 3);
  assert.equal(L.top({ lth: { k: 0 } }), 0);
  assert.equal(L.top({ lth: {}, lthx: { k: 2 } }), 2, 'kept after a move');
});
