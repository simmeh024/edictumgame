// The nation page other players see, and its classified files: the card, the overview and the factbook first, every
// other section in the order its player sets in Customise › Nation page (arrows, the arrow keys on the handle, a mouse
// drag, a touch drag, Back to default, Undo); classified topics blacked out for visitors on the page and in its
// statistics, up to the allowance; the preview of your own page; what a spy's file opens and for how long; the Bureau's
// planner and file; the record kept clean on load; a phone and the dark theme.
//   python3 build.py
//   node test/nation-page.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Local mode has only computer nations, so
// the other player is a record put into S.world with the mode set to 'world' (nothing reaches a database: there is none).
// Screenshots go to test/out/.
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
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `nation-page-${name}.png`), fullPage: full });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
/* what sticks out past the right edge, for a failing overflow check */
const wide = page => page.evaluate(() => { const W = document.documentElement.clientWidth, o = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > W + 1 && !e.closest('.vs-nav-l') && !e.closest('nav.tabbar')) o.push(e.tagName.toLowerCase() + '.' + String(e.className && e.className.baseVal === undefined ? e.className : '').split(' ')[0] + ':' + Math.round(r.right)); } return { sw: document.documentElement.scrollWidth, W, o: o.slice(0, 14) }; });
const order = page => S(page, () => window.__game.VL().vlOrder(window.__game.S.nation).join(','));
const visitInfo = page => S(page, () => ({
  secs: [...document.querySelectorAll('.vs-page > .vs')].map(e => e.dataset.vs + (e.querySelector(':scope > .cls-card') ? '*' : '') + (e.querySelector(':scope > .cls-lift') ? '+' : '')),
  fbHid: [...document.querySelectorAll('.factbook .cls-row dt')].map(d => d.textContent),
  fbTag: [...document.querySelectorAll('.factbook .cls-tag')].map(d => d.parentElement.firstChild.textContent),
  ov: document.querySelectorAll('.overview .cls-bar').length,
  nav: [...document.querySelectorAll('.vs-nav-b')].map(b => b.dataset.k + (b.classList.contains('cls') ? '*' : '')),
  ops: [...document.querySelectorAll('[data-act="cls-op"]')].map(b => b.dataset.k).join('')
}));
/* another player: a copy of this nation under another name, with the given layout */
const addPlayer = (page, vl) => S(page, vl => { const G = window.__game, o = G.clone(G.S.nation); o.name = 'Orvelle'; o.vl = vl; delete o.ifl; delete o.cov; G.S.mode = 'world'; G.S.world = { p2: o }; }, vl);

try {
  /* ── desktop, light ── */
  const d = await start('light', { width: 1280, height: 900 }), { page } = d;
  const V = await S(page, () => { const L = window.__game.VL(); return { def: L.VL_DEF, cls: L.CLS.map(c => c[0]), ops: L.CLS_OPS, read: L.CLS_READ }; });
  check('eighteen sections can move, nine topics can be classified', V.def.length === 18 && V.cls.length === 9, V);
  check('Gather intelligence reads every topic; the other operations their own', V.ops.g.length === 9 && V.ops.b.join() === 'cit' && V.ops.w.join() === 'mil' && V.ops.m.join() === 'eco,cab' && V.ops.d.join() === 'trd' && V.ops.c.join() === 'cu', V.ops);
  check('what an agent reads stays open for 7 days', V.read === 7 * DAY);

  /* a computer nation's page: the card, its actions, the index, then the overview and the factbook, then the sections */
  await d.go('region');
  const npc = await S(page, () => document.querySelector('[data-act="visit"][data-id]').dataset.id);
  await d.act('visit', { id: npc }); await until(() => S(page, () => window.__game.S.view === 'visit' && !!document.querySelector('.vs-page')));
  const top = await S(page, () => [...document.querySelector('.vs-page').children].slice(0, 4).map(e => e.className.split(' ')[0]));
  check('the card, its actions, the index and the overview with the factbook come first', top.join() === 'hero,row,vs-nav,nation-grid', top);
  const ni = await visitInfo(page);
  check('the sections follow in the default order', ni.secs.join() === V.def.filter(k => ni.secs.includes(k)).join() && ni.secs[0] === 'fr' && ni.secs.length >= 8, ni.secs);
  check('the index lists every section on the page', ni.nav.join() === ni.secs.join(), ni);
  check('a computer nation classifies nothing', !ni.fbHid.length && !ni.ov && !ni.secs.some(s => s.endsWith('*')));
  await page.click('.vs-nav-b[data-k="leg"]'); await sleep(900);
  check('a chip of the index jumps to its section', await S(page, () => { const r = document.getElementById('vs-leg').getBoundingClientRect(); return r.top >= -2 && r.top < 260; }));
  check('the page draws with no script errors', d.errors.length === 0, d.errors);
  await shot(page, 'computer');

  /* Customise › Nation page */
  await d.go('customise/nationpage');
  check('Customise opens at the Nation page, under Presentation', await until(() => S(page, () => { const s = document.getElementById('cz-sec-n'); return !!s && !s.dataset.lazy && document.getElementById('cz-dock').dataset.tab === 'look'; })));
  const cz = await S(page, () => ({ rows: [...document.querySelectorAll('#vl-list .vl-row')].map(r => r.dataset.k).join(','), fixed: document.querySelectorAll('.vl-fixed li').length, topics: document.querySelectorAll('.cls-opt').length, cnt: document.querySelector('.cls-cnt').textContent, rail: !!document.querySelector('#cz-go-n') }));
  check('every section in order, two fixed at the top, nine topics, none classified of three', cz.rows === V.def.join() && cz.fixed === 2 && cz.topics === 9 && /^0 of 3 classified/.test(cz.cnt), cz);
  check('the section is in the rail', cz.rail);

  /* arrows: Cities up one, focus stays on the arrow */
  await page.click('#vl-row-cit [data-d="-1"]'); await sleep(300);
  check('an arrow moves a section and saves the order', (await order(page)).startsWith('fr,rel,asm,cit,ter'), await order(page));
  check('the arrow keeps the focus', await S(page, () => document.activeElement && document.activeElement.matches('#vl-row-cit [data-d="-1"]')));
  /* the arrow keys on the handle */
  await page.focus('#vl-grip-gf'); await page.keyboard.press('ArrowUp'); await sleep(250); await page.keyboard.press('ArrowUp'); await sleep(250);
  check('the arrow keys on a handle move it, and the handle keeps the focus', (await order(page)).endsWith('gf,dorm,cv') && await S(page, () => document.activeElement && document.activeElement.id === 'vl-grip-gf'), await order(page));
  /* a mouse drag: Museum above Honours */
  await page.locator('#vl-grip-mu').scrollIntoViewIfNeeded();
  const gm = await page.locator('#vl-grip-mu').boundingBox(), ga = await page.locator('#vl-grip-ach').boundingBox();
  await page.mouse.move(gm.x + gm.width / 2, gm.y + gm.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(gm.x + gm.width / 2, gm.y + gm.height / 2 + (ga.y - gm.y) * i / 8 - 6); await sleep(30); }
  await page.mouse.up(); await sleep(400);
  check('a drag by the handle moves the section', (await order(page)).includes('fp,mu,ach,pp'), await order(page));
  const vl1 = await S(page, () => JSON.stringify(window.__game.S.nation.vl));
  await shot(page, 'customise', false);

  /* classifying: three of three, a fourth refused, then the Counter-Intelligence Bureau allows a fourth */
  for (const k of ['eco', 'cit', 'cab']) { await page.click('#cls-opt-' + k); await sleep(250); }
  await page.click('#cls-opt-mil'); await sleep(300);
  check('three topics classified, a fourth refused', await S(page, () => (window.__game.S.nation.vl.c || []).join()) === 'eco,cit,cab' && /^3 of 3 classified/.test(await S(page, () => document.querySelector('.cls-cnt').textContent)));
  check('a classified topic is marked on its row', await S(page, () => !!document.querySelector('#vl-row-cit .cls-st') && document.querySelector('#cls-opt-eco').getAttribute('aria-pressed') === 'true'));
  await d.edit(n => { n.policies = Object.assign({}, n.policies, { counterIntel: true }); });
  await d.go('customise/nationpage');
  await page.click('#cls-opt-mil'); await sleep(300);
  check('the Counter-Intelligence Bureau allows a fourth', await S(page, () => (window.__game.S.nation.vl.c || []).join()) === 'eco,cit,cab,mil' && /^4 of 4 classified/.test(await S(page, () => document.querySelector('.cls-cnt').textContent)));
  await d.edit(n => { n.policies = Object.assign({}, n.policies, { counterIntel: false }); });
  check('without it, the first three stay classified and the fourth waits', await S(page, () => window.__game.VL().clsOf(window.__game.S.nation).join()) === 'eco,cit,cab');
  await d.go('customise/nationpage');
  check('the waiting one says so', await S(page, () => document.querySelector('#cls-opt-mil').classList.contains('wait') && /Over the limit/.test(document.querySelector('#cls-opt-mil').textContent)));
  await page.click('#cls-opt-mil'); await sleep(300);

  /* Back to the default order, and Undo */
  await page.click('[data-act="vl-reset"]'); await sleep(300);
  check('Back to the default order', (await order(page)) === V.def.join() && await S(page, () => !window.__game.S.nation.vl.o));
  await page.click('[data-act="cz-undo"]'); await sleep(300);
  check('Undo puts the order back', await S(page, () => JSON.stringify(window.__game.S.nation.vl.o)) === JSON.stringify(JSON.parse(vl1).o), await order(page));

  /* the preview of your own page */
  await page.click('[data-act="vl-preview"]');
  await until(() => S(page, () => window.__game.S.view === 'visit' && !!document.querySelector('.vs-pbar')));
  const pv = await visitInfo(page);
  check('the preview: your page as a visitor sees it, and nothing on it works', await S(page, () => document.querySelector('.vs-page').hasAttribute('inert') && location.hash === '#visit/' + encodeURIComponent(window.__game.S.visit)));
  check('the preview follows your order', pv.secs.map(s => s.replace(/[*+]/g, '')).join() === (await order(page)).split(',').filter(k => pv.secs.some(s => s.replace(/[*+]/g, '') === k)).join(), pv.secs);
  check('classified Cities and Cabinet are stamped cards', pv.secs.includes('cit*') && pv.secs.includes('cab*'), pv.secs);
  check('the factbook and the overview black out the economy', pv.fbHid.join() === 'Average income|Economic output|Income tax|Largest industry|Growth'.split('|').join() && pv.ov === 3, pv);
  check('what each visitor sees for themselves is a placeholder', await S(page, () => ['rel', 'cv', 'gf'].every(k => !!document.querySelector(`#vs-${k} > .vs-ph`))));
  check('no operation buttons in your own preview', pv.ops === '');
  check('the preview does not stamp your passport or count as a visit', await S(page, () => !(window.__game.S.nation.pp && window.__game.S.nation.pp.v && window.__game.S.nation.pp.v[window.__game.S.visit])));
  await shot(page, 'preview');
  await page.click('[data-act="vl-edit"]').catch(() => {});
  check('Arrange it in Customise, on the bar above the page, opens the Nation page section', await until(() => S(page, () => window.__game.S.view === 'customise' && document.getElementById('cz-dock').dataset.sec === 'n')));
  /* the way in from your own Nation page */
  await d.go('nation');
  check('your Nation page offers As others see it', await S(page, () => !!document.querySelector('.id-acts [data-act="vl-preview"]')));
  check('your own factbook marks the lines visitors see blacked out, and shows them to you', await S(page, () => [...document.querySelectorAll('.factbook .cls-tag')].length === 5 && !document.querySelector('.factbook .cls-row')));

  /* another player who classifies its economy, armed forces and cities, and puts its cities first */
  /* (a copy of this nation: its land is this nation's, so its own cities and territory do not draw; its cabinet does) */
  await addPlayer(page, { o: ['cab'].concat(V.def.filter(k => k !== 'cab')), c: ['eco', 'mil', 'cab'] });
  await d.act('visit', { id: 'p2' }); await until(() => S(page, () => window.__game.S.view === 'visit' && window.__game.S.visit === 'p2' && !!document.querySelector('.vs-page')));
  const fv = await visitInfo(page);
  check('their page follows their order: the Cabinet first', fv.secs[0] === 'cab*' && fv.secs[1] === 'fr', fv.secs);
  check('their army and economy are blacked out in the factbook, and the overview', fv.fbHid.join() === 'Army,Average income,Economic output,Income tax,Largest industry,Growth' && fv.ov === 3, fv);
  check('the index strikes through what is classified', fv.nav[0] === 'cab*' && fv.nav.filter(k => k.endsWith('*')).length === 1, fv.nav);
  check('the stamped card offers the operations that read it', fv.ops.includes('g') && fv.ops.includes('m'), fv.ops);
  check('the visitor’s own sections are drawn (not placeholders)', await S(page, () => !!document.querySelector('#vs-rel') && !document.querySelector('.vs-ph')));
  await shot(page, 'visitor');
  /* statistics */
  await d.act('st-open', { id: 'p2' }); await until(() => S(page, () => window.__game.S.view === 'stats'));
  const tab = k => S(page, k => { document.querySelector(`[data-act="st-tab"][data-k="${k}"]`).click(); return new Promise(r => setTimeout(() => r(!!document.querySelector('.st-body .cls-pane')), 400)); }, k);
  check('Economy, Budget & flows and Military are classified tabs', await tab('economy') && await tab('budget') && await tab('military') && !(await tab('people')), await S(page, () => [...document.querySelectorAll('.stab .cls-dot')].map(d => d.parentElement.dataset.k).join()));
  await tab('overview');
  check('the overview tab blacks out output per person, drops the income chart and the money cards', await S(page, () => /Output per person/.test(document.querySelector('.st-tiles').textContent) && !!document.querySelector('.st-tiles .cls-bar') && !!document.querySelector('.st-body .cls-pane') && !!document.querySelector('.lcs') && !/Average income/.test(document.querySelector('.lcs').textContent)));
  await S(page, () => { const G = window.__game; G.S.statsFor = G.S.uid || 'me'; G.S.statsTab = 'military'; G.render(); }); await sleep(400);
  check('your own Military tab lists them last, without a figure', await S(page, () => { const L = [...document.querySelectorAll('.st-body .hb li')], l = L[L.length - 1]; return !!l && l.querySelector('.hb-l').textContent === 'Orvelle' && l.querySelector('.hb-v').textContent === 'Classified'; }));

  /* the Bureau: the planner says what an operation reads */
  await S(page, () => { const G = window.__game; G.S.cvTg = 'p2'; G.S.cvK = 'm'; G.S.ibTab = 'ops'; G.S.cvMsg = ''; }); await d.go('intel');
  check('the planner: bribing a minister also reads their economy and cabinet', /also read their classified economy and cabinet/.test(await S(page, () => (document.querySelector('.cls-plan') || {}).textContent || '')));
  await S(page, () => { const G = window.__game; G.S.cvK = 'd'; G.render(); }); await sleep(300);
  check('the planner: sabotage reads nothing they classify, and says Gather intelligence does', /does not read them; Gather intelligence/.test(await S(page, () => (document.querySelector('.cls-plan') || {}).textContent || '')));
  /* their file: the economy read two days ago, the cabinet nine days ago */
  await d.edit((n, now, G) => { G.VL().clsRead(n, 'p2', ['eco'], now - 2 * 864e5); n.ifl.p2.r.cab = now - 9 * 864e5; });
  await S(page, () => { const G = window.__game; G.S.ibTab = 'files'; G.S.ibFile = 'p2'; G.render(); }); await sleep(300);
  const file = await S(page, () => { const h = [...document.querySelectorAll('.ib-fs')].find(e => /Classified files/.test(e.textContent)); return h ? h.textContent.replace(/\s+/g, ' ') : ''; });
  check('the file lists what was read, open or closed again, and what is still closed', /Economy read .* open until/.test(file) && /Cabinet read .* closed again/.test(file) && /Still closed to you: armed forces and cabinet/.test(file), file);
  await d.act('visit', { id: 'p2' }); await until(() => S(page, () => window.__game.S.view === 'visit' && !!document.querySelector('.vs-page')));
  const rv = await visitInfo(page);
  check('read within 7 days: the economy is open, marked declassified', rv.fbHid.join() === 'Army' && rv.fbTag.length === 5 && rv.ov === 0, rv);
  check('read 9 days ago: the cabinet is closed again', rv.secs[0] === 'cab*', rv.secs);
  await d.edit((n, now, G) => { G.VL().clsRead(n, 'p2', ['cab'], now - 3600e3); });
  const rv2 = await visitInfo(page);
  check('read an hour ago: the cabinet opens, under a Declassified line', rv2.secs[0] === 'cab+' && await S(page, () => !!document.querySelector('#vs-cab .gv-pub') && /Read by your agents .* Open to you until/.test(document.querySelector('#vs-cab .cls-lift').textContent)), rv2.secs);
  await shot(page, 'declassified', false);

  /* a successful gathering reads every topic: launch until one succeeds, with what stops the next cleared each time */
  let launched = null;
  for (let i = 0; i < 12 && !launched; i++) {
    await d.edit(n => { n.cov = []; delete n.ag; if (n.ifl && n.ifl.p2) delete n.ifl.p2.r; n.gw = {}; });
    await S(page, () => { const G = window.__game; G.S.cvTg = 'p2'; G.S.cvK = 'g'; G.S.ibTab = 'ops'; G.S.cvMsg = ''; G.S.cvShow = null; });
    await d.go('intel');
    const b = await page.$('[data-act="cv-launch"]:not([disabled])'); if (!b) break;
    await b.click(); await sleep(500);
    launched = await S(page, () => { const G = window.__game, o = (G.S.nation.cov || [])[0]; return o && G.IB().cvRoll(o).ok ? G.S.nation.ifl.p2.r : null; });
  }
  check('a successful Gather intelligence reads every topic they classify into the file, and only those', !!launched && Object.keys(launched).sort().join() === 'cab,eco,mil' && Object.values(launched).every(t => typeof t === 'number'), launched);

  /* the record is kept clean when it loads */
  await d.edit(n => { n.vl = { o: ['zz', 'leg', 'cit', 'cit', 4], c: ['eco', 'nope', 'eco', null], x: 1 }; n.ifl = Object.assign({}, n.ifl, { p2: Object.assign({}, (n.ifl || {}).p2 || { t: Date.now() }, { r: { eco: Date.now(), BAD: 1, sp: 'x' } }) }); });
  await S(page, () => { const G = window.__game; G.S.mode = 'local'; G.S.world = {}; });
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view); await sleep(500);
  const kept = await S(page, () => ({ vl: window.__game.S.nation.vl, r: ((window.__game.S.nation.ifl || {}).p2 || {}).r }));
  check('after a reload the layout keeps only known sections and topics, once each', JSON.stringify(kept.vl) === JSON.stringify({ o: ['leg', 'cit'], c: ['eco'] }), kept.vl);
  const o2 = (await order(page)).split(',');
  check('the order fills in the sections it left out, each after the one before it by default', o2.length === 18 && new Set(o2).size === 18 && o2.indexOf('leg') < o2.indexOf('cit') && o2.indexOf('prv') === o2.indexOf('cit') + 1 && o2[0] === 'fr', o2);
  check('the file keeps only real read times', JSON.stringify(Object.keys(kept.r || {})) === JSON.stringify(['eco']), kept.r);
  check('no script errors on the desktop', d.errors.length === 0, d.errors);
  await d.ctx.close();

  /* ── a phone, dark ── */
  const p = await start('dark', { width: 390, height: 844 }, { phone: true }), P = p.page;
  /* a toast sliding in from the side widens the page for a moment: they are not what is measured here */
  await P.addStyleTag({ content: '.toast{display:none!important}' });
  await addPlayer(P, { c: ['eco', 'cab'] });
  await p.act('visit', { id: 'p2' }); await until(() => S(P, () => window.__game.S.view === 'visit' && !!document.querySelector('.vs-page')));
  await sleep(600);
  check('phone: the visitor’s page has no sideways scroll', await noOverflow(P), await wide(P));
  check('phone: the redaction tape is dark in the dark theme', await S(P, () => { const c = getComputedStyle(document.querySelector('.cls-bars i')).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 60; }));
  await shot(P, 'phone-visitor');
  await p.act('st-open', { id: 'p2' }); await until(() => S(P, () => window.__game.S.view === 'stats')); await sleep(400);
  await S(P, () => document.querySelector('[data-act="st-tab"][data-k="economy"]').click()); await sleep(500);
  check('phone: a classified Statistics tab has no sideways scroll', await S(P, () => !!document.querySelector('.st-body .cls-pane')) && await noOverflow(P), await wide(P));
  await S(P, () => { const G = window.__game; G.S.mode = 'local'; G.S.world = {}; });
  await p.go('customise/nationpage');
  check('phone: Customise › Nation page has no sideways scroll', await until(() => S(P, () => !!document.getElementById('vl-list'))) && await noOverflow(P), await wide(P));
  await S(P, () => document.getElementById('vl-grip-gf').scrollIntoView({ block: 'center' })); await sleep(300);
  const g = await P.locator('#vl-grip-gf').boundingBox(), t = await P.locator('#vl-grip-dorm').boundingBox(), cdp = await P.context().newCDPSession(P);
  const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: g.x + g.width / 2, y }] });
  await tp('touchStart', g.y + g.height / 2); for (let i = 1; i <= 10; i++) { await tp('touchMove', g.y + g.height / 2 + (t.y - g.y) * i / 10 - 6); await sleep(30); } await tp('touchEnd'); await sleep(500);
  check('phone: a touch drag on the handle moves the section', (await order(P)).endsWith('gf,dorm,cv'), await order(P));
  await shot(P, 'phone-customise', false);
  check('no script errors on the phone', p.errors.length === 0, p.errors);
  await p.ctx.close();
} catch (e) {
  console.log('FAIL the suite stopped:', e && e.stack || e); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
