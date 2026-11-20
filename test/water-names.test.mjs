// Lake and sea names chosen by players (game/edictum.html, "lake and sea names chosen by players"): a nation names the
// lakes and the sea within 5 hexes of its land. A lake carries one name, the nearest namer's (as near, the first); the
// sea within reach of a nation is its waters, named a piece at a time, and where two nations' named waters overlap
// each hex carries the nearer nation's name (as near, the first). Names are kept in each namer's record (n.wtn) and
// follow the land. Checked here with the game's own code cut from its source, over a small made-up map.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j + (b.endsWith(';') ? b.length : 0)); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const NAMES = cut('/* ───────── lake and sea names chosen by players', "MAP_LAYERS.push({stage:'top',kinds:['main','visit','found'],draw:wnLabels});");
const LAKES = cut('const LAKE_MAX=40,LAKE_A=0.42;', '/* the land a lake lies in');
const HELP = [line('function c3CleanName('), line('const nameFold='), line('const cap1 = '), line('const esc = '), line('function list('), line('const rvFold='), line('function rvTidy(')].join('\n');
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const plain = v => JSON.parse(JSON.stringify(v));

/* a map of 24 columns and 14 rows of hexes (odd rows set half a hex right, as the game's): column 0 is a strip of sea
   along the left edge, columns 16 and up the open sea, the rest land, with a lake of two hexes at row 6, columns 5-6 */
const COLS = 24, ROWS = 14, N = COLS * ROWS, HEX_W = 20, HEX_R = 11.5;
const at = (r, c) => r * COLS + c;
function makeMap() {
  const T = new Uint8Array(N).fill(2), nbr = new Int32Array(N * 6).fill(-1), cx = new Float64Array(N), cy = new Float64Array(N);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = at(r, c); if (c === 0 || c >= 16) T[i] = 1;
    cx[i] = c * HEX_W + (r & 1) * HEX_W / 2 + HEX_W / 2; cy[i] = HEX_R + r * 1.5 * HEX_R;
    const odd = r & 1, d = odd ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]] : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    d.forEach(([dr, dc], k) => { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) nbr[i * 6 + k] = at(rr, cc); });
  }
  T[at(6, 5)] = 1; T[at(6, 6)] = 1;
  return { N, COLS, ROWS, T, nbr, cx, cy, W: COLS * HEX_W, H: ROWS * 1.5 * HEX_R };
}
const LAKE_V = at(11, 3); // a lake of the river network: a land hex, named by the map
function world(me = 'a') {
  const MAP = makeMap(), toasts = [];
  const ctx = vm.createContext({
    MAP, MAP_T0: MAP.T.slice(), HEX_W, HEX_R, S: { nation: null, world: {} }, REG: { id: 'meridian' }, REG_BY_ID: { meridian: {}, frostmarch: {} },
    HIDN: { w: {} }, NORM_HOOKS: [], MAP_PANEL: [], MAP_TIP: [], MAP_LAYERS: [], REGION: 'the Meridian Reach', RVN_LEN: 32, myId: () => me,
    document: { addEventListener() {} }, toast: m => toasts.push(m), updateMapPanel() {}, redrawMaps() {}, clone: v => JSON.parse(JSON.stringify(v)),
    cellOf: l => l ? l.r * COLS + l.c : -1
  });
  vm.runInContext(vars(HELP) + '\n' + vars(LAKES) + '\n' + vars(NAMES), ctx);
  ctx.RV = { list: [{ id: 0, name: 'the Ostra', name0: 'the Ostra', nm: null }], lakes: [{ id: 0, name: 'Lake Morrow', cells: [LAKE_V] }], lakeAt: new Map([[LAKE_V, 0]]) };
  ctx.toasts = toasts;
  return ctx;
}
/* land: owner[c] = index into list, -1 where nobody holds it */
function land(list, own) {
  const owner = new Int32Array(N).fill(-1); for (const [i, cells] of own) for (const c of cells) owner[c] = i;
  return { list, owner, count: list.map((x, i) => owner.filter(o => o === i).length), byId: Object.fromEntries(list.map((x, i) => [x.id, i])) };
}
const block = (r0, r1, c0, c1) => { const a = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) a.push(at(r, c)); return a; };
const entry = (c, n, t = 1, r = 'meridian') => ({ r, c, n, t });
const nation = (id, wtn, more = {}) => ({ id, n: { name: id.toUpperCase(), wtn }, ...more });
const A_LAND = block(2, 4, 11, 13), B_LAND = block(8, 10, 12, 15);

test('what a hex is to a namer: land, a lake of open water, a lake of the river network, the sea', () => {
  const W = world();
  assert.equal(W.wnKind(at(5, 8)), null, 'land');
  assert.equal(W.wnKind(at(6, 5)).k, 'l');
  assert.equal(W.wnKind(at(6, 5)).id, W.wnKind(at(6, 6)).id, 'one lake');
  assert.deepEqual(plain(W.wnKind(LAKE_V)), { k: 'v', id: 0 });
  const s1 = W.wnKind(at(3, 16)), s2 = W.wnKind(at(3, 0));
  assert.equal(s1.k, 's'); assert.equal(s2.k, 's');
  assert.notEqual(s1.b, s2.b, 'the strip on the left is another sea');
  assert.equal(W.wnKind(-1), null); assert.equal(W.wnKind(N), null);
});

test('a nation\'s waters: the sea within 5 hexes of its land, in one piece here', () => {
  const W = world(), T = land([nation('a')], [[0, A_LAND]]), Wa = W.wnWaters(T, 0);
  assert.equal(Wa.R.get(at(3, 13)), 0, 'its own land');
  assert.equal(Wa.R.get(at(3, 16)), 3);
  assert.equal(Wa.R.get(at(3, 18)), 5);
  assert.equal(Wa.R.has(at(3, 19)), false, 'six hexes off');
  assert.ok(Wa.pc.has(at(3, 16)) && !Wa.pc.has(at(3, 15)), 'only the sea is its waters');
  assert.equal(Wa.size.length, 1);
  assert.equal(Wa.size[0], [...Wa.pc.keys()].length);
  assert.equal(W.wnWaters(T, 0), Wa, 'kept while the land is the same');
});

test('a name given to the sea goes on the nation\'s waters there, and nowhere else', () => {
  const W = world(), T = land([nation('a', [entry(at(3, 16), 'the Amber Sea')])], [[0, A_LAND]]);
  W.wnSync(T);
  const Wa = W.wnWaters(T, 0);
  assert.equal(W.WN.sea.size, Wa.pc.size);
  assert.equal(W.wnAt(T, at(4, 18)).nm, 'the Amber Sea');
  assert.equal(W.wnAt(T, at(4, 18)).by, 'a');
  assert.equal(W.wnAt(T, at(3, 19)).nm, '', 'beyond its reach');
  assert.equal(W.wnAt(T, at(3, 0)).nm, '', 'another sea');
  assert.deepEqual(plain(W.WN.parts.map(p => [p.nm, p.n])), [['the Amber Sea', Wa.pc.size]]);
  assert.ok(W.WN.parts[0].list.every(c => W.WN.sea.has(c)), 'its label goes on its own waters');
});

test('where two nations\' named waters overlap, the nearer nation\'s name shows; as near, the first given', () => {
  const W = world(), A = nation('a', [entry(at(3, 16), 'the Amber Sea', 5)]), B = nation('b', [entry(at(9, 16), 'the Cold Sound', 9)]);
  const T = land([A, B], [[0, A_LAND], [1, B_LAND]]);
  W.wnSync(T);
  const Wa = W.wnWaters(T, 0), Wb = W.wnWaters(T, 1);
  let near = 0, far = 0, tie = 0;
  for (const c of Wa.pc.keys()) {
    if (!Wb.pc.has(c)) { assert.equal(W.wnAt(T, c).nm, 'the Amber Sea'); continue; }
    const da = Wa.R.get(c), db = Wb.R.get(c), a = W.wnAt(T, c);
    assert.equal(a.all.length, 2, 'both names reach it');
    if (da < db) { near++; assert.equal(a.nm, 'the Amber Sea'); } else if (db < da) { far++; assert.equal(a.nm, 'the Cold Sound'); } else { tie++; assert.equal(a.nm, 'the Amber Sea', 'as near: the name given first'); }
  }
  assert.ok(near && far && tie, `the test map has hexes of each kind (${near}, ${far}, ${tie})`);
  /* named the other way round in time, the hexes as near go to B */
  A.n.wtn[0].t = 20; W.S.world = {};
  W.wnSync(T);
  for (const c of Wa.pc.keys()) if (Wb.pc.has(c) && Wa.R.get(c) === Wb.R.get(c)) assert.equal(W.wnAt(T, c).nm, 'the Cold Sound');
  assert.equal(W.WN.parts.length, 2);
});

test('neighbours giving their waters the same name have one label over them', () => {
  const W = world(), T = land([nation('a', [entry(at(3, 16), 'the Amber Sea')]), nation('b', [entry(at(9, 16), 'the Amber Sea', 2)])], [[0, A_LAND], [1, B_LAND]]);
  W.wnSync(T);
  assert.equal(W.WN.parts.length, 1);
  assert.equal(W.WN.parts[0].n, W.WN.sea.size);
});

test('a lake carries the name of the nearest nation that named it; as near, the first; holding it, nearest of all', () => {
  const W = world(), LK = at(6, 5);
  /* A two hexes from the lake, B three */
  const A = nation('a', [entry(LK, 'Lake Amber', 5)]), B = nation('b', [entry(at(6, 6), 'the Mere', 1)]);
  const own = () => [[0, [at(6, 8), at(5, 8)]], [1, [at(6, 9), at(7, 9)]]];
  let T = land([A, B], own());
  W.wnSync(T);
  assert.equal(W.wnAt(T, LK).nm, 'Lake Amber', 'nearer');
  assert.equal(W.wnAt(T, at(6, 6)).nm, 'Lake Amber', 'the whole lake');
  assert.deepEqual(plain(W.wnAt(T, LK).all.map(o => o.nm)), ['Lake Amber', 'the Mere']);
  /* as near: the name given first */
  T = land([A, B], [[0, [at(6, 8)]], [1, [at(7, 7)]]]);
  W.wnSync(T);
  assert.equal(W.wnAt(T, LK).nm, 'the Mere');
  /* B holds a hex of the lake */
  T = land([A, B], [[0, [at(6, 7)]], [1, [at(6, 6), at(7, 8)]]]);
  W.wnSync(T);
  assert.equal(W.wnAt(T, LK).nm, 'the Mere');
  assert.equal(W.wnAt(T, LK).all[0].d, 0);
  assert.equal(W.WN.lakes.length, 1, 'a named lake of open water gets a label');
  /* six hexes off, a nation's name does not count */
  T = land([A, B], [[0, [at(6, 12)]], [1, [at(6, 13)]]]);
  W.wnSync(T);
  assert.equal(W.wnAt(T, LK).nm, '');
  assert.equal(W.WN.lakes.length, 0);
});

test('a lake of the river network keeps the map\'s name until a nation names it, and gets it back', () => {
  const W = world(), A = nation('a', [entry(LAKE_V, 'Lake Brightwater')]);
  let T = land([A], [[0, [at(11, 6)]]]);
  W.wnSync(T);
  assert.equal(W.RV.lakes[0].name, 'Lake Brightwater');
  assert.equal(W.RV.lakes[0].name0, 'Lake Morrow');
  assert.deepEqual(plain(W.wnAt(T, LAKE_V)), { k: 'v', id: 0, nm: 'Lake Brightwater', by: 'a', nm0: 'Lake Morrow', all: [{ i: 0, id: 'a', nm: 'Lake Brightwater', t: 1, d: 3, c: LAKE_V }] });
  /* the land within reach lost: the map's name is back */
  T = land([A], [[0, [at(11, 12)]]]);
  W.wnSync(T);
  assert.equal(W.RV.lakes[0].name, 'Lake Morrow');
  assert.equal(W.wnAt(T, LAKE_V).nm, 'Lake Morrow');
  assert.equal(W.wnAt(T, LAKE_V).by, null);
});

test('computer nations and hidden nations name nothing; names given in another region are kept apart', () => {
  const W = world(), T = land([nation('a', [entry(at(3, 16), 'the Amber Sea')], { npc: true }), nation('b', [entry(at(9, 16), 'the Cold Sound')], { hid: true }), nation('c', [entry(at(9, 16), 'the Far Sea', 1, 'frostmarch')])], [[0, A_LAND], [1, B_LAND], [2, B_LAND.slice(0, 2)]]);
  W.wnSync(T);
  assert.equal(W.WN.sea.size, 0);
});

test('a name must be new to the region: rivers, lakes and other seas; the same sea may share one', () => {
  const W = world(), T = land([nation('a', [entry(at(3, 16), 'the Amber Sea')]), nation('b', [entry(at(6, 5), 'the Mere')])], [[0, A_LAND], [1, [at(6, 8)]]]);
  W.wnSync(T);
  assert.match(W.wnNameProblem(at(9, 17), 'x'), /at least two characters/);
  assert.match(W.wnNameProblem(at(9, 17), 'The Ostra'), /already a river called The Ostra/);
  assert.match(W.wnNameProblem(at(9, 17), 'lake morrow'), /Lake Morrow is a lake/);
  assert.match(W.wnNameProblem(at(9, 17), 'The Mere'), /The Mere is a lake/);
  assert.equal(W.wnNameProblem(at(9, 17), 'The Amber Sea'), '', 'the same sea');
  assert.match(W.wnNameProblem(at(5, 0), 'the Amber Sea'), /already a sea called The Amber Sea/);
  assert.equal(W.wnNameProblem(at(6, 6), 'the Mere'), '', 'the same lake');
  assert.equal(W.wnNameProblem(LAKE_V, 'Lake Morrow'), '', 'its own old name');
  assert.match(W.wnNameProblem(at(6, 6), 'Lake Morrow'), /is a lake/);
  assert.match(W.wnTaken('amber sea', null), /sea called The Amber Sea/, 'what the river names check');
});

test('records are cleaned on load: bad entries dropped, one per hex, the newest kept, thirty at most', () => {
  const W = world(), n = {}, ok = i => ({ r: 'meridian', c: i, n: 'Sea ' + i, t: i });
  W.NORM_HOOKS[0](n, { wtn: [null, { r: 'nowhere', c: 1, n: 'Xx' }, { r: 'meridian', c: -1, n: 'Xx' }, { r: 'meridian', c: 2, n: 'X' }, { r: 'meridian', c: 3.5, n: 'Xx' }, { r: 'meridian', c: 4, n: ' <b>Gull</b>   Bay ', t: 'x' }, { r: 'meridian', c: 4, n: 'Gull Bay', t: 7 }] });
  assert.deepEqual(plain(n.wtn), [{ r: 'meridian', c: 4, n: 'Gull Bay', t: 7 }]);
  const m = {}; W.NORM_HOOKS[0](m, { wtn: Array.from({ length: 40 }, (_, i) => ok(i)) });
  assert.equal(m.wtn.length, 30); assert.equal(m.wtn[0].c, 10);
  const e = { wtn: [1] }; W.NORM_HOOKS[0](e, { wtn: [] }); assert.equal('wtn' in e, false);
});

test('naming, renaming and taking a name away: one name a piece, one line in the history', () => {
  const W = world(), me = nation('a', []);let T = land([me], [[0, A_LAND]]);
  me.n = { name: 'A', loc: { r: 3, c: 12 }, log: [], wtn: [] }; W.S.nation = me.n;
  W.territory = () => T; W.commit = n => { W.S.nation = n; me.n = n; T.list[0] = { ...me, n }; };
  assert.equal(W.wnRename(at(3, 16), 'The Amber Sea'), true);
  assert.deepEqual(plain(W.S.nation.wtn.map(e => [e.c, e.n])), [[at(3, 16), 'the Amber Sea']]);
  assert.deepEqual(plain(W.S.nation.log[0]), { t: W.S.nation.log[0].t, k: 'wtren', a: 'the Amber Sea', b: '', fx: 's' });
  assert.match(W.toasts.at(-1), /^The sea off your coast is now called the Amber Sea/);
  /* a rename at another hex of the same piece replaces the name, and the history keeps one line */
  W.wnRename(at(4, 17), 'Gull Bay');
  assert.deepEqual(plain(W.S.nation.wtn.map(e => [e.c, e.n])), [[at(4, 17), 'Gull Bay']]);
  assert.deepEqual(W.S.nation.log.map(l => [l.k, l.a, l.b]), [['wtren', 'Gull Bay', '']]);
  assert.equal(W.wnAt(T, at(3, 16)).nm, 'Gull Bay');
  /* out of reach: refused, nothing changes */
  assert.equal(W.wnRename(at(3, 20), 'Far Water'), false);
  assert.match(W.S.wnErr, /only within 5 hexes/);
  /* a lake: its own entry beside the sea's */
  assert.equal(W.wnRename(LAKE_V, 'Lake Bright'), false, 'eight hexes off: out of reach');
  assert.equal(W.RV.lakes[0].name, 'Lake Morrow');
  T = land([me], [[0, A_LAND.concat(at(11, 6))]]);
  assert.equal(W.wnRename(LAKE_V, 'Lake Bright'), true);
  assert.equal(W.RV.lakes[0].name, 'Lake Bright');
  assert.equal(W.S.nation.wtn.length, 2);
  /* taken away within hours: the map's name back, and no line in the history for it */
  assert.equal(W.wnReset(LAKE_V), true);
  assert.equal(W.RV.lakes[0].name, 'Lake Morrow');
  assert.equal(W.S.nation.wtn.length, 1);
  assert.equal(W.S.nation.log.filter(l => l.a === 'Lake Bright' || l.b === 'Lake Bright').length, 0);
  assert.match(W.toasts.at(-1), /^Lake Bright is Lake Morrow again/);
  /* the sea's name taken away: nothing left */
  W.wnReset(at(3, 16));
  assert.equal('wtn' in W.S.nation, false);
  assert.equal(W.S.nation.log.length, 0);
});

test('two names on record for one piece of sea (pieces that grew together, a lake named twice): the newer shows', () => {
  const W = world(), T = land([nation('a', [entry(at(3, 16), 'the Amber Sea', 1), entry(at(4, 17), 'Gull Bay', 2), entry(at(6, 5), 'the Mere', 3), entry(at(6, 6), 'Lake Amber', 4)])], [[0, A_LAND.concat(at(6, 8))]]);
  W.wnSync(T);
  assert.equal(W.wnAt(T, at(3, 16)).nm, 'Gull Bay');
  assert.equal(W.wnAt(T, at(3, 16)).all.length, 1);
  assert.deepEqual(plain(W.WN.parts.map(p => p.nm)), ['Gull Bay']);
  assert.equal(W.wnAt(T, at(6, 5)).nm, 'Lake Amber');
  assert.equal(W.wnAt(T, at(6, 5)).all.length, 1);
});
