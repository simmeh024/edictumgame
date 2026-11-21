// Artificial islands (game/edictum.html, "artificial islands"): after the 50th, 150th and 500th decision an edict lands
// on the desk that raises an island of 4 or 5 hexes from the shallows, at most 8 hexes out, held at once without a land
// credit. Played here through the desk itself, all three, on a nation settled on a coast.
// Run with: npm run test:islands, or against a static build of public/ with BROWSER_ONLY=1 BASE_URL=http://127.0.0.1:<port>
import { player, open, found, check, finish, sleep, until, nav, text, OUT } from './lib.mjs';
const p = await player('isle', { vp: { width: 1280, height: 900 }, inject: !process.env.BROWSER_ONLY });
const errors = [];
p.on('pageerror', e => errors.push(String(e && e.message || e)));
await open(p);
await p.waitForSelector('#d-name');
await p.fill('#d-name', 'Dredgeland');
await p.click('#found-btn');
await p.waitForSelector('.layout', { timeout: 15000 });
await sleep(500);
const I = () => 'window.EDICTUM_PROBE.isl';

/* a free coastal hex beside open shallows to settle on (the game's own placement check, one call at a time) */
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

/* the desk as the game holds it now: synced, saved and drawn */
const desk = () => p.evaluate(() => { const n = G.syncInbox(G.S.nation, Date.now()); G.commit(n); G.render(); return G.S.nation.inbox.map(x => x.id).filter(id => /^isl-/.test(id)); });
const setDec = k => p.evaluate(k => { const n = G.clone(G.S.nation); n.dec = k; G.commit(n); G.render(); }, k);
const state = () => p.evaluate(() => {
  const X = window.EDICTUM_PROBE.isl, T = G.territory(), me = T.byId[G.myId()], n = G.S.nation;
  const isl = (n.isl || []).map(e => ({ c: e.c, i: e.i, T: G.MAP.T[e.c], own: T.owner[e.c] === me, name: X.landName(e.c), terr: X.terrName(e.c) }));
  if ((n.rec || []).some(e => e.i)) throw new Error('an island hex went into n.rec');
  return { isl, held: T.count[me], used: T.claimUsed[me], credits: G.MD.landCredits(n), isn: n.isn || null, log: (n.log || []).filter(l => l.k === 'isl').length };
});

await setDec(49);
check('no island edict before the 50th decision', (await desk()).length === 0);
await setDec(50);
const first = await until(async () => { const d = await desk(); return d.length ? d : null; }, 8000);
check('the first island edict lands at 50 decisions', JSON.stringify(first) === '["isl-dredger"]', JSON.stringify(first));
await nav(p, 'issues');
check('it is marked as an artificial island on the desk', await p.evaluate(() => !!document.querySelector('.issue-item .edict-isl')));
await p.locator('#main').screenshot({ path: OUT + '/islands-desk.png' });
await p.click('[data-act="open"][data-id="isl-dredger"]'); await p.waitForSelector('.edict [data-act="answer"]');
const notes = await p.evaluate(() => [...document.querySelectorAll('.edict .opt-isl')].map(e => e.textContent));
check('each answer says what it raises', notes.length === 3 && /island of 5 hexes/.test(notes[0]) && /island of 4 hexes/.test(notes[1]), JSON.stringify(notes));
await p.screenshot({ path: OUT + '/islands-edict.png' });

const before = await state();
await p.click('[data-act="answer"][data-id="isl-dredger"][data-o="0"]'); await sleep(600);
const one = await state();
console.log('first island', JSON.stringify(one.isl), 'held', before.held, '→', one.held);
check('five hexes of land rise from the sea', one.isl.length === 5 && one.isl.every(x => x.T === 2 && x.i === 1), JSON.stringify(one.isl));
check('they are the nation’s at once', one.isl.every(x => x.own) && one.held === before.held + 5, `${before.held} → ${one.held}`);
check('no land credit was spent', one.used === before.used && one.credits >= before.credits, `claims ${before.used} → ${one.used}, credits ${before.credits} → ${one.credits}`);
check('the island carries its name', one.isl.every(x => x.name === one.isn[1] && /Port Island$/.test(x.name)) && one.log === 1, JSON.stringify(one.isn));
const res = await text(p, '#main');
check('the result page says so', /an island of 5 hexes, has risen from the sea off/.test(res), res.slice(0, 300));
const geo = await p.evaluate(cells => {
  const M = G.MAP, T = G.territory(), me = T.byId[G.myId()], mine = []; for (let c = 0; c < M.N; c++) if (T.owner[c] === me && !cells.includes(c)) mine.push(c);
  const D = new Int16Array(M.N).fill(-1), q = [...mine]; for (const c of mine) D[c] = 0;
  for (let h = 0; h < q.length; h++) { const a = q[h]; for (let d = 0; d < 6; d++) { const j = M.nbr[a * 6 + d]; if (j >= 0 && D[j] < 0) { D[j] = D[a] + 1; q.push(j); } } }
  const apart = cells.every(c => [0, 1, 2, 3, 4, 5].every(d => { const j = M.nbr[c * 6 + d]; return j < 0 || cells.includes(j) || M.T[j] < 2; }));
  return { d: cells.map(c => D[c]), apart };
}, one.isl.map(x => x.c));
check('no more than 8 hexes out, and apart from the coast', geo.d.every(d => d >= 2 && d <= 8) && geo.apart, JSON.stringify(geo));

/* the map, centred on the new island */
await nav(p, 'map');
await p.evaluate(c => { G.MD.centerMain(c, 16); G.MD.drawMap(document.querySelector('canvas[data-map="main"]')); }, one.isl[0].c);
await sleep(800);
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/islands-map-1.png' });

/* the second, at 150, and the third, at 500: each its own island, apart from the others */
await setDec(149);
check('nothing more until the 150th decision', (await desk()).length === 0);
await setDec(150);
check('the second lands at 150', JSON.stringify(await until(async () => { const d = await desk(); return d.length ? d : null; }, 8000)) === '["isl-runway"]');
await nav(p, 'issues');
await p.click('[data-act="open"][data-id="isl-runway"]'); await p.waitForSelector('.edict [data-act="answer"]');
await p.click('[data-act="answer"][data-id="isl-runway"][data-o="2"]'); await sleep(600);
await setDec(500);
check('the third lands at 500', JSON.stringify(await until(async () => { const d = await desk(); return d.length ? d : null; }, 8000)) === '["isl-last-barge"]');
await nav(p, 'issues');
await p.click('[data-act="open"][data-id="isl-last-barge"]'); await p.waitForSelector('.edict [data-act="answer"]');
await p.click('[data-act="answer"][data-id="isl-last-barge"][data-o="0"]'); await sleep(600);
const all = await state();
const by = k => all.isl.filter(x => x.i === k).map(x => x.c);
check('three islands: 5, 4 and 5 hexes, all held', by(1).length === 5 && by(2).length === 4 && by(3).length === 5 && all.isl.every(x => x.own && x.T === 2), JSON.stringify(all.isl));
const edges = await p.evaluate(gs => gs.map(g => { let e = 0; for (const c of g) for (let d = 0; d < 6; d++) if (g.includes(G.MAP.nbr[c * 6 + d])) e++; return e / 2; }), [by(1), by(2), by(3)]);
console.log('touching pairs in each island', JSON.stringify(edges));
check('each island is a blob, not a line', edges[0] >= 6 && edges[1] >= 4 && edges[2] >= 6, JSON.stringify(edges));
check('each its own island', await p.evaluate(gs => gs.every((g, a) => g.every(c => [0, 1, 2, 3, 4, 5].every(d => { const j = G.MAP.nbr[c * 6 + d]; return !gs.some((h, b) => b !== a && h.includes(j)); }))), [by(1), by(2), by(3)]));
check('the names are kept', all.isn && /Research Island$/.test(all.isn[2]) && /^New /.test(all.isn[3]), JSON.stringify(all.isn));
check('no fourth island edict', (await desk()).length === 0);

/* another player of the region sees them as this nation's land, under their names (on the emulators: a static build
   has no region) */
if (!process.env.BROWSER_ONLY) {
  const q = await player('isle neighbour');
  await open(q); await found(q, 'Lookout Bay');
  const me = await p.evaluate(() => G.myId());
  const seen = await until(() => q.evaluate(([id, cells]) => { const T = G.territory(), i = T.byId[id]; if (i === undefined) return null;
    return cells.every(c => T.owner[c] === i && G.MAP.T[c] === 2) ? cells.map(c => window.EDICTUM_PROBE.isl.landName(c)) : null; }, [me, all.isl.map(x => x.c)]), 30000);
  check('another player sees the islands as Dredgeland’s land, by name', !!seen && seen.every((nm, k) => nm === all.isl[k].name), JSON.stringify(seen));
}
/* kept through a reload */
await sleep(2500); await p.reload(); await p.waitForFunction(() => window.G && G.S && G.S.nation && G.territory().byId[G.myId()] !== undefined, null, { timeout: 20000 });
const kept = await state();
check('the islands and their names are still there after a reload', kept.isl.length === 14 && kept.isl.every(x => x.own && x.T === 2) && JSON.stringify(kept.isn) === JSON.stringify(all.isn), JSON.stringify(kept));
await nav(p, 'map');
await p.evaluate(c => { G.MD.centerMain(c, 14); G.MD.drawMap(document.querySelector('canvas[data-map="main"]')); }, by(3)[0]);
await sleep(800);
await p.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/islands-map-3.png' });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
finish();
