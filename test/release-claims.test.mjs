// Releasing recent claims (releaseClaims in game/edictum.html): claims the release would leave cut off from the rest
// of the land go with it, patches that were apart already stay, and the lifetime count of land claimed gives back
// what is released. Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const start = source.indexOf('function landPatches('), end = source.indexOf('/* ───────── how to get more land', start);
assert.ok(start > 0 && end > start, 'releaseClaims is where the test expects it');

/* a strip of ten hexes, each touching the one before and after it; the nation's core is hex 0 */
const N = 10, nbr = new Int32Array(N * 6).fill(-1);
for (let c = 0; c < N; c++) { if (c > 0) nbr[c * 6] = c - 1; if (c < N - 1) nbr[c * 6 + 1] = c + 1; }
function game(claims, { cities = [], tally = claims.length } = {}) {
  const toasts = [], ctx = vm.createContext({
    MAP: { N, nbr }, S: { nation: { name: 'Stripland', claims: claims.map((c, k) => ({ c, t: 1000 + k })), cities: cities.map(c => ({ c })), tly: { claim: tally } } },
    myId: () => 'me', clone: x => structuredClone(x), toast: m => toasts.push(m), render() {}, updateMapPanel() {}, redrawMaps() {},
    commit(n) { ctx.S.nation = n; },
    territory() {
      const owner = new Int16Array(N).fill(-1); owner[0] = 0;
      for (const e of ctx.S.nation.claims) owner[e.c] = 0;
      return { owner, byId: { me: 0 } };
    },
    recentClaims(T) { const city = new Set(ctx.S.nation.cities.map(x => x.c)); return ctx.S.nation.claims.filter(e => !city.has(e.c) && T.owner[e.c] === 0); }
  });
  vm.runInContext(source.slice(start, end), ctx);
  return { release: cells => ctx.releaseClaims(cells), held: () => ctx.S.nation.claims.map(e => e.c).sort((a, b) => a - b), tally: () => ctx.S.nation.tly.claim, toasts };
}

test('releasing a hex releases the recent claims that only reached the land through it', () => {
  const g = game([1, 2, 3]);
  g.release([1]);
  assert.deepEqual(g.held(), []);
  assert.match(g.toasts[0], /released 3 hexes, 2 of them because they would have been cut off from the rest of your land: 3 land credits are free/);
});

test('releasing the outer end of a chain leaves the rest as it was', () => {
  const g = game([1, 2, 3]);
  g.release([3]);
  assert.deepEqual(g.held(), [1, 2]);
  assert.doesNotMatch(g.toasts[0], /cut off/);
});

test('a patch that was apart already stays, but a claim made from it goes with it', () => {
  const island = game([1, 5]);                                     // 5: an island shore, reached from a harbour
  island.release([1]);
  assert.deepEqual(island.held(), [5]);
  const chain = game([5, 6]);                                      // 6 was claimed next to the island shore
  chain.release([5]);
  assert.deepEqual(chain.held(), []);
});

test('a patch holding a city stays', () => {
  const g = game([1, 2, 3], { cities: [3] });
  g.release([1]);
  assert.deepEqual(g.held(), [2, 3]);
});

test('the lifetime count of land claimed gives back what is released, so claiming again counts once', () => {
  const g = game([1, 2, 3], { tally: 7 });
  g.release([2]);
  assert.deepEqual(g.held(), [1]);
  assert.equal(g.tally(), 5);
  const none = game([1], { tally: 0 });
  none.release([1]);
  assert.equal(none.tally(), 0);
});
