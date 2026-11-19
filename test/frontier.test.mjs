// The frontier ("the frontier" in game/edictum.html): every region's charted map — the one its players live
// on — is kept hex for hex in the north-west of a larger grid, and the new land lies east and south of it.
// Nothing a nation holds moves: a charted hex keeps its column and row, its stable key, its landmass name and
// the computer capitals standing on it, and map version 5 carries older records across (remapFront).
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapKit} from '../scripts/bake-maps.mjs';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const ids = mapKit(src, 'meridian').ids;
// the whole map of every region takes minutes to make; these four cover the kinds of frontier there are
const SOME = ['meridian', 'greywater', 'coralreach', 'ironsteppe'];

// one function of the game, by name, as globe-wrap.test.mjs takes them
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
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
  const run = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER',
    fn('frontCell') + fn('remapFront') + '\nreturn remapFront;')(oc, kit.CHART_ROWS, cols, 5);
  const was = { cv: 4, loc: { c: 12, r: 7, m: 4 }, claims: [{ c: 7 * oc + 12, t: 1 }, { c: 0, t: 2 }],
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
  const run = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER',
    fn('frontCell') + fn('remapFront') + '\nreturn remapFront;')(oc, kit.CHART_ROWS, cols, 5);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const was = {
    cv: 4,
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

test('the divisions keep their seats', () => {
  const kit = mapKit(src, 'greywater'), oc = kit.CHART_COLS, cols = kit.MAP_COLS;
  const run = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER',
    fn('frontCell') + fn('remapFront') + '\nreturn remapFront;')(oc, kit.CHART_ROWS, cols, 5);
  const at = (c, r) => r * oc + c, to = (c, r) => r * cols + c;
  const now = run({ cv: 4, prov: { on: 1, term: 'p', q: 3, r: 'greywater',
    l: [{ id: 1, nm: 'North', s: at(5, 5), m: [[at(6, 5), 2]] }, { id: 2, nm: 'Dormant', s: -1 }],
    x: { [at(7, 7)]: 1, [at(8, 7)]: 2 } } });
  assert.equal(now.prov.l[0].s, to(5, 5), 'the seat moves with its row');
  assert.deepEqual(now.prov.l[0].m, [[to(6, 5), 2]], 'and so does a seat taken in by merging');
  assert.equal(now.prov.l[0].nm, 'North');
  assert.equal(now.prov.l[1].s, -1, 'a division with no seat still has none');
  assert.deepEqual(now.prov.x, { [to(7, 7)]: 1, [to(8, 7)]: 2 }, 'and every hex moved by hand');
  assert.equal(now.prov.on, 1);
});
