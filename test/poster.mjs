// The poster in the browser: the way in from the World map, the picture drawn in each look and shape, the choice
// remembered, the picture saved as a file, Escape and focus, a nation with cities and a road, the Atlas look in the
// dark theme, and a phone.
//   python3 build.py
//   node test/poster.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the test
// probe. Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
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

/* a founded nation on the World map page; settled unless told otherwise */
async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = a => page.evaluate(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
  await go('map');
  const settle = async () => { await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300); };
  if (!opt.unsettled) await settle();
  /* the one-time gift for the fiftieth player opens over the page: put it aside */
  const gift = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); }); };
  await sleep(300); await gift();
  return { ctx, page, errors, edit, go, settle, gift };
}
const drawn = page => until(() => page.evaluate(() => { const c = document.querySelector('#pst-stage canvas'), s = document.getElementById('pst-save'); return !!c && !!s && !s.disabled; }), 20000);
/* the colour of one point of the sheet (in the sheet's own units), and how many colours a patch of it holds */
const pixel = (page, x, y) => page.evaluate(([x, y]) => { const c = document.querySelector('#pst-stage canvas'), k = c.width / ({ portrait: 600, wide: 900, square: 740 })[c.dataset.shape]; return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3); }, [x, y]);
const colours = (page, x, y, w, h) => page.evaluate(([x, y, w, h]) => { const c = document.querySelector('#pst-stage canvas'), k = c.width / ({ portrait: 600, wide: 900, square: 740 })[c.dataset.shape], d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)).data, s = new Set(); for (let i = 0; i < d.length; i += 16) s.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3)); return s.size; }, [x, y, w, h]);
const size = page => page.evaluate(() => { const c = document.querySelector('#pst-stage canvas'); return c ? [c.width, c.height, c.dataset.look, c.dataset.shape] : null; });
const near = (a, b, t = 6) => a && a.every((v, i) => Math.abs(v - b[i]) <= t);

try {
  /* ── before the capital is placed there is nothing to draw, so no way in ── */
  const u = await start('light', { width: 1280, height: 900 }, { unsettled: true });
  check('no poster button before the nation is on the map', await u.page.locator('[data-act="poster-open"]').count() === 0);
  await u.settle(); await u.gift();
  check('once settled, the picture button stands among the map’s controls', await u.page.locator('.map-ctrl [data-act="poster-open"]').count() === 1);
  check('a new nation has no map tools yet, so no second button (and no toolbar)', await u.page.locator('.mp-map-toolbar').count() === 0);
  await u.ctx.close();

  /* ── the dialog and the picture (desktop, light) ── */
  const t = await start('light', { width: 1280, height: 900 }), { page } = t;
  await page.click('.map-ctrl [data-act="poster-open"]');
  check('the button opens the poster’s dialog, named for the nation', await page.evaluate(() => { const d = document.querySelector('.pst-modal'); return !!d && d.getAttribute('role') === 'dialog' && /Poster of Lampwick/.test(document.getElementById('pst-h').textContent); }));
  check('Save waits for the picture', await page.evaluate(() => document.getElementById('pst-save').disabled || !!document.querySelector('#pst-stage canvas')));
  check('the picture is drawn', !!(await drawn(page)));
  check('Atlas, Portrait to begin with: 1800 by 2400 pixels', JSON.stringify(await size(page)) === JSON.stringify([1800, 2400, 'atlas', 'portrait']), await size(page));
  check('the sheet is the Atlas paper', near(await pixel(page, 8, 8), [248, 251, 249]), await pixel(page, 8, 8));
  check('the frame is inked', near(await pixel(page, 13, 300), [18, 41, 42], 40), await pixel(page, 13, 300));
  check('the map fills its frame with the map’s many colours', await colours(page, 40, 172, 520, 422) > 40, await colours(page, 40, 172, 520, 422));
  check('the name is written in the head', await colours(page, 150, 60, 300, 60) > 6, await colours(page, 150, 60, 300, 60));
  check('facts and key are written under the map', await colours(page, 40, 606, 520, 150) > 6);
  check('the picture has a text alternative', await page.evaluate(() => { const c = document.querySelector('#pst-stage canvas'); return c.getAttribute('role') === 'img' && /Poster of Lampwick/.test(c.getAttribute('aria-label')); }));
  check('the map behind is as it was: the visitor’s view and the map’s options are put back', await page.evaluate(() => { const G = window.__game; return !(G.S.mapViews && 'visit' in G.S.mapViews) && !document.querySelector('canvas[data-map="visit"]'); }));
  await page.screenshot({ path: path.join(OUT, 'poster-dialog.png') });

  /* each look and shape */
  for (const [look, paper] of [['antique', [239, 227, 198]], ['night', [15, 28, 34]]]) {
    await page.click(`[data-act="pst-look"][data-v="${look}"]`);
    check(`${look}: drawn`, !!(await drawn(page)) && (await size(page))[2] === look);
    check(`${look}: its own paper`, near(await pixel(page, 8, 8), paper), await pixel(page, 8, 8));
    check(`${look}: the map is drawn in its colours`, await colours(page, 40, 172, 520, 422) > 30);
  }
  await page.click('[data-act="pst-shape"][data-v="wide"]');
  check('Wide: 2700 by 1680', !!(await drawn(page)) && JSON.stringify((await size(page)).slice(0, 2)) === '[2700,1680]', await size(page));
  check('Wide: the map on the right, the name on the left', await colours(page, 310, 42, 548, 476) > 30 && await colours(page, 40, 130, 240, 80) > 6);
  await page.click('[data-act="pst-shape"][data-v="square"]');
  check('Square: 2220 by 2220', !!(await drawn(page)) && JSON.stringify((await size(page)).slice(0, 2)) === '[2220,2220]', await size(page));
  check('the pressed buttons say what is shown', await page.evaluate(() => [...document.querySelectorAll('.pst-opt[aria-pressed="true"]')].map(b => b.dataset.v).join() === 'night,square'));
  check('the choice is remembered', await page.evaluate(() => localStorage.getItem('statehood.poster') === 'night/square'));

  /* saved as a file */
  await page.click('[data-act="pst-shape"][data-v="wide"]'); await drawn(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pst-save')]);
  const file = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex'), bytes = fs.statSync(file).size;
  check('Save hands over a PNG named for the nation, the look and the shape', dl.suggestedFilename() === 'lampwick-poster-night-wide.png' && head === '89504e470d0a1a0a' && bytes > 40000, [dl.suggestedFilename(), head, bytes]);
  check('and says so', /Saved as lampwick-poster-night-wide\.png/.test(await page.textContent('#pst-note')));

  /* Escape, focus, and the choice kept for the next time */
  await page.keyboard.press('Escape');
  check('Escape closes it and focus goes back to the button', await page.evaluate(() => !document.querySelector('.pst-modal') && document.activeElement && document.activeElement.dataset.act === 'poster-open'));
  await page.click('.map-ctrl [data-act="poster-open"]');
  check('opened again, it is the look and shape last chosen', !!(await drawn(page)) && (await size(page)).slice(2).join() === 'night,wide', await size(page));
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  check('Tab stays inside the dialog', await page.evaluate(() => !!document.activeElement.closest('.pst-sheet')));
  await page.click('.pst-scrim', { position: { x: 5, y: 5 } });
  check('a click outside closes it', await page.evaluate(() => !document.querySelector('.pst-modal')));

  /* ── a nation with more land, cities and a road: the tools' button, and the key that follows the map ── */
  await t.edit((n, now, G) => { delete n.onb; });
  for (let r = 0; r < 4; r++) await page.evaluate(() => { const G = window.__game, T = G.territory(), fr = [...G.MD.claimFrontier(T)], n = G.clone(G.S.nation); n.claims = n.claims || []; for (const c of fr.slice(0, 30)) n.claims.push({ c, t: Date.now() - 1e6 }); G.commit(n); });
  const road = await page.evaluate(() => {
    const G = window.__game, M = G.MAP, T = G.territory(), mi = T.byId[G.myId()], cap = T.list[mi].cap; let far = -1, fd = -1;
    for (let i = 0; i < M.N; i++) { if (T.owner[i] !== mi || M.T[i] < 2 || M.T[i] > 3) continue; const d = Math.hypot(M.cx[i] - M.cx[cap], M.cy[i] - M.cy[cap]); if (d > fd) { fd = d; far = i; } }
    let n = G.clone(G.S.nation); n.cities.push({ id: 't1', c: far, nm: 'Farside', t: Date.now() - 9e5, b: [] }); G.commit(n);
    const T2 = G.territory(), p = G.MD.mpRoutePreview(T2, 'road', cap, far);
    if (p && p.path) { n = G.clone(G.S.nation); n.infra = [{ k: 'road', id: 't1', a: cap, b: far, path: p.path, reg: n.reg, t: Date.now() - 3 * 864e5, d: Date.now() - 864e5 }]; G.commit(n); }
    G.render(); const T3 = G.territory(), m3 = T3.byId[G.myId()];
    return { hexes: T3.count[m3], cities: G.S.nation.cities.length, road: !!(G.S.nation.infra || []).length, key: G.PST().pstKeyOf(G.S.nation, T3, m3).map(k => k[0]) };
  });
  check('the nation has grown: land, a second city and a road', road.hexes > 20 && road.cities === 2 && road.road, road);
  check('the key names the border, rivers and the road, and nothing the nation has not built', road.key.includes('border') && road.key.includes('river') && road.key.includes('road') && !road.key.includes('rail') && !road.key.includes('sea'), road.key);
  await sleep(300);
  check('with the map’s tools unlocked, Poster is one of them', await page.locator('.mp-map-toolbar [data-act="poster-open"]').count() === 1 && await page.locator('.mp-map-toolbar').count() === 1);
  await page.click('.mp-map-toolbar [data-act="poster-open"]');
  await page.click('[data-act="pst-look"][data-v="atlas"]'); await page.click('[data-act="pst-shape"][data-v="portrait"]');
  check('its poster is drawn', !!(await drawn(page)) && (await size(page)).slice(2).join() === 'atlas,portrait');
  await page.screenshot({ path: path.join(OUT, 'poster-grown.png') });
  await page.evaluate(() => { const c = document.querySelector('#pst-stage canvas'); c.style.maxHeight = 'none'; c.style.maxWidth = 'none'; c.style.width = '600px'; });
  await page.locator('#pst-stage canvas').screenshot({ path: path.join(OUT, 'poster-atlas-portrait.png') });
  await page.keyboard.press('Escape');
  check('no page errors', !t.errors.length, t.errors);
  await t.ctx.close();

  /* ── the dark theme: Atlas is still the light map, Night the dark one ── */
  const d = await start('dark', { width: 1280, height: 900 });
  await d.page.evaluate(() => localStorage.removeItem('statehood.poster'));
  await d.page.click('.map-ctrl [data-act="poster-open"]');
  const light = c => !!c && c.every(v => v > 110);
  check('dark theme: the Atlas poster keeps its light paper and its light map', !!(await drawn(d.page)) && near(await pixel(d.page, 8, 8), [248, 251, 249]) && light(await pixel(d.page, 40, 172)) && light(await pixel(d.page, 560, 594)), [await pixel(d.page, 8, 8), await pixel(d.page, 40, 172), await pixel(d.page, 560, 594)]);
  await d.page.click('[data-act="pst-look"][data-v="night"]');
  check('dark theme: Night is the dark one', !!(await drawn(d.page)) && near(await pixel(d.page, 8, 8), [15, 28, 34]) && !light(await pixel(d.page, 40, 172)));
  await d.page.screenshot({ path: path.join(OUT, 'poster-dark-theme.png') });
  check('dark theme: no page errors', !d.errors.length, d.errors);
  await d.ctx.close();

  /* ── a phone: a lighter picture, the dialog as a sheet inside the screen ── */
  const p = await start('light', { width: 375, height: 812 }, { phone: true });
  await p.page.evaluate(() => localStorage.removeItem('statehood.poster'));
  await p.page.evaluate(() => document.querySelector('.map-ctrl [data-act="poster-open"]').click());
  check('phone: drawn at twice the sheet’s size (1200 by 1600)', !!(await drawn(p.page)) && JSON.stringify((await size(p.page)).slice(0, 2)) === '[1200,1600]', await size(p.page));
  check('phone: the dialog and the picture fit the screen’s width', await p.page.evaluate(() => { const s = document.querySelector('.pst-sheet').getBoundingClientRect(), c = document.querySelector('#pst-stage canvas').getBoundingClientRect(); return s.left >= 0 && s.right <= innerWidth + 0.5 && c.left >= 0 && c.right <= innerWidth && c.width > 150 && document.documentElement.scrollWidth <= innerWidth; }));
  await p.page.screenshot({ path: path.join(OUT, 'poster-phone.png') });
  await p.page.evaluate(() => document.querySelector('[data-act="pst-close"]#pst-x').click());
  check('phone: Close closes it', await p.page.evaluate(() => !document.querySelector('.pst-modal')));
  check('phone: no page errors', !p.errors.length, p.errors);
  await p.ctx.close();
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
