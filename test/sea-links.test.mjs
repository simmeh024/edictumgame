// Sea links for provinces (game/edictum.html): a strait of up to two sea hexes, or a finished shipping connection,
// counts as touching; whole islands may belong to any division; an island of one hex may be a division on its own.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, 'found ' + a); return src.slice(i, j); };
const NOW = 1800000000000, W = 14, H = 9, N = W * H;

/* an axial grid: every hex is water until a test makes it land */
function world(land, owned = land) {
  const nbr = new Int32Array(N * 6).fill(-1), dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) dirs.forEach(([dq, dr], d) => { const x = q + dq, y = r + dr; if (x >= 0 && x < W && y >= 0 && y < H) nbr[(r * W + q) * 6 + d] = y * W + x; });
  const T = new Uint8Array(N), owner = new Int16Array(N).fill(-1);
  for (const c of land) T[c] = 2;
  for (const c of owned) owner[c] = 0;
  const n = { cities: [], infra: [] }, terr = { owner, byId: { me: 0 }, list: [{ id: 'me', n, cap: owned[0], me: true }] };
  class FixedDate extends Date { static now() { return NOW; } }
  const ctx = vm.createContext({ MAP: { N, nbr, T }, RECL: { sig: 'x' }, REG: { id: 'r' }, Date: FixedDate, myId: () => 'me', cityList: n => n.cities || [], NORM_HOOKS: [] });
  vm.runInContext(cut('function landPatches(', 'function releaseClaims(') + '\n' + cut('const SEA_LINK=', '/* ── which hex belongs where ── */') + '\n' + src.match(/function prvPieces\(cells,T,i\)\{[\s\S]*?\n\}/)[0], ctx);
  return { ctx, T: terr, n, MAP: ctx.MAP };
}
const at = (q, r) => r * W + q;
const row = (r, ...qs) => qs.map(q => at(q, r));

test('a strait of one or two sea hexes links the shores; three hexes of water do not', () => {
  for (const [gap, linked] of [[1, true], [2, true], [3, false]]) {
    const west = row(4, 0, 1, 2), east = row(4, 3 + gap, 4 + gap), { ctx, T } = world(west.concat(east));
    const L = ctx.seaLinks(T, 0);
    assert.equal(!!(L.get(at(2, 4)) && L.get(at(2, 4)).has(at(3 + gap, 4))), linked, `gap ${gap}`);
    assert.equal(ctx.prvTouch(T, 0, at(3 + gap, 4), west), linked);
  }
});

test('only the nation’s own land is linked, and another nation’s land is not water to cross', () => {
  const west = row(4, 0, 1, 2), east = row(4, 4, 5), wall = Array.from({ length: H }, (_, r) => at(3, r));
  const { ctx, T } = world(west.concat(east, wall), west.concat(east));
  for (const c of wall) T.owner[c] = 1;                            // a neighbour's coast runs right across the strait
  assert.ok(!ctx.prvTouch(T, 0, at(4, 4), west));
  const lone = world(row(4, 0, 1, 2, 4, 5), row(4, 0, 1, 2));        // the far shore is free land, not ours
  assert.ok([...lone.ctx.seaLinks(lone.T, 0).values()].every(s => !s.has(at(4, 4)) && !s.has(at(5, 4))));
});

test('a division over a strait is one piece; one cut on the same land is two', () => {
  const main = row(4, 0, 1, 2, 3, 4, 5), isle = row(4, 7, 8), { ctx, T } = world(main.concat(isle));
  assert.equal(ctx.prvPieces(row(4, 4, 5, 7, 8), T, 0), 1);       // the shore and the island across one sea hex
  assert.equal(ctx.prvPieces(row(4, 0, 1, 4, 5), T, 0), 2);       // two ends of the mainland without the middle
});

test('a whole island far away does not count as a piece, part of one does', () => {
  const main = row(4, 0, 1, 2, 3), isle = row(4, 9, 10, 11), { ctx, T } = world(main.concat(isle));
  assert.equal(ctx.prvPieces(row(4, 0, 1, 9, 10, 11), T, 0), 1);  // part of the mainland and the whole island
  assert.equal(ctx.prvPieces(row(4, 0, 1, 9, 10), T, 0), 2);      // part of the island stays a second piece
  assert.equal(ctx.prvPieces(row(4, 9, 10, 11), T, 0), 1);        // an island alone is one
  assert.equal(ctx.prvPieces([at(0, 4), at(1, 4)]), 1, 'without a nation it counts edge-to-edge pieces as before');
});

test('two divisions join when the result stays one piece', () => {
  const main = row(4, 0, 1, 2, 3, 4, 5), isle = row(4, 7, 8), far = row(4, 12, 13), { ctx, T } = world(main.concat(isle, far));
  const A = { cells: row(4, 0, 1, 2) }, B = { cells: row(4, 3, 4, 5) }, C = { cells: isle }, D = { cells: far }, E = { cells: row(4, 0, 1) }, F = { cells: row(4, 4, 5) };
  assert.ok(ctx.prvCanJoin(T, 0, A, B), 'neighbours on land');
  assert.ok(ctx.prvCanJoin(T, 0, B, C), 'across a strait');
  assert.ok(ctx.prvCanJoin(T, 0, A, D), 'a whole island far away');
  assert.ok(!ctx.prvCanJoin(T, 0, E, F), 'two ends of the mainland with a third division between');
});

test('an island of one hex may be a division; a hex of the mainland may not', () => {
  const main = row(4, 0, 1, 2), { ctx, T } = world(main.concat([at(8, 4)]));
  assert.ok(ctx.prvIslet(T, 0, at(8, 4)));
  assert.ok(!ctx.prvIslet(T, 0, at(1, 4)));
  assert.ok(ctx.prvHasIsles(T));
});

test('a finished shipping connection between two cities links them, an unfinished one does not', () => {
  const west = row(4, 0, 1), east = row(4, 6, 7), { ctx, T, n } = world(west.concat(east));
  n.loc = 1; n.cities = [{ c: at(1, 4), b: [{ k: 'harbour', d: NOW - 1 }] }, { c: at(6, 4), b: [] }];
  n.infra = [{ k: 'sea', a: at(1, 4), b: at(6, 4), d: NOW + 1000, reg: 'r', path: [] }];
  assert.ok(!ctx.prvTouch(T, 0, at(6, 4), west));
  n.infra[0].d = NOW - 1;
  assert.ok(ctx.prvTouch(T, 0, at(6, 4), west));
  n.cities[0].b[0].d = NOW + 5;                                   // the harbour is not finished, so the route does not work
  assert.ok(!ctx.prvTouch(T, 0, at(6, 4), west));
});
