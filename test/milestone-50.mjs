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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

// The 50-player gift: a nation founded before M50_CUT sees the pop-up, opens the box, gets 50 of every material, the
// Royal crown shield and the gold I Was Here achievement, once. A nation founded after the cut never sees it.
//   python3 build.py && node test/milestone-50.mjs
for (const [theme, viewport, tag] of [['light', { width: 1280, height: 860 }, 'desk'], ['dark', { width: 390, height: 844 }, 'phone']]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Orrery'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0));
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.onb; n.founded = Date.UTC(2026, 9, 20); n.stock = { food: 10, timber: 10, iron: 10, oil: 10, goods: 10 }; n.stockAt = Date.now(); G.commit(n); G.render(); });
  check(`${tag}: pop-up shows`, await until(() => page.evaluate(() => !!document.getElementById('m50')), 6000));
  await sleep(300); await page.screenshot({ path: path.join(OUT, `m50-${tag}-closed.png`) });
  check(`${tag}: shield locked before`, await page.evaluate(() => !window.__game.czShOk ? true : !window.__game.czShOk(window.__game.S.nation, 'royal')));
  await page.click('#m50-box'); await sleep(900);
  await page.screenshot({ path: path.join(OUT, `m50-${tag}-open.png`) });
  const n = await page.evaluate(() => { const n = window.__game.S.nation; return { m50: n.m50, st: n.stock }; });
  check(`${tag}: m50 set`, n.m50 === 1, n);
  check(`${tag}: +50 each`, ['food', 'timber', 'iron', 'oil', 'goods'].every(r => Math.floor(n.st[r]) >= 60), n.st);
  await page.click('#m50-ok'); await sleep(300);
  check(`${tag}: closed`, await page.evaluate(() => !document.getElementById('m50')));
  await sleep(2500);
  check(`${tag}: not again`, await page.evaluate(() => !document.getElementById('m50')));
  await page.evaluate(() => { location.hash = '#customise'; }); await sleep(800);
  check(`${tag}: royal shield usable`, await page.evaluate(() => !document.querySelector('#cz-a-s-royal.locked')));
  /* after the cut: never */
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.m50; n.founded = Date.UTC(2026, 10, 12); G.commit(n); G.render(); });
  await sleep(2600);
  check(`${tag}: late nation no pop-up`, await page.evaluate(() => !document.getElementById('m50')));
  check(`${tag}: no page errors`, errors.length === 0, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all ok'); process.exit(failed ? 1 : 0);
