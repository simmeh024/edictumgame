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
/* the Note Studio: the banknote designer on one screen */
await page.goto(BASE);
await page.fill('#d-name', 'Studiomark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { location.hash = '#customise'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
await page.evaluate(() => { const b = document.querySelector('[data-cst="open"]'); if (b) b.click(); else { const x = document.createElement('button'); x.dataset.cst = 'open'; document.body.appendChild(x); x.click(); x.remove(); } });
check('the Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('cu-st'); return e && !e.hidden && !!e.querySelector('.cst-front svg.cu-note'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('cu-st'), r = e.getBoundingClientRect(); return { sh: e.scrollHeight, h: r.height, w: e.scrollWidth, vw: innerWidth, docScroll: document.documentElement.scrollHeight > innerHeight && getComputedStyle(document.documentElement).overflow !== 'hidden' }; });
check('everything fits in one view (no scrolling) on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('layers, inspector, tabs and the series are all there', await page.evaluate(() => document.querySelectorAll('.cst-lay').length === 6 && !!document.getElementById('cst-i-x') && document.querySelectorAll('.cst-tab').length === 6 && document.querySelectorAll('.cst-card').length >= 9));
// drag the vignette 20 units left
const hit = await page.$('.cst-front .cst-ov [data-part="v"]'), bb = await hit.boundingBox(), u = bb.width / 80;
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + bb.width / 2 - 20 * u * i / 8, bb.y + bb.height / 2 + 1, { steps: 1 });
await page.mouse.up();
const pos = await page.evaluate(() => window.__game.S && JSON.stringify((document.getElementById('cst-i-x') || {}).value));
check('dragging moves the part, and the inspector follows', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value <= -15)), pos);
check('the move is on the history', await page.evaluate(() => [...document.querySelectorAll('.cst-hist .cst-b')].some(b => /Moved the vignette/.test(b.textContent))));
await page.keyboard.press('Control+z');
check('undo puts it back', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value === 0)));
await page.keyboard.press('Control+y');
check('redo moves it again', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value <= -15)));
// own guilloché, ornament, type
await page.click('[data-cst="tab"][data-v="guil"]'); await page.click('[data-cst="gon"]');
check('the guilloché sliders appear', await until(() => page.$('#cst-r-g0')));
await page.$eval('#cst-r-g0', e => { e.value = 11; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-cst="tab"][data-v="orn"]'); await page.click('[data-cst="set"][data-f="note.bd"][data-v="key"]'); await page.click('[data-cst="set"][data-f="note.ros"][data-v="compass"]');
await page.click('[data-cst="tab"][data-v="type"]'); await page.click('[data-cst="set"][data-f="note.tp"][data-v="1"]');
await page.click('[data-cst="tab"][data-v="colour"]'); await page.click('[data-cst="one"][data-v="1"]'); await page.click('[data-cst="harm"][data-v="comp"]');
check('one value can have its own colours', await until(() => page.evaluate(() => !!document.querySelector('.cst-card.on .cst-ovr'))));
await page.click('[data-cst="split"]'); await page.click('[data-cst="split"]');
for (const see of ['uv', 'wallet', 'hand', 'worn', 'phone', 'light', 'flat']) await page.selectOption('[data-cst-sel="see"]', see);
await page.click('[data-cst="zin"]'); await page.click('[data-cst="zin"]');
check('zooming in shows the mini-map', await until(() => page.$('.cst-mini')));
await page.click('[data-cst="z1"]');
await page.selectOption('[data-cst-sel="ver"]', 'save');
check('a version is saved on the nation', await until(() => page.evaluate(() => (window.__game.S.nation.cuV || []).length === 1)));
await page.screenshot({ path: path.join(OUT, 'note-studio.png') });
await page.click('[data-cst="save"]');
const saved = await until(() => page.evaluate(() => { const c = window.__game.S.nation.cur, N = c && c.note; return N && N.pos && N.pos.v && N.gp && N.gp[0] === 11 && N.bd === 'key' && N.ros === 'compass' && N.tp === 1 && N.ov && Object.keys(N.ov).length === 1 ? JSON.stringify(N) : false; }));
check('Save keeps every Studio choice on the currency', !!saved, saved);
const art = await page.evaluate(() => { const s = document.querySelector('.cst-front svg.cu-note'); return { part: !!s.querySelector('[data-part="v"][transform]'), paths: s.querySelectorAll('path').length }; });
check('the saved note draws the moved part', art.part, JSON.stringify(art));
await page.setViewportSize({ width: 390, height: 844 });
check('on a phone the Studio does not scroll sideways', await page.evaluate(() => { const e = document.getElementById('cu-st'); return e.scrollWidth <= innerWidth + 1; }));
await page.screenshot({ path: path.join(OUT, 'note-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('cu-st').hidden)));
check('no page errors in the Studio', errors.length === 0, errors.join(' | '));
await ctx.close();
/* the design guide, in a fresh browser with no nation */
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page2 = await ctx2.newPage();errors.length = 0;
page2.on('pageerror', e => errors.push(e.message));
await page2.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });

/* the banknote design system: every layout, era, preset and back draws, without errors, in its layers */
await page2.goto(BASE);
check('the game exposes the note kit', await until(() => page2.evaluate(() => !!(window.__game && window.__game.CU && window.__game.CU.guide)), 20000));
const r = await page2.evaluate(() => {
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
await page2.screenshot({ path: path.join(OUT, 'note-design.png'), fullPage: true });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
