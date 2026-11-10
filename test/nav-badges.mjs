// Menu badges on every page: a number where something waits on the player (crates back from a dig, today's
// cabinet briefing, a war report since the page was last open), a dot for other news since then, cleared by a visit,
// and Settings › Notifications can hide the dots. Phones show the same in the More sheet. On the page itself, the tab
// or heading where the waiting thing is carries the same badge (Field digs, Cabinet, The Moon).
//   python3 build.py
//   node test/nav-badges.mjs
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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* every page's badges in the side menu: {page: ['3', '•'], ...} and the words for screen readers */
const badges = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('nav.nav [data-v]')].filter(b => b.querySelector('.badge'))
  .map(b => [b.dataset.v, [...b.querySelectorAll('.badge')].map(x => x.classList.contains('dot') ? '•' : x.textContent)])));
const words = v => page.evaluate(v => [...document.querySelectorAll(`nav.nav [data-v="${v}"] .u-sr`)].map(x => x.textContent).join(''), v);
/* change the nation as a save would, and draw the page again */
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const mark = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? (e.querySelector('.nvx-tb')?.textContent || '') + '|' + (e.querySelector('.nvx-sr')?.textContent || '') : null; }, sel);
/* a guide the game opens on a first visit is closed first; the menu is clicked through the page */
const go = async v => { await page.evaluate(() => document.querySelector('#tut-g [data-act="tut-g-close"]')?.click()); await page.evaluate(v => document.querySelector(`nav.nav [data-v="${v}"]`).click(), v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Badgeland');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  /* an established nation: every page in the menu, and no charter in the way */
  await edit(n => { delete n.onb; });
  await page.evaluate(() => { location.hash = '#nation'; });
  await page.waitForFunction(() => window.__game.S.view === 'nation' && document.querySelector('nav.nav [data-v="museum"]'));
  await sleep(1500);

  let b = await badges();
  check('today’s cabinet briefing shows as 1 on Government', String(b.government) === '1' && /cabinet briefing/.test(await words('government')), JSON.stringify(b));
  await go('government');
  check('on the Government page the Cabinet tab says where it is', /^1\|.*cabinet briefing/.test(await mark('#gv-tab-cabinet') || ''), await mark('#gv-tab-cabinet'));
  await go('nation');
  await edit((n, now, G) => { const st = G.GV().brief(n, now); n.brf = { d: st.d, i: st.it.id, a: 0 }; });
  check('answering it takes the badge away', await until(async () => !(await badges()).government));

  await edit((n, now) => { n.dig = [{ s: 0, t0: now - 7200e3, t1: now + 3600e3, r: 12 }]; });
  b = await badges();
  check('diggers still out raise nothing on the Museum', !b.museum, JSON.stringify(b));
  await edit((n, now) => { n.dig = [{ s: 0, t0: now - 7200e3, t1: now - 5000, r: 12 }]; });
  b = await badges();
  check('diggers back with crates to open show as 1 on the Museum', String(b.museum) === '1' && /crates to open/.test(await words('museum')), JSON.stringify(b));
  await go('museum');
  check('in the Museum the Field digs tab says where the crates are', /^1\|.*crates to open/.test(await mark('.mu-tabs [data-h="digs"]') || ''), await mark('.mu-tabs [data-h="digs"]'));
  await page.screenshot({ path: path.join(OUT, 'nav-badges-museum.png') });
  check('other halls carry nothing', !(await page.evaluate(() => document.querySelector('.mu-tabs [data-h="entrance"] .nvx-tb'))));
  await go('nation');
  check('a visit alone does not clear what still waits there', String((await badges()).museum) === '1');
  await edit(n => { n.dig = []; });
  check('opening the crates clears it', !(await badges()).museum);

  /* a capital, then a finished Lunar Colony: a landing site to choose, marked on the Moon's tab */
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  await edit((n, now) => { n.cities[0].b = [...(n.cities[0].b || []), { k: 'lunar', s: now - 9e6, d: now - 5000, a: 1 }]; });
  check('a Lunar Colony ready to land shows as 1 on Space', String((await badges()).space) === '1' && /landing site/.test(await words('space')), JSON.stringify(await badges()));
  await go('space');
  check('and on the Space page, on the Moon’s tab', /^1\|.*landing site to choose on the Moon/.test(await mark('.sp-tabs [data-b="moon"]') || ''), await mark('.sp-tabs [data-b="moon"]'));
  await page.evaluate(() => { location.hash = '#nation'; }); await until(() => page.evaluate(() => window.__game.S.view === 'nation'));

  await edit((n, now) => { n.log = [{ t: now, k: 'npcwar', a: '', b: 'Ostrava', fx: '' }, ...(n.log || [])]; });
  b = await badges();
  check('a declaration of war since the map was last open counts on the Map', (b.map || []).includes('1') && /1 new report/.test(await words('map')), JSON.stringify(b));
  await go('map'); await go('nation');
  check('opening the Map clears the report', !((await badges()).map || []).includes('1'), JSON.stringify(await badges()));

  await edit((n, now) => { n.log = [{ t: now, k: 'games', a: 'the Spring Games', b: '', fx: 'gold in rowing' }, ...(n.log || [])]; });
  b = await badges();
  check('other news on a page is a dot', String(b.games) === '•' && /new since your last visit/.test(await words('games')), JSON.stringify(b));
  await page.locator('nav.nav').first().screenshot({ path: path.join(OUT, 'nav-badges-side.png') });
  const seen = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('statehood.navSeen.')));
  check('when each page was last open is kept on this device', !!seen);

  await go('settings');
  await page.click('#sg-tab-notif'); await page.click('#ntf-nvd-0'); await sleep(300);
  check('Settings › Notifications can hide the dots', !(await badges()).games && (await page.evaluate(() => JSON.parse(localStorage.getItem('statehood.notif')).nvd)) === 0);
  await page.click('#ntf-nvd-1'); await sleep(300);
  check('and show them again', String((await badges()).games) === '•');

  await go('games'); await go('nation');
  check('opening the page clears its dot', !(await badges()).games);

  /* phones: the More tab carries a dot, and the More sheet the page's badge */
  await edit((n, now) => { n.dig = [{ s: 1, t0: now - 7200e3, t1: now - 5000, r: 9 }]; });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(600);
  await page.evaluate(() => { location.hash = '#nation'; }); await sleep(600);
  check('on a phone the More tab shows that something waits', await until(() => page.evaluate(() => !!document.querySelector('#tab-more .tab-dot'))));
  await page.click('#tab-more');
  check('and the More sheet shows the Museum’s badge', await until(() => page.evaluate(() => document.querySelector('#more-sheet [data-v="museum"] .badge')?.textContent === '1')));
  await page.screenshot({ path: path.join(OUT, 'nav-badges-phone.png') });

  /* a reload draws the first page before it counts the badges (nvxWarm): they follow a moment later, on the menu
     and on the page */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.S.nation && document.querySelector('nav.nav [data-v="museum"]'));
  check('after a reload the badges follow the first paint', await until(async () => String((await badges()).museum) === '1'), JSON.stringify(await badges()));
  await go('museum');
  check('and the page marks its tab as before', /^1\|.*crates to open/.test(await mark('.mu-tabs [data-h="digs"]') || ''), await mark('.mu-tabs [data-h="digs"]'));

  check('no errors in the page', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('FAIL the run stopped: ' + (e && e.stack || e)); failed++;
  try { await page.screenshot({ path: path.join(OUT, 'nav-badges-fail.png') }); } catch (x) {}
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
