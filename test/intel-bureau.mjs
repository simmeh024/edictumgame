// The Intelligence page and the Bureau: the roster of named agents, the bureau's departments, the four tabs, the
// planner (target, operation, agent, odds and heat), the region board, a covert operation's case file, gathering
// intelligence into a file, heat that stops further operations, a military mission, home duty, the Defence and
// Record tabs, the desk's new tasks, a reload, a phone and the light theme.
//   python3 build.py
//   node test/intel-bureau.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators): what needs another player (captured
// agents, ransoms, joint operations with a player, chatter, swaying a vote) is in test/bureau.test.mjs and
// test/assembly-engine.test.mjs. Screenshots go to test/out/.
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

async function start(theme, viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  const act = (a, d = {}) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d); document.body.appendChild(b); b.click(); b.remove(); }, [a, d]);
  await go('map');
  await act('map-suggest'); await act('settle'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* an established nation, eight days old (counterfeiting is open), with goods for a few operations */
  await edit((n, now) => { delete n.onb; n.founded = now - 8 * 864e5; n.stock = Object.assign({}, n.stock, { food: 380, timber: 380, iron: 380, oil: 380, goods: 380 }); n.stockAt = now; n._stockSet = true; });
  return { ctx, page, errors, edit, go, act };
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `intel-${name}.png`), fullPage: full });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
/* clears what stops the next operation: the gap since the last one, heat and resting agents */
const fresh = d => d.edit(n => { n.cov = []; delete n.ag; });

try {
  /* ── desktop, dark ── */
  const d = await start('dark', { width: 1280, height: 900 }), { page } = d;
  await d.go('intel');
  check('the page draws with no script errors', d.errors.length === 0, d.errors);
  const roster = await S(page, () => [...document.querySelectorAll('.ib-ag')].map(li => ({ n: li.querySelector('.ib-ag-n b').textContent, sp: li.querySelector('.ib-ag-sp').textContent, st: li.querySelector('.ib-ag-st').textContent })));
  check('the roster: three named agents, different codenames and specialties, all ready', roster.length === 3 && new Set(roster.map(a => a.n)).size === 3 && new Set(roster.map(a => a.sp)).size === 3 && roster.every(a => a.st === 'Ready'), roster);
  check('four tabs, Operations first and selected', await S(page, () => [...document.querySelectorAll('.ib-tab')].map(t => t.textContent.trim() + ':' + t.getAttribute('aria-selected')).join('|')) === 'Operations:true|Files:false|Defence:false|Record:false');
  const kinds = await S(page, () => [...document.querySelectorAll('.cv-k')].map(b => b.dataset.k).join(''));
  check('seven kinds of operation: the five, gathering intelligence and a military mission', kinds === 'sbdmcgw', kinds);
  check('the agent chips: the best for the job, and one for each agent', await S(page, () => document.querySelectorAll('.ib-chip').length) === 4);
  check('the region board pins every nation, and a ring for no heat yet', await S(page, () => { const G = window.__game; return document.querySelectorAll('.ib-board g.ib-pin').length >= Math.min(3, G.IB().allNations().length) && !!document.querySelector('.ib-board g.ib-pin.me') && document.querySelectorAll('.ib-ring').length === 0; }));
  check('the page has no sideways scroll', await noOverflow(page));
  await shot(page, 'desktop-ops');

  /* a pin on the board picks the target */
  const pick = await S(page, () => { const g = [...document.querySelectorAll('.ib-board g[data-act="ib-pick"]')].find(x => x.dataset.id !== window.__game.S.cvTg); return g ? g.dataset.id : null; });
  if (pick) { await page.click(`.ib-board g[data-act="ib-pick"][data-id="${pick}"]`); await sleep(200); }
  check('a pin on the board picks that nation as the target', !!pick && await S(page, id => window.__game.S.cvTg === id && document.getElementById('cv-tg').value === id, pick), pick);
  const tg = await S(page, () => window.__game.S.cvTg);

  /* gathering intelligence, until it succeeds: the case file, and a file on them */
  await page.click('[data-act="cv-k"][data-k="g"]');
  check('gathering intelligence says what it does', /file on them/.test(await page.textContent('.cv-fx')));
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    if (i) { await fresh(d); await d.go('intel'); await S(page, id => { window.__game.S.cvTg = id; window.__game.S.cvK = 'g'; window.__game.render(); }, tg); }
    await page.click('[data-act="cv-launch"]');
    await until(() => S(page, () => (window.__game.S.nation.cov || []).length > 0));
    ok = await S(page, () => { const G = window.__game, o = G.S.nation.cov[0]; return G.IB().cvRoll(o).ok; });
  }
  const op = await S(page, () => window.__game.S.nation.cov[0]);
  check('the operation is saved with its agent', op.k === 'g' && Number.isInteger(op.ai) && op.tg === tg, op);
  const card = await S(page, () => { const c = document.querySelector('#cv-result .ib-case'); return c && { stamp: c.querySelector('.ib-stamp b').textContent, by: (c.querySelector('.ib-by') || {}).textContent || '', clip: !!c.querySelector('.ib-clip svg') }; });
  check('the case file: a stamp, the agent, the target’s flag clipped on', !!card && /Clean|Exposed/.test(card.stamp) && /^Agent /.test(card.by) && card.clip, card);
  check('the stamp drops in once, not again on the next redraw', await until(() => S(page, () => { window.__game.render(); const c = document.querySelector('#cv-result .ib-case'); return !!c && !c.classList.contains('ib-new'); }), 4000));
  check('the file on them has their army, stockpile and cabinet', await S(page, id => { const f = window.__game.S.nation.ifl && window.__game.S.nation.ifl[id]; return !!(f && f.a && f.s && f.c && f.t); }, tg));
  // success and exposure are rolled apart (cvRoll), so a successful operation can still be exposed: its agent is then
  // held abroad rather than resting
  const rested = await S(page, () => { const G = window.__game, n = G.S.nation, o = n.cov[0], a = G.IB().agRoster(n).find(q => q.i === o.ai); return { x: a.x, k: G.IB().agStatus(n, a, Date.now()).k, ex: G.IB().cvRoll(o).ex }; });
  check('the agent rests afterwards (or is held, when the operation was exposed), and has experience', rested.x >= 1 && rested.k === (rested.ex ? 'held' : 'rest'), rested);
  check('heat with the target shows on the planner and the board', await S(page, () => /Heat with/.test(document.querySelector('.ib-heat').textContent) && +document.querySelector('.ib-heat b').textContent > 0 && document.querySelectorAll('.ib-ring').length === 1));
  check('the next operation waits: the gap is on the button', await S(page, () => document.querySelector('[data-act="cv-launch"]').disabled));
  await shot(page, 'desktop-case');

  /* the Files tab */
  await page.click('[data-act="ib-tab"][data-t="files"]'); await sleep(200);
  const file = await S(page, () => ({ list: document.querySelectorAll('.ib-fl').length, secs: [...document.querySelectorAll('.ib-fs .lbl-h')].map(h => h.firstChild.textContent) }));
  check('Files: the nation in the list, and its file in sections', file.list === 1 && file.secs.join('|') === 'Army|Stockpile|Cabinet|Trade|Building sites|In the Assembly|Between you' || (file.list === 1 && file.secs[0] === 'Army' && file.secs.length === 7), file);
  check('the tabs move with the arrow keys', await (async () => { await page.focus('[data-act="ib-tab"][data-t="files"]'); await page.keyboard.press('ArrowRight'); await sleep(200); return S(page, () => window.__game.S.ibTab === 'def' && document.activeElement && document.activeElement.dataset.t === 'def'); })());
  await page.click('[data-act="ib-tab"][data-t="files"]'); await sleep(150);
  await shot(page, 'desktop-files');

  /* heat: four exposed operations in the last day are too hot to touch */
  await d.edit((n, now, G) => { const ops = []; for (let i = 0; ops.length < 4 && i < 4000; i++) { const o = { id: 'hx' + i.toString(36), k: 'd', tg: G.S.cvTg, tn: 'x', t: now - 9 * 3600e3, rg: G.REG ? G.REG.id : (G.S.nation.reg || 'meridian'), p: 0.5, x: 0.5, ai: 0 }; if (G.IB().cvRoll(o).ex) ops.push(o); } n.cov = ops; delete n.ag; });
  const hot = await S(page, () => { const G = window.__game, n = G.S.nation, x = G.IB().findNation(G.S.cvTg); return { h: G.IB().heatOf(n, x.id, Date.now()), why: G.IB().cvBlock(n, x, 's', Date.now()) }; });
  check('heat of 100 or more stops further operations against them', hot.h >= 100 && /^Too hot/.test(hot.why), hot);

  /* a military mission: the die, a report, the agent's experience */
  await fresh(d); await d.go('intel'); await page.click('[data-act="ib-tab"][data-t="ops"]'); await sleep(100);
  await page.click('[data-act="cv-k"][data-k="w"]'); await sleep(150);
  check('a military mission shows the die and its table', await S(page, () => !!document.querySelector('.ib-die #die') && document.querySelectorAll('.odds li').length === 8 && !!document.querySelector('[data-act="ib-mil"]')));
  /* the die (sendSpy's first Math.random) rolls 2 to 20 here: a natural 1 is caught, and a caught agent is held with no
     Home duty button, which failed the home-duty steps below whenever the mission sent agent 2 (1 run in 20 or so) */
  await page.evaluate(() => { const r = Math.random; Math.random = () => { Math.random = r; return 0.05 + r() * 0.95; }; });
  await page.click('[data-act="ib-mil"]');
  check('the mission is rolled and reported', !!(await until(() => S(page, () => !window.__game.S.spyRolling && !!document.querySelector('#cv-result .report')), 8000)));
  check('the military report keeps the agent, and a dossier goes into the file', await S(page, () => { const G = window.__game, r = G.S.nation.intel[0]; return Number.isInteger(r.ai) && (!r.d || !!(G.S.nation.ifl && G.S.nation.ifl[r.tg] && G.S.nation.ifl[r.tg].a)); }));

  /* home duty */
  await page.click('[data-act="ib-home"][data-i="2"]'); await sleep(150);
  check('home duty: the agent is off the planner and counted in your defences', await S(page, () => { const G = window.__game; return (G.S.nation.ag || []).some(a => a.i === 2 && a.h === 1) && !document.querySelector('.ib-chip[data-i="2"]') && /On home duty/.test(document.querySelector('.ib-ag.is-home').textContent); }));
  await page.click('[data-act="ib-tab"][data-t="def"]'); await sleep(150);
  const def = await S(page, () => ({ h: [...document.querySelectorAll('.ib-panel .h2')].map(h => h.textContent), dl: document.querySelector('.ib-panel .mp-dl') ? document.querySelector('.ib-panel .mp-dl').textContent : '' }));
  check('Defence: your defences, chatter, the mole hunt and incidents', ['Your defences', 'Chatter', 'Mole hunt', 'Incidents'].every(h => def.h.includes(h)) && /1 agent on home duty/.test(def.dl), def);
  check('a mole hunt needs other players about', await S(page, () => [...document.querySelectorAll('[data-act="ib-mole"]')].every(b => b.disabled) && /other players/.test(document.querySelector('.ib-mh').textContent)));
  await shot(page, 'desktop-defence');
  await page.click('[data-act="ib-home"][data-i="2"]'); await sleep(100);

  /* the Record tab */
  await page.click('[data-act="ib-tab"][data-t="rec"]'); await sleep(150);
  check('Record: the Most Wanted board, your record, caught in the act and military reports', await S(page, () => { const h = [...document.querySelectorAll('.ib-panel .h2')].map(x => x.textContent); return ['Most Wanted', 'Your record', 'Caught in the act', 'Military reports'].every(x => h.includes(x)); }));
  await shot(page, 'desktop-record');

  /* the bureau's departments: start one, and it counts once its time is up */
  await page.click('#ib-bu summary'); await sleep(150);
  check('the departments: six, with five blocks each', await S(page, () => document.querySelectorAll('#ib-bu .xu-row').length === 6 && document.querySelectorAll('#ib-bu .xu-blk i').length === 30));
  await page.click('[data-act="ib-up"][data-k="safe"]'); await sleep(150);
  check('an upgrade goes into training, paid for', await S(page, () => { const n = window.__game.S.nation; return n.buw && n.buw.k === 'safe' && n.buw.u === 1 && !!document.querySelector('#ib-bu .xu-ws'); }));
  await d.edit((n, now) => { n.buw.d = now - 1; });
  check('a finished block is written, and safe houses shorten the gap', await S(page, () => { const G = window.__game, n = G.S.nation; return n.bu && n.bu.safe === 1 && !n.buw && G.IB().buGap(n) === 7.5 * 3600e3; }));
  await shot(page, 'desktop-bureau', false);

  /* the desk asks for these too */
  check('the desk has the Bureau’s tasks, and a legendary one', await S(page, () => { const T = window.__game.IB().DD_TASKS, L = window.__game.IB().DD_LEG; return ['cov', 'spy', 'gint', 'bu', 'covc'].every(k => T[k]) && T.covc.legend === 1 && !!L.covc && !!L.spy; }));

  /* a reload keeps the roster, the file and the departments */
  const before = await S(page, () => JSON.stringify({ ag: window.__game.S.nation.ag || [], f: Object.keys(window.__game.S.nation.ifl || {}), bu: window.__game.S.nation.bu }));
  await page.evaluate(() => window.__game.saveNow && window.__game.saveNow()); await sleep(800);
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const after = await S(page, () => JSON.stringify({ ag: window.__game.S.nation.ag || [], f: Object.keys(window.__game.S.nation.ifl || {}), bu: window.__game.S.nation.bu }));
  check('a reload keeps the roster, the files and the departments', before === after, { before, after });
  check('no script errors on the way', d.errors.length === 0, d.errors);
  await d.ctx.close();

  /* ── a phone ── */
  const p = await start('dark', { width: 390, height: 844 }, { phone: true });
  await p.go('intel');
  check('phone: no sideways scroll', await noOverflow(p.page));
  check('phone: the roster in two columns', await S(p.page, () => { const L = [...document.querySelectorAll('.ib-ag')].map(e => e.getBoundingClientRect()); return L.length === 3 && Math.abs(L[0].top - L[1].top) < 2 && L[2].top > L[0].top + 10; }));
  check('phone: the four tabs fit', await S(p.page, () => { const t = document.querySelector('.ib-tabs'); return t.scrollWidth <= t.clientWidth + 1; }));
  await shot(p.page, 'phone');
  for (const t of ['files', 'def', 'rec']) { await p.page.click(`[data-act="ib-tab"][data-t="${t}"]`); await sleep(150); }
  check('phone: every tab without sideways scroll', await noOverflow(p.page));
  check('phone: no script errors', p.errors.length === 0, p.errors);
  await p.ctx.close();

  /* ── light ── */
  const l = await start('light', { width: 1280, height: 900 });
  await l.go('intel');
  await shot(l.page, 'light', false);
  check('light: no script errors', l.errors.length === 0, l.errors);
  await l.ctx.close();
} catch (e) { console.error(e); failed++; }
finally { await browser.close(); server.close(); }
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
