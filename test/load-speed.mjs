// Faster loads (2026-11-23), in the page, on a phone-sized window: the river network is kept between visits and taken
// back, the same to the last corner; the faces the first page used are asked for before the game draws its page next
// time; a map far down a page is drawn when it comes near (or, the first time, once the page has settled, which warms
// the World map); a long page's far sections are not laid out, yet its "Jump to section" list and the reader's place on
// returning are as they were; the bell's number and the Achievements register's later groups come just after the page.
//   python3 build.py
//   node test/load-speed.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  /* cached like Hosting's long-lived assets, so a reload takes them (and their fonts) from the browser's cache */
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': /[\\/]assets[\\/]/.test(f) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch();

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }), page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.EDICTUM_PROBE = g => { window.__game = g; };
  /* the page the moment the game first puts its layout in: its bell, and whether the noted faces are loaded */
  window.__first = null;
  new MutationObserver(() => {
    if (window.__first || !document.querySelector('.layout')) return;
    const b = document.querySelector('.bell');let noted = [];
    try { noted = JSON.parse(localStorage.getItem('edictum.fonts') || '[]'); } catch (e) {}
    window.__first = { bell: b ? b.outerHTML : null, fonts: noted.map(d => [d, document.fonts.check(d)]) };
  }).observe(document, { subtree: true, childList: true });
});
const G = f => page.evaluate(f);
const go = async v => { await page.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(250); };
const act = a => page.evaluate(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
/* the network as the rest of the game sees it, as one fingerprint */
const rivers = () => G(() => {
  const A = window.__game.WTN().rvData(), h = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 0).toString(36); };
  const list = A.list.map(r => [r.id, r.name0, r.kind, r.cls, r.parent, r.verts.join(), r.pts.flat().join(), r.w.join(), r.eh.join(), r.bk.join(), r.cells.join(), r.len, r.acc, r.end, r.mouth, r.tail && r.tail.join()].join('/'));
  const lakes = A.lakes.map(L => [L.id, L.name, L.cells.join(), L.x, L.y, L.loop.join(), L.river, L.tarn].join('/'));
  return { cached: A.cached, n: A.list.length, h: h(JSON.stringify([list, lakes, [...A.at], [...A.lake], [...A.lakeAt], [...(A.fz || [])], Array.from(A.E6).join(), Array.from(A.bonus).join(), Array.from(A.bank).join()])) };
});
const mapCv = () => G(() => { const c = document.querySelector('.main canvas.map-cv'); return c ? { far: !!c._far, drawn: !!c._mmf, top: Math.round(c.getBoundingClientRect().top) } : null; });

// a nation, settled, on its Nation page
await page.goto(BASE);
await page.fill('#d-name', 'Swiftmark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
await page.evaluate(() => { location.hash = '#map'; }); await until(() => G(() => window.__game.S.view === 'map')); await sleep(400);
for (let i = 0; i < 4 && await G(() => window.__game.S.nation.inbox.some(x => x.id === 'fd-settle')); i++) { await act('map-suggest'); await sleep(300); await act('settle'); await sleep(800); }
await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
await page.evaluate(() => { const g = window.__game; if (g.S.nation.onb) { const n = g.clone(g.S.nation); delete n.onb; g.commit(n); g.PG.saveSoon(); } });
await go('nation');

// 1. the rivers: made on this page and kept; taken back on the next, the same network
const made = await until(() => G(() => localStorage.getItem('edictum.rv')), 15000);
const R1 = await rivers();
check('a page that made its rivers keeps them, under its region', made === await G(() => window.__game.REG ? window.__game.REG.id : localStorage.getItem('edictum.rv')) && !R1.cached && R1.n > 50, { made, R1 });
/* the faces the first page used are noted once it has settled (6 s after the game started) */
const noted = await until(() => G(() => { try { return JSON.parse(localStorage.getItem('edictum.fonts') || 'null'); } catch (e) { return null; } }), 12000);
check('the faces the first page used are noted', Array.isArray(noted) && noted.length > 0 && noted.every(d => /^(italic )?[\w.]+ 16px "[^"]+"$/.test(d)), noted);

await page.reload();
await page.waitForFunction(() => window.__game && window.__game.S.view === 'nation' && document.querySelector('.layout'));
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const m0 = await mapCv();
const R2 = await until(async () => { const r = await rivers(); return r && r.n ? r : null; });
check('the next page takes the kept rivers instead of making them', typeof R2.cached === 'number', R2);
check('and they are the same network, to the last corner, name, lake and valley', R2.h === R1.h && R2.n === R1.n, { R1, R2 });

// 2. the faces: loaded before the game first drew its page
const first = await G(() => window.__first);
check('the noted faces are in before the game draws its first page', first && first.fonts.length > 0 && first.fonts.every(([, ok]) => ok), first && first.fonts);

// 3. the bell: drawn first without its number, which follows in place, as every later page draws it
check('the first page\'s bell has no number yet', first && /class="bell-n" hidden/.test(first.bell) && /aria-label="Notifications"/.test(first.bell), first && first.bell);
await sleep(1500);
const bellNow = await G(() => document.querySelector('.bell').outerHTML);
const bellFull = await G(() => { window.__game.S.notifOpen = false; const n = window.__game.clone(window.__game.S.nation); window.__game.commit(n); window.__game.render(); return document.querySelector('.bell').outerHTML; });
check('a moment later it shows what any later page shows', bellNow === bellFull, { bellNow, bellFull });

// 4. the map far down the Nation page: put off, then drawn once the page has settled (no terrain picture yet: it warms
// the World map), drawn again as its relief and sea come in
check('the Nation page\'s map, screens down on a phone, is not drawn with the page', m0 && m0.top > 2 * 844 && !m0.drawn, m0);
check('but once the page has settled', await until(async () => (await mapCv()).drawn, 8000), await mapCv());
/* with the terrain picture made, a far map waits until the reader comes near it */
await go('issues'); await go('nation'); await sleep(1500);
const m1 = await mapCv();
check('once the World map\'s pictures exist, a far map waits', m1 && m1.far && !m1.drawn, m1);
await page.evaluate(() => document.querySelector('.main canvas.map-cv').scrollIntoView({ block: 'center' }));
check('and is drawn as the reader comes near', await until(async () => (await mapCv()).drawn, 5000), await mapCv());
/* put full screen, the map leaves its section, which holds it no longer (a section not laid out would) */
await page.evaluate(() => document.querySelector('.map-fs-mini').click());
const fills = () => G(() => { const w = document.querySelector('.map-wrap.is-full'); if (!w) return false; const r = w.getBoundingClientRect(); return r.left <= 0.5 && r.top <= 0.5 && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; });
check("the Nation page's map, put full screen, fills the window", await until(fills, 5000), await G(() => { const w = document.querySelector('.map-wrap.is-full'); return w && JSON.stringify(w.getBoundingClientRect()); }));
await page.keyboard.press('Escape');
check('and leaves it again', await until(() => G(() => !document.querySelector('.map-wrap.is-full')), 5000));
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);

// 5. the far sections: not laid out; the jump list as with every section laid out; the reader's place kept
const skipped = await G(() => [...document.querySelectorAll('.main .wrap>section.section,.main .wrap>.nation-grid')].filter(s => s.firstElementChild && !s.firstElementChild.checkVisibility({ contentVisibilityAuto: true })).length);
check('the Nation page\'s far sections are not laid out', skipped >= 3, skipped);
const jumps = () => G(() => [...document.querySelectorAll('.ux-sections option')].map(o => o.value + ':' + o.textContent).join('|'));
const withCv = await jumps();
await G(() => { const s = document.createElement('style'); s.id = 'cv-test-off'; s.textContent = '.main .wrap>*{content-visibility:visible!important}'; document.head.appendChild(s); });
await go('issues'); await go('nation');
const withoutCv = await jumps();
await G(() => document.getElementById('cv-test-off').remove());
await go('issues'); await go('nation');
check('"Jump to section" lists the same sections as when every section is laid out', withCv && withCv === withoutCv, { withCv, withoutCv });
/* scrolled down without passing the sections above (so the browser never laid them out), then away and back */
const H = await G(() => document.documentElement.scrollHeight);
const at = async () => G(() => { const e = document.elementFromPoint(195, 420); const s = e && e.closest('.main .wrap>*'); return s ? [...s.parentElement.children].indexOf(s) + ':' + Math.round(s.getBoundingClientRect().top) : null; });
await G(() => window.scrollTo(0, 4200)); await sleep(500);
const here = await at(), yHere = await G(() => Math.round(window.scrollY));
await go('issues'); await go('nation'); await sleep(600);
const back = await at(), yBack = await G(() => Math.round(window.scrollY));
check('back on the page, the reader is where they were', here && back === here && Math.abs(yBack - yHere) <= 1, { H, here, back, yHere, yBack });
const patched = await G(() => { const app = document.getElementById('app'); app.prepend(document.createElement('i')); window.__game.render(); return !app.firstChild || app.firstChild.tagName !== 'I'; }) && await at();
check('and a page drawn again in place keeps them there', patched === here, { here, patched });
await go('issues'); await go('nation'); await sleep(600);
await go('issues'); await go('nation'); await sleep(600);
const again = await at(), yAgain = await G(() => Math.round(window.scrollY));
check('and after more returns, not a pixel further', again === here && yAgain === yHere, { here, again, yHere, yAgain });
check('nothing is left laid out in full, nor the scroll anchoring held off', await until(() => G(() => !/cv-(full|still)/.test(document.documentElement.className)), 3000));

// 6. the Achievements register: the first groups with the page, the rest just after, as the page itself draws them
await G(() => window.scrollTo(0, 0));
await page.evaluate(() => document.querySelector('.nav [data-v="achievements"]').click());
const a0 = await G(() => ({ stubs: document.querySelectorAll('#main [data-ach-fill]').length, cards: document.querySelectorAll('.ach-card').length }));
check('the register shows its first groups with the page, the others\' headings waiting', a0.stubs > 3 && a0.cards > 0, a0);
const filled = await until(() => G(() => document.querySelectorAll('#main [data-ach-fill]').length === 0), 8000);
const a1 = await G(() => ({ cards: document.querySelectorAll('.ach-card').length, ach: window.__game.ACH ? window.__game.ACH.length : null }));
check('and fills in just after, every card there', filled && a1.cards > a0.cards * 3, { a0, a1 });
/* drawn in full again at once (printing fills the rest at once): the same register, to the character */
const same = await G(() => {
  document.querySelector('.nav [data-v="nation"]').click(); document.querySelector('.nav [data-v="achievements"]').click();
  const stubs = document.querySelectorAll('#main [data-ach-fill]').length; window.dispatchEvent(new Event('beforeprint'));
  const lazy = document.getElementById('ach-list').innerHTML; window.__game.render();
  return { stubs, left: document.querySelectorAll('#main [data-ach-fill]').length, same: lazy === document.getElementById('ach-list').innerHTML };
});
check('filled in, the register is exactly what the page draws in full', same.stubs > 0 && same.left === 0 && same.same, same);
/* a single category is drawn whole, as before (a reward's link lands on its card) */
const one = await G(() => { document.querySelector('[data-act="ach-cat"][data-c="law"]').click(); return { stubs: document.querySelectorAll('#main [data-ach-fill]').length, cards: document.querySelectorAll('.ach-card').length }; });
check('one category is drawn whole at once', one.stubs === 0 && one.cards > 0, one);

// 7. a wide window: the Nation page's map, near, is drawn with the page as before
const wide = await browser.newContext({ viewport: { width: 1400, height: 900 } }), wp = await wide.newPage();
wp.on('pageerror', e => errors.push(e.message));
await wp.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await wp.goto(BASE); await wp.fill('#d-name', 'Broadmark'); await wp.click('#found-btn');
await wp.waitForFunction(() => window.__game && window.__game.S.nation);
await wp.evaluate(() => { location.hash = '#map'; }); await sleep(500);
const wact = a => wp.evaluate(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
for (let i = 0; i < 4 && await wp.evaluate(() => window.__game.S.nation.inbox.some(x => x.id === 'fd-settle')); i++) { await wact('map-suggest'); await sleep(300); await wact('settle'); await sleep(800); }
await wp.evaluate(() => { const g = window.__game; const n = g.clone(g.S.nation); delete n.onb; g.commit(n); location.hash = '#nation'; });
await wp.waitForFunction(() => window.__game.S.view === 'nation' && document.querySelector('.main canvas.map-cv'));
const near = await wp.evaluate(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const c = document.querySelector('.main canvas.map-cv'), t = c.getBoundingClientRect().top; return { top: Math.round(t), far: !!c._far, drawn: !!c._mmf, vh: innerHeight }; });
check('a map within a screen of the window is drawn with the page', near.top > 2 * near.vh || (!near.far && near.drawn), near);

check('no page errors', errors.length === 0, errors);
await browser.close(); server.close();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all load speed checks passed');
