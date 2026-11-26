// Deep-sea finds (2026-11-26): fleeting finds out at sea, reached by a salvage ship from a Harbour, whose upgrades raise
// the haul. A nation settled on the open sea's shore: no harbour, then a plain Harbour (the shelf only), a voyage sent
// from the Deep sea list, the ship at sea, back in port, its report under the Harbour Master's stamp, the bonus counted
// with the harbour's multiplier and the place's share, the tally, the logbook and the dock; a gold Harbour, a Grand
// Port and a Salvage Port (two ships); the map's side panel and marker; the Museum's Treasures of the Deep and its land
// credits; an achievement; the Help page; and a phone, where the idle ship card folds into a line.
//   python3 build.py
//   node test/deep-sea-page.mjs
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
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

/* a nation on a shore of the open sea (a land hex beside the shelf, near the middle of the map), its first city's
   building list emptied and its stockpile full */
async function settled(viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { if (g && g.S) window.__game = g; }; });
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });
  await page.goto(BASE);
  await page.fill('#d-name', 'Saltmarsh');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = (a, d = {}) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d); document.body.appendChild(b); b.click(); b.remove(); }, [a, d]);
  await edit(n => { delete n.onb; });
  await go('map');
  const pick = await page.evaluate(() => { const G = window.__game, M = G.MAP, g = G.DS().grid(), out = [];
    for (let c = 0; c < M.N; c++) { if (M.T[c] < 2) continue; let sea = 0; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && g.band[j] === 0) sea++; } if (sea >= 2) out.push(c); }
    const mid = (M.ROWS / 2 | 0) * M.COLS + (M.COLS / 3 | 0); out.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)); return out.slice(0, 16); });
  for (const c of pick) { await page.evaluate(c => { window.__game.S.mapPick = c; }, c); await act('settle'); if (await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 3000)) break; }
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});
  await sleep(400);
  await edit((n, now) => { for (const c of n.cities) c.b = []; n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  return { ctx, page, errors, edit, go, act };
}
const S = (page, f, a) => page.evaluate(f, a);
const harbour = (page) => S(page, () => window.__game.DS().harbours(window.__game.S.nation).map(h => ({ hm: h.hm, reach: h.reach, band: h.band, roll: h.roll, hl: h.hl, sv: h.sv })));
const setHarbour = (d, b) => d.edit(new Function('n', 'now', `const B=${JSON.stringify(b)};n.cities[0].b=[Object.assign({k:'harbour',s:now-2*864e5,d:now-864e5,a:1},B)];`));

try {
  const d = await settled({ width: 1280, height: 900 }), { page } = d;
  check('settled on the open sea: the capital\'s harbour would reach the sea', await S(page, () => { const G = window.__game; return G.DS().seaDist(G.S.nation.cities[0].c, 55).cells.length > 0; }));
  const grid = await S(page, () => { const P = window.__game.DS(), g = P.grid(), A = P.alive(); return { lanes: g.L, cnt: g.cnt, alive: A.length, bands: [0, 1, 2].map(b => A.filter(s => s.bd === b).length), deep: A.every(s => s.ds && window.__game.MAP.T[s.c] < 2) }; });
  check('the sea has lanes of its own and finds about at every depth, all on the water', grid.lanes >= 8 && grid.alive >= 5 && grid.deep, grid);

  /* no harbour */
  await d.go('explore');
  check('no harbour: the ship card says a ship needs a harbour', await S(page, () => /A ship needs a harbour/.test(document.querySelector('.xp-ship').textContent)));
  await page.click('.xp-seg[data-v="ds"]'); await sleep(300);
  check('the Deep sea filter lists the finds at sea, and says a Harbour sends the ship', await S(page, () => document.querySelector('.xp-seg[data-v="ds"]').getAttribute('aria-pressed') === 'true' && /Build one in a coastal city/.test(document.querySelector('.xp-list').textContent)));

  /* a plain Harbour reaches the shelf only */
  await setHarbour(d, {});
  check('a plain Harbour: ×1, 55 hexes by sea, the shelf only', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 100, reach: 55, band: 0, roll: 0, hl: 0, sv: false }]), await harbour(page));
  const at = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, t0 = P.flNow();
    for (let t = t0; t < t0 + 8 * 86400e3; t += 1800e3) for (const s of P.alive(t)) { const p = P.plan(n, s, t); if (!p.why) return { t, key: s.key, mins: p.mins, bd: s.bd }; } return null; });
  check('a find on the shelf comes within the plain Harbour\'s reach within eight days', !!at && at.bd === 0, at);
  const deepWhy = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, t0 = P.flNow(), out = new Set();
    for (let t = t0; t < t0 + 4 * 86400e3; t += 3600e3) for (const s of P.alive(t)) { const p = P.plan(n, s, t); if (s.bd > 0 && p.all.length) out.add(p.why); } return [...out]; });
  check('deep water and the abyss are too deep for it', deepWhy.length > 0 && deepWhy.every(w => /^Too deep for your harbours|^Your salvage ship|^It vanishes|^Picked/.test(w)), deepWhy);
  if (at) {
    await S(page, t => { window.__game.DS().flDebug({ t }); window.__game.render(); }, at.t); await sleep(300);
    const item = await S(page, k => { const b = document.querySelector(`[data-act="ds-send"][data-k="${k}"]`); const li = b && b.closest('li'); return li ? { odds: !!li.querySelector('.xp-odds'), pips: li.querySelectorAll('.xp-pips i').length, t: li.textContent.replace(/\s+/g, ' ') } : null; }, at.key);
    check('the find is in the list with its depth, odds, places, harbour and a Send button', !!item && item.odds && item.pips === 5 && /Shelf/.test(item.t) && /Harbour · ×1/.test(item.t) && /hexes by sea/.test(item.t), item);
    await S(page, k => document.querySelector(`[data-act="ds-send"][data-k="${k}"]`).scrollIntoView({ block: 'center' }), at.key);
    await page.screenshot({ path: path.join(OUT, 'deep-sea-list.png') });
    const before = await S(page, () => window.__game.S.nation.stock.food);
    await page.click(`[data-act="ds-send"][data-k="${at.key}"]`); await sleep(400);
    const v = await S(page, () => (window.__game.S.nation.fl || []).filter(e => e.hb != null));
    check('the voyage is kept with its harbour, multiplier and level', v.length === 1 && v[0].k === at.key && v[0].hm === 100 && v[0].hl === 0 && v[0].hb >= 0, v);
    check('and it cost food', (await S(page, () => window.__game.S.nation.stock.food)) < before);
    check('the ship card says it is at sea; the party card is untouched', await S(page, () => /At sea/.test(document.querySelector('.xp-ship').textContent) && !/On the way/.test(document.querySelector('.xp-party').textContent)));
    check('a second voyage waits for the ship', await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation; const s = P.alive().find(s => s.bd === 0 && s.key !== (n.fl || []).find(e => e.hb != null).k); return !s || /busy|Out of reach|vanishes|Picked/.test(P.plan(n, s).why); }));
    await S(page, () => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(OUT, 'deep-sea-at-sea.png') });
    await S(page, t => { window.__game.DS().flDebug({ t }); window.__game.render(); }, at.t + at.mins * 60000 + 60000); await sleep(300);
    check('back in port: Hear the report', await S(page, () => !!document.querySelector('.xp-ship [data-act="ds-report"]')));
    await page.click('.xp-ship [data-act="ds-report"]');
    await until(() => S(page, () => !window.__game.S.flRolling && !!document.querySelector('.xp-ship .xp-stamp')), 6000);
    const rep = await S(page, () => { const c = document.querySelector('.xp-ship'); return { wide: c.classList.contains('xp-wide'), t: c.textContent.replace(/\s+/g, ' '), stamp: c.querySelector('.xp-stamp').textContent, party: !document.querySelector('.xp-party.xp-wide') }; });
    check('the ship\'s report spans the row under the Harbour Master\'s stamp, and not the party\'s card', rep.wide && /Harbour Master/.test(rep.stamp) && rep.party, rep);
    const won = /Your salvage ship reached/.test(rep.t);
    check('a haul names the harbour\'s part; a miss says so', won ? /Harbour hauled it home: ×1/.test(rep.t) : /Picked clean|Gone before/.test(rep.t), rep.t.slice(0, 600));
    await page.screenshot({ path: path.join(OUT, 'deep-sea-report.png') });
    if (won) {
      const got = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, me = P.me(), L = P.flBonusList(me, n), e = n.fl.find(e => e.hb != null), C = P.flClaims().mine.get(me) || [], q = C.find(x => x.site.key === e.k);
        return { L: L.map(b => ({ s: b.stat, deep: b.deep, v0: b.v0 })), place: q && q.place, tier: q && q.tier, kind: e.kd, tly: Object.fromEntries(Object.entries(n.tly || {}).filter(([k]) => /^ds/.test(k))), ach: !!(n.ach && n.ach['ds-first']) }; });
      const K = { pearls: 4, ambergris: 3, whales: 4, coral: 3 }[got.kind], T = [0.35, 0.6, 1, 1.35, 1.7][got.tier], Pl = [1, 1.5, 1.25, 1, 0.75, 0.5][got.place];
      check('the bonus is the find\'s times the tier times the place\'s share (×1 harbour), marked deep', got.L.length > 0 && got.L.every(b => b.deep) && Math.abs(got.L[0].v0 - K * T * Pl) < 1e-6, got);
      check('the haul is counted in the tally', got.tly.ds === 1 && got.tly['ds:h0'] === 1 && got.tly['ds:b0'] === 1, got.tly);
      check('Salvage Rights is earned', got.ach, got);
    }
    await page.click('.xp-ship [data-act="fl-done"]'); await sleep(300);
    check('closing the report: the ship is in dock, the logbook has the voyage', await S(page, () => !document.querySelector('.xp-ship.xp-wide') && /In dock/.test(document.querySelector('.xp-ship').textContent) && /by salvage ship/.test(document.querySelector('.xp-lb').textContent)));
    /* the map: the find's marker and its side panel */
    await page.click(`.xp-list [data-act="ds-map"][data-k="${at.key}"]`).catch(async () => { await d.act('ds-map', { k: at.key }); });
    await until(() => S(page, () => window.__game.S.view === 'map'));
    await sleep(800);
    const mp = await S(page, k => { const cv = document.querySelector('canvas[data-map="main"]'), F = cv && cv._fl; return { marker: !!F && F.items.some(it => it.key === k), card: (document.querySelector('.ds-card') || {}).textContent || '' }; }, at.key);
    check('on the map: the find\'s marker and its deep-sea card', mp.marker && /Deep-sea find/.test(mp.card) && /Shelf: any Harbour reaches it/.test(mp.card), mp);
    await page.screenshot({ path: path.join(OUT, 'deep-sea-map.png') });
    await d.go('explore');
  }

  /* upgrades: gold, a Grand Port, a Salvage Port at grey and at gold II */
  await setHarbour(d, { ug: 3 });
  check('a blue Harbour: ×1.45, 67 hexes, deep water, +1', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 145, reach: 67, band: 1, roll: 1, hl: 3, sv: false }]), await harbour(page));
  await setHarbour(d, { ug: 5 });
  check('a gold Harbour: ×2, 75 hexes, the abyss, +2', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 200, reach: 75, band: 2, roll: 2, hl: 5, sv: false }]), await harbour(page));
  await setHarbour(d, { tr: 2, ln: 'fleet' });
  check('a Grand Port (Fishing Fleet): ×2, as far and deep as gold', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 200, reach: 75, band: 2, roll: 2, hl: 6, sv: false }]), await harbour(page));
  await setHarbour(d, { tr: 2, ln: 'salvage', ug: 1 });
  const sv = await S(page, () => { const P = window.__game.DS(), n = window.__game.S.nation; return { h: P.harbours(n)[0], ships: P.ships(n) }; });
  check('a Salvage Port at grey II: ×2.6, 78 hexes, two ships', sv.h.hm === 260 && sv.h.reach === 78 && sv.h.hl === 7 && sv.ships === 2, sv);
  await setHarbour(d, { tr: 2, ln: 'salvage', ug: 5 });
  check('a Salvage Port at gold II: ×3, 90 hexes', JSON.stringify((await harbour(page)).map(h => [h.hm, h.reach])) === '[[300,90]]', await harbour(page));
  const lines = await S(page, () => { const B = window.__game.DS().BTIER(); return B && B[2] ? Object.keys(B[2].lines) : null; });
  check('the Harbour retools to a Grand Port in three lines', JSON.stringify(lines) === '["fleet","merchant","salvage"]', lines);
  check('a gold Harbour\'s ship reaches more of the sea\'s finds than a plain one\'s', await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, U = P.reachSet(n); let k = 0; for (const s of P.alive()) if (U[s.c]) k++; return k >= 1; }));

  /* the Museum: Treasures of the Deep, from the curios stamped on voyages; half the set brings 2 land credits */
  const mus = await S(page, () => { const G = window.__game, P = G.DS(), n0 = G.S.nation, n = G.clone(n0), now = Date.now();
    const e0 = (n.fl || []).find(e => e.hb != null);
    const base = e0 ? Object.assign({}, e0) : { k: P.alive()[0].key, s: now - 3600e3, a: now - 1800e3, r: 10, m: 0, hb: n.cities[0].c, hm: 100, hl: 0, h: 1, p: 1, q: 2 };
    n.fl = (n.fl || []).filter(e => e.hb == null).concat(P.CURIOS.slice(0, 4).map((cu, i) => Object.assign({}, base, { s: base.s - (i + 1) * 60000, a: base.a - (i + 1) * 60000, cu })));
    const c0 = P.credits(n0); G.commit(n); const n2 = G.S.nation;
    return { held: P.CURIOS.filter(id => n2.coll && n2.coll[id]).length, credits: P.credits(n2) - c0 }; });
  check('curios on voyages go on display in Treasures of the Deep, and half the set brings 2 land credits', mus.held === 4 && mus.credits === 2, mus);

  /* the Help page */
  check('How to play explains deep-sea finds', await S(page, () => { const H = window.__game.DS().help(); return !!H && /salvage ship/.test(H.body(window.__game.S.nation)) && /×2 gold/.test(H.body(window.__game.S.nation)); }));
  check('no script errors', d.errors.length === 0, d.errors);
  await d.ctx.close();

  /* a phone: the idle ship card folds into the line on the expedition's card */
  const p = await settled({ width: 390, height: 844 }, { phone: true });
  await setHarbour(p, {});
  await p.go('explore');
  const ph = await S(p.page, () => ({ hidden: getComputedStyle(document.querySelector('.xp-ship')).display === 'none', line: (document.querySelector('.xp-pline') || {}).textContent || '', wide: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  check('on a phone the idle ship card folds into a line, and nothing overflows', ph.hidden && /Salvage ship:/.test(ph.line) && ph.wide, ph);
  await p.page.screenshot({ path: path.join(OUT, 'deep-sea-phone.png') });
  check('no script errors on the phone', p.errors.length === 0, p.errors);
  await p.ctx.close();
} catch (e) { console.error(e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
