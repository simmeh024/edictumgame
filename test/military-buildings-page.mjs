// Military buildings (22 Nov 2026) in the game itself: the Drill Ground, the Arsenal, the Naval Dockyard and the
// Military Hospital on the Cities page (plans, icons, rows, what each does here), built from the Build tab, and their
// effects as the game counts them: readiness, the coast's defence, the war's losses. Screenshots go to test/out/.
//   python3 build.py
//   node test/military-buildings-page.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the
// test probe.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });

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
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { if (g && g.S) window.__game = g; }; });
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const tab = async k => { await page.click(k === 'build' ? '.cx-tabs [data-act="ct-open"]' : `.cx-tabs [data-act="cx-tab"][data-k="${k}"]`); await sleep(300); };
const mil = (name, ...a) => page.evaluate(([name, a]) => window.EDICTUM_PROBE.mil[name](window.__game.S.nation, ...a), [name, a]);
const KEYS = ['drillyard', 'armoury', 'dockyard', 'milhosp'], MIN = 60000;

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Bulwark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});

  /* a nation of 20 million with a Barracks in a coastal city, and materials to spare */
  const cid = await page.evaluate(() => { const G = window.__game, P = window.EDICTUM_PROBE.mil; const c = G.S.nation.cities.find(c => P.isCoastal(c.c)); return c ? c.id : null; });
  check('the test nation has a coastal city', !!cid);
  await edit((n, now) => { const d = 864e5; n.pop = 20; n.peak = 20; n.popAt = now;
    for (const c of n.cities) c.b = [];
    n.cities[0].b = [{ k: 'barracks', s: now - 9 * d, d: now - 8 * d, a: 1 }];
    n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  const base = { max: await mil('maxReady'), ms: await mil('readyMs') };
  check('readiness before: 6 points, one every 15 minutes', base.max === 6 && base.ms === 15 * MIN, JSON.stringify(base));

  /* the plans */
  await go('cities');
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${cid}"]`); await sleep(300);
  await tab('build');
  const plans = await page.evaluate(([cid, keys]) => keys.map(k => { const b = document.querySelector(`[data-act="ct-build"][data-id="${cid}"][data-k="${k}"]`), li = b && b.closest('li.opt'); return { k, on: !!b && !b.disabled, ico: !!(li && li.querySelector('.b-ic svg')), t: li ? li.textContent.replace(/\s+/g, ' ').trim() : '' }; }), [cid, KEYS]);
  check('all four are in the city\'s plans, with an icon, and can be built', plans.every(p => p.on && p.ico), JSON.stringify(plans.map(p => [p.k, p.on, p.ico, p.t.slice(0, 80)])));
  check('they are Defence buildings and say what they do', plans.every(p => /Defence/.test(p.t)) && /Readiness comes back 20% sooner/.test(plans[0].t) && /Holds one more point of readiness/.test(plans[1].t) && /cross the water without losing strength/.test(plans[2].t) && /People lost to war −20%/.test(plans[3].t), JSON.stringify(plans.map(p => p.t.slice(0, 140))));
  await page.locator(`li.opt:has([data-act="ct-build"][data-k="drillyard"])`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'military-buildings-plans.png'), fullPage: true });

  /* built from the Build tab */
  await page.click(`[data-act="ct-build"][data-id="${cid}"][data-k="drillyard"]`); await sleep(400);
  const started = await page.evaluate(cid => { const c = window.__game.S.nation.cities.find(c => c.id === cid); const b = c && c.b.find(b => b.k === 'drillyard'); return b ? b.d - Date.now() : null; }, cid);
  check('Build starts the Drill Ground (four hours at most; a young nation builds quicker)', started > 0 && started <= 4 * 3600e3 + 60000, started);
  check('a nation has one: it is no longer offered', await until(() => page.evaluate(([cid]) => { const b = document.querySelector(`[data-act="ct-build"][data-id="${cid}"][data-k="drillyard"]`); return !b || b.disabled || !!b.closest('#cat-have'); }, [cid]), 3000));
  /* all four finished, in the coastal city */
  await edit((n, now) => { const c = n.cities.find(c => c.b.some(b => b.k === 'drillyard')); const d = 864e5;
    c.b = c.b.filter(b => !['drillyard', 'armoury', 'dockyard', 'milhosp'].includes(b.k)).concat(['drillyard', 'armoury', 'dockyard', 'milhosp'].map(k => ({ k, s: now - 2 * d, d: now - d, a: 1 }))); });
  const after = { max: await mil('maxReady'), ms: await mil('readyMs') };
  check('the Drill Ground readies a point in 12 minutes; the Arsenal holds a seventh', after.max === 7 && after.ms === 12 * MIN, JSON.stringify(after));
  check('the Hospital works for whoever holds its city', await mil('milLv', 'milhosp') === 0);
  const cut = await mil('milHospCut');
  check('the Hospital cuts the war\'s losses by 20%', Math.abs(cut - 0.2) < 1e-9, cut);
  /* gold: 30% sooner and two more points */
  await edit(n => { for (const c of n.cities) for (const b of c.b) if (b.k === 'drillyard' || b.k === 'armoury' || b.k === 'milhosp') b.ug = 5; });
  const gold = { max: await mil('maxReady'), ms: await mil('readyMs'), cut: await mil('milHospCut') };
  check('with all five upgrades: 10.5 minutes, two more points, 30% fewer lost', gold.max === 8 && gold.ms === Math.round(15 * MIN * 0.7) && Math.abs(gold.cut - 0.3) < 1e-9, JSON.stringify(gold));

  /* the rows: icons, and what each does here */
  await go('nation'); await go('cities');
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${cid}"]`); await sleep(300);
  await tab('b');
  const rows = await page.evaluate(([cid, keys]) => keys.map(k => { const li = document.querySelector(`#city-${cid} .blds li.bld:has([data-k="${k}"])`); if (!li) return { k, row: false }; const d = li.querySelector('details.bld-more'); if (d) d.open = true; return { k, row: true, ico: !!li.querySelector('.b-ic svg'), t: li.textContent.replace(/\s+/g, ' ').trim() }; }), [cid, KEYS]);
  check('each stands in the city with its icon', rows.every(r => r.row && r.ico), JSON.stringify(rows.map(r => [r.k, r.row, r.ico])));
  check('and says what it does here', /comes back every 10\.5 minutes instead of 15/.test(rows[0].t) && /two more points of readiness held/.test(rows[1].t) && /coastal hexes within 3 25% harder to take/.test(rows[2].t) && /people lost to war −30%/.test(rows[3].t), JSON.stringify(rows.map(r => (r.t || '').slice(0, 300))));
  const sky = await page.evaluate(() => { const c = document.querySelector('.cx-detail canvas[data-cx-sky]'); return !!c && c.width > 100; });
  check('the skyline still draws', sky);
  await page.locator(`#city-${cid} .blds`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'military-buildings-rows.png'), fullPage: true });

  /* How to play */
  await go('help'); await sleep(300);
  check('How to play explains them under War', /Military buildings/.test(await page.evaluate(() => document.body.textContent)) && /A Drill Ground brings readiness back 20% sooner/.test(await page.evaluate(() => document.body.textContent)));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('FAIL the run stopped: ' + (e && e.stack || e)); failed++;
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
