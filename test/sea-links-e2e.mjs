// Land across the sea (PR "sea links"): harbours reach across bays and further with a navy, the map explains land out of
// reach and can shade harbour reach, provinces move whole islands, and a claimed hex can be swapped once a day.
// Run with: npm run test:sea-links, or against a static build of public/ with BROWSER_ONLY=1 BASE_URL=http://127.0.0.1:<port>
import { player, open, check, finish, sleep, until, nav, text, OUT } from './lib.mjs';
const p = await player('sea', { vp: { width: 1280, height: 900 }, inject: !process.env.BROWSER_ONLY });
await open(p);
await p.waitForSelector('#d-name');
await p.fill('#d-name', 'Saltmarsh');
await p.click('#found-btn');
await p.waitForSelector('.layout', { timeout: 15000 });
await sleep(500);

/* a settling spot on a big coast with a small free island 7 to 10 hexes off. The candidates are listed in one go and the
   game's own placement check runs once per call: run all at once, the checks held the page long enough (over ten
   seconds) for Firestore to report its backend unreachable */
const cands = await p.evaluate(() => {
  const M = G.MAP, T = G.territory(), size = new Map(), out = [];
  for (let c = 0; c < M.N; c++) { const k = M.comp[c]; if (k >= 0) size.set(k, (size.get(k) || 0) + 1); }
  const hexDist = (a, b) => { const C = M.COLS, ar = Math.floor(a / C), ac = a % C, br = Math.floor(b / C), bc = b % C; const dq = (ac - (ar - (ar & 1)) / 2) - (bc - (br - (br & 1)) / 2), dr = ar - br; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
  const coastal = c => { for (let d = 0; d < 6; d++) { const v = M.nbr[c * 6 + d]; if (v >= 0 && M.T[v] < 2) return true; } return false; };
  const isles = new Set([...size].filter(([k, s]) => s >= 2 && s <= 7).map(([k]) => k));
  const isleCells = new Map(); for (let c = 0; c < M.N; c++) if (isles.has(M.comp[c])) (isleCells.get(M.comp[c]) || isleCells.set(M.comp[c], []).get(M.comp[c])).push(c);
  const coast = []; for (let m = 0; m < M.N; m++) if (M.T[m] >= 2 && T.owner[m] === -1 && (size.get(M.comp[m]) || 0) >= 150 && coastal(m)) coast.push(m);
  for (const [k, cells] of isleCells) {
    if (cells.some(c => T.owner[c] !== -1)) continue;
    for (const m of coast) { const d = hexDist(m, cells[0]); if (d >= 7 && d <= 10) { out.push({ cap: m, isle: cells, k }); if (out.length >= 400) return out; } }
  }
  return out;
});
let spot = null;
for (const c of cands) { if (!(await p.evaluate(m => G.MD.pickProblem(m, G.territory()), c.cap))) { spot = c; break; } }
if (!spot) throw new Error(`no coastal spot near a small island in this region (${cands.length} candidates)`);
await nav(p, 'map');
await p.evaluate(c => { G.S.mapPick = c; G.render(); }, spot.cap);
await p.click('[data-act="settle"]');
await until(() => p.evaluate(() => G.MD.landCredits && G.S.nation.loc && G.territory().byId[G.myId()] !== undefined));
await p.evaluate(() => { if (G.S.nation.onb) { const n = G.clone(G.S.nation); delete n.onb; G.commit(n); G.render(); } });
console.log('settled at', spot.cap, 'island', spot.isle.length, 'hexes');

/* a harbour city on the coast, a far island claimed outright, and the capital's land spread a little */
const setup = await p.evaluate(({ cap, isle }) => {
  const T = G.territory(), me = T.byId[G.myId()], M = G.MAP, now = Date.now();
  const n = G.clone(G.S.nation);
  n.cities = (n.cities || []).map(c => c.c === cap ? { ...c, b: (c.b || []).concat({ k: 'harbour', d: now - 1000, t: now - 5000 }) } : c);
  if (!n.cities.some(c => c.c === cap)) return { err: 'no capital city record', cities: n.cities };
  n.claims = (n.claims || []).concat(isle.map((c, k) => ({ c, t: now - 100000 + k })));
  n.lcb = (n.lcb || 0) + 40;
  G.commit(n); G.render();
  const T2 = G.territory(), j = T2.byId[G.myId()];
  return { held: T2.count[j], isleHeld: isle.every(c => T2.owner[c] === j), harbours: G.SL.mpHarbours(T2).length, reach: G.SL.mpHarbourReach(G.S.nation) };
}, spot);
console.log('setup', JSON.stringify(setup));
check('setup: the far island is held and the capital has a finished harbour', setup.isleHeld && setup.harbours === 1);

/* idea 2: the harbour frontier includes shores on the capital's own landmass across water */
const reachInfo = await p.evaluate(cap => {
  const T = G.territory(), fr = G.MD.mpHarbourFrontier(T), M = G.MAP; let same = 0, other = 0, touching = 0, me = T.byId[G.myId()];
  for (const c of fr.keys()) { if (M.comp[c] === M.comp[cap]) same++; else other++; for (let d = 0; d < 6; d++) { const v = M.nbr[c * 6 + d]; if (v >= 0 && T.owner[v] === me) { touching++; break; } } }
  return { same, other, touching, total: fr.size };
}, spot.cap);
console.log('harbour frontier', JSON.stringify(reachInfo));
check('harbour frontier never lists shores already next to your land', reachInfo.touching === 0);

/* idea 4: a navy stretches the reach */
const navy = await p.evaluate(() => { const before = G.MD.mpHarbourFrontier(G.territory()).size; const n = G.clone(G.S.nation); n.policies = { ...(n.policies || {}), navalFleet: 1 }; G.commit(n); G.render(); const after = G.MD.mpHarbourFrontier(G.territory()).size; return { before, after, reach: G.SL.mpHarbourReach(G.S.nation) }; });
console.log('navy', JSON.stringify(navy));
check('the Blue-Water Navy raises harbour reach to six and reaches more shore', navy.reach === 6 && navy.after >= navy.before);

/* idea 6: the harbour reach toggle and the inspector's reason */
await nav(p, 'map');
await p.evaluate(c => { G.MD.centerMain(c, 4); G.render(); }, spot.cap);
const tog = p.locator('[data-mp-opt="reach"]');
check('the map key offers Harbour reach once you hold a finished harbour', await tog.count() === 1);
if (await tog.count()) { await tog.check(); await sleep(400); }
await p.locator('canvas[data-map="main"]').scrollIntoViewIfNeeded();
await p.screenshot({ path: OUT + '/reach-on.png' });
const why = await p.evaluate(cap => {
  const T = G.territory(), M = G.MAP, fr = G.MD.claimFrontier(T), out = {};
  for (let c = 0; c < M.N && Object.keys(out).length < 3; c++) {
    if (M.T[c] < 2 || T.owner[c] !== -1 || fr.has(c) || T.isCap[c]) continue;
    const coastal = (() => { for (let d = 0; d < 6; d++) { const v = M.nbr[c * 6 + d]; if (v >= 0 && M.T[v] < 2) return true; } return false; })();
    const w = G.SL.claimWhy(T, c);
    const key = /too far/.test(w) ? 'far' : /inland/.test(w) ? 'inland' : /none of your harbours/.test(w) ? 'none' : 'other';
    if (!out[key] && Math.abs(M.cx[c] - M.cx[cap]) < 400) out[key] = w;
  }
  return out;
}, spot.cap);
check('the inspector explains a shore just out of harbour reach', !!why.far && /hexes across water from your harbour at .+ Your harbours reach 6/.test(why.far));
check('the inspector explains inland land', !!why.inland);

/* idea 1 + 3: provinces with the far island */
const shotAt = async (kind, c, name, w = 420, h = 320) => {
  const cv = p.locator(`canvas[data-map="${kind}"]`); await cv.scrollIntoViewIfNeeded();
  const pos = await p.evaluate(([kind, c]) => { const cv = document.querySelector(`canvas[data-map="${kind}"]`), v = G.MD.viewOf(kind, cv), s = G.MD.mapScale(cv, v), r = cv.getBoundingClientRect(); return { x: r.left + cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: r.top + cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, [kind, c]);
  await p.screenshot({ path: OUT + '/' + name + '.png', clip: { x: Math.max(0, pos.x - w / 2), y: Math.max(0, pos.y - h / 2), width: w, height: h } });
};
const clickOn = async (kind, c) => {
  if (kind === 'main') { await p.evaluate(c => { G.MD.centerMain(c, 12); G.render(); }, c); await sleep(200); }
  const cv = p.locator(`canvas[data-map="${kind}"]`); await cv.scrollIntoViewIfNeeded();
  const pos = await p.evaluate(([kind, c]) => { const cv = document.querySelector(`canvas[data-map="${kind}"]`), v = G.MD.viewOf(kind, cv), s = G.MD.mapScale(cv, v); return { x: cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, [kind, c]);
  await cv.click({ position: pos }); await sleep(250);
};
await p.evaluate(() => { G.SL.prvSwitch(true); });
await sleep(300);
const sec = await p.evaluate(cap => {
  const T = G.territory(), i = T.byId[G.myId()], M = G.MAP; let best = -1, bd = 0;
  for (let c = 0; c < M.N; c++) if (T.owner[c] === i && M.comp[c] === M.comp[cap]) { const d = Math.hypot(M.cx[c] - M.cx[cap], M.cy[c] - M.cy[cap]); if (d > bd) { bd = d; best = c; } }
  return best;
}, spot.cap);
await nav(p, 'provinces');
await p.click('#prv-edit');
await p.click('#prv-tool-add');
await clickOn('prov', sec);
const provs = await p.evaluate(() => G.S.nation.prov.l.map(q => ({ id: q.id, nm: q.nm, s: q.s })));
console.log('provinces', JSON.stringify(provs), await text(p, '#prv-msg'));
check('a second division is founded on the mainland', provs.length === 2);
const B = provs.find(q => q.s === sec);
const where = () => p.evaluate(isle => { const T = G.territory(), i = T.byId[G.myId()], N = G.SL.prvNatWith(T, i, G.S.nation.prov); return isle.map(c => { const g = N.pv[c] - N.base; return N.prov[g] && N.prov[g].id; }); }, spot.isle);
const before = await where();
const target = before[0] === B.id ? provs.find(q => q.id !== B.id) : B;
await p.selectOption('#prv-selp', String(target.id)); await sleep(300);
/* single hex first: the island does not touch the target division, so the editor points to Move islands */
await p.click('#prv-tool-move'); await clickOn('prov', spot.isle[0]);
const msg1 = await text(p, '#prv-msg');
console.log('move one:', msg1);
check('moving a lone island hex points to Move islands', /Move islands/.test(msg1) && /strait of up to 2 sea hexes/.test(msg1));
await p.click('#prv-tool-isle'); await clickOn('prov', spot.isle[0]);
const after = await where(), msg2 = await text(p, '#prv-msg');
console.log('island', JSON.stringify(before), '->', JSON.stringify(after), msg2);
check('Move islands moves every hex of the island into the selected division', after.every(id => id === target.id) && /whole island/.test(msg2));
await p.screenshot({ path: OUT + '/provinces-isle.png' });
/* the island division now has the mainland piece and the island: still one piece, so a further edit passes the checks */
const chk = await p.evaluate(() => { const T = G.territory(), i = T.byId[G.myId()]; return G.SL.prvCheck(T, i, G.S.nation.prov, G.S.nation.prov); });
check('a division holding a whole far island passes the one-piece check', chk === '', chk);
const mergeOpts = await p.locator('#prv-mrg option').allTextContents();
check('the merge list offers the other division', mergeOpts.length >= 1, mergeOpts.join(','));

/* idea 5: swap a claimed hex for free land, from the map */
await p.evaluate(() => { const n = G.clone(G.S.nation); n.lcb = (n.lcb || 0) + 3; G.commit(n); });
await p.evaluate(() => G.WH.claimAuto(true));
await sleep(300);
const pair = await p.evaluate(cap => {
  const T = G.territory(), i = T.byId[G.myId()], fr = [...G.MD.claimFrontier(T)], M = G.MAP;
  const adj = (a, b) => { for (let d = 0; d < 6; d++) if (M.nbr[a * 6 + d] === b) return true; return false; };
  for (const e of G.S.nation.claims.slice().reverse()) { if (M.comp[e.c] !== M.comp[cap]) continue;
    for (const t of fr) { if (M.comp[t] !== M.comp[cap] || adj(t, e.c)) continue; const r = G.SL.swapCheck(e.c, t); if (!r.why) return { from: e.c, to: t, claims: G.S.nation.claims.length, tally: (G.S.nation.tly || {}).claim || 0 }; } }
  return null;
}, spot.cap);
console.log('swap pair', JSON.stringify(pair));
check('there is a claimed hex that can be swapped for a frontier hex', !!pair);
if (pair) {
  await nav(p, 'map');
  await p.evaluate(c => { G.MD.centerMain(c, 18); G.render(); }, pair.from);
  await sleep(300);
  await clickOn('main', pair.from);
  check('your claimed hex offers Swap this hex for other land', await p.locator('[data-act="lsw-start"]').count() === 1);
  await p.click('[data-act="lsw-start"]'); await sleep(200);
  check('swap mode asks for free land to take instead', /Click free land on the map to take instead/.test(await text(p, '.lsw')));
  await clickOn('main', spot.isle[0]);
  const bad = await text(p, '.lsw .err');
  check('choosing land you already hold is refused with a reason', /not land you already hold/.test(bad), bad);
  await clickOn('main', pair.to);
  check('a valid choice shows both hexes and a Swap button', await p.locator('[data-act="lsw-go"]').count() === 1 && /Take instead/.test(await text(p, '.lsw')));
  await shotAt('main', pair.to, 'swap-at');
  const keep = await p.evaluate(() => { const L = G.S.lsw; G.S.lsw = null; G.render(); return L; }); await sleep(300); await shotAt('main', pair.to, 'swap-at-off');
  await p.evaluate(L => { G.S.lsw = L; G.render(); }, keep); await sleep(300);
  await p.click('[data-act="lsw-go"]'); await sleep(400);
  const res = await p.evaluate(({ from, to }) => { const T = G.territory(), i = T.byId[G.myId()], n = G.S.nation; return { from: T.owner[from] === i, to: T.owner[to] === i, claims: n.claims.length, tally: (n.tly || {}).claim || 0, lswT: !!n.lswT, log: n.log[0] && n.log[0].k, wait: G.SL.swapWait(n) > 0 }; }, pair);
  console.log('after swap', JSON.stringify(res));
  check('the swap gives up the old hex and takes the new one', !res.from && res.to && res.claims === pair.claims);
  check('a swap leaves the land-claimed tally as it was and logs it', res.tally === pair.tally && res.log === 'lswap');
  const again = await p.evaluate(({ to }) => { const T = G.territory(), fr = [...G.MD.claimFrontier(T)]; return G.SL.swapCheck(to, fr[0]).why; }, pair);
  check('only one swap a day', /one hex a day/.test(again || ''), again);
}
await p.evaluate(c => { G.MD.centerMain(c, 7); G.render(); }, spot.cap);
await sleep(400);
await p.locator('canvas[data-map="main"]').scrollIntoViewIfNeeded();
await shotAt('main', spot.cap, 'reach-at', 640, 480);
await p.evaluate(() => { G.S.view = 'provinces'; G.render(); }); await sleep(400); await p.locator('canvas[data-map="prov"]').scrollIntoViewIfNeeded(); await sleep(300); await p.screenshot({ path: OUT + '/provinces-after.png' });
finish();
