// Cities that need the player, in the bell: a matter waiting, idle builders and a city without a mayor each show as a
// pinned notice that counts in the bell's number, and a click opens that city on the right tab with the spot in view
// and lit up. The Cities entry in the menu counts the matters; Settings › Notifications can leave the reminders out.
//   python3 build.py
//   node test/city-alerts.mjs
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
/* change the nation as a save would, and draw the page again */
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const home = async () => { await page.evaluate(() => { location.hash = '#nation'; }); await until(() => page.evaluate(() => window.__game.S.view === 'nation')); await sleep(300); };
/* the bell's city notices: [label, text, city, tab, spot, new] */
const cityNotes = () => page.evaluate(() => [...document.querySelectorAll('.notif-pop [data-cx]')].map(b => [b.querySelector('.nt-k').textContent, b.querySelector('.nt-x').textContent, b.dataset.cx, b.dataset.cxt, b.dataset.cxa, b.closest('.nt-item').classList.contains('new')]));
/* a closing bell stays on the page for a moment while it fades, so the game's own state says whether it is open */
const isOpen = () => page.evaluate(() => !!window.__game.S.notifOpen);
const closeBell = async () => { if (await isOpen()) await page.click('.bell'); await until(() => page.evaluate(() => !document.querySelector('.notif-pop'))); };
const openBell = async () => { if (!(await isOpen())) { await closeBell(); await page.click('.bell'); } await until(() => page.evaluate(() => document.querySelectorAll('.notif-pop').length === 1)); };
const bellNumber = () => page.evaluate(() => { const b = document.querySelector('.bell-n'); return b && !b.hidden ? b.textContent : ''; });
const citiesBadge = () => page.evaluate(() => { const b = document.querySelector('nav.nav [data-v="cities"]'); return b ? [[...b.querySelectorAll('.badge')].map(x => x.textContent).join(','), [...b.querySelectorAll('.u-sr')].map(x => x.textContent).join('')] : null; });
/* where the page landed: the element is on screen, lit up and focused */
const landed = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return 'missing'; const r = e.getBoundingClientRect();
  return [r.top >= 0 && r.top < innerHeight - 40 ? 'in view' : 'off screen ' + Math.round(r.top), e.classList.contains('ca-flash') ? 'lit' : 'not lit', document.activeElement === e ? 'focused' : 'not focused'].join(', '); }, sel);
const IN = 'in view, lit, focused';
const click = async (cx, cxa) => { await openBell(); await page.click(`.notif-pop [data-cx="${cx}"][data-cxa="${cxa}"]`); await until(() => page.evaluate(() => window.__game.S.view === 'cities' && !document.querySelector('.notif-pop'))); await sleep(500); };

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Alertmark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  /* an established nation, past the charter, with a capital on the map */
  await edit(n => { delete n.onb; });
  await home();
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  await home();
  const cid = await page.evaluate(() => window.__game.S.nation.cities[0].id);
  const cap = await page.evaluate(() => window.__game.NB.myCityStates().mine[0].nm);
  /* the capital: plenty in the stockpile, nothing built, no mayor, and a matter due a minute ago */
  await edit((n, now) => { const c = n.cities[0]; c.b = []; delete c.my; c.ne = now - 60e3; n.stock = { food: 500, timber: 500, iron: 500, oil: 500, goods: 500 }; n.stockAt = now; n._stockSet = true; });
  await sleep(3200);

  const num0 = +(await bellNumber() || 0);
  await openBell();
  let notes = await cityNotes();
  const ev = notes.find(x => x[4] === 'ev'), idle = notes.find(x => x[3] === 'build'), mayor = notes.find(x => x[4] === 'mayor');
  check('a matter waiting is in the bell, under the city’s name, with what it is about', !!ev && ev[0] === cap && /A matter waits for your answer\.$/.test(ev[1]) && ev[2] === cid && ev[3] === 'ppl', JSON.stringify(notes));
  check('so are idle builders in the capital', !!idle && /has \d+ empty blocks and idle builders\. Choose what to build\./.test(idle[1]) && idle[0] === 'Ministry of Works', JSON.stringify(idle));
  check('and the missing mayor', !!mayor && /has no mayor\. Candidates are waiting/.test(mayor[1]), JSON.stringify(mayor));
  check('all three are new and counted in the bell’s number', notes.length === 3 && notes.every(x => x[5]) && num0 >= 3, `${num0} ${JSON.stringify(notes)}`);
  await page.locator('.notif-pop').screenshot({ path: path.join(OUT, 'city-alerts-bell.png') });
  await closeBell();
  const b = await citiesBadge();
  check('the Cities entry in the menu counts the matter', !!b && /^1$|^1,|,1$/.test(b[0]) && /a matter to answer/.test(b[1]), JSON.stringify(b));
  check('opening the bell takes them out of its number, as every pinned notice', +(await bellNumber() || 0) <= num0 - 3, await bellNumber());
  await openBell();
  check('but they stay in the bell while the city still needs you', (await cityNotes()).length === 3 && (await cityNotes()).every(x => !x[5]));

  await click(cid, 'ev');
  check('the matter opens the capital on its People tab', await page.evaluate(id => { const G = window.__game; return G.S.cxSel === id && document.querySelector('.cx-tabs .stab.on')?.textContent.startsWith('People'); }, cid));
  check('with the matter on screen, lit up and focused', await landed('#cx-matter') === IN, await landed('#cx-matter'));
  await page.screenshot({ path: path.join(OUT, 'city-alerts-matter.png') });

  await home(); await page.evaluate(() => window.scrollTo(0, 400));
  await click(cid, '');
  check('idle builders open the city’s Build tab', await page.evaluate(id => window.__game.S.cityOpen === id && document.querySelector('.cx-tabs .stab.on')?.textContent === 'Build', cid));
  check('with the city on screen, lit up and focused', await landed(`#city-${cid}`) === IN, await landed(`#city-${cid}`));

  await home();
  await click(cid, 'mayor');
  check('the missing mayor opens the People tab at the candidates', await page.evaluate(() => document.querySelector('.cx-tabs .stab.on')?.textContent.startsWith('People')) && await landed('#cx-mayor') === IN, await landed('#cx-mayor'));

  /* from the Cities page itself, on another tab: the notice still finds its spot */
  await page.click('.cx-tabs [data-k="def"]'); await sleep(200);
  await click(cid, 'ev');
  check('a notice works from the Cities page too', await landed('#cx-matter') === IN, await landed('#cx-matter'));

  /* answering the matter ends its notice and the menu's count */
  await page.click('#cx-matter [data-act="cx-ev"]:not([disabled])'); await sleep(3400);
  await openBell(); notes = await cityNotes();
  check('an answered matter leaves the bell', !notes.some(x => x[4] === 'ev') && notes.length === 2, JSON.stringify(notes));
  await closeBell();
  check('and the menu stops counting it', !/a matter to answer/.test((await citiesBadge())?.[1] || ''), JSON.stringify(await citiesBadge()));

  /* Settings › Notifications: the reminders can go, the matters stay */
  await page.evaluate(() => { location.hash = '#settings'; }); await until(() => page.evaluate(() => window.__game.S.view === 'settings'));
  await page.click('#sg-tab-notif'); await page.waitForSelector('[data-ntf-mute="city"]');
  check('Settings › Notifications offers the city reminders', /City reminders/.test(await page.evaluate(() => document.querySelector('[data-ntf-mute="city"]').closest('label').textContent)));
  await page.uncheck('[data-ntf-mute="city"]'); await sleep(200);
  await edit((n, now) => { n.cities[0].ne = now - 1000; }); await sleep(3200);
  await openBell(); notes = await cityNotes();
  check('with them off, only the new matter is told', notes.length === 1 && notes[0][4] === 'ev', JSON.stringify(notes));
  await closeBell();
  await page.check('[data-ntf-mute="city"]'); await sleep(200);

  /* on a phone the list of cities sits above the city: the notice scrolls down to the matter */
  await page.setViewportSize({ width: 390, height: 844 }); await home();
  await click(cid, 'ev');
  check('on a phone the matter is on screen too', await landed('#cx-matter') === IN, await landed('#cx-matter'));
  check('and nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(OUT, 'city-alerts-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });

  /* dark */
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await home(); await openBell();
  await page.locator('.notif-pop').screenshot({ path: path.join(OUT, 'city-alerts-bell-dark.png') });
  await closeBell();

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
