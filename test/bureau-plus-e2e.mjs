// The Statistics page's Population tab (free) and the Bureau's Edict impact, Timeline and City league (members), in
// the built game on the emulators.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/bureau-plus-e2e.mjs"
import path from 'node:path';
import { OUT, check, finish, sleep, until, player, open, found, nav, text } from './lib.mjs';

const DAY = 864e5;
const noScroll = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tab = async (p, k) => { await p.waitForSelector(`[data-act="st-tab"][data-k="${k}"]`); await p.evaluate(k => document.querySelector(`[data-act="st-tab"][data-k="${k}"]`).click(), k); await sleep(500); };
const sub = async (p, k) => { await p.waitForSelector(`[data-act="sb-sub"][data-v="${k}"]`); await p.evaluate(k => document.querySelector(`[data-act="sb-sub"][data-v="${k}"]`).click(), k); await sleep(500); };
const shot = (p, sel, f) => p.locator(sel).first().screenshot({ path: path.join(OUT, f) }).catch(e => check('screenshot ' + f, false, e.message));

const A = await player('Bureau-A', { vp: { width: 1280, height: 1000 } });
await open(A);
await found(A, 'Statistica');

/* forty days of history, three edicts signed along the way, and a few things that happened */
await A.evaluate(DAY => {
  const n = G.clone(G.S.nation), now = Date.now(), ids = (n.inbox || []).map(e => e.id).filter(Boolean).slice(0, 3);
  const base = Array.isArray(n.hist) && n.hist.length ? n.hist[n.hist.length - 1] : null, s0 = base ? base.s : null;
  n.hist = [];
  for (let d = 40; d >= 1; d--) {
    const s = Array.isArray(s0) ? s0.map((v, j) => Math.max(0, Math.min(100, v + (j === 1 ? (40 - d) * 0.3 : Math.sin(d / 5) * 2)))) : s0;
    n.hist.push({ t: now - d * DAY, p: Math.max(1, (n.pop || 5) * (0.8 + (40 - d) * 0.005)), s });
  }
  n.answered = (n.answered || []).concat(ids.map((id, k) => ({ id, o: 0, t: now - (35 - k * 12) * DAY, fx: '' })));
  n.log = [{ t: now - 20 * DAY, k: 'flag' }, { t: now - 8 * DAY, k: 'cat', a: 'Inoffensive Centrist Democracy', b: 'Liberal Democratic Socialists' }].concat(n.log || []);
  G.commit(n);
}, DAY);

/* ── free: Population ── */
await nav(A, 'stats');
await tab(A, 'population');
const pop = await text(A, '#main');
check('a Population tab, free for everyone', /Natural change a day/.test(pop) && /Births a day \(est\.\)/.test(pop) && /Deaths a day \(est\.\)/.test(pop));
check('with an estimated age pyramid of sixteen bands', (await A.evaluate(() => document.querySelectorAll('.pp-pyr .pp-m').length)) === 16);
check('a line over time from the nation’s history', !!(await A.$('.st-card svg.sb-chart')));
check('the estimates say they are estimates', /estimated from the age shares/.test(pop));
await shot(A, '#main', 'bureau-population.png');

/* ── members: the Bureau ── */
await A.evaluate(() => { G.SHOP.SHOP.doc = Object.assign({}, G.SHOP.SHOP.doc || {}, { vip: { until: Date.now() + 30 * 864e5, from: Date.now() - 864e5, runs: [{ s: Date.now() - 864e5, e: Date.now() + 30 * 864e5 }], per: [], status: 'active', plan: 'month', m: 1, f: [] } }); G.render(); });
await tab(A, 'bureau');
check('the Bureau opens for a member, with the three new sections', !!(await A.$('[data-act="sb-sub"][data-v="impact"]')) && !!(await A.$('[data-act="sb-sub"][data-v="timeline"]')) && !!(await A.$('[data-act="sb-sub"][data-v="cities"]')));

await sub(A, 'impact');
const imp = await text(A, '.sb-imp');
check('Edict impact lists each edict signed, with the week and the month after', (await A.evaluate(() => document.querySelectorAll('.sb-imp tbody tr').length)) >= 2 && /A month after/.test(imp));
check('and says which did best for the figure followed', /rose most after/.test(await text(A, '.sb-lede')));
await A.selectOption('[data-sb="ik"]', 'econ');await sleep(300);
check('the figure followed can be changed', /economic freedom/i.test(await text(A, '.sb-lede')));
await shot(A, '#main', 'bureau-impact.png');

await sub(A, 'timeline');
check('the Timeline marks edicts and events on the chart', (await A.evaluate(() => document.querySelectorAll('.sb-tl .sb-tl-m').length)) >= 5);
check('and lists them, newest first', /reclassified/i.test(await text(A, '.sb-tl-l')) && /Signed/.test(await text(A, '.sb-tl-l')));
await shot(A, '#main', 'bureau-timeline.png');

await sub(A, 'cities');
const lg = await text(A, '#main');
check('the City league ranks the nation’s cities', /City league/.test(lg) && ((await A.evaluate(() => document.querySelectorAll('.sb-league tbody tr').length)) >= 1 || /No cities yet|not on the map/.test(lg)), lg.slice(0, 200));
await A.click('[data-act="sb-ck"][data-v="mood"]');await sleep(300);
check('and can rank by mood', await A.evaluate(() => document.querySelector('[data-act="sb-ck"][data-v="mood"]').getAttribute('aria-pressed') === 'true'));
await shot(A, '#main', 'bureau-league.png');

/* a phone */
await A.setViewportSize({ width: 390, height: 844 });await sleep(400);
await sub(A, 'timeline');
check('no sideways scrolling on a phone', (await noScroll(A)) <= 1);
await tab(A, 'population');
check('nor on the Population tab', (await noScroll(A)) <= 1);
await shot(A, '#main', 'bureau-population-phone.png');

await finish();
