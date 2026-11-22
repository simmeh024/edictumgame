// The National Research Programme on the admin's Statistics page (functions/stats-research.js), on hand-made records:
// where each nation stands, the journey's steps, the laboratories, the research and the nations listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowResearch, researchSummary, researchBrief, RS_AT, RS_AGAIN, RS_LAWS, RS_PHASES, RS_STEPS, DAY } from '../functions/stats-research.js';
import { nationRow, summarize } from '../functions/stats.js';
import { rsEnc, rsPut, rsIdx, RS_N } from '../functions/research-rules.js';

const NOW = Date.parse('2026-11-23T12:00:00Z'), H = 3600000;
const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const save = rec => ({ j: JSON.stringify(rec), reg: rec.reg, name: rec.name, pop: rec.pop, updatedAt: rec.updatedAt });
/* a bitset of the first `t` tiers of a track (all five of each), and some extra indices */
const bits = (tiers, extra = []) => { const b = new Uint8Array(45); tiers.forEach((t, k) => { for (let x = 1; x <= t; x++) for (let s = 0; s < 5; s++) rsPut(b, rsIdx(k, x, s)); }); for (const i of extra) rsPut(b, i); return rsEnc(b); };
const base = (name, extra) => Object.assign({ name, reg: 'meridian', pop: 5, updatedAt: NOW - H, founded: NOW - 40 * DAY }, extra);
const nations = {
  early: base('Early', { ws: { e: 60 } }),
  vetoed: base('Vetoed', { ws: { e: 77 }, nrx: { dv: 76, dvt: NOW - DAY } }),
  due: base('Due', { ws: { e: 90 }, inbox: [{ id: 'rs-discovery', t: NOW - H }] }),
  site: base('Site', { ws: { e: 80 }, nrp: { v: 1, a: NOW - 2 * DAY, o: 1, st: 0, l: 0, k: rsEnc(new Uint8Array(45)), re: 0, rs: 0, q: [] } }),
  building: base('Builder', { ws: { e: 85 }, nrp: { v: 1, a: NOW - 3 * DAY, o: 0, c: 40, ft: NOW - 3 * DAY, st: 2, l: 0, k: rsEnc(new Uint8Array(45)), re: 0, rs: 0, q: [] } }),
  open: base('Scholar', { ws: { e: 140 }, founded: NOW - 60 * DAY, policies: { openScience: 1, tax: 1 }, answered: [{ id: 'rse-ai', o: 1, t: NOW - DAY }],
    nrp: { v: 1, a: NOW - 20 * DAY, o: 2, c: 41, ft: NOW - 20 * DAY, st: 5, i: NOW - 19 * DAY, l: 2, k: bits([6, 5, 4], [rsIdx(0, 7, 1)]), re: 900, rs: 700,
      q: [[rsIdx(0, 7, 2), NOW - H, NOW + H, 40, 0, 0]], ch: { accel: { s: 2 }, medctr: { s: 6, d: NOW - DAY } }, lc: [3], ap: [{ t: NOW - DAY, a: 'al1', q: 30 }] },
    nrx: { h: [[NOW - 2 * H, 'd', rsIdx(0, 7, 1), 0], [NOW - 3 * DAY, 'd', 0, 0], [NOW - 40 * DAY, 'd', 1, 0]], lt: { 'rsl-doors': 0 }, lr: ['x'], md: { report: NOW - DAY } }, rsd: [{ d: 'z', c: 9, t: NOW - DAY }] }),
  lost: base('Occupied', { ws: { e: 100 }, nrp: { v: 1, a: NOW - 10 * DAY, o: 0, c: 42, ft: NOW - 10 * DAY, st: 5, i: NOW - 9 * DAY, l: 0, lo: NOW - 5 * H, k: bits([1, 1, 1]), re: 60, rs: 45, q: [] } }),
  ruined: base('Ruins', { ws: { e: 100 }, nrp: { v: 1, a: NOW - 10 * DAY, o: 1, st: 1, i: NOW - 9 * DAY, l: 1, rz: NOW - DAY, k: bits([2, 1, 1]), re: 80, rs: 70, q: [] },
    nrx: { h: [[NOW - DAY, 'rz', 'Vesad', '']] } }),
  left: base('Mover', { ws: { e: 100 }, nrp: { v: 1, a: NOW - 10 * DAY, o: 2, st: 1, i: NOW - 9 * DAY, l: 0, rz: NOW - DAY, k: bits([1, 0, 0]), re: 30, rs: 25, q: [] },
    nrx: { h: [[NOW - DAY, 'rz', '', 'The laboratory stayed behind']] } }),
  rebuild: base('Again', { ws: { e: 100 }, nrp: { v: 1, a: NOW - 10 * DAY, o: 0, c: 43, ft: NOW - H, st: 3, i: NOW - 9 * DAY, l: 0, rz: NOW - DAY, k: bits([1, 1, 0]), re: 40, rs: 30, q: [] } }),
  dormant: base('Dormant', { ws: { e: 10 }, updatedAt: NOW - 60 * DAY, reg: 'frostmarch' }),
};
const rows = () => Object.entries(nations).map(([id, r]) => nationRow(id, save(r), null, NOW));
const world = () => ({ at: NOW, rows: rows(), accts: [], limited: false, devices: [], posts: {}, finery: [], days: [] });

test('the game’s own figures: the petition at 75, again 5 later, its edict, and the laws research brings', () => {
  assert.match(src, new RegExp(`const RS_AT=${RS_AT},RS_AGAIN=${RS_AGAIN},RS_ID='rs-discovery'`));
  for (const k of RS_LAWS) assert.match(src, new RegExp(`\\n  ${k}:\\['`), 'a law: ' + k);
  assert.match(src, /for\(const k of \['su','xu','i','ra','rp','lo'\]\)/, 'the game keeps when the laboratory was first seen lost');
  assert.match(src, /if\(T\.owner\[p\.c\]===me\)\{delete p\.lo;return out;\}\n    if\(!p\.lo\)p\.lo=now;/, 'and sets it in the commit hook, clearing it when the hex is held again');
});

test('each nation’s place on the way: before the petition, set aside, due, and every state of a laboratory', () => {
  const ph = Object.fromEntries(Object.entries(nations).map(([id, r]) => [id, rowResearch(r, NOW).rs.ph]));
  assert.deepEqual(ph, { early: 'early', vetoed: 'vetoed', due: 'due', site: 'site', building: 'building', open: 'open', lost: 'lost', ruined: 'ruined', left: 'ruined', rebuild: 'rebuild', dormant: 'early' });
  for (const p of Object.values(ph)) assert.ok(RS_PHASES.includes(p));
  /* set aside at 76: due again at 81 */
  assert.equal(rowResearch(base('x', { ws: { e: 81 }, nrx: { dv: 76 } }), NOW).rs.ph, 'due');
  const d = rowResearch(nations.due, NOW).rs; assert.equal(d.desk, 1); assert.equal(d.e, 90);
  const o = rowResearch(nations.open, NOW).rs;
  assert.equal(o.n, 6 * 5 + 5 * 5 + 4 * 5 + 1); assert.deepEqual(o.tk, [31, 25, 20]); assert.deepEqual(o.tt, [6, 5, 4]); assert.equal(o.far, 6);
  assert.equal(o.bal, 200); assert.deepEqual(o.q, [0]); assert.deepEqual(o.ch, { accel: 'run', medctr: 'done' });
  assert.equal(o.lc, 1); assert.equal(o.lr, 1); assert.equal(o.ap, 1); assert.equal(o.apq, 30); assert.equal(o.md, 1); assert.equal(o.razed, 1);
  assert.equal(o.last, NOW - 2 * H); assert.deepEqual(o.dd, [NOW - 2 * H, NOW - 3 * DAY], 'discoveries of the last 30 days');
  assert.deepEqual(o.pol, ['openScience']); assert.deepEqual(o.dil, [['rse-ai', 1]]); assert.deepEqual(o.lt, [['rsl-doors', 0]]);
  assert.equal(rowResearch(nations.ruined, NOW).rs.rzBy, 1, 'destroyed by a nation'); assert.equal(rowResearch(nations.left, NOW).rs.rzBy, 0, 'left behind');
  assert.equal(rowResearch(nations.lost, NOW).rs.lo, NOW - 5 * H);
  const b = researchBrief(o); assert.ok(!('k' in b) && !('dd' in b) && b.d30 === 2 && b.n === 76, 'the brief has no bitset');
});

test('the Research tab counts the world: phases, the journey, laboratories, research, credits, choices and war', () => {
  const X = summarize(world()).rs;
  assert.equal(X.nations, 11); assert.equal(X.programmes, 7); assert.equal(X.active30, 10);
  assert.deepEqual(X.phase, { early: 2, vetoed: 1, due: 1, site: 1, building: 1, open: 1, lost: 1, ruined: 2, rebuild: 1 });
  assert.equal(X.phase30.early, 1, 'the dormant nation is not this month’s');
  assert.deepEqual(Object.keys(X.steps), RS_STEPS);
  assert.equal(X.steps.e75, 9); assert.equal(X.steps.granted, 7); assert.equal(X.steps.placed, 6, 'every laboratory placed or opened, not the site still to choose');
  assert.equal(X.steps.st2, 6); assert.equal(X.steps.st3, 5); assert.equal(X.steps.open, 5); assert.equal(X.steps.d1, 5); assert.equal(X.steps.tier5, 1); assert.equal(X.steps.n50, 1); assert.equal(X.steps.n100, 0);
  assert.deepEqual(X.approach.map(b => b.n), [0, 0, 1, 0], 'Early, at 60 enacted edicts');
  assert.deepEqual(X.sites, [3, 2, 2]); assert.deepEqual(X.stages, [0, 0, 1, 0, 0]);
  assert.equal(X.levels.reduce((s, v) => s + v, 0), 5); assert.equal(X.levels[2], 1);
  assert.equal(X.techs.find(b => b.a === 0).n, 2, 'the site and the building have none');
  assert.equal(X.per[0], 5, 'Trade Tier I milestone known to five'); assert.equal(X.per.length, RS_N);
  assert.deepEqual(X.top[0], [0, 5]); assert.equal(X.never, RS_N - 76);
  assert.deepEqual(X.studies, [1, 0, 0]); assert.deepEqual(X.ch.accel, { run: 1, done: 0 }); assert.deepEqual(X.ch.medctr, { run: 0, done: 1 });
  assert.equal(X.credits.earned, 1110); assert.equal(X.credits.spent, 870); assert.equal(X.credits.max, 200);
  assert.deepEqual(X.laws, { openScience: 1 }); assert.deepEqual(X.dil, { 'rse-ai': { 1: 1 } }); assert.deepEqual(X.lt, { 'rsl-doors': { 0: 1 } });
  assert.deepEqual(X.war, { lost: 1, destroyed: 1, left: 1, razed: 1 });
  assert.equal(X.d7, 2); assert.equal(X.r7, 1);
  assert.equal(X.days.length, 30); assert.equal(X.days.at(-1).disc, 1); assert.equal(X.days.reduce((s, x) => s + x.disc, 0), 2);
  assert.equal(X.days.reduce((s, x) => s + x.petitions, 0), 7); assert.equal(X.days.reduce((s, x) => s + x.opened, 0), 5);
  assert.equal(X.timing.toOpenN, 5); assert.equal(X.timing.toOpenH, 24);
  assert.deepEqual(X.list.map(x => x.id).slice(0, 2), ['open', 'ruined'], 'the furthest on first');
  assert.equal(X.list[0].d7, 2); assert.deepEqual(X.list[0].tt, [6, 5, 4]);
  assert.deepEqual(X.next.map(x => x.id), ['early']);
  assert.deepEqual(X.stuck.map(x => x.ph).sort(), ['building', 'due', 'site', 'vetoed']);
  assert.ok(X.regs && X.regs.meridian.granted === 7 && X.regs.frostmarch.nations === 1, 'by region for the world');
  const F = summarize(world(), 'frostmarch').rs;
  assert.equal(F.nations, 1); assert.equal(F.programmes, 0); assert.ok(!F.regs, 'a region has no region table');
});
