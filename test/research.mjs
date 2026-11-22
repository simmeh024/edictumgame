// The National Research Programme in the game (game/edictum.html, "the National Research Programme"): the petition
// after 75 enacted edicts (vetoed, it comes back five later), the Research page appearing in the menu, the laboratory
// founded in a city, named, built in five stages from the stock, its inauguration and the Founding Research Grant of
// 12, the first three discoveries, Research Credits counted while away, the research tree with its eras, locks and
// detail panel, studies from Tier V, a Grand Challenge's locks, the scientific record and Letters from the Laboratory.
// The whole path on a desktop (light) and a phone (dark); every tab on a wide desktop (dark) and a phone (light) too.
// Screenshots go to test/out/.
//   python3 build.py
//   node test/research.mjs
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
  const go = async v => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; location.hash = '#' + v; window.__game.render(); }, v); await until(() => page.evaluate(v => window.__game.S.view === v.split('/')[0], v)); await sleep(400); };
  const desk = () => page.evaluate(() => [...document.querySelectorAll('.issue-card')].map(b => ({ id: b.dataset.id, gold: getComputedStyle(b).borderTopWidth, tag: (b.querySelector('.rsx-tag') || {}).textContent || '' })));
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
  const R = () => page.evaluate(() => { const n = window.__game.S.nation, p = n.nrp; return p ? JSON.parse(JSON.stringify(p)) : null; });
  const stockUp = () => edit(n => { n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = Date.now(); n._stockSet = true; });
  return { ctx, page, errors, edit, go, desk, answer, R, stockUp };
}

try {
  /* ── desktop, light: the petition, a veto, its return, the laboratory, the grant, three discoveries, the tree ── */
  {
    const t = await start('light', { width: 1360, height: 900 }), { page } = t;
    const P = () => page.evaluate(() => !!window.__game.rs);
    check('the game exposes the research probe', await until(P));
    const cat = await page.evaluate(() => { const r = window.__game.rs; return { n: r.RS.length, ids: new Set(r.RS.map(x => x.id)).size, t1: [0, 1, 2, 3, 4].map(i => r.RS[i].cost), tot: r.RS.reduce((s, x) => s + x.cost, 0) }; });
    check('360 technologies, 360 ids, tier I at 10, 2, 3, 4, 6, 125,415 RC in all', cat.n === 360 && cat.ids === 360 && cat.t1.join() === '10,2,3,4,6' && cat.tot === 125415, cat);
    check('no Research Lab in the menu before the petition', await page.evaluate(() => !document.querySelector('.nav [data-v="research"]')));
    await t.edit(n => { n.ws.e = 74; n.inbox = []; });
    await t.go('issues');
    check('at 74 enacted edicts the petition has not come', !(await t.desk()).some(x => x.id === 'rs-discovery'));
    await t.edit(n => { n.ws.e = 75; n.inbox = []; });
    await t.go('issues');
    check('at 75 the petition is on the desk, gold-bordered and tagged', await until(async () => (await t.desk()).some(x => x.id === 'rs-discovery' && x.tag === 'National Research' && x.gold === '2px')), await t.desk());
    await page.click('.issue-card[data-id="rs-discovery"]');
    check('it is called A Nation of Discovery and has three answers, in a republic’s words', await until(() => page.evaluate(() => /A Nation of Discovery/.test(document.querySelector('.paper.edict .h1').textContent) && /Senate|petitioned/.test(document.querySelector('.paper.edict').textContent) && document.querySelectorAll('[data-act="answer"][data-id="rs-discovery"]').length === 3)));
    check('the petition shows its three sites on a map, each with its advantage', await until(() => page.evaluate(() => { const m = document.querySelector('.paper.edict .rs-sitemap'); return !!m && !!m.querySelector('canvas.map-cv') && /The university quarter/.test(m.textContent) && /The coast/.test(m.textContent) && /The hills/.test(m.textContent) && /Research Credits a day/.test(m.textContent); })));
    const pins = await page.evaluate(() => window.__game.rs.rsLabSites(window.__game.S.nation));
    check('the advisors’ pins: one site of each kind within the borders, where the land allows', pins.length === 3 && pins[0] >= 0 && new Set(pins.filter(c => c >= 0)).size === pins.filter(c => c >= 0).length, pins);
    await sleep(700); await page.screenshot({ path: OUT + '/research-petition-1360.png' });
    await page.click('[data-act="dismiss"][data-id="rs-discovery"]');
    await until(() => page.evaluate(() => (window.__game.S.nation.answered || []).some(a => a.id === 'rs-discovery' && a.o === -1)));
    await sleep(300);
    const dv = await page.evaluate(() => window.__game.S.nation.nrx && window.__game.S.nation.nrx.dv);
    check('a veto is noted with the edicts so far', dv === 75, dv);
    await t.edit(n => { n.ws.e = 79; n.inbox = []; });
    await t.go('issues');
    check('four edicts later it has not come back', !(await t.desk()).some(x => x.id === 'rs-discovery'));
    await t.edit(n => { n.ws.e = 80; n.inbox = []; });
    await t.go('issues');
    check('five edicts later it is back: a veto cannot shut research out', await until(async () => (await t.desk()).some(x => x.id === 'rs-discovery')));
    await t.answer('rs-discovery', 0);
    const p0 = await t.R();
    check('granted: the programme begins with no laboratory yet', p0 && p0.a > 0 && p0.st === 0 && !p0.c && p0.o === 0, p0);
    await t.go('nation');
    check('Research Lab is now in the menu', await until(() => page.evaluate(() => { const a = document.querySelector('.nav [data-v="research"]'); return !!a && /Research Lab/.test(a.textContent); })));
    await t.go('research');
    check('the Overview asks for the laboratory to be founded', await until(() => page.evaluate(() => /Found the National Research Laboratory/.test(document.querySelector('#rs-p-overview').textContent))));
    await page.evaluate(() => window.__game.rs.rsShow('lab'));
    await page.fill('#rs-nm', 'Selenia Institute of Natural Philosophy');
    await page.fill('#rs-dn', 'Dr. Ada Quillfeather');
    await page.click('[data-act="rs-look"][data-k="h"][data-d="1"]');
    check('the Laboratory tab asks where it will stand: three kinds of site and a map', await until(() => page.evaluate(() => document.querySelectorAll('#rs-p-lab .rs-kind').length === 3 && !!document.querySelector('#rs-p-lab .rs-sitemap canvas') && /will stand at/.test(document.querySelector('#rs-p-lab .rs-siteat').textContent))));
    const siteWhy = await page.evaluate(() => { const G = window.__game, R = G.rs, T = R.territory(), i = T.byId[G.myId ? G.myId() : 'me']; let foreign = -1; for (let c = 0; c < T.owner.length; c++) if (T.owner[c] >= 0 && T.owner[c] !== T.byId[Object.keys(T.byId).find(k => T.list[T.byId[k]].me)]) { foreign = c; break; } const me = T.list.findIndex(x => x.me); return { foreign: R.rsSiteWhy(T, me, foreign, 0), sea: R.rsSiteWhy(T, me, T.owner.findIndex(o => o < 0), 1), capital: R.rsSiteWhy(T, me, T.list[me].cap, 0) }; });
    check('a site must be within the borders, on land, and not on a city', /within your own borders/.test(siteWhy.foreign) && /borders|water/.test(siteWhy.sea) && /city stands there/.test(siteWhy.capital), siteWhy);
    await page.screenshot({ path: OUT + '/research-site-1360.png' });
    await page.click('[data-act="rs-found"]');
    const p1 = await t.R();
    check('the laboratory is placed on the hex chosen, of the kind chosen, with its name and director', p1 && Number.isInteger(p1.c) && p1.c === pins[0] && p1.o === 0 && p1.rg && p1.nm === 'Selenia Institute of Natural Philosophy' && p1.dn === 'Dr. Ada Quillfeather' && p1.dl && p1.dl.h === 1, p1);
    check('the university quarter gives its credits once open', await page.evaluate(() => window.__game.rs.RS_SITES[0].rc === 2));
    await t.stockUp(); await t.go('research/lab');
    /* five stages: give everything, then let the works finish */
    for (let j = 0; j < 5; j++) {
      for (let k = 0; k < 6; k++) { const b = await page.$('[data-act="rs-give"][data-v="max"]:not([disabled])'); if (!b) break; await b.click(); await sleep(150); }
      const u = (await t.R()).su;
      check(`stage ${j + 1}: every material given, the works begin`, u > Date.now(), await t.R());
      /* the drawing: stages built in the bar, the one under way part filled; the crane (and its swinging load) while the
         builders work, and none for the inauguration */
      const fig = await page.evaluate(() => { const f = document.querySelector('[data-labfig="lab"]'); return { done: f.querySelectorAll('.lab-seg.done').length, now: f.querySelectorAll('.lab-seg.now').length, crane: !!f.querySelector('.lab-crane'), busy: f.querySelector('.rs-lab').classList.contains('busy'), plan: !!f.querySelector('.lab-plan'), words: f.querySelector('.lab-pw').textContent }; });
      check(`stage ${j + 1}: the drawing shows it under way`, fig.done === j && fig.now === 1 && fig.busy && fig.crane === (j < 4) && fig.plan === (j < 4) && /The builders are at work/.test(fig.words) && new RegExp(`Stage ${j + 1} of 5`).test(fig.words), fig);
      if (j === 2) await page.screenshot({ path: OUT + '/research-lab-building-1360.png' });
      /* the works end on their own, with nobody doing anything (the first stage), or at the next action */
      if (j === 0) { await t.edit(n => { n.nrp.su = Date.now() + 2500; }); check('a stage’s works finish by themselves when their time is up', await until(async () => (await t.R()).st === 1, 15000)); }
      else await t.edit(n => { n.nrp.su = Date.now() - 1000; });
      await until(async () => (await t.R()).st === j + 1);
      await t.stockUp();
    }
    const p2 = await t.R();
    check('after five stages the laboratory is inaugurated with the Founding Research Grant of 12', p2.st === 5 && p2.i > 0 && Math.abs(p2.re - 12) < 0.5 && (p2.gr || '').includes('f'), p2);
    check('the inauguration is in the national history', await page.evaluate(() => (window.__game.S.nation.log || []).some(l => l.k === 'rsi')));
    await t.go('research/lab');
    check('open: no crane, flags up, windows lit, level I of IX', await until(() => page.evaluate(() => { const f = document.querySelector('[data-labfig="lab"]'); return !f.querySelector('.lab-crane') && !!f.querySelector('.lab-flag') && f.querySelectorAll('.lab-win.lit').length >= 8 && /Level I of IX/.test(f.textContent); })));
    await page.screenshot({ path: OUT + '/research-lab-open-1360.png' });
    /* its own icon on the map, at its hex */
    await page.evaluate(() => { const G = window.__game; G.rs.centerOn(G.S.nation.nrp.c); location.hash = '#map'; G.render(); });
    await sleep(1500);
    check('the map shows the laboratory’s icon, and its tip names it', await until(() => page.evaluate(() => { const G = window.__game, n = G.S.nation; return G.rs.rsLabWhere({ id: 'me', n }, G.rs.territory()).s === 'held' && /Selenia Institute of Natural Philosophy of /.test(G.rs.mapTipAt(n.nrp.c)); })));
    await page.evaluate(() => { const cv = [...document.querySelectorAll('canvas.map-cv')].find(c => c.offsetParent); if (cv) cv.scrollIntoView({ block: 'center' }); });
    await sleep(600);
    await page.screenshot({ path: OUT + '/research-map-icon-1360.png' });
    await t.go('research/tree');
    check('the tree opens on Trade, Foundations, with Tier I to IV and a detail panel', await until(() => page.evaluate(() => document.querySelectorAll('#rs-p-tree .rs-col').length === 4 && document.querySelectorAll('#rs-p-tree .rs-card').length === 20 && !!document.querySelector('.rs-detail .rs-dh'))));
    /* three discoveries with the grant: 2 + 3 + 4 */
    for (const i of [1, 2, 3]) { await page.evaluate(i => window.__game.rs.rsResearch(i), i); }
    const p3 = await t.R(), known = await page.evaluate(() => { const r = window.__game.rs, b = r.rsBits(window.__game.S.nation.nrp.k); return r.RS.filter(x => r.rsHas(b, x.i)).map(x => x.id); });
    check('the grant pays for the first three discoveries', known.length === 3 && Math.round(p3.re - p3.rs) === 3, { known, re: p3.re, rs: p3.rs });
    const why = await page.evaluate(() => window.__game.rs.rsWhy(window.__game.S.nation, 0));
    check('the milestone says exactly what it waits for', why.some(w => /Domestic Markets/.test(w)), why);
    await page.evaluate(() => window.__game.rs.rsResearch(4));
    const bal4 = await page.evaluate(() => { const p = window.__game.S.nation.nrp; return Math.round(p.re - p.rs); });
    check('a fourth is not affordable yet (6 RC, 3 left)', bal4 === 3, bal4);
    /* a day away: credits counted from the last count, 20 a day at Science 50 */
    await t.edit(n => { n.s.sci = 50; n.nrp.ra = Date.now() - 86400000; });
    const p4 = await t.R(), rate = await page.evaluate(() => window.__game.rs.rsRate(window.__game.S.nation, Date.now()));
    check('a day away earns a day’s credits: 20 at Science & Technology 50, and 2 more for the university quarter', Math.abs(rate - 22) < 0.01 && Math.abs((p4.re - p4.rs) - 25) < 0.6, { rate, bal: p4.re - p4.rs });
    for (const i of [4, 0]) await page.evaluate(i => window.__game.rs.rsResearch(i), i);
    check('so the balance after the fourth and fifth (6 and 10) is 9', await page.evaluate(() => { const p = window.__game.S.nation.nrp; return Math.round(p.re - p.rs) === 9; }));
    check('Tier I of Trade is complete', await page.evaluate(() => { const r = window.__game.rs; return r.rsDone(r.rsBits(window.__game.S.nation.nrp.k))[0][1] === 5; }));
    await t.go('research/tree');
    await page.click('.rs-card[data-v="5"]');
    check('choosing a Tier II card shows its cost and effect', await until(() => page.evaluate(() => /Domestic Commerce/.test(document.querySelector('.rs-detail .rs-dh').textContent) && /Trade deals at once \+1/.test(document.querySelector('.rs-detail').textContent))));
    await page.click('[data-act="rs-era"][data-v="2"]');
    check('a later era can be looked at, every card locked, with its reason', await until(() => page.evaluate(() => document.querySelectorAll('#rs-p-tree .rs-card.rs-locked').length === 20 && /Why it is locked/.test(document.querySelector('.rs-detail').textContent) && /Complete Tier IV in Growth or War/.test(document.querySelector('#rs-p-tree').textContent))));
    await page.screenshot({ path: OUT + '/research-tree-era3-1360.png', fullPage: false });
    await page.click('[data-act="rs-era"][data-v="0"]');
    await sleep(300); await page.screenshot({ path: OUT + '/research-tree-1360.png' });
    /* a study from Tier V: paid at the start, finished only after its start is saved */
    await t.edit((n, now, G) => { const r = G.rs, b = r.rsBits(n.nrp.k); for (let i = 0; i < 20; i++) r.rsPut(b, i); n.nrp.k = r.rsEnc(b); n.nrp.re += 2000; });
    await t.stockUp();
    await page.evaluate(() => window.__game.rs.rsResearch(21));
    const q = (await t.R()).q;
    check('a Tier V technology begins a study of two hours, paid at the start', q.length === 1 && q[0][0] === 21 && Math.round((q[0][2] - q[0][1]) / 3600000) === 2, q);
    await t.edit(n => { n.nrp.q[0][2] = Date.now() - 1000; });
    const known21 = await page.evaluate(() => { const r = window.__game.rs; return r.rsHas(r.rsBits(window.__game.S.nation.nrp.k), 21); });
    check('finished in the local game, the study becomes the technology', known21);
    await t.go('research/lab');
    check('the Grand Challenges say what they wait for', await until(() => page.evaluate(() => /Complete Tier XIII in Trade/.test(document.querySelector('#rs-p-lab').textContent))));
    await page.screenshot({ path: OUT + '/research-lab-1360.png' });
    /* war: a computer nation takes the laboratory's hex. Nothing researched is lost, but no research is done */
    const before = await page.evaluate(() => { const r = window.__game.rs, n = window.__game.S.nation; return { k: n.nrp.k, count: r.rsCount(r.rsBits(n.nrp.k)) }; });
    await t.edit((n, now, G) => { const T = G.rs.territory(), foe = T.list.find(x => x.npc); n.conq = (n.conq || []).concat({ c: n.nrp.c, t: now, n: foe.id }); });
    await until(() => page.evaluate(() => (window.__game.S.nation.nrp.lo || 0) > 0), 9000);
    const war = await page.evaluate(() => { const r = window.__game.rs, n = window.__game.S.nation; return { active: r.rsActive(n), rate: r.rsRate(n, Date.now()), why: r.rsWhy(n, 6), k: n.nrp.k, where: r.rsLabWhere({ id: 'me', n }, r.territory()).s, lo: n.nrp.lo || 0 }; });
    check('the hex taken: research is kept, but no credits and no research while it is held', !war.active && war.rate === 0 && /enemy|hands/.test(war.why[0]) && war.k === before.k, war);
    const q0 = (await t.R()).q.length;
    await page.evaluate(() => window.__game.rs.rsResearch(22));
    check('a technology cannot be researched, nor a study begun, while the laboratory is held', await page.evaluate(q0 => { const r = window.__game.rs, p = window.__game.S.nation.nrp; return !r.rsHas(r.rsBits(p.k), 22) && p.q.length === q0; }, q0));
    await t.go('research/lab');
    check('the drawing shows the laboratory held by the enemy', await until(() => page.evaluate(() => !!document.querySelector('[data-labfig="lab"] .lab-flagc.enemy') && /held by an enemy/.test(document.querySelector('[data-labfig="lab"] svg').getAttribute('aria-label')))));
    await page.screenshot({ path: OUT + '/research-lab-occupied-1360.png' });
    await t.edit(n => { n.conq = (n.conq || []).filter(e => !(e && e.n && e.c === n.nrp.c)); });
    check('the hex retaken: the laboratory works again', await page.evaluate(() => window.__game.rs.rsActive(window.__game.S.nation)));
    check('the record notes when the hex was first seen lost, for the admin’s statistics, and forgets it once held again', await until(async () => !(await t.R()).lo, 9000) && war.lo > 0, { lo: war.lo, now: (await t.R()).lo });
    /* destroyed: rebuilt from its foundations, here or elsewhere; the research and the institution stay */
    await t.edit((n, now, G) => { G.rs.rsRuinTest(n, now, 'Vesad'); });
    const ru = await t.R();
    check('destroyed: no site, back to the foundations, the research kept', !Number.isInteger(ru.c) && ru.st === 1 && ru.rz > 0 && ru.k === before.k && ru.i > 0, ru);
    await t.go('research/lab');
    check('the Laboratory tab offers to rebuild on a site of the player’s choosing', await until(() => page.evaluate(() => /Rebuild the laboratory/.test(document.querySelector('#rs-p-lab').textContent) && document.querySelectorAll('#rs-p-lab .rs-kind').length === 3 && /ruins/.test(document.querySelector('[data-labfig]') ? '' : document.querySelector('#rs-p-lab').textContent))));
    await page.screenshot({ path: OUT + '/research-lab-ruined-1360.png' });
    await page.click('[data-act="rs-found"]');
    const rb = await t.R();
    check('rebuilt on a new site from the foundations, research kept', Number.isInteger(rb.c) && rb.st === 1 && rb.k === before.k, rb);
    check('while it is rebuilt, no research is done', await page.evaluate(() => !window.__game.rs.rsActive(window.__game.S.nation)));
    await t.edit(n => { n.nrp.st = 5; });
    await t.go('research/record');
    check('the scientific record lists the discoveries and the inauguration', await until(() => page.evaluate(() => { const x = document.querySelector('#rs-p-record').textContent; return /Domestic Markets/.test(x) && /Founding Research Grant/.test(x); })));
    await t.go('research');
    await page.screenshot({ path: OUT + '/research-overview-1360.png' });
    /* the first letter from the laboratory */
    await t.edit(n => { n.inbox = []; });
    await t.go('issues');
    check('Letters from the Laboratory: the first letter arrives, gold-bordered', await until(async () => (await t.desk()).some(x => x.id === 'rsl-doors' && x.tag === 'Letters from the Laboratory')), await t.desk());
    const e0 = await page.evaluate(() => window.__game.S.nation.ws.e);
    await t.answer('rsl-doors', 1);
    const p5 = await t.R(), e1 = await page.evaluate(() => window.__game.S.nation.ws.e);
    check('its answer is kept, grants its credits once, and does not count as an enacted edict', (p5.gr || '').includes('a') && e1 === e0 && await page.evaluate(() => window.__game.S.nation.nrx.lt['rsl-doors'] === 1), { gr: p5.gr, e0, e1 });
    await page.evaluate(() => { const S = window.__game.S; S.result = null; S.openIssue = null; location.hash = '#government/overview'; window.__game.render(); });
    check('Government › Mandate lists the laboratory’s initiatives beside the decrees', await until(() => page.evaluate(() => document.querySelectorAll('.rs-md-list li').length === 5 && !!document.querySelector('.gv-md-c li'))));
    check('no page errors on the desktop', !t.errors.length, t.errors);
    await t.ctx.close();
  }
  /* ── a phone, dark: the tree as one column, no sideways scroll, every tab ── */
  {
    const t = await start('dark', { width: 390, height: 844 }), { page } = t;
    await t.edit(n => { n.ws.e = 75; n.inbox = []; });
    await t.go('issues');
    await until(async () => (await t.desk()).some(x => x.id === 'rs-discovery'));
    const k2 = await page.evaluate(() => { const c = window.__game.rs.rsLabSites(window.__game.S.nation); return [2, 1, 0].find(k => c[k] >= 0); });
    await t.answer('rs-discovery', k2);
    await t.edit((n, now, G) => { const o = n.nrp.o; n.nrp.c = G.rs.rsLabSites(n)[o]; n.nrp.o = o; n.nrp.rg = G.rs.RS_SITES && n.reg; n.nrp.nm = 'Dark Lab'; n.nrp.dn = 'Dr. Night'; n.nrp.st = 5; n.nrp.i = now - 1000; n.nrp.ra = now - 1000; n.nrp.re = 12; n.nrp.gr = 'f'; });
    for (const tab of ['research', 'research/tree', 'research/lab', 'research/coop', 'research/record']) {
      await t.go(tab);
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      check(`phone, ${tab}: no sideways scroll`, w.sw <= w.cw + 1, w);
      await page.screenshot({ path: OUT + `/research-${tab.replace('/', '-')}-390-dark.png`, fullPage: tab === 'research/tree' });
    }
    await t.go('research/tree');
    const cols = await page.evaluate(() => { const c = [...document.querySelectorAll('#rs-p-tree .rs-col')].map(e => e.getBoundingClientRect().left); return new Set(c.map(Math.round)).size; });
    check('on a phone the four tiers stack in one column', cols === 1, cols);
    check('dark theme: the page background is dark', await page.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 300; }));
    check('no page errors on the phone', !t.errors.length, t.errors);
    await t.ctx.close();
  }
  /* ── the other two: a desktop in the dark theme, a phone in the light ── */
  for (const [theme, vp, tag] of [['dark', { width: 1600, height: 1000 }, '1600-dark'], ['light', { width: 390, height: 844 }, '390-light']]) {
    const t = await start(theme, vp), { page } = t;
    await t.edit(n => { n.ws.e = 75; n.inbox = []; });
    await t.go('issues');
    await until(async () => (await t.desk()).some(x => x.id === 'rs-discovery'));
    const k3 = await page.evaluate(() => { const c = window.__game.rs.rsLabSites(window.__game.S.nation); return [1, 2, 0].find(k => c[k] >= 0); });
    await t.answer('rs-discovery', k3);
    await t.edit((n, now, G) => { const o = n.nrp.o; n.nrp.c = G.rs.rsLabSites(n)[o]; n.nrp.o = o; n.nrp.rg = n.reg; n.nrp.nm = 'Lab'; n.nrp.dn = 'Dr. Day'; n.nrp.st = 5; n.nrp.i = now - 1000; n.nrp.ra = now - 1000; n.nrp.re = 40; n.nrp.gr = 'f'; });
    for (const tab of ['research', 'research/tree', 'research/lab', 'research/coop', 'research/record']) {
      await t.go(tab);
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      check(`${tag}, ${tab}: no sideways scroll`, w.sw <= w.cw + 1, w);
    }
    await t.go('research/tree');
    if (vp.width >= 1500) check('a wide desktop shows the detail panel beside the tree', await page.evaluate(() => { const a = document.querySelector('.rs-tree').getBoundingClientRect(), b = document.querySelector('.rs-detail').getBoundingClientRect(); return b.left >= a.right - 1 && b.top < a.bottom; }));
    await page.screenshot({ path: OUT + `/research-tree-${tag}.png` });
    check(`${tag}: the theme is ${theme}`, await page.evaluate(d => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number), s = c[0] + c[1] + c[2]; return d ? s < 300 : s > 500; }, theme === 'dark'));
    check(`${tag}: no page errors`, !t.errors.length, t.errors);
    await t.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
