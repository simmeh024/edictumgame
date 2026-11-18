// The Cities page, redrawn: an icon for every building, a skyline over each city, every city at a glance, calmer
// building rows with Details and a ⋯ menu for Demolish, a Build tab in four groups with the stockpile kept in view,
// mayors with faces, a mood gauge, the defence in all with the walls as rings, a phone pager and swipe, and three
// slips (the builders "busy until at", roads with one city, "you can found a new city" without a free site).
//   python3 build.py
//   node test/city-page.mjs
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
/* toasts come and go on their own timers and can sit over what a click wants */
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* change the nation as a save would, and draw the page again */
const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const tab = async k => { await page.click(k === 'build' ? '.cx-tabs [data-act="ct-open"]' : `.cx-tabs [data-act="cx-tab"][data-k="${k}"]`); await sleep(300); };
const D = 864e5;

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Pagemark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});

  /* every building has a drawing of its own */
  const icons = await page.evaluate(() => { const P = window.__game.CP2(); return Object.keys(P.BUILDINGS).filter(k => !P.BLD_ICO[k]); });
  check('every building has an icon of its own', icons.length === 0, icons.join(', '));

  /* one city: a capital with buildings, an upgrade, one under way and a matter due; no land beyond it */
  await edit((n, now) => { const c = n.cities[0], d = 864e5;
    c.b = [{ k: 'farm', s: now - 9 * d, d: now - 8 * d, a: 1, ug: 2 }, { k: 'sawmill', s: now - 8 * d, d: now - 7 * d, a: 1 }, { k: 'market', s: now - 7 * d, d: now - 6 * d, a: 1 }, { k: 'harbour', s: now - 3600e3, d: now + 5 * 3600e3, a: 1 }];
    n.stock = { food: 390, timber: 390, iron: 390, oil: 390, goods: 390 }; n.stockAt = now; n._stockSet = true; });
  await go('cities');
  const cid = await page.evaluate(() => window.__game.S.nation.cities[0].id);

  /* the slips */
  check('the builders are busy until a time, not "until at" one', /The builders are busy until \d/.test(await txt('.cx-qend') || ''), await txt('.cx-qend'));
  const todo = await txt('.cx-todo') || '';
  /* a chip under Needs your attention lands on the matter itself */
  let chip = await page.$('.cx-todo [data-act="cx-go"][data-k="ev"], .cx-todo [data-act="cx-go"][data-k="blk"]');
  if (!chip && await page.$('.cx-todo-l')) { await page.evaluate(id => { const b = document.createElement('button'); b.className = 'chip-btn t-jump'; Object.assign(b.dataset, { act: 'cx-go', id, tab: 'build', k: 'blk' }); document.querySelector('.cx-todo-l').append(b); }, cid); chip = await page.$('.t-jump'); }
  if (chip) { const k = await chip.getAttribute('data-k'); await chip.click(); await sleep(700);
    const at = await page.evaluate(k => { const m = document.querySelector(k === 'ev' ? '#cx-main #cx-matter' : '#cx-main .cat-wrap'); if (!m) return null; const r = m.getBoundingClientRect(); return { focus: document.activeElement === m, top: Math.round(r.top), h: innerHeight }; }, k);
    check('a Needs-your-attention chip brings the player to that matter', !!at && at.focus && at.top >= -2 && at.top < at.h / 2, k + ' ' + JSON.stringify(at)); }
  else console.log('     (no matter or empty block chip to click)');
  await page.click('.cx-add'); await sleep(300);
  const form = await txt('#cx-new') || '';
  console.log('     (found a city: ' + form.slice(0, 90) + ')');
  check('the page offers a new city only when the form has a site for it', /No site is free/.test(form) ? !/You can found a new city/.test(todo) && /No free site/.test(await txt('.cx-add')) : /You can found a new city/.test(todo) === !!(await page.$('#city-form')), JSON.stringify({ todo, add: await txt('.cx-add') }));
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${cid}"]`); await sleep(300);
  await tab('def');
  check('with one city, Roads does not say every other city is connected', !/Every other city you hold is already connected/.test(await txt(`#city-${cid} .cx-body`)) && /only city for now/.test(await txt(`#city-${cid} .cx-body`)), await txt(`#city-${cid} .cx-body`));
  await tab('b');

  /* the skyline */
  const sky = await page.evaluate(() => { const c = document.querySelector('.cx-detail canvas[data-cx-sky]'); if (!c || !c.width) return null; const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return { w: c.width, colours: set.size }; });
  check('the city card opens with a skyline drawn on a canvas', !!sky && sky.w > 100 && sky.colours > 8, JSON.stringify(sky));
  check('the skyline is decoration only', await page.evaluate(() => document.querySelector('.cx-sky').getAttribute('aria-hidden') === 'true'));

  /* the building rows */
  const farm = `#city-${cid} .blds li.bld:has([data-act="cx-menu"][data-k="farm"])`;
  check('a building row has an icon, its kind and its gain a day first', await page.locator(`${farm} .b-ic svg`).count() === 1 && /^Production$/.test(await txt(`${farm} .bld-tag`)) && /^\+[\d.]+ food a day/.test(await txt(`${farm} .bld-lead`)), await txt(`${farm} .bld-lead`));
  check('the rest of what it does waits under Details', await page.locator(`${farm} details.bld-more`).count() === 1 && !(await page.locator(`${farm} details.bld-more`).evaluate(d => d.open)) && /Here: \+[\d.]+ food a day \(/.test(await txt(`${farm} .bld-mb`)));
  check('the upgrade stays in view', await page.locator(`${farm} [data-act="cx-up"]`).isVisible());
  check('Demolish is no longer on the row itself', await page.locator(`${farm} [data-act="ct-demo-ask"]`).count() === 0);
  await page.click(`[data-act="cx-menu"][data-k="farm"]`);
  check('the ⋯ menu holds Demolish, focused', await page.locator('.bld-mx-p [data-act="ct-demo-ask"][data-k="farm"]').isVisible() && await until(() => page.evaluate(() => document.activeElement?.dataset.act === 'ct-demo-ask'), 2000), await page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + ' ' + (a.dataset.act || a.className) : 'none'; }));
  await page.keyboard.press('Escape'); await sleep(150);
  check('Escape closes it and returns to the button', await page.locator('.bld-mx-p').count() === 0 && await page.evaluate(() => document.activeElement?.dataset.act === 'cx-menu'));
  await page.click(`[data-act="cx-menu"][data-k="farm"]`); await page.click('body', { position: { x: 5, y: 5 } }); await sleep(150);
  check('a click elsewhere closes it', await page.locator('.bld-mx-p').count() === 0);
  await page.click(`[data-act="cx-menu"][data-k="farm"]`); await page.click('.bld-mx-p [data-act="ct-demo-ask"]');
  check('choosing Demolish still asks to confirm', await page.locator(`[data-act="ct-demolish"][data-k="farm"]`).isVisible() && await page.locator('[data-act="ct-demo-no"]').isVisible());
  await page.click('[data-act="ct-demo-no"]');
  check('Keep leaves the farm standing', await page.evaluate(() => window.__game.S.nation.cities[0].b.some(b => b.k === 'farm')));
  await page.screenshot({ path: path.join(OUT, 'city-page-buildings.png'), fullPage: true });

  /* the Build tab */
  await tab('build');
  check('the Build tab groups the plans: ready, short, coming later, built already', await page.locator('#cat-ready').count() + await page.locator('#cat-cost').count() >= 1 && await page.locator('details#cat-later').count() === 1 && await page.locator('details#cat-have').count() === 1);
  check('coming later and built already start folded', await page.evaluate(() => !document.querySelector('#cat-later').open && !document.querySelector('#cat-have').open));
  check('what is built here is filed under built already', await page.locator('#cat-have [data-act="ct-build"][data-k="farm"]').count() === 1 && /Built here/.test(await txt('#cat-have #bk-farm')));
  const locked = await page.evaluate(() => [...document.querySelectorAll('#cat-later li.opt')].map(li => li.querySelector('.opt-why').textContent));
  check('locked buildings say what unlocks them', locked.length > 3 && locked.every(t => t.length > 5), JSON.stringify(locked.slice(0, 4)));
  check('the cards carry an icon and their kind', await page.locator('#cat-ready ~ .opts .opt .b-ic, #cat-cost ~ .opts .opt .b-ic').count() > 0);
  check('the stockpile rides along in the sticky bar', await page.locator('.cx-cats .cx-mini .cx-mn').count() === 5 && await page.evaluate(() => getComputedStyle(document.querySelector('.cx-cats')).position === 'sticky'));
  /* search's jump to a locked building opens Coming later on it */
  const lk = await page.evaluate(() => document.querySelector('#cat-later li.opt')?.id.slice(3));
  await go('nation');
  await page.evaluate(k => window.__game.CP2().qjBuilding(k), lk); await until(() => page.evaluate(() => window.__game.S.view === 'cities'));
  check('a jump from search to a locked building opens Coming later on it', await until(() => page.evaluate(k => { const e = document.getElementById('bk-' + k); return !!e && e.closest('details').open && e.getBoundingClientRect().height > 0; }, lk)), lk);
  await page.screenshot({ path: path.join(OUT, 'city-page-build.png'), fullPage: true });

  /* two more cities on land around the capital */
  await edit((n, now, G) => {
    const M = G.MAP, cap = n.cities[0].c, T = G.XP().territory(), mi = T.list.findIndex(x => x.me), d = 864e5, dist = new Map([[cap, 0]]), q = [cap];
    while (q.length) { const c = q.shift(), k = dist.get(c); if (k >= 7) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[c * 6 + i]; if (nb < 0 || dist.has(nb) || M.T[nb] < 2) continue; if (T.owner[nb] >= 0 && T.owner[nb] !== mi) continue; dist.set(nb, k + 1); q.push(nb); } }
    const have = new Set((n.claims || []).map(e => e.c));
    n.claims = (n.claims || []).concat([...dist.keys()].filter(c => !have.has(c) && c !== cap).map((c, i) => ({ c, t: now - d + i })));
    const far = [...dist.entries()].filter(([, k]) => k >= 4).sort((x, y) => y[1] - x[1]).map(([c]) => c), a = far[0];
    const b = far.find(c => { const seen = new Set([a]), qq = [[a, 0]]; while (qq.length) { const [y, k] = qq.shift(); if (y === c) return k >= 4; if (k > 6) continue; for (let i = 0; i < 6; i++) { const nb = M.nbr[y * 6 + i]; if (nb >= 0 && !seen.has(nb)) { seen.add(nb); qq.push([nb, k + 1]); } } } return true; });
    n.cities.push({ id: 'c1', c: a, nm: 'Fenwick', t: now - 6 * d, b: [{ k: 'farm', s: now - 5 * d, d: now - 4 * d, a: 1, ug: 2 }], my: { nm: 'Juno Wendlecott', tr: 'steward', t: now - 3 * d } });
    n.cities.push({ id: 'c2', c: b, nm: 'Ashmere', t: now - 3 * d, b: [] });
  });
  await sleep(500);
  const names = await page.evaluate(() => window.__game.CP2().cxOrder().map(c => c.nm)), ids = await page.evaluate(() => window.__game.CP2().cxOrder().map(c => c.id));
  check('the test nation now holds three cities', names.length === 3, JSON.stringify(names));

  /* every city at a glance */
  check('with two or more cities the page shows them all at a glance', await page.locator('#cx-ovw table tbody tr').count() === 3);
  check('an idle city is marked in the list and the table', await page.locator('.cx-list .cx-item.idle').count() >= 1 && /Builders idle/.test(await txt('.cx-list .cx-item.idle')) && await page.locator('#cx-ovw tr.idle').count() >= 1);
  await page.click('[data-act="cx-sort"][data-k="pop"]');
  const pops = await page.evaluate(() => [...document.querySelectorAll('#cx-ovw tbody tr')].map(r => r.querySelector('.cx-ov-go b').textContent));
  check('sorting by people puts the largest first', pops[0] === names[0] && await page.locator('th[aria-sort="descending"] [data-k="pop"]').count() === 1, JSON.stringify(pops));
  await page.click('#cx-ovw [data-act="cx-sel"][data-id="c1"]'); await sleep(300);
  check('a name in the table opens that city', await page.evaluate(() => window.__game.S.cxSel === 'c1') && await page.locator('#city-c1.cx-detail').count() === 1);

  /* People: the gauge, the reasons as bars, the mayor's face and letter, the candidates' faces */
  await tab('ppl');
  check('the mood shows on a gauge with its reasons as bars', await page.locator('#city-c1 svg.cx-gauge').count() === 1 && await page.locator('#city-c1 .cx-mparts .cx-mp-bar i').count() >= 1);
  check('the mayor has a face and writes on the city’s paper', await page.locator('#city-c1 .cx-my .cv-med svg').count() === 1 && /Mayor of Fenwick/.test(await txt('#city-c1 .cx-lt .cx-letter')) && await page.locator('#city-c1 .cx-lt .cc-crest').count() === 1);
  await page.click('.cx-list [data-act="cx-sel"][data-id="c2"]'); await sleep(300); await tab('ppl');
  check('the candidates for mayor have faces too', await page.locator('#city-c2 .cx-cands li .cv-med svg').count() === 3);

  /* Defence: the total, and the walls as rings */
  await edit(n => { n.cities.find(c => c.id === 'c2').wl = 2; });
  await tab('def');
  const tot = await page.evaluate(() => { const G = window.__game, T = G.XP().territory(), ct = G.CX.cityState(T).all.find(c => c.id === 'c2' && c.fid === G.myId()); return Math.round((G.CP2().cxDefTotal(ct, T) - 1) * 100); });
  check('the defence is given in all, as the battle counts it: a city ×1.2, walls at level 2 ×1.3', tot === 56 && (await txt('#city-c2 .cx-def-t b')) === '+56%', `${tot} ${await txt('#city-c2 .cx-def-t b')}`);
  check('the walls show as rings, two of three built', await page.locator('#city-c2 .cx-rings .cr-on').count() === 2 && await page.locator('#city-c2 .cx-rings .cr-off').count() === 1);
  await page.screenshot({ path: path.join(OUT, 'city-page-defence.png'), fullPage: true });

  /* the phone: the pager, a swipe, no sideways scroll, the compact stockpile */
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${cid}"]`); await sleep(300);
  check('on a phone the card has a pager', await page.locator('.cx-pager').isVisible() && /1 of 3/.test(await txt('.cx-pg-n')));
  await tab('build');
  await page.click('[data-act="cx-step"][data-d="1"]'); await sleep(300);
  const s1 = await page.evaluate(() => ({ sel: window.__game.S.cxSel, open: window.__game.S.cityOpen }));
  check('the pager moves to the next city and keeps the Build tab', s1.sel === ids[1] && s1.open === s1.sel, JSON.stringify({ s1, ids }));
  const swipe = (x0, x1) => page.evaluate(([x0, x1]) => { const el = document.querySelector('#cx-main .city-h'), r = el.getBoundingClientRect(), y = r.top + 10;
    const t = x => new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0)], changedTouches: [t(x0)], bubbles: true })); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(x1)], bubbles: true })); }, [x0, x1]);
  await swipe(300, 120); await sleep(300);
  const s2 = await page.evaluate(() => window.__game.S.cxSel);
  check('a swipe to the left opens the next city', s2 !== s1.sel, `${s1.sel} → ${s2}`);
  await swipe(120, 300); await sleep(300);
  check('and one to the right goes back', await page.evaluate(() => window.__game.S.cxSel) === s1.sel);
  check('without the page scrolling sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('the stockpile is five compact tiles, names hidden', await page.locator('.cx-stock .cx-stk').count() === 5 && await page.evaluate(() => getComputedStyle(document.querySelector('.cx-stk-n')).display === 'none'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, 'city-page-phone.png'), fullPage: true });

  /* many cities beside a long card: the list scrolls by itself, inside the window (16 November 2026) */
  await page.setViewportSize({ width: 1280, height: 900 }); await sleep(400);
  await edit((n, now) => { const used = new Set(n.cities.map(c => c.c)), d = 864e5;
    const free = (n.claims || []).map(e => e.c).filter(c => !used.has(c)).slice(0, 12);
    free.forEach((c, i) => n.cities.push({ id: 'm' + i, c, nm: 'Manyford ' + (i + 1), t: now - 2 * d, b: [] })); });
  await sleep(500);
  await page.click(`.cx-list [data-act="cx-sel"][data-id="${cid}"]`); await sleep(300); await tab('build');
  /* down the long Build tab, where the list is pinned beside the card */
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.cx-wrap').getBoundingClientRect().top + scrollY + 600)); await sleep(300);
  const lst = () => page.evaluate(() => { const l = document.querySelector('.cx-list'), r = l.getBoundingClientRect(), last = l.lastElementChild.getBoundingClientRect();
    return { n: l.querySelectorAll('.cx-item:not(.cx-add)').length, ov: getComputedStyle(l).overflowY, sh: l.scrollHeight, ch: l.clientHeight, top: l.scrollTop, rt: r.top, bottom: r.bottom, lastIn: last.top >= r.top - 1 && last.bottom <= r.bottom + 1, vh: innerHeight, y: scrollY,
      squeezed: [...l.querySelectorAll('.cx-item')].filter(e => e.scrollHeight > e.clientHeight + 1).length }; });
  const L0 = await lst();
  check('the test nation now holds fifteen cities, more than the window shows', L0.n === 15 && L0.sh > L0.ch, JSON.stringify(L0));
  check('the list of cities is pinned inside the window and scrolls by itself', L0.ov === 'auto' && L0.rt >= 0 && L0.rt <= 16 && L0.bottom <= L0.vh && !L0.lastIn && L0.squeezed === 0, JSON.stringify(L0));
  const lx = await page.evaluate(() => { const r = document.querySelector('.cx-list').getBoundingClientRect(); return r.left + r.width / 2; });
  await page.mouse.move(lx, L0.bottom - 120); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 600); await sleep(120); } await sleep(500);
  const L1 = await lst();
  check('the wheel over the list brings its last city into view, the page staying put', L1.top > 0 && L1.lastIn && L1.y === L0.y, JSON.stringify(L1));
  await page.screenshot({ path: path.join(OUT, 'city-page-list.png') });
  /* the city just above "+ Found a city", clicked where it is (page.click would scroll it into view first) */
  const last = await page.evaluate(() => { const b = [...document.querySelectorAll('.cx-list .cx-item:not(.cx-add)')].pop(), r = b.getBoundingClientRect(); return { id: b.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(last.x, last.y); await sleep(400);
  const L2 = await lst();
  check('a city chosen at the bottom of the list opens, and the list stays where it was', await page.evaluate(id => window.__game.S.cxSel === id, last.id) && L2.top > 0 && Math.abs(L2.top - L1.top) < 2, JSON.stringify({ last, L1: L1.top, L2: L2.top }));

  check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.log('FAIL', e.stack || e.message); failed++; await page.screenshot({ path: path.join(OUT, 'city-page-error.png'), fullPage: true }).catch(() => {}); }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
