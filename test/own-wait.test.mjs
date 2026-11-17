// Staging playthrough (2026-11-16): a returning account with no copy of its nation in this browser saw the founding
// form until connect's first read brought the nation in. The page now says it is opening the nation instead.
// Run with: node --test test/own-wait.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
test('the founding form waits for a returning account’s first read, 10 seconds at most', () => {
  assert.match(src, /var OWN_WAIT=\{on:\(\(\)=>\{try\{const u=localStorage\.getItem\('edictum\.uid'\);return !!u&&u!=='-'&&!localStorage\.getItem\('statehood\.nation\.v1'\)/);
  assert.match(src, /if\(OWN_WAIT\.on\)setTimeout\(ownWaitEnd,10000\);/);
  assert.match(src, /const quit=\(\)=>\{ownWaitEnd\(\);/, 'a tab that cannot connect shows the form');
  assert.match(src, /queueRemote\(\);\}\}\n  ownWaitEnd\(\);\n  publishSync\(\);/, 'ends after the own read, read or failed');
  assert.match(src, /OWN_WAIT&&OWN_WAIT\.on&&!OBS\?ownWaitView\(\):foundView\(\)/);
});
