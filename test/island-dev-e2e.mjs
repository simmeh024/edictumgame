// Island towns, land bridges and more land (game/edictum.html, "island towns, land bridges and more land"): after the
// 550th, 750th and 900th decision an edict builds on the nation's artificial islands: a town on one of them (free, and
// one more city than the nation may otherwise found), a land bridge from an island to its other land, three more hexes
// for one island. Played here through the desk itself, after the first island was raised the same way.
// Run with: npm run test:island-dev, or against a static build of public/ with BROWSER_ONLY=1 BASE_URL=http://127.0.0.1:<port>
import { player, open, found, check, finish, sleep, until, nav, text, OUT } from './lib.mjs';
const p = await player('isle dev', { vp: { width: 1280, height: 900 }, inject: !process.env.BROWSER_ONLY });
const errors = [];
p.on('pageerror', e => errors.push(String(e && e.message || e)));
await open(p);
await p.waitForSelector('#d-name');
await p.fill('#d-name', 'Causewayland');
await p.click('#found-btn');
await p.waitForSelector('.layout', { timeout: 15000 });
await sleep(500);

/* a free coastal hex beside open shallows to settle on, away from the map's edges */
const cands = await p.evaluate(() => {
  const M = G.MAP, T = G.territory(), L = G.LK.lakeMap(), out = [];
  for (let c = M.COLS * 24; c < M.N - M.COLS * 24 && out.length < 400; c += 7) {
    if (M.T[c] < 2 || M.T[c] > 3 || T.owner[c] !== -1) continue;
    let sea = 0; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && M.T[j] === 1 && !L[j]) sea++; }
    if (sea >= 2) out.push(c);
  }
  return out;
});
let spot = -1;
for (const c of cands) { if (!(await p.evaluate(m => G.MD.pickProblem(m, G.territory()), c))) { spot = c; break; } }
if (spot < 0) throw new Error(`no free coast to settle on in this region (${cands.length} candidates)`);
await nav(p, 'map');
const settled = () => p.evaluate(() => !!G.S.nation.loc && G.territory().byId[G.myId()] !== undefined);
for (let k = 0; k < 4 && !(await settled()); k++) {
  await p.evaluate(c => { G.S.mapPick = c; G.render(); }, spot);
  await p.click('[data-act="settle"]');
  await until(settled, 6000);
}
check('settled on the coast', await settled(), String(spot));

const DEV = ['isl-town', 'isl-causeway', 'isl-more-land'];
const desk = () => p.evaluate(ids => { const n = G.syncInbox(G.S.nation, Date.now()); G.commit(n); G.render(); return G.S.nation.inbox.map(x => x.id).filter(id => ids.includes(id)); }, DEV);
const setDec = k => p.evaluate(k => { const n = G.clone(G.S.nation); n.dec = k; G.commit(n); G.render(); }, k);
const lands = async id => JSON.stringify(await until(async () => { const d = await desk(); return d.length ? d : null; }, 8000)) === JSON.stringify([id]);
const openEdict = async id => { await nav(p, 'issues'); await p.click(`[data-act="open"][data-id="${id}"]`); await p.waitForSelector('.edict [data-act="answer"]'); };
const answer = async (id, o) => { await p.click(`[data-act="answer"][data-id="${id}"][data-o="${o}"]`); await sleep(700); };
const state = () => p.evaluate(() => {
  const X = window.EDICTUM_PROBE.isd, Y = window.EDICTUM_PROBE.isl, T = G.territory(), me = T.byId[G.myId()], n = G.S.nation;
  const hex = e => ({ c: e.c, i: e.i, k: e.k, T: G.MAP.T[e.c], own: T.owner[e.c] === me, name: Y.landName(e.c) });
  return { isl: (n.isl || []).map(hex), isx: (n.isx || []).map(hex), isw: n.isw || null, isn: n.isn || null, cities: (n.cities || []).map(c => ({ id: c.id, c: c.c, nm: c.nm })),
    max: X.maxCities(), held: T.count[me], used: T.claimUsed[me], credits: G.MD.landCredits(n) };
});

/* the first island, through the desk at 50 decisions */
await setDec(50);
check('the first island edict lands', JSON.stringify(await until(async () => { const d = await p.evaluate(() => { const n = G.syncInbox(G.S.nation, Date.now()); G.commit(n); G.render(); return G.S.nation.inbox.map(x => x.id).filter(id => id === 'isl-dredger'); }); return d.length ? d : null; }, 8000)) === '["isl-dredger"]');
await openEdict('isl-dredger'); await answer('isl-dredger', 0);
const s0 = await state();
check('an island of five hexes is held', s0.isl.length === 5 && s0.isl.every(x => x.own && x.T === 2), JSON.stringify(s0.isl));

/* the town, at 550 */
await setDec(549);
check('no island town before the 550th decision', (await desk()).length === 0);
await setDec(550);
check('the town edict lands at 550 decisions', await lands('isl-town'));
await nav(p, 'issues');
check('it is marked as an island town on the desk', await p.evaluate(() => [...document.querySelectorAll('.issue-item .edict-isl')].some(e => e.textContent === 'Island town')));
await openEdict('isl-town');
const tq = await text(p, '.edict .issue-q'), tn = await p.evaluate(() => [...document.querySelectorAll('.edict .opt-isl')].map(e => e.textContent));
check('the edict names the island', tq.includes(s0.isn[1]) && !/\{ISLE\}/.test(tq), tq.slice(0, 160));
check('each answer says which town it founds, and where', tn.length === 3 && tn.every(t => t.startsWith('Founds ') && t.includes(' on ' + s0.isn[1])) && /Haven on /.test(tn[0]), JSON.stringify(tn));
await p.screenshot({ path: OUT + '/island-dev-town.png' });
await answer('isl-town', 0);
const s1 = await state();
const town = s1.cities.find(c => !s0.cities.some(x => x.id === c.id));
console.log('town', JSON.stringify(town), 'cities', s0.cities.length, '→', s1.cities.length, 'may found', s0.max, '→', s1.max);
check('a town is founded on the island', !!town && s0.isl.some(x => x.c === town.c) && /Haven$/.test(town.nm), JSON.stringify(town));
check('free, and on top of the cities the nation may found', s1.cities.length === s0.cities.length + 1 && s1.max === s0.max + 1 && s1.isw && s1.isw.ti === 1 && s1.isw.tc === town.id, JSON.stringify(s1.isw));
check('the result page says so', (await text(p, '#main')).includes(`${town.nm} is founded on ${s0.isn[1]}`));

/* the land bridge, at 750 */
await setDec(749);
check('no land bridge before the 750th decision', (await desk()).length === 0);
await setDec(750);
check('the bridge edict lands at 750 decisions', await lands('isl-causeway'));
await openEdict('isl-causeway');
const bq = await text(p, '.edict .issue-q'), bn = await p.evaluate(() => [...document.querySelectorAll('.edict .opt-isl')].map(e => e.textContent));
check('the edict names the island, the shore and the length', bq.includes(s0.isn[1]) && !/\{(ISLE|ISHORE|BRN)\}/.test(bq) && /(one hex|[a-z]+ hexes) of sand and stone/.test(bq), bq.slice(0, 260));
check('each answer says what it joins', bn.length === 3 && bn.every(t => t.startsWith('Joins ' + s0.isn[1] + ' to ')), JSON.stringify(bn));
await answer('isl-causeway', 0);
const s2 = await state();
const br = s2.isx.filter(x => x.k === 'b');
console.log('bridge', JSON.stringify(br), 'held', s1.held, '→', s2.held);
check('a land bridge rises from the sea, the nation’s at once', br.length >= 1 && br.length <= 8 && br.every(x => x.own && x.T === 2 && x.i === 1) && s2.held === s1.held + br.length, JSON.stringify(br));
check('no land credit was spent', s2.used === s1.used && s2.credits >= s1.credits, `claims ${s1.used} → ${s2.used}, credits ${s1.credits} → ${s2.credits}`);
check('it carries its name', br.every(x => x.name === s2.isw.bn) && /Causeway$/.test(s2.isw.bn), JSON.stringify(s2.isw));
const joined = await p.evaluate(({ br, isl }) => {
  const M = G.MAP, T = G.territory(), me = T.byId[G.myId()], nb = c => [0, 1, 2, 3, 4, 5].map(d => M.nbr[c * 6 + d]).filter(j => j >= 0);
  const main = j => T.owner[j] === me && M.T[j] >= 2 && !isl.includes(j) && !br.includes(j);
  return { chain: br.every((c, k) => !k || nb(br[k - 1]).includes(c)), start: nb(br[0]).some(j => isl.includes(j)), end: nb(br.at(-1)).some(main) };
}, { br: br.map(x => x.c), isl: s0.isl.map(x => x.c) });
check('it joins the island to the mainland, hex by hex', joined.chain && joined.start && joined.end, JSON.stringify(joined));

/* more land, at 900 */
await setDec(899);
check('no new land before the 900th decision', (await desk()).length === 0);
await setDec(900);
check('the last edict lands at 900 decisions', await lands('isl-more-land'));
await openEdict('isl-more-land');
const gn = await p.evaluate(() => [...document.querySelectorAll('.edict .opt-isl')].map(e => e.textContent));
check('each answer adds three hexes to the island', gn.length === 3 && gn.every(t => /^Adds three hexes of land to .+, yours at once without a land credit\.$/.test(t)) && gn[0].includes(s0.isn[1]), JSON.stringify(gn));
await answer('isl-more-land', 1);
const s3 = await state();
const gr = s3.isx.filter(x => x.k === 'g');
check('three hexes join the town’s island, the nation’s at once', gr.length === 3 && gr.every(x => x.own && x.T === 2 && x.i === 1 && x.name === s0.isn[1]) && s3.held === s2.held + 3, JSON.stringify(gr));
check('the bridge stays', s3.isx.filter(x => x.k === 'b').length === br.length);
check('no fourth edict', (await desk()).length === 0);

/* the map: the island with its town, its bridge and its new land */
await nav(p, 'map');
await p.evaluate(c => { G.MD.centerMain(c, 18); G.MD.drawMap(document.querySelector('canvas[data-map="main"]')); }, town.c);
await sleep(900);
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/island-dev-map.png' });

/* another player of the region sees the bridge and the new land as this nation's (on the emulators) */
if (!process.env.BROWSER_ONLY) {
  const q = await player('isle dev neighbour');
  await open(q); await found(q, 'Ferry Point');
  const me = await p.evaluate(() => G.myId()), cells = s3.isx.map(x => x.c);
  const seen = await until(() => q.evaluate(([id, cells]) => { const T = G.territory(), i = T.byId[id]; if (i === undefined) return null;
    return cells.every(c => T.owner[c] === i && G.MAP.T[c] === 2) ? cells.map(c => window.EDICTUM_PROBE.isl.landName(c)) : null; }, [me, cells]), 30000);
  check('another player sees the bridge and the new land as Causewayland’s, by name', !!seen && seen.every((nm, k) => nm === s3.isx[k].name), JSON.stringify(seen));
}
/* kept through a reload: the town on its island, the bridge, the new land and the charter */
await sleep(2500); await p.reload(); await p.waitForFunction(() => window.G && G.S && G.S.nation && G.territory().byId[G.myId()] !== undefined, null, { timeout: 20000 });
const kept = await state();
check('all of it is still there after a reload', kept.cities.some(c => c.id === town.id && c.c === town.c) && kept.isx.length === s3.isx.length && kept.isx.every(x => x.own && x.T === 2)
  && JSON.stringify(kept.isw) === JSON.stringify(s3.isw) && kept.max === s3.max, JSON.stringify({ isw: kept.isw, max: kept.max, isx: kept.isx.length }));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
finish();
