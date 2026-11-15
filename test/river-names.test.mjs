// River names chosen by players (game/edictum.html, "River names chosen by players"): every nation holding a stretch of
// a river (its land on both banks, or on one with unclaimed land across) may give it its own name, shown on the
// stretches in its land; the nation holding most of the river (more than half its bank hexes) names it across the
// region, except where others named their stretches. Names are kept in each namer's record (n.rvn) and follow the
// land. Checked here with the game's own code cut from its source, over a small made-up network and land.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const NAMES = cut('/* River names chosen by players.', '/* the river with this key, if this nation holds a stretch');
const HELP = [line('function c3CleanName('), line('const nameFold='), line('const cap1 = ')].join('\n');
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const plain = v => JSON.parse(JSON.stringify(v));

/* three rivers. The Ostra: five edges, edge j between hexes j and 10+j (bank hexes 0-4 and 10-14). An unnamed
   tributary: two edges, between 20/30 and 21/31. The Kest: two edges, between 40/50 and 41/51. Lake Morrow. */
function world(me = 'a') {
  const ctx = vm.createContext({ S: { nation: null, world: {} }, REG: { id: 'meridian' }, REG_BY_ID: { meridian: {}, frostmarch: {} }, HIDN: { w: {} }, NORM_HOOKS: [], REGION: 'the Meridian Reach', myId: () => me });
  vm.runInContext(vars(HELP) + '\n' + vars(NAMES), ctx);
  const riv = (id, name, cls, banks, key) => ({ id, name, name0: name, by: null, cls, len: banks.length, bk: banks.flat(), cells: [...new Set(banks.map(b => b[0]).concat(banks.map(b => b[1])))], verts: [900 + id, key, 1000 + id] });
  ctx.RV = { list: [riv(0, 'the Ostra', 3, [0, 1, 2, 3, 4].map(j => [j, 10 + j]), 101), riv(1, '', 2, [[20, 30], [21, 31]], 102), riv(2, 'the Kest', 1, [[40, 50], [41, 51]], 103)], lakes: [{ id: 0, name: 'Lake Morrow' }] };
  ctx.RV.byKey = new Map(ctx.RV.list.map(r => [ctx.rvKey(r), r.id]));
  return ctx;
}
/* land: owner[c] = index into list, -1 where nobody holds it */
function land(list, own) { const owner = new Int32Array(64).fill(-1); for (const [i, cells] of own) for (const c of cells) owner[c] = i; return { list, owner, byId: Object.fromEntries(list.map((x, i) => [x.id, i])) }; }
const entry = (v, n, r = 'meridian') => ({ r, v, n, t: 1 });
const nation = (id, rvn, more = {}) => ({ id, n: { name: id.toUpperCase(), rvn }, ...more });
const OSTRA = [0, 1, 2, 3, 4, 10, 11, 12, 13, 14];

test('the key of a river is its lowest corner, one per river', () => {
  const W = world();
  assert.equal(W.rvKey(W.RV.list[0]), 101);
  assert.equal(W.RV.byKey.size, W.RV.list.length);
});

test('who holds a stretch: the land on both banks, or on one with unclaimed land across', () => {
  const W = world(), r = W.RV.list[0], T = land([nation('a'), nation('b')], [[0, [0, 10, 1, 13]], [1, [3, 14]]]);
  assert.equal(W.rvEdgeHolder(T, r, 0), 0, 'both banks');
  assert.equal(W.rvEdgeHolder(T, r, 1), 0, 'one bank, wild land across');
  assert.equal(W.rvEdgeHolder(T, r, 2), -1, 'nobody');
  assert.equal(W.rvEdgeHolder(T, r, 3), -1, 'a border: one nation on each bank');
  assert.equal(W.rvEdgeHolder(T, r, 4), 1);
  assert.equal(W.rvStretch(T, r, 0), 2);
  assert.equal(W.rvHeld(T, r, 0), 4);
  assert.equal(W.rvMost(T, r, 0), false);
});

test('a nation holding the whole river names it everywhere', () => {
  const W = world(), T = land([nation('a', [entry(101, 'the Silverflow')])], [[0, OSTRA]]), r = W.RV.list[0];
  W.rvSync(T);
  assert.equal(r.name, 'the Silverflow');
  assert.equal(r.by, 'a');
  assert.equal(r.sn, null, 'one name for the whole course');
  assert.deepEqual(plain(W.rvAt(r, 3)), { nm: 'the Silverflow', by: 'a' });
  assert.equal(W.RV.list[1].name, '', 'a river A does not name keeps its own name');
});

test('nations sharing a river each have their own name on their stretches; most of the river names the rest', () => {
  const W = world(), r = W.RV.list[0];
  /* A holds edges 0-2 (6 of the 10 bank hexes: most of it), B edges 3-4 */
  const A = nation('a', [entry(101, 'the Silverflow')]), B = nation('b', [entry(101, 'the Goldrun')]);
  W.rvSync(land([A, B], [[0, [0, 1, 2, 10, 11, 12]], [1, [3, 4, 13, 14]]]));
  assert.equal(r.name, 'the Silverflow', 'the nation holding most of it names the river');
  assert.equal(r.by, 'a');
  assert.deepEqual(plain(r.sn), ['the Silverflow', 'the Silverflow', 'the Silverflow', 'the Goldrun', 'the Goldrun']);
  assert.deepEqual(plain(W.rvAt(r, 13)), { nm: 'the Goldrun', by: 'b' });
  assert.deepEqual(plain(W.rvAt(r, 1)), { nm: 'the Silverflow', by: 'a' });
  assert.equal(W.rvLabelAt(r, 4), 'the Goldrun');
  assert.deepEqual(plain(W.rvParts(r, 6)), [{ a: 0, b: 3, nm: 'the Silverflow', by: 'a' }, { a: 3, b: 5, nm: 'the Goldrun', by: 'b' }]);
  assert.deepEqual(plain([...r.nm]), [['a', 'the Silverflow'], ['b', 'the Goldrun']]);
  /* without a name of its own, B's stretches carry the river's name */
  B.n = { name: 'B' }; W.S.world = {};
  W.rvSync(land([A, B], [[0, [0, 1, 2, 10, 11, 12]], [1, [3, 4, 13, 14]]]));
  assert.equal(r.sn, null);
  assert.equal(W.rvNameAt(r, 13), 'the Silverflow');
});

test('with nobody holding most of it, the map\'s name stays on the stretches nobody named', () => {
  const W = world(), r = W.RV.list[0];
  const A = nation('a', [entry(101, 'the Silverflow')]), B = nation('b', [entry(101, 'the Goldrun')]);
  W.rvSync(land([A, B], [[0, [0, 1, 10, 11]], [1, [3, 4, 13, 14]]]));
  assert.equal(r.name, 'the Ostra');
  assert.equal(r.by, null);
  assert.deepEqual(plain(r.sn), ['the Silverflow', 'the Silverflow', 'the Ostra', 'the Goldrun', 'the Goldrun']);
  assert.deepEqual(plain(W.rvParts(r, 6).map(p => p.nm)), ['the Silverflow', 'the Ostra', 'the Goldrun']);
  /* an unnamed river named on one stretch is still unnamed elsewhere */
  const U = W.RV.list[1], C = nation('c', [entry(102, 'the Brightrun')]);
  W.rvSync(land([C], [[0, [20, 30]]]));
  assert.equal(U.name, '');
  assert.deepEqual(plain(U.sn), ['the Brightrun', '']);
  assert.deepEqual(plain(W.rvParts(U, 3)), [{ a: 0, b: 1, nm: 'the Brightrun', by: 'c' }, { a: 1, b: 2, nm: '', by: null }]);
});

test('names follow the land: a nation without a stretch of it shows no name, and has it back with the land', () => {
  const W = world(), r = W.RV.list[0], A = nation('a', [entry(101, 'the Silverflow')]), B = nation('b');
  /* A holds only bank hexes across from B's: every edge is a border */
  const border = land([A, B], [[0, [0, 1, 2]], [1, [10, 11, 12]]]);
  W.rvSync(border);
  assert.equal(W.rvStretch(border, r, 0), 0);
  assert.equal(r.name, 'the Ostra');
  assert.equal(r.nm, null);
  W.rvSync(land([A, B], [[0, [0, 1, 2, 10]], [1, [11, 12]]]));
  assert.deepEqual(plain(r.sn), ['the Silverflow', 'the Ostra', 'the Ostra', 'the Ostra', 'the Ostra']);
});

test('names of other regions, computer nations and hidden nations are not shown', () => {
  const W = world();
  const A = nation('a', [entry(101, 'the Elsewhere', 'frostmarch')]);
  const N = nation('npc-x', [entry(102, 'the Npcwater')], { npc: true });
  const H = nation('h', [entry(103, 'the Rude')], { hid: true });
  W.rvSync(land([A, N, H], [[0, OSTRA], [1, [20, 21, 30, 31]], [2, [40, 41, 50, 51]]]));
  assert.deepEqual([...W.RV.list].map(r => r.name), ['the Ostra', '', 'the Kest']);
  assert.ok(W.RV.list.every(r => r.sn === null && r.nm === null));
});

test('the memo follows the land, the own record and the world', () => {
  const W = world(), A = nation('a'), T = land([A], [[0, [20, 21, 30, 31]]]);
  W.rvSync(T);
  assert.equal(W.RV.list[1].name, '');
  A.n = { name: 'A', rvn: [entry(102, 'the Brightrun')] }; W.S.nation = A.n;
  W.rvSync(T);
  assert.equal(W.RV.list[1].name, 'the Brightrun');
  assert.equal(W.RV.list[1].name0, '', 'the map\'s own name is kept apart');
});

test('what a nation\'s stretches show without its name: the map\'s when it holds most, else the river\'s', () => {
  const W = world('b'), r = W.RV.list[0];
  const A = nation('a', [entry(101, 'the Silverflow')]), B = nation('b', [entry(101, 'the Goldrun')]);
  const T = land([A, B], [[0, [0, 1, 2, 10, 11, 12]], [1, [3, 4, 13, 14]]]);
  W.rvSync(T);
  assert.deepEqual(plain(W.rvMineOf(T, r, 1)), { most: false, mine: 'the Goldrun', back: 'the Silverflow', st: 2 });
  const WA = world('a'); WA.rvSync(T);
  assert.deepEqual(plain(WA.rvMineOf(T, WA.RV.list[0], 0)), { most: true, mine: 'the Silverflow', back: 'the Ostra', st: 3 });
});

test('a name must have a letter and be new to the region\'s other rivers and lakes, old and local names included', () => {
  const W = world(), r = W.RV.list[1];
  assert.match(W.rvNameProblem(r, 'x'), /at least two characters/);
  assert.match(W.rvNameProblem(r, '42'), /with a letter/);
  assert.match(W.rvNameProblem(r, 'Ostra'), /already a river called The Ostra/);
  assert.match(W.rvNameProblem(r, 'the ÓSTRA'), /already a river called/, 'case, accents and “the” do not matter');
  assert.match(W.rvNameProblem(r, 'lake morrow'), /Lake Morrow is a lake/);
  /* a name another nation gave a stretch of another river is taken too */
  W.rvSync(land([nation('b', [entry(103, 'the Goldrun')])], [[0, [40, 50]]]));
  assert.match(W.rvNameProblem(r, 'Goldrun'), /already a river called The Goldrun/);
  assert.match(W.rvNameProblem(r, 'the Kest'), /already a river called The Kest/);
  assert.equal(W.rvNameProblem(r, 'the Silverflow'), '');
  /* nations sharing a river may agree on a name */
  assert.equal(W.rvNameProblem(W.RV.list[2], 'the Goldrun'), '');
  assert.equal(W.rvNameProblem(W.RV.list[0], 'the Ostra'), '', 'a river may take back its own name');
});

test('a typed name is cleaned and a leading The is written as the map writes it', () => {
  const W = world();
  assert.equal(W.rvTidy('  The   Silver​flow  '), 'the Silverflow');
  assert.equal(W.rvTidy('Miller’s Creek'), 'Miller’s Creek');
  assert.equal(W.rvTidy('<b>Theodora</b>'), 'bTheodora/b');
  assert.equal(W.rvTidy('x'.repeat(50)).length, W.RVN_LEN);
});

test('a run of renames is one line in the history', () => {
  const W = world(), now = 1e12, n = { log: [] };
  W.rvLog(n, 'the Silverflow', 'the Ostra', now);
  assert.deepEqual({ ...n.log[0] }, { t: now, k: 'rvren', a: 'the Silverflow', b: 'the Ostra' });
  W.rvLog(n, 'the Goldflow', 'the Silverflow', now + 60e3);
  assert.equal(n.log.length, 1);
  assert.equal(n.log[0].a, 'the Goldflow');
  W.rvLog(n, 'the Ostra', 'the Goldflow', now + 120e3);
  assert.equal(n.log.length, 0, 'back to where it started: no line at all');
  W.rvLog(n, 'the Brightrun', '', now);
  assert.equal(n.log.length, 1);
  W.rvLog(n, '', 'the Brightrun', now + 60e3);
  assert.equal(n.log.length, 0);
  /* lines written in between do not split the run */
  W.rvLog(n, 'the Brightrun', '', now);
  n.log.unshift({ t: now + 1, k: 'mile', a: '6 million' });
  W.rvLog(n, 'the Swiftrun', 'the Brightrun', now + 60e3);
  assert.deepEqual(n.log.map(l => l.k + ':' + (l.a || '')), ['rvren:the Swiftrun', 'mile:6 million'], 'the run moves to the top with its new name');
  W.rvLog(n, '', 'the Swiftrun', now + 120e3);
  assert.deepEqual(n.log.map(l => l.k), ['mile']);
  n.log.length = 0;
  /* a later rename is a new line */
  W.rvLog(n, 'the Brightrun', '', now);
  W.rvLog(n, 'the Swiftrun', 'the Brightrun', now + 7 * 3600e3);
  assert.equal(n.log.length, 2);
});

test('saved names are checked on load: region, key, name, one per river, at most RVN_MAX', () => {
  const W = world(), norm = d => { const n = {}; for (const h of W.NORM_HOOKS) h(n, d); return n; };
  assert.equal(norm({}).rvn, undefined);
  const n = norm({ rvn: [entry(101, 'the Silverflow'), entry(101, 'the Goldflow'), entry(5, 'x'), entry(6, 'Lost', 'atlantis'), { r: 'meridian', v: -1, n: 'Neg' }, { r: 'meridian', v: 1.5, n: 'Half' }, null, entry(7, '<i>Odd</i>')] });
  assert.deepEqual(plain(n.rvn.map(e => [e.v, e.n])), [[101, 'the Goldflow'], [7, 'iOdd/i']]);
  const many = norm({ rvn: Array.from({ length: 60 }, (_, i) => entry(i, 'River ' + i)) });
  assert.equal(many.rvn.length, W.RVN_MAX);
  assert.equal(many.rvn[0].v, 60 - W.RVN_MAX, 'the newest are kept');
});
