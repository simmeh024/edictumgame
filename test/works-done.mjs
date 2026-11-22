// Works done, what is missing, Stop asks first, seized hexes. The bell tells of a finished upgrade, retool, wall and road
// (kept in n.wd once the save settles them) and each opens the work itself; an Upgrade, a road and an outfitters' block
// short of materials say by how much, with Trade for; Stop and Cancel ask before losing half the materials; a hex
// seized from the player opens the map on that hex.
//   python3 build.py
//   node test/works-done.mjs
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
const nation = f => page.evaluate(src => (0, eval)('(' + src + ')')(window.__game.S.nation), f.toString());
const open = async h => { await page.evaluate(h => { location.hash = h; }, h); await until(() => page.evaluate(v => window.__game.S.view === v, h.slice(1))); await sleep(400); };
const home = () => open('#nation');
const landed = (view, sel) => until(() => page.evaluate(([view, sel]) => {
  const S = window.__game.S; if (S.view !== view) return false; const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect();
  return r.top >= 0 && r.top < innerHeight - 40 && e.classList.contains('ca-flash');
}, [view, sel]), 5000);
const pulsing = sel => until(() => page.evaluate(sel => { const e = document.querySelector(sel); return !!e && e.classList.contains('tut-coach'); }, sel), 4000);
const nowAt = () => page.evaluate(() => { const S = window.__game.S, a = document.activeElement; return `${S.view} · city ${S.cxSel} · tab ${S.cxTab} · cell ${S.mapCell} · focus ${a && (a.id || a.className)}`; });
const bellRows = async () => { await home(); await page.click('.bell'); await until(() => page.evaluate(() => !!document.querySelector('.notif-pop')));
  const r = await page.evaluate(() => [...document.querySelectorAll('.notif-pop .nt')].map(b => ({ k: b.querySelector('.nt-k').textContent, x: b.querySelector('.nt-x').textContent, dl: b.dataset.dl || '', v: b.dataset.v })));
  await page.click('.bell'); return r; };
const bellClick = async dl => { await home(); await page.click('.bell'); await until(() => page.evaluate(() => !!document.querySelector('.notif-pop'))); const l = page.locator(`.notif-pop [data-dl="${dl}"]`).first(); if (!(await l.count())) return false; await l.click(); return true; };

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Worksmark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await home();
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  await home();
  const cap = await nation(n => n.cities[0].id);

  /* the capital: Farm Estates (grey), a Factory at gold, a University; a second city four or more hexes away on our land,
     with a finished road between them, a path of neighbouring hexes */
  await edit((n, now, G) => {
    const M = G.MAP, c0 = n.cities[0], T = G.XP().territory(), mi = T.list.findIndex(x => x.me), d = 864e5, dist = new Map([[c0.c, 0]]), par = new Map(), q = [c0.c];
    while (q.length) { const c = q.shift(), k = dist.get(c); if (k >= 6) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb < 0 || dist.has(nb) || M.T[nb] < 2) continue; if (T.owner[nb] >= 0 && T.owner[nb] !== mi) continue; dist.set(nb, k + 1); par.set(nb, c); q.push(nb); } }
    const have = new Set((n.claims || []).map(e => e.c));
    n.claims = (n.claims || []).concat([...dist.keys()].filter(c => !have.has(c) && c !== c0.c).map((c, i) => ({ c, t: now - d + i })));
    const far = [...dist.entries()].filter(([, k]) => k >= 4).sort((x, y) => x[1] - y[1]).map(([c]) => c)[0];
    const path = [far]; while (path[0] !== c0.c) path.unshift(par.get(path[0]));
    const t = now - 2 * d, B = (k, ug) => ({ k, s: t - 1e5, d: t, ...(ug ? { ug } : {}) });
    c0.b = [B('farm', 1), B('factory', 5), B('university')];
    n.cities.push({ id: 'c1', c: far, nm: 'Fenwick', t: now - 6 * d, b: [B('sawmill')] });
    const rt = now - 3 * 36e5; n.infra = [{ id: 'r1', k: 'road', a: c0.c, b: far, path, t: rt, d: rt + (path.length - 1) * 15 * 6e4 + 6e4, reg: n.reg }];
    n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; n._stockSet = true;
  });
  const road = await nation(n => n.infra[0]);

  /* 1, 2. an upgrade, the walls and a retool finish a few seconds from now; the save after settles them */
  await edit((n, now) => { const c = n.cities[0], f = c.b.find(b => b.k === 'farm'), fa = c.b.find(b => b.k === 'factory');
    f.uu = { u: 2, s: now - 36e5, d: now + 2500, p: { timber: 4, goods: 4 } }; c.wu = { l: 1, s: now - 36e5, d: now + 2500, p: { timber: 10, iron: 20 } };
    fa.tu = { l: 2, ln: 'asm', s: now - 36e5, d: now + 2500, p: { timber: 100 } }; });
  await sleep(3200);
  let rows = await bellRows();
  check('a finished upgrade is in the bell before any save', rows.some(r => r.dl === `bldup:${cap}:farm` && /Farm Estates in .* has its green upgrade, 2 of 5\./.test(r.x) && r.k.startsWith('Ministry of Works')), JSON.stringify(rows.filter(r => r.k.startsWith('Ministry of Works'))));
  await edit(() => {});
  const wd = await nation(n => ({ wd: n.wd || [], farm: n.cities[0].b.find(b => b.k === 'farm'), wl: n.cities[0].wl, wu: n.cities[0].wu, tr: n.cities[0].b.find(b => b.k === 'factory').tr }));
  check('the save settles them, and keeps each in n.wd', wd.farm.ug === 2 && !wd.farm.uu && wd.wl === 1 && !wd.wu && wd.tr === 2 && ['up', 'wall', 'tier'].every(w => wd.wd.some(x => x.w === w && x.c === cap)), JSON.stringify(wd));
  rows = await bellRows();
  /* the works' notices: the upgrade, the walls, the retool and the road (the city reminders share the label) */
  const works = rows.filter(r => r.k.startsWith('Ministry of Works') && /^(bldup|walls|hex):/.test(r.dl)).map(r => r.x);
  check('the bell still tells of the upgrade after the save', works.some(x => /Farm Estates in .* has its green upgrade, 2 of 5\./.test(x)), JSON.stringify(works));
  check('of the walls', works.some(x => /The walls of .* reach level 1 of 3\./.test(x)));
  check('of the retool', works.some(x => /The Factory in .* is retooled: it is now an Assembly Plant, tier II\./.test(x)), JSON.stringify(works));
  check('and of the road', works.some(x => /The road from .* to Fenwick is open\./.test(x)));
  check('each only once', works.length === new Set(works).size && works.length === 4, JSON.stringify(works));
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view); await sleep(600);
  check('n.wd is kept through a reload', (await nation(n => (n.wd || []).length)) >= 3);

  check('the upgrade notice opens the Farm Estates', await bellClick(`bldup:${cap}:farm`));
  check('in view and lit', await landed('cities', `#bld-${cap}-farm`), await nowAt());
  check('with its next upgrade pulsing', await pulsing(`#bld-${cap}-farm [data-act="cx-up"]`));
  await page.screenshot({ path: path.join(OUT, 'works-done-upgrade.png') });
  check('the walls notice opens the city’s walls', await bellClick(`walls:${cap}`));
  check('on the Defence tab, the next level pulsing', await landed('cities', `#city-${cap} .cx-def`) && await pulsing(`#city-${cap} [data-act="cx-wall"]`), await nowAt());
  const mid = road.path[Math.floor(road.path.length / 2)];
  check('the road notice opens the map on the road', await bellClick('hex:' + mid) && await until(() => page.evaluate(c => window.__game.S.view === 'map' && window.__game.S.mapCell === c, mid)), await nowAt());

  /* 9. a hex seized: the log keeps the hex, and the notice opens the map on it */
  const lost = await nation(n => n.claims[3].c);
  await edit((n, now, G) => { n.log.unshift({ t: now - 1000, k: 'lost', a: 'npc-oskaloo', b: 'Oskaloo', fx: 'the coast', c: n.claims[3].c }); });
  check('the hex stays with the log entry through a save', (await nation(n => n.log.find(l => l.k === 'lost')?.c)) === lost);
  rows = await bellRows();
  check('the notice of the hex seized carries it', rows.some(r => r.dl === 'hex:' + lost && /Oskaloo seized a hex/.test(r.x)), JSON.stringify(rows.slice(0, 4)));
  check('and opens the map on it', await bellClick('hex:' + lost) && await until(() => page.evaluate(c => window.__game.S.view === 'map' && window.__game.S.mapCell === c, lost)), await nowAt());

  /* 3, 4. short of materials: the Upgrade, the road and the outfitters say by how much, with Trade for */
  await edit((n, now) => { n.stock = { food: 0, timber: 0, iron: 0, oil: 0, goods: 0 }; n.stockAt = now; n._stockSet = true; n.xu = {}; delete n.xuw; });
  await open('#cities');
  await page.evaluate(id => { window.__game.S.cxSel = id; window.__game.S.cityOpen = null; window.__game.S.cxTab = 'b'; window.__game.render(); }, cap); await sleep(300);
  const short = await page.evaluate(id => { const r = document.getElementById('bld-' + id + '-farm'), s = r && r.querySelector('.ux-short'); return s ? [s.textContent, [...s.querySelectorAll('[data-act="ux-resource"]')].map(b => b.dataset.r + ':' + b.dataset.need)] : null; }, cap);
  check('a greyed-out Upgrade says what is short', !!short && /^Short of \d+ \w+/.test(short[0]) && short[1].length > 0, JSON.stringify(short));
  await page.screenshot({ path: path.join(OUT, 'works-done-short.png') });
  await page.click(`#bld-${cap}-farm .ux-short [data-act="ux-resource"]`);
  check('Trade for opens the Trade page on that resource', await until(() => page.evaluate(() => window.__game.S.view === 'trade' && !!document.querySelector('.ux-resource-notice'))));
  await open('#cities');
  await page.evaluate(id => { window.__game.S.cxSel = id; window.__game.S.cxTab = 'def'; window.__game.render(); }, cap); await sleep(300);
  check('so does the walls’ next level', await page.evaluate(id => !!document.querySelector('#city-' + id + ' .cx-def .ux-short [data-act="ux-resource"]'), cap));
  await open('#explore');
  await page.evaluate(() => { const x = document.getElementById('xu'); if (x) x.open = true; });
  check('and an outfitters’ block, not only in a tooltip', await page.evaluate(() => !!document.querySelector('.xu-row .ux-short [data-act="ux-resource"]')));

  /* 5. Stop asks first when it loses materials */
  await edit((n, now) => { n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; n._stockSet = true;
    const u = n.cities[0].b.find(b => b.k === 'university'); u.uu = { u: 1, s: now - 6e4, d: now + 36e5, p: { timber: 10, goods: 14 } };
    n.cities[0].b.push({ k: 'hospital', s: now + 36e5, d: now + 2 * 36e5, p: { timber: 12, goods: 15 } }); });
  await open('#cities');
  await page.evaluate(id => { window.__game.S.cxSel = id; window.__game.S.cityOpen = null; window.__game.S.cxTab = 'b'; window.__game.render(); }, cap); await sleep(300);
  await page.click(`#bld-${cap}-university [data-act="cx-up-no"]`);
  const ask = await page.evaluate(() => { const a = document.querySelector('.stop-ask'); return a ? a.textContent : ''; });
  await page.evaluate(() => document.querySelector('.stop-ask')?.scrollIntoView({ block: 'center' })); await page.screenshot({ path: path.join(OUT, 'works-done-stop.png') });
  check('Stop on an upgrade asks first, saying what is lost', /^Stop now and lose half the materials \(\d+ \w+(, \d+ \w+)*( and \d+ \w+)?\)\?/.test(ask), ask);
  check('and nothing has stopped yet', !!(await nation(n => n.cities[0].b.find(b => b.k === 'university').uu)));
  check('Keep going is focused', await until(() => page.evaluate(() => document.activeElement && document.activeElement.dataset.act === 'stop-keep'), 2000));
  await page.click('.stop-ask [data-act="stop-keep"]');
  check('Keep going leaves it', await page.evaluate(id => !document.querySelector('.stop-ask') && !!document.querySelector(`#bld-${id}-university [data-act="cx-up-no"]`), cap) && !!(await nation(n => n.cities[0].b.find(b => b.k === 'university').uu)));
  await page.click(`#bld-${cap}-university [data-act="cx-up-no"]`);
  await page.click('.stop-ask [data-stop-ok="1"]');
  check('Stop work stops it', await until(() => nation(n => !n.cities[0].b.find(b => b.k === 'university').uu)));
  const queued = await page.evaluate(() => !!document.querySelector('[data-act="ct-cancel"][data-k="hospital"]'));
  if (queued) { await page.click('[data-act="ct-cancel"][data-k="hospital"]');
    check('a building still in the queue goes at once (everything comes back)', await until(() => nation(n => !n.cities[0].b.some(b => b.k === 'hospital'))) && !(await page.evaluate(() => !!document.querySelector('.stop-ask')))); }
  else check('the queued building shows a Cancel', false, 'no ct-cancel for the hospital');

  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed++; console.log('FAIL the run stopped: ' + (e && e.stack || e));
} finally {
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exitCode = failed ? 1 : 0;
}
