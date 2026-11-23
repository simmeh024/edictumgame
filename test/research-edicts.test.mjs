// Research edicts (game/edictum.html, "research edicts (23 November 2026)"; functions/research-rules.js RS_ED_MAX,
// RS_Q_MIN, RS_Q_MAX): sixty edicts that speed research up or slow it down, and four research laws. The catalogue and
// its place in the file, the game's bounds agreeing with the server's, what the server now lets a save do with studies
// and credits, and the effects' arithmetic (run on its own in a context of its own).
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../functions/research-rules.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const HEAD = '/* ───────── research edicts (23 November 2026) ─────────';
const cut = (a, b, from = 0) => { const i = src.indexOf(a, from), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const SEC = cut(HEAD, '\nif(hot&&typeof hot.snapshot');
const DAY = 864e5, HOUR = 36e5, J = v => JSON.parse(JSON.stringify(v));

/* the catalogue, read on its own */
const LIST = (() => { const ctx = {}; vm.createContext(ctx); vm.runInContext(cut('const RSV_ISSUES=[', '\nfor(const is of RSV_ISSUES)').replace('const RSV_ISSUES', 'var RSV_ISSUES'), ctx); return J(ctx.RSV_ISSUES); })();
const STAT = JSON.parse(src.match(/const STAT_KEYS = (\[[^\n]+\]);/)[1].replace(/'/g, '"'));
const POL = new Set([...cut('const POLICIES = {', '\n};').matchAll(/\n  ([a-zA-Z]+):\['/g)].map(m => m[1]));
const RKEYS = ['rcb', 'rcp', 'rqn', 'rqs', 'rcx'], LAWS = ['researchTenure', 'scienceAusterity', 'peerReview', 'fastTrackScience'];
const research = e => Object.keys(e).some(k => RKEYS.includes(k)) || !!(e.p && Object.keys(e.p).some(k => LAWS.includes(k)));

test('sixty edicts, appended after every other, each changing how fast research goes', () => {
  assert.equal(LIST.length, 60);
  assert.equal(new Set(LIST.map(x => x.id)).size, 60);
  for (const is of LIST) assert.match(is.id, /^rsv-[a-z0-9-]+$/);
  /* no edict number moves: these are the last edicts pushed */
  const last = Math.max(...[...src.matchAll(/ISSUES\.push\(/g)].map(m => m.index));
  assert.ok(last > src.indexOf(HEAD), 'the research edicts are pushed last');
  assert.ok(src.indexOf(HEAD) > src.indexOf('/* ───────── military buildings (22 November 2026)'), 'after the military buildings');
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'RSV_ISSUES'/, 'a content catalogue');
  const topics = [...src.match(/const ISSUE_TOPICS = (\[.*?\]\]);/)[1].matchAll(/\['([a-z]+)','/g)].map(m => m[1]);
  for (const is of LIST) {
    assert.ok(topics.includes(is.c), is.id + ' has an edict topic');
    assert.equal(is.o.length, 3, is.id);
    assert.ok(is.o.filter(o => research(o.e)).length >= 2, is.id + ': at least two options change research');
    for (const o of is.o) {
      assert.match(o.t, /^“[^”]+,” says /, is.id + ' in the house style');
      for (const s of [is.t, is.q, o.t, o.fx, o.g && o.g.fx]) if (s) assert.doesNotMatch(s, /['"]/, is.id + ': typographic quotes only');
      for (const e of [o.e, o.g && o.g.e].filter(Boolean)) for (const [k, v] of Object.entries(e)) {
        if (STAT.includes(k)) { assert.ok(Number.isInteger(v) && v && Math.abs(v) <= 4, `${is.id} ${k}`); continue; }
        if (k === 'p') { for (const pk of Object.keys(v)) assert.ok(POL.has(pk), is.id + ' a real law ' + pk); continue; }
        if (k === 'b') continue;
        assert.ok(RKEYS.includes(k), `${is.id}: ${k}`);
        if (k === 'rqn') assert.ok(Number.isInteger(v) && v && Math.abs(v) <= 50, is.id);
        else if (k === 'rcx') assert.ok(v < 0 && v >= -2, is.id);
        else { const [pc, d, t] = v; assert.ok(Number.isInteger(pc) && pc && Math.abs(pc) <= 30 && Number.isInteger(d) && d >= 1 && d <= 7 && (t === undefined || ['t', 'g', 'w'].includes(t)), `${is.id} ${k} ${JSON.stringify(v)}`); }
      }
    }
  }
  /* both ways: speeding up and slowing down, now and for some days */
  const all = LIST.flatMap(is => is.o.flatMap(o => [o.e, o.g && o.g.e].filter(Boolean)));
  for (const [k, sign] of [['rcb', 1], ['rcb', -1], ['rqn', 1], ['rqn', -1], ['rqs', 1], ['rqs', -1], ['rcp', 1], ['rcx', -1]])
    assert.ok(all.some(e => e[k] !== undefined && Math.sign(Array.isArray(e[k]) ? e[k][0] : e[k]) === sign), `some option has ${k} ${sign > 0 ? 'up' : 'down'}`);
  /* ten gambles, whose loss has research effects of its own */
  const g = LIST.flatMap(is => is.o.filter(o => o.g).map(o => [is.id, o.g]));
  assert.equal(g.length, 10);
  for (const [id, x] of g) { assert.ok(x.p > 0 && x.p < 1 && x.w && x.l && x.fx, id); assert.ok(research(x.e), id + ': losing changes research too'); }
  /* four stories of three: a starter in the pool and two follow-ups reached from every option */
  const fo = LIST.filter(x => x.fo);
  assert.equal(fo.length, 8);
  for (const s of ['comet', 'feud', 'wing', 'prodigy']) {
    const [a, b, c] = [1, 2, 3].map(k => LIST.find(x => x.id === `rsv-${s}-${k}`));
    assert.ok(a && b && c && !a.fo && b.fo && c.fo, s);
    assert.ok(a.o.every(o => o.nx === b.id && o.nxh >= 4) && b.o.every(o => o.nx === c.id && o.nxh >= 4) && c.o.every(o => !o.nx), s + ' runs in order');
  }
  /* some only while a study is under way, and those may name it */
  for (const is of LIST.filter(x => x.sq)) assert.ok(is.o.some(o => o.e.rqn !== undefined || (o.g && o.g.e.rqn !== undefined)), is.id + ' hurries or holds up the study');
  assert.ok(LIST.filter(x => /\{RSSTUDY\}/.test(x.q)).every(x => x.sq), 'only a study-time edict names the study');
  /* a choice of track */
  const track = LIST.find(x => x.id === 'rsv-whose-first');
  assert.deepEqual(track.o.map(o => o.e.rcp[2]), ['t', 'g', 'w']);
  /* each starts the random pool only with the laboratory open; follow-ups never */
  assert.match(SEC, /for\(const is of RSV_ISSUES\)\{ISSUES\.push\(is\);is\.no=ISSUES\.length;ISSUE_BY_ID\[is\.id\]=is;is\.nbx=false;is\.nr=true;if\(is\.fo\)continue;if\(!is\.w\)is\.w=2;is\.req=is\.sq\?n=>rseOpen\(n\)&&rseStudying\(n\):n=>rseOpen\(n\);ISSUES_RANDOM\.push\(is\);\}/);
});

test('four research laws, in pairs that cannot stand together', () => {
  for (const k of LAWS) assert.ok(POL.has(k), k);
  assert.match(src, /\['researchTenure','scienceAusterity'\],\['peerReview','fastTrackScience'\]\]\.filter/);
  const civic = JSON.parse(readFileSync(new URL('../functions/civic-data.json', import.meta.url), 'utf8'));
  assert.ok(civic.conflicts.some(([a, b]) => a === 'researchTenure' && b === 'scienceAusterity') && civic.conflicts.some(([a, b]) => a === 'peerReview' && b === 'fastTrackScience'), 'the server knows the conflicts (tools/build-civic.mjs)');
  for (const k of LAWS) assert.ok(LIST.some(is => is.o.some(o => o.e.p && o.e.p[k])), 'an edict makes ' + k);
  const st = readFileSync(new URL('../functions/stats-research.js', import.meta.url), 'utf8');
  for (const k of LAWS) assert.ok(st.includes(`'${k}'`), 'the admin statistics count ' + k);
});

test('the game and the server hold research to the same bounds', () => {
  const rules = src.match(/const RS_RULES=\{[^\n]+\n[^\n]+/)[0];
  assert.match(rules, new RegExp(`edMax:${R.RS_ED_MAX},qMin:${R.RS_Q_MIN},qMax:${R.RS_Q_MAX},`));
  assert.ok(R.RS_ED_MAX > 0 && R.RS_Q_MIN === 0.5 && R.RS_Q_MAX >= 2);
  /* every edict's own boost stays within the cap, and no study cut could pass the floor alone */
  for (const is of LIST) for (const o of is.o) for (const e of [o.e, o.g && o.g.e].filter(Boolean)) {
    if (e.rcb) assert.ok(e.rcb[0] / 100 <= R.RS_ED_MAX, is.id);
    if (e.rqn) assert.ok(e.rqn / 100 <= 1 - R.RS_Q_MIN, is.id);
  }
  /* emergency funding never asks the server for less than RS_Q_MIN of a study's time */
  assert.match(src, /const half=Math\.max\(e\[1\]\+\(e\[2\]-e\[1\]\)\/2,e\[1\]\+RS\[e\[0\]\]\.h\*3600e3\*RS_RULES\.qMin\);/);
  /* a study begun takes the time the edicts and laws give it */
  assert.match(src, /const ms=rsStudyMs\(n,i,now\);p\.q=\(p\.q\|\|\[\]\)\.concat\(\[\[i,now,now\+ms,price,0,/);
});

/* the server */
const T0 = Date.UTC(2026, 10, 23, 12);
const bits = (...ix) => { const b = new Uint8Array(45); for (const i of ix) R.rsPut(b, i); return R.rsEnc(b); };
const rec = p => ({ founded: T0 - 30 * DAY, s: { sci: 50 }, nrp: Object.assign({ i: T0 - 10 * DAY, l: 0, q: [], ap: [], gr: 'f' }, p) });
const next = (before, f) => { const n = J(before); f(n.nrp, n); return n; };

test('the server: credits may carry the research edicts’ boost', () => {
  const before = rec({ k: bits(), re: 100, rs: 0, ra: T0 });
  const base = R.rsBase(50, 0, 0), most = (base + R.RS_BLD_RC_MAX) * (1 + R.RS_INTL_MAX + R.RS_DOM_MAX + R.RS_ED_MAX);
  assert.equal(R.rsRateMax(50, 0, 0), most);
  /* a day at the base rate with the edicts' whole boost, and international cooperation's and the report's: kept */
  const full = next(before, p => { p.re = 100 + base * (1 + R.RS_INTL_MAX + R.RS_DOM_MAX + R.RS_ED_MAX); p.ra = T0 + DAY; });
  assert.equal(R.rsSettle(full, before, T0 + DAY, T0).ok, true);
  /* more than the most: cut back */
  const over = next(before, p => { p.re = 100 + most * 1.2; p.ra = T0 + DAY; });
  assert.equal(R.rsSettle(over, before, T0 + DAY, T0).ok, false);
  assert.ok(over.nrp.re <= 100 + most + 1);
  /* credits spent by an edict (more spent than bought): fine */
  const spent = next(before, p => { p.rs = 30; p.ra = T0; });
  assert.equal(R.rsSettle(spent, before, T0, T0).ok, true);assert.equal(spent.nrp.rs, 30);
  /* the edicts' record rides along untouched */
  const ed = next(before, p => { p.ed = [{ k: 'c', v: 0.2, a: T0, u: T0 + 3 * DAY, id: 'rsv-night-shift' }]; });
  R.rsSettle(ed, before, T0, T0);assert.deepEqual(ed.nrp.ed, [{ k: 'c', v: 0.2, a: T0, u: T0 + 3 * DAY, id: 'rsv-night-shift' }]);
});

test('the server: a study may be made shorter (to half its time) or longer (to three times), no further', () => {
  const b4 = []; for (let t = 1; t <= 4; t++) for (let s = 0; s < 5; s++) b4.push(R.rsIdx(0, t, s));
  const i = R.rsIdx(0, 5, 1), price = R.rsCost(i), full = R.rsHours(i) * HOUR, now = T0;
  const before = rec({ k: bits(...b4), re: 1000, rs: 0, ra: now });
  const begin = len => next(before, p => { p.q = [[i, now, now + len, price, 0]]; p.rs = price; p.ra = now; });
  /* begun fast-tracked: 60% of its time is fine, 40% is not */
  const quick = begin(full * 0.6);assert.equal(R.rsSettle(quick, before, now, now - 60000).ok, true);assert.equal(quick.nrp.q.length, 1);
  const tooQuick = begin(full * 0.4);R.rsSettle(tooQuick, before, now, now - 60000);assert.equal(tooQuick.nrp.q.length, 0);
  /* begun slowed: twice its time is fine; ten times is held to three */
  const slow = begin(full * 2);assert.equal(R.rsSettle(slow, before, now, now - 60000).ok, true);
  const tooSlow = begin(full * 10);assert.equal(R.rsSettle(tooSlow, before, now, now - 60000).ok, false);assert.equal(tooSlow.nrp.q[0][2], now + full * R.RS_Q_MAX);
  /* a study held: an edict hurries it to 60% (kept), or past half (held to half) */
  const held = begin(full);R.rsSettle(held, before, now, now - 60000);
  const hurried = next(held, p => { p.q[0][2] = now + full * 0.6; });
  assert.equal(R.rsSettle(hurried, held, now + 60000, now).ok, true);assert.equal(hurried.nrp.q[0][2], now + full * 0.6);
  const rushed = next(held, p => { p.q[0][2] = now + full * 0.2; });
  assert.equal(R.rsSettle(rushed, held, now + 60000, now).ok, false);assert.equal(rushed.nrp.q[0][2], now + full * R.RS_Q_MIN);
  /* held up: later is kept, up to three times its time */
  const later = next(held, p => { p.q[0][2] = now + full * 1.5; });
  assert.equal(R.rsSettle(later, held, now + 60000, now).ok, true);assert.equal(later.nrp.q[0][2], now + full * 1.5);
  const never = next(held, p => { p.q[0][2] = now + full * 9; });
  assert.equal(R.rsSettle(never, held, now + 60000, now).ok, false);assert.equal(never.nrp.q[0][2], now + full * R.RS_Q_MAX);
  /* a hurried study finishes at its new end, not before */
  const early = next(hurried, p => { p.k = bits(...b4, i); p.q = []; p.ra = now + full * 0.5; });
  R.rsSettle(early, hurried, now + full * 0.5, now);assert.equal(R.rsHas(R.rsBits(early.nrp.k), i), false);
  const done = next(hurried, p => { p.k = bits(...b4, i); p.q = []; p.ra = now + full * 0.61; });
  assert.equal(R.rsSettle(done, hurried, now + full * 0.61, now).ok, true);assert.equal(R.rsHas(R.rsBits(done.nrp.k), i), true);
});

/* the arithmetic, on its own: the section's functions up to geoAfter, with what they call stubbed */
function engine(laws = {}) {
  const RS = [{ i: 0, n: 'Steam Power', k: 0, h: 12 }, { i: 1, n: 'Sanitation', k: 1, h: 6 }];
  const ctx = {
    Math, Object, Array, Number, JSON, String, Set, Map, isFinite, console, DAY, RS, RS_TRACKS: [{ k: 't' }, { k: 'g' }, { k: 'w' }],
    RS_RULES: { discMax: 0.25, edMax: R.RS_ED_MAX, qMin: R.RS_Q_MIN, qMax: R.RS_Q_MAX },
    POLICIES: { researchTenure: ['Research Tenure Act'], scienceAusterity: ['Science Austerity Act'], peerReview: ['Peer Review Act'], fastTrackScience: ['Fast-Track Science Act'] },
    ISSUE_BY_ID: { 'rsv-a': { t: 'Edict A' }, 'rsv-b': { t: 'Edict B' } }, fill: t => t, pol: () => laws, NORM_HOOKS: [],
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)), rsNum: (v, lo, hi) => typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo,
    rsOf: n => n && n.nrp, rsNow: () => ctx.NOW, NOW: 0, list: a => a.join(', '), cap1: s => s && s[0].toUpperCase() + s.slice(1), fmtAmt: x => String(Math.round(x * 10) / 10),
    fmtDur: ms => Math.round(ms / HOUR) + ' h', fmtTime: () => '12:00', dayTail: () => '', rsLog: () => {},
    rsStudyMs: (n, i) => RS[i].h * HOUR, rsRateParts: () => ({ v: 10, base: 10, intl: { v: 0 }, dom: { v: 0 }, parts: [] }), rsDisc: () => ({ v: 0, parts: [] }), rsBal: () => 0, rsAccrue: () => 0
  };
  vm.createContext(ctx);
  const code = cut('const RSE_FLOOR=', '\ngeoAfter=(f=>function(n,opt,ent,now,prior){');
  vm.runInContext(code.replace(/^const /gm, 'var ') + '\nvar rsRate=(n,t)=>rsRateParts(n,t).v;', ctx);
  return ctx;
}

test('the arithmetic: boosts capped together, credits counted piece by piece, studies bounded', () => {
  const G = engine(), n = { nrp: { i: 1, re: 0, rs: 0, ra: 0, q: [] } };
  /* words for each kind */
  assert.deepEqual(J(G.rseWords({ rcb: [20, 3], rcp: [-10, 1, 'w'], rqn: 25, rqs: [15, 2, 'g'], rcx: -0.5 })), ['Research Credits +20% for 3 days', 'War research 10% dearer for a day', 'studies under way finish sooner (25% of the time left cut)', 'Growth studies begun in the next 2 days take 15% less time', 'half a day’s Research Credits spent']);
  assert.match(G.rseWords({ p: { peerReview: true } })[0], /^the Peer Review Act becomes law: studies 15% longer/);
  assert.deepEqual(J(G.rseWords({ happy: 1 })), []);
  /* the rate: two boosts of 25% and 20% add 30% at most; a slowdown counts in full; never below −50% */
  n.nrp.ed = [{ k: 'c', v: 0.25, a: 0, u: 3 * DAY, id: 'rsv-a' }, { k: 'c', v: 0.2, a: 0, u: DAY, id: 'rsv-b' }];
  assert.equal(G.rseRateParts(n, HOUR).v, R.RS_ED_MAX);
  n.nrp.ed.push({ k: 'c', v: -0.2, a: 0, u: 2 * DAY, id: 'rsv-b' });
  assert.equal(G.rseRateParts(n, HOUR).v, Math.round((R.RS_ED_MAX - 0.2) * 1000) / 1000);
  n.nrp.ed = [{ k: 'c', v: -0.4, a: 0, u: DAY }, { k: 'c', v: -0.4, a: 0, u: DAY }];
  assert.equal(G.rseRateParts(n, HOUR).v, -0.5);
  /* credits: 10 a day, +20% from day 1 to day 2, counted over four days: 40 + 2 */
  G.rsRateParts = (m, t) => { const E = G.rseRateParts(m, t); return { v: 10 * (1 + E.v), base: 10, intl: { v: 0 }, dom: { v: 0 }, parts: [] }; };
  n.nrp.ed = [{ k: 'c', v: 0.2, a: DAY, u: 2 * DAY, id: 'rsv-a' }];
  assert.ok(Math.abs(G.rseEarn(n, 0, 4 * DAY) - 42) < 1e-6, 'the boost counts for the day it ran, though it ended between saves');
  assert.ok(Math.abs(G.rseEarn(n, 0, DAY) - 10) < 1e-6, 'and not before it began');
  /* the record: well-formed entries only, a credits boost until counted past its end */
  assert.deepEqual(J(G.rseClean([{ k: 'c', v: 0.2, a: 1, u: 10, id: 'x' }, { k: 'p', v: 0.1, a: 1, u: 5 }, { k: 'z', v: 1, a: 1, u: 99 }, { k: 'q', v: 2, a: 1, u: 99 }, null], 5, 6)), [{ k: 'c', v: 0.2, a: 1, u: 10, id: 'x' }]);
  /* study time: edicts and laws together, held between half and three times */
  const L = engine({ fastTrackScience: true }), m = { nrp: { i: 1, q: [], ed: [{ k: 'q', v: 0.3, a: 0, u: DAY, t: 't' }, { k: 'q', v: 0.3, a: 0, u: DAY }] } };
  assert.equal(L.rseStudyShare(m, 0, HOUR).v, 0.5, 'Trade: 30% + 30% + the law, held to half');
  assert.equal(L.rseStudyShare(m, 1, HOUR).v, 0.45, 'Growth: the edict for every track and the law');
  const P = engine({ peerReview: true }), s = { nrp: { i: 1, q: [], ed: [{ k: 'q', v: -0.3, a: 0, u: DAY }] } };
  assert.equal(P.rseStudyShare(s, 0, HOUR).v, -0.45);
  /* hurrying a study under way never takes it below half its time; holding it up never past three times */
  const H = engine();H.NOW = 2 * HOUR;
  const k = { nrp: { i: 1, re: 100, rs: 0, ra: 2 * HOUR, q: [[0, 0, 12 * HOUR, 5, 0, 1]], ed: [] } };
  H.rseApply(k, { rqn: 50 }, 'rsv-a', 2 * HOUR);
  assert.equal(k.nrp.q[0][2], 7 * HOUR, 'half of the ten hours left');
  H.rseApply(k, { rqn: 50 }, 'rsv-a', 2 * HOUR);
  assert.equal(k.nrp.q[0][2], 6 * HOUR, 'then no sooner than half its twelve hours');
  H.rseApply(k, { rqn: -50 }, 'rsv-a', 2 * HOUR);
  assert.equal(k.nrp.q[0][2], 8 * HOUR);
  for (let j = 0; j < 9; j++) H.rseApply(k, { rqn: -50 }, 'rsv-a', 2 * HOUR);
  assert.equal(k.nrp.q[0][2], 36 * HOUR, 'never more than three times its time');
  /* credits spent: a day's worth at today's rate, no more than the balance */
  const c = { nrp: { i: 1, re: 25, rs: 0, ra: 2 * HOUR, q: [], ed: [] } };
  H.rseApply(c, { rcx: -1 }, 'rsv-a', 2 * HOUR);assert.equal(c.nrp.rs, 10);
  H.rseApply(c, { rcx: -2 }, 'rsv-a', 2 * HOUR);assert.equal(c.nrp.rs, 25);
  const notes = H.rseApply(c, { rcx: -1 }, 'rsv-a', 2 * HOUR);assert.match(notes[0][1], /no Research Credits to spare/);
  /* the timed ones are recorded from the moment of the ruling */
  const t = { nrp: { i: 1, re: 0, rs: 0, ra: 2 * HOUR, q: [], ed: [] } };
  H.rseApply(t, { rcb: [20, 3], rcp: [10, 2, 'w'], rqs: [-15, 4] }, 'rsv-a', 2 * HOUR);
  assert.deepEqual(J(t.nrp.ed), [{ k: 'c', v: 0.2, a: 2 * HOUR, u: 2 * HOUR + 3 * DAY, id: 'rsv-a' }, { k: 'p', v: 0.1, a: 2 * HOUR, u: 2 * HOUR + 2 * DAY, id: 'rsv-a', t: 'w' }, { k: 'q', v: -0.15, a: 2 * HOUR, u: 2 * HOUR + 4 * DAY, id: 'rsv-a' }]);
});

test('the game wires the effects into research and the page', () => {
  for (const w of ['rsStudyMs=(f=>', 'rsRateParts=(f=>', 'rsDisc=(f=>', 'rsBal=function', 'rsAccrue=function', 'geoAfter=(f=>', 'gmbOdds=(f=>', 'rsRecWords=(f=>', 'rsOverviewHTML=(f=>', 'fill=(f=>', 'edictTopicBadge=(f=>']) assert.ok(SEC.includes(w), w);
  assert.match(SEC, /Edicts at work/);
  assert.match(src, /<dt>Research edicts and laws<\/dt>/, 'the credits a day show the edicts’ share');
  assert.match(src, /\/\* rse:start \*\/[\s\S]*\.opt-rse\{[\s\S]*\/\* rse:end \*\//);
});
