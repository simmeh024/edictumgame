// The Great Statue's state (game/edictum.html, wndState): the sum of every player nation's gifts in the region, with
// finished phases kept finished. A nation that left took its gifts out of that sum, and the phase after could then never
// fill up; gifts are now also noted against the phase they went to (n.wnd.p), which counts for that phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = html.indexOf('const WND_PH=['), to = html.indexOf('\nconst wndPhase=');
assert.ok(from > 0 && to > from, 'the statue code is found');

function statue(nations) {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], REG: { id: 'meridian' }, regText: s => s,
    num0: v => Number(v) || 0, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), list: nations });
  vm.runInContext(html.slice(from, to) + '\nconst allNations=()=>list;this.state=wndState;this.PH=WND_PH;', ctx);
  return ctx;
}
const rec = (id, c, ph, p) => ({ id, n: { name: id, wnd: { r: 'meridian', c, ph, t: 1, ...(p ? { p } : {}) } } });

test('gifts that fill a phase finish it, as before', () => {
  const S = statue([rec('a', { timber: 120, iron: 60 }, 0)]);
  assert.equal(S.state().done, 1);
  assert.equal(S.state().need.timber, 80, 'the plinth needs its own timber next');
});

test('when an early giver leaves, the next phase still fills from what is given to it', () => {
  /* a gave all of the foundations and left; b saw them finished (ph 1) and has given the whole plinth since */
  const plinth = { timber: 80, iron: 120, goods: 40 };
  const S = statue([rec('b', { ...plinth }, 1, { 1: { ...plinth } })]);
  const st = S.state();
  assert.equal(st.done, 2, 'the plinth is finished: ' + JSON.stringify(st.need));
});

test('part of a phase given since counts as that much of it', () => {
  const S = statue([rec('b', { timber: 40, iron: 120, goods: 40 }, 1, { 1: { timber: 40, iron: 120, goods: 40 } })]);
  const st = S.state();
  assert.equal(st.done, 1);
  assert.deepEqual({ ...st.need }, { timber: 40, iron: 0, goods: 0 }, 'only the missing timber is still wanted');
});

test('without the note, a record from before it counts through the total as it did', () => {
  /* the same leaver case with no n.wnd.p: the phase stays open, but every gift now carries the note */
  const S = statue([rec('b', { timber: 80, iron: 120, goods: 40 }, 1)]);
  assert.equal(S.state().done, 1);
});

test('a later phase is not finished by a note for an earlier one', () => {
  const S = statue([rec('b', { timber: 200, iron: 180, goods: 40 }, 2, { 1: { timber: 80, iron: 120, goods: 40 } })]);
  const st = S.state();
  assert.equal(st.done, 2);
  assert.deepEqual({ ...st.need }, { iron: 160, goods: 60 }, 'the feet still want all of theirs');
});

/* the Patron: earned by a nation that gave to its statue and saw it finished, and kept after a move */
const pa = html.indexOf("UNLOCKS['t-patron']"), pb = html.indexOf("how:id=>id==='t-patron'", pa), pe = html.indexOf('});', pb) + 3;
assert.ok(pa > 0 && pb > pa, 'the Patron code is found');
function patron(n, reg, list = []) {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], REG: { id: reg }, regText: s => s, UNLOCK_SOURCES: [], UNLOCKS: {},
    num0: v => Number(v) || 0, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), list });
  vm.runInContext(html.slice(from, to) + '\nconst allNations=()=>list;\n' + html.slice(pa, pe) + '\nthis.earned=n=>[...UNLOCK_SOURCES[0].earned(n)];', ctx);
  return [...ctx.earned(n)];
}
const gave = { timber: 120, iron: 60 };
test('a nation that saw its statue finished stays the Patron after moving region', () => {
  const n = { name: 'Moved', wnd: { r: 'meridian', c: gave, ph: 10, t: 1 } };
  assert.deepEqual(patron(n, 'meridian'), ['t-patron']);
  assert.deepEqual(patron(n, 'terra'), ['t-patron'], 'still the Patron in Terra');
});
test('and after giving to the new region’s statue, through what it keeps', () => {
  assert.deepEqual(patron({ name: 'Moved', wnd: { r: 'terra', c: { timber: 5 }, ph: 0, t: 2 }, wnx: { u: [0], l: 2, pt: 1 } }, 'terra'), ['t-patron']);
});
test('no Patron without a gift, or before the statue was finished', () => {
  assert.deepEqual(patron({ name: 'Idle', wnd: { r: 'meridian', c: {}, ph: 10, t: 1 } }, 'terra'), []);
  assert.deepEqual(patron({ name: 'Early', wnd: { r: 'meridian', c: gave, ph: 4, t: 1 } }, 'terra'), []);
});
