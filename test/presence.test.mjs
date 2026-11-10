/* Who of a region is online (functions/presence.js): the newest save report of each player decides, a hidden one
   leaves them out, and only those seen in the last 15 minutes are told, in whole seconds. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSeen, agesAt, ONLINE_MS } from '../functions/presence.js';

const NOW = 1_800_000_000_000, MIN = 60000;

test('the newest report of each player decides, and a hidden one leaves them out', () => {
  const seen = lastSeen([
    { uid: 'a', t: NOW - 5 * MIN }, { uid: 'a', t: NOW - 2 * MIN },
    { uid: 'b', t: NOW - 9 * MIN }, { uid: 'b', t: NOW - 1 * MIN, ho: true },
    { uid: 'c', t: NOW - 9 * MIN, ho: true }, { uid: 'c', t: NOW - 1 * MIN, ho: false },
    { uid: '', t: NOW }, { uid: 'd', t: NaN }, null, { t: NOW },
  ]);
  assert.deepEqual(seen, { a: NOW - 2 * MIN, c: NOW - MIN });
});

test('only players seen within 15 minutes are told, in whole seconds ago', () => {
  const ages = agesAt({ a: NOW - 2 * MIN, b: NOW - ONLINE_MS, c: NOW - ONLINE_MS + 1000, d: NOW + 5000, e: NOW - 61400 }, NOW);
  assert.deepEqual(ages, { a: 120, c: 899, d: 0, e: 61 });
  assert.equal(ONLINE_MS, 15 * MIN);
});
