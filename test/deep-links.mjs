// Deep links: what needs the player opens on the thing itself. The outfitters' "Needs Farm Estates upgraded to blue"
// opens the Farm Estates nearest blue, with its Upgrade button pulsing; the search's building results, the desk's
// "Upgrade a building", What's next's "Take a building to gold" and a finished building in the bell land on the
// building's row in its city; idle builders open a city's Build tab, a city to found its form, roads the capital's
// roads, land credits the land office, an offer of peace its Accept button, a milestone the milestones.
//   python3 build.py
//   node test/deep-links.mjs
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
const open = async h => { await page.evaluate(h => { location.hash = h; }, h); await until(() => page.evaluate(h => window.__game.S.view === h.slice(1) || (h === '#issues' && window.__game.S.view === 'issues'), h)); await sleep(400); };
const home = () => open('#nation');
/* where the page landed: the view, the element in view (below the sticky bar), lit and focused, and what pulses */
const landed = (view, sel) => until(() => page.evaluate(([view, sel]) => {
  const S = window.__game.S; if (S.view !== view) return false; const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect();
  return r.top >= 0 && r.top < innerHeight - 40 && e.classList.contains('ca-flash') && document.activeElement === e;
}, [view, sel]), 5000);
const pulsing = sel => until(() => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.classList.contains('tut-coach'); }, sel), 4000);
const nowAt = () => page.evaluate(() => { const S = window.__game.S, a = document.activeElement; return `${S.view} · city ${S.cxSel} · tab ${S.cxTab} · focus ${a && (a.id || a.className)}`; });
/* a button as the game draws it, clicked where the game would find it */
const press = html => page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; document.querySelector('#main').prepend(d); d.querySelector('button').click(); }, html);

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Linkmark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await home();
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  await home();
  const cap = await page.evaluate(() => window.__game.S.nation.cities[0].id);
  const bell = async sel => { await home(); await page.click('.bell'); await until(() => page.evaluate(() => !!document.querySelector('.notif-pop'))); const l = page.locator('.notif-pop ' + sel).first(); if (!(await l.count())) return false; await l.click(); return true; };
  check('land credits in the bell', await bell('[data-dl="land"]'));
  check('open the land office', await landed('map', '#lc-coach'), await nowAt());
  await home();
  check('the Nation page’s land credits card opens the land office too', await page.evaluate(() => !!document.querySelector('.nx-card [data-dl="land"]')));

  /* the capital: a University upgraded to green, Farm Estates to grey, a Market Hall; Fenwick: a University at purple,
     Farm Estates at green, a Sawmill; plenty in the stockpile */
  await edit((n, now, G) => {
    const M = G.MAP, c0 = n.cities[0], T = G.XP().territory(), mi = T.list.findIndex(x => x.me), d = 864e5, dist = new Map([[c0.c, 0]]), q = [c0.c];
    while (q.length) { const c = q.shift(), k = dist.get(c); if (k >= 6) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb < 0 || dist.has(nb) || M.T[nb] < 2) continue; if (T.owner[nb] >= 0 && T.owner[nb] !== mi) continue; dist.set(nb, k + 1); q.push(nb); } }
    const have = new Set((n.claims || []).map(e => e.c));
    n.claims = (n.claims || []).concat([...dist.keys()].filter(c => !have.has(c) && c !== c0.c).map((c, i) => ({ c, t: now - d + i })));
    const far = [...dist.entries()].filter(([, k]) => k >= 4).sort((x, y) => y[1] - x[1]).map(([c]) => c);
    const t = now - 2 * d, B = (k, ug) => ({ k, s: t - 1e5, d: t, ...(ug ? { ug } : {}) });
    c0.b = [B('university', 2), B('farm', 1), B('market')];
    n.cities.push({ id: 'c1', c: far[0], nm: 'Fenwick', t: now - 6 * d, b: [B('university', 4), B('farm', 2), B('sawmill')] });
    n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; n._stockSet = true;
  });
  await home();
  check('two cities, Fenwick holding the higher University', await page.evaluate(() => { const D = window.EDICTUM_PROBE.dl, b = D.dlBest(['university']); return D.dlCities().length === 2 && b && b[0].id === 'c1'; }));

  /* 1. the outfitters: Light rations blue needs Farm Estates upgraded to blue; the button names the one nearest it */
  await edit(n => { n.xu = { rations: 4 }; delete n.xuw; });
  await open('#explore');
  await page.evaluate(() => { const x = document.getElementById('xu'); if (x) x.open = true; });
  const need = await page.evaluate(() => { const b = document.querySelector('.xu-need.no [data-dl^="req:farm"]'); return b ? b.textContent : ''; });
  check('the outfitters name the building and the city to upgrade', need === 'Upgrade the Farm Estates in Fenwick', need);
  const mr = await page.evaluate(() => { const b = document.querySelector('.xu-need.no [data-dl^="req:maproom"]'); return b ? b.textContent : ''; });
  check('and the building to put up when there is none', mr === 'Build a Map Room', mr);
  await page.click('.xu-need.no [data-dl^="req:farm"]');
  check('a click opens Fenwick’s Farm Estates, in view, lit and focused', await landed('cities', '#bld-c1-farm'), await nowAt());
  check('with its Upgrade button pulsing', await pulsing('#bld-c1-farm [data-act="cx-up"]'));
  await page.screenshot({ path: path.join(OUT, 'deep-links-requirement.png') });
  await open('#explore');
  await page.evaluate(() => { const x = document.getElementById('xu'); if (x) x.open = true; });
  await page.click('.xu-need.no [data-dl^="req:maproom"]');
  check('Build a Map Room opens its plan in the Build tab', await landed('cities', '#bk-maproom'), await nowAt());
  check('and the pulse of the link before is gone', !(await page.evaluate(() => !!document.querySelector('.tut-coach'))));

  /* 2. the search's building result: the University with the highest upgrade */
  await home();
  await page.evaluate(() => window.__game.CP2().qjBuilding('university'));
  check('the search opens the highest University (Fenwick, purple)', await landed('cities', '#bld-c1-university'), await nowAt());
  await home();
  await page.evaluate(() => window.__game.CP2().qjBuilding('hospital'));
  check('and a building not built yet at its plan', await landed('cities', '#bk-hospital'), await nowAt());

  /* 3. the desk */
  await home();
  await press('<button data-act="dd-go" data-k="ugb">Open Cities</button>');
  check('the desk’s “Upgrade a building” opens the highest that can start now', await landed('cities', '#bld-c1-university'), await nowAt());
  check('its Upgrade button pulses', await pulsing('#bld-c1-university [data-act="cx-up"]'));
  /* Fenwick is busy upgrading its University: the next startable one is the capital's */
  await edit((n, now) => { const u = n.cities.find(c => c.id === 'c1').b.find(b => b.k === 'university'); u.uu = { u: 5, s: now - 1000, d: now + 3600e3 }; });
  await home();
  await press('<button data-act="dd-go" data-k="ugb">Open Cities</button>');
  check('with Fenwick’s builders busy, the capital’s University instead', await landed('cities', `#bld-${cap}-university`), await nowAt());
  await edit(n => { const u = n.cities.find(c => c.id === 'c1').b.find(b => b.k === 'university'); delete u.uu; });
  await home();
  await press('<button data-act="dd-go" data-k="build">Open Cities</button>');
  check('the desk’s “Start a building” opens a city with idle builders on its Build tab', await landed('cities', `#city-${cap} .cat-wrap`), await nowAt());
  await home();
  await press('<button data-act="dd-go" data-k="city">Open Cities</button>');
  check('the desk’s “Found a new city” opens the form for it', await landed('cities', '#cx-new'), await nowAt());

  /* 4. What's next */
  const tut = async k => { await home(); const d = await page.evaluate(k => window.EDICTUM_PROBE.dl.DL_TUT[k], k);
    await press(`<div class="tut-c"><ul><li data-k="${k}"><button data-act="go" data-v="cities" data-dl="${d}">Open cities</button></li></ul></div>`); };
  await tut('ug5');
  check('“Take a building to gold” opens the highest building of all', await landed('cities', '#bld-c1-university'), await nowAt());
  const free = await page.evaluate(() => window.EDICTUM_PROBE.dl.free()), room = free.filter(x => x[1] > 0 && !x[2]).sort((a, b) => a[1] - b[1]);
  await tut('blk');
  check('“Fill a city’s building blocks” opens the fullest city with room on its Build tab', room.length > 0 && await landed('cities', '#city-' + room[0][0] + ' .cat-wrap'), JSON.stringify(free) + ' · ' + await nowAt());
  await tut('road');
  check('“Link two cities by road” opens the capital’s roads', await landed('cities', '#cx-roads'), await nowAt());
  await tut('city2');
  check('“Found a second city” opens the form for it', await landed('cities', '#cx-new'), await nowAt());

  /* 5. the bell */
  await edit((n, now) => { n.cities[0].b.push({ k: 'hospital', s: now - 7200e3, d: now - 60e3 }); n.wars = { 'npc-oskaloo': { t: now - 30 * 864e5 } };
    n.log.unshift({ t: now - 1000, k: 'mile', a: '10 million', b: '', fx: 'Fortress' }); });
  check('a finished building in the bell says where it is', await bell(`[data-dl="bld:${cap}:hospital"]`));
  check('and opens on it', await landed('cities', `#bld-${cap}-hospital`), await nowAt());
  check('an offer of peace in the bell', await bell('[data-dl="peace:npc-oskaloo"]'));
  check('opens Diplomacy’s wars on its Accept button, pulsing', await landed('diplomacy', '#dp-p-wars [data-act="peace"][data-id="npc-oskaloo"]') && await pulsing('#dp-p-wars [data-act="peace"][data-id="npc-oskaloo"]'), await nowAt());
  await page.screenshot({ path: path.join(OUT, 'deep-links-peace.png') });
  check('a milestone passed', await bell('[data-dl^="sel:nation"]'));
  check('opens the milestones', await landed('nation', '.section > ol.miles'), await nowAt());

  /* 6. View required building (a Diplomata's passport typeface): the Diplomata's plan, not the top of the catalogue */
  await home();
  await press('<button data-act="ux-unlock" data-id="pfn-garamond">View required building</button>');
  check('View required building opens the Diplomata’s plan', await until(() => page.evaluate(() => { const e = document.getElementById('bk-diplo'), r = e && e.getBoundingClientRect(); return window.__game.S.view === 'cities' && !!r && r.top >= 0 && r.top < innerHeight - 40; }), 5000), await nowAt());

  /* 7. on a phone, the requirement lands below the taller sticky bar */
  await page.setViewportSize({ width: 390, height: 800 });
  await open('#explore');
  await page.evaluate(() => { const x = document.getElementById('xu'); if (x) x.open = true; });
  await page.click('.xu-need.no [data-dl^="req:farm"]');
  check('on a phone too', await landed('cities', '#bld-c1-farm'), await nowAt());
  await page.screenshot({ path: path.join(OUT, 'deep-links-phone.png') });

  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed++; console.log('FAIL the run stopped: ' + (e && e.stack || e));
} finally {
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exitCode = failed ? 1 : 0;
}
