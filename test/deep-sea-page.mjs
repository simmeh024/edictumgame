// Deep-sea finds (2026-11-26): fleeting finds out at sea, reached by a salvage ship from a Harbour, whose upgrades raise
// the haul. A nation settled on the open sea's shore: no harbour, then a plain Harbour (the shelf only), a voyage sent
// from the Deep sea list, the ship at sea, back in port, its report under the Harbour Master's stamp, the bonus counted
// with the harbour's multiplier and the place's share, the tally, the logbook and the dock; a gold Harbour, a Grand
// Port and a Salvage Port (two ships); the map's side panel and marker; the Museum's Treasures of the Deep and its land
// credits; an achievement; the Help page; and a phone, where the idle ship card folds into a line. Choosing the port
// (27 Nov 2026): two harbour cities, the rule, a home port, a port chosen for a find and kept on the device, the
// picker's comparison and its greyed ports, the ship card's settings, the small map's reach, and two ships' home ports.
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
  check('settled on the open sea: the capital\'s harbour would reach the sea', await S(page, () => { const G = window.__game; return G.DS().seaDist(G.S.nation.cities[0].c, G.DS().REACH).cells.length > 0; }));
  const grid = await S(page, () => { const P = window.__game.DS(), g = P.grid(), A = P.alive(); return { lanes: g.L, cnt: g.cnt, alive: A.length, bands: [0, 1, 2].map(b => A.filter(s => s.bd === b).length), deep: A.every(s => s.ds && window.__game.MAP.T[s.c] < 2) }; });
  check('the sea has lanes of its own and finds about at every depth, all on the water', grid.lanes >= 8 && grid.alive >= 5 && grid.deep, grid);

  /* no harbour */
  await d.go('explore');
  check('no harbour: the ship card says a ship needs a harbour', await S(page, () => /A ship needs a harbour/.test(document.querySelector('.xp-ship').textContent)));
  await page.click('.xp-seg[data-v="ds"]'); await sleep(300);
  check('the Deep sea filter lists the finds at sea, and says a Harbour sends the ship', await S(page, () => document.querySelector('.xp-seg[data-v="ds"]').getAttribute('aria-pressed') === 'true' && /Build one in a coastal city/.test(document.querySelector('.xp-list').textContent)));

  /* a plain Harbour reaches the shelf only */
  await setHarbour(d, {});
  check('a plain Harbour: ×1, 60 hexes by sea, the shelf only', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 100, reach: 60, band: 0, roll: 0, hl: 0, sv: false }]), await harbour(page));
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
  check('a blue Harbour: ×1.45, 72 hexes, deep water, +1', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 145, reach: 72, band: 1, roll: 1, hl: 3, sv: false }]), await harbour(page));
  await setHarbour(d, { ug: 5 });
  check('a gold Harbour: ×2, 80 hexes, the abyss, +2', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 200, reach: 80, band: 2, roll: 2, hl: 5, sv: false }]), await harbour(page));
  /* a gold Harbour too far away is named, with how far the find is and how far its ship sails, even while the ship is
     busy (rw); the distance shown is from it, and the one search for every harbour agrees with the harbour's own */
  const gap = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, h = P.harbours(n)[0], t0 = P.flNow(), D = P.seaDist(h.c, 9999), F = P.farDist([h]);
    let agree = 0, off = 0;
    for (let t = t0; t < t0 + 4 * 86400e3; t += 3600e3) for (const s of P.alive(t)) { if (F.d[s.c] === D[s.c]) agree++; else off++;
      const p = P.plan(n, s, t); if (D[s.c] > h.reach) return { rw: p.rw, d: p.d, dh: p.dh, far: D[s.c], reach: h.reach, agree, off }; }
    return { agree, off }; });
  check('a find beyond the gold Harbour: out of reach, how far, and how far its ship sails', !!gap.rw && gap.rw === `Out of reach: ${gap.far} hexes by sea from ${gap.dh}, and its ship sails 80.` && /’s gold Harbour$/.test(gap.dh) && gap.d === gap.far && gap.far > 80, gap);
  check('the search from every harbour at once agrees with every harbour on its own', gap.agree > 0 && gap.off === 0, gap);
  await setHarbour(d, { tr: 2, ln: 'fleet' });
  check('a Grand Port (Fishing Fleet): ×2, as far and deep as gold', JSON.stringify(await harbour(page)) === JSON.stringify([{ hm: 200, reach: 80, band: 2, roll: 2, hl: 6, sv: false }]), await harbour(page));
  await setHarbour(d, { tr: 2, ln: 'salvage', ug: 1 });
  const sv = await S(page, () => { const P = window.__game.DS(), n = window.__game.S.nation; return { h: P.harbours(n)[0], ships: P.ships(n) }; });
  check('a Salvage Port at grey II: ×2.6, 83 hexes, two ships', sv.h.hm === 260 && sv.h.reach === 83 && sv.h.hl === 7 && sv.ships === 2, sv);
  await setHarbour(d, { tr: 2, ln: 'salvage', ug: 5 });
  check('a Salvage Port at gold II: ×3, 95 hexes', JSON.stringify((await harbour(page)).map(h => [h.hm, h.reach])) === '[[300,95]]', await harbour(page));
  const lines = await S(page, () => { const B = window.__game.DS().BTIER(); return B && B[2] ? Object.keys(B[2].lines) : null; });
  check('the Harbour retools to a Grand Port in three lines', JSON.stringify(lines) === '["fleet","merchant","salvage"]', lines);
  check('a gold Harbour\'s ship reaches more of the sea\'s finds than a plain one\'s', await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, U = P.reachSet(n); let k = 0; for (const s of P.alive()) if (U[s.c]) k++; return k >= 1; }));

  /* choosing the port (27 Nov 2026): a second harbour city in the nation's own land, so two ports reach the same finds */
  const port2 = await S(page, () => { const G = window.__game, M = G.MAP, P = G.DS(), T = G.territory(), mi = T.byId[P.me()], cap = G.S.nation.cities[0].c, lk = G.LK.lakeMap(), out = [];
    for (let c = 0; c < M.N; c++) { if (c === cap || T.owner[c] !== mi || M.T[c] < 2) continue; let sea = 0; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && M.T[j] < 2 && !lk[j]) sea++; } if (sea >= 2) out.push(c); }
    return out; });
  check('the nation holds a second spot on the shore for a harbour city', port2.length > 0, port2.length);
  const two = await S(page, c2 => { const G = window.__game, P = G.DS(), n = G.clone(G.S.nation), now = Date.now();
    n.cities[0].b = [{ k: 'harbour', s: now - 2 * 864e5, d: now - 864e5, a: 1, ug: 5 }];
    n.cities = n.cities.filter(c => c.id !== 'dsport2').concat({ id: 'dsport2', c: c2, nm: 'Second Port', t: now - 3 * 864e5, b: [{ k: 'harbour', s: now - 2 * 864e5, d: now - 864e5, a: 1, ug: 1 }] });
    delete n.dsp; G.commit(n); G.render();
    return P.harbours(G.S.nation).map(h => ({ c: h.c, nm: h.nm, hm: h.hm, band: h.band })); }, port2[0]);
  check('two harbours: the gold one and a grey one', two.length === 2 && two[0].hm === 200 && two[1].hm === 110, two);
  const both = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, t0 = P.flNow();
    for (let t = t0 + 3 * 3600e3; t < t0 + 6 * 86400e3; t += 1800e3) for (const s of P.alive(t)) { const p = P.plan(n, s, t, null); if (p.opts.length === 2 && !p.why && s.e - t > 3 * 3600e3) return { t, key: s.key, hb: p.hb.c, how: p.how, sh: p.sh }; }
    return null; });
  check('a find both ports can go to: the rule picks the best haul, the gold Harbour', !!both && both.how === 'rule' && both.hb === two[0].c && both.sh === 0, both);
  const rule = await S(page, () => { const P = window.__game.DS(), t = Date.now(), s = { e: t + 10 * 3600e3 }, fit = [{ c: 1, d: 60, reach: 80, hm: 200 }, { c: 2, d: 10, reach: 64, hm: 110 }];
    return ['h', 'f', 'c'].map(r => P.byRule(fit, r, s, t)[0].c).concat(P.byRule(fit, 'h', { e: t + 30 * 60000 }, t)[0].c); });
  check('the rule: the best haul, the fastest, the cheapest; a port that arrives too late comes last', JSON.stringify(rule) === '[1,2,2,2]', rule);
  if (both) {
    const home = await S(page, ([c2, k, t]) => { const G = window.__game, P = G.DS(), n = G.clone(G.S.nation); n.dsp = { p: [c2, null], r: 'h' }; G.commit(n); const p = P.plan(G.S.nation, P.flByKey(k), t); return { hb: p.hb && p.hb.c, how: p.how, prefs: P.prefs(G.S.nation) }; }, [two[1].c, both.key, both.t]);
    check('a home port is used for every find it can reach', home.hb === two[1].c && home.how === 'home' && home.prefs.p[0] === two[1].c, home);
    const pick = await S(page, ([c1, k, t]) => { const G = window.__game, P = G.DS(); P.setPick(k, c1); const p = P.plan(G.S.nation, P.flByKey(k), t), raw = JSON.parse(localStorage.getItem('edictum.dsPort') || '{}'); G.S.dsHb = null; return { hb: p.hb && p.hb.c, how: p.how, raw: raw[k], again: P.pick(k), now: Date.now() }; }, [two[0].c, both.key, both.t]);
    check('a port chosen for a find wins over the home port, and is kept on this device until the find is gone', pick.hb === two[0].c && pick.how === 'pick' && Array.isArray(pick.raw) && pick.raw[0] === two[0].c && pick.raw[1] > pick.now && pick.again === two[0].c, pick);

    /* on the Expeditions page: each row's port, the comparison, a choice, and back to the game's own */
    await S(page, t => { window.__game.DS().flDebug({ t }); window.__game.render(); }, both.t);
    await d.go('explore'); await page.click('.xp-seg[data-v="ds"]').catch(() => {}); await sleep(300);
    const fold = `details.ds-pp[data-k="${both.key}"]`;
    const sum0 = await S(page, f => { const el = document.querySelector(f); return el ? el.querySelector('summary').textContent.replace(/\s+/g, ' ').trim() : null; }, fold);
    check('each find\'s row says which port its ship sails from, and why', !!sum0 && /^From .+ · ×2 your choice$/.test(sum0), sum0);
    await page.click(`${fold} > summary`); await sleep(400);
    const opened = await S(page, f => { const el = document.querySelector(f); return el && { open: el.open, on: [...el.querySelectorAll('button.ds-pr')].map(b => b.textContent.replace(/\s+/g, ' ').trim()), back: !!el.querySelector('.ds-pr-auto') }; }, fold);
    check('opening it compares the ports: haul, distance, voyage, cost and roll, marking the home port', !!opened && opened.open && opened.on.length === 2 && opened.on.every(x => /×[\d.]+ haul · \d+ hex(es)? · .+ · d20 [+−] \d+$/.test(x)) && opened.on.some(x => /Home port/.test(x)) && opened.back, opened);
    await S(page, f => document.querySelector(f).scrollIntoView({ block: 'center' }), fold);
    await page.screenshot({ path: path.join(OUT, 'deep-sea-ports.png') });
    await page.click(`${fold} button.ds-pr:not(.on)`); await sleep(400);
    const after = await S(page, ([f, k]) => ({ pick: window.__game.DS().pick(k), open: !!document.querySelector(f + '[open]') }), [fold, both.key]);
    check('choosing a port from the list keeps it for that find and closes the list', after.pick === two[1].c && !after.open, after);
    await page.click(`${fold} > summary`); await sleep(300);
    await page.click(`${fold} .ds-pr-auto`); await sleep(300);
    check('"Forget my choice" goes back to the home port', await S(page, ([f, k]) => window.__game.DS().pick(k) === null && /home port$/.test(document.querySelector(f + ' summary').textContent.trim()), [fold, both.key]));

    /* the ports that cannot go, greyed with why */
    const offs = await S(page, () => { const G = window.__game, P = G.DS(), n = G.S.nation, t0 = P.flNow(), out = {};
      for (let t = t0; t < t0 + 4 * 86400e3 && !(out.shallow && out.far); t += 3600e3) for (const s of P.alive(t)) { const p = P.plan(n, s, t, null);
        for (const r of P.portRows(n, s, t, p)) { if (!out.shallow && /^Too shallow/.test(r.why)) out.shallow = r.why;
          if (!out.far && /^Too far/.test(r.why)) { const m = /^Too far: (\d+) hexes by sea, and its ship sails (\d+)$/.exec(r.why), D = P.seaDist(r.c, 9999)[s.c]; out.far = { why: r.why, D, ok: !!m && +m[1] === D && +m[2] === r.h.reach && D > r.h.reach }; } } }
      return out; });
    check('a port that cannot go is greyed with why: too shallow', !!offs.shallow, offs);
    check('or too far, by the distance the search from the find agrees on', !!offs.far && offs.far.ok, offs);

    /* the ship card: a home port and how to choose the rest, kept in the nation */
    const card = await S(page, () => { const c = document.querySelector('.xp-ship'), h = c.querySelector('select[data-dshp]'); return { home: c.querySelectorAll('select[data-dshp]').length, opts: h ? [...h.options].map(o => o.textContent) : [], rule: !!c.querySelector('select[data-dsrule]'), shown: !!h && getComputedStyle(c.querySelector('.ds-home')).display !== 'none' }; });
    check('the ship card sets a home port (none, or either harbour) and how to choose the rest', card.home === 1 && card.opts.length === 3 && card.rule && card.shown, card);
    await page.selectOption('.xp-ship select[data-dsrule]', 'f'); await sleep(300);
    await page.selectOption('.xp-ship select[data-dshp][data-i="0"]', ''); await sleep(300);
    check('both are kept in the nation (n.dsp)', await S(page, () => { const x = window.__game.S.nation.dsp; return !!x && x.r === 'f' && x.p[0] === null; }));

    /* the small map: the home port's reach, or the selected find's port */
    const lab = await S(page, ([c1, c2, k]) => { const G = window.__game, P = G.DS(), n = G.clone(G.S.nation); n.dsp = { p: [c2, null], r: 'h' }; G.commit(n); G.S.xpSel = null;
      const a = P.mapPorts(G.S.nation, P.flNow()); P.setPick(k, c1); G.S.xpSel = 'g' + k; const b = P.mapPorts(G.S.nation, P.flNow()); G.S.xpSel = null; P.setPick(k, null);
      return { a: a.lab, ac: a.H.map(h => h.c), b: b.lab, bc: b.H.map(h => h.c) }; }, [two[0].c, two[1].c, both.key]);
    check('the small map draws the home port\'s reach, or the selected find\'s port', JSON.stringify(lab.ac) === JSON.stringify([two[1].c]) && JSON.stringify(lab.bc) === JSON.stringify([two[0].c]) && /^Reach from /.test(lab.a) && /^Reach from /.test(lab.b), lab);

    /* a Salvage Port's two ships, each with a home port of its own */
    const sv2 = await S(page, ([c1, c2, k, t]) => { const G = window.__game, P = G.DS(), n = G.clone(G.S.nation), now = Date.now();
      n.cities[0].b = [{ k: 'harbour', s: now - 2 * 864e5, d: now - 864e5, a: 1, tr: 2, ln: 'salvage', ug: 5 }]; n.dsp = { p: [c1, c2], r: 'h' }; G.commit(n); G.render();
      const n2 = G.S.nation, p = P.plan(n2, P.flByKey(k), t);
      return { ships: P.ships(n2), free: P.freeShips(n2, t), hb: p.hb && p.hb.c, sh: p.sh, selects: document.querySelectorAll('.xp-ship select[data-dshp]').length }; }, [two[0].c, two[1].c, both.key, both.t]);
    check('two ships, each with a home port: ship one sails from its own', sv2.ships === 2 && sv2.free.length === 2 && sv2.hb === two[0].c && sv2.sh === 0 && sv2.selects === 2, sv2);
    const sent2 = await S(page, ([k, t]) => { const G = window.__game, P = G.DS(); P.send(k); const n = G.S.nation, v = P.voyages(n).find(e => e.k === k), free = P.freeShips(n, t + 60000);
      let other = null; for (const s of P.alive(t)) { if (s.key === k) continue; const p = P.plan(n, s, t + 60000, null); if (p.opts.length === 2 && !p.why) { other = { hb: p.hb.c, sh: p.sh, how: p.how }; break; } }
      return { sh: v && v.sh, hb: v && v.hb, free, other }; }, [both.key, both.t]);
    check('the voyage names its ship; the other ship then sails from its own home port', sent2.sh === 0 && sent2.hb === two[0].c && JSON.stringify(sent2.free) === '[1]' && (!sent2.other || (sent2.other.sh === 1 && sent2.other.hb === two[1].c && sent2.other.how === 'home')), sent2);
  }

  /* the Museum: Treasures of the Deep, from the curios stamped on voyages; half the set brings 2 land credits */
  const mus = await S(page, () => { const G = window.__game, P = G.DS(), n0 = G.S.nation, n = G.clone(n0), now = Date.now();
    const e0 = (n.fl || []).find(e => e.hb != null);
    const base = e0 ? Object.assign({}, e0) : { k: P.alive()[0].key, s: now - 3600e3, a: now - 1800e3, r: 10, m: 0, hb: n.cities[0].c, hm: 100, hl: 0, h: 1, p: 1, q: 2 };
    n.fl = (n.fl || []).filter(e => e.hb == null).concat(P.CURIOS.slice(0, 4).map((cu, i) => Object.assign({}, base, { s: base.s - (i + 1) * 60000, a: base.a - (i + 1) * 60000, cu })));
    const c0 = P.credits(n0); G.commit(n); const n2 = G.S.nation;
    const has = m => P.CURIOS.filter(id => m.coll && m.coll[id]);
    return { before: has(n0), held: has(n2), want: P.CURIOS.slice(0, 4), credits: P.credits(n2) - c0 }; });
  /* a voyage earlier in the run may have brought a curio home already (which one is picked by the nation's random id):
     the four are all on display, with nothing else new, and half the set brings its 2 credits (CI, 27 Nov 2026: one
     already held from a voyage made it {held:5}) */
  check('curios on voyages go on display in Treasures of the Deep, and half the set brings 2 land credits', mus.want.every(id => mus.held.includes(id)) && mus.held.length === new Set([...mus.before, ...mus.want]).size && mus.before.length < 4 && mus.credits === 2, mus);

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
  await p.page.click('.xp-seg[data-v="ds"]').catch(() => {}); await sleep(300);
  check('on a phone the home port is set at the top of the Deep sea list instead, and nothing overflows', await S(p.page, () => { const li = document.querySelector('.ds-home-li'); return !!li && getComputedStyle(li).display !== 'none' && !!li.querySelector('select[data-dshp]') && document.documentElement.scrollWidth <= window.innerWidth + 1; }));
  check('no script errors on the phone', p.errors.length === 0, p.errors);
  await p.ctx.close();
} catch (e) { console.error(e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
