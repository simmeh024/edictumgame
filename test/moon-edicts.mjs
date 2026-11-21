// Eight early edicts about the Moon, in the game: before the Space page opens they come in order at 1, 3, 6 … enacted
// edicts, one at a time and never straight after another, tagged “The Moon · 1 of 8” on the desk and the edict; Coming
// up names the next. Once the page is open they are ordinary edicts. On a desktop (light) and a phone (dark).
//   python3 build.py
//   node test/moon-edicts.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
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

/* a founded nation with its capital settled, the Space page not yet open */
async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Selenia');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  const go = async v => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; location.hash = '#' + v; window.__game.render(); }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  /* an empty desk, the count set (or kept) and one arrival slot passed */
  const slot = e => edit((n, now, G, e) => { if (e != null) n.ws.e = e; n.inbox = []; n.issueClock = now - n.freq * 60000 - 1000; }, e);
  const desk = () => page.evaluate(() => [...document.querySelectorAll('.issue-card')].map(b => ({ id: b.dataset.id, moon: (b.querySelector('.edict-moon') || {}).textContent || '' })));
  const answer = async (id, o = 0) => {
    await page.click(`.issue-card[data-id="${id}"]`);
    await until(() => page.$(`[data-act="answer"][data-id="${id}"]`));
    await page.click(`[data-act="answer"][data-id="${id}"][data-o="${o}"]`);
    await until(() => page.evaluate(id => (window.__game.S.nation.answered || []).some(a => a.id === id), id));
  };
  return { ctx, page, errors, edit, go, slot, desk, answer };
}

try {
  /* ── desktop, light: Coming up, the first, the spacing, the second ── */
  {
    const t = await start('light', { width: 1280, height: 900 }), { page } = t;
    await t.edit(n => { n.ws.e = 0; });
    await t.go('nation');
    check('Coming up names the first edict about the Moon', await until(() => page.evaluate(() => [...document.querySelectorAll('.tut-up-l li')].some(li => /First edict about the Moon/.test(li.textContent) && /after your first edict/.test(li.textContent)))));
    await page.screenshot({ path: OUT + '/moon-edicts-coming-1280.png' });
    await t.slot(0); await t.go('issues');
    check('before the first enacted edict, none on the desk', await until(async () => { const d = await t.desk(); return d.length > 0 && !d.some(x => /^mn-/.test(x.id)); }), await t.desk());
    await t.slot(1); await t.go('issues');
    check('after one enacted edict, “The Same Face” arrives, tagged “The Moon · 1 of 8”', await until(async () => (await t.desk()).some(x => x.id === 'mn-face' && x.moon === 'The Moon · 1 of 8')), await t.desk());
    await page.screenshot({ path: OUT + '/moon-edicts-desk-1280.png' });
    await page.click('.issue-card[data-id="mn-face"]');
    check('it opens with its question about the far side, the tag and three answers', await until(() => page.evaluate(() => {
      const p = document.querySelector('.paper.edict'); if (!p) return false;
      return /The Same Face/.test(p.querySelector('.h1').textContent) && /far side gets just as much sunlight/.test(p.textContent) && /The Moon · 1 of 8/.test((p.querySelector('.edict-moon') || {}).textContent || '') && document.querySelectorAll('[data-act="answer"][data-id="mn-face"]').length === 3;
    })));
    await sleep(500); await page.screenshot({ path: OUT + '/moon-edicts-edict-1280.png' });
    const e0 = await page.evaluate(() => window.__game.S.nation.ws.e);
    await page.click('[data-act="answer"][data-id="mn-face"][data-o="1"]');
    check('answered: the result says what came of it', await until(() => page.evaluate(() => /telescope night/.test((document.querySelector('.paper.result') || {}).textContent || ''))));
    check('and it counts as an enacted edict', await until(() => page.evaluate(e0 => window.__game.S.nation.ws.e === e0 + 1, e0)));
    await t.slot(5); await t.go('issues');
    check('straight after one, the next slot brings another edict', await until(async () => { const d = await t.desk(); return d.length > 0 && !d.some(x => /^mn-/.test(x.id)); }), await t.desk());
    const other = (await t.desk())[0].id;
    await t.answer(other);
    await t.slot(); await t.go('issues');
    check('after another decision, “The Ground Is Breathing” (2 of 8)', await until(async () => (await t.desk()).some(x => x.id === 'mn-tide' && x.moon === 'The Moon · 2 of 8')), await t.desk());
    check('Coming up says nothing while one is on the desk', await (async () => { await t.go('nation'); return page.evaluate(() => ![...document.querySelectorAll('.tut-up-l li')].some(li => /about the Moon/.test(li.textContent))); })());
    check('no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
  /* ── phone, dark: the edict fits; once the Space page is open they are ordinary edicts ── */
  {
    const t = await start('dark', { width: 390, height: 844 }), { page } = t;
    await t.edit(n => { n.ws.e = 0; });
    await t.slot(1); await t.go('issues');
    check('phone: the first arrives', await until(async () => (await t.desk()).some(x => x.id === 'mn-face')), await t.desk());
    await page.screenshot({ path: OUT + '/moon-edicts-desk-390-dark.png' });
    await page.click('.issue-card[data-id="mn-face"]');
    await until(() => page.$('[data-act="answer"][data-id="mn-face"]'));
    check('phone: the edict fits the screen, no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    check('phone: the tag is readable in the dark theme', await page.evaluate(() => { const e = document.querySelector('.paper.edict .edict-moon'), s = e && getComputedStyle(e); return !!s && s.backgroundColor !== s.color && e.getBoundingClientRect().right <= innerWidth; }));
    await sleep(400); await page.screenshot({ path: OUT + '/moon-edicts-edict-390-dark.png', fullPage: false });
    await t.edit(n => { n.mc = { ...(n.mc || {}), p: { o: 0, t: Date.now() } }; });
    check('once the Space page is open, none is waiting and Coming up drops it', await page.evaluate(() => { const P = window.EDICTUM_PROBE.mn, n = window.__game.S.nation; return P.next(n) === -1 && P.coming(n) === null && P.ISSUES.every(is => is.req(n)); }));
    check('no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
} catch (e) { console.log('FAIL thrown: ' + (e && e.stack || e)); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
