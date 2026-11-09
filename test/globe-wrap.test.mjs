// The globe (game/edictum.html, "the globe"): every map wraps east to west. The wrap is added to MAP.nbr after the
// map is built; distances, the hex under a point, sea routes and the turns of the map on screen all go round.
// Land growth keeps the flat table, and no land on any baked map touches across the seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapKit, bakeMaps} from '../scripts/bake-maps.mjs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const globe = html.slice(html.indexOf('const MAP_PW='), html.indexOf('\n', html.indexOf('function mapTurns(')) + 1);
const code = ['genGeom', 'hexDist', 'cellAt', 'trBufs', 'trSearch', 'trSees'].map(fn).join('\n');
const tradeConst = html.match(/const TR_BLK_R=[^\n]*;/)[0];
const make = (cols, rows, land) => new Function('cols', 'rows', 'land', `
  const HEX_R=10,HEX_W=Math.sqrt(3)*HEX_R;
  ${tradeConst}
  let trBuf=null;
  ${code}
  const G=genGeom(cols,rows),T=new Uint8Array(G.N);
  for(let i=0;i<G.N;i++)T[i]=land(i%cols,Math.floor(i/cols))?2:0;
  const MAP={...G,T};
  ${globe}
  return {MAP,MAP_PW,hexDist,cellAt,mapTurns,wrapDx,search:(a,b,l)=>trSearch(a,b,l,()=>5)};`)(cols, rows, land);

const C = 120, R = 60, at = (c, r) => r * C + c;

test('the hexes on the east and west edges are neighbours, both ways, on even and odd rows', () => {
  const M = make(C, R, () => false), nb = M.MAP.nbr;
  for (const r of [10, 11]) {
    const e = at(C - 1, r), w = at(0, r);
    assert.ok([0, 1, 2, 3, 4, 5].some(d => nb[e * 6 + d] === w), 'east sees west on row ' + r);
    assert.ok([0, 1, 2, 3, 4, 5].some(d => nb[w * 6 + d] === e), 'west sees east on row ' + r);
    for (let d = 0; d < 6; d++) { const j = nb[e * 6 + d]; if (j >= 0) assert.ok([0, 1, 2, 3, 4, 5].some(k => nb[j * 6 + k] === e), 'and every link is two-way'); }
  }
  assert.equal(M.MAP.nbrFlat[at(C - 1, 10) * 6], -1, 'the flat table still ends at the edge');
  assert.ok([0, 1, 2, 3, 4, 5].every(d => nb[at(5, 0) * 6 + d] !== at(5, R - 1)), 'north and south do not wrap');
});

test('distances go the short way round', () => {
  const M = make(C, R, () => false);
  assert.equal(M.hexDist(at(0, 10), at(C - 1, 10)), 1);
  assert.equal(M.hexDist(at(2, 10), at(C - 3, 10)), 5);
  assert.equal(M.hexDist(at(0, 10), at(C / 2, 10)), C / 2);
  assert.equal(M.hexDist(at(30, 10), at(40, 10)), 10, 'and in the middle as before');
});

test('the hex under a point past either edge is the one round the globe', () => {
  const M = make(C, R, () => false), y = M.MAP.cy[at(0, 10)];
  assert.equal(M.cellAt(M.MAP.cx[at(3, 10)] + M.MAP_PW, y), at(3, 10));
  assert.equal(M.cellAt(M.MAP.cx[at(C - 2, 10)] - M.MAP_PW, y), at(C - 2, 10));
  assert.equal(M.cellAt(M.MAP.cx[at(7, 10)], -500), -1, 'off the top is still nowhere');
});

test('a sea route between ports near opposite edges sails across the seam', () => {
  /* two islands near the west and east edges, open sea between them both ways */
  const M = make(C, R, (c, r) => r > 25 && r < 35 && ((c >= 5 && c <= 10) || (c >= C - 11 && c <= C - 6)));
  const a = at(5, 30), b = at(C - 6, 30), P = M.search(a, b, false);
  assert.ok(P && P.cells[0] === a && P.cells[P.cells.length - 1] === b, 'a route is found');
  assert.ok(P.cells.length < 20, 'and it is short, across the seam: ' + P.cells.length);
});

test('the map is drawn once for each turn of the globe on screen', () => {
  const M = make(C, R, () => false), s = 1, W = M.MAP_PW;
  assert.deepEqual(M.mapTurns(0, s, W * 0.5), [0], 'one turn fills a narrow view');
  const t = M.mapTurns(-W * 0.8, s, W * 0.5);
  assert.equal(t.length, 2, 'two at the seam');
  assert.ok(t.includes(-W * 0.8) && t.includes(-W * 0.8 + W));
  assert.equal(t[0], -W * 0.8, 'the view’s own turn first');
});

test('no land on any baked map touches land across the seam', () => {
  const src = html, data = bakeMaps(src), ids = mapKit(src, 'meridian').ids;
  for (const id of ids) {
    const M = mapKit(src, id, {__edictum: {maps: JSON.parse(JSON.stringify(data))}}).bakedMap(), C2 = M.COLS;
    for (let r = 0; r < M.ROWS; r++) {
      const e = r * C2 + C2 - 1;
      if (M.T[e] < 2) continue;
      for (const r2 of [r - 1, r, r + 1]) if (r2 >= 0 && r2 < M.ROWS) assert.ok(M.T[r2 * C2] < 2, `${id}: land meets across the seam at row ${r}`);
    }
  }
});
