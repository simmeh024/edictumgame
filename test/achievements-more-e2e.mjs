// Achievements for Flock, provinces, warehouses, roads and transport, mayors and city mood, the Regional Assembly and
// parliament, in the built game on the emulators.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/achievements-more-e2e.mjs"
import path from 'node:path';
import { OUT, check, finish, sleep, until, player, open, found, nav, settle } from './lib.mjs';

const A = await player('Ach-More', { vp: { width: 1280, height: 1000 } });
await open(A);await found(A, 'Tallyburg');await settle(A);
const IDS = ['flk-1', 'flk-25', 'flk-100', 'prv-2', 'prv-5', 'prv-10', 'prv-gov5', 'prv-merge', 'wh-1', 'wh-3', 'wh-t3', 'wh-max', 'tr-1', 'tr-10', 'tr-rail', 'tr-bridge', 'tr-all',
  'my-1', 'my-all', 'md-thrive', 'md-all', 'md-10', 'asm-1', 'asm-25', 'asm-mine', 'asm-mine5', 'asm-del', 'asm-del5', 'gv-alone', 'gv-coal', 'gv-seats', 'gv-senate', 'md-spend10', 'md-spend50', 'brf-10', 'brf-60'];
const vals = await A.evaluate(ids => { const x = { n: G.S.nation, id: G.S.uid, me: true, m: {}, now: Date.now() };
  return ids.map(id => { const a = G.RK.ACH.find(q => q.id === id); return a ? [id, a.f(x), a.g, a.n] : [id, 'missing']; }); }, IDS);
check('36 new achievements, each working out its figure for a real nation', vals.every(([, v, g]) => Number.isFinite(v) && v >= 0 && g > 0), JSON.stringify(vals.filter(([, v]) => !Number.isFinite(v))));
check('no two achievements share a name', await A.evaluate(() => { const s = new Set(), d = []; for (const a of G.RK.ACH) { if (s.has(a.n)) d.push(a.n); s.add(a.n); } return d.length === 0 || d; }));
const parl = vals.find(r => r[0] === 'gv-seats');
check('the parliament’s size counts towards A Full House', parl[1] > 0, JSON.stringify(parl));

/* a peep on Flock counts, and earns First Peep */
await nav(A, 'flock');await sleep(400);
await A.fill('#flk-text', 'Testing the new honours office.');
await A.evaluate(() => document.getElementById('flk-form').requestSubmit());await sleep(600);
const flk = await until(() => A.evaluate(() => { const n = G.S.nation; return n.tly && n.tly.flk >= 1 ? { t: n.tly.flk, a: !!(n.ach && n.ach['flk-1']) } : null; }), 8000);
check('a peep is counted, and earns First Peep', !!flk && flk.t === 1 && flk.a, JSON.stringify(flk));

await nav(A, 'achievements');await sleep(500);
await A.evaluate(() => { const c = document.getElementById('ach-flk-1'); if (c) c.scrollIntoView({ block: 'center' }); });await sleep(200);
await A.screenshot({ path: path.join(OUT, 'ach-more.png') });
await finish();
