// A currency draft follows the nation while the player leaves it be (game/edictum.html, cuDraftRebase): a three-way
// merge of the draft, the currency before a commit and after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const i = html.indexOf('function cuDraftRebase(d,a,b){'), src = html.slice(i, html.indexOf('\n}\n', i) + 2);
const rebase = vm.runInNewContext(src + '\ncuDraftRebase;', { clone: o => JSON.parse(JSON.stringify(o)) });
const plain = v => JSON.parse(JSON.stringify(v));

test('what the player left as it was follows the currency; what they changed stays', () => {
  const a = { nm: 'Crown', mo: 'Onward', note: { c1: '#111111', c2: '#222222', pat: 'guil' }, coin: { met: 'gold' } };
  const b = { nm: 'Crown', mo: 'Onward', note: { c1: '#AA0000', c2: '#222222', pat: 'guil' }, coin: { met: 'gold' } };
  assert.deepEqual(plain(rebase(plain(a), a, b)), b, 'an untouched draft becomes the new currency');
  assert.deepEqual(plain(rebase({ ...plain(a), mo: 'Mine' }, a, b)), { ...b, mo: 'Mine' }, 'its own motto kept, the note colour follows');
  const d = plain(a); d.note.c1 = '#00FF00';
  assert.equal(rebase(d, a, b).note.c1, '#00FF00', 'a colour chosen in the draft is not overwritten');
  const e = plain(a); e.note.pat = 'stars';
  assert.deepEqual(plain(rebase(e, a, b).note), { c1: '#AA0000', c2: '#222222', pat: 'stars' }, 'inside one object: the field it changed stays, the rest follows');
});

test('nothing changed, no draft, keys come and go', () => {
  const a = { note: { c1: 'x' } }, d = { note: { c1: 'y' } };
  assert.equal(rebase(d, a, plain(a)), d, 'the currency unchanged: the very same draft');
  assert.equal(rebase(null, a, { note: { c1: 'z' } }), null);
  assert.deepEqual(plain(rebase({ note: { c1: 'x' } }, { note: { c1: 'x' } }, { note: { c1: 'x', c3: 'new' } })), { note: { c1: 'x', c3: 'new' } }, 'a field the currency gained arrives');
  assert.deepEqual(plain(rebase({ note: { c1: 'x', old: 1 } }, { note: { c1: 'x', old: 1 } }, { note: { c1: 'x' } })), { note: { c1: 'x' } }, 'one it dropped, untouched, goes');
  assert.deepEqual(plain(rebase({ note: { c1: 'x', old: 2 } }, { note: { c1: 'x', old: 1 } }, { note: { c1: 'x' } })), { note: { c1: 'x', old: 2 } }, 'one the player changed stays');
});

test('the game merges at every commit while a draft is open', () => {
  assert.ok(/commit=\(f=>function\(n\)\{\n\s*const d=CU\.d,a=d&&S\.nation\?cuDraft\(S\.nation\):null,r=f\.apply\(this,arguments\);\n\s*try\{if\(a&&CU\.d===d&&S\.nation\)CU\.d=cuDraftRebase\(d,a,cuDraft\(S\.nation\)\);\}catch\(e\)\{\}/.test(html));
});
