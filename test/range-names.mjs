// Mountain ranges named by players, and the Daily Dispatch using the names on the map. Checked here: the map writes a
// range's own name over it; clicking a mountain hex of a range the nation holds a hex of shows its name and offers to
// rename it; another range's name and a river's are refused; a field being typed in survives the panel being drawn
// again; the new name is saved in the record and shown in the panel, the hover tip, the history, place names and on
// the map; the Dispatch reports it, and writes a discovery under the name its finder gave it (not the site's old one);
// bringing back the map's name leaves no line in the history; the name goes with the land and comes back with it; a
// range the nation holds no hex of says how naming works; and the field fits a phone.
//   python3 build.py
//   node test/range-names.mjs
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
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });
/* the names written on the map in spaced capitals (a range's), as drawn */
await page.addInitScript(() => {
  window.__mr = []; const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (/^600 /.test(this.font) && parseFloat(this.letterSpacing) > 0 && String(t).length > 1) window.__mr.push(String(t)); return f.call(this, t, ...a); };
});

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const moveCap = c => edit((n, now, G, c) => { const M = G.MAP, cap = n.cities.find(x => x.c === M.COLS * n.loc.r + n.loc.c) || n.cities[0]; n.loc = { ...n.loc, c: c % M.COLS, r: Math.floor(c / M.COLS) }; cap.c = c; n.cities = [cap]; n.claims = []; }, c);
const select = async c => { await page.evaluate(c => { const G = window.__game; G.S.mapInspect = c; G.S.mapCell = null; G.S.mapSel = null; G.S.mapClaim = null; G.render(); }, c); await sleep(250); };
const showCell = async (c, z = 5) => {
  await page.evaluate(([c, z]) => { const G = window.__game; G.MD.centerMain(c, z); G.render(); }, [c, z]);
  const cv = page.locator('canvas[data-map="main"]'); await cv.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pos = await page.evaluate(c => { const G = window.__game, cv = document.querySelector('canvas[data-map="main"]'), v = G.MD.viewOf('main', cv), s = G.MD.mapScale(cv, v); return { x: cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, c);
  return { cv, pos };
};
const clickCell = async c => { const { cv, pos } = await showCell(c); await cv.click({ position: pos }); await sleep(300); };
/* the main map around hex c (hx: a hex's width in pixels), and the range names written on it */
const drawnAt = (c, hx, want) => page.evaluate(async ([c, hx, want]) => {
  const G = window.__game, K = G.MRN(), M = G.MAP, cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0], base = Math.min(cv.clientWidth / M.W, cv.clientHeight / M.H);
  G.S.mapViews.main = { z: hx / K.HEX_W / base, cx: M.cx[c], cy: M.cy[c] }; G.S.mapInspect = null; G.S.mapCell = null; window.__mr = []; scrollTo(0, 0); G.render();
  for (let k = 0; k < 40 && !window.__mr.includes(want); k++) await new Promise(r => setTimeout(r, 100));
  return [...new Set(window.__mr)];
}, [c, hx, want]);
const shot = async name => {
  await page.evaluate(() => { const cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0]; cv.scrollIntoView({ block: 'center' }); });
  await sleep(500); let big = null, bw = 0; for (const h of await page.locator('canvas.map-cv').all()) { const b = await h.boundingBox(); if (b && b.width > bw) { bw = b.width; big = h; } }
  if (big) await big.screenshot({ path: path.join(OUT, name) });
};
const nameAt = c => page.evaluate(c => { const K = window.__game.MRN(), a = K.mrAt(K.territory(), c); return a ? a.nm : null; }, c);
const caps = s => s.replace(/^the\s+/i, '').toUpperCase();
/* every story of today's Dispatch, headline and body */
const paper = () => page.evaluate(() => { const K = window.__game.MRN(), E = K.dspEdition(K.dspNoOf(Date.now()), Date.now()); return E.all.map(s => s.h + ' | ' + s.b); });

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Highcrag');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});
  await page.evaluate(() => window.__game.WTN().rvData());
  check('the river network is made', await until(() => page.evaluate(() => !!window.__game.WTN().RV), 20000));

  const map = await page.evaluate(() => {
    const K = window.__game.MRN(), G = K.mrMap();
    return { n: G.list.length, named: G.list.filter(R => R.name0).length, min: K.MR_MIN, small: G.list.filter(R => R.n < K.MR_MIN).every(R => !R.name0), names: new Set(G.list.filter(R => R.name0).map(R => R.name0)).size };
  });
  check('the map has its mountain ranges, every one of six hexes or more named once', map.n > 5 && map.named > 3 && map.small && map.names === map.named, JSON.stringify(map));
  console.log(`     ${map.n} ranges, ${map.named} named by the map`);

  /* a big range, and a lowland hex beside it well away from other capitals: the capital moves there */
  const spot = await page.evaluate(() => {
    const G = window.__game, K = G.MRN(), W = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me), L = K.mrMap().list;
    const far = c => T.list.every((y, j) => j === mi || W.hexDist(c, y.cap) > 14);
    for (const R of L.filter(R => R.n >= 40).sort((a, b) => b.n - a.n)) for (const c0 of R.cells) for (let d = 0; d < 6; d++) {
      const c = M.nbr[c0 * 6 + d]; if (c < 0 || M.T[c] < 2 || M.T[c] > 3 || (T.owner[c] >= 0 && T.owner[c] !== mi) || !far(c)) continue;
      return { cap: c, id: R.id, n: R.n, name0: R.name0, peak: c0 };
    }
    return null;
  });
  check('a lowland hex beside a big range is found', !!spot, JSON.stringify(spot));
  if (!spot) throw new Error('no spot');
  await moveCap(spot.cap);
  const held = await page.evaluate(id => { const K = window.__game.MRN(), T = K.territory(), mi = T.list.findIndex(x => x.me); const m = K.mrHeld(T).get(id); return { k: (m && m.get(mi)) || 0, mine: K.mrMap().list[id].cells.filter(c => T.owner[c] === mi) }; }, spot.id);
  check('the nation\'s land takes in a hex of the range', held.k > 0, JSON.stringify(held));
  if (!held.k) throw new Error('no mountain held');
  const hex = held.mine[0];
  const other = await page.evaluate(id => window.__game.MRN().mrMap().list.find(R => R.id !== id && R.name0).name0, spot.id);
  const river = await page.evaluate(() => { const r = window.__game.WTN().RV.list.find(r => r.name0); return r ? r.name0 : null; });
  await go('map');

  /* the map's own name over the range */
  let drawn = await drawnAt(hex, 9, caps(spot.name0));
  check('the map writes the range\'s own name over it', drawn.includes(caps(spot.name0)), JSON.stringify(drawn));
  check('and the place names use it', await page.evaluate(c => window.__game.MRN().placePhrase(c), hex) === 'in ' + spot.name0);

  await clickCell(hex);
  check('clicking the mountains shows a panel for the range', await page.locator('#map-panel .mr-pn').count() === 1, await txt('#map-panel'));
  check('which names it', (await txt('#map-panel .mr-pn .eyebrow')) === 'Mountain range' && (await txt('#map-panel .mr-l')) === `${spot.name0.replace(/^the/, 'The')} · ${spot.n} hexes of mountains.`, await txt('#map-panel .mr-pn'));
  const own = await txt('#map-panel .mr-own');
  check('and says the nation may name it, and how much of it it holds', !!own && own.startsWith(`You hold ${held.k} of its ${spot.n} hexes, so you may name it.`), own);
  check('with a button to rename it', (await txt('#map-panel [data-act="mr-edit"]')) === 'Rename the range');
  await page.click('#map-panel [data-act="mr-edit"]');
  check('the button opens a name field, focused, with the range\'s name', await until(() => page.evaluate(n => { const i = document.getElementById('mr-name'); return !!i && document.activeElement === i && i.value === n; }, spot.name0)));
  check('the field says where the name goes', ((await txt('#mr-form .hint')) || '').includes('The name goes on every map in') && ((await txt('#mr-form .hint')) || '').includes('Daily Dispatch'));

  /* names taken are refused */
  await page.fill('#mr-name', other); await page.click('#mr-form button[type="submit"]'); await sleep(250);
  let err = await txt('#mr-form .err');
  check('another range\'s name is refused', !!err && err.includes('is a mountain range in') && err.includes('already'), err);
  if (river) {
    await page.fill('#mr-name', river); await page.click('#mr-form button[type="submit"]'); await sleep(250);
    err = await txt('#mr-form .err');
    check('a river\'s name is refused', !!err && err.includes('There is already a river called'), err);
  }
  check('and nothing is saved', await page.evaluate(() => !window.__game.S.nation.mrn));
  /* typing survives the panel being drawn again */
  await page.fill('#mr-name', ''); await page.type('#mr-name', 'The Grey Sp');
  await page.evaluate(() => window.__game.MRN().updateMapPanel());
  check('a half-typed name keeps its focus and its text when the panel is drawn again', await page.evaluate(() => { const i = document.getElementById('mr-name'); return !!i && document.activeElement === i && i.value === 'The Grey Sp' && i.selectionStart === 11; }));
  await page.type('#mr-name', 'ine');
  await page.click('#mr-form button[type="submit"]'); await sleep(300);

  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation.mrn || null)));
  check('the name is saved in the nation\'s record', Array.isArray(saved) && saved.length === 1 && saved[0].c === hex && saved[0].n === 'the Grey Spine', JSON.stringify(saved));
  check('the panel shows the new name', (await txt('#map-panel .mr-l b')) === 'The Grey Spine' && (await txt('#map-panel .mr-by')) === 'Named by you.', await txt('#map-panel .mr-pn'));
  check('and the map\'s own name as an old one', ((await txt('#map-panel .mr-aka')) || '') === `Also called ${spot.name0} on the old maps.`, await txt('#map-panel .mr-aka'));
  check('every hex of the range carries it', await page.evaluate(id => { const K = window.__game.MRN(), T = K.territory(); return K.mrMap().list[id].cells.every(c => K.mrAt(T, c).nm === 'the Grey Spine'); }, spot.id));
  const line = await page.evaluate(() => { const G = window.__game, n = G.S.nation, l = n.log.find(l => l.k === 'mrren'); return l ? G.MRN().logLine(l, n, G.S.uid) : null; });
  check('the history has a line for it', line === `${spot.name0.replace(/^the/, 'The')} was renamed the Grey Spine.`, line);
  check('place names use the new name', await page.evaluate(c => window.__game.MRN().placePhrase(c), spot.peak) === 'in the Grey Spine');
  {
    const { cv, pos } = await showCell(hex), box = await cv.boundingBox();
    await page.mouse.move(box.x + pos.x, box.y + pos.y); await sleep(150); await page.mouse.move(box.x + pos.x + 1, box.y + pos.y);
    const tip = await until(async () => { const t = await txt('.map-tip'); return t && t.includes('The Grey Spine') ? t : null; }, 3000);
    check('a hover over the mountains speaks of the name', !!tip, await txt('.map-tip'));
  }
  drawn = await drawnAt(hex, 9, 'GREY SPINE');
  check('the map writes the new name over the range', drawn.includes('GREY SPINE') && !drawn.includes(caps(spot.name0)), JSON.stringify(drawn));
  await shot('range-names-map.png');

  /* the Dispatch */
  let st = await paper();
  check('the Daily Dispatch reports the new name', st.some(s => s.includes('the Grey Spine')), JSON.stringify(st.slice(0, 12)));

  /* a discovery named by its finder: the Dispatch uses the finder's name, not the site's old one (Guatapanal, 27 Nov) */
  const site = await page.evaluate(() => { const K = window.__game.MRN(), i = K.SITES.findIndex(s => s.k === 'peak'); return i >= 0 ? { si: i, def: K.siteDefault(i) } : null; });
  check('the map has an unclimbed peak', !!site);
  if (site) {
    await edit((n, now, G, si) => { const K = G.MRN(); n.disc = (n.disc || []).concat({ s: si, o: 'found', f: 1, t: now, r: 15, m: 0 }); n.log.unshift({ t: now, k: 'disc', a: String(si), fx: K.siteDefault(si) }); }, site.si);
    await edit((n, now, G, si) => { n.disc.find(e => e.s === si).nm = 'Mount Josefina'; }, site.si);
    check('the site is called by its finder\'s name', await page.evaluate(si => window.__game.MRN().siteName(si), site.si) === 'Mount Josefina');
    st = await paper();
    const story = st.find(s => s.includes('explorers') || s.includes('Discovery') || s.includes('discovered'));
    check('the Dispatch writes the discovery under the name its finder gave it', st.some(s => s.includes('Mount Josefina')) && !st.some(s => s.includes(site.def)), JSON.stringify(story || st.slice(0, 12)));
  }

  /* bringing back the map's name leaves no line */
  await go('map'); await select(hex);
  await page.click('#map-panel [data-act="mr-edit"]'); await sleep(200);
  check('the field holds the present name, and offers the map\'s back', await page.evaluate(() => document.getElementById('mr-name').value === 'the Grey Spine') && (await txt('#map-panel [data-act="mr-reset"]')) === `Bring back ${spot.name0}`);
  await page.click('#map-panel [data-act="mr-reset"]'); await sleep(300);
  check('the map\'s name is back', (await nameAt(hex)) === spot.name0 && await page.evaluate(() => !window.__game.S.nation.mrn));
  check('and the history has no line for it', await page.evaluate(() => !window.__game.S.nation.log.some(l => l.k === 'mrren')));

  /* names follow the land */
  await go('map'); await select(hex);
  await page.click('#map-panel [data-act="mr-edit"]'); await sleep(200);
  await page.fill('#mr-name', 'the Grey Spine'); await page.click('#mr-form button[type="submit"]'); await sleep(300);
  check('named again', (await nameAt(hex)) === 'the Grey Spine');
  const away = await page.evaluate(() => {
    const G = window.__game, K = G.MRN(), W = G.WTN(), M = G.MAP, T = K.territory(), mi = T.list.findIndex(x => x.me);
    const mts = []; for (let c = 0; c < M.N; c++) if (M.T[c] === 4) mts.push(c);
    const q = mts.slice(), dd = new Map(mts.map(c => [c, 0]));
    for (let h = 0; h < q.length; h++) { const a = q[h], v = dd.get(a); if (v >= 6) continue; for (let k = 0; k < 6; k++) { const j = M.nbr[a * 6 + k]; if (j >= 0 && !dd.has(j)) { dd.set(j, v + 1); q.push(j); } } }
    for (let c = 0; c < M.N; c++) if (!dd.has(c) && M.T[c] >= 2 && M.T[c] <= 3 && T.owner[c] < 0 && T.list.every((y, j) => j === mi || W.hexDist(c, y.cap) > 14)) return c;
    return null;
  });
  if (away == null) console.log('     (no hex six hexes from any mountain: names following the land are not checked this run)');
  else {
    await moveCap(away);
    check('the range\'s hexes gone, the name goes', (await nameAt(hex)) === spot.name0);
    check('the name stays in the record', await page.evaluate(() => (window.__game.S.nation.mrn || []).length === 1));
    await go('map'); await select(hex);
    check('and the panel says how naming works', (await txt('#map-panel .mr-why')) === 'To name this range, hold a hex of it.', await txt('#map-panel .mr-pn'));
    check('with nothing to press', await page.locator('#map-panel [data-act="mr-edit"]').count() === 0);
    await moveCap(spot.cap);
    check('the land back, the name is back with it', (await nameAt(hex)) === 'the Grey Spine');
  }

  /* on a phone the panel's field fits */
  await page.setViewportSize({ width: 390, height: 844 });
  await go('map'); await select(hex);
  if (await page.locator('#map-panel .mp-grab[aria-expanded="false"]').count()) { await page.click('#map-panel .mp-grab'); await sleep(400); }
  await page.click('#map-panel [data-act="mr-edit"]'); await sleep(300);
  const fits = await page.evaluate(() => { const f = document.getElementById('mr-form'); if (!f) return 'no form'; const b = f.getBoundingClientRect(); return b.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1 ? true : `${b.right} > ${innerWidth}`; });
  check('on a phone the name field fits the screen', fits === true, fits);
  await page.evaluate(() => document.getElementById('mr-form') && document.getElementById('mr-form').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'range-names-phone.png') });
  await page.click('#map-panel [data-act="mr-cancel"]').catch(() => {});
  await page.setViewportSize({ width: 1280, height: 900 });

  check('no page errors', !errors.length, errors.join(' | '));
} catch (e) {
  console.log('FAIL', e.stack || e.message); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
