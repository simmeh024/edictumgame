// War weariness (26 Nov 2026; game/edictum.html): the rate it climbs at, the ceiling an overrule buys and the way
// that ceiling bleeds back to 100. Checked with the game's own code, cut from its source.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const DAY = 864e5;
const CONSTS = cut('const WW_OR_TOP=', '\n') + '\n' + cut('const WW_POW=', '\n');
const GOALS = cut('const WAR_GOALS={', '\nconst NPC_BLOCS');

/* the game's own wwCeil, wrWeary and wwState, over stubs for the few things they ask the rest of the game for */
const ctx = vm.createContext({
  DAY, WW_DAY: 4, WW_PEACE: 6, WW_WARN: 75, BORDER_CAP: 12,
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  myId: () => 'me', wars: [],
  wrWarsOf: () => ctx.wars, S: { nation: null },
});
vm.runInContext([CONSTS.replace(/^const /gm, 'var '), GOALS.replace(/^const /gm, 'var '), fn('wwCeil'), fn('wrWeary'), fn('wwState')].join('\n'), ctx);
const ceil = (n, now) => vm.runInContext('wwCeil', ctx)(n, now);
const state = (n, now) => vm.runInContext('wwState', ctx)(n, now);
const at = (...g) => { ctx.wars = g.map(x => ({ id: 'npc-' + x, g: x })); };

test('the ceiling is 100 until the government overrules the call for peace', () => {
  assert.equal(ceil({}, 1000), 100);
  assert.equal(ceil({ wwo: 0 }, 1000), 100);
});

test('an overrule buys 20 points of room, which bleed back to 100 over three days', () => {
  const t = 5 * DAY;
  assert.equal(ceil({ wwo: t }, t), 120);
  assert.equal(ceil({ wwo: t }, t + 1.5 * DAY), 110);
  assert.equal(ceil({ wwo: t }, t + 3 * DAY), 100);
  assert.equal(ceil({ wwo: t }, t + 9 * DAY), 100, 'and it does not fall below 100 afterwards');
});

test('the rate is the base times the summed weight of the aims, raised to its power', () => {
  const now = 10 * DAY;
  at('b');
  assert.equal(Math.round(state({ wwy: 10 }, now).rate * 10) / 10, 4, 'one border war is the base rate');
  at('r');
  assert.equal(Math.round(state({ wwy: 10 }, now).rate * 10) / 10, 1.6, 'a raid is the cheapest war to fight');
  at('c', 'b');
  const W = state({ wwy: 38 }, now);
  assert.equal(Math.round(W.rate * 10) / 10, 13.2, 'a conquest and a border war together');
  assert.ok(W.rate > 4 + 6.8, 'two wars cost more than the same two apart');
});

test('at peace the number falls, and costs nothing while it does', () => {
  ctx.wars = [];
  const W = state({ wwy: 44 }, 10 * DAY);
  assert.equal(W.at, false);
  assert.equal(W.rate, -6);
  assert.equal(Math.round(W.ms / DAY * 100) / 100, 7.33, 'it is clear in seven and a third days');
  assert.equal(W.mood, 0);
  assert.equal(W.pop, 0);
});

test('while an overrule holds, the ceiling closes on the number from both sides', () => {
  const now = 10 * DAY;
  at('c', 'b');
  const plain = state({ wwy: 82 }, now), held = state({ wwy: 82, wwo: now }, now);
  assert.equal(plain.max, 100);
  assert.equal(held.max, 120);
  assert.ok(held.ms > plain.ms, 'the overrule buys time');
  /* 38 points apart, closing at the rate weariness climbs plus the 6.7 a day the ceiling falls */
  assert.equal(Math.round(held.ms / DAY * 100) / 100, Math.round(38 / (held.rate + 20 / 3) * 100) / 100);
  assert.equal(Math.round(held.fall * 10) / 10, 6.7);
});

test('the costs are read off the number, so they rise with it', () => {
  const now = 10 * DAY;
  at('c', 'b');
  assert.equal(state({ wwy: 38 }, now).mood, 8);
  assert.equal(state({ wwy: 82 }, now).mood, 16);
  assert.equal(state({ wwy: 109, wwo: now }, now).mood, 22, 'and past 100 while the people are being held to it');
  assert.equal(state({ wwy: 82 }, now).pop, 0.82);
});
