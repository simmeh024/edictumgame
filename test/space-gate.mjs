// The Space page opens with an edict: out of the menu until 25 edicts have been enacted, then “Class 4B Would Like to
// Know” on the Edicts desk in Mission Control's gold. Any answer opens the page, and the first visit starts a tour
// that points at the page step by step and ends with what to do next. A veto puts the question off for five edicts.
// On a desktop and a phone, in the light and dark themes.
//   python3 build.py
//   node test/space-gate.mjs
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
const STEPS = ['Your space programme', 'Found the agency', 'Missions take time', 'What to do now', 'The survey chart', 'Buildings for the agency', 'Letters from Mission Control', 'The road to the Moon'];

/* a founded nation with its capital settled and the charter behind it, the Space page not yet open */
async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Orrery');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  await edit(n => { delete n.onb; n.stock = { food: 300, timber: 300, iron: 300, oil: 300, goods: 300 }; n.stockAt = Date.now(); n._stockSet = true; });
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(400); };
  /* the count reached and two arrival slots passed: the prelude takes the first */
  const due = (e = 25) => edit((n, now, G, e) => { n.ws.e = e; n.inbox = []; n.issueClock = now - 2 * n.freq * 60000 - 1000; }, e);
  return { ctx, page, errors, edit, go, due };
}
const inMenu = page => page.evaluate(() => !!document.querySelector('.nav-btn[data-v="space"]'));
const tour = page => page.evaluate(() => {
  const g = document.getElementById('tut-g'); if (!g) return null; const sh = g.querySelector('.tut-sheet'), sp = g.querySelector('.tut-spot'), r = sh.getBoundingClientRect();
  return { k: g.querySelector('#tut-g-k').textContent, h: (g.querySelector('#tut-g-h') || {}).textContent, n: (g.querySelector('.tut-n') || {}).textContent, body: g.querySelector('.tut-body').textContent,
    spot: !sp.hidden && sp.getClientRects().length ? (b => ({ l: b.left, t: b.top, r: b.right, b: b.bottom }))(sp.getBoundingClientRect()) : null,
    sheet: { l: r.left, t: r.top, r: r.right, b: r.bottom }, dock: sh.classList.contains('tut-dock'), fig: !!g.querySelector('.tut-fig'), next: g.querySelector('[data-act="tut-g-next"]').textContent };
});
/* whether the spotlight sits round an element (allowing for its padding and the screen's edges) */
/* whether the spotlight is round an element: the element's visible middle inside the spot */
const around = (page, spot, sel) => page.evaluate(([s, sel]) => { const e = document.querySelector(sel); if (!e || !s) return false; const r = e.getBoundingClientRect();
  const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2, y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2; return x >= s.l && x <= s.r && y >= s.t && y <= s.b; }, [spot, sel]);
/* the tour once the page has stopped scrolling to its target */
const settled = async page => { let a = null; for (let i = 0; i < 20; i++) { await sleep(150); const b = await tour(page); if (a && b && JSON.stringify(a.spot) === JSON.stringify(b.spot) && JSON.stringify(a.sheet) === JSON.stringify(b.sheet)) return b; a = b; } return a; };
const goldOf = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e), g = getComputedStyle(document.documentElement).getPropertyValue('--mc-gold').trim();
  const rgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return h; const v = parseInt(m[1], 16); return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`; };
  return { w: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], c: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor], gold: rgb(g) }; }, sel);
/* the sheet leaves what it points at in view: all of it when it fits, else its first 60 pixels */
const clear = g => !!g && !!g.spot && (g.sheet.t >= g.spot.b - 1 || g.sheet.b <= g.spot.t + 1 || g.spot.t + 60 <= g.sheet.t || g.sheet.r <= g.spot.l + 1 || g.sheet.l >= g.spot.r - 1);
const allGold = g => !!g && g.w.every(w => w === '2px') && g.c.every(c => c === g.gold);
const toastSeen = (page, re) => until(() => page.evaluate(src => [...document.querySelectorAll('.toast,[role="status"]')].some(e => new RegExp(src).test(e.textContent)), re.source), 20000);

try {
  /* ── desktop, light: closed, the prelude, an answer, the tour ── */
  {
    const t = await start('light', { width: 1280, height: 900 }), { page } = t;
    check('a new nation: Space is not in the menu', !await inMenu(page));
    await page.keyboard.press('Control+k'); await page.waitForSelector('#qj-in'); await page.fill('#qj-in', 'Space'); await sleep(200);
    check('nor in Go to page', !await page.$('#qj-list [data-v="space"]'));
    await page.keyboard.press('Escape'); await sleep(200);
    await t.go('space');
    check('#space says what opens it, and how far the nation has come', await page.evaluate(() => { const l = document.querySelector('.spx-lock'); return !!l && /enacted 25 edicts/.test(l.textContent) && /has enacted 0 so far/.test(l.textContent) && !document.getElementById('mc-agency'); }));
    check('no tour on a closed page', await sleep(600).then(() => page.evaluate(() => !document.getElementById('tut-g'))));
    await page.screenshot({ path: OUT + '/space-gate-closed-1280.png' });
    await t.due(24); await t.go('issues');
    check('24 edicts: no prelude on the desk', await page.evaluate(() => !document.querySelector('.issue-card[data-id="mc-pre"]')));
    await t.due(25); await t.go('issues');
    check('25 edicts: an arrival brings “Class 4B Would Like to Know”, after the Willow Street letter that was due', await until(() => page.evaluate(() => { const ids = [...document.querySelectorAll('.issue-card')].map(b => b.dataset.id); return ids.includes('mc-pre') && ids.includes('ws-1'); })));
    const card = '.issue-card[data-id="mc-pre"]';
    check('on the desk in Mission Control’s gold, with its label', await until(() => page.$(card + '.mc-card')) && allGold(await goldOf(page, card)) && /Mission Control · Prelude/.test(await page.$eval(card, e => e.textContent)), await goldOf(page, card));
    await t.go('space');
    check('the closed page points at it', await page.evaluate(() => /on your Edicts desk now/.test(document.querySelector('.spx-lock').textContent) && !!document.querySelector('.spx-lock [data-act="open"][data-id="mc-pre"]')));
    await page.click('.spx-lock [data-act="open"][data-id="mc-pre"]');
    check('it opens on gold paper, with its story', await until(() => page.evaluate(() => { const p = document.querySelector('.paper.edict.mc-paper'); return !!p && /Class 4B Would Like to Know/.test(p.querySelector('.h1').textContent) && /Dr\. Lyra Okafor/.test(p.textContent) && /Any answer opens the Space page/.test(p.textContent); })));
    check('three answers, from three ministers', await page.$$eval('[data-act="answer"][data-id="mc-pre"]', b => b.length) === 3);
    await sleep(700); await page.screenshot({ path: OUT + '/space-gate-edict-1280.png' });
    await page.click('[data-act="answer"][data-id="mc-pre"][data-o="0"]');
    check('the result: what came of it, and the way to Space', await until(() => page.evaluate(() => { const o = document.querySelector('.paper.result.mc-paper .spx-out'); return !!o && /From the Ministry of Space Affairs/.test(o.textContent) && /The Space page is open/.test(o.textContent) && /Science & Survey/.test(o.textContent) && !!o.querySelector('[data-act="go"][data-v="space"]'); })));
    check('the page is open, and in the menu', await page.evaluate(() => window.__game.S.nation.mc.p.o === 0) && await until(() => inMenu(page)));
    check('the player is told', await toastSeen(page, /Space page is open/));
    check('a story edict: the count of enacted edicts does not move', await page.evaluate(() => window.__game.S.nation.ws.e === 25));
    await page.screenshot({ path: OUT + '/space-gate-result-1280.png' });
    await page.click('.spx-out [data-act="go"][data-v="space"]');
    check('the first visit starts the tour', await until(async () => { const g = await tour(page); return g && g.h === STEPS[0]; }));
    let g = await settled(page);
    check('“Guide to the Space page”, step 1 of 8, pointing at the agency', g.k === 'Guide to the Space page' && g.n === '1 of 8' && !!g.spot && await around(page, g.spot, '#mc-agency .eyebrow'), g);
    check('it says it appears once and can be brought back', /appears once/.test(g.body));
    check('the sheet sits clear of the agency’s title', clear(g) && (g.sheet.t >= g.spot.b - 1 || g.sheet.b <= g.spot.t + 1), g);
    await page.screenshot({ path: OUT + '/space-gate-tour-1-1280.png' });
    const seen = [g.h];
    for (let i = 1; i < STEPS.length; i++) {
      await page.click('#tut-g [data-act="tut-g-next"]'); g = await settled(page); seen.push(g && g.h);
      if (i === 1) {
        check('step 2 points at the team choice', !!g.spot && await around(page, g.spot, '#mc-agency .mc-teams'), g.spot);
        check('and says the backed team is chosen already', /backed Science & Survey/.test(g.body));
        check('the sheet sits clear of the team cards', clear(g) && (g.sheet.t >= g.spot.b - 1 || g.sheet.b <= g.spot.t + 1), g);
        await page.screenshot({ path: OUT + '/space-gate-tour-2-1280.png' });
      }
      if (i === 3) check('“What to do now”: found the agency', /Found the agency/.test(g.body) && !!g.spot);
      if (i === 4) check('the chart step points at the black chart', !!g.spot && await around(page, g.spot, '.mc-chart .sp-wrap'), g.spot);
      if (i === 7) check('the last step points at the road to the Moon, and its button says Done', !!g.spot && await around(page, g.spot, '.sp-teaser .sp-steps') && g.next === 'Done', g);
    }
    check('eight steps, in order', JSON.stringify(seen) === JSON.stringify(STEPS), seen);
    await page.click('#tut-g [data-act="tut-g-next"]');
    check('Done closes it', await until(() => page.evaluate(() => !document.getElementById('tut-g'))));
    check('and it is remembered with the nation', await until(() => page.evaluate(() => /s/.test((window.__game.S.nation.tut || {}).g || ''))));
    check('the founding form offers the backed team', await page.evaluate(() => document.querySelector('input[name="mc-team"][value="sci"]').checked && /backed/.test(document.querySelector('.spx-backed').textContent)));
    await t.go('nation'); await t.go('space'); await sleep(700);
    check('a second visit: no tour', await page.evaluate(() => !document.getElementById('tut-g')));
    await page.click('.spx-tour [data-act="tut-guide"][data-g="s"]');
    g = await tour(page);
    check('“Tour of this page” brings it back, without the once-only note', !!g && g.h === STEPS[0] && !/appears once/.test(g.body));
    await page.keyboard.press('Escape');
    check('Escape closes it', await until(() => page.evaluate(() => !document.getElementById('tut-g'))));
    /* found the agency: the tour now speaks of the teams and names the next step */
    await page.click('form.mc-found button[type="submit"]');
    await until(() => page.evaluate(() => !!(window.__game.S.nation.mc.a)));
    check('the agency is founded with the backed team', await page.evaluate(() => window.__game.S.nation.mc.a.f === 'sci'));
    await page.click('.spx-tour [data-act="tut-guide"][data-g="s"]');
    await page.click('#tut-g [data-act="tut-g-next"]'); g = await settled(page);
    check('step 2 is now “Your teams”, at the team chips', g.h === 'Your teams' && !!g.spot && await around(page, g.spot, '#mc-agency .mc-tm'), g);
    await page.click('#tut-g [data-act="tut-g-next"]'); await page.click('#tut-g [data-act="tut-g-next"]'); g = await settled(page);
    check('“What to do now” names the first assignment, at the next-step box', g.h === 'What to do now' && /Borrowed telescope time/.test(g.body) && !!g.spot && await around(page, g.spot, '#mc-agency .mc-next'), g);
    await page.screenshot({ path: OUT + '/space-gate-tour-next-1280.png' });
    await page.keyboard.press('Escape');
    /* How to play: the short tutorial, and the tour from there with its “Show me” */
    await t.go('help');
    check('How to play has “The Space page, step by step”', await page.evaluate(() => { const s = document.getElementById('help-space-page'); return !!s && /Found the agency/.test(s.textContent) && /25 edicts/.test(s.textContent); }));
    await page.evaluate(() => document.querySelector('#help-space-page [data-act="tut-guide"][data-g="s"]').click());
    g = await tour(page);
    check('“Take the tour” opens it off the page, with a picture and Show me', !!g && g.fig && !g.spot && /Show me/.test(g.body), g);
    await page.click('#tut-g [data-act="tut-g-there"]');
    check('Show me goes to the Space page and lights the agency', await until(async () => { const x = await tour(page); return x && x.spot && await page.evaluate(() => window.__game.S.view === 'space'); }));
    await page.keyboard.press('Escape');
    check('desktop: no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }

  /* ── desktop, dark: a veto puts it off ── */
  {
    const t = await start('dark', { width: 1280, height: 900 }), { page } = t;
    await t.due(25); await t.go('issues');
    await until(() => page.$('.issue-card[data-id="mc-pre"]'));
    check('dark: the gold border holds', allGold(await goldOf(page, '.issue-card[data-id="mc-pre"]')));
    await page.click('.issue-card[data-id="mc-pre"]');
    await until(() => page.$('[data-act="dismiss"][data-id="mc-pre"]'));
    check('dark: the paper is gold too', allGold(await goldOf(page, '.paper.edict.mc-paper')));
    await page.click('[data-act="dismiss"][data-id="mc-pre"]');
    check('a veto is recorded, and says the question comes back', await until(() => page.evaluate(() => { const p = window.__game.S.nation.mc.p; return p && p.o === -1 && p.e === 25; })) && await toastSeen(page, /come back/));
    check('the page stays closed and out of the menu', !await inMenu(page));
    await t.go('space');
    check('#space says when it comes back', await page.evaluate(() => /You vetoed it/.test(document.querySelector('.spx-lock').textContent) && /enacted 30 edicts/.test(document.querySelector('.spx-lock').textContent)));
    await t.due(29); await t.go('issues');
    check('not before thirty', await page.evaluate(() => !document.querySelector('.issue-card[data-id="mc-pre"]')));
    await t.due(30); await t.go('issues');
    check('at thirty it is back', await until(() => page.evaluate(() => !!document.querySelector('.issue-card[data-id="mc-pre"]'))));
    await page.screenshot({ path: OUT + '/space-gate-desk-dark-1280.png' });
    check('dark: no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }

  /* ── a phone, light and dark: the edict, an answer, the tour docked under the page ── */
  for (const theme of ['light', 'dark']) {
    const t = await start(theme, { width: 375, height: 812 }), { page } = t, P = 'phone-' + theme + ': ';
    await t.due(25); await t.go('issues');
    await until(() => page.$('.issue-card[data-id="mc-pre"]'));
    check(P + 'the gold card', allGold(await goldOf(page, '.issue-card[data-id="mc-pre"]')));
    await page.click('.issue-card[data-id="mc-pre"]');
    await page.waitForSelector('[data-act="answer"][data-id="mc-pre"][data-o="2"]');
    await page.evaluate(() => document.querySelector('[data-act="answer"][data-id="mc-pre"][data-o="2"]').click());
    await until(() => page.$('.spx-out'));
    check(P + 'the result names Flight Operations', /Flight Operations/.test(await page.$eval('.spx-out', e => e.textContent)));
    await page.evaluate(() => document.querySelector('.spx-out [data-act="go"][data-v="space"]').click());
    check(P + 'the tour starts', await until(async () => { const g = await tour(page); return g && g.h === STEPS[0]; }));
    let g = await settled(page);
    check(P + 'the sheet fits the screen and docks beside the page', g.sheet.l >= 0 && g.sheet.r <= 375 + 0.5 && g.sheet.b <= 812 + 0.5 && g.dock && !!g.spot, g);
    check(P + 'the sheet leaves what it points at in view', clear(g), g);
    check(P + 'step 1 fits whole above the sheet', g.sheet.t >= g.spot.b - 1, g);
    await page.screenshot({ path: OUT + `/space-gate-tour-1-375-${theme}.png` });
    await page.click('#tut-g [data-act="tut-g-next"]'); g = await settled(page);
    check(P + 'step 2 lights the team choice, Flight Operations chosen', g.h === 'Found the agency' && !!g.spot && /backed Flight Operations/.test(g.body) && await page.evaluate(() => document.querySelector('input[name="mc-team"][value="flt"]').checked));
    check(P + 'and leaves it in view', clear(g), g);
    await page.screenshot({ path: OUT + `/space-gate-tour-2-375-${theme}.png` });
    for (let i = 2; i < STEPS.length; i++) { await page.click('#tut-g [data-act="tut-g-next"]'); await sleep(300); }
    g = await tour(page);
    check(P + 'all eight steps', g.h === STEPS[7] && g.n === '8 of 8');
    await page.click('#tut-g [data-act="tut-g-next"]');
    check(P + 'Done closes it', await until(() => page.evaluate(() => !document.getElementById('tut-g'))));
    check(P + 'Space is in the menu', await page.evaluate(() => !!document.querySelector('.nav-btn[data-v="space"]')));
    check(P + 'no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
} catch (e) { console.log('FAIL exception ::', e && e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
