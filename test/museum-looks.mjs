// The museum, drawn (game/edictum.html, "the museum, drawn"): a banner and a wall panel over every hall, upstairs and
// the Christmas case too; the building's front growing a floor at a time, with scaffolding and a crane while one goes
// up; a hall on a floor not yet built behind its hoarding, with what the floor holds and the way to build it; the
// great skeleton of Natural History mounted as the finds come in; the Treasury's medals and velvet tray; the Collection
// on a gallery wall, kept on the device. On a desktop (light) and a phone (dark). Screenshots go to test/out/.
//   python3 build.py
//   node test/museum-looks.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(120); } }

async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Curatoria');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.EDICTUM_PROBE.mud);
  /* the museum as it would be: fl floors, a floor going up, a share of every artefact, a share of the dig finds */
  const set = (o = {}) => page.evaluate(o => { const g = window.__game, n = g.S.nation, M = g.MW(), now = Date.now();
    n.pop = o.pop || 50; n.popAt = now; n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now;
    const dig = new Set(M.COL_ITEMS.filter(a => M.DIG_SETS.includes(a.set)).slice(0, o.dug || 0).map(a => a.id));
    n.coll = Object.fromEntries(M.COL_ITEMS.filter((a, i) => dig.has(a.id) || (!M.DIG_SETS.includes(a.set) && i % (o.every || 3) === 0)).map((a, i) => [a.id, now - (i + 1) * 3600e3]));
    n.mw = Object.assign({}, n.mw || {}, { fl: o.fl || 1, b: o.b ? { f: (o.fl || 1) + 1, t1: now + 5 * 3600e3 } : null }); if (!o.b) delete n.mw.b;
    g.S.colDetail = null; g.render(); }, o);
  const hall = h => page.evaluate(h => { const g = window.__game; g.S.view = 'museum'; g.S.museumFor = null; g.S.muHall = h; g.S.colDetail = null; g.render(); window.scrollTo(0, 0); }, h);
  const q = (sel, f) => page.evaluate(([sel, f]) => (0, eval)('(' + f + ')')(document.querySelector(sel), document), [sel, f.toString()]);
  return { ctx, page, errors, set, hall, q };
}

try {
  /* ── desktop, light ── */
  {
    const t = await start('light', { width: 1360, height: 900 }), { page } = t;
    await t.set({ fl: 1 });
    /* the banner and the wall panel, in every hall of the ground floor and the rotunda */
    const seen = [];
    for (const h of ['founding', 'growth', 'laws', 'land', 'explore', 'arms', 'games', 'leaders', 'digs', 'xmas', 'collection']) {
      await t.hall(h);
      seen.push(await t.q('.mu-hall', (el) => { const w = el && el.querySelector(':scope > p.mu-wall'); return w ? { h: el.dataset.hall, ban: w.querySelectorAll('.mu-ban svg .col-g').length, num: (w.querySelector('.mu-wall-num') || {}).textContent || (w.querySelector('.mu-wall-num svg') ? 'icon' : ''), name: (w.querySelector('.mu-wall-h') || {}).textContent, words: (w.querySelector('.mu-wall-t') || {}).textContent } : { h: el && el.dataset.hall }; }));
    }
    check('every hall has its banner, four pieces under spotlights, and a wall panel with its numeral, name and words', seen.every(x => x.ban === 4 && x.num && x.name && x.words !== undefined), seen.filter(x => !(x.ban === 4 && x.num && x.name)));
    check('Hall I is numbered I and named; the rotunda shows its icon', seen[0].num === 'I' && /Hall of Founding/.test(seen[0].name) && seen[seen.length - 1].num === 'icon', [seen[0], seen[seen.length - 1]]);
    await t.hall('founding'); await page.screenshot({ path: OUT + '/museum-looks-banner-1360.png' });
    check('the Entrance has no banner (the floor plan leads)', (await t.hall('entrance'), await t.q('.mu-hall', el => !el.querySelector('.mu-wall'))));

    /* the building: grows a floor at a time, the dome on the third; scaffolding and a crane while one goes up */
    const bld = async () => { await t.hall('entrance'); return t.q('svg.mw-bld', el => ({ label: el.getAttribute('aria-label'), dome: !!el.querySelector('path[fill="var(--mwb-roof)"]'), crane: el.querySelectorAll('[stroke="var(--mwb-crane)"]').length, scaf: el.querySelectorAll('[stroke="var(--mwb-scaf)"]').length, flag: el.querySelectorAll('rect[width="6"][height="12"]').length, ins: (el.querySelector('.mwb-ins') || {}).textContent })); };
    const b1 = await bld();
    check('the building: one floor, a portico with MUSEUM over it, the nation’s flag, no dome', /1 floor/.test(b1.label) && !b1.dome && b1.flag === 3 && b1.ins === 'MUSEUM' && !b1.crane, b1);
    await t.set({ fl: 1, b: true }); const b1b = await bld();
    check('a floor going up: scaffolding and a crane', /with scaffolding/.test(b1b.label) && b1b.scaf > 0 && b1b.crane > 0, b1b);
    await t.set({ fl: 3 }); const b3 = await bld();
    check('three floors: the dome', /3 floors and a dome/.test(b3.label) && b3.dome && !b3.crane, b3);
    const el = await page.$('svg.mw-bld'); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: OUT + '/museum-looks-building-1360.png' });

    /* a hall on a floor not yet built: behind the hoarding */
    await t.set({ fl: 1, pop: 12 });
    await t.hall('natural');
    const site = await t.q('.mu-hall', el => ({ svg: !!el.querySelector('.mw-site svg[role="img"]'), h: (el.querySelector('.mw-site h2') || {}).textContent, rooms: [...el.querySelectorAll('.mw-site-l li')].map(li => li.textContent), on: (el.querySelector('.mw-site-l li.on') || {}).textContent, build: !!el.querySelector('.mw-site [data-act="mw-build"]:not([disabled])'), wall: !!el.querySelector(':scope > p.mu-wall .mu-ban') }));
    check('Natural History on an unbuilt floor: the hoarding, under its banner', site.svg && site.wall && /First floor is not built yet/.test(site.h), site);
    check('it lists the floor’s halls in order, this one marked, and the four cases', site.rooms.length === 5 && /^IX/.test(site.rooms[0]) && /^X\b|^XThe Hall of Natural/.test(site.rooms[1]) && /Natural History/.test(site.on) && /Four more display cases/.test(site.rooms[4]), site.rooms);
    check('a nation big enough can build the floor from here', site.build, site);
    await page.screenshot({ path: OUT + '/museum-looks-site-1360.png' });
    await t.hall('exhibit');
    const site3 = await t.q('.mu-hall', el => ({ h: (el.querySelector('.mw-site h2') || {}).textContent, first: /First floor comes first/.test(el.textContent), build: !!el.querySelector('.mw-site [data-act="mw-build"]'), dome: [...el.querySelectorAll('.mw-site-l li')].some(li => /The dome/.test(li.textContent)) }));
    check('a hall two floors up: the first floor comes first, and the dome is on its list', /Second floor is not built yet/.test(site3.h) && site3.first && !site3.build && site3.dome, site3);
    await t.set({ fl: 1, b: true }); await t.hall('natural');
    const busy = await t.q('.mu-hall', el => ({ eb: (el.querySelector('.mw-site .eyebrow') || {}).textContent, lab: el.querySelector('.mw-site svg').getAttribute('aria-label'), opens: /opens in/.test(el.textContent) }));
    check('with the floor going up: the builders at work, and when it opens', /builders are at work/i.test(busy.eb) && /builders at work/.test(busy.lab) && busy.opens, busy);
    await t.set({ fl: 1, pop: 12 }); await t.hall('natural');
    await page.click('.mw-site [data-act="mw-build"]');
    check('building it from the hoarding starts the builders', await until(() => page.evaluate(() => { const m = window.__game.S.nation.mw; return !!(m && m.b && m.b.f === 2); })));

    /* Natural History: the skeleton mounted as the finds come in */
    const skel = async dug => { await t.set({ fl: 2, dug }); await t.hall('natural'); return t.q('.mwn', el => el ? { lab: el.querySelector('svg').getAttribute('aria-label'), cap: el.querySelector('.mwn-cap').textContent, shelf: !!document.querySelector('.mw-arts.mw-shelf') } : null); };
    const s0 = await skel(0), s1 = await skel(12), sAll = await skel(9999);
    const k = s => +((/(\d+) of \d+ bones/.exec(s && s.lab) || [])[1]);
    check('no finds: the skeleton is all outline', s0 && k(s0) === 0, s0);
    check('some finds: some bones mounted, the finds on shelves under glass', k(s1) > 0 && k(s1) < 37 && s1.shelf, s1);
    check('every find: the skeleton stands complete', /37 of 37 bones/.test(sAll.lab) && /stands complete/.test(sAll.cap), sAll);
    const sk = await page.$('.mwn-art'); await sk.scrollIntoViewIfNeeded(); await sk.screenshot({ path: OUT + '/museum-looks-skeleton-1360.png' });

    /* the Treasury: the medals, the tray with a place for every coin, seal, medal and crown */
    await t.set({ fl: 2 }); await t.hall('treasury');
    const tr = await page.evaluate(() => { const g = window.__game, M = g.MW(), D = window.EDICTUM_PROBE.mud, own = g.S.nation.coll, all = M.COL_ITEMS.filter(D.mwTreasuryKind);
      return { all: all.length, got: all.filter(a => own[a.id]).length, rec: document.querySelectorAll('.mw-tray .mw-rec').length, own: document.querySelectorAll('.mw-tray .mw-rec.own').length, medals: document.querySelectorAll('.mw-medals .mw-md').length, figs: /Medals/.test(document.querySelector('.mu-hall').textContent) }; });
    check('the tray has a place for each of them, filled for those held', tr.all > 10 && tr.rec === tr.all && tr.own === tr.got && tr.got > 0, tr);
    check('the Games’ medals hang beside it', tr.medals === 3 && tr.figs, tr);
    await page.click('.mw-tray .mw-rec.own');
    check('a piece in the tray opens its label', await until(() => page.evaluate(() => !!window.__game.S.colDetail && !!document.querySelector('.col-sheet'))));
    await page.evaluate(() => { window.__game.S.colDetail = null; window.__game.render(); });
    const tray = await page.$('.mw-tray'); await tray.scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + '/museum-looks-treasury-1360.png' });

    /* the Collection on the gallery wall */
    await t.set({ fl: 1, every: 2 }); await t.hall('collection');
    check('the Collection opens as cases', await t.q('.mu-hall', el => !!el.querySelector('.col-tray') && !el.querySelector('.gw-wall')));
    await page.click('[data-act="col-view"][data-v="wall"]');
    const gw = await until(() => page.evaluate(() => { const w = document.querySelector('.gw-wall'); if (!w) return null; const f = [...w.querySelectorAll('.gw-f')], own = window.__game.S.nation.coll;
      return { n: f.length, held: Object.keys(own).length, l: f.filter(x => x.classList.contains('gw-l')).every(x => x.classList.contains('gw-2x2')), big: (() => { const a = w.querySelector('.gw-l'), c = w.querySelector('.gw-c'); return a && c ? a.getBoundingClientRect().width > c.getBoundingClientRect().width * 1.6 : true; })(), on: document.querySelector('[data-act="col-view"][data-v="wall"]').getAttribute('aria-pressed') }; }));
    check('the gallery wall hangs every piece held, the legendary ones largest', gw && gw.n === gw.held && gw.l && gw.big && gw.on === 'true', gw);
    await page.screenshot({ path: OUT + '/museum-looks-wall-1360.png' });
    await page.click('[data-act="col-f"][data-k="rar"][data-v="r"]');
    const rare = await page.evaluate(() => [...document.querySelectorAll('.gw-f')].every(x => x.classList.contains('gw-r')) && document.querySelectorAll('.gw-f').length > 0);
    check('the rarity filter applies to the wall', rare);
    await page.click('[data-act="col-f"][data-k="rar"][data-v=""]');
    await page.click('.gw-f');
    check('a frame opens its label', await until(() => page.evaluate(() => !!window.__game.S.colDetail && !!document.querySelector('.col-sheet'))));
    await page.evaluate(() => { window.__game.S.colDetail = null; window.__game.S.colView = null; window.__game.render(); });
    check('the choice is kept on this device', await t.q('.mu-hall', el => !!el.querySelector('.gw-wall')));
    check('no page errors on the desktop', !t.errors.length, t.errors);
    await t.ctx.close();
  }
  /* ── a phone, dark ── */
  {
    const t = await start('dark', { width: 390, height: 844 }), { page } = t;
    const wide = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    for (const [o, h] of [[{ fl: 1 }, 'founding'], [{ fl: 1, b: true }, 'natural'], [{ fl: 1 }, 'entrance'], [{ fl: 3, dug: 30 }, 'natural'], [{ fl: 3 }, 'treasury'], [{ fl: 3 }, 'collection']]) {
      await t.set(o); if (h === 'collection') await page.evaluate(() => { window.__game.S.colView = 'wall'; });
      await t.hall(h); const w = await wide();
      check(`phone, ${h}${o.b ? ' (building)' : ''}: no sideways scroll`, w.sw <= w.cw + 1, w);
      await page.screenshot({ path: OUT + `/museum-looks-${h}${o.b ? '-site' : ''}-390-dark.png` });
    }
    check('dark: the banner is a night museum', await page.evaluate(() => { const b = document.querySelector('.mu-ban'), c = getComputedStyle(b).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 200; }));
    check('no page errors on the phone', !t.errors.length, t.errors);
    await t.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all museum looks checks passed');
process.exit(failed ? 1 : 0);
