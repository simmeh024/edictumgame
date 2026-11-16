// "Your map look" on the World map page (2026-11-16, the owner: "on the map page, add a section that links to the map
// color in settings, also show locked ones and show the shop page in a modal that shows what each hex background looks
// like for the nation"; ideas 1, 3, 5, 7, 8, 10 and 13). Under "Your territory": every map colour, the locked ones saying
// how they are had; the hex backgrounds (land finishes) in the player's own colour, a held one opening Customise, a
// locked one opening its pack's Shop drawer over the map page, led by "How it looks on <nation>" and its try-on. Escape,
// the scrim, focus, the full-screen map, a phone in the dark theme. Then (the owner: "make it collapsed by default, and
// make changing the color here, also directly change it on the map"): closed at first as one line, kept open once
// opened; a colour chosen on it is worn at once, the map drawn again.
//   python3 build.py
//   node test/map-look.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
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
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

/* a founded nation, settled, on the World map page */
async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = a => page.evaluate(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  /* the one-time gift for the fiftieth player opens over the page: put it aside */
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* the land office offers the first block straight away: put that aside too, for the panel's own page */
  await page.evaluate(() => { const b = [...document.querySelectorAll('#map-panel button')].find(x => /^Cancel$/.test(x.textContent.trim())); if (b) b.click(); });
  await until(() => page.evaluate(() => !!document.querySelector('#map-panel .mlk')), 4000);
  await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
  return { ctx, page, errors, edit, go, act };
}
const toasts = page => page.evaluate(() => (window.__toasts || []).join(' | '));
/* the land office offers a block again each time the map is entered while the first credits wait: put it aside */
const office = async page => { await page.evaluate(() => { const b = [...document.querySelectorAll('#map-panel button')].find(x => /^Cancel$/.test(x.textContent.trim())); if (b) b.click(); }); await page.waitForSelector('#map-panel .mlk', { timeout: 4000 }).catch(() => {}); };
/* ...and the card opened, when it is closed */
const calm = async page => { await office(page); await page.evaluate(() => { const b = document.querySelector('#map-panel .mlk-tg[aria-expanded="false"]'); if (b) b.click(); }); await page.waitForSelector('#map-panel .mlk-sws', { timeout: 4000 }).catch(() => {}); };
const shut = page => page.evaluate(() => { const c = document.querySelector('#map-panel .mlk'), s = c?.querySelector('.mlk-sum'); if (!c) return null;
  return { exp: c.querySelector('.mlk-tg')?.getAttribute('aria-expanded'), body: !!c.querySelector('.mlk-sws, .mlk-t, .mlk-hint'), hidden: !!c.querySelector('#mlk-b')?.hidden, sum: s && getComputedStyle(s).display !== 'none' ? s.textContent : '', h: Math.round(c.getBoundingClientRect().height) }; });
/* the main map's picture, to tell whether it was drawn again */
const mapPic = page => page.evaluate(() => { const v = document.querySelector('canvas.map-cv'); try { return v ? v.toDataURL() : ''; } catch (e) { return ''; } });
/* the Shop as the server would have it: these three packs on sale (no Paddle prices in local mode) */
const sells = page => page.evaluate(() => { const G = window.__game; G.SHOP.SHOP.localAsked = true; G.SHOP.SHOP.cfg = { on: true, env: 'live', token: '', prices: { cartopack: 'pri_c', mayapack: 'pri_m', founder: 'pri_f' }, now: Date.now(), until: Date.UTC(2027, 1, 2) }; G.render(); });
const card = page => page.evaluate(() => { const c = document.querySelector('#map-panel .mlk'); if (!c) return null;
  return { h: c.querySelector('.mlk-tt')?.textContent, flag: c.querySelector('.mlk-flag')?.getAttribute('aria-pressed'), colour: c.querySelector('.mlk-r b')?.textContent, free: c.querySelectorAll('.mlk-sws .sw:not(.sw-lock)').length, lockSw: [...c.querySelectorAll('.mlk-sws .sw-lock')].map(b => b.dataset.act + ':' + (b.dataset.k || b.dataset.mc)),
    on: c.querySelector('.mlk-sws .sw.on')?.style.getPropertyValue('--sw'), locks: [...c.querySelectorAll('.mlk-locks li')].map(l => l.textContent.trim()),
    tiles: [...c.querySelectorAll('.mlk-t')].map(t => ({ id: t.dataset.id || '', act: t.dataset.act, lock: t.classList.contains('lock'), on: t.classList.contains('on'), n: t.querySelector('.mlk-tn').textContent, s: t.querySelector('.mlk-ts')?.textContent || '', svg: !!t.querySelector('svg.ctg-land') })),
    te: c.querySelectorAll('.mlk-r b')[1]?.textContent, groups: [...c.querySelectorAll('.mlk-gh')].map(g => g.textContent.trim()), foot: !!c.querySelector('.mlk-foot') }; });
const drawer = page => page.evaluate(() => { const d = document.querySelector('.shop-dr'); if (!d) return null; const r = d.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { mlk: d.classList.contains('mlk-dr'), view: window.__game.S.view, hash: location.hash, gal: d.querySelector('.mlk-gal-h')?.textContent, figs: [...d.querySelectorAll('.mlk-fig')].map(f => ({ on: f.classList.contains('on'), now: f.classList.contains('now'), n: f.querySelector('figcaption b')?.textContent, svg: !!f.querySelector('svg.ctg-land'), tr: f.querySelector('[data-act="ctg-try"]')?.dataset.id || '' })),
    four: /Four finishes for your land/.test(d.textContent), maya: !!d.querySelector('.shop-maya-land'), buy: [...d.querySelectorAll('button.btn')].some(b => /^Buy the /.test(b.textContent)), above: !!top && d.contains(top), focus: d.contains(document.activeElement) }; });

try {
  /* ── desktop, light ── */
  {
    const t = await start('light', { width: 1280, height: 900 }), { page, edit, go, act } = t;
    /* closed at first: one line, the colour and the hex background */
    await office(page); let z = await shut(page);
    check('the card is closed at first: one line with the colour and the hex background, nothing else drawn', z && z.exp === 'false' && !z.body && z.hidden && z.sum === 'Flag colour · Plain' && z.h < 70, z);
    await page.locator('#map-panel .mlk').screenshot({ path: path.join(OUT, 'map-look-closed.png') });
    await page.click('#map-panel .mlk-tg'); await sleep(200);
    z = await page.evaluate(() => ({ exp: document.querySelector('#map-panel .mlk-tg')?.getAttribute('aria-expanded'), sws: !!document.querySelector('#map-panel .mlk-sws'), focus: !!document.activeElement?.classList.contains('mlk-tg'), ls: localStorage.getItem('statehood.mlkopen.v1') }));
    check('opened, it shows the colours, the focus stays on its button, and it is remembered', z.exp === 'true' && z.sws && z.focus && z.ls === '1', z);
    await calm(page); let c = await card(page);
    check('the map panel has "Your map look" under Your territory', c && c.h === 'Your map look' && await page.evaluate(() => { const p = document.getElementById('map-panel'), m = p.querySelector('.mlk'), b = p.querySelector('[data-act="map-me"]'); return !!b && !!(b.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING); }), c);
    check('the colour comes from the flag (Match my flag pressed), with the twelve colours to pick from', c.colour === 'From your flag' && c.flag === 'true' && c.free === 12 && !c.on, c);
    check('the tutorial’s Orchid is shown locked, saying which task earns it', c.lockSw.length === 1 && c.lockSw[0] === 'mlk-mc-lock:rmb' && c.locks.length === 1 && /^Orchid: Earned by the tutorial task “.+”/.test(c.locks[0]), c);
    check('with nothing for sale and nothing held, no hex backgrounds are offered', c.tiles.length === 0 && c.te === 'Plain' && !c.foot, c.tiles);

    await sells(page); await sleep(200);
    await calm(page); c = await card(page);
    const ids = c.tiles.map(x => x.id);
    check('on sale: Plain and the six hex backgrounds, each drawn', JSON.stringify(ids) === JSON.stringify(['', 'te-hatch', 'te-stipple', 'te-wash', 'te-grid', 'te-fret', 'te-gilt']) && c.tiles.every(x => x.svg), ids);
    check('Plain is worn; the six are locked, under a line for each pack and its price', c.tiles[0].on && c.tiles[0].s === 'Wearing' && c.tiles.slice(1).every(x => x.lock && x.act === 'mlk-shop' && !x.s)
      && c.groups.length === 3 && /^Cartographer’s Pack · .*€\d/.test(c.groups[0]) && /^Mayan Pack · .*€\d/.test(c.groups[1]) && /^Founder’s Package · .*€\d/.test(c.groups[2]) && c.foot, { t: c.tiles, g: c.groups });
    check('the Cartographer’s three colours are shown locked, and the lock says where they are', c.lockSw.filter(x => x.startsWith('mlk-shop:')).length === 3 && c.locks.some(l => /^Prussian Blue, Carmine, and Sap Green: Cartographer’s Pack · .*€\d/.test(l)), c);
    await page.locator('#map-panel .mlk').screenshot({ path: path.join(OUT, 'map-look-card.png') });

    /* a locked hex background: the pack's Shop drawer over the map page, led by the gallery */
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-hatch"]'); await sleep(400);
    let d = await drawer(page);
    check('a locked hex background opens its pack in a Shop drawer over the map page', d && d.mlk && d.view === 'map' && d.hash === '#map' && d.above && d.focus && d.buy, d);
    check('the drawer leads with "How it looks on Lampwick": the land now, then each of the four finishes, the chosen one first', d.gal === 'How it looks on Lampwick' && d.figs.length === 5 && d.figs[0].now && d.figs[0].n === 'Your land now' && d.figs[1].on && d.figs[1].n === 'Engraver’s Hatching' && d.figs.slice(1).every(f => f.svg && f.tr) && !d.four, d.figs);
    await page.locator('.shop-dr').screenshot({ path: path.join(OUT, 'map-look-drawer.png') });
    await page.screenshot({ path: path.join(OUT, 'map-look-desktop.png') });
    await page.keyboard.press('Escape'); await sleep(300);
    check('Escape closes it; still on the map, the focus back on the tile', await page.evaluate(() => !document.querySelector('.shop-dr') && window.__game.S.view === 'map' && document.activeElement?.dataset.id === 'te-hatch'));

    /* trying a finish on from the drawer, then back to the pack over the map */
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-stipple"]'); await sleep(300);
    await page.click('.mlk-fig [data-act="ctg-try"][data-id="te-stipple"]'); await sleep(400);
    const tried = await page.evaluate(() => ({ dr: !!document.querySelector('.shop-dr'), note: document.querySelector('.ctg-try')?.textContent || '', te: window.__game.SHOP.cz(window.__game.S.nation).te, view: window.__game.S.view }));
    check('"Try it on your map" closes the drawer and puts the finish on the map', !tried.dr && /Trying on: Stippled Ink/.test(tried.note) && tried.te === 'te-stipple' && tried.view === 'map', tried);
    await page.click('.ctg-try [data-act="ctg-shop"]'); await sleep(400);
    d = await drawer(page);
    check('"Back to the pack" opens the drawer over the map again, the finish taken off', d && d.mlk && d.view === 'map' && d.figs[1].n === 'Stippled Ink' && d.figs[1].on && await page.evaluate(() => window.__game.SHOP.cz(window.__game.S.nation).te === ''), d);
    await page.click('.shop-scrim'); await sleep(300);
    check('the scrim closes it', await page.evaluate(() => !document.querySelector('.shop-dr') && window.__game.S.view === 'map'));

    /* the Mayan Pack and the Founder's Package: one finish each */
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-fret"]'); await sleep(300);
    d = await drawer(page);
    check('the Mayan Pack over the map: the land now and in the Stepped Fret, its own land picture left out', d && d.figs.length === 2 && d.figs[1].n === 'Stepped Fret' && d.figs[1].tr === 'te-fret' && !d.maya, d);
    await page.keyboard.press('Escape'); await sleep(200);
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-gilt"]'); await sleep(300);
    d = await drawer(page);
    check('the Founder’s Package over the map: the land in the Founder’s Gilt', d && d.figs.length === 2 && d.figs[1].n === 'Founder’s Gilt', d);
    await page.click('.mlk-fig [data-act="ctg-try"][data-id="te-gilt"]'); await sleep(400);
    check('the Founder’s Gilt can be tried on the map too', await page.evaluate(() => window.__game.SHOP.cz(window.__game.S.nation).te === 'te-gilt' && /Trying on: Founder’s Gilt/.test(document.querySelector('.ctg-try')?.textContent || '')));
    await page.click('.ctg-try [data-act="ctg-try-off"]'); await sleep(200);

    /* a locked Cartographer's colour opens the pack too */
    await calm(page); await page.click('#map-panel .mlk-sws [data-mc="#2B4C7E"]'); await sleep(300);
    d = await drawer(page);
    check('a locked Cartographer’s colour opens that pack over the map', d && d.mlk && d.figs.length === 5 && !d.figs.some(f => f.on), d);
    await page.keyboard.press('Escape'); await sleep(200);

    /* the Orchid's lock says how */
    await calm(page); await page.click('#map-panel .mlk-sws [data-act="mlk-mc-lock"]'); await sleep(300);
    check('the locked Orchid says how it is earned (after the founding toasts)', await until(async () => /Orchid is not yours yet\. Earned by the tutorial task/.test(await toasts(page)), 30000), await toasts(page));

    /* a colour chosen on the card is worn at once: saved, the map drawn again in it, still on the map page */
    await calm(page);
    const pic0 = await mapPic(page); await sleep(800); const pic1 = await mapPic(page);
    await page.click('#map-panel .mlk-sws .sw[data-val="#2A9D8F"]'); await sleep(800);
    const pic2 = await mapPic(page); c = await card(page);
    const worn = await page.evaluate(() => ({ mapc: window.__game.S.nation.mapc, view: window.__game.S.view, hash: location.hash, focus: document.activeElement?.dataset?.val, pressed: document.querySelector('#map-panel .mlk-sws .sw[data-val="#2A9D8F"]')?.getAttribute('aria-pressed') }));
    check('Teal on the card is worn at once: saved on the nation, still on the map, the card showing it', worn.mapc === '#2A9D8F' && worn.view === 'map' && worn.hash === '#map' && c.colour === 'Teal' && c.on === '#2A9D8F' && c.flag === 'false' && worn.pressed === 'true' && worn.focus === '#2A9D8F', { worn, c });
    check('the map is drawn again in Teal (its picture still before, changed after)', !!pic0 && pic0 === pic1 && pic1 !== pic2, { still: pic0 === pic1, changed: pic1 !== pic2, len: pic0.length });
    check('a toast says it is on the map', await until(async () => /Teal is your map colour now, for every player in your region\./.test(await toasts(page)), 30000), await toasts(page));
    await page.locator('#map-panel .mlk').screenshot({ path: path.join(OUT, 'map-look-card-teal.png') });
    await calm(page); await page.click('#map-panel .mlk [data-act="mlk-mc-set"]');
    check('"Change in Settings" opens the map colour', await until(() => page.evaluate(() => window.__game.S.view === 'settings' && document.querySelector('#sg-tab-nation')?.getAttribute('aria-selected') === 'true' && !!document.getElementById('set-mapc'))));
    await sleep(300);
    const sg = await page.evaluate(() => ({ on: document.querySelector('#set-mapc .sw.on')?.dataset.val, dirty: /unsaved/.test(document.getElementById('s-dirty')?.textContent || '') }));
    check('Settings has Teal saved, nothing waiting to save', sg.on === '#2A9D8F' && !sg.dirty, sg);
    await go('map');
    await office(page); z = await shut(page);
    check('back on the map, the card is still open', z && z.exp === 'true' && z.body && !z.hidden, z);
    await calm(page); await page.click('#map-panel .mlk-flag'); await sleep(600); c = await card(page);
    check('"Match my flag" takes the colour back to the flag at once', await page.evaluate(() => !window.__game.S.nation.mapc) && c.colour === 'From your flag' && c.flag === 'true' && !c.on, c);
    await page.click('#map-panel .mlk-tg'); await sleep(200); z = await shut(page);
    check('closed again, it stays closed', z.exp === 'false' && !z.body && await page.evaluate(() => localStorage.getItem('statehood.mlkopen.v1') === ''), z);

    /* held finishes: worn, held, and the way to Customise (open once the nation is past its charter) */
    await edit(n => { delete n.onb; const c = n.cz || {}; n.cz = Object.assign({}, c, { u: [...new Set([...(c.u || []), 'te-hatch', 'te-stipple', 'te-wash', 'te-grid', 'tb-survey', 'tb-pearl', 'tb-ribbon', 'hx-prussian', 'hx-carmine', 'hx-sap', 'pn-windrose', 't-surveyor', 'pl-blueprint'])], te: 'te-wash' }); });
    await sleep(300);
    await calm(page); c = await card(page);
    const w = c.tiles.find(x => x.id === 'te-wash'), h = c.tiles.find(x => x.id === 'te-hatch');
    check('held: the worn finish says Wearing, another held one sits beside it unlocked, the rest stay locked under their packs', c.te === 'Hand-Coloured' && w.on && w.s === 'Wearing' && !w.lock && w.act === 'mlk-cz' && h.s === '' && !h.lock && c.tiles.find(x => x.id === 'te-fret').lock && !c.tiles[0].on && c.groups.length === 2 && /^Mayan Pack/.test(c.groups[0]), { t: c.tiles, g: c.groups });
    check('held: the Cartographer’s colours are free to pick, and no longer in the locks', c.free === 15 && !c.locks.some(l => /Prussian/.test(l)), c);
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-hatch"]');
    check('a held finish opens Customise › Finery at Land', await until(() => page.evaluate(() => { const g = document.querySelector('.cz-g-te'); if (window.__game.S.view !== 'customise' || !g || location.hash !== '#customise/finery') return false; const r = g.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })));
    await go('map');
    await calm(page); await page.click('#map-panel .mlk-t[data-id="te-fret"]'); await sleep(300);
    d = await drawer(page);
    check('the gallery shows the land now in the finish worn', d && d.figs[0].now && await page.evaluate(() => /Hand-Coloured/.test(document.querySelector('.mlk-fig.now figcaption').textContent)), d);
    await page.keyboard.press('Escape'); await sleep(200);

    /* the full-screen map: the drawer over it, Escape closing the drawer only */
    await page.click('[data-act="map-fs"][data-k="main"]'); await sleep(500);
    const fs0 = await page.evaluate(() => !!window.__game.S.mapFs);
    await calm(page); await page.evaluate(() => document.querySelector('#map-panel .mlk-t[data-id="te-fret"]').click()); await sleep(400);
    d = await drawer(page);
    check('on the full-screen map the drawer opens above it', fs0 && d && d.above, { fs0, d });
    await page.keyboard.press('Escape'); await sleep(300);
    check('Escape closes the drawer and leaves the map full screen', await page.evaluate(() => !document.querySelector('.shop-dr') && !!window.__game.S.mapFs));
    await page.keyboard.press('Escape'); await sleep(300);
    check('a second Escape leaves full screen', await page.evaluate(() => !window.__game.S.mapFs));

    check('no page errors on the desktop', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }

  /* ── a phone, dark ── */
  {
    const t = await start('dark', { width: 390, height: 844 }, { phone: true }), { page } = t;
    await sells(page); await sleep(300);
    await office(page); const z = await shut(page);
    check('phone: the card is closed at first in the map’s sheet', z && z.exp === 'false' && !z.body && z.sum === 'Flag colour · Plain', z);
    await calm(page); const c = await card(page);
    check('phone: the card is in the map’s sheet, with its tiles', c && c.tiles.length === 7, c);
    const wide = await page.evaluate(() => { const m = document.querySelector('#map-panel .mlk'), r = m.getBoundingClientRect(), p = document.getElementById('map-panel').getBoundingClientRect(); return { over: document.documentElement.scrollWidth - innerWidth, r: Math.round(r.right), p: Math.round(p.right) }; });
    check('phone: nothing wider than the screen', wide.over <= 0 && wide.r <= wide.p, wide);
    await calm(page); await page.evaluate(() => document.querySelector('#map-panel .mlk-t[data-id="te-grid"]').click()); await sleep(500);
    const d = await drawer(page);
    check('phone: the drawer opens over the map as a sheet, led by the gallery', d && d.mlk && d.above && d.figs.length === 5 && d.figs[1].n === 'Survey Grid', d);
    await page.screenshot({ path: path.join(OUT, 'map-look-phone-dark.png') });
    check('no page errors on the phone', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
