// A capital on land already claimed (game/edictum.html, capWrong): a nation whose capital stands on a hex another
// nation had claimed first is left off the map until it settles again. The claim counts from the server's time of it
// (raceKnown), so a claim made offline and uploaded later never pushes out a capital that was there first.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const i = src.indexOf('function raceKnown('), j = src.indexOf('function raceSoon(', i);
assert.ok(i > 0 && j > i, 'raceKnown … capWrong sit before raceSoon');
const AC_EPOCH = Date.UTC(2026, 9, 28), DAY = 864e5;
function kit() {
  const ctx = vm.createContext({
    AC_EPOCH, RACE: { t: new Map(), want: new Set() }, S: { mode: 'world' }, fetched: 0,
    raceSoon() { ctx.fetched++; },
    capSince: n => Math.max(n.founded || 0, n.capAt || 0),
    inReach: (x, c) => Math.abs(c - x.cap) <= (x.reach ?? 68),
  });
  vm.runInContext(src.slice(i, j).replace('const capClaimsMemo', 'var capClaimsMemo'), ctx);
  return ctx;
}
const T0 = Date.UTC(2026, 10, 12, 19, 31);
const nation = (id, cap, o = {}) => ({ id, cap, npc: !!o.npc, reach: o.reach, n: { name: id, founded: o.founded ?? T0 - 60000, capAt: o.capAt ?? T0, claims: o.claims || [], _ts: o.ts } });
const claims = list => ({ list: list.map(e => ({ c: e.c, t: e.t, o: e.src, src: e.src, claim: true })) });

test('a capital on a claim made before it does not stand, and names whose claim it is', () => {
  const k = kit(), ete = nation('ete', 100, { founded: T0 - 17 * DAY, capAt: 0 }), nev = nation('nev', 105);
  const w = k.capWrong([ete, nev], claims([{ c: 105, t: Date.UTC(2026, 9, 27), src: 'ete' }]));
  assert.deepEqual([...w.keys()], ['nev']);
  assert.equal(w.get('nev'), ete);
});

test('a claim made after the capital took its place leaves the capital standing', () => {
  const k = kit(), a = nation('a', 100), b = nation('b', 105);
  assert.equal(k.capWrong([a, b], claims([{ c: 105, t: T0 + 5000, src: 'a' }])).size, 0);
});

test('while the claim\'s server time is being read, the capital stands; once it is in, it counts', () => {
  const k = kit(), a = nation('a', 100, { founded: T0 - DAY }), b = nation('b', 105), ev = claims([{ c: 105, t: T0 - 3600e3, src: 'a' }]);
  assert.equal(k.capWrong([a, b], ev).size, 0, 'not known yet');
  assert.ok(k.RACE.want.has('c105:a') && k.fetched === 1, 'the stamp is asked for');
  k.RACE.t.set('c105:a', T0 - 3500e3);
  assert.equal(k.capWrong([a, b], ev).size, 1, 'the server agrees it came first');
});

test('a claim made offline and stamped only when it reached the server does not push out an earlier capital', () => {
  const k = kit(), off = nation('off', 100, { founded: T0 - DAY }), b = nation('b', 105);
  k.RACE.t.set('c105:off', T0 + 600e3); // dated before the capital in its own record, stamped ten minutes after it
  assert.equal(k.capWrong([off, b], claims([{ c: 105, t: T0 - 1800e3, src: 'off' }])).size, 0);
});

test('a claim with no stamp counts from its record\'s last save', () => {
  const k = kit(), a = nation('a', 100, { founded: T0 - DAY, ts: T0 + 60e3 }), b = nation('b', 105);
  k.RACE.t.set('c105:a', null);
  assert.equal(k.capWrong([a, b], claims([{ c: 105, t: T0 - 1800e3, src: 'a' }])).size, 0, 'saved after the capital');
  a.n._ts = T0 - 60e3;
  assert.equal(k.capWrong([a, b], claims([{ c: 105, t: T0 - 1800e3, src: 'a' }])).size, 1, 'saved before it');
});

test('claims from before the server kept times count as they are', () => {
  const k = kit(), a = nation('a', 100, { founded: AC_EPOCH - 3 * DAY }), b = nation('b', 105);
  assert.equal(k.capWrong([a, b], claims([{ c: 105, t: AC_EPOCH - DAY, src: 'a' }])).size, 1);
  assert.equal(k.fetched, 0, 'no stamp is asked for');
});

test('only another settled player\'s claim within its reach counts', () => {
  const k = kit(), b = nation('b', 105), early = { c: 105, t: Date.UTC(2026, 9, 27) };
  assert.equal(k.capWrong([b], claims([{ ...early, src: 'b' }])).size, 0, 'its own claim under it');
  assert.equal(k.capWrong([b], claims([{ ...early, src: 'gone' }])).size, 0, 'a nation not on the map');
  assert.equal(k.capWrong([nation('far', 0, { reach: 20 }), b], claims([{ ...early, src: 'far' }])).size, 0, 'a claim the claimer cannot hold');
  assert.equal(k.capWrong([nation('npc-x', 100, { npc: true }), b], claims([{ ...early, src: 'npc-x' }])).size, 0, 'a computer nation');
  assert.equal(k.capWrong([nation('a', 100), { ...nation('draft', 105), id: 'draft' }], claims([{ ...early, src: 'a' }])).size, 0, 'the founding preview');
});

test('in a game of its own (no region) the record\'s times are used', () => {
  const k = kit(); k.S.mode = 'local';
  assert.equal(k.raceKnown('a', 'c1', T0, null), T0);
  assert.equal(k.fetched, 0);
});
