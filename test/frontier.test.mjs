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
  const run = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER',
    fn('frontCell') + fn('remapFront') + '\nreturn remapFront;')(oc, or, cols, 5);
  const rec = run({ cv: 4, jvp: [{ id: 'abcdef', w: 'a', k: 'road', to: 'b', ca: at(20, 10), cb: at(22, 12),
    path: hexes.map(([c, r]) => at(c, r)), t: 5 }, { v: 'a_abcdef', w: 'b', k: 'road', t: 6 }] });
  assert.deepEqual(rec.jvp[0].path, hexes.map(([c, r]) => to(c, r)));
  assert.equal(rec.jvp[0].ca, to(20, 10));
  assert.equal(rec.jvp[0].cb, to(22, 12));
  assert.deepEqual(rec.jvp[1], { v: 'a_abcdef', w: 'b', k: 'road', t: 6 }, 'the accepting side holds no hexes');
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
  const k = await sealKit('greywater'), oc = k.kit.CHART_COLS, cols = k.kit.MAP_COLS, run = new Function('CHART_COLS', 'CHART_ROWS', 'MAP_COLS', 'MAP_VER',
    fn('frontCell') + fn('remapFront') + '\nreturn remapFront;')(oc, k.kit.CHART_ROWS, cols, 5);
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
