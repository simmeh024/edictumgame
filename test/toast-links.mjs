// Links in toasts to what was unlocked: every kind of unlock has a place its link opens; a save that unlocks something
// toasts a link that lands on the thing itself, pulsing; a toast that names an unlock takes its link and anything left
// over gets a toast of its own; a held flag emblem lands in the flag designer; the bell's honours carry the unlocks;
// and a burst of reward toasts, folded into one, keeps their links.
//   python3 build.py
//   node test/toast-links.mjs
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

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; try { localStorage.setItem('statehood.notif', JSON.stringify({ rw: 'on' })); } catch (e) {} });
await page.goto(BASE);
await page.fill('#d-name', 'Lampwick'); await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
const act = (a, d = {}) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d); document.body.appendChild(b); b.click(); b.remove(); }, [a, d]);
await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
await act('map-suggest'); await act('settle'); await sleep(800);
await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); const G = window.__game, n = G.clone(G.S.nation); delete n.onb; G.commit(n); G.render(); });
await sleep(2500);
/* close every toast the way a player does, so the queue is empty */
const clearToasts = async () => { for (let i = 0; i < 20; i++) { const shown = await page.evaluate(() => { const T = document.querySelector('#toast'); if (T && !T.hidden) { T.querySelector('.toast-x')?.click(); return true; } return false; }); if (!shown) return; await sleep(120); } };
await clearToasts();
const closeOne = () => page.evaluate(() => { document.querySelector('#toast:not([hidden]) .toast-x')?.click(); });

/* 1. one unlock of every kind: its link opens the right page with the thing in view (an emblem the nation does not
   hold is not drawn in the flag designer, so its section is enough) */
const sample = await page.evaluate(() => { const U = window.__game.UX.UNLOCKS, by = {}; for (const id of Object.keys(U)) if (!by[U[id].k]) by[U[id].k] = id; return by; });
const noPlace = await page.evaluate(() => { const X = window.__game.UX; return Object.keys(X.UNLOCKS).filter(id => !X.unlockTarget(id)); });
check('every unlock in the game has a place its link opens', noPlace.length === 0, noPlace.slice(0, 10));
const missed = [];
for (const [k, id] of Object.entries(sample)) {
  const r = await page.evaluate(async id => { const X = window.__game.UX, T = X.unlockTarget(id); X.unlockShow(id); await new Promise(r => setTimeout(r, 650));
    const el = document.querySelector(T.target) || (T.sec && document.querySelector('#cz-sec-' + T.sec)), b = el && el.getBoundingClientRect();
    return { view: window.__game.S.view, want: T.view, seen: !!b && b.top < innerHeight && b.bottom > 0, exact: !!document.querySelector(T.target) }; }, id);
  if (r.view !== r.want || !r.seen || (!r.exact && k !== 'emblem')) missed.push(k + ':' + id + ' ' + JSON.stringify(r));
}
check(`a link of each of the ${Object.keys(sample).length} kinds lands on the thing in Customise, the passport designer or Settings`, missed.length === 0, missed);

/* 2. a save that unlocks something toasts a link to it, and the link lands on it, pulsing */
await page.evaluate(() => { location.hash = '#nation'; }); await sleep(700); await clearToasts();
const pick = await page.evaluate(() => { const G = window.__game, X = G.UX, held = X.unlocksOf(G.S.nation); const a = G.RK.ACH.find(a => a.u && X.UNLOCKS[a.u] && !held.has(a.u) && X.UNLOCKS[a.u].k === 'frame'); return a && { ach: a.id, u: a.u, n: X.UNLOCKS[a.u].n }; });
await page.evaluate(p => { const G = window.__game, n = G.clone(G.S.nation); n.ach = Object.assign({}, n.ach, { [p.ach]: Date.now() }); G.commit(n); }, pick);
const shown = await page.waitForFunction(u => { const T = document.querySelector('#toast'); return T && !T.hidden && !!T.querySelector(`a[data-kind="unlock"][data-id="${u}"]`); }, pick.u, { timeout: 8000 }).then(() => true).catch(() => false);
check('a save that unlocks a flag frame toasts a link to it', shown, await page.evaluate(() => document.querySelector('#toast')?.innerText));
await page.locator('#toast').screenshot({ path: path.join(OUT, 'toast-links-toast.png') }).catch(() => {});
await page.evaluate(u => { window.__lastU = u; }, pick.u);
await page.click(`#toast a[data-kind="unlock"][data-id="${pick.u}"]`);
await sleep(800);
const landed = await page.evaluate(() => { const el = document.activeElement; return { view: window.__game.S.view, focus: el && el.dataset ? el.dataset.czid : '', pulse: !!(el && el.classList.contains('cz-pulse')), hash: location.hash }; });
check('the link opens Customise on that frame, focused and pulsing', landed.view === 'customise' && landed.focus === pick.u && landed.pulse && /^#customise\//.test(landed.hash), landed);
check('and the toast closes as it goes', await page.evaluate(() => { const T = document.querySelector('#toast'); return !T || T.hidden || !T.querySelector('a[data-kind="unlock"][data-id="' + window.__lastU + '"]'); }));
await page.screenshot({ path: path.join(OUT, 'toast-links-landed.png') });

/* 3. a toast that names an unlock takes its link; what no toast names gets one of its own */
await clearToasts();
await page.evaluate(() => { const X = window.__game.UX; X.unlockQueue(['ps-laurel', 'ps-wings']); X.toast('Achievement earned: ‘Sworn Friends’ (gold, 50 prestige). Unlocked: the Laurel wreath entry stamp shape.'); });
const named = await page.evaluate(() => [...document.querySelectorAll('#toast a[data-kind="unlock"]')].map(a => a.dataset.id).join());
check('the toast that names the Laurel wreath links to it, and only to it', named === 'ps-laurel', named);
await sleep(1700); await closeOne();
const own = await page.waitForFunction(() => { const T = document.querySelector('#toast'); return T && !T.hidden && /^New for Lampwick: the Wings/.test(T.textContent) && [...T.querySelectorAll('a[data-kind="unlock"]')].map(a => a.dataset.id).join(); }, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => '');
check('the Wings, named by no toast, get a toast of their own with the link', own === 'ps-wings', own);
await clearToasts();

/* 4. an emblem the nation holds: its link lands on the emblem itself in the flag designer */
const emb = await page.evaluate(async () => { const G = window.__game, X = G.UX, a = G.RK.ACH.find(a => a.u && X.UNLOCKS[a.u] && X.UNLOCKS[a.u].k === 'emblem');
  const n = G.clone(G.S.nation); n.ach = Object.assign({}, n.ach, { [a.id]: Date.now() }); G.commit(n); X.unlockShow(a.u); await new Promise(r => setTimeout(r, 800));
  const el = document.querySelector(X.unlockTarget(a.u).target), b = el && el.getBoundingClientRect(); return { id: a.u, view: G.S.view, seen: !!b && b.top < innerHeight && b.bottom > 0 }; });
check('a held flag emblem’s link lands on it in the flag designer', emb.view === 'customise' && emb.seen, emb);

/* 5. the bell's honours list the unlocks beside the achievements */
await clearToasts();
const bell = await page.evaluate(async () => { document.querySelector('.bell')?.click(); await new Promise(r => setTimeout(r, 300)); const l = [...document.querySelectorAll('.nt-item a[data-kind="unlock"]')].map(a => a.dataset.id); document.querySelector('.bell')?.click(); return l; });
check('the bell’s honours carry links to what the achievements unlocked', bell.includes(pick.u) && bell.includes(emb.id), bell);

/* 6. reward toasts folded into one keep all their links */
await sleep(1700); await clearToasts();
const fold = await page.evaluate(async () => { const X = window.__game.UX;
  X.toast({ m: 'Achievement earned: a test.', links: [{ kind: 'unlock', id: 'f-gilt' }] }); X.toast({ m: 'Achievement earned: another test.', links: [{ kind: 'unlock', id: 'ps-laurel' }] }); X.toast({ m: 'Achievement earned: a third test.', links: [{ kind: 'unlock', id: 'ps-wings' }] });
  await new Promise(r => setTimeout(r, 50)); const T = document.querySelector('#toast'); return { text: T.textContent, links: [...T.querySelectorAll('a[data-kind]')].map(a => a.dataset.id) }; });
await closeOne(); await sleep(100);
const fold2 = await page.evaluate(() => { const T = document.querySelector('#toast'); return T && !T.hidden ? [...T.querySelectorAll('a[data-kind]')].map(a => a.dataset.id) : []; });
const all = [...new Set(fold.links.concat(fold2))];
check('a burst of reward toasts keeps every link', ['f-gilt', 'ps-laurel', 'ps-wings'].every(id => all.includes(id)), { fold, fold2 });

/* 7. phone: the toast's links fit */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => { window.__game.UX.toast({ m: 'Achievement earned: ‘Sworn Friends’ (gold, 50 prestige). Unlocked: the Laurel wreath entry stamp shape.', links: [{ kind: 'unlock', id: 'ps-laurel' }, { kind: 'unlock', id: 'f-gilt' }] }); });
await sleep(400);
check('on a phone the toast and its links fit the screen', await page.evaluate(() => { const T = document.querySelector('#toast'), b = T.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; }));
await page.locator('#toast').screenshot({ path: path.join(OUT, 'toast-links-phone.png') }).catch(() => {});
check('no script errors', errors.length === 0, errors.slice(0, 5));

await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
