// Provinces on the Cities page, and cities on the provinces page (16 November 2026): a city's card names the division
// it stands in and links there, any city can become its division's seat after a word on what moves, the overview
// table gains a sortable column, and the provinces page links each city back to the Cities page. Also the new
// province achievements, read in the running game.
//   python3 build.py
//   node test/province-links.mjs
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const D = 864e5;
/* the division a city stands in, and its seat, as the game sees them */
const where = cid => page.evaluate(cid => { const G = window.__game, P = G.PRVC(), ct = G.CP2().cxOrder().find(c => c.id === cid), p = ct && P.cxPrvOf(ct); return p ? { id: p.id, nm: p.nm, seat: p.seat, c: ct.c } : null; }, cid);
const achV = id => page.evaluate(id => { const G = window.__game, R = G.RK, a = R.ACH.find(x => x.id === id); return a ? R.achVal(a, R.achCtx(G.S.nation, G.myId(), Date.now(), true)).v : null; }, id);
/* move a division's seat off its city, onto a neighbouring hex of the same division */
const seatOff = cid => edit((n, now, G) => {
  const ct = n.cities.find(c => c.id === window.__cid), T = G.territory(), mi = T.byId[G.myId()], q = n.prov.l.find(v => v.s === ct.c);
  if (!q) return;
  const busy = new Set(n.cities.map(c => c.c).concat(n.prov.l.map(v => v.s)));
  for (let d = 0; d < 6; d++) { const nb = G.MAP.nbr[ct.c * 6 + d]; if (nb >= 0 && T.owner[nb] === mi && G.MAP.T[nb] >= 2 && !busy.has(nb)) { q.s = nb; break; } }
}).catch(e => { throw e; });

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Shiremark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});

  /* land around the capital, and two more cities on it */
  await edit((n, now, G) => {
    const M = G.MAP, cap = n.cities[0].c, T = G.XP().territory(), mi = T.list.findIndex(x => x.me), d = 864e5, dist = new Map([[cap, 0]]), q = [cap];
    while (q.length) { const c = q.shift(), k = dist.get(c); if (k >= 7) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb < 0 || dist.has(nb) || M.T[nb] < 2) continue; if (T.owner[nb] >= 0 && T.owner[nb] !== mi) continue; dist.set(nb, k + 1); q.push(nb); } }
    const have = new Set((n.claims || []).map(e => e.c));
    n.claims = (n.claims || []).concat([...dist.keys()].filter(c => !have.has(c) && c !== cap).map((c, i) => ({ c, t: now - d + i })));
    const far = [...dist.entries()].filter(([, k]) => k >= 4).sort((x, y) => y[1] - x[1]).map(([c]) => c), a = far[0];
    const b = far.find(c => { const seen = new Set([a]), qq = [[a, 0]]; while (qq.length) { const [y, k] = qq.shift(); if (y === c) return k >= 4; if (k > 6) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[y * 6 + i]; if (nb >= 0 && !seen.has(nb)) { seen.add(nb); qq.push([nb, k + 1]); } } } return true; });
    n.cities.push({ id: 'c1', c: a, nm: 'Fenwick', t: now - 6 * d, b: [] });
    n.cities.push({ id: 'c2', c: b, nm: 'Ashmere', t: now - 3 * d, b: [] });
  });
  await sleep(500);
  const capId = await page.evaluate(() => window.__game.S.nation.cities[0].id);
  check('the test nation holds three cities', (await page.evaluate(() => window.__game.CP2().cxOrder().length)) === 3);

  /* provinces off: the Cities page says nothing of them */
  await go('cities');
  check('with provinces off, a city card has no province chip', await page.locator('.city-tags .cx-prv').count() === 0);
  check('with provinces off, the overview has no province column', await page.locator('#cx-ovw th.cx-ov-prv').count() === 0 && !(await page.evaluate(() => window.__game.PRVC().cxOvwCols().some(c => c[0] === 'prv'))));

  /* provinces on: one division per city */
  await page.evaluate(() => window.__game.SL.prvSwitch(true)); await sleep(400);
  const nprov = await page.evaluate(() => window.__game.S.nation.prov.l.length);
  check('switching provinces on gives the capital and at least one other city a division', nprov >= 2, nprov);
  await page.evaluate(() => { window.__cid = 'c1'; }); await seatOff('c1');
  const f0 = await where('c1');
  check('Fenwick stands in a division whose seat is now beside it', !!f0 && f0.seat !== f0.c && f0.seat >= 0, JSON.stringify(f0));

  await go('cities');
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${capId}"]`); await sleep(300);
  const capP = await where(capId);
  check('the capital’s card names it the seat of its province', (await txt('.city-tags .cx-prv')) === 'Seat of ' + capP.nm, await txt('.city-tags .cx-prv'));
  check('the chip shows that province’s flag or arms', await page.locator('.city-tags .cx-prv .cx-prv-f svg').count() === 1);
  check('the capital, already a seat, offers no seat move', await page.locator('#cx-seat-b').count() === 0);

  await page.click('.cx-list [data-act="cx-sel"][data-id="c1"]'); await sleep(300);
  check('Fenwick’s card names its province without calling it the seat', (await txt('.city-tags .cx-prv')) === 'Province: ' + f0.nm, await txt('.city-tags .cx-prv'));
  check('the overview has a Province column', (await txt('#cx-ovw th.cx-ov-prv')) === 'Province', await txt('#cx-ovw th.cx-ov-prv'));
  const cells = await page.evaluate(() => [...document.querySelectorAll('#cx-ovw tbody tr')].map(r => ({ city: r.querySelector('.cx-ov-go b').textContent, prv: r.querySelector('.cx-ov-prv').textContent.trim() })));
  const seats = (await Promise.all([capId, 'c1', 'c2'].map(where))).filter(w => w && w.seat === w.c).length;
  check('each row names its city’s province, and marks the seats', cells.length === 3 && cells.every(r => r.prv.length > 1) && cells.filter(r => /seat$/.test(r.prv)).length === seats && seats >= 1, JSON.stringify(cells));
  await page.click('#cx-ovw [data-act="cx-sort"][data-k="prv"]'); await sleep(300);
  const sorted = await page.evaluate(() => [...document.querySelectorAll('#cx-ovw tbody .cx-ov-pl')].map(b => b.textContent));
  check('the Province column sorts A to Z first', sorted.length === 3 && sorted.join('|') === sorted.slice().sort((a, b) => a.localeCompare(b)).join('|'), sorted.join(', '));

  /* make Fenwick the seat: a word first, then the move */
  check('Fenwick offers to become the seat of its province', /^Make it the seat of /.test(await txt('#cx-seat-b') || ''), await txt('#cx-seat-b'));
  await page.click('#cx-seat-b'); await sleep(300);
  const ask = await txt('#cx-seat') || '';
  check('asking first: what moves, and where the seat is now', new RegExp(`Move the seat of ${f0.nm} to Fenwick\\?`).test(ask) && /Its seat is now on open country, in no city\./.test(ask) && /(hex(?:es)? changes?|No border moves)/.test(ask), ask);
  check('the button says the panel is open, and focus is on Move the seat', (await page.getAttribute('#cx-seat-b', 'aria-expanded')) === 'true' && await page.evaluate(() => document.activeElement && document.activeElement.id === 'cx-seat-go'));
  await page.screenshot({ path: path.join(OUT, 'province-links-seat-ask.png'), fullPage: false });
  await page.click('[data-act="cx-seat-no"]'); await sleep(300);
  check('Keep it where it is closes the panel and moves nothing', await page.locator('#cx-seat').count() === 0 && (await where('c1')).seat === f0.seat && await page.evaluate(() => document.activeElement && document.activeElement.id === 'cx-seat-b'));
  await page.click('#cx-seat-b'); await sleep(200); await page.click('#cx-seat-go'); await sleep(400);
  const f1 = await where('c1');
  check('Move the seat puts the seat on Fenwick', f1 && f1.seat === f1.c && f1.id === f0.id, JSON.stringify(f1));
  check('a line says so, and the card now names Fenwick the seat', /^Fenwick is now the seat of /.test(await txt('#cx-seat-msg') || '') && (await txt('.city-tags .cx-prv')) === 'Seat of ' + f0.nm && await page.locator('#cx-seat-b').count() === 0, await txt('#cx-seat-msg'));
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${capId}"]`); await sleep(300);
  check('the line goes when another city is opened', await page.locator('#cx-seat-msg').count() === 0);

  /* the chip opens the province */
  await page.click('.city-tags .cx-prv'); await until(() => page.evaluate(() => window.__game.S.view === 'provinces'));
  check('the chip opens the provinces page on that province', await page.evaluate(id => window.__game.PRVC().PRV.ui.sel === id, capP.id) && (await txt('#prv-side-h')) === capP.nm, await txt('#prv-side-h'));
  /* which of the three cities stand in a division, by the game's own reckoning (the map differs from run to run) */
  const inProv = async id => { const out = []; for (const c of [capId, 'c1', 'c2']) { const w = await where(c); if (w && w.id === id) out.push({ c, seat: w.seat === w.c }); } return out; };
  const capIn = await inProv(capP.id);
  check('its panel lists its cities, the seat marked', capIn.some(x => x.c === capId && x.seat) && /Seat/.test(await txt('#prv-side .prv-cities') || '') && await page.locator('#prv-side .prv-cities [data-act="prv-city"]').count() === capIn.length, await txt('#prv-side .prv-cities'));

  /* the provinces page: "Make it the seat" for a city that is not */
  await page.evaluate(() => { window.__cid = 'c2'; }); await seatOff('c2');
  const a0 = await where('c2');
  check('Ashmere is not the seat of its province now', a0 && a0.seat !== a0.c, JSON.stringify(a0));
  await page.evaluate(id => { const G = window.__game; G.PRVC().PRV.ui.sel = id; G.render(); }, a0.id); await sleep(300);
  const li = c => page.evaluate(c => { const b = document.querySelector(`#prv-side .prv-cities [data-act="prv-city"][data-c="${c}"]`), l = b && b.closest('li'); return l ? { seat: !!l.querySelector('.chip'), make: !!l.querySelector('[data-act="prv-seat-c"]') } : null; }, c);
  const was = (await inProv(a0.id)).find(x => x.seat);
  check('a city that is not the seat offers "Make it the seat"', JSON.stringify(await li('c2')) === '{"seat":false,"make":true}' && /not in a city/.test(await txt('#prv-side') || '') === !was, JSON.stringify(await li('c2')));
  await page.screenshot({ path: path.join(OUT, 'province-links-side.png'), fullPage: false });
  await page.click(`#prv-side [data-act="prv-seat-c"][data-c="${a0.c}"]`); await sleep(400);
  const a1 = await where('c2');
  check('and it does: Ashmere is the seat, the panel marks it', a1.seat === a1.c && JSON.stringify(await li('c2')) === '{"seat":true,"make":false}', JSON.stringify(a1));
  const was1 = was && await where(was.c);
  check('the city that was the seat now offers to be it again (if still in the division)', !was || !was1 || was1.id !== a0.id || JSON.stringify(await li(was.c)) === '{"seat":false,"make":true}', was ? JSON.stringify(await li(was.c)) : 'no city seat before');

  /* city names on the cards open the Cities page on that city */
  const link = page.locator('.prv-cards [data-act="prv-city"][data-c="c2"]');
  check('the cards name each city as a link', await link.count() === 1 && await page.locator('.prv-cards [data-act="prv-city"]').count() === 3);
  await link.click(); await until(() => page.evaluate(() => window.__game.S.view === 'cities'));
  await sleep(500);
  check('a city link opens the Cities page on that city', await page.evaluate(() => window.__game.S.cxSel === 'c2') && (await txt('#city-c2 .city-n')) === 'Ashmere', await txt('.cx-detail .city-n'));

  /* the division's own word follows: States */
  await edit(n => { n.prov.term = 's'; }); await sleep(300);
  await page.click('.cx-list [data-act="cx-sel"][data-id="c1"]'); await sleep(300);
  const f2 = await where('c1');
  check('with States, the chip and the column say State', (await txt('.city-tags .cx-prv')) === (f2.seat === f2.c ? 'Seat of ' : 'State: ') + f2.nm && /^State/.test(await txt('#cx-ovw th.cx-ov-prv') || ''), await txt('.city-tags .cx-prv') + ' / ' + await txt('#cx-ovw th.cx-ov-prv'));
  await page.click('.cx-list [data-act="cx-sel"][data-id="c2"]'); await sleep(200);
  await page.evaluate(() => { window.__cid = 'c2'; }); await seatOff('c2'); await sleep(300);
  check('a city that is not the seat reads "State: …"', /^State: /.test(await txt('.city-tags .cx-prv') || ''), await txt('.city-tags .cx-prv'));

  /* phones: nothing spills sideways */
  await page.setViewportSize({ width: 375, height: 800 }); await sleep(400);
  await page.click('#cx-seat-b').catch(() => {}); await sleep(300);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check('on a phone the chip and the seat panel fit the page', wide <= 376 && await page.locator('#cx-seat').count() === 1, wide);
  await page.screenshot({ path: path.join(OUT, 'province-links-phone.png'), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 }); await sleep(300);

  /* the new achievements, as the game reads them */
  const pid = a0.id;
  check('no full council yet', await achV('prv-council1') === 0);
  await page.evaluate(id => { const P = window.__game.PRVC(); P.prvAppoint(id, '0', 0); P.prvAppoint(id, '1', 0); P.prvAppoint(id, '2', 1); }, pid); await sleep(300);
  check('three councillors seated make a full council', await achV('prv-council1') === 1 && await achV('prv-council5') === 1);
  await page.evaluate(id => { const P = window.__game.PRVC(); P.prvSetAut(id, 3); }, pid); await sleep(300);
  const at = await page.evaluate(id => window.__game.S.nation.prov.l.find(q => q.id === id).at, pid);
  check('Home Rule stamps the date, and counts from it', at > Date.now() - 60e3 && await achV('prv-home') === 0, at);
  await edit((n, now) => { n.prov.l.find(q => q.a === 3).at = now - 8 * 864e5; }); await sleep(300);
  check('a week of Home Rule earns it', await achV('prv-home') === 7);
  const keep = await page.evaluate(() => { const G = window.__game; return G.normalize(JSON.parse(JSON.stringify(G.S.nation))).prov.l.find(q => q.a === 3).at; });
  check('the date survives a reload of the record', keep > 0);
  const big = await achV('prv-pop1'), pops = await page.evaluate(() => { const G = window.__game, M = G.PRVC().prvMine(); return M.N.prov.map(p => p.pop || 0); });
  check('the populous-province figure is the largest division', Math.abs(big - Math.max(...pops)) < 1e-9 && big > 0, big + ' vs ' + pops.join(','));
  check('no island province on one landmass', await achV('prv-isle') === 0);
  check('Devoted Federation needs five provinces', await achV('prv-devoted') === 0);

  /* provinces off again: the Cities page forgets them */
  await page.evaluate(() => window.__game.SL.prvSwitch(false)); await go('cities');
  check('switched off again, chip and column go', await page.locator('.city-tags .cx-prv').count() === 0 && await page.locator('#cx-ovw th.cx-ov-prv').count() === 0);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('FAIL', e && e.stack || e); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

