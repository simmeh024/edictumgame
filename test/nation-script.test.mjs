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
  'this.X={hash,SCR_FAM0,SCR_FAM,SCR_ABC,SCR_ON,SCR_B,scrClean,scrDef,scrOf,scrGlyphs,scrChars,scrLay,scrSVG,scrFmt,scrCodeOk,scrCustom,scrNode,scrSet,scrFamOf,scrMirror};'
].join('\n'), ctx);
const X = ctx.X, plain = v => JSON.parse(JSON.stringify(v));

test('nine families, 36 different signs each, for any seed', () => {
  assert.deepEqual(Object.keys(X.SCR_FAM), ['ang', 'brush', 'wedge', 'loop', 'dot', 'knot', 'ink', 'stamp', 'mod']);
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

test('families added later never change the script of a nation that did not choose', () => {
  const six = ['ang', 'brush', 'wedge', 'loop', 'dot', 'knot'];
  assert.deepEqual([...X.SCR_FAM0], six);
  for (let i = 0; i < 300; i++) { const k = 'seed' + i; assert.equal(X.scrDef({ seed: k }).f, six[X.hash('scrf:' + k) % 6], k); }
});

test('the new families: brushed squares, stamped signs, one modern line', () => {
  const ink = X.scrGlyphs(11, 'ink'), stamp = X.scrGlyphs(11, 'stamp'), mod = X.scrGlyphs(11, 'mod');
  assert.ok(ink.every(g => g.br === 1 && g.S.length >= 1 && g.S.length <= 4 && g.S.every(t => [1, 2, 3].includes(t.pf))), 'ink: one to four brush strokes, each with its pressure');
  assert.ok(stamp.every(g => g.S.length >= 1 && !g.br), 'stamped: drawn with the pen');
  assert.ok(stamp.some(g => g.S.some(t => t.z)), 'stamped: closed shapes');
  for (const g of mod) {
    const ys = g.S[0].p.map(q => q[1]);
    assert.ok(Math.min(...ys) === 0 && Math.max(...ys) === 14, 'modern: the line reaches from the top to the foot');
    assert.ok(g.S[0].p.length >= 4);
  }
  for (const f of ['ink', 'stamp', 'mod']) assert.match(X.scrSVG({ s: 3, f, w: 2 }, 'Saffron Coast'), /<path d="M/);
});

test('the stored choice is cleaned: only what is understood is kept', () => {
  assert.deepEqual(plain(X.scrClean({ s: 12, f: 'knot', w: 3, sl: -6, tm: 'serif', ink: 'royal', on: ['arms', 'arms', 'x'], z: 1 })), { s: 12, f: 'knot', w: 3, sl: -6, tm: 'serif', ink: 'royal', on: ['arms'] });
  assert.equal(X.scrClean({ s: -1, f: 'runes', w: 4, sl: 30, tm: 'x', ink: '#123456', on: 'title' }), null);
  assert.equal(X.scrClean({ s: 1.5, sl: 0 }), null);
  assert.deepEqual(plain(X.scrClean({ dr: 'ttb', mx: 'loop', mp: 50, lf: { B: 'wedge', b: 'loop', AB: 'loop', C: 'runes' }, cg: { A: '0z,~4mD,2hf2,.c', Q: 'zz,', R: '.E' } })), { dr: 'ttb', mx: 'loop', mp: 50, lf: { B: 'wedge' }, cg: { A: '0z,~4mD,2hf2,.c' } });
  assert.equal(X.scrClean({ dr: 'ltr', mx: 'x', mp: 55, lf: [], cg: 'A' }), null);
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

test('a sign drawn by hand: strokes on a 5 × 8 grid, curves, closed shapes and dots, within limits', () => {
  assert.deepEqual(plain(X.scrNode(0)), [0, 0]);
  assert.deepEqual(plain(X.scrNode(39)), [10, 14]);
  assert.deepEqual(plain(X.scrNode(12)), [5, 4]);
  const g = X.scrCustom('0z,~4mD,2hf2,.c');
  assert.deepEqual(plain(g.S), [{ p: [[0, 0], [0, 14]], sm: 0 }, { p: [[10, 0], [5, 8], [10, 14]], sm: 1 }, { p: [[5, 0], [5, 6], [0, 6]], sm: 0, z: 1 }]);
  assert.deepEqual(plain(g.D), [[[5, 4], 1]]);
  assert.equal(g.x0, 0);
  assert.equal(g.w, 10);
  assert.ok(X.scrCodeOk('0z'));
  assert.ok(X.scrCodeOk('.0,.1,.2,.3'));
  assert.equal(X.scrCodeOk('.0,.1,.2,.3,.4'), false, 'five dots');
  assert.equal(X.scrCodeOk('01,02,03,04,05,06,07'), false, 'seven strokes');
  assert.equal(X.scrCodeOk('0123456789ab'), false, 'twelve points');
  assert.equal(X.scrCodeOk('0'), false);
  assert.equal(X.scrCodeOk('0E'), false, 'no point beyond the grid');
  assert.equal(X.scrCodeOk(''), false);
});

test('a blend, a family for one letter, a sign drawn by hand: the alphabet as written', () => {
  const sp = { s: 4242, f: 'ang', mx: 'loop', mp: 50 }, i = c => X.SCR_ABC.indexOf(c);
  const fams = [...X.SCR_ABC].map(c => X.scrFamOf(sp, c)), loops = fams.filter(f => f === 'loop').length;
  assert.ok(loops >= 8 && loops <= 28, `half the letters or so from the blend, got ${loops}`);
  assert.ok(fams.every(f => f === 'ang' || f === 'loop'));
  assert.ok([...X.SCR_ABC].filter(c => X.scrFamOf({ ...sp, mp: 10 }, c) === 'loop').length < [...X.SCR_ABC].filter(c => X.scrFamOf({ ...sp, mp: 90 }, c) === 'loop').length);
  assert.ok([...X.SCR_ABC].every(c => X.scrFamOf({ ...sp, mx: 'ang' }, c) === 'ang'), 'blending the family into itself changes nothing');
  const G = X.scrSet(sp);
  for (const c of 'ABCXYZ09') assert.equal(G[i(c)], X.scrGlyphs(4242, X.scrFamOf(sp, c))[i(c)]);
  const own = X.scrSet({ ...sp, lf: { B: 'wedge' }, cg: { A: '0z', B: '' } });
  assert.equal(X.scrFamOf({ ...sp, lf: { B: 'wedge' }, cg: { A: '0z' } }, 'A'), 'own');
  assert.deepEqual(plain(own[i('A')].S), [{ p: [[0, 0], [0, 14]], sm: 0 }]);
  assert.equal(own[i('B')], X.scrGlyphs(4242, 'wedge')[i('B')]);
  assert.equal(X.scrSet(sp), G, 'the same choice is drawn once');
});

test('the words run left to right, right to left, in columns, or ox-turning', () => {
  const sp = { s: 77, f: 'wedge', w: 2 }, at = (L, c) => L.items.find(it => it.c === c);
  const ltr = X.scrLay(sp, 'AB CD'), rtl = X.scrLay({ ...sp, dr: 'rtl' }, 'AB CD');
  assert.ok(at(ltr, 'A').x < at(ltr, 'D').x);
  assert.ok(at(rtl, 'A').x > at(rtl, 'B').x && at(rtl, 'B').x > at(rtl, 'D').x);
  assert.equal(rtl.w, ltr.w);
  const col = X.scrLay({ ...sp, dr: 'ttb' }, 'AB CD', { v: 1 });
  assert.equal(col.v, 1);
  assert.ok(at(col, 'B').y > at(col, 'A').y && at(col, 'A').y === 0 && at(col, 'C').y === 0);
  assert.ok(at(col, 'A').x > at(col, 'C').x, 'the first word is the right-hand column');
  assert.ok(col.h > 28);
  const flat = X.scrLay({ ...sp, dr: 'ttb' }, 'AB CD');
  assert.equal(flat.v, 0, 'without room for columns it keeps a line');
  assert.ok(at(flat, 'A').x < at(flat, 'D').x);
  const ox = X.scrLay({ ...sp, dr: 'bou' }, 'AB CD'), G = X.scrSet(sp);
  assert.ok(at(ox, 'C').x > at(ox, 'D').x, 'the second word runs back');
  assert.equal(at(ox, 'A').g, G[0]);
  assert.equal(at(ox, 'C').g, X.scrMirror(G[2]), 'its letters mirrored');
  assert.equal(X.scrLay({ ...sp, dr: 'bou' }, 'CD', { wi: 1 }).items[0].g, X.scrMirror(G[3]), 'a line drawn a word at a time keeps count');
  assert.match(X.scrSVG({ ...sp, dr: 'ttb' }, 'AB', { v: 1 }), /style="--k:[0-9.]+"/);
});
