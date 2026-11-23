// Monuments to fallen nations (23 Nov 2026; game/edictum.html, "monuments to fallen nations"; functions/war-rules.js,
// memorial): wherever a capital fell, a monument on the map that tells of the nation; Moradara, the nation of Edictum's
// first player, gets the First Flame, the only one of its kind. Checked with the game's own code, cut from its source.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorial } from '../functions/war-rules.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const DAY = 864e5, J = v => JSON.parse(JSON.stringify(v));
const SEC = cut('/* ───────── monuments to fallen nations (23 November 2026)', '/* ───────── works done (WD)');
const FIRST = 'vSaJNbKeUzO1NqwCR5gWHey5zn92';

test('the referee keeps what the nation was with its fall: short strings, counts, its flag', () => {
  const m = memorial({ pretitle: 'Republic', leader: 'President', ruler: 'Ada', motto: 'x'.repeat(200), demonym: 'Moradaran', currency: 'crown', animal: 'otter', mapc: '#E5722A',
    flag: { p: 'chief', c: ['#E5722A', '#FFFFFF', '#E5722A'], e: 'none', ec: '#152450' }, pop: 52.99312, cities: [1, 2, 3, 4, 5], ach: Object.fromEntries([...Array(105)].map((_, i) => ['a' + i, 1])),
    answered: [{ o: 0 }, { o: 2 }, { o: -1 }], wars: { secret: 1 }, stock: { food: 9 } });
  assert.deepEqual(J(m), { pre: 'Republic', ld: 'President', ru: 'Ada', mo: 'x'.repeat(80), dem: 'Moradaran', cur: 'crown', ani: 'otter', fl: { p: 'chief', c: ['#E5722A', '#FFFFFF', '#E5722A'], e: 'none', ec: '#152450' },
    mc: '#E5722A', pop: 52.99, ct: 5, ach: 105, dec: 2 }, 'nothing else of the record');
  assert.equal(memorial({ dec: 40 }).dec, 40, 'the count of decisions the record keeps');
  const big = memorial({ flag: { p: 'tri-v', c: ['#111111', '#222222', '#333333'], e: 'star', ec: '#444444', layers: [...Array(200)].map(() => ({ k: 'disc', x: 1, y: 1, w: 1, h: 1, c: '#000000' })) } });
  assert.deepEqual(J(big.fl), { p: 'tri-v', c: ['#111111', '#222222', '#333333'], e: 'star', ec: '#444444' }, 'a flag too big to keep, without its layers');
  assert.deepEqual(J(memorial(null)), { pre: '', ld: '', ru: '', mo: '', dem: '', cur: '', ani: '', fl: {}, mc: '', pop: 0, ct: 0, ach: 0, dec: 0 });
  assert.match(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'), /const doc = \{ \.\.\.sg\.data\(\), st: 'fell', ft: now, foes, m: memorial\(them\) \};/);
  assert.match(src, /foes:Array\.isArray\(d\.foes\)\?d\.foes\.filter\(x=>typeof x==='string'\)\.slice\(0,40\):\[\],m:monNorm\(d\.m\)\};/, 'every game reads it with the siege');
});

function ctxWith(falls, world = {}) {
  const ctx = vm.createContext({ DAY, Math, JSON, Number, String, isFinite, Map, Set, Array, Object, wrFallsAt: () => falls, myId: () => 'me', S: { nation: null, world, worldAll: {} }, DORM: { w: {}, all: {} }, REG: { id: 'meridian' },
    MAP_LAYERS: [], MAP_TIP: [], MAP_PANEL: [], MAP_LEGEND: [], fmtDate: t => new Date(t).toISOString().slice(0, 10), fmtPop: p => p.toFixed(2) + ' million', plural: w => w + 's', regName: r => 'Region ' + r,
    esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), safeColor: (c, d) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d, mapColor: f => f.c[0],
    flagSVG: (f, l) => `<svg data-p="${f.p}" aria-label="${l}"></svg>`, flagNorm: f => f, cityList: n => n.cities || [], achEarnedIds: n => Object.keys(n.ach || {}), decisions: n => n.dec || 0 });
  vm.runInContext(vars(SEC), ctx);
  return ctx;
}
const fall = (id, d, c, ft, o = {}) => ({ id, a: 'conq', d, c, ft, df: ft - 20 * DAY, dn: 'Nation ' + id, an: 'Conquerors', cn: 'Capital ' + id, reg: 'meridian', foes: [], m: null, ...o });

test('one monument on each hex a capital fell on, telling of the newest fall there; the First Flame for Moradara\'s first fall only', () => {
  const t = Date.UTC(2026, 10, 22), falls = [fall('a', 'x1', 7, t), fall('m1', FIRST, 9, t + 1000, { dn: 'Moradara', cn: 'Ordar' }), fall('b', 'x2', 7, t + 2000), fall('m2', FIRST, 11, t + 3000, { dn: 'Moradara' })];
  const ctx = ctxWith(falls), L = J(ctx.monSites());
  assert.deepEqual(L.map(s => [s.c, s.falls.map(f => f.id), s.first && s.first.id]), [[7, ['a', 'b'], null], [9, ['m1'], 'm1'], [11, ['m2'], null]]);
  assert.equal(ctx.monIsFirst(falls[1]), true);assert.equal(ctx.monIsFirst(falls[3]), false, 'one First Flame: a later fall of the same account has an ordinary monument');
  assert.equal(ctx.monIsFirst(falls[0]), false);
  assert.equal(ctx.monSites(), ctx.monSites(), 'kept until the falls change');
  const tip = ctx.MAP_TIP[0];
  assert.equal(tip({ cell: 9, kind: 'main' }), 'The First Flame, monument to Moradara, the first nation');
  assert.equal(tip({ cell: 7, kind: 'visit' }), 'Monument to Nation b, fallen 2026-11-22');
  assert.equal(tip({ cell: 8, kind: 'main' }), null);assert.equal(tip({ cell: 7, kind: 'mini' }), null);
  assert.equal(ctx.MAP_PANEL[0]({ cell: 8 }), '', 'no card where nothing fell');
  assert.match(ctx.MAP_LEGEND[0](), /Monument to a fallen nation.*The First Flame/);
  assert.equal(ctxWith([falls[0]]).MAP_LEGEND[0]().includes('First Flame'), false);
  assert.equal(ctxWith([]).MAP_LEGEND[0](), '');
});

test('the card tells of the nation: kept with its fall, or read from its record while it stands as it fell', () => {
  const t = Date.UTC(2026, 10, 22, 20, 58), kept = { pre: 'People’s Republic', ld: 'Supreme Leader', ru: '', mo: 'Strength <b>Through</b> Paperwork', dem: 'Tocantinian', cur: 'crown', ani: 'otter',
    fl: { p: 'diag3', c: ['#152450', '#F4EEDC', '#F2C230'] }, mc: '', pop: 5, ct: 1, ach: 12, dec: 30 };
  const F = fall('t', 'toc', 5, t, { dn: 'Tocantins', an: 'The Wandering Isles', cn: 'Port Alder', df: t - 8 * DAY, m: kept });
  const ctx = ctxWith([F]), h = ctx.MAP_PANEL[0]({ cell: 5 });
  assert.match(h, /A monument to a fallen nation/);assert.match(h, /data-p="diag3"/, 'its flag');
  assert.match(h, /The People’s Republic of Tocantins/);
  assert.match(h, /Here stood Port Alder, capital of Tocantins for 8 days, until the army of The Wandering Isles took it after a siege on 2026-11-22\./);
  for (const [k, v] of [['Founded', '2026-11-14'], ['Fell', '2026-11-22, to The Wandering Isles'], ['Lasted', '8 days'], ['Leader', 'Supreme Leader'], ['Motto', '“Strength &lt;b>Through&lt;/b> Paperwork”'], ['People', '5.00 million'], ['Cities', '1'], ['Achievements', '12'], ['Edicts decided', '30'], ['Its people', 'Tocantinians']])
    assert.ok(h.includes(`<dt>${k}</dt><dd>${v}</dd>`), k + ': ' + v);
  assert.doesNotMatch(h, /<b>Through/, 'a player\'s words escaped');
  /* a fall from before the referee kept anything: the record, while it stands as it fell */
  const old = fall('o', 'kes', 6, t, { dn: 'Kesarova', df: 100, m: null }), rec = { name: 'Kesarova', founded: 100, pretitle: 'Kingdom', leader: 'President', motto: 'Hold', flag: { p: 'cross', c: ['#C8102E'] }, pop: 5, cities: [{}], ach: { a: 1 }, dec: 3 };
  const c2 = ctxWith([old], { kes: rec });assert.match(c2.MAP_PANEL[0]({ cell: 6 }), /The Kingdom of Kesarova[\s\S]*<dt>Motto<\/dt><dd>“Hold”/);
  const c3 = ctxWith([old], { kes: { ...rec, founded: t + DAY, name: 'Kesarova Reborn' } }), h3 = c3.MAP_PANEL[0]({ cell: 6 });
  assert.doesNotMatch(h3, /Kingdom/, 'not the record of a nation founded again since');
  assert.match(h3, /Its people rose again as Kesarova Reborn on 2026-11-23\./);
  const c4 = ctxWith([old]);c4.S.worldAll = { kes: { reg: 'greywater', name: 'New Kes' } };
  assert.match(c4.MAP_PANEL[0]({ cell: 6 }), /Its people rose again as New Kes in Region greywater\./, 'or in another region');
  /* several falls on one hex: the others listed */
  const c5 = ctxWith([old, { ...F, c: 6 }]);assert.match(c5.MAP_PANEL[0]({ cell: 6 }), /Also fallen here[\s\S]*Kesarova, which fell to Conquerors/);
});

test('the First Flame\'s card: the first player\'s nation, before any border', () => {
  const ft = Date.UTC(2026, 11, 1), F = fall('m', FIRST, 9, ft, { dn: 'Moradara', cn: 'Ordar', an: 'Eternia', df: Date.UTC(2026, 9, 30, 13, 52), m: { pre: 'Republic', ld: 'President', mo: 'Strength', fl: { p: 'chief', c: ['#E5722A'] }, pop: 52.99, ct: 5, ach: 105, dec: 400 } });
  const h = ctxWith([F]).MAP_PANEL[0]({ cell: 9 });
  assert.match(h, /class="mon-card mon-first"/);assert.match(h, /The First Flame · the monument to the first nation/);
  assert.match(h, /Before there were borders, treaties or wars, there was Moradara, the nation of Edictum’s first player, founded on 2026-10-30\. Its capital, Ordar, stood here for 31 days, until the army of Eternia took it on 2026-12-01\. The flame on this column burns for as long as Edictum lasts\./);
  assert.ok(h.includes('<dt>Achievements</dt><dd>105</dd>'));
  assert.match(src, /const MON_FIRST=\{id:'vSaJNbKeUzO1NqwCR5gWHey5zn92',nm:'Moradara'\};/, 'Moradara, by its player');
});

test('the map: every monument on the main map and a visit, whatever layers are ticked; the War layer\'s ruins gone', () => {
  const t = Date.UTC(2026, 10, 22), falls = [fall('a', 'x1', 7, t), fall('m', FIRST, 9, t + 1, { dn: 'Moradara' })];
  const ctx = ctxWith(falls), drawn = [];
  Object.assign(ctx, { wr3Cols: () => ({ ink: '#222222', sheet: '#ffffff' }), HEX_R: 10, MAP_FONT: 'serif', cityState: () => ({ byCell: new Map([[7, {}]]) }), monInfo: () => null });
  ctx.monStele = (g, x, y, r, band) => drawn.push(['stele', x, y, band]);ctx.monFlame = (g, x, y) => drawn.push(['flame', x, y]);
  const labels = [], g = { set font(v) {}, set textAlign(v) {}, set lineJoin(v) {}, set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, strokeText() {}, fillText: t => labels.push(t) };
  const L = ctx.MAP_LAYERS[0];assert.deepEqual(J(L.kinds), ['main', 'visit']);assert.equal(L.stage, 'top');
  L.draw({ T: {}, g, s: 2, scr: c => [c * 10, c * 10], off: () => false });
  assert.deepEqual(drawn.map(d => d[0]), ['stele', 'flame']);
  assert.ok(drawn[0][1] < 70, 'beside the city standing on the hex, not on it');assert.equal(drawn[1][1], 90, 'the First Flame on its hex');
  assert.deepEqual(labels, ['Monument to Nation a', 'Moradara', 'the first nation'], 'named from mid zoom; the first nation always');
  labels.length = 0;L.draw({ T: {}, g, s: 0.7, scr: c => [c * 10, c * 10], off: () => false });assert.deepEqual(labels, ['Moradara'], 'zoomed out, only Moradara\'s name');
  assert.doesNotMatch(src, /wr3Ruin|'Ruins of '\+/, 'the War layer no longer draws ruins');
  assert.doesNotMatch(src, /<p class="eyebrow">Ruins<\/p>/, 'nor the old ruins card');
  assert.match(src, /Wherever a capital fell, a monument to its nation stands on the map whatever layers are ticked: click it to read about the nation that fell\./, 'Help says so');
});

test('the region\'s happenings, the Fallen nations card and the Dispatch tell of the First Flame', () => {
  assert.match(src, /txt:monIsFirst\(F\)\?`\$\{F\.dn\}, the nation of Edictum’s first player, fell:/);
  assert.match(src, /\$\{monIsFirst\(F\)\?'The First Flame, the monument to the first nation, burns':'A monument stands'\} where its capital/);
  assert.match(src, /if\(monIsFirst\(F\)\)\{out\.push\(\{t:F\.ft,sec:'front',h:`The first nation has fallen: \$\{F\.dn\}`/);
  const N = (() => { const c = vm.createContext({}); vm.runInContext(vars(cut('const MON_FIRST=', '\n')) + '\n' + fn('monNorm'), c); return c.monNorm; })();
  assert.equal(N(null), null);assert.equal(N([1]), null);
  assert.deepEqual(J(N({ pre: 'A\u0000B', pop: -3, ct: 2.7, ach: 'many', fl: [1], mo: 7 })), { pre: 'A B', ld: '', ru: '', mo: '', dem: '', cur: '', ani: '', fl: null, mc: '', pop: 0, ct: 2, ach: 0, dec: 0 }, 'read as any record is');
});

test('a click on a monument on another nation\'s land shows its card, while the panel is about that nation', () => {
  const t = Date.UTC(2026, 10, 22), ctx = ctxWith([fall('a', 'x1', 5, t)]);
  ctx.territory = () => ({ owner: { 5: 0, 4: 1 }, list: [{ id: 'conq', me: false }, { id: 'me', me: true }] });
  ctx.monPick(5);assert.deepEqual(J(ctx.S.monCell), { c: 5, sel: 'conq' });
  assert.match(ctx.MAP_PANEL[0]({ cell: null, sel: 'conq' }), /Here stood Capital a/);
  assert.equal(ctx.MAP_PANEL[0]({ cell: null, sel: 'someone-else' }), '', 'not once the panel is about another nation');
  assert.match(ctx.MAP_PANEL[0]({ cell: 5, sel: null }), /Here stood/, 'the hex the panel is about');
  ctx.monPick(4);assert.equal(ctx.S.monCell, null, 'a click elsewhere puts it away');
  assert.match(src, /if\(kind==='main'\)try\{monPick\(cell\);\}catch\(e\)\{\}\n  \/\* observing \(OBS\)/, 'every click on the main map, observing too');
});
