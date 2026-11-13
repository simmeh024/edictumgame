/* Peace offers: one left unanswered for 30 hours takes effect by itself, and after any peace neither side may
   declare war again for 72 hours. Runs the game's own pairWar() against two records. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const GAME = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const H = 3600000;
const constOf = name => { const m = new RegExp('\\b' + name + '=(\\d+)\\*3600000\\b').exec(GAME); assert.ok(m, name); return Number(m[1]) * H; };
const PEACE_AUTO_MS = constOf('PEACE_AUTO_MS'), TRUCE_MS = constOf('TRUCE_MS');

function pairWarWith(recs, now) {
  const a = GAME.indexOf('function pairWar(a,b){'), b = GAME.indexOf('\n}\n', a);
  assert.ok(a > 0 && b > a, 'the game has pairWar');
  const ctx = vm.createContext({
    TRUCE_MS, PEACE_AUTO_MS, NPC_SET: new Set(['npc-1']), DAY: 24 * H,
    docOf: id => recs[id], wakeFence: () => 0, npcPeaceWait: () => 24 * H,
    Date: { now: () => now }
  });
  vm.runInContext(GAME.slice(a, b + 2) + '\nthis.pairWar=pairWar;', ctx);
  return ctx.pairWar;
}
const T0 = Date.UTC(2026, 10, 13, 12);

test('the rule is 30 hours to answer and 72 hours of truce', () => {
  assert.equal(PEACE_AUTO_MS, 30 * H);
  assert.equal(TRUCE_MS, 72 * H);
});

test('an unanswered offer holds for 30 hours, then the peace takes effect by itself', () => {
  const recs = { a: { wars: { b: { t: T0 } }, peace: { b: T0 + H } }, b: { wars: {}, peace: {} } };
  const offered = T0 + H, ends = offered + PEACE_AUTO_MS;
  let w = pairWarWith(recs, ends - 1)('a', 'b');
  assert.equal(w.war, true, 'still at war a moment before');
  assert.equal(w.offA, true);
  assert.equal(w.offB, false);
  assert.equal(w.ends, ends, 'it says when the offer takes effect');
  w = pairWarWith(recs, ends)('b', 'a');
  assert.equal(w.war, false, 'at peace from 30 hours on, seen from either side');
  assert.equal(w.auto, 'a', 'and it names whose offer it was');
  assert.equal(w.peaceAt, ends);
  assert.equal(w.truceUntil, ends + TRUCE_MS, 'then a truce of 72 hours');
});

test('an answer before then ends the war at once, with the same 72-hour truce', () => {
  const recs = { a: { wars: { b: { t: T0 } }, peace: { b: T0 + H } }, b: { wars: {}, peace: { a: T0 + 2 * H } } };
  const w = pairWarWith(recs, T0 + 3 * H)('a', 'b');
  assert.equal(w.war, false);
  assert.equal(w.auto, undefined, 'answered, not by itself');
  assert.equal(w.peaceAt, T0 + 2 * H);
  assert.equal(w.truceUntil, T0 + 2 * H + TRUCE_MS);
});

test('no offer, no clock: a war without one goes on', () => {
  const recs = { a: { wars: { b: { t: T0 } }, peace: {} }, b: { wars: {}, peace: {} } };
  const w = pairWarWith(recs, T0 + 30 * 24 * H)('a', 'b');
  assert.equal(w.war, true);
  assert.equal(w.ends, 0);
});

test('an old offer from before a newer declaration does not count', () => {
  const recs = { a: { wars: { b: { t: T0 } }, peace: { b: T0 - 100 * H } }, b: { wars: { a: { t: T0 - 200 * H } }, peace: {} } };
  const w = pairWarWith(recs, T0 + 40 * H)('a', 'b');
  assert.equal(w.war, true);
  assert.equal(w.ends, 0);
});

test('war declared again after the truce starts a new war, and an offer in it has its own 30 hours', () => {
  const again = T0 + H + PEACE_AUTO_MS + TRUCE_MS + H;
  const recs = { a: { wars: { b: { t: T0 } }, peace: { b: T0 + H } }, b: { wars: { a: { t: again } }, peace: {} } };
  let w = pairWarWith(recs, again + 10 * H)('a', 'b');
  assert.equal(w.war, true, 'the old offer is older than the new declaration');
  recs.a.peace.b = again + 20 * H;
  w = pairWarWith(recs, again + 20 * H + PEACE_AUTO_MS)('a', 'b');
  assert.equal(w.war, false);
  assert.equal(w.auto, 'a');
});

test('a computer nation is never timed out: its peace is its opponent’s', () => {
  const recs = { a: { wars: { 'npc-1': { t: T0 } }, peace: {} }, 'npc-1': {} };
  const w = pairWarWith(recs, T0 + 10 * 24 * H)('a', 'npc-1');
  assert.equal(w.war, true, 'the computer nation offering terms after a while is still the player’s to accept');
  assert.equal(w.offB, true);
  assert.equal(w.ends, 0);
});

test('every text about the truce follows TRUCE_MS', () => {
  assert.doesNotMatch(GAME, /truce now holds for 12 hours/);
  assert.match(GAME, /A truce now holds for \$\{TRUCE_MS\/3600000\} hours/);
});
