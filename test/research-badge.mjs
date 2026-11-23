// The Research Lab's badge (game/edictum.html, "the badge: what has finished since the player last looked"): a
// laboratory with no site counts as one thing waiting; a finished stage of the works and a finished study count on
// Research Lab in the menu until their tab (Laboratory, Overview) has been open; a technology bought outright does not;
// the tab carries the number while the page is open on another, and Recent discoveries marks the new ones New; the
// bell tells of each, its link opens the tab, and Settings › Notifications can turn them off. On a desktop (light)
// and a phone (dark), where Research Lab is behind More. Screenshots go to test/out/.
//   python3 build.py
//   node test/research-badge.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
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

async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Selenia');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { window.__game.rs = window.EDICTUM_PROBE.rs; });
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  const go = async v => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; S.notifOpen = false; location.hash = '#' + v; window.__game.render(); }, v); await until(() => page.evaluate(v => window.__game.S.view === v.split('/')[0], v)); await sleep(300); };
  const answer = async (id, o = 0) => {
    for (let k = 0; k < 4; k++) {
      await page.click(`.issue-card[data-id="${id}"]`).catch(() => {});
      if (await until(() => page.$(`[data-act="answer"][data-id="${id}"]`), 3000)) break;
      await page.evaluate(id => { const S = window.__game.S; S.openIssue = id; window.__game.render(); }, id);
      if (await until(() => page.$(`[data-act="answer"][data-id="${id}"]`), 2000)) break;
    }
    await page.click(`[data-act="answer"][data-id="${id}"][data-o="${o}"]`);
    await until(() => page.evaluate(id => (window.__game.S.nation.answered || []).some(a => a.id === id), id));
  };
  /* the petition granted: Research Lab in the menu, the laboratory still to be founded */
  const grant = async () => {
    await edit(n => { n.ws.e = 60; n.inbox = []; });
    await go('issues');
    await until(() => page.evaluate(() => !!document.querySelector('.issue-card[data-id="rs-discovery"]')));
    const k = await page.evaluate(() => { const c = window.__game.rs.rsLabSites(window.__game.S.nation); return [0, 1, 2].find(k => c[k] >= 0); });
    await answer('rs-discovery', k);
  };
  /* the badges of Research Lab: [numbers], words for a screen reader (the side menu, the phone's More sheet) */
  const badge = (sel = 'nav.nav [data-v="research"]') => page.evaluate(sel => { const b = document.querySelector(sel); return b ? { n: [...b.querySelectorAll('.badge')].map(x => x.textContent).join(','), w: [...b.querySelectorAll('.u-sr')].map(x => x.textContent).join('') } : null; }, sel);
  const tabMark = t => page.evaluate(t => { const b = document.querySelector('#rs-tab-' + t + ' > .nvx-tb'); return b ? b.textContent : ''; }, t);
  const isOpen = () => page.evaluate(() => !!document.querySelector('.notif-pop'));
  const openBell = async () => { if (!(await isOpen())) await page.click('.bell'); await until(isOpen); };
  const closeBell = async () => { if (await isOpen()) await page.click('.bell'); await until(async () => !(await isOpen())); };
  const notes = () => page.evaluate(() => [...document.querySelectorAll('.notif-pop .nt[data-v="research"]')].map(b => ({ k: b.querySelector('.nt-k').textContent, x: b.querySelector('.nt-x').textContent, dl: b.dataset.dl || '' })));
  return { ctx, page, errors, edit, go, grant, badge, tabMark, openBell, closeBell, notes };
}

try {
  /* ── desktop, light ── */
  {
    const t = await start('light', { width: 1360, height: 900 }), { page } = t;
    await t.grant();
    await t.go('nation');
    const b0 = await until(async () => { const b = await t.badge(); return b && b.n === '1' && b; });
    check('a laboratory with no site: Research Lab shows 1, a site to choose', b0 && /a site to choose for the laboratory/.test(b0.w), b0 || await t.badge());
    await t.go('research');
    check('and on the page, the Laboratory tab carries it', await until(async () => (await t.tabMark('lab')) === '1'));

    /* the site chosen and the first stage's works finished, while the player is on the Nation page */
    await t.go('nation');
    await t.edit((n, now, G) => { const o = n.nrp.o || 0; n.nrp.c = G.rs.rsLabSites(n)[o]; n.nrp.o = o; n.nrp.rg = n.reg; n.nrp.nm = 'Selenia Laboratory'; n.nrp.dn = 'Dr. Ada Quillfeather'; n.nrp.st = 0; n.nrp.su = now - 1000; });
    check('the works finish by themselves', await until(() => page.evaluate(() => window.__game.S.nation.nrp.st === 1)));
    const b1 = await until(async () => { const b = await t.badge(); return b && b.n === '1' && /a stage of works finished/.test(b.w) && b; });
    check('a finished stage: Research Lab shows 1, a stage of works finished (the site no longer counts)', !!b1, await t.badge());
    await page.screenshot({ path: OUT + '/research-badge-nav-1360.png' });
    await t.openBell();
    const n1 = await t.notes();
    check('the bell tells of it under National Research, its link the Laboratory tab', n1.some(x => /National Research/.test(x.k) && /is finished\. Next:/.test(x.x) && x.dl === 'rs:lab'), n1);
    await page.screenshot({ path: OUT + '/research-badge-bell-1360.png' });
    await page.click('.notif-pop .nt[data-dl="rs:lab"]');
    check('the bell’s link opens Research on the Laboratory tab', await until(() => page.evaluate(() => window.__game.S.view === 'research' && window.__game.rs.RSU.tab === 'lab' && document.querySelector('#rs-tab-lab').classList.contains('on'))));
    check('with the tab open, the menu’s number goes', await until(async () => { const b = await t.badge(); return b && b.n === ''; }), await t.badge());
    check('and the tab has no mark', (await t.tabMark('lab')) === '');

    /* inaugurated; a technology bought outright is the player's own doing and counts nowhere */
    await t.edit((n, now) => { const p = n.nrp; p.st = 5; delete p.su; p.i = now - 1000; p.ra = now - 1000; p.re = 400; p.gr = 'f'; });
    await t.go('nation');
    const tier1 = await page.evaluate(() => window.__game.rs.RS.findIndex(r => r.t === 1 && !r.h && r.cost === 2));
    await page.evaluate(i => window.__game.rs.rsResearch(i), tier1);
    check('a technology bought outright is a discovery', await until(() => page.evaluate(i => window.__game.rs.rsHas(window.__game.rs.rsBits(window.__game.S.nation.nrp.k), i), tier1)));
    await t.go('nation'); await sleep(1500);
    check('but it is not counted on the menu', ((await t.badge()) || {}).n === '', await t.badge());

    /* a study that ends while the player is elsewhere */
    const study = await page.evaluate(() => { const R = window.__game.rs.RS, i = R.findIndex(r => r.h > 0); return { i, n: R[i].n }; });
    await t.edit((n, now, G, i) => { n.nrp.q = [[i, now - 3 * 3600e3, now - 100, 50, 0, 1]]; }, study.i);
    check('the study ends: a discovery', await until(() => page.evaluate(i => window.__game.rs.rsHas(window.__game.rs.rsBits(window.__game.S.nation.nrp.k), i), study.i)));
    const b2 = await until(async () => { const b = await t.badge(); return b && b.n === '1' && /a new discovery/.test(b.w) && b; });
    check('a finished study: Research Lab shows 1, a new discovery', !!b2, await t.badge());
    await t.openBell();
    const n2 = await t.notes();
    check('the bell says “Discovery: …”, its link Recent discoveries', n2.some(x => x.x.startsWith('Discovery: ' + study.n) && x.dl === 'rs:overview'), n2);
    const bought = await page.evaluate(i => window.__game.rs.RS[i].n, tier1);
    check('the technology bought outright is not in the bell', !n2.some(x => x.x.startsWith('Discovery: ' + bought + '.')), n2);
    await t.closeBell();

    /* a stage of works finished too: two things, one on each tab */
    await t.edit((n, now, G) => { G.rs.rsLog(n, 'x', 1, 1, now); });
    const b3 = await until(async () => { const b = await t.badge(); return b && b.n === '2' && b; });
    check('two things: Research Lab shows 2 and says both', b3 && /a new discovery/.test(b3.w) && /a stage of works finished/.test(b3.w), await t.badge());

    /* the Overview open: its discovery seen and marked New, the Laboratory's still waiting */
    await t.go('research');
    check('on the Overview, the menu shows 1 (the Laboratory’s)', await until(async () => ((await t.badge()) || {}).n === '1'), await t.badge());
    check('the Laboratory tab carries 1, the Overview tab nothing', await until(async () => (await t.tabMark('lab')) === '1' && (await t.tabMark('overview')) === ''));
    const neu = await page.evaluate(() => [...document.querySelectorAll('#rs-recent li')].map(li => [li.querySelector('b').textContent, !!li.querySelector('.rs-new')]));
    check('Recent discoveries marks the finished study New, not the one bought', neu.some(([x, nw]) => x.startsWith(study.n) && nw) && neu.filter(([, nw]) => nw).length === 1, neu);
    await page.screenshot({ path: OUT + '/research-badge-tabs-1360.png' });
    /* the tab flipped without a redraw */
    await page.click('#rs-tab-lab');
    check('opening the Laboratory tab clears it and the menu', await until(async () => (await t.tabMark('lab')) === '' && ((await t.badge()) || {}).n === ''), [await t.tabMark('lab'), await t.badge()]);
    await page.click('#rs-tab-overview');
    await t.go('nation'); await t.go('research');
    check('back on the Overview later, nothing is New any more', await until(() => page.evaluate(() => !!document.querySelector('#rs-recent li') && !document.querySelector('#rs-recent .rs-new'))));
    check('and nothing is counted', ((await t.badge()) || {}).n === '' && (await t.tabMark('lab')) === '' && (await t.tabMark('overview')) === '');

    /* Settings › Notifications: Research can be taken out of the bell */
    await page.evaluate(() => { location.hash = '#settings'; }); await until(() => page.evaluate(() => window.__game.S.view === 'settings'));
    await page.click('#sg-tab-notif'); await page.waitForSelector('[data-ntf-mute="research"]');
    check('Settings › Notifications offers Research', /Research: discoveries and finished works/.test(await page.evaluate(() => document.querySelector('[data-ntf-mute="research"]').closest('label,tr').textContent)));
    await page.uncheck('[data-ntf-mute="research"]'); await sleep(200);
    await t.go('nation');
    await t.openBell();
    check('turned off, the bell no longer tells of research', (await t.notes()).length === 0, await t.notes());
    await t.closeBell();
    check('no page errors on the desktop', !t.errors.length, t.errors);
    await t.ctx.close();
  }
  /* ── a phone, dark: Research Lab behind More ── */
  {
    const t = await start('dark', { width: 390, height: 844 }), { page } = t;
    await t.grant();
    await t.go('nation');
    await t.edit((n, now, G) => { const o = n.nrp.o || 0; n.nrp.c = G.rs.rsLabSites(n)[o]; n.nrp.o = o; n.nrp.rg = n.reg; n.nrp.nm = 'Night Laboratory'; n.nrp.dn = 'Dr. Night'; n.nrp.st = 0; n.nrp.su = now - 1000; });
    check('phone: the works finish', await until(() => page.evaluate(() => window.__game.S.nation.nrp.st === 1)));
    check('phone: More carries a dot', await until(() => page.evaluate(() => !!document.querySelector('.tabbar .tab-more .tab-dot'))));
    check('phone: and says Research Lab is waiting', /Research Lab: a stage of works finished/.test(await page.evaluate(() => document.querySelector('#tab-more').textContent)));
    await page.click('#tab-more');
    const m = await until(async () => { const b = await t.badge('#more-sheet [data-v="research"]'); return b && b.n === '1' && b; });
    check('phone: in the More sheet, Research Lab shows 1', !!m, await t.badge('#more-sheet [data-v="research"]'));
    await page.screenshot({ path: OUT + '/research-badge-more-390-dark.png' });
    await page.click('#more-sheet [data-v="research"]');
    await until(() => page.evaluate(() => window.__game.S.view === 'research'));
    check('phone: the Laboratory tab carries it', await until(async () => (await t.tabMark('lab')) === '1'));
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('phone: no sideways scroll with the tab marked', w.sw <= w.cw + 1, w);
    await page.screenshot({ path: OUT + '/research-badge-tabs-390-dark.png' });
    await page.click('#rs-tab-lab');
    check('phone: opening it clears it from More', await until(() => page.evaluate(() => !/Research Lab:/.test(document.querySelector('#tab-more').textContent))));
    await page.click('#tab-more');
    check('phone: and from the More sheet', await until(async () => { const b = await t.badge('#more-sheet [data-v="research"]'); return b && b.n === ''; }), await t.badge('#more-sheet [data-v="research"]'));
    check('no page errors on the phone', !t.errors.length, t.errors);
    await t.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all research badge checks passed');
process.exit(failed ? 1 : 0);
