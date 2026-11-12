// UX polish, round two (2026-11-12): the founding name box and its one region box, an open edict's place on the desk
// and its keys, search reaching buildings, achievements, help and things to do, the phone's All pages sheet, Statistics
// in groups, tab rows that scroll sideways, the one picker for a new letter, and page introductions that fold.
//   python3 build.py
//   node test/ux-polish-2.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the test
// probe. Screenshots go to test/out/.
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

/* a fresh browser on the founding page */
async function fresh(viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: opt.theme || 'dark', ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  if (opt.seed) await page.addInitScript(s => { if (!sessionStorage.getItem('uxp2-seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('uxp2-seeded', '1'); } }, opt.seed);
  await page.goto(BASE);
  await page.waitForSelector('#d-name');
  return { ctx, page, errors };
}
/* founded, settled, with a full desk of edicts */
async function start(viewport, opt = {}) {
  const t = await fresh(viewport, opt), { page } = t;
  await page.fill('#d-name', opt.name || 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const go = async v => { await ev(v => { location.hash = '#' + v; }, v); await until(() => ev(v => window.__game.S.view === v, v)); await sleep(350); };
  const act = a => ev(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
  await go('map'); await act('map-suggest'); await act('settle'); await until(() => ev(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await ev(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* a desk of five: the edict clock wound back ten days */
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.issueClock = Date.now() - 10 * 86400e3; G.syncInbox(n, Date.now()); G.commit(n); G.render(); });
  return { ...t, ev, go, act };
}
const U = (page, f, a) => page.evaluate(([src, a]) => (0, eval)('(' + src + ')')(window.__game.UXP2(), window.__game, a), [f.toString(), a]);
const blur = page => page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });

try {
  /* ── 1, 2. the founding page: a suggested name is replaced by typing; one region box ── */
  {
    const { ctx, page, errors } = await fresh({ width: 1280, height: 900 });
    const sug = await page.inputValue('#d-name');
    await page.click('#d-name'); await page.keyboard.type('Polishia');
    check('a click on the suggested name selects it, so typing replaces it', await page.inputValue('#d-name') === 'Polishia', [sug, await page.inputValue('#d-name')]);
    await page.click('#d-motto'); await page.click('#d-name'); await page.keyboard.type('x');
    check('a name the player typed is not selected again', await page.inputValue('#d-name') === 'Polishiax');
    await page.click('[data-act="suggest-name"]'); const s2 = await page.inputValue('#d-name');
    await page.click('#d-motto'); await page.click('#d-name'); await page.keyboard.type('Ostmark');
    check('after Suggest, the new suggestion is selected again', s2 !== 'Polishiax' && await page.inputValue('#d-name') === 'Ostmark', s2);
    check('the form has four sections: the region is no longer section V', await page.$$eval('.found-form .fs-l', l => l.map(x => x.textContent.replace(/Optional/, '').trim().replace(/^[IVX]+/, '')).join('|')) === 'Name|Particulars|Flag|Founding principles');
    check('one region box, with the first edict’s line', await page.$$eval('.fr-box', b => b.length) === 1 && /your first edict/.test(await page.textContent('.fr-box .fr-first')));
    await page.click('.fr-box [data-act="found-browse"]');
    check('the region maps open inside the box: every region', await until(() => page.$$eval('.fr-box .fr-grid .wr-card', c => c.length === 27)));
    await page.locator('.fr-box').screenshot({ path: path.join(OUT, 'uxp2-region-box.png') });
    await page.click('.fr-box [data-act="found-browse"]');
    check('and close again', await until(() => page.$$eval('.fr-grid', g => g.length === 0)));
    check('founding page: no page errors', !errors.length, errors);
    await ctx.close();
  }

  /* ── 4, 5. along the desk, by button, key and swipe; the list of keys ── */
  const t = await start({ width: 1280, height: 900 }), { page } = t;
  await t.go('edicts');
  const desk = () => U(page, (X, G) => X.edictDesk(G.syncInbox(G.S.nation, Date.now())).map(x => x.id));
  const d0 = await desk();
  check('a desk of five edicts to move along', d0.length === 5, d0.length);
  await blur(page); await page.keyboard.press('n');
  check('N on the list opens the next unread edict', await until(() => t.ev(() => !!window.__game.S.openIssue)));
  check('the open edict says where it stands on the desk', /Edict 1 of 5 on your desk/.test(await page.textContent('.edict-nav')), await page.textContent('.edict-nav'));
  check('the first has no edict before it', await page.isDisabled('.edict-nav .ed-step >> nth=0'));
  await page.screenshot({ path: path.join(OUT, 'uxp2-edict-desk.png') });
  await page.click('.edict-nav .ed-step[data-step="1"]');
  check('Next opens the second edict on the desk', await until(async () => (await t.ev(() => window.__game.S.openIssue)) === d0[1]) && /Edict 2 of 5/.test(await page.textContent('.edict-nav')));
  await blur(page); await page.keyboard.press('ArrowRight');
  check('→ opens the third', await until(async () => (await t.ev(() => window.__game.S.openIssue)) === d0[2]));
  await blur(page); await page.keyboard.press('ArrowLeft');
  check('← goes back to the second', await until(async () => (await t.ev(() => window.__game.S.openIssue)) === d0[1]));
  const before = await t.ev(() => window.__game.S.nation.answered.length);
  await blur(page); await page.keyboard.press('1');
  check('1 picks motion I: its button takes the focus and says how to vote', await until(() => t.ev(() => document.activeElement.matches('[data-act="answer"][data-o="0"].ed-armed') && !!document.querySelector('.ed-armed + .ed-arm-t'))));
  check('and nothing is decided yet', await t.ev(() => window.__game.S.nation.answered.length) === before && await t.ev(() => !window.__game.S.result));
  await page.screenshot({ path: path.join(OUT, 'uxp2-edict-armed.png') });
  await page.keyboard.press('Escape');
  check('Esc puts the choice down, still on the edict', await until(() => t.ev(() => !document.querySelector('.ed-armed') && !!window.__game.S.openIssue)));
  await blur(page); await page.keyboard.press('v');
  check('V picks the veto', await until(() => t.ev(() => document.activeElement.matches('.issue-foot [data-act="dismiss"].ed-armed'))));
  await page.keyboard.press('2');
  check('another key picks something else instead', await until(() => t.ev(() => document.activeElement.matches('[data-act="answer"][data-o="1"].ed-armed') && !document.querySelector('.issue-foot .ed-armed'))));
  const motions = await page.$$eval('.paper.edict [data-act="answer"][data-o]', b => b.length);
  check('the line of keys fits this edict: one key per motion, and the veto', new RegExp(`Keys: 1–${motions} vote · V veto`).test(await page.textContent('.paper.edict .edict-keyline')), [motions, await page.textContent('.paper.edict .edict-keyline')]);
  await page.keyboard.press('2');
  check('the same key again votes', await until(() => t.ev(() => !!window.__game.S.result)) && await t.ev(() => window.__game.S.nation.answered.at(-1).o) === 1);
  await blur(page); await page.keyboard.press('n');
  check('N on a decided edict opens the next one', await until(() => t.ev(() => !!window.__game.S.openIssue && !window.__game.S.result)));
  const pinned = await t.ev(() => window.__game.S.openIssue);
  await blur(page); await page.keyboard.press('p');
  check('P pins the open edict', await until(() => t.ev(id => !!(window.__game.S.nation.inbox.find(x => x.id === id) || {}).pin, pinned)));
  await blur(page); await page.keyboard.press('Escape');
  check('Esc goes back to the list', await until(() => t.ev(() => !window.__game.S.openIssue && window.__game.S.view === 'issues')));
  await blur(page); await page.keyboard.press('?');
  check('? opens the list of keys, its Close button focused', await until(() => t.ev(() => !!document.querySelector('.keys-modal') && document.activeElement.closest('.keys-modal'))));
  check('the list covers edicts, the maps and search', /An open edict/.test(await page.textContent('.keys-modal')) && /A map/.test(await page.textContent('.keys-modal')) && /Search the game/.test(await page.textContent('.keys-modal')));
  await page.screenshot({ path: path.join(OUT, 'uxp2-keys.png') });
  await page.keyboard.press('Escape');
  check('Esc closes it', await until(() => t.ev(() => !document.querySelector('.keys-modal'))));
  /* keys never act while the player types */
  await t.go('messages'); await page.click('#dm-to'); await page.keyboard.type('?1n');
  check('typing in a box is only typing', await page.inputValue('#dm-to') === '?1n' && await t.ev(() => !document.querySelector('.keys-modal') && window.__game.S.view === 'messages'));
  await page.fill('#dm-to', ''); await page.keyboard.press('Escape');

  /* ── 7. search: buildings, achievements, help, edicts on the desk, things to do ── */
  const items = q => U(page, (X, G, q) => X.qjItems(q).map(x => x.v), q);
  const gran = await items('gran');
  check('“gran” finds the Granary among the buildings', gran.includes('bld:granary'), gran);
  check('and stays short: at most six achievements', gran.filter(v => v.startsWith('ach:')).length <= 6);
  check('an achievement by name', (await items('grand tour')).includes('ach:pass-25'));
  check('a section of How to play', (await items('migration')).includes('help:mig'));
  check('things to do: found a city, holiday, keys', (await items('found a')).includes('do:city') && (await items('holiday')).includes('do:away') && (await items('keyboard')).includes('do:keys'));
  const wait1 = await t.ev(() => { const G = window.__game, X = G.UXP2(), n = G.S.nation, x = G.syncInbox(n, Date.now()).inbox.find(x => !x.pin); return x ? [x.id, X.fill(X.ISSUE_BY_ID[x.id].t, n, x)] : null; });
  check('an edict waiting on the desk, by its title', (await items(wait1[1].slice(0, 12))).includes('edict:' + wait1[0] + '|' + (await t.ev(id => window.__game.syncInbox(window.__game.S.nation, Date.now()).inbox.find(x => x.id === id).at, wait1[0]))), wait1);
  const secret = await U(page, (X, G) => { const a = X.ACH.find(a => a.sec && !(G.S.nation.ach || {})[a.id]); return a ? a.n : ''; });
  check('a secret achievement stays secret', !!secret && !(await items(secret)).some(v => v.startsWith('ach:')), secret);
  const pick = async (q, v) => { await blur(page); await page.keyboard.press('/'); await page.waitForSelector('#qj-in'); await page.fill('#qj-in', q); await page.click(`.qj-o[data-v="${v}"]`); await sleep(900); };
  await blur(page); await page.keyboard.press('/'); await page.waitForSelector('#qj-in'); await page.fill('#qj-in', 'gran'); await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'uxp2-search-gran.png') });
  await page.click('.qj-o[data-v="bld:granary"]'); await sleep(900);
  check('choosing the Granary opens a city’s Build tab at the Granary', await until(() => t.ev(() => window.__game.S.view === 'cities' && document.activeElement.id === 'bk-granary')));
  await pick('grand tour', 'ach:pass-25');
  check('choosing an achievement opens it on the Achievements page', await until(() => t.ev(() => window.__game.S.view === 'achievements' && document.activeElement.id === 'ach-pass-25')));
  await pick('migration', 'help:mig');
  check('choosing a help section opens How to play there', await until(() => t.ev(() => window.__game.S.view === 'help' && document.activeElement.id === 'hh-mig')));
  await pick('holiday', 'do:away');
  check('“Go on holiday” opens the holiday box in Settings', await until(() => t.ev(() => window.__game.S.view === 'settings' && document.activeElement.id === 'away-box')));
  await pick('keyboard', 'do:keys');
  check('“Keyboard keys” opens the list of keys', await until(() => t.ev(() => !!document.querySelector('.keys-modal'))));
  await page.keyboard.press('Escape');

  /* ── 9. Statistics in groups, the last tab remembered ── */
  await t.go('stats');
  const vis = () => page.$$eval('.st-tabs .stab', b => b.filter(x => !x.hidden).map(x => x.dataset.k));
  check('five groups in the first row', (await page.$$eval('.st-groups .stab', b => b.map(x => x.textContent.trim()))).join('|') === 'Summary|People|Economy|State|The Bureau ★');
  check('the second row holds only the open group’s tabs', JSON.stringify(await vis()) === JSON.stringify(['overview', 'factbook', 'timeline', 'trends']), await vis());
  await page.click('[data-act="st-grp"][data-g="eco"]');
  check('a group opens on its first tab', await until(async () => JSON.stringify(await vis()) === JSON.stringify(['economy', 'budget', 'forecast']) && await t.ev(() => window.__game.S.statsTab === 'economy')));
  await page.click('[data-act="st-tab"][data-k="budget"]');
  await page.click('[data-act="st-grp"][data-g="bureau"]');
  check('a group of one tab has no second row', await until(() => t.ev(() => window.__game.S.statsTab === 'bureau' && getComputedStyle(document.querySelector('.st-tabs')).display === 'none')));
  await page.click('[data-act="st-grp"][data-g="eco"]');
  check('coming back to a group opens the tab used last in it', await until(() => t.ev(() => window.__game.S.statsTab === 'budget')));
  await page.screenshot({ path: path.join(OUT, 'uxp2-stats-groups.png') });
  check('a hidden tab still opens by its link', await t.ev(() => { document.querySelector('[data-act="st-tab"][data-k="military"]').click(); return window.__game.S.statsTab === 'military'; }) && await until(async () => (await vis()).includes('military')));
  await page.click('[data-act="st-grp"][data-g="eco"]'); await page.click('[data-act="st-tab"][data-k="forecast"]');
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation);
  await t.go('nation'); await t.go('stats');
  check('a new visit opens Statistics on the tab used last', await until(() => t.ev(() => window.__game.S.statsTab === 'forecast')));

  /* ── 11. one picker for a new letter ── */
  await t.go('messages');
  check('an empty thread pane suggests nations to write to', await page.$$eval('.dm-sug-b', b => b.length) >= 1);
  await page.click('#dm-to');
  check('the picker opens on focus, in groups, each nation with its flag', await until(() => t.ev(() => document.getElementById('dm-to').getAttribute('aria-expanded') === 'true' && document.querySelectorAll('.dm-pk-o .mflag').length >= 8 && document.querySelectorAll('.dm-pk-h').length >= 1)));
  await page.screenshot({ path: path.join(OUT, 'uxp2-letter-picker.png') });
  const all = await page.$$eval('.dm-pk-o', o => o.length);
  await page.keyboard.type('ka');
  check('typing narrows the list', await until(async () => { const v = await page.$$eval('.dm-pk-o', o => o.length); return v >= 1 && v < all; }));
  await page.keyboard.press('Escape');
  check('Esc closes the list and keeps the text', await until(() => t.ev(() => !document.getElementById('dm-pk-l'))) && await page.inputValue('#dm-to') === 'ka');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const second = await page.getAttribute('#dm-pk-l .dm-pk-o.on', 'data-id').catch(() => null);
  await page.keyboard.press('Enter');
  check('↓ and Enter choose a nation and open its thread, the letter box focused', !!second && await until(() => t.ev(id => window.__game.S.msgPeer === id && document.activeElement.id === 'dm-text', second)), second);
  check('and the picker is empty again', await page.inputValue('#dm-to') === '');
  await page.fill('#dm-text', 'Greetings.'); await page.click('#dm-form button[type="submit"]'); await sleep(400);
  await t.ev(() => { window.__game.S.msgPeer = null; window.__game.render(); });
  await page.click('#dm-to');
  check('a nation written to comes first, under “Written to lately”', await until(() => t.ev(id => { const h = document.querySelector('.dm-pk-h'), o = document.querySelector('.dm-pk-o'); return h && /Written to lately/.test(h.textContent) && o.dataset.id === id; }, second)));
  await page.click(`#dm-pk-l .dm-pk-o[data-id="${second}"]`);
  check('a click chooses too', await until(() => t.ev(id => window.__game.S.msgPeer === id, second)));

  /* ── 13. introductions: none folded on a new device; folded once a page is known ── */
  await t.go('region');
  check('a page seen only now keeps its introduction open', await t.ev(() => !document.querySelector('#main .vh.vh-fold')));
  const seen = await t.ev(() => JSON.parse(localStorage.getItem('edictum.vhSeen') || '{}'));
  check('visits are counted per page, at most once an hour', seen.region && seen.region.n === 1);
  await t.go('map'); await t.go('region');
  check('a second visit within the hour does not count', (await t.ev(() => JSON.parse(localStorage.getItem('edictum.vhSeen')).region.n)) === 1);
  check('this page’s introduction runs over a line (or the test proves nothing)', await t.ev(() => { const p = document.querySelector('#main .vh h1~p'); return !!p && p.getBoundingClientRect().height > 30; }));
  check('no page errors along the way', !t.errors.length, t.errors);
  await t.ctx.close();

  const old = { 'edictum.vhSeen': JSON.stringify({ region: { n: 5, t: Date.now() - 2 * 3600e3 } }) };
  const f = await start({ width: 1280, height: 900 }, { seed: old, name: 'Foldham' });
  await f.go('region');
  check('a page opened on five visits folds its introduction to one line, with More', await until(() => f.ev(() => { const h = document.querySelector('#main .vh'), p = h && h.querySelector('h1~p'); return h.classList.contains('vh-fold') && p.getBoundingClientRect().height < 30 && /More/.test(h.querySelector('.vh-more').textContent); })));
  await f.page.locator('#main .vh').screenshot({ path: path.join(OUT, 'uxp2-intro-folded.png') });
  await f.page.click('#main .vh-more');
  check('More opens it, and Less is offered', await until(() => f.ev(() => !document.querySelector('#main .vh.vh-fold') && /Less/.test(document.querySelector('#main .vh-more').textContent))));
  await f.go('map'); await f.go('region');
  check('it stays open on the next visit', await f.ev(() => !document.querySelector('#main .vh.vh-fold')));
  await f.page.click('#main .vh-more');
  check('Less folds it again', await until(() => f.ev(() => !!document.querySelector('#main .vh.vh-fold'))));
  check('no page errors', !f.errors.length, f.errors);
  await f.ctx.close();

  /* ── 8, 10, 5. a phone: the All pages sheet, tab rows that scroll, a swipe along the desk ── */
  const p = await start({ width: 375, height: 812 }, { phone: true, name: 'Pocketa' });
  for (const v of ['nation', 'cities', 'stats']) await p.go(v);
  await p.go('map');
  check('phone: the Map page’s tab row fades on the right, where more tabs wait', await until(() => p.ev(() => { const r = document.querySelector('.map-tabs'); return r && r.scrollWidth > r.clientWidth && r.classList.contains('sx-r') && !r.classList.contains('sx-l'); })));
  await p.ev(() => { const r = document.querySelector('.map-tabs'); r.scrollLeft = r.scrollWidth; });
  check('phone: scrolled to its end, it fades on the left instead', await until(() => p.ev(() => { const r = document.querySelector('.map-tabs'); return r.classList.contains('sx-l') && !r.classList.contains('sx-r'); })));
  await p.page.click('#tab-more');
  check('phone: the sheet opens with a search box and the pages opened lately', await until(() => p.ev(() => !!document.querySelector('#more-sheet .more-search') && [...document.querySelectorAll('.more-rec .more-b')].map(b => b.dataset.v).join().startsWith('stats,cities,nation'))), await p.ev(() => [...document.querySelectorAll('.more-rec .more-b')].map(b => b.dataset.v)));
  await sleep(300); await p.page.screenshot({ path: path.join(OUT, 'uxp2-phone-sheet.png') });
  await p.page.click('#more-sheet .more-search');
  check('phone: the search box opens search, the sheet closed', await until(() => p.ev(() => !!document.querySelector('.qj-modal') && !document.getElementById('more-sheet') && document.activeElement.id === 'qj-in')));
  await p.page.keyboard.press('Escape');
  await p.go('stats'); await p.ev(() => document.querySelector('[data-act="st-grp"][data-g="ppl"]').click()); await sleep(200);
  await p.ev(() => document.querySelector('[data-act="st-tab"][data-k="culture"]').click()); await sleep(300);
  check('phone: the open tab is scrolled into view after a redraw', await until(() => p.ev(() => { const r = document.querySelector('.st-tabs').getBoundingClientRect(), o = document.querySelector('.st-tabs .stab.on').getBoundingClientRect(); return o.left >= r.left - 1 && o.right <= r.right + 1; })));
  await p.page.screenshot({ path: path.join(OUT, 'uxp2-phone-stats.png') });
  await p.go('edicts');
  await p.ev(() => { const G = window.__game, d = G.UXP2().edictDesk(G.syncInbox(G.S.nation, Date.now())); G.UXP2().edictOpen(d[0].id, d[0].at); });
  await until(() => p.ev(() => !!window.__game.S.openIssue));
  const first = await p.ev(() => window.__game.S.openIssue);
  const swipe = (dx) => p.ev(dx => { const el = document.querySelector('.paper.edict .issue-q'), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 10;
    const T = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [T(x)], changedTouches: [T(x)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [T(x + dx)] })); }, dx);
  await swipe(-140);
  check('phone: a swipe to the left opens the next edict on the desk', await until(async () => { const id = await p.ev(() => window.__game.S.openIssue); return id && id !== first; }));
  await p.page.screenshot({ path: path.join(OUT, 'uxp2-phone-edict.png') });
  await swipe(140);
  check('phone: a swipe to the right goes back', await until(async () => (await p.ev(() => window.__game.S.openIssue)) === first));
  check('phone: no sideways scroll on the page', await p.ev(() => document.documentElement.scrollWidth <= innerWidth));
  check('phone: no page errors', !p.errors.length, p.errors);
  await p.ctx.close();
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
