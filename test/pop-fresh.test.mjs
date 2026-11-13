// An honest save's headline population matches its record. On 13 Nov 2026 a phone's decision made at 18:51 was saved
// at 19:34 with the 18:51 population; the rules count growth from the server's time of the last save, so the next save
// (44 minutes of growth higher) had to be held below its record, and every game's fair-play check listed the player.
// Now a save that goes out well after its action carries the population of the moment it is sent (game/edictum.html,
// popFresh); the server holds an update's headline to what the rules allow by its own clock (functions/civic.js,
// heldPop; the page used to, by performance.now(), which stops while a phone sleeps); and auditNation lists a record
// only beyond what an hour of clock difference explains.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldPop, SKEW_MS } from '../functions/civic.js';

const DAY = 864e5, MIN = 60000;
const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const piece = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + from.length); assert.ok(i > 0 && j > i, from); return src.slice(i, j); };

/* the growth curve and popFresh, as the game has them */
const G = vm.createContext({ Math, DAY, npcPop: () => { throw new Error('a computer nation'); }, npcMig: () => 0, rateOf: () => 0.18 });
vm.runInContext([piece('function logistic(', '\n'), piece('function popNow(', '\n}\n') + '\n}', piece('function migNet(', '\n'),
  piece('const POP_FRESH=', 'async function writeRemote(').replace('const POP_FRESH', 'var POP_FRESH')].join('\n'), G);
/* what firestore.rules (grows) lets a save's headline be, at time t, after a last save of pop at server time at */
const rules = (pop, at, t) => { const d = (t - at) / DAY; return pop * Math.pow(1.35, d) + 3 * d + 0.0001; };
const T0 = Date.UTC(2026, 10, 13, 18, 50, 58), lev = () => ({ pop: 5.9413, popAt: T0, updatedAt: T0, pk: 1178.53, pr: 0.17928, mig: { i: 0.02, o: 0.0015 } });

test('a save sent long after its action carries the population of the moment it goes out', () => {
  const n = lev(), at = T0 + 44 * MIN, want = G.popNow(lev(), at);
  assert.equal(G.popFresh(n, at), n);
  assert.equal(n.popAt, at); assert.equal(n.pop, want); assert.ok(want > 5.9413 + 0.02);
  assert.equal(n.updatedAt, T0, 'the action keeps its own time');
});
test('the curve goes on the same from the later point', () => {
  const flat = { ...lev(), mig: null }, a = G.popFresh({ ...flat }, T0 + 44 * MIN);
  assert.ok(Math.abs(G.popNow(a, T0 + 3 * 3600000) - G.popNow(flat, T0 + 3 * 3600000)) < 1e-9);
  const m = G.popFresh(lev(), T0 + 44 * MIN);
  assert.ok(Math.abs(G.popNow(m, T0 + 3 * 3600000) - G.popNow(lev(), T0 + 3 * 3600000)) < 1e-4, 'migration: within a hundred people');
});
test('a save sent within a minute of its action, a computer nation, a record without a time: left as they are', () => {
  for (const [n, at] of [[lev(), T0 + 59000], [{ ...lev(), npc: true }, T0 + 44 * MIN], [{ ...lev(), popAt: 0 }, T0 + 44 * MIN], [lev(), T0 - 5 * MIN]]) {
    const before = JSON.stringify(n); G.popFresh(n, at); assert.equal(JSON.stringify(n), before);
  }
});

test('heldPop: an update within what the rules allow is saved as it is', () => {
  const at = T0, now = T0 + 30 * MIN;
  for (const p of [10, 10.05, 10.12]) assert.equal(heldPop(p, 10, at, now), p);
  assert.equal(heldPop(9.5, 10, at, now), 9.5, 'a fall');
});
test('heldPop: above that, within an hour of clock difference, held to the most the rules allow — which they still allow when it lands', () => {
  const at = T0, now = T0 + 30 * MIN, h = heldPop(10.2, 10, at, now);
  assert.ok(h < 10.2 && h >= rules(10, at, now) - 0.0002, String(h));
  for (const late of [now, now + 200, now + 120000]) assert.ok(h <= rules(10, at, late), 'the rules take it at ' + (late - now) + ' ms');
  assert.equal(Math.round(h * 1e4) / 1e4, h, 'to four places, as the shim rounds a headline');
  assert.ok(heldPop(10.37, 10, at, now) < 10.37, 'the most an hour ahead explains');
});
test('heldPop: beyond what an hour of clock difference explains, sent as it is, for the rules to refuse', () => {
  const at = T0, now = T0 + 30 * MIN, edge = rules(10, at, now + SKEW_MS);
  assert.equal(heldPop(edge + 0.01, 10, at, now), edge + 0.01);
  assert.equal(heldPop(100, 10, at, now), 100, 'a tenfold jump');
});

test('the 13 Nov saves, replayed: with popFresh and heldPop the headline matches the record', () => {
  const lastTs = Date.UTC(2026, 10, 13, 17, 16, 25), lateTs = Date.UTC(2026, 10, 13, 19, 34, 54), nextAt = Date.UTC(2026, 10, 13, 19, 35, 30);
  /* before: the late save carried 18:51's population, the next one was held below its record */
  const stale = 5.9413, fresh = 5.9740;
  assert.ok(heldPop(fresh, stale, lateTs, nextAt) < fresh - 0.03);
  /* now: the late save is brought up to 19:34, and nothing has to be held */
  const sent = G.popFresh(lev(), lateTs);
  assert.equal(heldPop(sent.pop, 5.8622, lastTs, lateTs), sent.pop);
  const next = G.popNow(sent, nextAt);
  assert.equal(heldPop(next, sent.pop, lateTs, nextAt), next);
});

/* auditNation, with what it needs for a plain record */
const A = vm.createContext({ Math, Date, Map, Number, Array, DAY, S: { uid: 'me', db: null }, fmtPop: m => m.toFixed(2) + ' million', RES: [], NPC_SET: new Set(), REF_EPOCH: 0 });
vm.runInContext(piece('const AC_EPOCH=', '/* no army stronger').replace('const AC_EPOCH', 'var AC_EPOCH'), A);
const audit = (rec, head) => { const now = Date.UTC(2026, 10, 13, 20), n = { pop: rec, founded: now - 2 * DAY }, why = A.auditNation(n, { _pop: head, _ts: now - MIN }, 'them', now, false); return { why, pop: n.pop }; };
test('auditNation: an honest save held below its record is held to its headline, not listed', () => {
  const a = audit(5.9859, 5.9687);
  assert.equal(a.why.length, 0, a.why.join(' ')); assert.equal(a.pop, 5.9687);
  assert.equal(audit(10 * Math.pow(1.35, 1 / 24) + 3 / 24, 10).why.length, 0, 'the most an hour explains');
});
test('auditNation: a record past what an hour explains is listed, and held all the same', () => {
  const a = audit(900, 10);
  assert.match(a.why.join(' '), /Its record claims 900\.00 million people; its save declared 10\.00 million\./); assert.equal(a.pop, 10);
  assert.equal(audit(10 * Math.pow(1.35, 1 / 24) + 3 / 24 + 0.01, 10).why.length, 1);
});
