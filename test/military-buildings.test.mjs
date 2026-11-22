// Military buildings (22 Nov 2026; game/edictum.html, "military buildings"): the Drill Ground, the Arsenal, the Naval
// Dockyard and the Military Hospital, checked with the game's own section cut from its source, against the referee's
// half (functions/war-rules.js milReady) and the figures job's population (jobs/fx/engine.mjs).
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milReady, milMs, milBlocks } from '../functions/war-rules.js';
import * as E from '../jobs/fx/engine.mjs';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const SEC = cut('/* ───────── military buildings (22 November 2026) ─────────', '\nif(hot&&typeof hot.snapshot');
const UG = cut('/* the five upgrade blocks', 'const CX_WALL=');
const DAY = 864e5, MIN = 60000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* the section in a context of its own: the game's helpers it wraps are plain stubs, and T is the territory */
function load(opts = {}) {
  const ctx = {
    DAY, Math, Date, Object, Array, Number, JSON, isFinite, clamp, console,
    BUILDINGS: { barracks: { n: 'Barracks' } }, BLD_ICO: {}, MILESTONES: [6, 7, 8.5, 10, 12.5, 15, 20].map(p => ({ p })), DC_GLYPH: {}, DC_GEO: {},
    COMMIT_HOOKS: [], NORM_HOOKS: [], window: {}, S: { nation: null },
    dcRoof() {}, dcFlag() {}, fmt1: v => String(Math.round(v * 10) / 10), popAmt: v => (Math.round(v * 100) / 100) + ' million',
    myId: () => 'me', T: null, agg: [], pol: n => (n && n.policies) || {},
    territory() { return ctx.T; }, cityState() { return { agg: ctx.agg }; }, bldAggOf: n => ctx.myAgg || null,
    cityList: n => (n && n.cities) || [], cxUps: (b, now) => b.uu && b.uu.d <= now ? b.uu.u : b.ug || 0,
    isCoastal: c => c < 100, hexDist: (a, b) => Math.abs(a - b),
    nbCity() {}, readyMs: () => 15 * MIN, maxReady: () => 6, cityDefMult: () => 1, cityDefNotes: () => [],
    wrPopFx: () => ({ m: 1, l: 0.01 }), popNow: n => n.pop, growth: () => 0.5, wr3Close: (n, id, s) => ({ nm: 'Vesad', p: s.p }),
    nbUgLine: () => '', bldGain: () => ({ lm: 1, mk: 1, res: [], up: [], x: [] }), ...opts
  };
  vm.createContext(ctx);
  vm.runInContext(UG.replace(/^const /gm, 'var ') + '\n' + SEC.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return ctx;
}
const bld = (k, now, extra = {}) => ({ k, s: now - 2 * DAY, d: now - DAY, ...extra });
const nation = cities => ({ name: 'Ostra', founded: 1, seed: 's', policies: {}, cities });

test('four Defence buildings, drawn, priced in materials and unlocked at a milestone', () => {
  const c = load(), keys = ['drillyard', 'armoury', 'dockyard', 'milhosp'];
  assert.deepEqual([...c.MIL_KEYS], keys);
  for (const k of keys) {
    const B = c.BUILDINGS[k];
    assert.ok(B && B.n && B.d && B.q && B.h > 0, k + ' has a name, a description, a line of colour and a build time');
    assert.equal(B.c, 'def', k + ' is on the Defence tab');
    assert.ok(Object.keys(B.cost).every(r => ['food', 'timber', 'iron', 'oil', 'goods'].includes(r)), k + ' costs only materials');
    assert.ok(B.up && Object.keys(B.up).length, k + ' has an upkeep');
    assert.ok(c.DC_GLYPH[B.icon] && typeof c.DC_GLYPH[B.icon].f === 'function', k + ' has a drawing');
    assert.match(c.BLD_ICO[k] || '', /^<(path|rect|circle) /, k + ' has an icon on the Cities page');
    assert.ok(c.MILESTONES.some(m => (m.b || []).includes(k)), k + ' unlocks at a milestone');
    /* the drawing draws: a recorder for the calls it makes */
    const calls = [], q = new Proxy({}, { get: (t, m) => (...a) => { calls.push(m); if (m === 'path') a[1]({ moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {} }, (x, y) => [x, y]); } });
    c.DC_GLYPH[B.icon].f(q, 0);assert.ok(calls.length >= 4, k + ' draws shapes: ' + calls.length);
  }
  assert.equal(c.BUILDINGS.dockyard.need, 'coast');assert.equal(c.DC_GEO.navyard, 'coast', 'a dockyard is drawn at the coast');
  for (const k of ['drillyard', 'armoury', 'milhosp']) assert.equal(c.BUILDINGS[k].one, 1, k + ': one per nation');
  for (const k of ['drillyard', 'armoury']) assert.deepEqual([...c.BUILDINGS[k].needB], ['barracks'], k + ' needs a Barracks');
  assert.equal(c.BUILDINGS.armoury.army, 0.02, 'the Arsenal adds 2% to the army, and its blocks their share');
  assert.equal(c.BUILDINGS.milhosp.once.health, 2);
});

test('the Drill Ground and the Arsenal: readiness back sooner and held longer, only in a city of your own you hold', () => {
  const now = Date.now(), c = load();
  const n = nation([{ id: 'cap', c: 10, b: [bld('drillyard', now)] }, { id: 'b', c: 20, b: [bld('armoury', now)] }]);
  c.S.nation = n;c.T = { byId: { me: 0 }, owner: { 10: 0, 20: 0 } };
  assert.equal(c.readyMs(n), 12 * MIN, '20% sooner: 12 minutes');
  assert.equal(c.maxReady(n), 7, 'one more point');
  n.cities[0].b[0].ug = 5;n.cities[1].b[0].ug = 5;
  assert.equal(c.readyMs(n), Math.round(15 * MIN * 0.7), 'gold: 30% sooner');
  assert.equal(c.maxReady(n), 8, 'gold: two more points');
  n.cities[0].b[0].ug = 2;n.cities[0].b[0].uu = { u: 3, s: now - DAY, d: now - 1 };
  assert.equal(c.readyMs(n), Math.round(15 * MIN * 0.74), 'an upgrade finished before the save counts');
  /* an enemy holds the Arsenal's city: the game no longer counts it, though the referee still would */
  c.T.owner[20] = 1;
  assert.equal(c.maxReady(n), 6);
  /* still being built */
  const m = nation([{ id: 'cap', c: 10, b: [bld('drillyard', now, { d: now + DAY })] }]);c.S.nation = m;
  assert.equal(c.readyMs(m), 15 * MIN);assert.equal(c.maxReady(m), 6);
  assert.match(src, /const READY_BASE=6,MAX_READY=11,/, 'a record keeps up to 11 points (6 + Reserve 2 + veterans 1 + Arsenal 2)');
});

test('the referee allows at least what the game does: same blocks, every city of the record, veterans too', () => {
  const now = Date.now(), c = load();
  const recs = [
    nation([]),
    nation([{ c: 10, b: [bld('drillyard', now)] }]),
    nation([{ c: 10, b: [bld('drillyard', now, { ug: 4 })] }, { c: 20, b: [bld('armoury', now, { ug: 5 })] }]),
    nation([{ c: 10, b: [bld('drillyard', now, { ug: 1, uu: { u: 2, s: now - DAY, d: now - 5 } })] }, { c: 20, b: [bld('armoury', now, { ug: 3 })] }]),
    nation([{ c: 10, b: [bld('armoury', now, { d: now + 1000 })] }])
  ];
  c.T = { byId: { me: 0 }, owner: { 10: 0, 20: 0 } };
  for (const n of recs) {
    c.S.nation = n;const srv = milReady(n, now), game = { ms: c.readyMs(n), max: c.maxReady(n) };
    assert.ok(milMs(15 * MIN, srv.cut) <= game.ms, 'the referee readies a point no later than the game: ' + JSON.stringify([srv, game]));
    assert.ok(6 + srv.extra >= game.max, 'and holds at least as many');
  }
  /* exactly the same where every city is held */
  c.S.nation = recs[2];assert.equal(milMs(15 * MIN, milReady(recs[2], now).cut), c.readyMs(recs[2]));
  assert.equal(6 + milReady(recs[2], now).extra, c.maxReady(recs[2]));
  /* the referee reads cities the game no longer holds, and veterans in the reserve */
  c.T.owner[20] = 1;assert.ok(6 + milReady(recs[2], now).extra > c.maxReady(recs[2]));
  assert.equal(milReady({ vet: { k: 'res', t: now - 1, u: now + DAY } }, now).extra, 1);
  assert.equal(milReady({ vet: { k: 'pen', t: now - 1, u: now + DAY } }, now).extra, 0);
  assert.equal(milReady({ vet: { k: 'res', t: now - 2 * DAY, u: now - 1 } }, now).extra, 0, 'a reserve stood down');
  assert.equal(milBlocks({ cities: 'x' }, 'armoury', now), -1);assert.equal(milBlocks(null, 'armoury', now), -1);
  assert.equal(milBlocks({ cities: [{ b: [{ k: 'armoury', d: now - 1, ug: 9 }] }] }, 'armoury', now), 0, 'blocks out of range count as none');
  assert.match(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'), /readiness\(st\.exists \? st\.data\(\) : \{\}, mine\.policies \|\| \{\}, now, drills, milReady\(mine, now\)\)/);
});

test('the Naval Dockyard: coastal hexes within 3 harder to take, and the water crossed at full strength', () => {
  const c = load(), a = {}, ct = (cell, ug) => ({ c: cell, done: ['dockyard'], ug: ug ? { dockyard: ug } : {} });
  c.nbCity(a, ct(50, 0));c.nbCity(a, ct(60, 5));
  assert.equal(a.mil.dockyard, 6, 'the best one held: gold');assert.equal(a.docks.length, 2);
  c.agg = [a, {}];
  assert.equal(c.cityDefMult(null, 0, 52), 1.25, 'coastal and within 3: +25%');
  assert.ok(Math.abs(c.cityDefMult(null, 0, 62) - 1.35) < 1e-9, 'near the gold one: +35%');
  assert.equal(c.cityDefMult(null, 0, 54), 1, 'four hexes away');
  assert.equal(c.cityDefMult(null, 0, 150), 1, 'inland');
  assert.equal(c.cityDefMult(null, 1, 52), 1, 'another nation');
  assert.match(c.cityDefNotes(null, 0, 52).join(' '), /naval dockyard guards this coast: 25% harder/);
  assert.equal(c.milNavy(null, 0), true);assert.equal(c.milNavy(null, 1), false);
  assert.match(src, /\(sea&&!pA\.navalFleet&&!milNavy\(T,ai\)\?Math\.min\(1,0\.75\+alFx\(A\.id\)\.sea\):1\)/, 'the battle drops the sea crossing loss');
  assert.match(src, /if\(milNavy\(T,ai\)\)out\.push\(`By sea, with/, 'and the battle report says why');
});

test('the Military Hospital: fewer people lost, and a quarter of a war\'s dead come home over a week', () => {
  const now = Date.now(), c = load();
  assert.equal(c.wrPopFx({}).l, 0.01, 'without one, the loss is the war\'s');
  c.myAgg = { mil: { milhosp: 1 } };
  assert.equal(c.wrPopFx({}).l, 0.008, '−20%');
  c.myAgg = { mil: { milhosp: 6 } };
  assert.equal(c.wrPopFx({}).l, 0.007, 'gold: −30%');
  /* a war ends: its report's losses start home from this count */
  const n = { pop: 30, popAt: now, mhr: [{ p: 1, t: now - 9 * DAY, u: now - 2 * DAY }] };
  const r = c.wr3Close(n, 'them', { p: 2 }, 'peace', now);
  assert.equal(r.p, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(n.mhr)), [{ p: 0.5, t: now, u: now + 7 * DAY }], 'a quarter, over a week; the finished entry dropped');
  const msg = c.COMMIT_HOOKS.map(h => h(n)).flat();
  assert.equal(msg.length, 1);assert.match(msg[0].m, /0\.5 million of the people the war with Vesad cost are coming home/);
  assert.deepEqual(c.COMMIT_HOOKS.map(h => h(n)).flat(), [], 'said once');
  /* counted in the population from the last count on */
  assert.ok(Math.abs(c.popNow(n, now + DAY) - (30 + 0.5 / 7)) < 1e-9, 'a seventh a day');
  assert.ok(Math.abs(c.popNow(n, now + 30 * DAY) - 30.5) < 1e-9, 'all of it after the week');
  assert.ok(Math.abs(c.milHomeAdd({ popAt: now + 3 * DAY, mhr: n.mhr }, now + 4 * DAY) - 0.5 / 7) < 1e-9, 'what was counted is not counted twice');
  assert.ok(Math.abs(c.growth({ mhr: n.mhr }) - (0.5 + 0.5 / 7)) < 1e-9, 'growth shows them coming');
  assert.equal(c.growth({ mhr: [{ p: 1, t: Date.now() + DAY, u: Date.now() + 8 * DAY }] }), 0.5, 'not before they start');
  /* no hospital, no losses: nobody comes home */
  c.myAgg = null;const m = { pop: 30, popAt: now };c.wr3Close(m, 'them', { p: 2 }, 'peace', now);assert.equal(m.mhr, undefined);
  c.myAgg = { mil: { milhosp: 1 } };c.wr3Close(m, 'them', { p: 0 }, 'peace', now);assert.equal(m.mhr, undefined);
  /* the record keeps sane entries only, four at most */
  const out = {}, d = { popAt: now, mhr: [{ p: 1, t: now, u: now + 7 * DAY }, { p: -1, t: now, u: now + DAY }, { p: 1, t: now, u: now + 30 * DAY }, { p: 1, t: now - 9 * DAY, u: now - DAY }, 'x'] };
  c.NORM_HOOKS[0](out, d);
  assert.deepEqual(JSON.parse(JSON.stringify(out.mhr)), [{ p: 1, t: now, u: now + 7 * DAY }]);
  const none = {};c.NORM_HOOKS[0](none, { mhr: 'x' });assert.equal(none.mhr, undefined);
});

test('the figures job counts the people coming home as the game does', () => {
  const now = Date.UTC(2026, 10, 22), rec = x => ({ s: {}, policies: {}, budget: {}, hist: [], pop: 20, popAt: now - DAY, founded: now - 100 * DAY, cities: [], ...x });
  const a = E.indicators('a', rec(), now, {}).pop, b = E.indicators('a', rec({ mhr: [{ p: 1.4, t: now - 2 * DAY, u: now + 5 * DAY }] }), now, {}).pop;
  assert.ok(Math.abs(b - a - 0.2) < 1e-9, 'a day of seven: ' + (b - a));
  assert.equal(E.indicators('a', rec({ mhr: 'x' }), now, {}).pop, a);
  const c = load(), n = { pop: 0, popAt: now - DAY, mhr: [{ p: 1.4, t: now - 2 * DAY, u: now + 5 * DAY }] };
  assert.ok(Math.abs(c.milHomeAdd(n, now) - 0.2) < 1e-9, 'the game agrees');
});

test('in words: the Cities page and the upgrade lines', () => {
  const c = load();
  assert.equal(c.nbUgLine('drillyard', 0, {}), 'a point of readiness comes back every 12 minutes instead of 15');
  assert.equal(c.nbUgLine('drillyard', 5, { rapidMobilisation: true }), 'a point of readiness comes back every 7 minutes instead of 10');
  assert.equal(c.nbUgLine('armoury', 5, {}), 'two more points of readiness held, and army strength +4%');
  assert.equal(c.nbUgLine('dockyard', 2, {}), 'coastal hexes within 3 29% harder to take, and no strength lost crossing the water');
  assert.equal(c.nbUgLine('milhosp', 1, {}), 'people lost to war −22%');
  assert.equal(c.nbUgLine('farm', 1, {}), '', 'others unchanged');
  c.T = { list: [{ n: { policies: {} } }] };
  const g = c.bldGain({ done: ['milhosp'], ug: { milhosp: 5 }, hi: 0 }, 'milhosp');
  assert.deepEqual(g.x.map(x => x.t), ['people lost to war −30%']);
  assert.match(src, /<h3 class="help-h3">Military buildings<\/h3>/, 'How to play explains them');
});
