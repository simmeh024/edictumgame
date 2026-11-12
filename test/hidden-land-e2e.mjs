// A nation a moderator hides keeps its land (HIDN in game/edictum.html): the other players' maps hold it as a grey,
// nameless "Hidden nation" that nobody can claim, and nothing moves when it is shown again. Run with:
//   npm run test:hidden-land
// (that is: python3 build.py && firebase emulators:exec --only auth,firestore,functions,hosting "node test/hidden-land-e2e.mjs")
import { BASE, PROJECT, FS_HOST, check, finish, until, sleep, player, open, found, regionTab, text, clearEmulators } from './lib.mjs';

/* the owner writes mod/<uid> as the admin console does (functions/admin.js), past the rules */
const DOCS = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const owner = (path, init = {}) => fetch(`${DOCS}/${path}`, { headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, ...init });
const hide = uid => owner('mod/' + uid, { method: 'PATCH', body: JSON.stringify({ fields: { hidden: { booleanValue: true }, note: { stringValue: 'Under review' }, t: { integerValue: String(Date.now()) }, by: { stringValue: 'admin' } } }) });
const unhide = uid => owner('mod/' + uid, { method: 'DELETE' });

/* the hexes a player's map gives a nation, and how it shows it */
const landOf = (p, id) => p.evaluate(id => {
  const T = G.territory(), i = T.byId[id]; if (i === undefined) return null;
  const cells = []; for (let c = 0; c < G.MAP.N; c++) if (T.owner[c] === i) cells.push(c);
  return { cells, hid: !!T.list[i].hid, name: T.list[i].n.name, capital: T.list[i].n.capital };
}, id);
const same = (a, b) => !!a && !!b && a.cells.length === b.cells.length && a.cells.every((c, k) => c === b.cells[k]);

await clearEmulators();
const B = await player('B'), A = await player('A');
await open(B); await found(B, 'Veilland');
const uidB = await B.evaluate(() => G.S.uid);
await open(A); await found(A, 'Watchford');

const seen = await until(async () => { const l = await landOf(A, uidB); return l && l.cells.length ? l : null; }, 20000);
check('the other player sees Veilland’s land', !!seen && !seen.hid && seen.name === 'Veilland', seen && seen.cells.length + ' hexes');

await hide(uidB);
const held = await until(async () => { const l = await landOf(A, uidB); return l && l.hid ? l : null; }, 15000);
check('hidden, its land stays on the other player’s map', same(held, seen), held && held.cells.length + ' hexes');
check('as a grey, nameless Hidden nation', !!held && held.name === 'Hidden nation' && held.capital === 'Capital');
check('none of it can be claimed', !(await A.evaluate(cells => { const T = G.territory(), fr = G.MD.claimFrontier(T); return cells.some(c => fr.has(c)); }, held ? held.cells : [])));
await regionTab(A);
check('it leaves the region’s list of nations', !/Veilland/.test(await text(A, '.tbl')) && /Watchford/.test(await text(A, '.tbl')));
const panel = await A.evaluate(id => { G.S.mapSel = id; const h = G.HID().mapPanel(); G.S.mapSel = null; return h; }, uidB);
check('its map panel says why, with no name, war, spy or visit', /Hidden nation/.test(panel) && /moderators have hidden/.test(panel) && !/Veilland|Declare war|Send a spy|View nation/.test(panel));
check('its owner still plays it, and its army stays at home', await until(() => B.evaluate(() => G.HID().iAmHidden() && G.HID().frontier(G.territory()).size === 0), 10000));

await unhide(uidB);
const back = await until(async () => { const l = await landOf(A, uidB); return l && !l.hid ? l : null; }, 15000);
check('shown again, it has exactly the land it had', same(back, seen) && back.name === 'Veilland');

/* ── waking from dormancy: the welcome back (dormWelcome), and the free move to a quieter region ──
   browser-only, so the test can move the nation's clock back as test/e2e.mjs does */
const W = await player('W', { block: /\/vendor\/firebase\/|\/__\/firebase\//, inject: false });
await open(W); await found(W, 'Sleepwell');
await W.evaluate(() => { const n = JSON.parse(localStorage.getItem('statehood.nation.v1')); n.updatedAt = Date.now() - 260 * 864e5; delete n.away; n.lcb = 30; localStorage.setItem('statehood.nation.v1', JSON.stringify(n)); });
await W.reload(); await W.waitForSelector('#dorm-name');
await W.fill('#dorm-name', 'Sleepwell'); await W.click('#dorm-form button[type="submit"]');
const dlg = await W.waitForSelector('#dorm-wb[open]', { timeout: 8000 }).catch(() => null);
const said = dlg ? (await dlg.innerText()).replace(/\s+/g, ' ') : '';
check('waking opens a welcome back', /Welcome back, The .* of Sleepwell/.test(said) && /260 days have passed/.test(said), said.slice(0, 90));
check('it says the land went back to the wild, and offers both ways on', /went back to the wild/.test(said) && /Begin again in/.test(said) && /start afresh somewhere quieter/.test(said));
check('the heading has focus', await W.evaluate(() => document.activeElement && document.activeElement.id === 'dwb-h'));
await W.click('[data-act="dwb-stay"]');
await W.waitForSelector('#dorm-wb', { state: 'detached', timeout: 3000 }).catch(() => {});
check('"Choose a place on the map" closes it on the map', !(await W.$('#dorm-wb')) && await W.evaluate(() => G.S.view === 'map'));
check('until it settles, the map panel keeps the way to a quieter region', /quieter region at no cost/.test(await text(W, '#map-panel')));
await W.click('[data-act="dorm-welcome"]');
check('which opens the welcome back again', !!(await W.waitForSelector('#dorm-wb[open]', { timeout: 4000 }).catch(() => null)));
await W.keyboard.press('Escape'); await W.waitForSelector('#dorm-wb', { state: 'detached', timeout: 3000 }).catch(() => {});
const pre = await W.evaluate(() => { const X = G.WAKE(), n = G.S.nation; return { rid: X.REGIONS.find(R => R.id !== X.REG.id && !X.regDisabled(R.id)).id, fresh: X.dormFresh(n), cap: JSON.stringify(n.mvCap || null), mvl: n.mvl || 0 }; });
const moved = W.waitForEvent('framenavigated', { timeout: 15000 }).catch(() => null);
await W.evaluate(rid => { G.WAKE().moveTo(rid, true); }, pre.rid);
await moved; await W.waitForSelector('.layout', { timeout: 20000 }).catch(() => {}); await sleep(1200);
const post = await W.evaluate(() => { const raw = JSON.parse(localStorage.getItem('statehood.nation.v1')); return { reg: raw.reg, here: G.WAKE().REG.id, mvl: raw.mvl || 0, cap: JSON.stringify(raw.mvCap || null), fresh: G.WAKE().dormFresh(G.S.nation), again: !!document.querySelector('[data-act="dorm-welcome"]') }; });
check('the free move lands in the chosen region', pre.fresh && post.reg === pre.rid && post.here === pre.rid, JSON.stringify(post));
check('losing no land credits and keeping the packed capital', post.mvl === pre.mvl && post.cap === pre.cap && pre.cap !== 'null');
check('and it is spent: no second free move', !post.fresh && !post.again);
await sleep(300);
await finish();
