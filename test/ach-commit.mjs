// What the Achievements page shows as "Done, to be recorded at your next decision" is recorded at the next decision.
// The page reads the live record; the decision hands commit() a copy of it. An achievement that read its figure through
// the live record (the stockpile's gain a day, from the economy) read 0 from the copy, so it stayed "Done" for good
// (bug report 2026-11-12, The Wandering Isles). Here a real decision records a stockpile achievement the page shows as
// done, and every achievement the nation has made a start on, given a goal it has already reached, is recorded by the
// next save.
//   python3 build.py
//   node test/ach-commit.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the test
// probe. A screenshot goes to test/out/.
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE);
await page.fill('#d-name', 'Tallyfield');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
const act = (a, data = {}) => page.evaluate(([a, data]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, data); document.body.appendChild(b); b.click(); b.remove(); }, [a, data]);
await go('map');
for (let i = 0; i < 4 && !(await page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); i++) {
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 5000);
}
check('the nation is settled', await page.evaluate(() => (window.__game.S.nation.cities || []).length > 0));
await page.evaluate(() => { const G = window.__game; if (G.S.nation.onb) { const n = G.clone(G.S.nation); delete n.onb; G.commit(n); G.render(); } });
await sleep(300);
await page.evaluate(() => { for (const b of document.querySelectorAll('[role="dialog"] button')) if (/^(Later|I have saved it)$/i.test(b.textContent.trim())) b.click(); });

/* a goal lowered to what the nation already has: ids and the goals to put back */
const lower = ids => page.evaluate(ids => {
  const G = window.__game, K = G.RK, x = K.achCtx(G.S.nation, G.myId(), Date.now(), true), out = {};
  for (const a of K.ACH) {
    if (ids ? !ids.includes(a.id) : (a.p || a.need && !a.need() || (G.S.nation.ach || {})[a.id])) continue;
    const v = K.achVal(a, x).v;
    if (v >= 1) { out[a.id] = a.g; a.g = ids ? 1 : Math.floor(v); }
  }
  window.__g0 = Object.assign(window.__g0 || {}, out);
  return Object.keys(out);
}, ids);
const restore = () => page.evaluate(() => { const K = window.__game.RK; for (const [id, g] of Object.entries(window.__g0 || {})) K.ACH.find(a => a.id === id).g = g; window.__g0 = {}; });

/* 1. a real decision records the stockpile's goods a day */
const rate = await page.evaluate(() => { const G = window.__game; return G.RK.stockRates(G.S.nation).goods; });
check('the stockpile gains goods every day (the figure the goods achievements read)', rate >= 1, rate);
check('Workshop of the World has its goal lowered to 1 goods a day', (await lower(['eco-goods25'])).includes('eco-goods25'));
await go('achievements');
const before = await page.evaluate(() => { const c = document.getElementById('ach-eco-goods25'); return c ? c.querySelector('.ach-meta').textContent : null; });
check('the page shows it as done, to be recorded at the next decision', /to be recorded at your next decision/.test(before || ''), before);
const issue = await page.evaluate(() => { const G = window.__game, q = (G.S.nation.inbox || []).find(x => x && x.id && !/^fd-/.test(x.id)) || (G.S.nation.inbox || [])[0]; return q ? { id: q.id, dec: (G.S.nation.answered || []).length } : null; });
check('there is an edict to decide', !!issue, issue);
if (issue) {
  await act('answer', { id: issue.id, o: '0' });
  const done = await until(() => page.evaluate(n => (window.__game.S.nation.answered || []).length > n, issue.dec));
  check('the edict is decided', !!done, issue);
  const got = await page.evaluate(() => (window.__game.S.nation.ach || {})['eco-goods25'] || 0);
  check('the decision records Workshop of the World', got > 0, got);
  await go('achievements');
  const after = await page.evaluate(() => { const c = document.getElementById('ach-eco-goods25'); return c ? c.querySelector('.ach-meta').textContent : null; });
  check('the page now says it was earned', /Earned/.test(after || '') && !/next decision/.test(after || ''), after);
  await page.evaluate(() => { const c = document.getElementById('ach-eco-goods25'); if (c) c.scrollIntoView({ block: 'center' }); });
  await page.screenshot({ path: path.join(OUT, 'ach-commit.png') });
}
await restore();

/* 2. every achievement the nation has a figure for, done on the page, is done in the save that follows */
const due = await lower(null);
check('many achievements have a figure to lower their goal to', due.length >= 20, due.length);
const shown = await page.evaluate(() => { const G = window.__game; return G.RK.achState({ id: G.myId(), n: G.S.nation, me: true }).rows.filter(q => q.due).map(q => q.a.id); });
check('the page shows each of them as done', due.every(id => shown.includes(id)), due.filter(id => !shown.includes(id)));
await page.evaluate(() => { const G = window.__game; G.commit(G.clone(G.S.nation)); });
const missed = await page.evaluate(ids => { const e = window.__game.S.nation.ach || {}; return ids.filter(id => !e[id]); }, due);
check('the next save records every one of them', missed.length === 0, missed);
await restore();

check('no page errors', errors.length === 0, errors);
await ctx.close();
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
