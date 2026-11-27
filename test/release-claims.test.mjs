// Releasing recent claims (releaseClaims in game/edictum.html): claims the release would leave cut off from the rest
// of the land go with it, patches that were apart already stay, and the lifetime count of land claimed gives back
// what is released. Claims a trip needed to reach its site (n.xph, xpHoldFor) stay, so land claimed toward a site
// cannot be released for its credits once the explorers have set out. Run with: npm run test:fx
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
function game(claims, { cities = [], tally = claims.length, xph } = {}) {
  const toasts = [], ctx = vm.createContext({
    MAP: { N, nbr }, S: { nation: { name: 'Stripland', claims: claims.map((c, k) => ({ c, t: 1000 + k })), cities: cities.map(c => ({ c })), tly: { claim: tally }, ...(xph ? { xph } : {}) } },
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

/* claims a trip needed: hex k of claims [1, 2, 3] was claimed at 1000 + k - 1 */
test('a hex a trip needed to reach its site stays, and says why', () => {
  const g = game([1, 2, 3], { xph: [{ c: 3, t: 1002 }] });
  g.release([3]);
  assert.deepEqual(g.held(), [1, 2, 3]);
  assert.equal(g.tally(), 3);
  assert.match(g.toasts[0], /A team you sent out needed this hex to reach its site, so it stays yours/);
});

test('a release that would cut off a held hex is refused as a whole', () => {
  const g = game([1, 2, 3], { xph: [{ c: 3, t: 1002 }] });
  g.release([1]);
  assert.deepEqual(g.held(), [1, 2, 3]);
  assert.match(g.toasts[0], /would cut off land a team you sent out needed/);
});

test('land the trip did not need can still be released', () => {
  const g = game([1, 2, 3, 5], { xph: [{ c: 2, t: 1001 }] });
  g.release([3]);
  assert.deepEqual(g.held(), [1, 2, 5]);
  g.release([5]);
  assert.deepEqual(g.held(), [1, 2]);
});

test('a hold is for the claim it was made on: the same hex claimed again later is free of it', () => {
  const g = game([1], { xph: [{ c: 1, t: 1 }] });
  g.release([1]);
  assert.deepEqual(g.held(), []);
});

/* xpHoldFor, xphKeep and the load hook, on a strip where hexDist is the gap between two hexes */
function holds({ core, recent, now = 1e9 }) {
  const i = source.indexOf('const XPH_MAX='), j = source.indexOf('function claimList(', i);
  assert.ok(i > 0 && j > i, 'xpHoldFor is where the test expects it');
  const ctx = vm.createContext({
    MAP: { N: 40 }, RELEASE_MS: 864e5, NORM_HOOKS: [], Date: { now: () => now },
    hexDist: (a, b) => Math.abs(a - b),
    recentClaims: () => recent.map(c => ({ c, t: 1000 + c }))
  });
  vm.runInContext(source.slice(i, j).replace(/\bconst (XPH_MAX)/, 'var $1'), ctx);
  const owner = new Int16Array(40).fill(-1);
  for (const c of core.concat(recent)) owner[c] = 0;
  /* the trip's distance, measured from the land in T2 (as expDist does) */
  const dist = cell => T2 => { let d = Infinity; for (let c = 0; c < 40; c++) if (T2.owner[c] === 0) d = Math.min(d, Math.abs(c - cell)); return d; };
  return { ctx, hold: (cell, rg) => JSON.parse(JSON.stringify(ctx.xpHoldFor({ owner, byId: { me: 0 } }, cell, rg, dist(cell)))) };
}

test('a trip that reaches its site only thanks to recent claims holds those within its reach of the site', () => {
  const { hold } = holds({ core: [0, 1, 2], recent: [3, 4, 5] });
  assert.deepEqual(hold(10, 6), [{ c: 4, t: 1004 }, { c: 5, t: 1005 }]);  // from 2 the site is 8 away
});

test('a trip the older land reaches anyway holds nothing', () => {
  const { hold } = holds({ core: [0, 1, 2], recent: [3, 4, 5] });
  assert.deepEqual(hold(7, 6), []);                                       // from 2 the site is 5 away
  assert.deepEqual(holds({ core: [0, 1, 2], recent: [] }).hold(10, 6), []);
});

test('holds end with their claim\'s day, are kept once each and survive a load', () => {
  const now = 1e9, { ctx } = holds({ core: [0], recent: [], now });
  const keep = L => JSON.parse(JSON.stringify(ctx.xphKeep(L, now)));
  assert.deepEqual(keep([{ c: 4, t: now - 1000 }, { c: 4, t: now - 1000 }, { c: 5, t: now - 864e5 }, { c: 50, t: now }, { c: 1.5, t: now }, null]), [{ c: 4, t: now - 1000 }]);
  const n = { xph: [{ c: 4, t: now - 2000 }] };
  ctx.xphAdd(n, [{ c: 6, t: now - 10 }], now);
  assert.deepEqual(JSON.parse(JSON.stringify(n.xph)), [{ c: 4, t: now - 2000 }, { c: 6, t: now - 10 }]);
  const m = {}; ctx.NORM_HOOKS[0](m, { xph: [{ c: 6, t: now - 10 }, { c: 7, t: 1 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(m.xph)), [{ c: 6, t: now - 10 }]);
  const e = {}; ctx.NORM_HOOKS[0](e, {});
  assert.equal(e.xph, undefined);
});

/* recentClaims itself: the hex a swap took (its claim made at n.lswT) is not for release, so a swap cannot turn an
   old hex, or a hex a trip needed, into a credit */
test('the hex a swap took cannot be released; other recent claims can', () => {
  const i = source.indexOf('function recentClaims('), j = source.indexOf('function claimBatches(', i);
  assert.ok(i > 0 && j > i, 'recentClaims is where the test expects it');
  const now = 1e9, ctx = vm.createContext({ RELEASE_MS: 864e5, Date: { now: () => now }, myId: () => 'me',
    S: { nation: { claims: [{ c: 1, t: now - 3e5 }, { c: 2, t: now - 6e4 }, { c: 3, t: now - 2 * 864e5 }], cities: [], lswT: now - 6e4 } } });
  vm.runInContext(source.slice(i, j), ctx);
  const owner = new Int16Array(10).fill(-1); for (const c of [0, 1, 2, 3]) owner[c] = 0;
  const T = { owner, byId: { me: 0 }, occ: [], isCap: [] };
  assert.deepEqual(ctx.recentClaims(T).map(e => e.c), [1]);
  delete ctx.S.nation.lswT;
  assert.deepEqual(ctx.recentClaims(T).map(e => e.c), [1, 2]);
});
