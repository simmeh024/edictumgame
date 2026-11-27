// Mountain ranges named by players (game/edictum.html, "mountain ranges, named by players"): mountains that touch make
// a range; the map names every range of MR_MIN hexes or more, and a nation holding a hex of a range may give it a name
// of its own. A range carries one name: the name given by the nation holding most of it (as many, the one named first).
// Names are kept in each namer's record (n.mrn) and follow the land. The Daily Dispatch uses the names on the map, and
// writes a discovery under the name its finder gave it. Checked here with the game's own code cut from its source,
// over a small made-up map.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j + (b.endsWith(';') ? b.length : 0)); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const RANGES = cut('/* ───────── mountain ranges, named by players', "MAP_LAYERS.push({stage:'top',kinds:['main','visit','found'],draw:mrLabels});");
const WATERS = cut('/* ───────── lake and sea names chosen by players', "MAP_LAYERS.push({stage:'top',kinds:['main','visit','found'],draw:wnLabels});");
const LAKES = cut('const LAKE_MAX=40,LAKE_A=0.42;', '/* the land a lake lies in');
const HELP = [line('function c3CleanName('), line('const nameFold='), line('const cap1 = '), line('const esc = '), line('function list('), line('const rvFold='), line('function rvTidy('), line('function hash('), line('const clamp = ')].join('\n');
const PLACE = line('function placePhrase(');
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const plain = v => JSON.parse(JSON.stringify(v));

/* a map of 24 columns and 14 rows of hexes (odd rows set half a hex right, as the game's): land, with a strip of sea
   down the left edge and the open sea from column 20; a range of 15 mountain hexes (rows 2-4, columns 4-8), another
   of 9 (rows 9-11, columns 4-6), a run of two (row 6, columns 14-15) and a lone peak (row 12, column 12) */
const COLS = 24, ROWS = 14, N = COLS * ROWS, HEX_W = 20, HEX_R = 11.5;
const at = (r, c) => r * COLS + c;
const block = (r0, r1, c0, c1) => { const a = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) a.push(at(r, c)); return a; };
const BIG = block(2, 4, 4, 8), MID = block(9, 11, 4, 6), TWO = [at(6, 14), at(6, 15)], ONE = at(12, 12);
function makeMap() {
  const T = new Uint8Array(N).fill(2), nbr = new Int32Array(N * 6).fill(-1), cx = new Float64Array(N), cy = new Float64Array(N);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = at(r, c); if (c === 0 || c >= 20) T[i] = 1;
    cx[i] = c * HEX_W + (r & 1) * HEX_W / 2 + HEX_W / 2; cy[i] = HEX_R + r * 1.5 * HEX_R;
    const odd = r & 1, d = odd ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]] : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    d.forEach(([dr, dc], k) => { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) nbr[i * 6 + k] = at(rr, cc); });
  }
  for (const c of [...BIG, ...MID, ...TWO, ONE]) T[c] = 4;
  return { N, COLS, ROWS, T, nbr, cx, cy, W: COLS * HEX_W, H: ROWS * 1.5 * HEX_R, comp: new Int32Array(N).fill(0), comps: [{ name: 'Brask', size: N }] };
}
/* land: owner[c] = index into list, -1 where nobody holds it */
function land(list, own) {
  const owner = new Int32Array(N).fill(-1); for (const [i, cells] of own) for (const c of cells) owner[c] = i;
  return { list, owner, byId: Object.fromEntries(list.map((x, i) => [x.id, i])) };
}
const entry = (c, n, t = 1, r = 'meridian') => ({ r, c, n, t });
const nation = (id, mrn, more = {}) => ({ id, n: { name: id.toUpperCase(), mrn, loc: { r: 0, c: 0 }, log: [] }, ...more });
function world(me = 'a') {
  const MAP = makeMap(), toasts = [];
  const ctx = vm.createContext({
    MAP, MAP_T0: MAP.T.slice(), HEX_W, HEX_R, S: { nation: null, world: {} }, REG: { id: 'meridian' }, REG_BY_ID: { meridian: {}, frostmarch: {} },
    HIDN: { w: {} }, NORM_HOOKS: [], MAP_PANEL: [], MAP_TIP: [], MAP_LAYERS: [], REGION: 'the Meridian Reach', RVN_LEN: 32, MAP_FONT: 'serif', myId: () => me,
    document: { addEventListener() {} }, toast: m => toasts.push(m), updateMapPanel() {}, redrawMaps() {}, clone: v => JSON.parse(JSON.stringify(v)),
    cellOf: l => l ? l.r * COLS + l.c : -1, cellKey: i => 'meridian:' + i, rlfDark: () => false, rvHit: () => false,
    isLake: () => false, lakeShore: () => '', placeIn: () => 'in the mountains of', TERRAIN_IN: []
  });
  vm.runInContext(vars(HELP) + '\n' + vars(LAKES) + '\n' + vars(WATERS) + '\n' + vars(RANGES) + '\n' + PLACE, ctx);
  ctx.RV = { list: [{ id: 0, name: 'the Ostra', name0: 'the Ostra', nm: null }], lakes: [{ id: 0, name: 'Lake Morrow', name0: 'Lake Morrow', cells: [] }], lakeAt: new Map() };
  /* the territory the game would work out, and a save that puts the nation back in it */
  ctx.T = null; ctx.territory = () => ctx.T; ctx.mapTerr = () => ctx.T;
  ctx.commit = n => { ctx.S.nation = n; const i = ctx.T.byId[me]; if (i !== undefined) ctx.T = { ...ctx.T, list: ctx.T.list.map((x, j) => j === i ? { ...x, n } : x) }; };
  ctx.use = T => { ctx.T = T; const i = T.byId[me]; ctx.S.nation = i === undefined ? null : T.list[i].n; return T; };
  ctx.toasts = toasts;
  return ctx;
}

test('mountains that touch make a range; the map names those of six hexes or more, each once', () => {
  const W = world(), G = W.mrMap();
  assert.deepEqual(plain(G.list.map(R => R.n).sort((a, b) => b - a)), [15, 9, 2, 1]);
  const big = W.mrOf(BIG[0]), mid = W.mrOf(MID[4]);
  assert.ok(BIG.every(c => W.mrOf(c) === big) && MID.every(c => W.mrOf(c) === mid), 'every hex of a block is one range');
  assert.equal(W.mrOf(TWO[0]), W.mrOf(TWO[1]));
  assert.equal(W.mrOf(at(5, 5)), null, 'lowland is no range');
  assert.equal(W.mrOf(-1), null); assert.equal(W.mrOf(N), null);
  assert.match(big.name0, /^the [A-Z][a-z]+ (Peaks|Crags|Heights|Range|Mountains)$/);
  assert.match(mid.name0, /^the [A-Z][a-z]+ /);
  assert.notEqual(W.rvFold(big.name0), W.rvFold(mid.name0));
  assert.equal(W.mrOf(TWO[0]).name0, '', 'a run of two has no name of its own');
  assert.equal(W.mrOf(ONE).name0, '');
  /* the same map gives the same names */
  assert.equal(world().mrOf(BIG[0]).name0, big.name0);
  assert.equal(W.mrName(BIG[3]), big.name0, 'before any sync, the map\'s own name');
});

test('a range carries the name given by the nation holding most of it; as many, the one named first', () => {
  const W = world(), A = nation('a', [entry(BIG[0], 'the Grey Spine', 5)]), B = nation('b', [entry(BIG[14], 'the Saltpeaks', 9)]);
  const T = W.use(land([A, B], [[0, BIG.slice(0, 4)], [1, BIG.slice(4, 6)]]));
  assert.equal(W.mrAt(T, BIG[10]).nm, 'the Grey Spine', 'A holds four hexes, B two');
  assert.equal(W.mrAt(T, BIG[10]).by, 'a');
  assert.deepEqual(plain(W.mrAt(T, BIG[10]).all.map(o => [o.id, o.h])), [['a', 4], ['b', 2]]);
  assert.equal(W.mrAt(T, MID[0]).nm, W.mrOf(MID[0]).name0, 'the other range keeps the map\'s name');
  const T2 = W.use(land([A, B], [[0, BIG.slice(0, 3)], [1, BIG.slice(4, 10)]]));
  assert.equal(W.mrAt(T2, BIG[0]).nm, 'the Saltpeaks', 'B now holds more');
  const T3 = W.use(land([A, B], [[0, BIG.slice(0, 3)], [1, BIG.slice(4, 7)]]));
  assert.equal(W.mrAt(T3, BIG[0]).nm, 'the Grey Spine', 'as many: the name given first');
  A.n.mrn[0].t = 20; W.S.world = {};
  assert.equal(W.mrAt(T3, BIG[0]).nm, 'the Saltpeaks');
  assert.equal(W.mrName(BIG[2]), 'the Saltpeaks', 'mrName reads the last sync');
});

test('names follow the land, and hidden and computer nations, other regions and other ranges do not count', () => {
  const W = world(), A = nation('a', [entry(BIG[0], 'the Grey Spine')]);
  W.use(land([A], [[0, MID]]));
  assert.equal(W.mrAt(W.T, BIG[0]).nm, W.mrOf(BIG[0]).name0, 'A holds no hex of the range: its name waits');
  assert.equal(W.mrAt(W.T, BIG[0]).all.length, 0);
  W.use(land([A], [[0, [BIG[7]]]]));
  assert.equal(W.mrAt(W.T, BIG[0]).nm, 'the Grey Spine', 'one hex back, and the name is back');
  for (const more of [{ hid: true }, { npc: true }]) {
    const X = nation('x', [entry(BIG[1], 'the Hidden Teeth', 0)], more);
    W.use(land([X], [[0, BIG]]));
    assert.equal(W.mrAt(W.T, BIG[0]).nm, W.mrOf(BIG[0]).name0, JSON.stringify(more));
  }
  const F = nation('f', [entry(BIG[1], 'the Frost Wall', 0, 'frostmarch')]);
  W.use(land([F], [[0, BIG]]));
  assert.equal(W.mrAt(W.T, BIG[0]).nm, W.mrOf(BIG[0]).name0, 'a name given in another region');
  /* two names for one range in one record: the newer stands */
  const D = nation('d', [entry(BIG[1], 'the Old Name', 1), entry(BIG[9], 'the New Name', 2)]);
  W.use(land([D], [[0, [BIG[3]]]]));
  assert.equal(W.mrAt(W.T, BIG[0]).nm, 'the New Name');
  assert.equal(W.mrAt(W.T, BIG[0]).all.length, 1);
});

test('naming a range: only while holding a hex of it, saved in the record, with one line in the history', () => {
  const W = world(), A = nation('a', undefined);
  W.use(land([A], [[0, MID]]));
  assert.equal(W.mrRename(BIG[0], 'the Grey Spine'), false);
  assert.match(W.S.mrErr, /only while you hold a hex of it/);
  assert.equal(W.mrRename(at(5, 5), 'the Grey Spine'), false);
  assert.match(W.S.mrErr, /Only mountains/);
  W.use(land([A], [[0, [...MID, BIG[2]]]]));
  const old = W.mrOf(BIG[0]).name0;
  assert.equal(W.mrRename(BIG[2], '  The   Grey Spine '), true);
  assert.deepEqual(plain(W.S.nation.mrn), [{ r: 'meridian', c: BIG[2], n: 'the Grey Spine', t: W.S.nation.mrn[0].t }]);
  assert.deepEqual(plain(W.S.nation.log[0]), { t: W.S.nation.log[0].t, k: 'mrren', a: 'the Grey Spine', b: old });
  assert.equal(W.mrAt(W.T, BIG[14]).nm, 'the Grey Spine');
  assert.match(W.toasts.at(-1), /is now called the Grey Spine on every map in the Meridian Reach/);
  /* a rename within six hours keeps one line, from the map's name to the newest */
  assert.equal(W.mrRename(BIG[5], 'the Saltpeaks'), true);
  assert.equal(W.S.nation.mrn.length, 1, 'one name for one range');
  assert.deepEqual(plain(W.S.nation.log.map(l => [l.k, l.a, l.b])), [['mrren', 'the Saltpeaks', old]]);
  /* bringing back the map's name takes the line away */
  assert.equal(W.mrReset(BIG[5]), true);
  assert.equal(W.S.nation.mrn, undefined);
  assert.deepEqual(plain(W.S.nation.log), []);
  assert.equal(W.mrAt(W.T, BIG[0]).nm, old);
  /* a range with no name of its own */
  W.use(land([{ ...A, n: W.S.nation }], [[0, [TWO[0]]]]));
  assert.equal(W.mrRename(TWO[1], 'Mount Clemency'), true);
  assert.equal(W.S.nation.log[0].b, '');
  assert.equal(W.mrReset(TWO[1]), true);
  assert.equal(W.mrAt(W.T, TWO[0]).nm, '');
  assert.match(W.toasts.at(-1), /has no name again/);
});

test('a range\'s name is unique among the region\'s ranges, rivers, lakes and seas', () => {
  const W = world(), A = nation('a', undefined);
  W.use(land([A], [[0, [BIG[0], MID[0]]]]));
  const mid = W.mrOf(MID[0]).name0;
  assert.equal(W.mrNameProblem(BIG[0], mid.replace(/^the /, 'The ')), `${mid.replace(/^the /, 'The ')} is a mountain range in the Meridian Reach already.`);
  assert.equal(W.mrNameProblem(BIG[0], 'Ostra'), 'There is already a river called The Ostra in the Meridian Reach.');
  assert.equal(W.mrNameProblem(BIG[0], 'lake morrow'), 'Lake Morrow is a lake in the Meridian Reach already.');
  assert.equal(W.mrNameProblem(BIG[0], 'x'), 'Give it a name of at least two characters, with a letter in it.');
  assert.equal(W.mrNameProblem(BIG[0], W.mrOf(BIG[0]).name0), '', 'its own name is no clash');
  assert.equal(W.mrRename(BIG[0], mid), false);
  assert.equal(W.S.nation.mrn, undefined, 'nothing saved');
  /* and a lake or the sea may not take a range's name */
  assert.match(W.wnNameProblem(at(3, 21), mid), /is a mountain range in the Meridian Reach already/);
});

test('the record keeps clean names, at most twenty, one per hex', () => {
  const W = world(), [hook] = W.NORM_HOOKS.slice(-1), n = {};
  hook(n, { mrn: [entry(BIG[0], ' the <b>Grey</b>  Spine '), entry(BIG[0], 'the Saltpeaks', 2), { r: 'nowhere', c: 1, n: 'Xy' }, { r: 'meridian', c: -1, n: 'Xy' }, entry(MID[0], 'x'), null, 'junk'] });
  assert.deepEqual(plain(n.mrn), [entry(BIG[0], 'the Saltpeaks', 2)]);
  const m = {}; hook(m, { mrn: Array.from({ length: 25 }, (_, k) => entry(k, 'Name ' + k)) });
  assert.equal(m.mrn.length, 20); assert.equal(m.mrn[0].n, 'Name 5');
  const e = { mrn: [1] }; hook(e, {}); assert.equal('mrn' in e, false);
});

test('a hex in a named range is in that range, by the name on the map', () => {
  const W = world(), A = nation('a', [entry(BIG[0], 'the Grey Spine')]);
  W.mrSync(W.use(land([A], [[0, [BIG[0]]]])));
  assert.equal(W.placePhrase(BIG[6]), 'in the Grey Spine');
  assert.equal(W.placePhrase(MID[1]), 'in ' + W.mrOf(MID[0]).name0);
  assert.equal(W.mrIn('Mount Clemency'), 'on Mount Clemency');
  assert.equal(W.mrIn('the Saltpeaks'), 'in the Saltpeaks');
  assert.equal(W.placePhrase(ONE), 'in the mountains of Brask', 'a lone peak with no name');
  assert.equal(W.placePhrase(at(5, 5)), 'in the mountains of Brask', 'off the mountains, as before (placeIn is stubbed here)');
});

test('the Dispatch\'s weather puts the snow on the passes of the named range', () => {
  const W = world(), A = nation('a', [entry(BIG[0], 'the Grey Spine')]);
  W.use(land([A], [[0, [BIG[0]]]]));
  const all = Array.from({ length: N }, (_, i) => i);
  assert.equal(W.mrSnowOf(all, c => BIG.includes(c) || MID.includes(c)), ' of the Grey Spine', 'the range with most cold hexes');
  assert.equal(W.mrSnowOf(all, c => MID.includes(c)), ' of ' + W.mrOf(MID[0]).name0);
  assert.equal(W.mrSnowOf(all, c => c === ONE), '', 'a peak with no name');
});

test('the side panel: the name, who gave it, and naming it', () => {
  const W = world('b'), A = nation('a', [entry(BIG[0], 'the Grey Spine', 1)]), B = nation('b', [entry(BIG[9], 'the Saltpeaks', 3)]);
  W.use(land([A, B], [[0, BIG.slice(0, 5)], [1, BIG.slice(5, 7)]]));
  const h = W.mrPanel(W.T, BIG[8]);
  assert.match(h, /<p class="eyebrow">Mountain range<\/p>/);
  assert.match(h, /<b>The Grey Spine<\/b> · 15 hexes of mountains\./);
  assert.match(h, /Named by A\./);
  assert.match(h, /Also called the Saltpeaks in B and the [A-Z][a-z]+ [A-Z][a-z]+ on the old maps\./);
  assert.match(h, /You call it the Saltpeaks; the map shows the Grey Spine\. You hold 2 of its 15 hexes, so you may name it\./);
  assert.match(h, /data-act="mr-edit" data-c="\d+">Rename the range</);
  W.S.mrEdit = W.mrOf(BIG[0]).id;
  const f = W.mrPanel(W.T, BIG[8]);
  assert.match(f, /<form id="mr-form"/); assert.match(f, /value="the Saltpeaks"/); assert.match(f, /Bring back the Grey Spine/);
  W.S.mrEdit = null;
  W.use(land([A, B], [[0, BIG.slice(0, 5)], [1, [at(7, 2)]]]));
  assert.match(W.mrPanel(W.T, BIG[8]), /To name this range, hold a hex of it\./);
  assert.match(W.mrPanel(W.T, ONE), /<p class="eyebrow">Mountains<\/p><p class="rv-l mr-l">Mountains with no name yet · 1 hex\.<\/p>/);
});

test('the game uses the names: the Dispatch, the history, the region feed and the map', () => {
  /* the Dispatch writes a discovery under the name the site has now, given by its finder after the find */
  assert.match(src, /FX:dspClean\(l\.k==='disc'&&SITES\[\+l\.a\]\?siteName\(\+l\.a\):l\.fx,120\)/);
  assert.match(src, /\n  mrren:\{sec:'society',w:3,kick:'Mountains',go:'map',h:\['\{N\} names \{A1\}'/);
  assert.match(src, /case 'mrren':return l\.b\?`\$\{cap1\(l\.b\)\} was renamed \$\{l\.a\}\.`:`A mountain range was named \$\{l\.a\}\.`;/);
  assert.match(src, /if\(l\.k==='mrren'\)return l\.b\?/);
  assert.match(src, /mrren:\['land','Named a mountain range \{a\}'\]/);
  assert.match(src, /', snow on the high passes'\+mrSnowOf\(C\.cells,cold\)/);
  assert.match(src, /MAP_LAYERS\.push\(\{stage:'top',kinds:\['main','visit','found'\],draw:wnLabels\}\);[\s\S]*MAP_LAYERS\.push\(\{stage:'top',kinds:\['main','visit','found'\],draw:mrLabels\}\);/, 'range names give way to the sea\'s');
  /* the map's news no longer adds the finder's name to a story that already has it */
  assert.match(src, /named\.has\(k\)&&!String\(s\.b\|\|''\)\.includes\(named\.get\(k\)\)/);
});
