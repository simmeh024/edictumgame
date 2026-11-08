// functions/nationtext.js: nations/ records read the same in either form, and the deflated one is much smaller.
//   node --test test/nationtext.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nationText, deflateNation } from '../functions/nationtext.js';

const rec = { name: 'Testland', reg: 'meridian', cities: Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, name: 'City ' + i, pop: i * 1000 })) };
const j = JSON.stringify(rec);

test('v 1 (j) and v 2 (z) give the same text, from a snapshot or its data', () => {
  const z = deflateNation(j), snap = d => ({ get: k => d[k] });
  assert.equal(nationText({ v: 1, j }), j);
  assert.equal(nationText({ v: 2, z }), j);
  assert.equal(nationText(snap({ v: 2, z })), j);
  assert.equal(nationText(snap({ v: 1, j })), j);
  assert.equal(nationText({ v: 2, z: new Uint8Array(z) }), j);          // bytes as a plain Uint8Array
  assert.ok(z.length < j.length / 4, `${j.length} characters deflate to ${z.length} bytes`);
});

test('missing or broken records read as null, never throw', () => {
  assert.equal(nationText(null), null);
  assert.equal(nationText({}), null);
  assert.equal(nationText({ z: Buffer.from('not deflate data at all') }), null);
});
