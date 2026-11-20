// The frontier ("the frontier" in game/edictum.html): every region's charted map — the one its players live
// on — is kept hex for hex in the north-west of a larger grid, and the new land lies east and south of it.
// Nothing a nation holds moves: a charted hex keeps its column and row, its stable key, its landmass name and
// the computer capitals standing on it, and map version 5 carries older records across (remapFront).
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mapKit} from '../scripts/bake-maps.mjs';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const ids = mapKit(src, 'meridian').ids;
// the whole map of every region takes minutes to make; these four cover the kinds of frontier there are
const SOME = ['meridian', 'greywater', 'coralreach', 'ironsteppe'];

// one function of the game, by name, as globe-wrap.test.mjs takes them
function fn(name) {
  let at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = src.indexOf('\nasync function ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
// one line of the game, from its start
function line(start) {
  const at = src.indexOf('\n' + start);
  assert.ok(at >= 0, start + ' is found');
  return src.slice(at + 1, src.indexOf('\n', at + 1));
}
// the regions a test reads, as REG_BY_ID holds them
const REGS = Object.fromEntries(['greywater', 'meridian', 'terra'].map(id => [id, mapKit(src, id).REG]));
// remapFront as the page of region `id` runs it (FZ: the frontier build's site indices as this list has them, SITE_FZ)
function remapper(id, FZ = null) {
  const kit = mapKit(src, id);
  return new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER', 'REG', 'REG_BY_ID', 'FRONT_AT', 'SITE_FZ',
    line('const recReg=') + '\n' + fn('frontCell') + fn('remapFront') + fn('remapLate') + '\nreturn remapFront;')(
    kit.CHART_COLS, kit.CHART_ROWS, kit.MAP_COLS, 5, kit.REG, REGS, Date.UTC(2026, 10, 19, 19, 41, 53), FZ);
}

test('every region that grows has land names for its frontier, and Terra does not grow', () => {
  const grow = [], still = [];
  for (const id of ids) {
    const kit = mapKit(src, id), R = kit.REG, has = Array.isArray(R.frontier) && R.frontier.length > 0;
    (has ? grow : still).push(id);
    if (has) {
      assert.ok(R.frontier.length >= 8, id + ' has names to spare');
      assert.equal(new Set(R.frontier).size, R.frontier.length, id + ' names no land twice');
      for (const nm of R.frontier) assert.match(nm, /^[^\s].{1,38}[^\s]$/);
      assert.ok(kit.MAP_COLS > kit.CHART_COLS && kit.MAP_ROWS > kit.CHART_ROWS, id + ' grows both ways');
      assert.ok(kit.MAP_COLS * kit.MAP_ROWS > kit.CHART_COLS * kit.CHART_ROWS * 1.3, id + ' grows by about the share set');
    } else {
      assert.equal(kit.MAP_COLS, kit.CHART_COLS, id + ' keeps its grid');
      assert.equal(kit.MAP_ROWS, kit.CHART_ROWS, id + ' keeps its grid');
    }
  }
  assert.deepEqual(still, ['terra'], 'only Terra, which is not open yet, stays as it was');
  assert.ok(grow.length >= 26);
});

test('no two regions draw the same frontier', () => {
  const seen = new Set();
  for (const id of ids.filter(x => x !== 'terra')) {
    const kit = mapKit(src, id);
    seen.add(kit.MAP_COLS / kit.CHART_COLS > kit.MAP_ROWS / kit.CHART_ROWS ? 'east' : 'south');
  }
  assert.equal(seen.size, 2, 'some regions grow more to the east, others more to the south');
});

for (const id of SOME) test(`${id}: the charted map is kept hex for hex`, () => {
  const kit = mapKit(src, id), chart = kit.chartOf(), map = kit.generate();
  const { CHART_COLS: oc, CHART_ROWS: or, MAP_COLS: cols, MAP_ROWS: rows } = kit;
  assert.ok(cols > oc && rows > or);
  assert.equal(map.T.length, cols * rows);
  let land = 0, fresh = 0;
  for (let r = 0; r < or; r++) for (let c = 0; c < oc; c++) {
    const j = r * oc + c, i = r * cols + c;
    assert.equal(map.T[i], chart.T[j], `hex ${c},${r} is the hex it was`);
    assert.equal(map.chart[i], j, `hex ${c},${r} knows the index it had`);
  }
  for (let i = 0; i < map.T.length; i++) if (map.T[i] >= 2) { land++; if (map.chart[i] < 0) fresh++; }
  // the new land is worth having, and it is all named
  assert.ok(fresh > 2000, 'the frontier is land, not a sliver');
  assert.ok(land > 30000);
  const young = map.comps.filter(c => map.chart[c.cells[0]] < 0 && c.size >= 6);
  assert.ok(young.length >= 1);
  for (const c of young) assert.ok(c.name, 'every new land of six hexes or more has a name');
  assert.equal(new Set(young.map(c => c.name)).size, young.length);
  // and no new land rivals the one the region already had
  const own = chart.comps[0].size;
  for (const c of young) assert.ok(c.size <= own, `${c.name} does not out-do the region's own land`);
  // the charted landmasses keep their names
  for (const c of map.comps) {
    const ci = map.chart[c.cells[0]];
    if (ci < 0) continue;
    const was = chart.comp[ci];
    assert.equal(c.name, was >= 0 ? chart.comps[was].name : '', 'a charted land keeps its name');
  }
  // every computer nation stands on the hex it stood on, in the same column and row
  for (const k of Object.keys(chart.npcLoc)) {
    const j = chart.npcLoc[k];
    assert.equal(map.npcLoc[k], Math.floor(j / oc) * cols + (j % oc), k + ' has not moved');
    assert.equal(map.T[map.npcLoc[k]], chart.T[j]);
  }
  // the globe wraps east to west: no land may reach round the seam to the charted coast
  for (let r = 0; r < rows; r++) {
    if (map.T[r * cols + cols - 1] < 2) continue;
    for (const rr of [r - 1, r, r + 1]) if (rr >= 0 && rr < rows) assert.ok(map.T[rr * cols] < 2, 'nothing touches across the seam');
  }
});

test('a hex keeps the key its resources and rivers were made from', () => {
  const kit = mapKit(src, 'greywater'), map = kit.generate();
  const cellKey = new Function('MAP', 'REG', src.match(/^function cellKey\(i\)\{[^\n]+/m)[0] + '\nreturn cellKey;')(map, kit.REG);
  assert.equal(cellKey(0), 'greywater:0');
  // a charted hex well into the map answers with the index it had, not the one it has
  const c = 100, r = 50, had = r * kit.CHART_COLS + c, has = r * kit.MAP_COLS + c;
  assert.notEqual(had, has);
  assert.equal(cellKey(has), 'greywater:' + had);
  // and a hex of the new land answers with its own
  const far = 10 * kit.MAP_COLS + kit.MAP_COLS - 2;
  assert.equal(map.chart[far], -1);
  assert.equal(cellKey(far), 'greywater:' + far);
});

test('a nation saved before the frontier keeps its column and row (map version 5)', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS;
  const run = remapper('greywater');
  const was = { cv: 4, reg: 'greywater', loc: { c: 12, r: 7, m: 4 }, claims: [{ c: 7 * oc + 12, t: 1 }, { c: 0, t: 2 }],
    cities: [{ c: 7 * oc + 12, nm: 'Home' }], conq: [{ c: 3 * oc + 4, t: 9 }], intel: [{ c: 2 * oc + 1, s: 'x' }] };
  const now = run(was);
  assert.equal(now.cv, 5);
  assert.deepEqual(now.loc, { c: 12, r: 7, m: 5 }, 'the capital is where it was');
  assert.deepEqual(now.claims.map(e => e.c), [7 * cols + 12, 0], 'every claim moves with its row');
  assert.equal(now.cities[0].c, 7 * cols + 12);
  assert.equal(now.cities[0].nm, 'Home');
  assert.equal(now.conq[0].c, 3 * cols + 4);
  assert.equal(now.intel[0].c, 2 * cols + 1);
  assert.equal(was.claims[0].c, 7 * oc + 12, 'the record it was given is left alone');
  // a record already on this map, or far older, is not touched
  const fresh = { cv: 5, claims: [{ c: 5, t: 1 }] };
  assert.equal(run(fresh), fresh);
  const ancient = { cv: 2, claims: [{ c: 5, t: 1 }] };
  assert.equal(run(ancient), ancient);
});

/* What the frontier first forgot (19 Nov 2026): a hex is kept by number in more places than a nation's claims —
   its roads, the day's survey caches, a dormant neighbour's old capital, and the border agreements a region
   shares, which live on the server and know nothing of maps. All of them move with frontCell now. */
test('a nation keeps its roads, its caches and its dormant neighbours', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS;
  const run = remapper('greywater');
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const was = {
    cv: 4, reg: 'greywater',
    infra: [{ id: 'r1', k: 'road', a: at(4, 9), b: at(6, 9), path: [at(4, 9), at(5, 9), at(6, 9)], t: 1, d: 2, reg: 'greywater' }],
    svc: { d: 12, c: [[at(8, 3), 'iron', 40, 0], [at(9, 3), 'food', 10, 1]] },
    dorm: [{ a: 1, b: 2, c: at(2, 2) }, { a: 3, b: 4 }],
  };
  const now = run(was);
  assert.deepEqual(now.infra[0].path, [to(4, 9), to(5, 9), to(6, 9)], 'every hex of the way moves');
  assert.equal(now.infra[0].a, to(4, 9));
  assert.equal(now.infra[0].b, to(6, 9));
  assert.equal(now.infra[0].k, 'road', 'and the rest of the route is left as it was');
  assert.deepEqual(now.svc.c, [[to(8, 3), 'iron', 40, 0], [to(9, 3), 'food', 10, 1]]);
  assert.equal(now.svc.d, 12);
  assert.deepEqual(now.dorm, [{ a: 1, b: 2, c: to(2, 2) }, { a: 3, b: 4 }]);
  assert.equal(was.infra[0].path[0], at(4, 9), 'the record it was given is left alone');
});

test('a border agreement drawn before the frontier is read against the wider rows', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS;
  const bdNorm = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER', 'MAP', 'BD_RULES', 'FRONT_AT',
    fn('frontCell') + fn('bdNorm') + '\nreturn bdNorm;')(oc, kit.CHART_ROWS, cols, 5,
      { N: cols * kit.MAP_ROWS }, { maxP: 4, maxCells: 1500 }, Date.UTC(2026, 10, 19, 19, 41, 53));
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const doc = t => ({ reg: 'greywater', p: ['a', 'b'], st: 'active', t,
    s: { a: [at(10, 5), at(11, 5)], b: [at(12, 5)] }, buf: [at(13, 5)],
    sw: [{ id: 's1', g: at(10, 5), k: at(12, 5) }] });
  const older = bdNorm('x', doc(Date.UTC(2026, 10, 18)));
  assert.deepEqual(older.s.a, [to(10, 5), to(11, 5)], 'each side moves with the rows');
  assert.deepEqual(older.s.b, [to(12, 5)]);
  assert.deepEqual(older.buf, [to(13, 5)]);
  assert.equal(older.sw[0].g, to(10, 5), 'and so do the hexes being swapped');
  assert.equal(older.sw[0].k, to(12, 5));
  const newer = bdNorm('y', doc(Date.UTC(2026, 10, 20)));
  assert.deepEqual(newer.s.a, [at(10, 5), at(11, 5)], 'one drawn since is already on this map');
  assert.deepEqual(newer.buf, [at(13, 5)]);
  const stamped = bdNorm('z', { ...doc(Date.UTC(2026, 10, 18)), cv: 5 });
  assert.deepEqual(stamped.s.a, [at(10, 5), at(11, 5)], 'and one that says which map it is drawn on is believed');
});

/* The stripes that stayed (19 Nov 2026): a joint venture's road, railway or bridge is kept by number on the server too
   (ventures/{id}), and the first fix did not reach it. Read against the wider rows, each step north or south of an old
   route became a leap across most of a row; the venture counted as cut and was drawn in red dashes, wall to wall. */
test('a joint venture filed before the frontier keeps its road', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, or = kit.CHART_ROWS, cols = kit.MAP_COLS, rows = kit.MAP_ROWS;
  const G = new Function('HEX_W', 'HEX_R', fn('genGeom') + '\nreturn genGeom;')(Math.sqrt(3) * 10, 10)(cols, rows);
  const FRONT = Date.UTC(2026, 10, 19, 19, 41, 53);
  const jvNorm = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP', 'JV_RULES', 'FRONT_AT',
    fn('frontCell') + fn('jvAdj') + fn('jvNorm') + '\nreturn jvNorm;')(oc, or, cols, G,
      { kinds: ['road', 'rail', 'bridge'], path: 40 }, FRONT);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  // a road that turns south: (20,10) (21,10) then down the rows, as the game's own neighbours run (odd rows sit right)
  const hexes = [[20, 10], [21, 10], [21, 11], [21, 12], [22, 12]];
  const doc = (t, P) => ({ k: 'road', p: ['a', 'b'], a: 'a', b: 'b', ca: P[0], cb: P[P.length - 1], path: P, st: 'active', t, d: t + 1 });
  const chain = P => P.every((x, i) => !i || [0, 1, 2, 3, 4, 5].some(d => G.nbr[P[i - 1] * 6 + d] === x));
  assert.ok(chain(hexes.map(([c, r]) => to(c, r))), 'the road is a chain of neighbours on this map');
  assert.ok(!chain(hexes.map(([c, r]) => at(c, r))), 'and its charted numbers are not one here');

  const older = jvNorm('v1', doc(Date.UTC(2026, 10, 17), hexes.map(([c, r]) => at(c, r))));
  assert.deepEqual(older.path, hexes.map(([c, r]) => to(c, r)), 'every hex of the way moves with its row');
  assert.equal(older.ca, to(20, 10), 'and so do the cities at its ends');
  assert.equal(older.cb, to(22, 12));
  // a tab still on the charted map filed it after the frontier was live: no chain as read, one once moved
  const late = jvNorm('v2', doc(FRONT + 3600e3, hexes.map(([c, r]) => at(c, r))));
  assert.deepEqual(late.path, hexes.map(([c, r]) => to(c, r)), 'a late filing from an old tab moves too');
  // one found on this map is believed
  const newer = jvNorm('v3', doc(FRONT + 3600e3, hexes.map(([c, r]) => to(c, r))));
  assert.deepEqual(newer.path, hexes.map(([c, r]) => to(c, r)), 'one filed since is already on this map');
  assert.equal(newer.ca, to(20, 10));
  // a bridge filed before: its two banks move
  const br = jvNorm('v4', { ...doc(Date.UTC(2026, 10, 17), [at(30, 20), at(30, 21)]), k: 'bridge' });
  assert.deepEqual(br.path, [to(30, 20), to(30, 21)]);

  // and a proposal paid for but not yet filed moves with the nation's record, so it is filed on this map
  const run = remapper('greywater');
  const rec = run({ cv: 4, reg: 'greywater', jvp: [{ id: 'abcdef', w: 'a', k: 'road', to: 'b', ca: at(20, 10), cb: at(22, 12),
    path: hexes.map(([c, r]) => at(c, r)), t: 5 }, { v: 'a_abcdef', w: 'b', k: 'road', t: 6 }] });
  assert.deepEqual(rec.jvp[0].path, hexes.map(([c, r]) => to(c, r)));
  assert.equal(rec.jvp[0].ca, to(20, 10));
  assert.equal(rec.jvp[0].cb, to(22, 12));
  assert.deepEqual(rec.jvp[1], { v: 'a_abcdef', w: 'b', k: 'road', t: 6 }, 'the accepting side holds no hexes');
});

test('the divisions keep their seats', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS;
  const run = remapper('greywater');
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const now = run({ cv: 4, reg: 'greywater', prov: { on: 1, term: 'p', q: 3, r: 'greywater',
    l: [{ id: 1, nm: 'North', s: at(5, 5), m: [[at(6, 5), 2]] }, { id: 2, nm: 'Dormant', s: -1 }],
    x: { [at(7, 7)]: 1, [at(8, 7)]: 2 } } });
  assert.equal(now.prov.l[0].s, to(5, 5), 'the seat moves with its row');
  assert.deepEqual(now.prov.l[0].m, [[to(6, 5), 2]], 'and so does a seat taken in by merging');
  assert.equal(now.prov.l[0].nm, 'North');
  assert.equal(now.prov.l[1].s, -1, 'a division with no seat still has none');
  assert.deepEqual(now.prov.x, { [to(7, 7)]: 1, [to(8, 7)]: 2 }, 'and every hex moved by hand');
  assert.equal(now.prov.on, 1);
});

/* What the frontier still forgot (19 Nov 2026, second pass): the rivers a nation named, the expansion plan saved on the
   map page and the bridges thrown over a river in a war are kept by hex too. */
test('a nation keeps its river names, its saved plan and its war bridges', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS, run = remapper('greywater');
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const was = { cv: 4, reg: 'greywater',
    rvn: [{ r: 'greywater', v: 2 * at(12, 7) + 1, n: 'Silverrun', t: 1 }, { r: 'greywater', v: 2 * at(40, 30), n: 'Tallow', t: 2 },
      { r: 'greywater', v: 2 * at(3, 0) + 1, n: 'Top', t: 3 }, { r: 'meridian', v: 2 * at(12, 7), n: 'Left behind', t: 4 }],
    mapPlan: { reg: 'greywater', cells: [at(5, 5), at(6, 5), at(5, 6)] },
    brg: [{ c: at(9, 9), r: 'greywater', s: 10, d: 20 }, { c: at(9, 9), r: 'meridian', s: 10, d: 20, o: 1 }] };
  const now = run(was);
  // a river is known by a corner, 2 × hex + (0 top, 1 bottom): the hex moves, the corner stays the same one of it
  assert.deepEqual(now.rvn.map(e => e.v), [2 * to(12, 7) + 1, 2 * to(40, 30), 2 * at(3, 0) + 1, 2 * at(12, 7)]);
  assert.equal(now.rvn[0].n, 'Silverrun', 'and the name is the one it had');
  assert.equal(now.rvn[3].v, was.rvn[3].v, "a name given in another region keeps that region's number");
  assert.deepEqual(now.mapPlan, { reg: 'greywater', cells: [to(5, 5), to(6, 5), to(5, 6)] });
  assert.deepEqual(now.brg, [{ c: to(9, 9), r: 'greywater', s: 10, d: 20 }, { c: at(9, 9), r: 'meridian', s: 10, d: 20, o: 1 }]);
  assert.equal(was.rvn[0].v, 2 * at(12, 7) + 1, 'the record it was given is left alone');
  // a plan saved in another region is not this page's to move
  const other = run({ cv: 4, reg: 'greywater', mapPlan: { reg: 'meridian', cells: [at(5, 5)] } });
  assert.deepEqual(other.mapPlan.cells, [at(5, 5)]);
});

/* A record is moved with its own region's rows only. A cv 4 record of another region read here (a new device opens
   FIRST_REG; the admins' scan of every region) was moved with this page's width, marked version 5 and kept so by
   MAP_KEEP: its own page then never moved it, and its land lay on the wrong hexes for good. */
test('a record of another region is left on the charted map for its own page', () => {
  const grey = remapper('greywater'), mer = remapper('meridian');
  const mk = mapKit(src, 'meridian'), gk = mapKit(src, 'greywater');
  assert.notEqual(mk.MAP_COLS, gk.MAP_COLS, 'the two regions have rows of different widths');
  const at = (c, r) => r * mk.CHART_COLS + c, to = (c, r) => r * mk.MAP_COLS + c;
  const rec = { cv: 4, reg: 'meridian', loc: { c: 12, r: 7, m: 4 }, claims: [{ c: at(12, 7), t: 1 }], conq: [{ c: at(13, 7), t: 2 }] };
  assert.equal(grey(rec), rec, "on Greywater's page a Meridian record is not touched");
  const home = mer(rec);
  assert.equal(home.cv, 5, 'on its own page it moves');
  assert.deepEqual(home.claims.map(e => e.c), [to(12, 7)]);
  assert.deepEqual(home.loc, { c: 12, r: 7, m: 5 });
  // a record that names no region is Meridian's (the region hook's default), as it always was
  const bare = { cv: 4, claims: [{ c: at(12, 7), t: 1 }] };
  assert.equal(grey(bare), bare);
  assert.deepEqual(mer(bare).claims.map(e => e.c), [to(12, 7)]);
  // and one that names a region nobody knows is treated the same way
  assert.equal(grey({ ...bare, reg: 'atlantis' }).cv, 4);
});

/* the whole of normalize, with remapFront as it is and a stand-in for the rest: a record of another region comes
   through on version 4, its land on the charted numbers, so its own page still moves it */
test("normalize keeps another region's record on the charted map, and moves its own", () => {
  const gk = mapKit(src, 'greywater'), mk = mapKit(src, 'meridian');
  const i = src.indexOf('const FWD_MAX='), j = src.indexOf('\n', src.indexOf('const MAP_KEEP=')) + 1;
  const ctx = vm.createContext({ MAP_VER: 5, window: {}, remapLegacy: d => d, remapFront: remapper('greywater'), JSON, Proxy, Reflect, Set, REG: gk.REG, REG_BY_ID: REGS,
    // the real normalizeR2 marks every record version 5 and keeps land only from a record already on it
    normalizeR2: d => ({ name: d.name, reg: d.reg, cv: 5, claims: d.cv === 5 ? d.claims : [], conq: d.cv === 5 ? d.conq : [] }) });
  vm.runInContext(src.slice(i, j).replace(/\bconst (FWD_MAX|MAP_KEEP)/g, 'var $1'), ctx);
  const mat = (c, r) => r * mk.CHART_COLS + c, gat = (c, r) => r * gk.CHART_COLS + c, gto = (c, r) => r * gk.MAP_COLS + c;
  const away = ctx.normalize({ name: 'Away', reg: 'meridian', cv: 4, claims: [{ c: mat(30, 20), t: 1 }], conq: [{ c: mat(31, 20), t: 2 }] });
  assert.equal(away.cv, 4, "another region's record stays on version 4");
  assert.deepEqual(away.claims.map(e => e.c), [mat(30, 20)], 'with its land as it was');
  assert.deepEqual(away.conq.map(e => e.c), [mat(31, 20)]);
  const home = ctx.normalize({ name: 'Home', reg: 'greywater', cv: 4, claims: [{ c: gat(30, 20), t: 1 }] });
  assert.equal(home.cv, 5);
  assert.deepEqual(home.claims.map(e => e.c), [gto(30, 20)], "and this region's own record moves");
});

// regGrid as a page builds it, with the game's constants
function regGridFn() {
  assert.equal(line('const REGION_LAND='), 'const REGION_LAND=30000,MAP_ASPECT=226/142;', "the constants stood in are the game's");
  assert.equal(line('const FRONT_GROW='), 'const FRONT_GROW=1.42;');
  return new Function('hash', 'REGION_LAND', 'MAP_ASPECT', 'FRONT_GROW', fn('regGrid') + '\nreturn regGrid;')(
    new Function(fn('hash') + '\nreturn hash;')(), 30000, 226 / 142, 1.42);
}

test("every region's grids can be worked out on any page", () => {
  const regGrid = regGridFn();
  for (const id of ids) {
    const kit = mapKit(src, id);
    assert.deepEqual(regGrid(kit.REG), { oc: kit.CHART_COLS, or: kit.CHART_ROWS, cols: kit.MAP_COLS, rows: kit.MAP_ROWS }, id);
  }
});

/* The conquest seals (19 Nov 2026). The referee signs the attacker, the hex's number, the time, the ally and the
   defender. remapFront moved every conquest's number with its row, so each one sealed between REF_EPOCH and the
   frontier outside the top row failed its check: the hex went back to the defender and the conqueror was listed for
   forged seals. Real seals here, made and checked with the browser's own ECDSA, read by the game's refVerify. */
async function sealKit(page) {
  const kit = mapKit(src, page), FRONT = Date.UTC(2026, 10, 19, 19, 41, 53);
  assert.equal(line('const FRONT_AT='), 'const FRONT_AT=Date.UTC(2026,10,19,19,41,53);');
  const g = new Function('window', 'REG', 'REG_BY_ID', 'FRONT_AT', 'regGrid', [line('const SEAL2_AT='), line('const refV2='), line('const refText='),
    line('const unb64='), fn('refCell'), fn('refVerify'), 'return {refText,refCell,refVerify,SEAL2_AT};'].join('\n'))({}, kit.REG, REGS, FRONT, regGridFn());
  const { subtle } = globalThis.crypto, key = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  // as the referee signs (functions/index.js): IEEE P1363, base64url
  const sign = async text => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(text))).toString('base64url');
  const seal = async (src, e) => { const s = await sign(g.refText(src, e)); return e.t >= g.SEAL2_AT ? { ...e, s2: s } : { ...e, s }; };
  return { ...g, kit, key: key.publicKey, seal, FRONT };
}

test('a conquest sealed before the frontier still checks out after its record moved', async () => {
  const k = await sealKit('greywater'), oc = k.kit.CHART_COLS, cols = k.kit.MAP_COLS, run = remapper('greywater');
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c, me = 'uidConqueror';
  // sealed on the charted map: one with the second seal (since 10 Nov), one with the first (29 Oct to 10 Nov), one in the top row
  const e2 = await k.seal(me, { c: at(40, 30), t: Date.UTC(2026, 10, 15), w: '', d: 'uidDefender' });
  const e1 = await k.seal(me, { c: at(41, 30), t: Date.UTC(2026, 10, 2), w: 'uidAlly' });
  const e0 = await k.seal(me, { c: at(42, 0), t: Date.UTC(2026, 10, 16), w: '', d: 'uidDefender' });
  const rec = run({ cv: 4, reg: 'greywater', conq: [e2, e1, e0] });
  assert.deepEqual(rec.conq.map(e => e.c), [to(40, 30), to(41, 30), at(42, 0)], 'the record moved its conquests with their rows');
  // read as the number the hex has now, the seal fails: that was the fault
  const { subtle } = globalThis.crypto, raw = e => subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.key,
    Buffer.from(e.s2 || e.s, 'base64url'), new TextEncoder().encode(k.refText(me, e)));
  assert.equal(await raw(rec.conq[0]), false, 'the seal is not over the number the hex has now');
  for (const e of rec.conq) assert.equal(await k.refVerify(k.key, me, e, 'greywater', 5), true, 'every one checks out as it was sealed');
  assert.equal(k.refCell(rec.conq[0], 'greywater', 5), at(40, 30), 'against the number its hex had on the charted map');
  assert.equal(k.refCell(rec.conq[2], 'greywater', 5), at(42, 0), "the top row's numbers never changed");
  // another conqueror's name on it does not
  assert.equal(await k.refVerify(k.key, 'uidSomeoneElse', rec.conq[0], 'greywater', 5), false);
});

test('no seal vouches for two hexes', async () => {
  const k = await sealKit('greywater'), oc = k.kit.CHART_COLS, cols = k.kit.MAP_COLS, or = k.kit.CHART_ROWS;
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c, me = 'uidConqueror', fc = j => Math.floor(j / oc) * cols + j % oc;
  // a seal from before the frontier, over the charted (40,30), put on the hex that has that number now
  const old = await k.seal(me, { c: at(40, 30), t: Date.UTC(2026, 10, 15), w: '', d: 'uidDefender' });
  assert.notEqual(at(40, 30), to(40, 30));
  assert.equal(await k.refVerify(k.key, me, old, 'greywater', 5), false, 'an old seal does not count for the hex that has its old number now');
  // a seal from since the frontier, over (40,30) as numbered now, put on the hex its number would move to
  const late = await k.seal(me, { c: to(40, 30), t: k.FRONT + 3600e3, w: '', d: 'uidDefender' });
  assert.equal(await k.refVerify(k.key, me, late, 'greywater', 5), true, 'a seal from since checks out on its own hex');
  assert.notEqual(fc(to(40, 30)), to(40, 30));
  assert.equal(await k.refVerify(k.key, me, { ...late, c: fc(to(40, 30)) }, 'greywater', 5), false, 'and on no other');
  // so a tab still on the charted map that conquered after the frontier went live sealed the charted number, and once
  // moved its conquest does not check out: the time is sealed, and reading it both ways would let a seal travel
  const stale = await k.seal(me, { c: at(40, 30), t: k.FRONT + 60e3, w: '', d: 'uidDefender' });
  assert.equal(await k.refVerify(k.key, me, { ...stale, c: to(40, 30) }, 'greywater', 5), false);
  // nothing of the frontier was there to conquer before it
  const far = { c: to(oc + 5, 10), t: Date.UTC(2026, 10, 15), w: '', d: 'uidDefender', s2: old.s2 };
  assert.equal(k.refCell(far, 'greywater', 5), -1);
  assert.equal(k.refCell({ ...far, c: to(5, or + 2) }, 'greywater', 5), -1);
  assert.equal(await k.refVerify(k.key, me, far, 'greywater', 5), false);
});

test("another region's seals are read against that region's rows", async () => {
  // the admins' scan of every region reads Meridian's records on Greywater's page
  const k = await sealKit('greywater'), mk = mapKit(src, 'meridian'), me = 'uidMeridian';
  const at = (c, r) => r * mk.CHART_COLS + c, to = (c, r) => r * mk.MAP_COLS + c;
  const e = await k.seal(me, { c: at(50, 40), t: Date.UTC(2026, 10, 12), w: '', d: 'uidDefender' });
  // still on version 4 (not yet loaded on its own page since the frontier): the number is the one sealed
  assert.equal(await k.refVerify(k.key, me, e, 'meridian', 4), true);
  // moved by its own page: read with Meridian's rows, not Greywater's
  const moved = { ...e, c: to(50, 40) };
  assert.equal(k.refCell(moved, 'meridian', 5), at(50, 40));
  assert.equal(await k.refVerify(k.key, me, moved, 'meridian', 5), true);
  // a region that did not grow keeps every number
  assert.equal(k.refCell({ c: 1234, t: Date.UTC(2026, 10, 12) }, 'terra', 5), 1234);
});

/* The races (19 Nov 2026): a claim's stamp is written once, under the hex's number at the time, so a claim from before
   the frontier is looked up under the number its hex had on the charted map. */
test('a claim from before the frontier is raced by the stamp it was given', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS, FRONT = Date.UTC(2026, 10, 19, 19, 41, 53);
  const g = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'FRONT_AT', fn('chartCell') + fn('raceCK') + fn('frontCell') + '\nreturn {raceCK,chartCell,frontCell};')(oc, kit.CHART_ROWS, cols, FRONT);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  assert.equal(g.raceCK({ c: to(40, 30), t: Date.UTC(2026, 10, 12) }), 'c' + at(40, 30), 'stamped on the charted map');
  assert.equal(g.raceCK({ c: to(40, 30), t: FRONT + 60e3 }), 'c' + to(40, 30), 'stamped since on this one');
  assert.equal(g.raceCK({ c: to(5, 0), t: Date.UTC(2026, 10, 12) }), 'c' + at(5, 0), 'the top row never changed');
  // chartCell undoes frontCell on every charted hex, and has nothing for the frontier
  for (const j of [0, at(oc - 1, 0), at(17, 33), at(oc - 1, kit.CHART_ROWS - 1)]) assert.equal(g.chartCell(g.frontCell(j)), j);
  assert.equal(g.chartCell(to(oc + 3, 4)), -1);
  assert.equal(g.chartCell(to(4, kit.CHART_ROWS + 1)), -1);
});

/* The records the frontier's own build already moved (19 Nov 2026, from FRONT_AT until this was live): version 5, with
   the rivers named, the bridges and the public works still on the charted numbers, and finds and expeditions since
   numbered in that build's shuffled list of sites. remapLate puts each right once, by its date, and marks the record. */
test('a record the frontier build moved is put right once, by the date of each thing in it', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS, FRONT = Date.UTC(2026, 10, 19, 19, 41, 53);
  const run = remapper('greywater', [0, 1, 7, 3, 140, 5, 6, 2]);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c, before = Date.UTC(2026, 10, 15), since = FRONT + 3600e3;
  const was = { cv: 5, reg: 'greywater', claims: [{ c: to(12, 7), t: 1 }],
    rvn: [{ r: 'greywater', v: 2 * at(12, 7) + 1, n: 'Old name', t: before }, { r: 'greywater', v: 2 * to(40, 30), n: 'New name', t: since }],
    brg: [{ c: at(9, 9), r: 'greywater', s: before, d: before + 3600e3 }, { c: to(9, 9), r: 'greywater', s: since, d: since + 3600e3 }],
    ew: [{ k: 'yard', nm: 'Old yard', c: at(20, 20), t: before, d: before + 1 }, { k: 'yard', nm: 'New yard', c: to(21, 20), t: since, d: since + 1 }],
    disc: [{ s: 2, t: before, o: 'found' }, { s: 2, t: since, o: 'found', f: 1 }, { s: 4, t: since, o: 'traces' }],
    exp: { s: 7, t0: since, t1: since + 1 }, exp2: { s: 7, t0: before, t1: before + 1 },
    xb: [{ s: 4, t: since }], mapPlan: { reg: 'greywater', cells: [at(5, 5)] } };
  const now = run(was);
  assert.equal(now.fz, 1, 'the record is marked');
  assert.deepEqual(now.claims, was.claims, 'its land was moved already and is not moved again');
  assert.deepEqual(now.rvn.map(e => e.v), [2 * to(12, 7) + 1, 2 * to(40, 30)], 'a river named before the frontier moves, one named since stays');
  assert.deepEqual(now.brg.map(b => b.c), [to(9, 9), to(9, 9)], 'a bridge begun before moves');
  assert.deepEqual(now.ew.map(w => w.c), [to(20, 20), to(21, 20)], 'and so does a public works');
  assert.deepEqual(now.disc.map(e => e.s), [2, 7, 140], 'a find since was numbered in the shuffled list');
  assert.equal(now.exp.s, 2, 'an expedition sent since too');
  assert.equal(now.exp2.s, 7, 'one sent before was in the list as it was');
  assert.deepEqual(now.xb, [{ s: 140, t: since }]);
  assert.deepEqual(now.mapPlan, was.mapPlan, 'the plan carries no date and is left alone');
  // once marked, never again
  assert.equal(run(now), now);
  // a record from before the frontier (version 4) is moved and marked in one go; its sites were never shuffled
  const v4 = run({ cv: 4, reg: 'greywater', ew: [{ k: 'yard', nm: 'Y', c: at(20, 20), t: before, d: before + 1 }], disc: [{ s: 2, t: since, o: 'found' }] });
  assert.equal(v4.fz, 1);
  assert.equal(v4.ew[0].c, to(20, 20));
  assert.equal(v4.disc[0].s, 2, 'a tab on the old map numbered its finds in the old list');
  assert.equal(run(v4), v4);
  // another region's record is its own page's to put right
  const away = { cv: 5, reg: 'meridian', ew: [{ k: 'yard', c: 5, t: before, d: before + 1 }] };
  assert.equal(run(away), away);
});

/* The game's own sites, run on a map: the charted map (as every region had it before the frontier) or the grown one */
function sitesOn(region, grown) {
  const PARTS = [['const LEG={', '/* a stable key for per-hex randomness'], ['/* hex geometry for a grid', '/* older Meridian records (map version 2)'], ['const HEX_R=10,', '\nconst MAP=bakedMap()']];
  const TABLES = [['function climateOf(cell){', '\n/* figures the Statistics page'], ['const CELL_RES=(()=>{', '/* large iron deposits'], ['/* large iron deposits', '\nconst resName='], ['const BIOME=', '\nfunction terrName']];
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a + ' is found'); return src.slice(i, j); };
  const code = [line('function rng(seed){'), line('const clamp = '), ...PARTS.map(([a, b]) => cut(a, b)), line('function hash(str){'),
    'const MAP=' + (grown ? 'REG_MER?embedFrontier(REG,embedLegacy(legacyMap())):genRegionMap(REG)' : 'REG_MER?embedLegacy(legacyMap()):genChartMap(REG)') + ';',
    line('function cellKey(i){'), ...TABLES.map(([a, b]) => cut(a, b)), line('function hexDist(a,b){'), line('function hexDistIn(a,b,C){'), line('const BIOME_KEY='),
    'const MAP_T0=MAP.T.slice();', cut('const LAKE_MAX=', 'const claimLand='), cut('const SITE_KINDS={', '/* a site the player may see'),
    'let wndCellMemo={m:null,c:-1};', fn('wndCell'), 'let lthCellMemo={m:null,c:-1};', fn('lthCell'),
    'return {MAP,SITES,SITE_FZ,wndCell,lthCell};'].join('\n');
  const store = { 'statehood.nation.v1': JSON.stringify({ name: 'Baker', reg: region }) };
  return new Function('localStorage', 'window', 'performance', code)({ getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null }, {}, { now: () => Date.now() });
}

/* The sites (19 Nov 2026): a site is known by its index, and the frontier's land joined the draw that lays them out, so
   the list was shuffled from the twelfth site on (Greywater; Meridian's legacy sites held the first 57) and every find
   since 29 Oct pointed at another site. The charted map's list now comes first, exactly as it was, and the frontier
   build's own sites after it, so that its indices still name theirs. Checked here against the charted map's own list,
   which the game made (before the frontier) with this same draw. */
for (const id of ['greywater', 'meridian']) test(`${id}: the sites are where they were, and the frontier's after them`, () => {
  const chart = sitesOn(id, false), now = sitesOn(id, true), M = now.MAP;
  assert.equal(chart.SITE_FZ, null, 'a map that did not grow has one list');
  const n = chart.SITES.length;
  assert.equal(n, 96 + 20, 'the charted map has its 96 sites and 20 lost places');
  chart.SITES.forEach((s, i) => {
    const t = now.SITES[i];
    assert.deepEqual([M.chart[t.c], t.k, t.x, !!t.lost], [s.c, s.k, s.x, !!s.lost], `site ${i} is the one it was`);
  });
  const extra = now.SITES.slice(n);
  assert.ok(extra.length >= 8, 'the frontier has sites of its own');
  assert.ok(extra.filter(s => M.chart[s.c] < 0).length >= extra.length * 0.75, 'nearly all of them on its land');
  assert.equal(new Set(now.SITES.map(s => s.c)).size, now.SITES.length, 'no hex is two sites');
  // every index the frontier's build gave out names the same hex in the list now
  assert.equal(now.SITE_FZ.length, n);
  assert.ok(now.SITE_FZ.some((j, i) => j !== i), 'that build had shuffled them');
  for (let i = n; i < now.SITES.length; i++) assert.ok(now.SITE_FZ.includes(i), 'every site after the charted ones is one of that build\'s');
  assert.equal(new Set(now.SITE_FZ).size, n, 'and no two of its indices land on one site');
  // the statue and the lighthouse stand where they stood
  assert.equal(M.chart[now.wndCell()], chart.wndCell(), 'the statue');
  assert.equal(M.chart[now.lthCell()], chart.lthCell(), 'the lighthouse');
});

/* The riddle of the week (19 Nov 2026): this week's answer was set before the frontier, on the charted map. The job
   moves a key set before then once (cv 5), with the game's own grid. */
test('the riddle job moves a key set before the frontier, once', async () => {
  const { frontMove, keyOld } = await import('../jobs/fx/riddle.mjs');
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS, F = frontMove(src, 'greywater');
  assert.equal(F.at, Date.UTC(2026, 10, 19, 19, 41, 53));
  assert.equal(F.move(33 * oc + 40), 33 * cols + 40);
  assert.equal(F.move(5), 5);
  assert.equal(frontMove(src, 'terra'), null, 'nothing moves where the grid did not grow');
  const key = (t, cv) => ({ exists: true, get: k => k === 't' ? { toMillis: () => t } : k === 'cv' ? cv : undefined });
  assert.equal(keyOld(key(Date.UTC(2026, 10, 16, 8)), F), true, "this week's key, set on Monday");
  assert.equal(keyOld(key(Date.UTC(2026, 10, 16, 8), 5), F), false, 'once moved it says so');
  assert.equal(keyOld(key(Date.UTC(2026, 10, 23, 8), 5), F), false, 'and every key set since says so from the start');
  assert.equal(keyOld({ exists: false }, F), false);
  assert.match(readFileSync(new URL('../jobs/fx/riddle.mjs', import.meta.url), 'utf8'), /riddleKeys\/' \+ id\), \{ c: Q\.c,[^}]*cv: 5 \}/, 'a new key is written as moved');
});

test('a riddle the job counted later is paid once', () => {
  let made = null;
  const S = { nation: { name: 'X', rdo: ['greywater_20261109'] } };
  const rdPaid = new Function('S', 'OBS', 'clone', 'commit', fn('rdPaid') + '\nreturn rdPaid;')(S, false, x => structuredClone(x), n => { made = n; });
  rdPaid('greywater_20261116', { ok: 0, r: 0 });
  assert.equal(made, null, 'not while the guess is not counted');
  rdPaid('greywater_20261116', { ok: 1, r: 4 });
  assert.deepEqual(made._rdw, { id: 'greywater_20261116', rank: 4 });
  made = null;
  rdPaid('greywater_20261109', { ok: 1, r: 2 });
  assert.equal(made, null, 'and a riddle already paid is not paid again');
});

/* The borders on the server (19 Nov 2026): an agreement is kept as it was drawn, and the server compares numbers
   (functions/border-rules.js, bdSideOf). One drawn before the frontier holds the charted map's numbers, so a claim past
   its line, sent as numbered now, never broke it, and a swap went into it on the wrong numbers. The game tells the server
   the number it holds (bdNum). */
test('a claim past an old border is told to the server in that border\'s numbers', async () => {
  const { bdSideOf } = await import('../functions/border-rules.js');
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS, FRONT = Date.UTC(2026, 10, 19, 19, 41, 53);
  const g = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER', 'MAP', 'BD_RULES', 'FRONT_AT',
    fn('frontCell') + fn('chartCell') + fn('bdNorm') + fn('bdNum') + '\nreturn {bdNorm,bdNum};')(oc, kit.CHART_ROWS, cols, 5,
      { N: cols * kit.MAP_ROWS }, { maxP: 4, maxCells: 1500 }, FRONT);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const raw = t => ({ reg: 'greywater', p: ['a', 'b'], st: 'active', t, s: { a: [at(10, 5)], b: [at(12, 5), at(13, 6)] }, buf: [at(11, 5)], bt: 0, bc: at(12, 5) });
  const old = raw(Date.UTC(2026, 10, 18)), B = g.bdNorm('x', old);
  assert.equal(B.ch, 1, 'drawn on the charted map');
  assert.deepEqual(B.s.b, [to(12, 5), to(13, 6)]);
  assert.equal(B.bc, to(12, 5), 'and the hex it was broken on, read the same way');
  // nation a claims b's hex (13,6), as this map numbers it: the server finds it on b's side only in the charted number
  assert.equal(bdSideOf(old, to(13, 6)), '', 'sent as numbered now, the server saw no breach');
  assert.equal(bdSideOf(old, g.bdNum(B, to(13, 6))), 'b', 'sent as the border holds it, it does');
  assert.equal(bdSideOf(old, g.bdNum(B, to(11, 5))), 'buf');
  assert.equal(g.bdNum(B, to(oc + 4, 5)), -1, 'no hex of the frontier is in it');
  // one drawn since holds the numbers as they are
  const fresh = raw(FRONT + 3600e3), F = g.bdNorm('y', fresh);
  assert.equal(F.ch, 0);
  assert.equal(g.bdNum(F, at(13, 6)), at(13, 6));
  assert.equal(bdSideOf(fresh, g.bdNum(F, at(13, 6))), 'b');
});
