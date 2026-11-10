// The Expeditions page (Map › Expeditions): the expedition and the fleeting party side by side, the list of where to
// go next with its odds and filters, the small map (a click on a marker finds it in the list), the expedition out,
// back and its report with the stamp, the naming and the postcard, the register and the logbook, a fleeting party
// sent and heard, a phone's tabs, and the light theme.
//   python3 build.py
//   node test/expeditions-page.mjs
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
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, acceptDownloads: true, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(500); };
  const act = (a, d = {}) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d); document.body.appendChild(b); b.click(); b.remove(); }, [a, d]);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* an established nation, with supplies for a few expeditions */
  await edit(n => { delete n.onb; n.stock = Object.assign({}, n.stock, { food: 400, oil: 200, goods: 200 }); n.stockAt = Date.now(); n._stockSet = true; });
  return { ctx, page, errors, edit, go, act };
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `expeditions-${name}.png`), fullPage: full });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const S = (page, f, a) => page.evaluate(f, a);

try {
  /* ── desktop, dark ── */
  const d = await start('dark', { width: 1280, height: 900 }), { page } = d;
  await d.go('explore');
  check('the page draws with no script errors', d.errors.length === 0, d.errors);
  check('the expedition comes first, the fleeting party beside it', await S(page, () => { const c = [...document.querySelectorAll('.xp-top>.xp-card')]; return c.length === 2 && c[0].classList.contains('xp-exp') && c[1].classList.contains('xp-party'); }));
  check('the stockpile sits under the two cards', await S(page, () => { const t = document.querySelector('.xp-top'), s = document.querySelector('.xp>.stk-strip'); return !!s && t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING; }));
  const base = await S(page, () => { const b = document.querySelector('.xp-exp [data-act="exp-send"]'); return b ? { t: b.textContent, s: +b.dataset.s } : null; });
  check('at base camp, the card offers the best odds within reach', !!base && /^Send to the /.test(base.t), base);
  const rows = await S(page, () => [...document.querySelectorAll('.xp-list .xp-item:not(.xp-fl):not(.xp-tease)')].map(li => ({ pct: li.querySelector('.xp-pct')?.textContent, bar: li.querySelectorAll('.xp-bar i').length, finds: li.querySelectorAll('.xp-rw .xp-pill.rew').length, send: !!li.querySelector('[data-act="exp-send"]') })));
  check('each rumour shows its chance, a bar and what it brings', rows.length > 0 && rows.every(r => /^\d+%$/.test(r.pct) && r.bar >= 1 && r.finds >= 1), rows);
  check('the chance agrees with the odds of the die', await S(page, () => { const X = window.__game.XP(), li = document.querySelector('.xp-list .xp-item:not(.xp-fl):not(.xp-tease)'), si = +li.id.replace('xp-i-s', ''), P = X.expPlan(window.__game.S.nation, si); return li.querySelector('.xp-pct').textContent === X.expOdds(P.mod, P.dc).find + '%'; }));
  check('no rumour is shown more than once', await S(page, () => { const ids = [...document.querySelectorAll('.xp-item')].map(x => x.id); return ids.length === new Set(ids).size; }));
  check('the page has no sideways scroll', await noOverflow(page));
  /* the small map: drawn with its markers */
  check('the small map draws its markers', !!(await until(() => S(page, () => { const c = document.querySelector('canvas[data-xp]'); return c && c._xp && c._xp.length > 0; }))));
  await shot(page, 'desktop-base');
  /* the filters */
  await d.act('xp-f', { v: 'rum' });
  check('Rumours shows only rumours', await S(page, () => !document.querySelector('.xp-list .xp-fl') && document.querySelectorAll('.xp-list .xp-item').length > 0));
  check('and its button is pressed', await S(page, () => document.querySelector('[data-act="xp-f"][data-v="rum"]').getAttribute('aria-pressed') === 'true'));
  await d.act('xp-f', { v: 'fl' });
  check('Fleeting shows no rumours', await S(page, () => !document.querySelector('.xp-list [id^="xp-i-s"]')));
  await d.act('xp-f', { v: 'all' });
  await d.act('xp-near');
  check('In reach only hides what is out of reach', await S(page, () => [...document.querySelectorAll('.xp-list .xp-item')].every(li => !/Out of reach/.test(li.textContent))));
  await d.act('xp-near');
  /* a marker on the small map finds its row */
  await page.evaluate(() => document.querySelector('canvas[data-xp]').scrollIntoView({ block: 'center' })); await sleep(300);
  const hit = await S(page, () => { const c = document.querySelector('canvas[data-xp]'), it = c._xp.find(q => q.id[0] === 's' && document.getElementById('xp-i-' + q.id)); if (!it) return null; const r = c.getBoundingClientRect(); return { x: r.left + it.x, y: r.top + it.y, id: it.id }; });
  if (hit) {
    await page.mouse.click(hit.x, hit.y); await sleep(500);
    const sel = await S(page, () => { const id = window.__game.S.xpSel, el = id && document.getElementById('xp-i-' + id.replace(/[^A-Za-z0-9_-]/g, '-')); return { id, mark: !!el && el.classList.contains('is-sel') }; });
    check('a click on a marker on the small map marks its row', !!sel.id && sel.mark, sel);
    check('and stays on the page', await S(page, () => window.__game.S.view === 'explore'));
  } else check('a rumour in the list is on the small map', false);
  /* the expedition out */
  await page.click('.xp-exp [data-act="exp-send"]'); await sleep(400);
  check('sending it puts the card in the field, with the seal on the die', await S(page, () => /In the field/i.test(document.querySelector('.xp-exp').textContent) && !!document.querySelector('.xp-exp .xp-seal')));
  check('the route is drawn, cut where the party is', await S(page, () => !!document.querySelector('.xp-route .xp-r-done') && !!document.querySelector('.xp-route .xp-r-rest')));
  check('the card gives the chance, never the roll', await S(page, () => { const t = document.querySelector('.xp-exp').textContent; return /\d+% to find it/.test(t) && !/Rolled/.test(t); }));
  check('the shared half says where it went and when it is back', await S(page, () => { const n = window.__game.S.nation; return Array.isArray(n.xb) && n.xb.length === 1 && n.xb[0].s === n.exp.s && n.xb[0].t === n.exp.t1; }));
  check('the rumours say the expedition is out', await S(page, () => /Your expedition is out/.test(document.querySelector('.xp-list').textContent) && !document.querySelector('.xp-list [data-act="exp-send"]')));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'desktop-field', false);
  /* back home, with a 20 */
  await d.edit(n => { n.exp.t0 = Date.now() - 3600e3; n.exp.t1 = Date.now() - 1000; n.exp.r = 20; });
  check('back home: the seal and the button to break it', await S(page, () => !!document.querySelector('.xp-exp [data-act="exp-report"]') && /Back home/i.test(document.querySelector('.xp-exp').textContent)));
  await shot(page, 'desktop-back', false);
  await page.click('.xp-exp [data-act="exp-report"]');
  await until(() => S(page, () => !window.__game.S.expRolling && !!document.querySelector('.xp-stamp')), 6000);
  check('the report spans the row, with its stamp', await S(page, () => document.querySelector('.xp-exp').classList.contains('xp-wide') && /Remarkable discovery/i.test(document.querySelector('.xp-stamp').textContent)));
  check('the roll strip has a pin on the 20', await S(page, () => { const p = document.querySelector('.xp-tk-pin'); return !!p && Math.abs(parseFloat(p.style.left) - 97.5) < 0.1; }));
  check('a first find asks for a name and offers the postcard', await S(page, () => !!document.getElementById('site-form') && !!document.querySelector('.xp-rep [data-act="xp-card"]')));
  check('the shared marker went with the expedition', await S(page, () => !window.__game.S.nation.exp && !window.__game.S.nation.xb));
  await shot(page, 'desktop-report', false);
  await page.fill('#site-name', 'Lampwick Wonder'); await page.click('#site-form button[type="submit"]'); await sleep(400);
  check('the name goes into the register, marked as yours', await S(page, () => { const m = document.querySelector('.xp-disc.mine'); return !!m && /Lampwick Wonder/.test(m.textContent) && /Named by you/.test(m.textContent); }));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('.xp-rep [data-act="xp-card"]')]);
  check('Save the postcard downloads a picture named for the find', !!dl && /^postcard-lampwick-wonder\.png$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
  if (dl) { const f = path.join(OUT, 'expeditions-postcard.png'); await dl.saveAs(f); check('the postcard is a real picture', fs.statSync(f).size > 20000, fs.statSync(f).size); }
  await page.click('.xp-rep [data-act="xp-close"]'); await sleep(300);
  check('closing the report brings base camp back', await S(page, () => /At base camp/i.test(document.querySelector('.xp-exp').textContent) && !document.querySelector('.xp-exp.xp-wide')));
  check('the field guide counts the kind found', await S(page, () => document.querySelectorAll('.xp-kind.on').length === 1));
  check('the logbook lists it', await S(page, () => /Remarkable discovery/i.test(document.querySelector('.xp-lb').textContent)));
  /* a fleeting find in reach: move the clock to one */
  const at = await S(page, () => { const G = window.__game, X = G.XP(), n = G.S.nation, t0 = X.flNow();
    for (let t = t0; t < t0 + 6 * 86400e3; t += 1800e3) for (const s of X.flAlive(t)) { const P = X.flPlan(n, s, t); if (!P.why && P.d <= P.rg) return { t, key: s.key, mins: P.mins }; } return null; });
  if (at) {
    await S(page, t => { window.__game.XP().flDebug({ t }); window.__game.render(); }, at.t); await sleep(300);
    const fi = await S(page, k => { const li = [...document.querySelectorAll('.xp-fl')].find(x => x.querySelector(`[data-k="${k}"]`)); return li ? { odds: !!li.querySelector('.xp-odds'), pips: li.querySelectorAll('.xp-pips i').length, send: !!li.querySelector('[data-act="fl-send"]'), go: li.querySelector('.xp-go').textContent } : { none: [...document.querySelectorAll('.xp-fl')].length, f: window.__game.S.xpF, view: window.__game.S.view, list: document.querySelector('.xp-list') && document.querySelector('.xp-list').textContent.slice(-300) }; }, at.key);
    check('a find in reach has its odds, its places and a Send button', fi.odds && fi.pips === 5 && fi.send, fi);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(k => document.querySelector(`[data-act="fl-send"][data-k="${k}"]`).scrollIntoView({ block: 'center' }), at.key);
    await shot(page, 'desktop-fleeting', false);
    await page.click(`[data-act="fl-send"][data-k="${at.key}"]`); await sleep(300);
    check('the party sets out: its card says it is on the way', await S(page, () => /On the way/i.test(document.querySelector('.xp-party').textContent)));
    await S(page, t => { window.__game.XP().flDebug({ t }); window.__game.render(); }, at.t + at.mins * 60000 + 60000); await sleep(300);
    check('arrived: Hear the report', await S(page, () => !!document.querySelector('.xp-party [data-act="fl-report"]')));
    await page.click('.xp-party [data-act="fl-report"]');
    await until(() => S(page, () => !window.__game.S.flRolling && !!document.querySelector('.xp-party .xp-stamp')), 6000);
    check('the party’s report spans the row, with its tier', await S(page, () => document.querySelector('.xp-party').classList.contains('xp-wide') && !!document.querySelector('.xp-party .xp-tk-pin')));
    await page.evaluate(() => document.querySelector('.xp-party').scrollIntoView({ block: 'start' }));
    await shot(page, 'desktop-party-report', false);
    await page.click('.xp-party [data-act="fl-done"]'); await sleep(300);
    check('closing it folds the card back', await S(page, () => !document.querySelector('.xp-party.xp-wide')));
    check('the logbook lists the party', await S(page, () => document.querySelectorAll('.xp-lb li').length >= 2));
  } else console.log('skip: no fleeting find came within reach in six days');
  check('still no script errors', d.errors.length === 0, d.errors);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'desktop-after');
  await d.ctx.close();

  /* ── the outfitters: a block in the workshop, buildings that open the next ones, lost places, a second team ── */
  const o = await start('dark', { width: 1280, height: 900 }), op = o.page;
  await o.edit(n => { n.stock = Object.assign({}, n.stock, { food: 900, timber: 900, iron: 900, oil: 400, goods: 900 }); n.stockAt = Date.now(); n._stockSet = true; });
  await o.go('explore');
  check('outfitters: the card sits above the small map', await S(op, () => { const s = document.querySelector('.xp-side'); return !!s && s.firstElementChild.id === 'xu' && !!s.querySelector('canvas[data-xp]'); }));
  check('outfitters: every requirement named in it is a real building', await S(op, () => { const X = window.__game.XP(); return X.XU_KEYS.every(k => X.XU[k].req.every(q => !q || q.k.every(b => !!X.BUILDINGS[b]))); }));
  check('outfitters: eight upgrades, the grey of trekking gear open to everyone', await S(op, () => { const rows = document.querySelectorAll('.xu-row'); const b = document.querySelector('[data-act="xu-up"][data-k="gear"]'); return rows.length === 8 && !!b && b.getAttribute('aria-disabled') !== 'true'; }));
  check('outfitters: Old maps needs a Map Room, and says so', await S(op, () => { const b = document.querySelector('[data-act="xu-up"][data-k="maps"]'); const row = b && b.closest('.xu-row'); return !!b && b.getAttribute('aria-disabled') === 'true' && /Needs a Map Room/.test(row.textContent); }));
  await op.click('[data-act="xu-up"][data-k="gear"]'); await sleep(300);
  check('outfitters: the first block goes into the workshop, and is paid for', await S(op, () => { const n = window.__game.S.nation; return n.xuw && n.xuw.k === 'gear' && n.xuw.u === 1 && /In the workshop/.test(document.querySelector('.xu').textContent); }));
  check('outfitters: one at a time: every other Upgrade waits', await S(op, () => [...document.querySelectorAll('[data-act="xu-up"]')].every(b => b.getAttribute('aria-disabled') === 'true')));
  await o.edit(n => { n.xuw.s -= 7200e3; n.xuw.d = Date.now() - 1000; });
  await o.edit(() => {});
  check('outfitters: when its time is up it is fitted on the next save', await S(op, () => { const n = window.__game.S.nation; return !n.xuw && n.xu && n.xu.gear === 1 && n.xul && n.xul.k === 'gear'; }));
  check('outfitters: the gear lifts the roll in farmland and hills', await S(op, () => { const X = window.__game.XP(), n = window.__game.S.nation; return X.SITES.some((s, i) => !s.lost && X.expPlan(n, i).parts.some(p => p[0] === 'trekking gear' && p[1] === 1)); }));
  check('outfitters: green needs a Sawmill, and says so', await S(op, () => { const b = document.querySelector('[data-act="xu-up"][data-k="gear"]'), row = b.closest('.xu-row'); return b.getAttribute('aria-disabled') === 'true' && /Needs a Sawmill/.test(row.textContent) && !!row.querySelector('.xu-need.no'); }));
  await o.edit((n, now) => { const c = n.cities[0]; c.b = (c.b || []).concat({ k: 'sawmill', s: now - 7200e3, d: now - 3600e3 }, { k: 'maproom', s: now - 7200e3, d: now - 3600e3 }); });
  check('outfitters: with a Sawmill built, green opens, naming the city', await S(op, () => { const b = document.querySelector('[data-act="xu-up"][data-k="gear"]'), row = b.closest('.xu-row'); return b.getAttribute('aria-disabled') !== 'true' && !!row.querySelector('.xu-need.ok') && /has one/.test(row.textContent); }));
  check('outfitters: and the Map Room opens Old maps', await S(op, () => { const b = document.querySelector('[data-act="xu-up"][data-k="maps"]'); return b.getAttribute('aria-disabled') !== 'true'; }));
  check('lost places: hidden until the old maps show their kind', await S(op, () => { const X = window.__game.XP(), L = X.SITES.map((s, i) => i).filter(i => X.SITES[i].lost); return L.length > 0 && L.every(i => !X.xpSeen(i)); }));
  await o.edit(n => { n.xu = Object.assign({}, n.xu, { maps: 1 }); });
  check('lost places: grey shows the pirate coves, and only them', await S(op, () => { const X = window.__game.XP(), L = X.SITES.map((s, i) => i).filter(i => X.SITES[i].lost); return L.every(i => X.xpSeen(i) === (X.SITES[i].k === 'cove')); }));
  check('lost places: a cove within reach is listed in gold, or the teaser counts the rest', await S(op, () => !!document.querySelector('.xp-item.xp-lost') || !!document.querySelector('.xp-tease') || !document.querySelector('.xp-list')));
  await o.edit(n => { n.xu = Object.assign({}, n.xu, { team: 1 }); });
  check('second team: the card names both teams', await S(op, () => /Your expeditions/.test(document.querySelector('.xp-exp .xp-hd').textContent) && !!document.querySelector('.xp-t2')));
  await op.click('.xp-exp .xp-acts [data-act="exp-send"]'); await sleep(300);
  check('second team: the first sets out, the second offers the next best', await S(op, () => !!window.__game.S.nation.exp && !!document.querySelector('.xp-t2 [data-act="exp-send"]')));
  await op.click('.xp-t2 [data-act="exp-send"]'); await sleep(300);
  check('second team: both out at once, to different places, and the shared half names both', await S(op, () => { const n = window.__game.S.nation; return !!n.exp && !!n.exp2 && n.exp.s !== n.exp2.s && Array.isArray(n.xb) && n.xb.length === 2; }));
  check('second team: with both out, the rumours say so', await S(op, () => /Both your teams are out/.test(document.querySelector('.xp-list').textContent)));
  await o.edit(n => { n.exp2.t0 -= 7200e3; n.exp2.t1 = Date.now() - 1000; });
  check('second team: home first, with its own button', await S(op, () => !!document.querySelector('.xp-t2 [data-act="exp-report"][data-t="2"]')));
  await op.click('.xp-t2 [data-act="exp-report"]');
  await until(() => S(op, () => !window.__game.S.expRolling && !!document.querySelector('.xp-stamp')), 6000);
  check('second team: its report says whose it is, and the first team is still out', await S(op, () => /The second team’s report/.test(document.querySelector('.xp-exp').textContent) && !!window.__game.S.nation.exp && !window.__game.S.nation.exp2));
  await op.evaluate(() => document.querySelector('.xu').scrollIntoView({ block: 'start' }));
  await shot(op, 'desktop-outfitters', false);
  /* the Cities page says what a building opens */
  await o.go('cities');
  check('Cities: a building says what it opens at the outfitters', await S(op, () => [...document.querySelectorAll('.xp-bnote')].some(e => /For explorers: opens .* at the outfitters/.test(e.textContent))));
  check('outfitters: no script errors', o.errors.length === 0, o.errors);
  await o.ctx.close();

  /* ── a phone, dark: tabs, the party's line ── */
  const p = await start('dark', { width: 390, height: 844 }, { phone: true });
  await p.go('explore');
  check('phone: the tabs show, the register waits behind its tab', await S(p.page, () => getComputedStyle(document.querySelector('.xp-tabs')).display !== 'none' && getComputedStyle(document.querySelector('.xp-s-reg')).display === 'none'));
  check('phone: an idle party is one line on the expedition’s card', await S(p.page, () => getComputedStyle(document.querySelector('.xp-party')).display === 'none' && getComputedStyle(document.querySelector('.xp-pline')).display !== 'none'));
  check('phone: no sideways scroll', await noOverflow(p.page));
  await shot(p.page, 'phone-next');
  await p.page.click('[data-act="xp-tab"][data-v="reg"]'); await sleep(300);
  check('phone: the Register tab shows the register only', await S(p.page, () => getComputedStyle(document.querySelector('.xp-s-reg')).display !== 'none' && getComputedStyle(document.querySelector('.xp-s-next')).display === 'none'));
  await shot(p.page, 'phone-register');
  check('phone: no script errors', p.errors.length === 0, p.errors);
  await p.ctx.close();

  /* ── desktop, light ── */
  const l = await start('light', { width: 1280, height: 900 });
  await l.go('explore');
  check('light: draws with no script errors', l.errors.length === 0, l.errors);
  await shot(l.page, 'desktop-light');
  await l.ctx.close();
} catch (e) { console.error(e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
