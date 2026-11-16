// Building tiers on the Cities page: a Factory with all five upgrades offers "Retool to tier II", its three lines, a retool
// under way that can be stopped (half back), the finished tier II with its badge, its own output and its blocks starting
// again at twice the price, What's next suggesting the first retool, the income forecast, Help and the achievements.
//   python3 build.py
//   node test/factory-tiers-page.mjs
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
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const fac = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation.cities[0].b.find(b => b.k === 'factory') || null)));
const stock = () => page.evaluate(() => { const G = window.__game, st = G.GB().stockNow(G.S.nation, Date.now()); return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.floor(v)])); });
/* the Factory's row on the Cities page */
const row = () => page.evaluate(() => { const b = document.querySelector('.bld [data-k="factory"]'); const li = b && b.closest('li.bld'); return li ? li.textContent.replace(/\s+/g, ' ').trim() : ''; });
const D = 864e5, FULL = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 };

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Tiermark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});

  /* the capital with a gold Factory and a full stockpile */
  await edit((n, now) => { const c = n.cities[0], d = 864e5;
    c.b = [{ k: 'factory', s: now - 9 * d, d: now - 8 * d, a: 1, ug: 5 }, { k: 'farm', s: now - 8 * d, d: now - 7 * d, a: 1, ug: 1 }];
    n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  const cid = await page.evaluate(() => window.__game.S.nation.cities[0].id);
  const T = await page.evaluate(() => { const P = window.__game.TIER(); return { cost: P.BTIER.factory[2].cost, lines: Object.keys(P.BTIER.factory[2].lines) }; });
  check('the probe knows the Factory’s tier II and its three lines', T.lines.join() === 'asm,steel,clean', T.lines.join());
  /* what this nation pays and waits, with its cabinet's bonuses */
  const Q = await page.evaluate(() => { const P = window.__game.TIER(); return P.tierQuote(window.__game.S.nation, null, 'factory', 2); });
  const QT = ['timber', 'iron', 'oil', 'goods'].filter(k => Q.cost[k]).map(k => Q.cost[k] + ' ' + k).join(', ');

  /* What's next suggests the first retool */
  await go('nation');
  const nx = await until(() => page.evaluate(() => { const e = document.querySelector('[data-act="tier-city"]'); return e ? e.closest('li').textContent.replace(/\s+/g, ' ').trim() : ''; }));
  check('What’s next suggests retooling the gold Factory', /Retool the Factory in .+All five of its upgrades are done/.test(nx || ''), nx);
  await page.click('[data-act="tier-city"]');
  await until(() => page.evaluate(() => window.__game.S.view === 'cities'));
  const opened = await until(() => page.$('.tier-pick'));
  check('its button opens the city with the lines to choose from', !!opened);

  /* the row at gold: the offer, then the lines */
  let r = await row();
  check('the gold row offers the retool with its price and time', /All five upgrades done: it works at double strength\./.test(r) && r.includes(`Industrial Works · ${QT} · ${Q.hours} h · its five upgrades start again`), r + ' :: ' + QT);
  const lines = await page.$$eval('.tier-pick [data-act="tier-go"]', bs => bs.map(b => b.textContent.trim()));
  check('three lines, each with its own button', lines.join(' | ') === 'Retool as an Assembly Plant | Retool as a Steelworks | Retool as a Clean Works', lines.join(' | '));
  const pick = await txt('.tier-pick');
  check('each line says what it makes and burns', /Goods \+12 a day\. Uses 2 oil a day/.test(pick) && /Burns 2 iron a day instead of oil/.test(pick) && /does not weigh on the city’s mood/.test(pick), pick);
  await page.locator('.tier-pick').screenshot({ path: path.join(OUT, 'factory-tier-pick.png') });

  /* Steelworks, then stop: half back */
  const before = await stock();
  await page.click('[data-act="tier-go"][data-ln="steel"]'); await sleep(300);
  let b = await fac();
  check('the retool is under way, to tier II as a Steelworks', b && b.tu && b.tu.l === 2 && b.tu.ln === 'steel' && b.ug === 5 && Math.abs((b.tu.d - b.tu.s) / 36e5 - Q.hours) < 0.01, JSON.stringify(b));
  let st = await stock();
  check('the price is paid at the start', ['timber', 'iron', 'oil', 'goods'].every(k => before[k] - st[k] === Q.cost[k]), JSON.stringify({ before, st, Q }));
  r = await row();
  check('the row says it is retooling, keeps working, and can be stopped', /Retooling as a Steelworks, tier II: .+ left\. It keeps working meanwhile\. Stop/.test(r), r);
  const busy = await page.evaluate(() => document.querySelector('.bld [data-k="farm"][data-act="cx-up"]')?.disabled ?? null);
  check('the city’s other upgrades wait while it retools', busy === true, String(busy));
  const plan = await page.evaluate(() => { const p = window.__game.IFC().plan(window.__game.S.nation); return p ? p.works.map(w => w.t + ':' + w.k) : null; });
  check('the income forecast lists the retool', (plan || []).includes('tier:factory'), JSON.stringify(plan));
  await page.click('[data-act="tier-stop"]'); await sleep(300);
  b = await fac(); st = await stock();
  check('Stop gives half back and the Factory stays at gold', !b.tu && b.ug === 5 && ['timber', 'iron', 'oil', 'goods'].every(k => st[k] - (before[k] - Q.cost[k]) === Math.floor(Q.cost[k] / 2)), JSON.stringify({ b, st }));

  /* Assembly Plant, finished */
  await edit((n, now) => { n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  await page.click('[data-act="tier-pick"][data-k="factory"]'); await sleep(200);
  await page.click('[data-act="tier-go"][data-ln="asm"]'); await sleep(300);
  await edit((n, now) => { const f = n.cities[0].b.find(b => b.k === 'factory'); f.tu.s = now - 25 * 3600e3; f.tu.d = now - 60e3; });
  b = await fac();
  check('a finished retool is written into the record: tier II, the line, no blocks', b.tr === 2 && b.ln === 'asm' && !b.ug && !b.tu && !b.uu, JSON.stringify(b));
  r = await row();
  check('the row shows the Assembly Plant with its tier II badge and no blocks yet', /^Assembly Plant ?II/.test(r) && await page.$('.bld .tier-b') !== null, r);
  check('it makes 12 goods, and its first Factory runs without oil', /\+12 goods a day/.test(r), r);
  const q = await page.evaluate(() => { const P = window.__game.TIER(); return [P.cxUpQuote(window.__game.S.nation, null, 'factory', 1, 1).cost, P.cxUpQuote(window.__game.S.nation, null, 'factory', 1, 2).cost]; });
  check('its blocks start again, at twice the price', r.includes('Upgrade to grey') && q[1].timber >= 2 * q[0].timber - 1 && r.includes(`${q[1].timber} timber`), JSON.stringify({ q, r }));
  await page.screenshot({ path: path.join(OUT, 'factory-tier-row.png'), clip: await page.locator('.bld:has([data-k="factory"])').boundingBox() || undefined });

  /* a tier II block: the goods rise from 12 */
  await page.click('[data-act="cx-up"][data-k="factory"]'); await sleep(300);
  await edit((n, now) => { const f = n.cities[0].b.find(b => b.k === 'factory'); f.uu.s = now - 10 * 3600e3; f.uu.d = now - 60e3; });
  await sleep(300);
  r = await row();
  check('one tier II block: 13.2 goods', /\+13\.2 goods a day/.test(r), r);
  const rt = await page.evaluate(() => { const G = window.__game; return G.GB().stockRates(G.S.nation).goods; });
  check('the stockpile’s goods income has the Assembly Plant in it', rt > 13, String(rt));

  /* What's next has stopped suggesting it; achievements; Help */
  await go('nation');
  check('What’s next suggests the first retool only', !(await page.$('[data-act="tier-city"]')));
  const ach = await until(() => page.evaluate(() => !!(window.__game.S.nation.ach || {})['bld-tier2']), 8000);
  check('Second Shift is earned', ach);
  await go('help');
  const help = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  check('How to play explains tiers', /A Factory with all five can then be retooled to tier II, Industrial Works/.test(help) && /an Assembly Plant \(12 goods a day for a flat 2 oil\), a Steelworks/.test(help));

  /* a phone: the picker fits */
  await edit((n, now) => { const c = n.cities[0]; c.b = [{ k: 'factory', s: now - 9 * 864e5, d: now - 8 * 864e5, a: 1, ug: 5 }]; n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  await page.setViewportSize({ width: 390, height: 844 });
  await go('cities');
  await page.click('[data-act="tier-pick"][data-k="factory"]'); await sleep(300);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('on a phone the picker fits the width', wide <= 0, String(wide));
  await page.locator('.tier-pick').screenshot({ path: path.join(OUT, 'factory-tier-pick-phone.png') });
} catch (e) {
  failed++; console.log('FAIL threw: ' + (e && e.stack || e));
} finally {
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
}
