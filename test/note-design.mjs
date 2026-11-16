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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* the banknote design system: every layout, era, preset and back draws, without errors, in its layers */
await page.goto(BASE);
check('the game exposes the note kit', await until(() => page.evaluate(() => !!(window.__game && window.__game.CU && window.__game.CU.guide)), 20000));
const r = await page.evaluate(() => {
  const html = window.__game.CU.guide();
  document.body.innerHTML = `<main style="padding:20px;max-width:1240px;background:#fff">${html}</main>`;
  const svgs = [...document.querySelectorAll('.cug-f svg')];
  return { n: svgs.length, eras: [...new Set(svgs.map(s => s.dataset.era).filter(Boolean))].sort().join(','), lays: [...new Set(svgs.map(s => s.dataset.lay).filter(Boolean))].sort().join(','),
    layers: document.querySelectorAll('.cug-f svg [data-layer]').length, empty: svgs.filter(s => s.getBBox().width < 10).length };
});
check('the guide draws its notes', r.n >= 50, JSON.stringify(r));
check('every era is drawn', r.eras === 'antique,classic,deco,future,polymer', r.eras);
check('every layout is drawn', r.lays === 'classic,minimal,modern,ornate', r.lays);
check('notes are drawn in named layers', r.layers > 100, r.layers);
check('no note is blank', r.empty === 0, r.empty);
await page.screenshot({ path: path.join(OUT, 'note-design.png'), fullPage: true });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
