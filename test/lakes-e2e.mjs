// Lakes (PR "lake claims"): a lake, water shut in by land, is claimed like land through the map's own panels, and the
// nation's colour lies over it at LAKE_A of the usual strength, so the water shows through.
// Run with: npm run test:lakes, or against a static build of public/ with BROWSER_ONLY=1 BASE_URL=http://127.0.0.1:<port>
import { player, open, check, finish, sleep, until, nav, text, OUT } from './lib.mjs';
const p = await player('lake', { vp: { width: 1280, height: 900 }, inject: !process.env.BROWSER_ONLY });
await open(p);
await p.waitForSelector('#d-name');
await p.fill('#d-name', 'Mereland');
await p.click('#found-btn');
await p.waitForSelector('.layout', { timeout: 15000 });
await sleep(500);

/* a free lake of 4 to 14 hexes, all of it shallow, and a shore hex beside it to settle on. The candidates are listed in one go
   and the game's own placement check runs once per call (one long evaluate can hold the page past Firestore's patience) */
const cands = await p.evaluate(() => {
  const M = G.MAP, T = G.territory(), L = G.LK.lakeMap(), seen = new Set(), out = [];
  for (let c = 0; c < M.N; c++) {
    if (!L[c] || seen.has(c)) continue; const cells = [c]; seen.add(c);
    for (let q = 0; q < cells.length; q++) for (let d = 0; d < 6; d++) { const j = M.nbr[cells[q] * 6 + d]; if (j >= 0 && L[j] && !seen.has(j)) { seen.add(j); cells.push(j); } }
    if (cells.length < 4 || cells.length > 14 || cells.some(x => M.T[x] !== 1 || T.owner[x] !== -1)) continue;
    const shore = new Set(); for (const x of cells) for (let d = 0; d < 6; d++) { const j = M.nbr[x * 6 + d]; if (j >= 0 && M.T[j] >= 2 && M.T[j] < 4 && T.owner[j] === -1) shore.add(j); }
    for (const s of shore) out.push({ cap: s, lake: cells });
    if (out.length > 300) break;
  }
  return out;
});
let spot = null;
for (const c of cands) { if (!(await p.evaluate(m => G.MD.pickProblem(m, G.territory()), c.cap))) { spot = c; break; } }
if (!spot) throw new Error(`no free lake with a shore to settle on in this region (${cands.length} candidates)`);
await nav(p, 'map');
await p.evaluate(c => { G.S.mapPick = c; G.render(); }, spot.cap);
await p.click('[data-act="settle"]');
await until(() => p.evaluate(() => G.S.nation.loc && G.territory().byId[G.myId()] !== undefined));
await p.evaluate(() => { const n = G.clone(G.S.nation); delete n.onb; n.lcb = (n.lcb || 0) + 80; G.commit(n); G.render(); });
console.log('settled at', spot.cap, 'beside a lake of', spot.lake.length, 'hexes');

const facts = await p.evaluate(lake => {
  const T = G.territory(), fr = G.LK.claimFrontier(T), me = T.byId[G.myId()];
  return { lakes: lake.every(c => G.LK.isLake(c)), free: lake.every(c => G.LK.freeCell(T, c)), reach: lake.filter(c => fr.has(c)), auto: G.LK.autoPlan(T, 40).filter(c => G.MAP.T[c] < 2).length, credits: G.LK.landCredits(G.S.nation), held: T.count[me] };
}, spot.lake);
console.log('before', JSON.stringify(facts));
check('every hex of the lake is a lake and free to claim', facts.lakes && facts.free);
check('the lake hexes beside your land are on the claim frontier', facts.reach.length > 0, JSON.stringify(facts.reach));
check('spending credits for you never takes a lake', facts.auto === 0);

/* the map's pixels at the middle of each lake hex, seen from one fixed view with no credits to spend (so no claimable
   blocks are shaded): taken before and after the lake is claimed, they give the strength of the colour laid over it */
/* paused land credits (Settings › Land) count as none to spend, so no claimable block is shaded */
const zeroCredits = async () => { await p.evaluate(() => { const n = G.clone(G.S.nation); n.lcp = Date.now(); G.commit(n); G.S.mapClaim = null; G.S.mapCell = null; G.S.mapInspect = null; G.render(); }); await sleep(300); return 0; };
const giveCredits = () => p.evaluate(() => { const n = G.clone(G.S.nation); delete n.lcp; G.commit(n); G.render(); });
const sample = async lake => {
  const out = [];
  for (const c of lake) {
    await p.evaluate(c => { G.MD.centerMain(c, 16); G.render(); }, c); await sleep(250);
    out.push(await p.evaluate(() => {
      if (G.LK.landCredits(G.S.nation)) throw new Error('land credits to spend would shade the claimable blocks');
      const cv = document.querySelector('canvas[data-map="main"]'), d = cv.width / cv.clientWidth;
      return [...cv.getContext('2d').getImageData(Math.round((cv.clientWidth / 2 + 3) * d), Math.round((cv.clientHeight / 2 + 3) * d), 1, 1).data].slice(0, 3);
    }));
  }
  return out;
};
const spare = await zeroCredits();
const P0 = await sample(spot.lake);
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/lake-free.png' });
await giveCredits(spare);

/* click a lake hex beside your land: the land office offers it like land */
const clickOn = async c => {
  await p.evaluate(c => { G.MD.centerMain(c, 12); G.render(); }, c); await sleep(250);
  const cv = p.locator('canvas[data-map="main"]'); await cv.scrollIntoViewIfNeeded();
  const pos = await p.evaluate(c => { const cv = document.querySelector('canvas[data-map="main"]'), v = G.MD.viewOf('main', cv), s = G.MD.mapScale(cv, v); return { x: cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, c);
  await cv.click({ position: pos }); await sleep(300);
};
const first = facts.reach[0];
let panel = '';
for (let i = 0; i < 3 && !/A free lake in/.test(panel); i++) { if (i) await sleep(700); await clickOn(first); panel = await text(p, '#map-panel'); }
check('a click on a free lake opens the land office for it', /A free lake in/.test(panel) && /lake \(\d+\)/.test(panel), panel.slice(0, 300));
const one = (await p.locator('#map-panel [data-act="lc-one"]').count()) ? 'lc-one' : 'lc-block';
await p.click(`#map-panel [data-act="${one}"]`); await sleep(400);
const after1 = await p.evaluate(c => { const T = G.territory(); return { mine: T.owner[c] === T.byId[G.myId()], toast: [...document.querySelectorAll('.toast, [role="status"]')].map(e => e.textContent).join(' | ') }; }, first);
check('the lake hex is claimed', after1.mine, JSON.stringify(after1));

/* the tile inspector speaks of a lake, held by you */
await clickOn(first);
const insp = await text(p, '#map-panel');
check('the tile details name the lake and its holder', /Lake in|A lake in/.test(insp) && /You, claimed on/.test(insp), insp.slice(0, 400));

/* claim the rest of the lake and its shore, nearest first, so it lies inside your borders */
const rest = await p.evaluate(lake => {
  const M = G.MAP, T = G.territory(), me = T.byId[G.myId()], want = new Set(lake);
  for (const c of lake) for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && M.T[j] >= 2 && T.owner[j] === -1) want.add(j); }
  const order = [], have = new Set(); for (let c = 0; c < M.N; c++) if (T.owner[c] === me) have.add(c);
  for (let pass = 0; pass < 20 && want.size; pass++) for (const c of [...want]) { let j = false; for (let d = 0; d < 6 && !j; d++) j = have.has(M.nbr[c * 6 + d]); if (j && G.LK.freeCell(T, c)) { order.push(c); have.add(c); want.delete(c); } else if (!G.LK.freeCell(T, c)) want.delete(c); }
  const ok = G.LK.writeClaims(order, '');
  const T2 = G.territory(), i = T2.byId[G.myId()];
  return { ok, n: order.length, lakeHeld: lake.filter(c => T2.owner[c] === i).length, held: T2.count[i] };
}, spot.lake);
console.log('rest', JSON.stringify(rest));
check('the whole lake can be claimed with its shore', rest.ok && rest.lakeHeld === spot.lake.length, JSON.stringify(rest));
check('the lake counts towards the hexes you hold', rest.held >= facts.held + spot.lake.length);

/* the colour over the lake: per hex, how far the pixel moved from the water towards the nation's colour */
await zeroCredits();
const P1 = await sample(spot.lake);
const tint = await p.evaluate(([P0, P1]) => {
  const rgb = h => { const x = h.trim().replace('#', ''); const f = x.length === 3 ? x.split('').map(q => q + q).join('') : x; return [0, 2, 4].map(k => parseInt(f.slice(k, k + 2), 16)); };
  const T = G.territory(), C = rgb(T.list[T.byId[G.myId()]].col), ta = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--terr-a')) || 0.5;
  const est = P0.map((a, h) => { const k = [0, 1, 2].sort((x, y) => Math.abs(C[y] - a[y]) - Math.abs(C[x] - a[x]))[0]; return Math.abs(C[k] - a[k]) < 40 ? null : (P1[h][k] - a[k]) / (C[k] - a[k]); }).filter(e => e != null).sort((a, b) => a - b);
  return { median: est[est.length >> 1], est: est.map(e => +e.toFixed(3)), want: +(ta * G.LK.LAKE_A).toFixed(3), land: ta };
}, [P0, P1]);
console.log('tint', JSON.stringify(tint));
/* (a hex under the capital's name reads higher, and drifting weather shifts a reading a little: the median, within a band
   well under the land's own strength) */
check('the lake is washed at about LAKE_A of the land\'s strength, so the water shows through', tint.est.length >= 5 && Math.abs(tint.median - tint.want) < 0.09 && tint.median < tint.land * 0.7, JSON.stringify(tint));
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/lake-held.png' });
await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; G.render(); }); await sleep(500);
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/lake-held-dark.png' });
await p.evaluate(() => { delete document.documentElement.dataset.theme; G.render(); }); await sleep(200);
finish();
