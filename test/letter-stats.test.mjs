// The admin portal's Letter statistics (functions/letter-stats.js, letterSummary): how the letters of a window are
// counted, on hand-made rows. No emulator needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterSummary, LS_TOP } from '../functions/letter-stats.js';

const T = 1_800_000_000_000;

test('a letter is a writer’s letter: a group letter’s copies count once, for every member as a reader', () => {
  const rows = [
    { by: 'ann', to: 'bob', t: T, k: 'protest' },
    { by: 'ann', to: 'bob', t: T + 1, a: 'deal' },
    { by: 'bob', to: 'ann', t: T + 2, k: 'friend', a: 'city' },
    // one group letter to three members
    { by: 'cat', to: 'ann', t: T + 3, g: true, k: 'treaty' }, { by: 'cat', to: 'bob', t: T + 3, g: true, k: 'treaty' }, { by: 'cat', to: 'dan', t: T + 3, g: true, k: 'treaty' },
    { by: '', to: 'bob', t: T + 4 }, { by: 'eve', to: '', t: T + 5 }
  ];
  const s = letterSummary(rows);
  assert.equal(s.letters, 4); assert.equal(s.copies, 6); assert.equal(s.group, 1);
  assert.equal(s.writers, 3); assert.equal(s.readers, 3);
  assert.equal(s.pairs, 4, 'ann–bob, cat–ann, cat–bob, cat–dan');
  assert.deepEqual(s.notes, { protest: 1, friend: 1, treaty: 1 }, 'a group letter’s note counts once');
  assert.deepEqual(s.att, { deal: 1, city: 1 });
  assert.deepEqual(s.top[0], { uid: 'ann', sent: 2, copies: 2, readers: 1, groups: 0, last: T + 1 });
  assert.deepEqual(s.top.find(w => w.uid === 'cat'), { uid: 'cat', sent: 1, copies: 3, readers: 3, groups: 1, last: T + 3 });
  assert.deepEqual(s.most[0], { uid: 'bob', got: 3 });
});

test('unknown notes and attachments are not counted, and the lists keep the busiest', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ by: 'w' + i, to: 'r', t: T + i, k: 'insult', a: 'bomb' }))
    .concat(Array.from({ length: 5 }, (_, i) => ({ by: 'w7', to: 'r' + i, t: T + 100 + i })));
  const s = letterSummary(rows);
  assert.deepEqual(s.notes, {}); assert.deepEqual(s.att, {});
  assert.equal(s.top.length, LS_TOP);
  assert.equal(s.top[0].uid, 'w7'); assert.equal(s.top[0].sent, 6); assert.equal(s.top[0].readers, 6);
  assert.equal(letterSummary([]).letters, 0);
});
