// functions/pace.js: the callables' pacing, a token bucket per player and per address.
//   node --test test/pace.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { take, pace, resetPace } from '../functions/pace.js';

test('a bucket lets a burst through, then refills at its rate', () => {
  resetPace();
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(take('p', 5, 1, t), true);
  assert.equal(take('p', 5, 1, t), false, 'empty after the burst');
  assert.equal(take('p', 5, 1, t + 999), false, 'not a whole token yet');
  assert.equal(take('p', 5, 1, t + 2000), true);
  assert.equal(take('p', 5, 1, t + 60_000), true, 'refills, but never past the burst');
  for (let i = 0; i < 4; i++) take('p', 5, 1, t + 60_000);
  assert.equal(take('p', 5, 1, t + 60_000), false);
  assert.equal(take('q', 5, 1, t), true, 'each key has its own bucket');
});

test('pace refuses with resource-exhausted when any rule is empty', () => {
  resetPace();
  pace([['a', 1, 0.001], ['b', 2, 0.001]]);
  assert.throws(() => pace([['a', 1, 0.001]]), e => e.code === 'resource-exhausted' && e.details?.code === 'paced');
  pace([['b', 2, 0.001]]);
  assert.throws(() => pace([['b', 2, 0.001]]), e => e.code === 'resource-exhausted');
});
