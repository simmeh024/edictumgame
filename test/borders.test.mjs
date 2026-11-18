// Border agreements (functions/borders.js): the game keeps a copy of their rules (BD_RULES) and works out which
// agreements are in force as the server does (bdLive beside the server's). These checks keep the copies in step, and
// check the shape the server accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as R from '../functions/border-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function constOf(name) {
  const at = html.indexOf('const ' + name + '=');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(html.indexOf('{', at), i + 1) + ')')));
}
const fnOf = name => { const m = html.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n')); assert.ok(m, name + ' is found'); return m[0]; };

test('the game and the server share the border agreements’ rules', () => {
  assert.deepEqual(constOf('BD_RULES'), JSON.parse(JSON.stringify(R.BD_RULES)));
});

test('in force means the same to the game and the server', () => {
  const g = vm.runInNewContext(fnOf('bdLive') + ';bdLive');
  const now = 1e12, D = 86400000;
  const cases = [
    { st: 'offered' }, { st: 'active', exp: 0 }, { st: 'active', exp: now + D }, { st: 'active', exp: now - 1 },
    { st: 'ending', end: now + D, exp: 0 }, { st: 'ending', end: now - 1, exp: 0 }, { st: 'ending', end: now + D, exp: now - 1 }, { st: 'broken', bt: now }
  ];
  for (const B of cases) assert.equal(g(B, now), R.bdLive(B, now), JSON.stringify(B));
  assert.equal(g(null, now), false);
});

test('a drawn border: every nation has a side, each hex once, a cap on hexes', () => {
  assert.ok(R.bdShape(['a', 'b'], { a: [1, 2], b: [3] }, [4]));
  assert.equal(R.bdShape(['a', 'b'], { a: [1, 2], b: [] }, []), null, 'a side left empty');
  assert.equal(R.bdShape(['a', 'b'], { a: [1, 2], b: [2] }, []), null, 'a hex twice');
  assert.equal(R.bdShape(['a', 'b'], { a: [1], b: [3] }, [1]), null, 'a hex on a side and in the buffer');
  assert.equal(R.bdShape(['a'], { a: [1] }, []), null, 'one nation alone');
  assert.equal(R.bdShape(['a', 'b', 'c', 'd', 'e'], { a: [1], b: [2], c: [3], d: [4], e: [5] }, []), null, 'too many nations');
  assert.equal(R.bdShape(['a', 'b'], { a: [1.5], b: [3] }, []), null, 'not a hex');
  const big = Array.from({ length: R.BD_RULES.maxCells }, (_, i) => i);
  assert.equal(R.bdShape(['a', 'b'], { a: big, b: [R.BD_RULES.maxCells] }, []), null, 'too many hexes');
  const S = R.bdShape(['a', 'b', 'c'], { a: [1], b: [2], c: [3] }, [9]);
  assert.equal(R.bdSideOf({ p: ['a', 'b', 'c'], ...S }, 2), 'b');
  assert.equal(R.bdSideOf({ p: ['a', 'b', 'c'], ...S }, 9), 'buf');
  assert.equal(R.bdSideOf({ p: ['a', 'b', 'c'], ...S }, 7), '');
});

test('the game wires every part in', () => {
  for (const s of ["op:'bdBreach'", "'bdOffer'", "'bdAnswer'", "'bdRenew'", "'bdEnd'", "'bdSwap'", "'bdSwapAnswer'", 'VIEWS_EXT.assembly=(f=>', 'dpTreaties=(f=>', 'writeClaims=(f=>', 'autoPlan=(f=>',
    "if(c.k==='border')return bdCardHTML(c);", "c.k==='border'&&typeof c.id==='string'"]) assert.ok(html.includes(s), s);
  for (const id of ['dip-bd1', 'dip-bd3', 'dip-bdmulti', 'dip-bdbuf', 'dip-bdsea', 'dip-bdold', 'dip-bdrenew', 'dip-bdsw', 'dip-bdbrk']) assert.ok(html.includes(`'${id}'`), id);
});
