// The income forecast in the browser: the line in the stockpile breakdown (with nothing under way, and with work
// under way), its link to Statistics › Income forecast, the tab itself, that the forecast leaves the nation exactly
// as it was, and that its figures match the nation once the works really are done. Light, dark and a phone.
//   python3 build.py
//   node test/income-forecast.mjs
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

/* a founded, settled nation */
async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Ledgermere');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = (a, data = {}) => page.evaluate(([a, data]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, data); document.body.appendChild(b); b.click(); b.remove(); }, [a, data]);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  /* the one-time gift for the fiftieth player, or the recovery code, may open over the page: put them aside */
  await page.evaluate(() => { for (const b of document.querySelectorAll('[role="dialog"] button')) if (/^(Later|I have saved it)$/i.test(b.textContent.trim())) b.click(); });
  return { ctx, page, errors, edit, go, act };
}
/* work under way in the capital: a finished Farm Estates getting its grey upgrade (done in 2 h), a Sawmill going up
   (done in 1 h) and a Warehouse queued behind it (done in 3 h) */
const SETUP = (n, now) => {
  const c = n.cities[0];
  c.b = (c.b || []).filter(b => !['farm', 'sawmill', 'warehouse'].includes(b.k));
  c.b.push({ k: 'farm', s: now - 7200e3, d: now - 3600e3, a: 1, uu: { u: 1, s: now - 60e3, d: now + 2 * 3600e3 } });
  c.b.push({ k: 'sawmill', s: now - 60e3, d: now + 3600e3 });
  c.b.push({ k: 'warehouse', s: now + 3600e3, d: now + 3 * 3600e3 });
};

{
  const { ctx, page, errors, edit, go, act } = await start('light', { width: 1280, height: 900 });
  /* nothing under way */
  const none = await page.evaluate(() => { const G = window.__game, P = G.IFC().plan(G.S.nation); return { works: P && P.works.length, line: G.IFC().line(G.S.nation, 'food') }; });
  check('with nothing under way the plan is empty', none.works === 0, none);
  check('…and the breakdown line says no upgrades are under way, with the link', /No upgrades are under way/.test(none.line) && /data-act="ifc-go"/.test(none.line), none.line);
  await go('cities');
  await act('res-bd', { r: 'food' });
  const modal0 = await page.evaluate(() => { const p = document.querySelector('#rbd-root .rbd-fc'); return p ? p.textContent : null; });
  check('the food breakdown shows the line', modal0 && /No upgrades are under way/.test(modal0), modal0);
  await page.click('#rbd-root [data-act="ifc-go"]');
  await until(() => page.evaluate(() => window.__game.S.view === 'stats' && window.__game.S.statsTab === 'forecast'));
  const empty = await page.evaluate(() => ({ view: window.__game.S.view, tab: window.__game.S.statsTab, modal: document.getElementById('rbd-root').innerHTML, on: (document.querySelector('.st-tabs .stab.on') || {}).textContent, h: (document.querySelector('.ifc-none .empty-h') || {}).textContent, now: document.querySelectorAll('.ifc-t tbody tr').length }));
  check('the link opens Statistics › Income forecast and closes the breakdown', empty.view === 'stats' && empty.tab === 'forecast' && empty.on === 'Income forecast' && empty.modal === '', empty);
  check('…which says no upgrades are under way, and shows the day now', empty.h === 'No upgrades under way' && empty.now === 5, empty);
  await page.screenshot({ path: path.join(OUT, 'income-forecast-none.png'), fullPage: false });

  /* work under way */
  await edit(SETUP);
  const res = await page.evaluate(() => {
    const G = window.__game, n = G.S.nation, rates = () => JSON.stringify(G.MD.stockRates(G.S.nation)), cap = () => G.WH.stockCap(G.S.nation);
    const before = { rec: JSON.stringify(n), rt: rates(), cap: cap() }, t0 = performance.now(), P = G.IFC().plan(n), ms = performance.now() - t0;
    const after = { rec: JSON.stringify(G.S.nation), rt: rates(), cap: cap() };
    return { before, after, ms, same: G.S.nation === n, works: P.works.map(w => w.t + ':' + w.k), steps: P.steps.map(s => ({ rt: s.rt, cap: s.cap })), total: P.total, base: P.base, aft: P.after };
  });
  check('three works, in the order they finish', JSON.stringify(res.works) === JSON.stringify(['build:sawmill', 'up:farm', 'build:warehouse']), res.works);
  check('the forecast leaves the record exactly as it was (every key, in order)', res.same && res.before.rec === res.after.rec);
  /* the population grows by the millisecond, and goods with it, so "the same" is to a millionth */
  const same = (a, b) => ['food', 'timber', 'iron', 'oil', 'goods'].every(r => Math.abs(a[r] - b[r]) < 1e-6);
  check('…and the stockpile’s day and storage as they were', same(JSON.parse(res.before.rt), JSON.parse(res.after.rt)) && res.before.cap === res.after.cap, { b: res.before.rt, a: res.after.rt });
  check('the base is today’s day', same(res.base.rt, JSON.parse(res.before.rt)), { base: res.base.rt, now: res.before.rt });
  check('the Sawmill adds timber', res.steps[0].rt.timber > 0.5, res.steps[0]);
  check('the Farm Estates upgrade adds food', res.steps[1].rt.food > 0.05, res.steps[1]);
  check('the Warehouse adds storage and no income', res.steps[2].cap > 0 && Object.values(res.steps[2].rt).every(v => Math.abs(v) < 1e-6), res.steps[2]);
  check('the steps add up to the total', ['food', 'timber', 'iron', 'oil', 'goods'].every(r => Math.abs(res.steps.reduce((s, x) => s + x.rt[r], 0) - res.total.rt[r]) < 1e-9));
  /* the breakdown's quick plan (now and all done, nothing between) agrees with the full one */
  const quick = await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); G.commit(n); const q = G.IFC().plan(G.S.nation, true), f = G.IFC().plan(G.S.nation), q2 = G.IFC().plan(G.S.nation, true); return { qs: q.steps.length, fs: f.steps.length, q: q.total.rt, f: f.total.rt, reuse: q2 === f }; });
  check('the quick plan has one step with the same total, and reuses a full plan already made', quick.qs === 1 && quick.fs === 3 && ['food', 'timber', 'iron', 'oil', 'goods'].every(r => Math.abs(quick.q[r] - quick.f[r]) < 1e-6) && quick.reuse, quick);

  /* the breakdown and the tab, with work under way */
  await go('cities');
  await act('res-bd', { r: 'timber' });
  const line = await page.evaluate(() => (document.querySelector('#rbd-root .rbd-fc') || {}).textContent || '');
  check('the timber breakdown says what is under way and what it adds', /Under way: a building upgrade and 2 new buildings\. When all are done, at \d\d:\d\d[^,]*, timber gains \+[\d.]+ a day more\./.test(line), line);
  await page.screenshot({ path: path.join(OUT, 'income-forecast-modal.png') });
  await act('res-bd', { r: 'oil' });
  const oil = await page.evaluate(() => (document.querySelector('#rbd-root .rbd-fc') || {}).textContent || '');
  check('…and for a resource none of them changes, says so', /None of them changes oil\./.test(oil), oil);
  await page.click('#rbd-root [data-act="ifc-go"]');
  await until(() => page.evaluate(() => window.__game.S.view === 'stats' && !!document.querySelector('.ifc-l')));
  const tab = await page.evaluate(() => ({ lede: (document.querySelector('.sb-lede') || {}).textContent, items: [...document.querySelectorAll('.ifc-l li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), store: [...document.querySelectorAll('.ifc-t tbody th')].map(t => t.textContent) }));
  check('the tab’s lede sums it up', /^A building upgrade and 2 new buildings are under way\. When the last is done, at .*your stockpile gains .*timber.* a day more than now, and each resource has [\d,]+ more storage\.$/.test(tab.lede || ''), tab.lede);
  check('the tab lists the three works in order', tab.items.length === 3 && /Sawmill/.test(tab.items[0]) && /Farm Estates.*Grey upgrade, 1 of 5/.test(tab.items[1]) && /Warehouse.*waiting its turn.*storage for each resource/.test(tab.items[2]), tab.items);
  check('the table has storage as a row', tab.store.includes('Storage, each'), tab.store);
  await sleep(900); // the page fades in
  await page.screenshot({ path: path.join(OUT, 'income-forecast-light.png'), fullPage: true });

  /* the forecast matches the nation once the works really are done */
  const real = await page.evaluate(() => {
    const G = window.__game, P = G.IFC().plan(G.S.nation), n = G.clone(G.S.nation), now = Date.now(), c = n.cities[0];
    for (const b of c.b) { if (b.d > now) { const sh = now - 1 - b.d; b.d += sh; b.s += sh; } if (b.uu) { b.ug = b.uu.u; delete b.uu; } }
    G.commit(n); G.render();
    return { want: P.after, got: { rt: G.MD.stockRates(G.S.nation), cap: G.WH.stockCap(G.S.nation) }, works: G.IFC().plan(G.S.nation).works.length };
  });
  check('once done, the stockpile’s day is what the forecast said', ['food', 'timber', 'iron', 'oil', 'goods'].every(r => Math.abs(real.want.rt[r] - real.got.rt[r]) < 0.05) && real.want.cap === real.got.cap, real);
  check('…and nothing is under way any more', real.works === 0, real.works);
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors, edit, go } = await start('dark', { width: 1280, height: 900 });
  await edit(SETUP);
  /* away from the tab, so nothing has worked the forecast out yet: how long the first one takes */
  const ms = await page.evaluate(() => { const G = window.__game, t0 = performance.now(); G.IFC().plan(G.S.nation); return performance.now() - t0; });
  console.log(`     (the first forecast took ${ms.toFixed(1)} ms for 3 works)`);
  await page.evaluate(() => { const G = window.__game; G.S.statsFor = null; G.S.statsTab = 'forecast'; G.S.statsKeep = true; });
  await go('stats');
  check('dark: the tab draws', await page.evaluate(() => document.querySelectorAll('.ifc-l li').length === 3));
  await page.screenshot({ path: path.join(OUT, 'income-forecast-dark.png'), fullPage: true });
  check('dark: no page errors', errors.length === 0, errors);
  await ctx.close();
}
{
  const { ctx, page, errors, edit, go } = await start('light', { width: 390, height: 844 }, { phone: true });
  await edit(SETUP);
  await page.evaluate(() => { const G = window.__game; G.S.statsFor = null; G.S.statsTab = 'forecast'; G.S.statsKeep = true; });
  await go('stats');
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth, li: document.querySelectorAll('.ifc-l li').length }));
  check('phone: the tab draws without sideways scrolling', w.li === 3 && w.doc <= w.vw, w);
  await page.evaluate(() => document.querySelector('.ifc-l').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, 'income-forecast-phone.png') });
  check('phone: no page errors', errors.length === 0, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
