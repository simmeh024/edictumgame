// First steps: easy Bronze achievements for a new player, in the built game on the emulators.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/first-steps-e2e.mjs"
import path from 'node:path';
import { OUT, check, finish, sleep, until, player, open, found, nav, settle, czSection } from './lib.mjs';

const A = await player('First-Steps', { vp: { width: 1280, height: 1000 } });
await open(A);await found(A, 'Firstonia');await settle(A);
const earned = () => A.evaluate(() => Object.keys(G.S.nation.ach || {}).filter(k => k.startsWith('fs-')).sort());
check('none of the first steps is earned before the player does anything (placing the capital opens the map)', (await earned()).filter(k => k !== 'fs-move' && k !== 'fs-map').length === 0, JSON.stringify(await earned()));
for (const v of ['nation', 'issues', 'map', 'cities', 'stats', 'census', 'government', 'trade', 'region', 'achievements', 'passport', 'museum']) { await nav(A, v); await sleep(350); }
/* the visits are written with the next ordinary save */
await A.evaluate(() => { const n = G.clone(G.S.nation); G.commit(n); });await sleep(400);
const pages = await A.evaluate(() => Object.keys(G.S.nation.tly || {}).filter(k => k.startsWith('view:')).length);
check('each page is counted once, the first time it is opened, with the next save', pages >= 10, String(pages));
const got = await until(async () => { const e = await earned(); return ['fs-pages10', 'fs-stats', 'fs-map', 'fs-ach'].every(k => e.includes(k)) ? e : null; }, 8000);
check('opening pages earns Finding Your Way, Census Taker, Map Reader and Hall of Fame', !!got, JSON.stringify(await earned()));
/* a change in Customise */
await A.evaluate(() => { const n = G.clone(G.S.nation); n.tly = Object.assign({}, n.tly); G.commit(n); });
await nav(A, 'customise');await sleep(600);
await czSection(A, 'b');
const clicked = await A.evaluate(() => { const b = document.getElementById('cz-p-p-waves') || document.getElementById('cz-p-p-guilloche'); if (!b) return false; b.click(); return true; });
await sleep(600);
check('changing the look in Customise earns A Touch of Style', clicked && !!(await until(async () => (await earned()).includes('fs-style'), 6000)), JSON.stringify(await earned()));
const saved = await A.evaluate(() => Object.keys(G.S.nation.ach || {}).length);
check('a new player earns a handful of achievements in the first minutes', saved >= 8, String(saved));
await nav(A, 'achievements');await sleep(400);
await A.evaluate(() => { const c = document.getElementById('ach-fs-pages10'); if (c) c.scrollIntoView({ block: 'center' }); });await sleep(200);
await A.screenshot({ path: path.join(OUT, 'first-steps.png') });
await finish();
