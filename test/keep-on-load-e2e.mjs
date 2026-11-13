// Keep what a newer build saved (game/edictum.html, normalize + the achievements hook; src/shim.js, splitNation): a record
// carrying a field and an achievement this build does not know keeps both through a load, a change and a save, the
// field moving to the private half, and both still there after another reload. Also: loading a whole region stays quick.
// Run with: npm run test:keep-on-load
import { PROJECT, FS_HOST, check, finish, until, sleep, player, open, found, restGet, fieldsText, clearEmulators } from './lib.mjs';

const DOCS = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const shared = async uid => { const r = await restGet('nations/' + uid); return r.status === 200 ? { rev: Number(r.body.fields.rev.integerValue), rec: JSON.parse(fieldsText(r.body.fields)) } : null; };
const priv = async uid => { const r = await restGet('nationx/' + uid); return r.status === 200 && r.body.fields.j ? JSON.parse(r.body.fields.j.stringValue) : null; };

await clearEmulators();
const A = await player('keep');
const uid = await open(A); await found(A, 'Keepsake');
check('the nation is saved', !!(await until(() => shared(uid), 15000)));

/* a newer build's save, as the emulator's owner writes it: a field and an achievement this build has never heard of.
   Written once the game's own first saves are done (same rev for 3 s): a write while the game saves the record gets a 409
   from the emulator (seen in CI, 13 Nov 2026), so a clash is retried on a fresh copy. */
let last = -1, same = 0;
await until(async () => { const s = await shared(uid); const r = s ? s.rev : -1; same = r === last ? same + 1 : 0; last = r; return same >= 6; }, 30000, 500);
let w = null, at = 0;
for (let i = 0; i < 6 && !(w && w.ok); i++) {
  if (i) await sleep(700);
  const raw = await restGet('nations/' + uid), f = raw.body.fields, rec = JSON.parse(fieldsText(f));
  at = Date.now() - 60e3;
  rec.zzFuture = { tier: 3, notes: ['kept'] }; rec.ach = { ...(rec.ach || {}), 'zz-future-medal': at };
  delete f.z; f.v = { integerValue: '1' }; f.j = { stringValue: JSON.stringify(rec) }; f.rev = { integerValue: String(Number(f.rev.integerValue) + 1) };
  w = await fetch(`${DOCS}/nations/${uid}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: f }) });
}
check('the newer save is in place', w.ok, String(w.status));

await A.reload(); await A.waitForSelector('.layout', { timeout: 30000 });
const loaded = await until(() => A.evaluate(() => G.S.nation && G.S.nation.zzFuture && G.S.nation.ach && G.S.nation.ach['zz-future-medal'] ? { f: G.S.nation.zzFuture, fk: G.S.nation._fk } : null), 15000);
check('loading keeps the unknown field as it was, and says it is unknown', !!loaded && loaded.f.tier === 3 && loaded.f.notes[0] === 'kept' && Array.isArray(loaded.fk) && loaded.fk.includes('zzFuture'), JSON.stringify(loaded));
check('and the unknown achievement, which counts for nothing here', await A.evaluate(() => { const a = { ...G.S.nation.ach }, b = { ...a }; delete b['zz-future-medal']; return G.RK.achPoints({ ach: a }) === G.RK.achPoints({ ach: b }); }));

/* a change and a save from this build */
const rev0 = (await shared(uid)).rev;
await A.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'Nothing is lost'; G.commit(n); });
check('this build saves a change', !!(await until(async () => { const s = await shared(uid); return s && s.rev > rev0 && s.rec.motto === 'Nothing is lost'; }, 20000)));
const s1 = await shared(uid), p1 = await priv(uid);
check('the achievement is still in the shared record', !!s1.rec.ach && s1.rec.ach['zz-future-medal'] === at);
check('the unknown field moved to the private half, and _fk was never saved', !('zzFuture' in s1.rec) && !!p1 && p1.zzFuture && p1.zzFuture.tier === 3 && !('_fk' in s1.rec) && !('_fk' in p1), JSON.stringify({ shared: 'zzFuture' in s1.rec, priv: p1 && p1.zzFuture }));

await A.reload(); await A.waitForSelector('.layout', { timeout: 30000 });
check('after another reload both are still there', !!(await until(() => A.evaluate(() => !!(G.S.nation.zzFuture && G.S.nation.zzFuture.tier === 3 && G.S.nation.ach['zz-future-medal'])), 15000)));

/* loading watches which fields it reads: a whole region's worth of records still loads quickly */
const ms = await A.evaluate(() => { const r = JSON.parse(JSON.stringify(G.S.nation)); const t = performance.now(); for (let i = 0; i < 200; i++) G.normalize(JSON.parse(JSON.stringify(r))); return (performance.now() - t) / 200; });
check('a record loads in a few milliseconds', ms < 15, ms.toFixed(2) + ' ms each');
await sleep(300);
await finish();
