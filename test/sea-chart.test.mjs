// The sea, charted (game/edictum.html, "the sea, charted"): a field of each point's distance from the nearest land,
// from which the map draws depth bands, the land's shadow and water lines. These run the job's stages on a small
// map and check the field against a brute-force measure: exact near the coasts, close out at sea, negative inside
// the land, across the globe's seam, and contours that lie on their levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const globe = html.slice(html.indexOf('const MAP_PW='), html.indexOf('\n', html.indexOf('function mapTurns(')) + 1);
const sea = html.slice(html.indexOf('const SF_WL='), html.indexOf('\nfunction sfStart('));
const code = ['genGeom', 'cellAt'].map(fn).join('\n');
/* a map whose land is land(c, r); the job's stages run to the end (or to stage `upto`), as sfStart and sfRun would */
const make = (cols, rows, land, upto) => new Function('cols', 'rows', 'land', 'upto', `
  const HEX_R=10,SQ3=Math.sqrt(3),HEX_W=SQ3*HEX_R;
  ${code}
  const G=genGeom(cols,rows),T=new Uint8Array(G.N);
  for(let i=0;i<G.N;i++)T[i]=land(i%cols,Math.floor(i/cols))?2:0;
  const MAP={...G,T};
  ${globe}
  ${sea}
  const Gd=sfGrid(),nx=Gd.nx,ny=Gd.ny,K=Math.min(nx,Math.ceil((SF_DL[SF_DL.length-1]+12)/Gd.gx)),W=nx+2*K,N=W*ny;
  const J={...Gd,K,W,hx:new Int32Array(nx*ny),fx:new Int32Array(N).fill(-1),fy:new Int32Array(N),d2:new Float32Array(N).fill(Infinity),D:new Float32Array(nx*ny),seg:new Map()};
  const last=upto==null?SF_STAGES.length:upto;
  for(let st=0;st<last;st++)for(let y=0;y<ny;y+=16)SF_STAGES[st](J,y,Math.min(ny,y+16));
  /* brute force: the nearest land hex's outline, over every land hex */
  const exact=(x,y)=>{let m=Infinity;for(let i=0;i<MAP.N;i++)if(MAP.T[i]>=2){const v=sfHexOut(x,y,i);if(v<m)m=v;}return m;};
  return {MAP,MAP_PW,J,exact,sfHexOut,SF_EXACT,SF_LV,SF_WL};`)(cols, rows, land, upto);

const C = 40, R = 30;
/* an island in the middle, and a small one by the east edge (its sea reaches round the globe to the west edge) */
const isle = (c, r) => (Math.abs(c - 18) <= 4 && Math.abs(r - 14) <= 3) || (c === 39 && r >= 8 && r <= 9);

test('a point inside a hex is 0 from it; outside, the distance to its outline', () => {
  const M = make(C, R, isle, 0), h = 14 * C + 18, x = M.MAP.cx[h], y = M.MAP.cy[h], ri = Math.sqrt(3) * 5;
  assert.equal(M.sfHexOut(x, y, h), 0);
  assert.equal(M.sfHexOut(x + ri - 0.1, y, h), 0);
  assert.ok(Math.abs(M.sfHexOut(x + ri + 3, y, h) - 3) < 1e-9, 'straight out from an upright edge');
  assert.ok(Math.abs(M.sfHexOut(x, y - 10 - 4, h) - 4) < 1e-9, 'straight out from the top corner');
  assert.ok(Math.abs(M.sfHexOut(x, y + 10 + 4, h) - 4) < 1e-9, 'and the bottom one');
});

test('near the coasts the field is the exact distance to the land; inside the land it is negative', () => {
  const M = make(C, R, isle, 4), J = M.J;
  let near = 0, inland = 0;
  for (let y = 0; y < J.ny; y += 3) for (let x = 0; x < J.nx; x += 3) {
    const d = J.D[y * J.nx + x], X = x * J.gx, Y = y * J.gy, e = M.exact(X, Y);
    if (e === 0) { assert.ok(d <= 0, `inside the land at ${X},${Y}: ${d}`); inland++; continue; }
    if (e < M.SF_EXACT - 1) { assert.ok(Math.abs(d - e) < 1e-3, `near the coast at ${X},${Y}: ${d} against ${e}`); near++; }
    /* out at sea, the distance to the nearest land point of the grid: at most about a step and a half further */
    else assert.ok(d >= e - 1e-3 && d - e < 1.5 * J.gx, `out at sea at ${X},${Y}: ${d} against ${e}`);
  }
  assert.ok(near > 50 && inland > 20, `points checked: ${near} near, ${inland} inland`);
});

test('distances reach across the globe’s seam', () => {
  const M = make(C, R, isle, 4), J = M.J, y = Math.round(M.MAP.cy[8 * C + 39] / J.gy);
  /* the west edge's points, next to the island on the east edge */
  const d = J.D[y * J.nx + 1], e = M.exact(1 * J.gx, y * J.gy);
  assert.ok(e < 15, 'the island lies just over the seam: ' + e);
  assert.ok(Math.abs(d - e) < 1e-3, `${d} against ${e}`);
});

test('the contours lie on their levels', () => {
  const M = make(C, R, isle), J = M.J;
  const levels = new Map();
  for (const [key, A] of J.seg) {
    const l = key >> 16, v = M.SF_LV[l];
    levels.set(l, (levels.get(l) || 0) + A.length / 4);
    if (l >= M.SF_WL.length) continue; /* the depth contours lie in the blurred field, by design */
    for (let i = 0; i < A.length; i += 2) { const e = M.exact(A[i], A[i + 1]); assert.ok(Math.abs(e - v) < 1.2, `a ${v} line at ${A[i]},${A[i + 1]} is ${e} from land`); }
  }
  for (let l = 0; l < M.SF_WL.length; l++) assert.ok(levels.get(l) > 20, 'water line ' + l + ' is drawn');
  assert.ok(levels.get(M.SF_WL.length) > 10, 'and the first depth contour');
});

test('a map with no land gives no contours and no nearest land', () => {
  const M = make(12, 10, () => false), J = M.J;
  assert.equal(J.seg.size, 0);
  assert.ok(J.D.every(d => d >= 1e4));
});
