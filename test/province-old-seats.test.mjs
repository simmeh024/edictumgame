// Old seats of provinces (game/edictum.html): a merger keeps the absorbed division's seat so no border moves; a refusal
// it causes says so and offers to remove it, and Remove old seats gives the land to whichever seat is nearest.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, 'found ' + a); return src.slice(i, j); };
const COLS = 16, ROWS = 9, N = COLS * ROWS;
const at = (c, r) => r * COLS + c, plain = o => JSON.parse(JSON.stringify(o));
/* a nation of 14 by 7 hexes (98: room for 16 divisions), Alpha's seat in the west and Beta's in the east */
const LAND = []; for (let r = 1; r <= 7; r++) for (let c = 1; c <= 14; c++) LAND.push(at(c, r));
const SA = at(3, 4), SB = at(11, 4), MID = at(7, 4);
const two = () => ({ on: 1, term: 'p', l: [{ id: 1, nm: 'Alpha', s: SA }, { id: 2, nm: 'Beta', s: SB }], x: {}, q: 2, r: 'r' });

/* an odd-r offset grid, as the game's hexDist expects; every hex of LAND is ours */
function game(prov) {
  const nbr = new Int32Array(N * 6).fill(-1), cx = new Float32Array(N), cy = new Float32Array(N), T = new Uint8Array(N), owner = new Int16Array(N).fill(-1);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = at(c, r), odd = r & 1;
    (odd ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]])
      .forEach(([dc, dr], k) => { const x = c + dc, y = r + dr; if (x >= 0 && x < COLS && y >= 0 && y < ROWS) nbr[i * 6 + k] = at(x, y); });
    cx[i] = c * 17.3 + (odd ? 8.66 : 0); cy[i] = r * 15;
  }
  for (const c of LAND) { T[c] = 2; owner[c] = 0; }
  const n = { name: 'Wildach', seed: 's', reg: 'r', cities: [], infra: [], log: [], prov: JSON.parse(JSON.stringify(prov)) };
  const terr = { owner, byId: { me: 0 }, list: [{ id: 'me', n, cap: SA, me: true }] };
  const ctx = vm.createContext({
    MAP: { N, COLS, ROWS, nbr, T, cx, cy }, RECL: { sig: 'x' }, REG: { id: 'r' }, NORM_HOOKS: [], myId: () => 'me', cityList: n => n.cities || [],
    S: { nation: n }, territory: () => terr, clone: o => JSON.parse(JSON.stringify(o)), render: () => {}, toast: () => {},
    commit: m => { ctx.S.nation = m; terr.list[0].n = m; }, cityState: () => ({ byCell: new Map() }), czText: (s, k) => String(s || '').slice(0, k),
    prvNameIdea: () => 'Gamma', prvNew: (n, P, s, nm) => ({ id: ++P.q, nm, s, g: { nm: 'Gov', tr: [] } }),
    HEX_R: 10, HCX: [1, .5, -.5, -1, -.5, .5], HCY: [0, .8, .8, 0, -.8, -.8],
  });
  vm.runInContext([src.match(/const clamp = \(v,a,b\) => [^\n]*/)[0], src.match(/function hexDist\(a,b\)\{[^\n]*/)[0],
    cut('function landPatches(', 'function releaseClaims('), cut('const PRV_TERMS=', '/* ── names in the flavour of the nation'),
    cut('/* ── checks ── */', 'function prvRename('), 'globalThis.G={PRV,prvAdd,prvSeat,prvMerge,prvMoveHex,prvDropOld,prvNatWith,prvOld};'].join('\n'), ctx);
  const G = ctx.G, nat = () => ctx.S.nation, div = id => G.prvNatWith(terr, 0, nat().prov).byId.get(id);
  /* the message the page shows, and whether it offers to remove old seats (and whose) */
  const said = () => { const u = G.PRV.ui; return { msg: u.msg, fix: u.fix && u.msg && u.fix.msg === u.msg ? u.fix.id : null }; };
  return { G, nat, div, said };
}
const merged = () => { const g = game(two()); g.G.prvMerge(1, 2); return g.nat().prov; };

test('a merger keeps the other seat as an old seat, and moves no border', () => {
  const g = game(two()), before = g.div(1).cells.concat(g.div(2).cells).sort((a, b) => a - b);
  g.G.prvMerge(1, 2);
  assert.deepEqual(plain(g.nat().prov.l.map(q => q.id)), [1]);
  assert.deepEqual(plain(g.nat().prov.l[0].m), [[SB, 2]]);
  assert.equal(g.G.prvOld(g.div(1)), 1);
  assert.deepEqual(plain(g.div(1).cells.slice().sort((a, b) => a - b)), plain(before));
});

test('a new province between the two seats is refused, naming the old seat and offering to remove it', () => {
  const ok = game(two()); ok.G.prvAdd(MID);
  assert.equal(ok.nat().prov.l.length, 3, 'before the merger the same hex founds a province');
  const g = game(merged()); g.G.prvAdd(MID);
  assert.equal(g.nat().prov.l.length, 1);
  const s = g.said();
  assert.match(s.msg, /^A new province here would cut Alpha in two, between its seat and an old seat it kept/);
  assert.match(s.msg, /\(a small dot on the map\)\. Choose another hex, or remove the old seat\.$/);
  assert.equal(s.fix, 1);
});

test('the old seat hex itself is named as an old seat', () => {
  const g = game(merged()); g.G.prvAdd(SB);
  assert.equal(g.said().msg, 'That hex is an old seat of Alpha, kept when another province merged into it, so it cannot be the seat of a new province yet.');
  assert.equal(g.said().fix, 1);
  const h = game(merged()); h.G.prvAdd(at(13, 4)); assert.equal(h.nat().prov.l.length, 2, 'a province east of the old seat is fine');
  h.G.prvMoveHex(SB, 3);
  assert.equal(h.said().msg, 'That hex is an old seat of Alpha, kept when another province merged into it, so it stays in Alpha.');
  assert.equal(h.said().fix, 1);
});

test('the main seat keeps its own messages, with nothing to remove', () => {
  const g = game(merged()); g.G.prvAdd(SA);
  assert.equal(g.said().msg, 'That hex is already the seat of Alpha.');
  assert.equal(g.said().fix, null);
});

test('removing the old seats keeps the seat, gives the land to the nearest seat, and lets the province be founded', () => {
  const g = game(merged());
  assert.ok(g.G.prvDropOld(1));
  const q = g.nat().prov.l[0];
  assert.equal(q.s, SA); assert.equal(q.m, undefined);
  assert.equal(g.G.prvOld(g.div(1)), 0);
  assert.equal(g.div(1).cells.length, LAND.length, 'one division still holds all the land');
  assert.match(g.said().msg, /^Alpha has given up its old seat\. The land it held now belongs to whichever seat is nearest\./);
  g.G.prvAdd(MID);
  assert.equal(g.nat().prov.l.length, 2);
  assert.ok(g.div(3).cells.includes(at(13, 4)), 'the east goes to the new seat, the nearest');
});

test('removing old seats where there are none is refused', () => {
  const g = game(two());
  assert.equal(g.G.prvDropOld(1), false);
  assert.equal(g.said().msg, 'Alpha has no old seats.');
  assert.deepEqual(plain(g.nat().prov), plain(game(two()).nat().prov));
});

test('moving the seat onto the old seat still makes it the only seat', () => {
  const g = game(merged()); g.G.prvSeat(1, SB);
  assert.equal(g.nat().prov.l[0].s, SB); assert.equal(g.nat().prov.l[0].m, undefined);
});
