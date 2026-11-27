// City sites (2026-11-27, from a player's request): the three suggested sites are numbered on the Cities page and pinned
// on the map, each card can show its site on the map, and a free hex of your land says in the map panel what a city
// there would work, what that land yields (the nation's already), what its first buildings would add and how the hex
// ranks; the land it would work is shaded on the map. The figures are checked against the city once it is founded:
// the same hexes, the same reach, and a Sawmill there making what the card said.
//   python3 build.py
//   node test/city-sites.mjs
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
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = Object.assign(window.__game || {}, g); }; });
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
/* what the game predicts for a hex: the hexes, reach and gains */
const predict = c => page.evaluate(c => { const X = window.__game.CSITE(), T = X.territory(), sc = X.siteCity(c, T); return { dist: [...sc.dist].sort((a, b) => a - b), r: sc.r, pop: sc.pop, more: sc.more, gains: X.siteGains(sc.dist, window.__game.S.nation) }; }, c);
const sites = () => page.evaluate(() => { const X = window.__game.CSITE(); return X.citySites(X.territory()); });
/* the city standing on a hex, as cityState has it */
const actual = c => page.evaluate(c => { const X = window.__game.CSITE(), ct = X.cityState(X.territory()).byCell.get(c); return ct ? { dist: [...ct.dist].sort((a, b) => a - b), r: ct.radius, pop: ct.population, out: ct.buildOutput, mk: ct.mk } : null; }, c);

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Sitemark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || (window.__game.S.nation.loc != null)), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});
  /* land up to 7 hexes round the capital, people enough for several cities, and materials to found them */
  await edit((n, now, G) => {
    const M = G.MAP, T = G.CSITE().territory(), mi = T.list.findIndex(x => x.me), cap = T.list[mi].cap, d = 864e5, dist = new Map([[cap, 0]]), q = [cap];
    while (q.length) { const c = q.shift(), k = dist.get(c); if (k >= 7) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb < 0 || dist.has(nb) || M.T[nb] < 2) continue; if (T.owner[nb] >= 0 && T.owner[nb] !== mi) continue; dist.set(nb, k + 1); q.push(nb); } }
    const have = new Set((n.claims || []).map(e => e.c));
    n.claims = (n.claims || []).concat([...dist.keys()].filter(c => !have.has(c) && c !== cap).map((c, i) => ({ c, t: now - d + i })));
    n.pop = 30; n.popAt = now; n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now;
  });
  await sleep(500);
  const S0 = await sites();
  check('three suggested sites on the larger land', S0.length === 3, JSON.stringify(S0));

  /* ── the Cities page: numbered cards, what buildings would add, Show on the map ── */
  await go('cities');
  await page.click('[data-act="cx-sel"][data-id="new"]'); await sleep(300);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#city-form .site-w')].map(w => ({ k: w.querySelector('.site-k')?.textContent, c: +w.querySelector('.site').dataset.c, txt: w.querySelector('.site').textContent.replace(/\s+/g, ' ').trim(), g: w.querySelector('.site-g')?.textContent || '', map: !!w.querySelector('[data-act="ct-site-map"]') })));
  check('the cards are numbered 1 to 3, in the order of the suggestions', cards.length === 3 && cards.map(x => x.k).join() === '1,2,3' && cards.every((x, i) => x.c === S0[i]), JSON.stringify(cards.map(x => [x.k, x.c])));
  check('each card says how much land the city would work', cards.every(x => /\d+ hex(es)? of land to work/.test(x.txt)), cards[0]?.txt);
  check('each card has a Show on the map link', cards.every(x => x.map));
  const P1 = await predict(S0[0]);
  check('the first card names the buildings and what they would add', /^Buildings would add \+[\d.]+ (food|timber|iron|oil) \(/.test(cards[0].g) && P1.gains.every(q => cards[0].g.includes(q.n)), cards[0].g);
  check('the cards no longer pass the land’s own yield off as the city’s', !cards.some(x => /\d (food|timber|iron)(,| and) .* a day$/.test(x.txt.replace(/Buildings would add.*$/, '').trim())), cards[0]?.txt);
  check('the page says the land’s yield is the nation’s already', /yields to your nation already/.test(await txt('#city-form .muted')));
  await page.locator('#city-form').screenshot({ path: path.join(OUT, 'city-sites-cards.png') });

  /* ── Show on the map: centred, selected, the panel's figures ── */
  await page.click(`#city-form .site-w:nth-child(2) [data-act="ct-site-map"]`);
  await until(() => page.evaluate(() => window.__game.S.view === 'map'));
  await sleep(600);
  check('Show on the map opens the map on that hex, selected', await page.evaluate(c => window.__game.S.mapCell === c, S0[1]));
  const panel = await txt('#map-panel');
  check('the panel says what a city there would work', /As a city\s*Works \d+ hex(es)? of your land/.test(panel), panel?.slice(0, 300));
  check('the panel says the land’s yield is the nation’s already', /which your nation has already/.test(panel) || /Its land yields\s*Little/.test(panel));
  check('the panel says what its buildings would add', /Buildings would add\s*\S/.test(panel));
  check('the panel ranks it as suggested site 2', /Ranks\s*Suggested site 2 · (the best|\d+(st|nd|rd|th) best) of the \d+ hexes where a city could stand/.test(panel), panel?.match(/Ranks[^.]*/)?.[0]);
  check('the panel explains the shaded land', /The shaded hexes on the map are the land it would work/.test(panel));
  check('the panel still offers to found a city here', await page.locator('#mc-form').count() === 1);
  await page.locator('#map-panel').screenshot({ path: path.join(OUT, 'city-sites-panel.png') });
  /* a closer look at the pins and the shaded land, light and dark */
  await page.evaluate(() => { const G = window.__game, v = G.S.mapViews.main; v.z = Math.max(v.z, 16); G.MTP().redrawMaps(); }); await sleep(700);
  const cv = page.locator('canvas.map-cv[data-map="main"]');
  await cv.scrollIntoViewIfNeeded(); await cv.screenshot({ path: path.join(OUT, 'city-sites-zoom.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await sleep(500); await page.evaluate(() => window.__game.MTP().redrawMaps()); await sleep(600);
  await cv.screenshot({ path: path.join(OUT, 'city-sites-zoom-dark.png') }); await page.emulateMedia({ colorScheme: 'light' }); await sleep(300);

  /* the nation's own panel lists the three sites; each selects its hex */
  await page.click('#map-panel [data-act="map-desel"]'); await sleep(300);
  const box = await page.evaluate(() => [...document.querySelectorAll('#map-panel .site-pins [data-act="ct-site-map"]')].map(b => +b.dataset.c));
  check('your territory’s panel lists the three suggested sites', box.join() === S0.join(), JSON.stringify(box));
  await page.click('#map-panel .site-pins li:nth-child(3) [data-act="ct-site-map"]'); await sleep(400);
  check('a site in that list selects its hex', await page.evaluate(c => window.__game.S.mapCell === c, S0[2]));

  /* a hex too close to the capital keeps the short Nearby line */
  const near = await page.evaluate(() => { const X = window.__game.CSITE(), T = X.territory(), mi = T.list.findIndex(x => x.me), cap = T.list[mi].cap, M = window.__game.MAP; for (let d = 0; d < 6; d++) { const c = M.nbr[cap * 6 + d]; if (c >= 0 && T.owner[c] === mi && M.T[c] >= 2) return c; } return -1; });
  await page.evaluate(c => { const G = window.__game; G.S.mapCell = c; G.render(); }, near); await sleep(300);
  const pn = await txt('#map-panel');
  check('a hex too close to a city shows Nearby, not a city’s figures', /Nearby/.test(pn) && !/As a city/.test(pn), pn?.slice(0, 200));
  /* a free hex that is not suggested still ranks, without "Suggested site" */
  const other = await page.evaluate(() => { const X = window.__game.CSITE(), T = X.territory(), sp = X.siteSpots(T), s3 = X.citySites(T); return sp.find(c => !s3.includes(c)); });
  await page.evaluate(c => { const G = window.__game; G.S.mapCell = c; G.render(); }, other); await sleep(300);
  const po = await txt('#map-panel');
  check('any free hex ranks among those where a city could stand', /Ranks\s*(The best|\d+(st|nd|rd|th) best) of the \d+ hexes/.test(po) && !/Suggested site/.test(po), po?.match(/Ranks[^.]*/)?.[0]);
  /* a chosen site that is not one of the three (the page remembers its own choice when you come back to it) shows as a
     card of its own, selected, so the form never founds a city on a hex it does not show */
  await go('cities'); await page.click('[data-act="cx-sel"][data-id="new"]').catch(() => {}); await sleep(300);
  await page.evaluate(c => { const G = window.__game; G.S.citySite = c; G.render(); }, other); await sleep(300);
  const own = await page.evaluate(() => { const w = [...document.querySelectorAll('#city-form .site-w')]; const last = w[w.length - 1]; return { n: w.length, own: !!last?.querySelector('.site-k-own'), on: last?.querySelector('.site')?.classList.contains('on'), c: +last?.querySelector('.site')?.dataset.c }; });
  check('a chosen site that is not suggested is a fourth card, selected', own.n === 4 && own.own && own.on && own.c === other, JSON.stringify(own));

  /* ── the figures hold once the city stands: same hexes, same reach, and a Sawmill making what the card said ── */
  await page.click(`#city-form .site[data-c="${S0[0]}"]`); await sleep(200);
  const P = await predict(S0[0]);
  await page.fill('#city-name', 'Firstsite'); await page.click('#city-form button[type="submit"]');
  await until(() => page.evaluate(c => (window.__game.S.nation.cities || []).some(x => x.c === c), S0[0]));
  await sleep(400);
  let A = await actual(S0[0]);
  check('the city works the hexes predicted', A && JSON.stringify(A.dist) === JSON.stringify(P.dist), JSON.stringify({ p: P.dist.length, a: A?.dist.length }));
  check('with the reach predicted', A && A.r === P.r, JSON.stringify({ p: P.r, a: A?.r, pp: P.pop, ap: A?.pop }));
  check('and about the residents predicted', A && Math.abs(A.pop - P.pop) <= Math.max(0.02, P.pop * 0.03), JSON.stringify({ p: P.pop, a: A?.pop }));
  await edit((n, now) => { const c = n.cities.find(x => x.nm === 'Firstsite'); c.b = [{ k: 'sawmill', s: now - 3e5, d: now - 1e5, p: { food: 12, goods: 8 } }]; });
  await sleep(300); A = await actual(S0[0]);
  const saw = P.gains.find(q => q.k === 'sawmill');
  check('its Sawmill makes the timber the card said', saw && A && Math.abs(A.out.timber - saw.v * A.mk) < 0.01 && A.mk === 1, JSON.stringify({ said: saw?.v, makes: A?.out?.timber, mk: A?.mk }));

  /* a big nation's new city starts with the three-hex reach, as predicted */
  await edit((n, now) => { n.pop = 900; n.popAt = now; n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; });
  await sleep(300);
  const S1 = await sites();
  const P3 = S1.length ? await predict(S1[0]) : null;
  check('a big nation’s new city is predicted to start with the three-hex reach', P3 && P3.r === 3, JSON.stringify(P3 && { r: P3.r, pop: P3.pop }));
  if (P3) {
    await page.evaluate(c => { const G = window.__game; G.S.citySite = c; G.S.cityName = 'Bigsite'; G.render(); }, S1[0]);
    await go('cities'); await page.click('[data-act="cx-sel"][data-id="new"]').catch(() => {}); await sleep(300);
    await page.click(`#city-form .site[data-c="${S1[0]}"]`); await sleep(200);
    await page.fill('#city-name', 'Bigsite'); await page.click('#city-form button[type="submit"]');
    await until(() => page.evaluate(c => (window.__game.S.nation.cities || []).some(x => x.c === c), S1[0]));
    await sleep(400);
    const B = await actual(S1[0]);
    check('and it does, on the hexes predicted', B && B.r === P3.r && JSON.stringify(B.dist) === JSON.stringify(P3.dist), JSON.stringify({ p: [P3.r, P3.dist.length], a: B && [B.r, B.dist.length] }));
  }
  /* the shaded land is drawn on the main map without errors, at every zoom the panel opens at */
  await page.evaluate(c => { const G = window.__game; location.hash = '#map'; G.S.mapCell = c; }, other); await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'city-sites-shade.png') });
  check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.log('FAIL', e.stack || e.message); failed++; await page.screenshot({ path: path.join(OUT, 'city-sites-error.png'), fullPage: true }).catch(() => {}); }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
