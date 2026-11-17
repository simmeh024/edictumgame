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
/* the Flag Studio: the flag designer on one screen */
await page.goto(BASE);
await page.fill('#d-name', 'Flagmark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { location.hash = '#customise'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.fst = 'open'; document.body.appendChild(x); x.click(); x.remove(); });
check('the Flag Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('fg-st'); return e && !e.hidden && !!e.querySelector('.fs-flag svg'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('fg-st'); return { sh: e.scrollHeight, h: e.getBoundingClientRect().height, w: e.scrollWidth, vw: innerWidth }; });
check('everything fits in one view on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('layers, inspector, five tabs, the check and the in-use strip are there', await page.evaluate(() => document.querySelectorAll('#fg-st .cst-lay').length >= 4 && document.querySelectorAll('#fg-st .cst-tab').length === 5 && document.querySelectorAll('#fg-st .cst-proof li').length >= 3 && document.querySelectorAll('#fg-st .fs-use').length === 6 && document.querySelectorAll('#fg-st .fs-var').length === 4));
await page.click('#fg-st [data-fst="tab"][data-v="charges"]'); await page.click('#fg-st [data-fst="set"][data-f="e"][data-v="star"]');
const hit = await page.$('#fg-st .cst-ov [data-fpart="emb"]'), bb = await hit.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 30, { steps: 8 }); await page.mouse.up();
check('dragging moves the emblem and the inspector follows', await until(() => page.evaluate(() => { const f = window.__game.S.czFlag; return typeof f.ex === 'number' && f.ex > 55 && +document.getElementById('fs-i-ex').value > 55; })));
await page.keyboard.press('Control+z');
check('undo puts it back', await until(() => page.evaluate(() => window.__game.S.czFlag.ex === undefined || window.__game.S.czFlag.ex < 55)));
await page.keyboard.press('Control+y');
await page.click('#fg-st [data-fst="tab"][data-v="style"]');
await page.click('#fg-st [data-fst="trad"][data-v="union"]');
check('a tradition sets stripes and a starred canton', await until(() => page.evaluate(() => { const f = window.__game.S.czFlag; return f.p === 'stripes' && !!f.cn && f.ck === 12; })));
await page.click('#fg-st [data-fst="set"][data-f="pr"][data-v="swt"]');
await page.click('#fg-st [data-fst="set"][data-f="bd"][data-v="frame"]');
await page.click('#fg-st [data-fst="set"][data-f="ca"][data-v="rows"]');
const art = await page.evaluate(() => { const s = document.querySelector('#fg-st .fs-flag svg'); return { clip: !!s.querySelector('clipPath'), pr: s.dataset.pr }; });
check('the swallowtail is cut from the flag', art.clip && art.pr === 'swt', JSON.stringify(art));
await page.click('#fg-st [data-fst="tab"][data-v="colour"]'); await page.click('#fg-st [data-fst="harm"][data-v="comp"]');
await page.click('#fg-st [data-fst="tab"][data-v="charges"]'); await page.click('#fg-st [data-fst="set"][data-f="e"][data-v="star"]'); await page.click('#fg-st [data-fst="set"][data-f="arr"][data-v="cons"]');
check('charges can stand in a constellation', await until(() => page.evaluate(() => window.__game.S.czFlag.ea === 'cons' && window.__game.S.czFlag.ek >= 2)));
for (const v of ['building', 'map', 'pin', 'ship', 'tiny', 'pole']) await page.selectOption('#fg-st [data-fst-sel="see"]', v);
check('the flag is back on its pole', await page.evaluate(() => !!document.querySelector('#fg-st .fs-pole')));
await page.click('#fg-st [data-fst="tab"][data-v="var"]');
check('the four variants are drawn', await page.evaluate(() => document.querySelectorAll('#fg-st .fs-vfig > svg').length === 4));
await page.screenshot({ path: path.join(OUT, 'flag-studio.png') });
await page.selectOption('#fg-st [data-fst-sel="ver"]', 'save');
check('a version is saved on the nation', await until(() => page.evaluate(() => (window.__game.S.nation.fgV || []).length === 1)));
await page.click('#fg-st [data-fst="save"]');
const saved = await until(() => page.evaluate(() => { const f = window.__game.S.nation.flag; return f.p === 'stripes' && f.pr === 'swt' && f.bd === 'frame' && f.ca === 'rows' && f.ea === 'cons' ? JSON.stringify(f) : false; }));
check('Save flies the flag with every Studio choice', !!saved, saved);
check('the flag draws the same everywhere', await page.evaluate(() => { const s = window.__game.FD.flagSVG(window.__game.S.nation.flag, ''); return /clip-path/.test(s) && /data-pr="swt"/.test(s); }));
await page.click('#fg-st [data-fst="surprise"]');
check('Surprise me makes a new flag', await until(() => page.evaluate(() => JSON.stringify(window.__game.S.czFlag) !== JSON.stringify(window.__game.S.nation.flag))));
await page.keyboard.press('Control+z');
await page.setViewportSize({ width: 390, height: 844 });
const wide = await page.evaluate(() => { const e = document.getElementById('fg-st'); return { ok: e.scrollWidth <= innerWidth + 1, sw: e.scrollWidth, who: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(x => x.tagName + '.' + (x.className.baseVal ?? x.className) + '#' + x.id + ':' + Math.round(x.getBoundingClientRect().right)) }; });
check('on a phone the Studio does not scroll sideways', wide.ok, JSON.stringify(wide));
await page.screenshot({ path: path.join(OUT, 'flag-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('fg-st').hidden)));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
