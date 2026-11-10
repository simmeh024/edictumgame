// Lakes (game/edictum.html, "lakes"): water shut in by land, at most LAKE_MAX hexes and never reaching the open sea, may
// be claimed like land and is drawn under a paler wash of its holder's colour. Checked here on every region's real map
// (made by the game's own generators, as scripts/bake-maps.mjs makes them), with the game's own code cut from its source.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapKit } from '../scripts/bake-maps.mjs';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const LAKES = cut('/* ── lakes ──', 'const BIOME=(()=>{');
const WRAP = cut('MAP.nbrFlat=MAP.nbr.slice();', '/* the shortest way across x');
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const HEAP = ['const hlt=', 'function hpush(', 'function hpop('].map(line).join('\n');
const GROW = cut('function grow(list,over){', '/* when a nation\'s capital took its place');
const FILL = cut('function hexFill(g,i,rad){', 'function edgeList(');
const TERRC = cut('function terrCount(cells){', '/* the map key:');
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');

/* a region's map as the page has it: generated, wrapped east to west, with the lake code run over it */
function region(id) {
  const K = mapKit(src, id), MAP = K.generate(), ctx = vm.createContext({ MAP, landName: c => MAP.comp[c] >= 0 ? 'land' + MAP.comp[c] : 'a remote islet' });
  vm.runInContext(WRAP, ctx);
  ctx.MAP_T0 = MAP.T.slice();
  vm.runInContext(vars(LAKES), ctx);
  return ctx;
}
/* the map's bodies of water: cells, and whether one reaches the top or bottom edge */
function bodies(MAP) {
  const seen = new Uint8Array(MAP.N), out = [];
  for (let i = 0; i < MAP.N; i++) {
    if (MAP.T[i] >= 2 || seen[i]) continue; const cells = [i]; seen[i] = 1; let open = false;
    for (let q = 0; q < cells.length; q++) { const a = cells[q]; for (let d = 0; d < 6; d++) { const j = MAP.nbr[a * 6 + d]; if (j < 0) { open = true; continue; } if (MAP.T[j] < 2 && !seen[j]) { seen[j] = 1; cells.push(j); } } }
    out.push({ cells, open });
  }
  return out;
}

const IDS = mapKit(src, 'meridian').ids;
const MAPS = new Map(IDS.map(id => [id, region(id)]));

test('every region has lakes, and only small water shut in by land is one', () => {
  for (const [id, ctx] of MAPS) {
    const { MAP, LAKE_MAX } = ctx, L = ctx.lakeMap();let lakes = 0, oceans = 0;
    for (const b of bodies(MAP)) {
      const want = !b.open && b.cells.length <= LAKE_MAX;
      for (const c of b.cells) assert.equal(L[c] === 1, want, `${id}: hex ${c} in a body of ${b.cells.length}${b.open ? ', open sea' : ''}`);
      if (want) lakes++; if (b.open) oceans++;
    }
    assert.ok(lakes >= 3, `${id} has ${lakes} lakes`);
    assert.ok(oceans >= 1, `${id} has an open sea`);
    for (let c = 0; c < MAP.N; c++) if (MAP.T[c] >= 2) assert.equal(L[c], 0, `${id}: land hex ${c} is no lake`);
  }
});

test('a lake hex may be claimed like land; the open sea may not', () => {
  const ctx = MAPS.get('meridian'), { MAP } = ctx, L = ctx.lakeMap();
  const lake = L.indexOf(1), land = MAP.T.findIndex(t => t >= 2), sea = bodies(MAP).find(b => b.open).cells[0];
  assert.ok(ctx.isLake(lake) && ctx.claimLand(lake));
  assert.ok(!ctx.isLake(land) && ctx.claimLand(land));
  assert.ok(!ctx.isLake(sea) && !ctx.claimLand(sea));
  assert.ok(!ctx.isLake(-1) && !ctx.claimLand(-1));
  assert.match(ctx.lakeShore(lake), /^land\d+$/, 'a lake is named after the land round it');
});

test('a reclaimed lake hex is land again, and the rest of its lake stays a lake', () => {
  const ctx = region('meridian'), { MAP } = ctx, L = ctx.lakeMap();
  const b = bodies(MAP).find(x => !x.open && x.cells.length >= 3 && x.cells.length <= ctx.LAKE_MAX);
  assert.ok(b, 'meridian has a lake of three hexes or more');
  const [c, ...rest] = b.cells;MAP.T[c] = 2;
  assert.ok(!ctx.isLake(c) && ctx.claimLand(c));
  for (const r of rest) assert.ok(ctx.isLake(r), `hex ${r} is still a lake`);
});

test('claiming a lake moves nobody\'s core: water stays open to every nation\'s growth', () => {
  let cases = 0, crossed = 0;
  for (const id of ['meridian', 'driftlands', 'gilded', 'ambershallows', 'greywater', 'scatteredcrown']) {
    const m = MAPS.get(id), MAP = m.MAP, L = m.lakeMap();
    const g = vm.createContext({ MAP, STEP: [0, 2.5, 1, 1.35, 2.1] });
    vm.runInContext(vars(HEAP) + '\n' + GROW, g);
    const dist = (a, b) => { const C = MAP.COLS, ar = Math.floor(a / C), ac = a % C, br = Math.floor(b / C), bc = b % C, dq = (ac - (ar - (ar & 1)) / 2) - (bc - (br - (br & 1)) / 2), dr = ar - br; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
    for (const b of bodies(MAP).filter(x => !x.open && x.cells.every(c => L[c])).slice(0, 30)) {
      /* a neighbour's capital on the shore, growing a core of 30 hexes; the lake claimed by a nation further off */
      const shore = []; for (const c of b.cells) for (let d = 0; d < 6; d++) { const j = MAP.nbrFlat[c * 6 + d]; if (j >= 0 && MAP.T[j] >= 2 && !shore.includes(j)) shore.push(j); }
      const nb = shore[0], far = shore.find(c => dist(c, nb) >= 2) ?? shore[1];
      if (far === undefined) continue;
      const list = [{ cap: far, budget: 1, w: 1 }, { cap: nb, budget: 30, w: 1 }];
      const before = g.grow(list, null), after = g.grow(list, new Map(b.cells.map(c => [c, 0])));
      for (let c = 0; c < MAP.N; c++) if (MAP.T[c] >= 2) assert.equal(after.owner[c], before.owner[c], `${id}: land hex ${c} kept its holder`);
      for (const c of b.cells) assert.equal(after.owner[c], 0, `${id}: the claimed lake hex ${c} is held`);
      assert.equal(after.held[0], before.held[0] + b.cells.length, 'the lake counts towards the hexes held');
      assert.deepEqual([...after.grown], [...before.grown], 'the cores grow as far as before');
      /* did the neighbour's core reach land only the lake leads to (land beside the lake, not its own capital's ring)? */
      const ring = new Set([nb]); for (let d = 0; d < 6; d++) ring.add(MAP.nbrFlat[nb * 6 + d]);
      if (shore.some(c => !ring.has(c) && before.owner[c] === 1)) crossed++;
      cases++;
    }
  }
  assert.ok(cases >= 40, `${cases} lakes checked`);
  assert.ok(crossed >= 10, `${crossed} cores grew along a lake shore`);
});

test('a held lake is filled at LAKE_A of the land\'s alpha, in the same colour', () => {
  const T = new Uint8Array([2, 1, 3, 1, 2]), fills = [];
  const g = { globalAlpha: 0.5, fillStyle: '', n: 0, beginPath() { this.n = 0; }, moveTo() { this.n++; }, lineTo() {}, fill() { fills.push({ hexes: this.n, alpha: this.globalAlpha, style: this.fillStyle }); } };
  const ctx = vm.createContext({ MAP: { T, cx: new Float32Array(5), cy: new Float32Array(5) }, HCX: [1, 1, 1, 1, 1, 1], HCY: [1, 1, 1, 1, 1, 1], LAKE_A: 0.42 });
  vm.runInContext(FILL, ctx);
  ctx.fillHeld(g, [0, 1, 2, 3, 4], '#c33', 10.5);
  assert.deepEqual(fills, [{ hexes: 3, alpha: 0.5, style: '#c33' }, { hexes: 2, alpha: 0.5 * 0.42, style: '#c33' }]);
  assert.equal(g.globalAlpha, 0.5, 'the alpha is left as it was');
  fills.length = 0;ctx.fillHeld(g, [0, 2, 4], '#c33', 10.5);
  assert.equal(fills.length, 1, 'land alone takes one fill');
});

test('a block\'s terrain line counts its lake hexes', () => {
  const ctx = vm.createContext({ MAP: { T: [2, 2, 1, 1, 0] }, BIOME: [1, 2, 0, 0, 0], BIOME_NAME: ['', 'Farmland', 'Forest'], isLake: c => c === 2 || c === 3 });
  vm.runInContext(TERRC, ctx);
  assert.deepEqual([...ctx.terrCount([0, 1, 2, 3, 4])], ['farmland (1)', 'forest (1)', 'lake (2)']);
});

test('the rules that keep a lake a lake are still in the source', () => {
  assert.match(src, /const freeCell=\(T,c\)=>claimLand\(c\)&&/, 'free hexes may be lakes');
  assert.match(src, /isCap\[e\.c\]\|\|!claimLand\(e\.c\)\)continue;/, 'territory keeps claims on lakes');
  assert.match(src, /let fr=\[\.\.\.claimFrontier\(T\)\]\.filter\(c=>MAP\.T\[c\]>=2\);/, 'spending credits for you takes land only');
  assert.match(src, /if\(MAP\.T\[c\]<2\)return `A seat stands on land, not on a lake\./, 'a province seat stands on land');
  assert.match(src, /if\(cell<0\|\|MAP\.T\[cell\]<2\)return 'Cities must stand on land\.';/, 'cities stand on land');
});
