// Land a trip needed stays (n.xph): a nation claims a line of land toward a site just out of its explorers' reach,
// the site card warns that sending a team holds that land, the team sets out, and the land can no longer be released
// (the hex card, the land office's list and releaseClaims itself), while land the trip did not need still can.
//   python3 build.py
//   node test/release-hold.mjs
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

/* a founded, settled nation with a site past reach and a chain of free land toward it. The nation is founded somewhere
   new each time, and now and then nothing fits (a small island): then another is founded */
async function setup() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.EDICTUM_PROBE = g => { window.__game = g; };
    /* every toast shown, in order (they queue, a few seconds each) */
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) { const t = el.textContent.trim(); if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t); } }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true }));
  });
  await page.goto(BASE);
  await page.fill('#d-name', 'Reachmere');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = (a, data = {}) => page.evaluate(([a, data]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, data); document.body.appendChild(b); b.click(); b.remove(); }, [a, data]);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await page.evaluate(() => { for (const b of document.querySelectorAll('[role="dialog"] button')) if (/^(Later|I have saved it)$/i.test(b.textContent.trim())) b.click(); });
  await edit(n => { delete n.onb; n.stock = Object.assign({}, n.stock, { food: 900, oil: 400, goods: 400 }); n.stockAt = Date.now(); n._stockSet = true; });
  /* the chain: the shortest walk over free land from the border to a hex within reach of the site, to be claimed as
     the newest claims; plus a free border hex out of the site's reach that the trip does not need */
  const plan = await page.evaluate(() => {
    const G = window.__game, X = G.XP(), M = G.MAP, n = G.S.nation, rg = X.expRange(n), T = X.territory(), mi = T.byId[G.NPX().myId()];
    const hd = G.NPX().hexDist, free = c => T.owner[c] === -1 && !T.isCap[c] && G.LK.claimLand(c);
    /* breadth-first over free land, from the hexes next to the border: steps and the way back */
    const step = new Int16Array(M.N).fill(-1), from = new Int32Array(M.N).fill(-1), q = [];
    for (let c = 0; c < M.N; c++) if (T.owner[c] === mi) for (let k = 0; k < 6; k++) { const j = M.nbr[c * 6 + k]; if (j >= 0 && step[j] < 0 && free(j)) { step[j] = 1; q.push(j); } }
    for (let h = 0; h < q.length; h++) { const c = q[h]; if (step[c] >= 12) continue; for (let k = 0; k < 6; k++) { const j = M.nbr[c * 6 + k]; if (j >= 0 && step[j] < 0 && free(j)) { step[j] = step[c] + 1; from[j] = c; q.push(j); } } }
    let best = null;
    for (const [si, st] of X.SITES.entries()) {
      if (st.lost || !X.xpSeen(si, n) || X.discoveries().has(si)) continue;
      const d = X.expPlan(n, si).d; if (!(d > rg && d <= rg + 12)) continue;
      let end = -1; for (const c of q) if (hd(c, st.c) <= rg && (end < 0 || step[c] < step[end])) end = c;
      if (end < 0 || (best && step[end] >= best.line.length)) continue;
      const line = []; for (let c = end; c >= 0; c = from[c]) line.unshift(c);
      let extra = -1; for (const c of q) if (step[c] === 1 && !line.includes(c) && hd(c, st.c) > rg && (extra < 0 || hd(c, st.c) > hd(extra, st.c))) extra = c;
      if (extra < 0) continue;
      best = { si, d, rg, line, extra };
    }
    window.__plan = best;
    return best;
  });
  return { ctx, page, errors, edit, act, plan };
}
let S0 = null;
for (let k = 0; k < 4 && !(S0 && S0.plan); k++) { if (S0) await S0.ctx.close(); S0 = await setup(); }
const { page, errors, edit, act, plan } = S0;
/* waits for a toast matching re since the last clear, and returns them all */
const toasts = () => page.evaluate(() => window.__toasts.join(' | '));
const toastSeen = async re => { await until(() => page.evaluate(src => window.__toasts.some(t => new RegExp(src).test(t)), re.source), 20000); return toasts(); };
const clearToasts = () => page.evaluate(() => { window.__toasts = []; });
/* the founding's toasts (steps done, stamps) queue for a minute or more: close them so the next one shows at once */
const drainToasts = async () => { for (let k = 0; k < 60; k++) { const open = await page.evaluate(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return false; el.querySelector('[data-act="toast-x"]')?.click(); return true; }); if (!open) return; await sleep(120); } };
/* the map's side panel showing one thing (patch: S's map fields) and its text: a step of the founding can leave a map
   mode or a claim open, which the panel shows first */
const panel = async patch => {
  await page.evaluate(patch => { const G = window.__game, S = G.S; Object.assign(S, { mpMode: '', mapTarget: null, mapSite: null, mapSel: null, mapClaim: null, mapInspect: null, mapCell: null, lsw: null }, patch); G.render(); }, patch);
  await sleep(400);
  return page.evaluate(() => { const p = document.getElementById('map-panel'); return { text: p ? p.textContent : '', view: window.__game.S.view }; });
};
check('a site past reach with free land toward it', !!plan && plan.line.length > 0 && plan.extra >= 0, plan);
if (plan) {
  await edit((n, now) => { const P = window.__plan; n.claims = (n.claims || []).concat(P.line.map((c, k) => ({ c, t: now - 60e3 + k })), [{ c: P.extra, t: now - 30e3 }]); });
  const st = await page.evaluate(() => { const G = window.__game, X = G.XP(), P = window.__plan, T = X.territory(), mi = T.byId[G.NPX().myId()]; return { why: X.expPlan(G.S.nation, P.si).why, owned: P.line.concat(P.extra).every(c => T.owner[c] === mi), credits: G.LH().credits(G.S.nation) }; });
  check('the claimed line brings the site within reach', st.owned && st.why === '', st);

  /* the site card warns before the team sets out */
  const card = await panel({ mapSite: plan.si });
  check('the site card says sending a team holds the land', /Only land you claimed in the last 24 hours brings this within reach/.test(card.text) && /can no longer be released/.test(card.text), { view: card.view, text: card.text.slice(0, 300) });
  await page.evaluate(() => [...document.querySelectorAll('p.hint')].find(p => /Only land you claimed/.test(p.textContent))?.scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'release-hold-site.png') });

  await drainToasts(); await clearToasts();
  await page.evaluate(si => window.__game.XP().sendExpedition(si), plan.si); await sleep(400);
  const sent = await page.evaluate(() => { const n = window.__game.S.nation; return { exp: !!n.exp, xph: n.xph || null }; });
  const held = sent.xph ? sent.xph.map(h => h.c) : [];
  check('the team set out and holds the land it needed', sent.exp && held.length > 0 && held.every(c => plan.line.includes(c)) && !held.includes(plan.extra), { sent, plan });
  { const t = await toastSeen(/can no longer be released/); check('…and the toast says so', /can no longer be released/.test(t), t); }
  /* the credits after setting out (the charter's "Send an expedition" step pays some on a first trip) */
  await sleep(300);
  const before = await page.evaluate(() => window.__game.LH().credits(window.__game.S.nation));

  /* releasing a held hex, or the start of the line that would cut it off, is refused; credits stay as they were */
  for (const [name, cell, re] of [['a held hex', held[held.length - 1], /needed this hex to reach its site/], ['the first hex of the line', plan.line[0], plan.line.length > 1 && !held.includes(plan.line[0]) ? /would cut off land a team you sent out needed/ : /needed this hex to reach its site/]]) {
    await drainToasts(); await clearToasts();
    await act('lc-release', { c: String(cell) }); await sleep(300);
    const after = await page.evaluate(() => { const G = window.__game, n = G.S.nation, P = window.__plan; return { kept: P.line.every(c => n.claims.some(e => e.c === c)), credits: G.LH().credits(n) }; });
    const t = await toastSeen(re);
    check(`releasing ${name} is refused`, after.kept && after.credits === before && re.test(t), { after, before, t });
  }

  /* the hex card shows the hold instead of the release button */
  const hex = { ...(await panel({ mapCell: held[0] })), btn: await page.evaluate(() => !!document.querySelector('#map-panel [data-act="lc-release"][data-c]')) };
  check('the hex card says the hex stays, with no release button', /a team you sent out needed it to reach its site, so it stays yours/.test(hex.text) && !hex.btn, { btn: hex.btn, view: hex.view, text: hex.text.slice(0, 300) });
  await page.evaluate(() => [...document.querySelectorAll('p.hint')].find(p => /needed it to reach its site/.test(p.textContent))?.scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'release-hold-hex.png') });

  /* land the trip did not need is released as before */
  await act('lc-release', { c: String(plan.extra) }); await sleep(300);
  const free = await page.evaluate(() => { const G = window.__game, n = G.S.nation, P = window.__plan; return { gone: !n.claims.some(e => e.c === P.extra), credits: G.LH().credits(n) }; });
  check('the hex the trip did not need is released, its credit back', free.gone && free.credits === before + 1, { free, before });

  /* the hold survives a reload */
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation); await sleep(500);
  const re = await page.evaluate(() => (window.__game.S.nation.xph || []).map(h => h.c));
  check('the hold is still there after a reload', re.length === held.length && re.every(c => held.includes(c)), { re, held });
}
check('no page errors', errors.length === 0, errors);
await browser.close(); server.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
