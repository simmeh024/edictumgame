// Lake and sea names chosen by players: a nation names the lakes and the sea within 5 hexes of its land, from the
// map's side panel. Checked here: clicking the sea within reach offers to name these waters and says how far they run,
// a name a river has is refused, a field being typed in survives the panel being drawn again, the name is saved in
// the record, shown in the panel, the hover tip, the history and on the map over the nation's waters, the sea beyond
// reach says how naming works, the name goes when the land within reach goes and comes back with it, a rename keeps
// one line in the history and taking the name away leaves none, a lake of open water and a lake of the river network
// can be named (and the map's own name brought back), and the field fits a phone.
//   python3 build.py
//   node test/water-names.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the
// test probe. Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });

/* public/ as Hosting would serve it, without the Firebase config, so the game starts in its local mode */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
/* toasts come and go on their own timers and can sit over what a click wants; the texts are kept for the checks */
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });
/* the names written on the map in italic, with their fonts: a sea's in italic 500, a lake's in italic 600 */
await page.addInitScript(() => {
  window.__wn = []; const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (/italic/.test(this.font) && String(t).length > 1) window.__wn.push((/italic 500/.test(this.font) ? 'sea:' : 'lake:') + String(t)); return f.call(this, t, ...a); };
});
/* hexes within d steps of some cells (through hexes ok(j) lets in), with how many steps: Map hex -> steps */
await page.addInitScript(() => {
  window.__ring = (M, cells, d, ok) => { const D = new Map(), q = []; for (const c of cells) { D.set(c, 0); q.push(c); }
    for (let h = 0; h < q.length; h++) { const a = q[h], v = D.get(a); if (v >= d) continue; for (let k = 0; k < 6; k++) { const j = M.nbr[a * 6 + k]; if (j >= 0 && !D.has(j) && (!ok || ok(j))) { D.set(j, v + 1); q.push(j); } } }
    return D; };
});

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* change the nation as a save would, and draw the page again */
const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
/* the capital moved to hex c, with its core and no claims */
const moveCap = c => edit((n, now, G, c) => { const M = G.MAP, cap = n.cities.find(x => x.c === M.COLS * n.loc.r + n.loc.c) || n.cities[0]; n.loc = { ...n.loc, c: c % M.COLS, r: Math.floor(c / M.COLS) }; cap.c = c; n.cities = [cap]; n.claims = []; }, c);
/* where hex c is on the main map, centred and close in, in the canvas's own pixels */
const showCell = async (c, z = 5) => {
  await page.evaluate(([c, z]) => { const G = window.__game; G.MD.centerMain(c, z); G.render(); }, [c, z]);
  const cv = page.locator('canvas[data-map="main"]'); await cv.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pos = await page.evaluate(c => { const G = window.__game, cv = document.querySelector('canvas[data-map="main"]'), v = G.MD.viewOf('main', cv), s = G.MD.mapScale(cv, v); return { x: cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, c);
  return { cv, pos };
};
const clickCell = async c => { const { cv, pos } = await showCell(c); await cv.click({ position: pos }); await sleep(300); };
const select = async c => { await page.evaluate(c => { const G = window.__game; G.S.mapInspect = c; G.S.mapCell = null; G.S.mapSel = null; G.S.mapClaim = null; G.render(); }, c); await sleep(250); };
const nameAt = c => page.evaluate(c => { const K = window.__game.WTN(), a = K.wnAt(K.territory(), c); return a ? a.nm : null; }, c);
const lastLine = () => page.evaluate(() => { const G = window.__game, n = G.S.nation, l = n.log.find(l => l.k === 'wtren'); return l ? G.WTN().logLine(l, n, G.S.uid) : null; });
/* the main map close in on hex c (hx: a hex's width in pixels), and the names written on it */
const drawnAt = (c, hx, want) => page.evaluate(async ([c, hx, want]) => {
  const G = window.__game, K = G.WTN(), M = G.MAP, cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0], base = Math.min(cv.clientWidth / M.W, cv.clientHeight / M.H);
  G.S.mapViews.main = { z: hx / K.HEX_W / base, cx: M.cx[c], cy: M.cy[c] }; G.S.mapInspect = null; G.S.mapCell = null; window.__wn = []; scrollTo(0, 0); G.render();
  for (let k = 0; k < 40 && !window.__wn.includes(want); k++) await new Promise(r => setTimeout(r, 100));
  return [...new Set(window.__wn)];
}, [c, hx, want]);
const shot = async name => {
  await page.evaluate(() => { const cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0]; cv.scrollIntoView({ block: 'center' }); });
  await sleep(500); let big = null, bw = 0; for (const h of await page.locator('canvas.map-cv').all()) { const b = await h.boundingBox(); if (b && b.width > bw) { bw = b.width; big = h; } }
  if (big) await big.screenshot({ path: path.join(OUT, name) });
};

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Seaholm');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});
  await page.evaluate(() => window.__game.WTN().rvData());
  check('the river network is made', await until(() => page.evaluate(() => !!window.__game.WTN().RV), 20000));

  /* a coast on the open sea, well away from other capitals: the capital moves there */
  const coast = await page.evaluate(() => {
    const G = window.__game, K = G.WTN(), M = G.MAP, T = G.territory(), mi = T.list.findIndex(x => x.me), B = K.wbMap(), cap0 = T.list[mi].cap;
    const far = c => T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 14);
    let best = null;
    for (let c = 0; c < M.N; c++) { if (M.T[c] < 2 || M.T[c] > 3 || (T.owner[c] >= 0 && T.owner[c] !== mi) || !far(c)) continue; let sea = 0;
      for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && M.T[j] < 2 && B.of[j] >= 0 && !B.bodies[B.of[j]].lake) sea++; }
      if (sea >= 3) { const dd = K.hexDist(c, cap0); if (!best || dd < best.d) best = { c, d: dd }; } }
    return best && best.c;
  });
  check('a coast on the open sea is found', coast != null);
  if (coast == null) throw new Error('no coast');
  await moveCap(coast);
  await go('map');
  /* a hex of the nation's waters, three hexes out, and one of the same sea beyond reach */
  const sea = await page.evaluate(() => {
    const G = window.__game, K = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me), W = K.wnWaters(T, mi), big = W.size.indexOf(Math.max(...W.size));
    let sel = null, far = null; for (const [c, p] of W.pc) if (p === big && W.R.get(c) === 3) { sel = c; break; }
    const D = window.__ring(M, [...W.pc.keys()], 4, j => M.T[j] < 2);
    for (const [c, d] of D) if (d >= 2 && !W.R.has(c)) { far = c; break; }
    const river = K.RV.list.find(r => r.name0);
    return { sel, far, size: W.size[big], reg: K.REG.id, river: river ? river.name0 : null };
  });
  check('the nation has waters to name', sea.sel != null && sea.size > 5, JSON.stringify(sea));
  console.log(`     ${sea.size} hexes of sea within reach of Seaholm`);

  await clickCell(sea.sel);
  check('clicking the sea shows a panel for it', await page.locator('#map-panel .wn-pn').count() === 1, await txt('#map-panel'));
  check('which calls it the sea, with no name yet', (await txt('#map-panel .wn-pn .eyebrow')) === 'Sea' && (await txt('#map-panel .wn-l')) === 'Waters with no name yet.', await txt('#map-panel .wn-pn'));
  const own = await txt('#map-panel .wn-own');
  check('and says the nation may name them, and how far they run', !!own && own.includes(`These waters lie within 5 hexes of your land (${sea.size} hexes of sea), so you may name them`), own);
  check('with a button to name them', (await txt('#map-panel [data-act="wn-edit"]')) === 'Name these waters');
  await page.click('#map-panel [data-act="wn-edit"]');
  check('the button opens a name field, focused and empty', await until(() => page.evaluate(() => { const i = document.getElementById('wn-name'); return !!i && document.activeElement === i && i.value === ''; })));
  check('the field says where the name goes', ((await txt('#wn-form .hint')) || '').includes('The name goes on the sea within 5 hexes of your land here'));

  /* a river's name is refused */
  if (sea.river) {
    await page.fill('#wn-name', sea.river); await page.click('#wn-form button[type="submit"]'); await sleep(250);
    const err = await txt('#wn-form .err');
    check('a name a river has is refused', !!err && err.includes('There is already a river called'), err);
    check('and nothing is saved', await page.evaluate(() => !window.__game.S.nation.wtn));
  }
  /* typing survives the panel being drawn again (a save from another player redraws it) */
  await page.fill('#wn-name', ''); await page.type('#wn-name', 'The Amber S');
  await page.evaluate(() => window.__game.WTN().updateMapPanel());
  check('a half-typed name keeps its focus and its text when the panel is drawn again', await page.evaluate(() => { const i = document.getElementById('wn-name'); return !!i && document.activeElement === i && i.value === 'The Amber S' && i.selectionStart === 11; }));
  await page.type('#wn-name', 'ea');
  await page.click('#wn-form button[type="submit"]'); await sleep(300);

  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation.wtn || null)));
  check('the name is saved in the nation\'s record', Array.isArray(saved) && saved.length === 1 && saved[0].r === sea.reg && saved[0].c === sea.sel && saved[0].n === 'the Amber Sea', JSON.stringify(saved));
  check('the panel shows the new name', (await txt('#map-panel .wn-l b')) === 'The Amber Sea' && (await txt('#map-panel .wn-by')) === 'Named by you.', await txt('#map-panel .wn-pn'));
  check('and what the nation calls them', ((await txt('#map-panel .wn-own')) || '').startsWith('You call them the Amber Sea.'));
  check('a rename button stays for another go', (await txt('#map-panel [data-act="wn-edit"]')) === 'Rename these waters');
  check('every hex of the nation\'s waters carries the name', await page.evaluate(() => { const K = window.__game.WTN(), T = K.territory(), mi = T.list.findIndex(x => x.me), W = K.wnWaters(T, mi), p = W.pc.get(window.__game.S.nation.wtn[0].c); return [...W.pc].filter(([c, q]) => q === p).every(([c]) => K.wnAt(T, c).nm === 'the Amber Sea'); }));
  check('the history has a line for it', (await lastLine()) === 'The sea off its coast was named the Amber Sea.', await lastLine());

  /* the hover tip over the water */
  {
    const { cv, pos } = await showCell(sea.sel), box = await cv.boundingBox();
    await page.mouse.move(box.x + pos.x, box.y + pos.y); await sleep(150); await page.mouse.move(box.x + pos.x + 1, box.y + pos.y);
    const tip = await until(async () => { const t = await txt('.map-tip'); return t && t.includes('The Amber Sea') ? t : null; }, 3000);
    check('a hover over the water speaks of its name', !!tip, await txt('.map-tip'));
  }

  /* beyond reach: no name, and how naming works */
  if (sea.far != null) {
    await select(sea.far);
    check('beyond reach the sea has no name', (await txt('#map-panel .wn-l')) === 'Waters with no name yet.', await txt('#map-panel .wn-pn'));
    check('and the panel says how naming works', (await txt('#map-panel .wn-why')) === 'Nations name the sea within 5 hexes of their land.', await txt('#map-panel .wn-pn'));
    check('with nothing to press', await page.locator('#map-panel [data-act="wn-edit"]').count() === 0);
  }

  /* on the map */
  let drawn = await drawnAt(sea.sel, 16, 'sea:the Amber Sea');
  check('the name is written on the nation\'s waters on the map', drawn.includes('sea:the Amber Sea'), JSON.stringify(drawn));
  await shot('water-names-sea.png');

  /* names follow the land: the capital moved inland, the name goes; moved back, it comes back */
  const inland = await page.evaluate(() => {
    const G = window.__game, K = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me), cap = T.list[mi].cap;
    const wet = []; for (let c = 0; c < M.N; c++) if (M.T[c] < 2) wet.push(c);
    const D = window.__ring(M, wet, 9);
    for (let c = 0; c < M.N; c++) if (!D.has(c) && M.T[c] >= 2 && M.T[c] <= 3 && T.owner[c] < 0 && T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 14)) return c;
    return null;
  });
  if (inland == null) console.log('     (no hex nine hexes from any water: names following the land are not checked this run)');
  else {
    await moveCap(inland);
    check('the land within reach gone, the name goes', (await nameAt(sea.sel)) === '');
    check('the name stays in the record', await page.evaluate(() => (window.__game.S.nation.wtn || []).length === 1));
    await moveCap(coast);
    check('the land back, the name is back with it', (await nameAt(sea.sel)) === 'the Amber Sea');
  }

  /* a rename keeps one line; taking the name away leaves none */
  await go('map'); await select(sea.sel);
  await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
  check('the field holds the present name', await page.evaluate(() => document.getElementById('wn-name').value === 'the Amber Sea'));
  await page.fill('#wn-name', 'Gull Bay'); await page.click('#wn-form button[type="submit"]'); await sleep(300);
  check('renamed', (await nameAt(sea.sel)) === 'Gull Bay' && await page.evaluate(() => window.__game.S.nation.wtn.length === 1));
  check('a rename within hours keeps one line in the history', await page.evaluate(() => window.__game.S.nation.log.filter(l => l.k === 'wtren').length === 1) && (await lastLine()) === 'The sea off its coast was named Gull Bay.', await lastLine());
  await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
  check('the field offers to take the name away', (await txt('#map-panel [data-act="wn-reset"]')) === 'Take the name away');
  await page.click('#map-panel [data-act="wn-cancel"]'); await sleep(200);
  check('Cancel closes the field', await page.locator('#wn-form').count() === 0);
  await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
  await page.click('#map-panel [data-act="wn-reset"]'); await sleep(300);
  check('the name is taken away', (await nameAt(sea.sel)) === '' && await page.evaluate(() => !window.__game.S.nation.wtn));
  check('and leaves no line in the history', await page.evaluate(() => !window.__game.S.nation.log.some(l => l.k === 'wtren')));

  /* on a phone the panel's field fits */
  await page.setViewportSize({ width: 390, height: 844 });
  await go('map'); await select(sea.sel);
  if (await page.locator('#map-panel .mp-grab[aria-expanded="false"]').count()) { await page.click('#map-panel .mp-grab'); await sleep(400); }
  await page.click('#map-panel [data-act="wn-edit"]'); await sleep(300);
  const fits = await page.evaluate(() => { const f = document.getElementById('wn-form'); if (!f) return 'no form'; const b = f.getBoundingClientRect(); return b.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1 ? true : `${b.right} > ${innerWidth}`; });
  check('on a phone the name field fits the screen', fits === true, fits);
  await page.evaluate(() => document.getElementById('wn-form') && document.getElementById('wn-form').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'water-names-phone.png') });
  await page.click('#map-panel [data-act="wn-cancel"]').catch(() => {});
  await page.setViewportSize({ width: 1280, height: 900 });

  /* a lake of open water: the capital moves two or three hexes from one */
  const lake = await page.evaluate(() => {
    const G = window.__game, K = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me), B = K.wbMap();
    const far = c => T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 14);
    for (const b of B.bodies.filter(b => b.lake && b.n >= 3).sort((a, b) => b.n - a.n)) {
      if (!b.cells.every(c => M.T[c] < 2 && T.owner[c] < 0 && far(c))) continue;
      for (const [c, d] of window.__ring(M, b.cells, 3)) if (d === 3 && M.T[c] >= 2 && M.T[c] <= 3 && T.owner[c] < 0 && far(c)) return { cap: c, cells: b.cells, sel: b.cells[0] };
    }
    return null;
  });
  if (!lake) console.log('     (no free lake of open water on this map: naming one is not checked this run)');
  else {
    await moveCap(lake.cap); await go('map');
    await clickCell(lake.sel);
    check('a lake of open water has its panel', (await txt('#map-panel .wn-pn .eyebrow')) === 'Lake' && (await txt('#map-panel .wn-l')) === 'A lake with no name yet.', await txt('#map-panel .wn-pn'));
    const lo = await txt('#map-panel .wn-own');
    check('which says how far it lies and who names a lake', !!lo && /This lake lies [0-3] hexe?s? from your land, within the 5 that let you name it/.test(lo) && lo.includes('the map shows the name of the one nearest it'), lo);
    await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
    await page.fill('#wn-name', 'the Glass Mere'); await page.click('#wn-form button[type="submit"]'); await sleep(300);
    check('the lake is named, every hex of it', (await Promise.all(lake.cells.map(nameAt))).every(n => n === 'the Glass Mere'));
    check('the history says a lake was named', (await lastLine()) === 'A lake was named the Glass Mere.', await lastLine());
    drawn = await drawnAt(lake.sel, 26, 'lake:the Glass Mere');
    check('and its name is written in the lake on the map', drawn.includes('lake:the Glass Mere'), JSON.stringify(drawn));
    await shot('water-names-lake.png');
  }

  /* a lake of the river network, named by the map: the capital moves five hexes from one (rows apart, so the capital's
     labels and the lake's do not compete for room), renames it and gives its name back */
  const rvl = await page.evaluate(() => {
    const G = window.__game, K = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me);
    const far = c => T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 14);
    /* the largest first: a lake of one or two hexes on a named river may have no room left for its name */
    for (const L of [...K.RV.lakes].sort((a, b) => b.cells.length - a.cells.length || a.id - b.id)) {
      if (!L.name || !L.cells.every(c => T.owner[c] < 0 && far(c))) continue;
      for (const [c, d] of window.__ring(M, L.cells, 5)) if (d === 5 && Math.abs(Math.floor(c / M.COLS) - Math.floor(L.cells[0] / M.COLS)) >= 4 && M.T[c] >= 2 && M.T[c] <= 3 && !K.RV.lakeAt.has(c) && T.owner[c] < 0 && far(c)) return { id: L.id, cap: c, sel: L.cells[0], name0: L.name0 || L.name };
    }
    return null;
  });
  if (!rvl) console.log('     (no free lake of the river network on this map: renaming one is not checked this run)');
  else {
    await moveCap(rvl.cap); await go('map'); await select(rvl.sel);
    check('a lake of the river network shows its map name', (await txt('#map-panel .rv-pn .eyebrow')) === 'Lake' && (await txt('#map-panel .rv-l b')) === rvl.name0, await txt('#map-panel .rv-pn'));
    check('and may be renamed from within reach', (await txt('#map-panel [data-act="wn-edit"]')) === 'Rename the lake', await txt('#map-panel .rv-pn'));
    await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
    check('the field holds the map\'s name', await page.evaluate(n0 => document.getElementById('wn-name').value === n0, rvl.name0));
    await page.fill('#wn-name', 'Lake Brightwater'); await page.click('#wn-form button[type="submit"]'); await sleep(300);
    check('renamed: the lake is called so', await page.evaluate(id => window.__game.WTN().RV.lakes[id].name, rvl.id) === 'Lake Brightwater' && (await txt('#map-panel .rv-l b')) === 'Lake Brightwater');
    check('the history says what it was called', (await lastLine()) === `${rvl.name0} was renamed Lake Brightwater.`, await lastLine());
    drawn = await drawnAt(rvl.sel, 26, 'lake:Lake Brightwater');
    check('and the map writes the new name by the lake', drawn.includes('lake:Lake Brightwater') && !drawn.includes('lake:' + rvl.name0), JSON.stringify(drawn));
    await shot('water-names-rvlake.png');
    await go('map'); await select(rvl.sel);
    await page.click('#map-panel [data-act="wn-edit"]'); await sleep(200);
    check('the field offers the map\'s name back', (await txt('#map-panel [data-act="wn-reset"]')) === 'Bring back ' + rvl.name0);
    await page.click('#map-panel [data-act="wn-reset"]'); await sleep(300);
    check('and brings it back', await page.evaluate(id => window.__game.WTN().RV.lakes[id].name, rvl.id) === rvl.name0 && (await txt('#map-panel .rv-l b')) === rvl.name0);
    check('a rename undone within hours leaves no line', await page.evaluate(() => !window.__game.S.nation.log.some(l => l.k === 'wtren' && [l.a, l.b].includes('Lake Brightwater'))));
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('FAIL', e.stack || e.message); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
