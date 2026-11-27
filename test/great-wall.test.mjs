// The Great Wall on the map (game/edictum.html, dcWallGeo/dcWalls): every finished wall runs round the
// nation's whole border, coast included, rising from the stretch nearest the capital while it is built.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const geom = cut('function genGeom(COLS,ROWS){', '/* terrain for a region:');
const dist = cut('function hexDist(a,b){', '\n');
const wall = cut('const dcWallMemo=new WeakMap();', 'const dcTimed=');

let drawn = 0;
class Path2D { moveTo() { drawn++; } lineTo() {} arc() {} closePath() {} }
const ctx = vm.createContext({ Math, Map, Set, WeakMap, Float32Array, Int32Array, Uint8Array, Date, Path2D, HEX_R: 10, HEX_W: Math.sqrt(3) * 10 });
vm.runInContext(geom + '\n' + dist + '\n' + wall.replace('const dcWallMemo', 'var dcWallMemo')
  + '\nconst HCX=[],HCY=[];for(let k=0;k<6;k++){const a=(60*k-30)*Math.PI/180;HCX.push(Math.cos(a));HCY.push(Math.sin(a));}', ctx);
ctx.MAP = ctx.genGeom(20, 20); ctx.MAP.T = new Uint8Array(ctx.MAP.N).fill(2);
const { MAP } = ctx;
const at = (c, r) => r * MAP.COLS + c;
function terr(cells, cap) {
  const owner = new Int16Array(MAP.N).fill(-1); for (const c of cells) owner[c] = 0;
  return { list: [{ cap, id: 'balbosa' }], owner };
}
function exterior(T) {
  const out = []; for (let c = 0; c < MAP.N; c++) { if (T.owner[c] !== 0) continue;
    for (let d = 0; d < 6; d++) { const j = MAP.nbr[c * 6 + d]; if (j < 0 || T.owner[j] !== 0) out.push([c, d]); } }
  return out;
}
const block = (c0, r0, w, h) => { const a = []; for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) a.push(at(c, r)); return a; };

test('a big nation’s wall follows every outer edge, not a 16-edge stretch, and no inner edge', () => {
  const T = terr(block(4, 4, 9, 8), at(8, 8)), G = ctx.dcWallGeo(T, 0), E = exterior(T);
  assert.ok(E.length > 16, 'the nation is big enough for the old stretch to have fallen short');
  assert.equal(G.lines.length, E.length);
  const inner = block(5, 5, 7, 6); for (const c of inner) assert.ok(!G.cells.has(c), 'an inner hex carries no wall');
  for (const [c] of E) assert.ok(G.cells.has(c), 'every border hex carries wall');
  assert.equal(ctx.dcWallGeo(T, 0), G, 'the geometry is kept for the same territory');
});

test('coast and the map edge are walled too, alongside land borders', () => {
  const cells = block(0, 3, 6, 5);
  for (const c of block(6, 3, 2, 5)) MAP.T[c] = 1;
  try {
    const T = terr(cells, at(2, 5)), G = ctx.dcWallGeo(T, 0);
    assert.equal(G.lines.length, exterior(T).length);
    const sea = exterior(T).filter(([c, d]) => { const j = MAP.nbr[c * 6 + d]; return j >= 0 && MAP.T[j] < 2; });
    const edge = exterior(T).filter(([c, d]) => MAP.nbr[c * 6 + d] < 0);
    assert.ok(sea.length > 0 && edge.length > 0);
    for (const [c] of sea.concat(edge)) assert.ok(G.cells.has(c));
  } finally { for (const c of block(6, 3, 2, 5)) MAP.T[c] = 2; }
});

test('an overseas colony gets its own wall', () => {
  const home = block(2, 2, 4, 4), colony = [at(14, 14), at(15, 14)];
  const T = terr(home.concat(colony), at(3, 3)), G = ctx.dcWallGeo(T, 0);
  for (const c of colony) assert.ok(G.cells.has(c));
  assert.equal(G.lines.length, exterior(T).length);
});

test('the wall rises from the land border nearest the capital outward', () => {
  const cap = at(5, 8), T = terr(block(4, 4, 9, 8), cap), G = ctx.dcWallGeo(T, 0);
  const cellOf = l => { for (let i = 0; i < MAP.N; i++) if (Math.abs(MAP.cx[i] - l[4]) < 1e-3 && Math.abs(MAP.cy[i] - l[5]) < 1e-3) return i; return -1; };
  const first = cellOf(G.lines[0]), nearest = Math.min(...exterior(T).map(([c]) => ctx.hexDist(c, cap)));
  assert.equal(ctx.hexDist(first, cap), 1); assert.equal(nearest, 1, 'the first stretch stands on the border next to the capital');
  const ds = G.lines.map(l => ctx.hexDist(cellOf(l), first));
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i] >= ds[i - 1], 'lines are ordered outward');
  assert.ok(ds[ds.length - 1] >= 8, 'and reach the far side');
});

test('the map draws the stretches in view, and a wall in progress only its built share', () => {
  const T = terr(block(4, 4, 9, 8), at(8, 8)), G = ctx.dcWallGeo(T, 0);
  const g = { stroke() {}, fill() {}, beginPath() {}, arc() {}, setLineDash() {} };
  ctx.dcMix = () => '#888'; ctx.rlfDark = () => false; ctx.dcProg = () => 0.5;
  const walls = done => [{ ct: { done: done ? ['wall'] : [] }, b: {}, o: 0 }];
  const run = (done, view) => { ctx.dcSpots = () => ({ walls: walls(done) }); drawn = 0; ctx.dcWalls({ g, T, s: 0.3, col: { sheet: '#fff', ink: '#000' }, ...view }); return drawn; };
  assert.equal(run(true, {}), G.lines.length, 'with no view given, the whole wall');
  const all = { x0: -1e4, x1: 1e4, y0: -1e4, y1: 1e4 };
  assert.equal(run(true, all), G.lines.length);
  assert.equal(run(false, all), Math.ceil(G.lines.length * 0.5));
  assert.equal(run(true, { x0: 1e4, x1: 2e4, y0: 1e4, y1: 2e4 }), 0, 'nothing out of view');
  const x = MAP.cx[at(4, 8)], y = MAP.cy[at(4, 8)], part = run(true, { x0: x - 5, x1: x + 5, y0: y - 5, y1: y + 5 });
  assert.ok(part > 0 && part < G.lines.length, 'a close-up draws only its corner of the wall');
});
