import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Christmas on Willow Street in the browser, on the page as built, with no Firestore (a local game) and the clock set to
// 14:00 UTC on 12 December 2026: a nation founded that day finds the note of 30 November and twelve letters waiting,
// answers the note (5 land credits) and five letters through the page itself, and sees its windows lit, its Christmas
// case in the Museum, the season's card on the Edicts page and the menu's count; on a phone the street scrolls in its
// own strip and nothing else is wider than the screen. A preview of 25 December (?xmas=) keeps its answers to itself.
//   python3 build.py && node test/xmas.mjs
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
const NOW = Date.UTC(2026, 11, 12, 14);

for (const [theme, viewport, tag] of [['light', { width: 1280, height: 900 }, 'desk'], ['dark', { width: 390, height: 844 }, 'phone']]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; try { localStorage.setItem('statehood.mlkopen.v1', '1'); } catch (e) {} });
  await page.goto(BASE);
  await page.fill('#d-name', tag === 'desk' ? 'Yuletide' : 'Mistletoe'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0));
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.onb; G.commit(n); G.render(); });
  const X = () => page.evaluate(() => { const x = window.EDICTUM_PROBE.xm, n = window.__game.S.nation; return { count: x.xmCount(n), rec: x.xmRec(n).map(e => [e.id, e.o]), land: x.xmLand(n), lc: x.landCredits(n), u: x.xmUnlocks(n), stock: n.stock, phase: x.xmPhase(x.xmNow()) }; });
  const go = h => page.evaluate(h => { location.hash = '#' + h; }, h);
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  await go('christmas'); await until(() => page.$('.xm-scene'));
  const cal = await page.evaluate(() => ({ h: (document.querySelector('.xm-vh h1') || {}).textContent, tiles: document.querySelectorAll('.xm-tile').length,
    open: document.querySelectorAll('.xm-tile.open').length, wait: document.querySelectorAll('.xm-tile.wait').length, locked: document.querySelectorAll('.xm-tile.locked').length,
    say: (document.querySelector('.xm-say') || {}).textContent, pre: !!document.querySelector('.xm-prec [data-xm="open"][data-d="0"]'), wins: document.querySelectorAll('.xm-w').length,
    times: (document.querySelector('.xm-times') || {}).textContent || '' }));
  check(`${tag}: the calendar is there`, cal.h === 'Christmas on Willow Street' && cal.tiles === 25 && cal.wins === 25, cal);
  check(`${tag}: on 12 December, letter 1 is open, 2 to 12 wait their turn, 13 to 25 have not arrived`, cal.open === 1 && cal.wait === 11 && cal.locked === 13, cal);
  check(`${tag}: twelve letters waiting, the reset time and the deadline said`, /Twelve letters are waiting/.test(cal.say) && /00:00 UTC/.test(cal.times) && /23:59 UTC/.test(cal.times) && /Letter 13 arrives/.test(cal.times), cal);
  check(`${tag}: the note of 30 November is waiting`, cal.pre, cal);
  const navWords = await page.evaluate(() => [...document.querySelectorAll('[data-act="go"][data-v="christmas"]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  check(`${tag}: Christmas is in the menu`, /Christmas/.test(navWords), navWords);
  if (tag === 'phone') check('phone: nothing but the street is wider than the screen', (await wide()) <= 0, await wide());
  await page.screenshot({ path: path.join(OUT, `xmas-${tag}-calendar.png`), fullPage: true });

  /* the note: any answer, 5 land credits */
  const lc0 = (await X()).lc;
  await page.click('.xm-prec [data-xm="open"][data-d="0"]'); await until(() => page.$('.xm-paper'));
  check(`${tag}: the note says it is worth 5 land credits`, /\+5 land credits/.test(await page.textContent('.xm-paper')));
  await page.click('[data-xm="pick"][data-i="1"]'); await page.click('[data-xm="seal"]'); await sleep(300);
  const a0 = await X();
  check(`${tag}: the note answered, 5 land credits more`, a0.rec.some(([d]) => d === 0) && a0.land === 5 && a0.lc === lc0 + 5, { a0, lc0 });

  /* five letters through the page */
  const food0 = (await X()).stock.food;
  for (let d = 1; d <= 5; d++) {
    await go('christmas'); await sleep(150);
    await page.evaluate(() => { const b = document.querySelector('[data-xm="cal"]'); if (b) b.click(); });
    await page.click(`.xm-tile[data-d="${d}"]`); await until(() => page.$('[data-xm="pick"]'));
    if (d === 1) {
      await page.click('[data-xm="pick"][data-i="2"]'); await sleep(100);
      const conf = await page.evaluate(() => (document.querySelector('.xm-confirm') || {}).textContent || '');
      check(`${tag}: the gift is named before the answer is sealed`, /You receive/.test(conf) && /Potato Seal/.test(conf) && /20 timber/.test(conf), conf);
      if (tag === 'phone') check('phone: a letter fits the screen', (await wide()) <= 0, await wide());
      await page.screenshot({ path: path.join(OUT, `xmas-${tag}-letter.png`), fullPage: true });
    } else await page.click('[data-xm="pick"][data-i="0"]');
    if (d === 5) check(`${tag}: letter 5 shows its piece for Customise`, /Gingerbread Star/.test(await page.textContent('.xm-czb')));
    await page.click('[data-xm="seal"]'); await until(() => page.$('.result-fx'));
    if (d === 1) { await page.screenshot({ path: path.join(OUT, `xmas-${tag}-result.png`), fullPage: true });
      check(`${tag}: window 1 is lit`, /Window 1 on Willow Street is lit/.test(await page.textContent('.xm-paper'))); }
  }
  const a5 = await X();
  check(`${tag}: five letters answered, in order`, a5.count === 5 && JSON.stringify(a5.rec.filter(([d]) => d > 0).map(([d]) => d)) === '[1,2,3,4,5]', a5.rec);
  check(`${tag}: letter 5 earned the Gingerbread Star`, a5.u.includes('e-gingerstar'), a5.u);
  check(`${tag}: the gifts reached the stores`, a5.stock.food > food0, { food0, food: a5.stock.food });
  /* the calendar again: five lit, the next open, the case filling */
  await go('christmas'); await page.evaluate(() => { const b = document.querySelector('[data-xm="cal"]'); if (b) b.click(); }); await sleep(200);
  const cal2 = await page.evaluate(() => ({ lit: document.querySelectorAll('.xm-w.s-lit').length, open: document.querySelector('.xm-tile.open') && document.querySelector('.xm-tile.open').dataset.d, count: (document.querySelector('.xm-count') || {}).textContent, keeps: document.querySelectorAll('.xm-case svg').length }));
  check(`${tag}: five windows lit and letter 6 open`, cal2.lit === 5 && cal2.open === '6' && /5 of 25 lights lit/.test(cal2.count) && cal2.keeps === 5, cal2);
  await page.screenshot({ path: path.join(OUT, `xmas-${tag}-calendar-5.png`), fullPage: true });
  /* a second answer to letter 1 changes nothing */
  await page.evaluate(() => { location.hash = '#christmas'; }); await page.click('.xm-tile[data-d="1"]'); await sleep(200);
  check(`${tag}: an answered letter offers no answer again`, !(await page.$('[data-xm="pick"]')));
  /* the Edicts page, the Museum */
  await go('edicts'); await until(() => page.$('.xm-desk'));
  check(`${tag}: the season’s card on the Edicts page`, /Seven letters are waiting/.test(await page.textContent('.xm-desk')), await page.textContent('.xm-desk'));
  await page.evaluate(() => { window.__game.S.muHall = 'xmas'; location.hash = '#museum'; }); await until(() => page.$('.xm-shelf'));
  check(`${tag}: the Christmas case holds five keepsakes`, (await page.$$('.xm-shelf li')).length === 5);
  if (tag === 'phone') check('phone: the Museum’s case fits the screen', (await wide()) <= 0, await wide());
  check(`${tag}: no errors on the page`, errors.length === 0, errors);
  await ctx.close();
}

/* a preview of Christmas Day on a development host: everything open, nothing saved */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE + '?xmas=2026-12-25T10:00Z');
  await page.fill('#d-name', 'Previewland'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation);
  await page.evaluate(() => { location.hash = '#christmas'; }); await until(() => page.$('.xm-pv'));
  const pv = await page.evaluate(() => ({ banner: document.querySelector('.xm-pv').textContent, say: document.querySelector('.xm-say').textContent }));
  check('preview: the banner says so, and every letter has arrived', /Preview/.test(pv.banner) && /Twenty-five letters are waiting/.test(pv.say), pv);
  await page.click('.xm-tile[data-d="1"]'); await page.click('[data-xm="pick"][data-i="0"]'); await page.click('[data-xm="seal"]'); await sleep(200);
  const saved = await page.evaluate(() => ({ xm: window.__game.S.nation.xm || null, n: window.EDICTUM_PROBE.xm.xmCount(window.__game.S.nation) }));
  check('preview: the answer stays in the tab and is never saved', saved.xm === null && saved.n === 1, saved);
  check('preview: no errors', errors.length === 0, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
