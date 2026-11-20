// The map, faster (2026-11-20), in the page: opening the World map draws it once (it was drawn three times) and a page
// drawn while it is open draws it once (twice before); a new size still draws it; the sea moves at about 15 frames a
// second while the page is used, holds still once nobody touches it or the window loses focus, still moves the night on,
// and starts again at a touch; zoomed out, the land's colours and borders come from two pictures made once, kept for the
// same view, made again when the land changes and let go when the map is zoomed in or left.
//   python3 build.py
//   node test/map-speed.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.EDICTUM_PROBE = g => { window.__game = g; };
  window.EDICTUM_MFX_PARK = 1500; window.EDICTUM_MFX_NIGHT = 1200;
  /* a full picture of the World map begins by filling the whole canvas with the deep sea; the overlay's frames begin
     by clearing the whole overlay. Counted here, from outside the game. */
  window.__draws = 0; window.__fx = 0;
  const fr = CanvasRenderingContext2D.prototype.fillRect, cr = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { const c = this.canvas; if (c && c.classList && c.classList.contains('map-cv') && c.dataset.map === 'main' && x === 0 && y === 0 && w === c.clientWidth && h === c.clientHeight) window.__draws++; return fr.apply(this, arguments); };
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) { const c = this.canvas; if (c && c.classList && c.classList.contains('map-fx') && x === 0 && y === 0 && w === c.width) window.__fx++; return cr.apply(this, arguments); };
});
await page.goto(BASE);
await page.fill('#d-name', 'Lampwick');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); };
const act = a => page.evaluate(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
await go('map'); await sleep(400);
await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
const draws = () => page.evaluate(() => window.__draws);
/* the pictures drawn while f runs and ms pass; the clock draws the map again when the minute turns, so a count over a
   turn of the minute is taken again */
async function drawn(f, ms) {
  for (let k = 0; ; k++) {
    const [d0, m0] = await page.evaluate(() => [window.__draws, Math.floor(Date.now() / 60000)]);
    await f(); await sleep(ms);
    const [d1, m1] = await page.evaluate(() => [window.__draws, Math.floor(Date.now() / 60000)]);
    if (m0 === m1 || k === 2) return d1 - d0;
  }
}

/* 1. one picture per page drawn */
for (let k = 0; k < 2; k++) {
  await go('nation'); await sleep(800);
  const n = await drawn(() => go('map'), 1200);
  check(`opening the World map draws it once (${k + 1})`, n === 1, n);
}
{
  let k = 0;
  /* a note at the top of the map's panel (S.warMsg) changes the page, so the page is drawn again, not left as it was */
  const n = await drawn(() => page.evaluate(m => { const G = window.__game; G.S.warMsg = 'Steady as the tide ' + m; G.render(); }, ++k), 800);
  check('a page drawn while the map is open draws it once', n === 1, n);
  const n1 = await drawn(() => page.evaluate(m => { const G = window.__game; for (let i = 0; i < 3; i++) { G.S.warMsg = 'Thrice ' + m + i; G.render(); } }, ++k), 800);
  check('three pages drawn in one go: still one picture', n1 === 1, n1);
  const n2 = await drawn(() => page.setViewportSize({ width: 1180, height: 820 }), 1000);
  check('a new size draws it again', n2 >= 1, n2);
  const sz = await page.evaluate(() => { const c = document.querySelector('canvas.map-cv[data-map="main"]'); return [c._sz, c.clientWidth + 'x' + c.clientHeight]; });
  check('drawn at the size it has', sz[0] === sz[1], sz);
  const n3 = await drawn(async () => {}, 1000);
  check('and then left alone', n3 === 0, n3);
}

/* 2. the sea at rest */
await page.evaluate(() => document.querySelector('canvas.map-cv[data-map="main"]').scrollIntoView({ block: 'center' }));
const box = await page.evaluate(() => { const r = document.querySelector('canvas.map-cv[data-map="main"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; });
/* away from the map: a pointer over the map's hexes fades its hover ring in and out at the full 30 frames */
const off = await page.evaluate(() => { const r = document.querySelector('canvas.map-cv[data-map="main"]').getBoundingClientRect(); return { x: r.right + 30, y: r.top + 10 }; });
const fx = () => page.evaluate(() => window.__fx);
{
  const t0 = Date.now(), f0 = await fx();
  while (Date.now() - t0 < 1000) { await page.mouse.move(off.x + (Date.now() - t0) / 40, off.y); await sleep(50); }
  const n = await fx() - f0;
  check('the sea moves while the page is used, at about 15 frames a second', n >= 5 && n <= 24, n);
  await sleep(1800); const f1 = await fx(); await sleep(900);
  check('it holds still once nobody touches the page', await fx() - f1 <= 1, await fx() - f1);
  const f2 = await fx(); await sleep(2600);
  check('the night still moves on while it holds, a frame every so often', await fx() - f2 >= 1 && await fx() - f2 <= 3, await fx() - f2);
  await page.mouse.move(box.x + 40, box.y + 10); await sleep(500);
  const f3 = await fx(); await page.mouse.move(box.x + 50, box.y + 12); await sleep(500);
  check('a touch sets it going again', await fx() - f3 >= 3, await fx() - f3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(300); const f4 = await fx(); await sleep(700);
  check('out of focus it holds still', await fx() - f4 <= 1, await fx() - f4);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); const f5 = await fx(); await sleep(600);
  check('back in focus it moves', await fx() - f5 >= 3, await fx() - f5);
}

/* 3. the land, ready drawn */
const pic = () => page.evaluate(() => { const P = window.__game.MTP(), M = P.MTP, cv = document.querySelector('canvas.map-cv[data-map="main"]');
  if (!window.__picIds) window.__picIds = new WeakMap(), window.__picN = 0; const id = c => { if (!c) return 0; if (!window.__picIds.has(c)) window.__picIds.set(c, ++window.__picN); return window.__picIds.get(c); };
  if (!cv) return { fill: id(M.fill), edge: id(M.edge), map: false };
  const v = P.viewOf('main', cv), q = P.mapScale(cv, v) * Math.min(2, devicePixelRatio || 1), MAP = window.__game.MAP;
  return { fill: id(M.fill), edge: id(M.edge), w: M.fill ? M.fill.width : 0, h: M.fill ? M.fill.height : 0, want: [Math.ceil(MAP.W * q) + 2 * P.MTP_PAD, Math.ceil(MAP.H * q) + 2 * P.MTP_PAD], z: v.z }; });
const view = z => page.evaluate(z => { const G = window.__game, n = G.S.nation; G.MD.centerMain(n.cities[0].c, z); G.MTP().redrawMaps(); }, z);
{
  await view(1); await sleep(700);
  const a = await pic();
  check('zoomed right out, the land comes from two pictures of the whole region at the view’s scale', a.fill > 0 && a.edge > 0 && a.w === a.want[0] && a.h === a.want[1], a);
  await page.evaluate(() => window.__game.MTP().redrawMaps()); await sleep(500);
  const b = await pic();
  check('drawn again at the same view, the same pictures', b.fill === a.fill && b.edge === a.edge, [a, b]);
  await page.evaluate(() => { const G = window.__game, S = G.S, v = S.mapViews.main; v.cx += 23.7; G.MTP().redrawMaps(); }); await sleep(500);
  const c = await pic();
  check('moved at the same zoom: still the same pictures', c.fill === a.fill, [a, c]);
  const before = await page.evaluate(() => { const G = window.__game, T = G.territory(); return T.count[T.byId[G.myId()]]; });
  await page.evaluate(() => { const G = window.__game, T = G.territory(), b = [...G.MD.claimableBlocks(T)][0]; if (b == null) return; const c = G.MD.blockPlan(T, b)[0], n = G.clone(G.S.nation); n.claims = (n.claims || []).concat([{ c, t: Date.now() }]); G.commit(n); G.render(); G.MTP().redrawMaps(); });
  await sleep(600);
  const d = await pic(), after = await page.evaluate(() => { const G = window.__game, T = G.territory(); return T.count[T.byId[G.myId()]]; });
  check('the land changed (a claim): the pictures are made again', after > before && d.fill !== a.fill && d.fill > 0, { before, after, a, d });
  await view(12); await sleep(700);
  const e = await pic();
  check('zoomed in, they are let go', e.fill === 0, e);
  await view(1); await sleep(600);
  check('zoomed out again, made again', (await pic()).fill > 0);
  await go('nation'); await sleep(600);
  check('the World map left: let go', (await pic()).fill === 0);
}

check('no page errors', errors.length === 0, errors);
await browser.close(); server.close();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all map speed checks passed');
