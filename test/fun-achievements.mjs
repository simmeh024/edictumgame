import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

// The twelve fun achievements (2026-11-09): each is defined and its progress function turns true on a hand-made record.
//   python3 build.py && node test/fun-achievements.mjs
const ctx = await browser.newContext(), page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE); await page.fill('#d-name', 'Orrery'); await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.RK);
const r = await page.evaluate(() => {
  const A = window.__game.RK.ACH, by = Object.fromEntries(A.map(a => [a.id, a])), jan = new Date(2027, 0, 1, 10).getTime(), t = Date.now();
  const run = (id, n) => { const a = by[id]; if (!a) return 'missing'; try { return a.f({ n, id: 'me', now: t, me: false, npc: false, m: {} }) >= a.g; } catch (e) { return 'err ' + e.message; } };
  return {
    circus: [run('fun-circus', { answered: [1, 2, 3, 4, 5].map(i => ({ id: (i % 2 ? 'pgt-' : 'fwk-') + i, o: 0, t })) }), run('fun-circus', { answered: [{ id: 'pgt-a', o: 0, t }] })],
    nocomment: [run('fun-nocomment', { answered: [{ id: 'scd-x', o: -1, t }] }), run('fun-nocomment', { answered: [{ id: 'scd-x', o: 0, t }] })],
    books: [run('fun-books', { tly: { 'log:budget': 3 } }), run('fun-books', { tly: { 'log:budget': 2 } })],
    holiday: [run('fun-holiday', { policies: { holidayEntitlement: 1 } }), run('fun-holiday', { policies: {} })],
    silk: [run('fun-silk', { tly: { 'trade:a': 1, 'trade:b': 1, 'deal:c': 1, 'deal:d': 1, 'deal:e': 1, 'deal:a': 1, 'deal:b': 1 } }), run('fun-silk', { tly: { 'trade:a': 1 } })],
    cat: [run('fun-cat', { tly: { 'cov:cclean': 1 } }), run('fun-cat', { tly: {} })],
    bug: [run('fun-bug', { bgok: 1 }), run('fun-bug', {})],
    poll: [run('fun-poll', { nwv: 1 }), run('fun-poll', {})],
    ny: [run('fun-newyear', { answered: [{ id: 'x', o: 0, t: jan }] }), run('fun-newyear', { answered: [{ id: 'x', o: 0, t: new Date(2027, 0, 2, 10).getTime() }] })],
    defined: ['fun-spade', 'fun-endorse', 'fun-paper'].map(id => !!by[id]),
  };
});
for (const [k, v] of Object.entries(r)) check(k, k === 'defined' ? v.every(Boolean) : v[0] === true && v[1] === false, v);
/* the flags survive a save */
await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); n.bgok = 1; n.nwv = 1; G.commit(n); });
check('flags kept', await page.evaluate(() => window.__game.S.nation.bgok === 1 && window.__game.S.nation.nwv === 1));
check('no page errors', errors.length === 0, errors);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all ok'); process.exit(failed ? 1 : 0);
