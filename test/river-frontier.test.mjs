// The rivers of a region that grew (the frontier, 19 Nov 2026; "The rivers of a region that grew" in game/edictum.html).
// Made afresh on the wider grid, the charted map's rivers came out elsewhere, and the names players had given them
// no longer found them. The charted map's rivers are made on the charted map again (rvChartOf), as every page made
// them before the frontier, and joined on the wider grid with the new land's own (rvJoin). Checked with the game's
// own generators, cut from its source: the charted part is the network the pre-frontier build made, to the corner
// (its fingerprint was taken from that build, 79c8139); the new land keeps what the wider grid gave it.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = i < 0 ? -1 : src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = re => { const m = src.match(re); assert.ok(m, `source has ${re}`); return m[0]; };
// one function of the game by name, to its closing brace
function fn(head) {
  const at = src.indexOf('\n' + head); assert.ok(at >= 0, head + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
// the map generators (as scripts/bake-maps.mjs takes them), the helpers the rivers use, and the rivers
const CODE = [
  cut('const LEG={', '/* a stable key for per-hex randomness'),
  cut('/* hex geometry for a grid', '/* older Meridian records (map version 2)'),
  cut('const HEX_R=10,', '\nconst MAP=bakedMap()'),
  line(/^function hash\(str\)\{[^\n]+/m), line(/^const clamp = [^\n]+/m), line(/^function rng\(seed\)\{[^\n]+/m),
  cut('const NPCS_MER = [', '\n];') + '\n];', cut('const NPC_CITY_DEF={', '\n};') + '\n};',
  cut('/* ───────── Round 10, A: rivers and lakes', '\nlet RV=null'),
  fn('function* rvBuildIt('),
  'const MAP=REG_MER?embedFrontier(REG,embedLegacy(legacyMap())):genRegionMap(REG);',
  'const CHART=REG_MER?embedLegacy(legacyMap()):genChartMap(REG);',
  'const run=it=>{for(;;){const r=it.next();if(r.done)return r.value;}};',
  'return {REG,MAP,CHART,CHART_COLS,CHART_ROWS,MAP_COLS,rvGen,rvAssemble,rvChartOf,run,build:()=>run(rvBuildIt({...MAP},REG))};'
].join('\n');
function kit(region) {
  const store = { 'statehood.nation.v1': JSON.stringify({ name: 'Tester', reg: region }) };
  const k = new Function('localStorage', 'window', CODE)({ getItem: x => Object.prototype.hasOwnProperty.call(store, x) ? store[x] : null }, {});
  assert.equal(k.REG.id, region);
  return k;
}
const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const fingerprint = A => fnv(A.list.map(r => `${r.verts.join(',')}|${r.cls}|${r.parent}|${r.name}`).join(';') + '#' + A.lakes.map(l => `${l.cells.join(',')}|${l.name}|${l.river}`).join(';'));
/* the river networks the pre-frontier build (79c8139) made: rivers, lakes, fingerprint. Changing the river generators
   moves every river of every region, and every name players gave goes with them: never update these lightly */
const BEFORE = { meridian: [470, 3, 'f42546e4'], greywater: [441, 4, '53311bfb'] };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const region of Object.keys(BEFORE)) {
  test(`${region}: the charted map's rivers are the ones it had before the frontier, and the new land keeps its own`, () => {
    const K = kit(region), oc = K.CHART_COLS, nc = K.MAP_COLS, N = K.MAP.N, ch = K.MAP.chart;
    assert.ok(nc > oc, region + ' grew');
    const fc = c => Math.floor(c / oc) * nc + (c % oc), fv = v => 2 * fc(v >> 1) + (v & 1);
    /* the charted grid made from the wider map is the charted map, for everything the rivers read */
    const G0 = K.rvChartOf({ ...K.MAP });
    for (const f of ['COLS', 'ROWS', 'N']) assert.equal(G0[f], K.CHART[f], f);
    for (const f of ['T', 'coast', 'comp', 'nbr', 'cx', 'cy']) assert.ok(eq(Array.from(G0[f]), Array.from(K.CHART[f])), f);
    assert.ok(eq(G0.comps.map(c => c.size), K.CHART.comps.map(c => c.size)), 'landmasses');
    assert.ok(eq(G0.npcLoc, K.CHART.npcLoc), 'computer capitals');
    assert.ok(eq(G0.leg ? Array.from(G0.leg) : null, K.CHART.leg ? Array.from(K.CHART.leg) : null), 'legacy keys');
    const A0 = K.rvAssemble(K.rvGen(G0, K.REG), K.REG);
    assert.deepEqual([A0.list.length, A0.lakes.length, fingerprint(A0)], BEFORE[region], 'the network the pre-frontier build made');

    const J = K.build(), W = K.rvAssemble(K.rvGen({ ...K.MAP }, K.REG), K.REG);
    /* the charted part: the same rivers under the same numbers, every corner and hex moved to the wider rows */
    A0.list.forEach((r, k) => { const j = J.list[k];
      for (const f of ['id', 'name', 'kind', 'cls', 'parent', 'len', 'acc', 'pts', 'w', 'tail']) assert.ok(eq(r[f], j[f]), `river ${k} ${f}`);
      assert.ok(eq(r.verts.map(fv), j.verts) && eq(r.bk.map(fc), j.bk) && eq(r.cells.map(fc), j.cells) && fv(r.end) === j.end, `river ${k} on the wider rows`); });
    A0.lakes.forEach((L, k) => { const M = J.lakes[k]; assert.ok(eq([L.name, L.x, L.y, L.river, L.tarn, L.cells.map(fc)], [M.name, M.x, M.y, M.river, M.tarn, M.cells]), 'lake ' + k); });
    for (let i = 0; i < G0.N; i++) { const j = fc(i);
      assert.ok(A0.bank[i] === J.bank[j] && A0.bonus[i] === J.bonus[j] && A0.at.get(i) === J.at.get(j), 'valley and banks at ' + i);
      for (let d = 0; d < 6; d++) assert.equal(J.E6[j * 6 + d], A0.E6[i * 6 + d], `crossing ${i}/${d}`); }
    /* the new land: the wider grid's own rivers, which never reach the charted map */
    const mine = W.list.filter(r => ch[r.cells[0]] < 0), extra = J.list.slice(A0.list.length);
    assert.ok(W.list.every(r => r.cells.every(c => (ch[c] < 0) === (ch[r.cells[0]] < 0))), 'no river runs from the charted map into the new land');
    assert.ok(eq(mine.map(r => r.verts), extra.map(r => r.verts)), 'the new land keeps its rivers');
    assert.ok(extra.every((r, k) => r.id === A0.list.length + k && (r.parent < 0 || (r.parent >= A0.list.length && r.parent < J.list.length))), 'numbered after the charted ones');
    assert.ok(J.lakes.slice(A0.lakes.length).every(L => L.cells.every(c => ch[c] < 0)), 'the new land keeps its lakes');
    /* the map's every crossing and bank stands for one river of the list */
    let edges = 0; for (let i = 0; i < N * 6; i++) if (J.E6[i]) { edges++; assert.ok(J.E6[i] <= J.list.length); }
    assert.equal(edges, 2 * J.list.reduce((s, r) => s + r.len, 0), 'each edge of a river, from both banks');
    for (const [c, id] of J.at) assert.ok(J.list[id].cells.includes(c), 'at ' + c);
    for (const [c, id] of J.lakeAt) assert.ok(J.lakes[id].cells.includes(c) && J.lake.has(c), 'lake at ' + c);
    /* one name, one river or lake: the new land's, where the wider grid gave it a charted one's name, has its own */
    const names = J.list.map(r => r.name).concat(J.lakes.map(l => l.name)).filter(Boolean);
    assert.equal(new Set(names).size, names.length, 'no name twice: ' + names.filter((n, i) => names.indexOf(n) !== i));
    /* every charted river the wider grid made leads to a river, unless none runs anywhere near it */
    const key = r => r.verts[r.verts.length - 2];
    let led = 0, near = 0;
    for (const r of W.list) { if (ch[r.cells[0]] < 0) continue; const id = J.fz.get(key(r));
      if (id === undefined) continue; led++; assert.ok(id >= 0 && id < A0.list.length, 'to a charted river');
      const ring = new Set(); for (const c of J.list[id].cells) { ring.add(c); for (let d = 0; d < 6; d++) ring.add(K.MAP.nbr[c * 6 + d]); }
      if (r.cells.some(c => ring.has(c))) near++; }
    assert.equal(near, led, 'each to a river beside it');
    assert.ok(led > 0.75 * W.list.filter(r => ch[r.cells[0]] >= 0).length, 'nearly all lead somewhere');
  });
}
