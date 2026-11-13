// Land only on a known map (game/edictum.html, 2026-11-12). A game that could not reach the server played on its own,
// with no other nation on its map: a new nation founded that way put its capital on land Eternia had claimed, and its
// first save brought it into the region. Now:
//   1. a capital on a hex another nation claimed first does not stand: the other players' maps leave that nation off
//      (capWrong), and its own game lifts it and asks its player, in plain words, to settle again (capLift);
//   2. a game playing in this browser only on the live site cannot settle or claim (landWait); EDICTUM_LAND_STRICT
//      gives this computer the live site's rule;
//   3. a guest sign-in that failed is tried again, and once it works the page reloads into the region (src/shim.js).
// Run with: npm run test:offline-land
// (that is: python3 build.py && firebase emulators:exec --only auth,firestore,functions,hosting "node test/offline-land-e2e.mjs")
import { BASE, OUT, check, finish, until, sleep, player, open, ready, found, settle, nav, text, clearEmulators, nationDoc, localNation } from './lib.mjs';

/* the hexes a player's map gives a nation */
const landOf = (p, id) => p.evaluate(id => {
  const T = G.territory(), i = T.byId[id]; if (i === undefined) return null;
  const cells = []; for (let c = 0; c < G.MAP.N; c++) if (T.owner[c] === i) cells.push(c);
  return cells;
}, id);

await clearEmulators();
const A = await player('A'), B = await player('B');
await open(A); await found(A, 'Eastmere');
const uidA = await A.evaluate(() => G.S.uid);
/* Eastmere claims a hex next to its land: the hex Westholm's capital will come down on */
const target = await A.evaluate(async () => {
  const T = G.territory(), fr = [...G.LK.claimFrontier(T)].filter(c => G.MAP.T[c] >= 2).sort((a, b) => a - b);
  for (const c of fr) if (G.LK.writeClaims([c], '')) return c;
  return -1;
});
check('Eastmere claims a hex', target >= 0, String(target));
check('and its save carries the claim (stamped with the server\'s time)', !!(await until(async () => { const d = await nationDoc(uidA); return d && d.rec.claims.some(e => e.c === target); }, 15000)));

await open(B); await found(B, 'Westholm');
const uidB = await B.evaluate(() => G.S.uid);
const before = await B.evaluate(() => ({ cap: G.S.nation.capital }));
check('the other player sees Westholm’s land', !!(await until(async () => { const l = await landOf(A, uidB); return l && l.length ? l : null; }, 20000)));

/* a save as an offline game made it: the capital on Eastmere's claim (the lift is held off until Eastmere has looked) */
await B.evaluate(c => { G.S.moving = 'a test'; const n = G.clone(G.S.nation); n.loc = G.locOf(c); n.cities = n.cities.map((x, k) => k ? x : { ...x, c, b: (x.b || []).concat({ k: 'farm', s: 1, d: 2, a: 1 }) }); G.commit(n); }, target);
const packed = await B.evaluate(() => JSON.stringify(G.S.nation.cities[0].b));
check('the misplaced capital reaches the server', !!(await until(async () => { const d = await nationDoc(uidB); return d && d.rec.loc && JSON.stringify(d.rec.loc) === JSON.stringify(await B.evaluate(c => G.locOf(c), target)); }, 15000)));
check('Eastmere’s map leaves Westholm off: its capital stands on land claimed first', !!(await until(async () => (await landOf(A, uidB)) === null, 15000)));
const held = await A.evaluate(c => { const T = G.territory(); return T.owner[c] === T.byId[G.S.uid]; }, target);
check('and the hex stays Eastmere’s', held);

/* Westholm's own game lifts the capital and says what happened */
await B.evaluate(() => { G.S.moving = undefined; G.render(); });
/* the guest's recovery-code dialog comes first if it is open (the note waits for it), as a player would close it */
let dlg = null;
for (let k = 0; k < 30 && !dlg; k++) {
  if (await B.isVisible('[data-ed="recovery-saved"]').catch(() => false)) await B.click('[data-ed="recovery-saved"]').catch(() => {});
  dlg = await B.waitForSelector('#cap-lift[open]', { timeout: 500 }).catch(() => null);
}
const said = dlg ? (await dlg.innerText()).replace(/\s+/g, ' ') : '';
if (dlg) await dlg.screenshot({ path: OUT + '/offline-land-note.png' }).catch(() => {});
const why = dlg ? '' : JSON.stringify(await B.evaluate(() => { const L = G.LAND(), T = G.territory(); return { moving: G.S.moving, mode: G.S.mode, heard: L.worldHeardAt(), wait: L.landWait(), wrong: [...(T.wrong || new Map()).keys()], onMap: T.byId[G.S.uid] !== undefined, race: [...L.RACE.t.entries()].slice(0, 6), loc: G.S.nation.loc, capAt: G.S.nation.capAt }; }));
check('Westholm’s player is asked to choose a new home', /Please choose a new home for/.test(said), said.slice(0, 80) || why);
check('in plain words: no connection, an empty map, land Eastmere had claimed', /could not connect to the other players/.test(said) && /had already claimed/.test(said) && /Eastmere/.test(said));
check('and what is kept: buildings come along, credits come back, settling is free', /buildings go up again/.test(said) && /land credit you spent is yours to spend again/.test(said) && /Settling costs nothing/.test(said));
check('the heading has focus', await B.evaluate(() => document.activeElement && document.activeElement.id === 'cpl-h'));
const lifted = await B.evaluate(() => { const n = G.S.nation; return { loc: n.loc, claims: n.claims.length, cities: n.cities.length, rsx: n.rsx, mvCap: !!n.mvCap }; });
check('the nation is off the map: no capital, claims or cities, the capital packed', lifted.loc === null && lifted.claims === 0 && lifted.cities === 0 && lifted.mvCap, JSON.stringify(lifted));
check('it remembers whose land it was', !!lifted.rsx && lifted.rsx.by === 'Eastmere' && lifted.rsx.c === target);
check('and saves that', !!(await until(async () => { const d = await nationDoc(uidB); return d && !d.rec.loc && d.rec.rsx && d.rec.rsx.by === 'Eastmere'; }, 15000)));
await B.click('[data-act="cpl-map"]', { timeout: 5000 }).catch(() => {});
await B.waitForSelector('#cap-lift', { state: 'detached', timeout: 3000 }).catch(() => {});
check('"Choose a new place" opens the map', await B.evaluate(() => G.S.view === 'map'));
check('whose panel says why the capital had to move', /had to move: it stood on land Eastmere had claimed first/.test(await text(B, '#map-panel')));
await B.click('[data-act="cpl-why"]', { timeout: 5000 }).catch(() => {});
check('"What happened?" opens the note again', !!(await B.waitForSelector('#cap-lift[open]', { timeout: 4000 }).catch(() => null)));
await B.keyboard.press('Escape'); await B.waitForSelector('#cap-lift', { state: 'detached', timeout: 3000 }).catch(() => {});

/* the founding edict is long answered, so settle on the map as a player would */
for (let k = 0; k < 4 && !(await B.evaluate(() => !!G.S.nation.loc)); k++) {
  await B.click('[data-act="map-suggest"]').catch(() => {}); await B.click('[data-act="settle"]').catch(() => {});
  await B.waitForFunction(() => !!G.S.nation.loc, undefined, { timeout: 8000 }).catch(() => {});
}
const again = await B.evaluate(() => ({ placed: !!G.S.nation.loc, rsx: !!G.S.nation.rsx, b: JSON.stringify((G.S.nation.cities[0] || {}).b || []), cap: G.S.nation.capital }));
check('settling again puts the capital up with its buildings', again.placed && again.b === packed && /farm/.test(packed) && again.cap === before.cap, JSON.stringify(again));
check('and the note is done with', !again.rsx && !/had to move/.test(await text(B, '#map-panel')));
check('Eastmere sees Westholm on the map again', !!(await until(async () => { const l = await landOf(A, uidB); return l && l.length ? l : null; }, 20000)));

/* ── 2 + 3: offline on the live site, then the sign-in that failed works ── */
const O = await player('O', { recovery: false });
await O.ctx.addInitScript(() => { window.EDICTUM_LAND_STRICT = true; });
let blocked = true;
await O.ctx.route(/accounts:signUp/, r => blocked ? r.abort() : r.continue());
await O.goto(BASE + '/');
check('with the guest sign-in failing, the game plays in this browser only', (await ready(O)) === null);
check('for that reason', await O.evaluate(() => window.__edictum.off === true && window.__edictum.why === 'anonymous sign-in failed'));
await found(O, 'Driftmoor', { newPlayer: true });
check('a nation can still be founded', (await O.evaluate(() => G.S.nation && G.S.nation.name)) === 'Driftmoor');
check('but settling and claiming wait for the connection', await O.evaluate(() => G.LAND().landWait() === 'off'));
await nav(O, 'nation');
await O.locator('.fd-card').screenshot({ path: OUT + '/offline-land-card.png' }).catch(() => {});
check('the Place-your-capital card says why, instead of offering places', /can’t reach the other players/.test(await text(O, '.fd-card')) && !(await O.$('.fd-card [data-act="fd-pick"]')));
await nav(O, 'map');
await O.click('[data-act="map-suggest"]').catch(() => {}); await O.click('[data-act="settle"]').catch(() => {});
await sleep(400);
check('Settle on the map is refused, with the reason', await O.evaluate(() => !G.S.nation.loc) && /Reload the page when your connection is better/.test(await text(O, '#map-panel')));
check('nothing claimed', ((await localNation(O)) || {}).claims?.length === 0);

blocked = false;
const back = O.waitForEvent('framenavigated', { timeout: 150000 }).catch(() => null);
check('once the sign-in works, the page reloads into the region', !!(await back), 'waited for the retry');
await O.waitForSelector('.layout', { timeout: 30000 }).catch(() => {});
const uidO = await ready(O);
check('online, as a guest', typeof uidO === 'string' && uidO.length > 0);
check('Driftmoor came along', !!(await until(async () => { const d = await nationDoc(uidO); return d && d.name === 'Driftmoor'; }, 20000)));
await settle(O);
check('and now settles', await O.evaluate(() => !!G.S.nation.loc));
await sleep(300);
await finish();
