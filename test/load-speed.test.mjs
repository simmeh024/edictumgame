// Faster loads (2026-11-23), the parts that run without a page: the river network kept between visits ("Kept between
// visits" in game/edictum.html). A network kept by one page must be taken by the next exactly as the generators make
// it, and only under its own key: the river code's fingerprint (build.py, RV_SOURCE) and the map it is made from.
// Checked with the game's own generators and cache code, cut from its source, and a stand-in for IndexedDB.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = i < 0 ? -1 : src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = re => { const m = src.match(re); assert.ok(m, `source has ${re}`); return m[0]; };
function fn(head) {
  const at = src.indexOf('\n' + head); assert.ok(at >= 0, head + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
// the map generators, the helpers the rivers use, the rivers, and the code that keeps and takes them
const CODE = sig => [
  cut('const LEG={', '/* a stable key for per-hex randomness'),
  cut('/* hex geometry for a grid', '/* older Meridian records (map version 2)'),
  cut('const HEX_R=10,', '\nconst MAP=bakedMap()'),
  line(/^function hash\(str\)\{[^\n]+/m), line(/^const clamp = [^\n]+/m), line(/^function rng\(seed\)\{[^\n]+/m),
  cut('const NPCS_MER = [', '\n];') + '\n];', cut('const NPC_CITY_DEF={', '\n};') + '\n};',
  cut('/* ───────── Round 10, A: rivers and lakes', '\nlet RV=null'),
  fn('function* rvBuildIt('),
  'const MAP=REG_MER?embedFrontier(REG,embedLegacy(legacyMap())):genRegionMap(REG);',
  'const MAP_T0=MAP.T.slice();',
  cut('const RV_SIG=', '\n/* run the job for about').replace("/*RV_SIG*/''", JSON.stringify(sig)),
  'const run=it=>{for(;;){const r=it.next();if(r.done)return r.value;}};',
  'return {REG,MAP,MAP_T0,rvCacheKey,rvCached,rvStore,build:()=>run(rvBuildIt({...MAP,T:MAP_T0},REG))};'
].join('\n');
/* a stand-in for the game's IndexedDB (rlfDB): put keeps a structured clone, as the browser does */
function kit(region, { sig = 'test-sig', geo } = {}) {
  const store = { 'statehood.nation.v1': JSON.stringify({ name: 'Tester', reg: region }) }, kept = new Map();
  const db = { transaction: () => { const t = { objectStore: () => ({ put: (v, k) => { kept.set(k, structuredClone(v)); setTimeout(() => t.oncomplete && t.oncomplete(), 0); } }) }; return t; } };
  const win = { indexedDB: {}, __edictum: {} };
  const code = CODE(sig).replace('const MAP=REG_MER', (geo ? `Object.assign(REG.geo,${JSON.stringify(geo)});` : '') + 'const MAP=REG_MER');
  const k = new Function('localStorage', 'window', 'rlfDB', code)(
    { getItem: x => Object.prototype.hasOwnProperty.call(store, x) ? store[x] : null, setItem: (x, v) => { store[x] = String(v); } },
    win, () => Promise.resolve(db));
  assert.equal(k.REG.id, region);
  return { ...k, kept, win, store };
}
/* until the stand-in's transaction has completed (its put clones a few megabytes first) */
const settled = async K => { for (let i = 0; i < 100 && !K.store['edictum.rv']; i++) await new Promise(r => setTimeout(r, 20)); };
/* the network as the rest of the game sees it: everything rvAssemble (or rvJoin) gives, but the generator's own working (X) */
const strip = A => { const { X, R, ms, slices, longest, steps, cached, ...rest } = A; return rest; };

for (const region of ['meridian', 'frostmarch']) {
  test(`${region}: the network kept by one page is the one the next page takes, exactly`, async () => {
    const K = kit(region), A = K.build();
    K.rvStore(A);
    /* what rvFinish then does to the network does not reach the copy being kept */
    A.list[0].name0 = A.list[0].name; A.list[0].by = null;
    await settled(K);
    const rec = K.kept.get('rv:' + region);
    assert.ok(rec, 'kept under the region');
    assert.equal(K.store['edictum.rv'], region, 'the stub is told which region to read');
    assert.equal(rec.k, K.rvCacheKey());
    assert.ok(!('name0' in rec.list[0]), 'kept as made');
    /* the next page: the stub's read hands the game another structured clone */
    K.win.__edictum.rv = structuredClone(rec);
    const B = K.rvCached();
    assert.ok(B, 'taken');
    assert.equal(K.win.__edictum.rv, null, 'and let go of');
    assert.equal(B.R, K.REG);
    const fresh = K.build();
    assert.deepStrictEqual(strip(B), strip(fresh));
    assert.equal(B.E6.constructor, Int32Array); assert.equal(B.bonus.constructor, Float32Array); assert.equal(B.bank.constructor, Int8Array);
    assert.ok(B.at instanceof Map && B.lake instanceof Set && B.lakeAt instanceof Map);
    if (fresh.fz) assert.ok(B.fz instanceof Map && B.fz.size === fresh.fz.size, 'a region that grew keeps its names\' map');
  });
}

test('a kept network is taken only under this page\'s key and in its own shape', async () => {
  const K = kit('meridian'), A = K.build();
  K.rvStore(A); await settled(K);
  const rec = K.kept.get('rv:meridian');
  const take = r => { K.win.__edictum.rv = structuredClone(r); return K.rvCached(); };
  assert.ok(take(rec));
  assert.equal(take({ ...rec, k: rec.k + 'x' }), null, 'another key');
  assert.equal(take({ ...rec, E6: new Int32Array(10) }), null, 'a short edge table');
  assert.equal(take({ ...rec, E6: Array.from(rec.E6) }), null, 'an edge table of the wrong kind');
  assert.equal(take({ ...rec, at: [...rec.at] }), null, 'river by hex not a Map');
  assert.equal(take({ ...rec, list: null }), null, 'no rivers');
  K.win.__edictum.rv = null; assert.equal(K.rvCached(), null, 'nothing read');
});

test('the key changes with the river code, the region and the map the network is made from', () => {
  const key = o => kit('meridian', o).rvCacheKey();
  const base = key();
  assert.equal(key(), base, 'the same page makes the same key');
  assert.notEqual(key({ sig: 'other-sig' }), base, 'the river code (RV_SIG)');
  assert.notEqual(kit('frostmarch').rvCacheKey(), base, 'the region');
  assert.notEqual(key({ geo: { wet: 0.31 } }), base, 'the region\'s climate');
  /* the terrain: one hex changed in the original map */
  const K = kit('meridian'), before = K.rvCacheKey();
  const K2 = kit('meridian'); const i = K2.MAP_T0.findIndex(t => t === 2); K2.MAP_T0[i] = 3;
  assert.notEqual(K2.rvCacheKey(), before, 'the terrain');
});

test('build.py fingerprints the source the network comes from, and the game marks where it goes', () => {
  const py = readFileSync(new URL('../build.py', import.meta.url), 'utf8');
  const block = py.match(/RV_SOURCE = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'build.py has RV_SOURCE');
  const unpy = s => s.replace(/\\n/g, '\n').replace(/\\'/g, "'");
  const pairs = [...block[1].matchAll(/\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\)/g)].map(m => [unpy(m[1]), unpy(m[2])]);
  assert.ok(pairs.length >= 8, 'its parts');
  for (const [a, b] of pairs) { const i = src.indexOf(a); assert.ok(i >= 0 && src.indexOf(b, i + a.length) > i, `the game has ${a} … ${JSON.stringify(b)}`); }
  assert.ok(pairs.some(([a]) => a.startsWith('/* ───────── Round 10, A: rivers')) && pairs.some(([a]) => a === 'function* rvBuildIt('), 'the rivers and rvBuildIt');
  assert.equal(src.split("/*RV_SIG*/''").length, 2, 'one mark');
});
