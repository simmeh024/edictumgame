// Two independent browser profiles sharing one account, against the local emulators.
import {
  check, finish, sleep, until, player, open, ready, found, nav, localNation,
  nationDoc, restGet, clearEmulators, openAccount, errors, OUT
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
const status = p => p.locator('.side-foot .ed-sync').textContent();
check('a confirmed nation shows Synced on both devices', await until(async () => await status(A) === 'Synced' && await status(B) === 'Synced'));
check('the indicator politely announces status changes', await A.locator('.ed-sync').getAttribute('role') === 'status' && await A.locator('.ed-sync').getAttribute('aria-live') === 'polite');
await A.locator('.ed-acct').screenshot({ path: OUT + '/sync-synced-desktop.png' });

// Hold a real commit in flight: connectivity alone must never produce a Synced label.
let releaseSave, commitWaiting = false;
const saveGate = new Promise(resolve => { releaseSave = resolve; });
const holdCommit = async route => {
  if (!(route.request().postData() || '').includes('"update"')) return route.continue();
  commitWaiting = true; await saveGate; await route.continue();
};
await A.ctx.route(/\/documents:commit/, holdCommit);
await edit(A, 'Saved on desktop');
check('an unacknowledged save shows Saving', await until(() => commitWaiting) && await status(A) === 'Saving');
await A.locator('.ed-acct').screenshot({ path: OUT + '/sync-saving-desktop.png' });
releaseSave(); await saved(A);
await A.ctx.unroute(/\/documents:commit/, holdCommit);
check('Saving becomes Synced only after the commit succeeds', await until(async () => await status(A) === 'Synced'));
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
check('a connection drop immediately shows Offline even without pending changes', await until(async () => await status(B) === 'Offline'));
await edit(B, 'Unsaved phone edit');
check('editing offline never claims the change is synced', await status(B) === 'Offline');
await B.locator('.ed-acct').screenshot({ path: OUT + '/sync-offline-phone.png' });
await sleep(2500);
await edit(A, 'Desktop wins the race'); await saved(A);
const winningRevision = await rev();
await B.ctx.setOffline(false);
await B.evaluate(() => window.dispatchEvent(new Event('online')));
check('an offline stale device loads the winning save', await until(async () => (await localNation(B)).motto === 'Desktop wins the race', 20000));
check('the stale edit never overwrites the cloud', await motto() === 'Desktop wins the race' && await rev() === winningRevision);
check('conflict recovery shows Synced after loading the server save', await until(async () => await status(B) === 'Synced'));
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
check('reconnecting shows Synced after retrying the pending change', await until(async () => await status(B) === 'Synced'));

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

// Keep a desktop tab active at the real save interval. Accelerated test intervals hid the first
// save waiting a full minute: switching away on a phone flushes the same queue much sooner.
const D = await player('desktop production timing', { saveGap: 60000 }); await open(D);
const uidD = await ready(D);
await found(D, 'Desktopland');
check('the first desktop save does not wait the production background interval', await until(async () => {
  const n = await localNation(D);
  return n && n._rev > 0 && !n._dirty && await status(D) === 'Synced' && !!await nationDoc(uidD);
}, 8000));

// Reopening a browser with unsent local changes must send its first pending save promptly too.
await D.ctx.setOffline(true);
await edit(D, 'Recovered desktop progress');
const desktopStorage = await D.ctx.storageState({ indexedDB: true });
await D.ctx.close();
const R = await player('returning desktop', { saveGap: 60000, storageState: desktopStorage }); await open(R);
// A restored IndexedDB session and a paced transaction retry can outlast eight seconds on CI.
// Use the existing save-settling bound, still far below the old sixty-second scheduling bug.
const returned = await until(async () => {
  const n = await localNation(R), cloud = await nationDoc(uidD);
  return n && !n._dirty && await status(R) === 'Synced' && cloud && cloud.rec.motto === 'Recovered desktop progress';
}, 15000);
check('returning desktop progress syncs without a minute on Saving', returned, returned ? '' : JSON.stringify({
  status: await status(R), local: await localNation(R), cloud: await nationDoc(uidD)
}));

await finish();
