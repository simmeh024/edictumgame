// The Nation page, ideas of 2026-11-16: the factbook in Figures and Particulars (how a figure moved since yesterday, the
// figures on your own page opening their pages, Particulars folded on a phone); the leader's portrait on the card; Open
// to (Customise, the card, Undo, the region's filter, the record kept clean); what a nation has to spare and is short
// of, and Propose a trade filled in from it; Neighbours, on your page and on theirs; who collected your stamp this week.
// A phone and the dark theme.
//   python3 build.py
//   node test/nation-page-plus.mjs
// Like nation-page.mjs it serves public/ itself, so the game runs in its local mode (no emulators): other players are
// records put into S.world with the mode set to 'world'. Screenshots go to test/out/.
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
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const S = (page, f, a) => page.evaluate(f, a);
const DAY = 864e5;

async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v.split('/')[0], v)); await sleep(400); };
  const act = (a, d = {}) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d); document.body.appendChild(b); b.click(); b.remove(); }, [a, d]);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* an established nation, eight days old, with goods for an operation */
  await edit((n, now) => { delete n.onb; n.founded = now - 8 * 864e5; n.stock = Object.assign({}, n.stock, { food: 380, timber: 380, iron: 380, oil: 380, goods: 380 }); n.stockAt = now; n._stockSet = true; });
  return { ctx, page, errors, edit, go, act };
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `np-plus-${name}.png`), fullPage: full });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const wide = page => page.evaluate(() => { const W = document.documentElement.clientWidth, o = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > W + 1 && !e.closest('.vs-nav-l')) o.push((e.className || e.tagName) + ':' + Math.round(r.right)); } return o.slice(0, 8); });
const X = page => S(page, () => window.__game.NPX());
/* a second player whose capital stands a few hexes from this nation's, so the two lands touch: tries the free land cells
   nearest first until the map draws a border between them */
const addNeighbour = (page, extra = {}) => S(page, extra => {
  const G = window.__game, N = G.NPX(), me = G.S.nation, T0 = N.territory(), mi = T0.byId[N.myId()], cap = T0.list[mi].cap;
  const o = G.clone(me); o.name = 'Orvelle'; o.claims = []; o.cities = []; delete o.ifl; delete o.cov; delete o.pp; delete o.ppr; delete o.vl; delete o.gw; Object.assign(o, extra);
  const C = N.MAP.COLS, cand = [];
  for (let c = 0; c < N.MAP.N; c++) { if (N.MAP.T[c] < 2 || T0.owner[c] >= 0) continue; const d = N.hexDist(c, cap); if (d >= 3 && d <= 8) cand.push([d, c]); }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  G.S.mode = 'world';
  for (const [, c] of cand.slice(0, 80)) {
    o.loc = Object.assign({}, me.loc, { r: Math.floor(c / C), c: c % C }); G.S.world = { p2: o };
    const T = N.territory(), i = T.byId[N.myId()], j = T.byId.p2;
    if (i !== undefined && j !== undefined && N.bordersOf(T, i).includes(j)) { G.render(); return c; }
  }
  G.S.world = {}; G.S.mode = 'local'; return -1;
}, extra);

try {
  /* ── desktop, light ── */
  const d = await start('light', { width: 1280, height: 900 }), { page } = d;
  await d.go('nation');

  /* the factbook in two halves */
  const fb = () => S(page, () => ({
    fig: [...document.querySelectorAll('.factbook .fb-fig dt')].map(e => e.firstChild.textContent),
    part: [...document.querySelectorAll('.factbook .fb-part dt')].map(e => e.firstChild.textContent),
    open: !!(document.querySelector('.factbook .fb-part') || {}).open,
    go: [...document.querySelectorAll('.factbook .fb-fig .fb-go')].map(b => b.closest('div').querySelector('dt').firstChild.textContent),
    tr: [...document.querySelectorAll('.factbook .fb-tr')].map(t => t.closest('div').querySelector('dt').firstChild.textContent + ':' + t.className.replace('fb-tr ', '') + ':' + t.querySelector('[aria-hidden]').textContent)
  }));
  const f0 = await fb();
  check('Figures first: the numbers that move, from Population to Growth', f0.fig.slice(0, 3).join() === 'Population,Land area,Cities' && f0.fig[f0.fig.length - 1] === 'Growth' && ['Army', 'Alliance', 'Trade deals', 'Average income', 'Economic output', 'Income tax', 'Largest industry'].every(k => f0.fig.includes(k)), f0.fig);
  check('then Particulars: names and symbols, open on a wide screen', ['Capital', 'Leader', 'Currency', 'National animal', 'Demonym', 'Founded'].every(k => f0.part.includes(k)) && !f0.part.includes('Population') && f0.open, f0);
  check('on your own page each figure you manage opens its page', ['Population', 'Land area', 'Cities', 'Army', 'Alliance', 'Trade deals', 'Average income', 'Economic output', 'Income tax', 'Growth'].every(k => f0.go.includes(k)), f0.go);
  check('no trend before there is a snapshot from yesterday', f0.tr.length === 0, f0.tr);
  /* a snapshot from a day ago: fewer people, a lower income tax */
  await d.edit((n, now, G) => { const N = G.NPX(), ti = N.STAT_KEYS.indexOf('tax'), h = { t: now - 864e5, p: N.popNow(n, now) * 0.8, s: N.STAT_KEYS.map(k => n.s[k]), e: 1 }; h.s[ti] = Math.round(n.s.tax) - 4; n.hist = [h]; });
  await sleep(300);
  const f1 = await fb();
  check('since yesterday: population up a quarter, the tax rate up 4 points (a rate, so not green or red)', f1.tr.some(t => /^Population:up:▲ 2[45]\.\d%$/.test(t)) && f1.tr.includes('Income tax:flat:▲ 4 pts'), f1.tr);
  check('the trend says so to a screen reader', /up 4 points since yesterday/.test(await S(page, () => [...document.querySelectorAll('.factbook .fb-tr .u-sr')].map(e => e.textContent).join('|'))));
  await d.edit((n, now) => { n.hist = (n.hist || []).map(h => Object.assign({}, h, { t: now - 2 * 3600e3 })); });
  await sleep(300);
  check('a snapshot only two hours old says nothing', (await fb()).tr.length === 0, (await fb()).tr);
  await page.click('.fb-fig .fb-go[data-v="cities"]');
  check('Cities opens the Cities page', await until(() => S(page, () => window.__game.S.view === 'cities')));
  await d.go('nation');
  await page.click('.fb-fig .fb-go[data-k="budget"]');
  check('Income tax opens Statistics at Budget & flows', await until(() => S(page, () => window.__game.S.view === 'stats' && window.__game.S.statsTab === 'budget')));
  await d.go('nation');
  await page.click('.fb-part > summary'); await sleep(200);
  await d.edit(n => { n.motto = 'Folded'; }); await sleep(300);
  check('Particulars stay folded through a redraw once folded', await S(page, () => !document.querySelector('.fb-part').open));
  await page.click('.fb-part > summary'); await sleep(200);

  /* the leader on the card */
  const lead = () => S(page, () => { const h = document.querySelector('.hero .hero-lead'); return h ? { med: !!h.querySelector('.cv-med svg'), t: h.querySelector('.hero-ruler').textContent, c: (h.querySelector('.hero-lead-c') || {}).textContent || '' } : null; });
  const l0 = await lead();
  check('the card shows the leader’s portrait, led by the title alone while unnamed', !!l0 && l0.med && /^Led by the President/.test(l0.t), l0);
  await d.edit(n => { n.ruler = 'Ada Brook'; }); await sleep(300);
  const l1 = await lead();
  check('named, the leader by title and name, with where they were born', /^Led by President Ada Brook/.test(l1.t) && /Born in /.test(l1.c), l1);

  /* Open to: the way in from the card, Customise, the card again, Undo */
  check('your card offers to say what you are open to', /Say what you are open to/.test(await S(page, () => (document.querySelector('.hero [data-act="op-edit"]') || {}).textContent || '')));
  await page.click('.hero [data-act="op-edit"]');
  check('it opens Customise at Open to', await until(() => S(page, () => window.__game.S.view === 'customise' && !!document.getElementById('op-tog-trd'))));
  check('six labels to choose from, none chosen', await S(page, () => document.querySelectorAll('.op-tog').length === 6 && !document.querySelector('.op-tog[aria-pressed="true"]')));
  await page.click('#op-tog-trd'); await sleep(250); await page.click('#op-tog-slow'); await sleep(250);
  const vp = () => S(page, () => JSON.stringify((window.__game.S.nation.vl || {}).p || []));
  check('choosing Trade and Slow replies saves them, pressed', await vp() === '["trd","slow"]' && await S(page, () => document.querySelector('#op-tog-trd').getAttribute('aria-pressed') === 'true' && document.activeElement && document.activeElement.id === 'op-tog-slow'), await vp());
  await page.click('[data-act="cz-undo"]'); await sleep(250);
  check('Undo takes the last one back', await vp() === '["trd"]', await vp());
  await page.click('#op-tog-slow'); await sleep(250);
  await d.go('nation');
  const op = await S(page, () => { const h = document.querySelector('.hero .hero-op'); return h ? { chips: [...h.querySelectorAll('.op-chip')].map(c => c.textContent), lbl: (h.querySelector('.lbl') || {}).textContent, edit: !!h.querySelector('[data-act="op-edit"]') } : null; });
  check('your card: Open to Trade, and Slow replies apart, with a way to change them', !!op && op.chips.join() === 'Trade,Slow replies' && op.lbl === 'Open to' && op.edit, op);

  /* Neighbours: another player next door */
  const cell = await addNeighbour(page, { vl: { p: ['al', 'dm'] } });
  check('a second player is placed where its land touches yours', cell >= 0, cell);
  await d.go('nation'); await sleep(300);
  const nb = () => S(page, () => { const s = document.querySelector('.nb-sec'); return s ? { rows: [...s.querySelectorAll('.nb-row')].map(r => r.querySelector('.nb-n button').textContent + '|' + [...r.querySelectorAll('.nb-c .chip')].map(c => c.textContent).join('+') + '|' + ((r.querySelector('.nb-gw') || {}).textContent || '') + '|' + r.querySelector('.nb-n .hint').textContent), prev: (s.previousElementSibling && s.previousElementSibling.querySelector('h2') || {}).textContent } : null; });
  const nb0 = await nb();
  check('your page: Neighbours, just after Territory, names the nation next door at peace and the length of the border', !!nb0 && /^Territory/.test(nb0.prev) && nb0.rows.length === 1 && /^Orvelle\|At peace\|\|\d+ hexe?s? on the border$/.test(nb0.rows[0]), nb0);
  await d.edit(n => { n.gw = { p2: 12 }; }); await sleep(300);
  check('with your record of goodwill with them', /\|Warm \(\+12\)\|/.test((await nb()).rows[0]), await nb());
  await d.act('visit', { id: 'p2' }); await until(() => S(page, () => window.__game.S.view === 'visit' && window.__game.S.visit === 'p2' && !!document.querySelector('.vs-page')));
  const vn = await S(page, () => ({ sec: !!document.querySelector('#vs-nb .nb-sec'), nav: [...document.querySelectorAll('.vs-nav-b')].map(b => b.dataset.k), row: [...document.querySelectorAll('#vs-nb .nb-row')].map(r => r.textContent.replace(/\s+/g, ' ')), chips: [...document.querySelectorAll('.hero .op-chip')].map(c => c.textContent), oped: !!document.querySelector('.hero [data-act="op-edit"]'), go: document.querySelectorAll('.factbook .fb-go').length, parts: !!document.querySelector('.factbook .fb-part') }));
  check('their page: a Neighbours section of its own, in the index, with you marked', vn.sec && vn.nav.includes('nb') && vn.nav.indexOf('nb') === vn.nav.indexOf('ter') + 1 && vn.row.length === 1 && /Lampwick You/.test(vn.row[0]), vn);
  check('their card: Open to Alliances and Letters, and no way for you to change it', vn.chips.join() === 'Alliances,Letters' && !vn.oped, vn);
  check('their factbook: the same two halves, the figures not links', vn.parts && vn.go === 0, vn);
  await shot(page, 'visitor');

  /* the region's list, narrowed to what players are open to */
  await d.go('region');
  await S(page, () => { const b = document.querySelector('[data-act="rgn-tab"][data-v="nations"]'); if (b) b.click(); }); await sleep(300);
  const chips = await S(page, () => Object.fromEntries([...document.querySelectorAll('[data-act="rgn-filter"]')].map(b => [b.dataset.v, +b.querySelector('.rgn-chip-n').textContent.replace(/\D/g, '')])));
  check('the region’s list offers Open to trade, alliances and letters, with their counts', chips['op-trd'] === 1 && chips['op-al'] === 1 && chips['op-dm'] === 1, chips);
  await page.click('[data-act="rgn-filter"][data-v="op-al"]'); await sleep(300);
  check('Open to alliances leaves only the nation that is', await S(page, () => [...document.querySelectorAll('.rgn-row')].map(r => r.dataset.id).join()) === 'p2');
  await page.click('[data-act="rgn-filter"][data-v="op-trd"]'); await sleep(300);
  check('Open to trade leaves only you', await S(page, () => [...document.querySelectorAll('.rgn-row')].map(r => r.dataset.id).join()) === 'me');

  /* what a computer nation has to spare and is short of, and Propose a trade filled in from it */
  const npc = await S(page, () => { const N = window.__game.NPX(); return ['npc-karvesk', 'npc-vellmark', 'npc-lucanto', 'npc-oskaloo', 'npc-brennoch', 'npc-tarrow', 'npc-marrowmere', 'npc-ilsund'].find(id => { const H = N.hnOf(id); return H && H.has.length && N.economy().T.byId[id] !== undefined; }); });
  check('a computer nation has something to spare', !!npc, npc);
  await d.act('visit', { id: npc }); await until(() => S(page, () => window.__game.S.view === 'visit' && window.__game.S.visit === npc && !!document.querySelector('.vs-page')));
  const hn = await S(page, id => {
    const N = window.__game.NPX(), H = N.hnOf(id), E = H.E, mi = E.T.byId[N.myId()], RN = { food: 'Food', timber: 'Timber', iron: 'Iron', oil: 'Oil', goods: 'Goods' };
    const g = k => [...document.querySelectorAll('.hn-line .hn-g')].filter(e => e.querySelector('.hn-k').textContent === k).flatMap(e => [...e.querySelectorAll('li')].map(l => l.querySelector('span:not(.r-ic):not(.hn-you)').textContent + (l.querySelector('.hn-you') ? '*' : '')));
    return { has: g('To spare'), need: g('Short of'), want: H.has.map(r => RN[r] + (E.ratio[r][mi] < 0.9 ? '*' : '')), wantN: H.need.map(r => RN[r] + (E.sup[r][mi] - E.dem[r][mi] >= 1 ? '*' : '')), after: document.querySelector('.hn-line') && document.querySelector('.hn-line').previousElementSibling.classList.contains('visit-acts') };
  }, npc);
  check('under the buttons: what it has to spare and is short of, as the Trade page reckons it', hn.after && hn.has.join() === hn.want.join() && hn.need.join() === hn.wantN.join(), hn);
  check('a player who classifies its trade or its economy shows no Board of Trade line', await S(page, id => { const N = window.__game.NPX(), x = N.findNation(id), as = vl => N.hnLine({ id, n: Object.assign({}, x.n, { npc: false, vl }) }, Date.now()); return as(undefined) !== '' && as({ c: ['trd'] }) === '' && as({ c: ['eco'] }) === ''; }, npc));
  check('opening its page collects its stamp, and your record keeps when (ppr)', await until(() => S(page, id => { const G = window.__game, n = G.S.nation; return !!(n.pp && n.pp.v && n.pp.v[id]) && Array.isArray(n.ppr) && n.ppr[0][0] === G.NPX().ppHash(id) && Math.abs(n.ppr[0][1] * 6e4 - Date.now()) < 120e3; }, npc)));
  await page.click('.visit-acts [data-act="trade-go"]');
  await until(() => S(page, () => window.__game.S.view === 'trade' && !!document.getElementById('tr-rr')));
  const tr = await S(page, id => { const G = window.__game, N = G.NPX(), E = N.economy(), j = E.T.byId[id], t = G.S.trade; return { w: t.w, rr: t.rr, gr: t.gr, ra: +t.ra, ga: +t.ga, spare: E.sup[t.rr][j] - E.dem[t.rr][j], msg: (document.querySelector('.war-msg') || {}).textContent || '', sel: document.getElementById('tr-rr').value, selW: document.getElementById('tr-w').value }; }, npc);
  check('Propose a trade opens the form filled in: something they can spare, which the form shows', tr.w === npc && tr.selW === npc && tr.sel === tr.rr && tr.spare >= 0.5 && tr.ra >= 0.5 && tr.ra <= Math.max(0.5, tr.spare) + 1e-9 && tr.gr !== tr.rr && tr.ga >= 0.5, tr);
  check('and says it was filled in from what they have', /^Filled in from what .+ has to spare/.test(tr.msg), tr.msg);

  /* who collected your stamp this week */
  await S(page, () => {
    const G = window.__game, N = G.NPX(), h = N.ppHash(N.myId()), now = Date.now(), p2 = G.S.world.p2, base = G.clone(p2);
    delete base.loc; p2.ppr = [[h, Math.floor((now - 90 * 6e4) / 6e4)]]; p2.pph = [h];
    G.S.world.p3 = Object.assign(G.clone(base), { name: 'Quillon', ppr: [[h, Math.floor((now - 10 * 864e5) / 6e4)]], pph: [h] });
    G.S.world.p4 = Object.assign(G.clone(base), { name: 'Thessaly', pph: [h] });
    G.S.world.p5 = Object.assign(G.clone(base), { name: 'Umbria', ppr: [['zzzzz', Math.floor(now / 6e4)]] });
  });
  await d.go('nation'); await sleep(300);
  const who = await S(page, () => { const p = document.querySelector('.pp-sec .pp-who'); return p ? { t: p.textContent.replace(/\s+/g, ' '), ids: [...p.querySelectorAll('[data-act="visit"]')].map(b => b.dataset.id) } : null; });
  check('your Passport section: carried by three nations, and this week only Orvelle collected it', !!who && /carried by 3 nations/.test(who.t) && /This week Orvelle collected it\./.test(who.t) && who.ids.join() === 'p2', who);
  await shot(page, 'own');
  check('no script errors on the desktop', d.errors.length === 0, d.errors);

  /* the record kept clean when it loads: Open to and the stamp times */
  await d.edit(n => { n.vl = { p: ['trd', 'nope', 'trd', 5, 'war'] }; n.ppr = [['abc12', 29000000], ['BAD', 1], [7, 2], ['x', -1], 'y']; });
  await S(page, () => { const G = window.__game; G.S.mode = 'local'; G.S.world = {}; });
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view); await sleep(500);
  const kept = await S(page, () => ({ vl: window.__game.S.nation.vl, ppr: window.__game.S.nation.ppr }));
  check('after a reload Open to keeps only known labels, once each, in their order', JSON.stringify(kept.vl) === JSON.stringify({ p: ['trd', 'war'] }), kept.vl);
  check('and the stamp times keep only recent ones the record really holds', Array.isArray(kept.ppr) && kept.ppr.every(e => typeof e[0] === 'string' && /^[0-9a-z]{1,5}$/.test(e[0]) && e[1] * 6e4 > Date.now() - 8 * 864e5), kept.ppr);
  await d.go('nation');
  check('in local mode (no other players) the stamp line is left out', await S(page, () => !document.querySelector('.pp-who')));
  await d.ctx.close();

  /* ── a phone, dark ── */
  const p = await start('dark', { width: 390, height: 844 }, { phone: true }), P = p.page;
  await P.addStyleTag({ content: '.toast{display:none!important}' });
  await p.edit(n => { n.ruler = 'Ada Brook'; n.vl = { p: ['trd', 'al', 'dm', 'pen', 'war', 'slow'] }; });
  await addNeighbour(P, { vl: { p: ['trd'] } });
  await p.go('nation'); await sleep(500);
  check('phone: Particulars start folded', await S(P, () => !!document.querySelector('.fb-part') && !document.querySelector('.fb-part').open));
  check('phone: your Nation page has no sideways scroll', await noOverflow(P), await wide(P));
  await shot(P, 'phone-own');
  await p.act('visit', { id: 'p2' }); await until(() => S(P, () => window.__game.S.view === 'visit' && !!document.querySelector('.vs-page'))); await sleep(500);
  check('phone: their page has no sideways scroll', await noOverflow(P), await wide(P));
  await shot(P, 'phone-visitor');
  const nk = await S(P, () => ['npc-karvesk', 'npc-vellmark', 'npc-lucanto'].find(id => { const H = window.__game.NPX().hnOf(id); return H && (H.has.length || H.need.length); }));
  if (nk) { await p.act('visit', { id: nk }); await until(() => S(P, () => window.__game.S.visit === nk && !!document.querySelector('.hn-line'))); await sleep(400);
    check('phone: the Board of Trade line has no sideways scroll', await noOverflow(P), await wide(P)); }
  await S(P, () => { const G = window.__game; G.S.mode = 'local'; G.S.world = {}; });
  await p.go('customise/nationpage');
  check('phone: Customise › Open to has no sideways scroll', await until(() => S(P, () => !!document.getElementById('op-tog-trd'))) && await noOverflow(P), await wide(P));
  check('no script errors on the phone', p.errors.length === 0, p.errors);
  await p.ctx.close();
} catch (e) {
  console.log('FAIL the suite stopped:', e && e.stack || e); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
