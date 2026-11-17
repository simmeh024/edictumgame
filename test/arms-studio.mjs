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
/* the Arms Studio: the coat of arms on one screen, beside the Customise designer */
await page.goto(BASE);
await page.fill('#d-name', 'Armsmark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { location.hash = '#customise/arms'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
await page.evaluate(() => { const b = document.querySelector('[data-ars="open"]'); if (b) b.click(); else { const x = document.createElement('button'); x.dataset.ars = 'open'; document.body.appendChild(x); x.click(); x.remove(); } });
check('the Arms Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('ar-st'); return e && !e.hidden && !!e.querySelector('.as-pap svg.cz-arms'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('ar-st'); return { sh: e.scrollHeight, h: e.getBoundingClientRect().height, w: e.scrollWidth, vw: innerWidth }; });
check('everything fits in one view on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('parts, inspector, four tabs, the blazon and the in-use strip are there', await page.evaluate(() => document.querySelectorAll('#ar-st .as-lay').length === 9 && document.querySelectorAll('#ar-st .cst-tab').length === 4 && !!document.querySelector('#ar-st .as-blazon') && document.querySelectorAll('#ar-st .as-use').length === 6));
const A = (sel) => page.click('#ar-st ' + sel);
// shield: an ordinary on top of the division
await A('[data-ars="tab"][data-v="shield"]'); await A('[data-ars="set"][data-f="d"][data-v="fess"]'); await A('[data-ars="set"][data-f="or"][data-v="chief"]');
// charges: a lion, three of them in fess, a crown in chief
await A('[data-ars="tab"][data-v="charges"]'); await A('[data-ars="set"][data-f="c"][data-v="c-lion"]'); await A('[data-ars="set"][data-f="cn"][data-v="3"]');
await A('[data-ars="set"][data-f="ca"][data-v="fess"]'); await A('[data-ars="set"][data-f="c2"][data-v="c-star"]');
check('the blazon follows: three lions in fess, a chief, a star in chief', await until(() => page.evaluate(() => { const t = document.querySelector('#ar-st .as-blazon').textContent; return /three lions in fess/.test(t) && /a chief/.test(t) && /in chief a mullet/.test(t); })), await page.evaluate(() => document.querySelector('#ar-st .as-blazon').textContent));
// the full achievement
await A('[data-ars="tab"][data-v="ach"]');
for (const [f, v] of [['cr', 'helm'], ['su', 'eagle'], ['mn', '1'], ['cm', 'rock'], ['m', '1']]) await A(`[data-ars="set"][data-f="${f}"][data-v="${v}"]`);
await page.fill('#as-t-mt', 'Ever Onward');
const full = await page.evaluate(() => { const s = document.querySelector('#ar-st .as-pap svg.cz-arms'), vb = s.getAttribute('viewBox').split(' ').map(Number); return { w: vb[2], ever: /EVER ONWARD/.test(s.innerHTML) }; });
check('the full achievement is drawn round the shield, with the motto of its own', full.w > 200 && full.ever, JSON.stringify(full));
// drag the charges
const hit = await page.$('#ar-st .cst-ov [data-apart="ch"]'), bb = await hit.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 + 30, { steps: 6 }); await page.mouse.up();
check('dragging moves the charges', await until(() => page.evaluate(() => typeof window.__game.S.nation && document.getElementById('as-i-py') && +document.getElementById('as-i-py').value > 60)));
await page.locator('#as-cv').focus();
await page.keyboard.press('Control+z');
check('undo puts them back', await until(() => page.evaluate(() => +document.getElementById('as-i-py').value <= 60)));
check('the heraldry check speaks', await page.evaluate(() => document.querySelectorAll('#ar-st .cst-proof li').length >= 2));
for (const v of ['note', 'coin', 'passport', 'city', 'tiny', 'page']) await page.selectOption('#ar-st [data-ars-sel="see"]', v);
await page.screenshot({ path: path.join(OUT, 'arms-studio.png') });
await A('#as-save');
const saved = await until(() => page.evaluate(() => { const a = window.__game.S.nation.cz && window.__game.S.nation.cz.a; return a && a.or === 'chief' && a.cn === 3 && a.ca === 'fess' && a.c2 === 'c-star' && a.cr === 'helm' && a.su === 'eagle' && a.mn === 1 && a.cm === 'rock' && a.mt === 'Ever Onward' ? JSON.stringify(a) : false; }));
check('Save keeps every Studio choice on the arms', !!saved, saved);
await A('[data-ars="surprise"]');
check('Surprise me makes new arms', await until(() => page.evaluate(() => !document.querySelector('#ar-st [data-ars="discard"]').disabled)));
await A('[data-ars="discard"]');
await page.setViewportSize({ width: 390, height: 844 });
check('on a phone the Studio does not scroll sideways', await page.evaluate(() => document.getElementById('ar-st').scrollWidth <= innerWidth + 1));
await page.screenshot({ path: path.join(OUT, 'arms-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('ar-st').hidden)));
check('the Customise arms designer is still there, with the full arms in its preview', await until(() => page.evaluate(() => !!document.querySelector('#cz-a-s-heater, [id^="cz-a-s-"]') && !!document.querySelector('[data-ars="open"]') && +document.querySelector('.cz-arms-big').getAttribute('viewBox').split(' ')[2] > 200)));
await page.screenshot({ path: path.join(OUT, 'arms-customise.png') });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
