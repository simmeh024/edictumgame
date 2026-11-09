// The Museum, expanded: building a floor (people and materials, then a wait), display cases and their points, the
// takings (tickets and the gift shop), a curator, restoring a worn dig find, a travelling exhibition, the new halls
// upstairs, the floor plan's floors, and the region's Museum of the Year. Loans need a second player: their
// sums are checked through the probe with a lender written into the world.
//   python3 build.py
//   node test/museum-plus.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let failed = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c || extra === undefined ? '' : ' · ' + extra)); if (!c) failed++; };
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE);
await page.fill('#d-name', 'Curatoria'); await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation);
const G = (fn, a) => page.evaluate(fn, a);
const click = async sel => { await page.click(sel); await page.waitForTimeout(150); };
const main = () => page.evaluate(() => document.querySelector('.main').innerText);
const open = h => G(h => { const g = window.__game; g.S.view = 'museum'; g.S.muHall = h; g.render(); }, h);

// a nation big enough for the first floor, with materials, and a few artefacts (some from digs)
await G(() => { const g = window.__game, n = g.S.nation, M = g.MW(), now = Date.now();
  n.pop = 12; n.popAt = now; n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = now;
  const dug = M.COL_ITEMS.filter(a => M.DIG_SETS.includes(a.set)).slice(0, 6), plain = M.COL_ITEMS.filter(a => !M.DIG_SETS.includes(a.set)).slice(0, 8);
  n.coll = Object.fromEntries(dug.concat(plain).map(a => [a.id, now - 1000])); g.render(); });
await open('entrance');
ok(/The building/.test(await main()) && !!await page.$('svg.mw-bld'), 'the Entrance Hall draws the building and its boxes');
ok(await G(() => window.__game.MW().mwSlots(window.__game.S.nation)) === 4, 'the ground floor has four cases');
const before = await G(() => { const g = window.__game; return { pop: g.popNow(g.S.nation), t: g.S.nation.stock.timber }; }).catch(() => null);
await click('[data-act="mw-build"]');
const built = await G(() => { const g = window.__game, n = g.S.nation, m = g.MW().mwOf(n); return { b: m.b, fl: m.fl, timber: Math.round(g.S.nation.stock.timber), pop: n.pop }; });
ok(built.b && built.b.f === 2 && built.fl === 1 && built.timber < 400 && built.pop < 11.5, 'building the first floor takes people and materials, and starts the builders', JSON.stringify(built));
ok(/opens in/.test(await main()), 'the Entrance Hall says when it opens');
// the builders finish: the next save opens the floor
await G(() => { const g = window.__game, n = g.S.nation; n.mw.b.t1 = Date.now() - 1; g.commit(g.clone(n)); g.render(); });
ok(await G(() => window.__game.MW().mwOf(window.__game.S.nation).fl) === 2 && await G(() => window.__game.MW().mwSlots(window.__game.S.nation)) === 8, 'once finished, the first floor opens with eight cases');

// display cases
await open('gallery');
const firstAdd = await page.$('[data-act="mw-show"]');
for (let i = 0; i < 3; i++) { const b = page.locator('[data-act="mw-show"]:not([disabled])', { hasText: 'Put on show' }).first(); if (await b.count()) await b.click(); await page.waitForTimeout(150); }
const show = await G(() => { const g = window.__game, M = g.MW(), n = g.S.nation; return { on: M.mwOnShow(n).length, pts: M.mwPoints(n, g.S.uid || 'me', Date.now()) }; });
ok(!!firstAdd && show.on === 3 && show.pts > 0, 'putting artefacts on show fills cases and earns display points', JSON.stringify(show));
await page.screenshot({ path: OUT + '/museum-gallery.png', fullPage: true });

// tickets, the takings, and a curator
await open('entrance');
await click('[data-act="mw-tk"][data-k="2"]');
const goods0 = await G(() => window.__game.S.nation.stock.goods);
await click('[data-act="mw-collect"]');
const goods1 = await G(() => window.__game.S.nation.stock.goods);
ok(goods1 > goods0 && await G(() => window.__game.MW().mwOf(window.__game.S.nation).tk) === 2, 'a proper ticket and today’s takings add goods', `${goods0} → ${goods1}`);
ok(!!await page.$('[data-act="mw-collect"][disabled]'), 'the takings can be collected once a day');
await click('[data-act="mw-hire"][data-k="showman"]');
ok(await G(() => (window.__game.MW().mwOf(window.__game.S.nation).cu || {}).k) === 'showman', 'a curator can be hired');
await page.screenshot({ path: OUT + '/museum-entrance.png', fullPage: true });

// restoring a worn dig find
await open('natural');
const worn = await page.$('[data-act="mw-restore"]');
if (worn) { await worn.click(); await page.waitForTimeout(150); ok(/back in/i.test(await main()), 'a worn find goes to the conservators'); }
else ok(/Finds from digs/.test(await main()), 'Natural History lists the dig finds (none worn this time)');

// the halls upstairs: open on the first floor, locked above it
await open('treasury'); ok(/medals/i.test(await main()), 'the Treasury opens on the first floor');
await open('flags'); ok(!!await page.$('.mw-flags svg'), 'the Gallery of Flags hangs the nation’s flag');
await open('exhibit'); ok(/not built yet/.test(await main()), 'the Exhibition Hall waits for the second floor');

// the second floor, then the exhibition
await G(() => { const g = window.__game, n = g.S.nation, now = Date.now(); n.pop = 45; n.popAt = now; n.stock = { food: 999, timber: 999, iron: 999, oil: 999, goods: 999 }; n.stockAt = now; g.render(); });
await open('entrance'); await click('[data-act="mw-build"]');
await G(() => { const g = window.__game, n = g.S.nation; n.mw.b.t1 = Date.now() - 1; g.commit(g.clone(n)); g.render(); });
ok(await G(() => window.__game.MW().mwOf(window.__game.S.nation).fl) === 3, 'the second floor and the dome open');
await G(() => { const g = window.__game, M = g.MW(), n = g.S.nation, E = M.mwExhibit(Date.now()), now = Date.now();
  const fit = M.COL_ITEMS.filter(a => { const t = (a.set + ' ' + a.id + ' ' + a.g + ' ' + a.n).toLowerCase(); return E.w.some(w => t.includes(w)); }).slice(0, 3);
  for (const a of fit) n.coll[a.id] = now - 500; g.render(); });
await open('exhibit');
await click('[data-act="mw-exhibit"]');
ok(await G(() => window.__game.MW().mwOf(window.__game.S.nation).ex.length) === 1, 'three matching artefacts stage this month’s exhibition');
await page.screenshot({ path: OUT + '/museum-exhibit.png', fullPage: true });
await open('loans'); ok(/Borrowed/.test(await main()) && /Lent out/.test(await main()), 'the Loans Gallery opens on the second floor');

// the floor plan's floors
await open('entrance');
await click('[data-act="mw-floor"][data-f="3"]');
ok(/The Exhibition Hall/.test(await page.evaluate(() => document.querySelector('.mw-plan').innerText)), 'the floor plan shows the rooms of the second floor');

// loans and the ranking, with a lender written into the world
const loan = await G(() => { const g = window.__game, M = g.MW(), me = g.S.uid || 'me', now = Date.now(), a = M.COL_ITEMS.find(x => x.r === 'l') || M.COL_ITEMS[0];
  const mode = g.S.mode; g.S.mode = 'world'; g.S.world['lender'] = { ...g.clone(g.S.nation), name: 'Lendland', mw: { fl: 1, lo: [{ id: a.id, to: me, t0: now - 1000, t1: now + 6 * 86400e3 }] } };
  const p0 = M.mwPoints(g.S.nation, me, now), rank = M.mwRanking().length; g.S.mode = mode; delete g.S.world['lender']; return { p0, rank }; });
ok(loan.p0 > await G(() => { const g = window.__game; return g.MW().mwPoints(g.S.nation, g.S.uid || 'me', Date.now()); }), 'a borrowed artefact adds to the display points', JSON.stringify(loan));
ok(loan.rank >= 2, 'the region’s player museums are ranked');

ok(!errs.length, 'no errors in the page' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
