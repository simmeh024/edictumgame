// Trade routes on maps past 65,536 cells (game/edictum.html, trBufs/trSearch/trTree): the route heap packs each cell
// into its key, once as key%65536, which most maps outgrow (a 250-nation region has about 75,000 cells), so routes in
// their south came out as other cells. These run the game's own search on a 90,000-cell map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
/* one top-level function of the game, by name, up to its closing brace */
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const code = ['genGeom', 'trBufs', 'trSearch', 'trTree'].map(fn).join('\n');
const tradeConst = html.match(/const TR_BLK_R=[^\n]*;/)[0];
const make = (cols, rows, sea) => new Function('cols', 'rows', 'sea', `
  const HEX_R=10,HEX_W=Math.sqrt(3)*HEX_R;
  ${tradeConst}
  let trBuf=null;const trTrees=new Map(),RECL={sig:'test'};
  ${code}
  const G=genGeom(cols,rows),T=new Uint8Array(G.N).fill(2);
  for(let i=0;i<G.N;i++)if(sea(i%cols,Math.floor(i/cols)))T[i]=0;
  const MAP={...G,T};
  return {MAP,search:(a,b,land)=>trSearch(a,b,land,()=>5),tree:a=>trTree(a)};`)(cols, rows, sea);

const COLS = 300, ROWS = 300;
const at = (c, r) => r * COLS + c;
/* every step of a route is to a neighbouring cell */
function joined(M, cells) {
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    if (![0, 1, 2, 3, 4, 5].some(d => M.MAP.nbr[a * 6 + d] === b)) return `${a} → ${b} are not neighbours`;
  }
  return '';
}

test('a land route between two cells past 65,535 runs from one to the other, cell by cell', () => {
  const M = make(COLS, ROWS, () => false);
  assert.ok(M.MAP.N > 65536);
  const a = at(20, 250), b = at(260, 280);
  assert.ok(a >= 65536 && b >= 65536);
  const R = M.search(a, b, true);
  assert.ok(R, 'a route is found');
  assert.equal(R.cells[0], a); assert.equal(R.cells[R.cells.length - 1], b);
  assert.equal(joined(M, R.cells), '');
  assert.ok(R.cells.length >= 241 && R.cells.length < 320, 'and it is about as short as the map allows: ' + R.cells.length);
});

test('a route from the north to the south crosses the 65,536th cell', () => {
  const M = make(COLS, ROWS, () => false);
  const a = at(150, 5), b = at(150, 295), R = M.search(a, b, true);
  assert.ok(R && R.cells[0] === a && R.cells[R.cells.length - 1] === b && !joined(M, R.cells));
});

test('a route by sea and land in the south reaches its end', () => {
  /* sea everywhere but a wall of land from column 100 to 110: crossed with a charge at each landing, or sailed round */
  const M = make(COLS, ROWS, (c, r) => !(c >= 100 && c <= 110 && r > 10));
  const a = at(50, 290), b = at(200, 290), R = M.search(a, b, false);
  assert.ok(R, 'a route is found');
  assert.equal(R.cells[0], a); assert.equal(R.cells[R.cells.length - 1], b);
  assert.equal(joined(M, R.cells), '');
  assert.ok(R.cells.filter(c => M.MAP.T[c] < 2).length > 100, 'mostly by sea');
});

test('a road tree grown from a southern hub reaches every cell, each back to the hub', () => {
  const M = make(COLS, ROWS, () => false), hub = at(150, 280), t = M.tree(hub);
  for (const end of [at(0, 0), at(299, 299), at(10, 270), at(290, 230)]) {
    const path = []; for (let c = end; c !== -1 && path.length < 1000; c = t.par[c]) path.push(c);
    assert.equal(path[path.length - 1], hub, 'back to the hub from ' + end);
    assert.equal(joined(M, path), '');
  }
});
