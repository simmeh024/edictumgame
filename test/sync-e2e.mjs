// Two independent browser profiles sharing one account, against the local emulators.
import {
  check, finish, sleep, until, player, open, ready, found, nav, localNation,
  nationDoc, restGet, clearEmulators, openAccount, errors
} from './lib.mjs';

await clearEmulators();
const A = await player('desktop');
const uid = await open(A);
await found(A, 'Togetherland');
check('the initial nation reaches Firestore', !!await until(() => nationDoc(uid), 15000), JSON.stringify(errors));
await until(async () => { const n = await localNation(A); return n && n._rev > 0 && !n._dirty; }, 15000);
// Copy only the starting authenticated session, then let the two storage profiles evolve independently.
// Existing e2e.mjs covers linking and signing in with Google; these tests exercise saving after sign-in.
const B = await player('phone', { vp: { width: 390, height: 844 }, storageState: await A.ctx.storageState({ indexedDB: true }) });
await open(B);
check('both devices play the same account', await ready(B) === uid);
await B.waitForSelector('.layout');

const rev = async () => Number((await restGet('nations/' + uid)).body.fields.rev.integerValue);
const motto = async () => (await nationDoc(uid)).rec.motto;
const edit = async (p, value) => {
  await nav(p, 'settings'); await p.fill('#s-motto', value);
  await p.click('#settings-form button[type="submit"]');
};
const saved = async p => {
  const n = await until(async () => { const n = await localNation(p); return n && n._rev > 0 && !n._dirty; }, 15000);
  if (!n) throw new Error('Save did not settle: ' + JSON.stringify({ nation: await localNation(p), errors }));
  return n;
};

await edit(A, 'Saved on desktop'); await saved(A);
check('an idle phone receives a desktop save without reloading', await until(async () => (await localNation(B)).motto === 'Saved on desktop', 15000));
await edit(B, 'Saved on phone'); await saved(B);
check('updates flow back from phone to desktop', await until(async () => (await localNation(A)).motto === 'Saved on phone', 15000));

// A session behind a fast device clock must still accept a greater server revision.
await A.evaluate(async uid => {
  const db = await window.claude.use('db'), n = (await db.doc('nations/' + uid).get()).data();
  n.motto = 'Fast desktop clock'; n.updatedAt = Date.now() + 3600000;
  await db.doc('nations/' + uid).set(n);
}, uid);
await until(async () => (await localNation(A)).motto === 'Fast desktop clock', 15000);
await until(async () => (await localNation(B)).motto === 'Fast desktop clock', 15000);
await edit(B, 'Slower phone clock'); await saved(B);
check('a higher revision wins even with an earlier device timestamp', await until(async () => (await localNation(A)).motto === 'Slower phone clock', 15000));

// Hold one device offline while it edits; let the other commit before it reconnects.
await B.ctx.setOffline(true);
await edit(B, 'Unsaved phone edit');
await sleep(2500);
await edit(A, 'Desktop wins the race'); await saved(A);
const winningRevision = await rev();
await B.ctx.setOffline(false);
await B.evaluate(() => window.dispatchEvent(new Event('online')));
check('an offline stale device loads the winning save', await until(async () => (await localNation(B)).motto === 'Desktop wins the race', 20000));
check('the stale edit never overwrites the cloud', await motto() === 'Desktop wins the race' && await rev() === winningRevision);
const copy = await B.evaluate(uid => JSON.parse(localStorage.getItem('edictum.unsaved.' + uid)), uid);
check('the rejected changes are preserved on their original device', copy && copy.nation.motto === 'Unsaved phone edit');
await openAccount(B);
const [download] = await Promise.all([B.waitForEvent('download'), B.click('[data-ed="unsaved"]')]);
check('the player can download their unsaved copy', download.suggestedFilename() === 'edictum-unsaved.json');
await B.keyboard.press('Escape');
await edit(B, 'Phone can save again'); await saved(B);
check('the conflicted device can save a subsequent action', await motto() === 'Phone can save again');

// Failed saves remain pending and retry automatically without needing another gameplay action.
await B.ctx.setOffline(true);
await edit(B, 'Retry after reconnect'); await sleep(2500);
await B.ctx.setOffline(false);
await B.evaluate(() => window.dispatchEvent(new Event('online')));
check('a failed save is retried on reconnect', await until(async () => await motto() === 'Retry after reconnect', 20000));
await saved(B);

// The read of the latest record must not overwrite actions made while that read was in flight.
const snapshot = await B.evaluate(async uid => (await (await window.claude.use('db')).doc('nations/' + uid).get()).data(), uid);
await edit(A, 'Newer revision'); await saved(A);
const rejected = await B.evaluate(async ([uid, n]) => {
  try { await (await window.claude.use('db')).doc('nations/' + uid).set(n); return 'saved'; }
  catch (e) { return e.code; }
}, [uid, snapshot]);
check('the adapter rejects an explicitly stale revision', rejected === 'save_conflict');
check('the rejected transaction changes neither half of the nation', await motto() === 'Newer revision');

// Simultaneous writers must publish exactly one coherent shared/private pair.
await sleep(1600);
const base = await A.evaluate(async uid => (await (await window.claude.use('db')).doc('nations/' + uid).get()).data(), uid);
const compete = (p, label, freq) => p.evaluate(async ([uid, n, label, freq]) => {
  n.motto = label; n.freq = freq; n.updatedAt = Date.now();
  try { await (await window.claude.use('db')).doc('nations/' + uid).set(n); return label; }
  catch (e) { return e.code; }
}, [uid, base, label, freq]);
const race = await Promise.all([compete(A, 'Desktop transaction', 60), compete(B, 'Phone transaction', 240)]);
check('exactly one of two simultaneous saves succeeds', race.filter(x => x === 'save_conflict').length === 1, race.join(', '));
const final = (await nationDoc(uid)).rec;
check('shared and private data belong to the same winning save', final.motto === 'Desktop transaction' ? final.freq === 60 : final.motto === 'Phone transaction' && final.freq === 240);
check('a raced save advances the revision only once', await rev() === base._rev + 1);

const C = await player('different account'); await open(C);
const foreign = await C.evaluate(async ([uid, n]) => {
  try { await (await window.claude.use('db')).doc('nations/' + uid).set(n); return 'saved'; }
  catch (e) { return e.code; }
}, [uid, base]);
check('another account is refused as unauthorized rather than a save conflict', foreign === 'not_granted');

await finish();
