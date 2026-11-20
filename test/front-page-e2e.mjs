// The front page (hmView in game/edictum.html), on the emulators, with its figures and a region's map made by the jobs'
// own code (functions/home.js runHome; the game's hmBake, as jobs/stats/home-maps.mjs runs it): the counters, the live
// bar, the region tabs and map; nothing of the region read and no live feed open before the visitor starts founding;
// Regenerate and its locks; Quick Found in another region (the preview is what is founded, and the tutorial still
// waits for a name of the capital's own); Customize first; the default region set in Region control; the carousel and
// its enlarged view; a phone's order; the founding funnel's statistics, told quick from customised.
//   npm run test:front-page
import { createRequire } from 'node:module';
import { BASE, OUT, PROJECT, check, finish, until, sleep, player, open, found, text, localNation, nationDoc, clearEmulators, browser } from './lib.mjs';
import { runHome, recordOf } from '../functions/home.js';
import { loadWorld } from '../jobs/fx/world.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const ms = v => v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
await clearEmulators();

/* ── two nations in the Meridian Reach, the figures, and its map ── */
/* each with its capital settled and saved before its browser closes */
for (const nm of ['Firstmark', 'Secondholm']) { const p = await player('seed-' + nm); await open(p); await found(p, nm); const uid = await p.evaluate(() => G.S.uid); await until(async () => !!(await nationDoc(uid))?.rec?.loc, 20000); await p.ctx.close(); }
const report = await runHome(db, { regions: loadWorld().regions, Timestamp });
const live = (await db.doc('home/live').get()).data();
check('the figures job counts the two nations and tells of their foundings', live.c.n === 2 && live.r.meridian?.n === 2 && live.ev.filter(e => e.k === 'found').map(e => e.nm).sort().join() === 'Firstmark,Secondholm', JSON.stringify(report));
check('the public figures name no uid', !(await db.collection('summaries').get()).docs.some(d => JSON.stringify(live).includes(d.id)));
{
  const ctx = await browser.newContext();
  await ctx.route('**/__/firebase/init.json', r => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(() => { localStorage.setItem('statehood.region', 'meridian'); window.EDICTUM_PROBE = g => { window.G = g; }; });
  const p = await ctx.newPage(); await p.goto(BASE + '/');
  await p.waitForFunction(() => window.G && window.G.HMB && window.G.HMB().REG.id === 'meridian');
  const raws = {};
  for (const d of (await db.collection('nations').get()).docs) { const r = recordOf(d); if (r) raws[d.id] = Object.assign(r, { _ts: ms(d.get('ts')), _rev: d.get('rev') || 0, _dirty: false }); }
  const doc = await p.evaluate(raws => window.G.HMB().hmBake(raws, []), raws);
  check('the game works out the region’s map: both nations hold land', doc.players === 2 && doc.ns.filter(x => !x.npc && x.nm).map(x => x.nm).sort().join() === 'Firstmark,Secondholm', JSON.stringify(doc.ns.slice(0, 4)));
  await db.doc('home/map-meridian').set({ v: doc.v, at: Date.now(), c: doc.c, r: doc.r, o: doc.o, ns: doc.ns });
  await ctx.close();
}

/* a visitor who has said yes to visit statistics, with Google itself kept out (its tag would send nothing here) */
const visitor = async (tag, opts = {}) => {
  const p = await player(tag, opts);
  await p.ctx.addInitScript(() => { window.EDICTUM_RANDOM_FACTS = true; window.EDICTUM_ANALYTICS_ID = 'G-TEST12345'; try { if (!localStorage.getItem('edictum.analytics')) localStorage.setItem('edictum.analytics', 'y'); } catch (e) {} });
  await p.ctx.route(/googletagmanager\.com|google-analytics\.com/, r => r.abort());
  return p;
};
const events = p => p.evaluate(() => (window.dataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event').map(a => [a[1], a[2] || {}]));
const quiet = p => p.evaluate(() => ({ engaged: G.HMB().hmEngaged(), world: !!G.S.worldAll, al: !!G.ALX().AL.unsub, ty: !!G.TYX().TY.unsub, chat: !!G.CHAT().RGC.unsub }));
const draft = p => p.evaluate(() => { const d = G.S.draft; return { name: d.name, pretitle: d.pretitle, flag: JSON.stringify(d.flag), capital: d.capital, motto: d.motto, leader: d.leader, currency: d.currency, animal: d.animal }; });

/* ── the page as a visitor first sees it ── */
const V = await visitor('visitor', { vp: { width: 1366, height: 900 } });
await V.goto(BASE + '/'); await V.waitForSelector('#found-btn');
check('the counters show the figures', await until(async () => JSON.stringify(await V.$$eval('.hm-stat-v', l => l.slice(0, 2).map(x => x.textContent))) === '["2","2"]'));
check('the live bar tells of a founding', await until(async () => /(Firstmark|Secondholm) has joined the world in Meridian Reach/.test(await text(V, '#hm-live-t'))));
check('the region tabs name the region with its nations, chosen', /Meridian Reach\s*2/.test(await text(V, '.hm-tab.on')) && await V.getAttribute('.hm-tab.on', 'aria-selected') === 'true');
check('the map is drawn, with the nations named for screen readers', await until(async () => /Firstmark/.test(await V.getAttribute('#hm-map', 'aria-label')) && await V.evaluate(() => { const c = document.querySelector('canvas.hm-cv'); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, set = new Set(); for (let i = 0; i < d.length; i += 4 * 211) set.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return set.size > 6; })));
check('nothing of the region is read and no live feed is open', JSON.stringify(await quiet(V)) === JSON.stringify({ engaged: false, world: false, al: false, ty: false, chat: false }), JSON.stringify(await quiet(V)));
await V.click('#hm-live [data-act="hm-ev"][data-d="1"]'); await V.click('.hm-car-next'); await V.click('[data-act="hm-regen"]'); await V.click('[data-act="hm-lock"][data-k="f"]'); await V.click('[data-act="hm-lock"][data-k="f"]');
await V.click('#hm-try [data-act="hm-try"][data-o="1"]');
check('looking around (the live bar, the carousel, Regenerate, a lock, the sample edict) starts nothing either', !(await quiet(V)).engaged);
await V.screenshot({ path: OUT + '/front-page-1366.png' });

/* Regenerate and its locks */
const d0 = await draft(V); await V.click('[data-act="hm-regen"]'); const d1 = await draft(V);
check('Regenerate draws another nation: name, flag and facts', d0.name !== d1.name && d0.flag !== d1.flag && d0.capital !== d1.capital && await V.inputValue('#d-name') === d1.name);
await V.click('[data-act="hm-lock"][data-k="f"]'); await V.click('[data-act="hm-regen"]'); const d2 = await draft(V);
check('a locked flag stays through Regenerate', d2.flag === d1.flag && d2.name !== d1.name);
await V.fill('#d-name', 'Thirdhaven'); await sleep(300); await V.click('[data-act="hm-regen"]'); const d3 = await draft(V);
check('a typed name locks itself', d3.name === 'Thirdhaven' && await V.inputValue('#d-name') === 'Thirdhaven' && await V.getAttribute('[data-act="hm-lock"][data-k="n"]', 'aria-pressed') === 'true');

/* another region, chosen from the list of all of them; Quick Found reloads into it and founds what the preview showed */
await V.click('[data-act="hm-browse"][data-v="card"]');
await V.click('#hm-browse-card [data-id="frostmarch"]');
check('choosing a region updates the founding card, the tabs and the preview, and keeps the name', await until(async () => /Founding in Frostmarch/.test(await text(V, '.hm-qf-reg')) && /Frostmarch/.test(await text(V, '.hm-tab.on')) && /Frostmarch/.test(await text(V, '#hm-pv')) && await V.inputValue('#d-name') === 'Thirdhaven'));
const shown = await draft(V);
await V.click('#found-btn');
await V.waitForSelector('.layout', { timeout: 40000 });
const made = await V.evaluate(() => { const n = G.S.nation; return { name: n.name, pretitle: n.pretitle, flag: JSON.stringify(n.flag), capital: n.capital, motto: n.motto, leader: n.leader, currency: n.currency, animal: n.animal, reg: n.reg, capA: n.capA, inbox: n.inbox.map(x => x.id), held: G.HMB().capHolder(n) }; });
check('the nation is founded in the chosen region', made.reg === 'frostmarch');
check('exactly as the preview showed it', ['name', 'pretitle', 'flag', 'capital', 'motto', 'leader', 'currency', 'animal'].every(k => made[k] === shown[k]), JSON.stringify({ shown, made }));
check('its first edict, where the capital stands, is on the desk, and its drawn capital still waits for a name of its own', made.inbox.includes('fd-settle') && made.capA === made.capital && made.held);
const ev1 = await events(V), found1 = ev1.find(e => e[0] === 'nation_founded');
check('the statistics tell a quick founding: the click on the page that founds, and the founding marked quick', ev1.some(e => e[0] === 'quick_found_click') && found1 && found1[1].quick_found === 1, JSON.stringify(ev1.map(e => e[0])));
check('and nothing that names the nation or the player', !JSON.stringify(ev1).includes('Thirdhaven') && !JSON.stringify(ev1).includes(await V.evaluate(() => G.S.uid)));
await V.ctx.close();

/* ── Customize first: the full charter with what was chosen, and the founding marked customised ── */
const W = await visitor('charter', { vp: { width: 1280, height: 900 } });
await W.goto(BASE + '/'); await W.waitForSelector('#found-btn');
check('the visit and the sample edict are counted', await until(async () => (await events(W)).some(e => e[0] === 'homepage_view')));
await W.click('#hm-try [data-act="hm-try"][data-o="0"]');
await W.fill('#d-name', 'Chartermoor'); await W.selectOption('#d-pretitle', 'Kingdom');
const wShown = await draft(W);
await W.click('[data-act="hm-custom"]'); await W.waitForSelector('#found-form');
check('the charter opens with the name, the type of state and the region kept', await W.inputValue('#d-name') === 'Chartermoor' && await W.inputValue('#d-pretitle') === 'Kingdom' && /Meridian Reach/.test(await text(W, '.fr-now')) && await W.inputValue('#d-capital') === wShown.capital);
check('a kingdom’s drawn leader is a minister', !/President/.test(wShown.leader));
await W.click('#found-form #found-btn'); await W.waitForSelector('.layout', { timeout: 30000 });
const wMade = await W.evaluate(() => JSON.stringify(G.S.nation.flag));
const ev2 = await events(W), found2 = ev2.find(e => e[0] === 'nation_founded');
check('founded from the charter under the flag drawn for it, not the old default', wMade === wShown.flag && !/"p":"tri-v","c":\["#0F6E67"/.test(wMade));
check('the statistics tell it from a quick one', ['homepage_view', 'sample_edict_answer', 'customize_click'].every(k => ev2.some(e => e[0] === k)) && found2 && found2[1].quick_found === 0, JSON.stringify(ev2.map(e => e[0])));
await W.ctx.close();

/* ── the default region set in Region control ── */
await db.doc('regionStatus/saffron').set({ def: true, enabled: true, mode: 'enabled' }, { merge: true });
const X = await player('default region');
await open(X);
check('a newcomer who chose nothing starts in the default region', await until(async () => /Founding in Saffron Coast/.test(await text(X, '.hm-qf-reg')) && /Saffron Coast/.test(await text(X, '.hm-tab.on'))));
await X.ctx.close();
await db.doc('regionStatus/saffron').delete();

/* ── the carousel and the enlarged view ── */
const C = await player('carousel', { vp: { width: 1366, height: 900 } });
await open(C);
const first = () => C.$eval('#hm-car-track .hm-card-h', h => h.textContent.trim());
check('the carousel says which screens are in view', /^1–4 of 10$/.test(await text(C, '#hm-car-n')));
const f0 = await first(); await C.click('.hm-car-next'); await sleep(1000);
check('its arrows move it on, and back', await first() !== f0 && /^2–5 of 10$/.test(await text(C, '#hm-car-n')) && (await C.click('.hm-car-prev'), await sleep(1000), await first()) === f0);
await C.click('#hm-car-track .hm-card-pic');
check('a screen opens larger, from its own larger picture', await until(async () => await C.evaluate(() => { const d = document.getElementById('hm-zoom'); return !!d && d.open && /\/home\/zoom\//.test(d.querySelector('img').getAttribute('src')); })));
await C.keyboard.press('ArrowRight'); await sleep(200);
check('the arrow keys move through them', /\d+ of 12/.test(await text(C, '#hm-zoom .hm-zoom-n')));
await C.keyboard.press('Escape');
check('Escape closes it', await until(() => C.evaluate(() => !document.getElementById('hm-zoom').open)));
await C.click('.hm-theme');
check('the theme button turns the page dark', await C.evaluate(() => document.documentElement.dataset.theme === 'dark'));
await C.ctx.close();

/* ── a phone ── */
const M = await player('phone', { vp: { width: 390, height: 844 } });
await open(M);
const order = await M.evaluate(() => ['.found-head', '#hm-live', '.hm-h1', '.hm-stats', '.hm-qf', '.hm-rc', '#hm-try', '.hm-show'].map(s => document.querySelector(s).getBoundingClientRect().top));
check('on a phone: header, live bar, headline, counters, founding, map, sample edict, then the rest', order.every((y, i) => !i || y > order[i - 1]), JSON.stringify(order));
check('nothing scrolls sideways', await M.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
check('the carousel shows one screen at a time', /^1 of 10$/.test(await text(M, '#hm-car-n')));
await M.screenshot({ path: OUT + '/front-page-390.png', fullPage: true });
await M.ctx.close();

await finish();
