// Letters from Mission Control in the browser: the space agency founded from the Space page, a mission flown, the
// survey chart lit by it, the mandate spent from the agency's card, and the gold border round every letter from
// Mission Control on the Edicts desk, opened and answered, on a desktop and a phone, in the light and dark themes.
//   python3 build.py
//   node test/mission-control.mjs
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

/* a founded nation with its capital settled, the charter behind it */
async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Lampwick');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = fn => page.evaluate(src => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G); G.commit(n); G.render(); }, fn.toString());
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  /* the Space page already open (its prelude answered) and its tour already seen: test/space-gate.mjs covers both */
  await edit(n => { delete n.onb; n.stock = { food: 300, timber: 300, iron: 300, oil: 300, goods: 300 }; n.stockAt = Date.now(); n._stockSet = true; n.mc.p = { o: 0, t: Date.now() - 1000 }; n.tut = Object.assign({}, n.tut, { g: ((n.tut && n.tut.g) || '') + 's' }); });
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  return { ctx, page, errors, edit, go };
}
/* the desk with the first letter from Mission Control on it: fifty edicts enacted, the dice past their last miss */
async function letterOnDesk(t) {
  await t.edit((n, now) => { n.ws.e = 60; n.ws.c = [0, 1, 2, 3].map(() => ({ o: 0, f: 'rep', b: '111', t: now - 1e6, x: '', n: '' })); n.mc.r = 11; n.inbox = []; n.issueClock = now - 2 * n.freq * 60000 - 1000; });
  await t.go('issues');
  return until(() => t.page.$('.issue-card.mc-card'));
}
const goldOf = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e), g = getComputedStyle(document.documentElement).getPropertyValue('--mc-gold').trim();
  const rgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return h; const v = parseInt(m[1], 16); return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`; };
  return { w: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], c: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor], gold: rgb(g) }; }, sel);
const allGold = g => !!g && g.w.every(w => w === '2px') && g.c.every(c => c === g.gold);

try {
  /* ── the agency, the first mission, the chart and the mandate (desktop, light) ── */
  const t = await start('light', { width: 1280, height: 900 }), { page } = t;
  await t.go('space');
  check('before the agency: the founding form and a black survey chart', await page.evaluate(() => !!document.querySelector('form.mc-found') && !!document.querySelector('canvas.sp-cv[data-mode="chart"]')));
  check('three teams to choose from, each with a first assignment under an hour', await page.evaluate(() => [...document.querySelectorAll('.mc-team')].map(l => l.querySelector('.mc-first').textContent).every(x => /about (\d+) minutes/.test(x) && +/about (\d+) minutes/.exec(x)[1] < 60) && document.querySelectorAll('.mc-team').length === 3));
  const dark = await page.evaluate(() => { const L = window.__game.MC.reveal(window.__game.S.nation, Date.now()); return [...L].every(v => v === 0); });
  check('the chart starts completely black', dark);
  await page.fill('#mc-nm', 'Lampwick Lunar Office');
  await page.check('.mc-team input[value="sci"]', { force: true });
  await page.click('form.mc-found button[type="submit"]');
  await until(() => page.evaluate(() => !!(window.__game.S.nation.mc && window.__game.S.nation.mc.a)));
  check('the agency is founded with its name, Science & Survey first', await page.evaluate(() => { const a = window.__game.S.nation.mc.a; return a.nm === 'Lampwick Lunar Office' && a.f === 'sci' && !!a.tm.sci; }));
  check('the next step offers the first assignment', await page.evaluate(() => !!document.querySelector('[data-act="mc-start"][data-k="scope"]')));
  /* the goods just before: a full stockpile may already have earned achievements, and a new rank pays goods */
  const goods0 = await page.evaluate(() => window.__game.S.nation.stock.goods);
  await page.click('[data-act="mc-start"][data-k="scope"]');
  await until(() => page.evaluate(() => !!window.__game.S.nation.mc.ms.scope));
  const job = await page.evaluate(() => (document.querySelector('.mc-jobs li') || {}).innerText || '');
  check('the job under way: its name, time remaining and what it will reveal', /Borrowed telescope time/.test(job) && /Ready in/.test(job) && /crescent/.test(job), job);
  check('its cost came from the stockpile', await page.evaluate(g0 => window.__game.S.nation.stock.goods <= g0 - 2.5, goods0));
  await t.edit((n, now) => { n.mc.ms.scope.s = now - 3600e3; n.mc.ms.scope.d = now - 1000; });
  await sleep(500);
  const lit = await page.evaluate(() => [...window.__game.MC.reveal(window.__game.S.nation, Date.now())].filter(v => v > 0).length);
  check('the first image lights a crescent on the chart', lit === 8, lit);
  const next = await page.evaluate(() => (document.querySelector('.mc-next') || {}).innerText || '');
  check('the next requirement is named, with the action that meets it', /Flight Operations/.test(next) && !!(await page.$('.mc-next [data-act="mc-fund"]')), next);
  await page.click('.mc-next [data-act="mc-fund"]');
  await until(() => page.evaluate(() => !!window.__game.S.nation.mc.a.tm.flt));
  check('Flight Operations joins the agency', await page.evaluate(() => !!window.__game.S.nation.mc.a.tm.flt));
  /* the mandate: second staff, its cost after the laws, and the schedules side by side */
  const md0 = await page.evaluate(() => window.__game.GV().md(window.__game.S.nation, Date.now()));
  await page.click('#mc-md-mcStaff [data-act="mc-md-ask"]');
  const card = await page.evaluate(() => document.getElementById('mc-md-mcStaff').innerText);
  check('the spend shows its cost, the balance, the ordinary and the faster schedule', /Ordinary schedule/.test(card) && /With the mandate/.test(card) && /costs 2/.test(card), card);
  await page.click('[data-act="mc-md-yes"][data-k="mcStaff"]');
  await until(() => page.evaluate(() => !!window.__game.S.nation.mc.md.c1));
  check('second staff: two slots now, two mandate spent, one decree on the leader’s record', await page.evaluate(md0 => { const G = window.__game, n = G.S.nation; return G.MC.slots(n, Date.now()) === 2 && Math.abs(G.GV().md(n, Date.now()) - (md0 - 2)) < 0.05 && n.ldr.d >= 1; }, md0));
  check('and not twice', await page.evaluate(() => !document.querySelector('#mc-md-mcStaff [data-act="mc-md-ask"]')));
  await page.screenshot({ path: path.join(OUT, 'mission-control-space.png') });
  /* the Government page's mandate links to the agency's spends */
  await t.go('government');
  check('Government › Mandate lists the space agency’s spends', await page.evaluate(() => [...document.querySelectorAll('.mc-md-list li')].length === 3));
  await page.click('.mc-md-list [data-act="mc-go-md"][data-k="mcStaff"]');
  check('and its link opens the Space page', await until(() => page.evaluate(() => window.__game.S.view === 'space')));
  /* a building it needs, built from the Space page */
  await t.edit((n, now) => { n.mc.ms.cam = { s: now - 7200e3, d: now - 1000 }; });
  await t.go('space');
  const b = await page.$('.mc-next [data-act="mc-build"][data-k="mctrl"]');
  check('the missing building has a direct build button', !!b);
  if (b) { await b.click(); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).some(c => (c.b || []).some(x => x.k === 'mctrl')))); }
  check('Mission Control is under construction', await page.evaluate(() => (window.__game.S.nation.cities || []).some(c => (c.b || []).some(x => x.k === 'mctrl'))));
  await page.evaluate(() => document.querySelector('.mc-chart').scrollIntoView()); await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'mission-control-chart.png') });
  const z0 = await page.evaluate(() => window.__game.S.spV && window.__game.S.spV.moonchart ? window.__game.S.spV.moonchart.z : 1);
  await page.click('.mc-chart [data-act="sp-zoom"][data-d="1"]'); await sleep(300);
  check('the chart’s own zoom button zooms the chart', await page.evaluate(z0 => window.__game.S.spV.moonchart.z > z0, z0));
  check('no page errors on the Space page', !t.errors.length, t.errors);

  /* ── a veteran: the Lunar Colony complete, the landing at the preferred site, the first night ── */
  await t.edit((n, now) => { const c = n.cities[0]; c.b = (c.b || []).filter(b => b.k !== 'lunar').concat({ k: 'lunar', s: now - 5 * 864e5, d: now - 864e5 }); n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = now; n._stockSet = true; n.mc.xn = 'Lamplight One'; n.mc.ms.prep = { s: now - 4 * 864e5, d: now - 3 * 864e5 }; });
  await t.go('space');
  check('with the wonder complete, the full settlement map replaces the chart', await page.evaluate(() => !!document.querySelector('canvas.sp-cv:not([data-mode])') && !document.querySelector('canvas.sp-cv[data-mode="chart"]')));
  const land = await page.evaluate(() => (document.querySelector('.mc-land') || {}).innerText || '');
  check('the landing panel offers the preferred surveyed site', /Preferred site/.test(land), land);
  const pick = await page.$('.mc-land [data-act="mc-sel"]');
  if (pick) { await pick.evaluate(el => el.click()); await sleep(400); }
  check('selecting it uses the ordinary landing selection', await page.evaluate(() => !!window.__game.S.spSel));
  const landBtn = await page.$('[data-act="sp-land"]');
  check('the ordinary “Land here” button follows, checked as usual', !!landBtn);
  if (landBtn) { await landBtn.evaluate(el => el.click()); await until(() => page.evaluate(() => !!(window.__game.S.nation.sp && window.__game.S.nation.sp.moon))); }
  const col = await page.evaluate(() => { const n = window.__game.S.nation; return n.sp && n.sp.moon ? { nm: n.sp.moon.nm, e: n.sp.moon.e, p: n.sp.moon.p, ld: n.mc.ld } : null; });
  check('landed: the colony takes the expedition’s name, and the prepared crew’s 20,000 settlers and two points, recorded once', !!col && col.nm === 'Lamplight One' && col.e >= 5 && col.e < 5.1 && Math.abs(col.p - 0.02) < 0.001 && !!col.ld && col.ld.p === 1, col);
  await t.go('nation'); await t.go('space');
  check('the first night: the lit habitat, the log and the Gazette', await page.evaluate(() => !!document.querySelector('.mc-night .mc-hab') && /Lunar Gazette/.test(document.querySelector('.mc-night').textContent)));
  await page.evaluate(() => document.querySelector('.mc-night').scrollIntoView({ block: 'center' })); await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'mission-control-first-night.png') });
  check('no page errors after the landing', !t.errors.length, t.errors);

  /* ── the letter, in both themes and on a phone ── */
  await t.ctx.close();
  for (const [theme, vp, tag] of [['light', { width: 1280, height: 900 }, 'desktop-light'], ['dark', { width: 1280, height: 900 }, 'desktop-dark'], ['light', { width: 375, height: 812 }, 'phone-light'], ['dark', { width: 375, height: 812 }, 'phone-dark']]) {
    const u = await start(theme, vp), p = u.page;
    await u.edit((n, now) => { n.mc = { v: 1, a: { nm: 'Lampwick Space Agency', t: now - 3600e3, f: 'flt', tm: { flt: now - 3600e3 } }, ms: { cam: { s: now - 7200e3, d: now - 3600e3 } }, c: [], x: {}, r: 0, md: {} }; });
    const card = await letterOnDesk(u);
    check(`${tag}: the letter from Mission Control is on the desk`, !!card);
    if (!card) continue;
    const g = await goldOf(p, '.issue-card.mc-card');
    check(`${tag}: a 2 px gold border all round the card`, allGold(g), g);
    check(`${tag}: labelled Mission Control without needing colour`, await p.evaluate(() => /Mission Control · Letter I of XIV/.test(document.querySelector('.issue-card.mc-card .mc-tag').textContent)));
    check(`${tag}: ordinary cards keep their own border`, await p.evaluate(() => { const c = document.querySelector('.issue-card:not(.mc-card)'); return !c || getComputedStyle(c).borderTopWidth === '1px'; }));
    check(`${tag}: no sideways scrolling`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await card.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    check(`${tag}: the focus ring is still there`, await p.evaluate(() => { const e = document.activeElement; return e && e.classList.contains('mc-card') && getComputedStyle(e).outlineStyle !== 'none' && getComputedStyle(e).outlineWidth !== '0px'; }));
    await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: path.join(OUT, `mission-control-card-${tag}.png`) });
    await card.click(); await until(() => p.$('.paper.mc-paper'));
    const g2 = await goldOf(p, '.paper.mc-paper');
    check(`${tag}: the opened letter has the same gold border`, allGold(g2), g2);
    check(`${tag}: Dr. Okafor’s letter, with the test flight that already flew`, await p.evaluate(() => { const t = document.querySelector('.mc-letter').innerText; return /Okafor/.test(t) && /Fisheries/.test(t) && /camera test/.test(t); }));
    await p.screenshot({ path: path.join(OUT, `mission-control-letter-${tag}.png`) });
    await p.click('[data-act="answer"][data-id="mc-1"][data-o="0"]');
    await until(() => p.$('.paper.result.mc-paper'));
    check(`${tag}: the answer: gold border, and what came of it from Mission Control`, allGold(await goldOf(p, '.paper.result.mc-paper')) && await p.evaluate(() => !!document.querySelector('.mc-out p')));
    check(`${tag}: the sponsor is recorded`, await p.evaluate(() => { const r = window.__game.S.nation.mc.c[0]; return r && r.o === 0 && !!r.sn; }));
    check(`${tag}: no page errors`, !u.errors.length, u.errors);
    await u.ctx.close();
  }
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
