// Two independent browser profiles sharing one account, against the local emulators.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check, finish, sleep, until, player, open, ready, found, nav, localNation,
  nationDoc, restGet, clearEmulators, openAccount, errors, OUT, FS_HOST, PROJECT, BASE
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

// A tab in the background lets go of the region's listeners (quiet tabs) and catches up on its return.
const showing = (p, on) => p.evaluate(on => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !on });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => on ? 'visible' : 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, on);
await B.evaluate(() => { window.EDICTUM_QUIET_HIDDEN = 1000; });
await showing(B, false); await sleep(22000); // the quiet check runs every 20 seconds
await edit(A, 'Saved while the phone sleeps'); await saved(A); await sleep(5000);
check('a phone in the background no longer follows the region', (await localNation(B)).motto === 'Saved on phone');
await showing(B, true);
check('back in front, the phone catches up with the latest save', await until(async () => (await localNation(B)).motto === 'Saved while the phone sleeps', 15000));
await edit(A, 'Saved on desktop again'); await saved(A);
check('and follows the region again', await until(async () => (await localNation(B)).motto === 'Saved on desktop again', 15000));
await B.evaluate(() => { delete window.EDICTUM_QUIET_HIDDEN; });

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

// A refused save is replayed onto the other device's save: different changes are both kept.
await B.ctx.setOffline(true);
await nav(B, 'settings'); await B.fill('#s-about', 'Written on the phone');
await B.click('#settings-form button[type="submit"]');
await sleep(2500);
await edit(A, 'Desktop motto, phone about'); await saved(A);
const beforeMerge = await rev();
await B.evaluate(uid => localStorage.removeItem('edictum.unsaved.' + uid), uid);
await B.ctx.setOffline(false);
await B.evaluate(() => window.dispatchEvent(new Event('online')));
const merged = async () => { const r = (await nationDoc(uid)).rec; return r.motto === 'Desktop motto, phone about' && r.about === 'Written on the phone'; };
check('a refused save keeps both devices’ different changes', await until(merged, 20000), JSON.stringify((await nationDoc(uid)).rec.about));
check('the replayed save is one new revision', await rev() === beforeMerge + 1);
check('the desktop receives the replayed change', await until(async () => (await localNation(A)).about === 'Written on the phone', 15000));
check('nothing needed keeping aside after a clean replay', await B.evaluate(uid => localStorage.getItem('edictum.unsaved.' + uid), uid) === null);
await saved(B);

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
await found(D, 'Desktopland', {newPlayer:true});
// Use the same settling bound as the restored-session check below: Auth, the region gate and a
// paced Firestore retry can exceed eight seconds on CI. Fifteen still detects the old 60s delay.
const firstDesktop = await until(async () => {
  const n = await localNation(D);
  return n && n._rev > 0 && !n._dirty && await status(D) === 'Synced' && !!await nationDoc(uidD);
}, 15000);
check('the first desktop save does not wait the production background interval', firstDesktop, firstDesktop ? '' : JSON.stringify({
  status: await status(D), local: await localNation(D), cloud: await nationDoc(uidD)
}));

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

// A phone's listener can go quiet without an error (a connection that died while it slept), and the SDK's own
// reads share that connection. The page asks the server for its revision alone now and then, and loads what it missed.
await B.addInitScript(() => { window.EDICTUM_OWN_CHECK = Number(sessionStorage.getItem('test.ownCheck')) || 2000; window.EDICTUM_VERSION_AWAY = 0; window.EDICTUM_VERSION_MIN = 0; });
const stall = route => route.abort();
let revisionAsks = 0;
const countRevision = route => { revisionAsks++; return route.continue(); };
await B.ctx.route(/\/Listen\/channel/, stall);
await B.ctx.route(/mask\.fieldPaths=rev/, countRevision);
await B.reload(); await B.waitForSelector('.layout'); await saved(B);
await edit(A, 'Heard without a listener'); await saved(A);
check('a phone whose listener is down still loads a save from the desktop', await until(async () => (await localNation(B)).motto === 'Heard without a listener', 20000));
check('it asked the server for its revision alone', revisionAsks > 0, String(revisionAsks));
// with the listener working, its news stands in for the question (asked at most every 15 seconds here)
await B.ctx.unroute(/\/Listen\/channel/, stall);
// the SDK's warning about the connection this test cut on purpose
for (let i = errors.length - 1; i >= 0; i--) if (/^phone console: .*Could not reach Cloud Firestore backend/s.test(errors[i])) errors.splice(i, 1);
await B.evaluate(() => sessionStorage.setItem('test.ownCheck', '15000'));
await B.reload(); await B.waitForSelector('.layout'); await saved(B);
const asked = revisionAsks;
await edit(A, 'Heard by the listener'); await saved(A);
const heard = await until(async () => (await localNation(B)).motto === 'Heard by the listener', 10000);
check('with the listener bringing news, the phone does not ask as well', heard && revisionAsks === asked, `${asked} → ${revisionAsks}`);
await B.ctx.unroute(/mask\.fieldPaths=rev/, countRevision);
await B.evaluate(() => sessionStorage.removeItem('test.ownCheck'));

// An open tab keeps the build it loaded. Coming back to it after a newer deploy, it saves and loads the new build,
// unless the player is writing something there.
const VERSION = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'version.json');
const built = fs.readFileSync(VERSION, 'utf8');
check('the page and /version.json carry the same build', await B.evaluate(async () => {
  const v = await (await fetch('/version.json', { cache: 'no-store' })).json();
  return /^[0-9a-f]{12}$/.test(v.b) && document.querySelector('meta[name="edictum-build"]').content === v.b;
}));
try {
  fs.writeFileSync(VERSION, JSON.stringify({ b: '0123456789ab' }) + '\n');
  await B.evaluate(() => { window.__sameLoad = true; });
  await nav(B, 'settings'); await B.fill('#s-motto', 'Half written on the phone');
  await showing(B, false); await sleep(300); await showing(B, true); await sleep(4000);
  check('a page with something half written is not reloaded', await B.evaluate(() => window.__sameLoad === true));
  check('it is told a new version is out instead', /new version of Edictum is out/.test((await B.locator('.ed-toast').allTextContents()).join(' ')));
  /* leaving with the motto half written asks first; this test leaves it unsaved */
  await nav(B, 'nation'); if (await B.$('[data-act="sg-leave-go"]')) { await B.click('[data-act="sg-leave-go"]'); await sleep(250); }
  await B.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'Sent before the reload'; G.commit(n); });
  const loaded = B.waitForEvent('load', { timeout: 30000 }).then(() => true, () => false);
  await showing(B, false); await sleep(300); await showing(B, true);
  check('coming back to an out-of-date page loads the new build', await loaded);
  await B.waitForSelector('.layout');
  check('the change waiting to be saved was sent first', await motto() === 'Sent before the reload');
  check('and the reloaded page says why', await until(async () => /updated while you were away/.test((await B.locator('.ed-toast').allTextContents()).join(' ')), 8000));
} finally { fs.writeFileSync(VERSION, built); }

// A device whose clock runs ahead counts more growth than the server's clock allows between saves seconds apart (rules:
// grows). Its saves must still be accepted: the headline population is held within the allowance (src/shim.js, popBase).
const F = await player('fast clock', { storageState: await A.ctx.storageState({ indexedDB: true }) });
await F.ctx.addInitScript(() => { const skew = 20 * 60000, N = Date.now; Date.now = () => N() + skew; const O = Date; window.Date = class extends O { constructor(...a) { if (a.length) super(...a); else super(N() + skew); } static now() { return N() + skew; } }; });
await open(F); await F.waitForSelector('.layout');
const before = await rev();
for (let i = 0; i < 4; i++) { await edit(F, 'Fast clock ' + i); await sleep(2500); }
check('a device with its clock 20 minutes ahead keeps saving every few seconds', await until(async () => await motto() === 'Fast clock 3', 25000) && await rev() >= before + 3, JSON.stringify(await F.evaluate(() => window.__edictum.saveHealth)));
check('and never turns view-only', await F.evaluate(() => G.S.mode) === 'world' && await F.evaluate(() => window.__edictum.saveHealth.error) !== 'not_granted');

/* ── save safety: an earlier visit's changes, more than one kept copy, a first read that fails, a nation dissolved
   on another device, and dissolving while a save is on its way ── */
const copies = p => p.evaluate(uid => { const o = JSON.parse(localStorage.getItem('edictum.unsaved.' + uid) || 'null'); return o ? [o].concat(o.prev || []).map(c => c.nation.motto) : []; }, uid);
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast, .ed-toast')].map(t => t.textContent).join(' | '));
const syncState = p => p.evaluate(() => window.__edictum.syncStatus);
const leaveWith = async (p, motto) => { await p.ctx.setOffline(true); await edit(p, motto); await sleep(1500); const st = await p.ctx.storageState({ indexedDB: true }); await p.ctx.close(); return st; };
await saved(B); await saved(A);
await B.evaluate(uid => localStorage.removeItem('edictum.unsaved.' + uid), uid);

// 18. a change from the last visit, sent on return, meets a save another device made meanwhile
const lastVisit = await leaveWith(B, 'Carried from the last visit');
const C2 = await player('returning phone', { vp: { width: 390, height: 844 }, storageState: lastVisit });
let releasePermit, permitHeld = false; const permitGate = new Promise(r => { releasePermit = r; });
const holdPermit = async route => { if (!permitHeld && route.request().postDataJSON()?.data?.op === 'authorizeSave') { permitHeld = true; await permitGate; } return route.continue(); };
await C2.ctx.route('**/europe-west1/civic', holdPermit);
await open(C2); await C2.waitForSelector('.layout');
check('a returning device sends the change its last visit left unsaved', await until(() => permitHeld, 15000));
await edit(A, 'Desktop saved meanwhile'); await saved(A);
releasePermit();
check('refused, it loads the other device’s save', await until(async () => (await localNation(C2))?.motto === 'Desktop saved meanwhile', 20000));
check('and keeps the last visit’s change as a copy instead of dropping it', (await copies(C2))[0] === 'Carried from the last visit', JSON.stringify(await copies(C2)));
check('and asks the player to repeat it', await until(async () => /repeat your unsaved changes/.test(await toasts(C2)), 10000));
await C2.ctx.unroute('**/europe-west1/civic', holdPermit);
await saved(C2);

// 19. a second conflict keeps its own copy beside the first
await C2.ctx.setOffline(true); await edit(C2, 'Second change kept aside'); await sleep(1500);
await edit(A, 'Desktop saved again'); await saved(A);
await C2.ctx.setOffline(false); await C2.evaluate(() => window.dispatchEvent(new Event('online')));
check('a second conflict loads the other save again', await until(async () => (await localNation(C2))?.motto === 'Desktop saved again', 20000));
check('and keeps its copy beside the first one, which is not lost', JSON.stringify(await copies(C2)) === JSON.stringify(['Second change kept aside', 'Carried from the last visit']), JSON.stringify(await copies(C2)));
await saved(C2);

// 20. the first read on return fails; a newer save from another device then arrives
const failedRead = await leaveWith(C2, 'Kept through a failed first read');
await edit(A, 'Desktop saved while the phone was away'); await saved(A);
const C3 = await player('returning phone 2', { vp: { width: 390, height: 844 }, storageState: failedRead });
let failReads = true; const failRead = route => failReads ? route.abort() : route.continue();
await C3.ctx.route(/documents:batchGet/, failRead);
await open(C3); await C3.waitForSelector('.layout'); await sleep(15000); // past the SDK's own retries of that read
failReads = false; await C3.evaluate(() => window.dispatchEvent(new Event('focus')));
check('after a failed first read, the newer save is loaded', await until(async () => (await localNation(C3))?.motto === 'Desktop saved while the phone was away', 30000));
check('but the change it would replace is kept as a copy, and the player told', (await copies(C3)).includes('Kept through a failed first read') && await until(async () => /repeat your unsaved changes/.test(await toasts(C3)), 10000), JSON.stringify(await copies(C3)));
await C3.ctx.unroute(/documents:batchGet/, failRead);
await saved(C3);

// 16. dissolved on another device: the record is gone, as dissolving there leaves it
await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/nations/${uid}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
await edit(C3, 'Saved after the dissolve');
check('a save refused for a nation dissolved on another device lets it go', await until(async () => !(await localNation(C3)) && await C3.isVisible('#d-name'), 20000));
check('and says so, keeping a copy of it', await until(async () => /dissolved on another device/.test(await toasts(C3)), 10000) && (await copies(C3))[0] === 'Saved after the dissolve');
check('it no longer says Saving', await until(async () => await syncState(C3) === 'synced', 10000), await syncState(C3));
check('and signing out is allowed', await C3.evaluate(async () => { try { await window.__edictum.beforeSignOut(); return true; } catch (e) { return e.message; } }) === true);

// 17. dissolving while a save is on its way
await found(C3, 'Secondland'); await saved(C3);
let releaseCommit, commitHeld = false; const commitGate = new Promise(r => { releaseCommit = r; });
const holdUpdate = async route => { if (!commitHeld && (route.request().postData() || '').includes('"update"')) { commitHeld = true; await commitGate; } return route.continue(); };
await C3.ctx.route(/\/documents:commit/, holdUpdate);
await edit(C3, 'A save still on its way');
check('a save is on its way', await until(() => commitHeld, 15000));
await nav(C3, 'settings'); await C3.click('#sg-tab-account'); await C3.click('[data-act="dissolve-ask"]');
await C3.fill('#dz-type', 'Secondland'); await C3.click('[data-act="dissolve-confirm"]');
await sleep(500); releaseCommit(); await sleep(6000);
check('dissolving while a save is on its way does not bring the nation back', !(await localNation(C3)) && await C3.isVisible('#d-name') && (await restGet('nations/' + uid)).status === 404, JSON.stringify({ local: (await localNation(C3))?.name, cloud: (await restGet('nations/' + uid)).status }));
await C3.ctx.unroute(/\/documents:commit/, holdUpdate);

// 21. two tabs in one browser share one copy of the nation: the newest plays, the other stops and can take over
await found(C3, 'Tabsworth'); await saved(C3);
const T2 = await C3.ctx.newPage();
T2.on('pageerror', e => errors.push('second tab PAGEERROR ' + e.message));
await T2.goto(BASE + '/'); await T2.waitForSelector('.layout', { timeout: 20000 });
check('opening a second tab stops the first', await until(() => C3.isVisible('.tab-yield'), 10000) && /open in another tab/.test(await C3.locator('.tab-yield').textContent()));
let stoppedSaves = 0;
const countStopped = r => { if (/europe-west1\/civic/.test(r.url()) && /authorizeSave/.test(r.postData() || '')) stoppedSaves++; };
C3.on('request', countStopped);
await C3.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'From the stopped tab'; G.commit(n); });
await edit(T2, 'From the newest tab'); await saved(T2);
await sleep(3000);
check('the stopped tab neither changes nor saves the nation', (await localNation(T2)).motto === 'From the newest tab' && await C3.evaluate(() => G.S.nation.motto) !== 'From the stopped tab' && stoppedSaves === 0 && await motto() === 'From the newest tab', JSON.stringify({ stoppedSaves, cloud: await motto() }));
C3.off('request', countStopped);
/* two tabs loading at once each see the other's claim: only a newer one than its own stops a tab */
await T2.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'edictum.tab', newValue: JSON.stringify({ id: 'an-older-tab', at: 1 }) })));
await sleep(500);
check('an older claim arriving late stops nothing', !(await T2.isVisible('.tab-yield')));
/* the busy-region check below wants short retry steps: the reload "Play here" makes takes them up */
await C3.ctx.addInitScript(() => { window.EDICTUM_SAVE_RETRY = [1000, 2000, 3000, 4000]; });
await Promise.all([C3.waitForNavigation({ timeout: 20000 }), C3.click('.tab-yield button')]);
await C3.waitForSelector('.layout', { timeout: 20000 });
check('“Play here” takes over with the other tab’s latest', await until(() => T2.isVisible('.tab-yield'), 10000) && await C3.evaluate(() => G.S.nation.motto) === 'From the newest tab');
await T2.close();

// 22. a busy region (a rate limit, HTTP 429): tried again at growing gaps, and never called full
const busyAt = [];
const busy = route => {
  if (!(route.request().postData() || '').includes('authorizeSave')) return route.continue();
  busyAt.push(Date.now());
  return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' } }) });
};
await C3.route('**/europe-west1/civic', busy);
await edit(C3, 'Sent once the region has room');
/* the tab coming back into focus (resumeNation) while the region is busy waits for the retry step too */
await until(() => busyAt.length >= 1, 15000); await sleep(100);
await C3.evaluate(() => window.dispatchEvent(new Event('focus')));
const gaps = () => busyAt.slice(1).map((t, i) => t - busyAt[i]);
check('a rate-limited save is tried again at growing gaps', await until(() => busyAt.length >= 3, 20000) && gaps()[0] >= 900 && gaps()[1] >= 1900, JSON.stringify(gaps()));
/* the notice comes with the third refusal, and toasts show one at a time: an achievement the edit earned (with a new
   rank, a long toast of eight seconds or more) can stand before it */
check('the player hears the region is busy, not that its storage is full', await until(async () => /region is busy/.test(await toasts(C3)), 40000) && !/storage is full/.test(await toasts(C3)), await toasts(C3));
await C3.unroute('**/europe-west1/civic', busy);
check('and the save lands once the region has room', await until(async () => await motto() === 'Sent once the region has room', 20000));


// the SDK's warnings about the connections these scenarios cut on purpose (offline devices, failed reads)
for (let i = errors.length - 1; i >= 0; i--) if (/^returning phone( 2)? console: /.test(errors[i]) && /Could not reach Cloud Firestore backend|@firebase\/firestore|Failed to fetch|ERR_|network/i.test(errors[i])) errors.splice(i, 1);


await finish();
