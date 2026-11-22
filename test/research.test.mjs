// The National Research Programme (game/edictum.html, "the National Research Programme"; functions/research-rules.js;
// jobs/fx/engine.mjs researchOf; docs/research.md): the catalogue, its prerequisites and costs, the balance targets,
// what the server holds a save to (clock manipulation, replayed and unpaid saves, studies, grants, a nation founded
// again), readiness for the referee, alliances and licences, and the agreement of the game's copies with the server's.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../functions/research-rules.js';
import { milReady } from '../functions/war-rules.js';
import * as E from '../jobs/fx/engine.mjs';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const civic = readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const HEAD = '/* ───────── the National Research Programme (22 November 2026) ─────────';
const SEC = cut(HEAD, '/* ───────── military buildings (22 November 2026)');
const PURE = cut(HEAD, '/* ── the record ──');
const DAY = 864e5, HOUR = 36e5;

/* the pure part of the section in a context of its own: the catalogue, the rules, the effects */
function game() {
  const ctx = { Math, Object, Array, Number, JSON, String, Set, Map, Uint8Array, isFinite, console, roman: v => String(v), list: a => a.join(', ') };
  vm.createContext(ctx);
  vm.runInContext(PURE.replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  /* the institutions and the Grand Challenges are later in the section: their tables alone */
  const inst = cut('const RS_INST=[', '];') + '];', ch = cut('const RS_CH={', '\nconst RS_CH_KEYS=');
  vm.runInContext(inst.replace(/^const /, 'var ') + '\n' + ch.replace(/^const /, 'var '), ctx);
  return ctx;
}
const G = game(), J = v => JSON.parse(JSON.stringify(v));
const SPEC = [
  ['Market Economics', 'Sanitation', 'Basic Military Training'], ['Domestic Commerce', 'Public Health', 'Defensive Engineering'], ['Banking', 'Agricultural Science', 'Military Logistics'],
  ['Industrial Engineering', 'Public Education', 'Military Medicine'], ['International Commerce', 'Urban Planning', 'Intelligence Networks'], ['Mass Production', 'Civil Infrastructure', 'Mechanised Forces'],
  ['Global Logistics', 'Social Welfare', 'Strategic Command'], ['Financial Engineering', 'Advanced Medicine', 'Electronic Warfare'], ['Industrial Automation', 'Renewable Energy', 'Aerospace Defence'],
  ['Digital Economy', 'Smart Cities', 'Autonomous Defence'], ['Artificial Intelligence', 'Biotechnology', 'Cyber Warfare'], ['Advanced Economic Modelling', 'Advanced Infrastructure', 'Satellite Surveillance'],
  ['Advanced Manufacturing', 'Integrated Infrastructure', 'Strategic Intelligence'], ['International Banking', 'Universal Healthcare', 'Military Engineering'], ['Global Supply Chains', 'Advanced Education', 'Joint Operations'],
  ['Economic Resilience', 'Sustainable Development', 'National Security'], ['Financial Stability', 'Metropolitan Planning', 'Crisis Preparedness'], ['International Investment', 'Advanced Public Services', 'Cyber Defence'],
  ['Strategic Industries', 'National Innovation', 'Military Modernisation'], ['Economic Diplomacy', 'Institutional Excellence', 'Integrated Defence'], ['Industrial Independence', 'Resource Security', 'Strategic Deterrence'],
  ['Global Financial Leadership', 'Environmental Restoration', 'National Resilience'], ['Economic Sovereignty', 'Generational Prosperity', 'International Security'], ['Golden Economy', 'Golden Civilisation', 'Guardian of Sovereignty']];

test('exactly 360 technologies: three tracks, 24 tiers, five a tier, each complete', () => {
  assert.equal(G.RS.length, 360);
  assert.equal(new Set(G.RS.map(r => r.id)).size, 360, 'ids are unique');
  assert.equal(new Set(G.RS.map(r => r.n)).size, 360, 'names are unique');
  for (const [k, T] of G.RS_TRACKS.entries()) {
    assert.equal(G.RS_DATA[T.k].length, 24, T.n + ' has 24 tiers');
    for (let t = 1; t <= 24; t++) {
      assert.equal(G.RS_DATA[T.k][t - 1].length, 5, `${T.n} tier ${t} has five`);
      assert.equal(G.RS[G.rsIdx(k, t, 0)].n, SPEC[t - 1][k], `${T.n} tier ${t}'s milestone is ${SPEC[t - 1][k]}`);
    }
  }
  const icons = new Set(Object.keys(cut('const RS_ICO={', '\nconst RS_ICO_ALIAS=').match(/^\s+(\w+):'/gm).reduce((o, l) => (o[l.trim().split(':')[0]] = 1, o), {})));
  const alias = JSON.parse(cut('const RS_ICO_ALIAS=', ';\n').slice('const RS_ICO_ALIAS='.length).replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  for (const r of G.RS) {
    assert.match(r.id, /^[tgw]-[a-z0-9-]+$/, r.id + ': a stable id');
    assert.equal(r.id[0], G.RS_TRACKS[r.k].k, r.id + ' is in its track');
    assert.ok(r.d.length > 30 && /[.!?]$/.test(r.d), r.id + ' has a description');
    assert.ok(icons.has(r.ico) || icons.has(alias[r.ico]), r.id + ' has an icon: ' + r.ico);
    const fx = Object.keys(r.fx).filter(k => k !== 'u');
    assert.ok(fx.length, r.id + ' does something');
    assert.equal(r.i, G.rsIdx(r.k, r.t, r.s));
  }
  assert.deepEqual(J(G.RS_ERAS.map(e => e[0])), ['Foundations', 'Industrialisation', 'Modernisation', 'National Excellence', 'International Leadership', 'Golden Age']);
});

test('prices: tier I at 2, 3, 4, 6 and 10; each tier at its average; 125,415 in all; the grant buys three', () => {
  assert.deepEqual([1, 2, 3, 4, 0].map(s => G.RS[s].cost), [2, 3, 4, 6, 10]);
  for (let t = 1; t <= 24; t++) for (let k = 0; k < 3; k++) {
    const sum = [0, 1, 2, 3, 4].reduce((s, j) => s + G.RS[G.rsIdx(k, t, j)].cost, 0);
    assert.equal(sum, 5 * R.RS_AVG[t - 1], `tier ${t} averages ${R.RS_AVG[t - 1]}`);
    assert.equal(G.RS[G.rsIdx(k, t, 0)].cost, Math.max(...[0, 1, 2, 3, 4].map(j => G.RS[G.rsIdx(k, t, j)].cost)), 'the milestone is the dearest');
  }
  assert.equal(G.RS.reduce((s, r) => s + r.cost, 0), 125415);
  for (let i = 0; i < 360; i++) assert.equal(G.RS[i].cost, R.rsCost(i), 'the server prices it the same: ' + G.RS[i].id);
  /* the grant of 12: the three cheapest of tier I cost 9, and nothing in tiers I and II needs materials or waits */
  const cheap = G.RS.filter(r => r.t === 1 && r.k === 0).map(r => r.cost).sort((a, b) => a - b);
  assert.ok(cheap[0] + cheap[1] + cheap[2] <= R.RS_GRANTS.f && cheap[0] + cheap[1] + cheap[2] + cheap[3] > R.RS_GRANTS.f);
  for (const r of G.RS.filter(r => r.t <= 2)) { assert.deepEqual(J(G.rsMat(r.i)), {}, r.id + ': no materials'); assert.equal(r.h, 0, r.id + ': no timer'); }
  for (const r of G.RS.filter(r => r.t >= 3)) assert.ok(Object.values(G.rsMat(r.i)).every(v => v > 0), r.id + ': materials from tier III');
  for (const r of G.RS) assert.equal(r.h, R.rsHours(r.i), r.id + ': the same study time as the server');
});

test('prerequisites: valid, from lower tiers across tracks, and without a cycle', () => {
  assert.deepEqual(J(G.RS_X), R.RS_X);assert.deepEqual(J(G.RS_C), R.RS_C);assert.deepEqual(J(G.RS_RC), R.RS_RC);assert.deepEqual(J(G.RS_READY), R.RS_READY);assert.deepEqual(J(G.RS_RMAX), R.RS_RMAX);
  for (const [i, xs] of Object.entries(G.RS_X)) for (const x of xs) {
    assert.ok(G.RS[x], 'exists');assert.ok(G.RS[x].t < G.RS[i].t, `${G.RS[i].id} needs ${G.RS[x].id} of a lower tier`);assert.notEqual(G.RS[x].k, G.RS[i].k, 'of another track');
  }
  for (const c of Object.values(G.RS_C)) assert.ok(G.RS_CH[c], 'a Grand Challenge: ' + c);
  for (let i = 0; i < 360; i++) assert.deepEqual(J(G.rsPre(i)), R.rsPre(i), 'the same prerequisites on the server');
  /* acyclic: every technology can be reached in the server's order, each after its prerequisites */
  const seen = new Set();
  for (const i of R.RS_ORDER) { for (const p of R.rsPre(i)) assert.ok(seen.has(p), `${G.RS[i].id} after ${G.RS[p].id}`); seen.add(i); }
  assert.equal(seen.size, 360);
  /* the cross-track gates as asked: IX-X another track at IV, XI-XII both at VI, then all tracks, XVII the Grand Academy */
  assert.deepEqual(R.rsGates(0, 9), [{ o: 1, at: 4 }]);assert.deepEqual(R.rsGates(1, 11), [{ o: 2, at: 6 }]);assert.deepEqual(R.rsGates(2, 13), [{ o: 2, at: 8 }]);
  assert.deepEqual(R.rsGates(0, 17), [{ lab: 4 }]);assert.deepEqual(R.rsGates(0, 24), [{ o: 2, at: 22 }]);assert.deepEqual(R.rsGates(0, 8), []);
  for (let k = 0; k < 3; k++) for (let t = 1; t <= 24; t++) assert.deepEqual(J(G.rsGates(k, t)), R.rsGates(k, t));
  /* everything can be researched alone, with no alliance and no space programme: no technology needs either */
  for (const r of G.RS) assert.ok(!r.q.sp && !r.q.al, r.id);
});

test('effects: summed within their caps, and the readiness the referee reads', () => {
  const tot = {};
  for (const r of G.RS) for (const k of G.RS_FX_KEYS) if (r.fx[k]) tot[k] = (tot[k] || 0) + r.fx[k];
  for (const k of G.RS_FX_KEYS) assert.ok((tot[k] || 0) <= G.RS_FX_CAP[k] + 1e-9, `${k}: ${tot[k]} within ${G.RS_FX_CAP[k]}`);
  assert.ok(G.RS_FX_CAP.army <= 0.07 && G.RS_FX_CAP.def <= 0.16, 'no large combat multipliers');
  const all = new Uint8Array(45).fill(255), k = G.rsEnc(all), F = G.rsFxBits(k);
  assert.equal(F.n, 360);assert.equal(F.army, G.RS_FX_CAP.army);
  const w = R.rsWar({ nrp: { k } });
  assert.equal(w.rcut, F.rcut, 'the game and the referee cut readiness alike');assert.equal(w.extra, 1);
  const m = milReady({ nrp: { k }, cities: [] }, Date.now());
  assert.equal(m.extra, 1);assert.equal(m.rcut, w.rcut);
  assert.deepEqual(R.rsWar({}), { rcut: 0, extra: 0 }, 'none without research');
  /* the referee: a point's time cut by research before a Drill Ground's, as the game's wrappers run */
  assert.ok(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8').includes('milMs(milMs(trReadyMs((pol.rapidMobilisation ? 10 : 15) * 60000, drills || 0), m.rcut || 0), m.cut)'));
  assert.ok(SEC.indexOf('readyMs=(f=>function(n){const ms=f.apply(this,arguments),c=rsFxN(n).rcut') < src.indexOf('readyMs=(f=>function(n){const ms=f.apply(this,arguments),c=milDrillCut('), 'research wraps readyMs before the Drill Ground does');
});

test('Research Credits: 10 + Science / 5 + the institution, the targets at Science 50, and the most a save may earn', () => {
  assert.equal(R.rsBase(50, 0, 0), 20, 'a research statistic of 50 gives 20 a day');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(l => R.rsBase(50, l, 0)), [20, 30, 40, 55, 70, 95, 130, 175, 250]);
  assert.deepEqual(J(G.RS_INST.map(x => x[1])), R.RS_INST_BONUS);assert.deepEqual(J(G.RS_RULES.inst), R.RS_INST_BONUS);
  assert.equal(R.rsBase(100, 0, 0), 30);assert.equal(R.rsBase(-5, 0, 0), 10);assert.equal(R.rsBase(250, 0, 0), 30, 'Science counts to 100');
  assert.ok(R.rsRateMax(50, 0, 0) >= 20 * (1 + R.RS_INTL_MAX + R.RS_DOM_MAX), 'room for cooperation and the nation’s own boosts');
  assert.equal(G.RS_RULES.intlMax, R.RS_INTL_MAX);assert.equal(G.RS_RULES.discMax, R.RS_DISC_MAX);assert.equal(G.RS_RULES.domMax, R.RS_DOM_MAX);
  assert.deepEqual(JSON.parse(cut('const RS_GRANTS=', ';').slice(16).replace(/(\w+):/g, '"$1":')), R.RS_GRANTS);
  /* the institutions: the first with one track at tier IV, later ones with more of every track */
  const B = top => { const b = new Uint8Array(45); top.forEach((t, k) => { for (let x = 1; x <= t; x++) for (let s = 0; s < 5; s++) R.rsPut(b, R.rsIdx(k, x, s)); }); return b; };
  assert.equal(R.rsLevelMax(B([3, 0, 0])), 0);assert.equal(R.rsLevelMax(B([4, 0, 0])), 1);assert.equal(R.rsLevelMax(B([8, 4, 0])), 2);assert.equal(R.rsLevelMax(B([12, 8, 8])), 3);
  assert.equal(R.rsLevelMax(B([16, 16, 16])), 4);assert.equal(R.rsLevelMax(B([24, 24, 24])), 8);
  for (const t of [[4, 0, 0], [8, 4, 0], [16, 16, 16], [20, 18, 18]]) assert.equal(G.rsLevelMax(B(t)), R.rsLevelMax(B(t)));
  /* a timeline at Science 50: Tier I of one track in the first day, Tier IV (the first expansion) inside two weeks */
  let rc = 12, day = 0, done = 0;const order = [];for (let t = 1; t <= 4; t++) for (const s of [1, 2, 3, 4, 0]) order.push(R.rsCost(R.rsIdx(0, t, s)));
  const tierAt = [];for (const c of order) { while (rc < c) { rc += 20; day++; } rc -= c; done++; if (done % 5 === 0) tierAt.push(day); }
  assert.ok(tierAt[0] <= 1, 'Tier I within a day: ' + tierAt[0]);assert.ok(tierAt[3] <= 14, 'Tier IV within two weeks: ' + tierAt[3]);
});

/* a saved record with research, and the save that follows */
const T0 = Date.UTC(2026, 10, 22, 12);
const rec = (o = {}) => ({ founded: T0 - 30 * DAY, s: { sci: 50 }, nrp: { v: 1, a: T0 - 9 * DAY, i: T0 - 8 * DAY, ra: T0 - DAY, re: 100, rs: 80, l: 0, st: 5, k: R.rsEnc(new Uint8Array(45)), q: [], ap: [], gr: 'f', ...o } });
const bits = (...ix) => { const b = new Uint8Array(45); ix.forEach(i => R.rsPut(b, i)); return R.rsEnc(b); };
const next = (before, f) => { const n = JSON.parse(JSON.stringify(before)); f(n.nrp, n); return n; };

test('the server: credits by its own clock, never faster than the record allows', () => {
  const before = rec(), now = T0;
  /* a day at Science 50 and the laboratory: at most 20 a day (36.25 with every boost) */
  const honest = next(before, p => { p.re = 120; p.ra = now; });
  let k = R.rsSettle(honest, before, now, T0 - DAY);
  assert.equal(k.ok, true);assert.equal(honest.nrp.re, 120);
  /* a clock pushed a year ahead: the credits held to the server's day */
  const ahead = next(before, p => { p.re = 100 + 20 * 365; p.ra = now + 365 * DAY; });
  k = R.rsSettle(ahead, before, now, T0 - DAY);
  assert.equal(k.ok, false);assert.ok(ahead.nrp.re <= 100 + R.rsRateMax(50, 0, 0) + R.RS_EPS && ahead.nrp.ra <= now + R.RS_SKEW, ahead.nrp);
  /* a save sent twice: the second adds nothing the first did not */
  const again = next(honest, () => {});
  k = R.rsSettle(again, honest, now + 1000, now);
  assert.equal(again.nrp.re, 120);
  /* spent never falls, earned never falls, research never lost */
  const back = next(honest, p => { p.rs = 0; p.re = 10; p.k = bits(); });
  const withK = next(honest, p => { p.k = bits(1, 2); });
  R.rsSettle(back, withK, now + 2000, now);
  assert.ok(back.nrp.rs >= 80 && back.nrp.re >= 120 && R.rsHas(R.rsBits(back.nrp.k), 1) && R.rsHas(R.rsBits(back.nrp.k), 2), back.nrp);
});

test('the server: a technology needs its prerequisites, its gates and its price', () => {
  const before = rec({ re: 50, rs: 0, ra: T0 }), now = T0 + 1000;
  /* three of tier I paid for (9, or 6.75 with the most discount) */
  const ok = next(before, p => { p.k = bits(1, 2, 3); p.rs = 9; p.ra = now; });
  assert.equal(R.rsSettle(ok, before, now, T0).ok, true);assert.equal(ok.nrp.k, bits(1, 2, 3));
  /* unpaid: taken back whole */
  const free = next(before, p => { p.k = bits(1, 2, 3); p.ra = now; });
  const kf = R.rsSettle(free, before, now, T0);
  assert.equal(kf.ok, false);assert.equal(free.nrp.k, bits());
  /* a milestone before its tier's four, a tier before the last is complete: refused */
  const early = next(before, p => { p.k = bits(0, 5); p.rs = 30; p.ra = now; });
  R.rsSettle(early, before, now, T0);
  assert.equal(early.nrp.k, bits());
  /* a gate: Tier IX of Trade before any other track reaches IV */
  const b8 = []; for (let t = 1; t <= 8; t++) for (let s = 0; s < 5; s++) b8.push(R.rsIdx(0, t, s));
  const deep = rec({ k: bits(...b8), re: 1e5, rs: 0, ra: T0 });
  assert.equal(R.rsOpen(R.rsIdx(0, 9, 1), R.rsBits(deep.nrp.k), 0, null), false);
  const b4 = []; for (let t = 1; t <= 4; t++) for (let s = 0; s < 5; s++) b4.push(R.rsIdx(1, t, s));
  assert.equal(R.rsOpen(R.rsIdx(0, 9, 1), R.rsBits(bits(...b8, ...b4)), 0, null), true);
});

test('the server: studies start after the saved record, run their time, and finish only by its clock', () => {
  const b4 = []; for (let t = 1; t <= 4; t++) for (let s = 0; s < 5; s++) b4.push(R.rsIdx(0, t, s));
  const i = R.rsIdx(0, 5, 1), price = R.rsCost(i), now = T0;
  const before = rec({ k: bits(...b4), re: 1000, rs: 0, ra: now });
  /* begun now, paid, two hours */
  const start = next(before, p => { p.q = [[i, now, now + 2 * HOUR, price, 0]]; p.rs = price; p.ra = now; });
  assert.equal(R.rsSettle(start, before, now, now - 60000).ok, true);assert.equal(start.nrp.q.length, 1);
  /* backdated a day: refused */
  const back = next(before, p => { p.q = [[i, now - DAY, now - DAY + 2 * HOUR, price, 0]]; p.rs = price; p.ra = now; });
  R.rsSettle(back, before, now, now - 60000);assert.equal(back.nrp.q.length, 0);
  /* shorter than its time: refused */
  const quick = next(before, p => { p.q = [[i, now, now + 60000, price, 0]]; p.rs = price; p.ra = now; });
  R.rsSettle(quick, before, now, now - 60000);assert.equal(quick.nrp.q.length, 0);
  /* finished before its end: not yet */
  const soon = next(start, p => { p.k = bits(...b4, i); p.q = []; });
  R.rsSettle(soon, start, now + HOUR, now);assert.equal(R.rsHas(R.rsBits(soon.nrp.k), i), false);
  /* finished after its end: researched, the study gone */
  const done = next(start, p => { p.k = bits(...b4, i); p.q = []; p.ra = now + 3 * HOUR; });
  assert.equal(R.rsSettle(done, start, now + 3 * HOUR, now).ok, true);assert.equal(R.rsHas(R.rsBits(done.nrp.k), i), true);assert.equal(done.nrp.q.length, 0);
  /* emergency funding halves it, once */
  const half = next(start, p => { p.q[0][2] = now + HOUR; p.q[0][4] = 1; });
  R.rsSettle(half, start, now + 60000, now);assert.equal(half.nrp.q[0][2], now + HOUR);
  /* a technology of tier V bought outright, with no study: refused */
  const direct = next(before, p => { p.k = bits(...b4, i); p.rs = price; p.ra = now; });
  R.rsSettle(direct, before, now, now - 60000);assert.equal(R.rsHas(R.rsBits(direct.nrp.k), i), false);
});

test('the server: grants once, institutions one at a time, pledges paid, a nation founded again starts afresh', () => {
  const now = T0;
  /* the founding grant at the inauguration, once */
  const before = { founded: T0 - 30 * DAY, s: { sci: 50 }, nrp: { v: 1, a: T0 - DAY, st: 4, l: 0, k: bits(), q: [], ap: [], re: 0, rs: 0 } };
  const open = next(before, p => { p.st = 5; p.i = now; p.ra = now; p.re = 12; p.gr = 'f'; });
  assert.equal(R.rsSettle(open, before, now, now - 60000).ok, true);assert.equal(open.nrp.re, 12);
  const twice = next(open, p => { p.re = 24; p.gr = 'ff'; });
  R.rsSettle(twice, open, now + 1000, now);assert.ok(twice.nrp.re < 13, 'the grant counts once');
  /* a letter's grant: once */
  const letter = next(open, p => { p.re = 27; p.gr = 'fa'; });
  assert.equal(R.rsSettle(letter, open, now + 1000, now).ok, true);assert.equal(letter.nrp.re, 27);
  /* the institution: not past what the research allows, and one level at a time */
  const jump = next(open, p => { p.l = 3; });
  R.rsSettle(jump, open, now + 1000, now);assert.equal(jump.nrp.l, 0);
  /* a pledge to an alliance's project must be paid for */
  const pl = rec({ re: 200, rs: 0, ra: now });
  const unpaid = next(pl, p => { p.ap = [{ t: now, a: 'al1', q: 100 }]; });
  R.rsSettle(unpaid, pl, now, now - 60000);assert.equal(unpaid.nrp.ap.length, 0);
  const paid = next(pl, p => { p.ap = [{ t: now, a: 'al1', q: 100 }]; p.rs = 100; });
  assert.equal(R.rsSettle(paid, pl, now, now - 60000).ok, true);assert.equal(paid.nrp.ap.length, 1);
  /* founded again: the old research is not carried over, and a new record cannot claim it */
  const fresh = { founded: now, s: { sci: 50 }, nrp: { v: 1, a: now, st: 0, l: 0, k: bits(1, 2, 3), re: 500, rs: 9, q: [], ap: [] } };
  R.rsSettle(fresh, rec(), now, now - 60000);assert.equal(fresh.nrp.k, bits());assert.ok(fresh.nrp.re < 1);
  /* a save without its research: the research stays */
  const gone = { founded: T0 - 30 * DAY, s: { sci: 50 } };
  R.rsSettle(gone, rec({ k: bits(1) }), now, now - 60000);assert.equal(gone.nrp.k, bits(1));
  assert.equal(R.rsSettle({ founded: 1 }, {}, now, 0), null, 'nothing to settle without research');
});

test('the save permit settles research on every save, and the game takes back what the server did not keep', () => {
  assert.match(civic, /const rsKept = rsSettle\(n, before, now,/);assert.match(civic, /rs: rsKept/);
  assert.match(shim, /rs: isObj\(approved\.rs\) \? approved\.rs : null/);
  assert.match(SEC, /window\.addEventListener\('edictum:saved',e=>\{[\s\S]*?k\.ok===false/);
  assert.ok(!/NX_KEYS\.nrp|'nrp'/.test(shim.slice(shim.indexOf('var NX_KEYS'), shim.indexOf('function splitNation'))), 'n.nrp stays in the shared half, which the server and the referee read');
  assert.match(shim, /NX_KEYS\.nrx = 1/);
});

test('the currency job reads research as the game does', () => {
  assert.deepEqual(E.RS_FXI, J(Object.fromEntries(G.RS.filter(r => r.fx.fx).map(r => [r.i, r.fx.fx]))));
  assert.deepEqual(E.RS_CFI, J(Object.fromEntries(G.RS.filter(r => r.fx.cf).map(r => [r.i, r.fx.cf]))));
  assert.deepEqual(E.RS_CBI, J(Object.fromEntries(G.RS.filter(r => r.fx.bx && r.fx.bx.cbank).map(r => [r.i, r.fx.bx.cbank]))));
  const all = G.rsEnc(new Uint8Array(45).fill(255)), F = G.rsFxBits(all);
  assert.deepEqual(E.researchOf({ nrp: { i: 1, k: all } }, false), { fx: F.fx, cf: F.cf });
  assert.deepEqual(E.researchOf({ nrp: { i: 1, k: all } }, true), { fx: F.fx, cf: Math.min(0.5, F.cf + F.bx.cbank * 0.5) });
  assert.deepEqual(E.researchOf({ nrp: { k: all } }, true), { fx: 0, cf: 0 }, 'nothing before the laboratory opens');
  assert.deepEqual(E.researchOf({}, true), { fx: 0, cf: 0 });
});

test('the petition, the letters and the edicts research brings', () => {
  const disc = cut('const RS_DISC={', '\nconst RS_DISC_FX=');
  for (const f of ['rep', 'crn', 'imp', 'sul', 'the', 'peo', 'col', 'bor']) assert.match(disc, new RegExp(`\\n  ${f}:\\{q:'`), 'a version for ' + f);
  assert.equal((disc.match(/“[^”]+,” says /g) || []).length, 24, 'three answers each, in the house style');
  assert.match(SEC, /const RS_AT=75,RS_AGAIN=5,RS_ID='rs-discovery'/);
  assert.match(SEC, /ISSUES\.push\(\{id:RS_ID,c:'tech',fo:1,rsx:1,t:'A Nation of Discovery'/);
  const L = cut('const RS_LETTERS=[', '\nfor(const L of RS_LETTERS)'), ids = [...L.matchAll(/\{id:'(rsl-[a-z-]+)'/g)].map(m => m[1]);
  assert.equal(ids.length, 12);assert.equal(new Set(ids).size, 12);
  assert.ok(/inauguration|open/.test(L) && /emigrat|chair abroad/.test(L) && /trials/i.test(L) && /accident/i.test(L) && /interfere|Minister Disagrees/.test(L) && /Request From Abroad/.test(L), 'the events asked for');
  const D = cut('const RS_DILEMMAS=[', '\nfor(const D of RS_DILEMMAS)');
  for (const m of D.matchAll(/rq:'([a-z0-9-]+)'/g)) assert.ok(G.RS_BY[m[1]], 'a dilemma needs a real technology: ' + m[1]);
  assert.match(src, /if\(k<0\)\{if\(a\.o>=0&&!\/\^\(mc\|rsl\)-\/\.test\(a\.id\)\)W\(\)\.e\+\+;continue;\}/, 'letters are not enacted edicts');
  /* appended after every other edict, so no edict number moves */
  const last = Math.max(...[...src.matchAll(/ISSUES\.push\(/g)].map(m => m.index));
  assert.ok(last > src.indexOf(HEAD), 'the last edicts pushed are research’s');
  for (const id of ['openScience', 'classifiedResearch', 'researchEthics', 'healthCoop', 'sciExchange', 'tradeStandards', 'natureConvention', 'researchFund', 'nuclearSafety', 'armsControl'])
    assert.match(src, new RegExp(`\\n  ${id}:\\['`), 'a law: ' + id);
  const asm = readFileSync(new URL('../functions/assembly-engine.js', import.meta.url), 'utf8');
  for (const c of ['healthcoop', 'sciex', 'standards', 'natcon', 'resfund', 'nuclear', 'armsctl']) { assert.match(asm, new RegExp(`\\b${c}:\\{n:'`), 'the server knows the convention ' + c); }
  const req = cut('const RS_ASM_REQ=', ';');for (const m of req.matchAll(/:'([a-z0-9-]+)'/g)) assert.ok(G.RS_BY[m[1]], m[1]);
});

test('alliances and licences: the same rules in the game and on the server', () => {
  const g = cut('const RS_AL_PROJ=', '\nconst RS_LIC=');
  for (const [ty, P] of Object.entries(R.RS_AL_PROJ)) for (const k of ['p', 'g']) assert.ok(g.includes(`n:'${P[k].n}',tr:'${P[k].tr}',disc:${P[k].disc}`), ty + ' ' + k);
  assert.ok(g.includes(JSON.stringify(R.RS_AL_SCALE).replace(/"/g, '').slice(1, -1).slice(0, 40)), 'the same scale');
  for (const ty of Object.keys(R.RS_AL_PROJ)) for (const k of ['p', 'g']) { const d = R.RS_AL_PROJ[ty][k].disc; assert.ok(d <= R.RS_DISC_MAX); }
  assert.equal(R.rsAlNeed('p', 1), 360);assert.equal(R.rsAlNeed('p', 5), 600);assert.equal(R.rsAlNeed('p', 40), 1500);assert.equal(R.rsAlNeed('g', 4), 2000);
  assert.equal(R.RS_LIC.disc, 0.2, 'a licence takes at most 20% off');
  const fee = cut('function rsLicFee(i){', '\nconst rsAlCost=');
  vm.runInContext(fee.replace(/^function /, 'function '), G);
  for (const i of [0, 5, 130, 250, 359]) assert.deepEqual(J(G.rsLicFee(i)), R.rsLicFee(i));
  const al = readFileSync(new URL('../functions/alliances.js', import.meta.url), 'utf8'), tr = readFileSync(new URL('../functions/treaties.js', import.meta.url), 'utf8');
  assert.match(al, /alStudy, alRsStart, alRsGive \};/);assert.match(tr, /trEnd, trLic, trLicAns \};/);
  assert.match(tr, /refuse\('lic_pact'/);assert.match(tr, /refuse\('lic_once'/);assert.match(tr, /refuse\('lic_week'/);assert.match(tr, /refuse\('lic_age'/);
  assert.match(al, /if \(!p \|\| p\.a !== aid \|\| !Number\.isFinite\(p\.t\) \|\| p\.t <= lt/, 'a pledge is credited once (watermark)');
  assert.match(readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), /match \/rsLic\/\{lid\} \{ allow read: if request\.auth != null && request\.auth\.uid in resource\.data\.p; \}/);
});
