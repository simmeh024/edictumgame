// The nation's script (game/edictum.html, 18 November 2026): every nation writes in an alphabet of its own, 36 signs
// drawn from a seed in one of six families (scrGlyphs), set in a row (scrLay) and drawn as SVG (scrSVG). It is a skin
// over the words: the record keeps them as typed, n.scr only says how they are drawn (scrClean). Letters mark words
// for the script with [[ and ]] (scrFmt puts the marks on and takes them off). The code runs here as written.
//   node --test test/nation-script.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };

const ctx = vm.createContext({ Object, Array, Set, Map, Math, JSON, String, Number });
vm.runInContext([
  grab(/function hash\(str\)\{.*\}/), grab(/function rng\(seed\)\{.*\}/), grab(/const esc = .*;/),
  slice('const SCR_FAM={', '/* the script inside another drawing'),
  grab(/function scrFmt\(v,a,b\)\{[\s\S]*?\n\}/),
  'this.X={SCR_FAM,SCR_ABC,SCR_ON,scrClean,scrDef,scrOf,scrGlyphs,scrChars,scrLay,scrSVG,scrFmt};'
].join('\n'), ctx);
const X = ctx.X, plain = v => JSON.parse(JSON.stringify(v));

test('six families, 36 different signs each, for any seed', () => {
  assert.deepEqual(Object.keys(X.SCR_FAM), ['ang', 'brush', 'wedge', 'loop', 'dot', 'knot']);
  assert.equal(X.SCR_ABC.length, 36);
  for (const f of Object.keys(X.SCR_FAM)) for (const s of [0, 7, 4242, 99991, 4294967295]) {
    const G = X.scrGlyphs(s, f);
    assert.equal(G.length, 36);
    assert.equal(new Set(G.map(g => JSON.stringify([g.S, g.F, g.D]))).size, 36, `${f} ${s}`);
    for (const g of G) assert.ok(g.w >= 3 && g.w <= 13, `${f} ${s} width ${g.w}`);
  }
});

test('the same seed always draws the same letters; another seed, others', () => {
  const a = X.scrSVG({ s: 11, f: 'ang', w: 2 }, 'Saffron Coast'), b = X.scrSVG({ s: 11, f: 'ang', w: 2 }, 'Saffron Coast');
  assert.equal(a, b);
  assert.notEqual(a, X.scrSVG({ s: 12, f: 'ang', w: 2 }, 'Saffron Coast'));
  assert.notEqual(a, X.scrSVG({ s: 11, f: 'loop', w: 2 }, 'Saffron Coast'));
});

test('a nation without a choice writes in the script its seed gives it', () => {
  const n = { seed: 'abc', name: 'Lavyria' }, d = X.scrDef(n);
  assert.ok(Object.keys(X.SCR_FAM).includes(d.f));
  assert.deepEqual(plain(X.scrOf(n)), plain(d));
  assert.deepEqual(plain(X.scrOf({ ...n, scr: { f: 'dot', on: ['sign'] } })), { ...plain(d), f: 'dot', on: ['sign'] });
  assert.notEqual(X.scrDef({ seed: 'abd' }).s, d.s);
});

test('the stored choice is cleaned: only what is understood is kept', () => {
  assert.deepEqual(plain(X.scrClean({ s: 12, f: 'knot', w: 3, sl: -6, tm: 'serif', ink: 'royal', on: ['arms', 'arms', 'x'], z: 1 })), { s: 12, f: 'knot', w: 3, sl: -6, tm: 'serif', ink: 'royal', on: ['arms'] });
  assert.equal(X.scrClean({ s: -1, f: 'runes', w: 4, sl: 30, tm: 'x', ink: '#123456', on: 'title' }), null);
  assert.equal(X.scrClean({ s: 1.5, sl: 0 }), null);
  assert.equal(X.scrClean(null), null);
  assert.equal(X.scrClean([1]), null);
  assert.deepEqual(Object.keys(X.SCR_ON), ['title', 'arms', 'note', 'sign']);
});

test('letters it has no sign for are left out; accents fall off', () => {
  assert.equal(X.scrChars('Ça va, Œuvre ß! 3 日本  ').join(''), 'CA VA, OEUVRE SS! 3');
  assert.equal(X.scrChars('  ').length, 0);
  assert.equal(X.scrSVG({ s: 1, f: 'ang', w: 2 }, '日本'), '');
  const L = X.scrLay({ s: 1, f: 'ang', w: 2 }, 'ab cd');
  assert.equal(L.items.length, 4);
  assert.equal(L.words.length, 2);
  assert.ok(L.w > 0);
});

test('the drawing carries the plain words, escaped, for screen readers and the tooltip', () => {
  const s = X.scrSVG({ s: 3, f: 'wedge', w: 1, sl: 10, tm: 'dot', ink: 'gold' }, 'a<b> "c"');
  assert.match(s, /role="img" aria-label="a&lt;b&gt; &quot;c&quot;"/);
  assert.match(s, /<title>a&lt;b&gt; &quot;c&quot;<\/title>/);
  assert.match(s, /skewX\(-10\)/);
  assert.ok(!/<script|onload/i.test(s));
  const quiet = X.scrSVG({ s: 3, f: 'dot', w: 2 }, 'abc', { label: '' });
  assert.match(quiet, /aria-hidden="true"/);
  assert.ok(!/<title>/.test(quiet));
});

test('the script button puts [[ ]] round the words, or takes them off', () => {
  assert.deepEqual(plain(X.scrFmt('one two\nthree', 2, 2)), ['[[one two]]\nthree', 0, 11]);
  assert.deepEqual(plain(X.scrFmt('[[one two]]', 0, 11)), ['one two', 0, 7]);
  assert.deepEqual(plain(X.scrFmt('a [[b c]] d', 4, 7)), ['a b c d', 2, 5]);
  assert.deepEqual(plain(X.scrFmt('say hello there', 4, 9)), ['say [[hello]] there', 4, 13]);
  assert.deepEqual(plain(X.scrFmt('one\n\ntwo', 0, 8)), ['[[one]]\n\n[[two]]', 0, 16]);
  assert.equal(X.scrFmt('   ', 1, 1), null);
});
