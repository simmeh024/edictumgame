// Staging playthrough (2026-11-16): a nation in its first two minutes got a toast for every law already in the
// rulebook and for votes it never saw; it now gets one line saying it has a seat and follows the laws in force.
// Run with: node --test test/asm-fresh.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
test('a nation just founded gets one rulebook line, not a toast a law', () => {
  assert.match(src, /newest=rec\[rec\.length-1\],fresh=now-\(n\.founded\|\|0\)<120000;/);
  assert.match(src, /else if\(fresh\)joined\+\+;else notes\.push\(/);
  assert.match(src, /if\(!fresh\)for\(const e of rec\)out\.push\(asmResultText/);
  assert.match(src, /has a seat in the \$\{REGION\} Assembly/);
});
