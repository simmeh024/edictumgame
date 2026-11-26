// Pictures of the war office and the referee's die, as the game draws them. Not a test: it makes up a nation at war
// and shoots the pages, so a change to either can be looked at.
//   python3 build.py
//   node test/war-office-shots.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Shots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const errors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.waitForSelector('#d-name');
  await page.fill('#d-name', 'Valoria');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const go = async v => { await ev(v => { location.hash = '#' + v; }, v); if (!await until(() => ev(v => window.__game.S.view === v, v))) throw new Error('could not open ' + v); await sleep(400); };
  const act = a => ev(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);

  await go('map'); await act('map-suggest'); await act('settle');
  await until(() => ev(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await ev(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.pop = 20; n.popAt = Date.now(); G.commit(n); });

  /* the capital put beside a computer nation, so there is a front to show */
  const plan = await ev(() => {
    const G = window.__game, M = G.MAP, T = G.territory(), npcs = T.list.filter(x => x.npc), D = npcs[0], di = T.byId[D.id];
    const nb = c => { const o = []; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0) o.push(j); } return o; };
    for (let c = 0; c < M.N; c++) {
      if (T.owner[c] !== di || T.isCap[c] || M.T[c] < 2) continue;
      const free = nb(c).find(j => T.owner[j] === -1 && M.T[j] >= 2 && nb(j).every(k => T.owner[k] === -1 || T.owner[k] === di));
      if (free != null) return { D: D.id, Dn: D.n.name, E: npcs[1] && npcs[1].id, En: npcs[1] && npcs[1].n.name, c, free };
    }
    return null;
  });
  if (!plan) throw new Error('no computer nation with a hex beside free land');
  await ev(p => { const G = window.__game, n = G.clone(G.S.nation); n.loc = G.locOf(p.free); n.capAt = Date.now() - 60000; G.commit(n); }, plan);

  /* two wars, their counts, their cost so far, some weariness and a report of a war already over */
  await ev(p => {
    const G = window.__game, n = G.clone(G.S.nation), now = Date.now(), DAY = 86400000;
    n.wars = { [p.D]: { t: now - 12 * DAY, g: 'c' }, ...(p.E ? { [p.E]: { t: now - 4 * DAY, g: 'b' } } : {}) };
    n.wst = {
      [p.D]: { t: now - 12 * DAY, a: 9, w: 5, r: 0, m: { food: 412, iron: 188, oil: 96 }, p: 1.2 },
      ...(p.E ? { [p.E]: { t: now - 4 * DAY, a: 3, w: 2, r: 0, m: { food: 96, iron: 44 }, p: 0.28 } } : {}),
    };
    n.wwy = 38; n.ready = 3; n.readyAt = now - 60000;
    n.wrp = [{ id: 'gone-1', nm: 'Aubrenne', t0: now - 24 * DAY, t1: now - 17 * DAY, how: 'peace', g: 'c', a: 8, w: 6, r: 0, tk: 5, ls: 1, m: { food: 302, iron: 140 }, p: 2.1, res: 'gain' },
    { id: 'gone-2', nm: 'Pellmoor', t0: now - 39 * DAY, t1: now - 36 * DAY, how: 'auto', g: 'r', a: 4, w: 2, r: 2, tk: 0, ls: 0, m: { food: 88, iron: 30 }, p: 0.41, res: 'draw' }];
    G.commit(n);
  }, plan);

  await go('war');
  await page.screenshot({ path: path.join(OUT, 'war-office.png'), fullPage: true });
  await ev(() => { document.documentElement.dataset.theme = 'dark'; });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'war-office-dark.png'), fullPage: true });
  await ev(() => { document.documentElement.dataset.theme = 'light'; });
  await sleep(400);

  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => window.__game.render());
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'war-office-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await ev(() => window.__game.render());
  await sleep(400);

  /* war weariness: climbing, past the warning line, and falling again once the wars are over */
  await go('war');
  await page.locator('.wo-strip').screenshot({ path: path.join(OUT, 'ww-strip.png') });
  await page.locator('#ww-card').screenshot({ path: path.join(OUT, 'ww-card.png') });
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.wwy = 82; n.wwL = 9; G.commit(n); G.render(); });
  await sleep(400);
  await page.locator('.wo-strip').screenshot({ path: path.join(OUT, 'ww-strip-warn.png') });
  await page.locator('#ww-card').screenshot({ path: path.join(OUT, 'ww-card-warn.png') });
  /* the government overrules the call for peace: the ceiling stands at 120 and bleeds back to 100 */
  await ev(() => { const G = window.__game; const b = document.querySelector('#ww-card [data-act="ww-fight"]'); if (b && !b.disabled) b.click(); });
  await sleep(500);
  await page.locator('#ww-card').screenshot({ path: path.join(OUT, 'ww-card-overruled.png') });
  await page.locator('.wo-strip').screenshot({ path: path.join(OUT, 'ww-strip-overruled.png') });
  /* a day and a half in, with the ceiling half drained and weariness past 100 */
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.wwo = Date.now() - 1.5 * 86400000; n.wwy = 109; G.commit(n); G.render(); });
  await sleep(400);
  await page.locator('#ww-card').screenshot({ path: path.join(OUT, 'ww-card-overruled-late.png') });
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.wars = {}; n.wwy = 44; delete n.wwo; G.commit(n); G.render(); });
  await sleep(400);
  await page.locator('#ww-card').screenshot({ path: path.join(OUT, 'ww-card-peace.png') });
  await ev(p => { const G = window.__game, n = G.clone(G.S.nation), now = Date.now(), DAY = 86400000;
    n.wars = { [p.D]: { t: now - 12 * DAY, g: 'c' }, ...(p.E ? { [p.E]: { t: now - 4 * DAY, g: 'b' } } : {}) }; n.wwy = 38; G.commit(n); G.render(); }, plan);
  await sleep(400);

  /* the Wars tab of the Diplomacy page: the rows, their figures and the clock on an offer.
     The war stats go back in first: the tick files them under war reports once a peace offer stands. */
  await ev(p => {
    const G = window.__game, n = G.clone(G.S.nation), now = Date.now(), DAY = 86400000;
    n.wst = {
      [p.D]: { t: now - 12 * DAY, a: 9, w: 5, r: 0, m: { food: 412, iron: 188, oil: 96 }, p: 1.2 },
      ...(p.E ? { [p.E]: { t: now - 4 * DAY, a: 3, w: 2, r: 0, m: { food: 96, iron: 44 }, p: 0.28 } } : {}),
    };
    G.commit(n);
  }, plan);
  await go('diplomacy');
  await ev(() => { const b = document.querySelector('.dp-tab[data-v="wars"]'); if (b) b.click(); });
  await sleep(500);
  await page.locator('#dp-p-wars').screenshot({ path: path.join(OUT, 'dip-wars-live.png') });
  await ev(() => { document.documentElement.dataset.theme = 'dark'; });
  await sleep(400);
  await page.locator('#dp-p-wars').screenshot({ path: path.join(OUT, 'dip-wars-live-dark.png') });
  await ev(() => { document.documentElement.dataset.theme = 'light'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => window.__game.render());
  await sleep(500);
  await ev(() => { const b = document.querySelector('.dp-tab[data-v="wars"]'); if (b) b.click(); });
  await sleep(400);
  await page.locator('#dp-p-wars').screenshot({ path: path.join(OUT, 'dip-wars-live-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await ev(() => window.__game.render());
  await sleep(400);

  /* the attack panel: the forecast, the die while the referee answers, and the report */
  const cell = await ev(p => { const G = window.__game, T = G.territory(), di = T.byId[p.D]; for (const c of G.frontier(T).keys()) if (T.owner[c] === di) return c; return -1; }, plan);
  if (!(cell >= 0)) throw new Error('no hex of theirs on the front');
  await go('map');
  await ev(c => { const G = window.__game; G.S.mapTarget = c; G.S.mapSel = null; G.updateMapPanel(); }, cell);
  await sleep(300);
  await page.locator('#map-panel').screenshot({ path: path.join(OUT, 'battle-forecast.png') });
  await ev(() => { const G = window.__game; G.S.attacking = true; G.updateMapPanel(); });
  await sleep(300);
  await page.locator('#map-panel').screenshot({ path: path.join(OUT, 'battle-rolling.png') });
  await ev(() => { const G = window.__game; G.S.attacking = false; G.updateMapPanel(); });
  /* a win, then a loss, from the page's own roll */
  for (const [name, r] of [['battle-won', 0.08], ['battle-lost', 0.97]]) {
    /* a hex of theirs still on the front: the one just taken is ours now */
    const c = await ev(p => { const G = window.__game, T = G.territory(), di = T.byId[p.D]; for (const q of G.frontier(T).keys()) if (T.owner[q] === di) return q; return -1; }, plan);
    if (!(c >= 0)) { console.log('no hex left to attack for ' + name); break; }
    await ev(c => { const G = window.__game, n = G.clone(G.S.nation); n.ready = 3; n.readyAt = Date.now(); G.commit(n); G.S.mapTarget = c; G.updateMapPanel(); }, c);
    await ev(v => { const r = Math.random; Math.random = () => v; window.__restoreRandom = () => { Math.random = r; }; }, r);
    await page.click('#map-panel [data-act="attack"]');
    await until(() => ev(() => !window.__game.S.mapTarget));
    await ev(() => window.__restoreRandom());
    await sleep(400);
    await page.locator('#map-panel').screenshot({ path: path.join(OUT, name + '.png') });
  }
  console.log('shots in ' + OUT);
  console.log(errors.length ? 'PAGE ERRORS: ' + errors.slice(0, 5).join(' | ') : 'no page errors');
} catch (e) {
  console.log('FAILED', e && e.stack || e);
} finally {
  await browser.close();
  server.close();
}
