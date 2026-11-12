// Customise › Passport: the passport's cover, pages and entry stamp are designed in Customise as well as on the Passport
// page. The section sits in Presentation after Community Board, opens at #customise/passport, saves a pick and stays
// put, counts what is held the same whether drawn or not, hides the other sections (Community Board's own view too),
// is found by the search, and fits a phone. A passport unlock's link lands on its tile there.
//   python3 build.py
//   node test/customise-passport.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
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

async function start(viewport) {
  const page = await browser.newPage({ viewport }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  return { page, errors };
}
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await sleep(900); };
const shown = page => page.evaluate(() => [...document.querySelectorAll('.cz-sec')].filter(s => s.getClientRects().length).map(s => s.id));

const { page, errors } = await start({ width: 1366, height: 900 });
await go(page, '#customise/passport');
const at = await page.evaluate(() => ({ view: window.__game.S.view, sec: document.getElementById('cz-dock')?.dataset.sec, rail: [...document.querySelectorAll('.cz-go .cz-go-l')].map(e => e.textContent),
  tabs: [...document.querySelectorAll('#cz-sec-p [data-act="pp-dtab"]')].map(b => b.textContent), title: document.querySelector('#cz-sec-p h2')?.textContent }));
check('#customise/passport opens Customise on the Passport section', at.view === 'customise' && at.sec === 'p' && /^VII\s*Passport/.test(at.title || ''), at);
check('it is listed in Presentation, after Community Board', at.rail.indexOf('Passport') === at.rail.indexOf('Community Board') + 1, at.rail);
check('with the cover, the pages and the entry stamp to design', at.tabs.join() === 'Cover,Pages,Entry stamp', at.tabs);
check('and only the Passport section is drawn and shown', JSON.stringify(await shown(page)) === '["cz-sec-p"]', await shown(page));
const openCount = await page.evaluate(() => document.querySelector('[data-czn="p"]')?.textContent);
await page.locator('#cz-sec-p').screenshot({ path: path.join(OUT, 'customise-passport.png'), clip: undefined }).catch(() => {});

/* a pick saves, and the page stays where it is */
const pick = await page.evaluate(() => { const b = [...document.querySelectorAll('#cz-sec-p [data-act="pp-set"][data-f="c.col"]')].find(x => !x.classList.contains('on') && !x.classList.contains('locked')); return b && b.dataset.v; });
await page.click(`#cz-sec-p [data-act="pp-set"][data-f="c.col"][data-v="${pick}"]`); await sleep(400);
const saved = await page.evaluate(() => ({ col: window.__game.S.nation.pp && window.__game.S.nation.pp.c.col, view: window.__game.S.view, sec: document.getElementById('cz-dock')?.dataset.sec, on: document.querySelector('#cz-sec-p [data-f="c.col"].on')?.dataset.v }));
check('choosing a cover colour there saves it, and Customise stays on Passport', saved.col === pick && saved.on === pick && saved.view === 'customise' && saved.sec === 'p', { pick, saved });
await page.click('#cz-sec-p [data-act="pp-dtab"][data-v="s"]'); await sleep(300);
const stamp = await page.evaluate(() => ({ shapes: document.querySelectorAll('#cz-sec-p [data-act="pp-set"][data-f="s.sh"]').length, big: !!document.querySelector('#cz-sec-p .pp-stamp-big svg') }));
check('the Entry stamp tab shows every shape and the stamp itself', stamp.shapes >= 17 && stamp.big, stamp);
await page.screenshot({ path: path.join(OUT, 'customise-passport-stamp.png') });
const afterTab = await page.evaluate(() => document.querySelector('[data-czn="p"]')?.textContent);

/* the count is the same whether the section is drawn or only its heading (the cover colour picked above earned Cover
   Story, whose stamp shape counts one more held) */
await go(page, '#customise/banner');
const stubCount = await page.evaluate(() => ({ n: document.querySelector('[data-czn="p"]')?.textContent, lazy: document.getElementById('cz-sec-p')?.dataset.lazy }));
check('what is held counts every passport cosmetic, the same whichever tab was open or whether the section is drawn', stubCount.lazy === '1' && stubCount.n === afterTab && / of (\d+) held$/.exec(openCount)?.[1] === / of (\d+) held$/.exec(afterTab)?.[1], { openCount, afterTab, stubCount });
check('another section open hides the passport', JSON.stringify(await shown(page)) === '["cz-sec-b"]', await shown(page));
await go(page, '#customise/board');
check('Community Board open shows only itself, not the other sections’ headings', JSON.stringify(await shown(page)) === '["cz-sec-w"]', await shown(page));

/* the way back to the book, the search, and an unlock's link */
await go(page, '#customise/passport');
await page.click('#cz-sec-p [data-act="go"][data-v="passport"]'); await sleep(500);
check('Open your passport goes to the Passport page', await page.evaluate(() => window.__game.S.view) === 'passport');
await page.keyboard.press('Control+k'); await sleep(200); await page.keyboard.type('passport designer'); await sleep(300);
const hit = await page.evaluate(() => [...document.querySelectorAll('[data-v="focus:passport"]')].length);
if (hit) { await page.click('[data-v="focus:passport"]'); await sleep(900); }
check('the search’s Passport designer opens Customise › Passport', hit > 0 && await page.evaluate(() => window.__game.S.view === 'customise' && document.getElementById('cz-dock')?.dataset.sec === 'p'), hit);
const link = await page.evaluate(async () => { const X = window.__game.UX, T = X.unlockTarget('ps-laurel'); X.unlockShow('ps-laurel'); await new Promise(r => setTimeout(r, 900));
  const el = document.querySelector(T.target), b = el && el.getBoundingClientRect(); return { view: window.__game.S.view, sec: document.getElementById('cz-dock')?.dataset.sec, seen: !!b && b.top < innerHeight && b.bottom > 0 }; });
check('a passport unlock’s link lands on its tile in Customise › Passport, on the Entry stamp tab', link.view === 'customise' && link.sec === 'p' && link.seen, link);
check('no script errors on a desktop', errors.length === 0, errors.slice(0, 5));
await page.close();

/* a phone: the passport above its tiles, nothing wider than the screen */
const ph = await start({ width: 390, height: 844 });
await go(ph.page, '#customise/passport');
const fit = await ph.page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, has: !!document.querySelector('#cz-sec-p .pp-des'), prevFirst: (() => { const p = document.querySelector('#cz-sec-p .pp-prev'), c = document.querySelector('#cz-sec-p .pp-ctl'); return p && c && p.getBoundingClientRect().top < c.getBoundingClientRect().top; })() }));
check('on a phone the passport shows above its tiles, and nothing is wider than the screen', fit.has && fit.prevFirst && !fit.over, fit);
await ph.page.screenshot({ path: path.join(OUT, 'customise-passport-phone.png') });
check('no script errors on a phone', ph.errors.length === 0, ph.errors.slice(0, 5));

await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
