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
/* the Space page's tabs (Mission Control · Map · Others) and the Moon map's switch (Colonies · My survey) */
const shut = page => page.evaluate(() => { const x = document.querySelector('#tut-g .tut-x'); if (x) x.click(); });
const tab = async (page, k) => { await shut(page); if (!(await page.$(`#sp-sub-${k}.on`))) { await page.click(`[data-act="sp-sub"][data-s="${k}"]`); await sleep(200); } };
const layer = async (page, l) => { await shut(page); if (!(await page.$(`#sp-ly-${l}.on`))) { await page.click(`[data-act="sp-layer"][data-l="${l}"]`); await sleep(200); } };
const goldOf = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e), g = getComputedStyle(document.documentElement).getPropertyValue('--mc-gold').trim();
  const rgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return h; const v = parseInt(m[1], 16); return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`; };
  return { w: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], c: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor], gold: rgb(g) }; }, sel);
const allGold = g => !!g && g.w.every(w => w === '2px') && g.c.every(c => c === g.gold);

try {
  /* ── the agency, the first mission, the chart and the mandate (desktop, light) ── */
  const t = await start('light', { width: 1280, height: 900 }), { page } = t;
  await t.go('space');
  check('the page in parts: the road at its first step, three tabs, Mission Control open, no Mars or Belt tab yet', await page.evaluate(() => /Agency/.test((document.querySelector('.sp-road li.cur') || {}).textContent || '') && document.querySelectorAll('.sp-sub [data-act="sp-sub"]').length === 3 && !!document.querySelector('#sp-sub-mc.on') && !document.querySelector('.sp-bodies')));
  check('the long introduction on the first visit, remembered as seen', await page.evaluate(() => /Outer Space Treaty/.test(document.querySelector('.vh').textContent) && Object.keys(localStorage).some(k => /^edictum\.spui\./.test(k) && JSON.parse(localStorage.getItem(k)).i === 1)));
  const formOnMc = await page.evaluate(() => !!document.querySelector('form.mc-found') && !document.querySelector('canvas.sp-cv[data-mode="chart"]'));
  await tab(page, 'map');
  check('before the agency: the founding form on Mission Control, and a black survey chart on Map', formOnMc && await page.evaluate(() => !!document.querySelector('canvas.sp-cv[data-mode="chart"]') && !!document.querySelector('#sp-ly-survey.on')));
  await tab(page, 'mc');
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
  check('the road moves on, and the tiles count the slots and the sectors', await page.evaluate(() => /First picture/.test(document.querySelector('.sp-road li.cur').textContent) && /mission slots in use/.test(document.querySelector('.sp-stat').textContent) && /sectors charted/.test(document.querySelector('.sp-stat').textContent)));
  await t.edit((n, now) => { n.mc.ms.scope.s = now - 3600e3; n.mc.ms.scope.d = now - 1000; });
  await sleep(500);
  const lit = await page.evaluate(() => [...window.__game.MC.reveal(window.__game.S.nation, Date.now())].filter(v => v > 0).length);
  check('the first image lights a crescent on the chart', lit === 8, lit);
  const next = await page.evaluate(() => (document.querySelector('.mc-next') || {}).innerText || '');
  check('the next requirement is named, with the action that meets it', /Flight Operations/.test(next) && !!(await page.$('.mc-next [data-act="mc-fund"]')), next);
  await page.click('.mc-next [data-act="mc-fund"]');
  await until(() => page.evaluate(() => !!window.__game.S.nation.mc.a.tm.flt));
  check('Flight Operations joins the agency', await page.evaluate(() => !!window.__game.S.nation.mc.a.tm.flt));
  check('the teams are plain words, with no fund buttons of their own', await page.evaluate(() => /^Teams: Science & Survey and Flight Operations\./.test(document.querySelector('.mc-tm').textContent) && !document.querySelector('.mc-tm button')));
  /* the mandate: second staff, its cost after the laws, and the schedules side by side */
  const md0 = await page.evaluate(() => window.__game.GV().md(window.__game.S.nation, Date.now()));
  check('the mandate is a small link beside the slots, its card shown only when asked', await page.evaluate(() => !document.getElementById('mc-md-mcStaff') && !!document.querySelector('.mc-status [data-act="mc-md-ask"][data-k="mcStaff"]')));
  await page.click('.mc-status [data-act="mc-md-ask"][data-k="mcStaff"]');
  const card = await page.evaluate(() => document.getElementById('mc-md-mcStaff').innerText);
  check('the spend shows its cost, the balance, the ordinary and the faster schedule', /Ordinary schedule/.test(card) && /With the mandate/.test(card) && /costs 2/.test(card), card);
  await page.click('[data-act="mc-md-yes"][data-k="mcStaff"]');
  await until(() => page.evaluate(() => !!window.__game.S.nation.mc.md.c1));
  check('second staff: two slots now, two mandate spent, one decree on the leader’s record', await page.evaluate(md0 => { const G = window.__game, n = G.S.nation; return G.MC.slots(n, Date.now()) === 2 && Math.abs(G.GV().md(n, Date.now()) - (md0 - 2)) < 0.05 && n.ldr.d >= 1; }, md0));
  check('and not twice: the link is gone, the spend folded under Done so far', await page.evaluate(() => !document.querySelector('[data-act="mc-md-ask"][data-k="mcStaff"]') && /Second staff for the space agency/.test((document.getElementById('mc-done') || {}).textContent || '') && !document.getElementById('mc-done').open));
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
  check('Under way lists the building beside the missions', await page.evaluate(() => [...document.querySelectorAll('.mc-jobs li')].some(li => /Mission Control/.test(li.textContent) && /Building/.test(li.textContent))));
  await tab(page, 'map');
  await page.evaluate(() => document.querySelector('.mc-chart').scrollIntoView()); await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'mission-control-chart.png') });
  const z0 = await page.evaluate(() => window.__game.S.spV && window.__game.S.spV.moonchart ? window.__game.S.spV.moonchart.z : 1);
  await page.click('.mc-chart [data-act="sp-zoom"][data-d="1"]'); await sleep(300);
  check('the chart’s own zoom button zooms the chart', await page.evaluate(z0 => window.__game.S.spV.moonchart.z > z0, z0));
  check('no page errors on the Space page', !t.errors.length, t.errors);

  /* ── a veteran: the Lunar Colony complete, the landing at the preferred site, the first night ── */
  await t.edit((n, now) => { const c = n.cities[0]; c.b = (c.b || []).filter(b => b.k !== 'lunar').concat({ k: 'lunar', s: now - 5 * 864e5, d: now - 864e5 }); n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = now; n._stockSet = true; n.mc.xn = 'Lamplight One'; n.mc.ms.prep = { s: now - 4 * 864e5, d: now - 3 * 864e5 }; });
  await t.go('space');
  await tab(page, 'map');
  check('with the wonder complete, the map opens on the colonies, one map at a time', await page.evaluate(() => !!document.querySelector('canvas.sp-cv:not([data-mode])') && !document.querySelector('canvas.sp-cv[data-mode="chart"]') && !!document.querySelector('#sp-ly-cols.on')));
  await layer(page, 'survey');
  check('and the switch shows the survey chart in its place', await page.evaluate(() => !document.querySelector('canvas.sp-cv:not([data-mode])') && !!document.querySelector('canvas.sp-cv[data-mode="chart"]')));
  await layer(page, 'cols');
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
  /* the Moon achievements: the next save records the landing ones, and nothing the colony has not done yet */
  await t.edit(() => {});
  const ach = await page.evaluate(() => Object.keys(window.__game.S.nation.ach || {}));
  const want = ['mc-agency', 'mc-photo', 'mc-prep', 'sp-moon', 'sp-moon-first'], not = ['sp-moon1', 'sp-moon-t50', 'sp-moon-year', 'mc-letters', 'sp-moon-port'];
  check('the landing earns Ground Control, Holiday Snaps, Well Prepared, One Small Step and First on the Moon', want.every(id => ach.includes(id)), want.filter(id => !ach.includes(id)));
  check('and none of the colony’s later ones yet', not.every(id => !ach.includes(id)), not.filter(id => ach.includes(id)));
  await t.go('nation'); await t.go('space');
  check('landed: the page opens on the map of the colony', await page.evaluate(() => !!document.querySelector('#sp-sub-map.on') && !!document.querySelector('#sp-panel .sp-stats')));
  await tab(page, 'mc');
  await page.click('#mc-done > summary'); await sleep(200);
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

  /* ── the outpost (16 Nov): the cargo beacon held on the shared Moon, one smelter or extractor at 40%, and the colony
     opening there once the Lunar Colony is complete ── */
  {
    const o = await start('light', { width: 1280, height: 900 }), p = o.page;
    await o.edit((n, now) => {
      const H = 3600e3, past = h => ({ s: now - (h + 1) * H, d: now - h * H });
      n.mc = { v: 1, a: { nm: 'Lampwick Space Agency', t: now - 50 * H, f: 'flt', tm: { flt: now - 50 * H, sci: now - 50 * H, eng: now - 50 * H } },
        ms: { cam: past(48), orb: past(40), relay: past(30), polar: past(20), rover: past(10), cargo: past(2) }, c: [], x: {}, r: 0, md: {}, p: { o: 0, t: now - 60 * H } };
      const c = n.cities[0];c.b = (c.b || []).concat(['mctrl', 'dsts', 'robo', 'spaceport'].map(k => ({ k, s: now - 60 * H, d: now - 55 * H })));
      n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 };n.stockAt = now;n._stockSet = true;
    });
    await o.go('space');
    check('outpost: after the cargo landing the agency offers to make the beacon an outpost', await p.evaluate(() => !!document.querySelector('#mc-op') && !!document.querySelector('[data-act="sp-op-place"]')));
    const rate0 = await p.evaluate(() => { const G = window.__game; return G.GB().stockRates(G.S.nation); });
    await p.evaluate(() => document.querySelector('[data-act="sp-op-place"]').click());
    await until(() => p.evaluate(() => !!(window.__game.S.nation.sp && window.__game.S.nation.sp.op)));
    const op = await p.evaluate(() => { const n = window.__game.S.nation; return n.sp && n.sp.op ? { ...n.sp.op } : null; });
    check('outpost: set up on a tile of the Moon, with no building yet', !!op && op.c >= 0 && op.b === '', op);
    const opts = await p.evaluate(() => [...document.querySelectorAll('[data-act="sp-op-build"]')].map(b => ({ k: b.dataset.k, on: !b.disabled })));
    check('outpost: a smelter or an extractor to build, as the ground allows', opts.length >= 1 && opts.some(x => x.on) && opts.every(x => ['rs', 'he'].includes(x.k)), opts);
    const k = (opts.find(x => x.on) || {}).k;
    if (k) { await p.evaluate(k => document.querySelector(`[data-act="sp-op-build"][data-k="${k}"]`).click(), k); await until(() => p.evaluate(() => !!window.__game.S.nation.sp.op.b)); }
    check('outpost: the building is ordered, and the outpost has room for no other', await p.evaluate(() => /^(rs|he)/.test(window.__game.S.nation.sp.op.b) && !document.querySelector('[data-act="sp-op-build"]')));
    /* finished two days ago: it sends 40% home */
    await o.edit((n, now) => { const op = n.sp.op;op.t = now - 3 * 864e5;op.b = op.b.slice(0, 2) + op.c.toString(36) + '.0.1'; });
    const rate1 = await p.evaluate(() => { const G = window.__game; return G.GB().stockRates(G.S.nation); });
    const d = { iron: Math.round((rate1.iron - rate0.iron) * 100) / 100, oil: Math.round((rate1.oil - rate0.oil) * 100) / 100 };
    check('outpost: it sends 40% of its output home (1.6 iron or 2 oil a day)', k === 'rs' ? d.iron === 1.6 && d.oil === 0 : d.oil === 2 && d.iron === 0, { k, d });
    await o.go('nation'); await o.go('space');
    await tab(p, 'oth');
    check('outpost: the space race lists it', await p.evaluate(() => /Outpost on the Moon/.test((document.querySelector('.sp-race') || {}).textContent || '')));
    await o.edit(() => {});
    let ach = await p.evaluate(() => Object.keys(window.__game.S.nation.ach || {}));
    check('outpost: Beacon Keeper and Moonlighting', ['sp-op', 'sp-op-run'].every(id => ach.includes(id)), ach.filter(a => /^sp-/.test(a)));
    /* the Lunar Colony complete: the colony opens at the outpost */
    await o.edit((n, now) => { const c = n.cities[0];c.b = c.b.concat({ k: 'lunar', s: now - 5 * 864e5, d: now - 864e5 });n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 };n.stockAt = now;n._stockSet = true; });
    await o.go('space');
    await tab(p, 'map');
    check('outpost: with the wonder complete, the Space page offers to open the colony there', await p.evaluate(() => !!document.querySelector('#sp-panel [data-act="sp-land-op"]') && /outpost/i.test(document.querySelector('#sp-panel').textContent)));
    await p.evaluate(() => document.querySelector('#sp-panel [data-act="sp-land-op"]').click());
    await until(() => p.evaluate(() => !!(window.__game.S.nation.sp && window.__game.S.nation.sp.moon)));
    const m = await p.evaluate(() => { const n = window.__game.S.nation; return n.sp && n.sp.moon ? { t: n.sp.moon.t, c: n.sp.moon.c, b: n.sp.moon.b, ld: n.sp.moon.ld, lp: n.sp.moon.lp, op: !!n.sp.op } : null; });
    check('outpost: the colony keeps the outpost’s tile, time and building, and notes the landing', !!m && m.c === op.c && m.b.slice(0, 2) === k && m.ld > m.t && m.lp > 0 && !m.op, m);
    await o.edit(() => {});
    ach = await p.evaluate(() => Object.keys(window.__game.S.nation.ach || {}));
    check('outpost: One Small Step, Before a Billion and First on the Moon follow the landing', ['sp-moon', 'sp-moon-early', 'sp-moon-first', 'sp-moon-reg', 'sp-op'].every(id => ach.includes(id)), ach.filter(a => /^sp-/.test(a)));
    await o.go('nation'); await o.go('space');
    check('outpost: the panel is the colony’s own now', await p.evaluate(() => /Your colony on/.test(document.querySelector('#sp-panel').textContent)));
    await p.screenshot({ path: path.join(OUT, 'mission-control-outpost-colony.png') });
    /* on a phone, a tile selected on the map: a bar at the foot of the screen says what it is and what to do */
    await p.setViewportSize({ width: 375, height: 812 }); await sleep(300);
    await p.evaluate(() => { const G = window.__game, c = G.S.nation.sp.moon.c; G.S.spSel = { b: 'moon', c }; G.render(); });
    const bar = await p.evaluate(() => { const b = document.querySelector('.sp-selbar'); if (!b) return null; const s = getComputedStyle(b), r = b.getBoundingClientRect(), tb = document.querySelector('.tabbar'); return { pos: s.position, vis: s.display !== 'none', t: b.textContent, above: !tb || r.bottom <= tb.getBoundingClientRect().top + 1 }; });
    check('outpost: on a phone the selected tile has a bar at the foot, above the tab bar', !!bar && bar.pos === 'fixed' && bar.vis && /Details/.test(bar.t) && bar.above, bar);
    await p.screenshot({ path: path.join(OUT, 'mission-control-selbar-phone.png') });
    await p.click('[data-act="sp-sb-x"]'); await sleep(200);
    check('outpost: and the cross clears the selection', await p.evaluate(() => !window.__game.S.spSel && !document.querySelector('.sp-selbar')));
    check('outpost: no sideways scrolling on a phone', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.setViewportSize({ width: 1280, height: 900 });
    check('outpost: no page errors', !o.errors.length, o.errors);
    await o.ctx.close();
  }

  /* ── charting the Moon: the second dish and its queue, a block, a strip, a traverse, a campaign, the finds, the rewards,
     a landing site chosen from the chart, and the chart kept after the Lunar Colony ── */
  {
    const o = await start('light', { width: 1280, height: 900 }), p = o.page;
    await o.edit((n, now) => { const D = 864e5, T = now - 30 * D, c = n.cities[0];
      n.mc.a = { nm: 'Lampwick Survey', t: T, f: 'sci', tm: { sci: T, flt: T, eng: T } };
      for (const [k, d] of [['scope', 20], ['cam', 19], ['orb', 18], ['relay', 17], ['polar', 16], ['rover', 15]]) n.mc.ms[k] = { s: now - d * D - 3600e3, d: now - d * D };
      n.mc.ms.relay.v = 'dom'; n.mc.c = [0, 1, 2, 3, 4].map(() => ({ o: 0, f: 'rep', b: '111', t: T, x: '' }));
      c.b = (c.b || []).concat(['mctrl', 'dsts', 'robo', 'observ'].map(k => ({ k, s: T, d: T + 3600e3 })));
      n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; n._stockSet = true; });
    await o.go('space');
    const sel = async s => { await tab(p, 'map'); await p.evaluate(s => { const G = window.__game; G.S.mcSec = s; G.render(); }, s); };
    const mc = () => tab(p, 'mc');
    const finish = () => o.edit((n, now) => { for (const k of Object.keys(n.mc.ms)) { const m = n.mc.ms[k]; if (m.d > now && m.v !== 'dish') { m.s = now - 2 * 864e5; m.d = now - 864e5 - 60e3; } } });
    const free = (kind, need) => p.evaluate(([kind, need]) => { const G = window.__game, n = G.S.nation, now = Date.now(), L = G.MC.reveal(n, now);
      for (let s = 0; s < 160; s++) { if (need === 2 && L[s] < 2) continue; for (const k of kind === 'tv' ? ['n', 'e', 's', 'w'].map(d => 'tv' + s + d) : [kind === 'wf' ? G.MC.wfKey(s) : kind === 'os' ? G.MC.osKey(s) : 'sc' + s]) if (k && !G.MC.startProblem(n, k, now)) return { s, k }; }
      return null; }, [kind, need]);
    const ag = () => p.evaluate(() => (document.querySelector('.mc-agency') || {}).textContent || '');
    const a0 = await ag();
    check('charting: the agency counts the charted sectors and names the next reward', /of 160 sectors charted in detail/.test(a0) && /At 40: the Selenographia card pattern/.test(a0), a0.slice(0, 400));
    /* the second dish */
    const g0 = await p.evaluate(() => window.__game.S.nation.stock.goods);
    await p.click('[data-act="mc-dish"]');
    await until(() => p.evaluate(() => !!window.__game.S.nation.mc.dh));
    check('charting: the second dish is ordered and paid for', await p.evaluate(g0 => { const n = window.__game.S.nation; return !!n.mc.dh && n.mc.dh.d - n.mc.dh.s === 8 * 3600e3 && n.stock.goods <= g0 - 29.5; }, g0));
    await o.edit((n, now) => { n.mc.dh = { s: now - 9 * 3600e3, d: now - 3600e3 }; });
    /* a wide-field block keeps Science & Survey busy */
    const wf = await free('wf');
    await sel(wf.s);
    const info = await p.evaluate(() => (document.getElementById('mc-sec') || {}).textContent || '');
    check('charting: a sector offers a survey, a wide-field block and an orbiter strip', /Survey this sector/.test(info) && /Wide-field survey/.test(info) && /Mapping orbiter/.test(info), info);
    await p.click(`#mc-sec [data-act="mc-start"][data-k="${wf.k}"]`);
    await until(() => p.evaluate(k => !!window.__game.S.nation.mc.ms[k], wf.k));
    await mc();
    check('charting: the wide-field survey is under way with Science & Survey', await p.evaluate(() => /Wide-field survey/.test((document.querySelector('.mc-jobs') || {}).textContent || '')),
      await p.evaluate(() => ({ msg: window.__game.S.mcMsg, ms: Object.keys(window.__game.S.nation.mc.ms), agency: !!document.querySelector('.mc-agency') })));
    /* so three sector surveys go to the second dish's queue, back to back */
    for (let i = 0; i < 3; i++) { const sc = await free('sc'); await sel(sc.s); await p.click(`#mc-sec [data-act="mc-start"][data-k="${sc.k}"]`); await until(() => p.evaluate(k => !!window.__game.S.nation.mc.ms[k], sc.k)); }
    const lane = await p.evaluate(() => { const G = window.__game; return G.MC.lane(G.S.nation, Date.now()).map(x => ({ k: x.k, s: x.s, d: x.d, v: x.v })); });
    check('charting: with Science & Survey busy, three sectors queue at the second dish, back to back', lane.length === 3 && lane.every(x => x.v === 'dish') && lane[1].s === lane[0].d && lane[2].s === lane[1].d, lane);
    await mc();
    check('charting: the queue is listed under Under way, with Remove beside the two not started', await p.evaluate(() => document.querySelectorAll('.mc-jobs .mc-qi').length === 3 && document.querySelectorAll('.mc-jobs .mc-qi [data-act="mc-unq"]').length === 2));
    check('charting: the tiles count the queue', await p.evaluate(() => /3 of 5\s*in the survey queue/.test(document.querySelector('.sp-stat').textContent)));
    await (await p.$('.mc-agency')).screenshot({ path: path.join(OUT, 'mission-control-survey-agency.png') });
    const gq = await p.evaluate(() => window.__game.S.nation.stock.goods);
    await p.click(`.mc-jobs [data-act="mc-unq"][data-k="${lane[1].k}"]`);
    await until(() => p.evaluate(k => !window.__game.S.nation.mc.ms[k], lane[1].k));
    const lane2 = await p.evaluate(() => { const G = window.__game; return G.MC.lane(G.S.nation, Date.now()).map(x => ({ k: x.k, s: x.s, d: x.d })); });
    check('charting: a queued survey comes out, its cost back, and the next moves up', lane2.length === 2 && lane2[1].s === lane2[0].d && await p.evaluate(g => Math.abs(window.__game.S.nation.stock.goods - (g + 5)) < 0.6, gq), lane2);
    await finish();
    /* a far-side campaign, a mapping orbiter, a rover traverse */
    await o.go('nation'); await o.go('space'); await mc();
    check('charting: the next campaign of each chain is listed, the first far-side one ready to start', await p.evaluate(() => { const t = document.querySelector('.mc-camp').textContent; return !!document.querySelector('.mc-camp [data-act="mc-start"][data-k="fs1"]') && /polar night survey: north/.test(t) && !/campaign II/.test(t) && !/survey: south/.test(t); }));
    await p.click('.mc-camp [data-act="mc-start"][data-k="fs1"]');
    await until(() => p.evaluate(() => !!window.__game.S.nation.mc.ms.fs1));
    check('charting: the far-side campaign is under way', await p.evaluate(() => /Far-side campaign I/.test(document.querySelector('.mc-jobs').textContent)));
    await finish();
    const os = await free('os');
    await sel(os.s); await p.click(`#mc-sec [data-act="mc-start"][data-k="${os.k}"]`);
    await until(() => p.evaluate(k => !!window.__game.S.nation.mc.ms[k], os.k));
    await mc();
    check('charting: a mapping orbiter flies with Flight Operations', await p.evaluate(() => /Mapping orbiter/.test(document.querySelector('.mc-jobs').textContent) && /Flight Operations/.test(document.querySelector('.mc-jobs').textContent)));
    await finish();
    const tv = await free('tv', 2);
    await sel(tv.s);
    check('charting: a charted sector offers a rover traverse', await p.evaluate(() => /Rover traverse from here/.test(document.getElementById('mc-sec').textContent)));
    await p.click(`#mc-sec [data-act="mc-start"][data-k="${tv.k}"]`);
    await until(() => p.evaluate(k => !!window.__game.S.nation.mc.ms[k], tv.k));
    const fold = await p.evaluate(([wk, ok]) => { const n = window.__game.S.nation; return { sv: n.mc.sv || '', wf: !!n.mc.ms[wk], os: !!n.mc.ms[ok], fs1: !!n.mc.ms.fs1 }; }, [wf.k, os.k]);
    check('charting: the traverse is under way, and finished surveys folded into the chart’s record', /^[0-9a-f]{40}$/.test(fold.sv) && !fold.wf && !fold.os && fold.fs1, fold);
    await finish();
    /* every sector charted: finds, rewards, Every Sector */
    await o.edit(n => { n.mc.sv = 'f'.repeat(40); });
    await o.go('nation'); await o.go('space');
    const fd = await p.evaluate(() => { const G = window.__game; return G.MC.finds(G.S.nation, Date.now()).length; });
    await mc();
    check('charting: the finds count in the tiles and in the section’s line', await p.evaluate(() => /finds to bring home/.test(document.querySelector('.sp-stat').textContent) && /finds to bring home/.test(document.querySelector('#mc-survey > summary').textContent)));
    check('charting: the campaigns charted are folded under Done so far', await p.evaluate(() => /Far-side campaign I/.test((document.getElementById('mc-done') || {}).textContent || '')));
    check('charting: the whole Moon charted holds its finds, listed to bring home', fd > 20 && await p.evaluate(() => !!document.querySelector('.mc-finds [data-act="mc-home"][data-s="all"]')), fd);
    await sel(await p.evaluate(() => { const G = window.__game; return G.MC.finds(G.S.nation, Date.now())[3].s; }));
    await p.evaluate(() => document.querySelector('.mc-chart').scrollIntoView()); await sleep(1200);
    await p.screenshot({ path: path.join(OUT, 'mission-control-survey-finds.png') });
    await mc();
    const s0 = await p.evaluate(() => ({ ...window.__game.S.nation.stock }));
    await p.click('.mc-finds [data-act="mc-home"][data-s="all"]');
    await until(() => p.evaluate(() => !!window.__game.S.nation.mc.fc));
    const home = await p.evaluate(s0 => { const G = window.__game, n = G.S.nation, F = G.MC.finds(n, Date.now()); return { all: F.every(f => f.got), gain: ['food', 'iron', 'oil', 'goods'].reduce((a, r) => a + n.stock[r] - s0[r], 0) }; }, s0);
    check('charting: the finds come home, their resources in the stockpile', home.all && home.gain > 300, home);
    await o.edit(() => {});
    const rw = await p.evaluate(() => { const G = window.__game, n = G.S.nation, u = G.UX.unlocksOf(n), m = G.clone(n); m.mc.sv = undefined; m.mc.ms = {};
      return { u: ['p-selene', 'c-moonchart', 'e-moonchart', 'pn-dish'].filter(id => u.has(id)), land: G.RK.landEarned(n) - G.RK.landEarned(m), ach: !!(n.ach && n.ach['mc-chart-all']) }; });
    check('charting: the rewards at 40, 80 and 120 sectors, their land credits, and Every Sector at 160', rw.u.length === 4 && rw.land >= 6 && rw.ach, rw);
    /* a landing site chosen from the chart */
    const ps = await p.evaluate(() => { const G = window.__game, n = G.S.nation, now = Date.now(), cand = G.MC.sites(n);
      for (let s = 0; s < 160; s++) { const c = G.MC.secSite(s); if (c >= 0 && !cand.includes(c) && c !== G.MC.prefTile(n) && G.MC.prefOk(n, c, now)) return { s, c }; } return null; });
    await sel(ps.s);
    await p.click(`#mc-sec [data-act="mc-pref"][data-c="${ps.c}"]`);
    await until(() => p.evaluate(c => window.__game.S.nation.mc.pf === c, ps.c));
    await mc();
    check('charting: any charted sector’s best ground can be the preferred landing site', await p.evaluate(c => window.__game.S.nation.mc.pf === c && /chosen from the chart/.test(document.querySelector('.mc-sites').textContent), ps.c));
    await tab(p, 'map');
    await p.evaluate(() => document.querySelector('.mc-chart').scrollIntoView()); await sleep(1200);
    await p.screenshot({ path: path.join(OUT, 'mission-control-survey-chart.png') });
    /* the Lunar Colony complete: the chart follows the shared map, and still charts */
    await o.edit((n, now) => { const c = n.cities[0]; c.b = c.b.concat({ k: 'lunar', s: now - 5 * 864e5, d: now - 864e5 }); n.mc.sv = undefined; });
    await o.go('nation'); await o.go('space');
    const sc = await free('sc');
    await tab(p, 'map');
    const colsFirst = await p.evaluate(() => !!document.querySelector('#sp-ly-cols.on') && !!document.querySelector('canvas.sp-cv:not([data-mode])'));
    await layer(p, 'survey');
    await sel(sc.s);
    check('charting: after the Lunar Colony the map opens on the colonies, and its switch keeps the survey chart, which still surveys', colsFirst && await p.evaluate(k => !!document.querySelector('canvas.sp-cv[data-mode="chart"]') && !!document.querySelector(`#mc-sec [data-act="mc-start"][data-k="${k}"]`), sc.k));
    check('charting: no page errors', !o.errors.length, o.errors);
    await o.ctx.close();
  }
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
