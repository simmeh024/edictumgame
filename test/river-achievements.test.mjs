// Achievements for river names (game/edictum.html, "achievements for river names", 16 November 2026): twelve
// achievements for naming rivers and streams, and the tally hook that counts every river and stream a nation named
// (rvr:/rvs:<region>:<key>) and every name it changed (rvre). The section runs here as written, with the game's own
// river-name code (rvKey, rvMost, rvStretch, rvSync) and tally (gbBump), over a small made-up network and land.
//   node --test test/river-achievements.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return html.slice(i, j); };
const line = k => { const i = html.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return html.slice(i, html.indexOf('\n', i)); };
const grab = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
const BLOCK = cut('/* ───────── achievements for river names', '/* drawing: Path2Ds per class');
const NAMES = cut('/* River names chosen by players.', '/* the name a river has at one of its bank hexes');
const HELP = [line('function c3CleanName('), line('const nameFold='), line('const cap1 = '), grab(/const TALLY_MAX=\d+/), grab(/function gbBump\(n,k,by,now\)\{.*\}/)].join('\n');
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const NOW = Date.UTC(2026, 10, 16, 12);

/* four rivers. The Ostra (a main river): five edges, edge j between hexes j and 10+j. An unnamed tributary of the
   Ostra: two edges, 20/30 and 21/31. The Kest, a stream feeding the tributary: 40/50 and 41/51. A nameless stream
   feeding the Ostra: 60/70. */
function world(me = 'a') {
  const A = {}, HOOKS = [], PEND = new Map();
  const ctx = vm.createContext({
    Math, Object, Set, Map, Array, Number, isFinite, JSON, String,
    S: { nation: null, world: {} }, REG: { id: 'meridian' }, REG_BY_ID: { meridian: {}, frostmarch: {} }, HIDN: { w: {} }, NORM_HOOKS: [], REGION: 'the Meridian Reach', FRONT_AT: Date.UTC(2026, 10, 19, 19, 41, 53),
    COMMIT_HOOKS: HOOKS, myId: () => me, PEND,
    achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
    achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), achYes: v => v ? 1 : 0,
    aT: (x, k) => (x.n.tly && x.n.tly[k]) || 0,
    aTP: (x, k) => ((x.n.tly && x.n.tly[k]) || 0) + (x.me ? PEND.get(k) || 0 : 0),
    aKeys: (x, pre) => Object.keys(x.n.tly || {}).filter(k => k.startsWith(pre) && x.n.tly[k] > 0).length
  });
  vm.runInContext(vars(HELP) + '\n' + vars(NAMES), ctx);
  const riv = (id, name, cls, parent, banks, key) => ({ id, name, name0: name, by: null, cls, parent, len: banks.length, bk: banks.flat(), cells: [...new Set(banks.map(b => b[0]).concat(banks.map(b => b[1])))], verts: [900 + id, key, 1000 + id] });
  ctx.RV = { list: [riv(0, 'the Ostra', 3, -1, [0, 1, 2, 3, 4].map(j => [j, 10 + j]), 101), riv(1, '', 2, 0, [[20, 30], [21, 31]], 102), riv(2, 'the Kest', 1, 1, [[40, 50], [41, 51]], 103), riv(3, '', 1, 0, [[60, 70]], 104)], lakes: [] };
  ctx.RV.byKey = new Map(ctx.RV.list.map(r => [ctx.rvKey(r), r.id]));
  ctx.rvTried = true; ctx.LAND = null;
  ctx.rvReady = () => ctx.rvTried ? ctx.RV : null;
  ctx.territory = () => ctx.LAND;
  vm.runInContext(vars(BLOCK), ctx);
  return { A, HOOKS, ctx, PEND };
}
/* land: owner[c] = index into list, -1 where nobody holds it */
function land(list, own) { const owner = new Int32Array(80).fill(-1); for (const [i, cells] of own) for (const c of cells) owner[c] = i; return { list, owner, byId: Object.fromEntries(list.map((x, i) => [x.id, i])) }; }
const entry = (v, n, r = 'meridian', t = 1) => ({ r, v, n, t });
const OSTRA = [0, 1, 2, 3, 4, 10, 11, 12, 13, 14];
const rec = (rvn, tly = {}) => ({ name: 'A', rvn, tly });
const val = (W, id, n, o = {}) => +W.A[id].f({ n, id: 'a', me: true, npc: false, now: NOW, m: {}, ...o }) || 0;
const earned = (W, id, n, o) => val(W, id, n, o) >= W.A[id].g;
const save = (W, n, old) => { W.HOOKS[0](n, old, NOW); return n; };

test('twelve achievements, with ids and names of their own, in Land & cities', () => {
  const W = world(), all = Object.values(W.A);
  assert.equal(all.length, 12);
  const per = {}; for (const a of all) per[a.t] = (per[a.t] || 0) + 1;
  assert.deepEqual(per, { b: 5, s: 4, g: 3 });
  assert.equal(all.reduce((s, a) => s + TIER[a.t], 0), 300);
  for (const a of all) {
    assert.equal(a.c, 'land', a.id);
    assert.match(a.id, /^rv-[a-z0-9-]+$/);
    assert.ok(a.d.length > 10 && /[.!]$/.test(a.d), a.id + ' has a sentence');
    assert.ok(Number.isInteger(a.g) && a.g >= 1, a.id + ' has a goal');
  }
  /* nowhere else in the game: not the ids, not the names (literal achDef calls, the passport's P() and tables) */
  const lit = [...html.matchAll(/achDef\('[a-z]+','([a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const pp = [...html.matchAll(/\bP\('([a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const tbl = [...html.matchAll(/\['([a-z]+-[a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const every = lit.concat(pp, tbl);
  for (const a of all) {
    assert.equal(every.filter(([i]) => i === a.id).length, 1, 'id once: ' + a.id);
    assert.equal(every.filter(([, n]) => n === a.n).length, 1, 'name once: ' + a.n);
    assert.equal(html.split(a.n).length - 1, 1, 'name nowhere else in the game: ' + a.n);
  }
  assert.ok(W.A['rv-again'].o.sec && W.A['rv-back'].o.sec, 'the two about changing your mind are secret');
  assert.equal(W.A['rv-shared'].o.mp, 1, 'sharing a river needs another player');
});

test('the tally counts each river and stream named once, by kind, and names changed', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  const n1 = save(W, rec([entry(101, 'the Silverflow', 'meridian', 5)]), rec([]));
  assert.equal(n1.tly['rvr:meridian:101'], 1, 'a main river counts as a river');
  assert.equal(n1.tlf['rvr:meridian:101'], 5, 'first counted when it was named');
  /* saved again, nothing new */
  save(W, n1, n1);
  assert.equal(n1.tly['rvr:meridian:101'], 1);
  assert.equal(n1.tly.rvre, undefined);
  /* renamed: a change, not another river */
  const n2 = save(W, rec([entry(101, 'the Goldrun')], { ...n1.tly }), n1);
  assert.equal(n2.tly['rvr:meridian:101'], 1);
  assert.equal(n2.tly.rvre, 1);
  /* a stream, and an entry for another region: that one waits (its network is not this one) */
  const n3 = save(W, rec([entry(101, 'the Goldrun'), entry(103, 'the Little Kest'), entry(104, 'the Brook', 'frostmarch')], { ...n2.tly }), n2);
  assert.equal(n3.tly['rvs:meridian:103'], 1);
  assert.equal(Object.keys(n3.tly).filter(k => k.includes('frostmarch')).length, 0);
  assert.equal(n3.tly.rvre, 1, 'adding names is not changing one');
  /* a name taken back stays counted */
  const n4 = save(W, rec([entry(103, 'the Little Kest')], { ...n3.tly }), n3);
  assert.equal(n4.tly['rvr:meridian:101'], 1);
  assert.equal(val(W, 'rv-riv1', n4), 1);
  assert.equal(val(W, 'rv-str1', n4), 1);
  assert.equal(val(W, 'rv-5', n4), 2);
});

test('names given before the network was ready are counted at a later save', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  W.ctx.rvTried = false;
  const n = rec([entry(102, 'the Ash'), entry(103, 'the Kestrel')]);
  save(W, n, n);
  assert.equal(Object.keys(n.tly).length, 0, 'no network, no kinds');
  assert.equal(val(W, 'rv-5', n), 0, 'nor any progress read from it');
  W.ctx.rvTried = true;
  save(W, n, n);
  assert.deepEqual(Object.keys(n.tly).sort(), ['rvr:meridian:102', 'rvs:meridian:103']);
  /* a record without a tally yet (tallyScan makes it first) is left alone */
  const bare = { name: 'A', rvn: [entry(101, 'the Ash')] };
  save(W, bare, null);
  assert.equal(bare.tly, undefined);
});

test('a full tally still counts the names on record', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  const full = {}; for (let i = 0; i < W.ctx.TALLY_MAX; i++) full['x' + i] = 1;
  const n = save(W, rec([entry(101, 'the Ash'), entry(102, 'the Birch'), entry(103, 'the Cedar'), entry(104, 'the Dogwood')], full), rec([]));
  assert.equal(Object.keys(n.tly).length, W.ctx.TALLY_MAX, 'nothing added');
  assert.equal(val(W, 'rv-5', n), 4);
  assert.equal(val(W, 'rv-riv1', n), 2);
  assert.equal(val(W, 'rv-str1', n), 2);
  assert.equal(val(W, 'rv-blank', n), 2, 'the tributary and the nameless stream had no name on the old maps');
});

test('15 different rivers and streams for Hydrographer Royal, from any region', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  const t = {}; for (let i = 0; i < 9; i++) t['rvs:frostmarch:' + i] = 1; for (let i = 0; i < 5; i++) t['rvr:frostmarch:' + (50 + i)] = 1;
  assert.equal(val(W, 'rv-15', rec([], t)), 14);
  assert.ok(!earned(W, 'rv-15', rec([], t)));
  assert.ok(earned(W, 'rv-15', rec([], { ...t, 'rvr:meridian:101': 1 })));
  assert.ok(earned(W, 'rv-5', rec([], t)));
});

test('holding most of a river you named puts your name on every map', () => {
  const W = world();
  const half = [0, 1, 2, 3, 4], most = [0, 1, 2, 3, 4, 10];
  W.ctx.LAND = land([{ id: 'a', n: {} }], [[0, half]]);
  const n = rec([entry(101, 'the Silverflow')]);
  assert.equal(val(W, 'rv-most', n), 0, 'half is not most');
  W.ctx.LAND = land([{ id: 'a', n: {} }], [[0, most]]);
  assert.equal(val(W, 'rv-most', n), 1);
  assert.equal(val(W, 'rv-main', n), 1, 'the Ostra is a main river');
  assert.equal(val(W, 'rv-most', rec([])), 0, 'not named, not yours');
  /* three at once */
  W.ctx.LAND = land([{ id: 'a', n: {} }], [[0, OSTRA.concat([20, 21, 30, 40, 41, 50])]]);
  const three = rec([entry(101, 'the Silverflow'), entry(102, 'the Ash'), entry(103, 'the Cedar')]);
  assert.equal(val(W, 'rv-most3', three), 3);
  assert.equal(val(W, 'rv-main', rec([entry(102, 'the Ash'), entry(103, 'the Cedar')])), 0, 'no main river among them');
  /* a hidden nation's names are not shown, so not on every map */
  W.ctx.LAND = land([{ id: 'a', n: {}, hid: true }], [[0, OSTRA]]);
  assert.equal(val(W, 'rv-most', n), 0);
  /* another nation's land: read for it */
  W.ctx.LAND = land([{ id: 'a', n: {} }, { id: 'b', n: {} }], [[1, OSTRA]]);
  assert.equal(val(W, 'rv-most', n), 0);
  assert.equal(val(W, 'rv-most', n, { id: 'b', me: false }), 1);
});

test('Confluence: a river or stream and one that flows into it', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  assert.ok(!earned(W, 'rv-trib', rec([entry(101, 'the Ash'), entry(103, 'the Cedar')])), 'the Kest feeds the tributary, not the Ostra');
  assert.ok(earned(W, 'rv-trib', rec([entry(102, 'the Ash'), entry(103, 'the Cedar')])));
  assert.ok(earned(W, 'rv-trib', rec([entry(104, 'the Brook'), entry(101, 'the Ash')])));
  assert.ok(!earned(W, 'rv-trib', rec([entry(104, 'the Brook'), entry(101, 'the Ash', 'frostmarch')])), 'names of another region are not read against this one');
});

test('By Any Other Name: a river another nation calls by a name of its own', () => {
  const W = world();
  const mine = rec([entry(101, 'the Silverflow')]);
  /* both hold a stretch of the Ostra: a holds edges 0-1, b edges 3-4 */
  const two = (bn, more = {}) => land([{ id: 'a', n: mine }, { id: 'b', n: { name: 'B', rvn: bn }, ...more }], [[0, [0, 1, 10, 11]], [1, [3, 4, 13, 14]]]);
  W.ctx.LAND = two([entry(101, 'the Goldrun')]);
  assert.ok(earned(W, 'rv-shared', mine));
  W.ctx.LAND = two([entry(101, 'the Silverflow')]);
  assert.ok(!earned(W, 'rv-shared', mine), 'the same name is not another');
  W.ctx.LAND = two([]);
  assert.ok(!earned(W, 'rv-shared', mine), 'unnamed by the other');
  W.ctx.LAND = two([entry(101, 'the Goldrun')], { npc: true });
  assert.ok(!earned(W, 'rv-shared', mine), 'computer nations name no rivers');
  /* the other nation's name, but none of a's land on the river: a's name does not show */
  W.ctx.LAND = land([{ id: 'a', n: mine }, { id: 'b', n: { name: 'B', rvn: [entry(101, 'the Goldrun')] } }], [[1, [3, 4, 13, 14]]]);
  assert.ok(!earned(W, 'rv-shared', mine));
});

test('changing your mind: a name changed, and an old name given back', () => {
  const W = world();
  W.ctx.LAND = land([{ id: 'a', n: {} }], []);
  assert.ok(!earned(W, 'rv-again', rec([])));
  assert.ok(earned(W, 'rv-again', rec([], { rvre: 1 })));
  assert.ok(!earned(W, 'rv-back', rec([])));
  W.PEND.set('rvback', 1);
  assert.ok(earned(W, 'rv-back', rec([])), 'counted before the save writes it');
  assert.ok(!earned(W, 'rv-back', rec([]), { me: false }), 'only your own pending count');
  assert.ok(earned(W, 'rv-back', rec([], { rvback: 1 }), { me: false }));
});

test('rvReset counts an old name given back, and only then, before its save', () => {
  const fn = cut('function rvReset(key){', '/* the river\'s other names');
  assert.match(fn, /if\(back\)achPend\('rvback'\);commit\(n\);/);
  /* the hook runs before the honours office looks: it is put in front of the commit hooks */
  assert.match(cut('/* ───────── achievements for river names', 'const aRv='), /^COMMIT_HOOKS\.unshift\(/m);
  assert.ok(html.indexOf('/* ───────── achievements for river names') > html.indexOf('function rvSync(T){'));
});
