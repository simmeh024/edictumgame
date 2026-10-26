// End-to-end tests of the built site on the Firebase emulators:
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/e2e.mjs"
// Covers: two players sharing a region and its message board, reloads, the security rules as
// the game meets them, admin moderation, browser-only mode when Firebase is blocked, export
// and import, and Google sign-in (linking, switching, signing out) with the Auth emulator's
// stand-in for Google. Set EDICTUM_FIXTURE=/path/to/a/nation.json to also import a real
// record exported from the claude.ai version.
import fs from 'node:fs';
import path from 'node:path';
import {
  BASE, OUT, check, finish, sleep, until, player, open, ready, found, nav, text, sideName, localNation,
  restGet, restPatch, nationDoc, clearEmulators, setClaims, googlePopup, openAccount, errors
} from './lib.mjs';

await clearEmulators();
const t0 = Date.now();

/* ── 1. two players in one region ───────────────────────────────────────── */
const A = await player('A');
const uidA = await open(A);
check('A gets an anonymous account at once', typeof uidA === 'string' && uidA.length > 10, uidA);
await found(A, 'Aldoria');
const docA = await until(() => nationDoc(uidA));
check('A’s nation is saved to nations/<uid> in the stored shape', docA && docA.v === 1 && docA.name === 'Aldoria' && docA.rec && docA.rec.name === 'Aldoria' && docA.keys.join() === 'j,name,reg,updatedAt,v', docA && docA.keys.join());
check('the mode line says the region is connected', /Connected to/.test(await text(A, '.mode.world')));

const B = await player('B');
const uidB = await open(B);
await found(B, 'Borvia');
check('B is a different player', uidB && uidB !== uidA);
await nav(A, 'region'); await nav(B, 'region');
const regionA = await until(async () => { const t = await text(A, '.tbl'); return /Aldoria/.test(t) && /Borvia/.test(t) ? t : ''; });
const regionB = await until(async () => { const t = await text(B, '.tbl'); return /Aldoria/.test(t) && /Borvia/.test(t) ? t : ''; });
check('A’s Region page lists both nations', !!regionA);
check('B’s Region page lists both nations', !!regionB);

/* ── 2. the region message board ────────────────────────────────────────── */
await A.fill('#rmb-text', 'Greetings from Aldoria');
await A.click('#rmb-form button[type="submit"]');
check('B sees A’s post on the board', await until(async () => /Greetings from Aldoria/.test(await text(B, '.posts'))));
const rmbA = await restGet('rmb/' + uidA);
check('the post is stored in rmb/<uid>', rmbA.status === 200 && JSON.stringify(rmbA.body).includes('Greetings from Aldoria'));

/* ── 3. reloads ─────────────────────────────────────────────────────────── */
await A.reload(); const uidA2 = await ready(A);
check('a reload keeps the same anonymous account', uidA2 === uidA);
check('a reload keeps the nation', await until(async () => (await sideName(A)) === 'Aldoria'));
await A.evaluate(() => localStorage.removeItem('statehood.nation.v1'));
await A.reload(); await ready(A);
check('with this browser’s copy gone, the nation comes back from Firestore', await until(async () => (await sideName(A)) === 'Aldoria', 10000));

/* ── 4. the rules, as the game meets them ───────────────────────────────── */
const tryWrite = (p, path, data) => p.evaluate(async ([path, data]) => {
  const db = await window.claude.use('db');
  try { await db.doc(path).set(data); return 'ok'; } catch (e) { return e.code; }
}, [path, data]);
check('A cannot write B’s nation (code not_granted)', (await tryWrite(A, 'nations/' + uidB, { name: 'Stolen', s: {} })) === 'not_granted');
check('A cannot write B’s board (code not_granted)', (await tryWrite(A, 'rmb/' + uidB, { posts: [] })) === 'not_granted');
check('a 41-post board is refused (code not_granted)', (await tryWrite(A, 'rmb/' + uidA, { posts: Array.from({ length: 41 }, (_, i) => ({ id: 'x' + i, t: i, x: 'x', r: 'meridian' })) })) === 'not_granted');
const anonRead = await restGet('nations/' + uidB);
check('a visitor who is not signed in can read a nation', anonRead.status === 200);
check('a visitor who is not signed in cannot write one', (await restPatch('nations/' + uidB, { name: { stringValue: 'x' } })) === 403);
check('B’s nation is unchanged', (await nationDoc(uidB)).name === 'Borvia');

/* ── 5. an admin moderates the board ────────────────────────────────────── */
await B.fill('#rmb-text', 'A rude remark from Borvia');
await B.click('#rmb-form button[type="submit"]');
await until(async () => /rude remark/.test(await text(A, '.posts')));
check('before the claim, A has no Remove button on B’s post', !(await A.$(`.posts [data-act="del-post"][data-a="${uidB}"]`)));
check('the admin claim is set (Auth emulator)', (await setClaims(uidA, { admin: true })) === 200);
await A.evaluate(() => firebase.auth().currentUser.getIdToken(true)); // an admin signs out and in; a forced refresh does the same here
await A.reload(); await ready(A);
check('user.isOwner() is true with the claim', await A.evaluate(() => window.claude.use('user').then(u => u.isOwner())));
await nav(A, 'region');
const del = await until(() => A.$(`.posts [data-act="del-post"][data-a="${uidB}"]`));
check('the admin sees Remove on B’s post', !!del);
if (del) await del.click();
check('the admin removed B’s post from rmb/<uidB>', await until(async () => !JSON.stringify((await restGet('rmb/' + uidB)).body).includes('rude remark')));
check('B no longer sees the removed post', await until(async () => !/rude remark/.test(await text(B, '.posts'))));
check('B still sees A’s post', /Greetings from Aldoria/.test(await text(B, '.posts')));

/* ── 6. Firebase blocked: browser-only mode ─────────────────────────────── */
const C = await player('C', { block: /\/vendor\/firebase\/|\/__\/firebase\//, inject: false });
const uidC = await open(C);
check('with Firebase blocked, use() resolves null', uidC === null);
await found(C, 'Cornmarsh');
check('the game plays in this browser only', /Offline/.test(await text(C, '.side-foot .mode')));
check('the account control offers export and import', /Saved in this browser/.test(await text(C, '.ed-acct-b')));
await C.reload(); await ready(C);
check('the local nation survives a reload', (await sideName(C)) === 'Cornmarsh');

/* ── 7. no injected config: init.json and the local emulators are found on their own ── */
const D0 = await player('D0', { inject: false });
check('the Hosting emulator’s init.json plus a demo project id reach the emulators', typeof (await open(D0)) === 'string');
await D0.ctx.close();

/* ── 8. export and import ───────────────────────────────────────────────── */
await openAccount(A);
const [dl] = await Promise.all([A.waitForEvent('download'), A.click('[data-ed="export"]')]);
const file = path.join(OUT, dl.suggestedFilename());
await dl.saveAs(file);
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
check('Export my nation downloads the nation as JSON', exported.name === 'Aldoria' && /^aldoria-\d{4}-\d\d-\d\d\.edictum\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await A.keyboard.press('Escape');

const D = await player('D');
const uidD = await open(D);
await openAccount(D);
const bad = path.join(OUT, 'not-a-nation.json');
fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
await D.setInputFiles('dialog.ed-dlg .ed-file', bad);
check('a file with no nation in it is refused before anything changes', await until(async () => /holds no nation/.test(await text(D, '.ed-msg'))));
const fixture = process.env.EDICTUM_FIXTURE;
const importFile = fixture && fs.existsSync(fixture) ? fixture : file;
const importName = JSON.parse(fs.readFileSync(importFile, 'utf8')).name;
await D.setInputFiles('dialog.ed-dlg .ed-file', importFile);
await D.waitForSelector('[data-ed="import-yes"]');
check('the import asks first', (await text(D, '#ed-dlg-h')).includes(importName));
await Promise.all([D.waitForNavigation(), D.click('[data-ed="import-yes"]')]);
await ready(D);
check('after the reload the imported nation is played', await until(async () => (await sideName(D)) === importName));
check('a message confirms the import', /Imported/.test(await text(D, '.ed-toast')));
const docD = await until(async () => { const d = await nationDoc(uidD); return d && d.name === importName ? d : null; }, 10000);
check('the imported nation is saved to the importer’s own nations/<uid>' + (fixture ? ' (real claude.ai record, nested arrays and all)' : ''), !!docD);
// the game's normaliser refusing a record: what was there before comes back
const before = await D.evaluate(() => localStorage.getItem('statehood.nation.v1'));
await D.evaluate(prev => {
  sessionStorage.setItem('edictum.import', JSON.stringify({ name: 'Nowhere', t: Date.now(), prev, prevBackup: null }));
  localStorage.setItem('statehood.nation.v1', JSON.stringify({ name: '   ', s: {} }));
}, before);
await D.reload(); // the shim sees the founding screen, puts the old record back and reloads once more
check('a record the game refuses is rolled back, and the player is told', await until(async () => /could not be read/.test(await text(D, '.ed-toast')), 15000) && await until(async () => (await sideName(D)) === importName));

/* ── 9. Google sign-in (Auth emulator) ──────────────────────────────────── */
// a. A guest with a nation links Google: same uid
await openAccount(A);
await googlePopup(A, '[data-ed="google"]', 'alice@example.com');
check('linking keeps the guest’s uid', await until(async () => (await ready(A)) === uidA));
check('the control shows the Google account', await until(async () => /alice@example\.com/.test(await text(A, '.ed-acct-b'))));
check('the dialog says the nation is kept with the account', /Linked/.test(await text(A, '.ed-msg')));
await A.keyboard.press('Escape');

// b. a new device signs in to that account from the founding screen
const E = await player('E');
const uidE0 = await open(E);
check('the founding screen has a sign-in control', /Sign in/.test(await text(E, '.found-head .ed-acct-b')));
await openAccount(E);
await Promise.all([E.waitForNavigation({ timeout: 15000 }), googlePopup(E, '[data-ed="google"]', 'alice@example.com')]);
const uidE = await ready(E);
check('the second device is now A’s account', uidE === uidA && uidE0 !== uidA);
check('and plays A’s nation', await until(async () => (await sideName(E)) === 'Aldoria'));

// c. a guest with a nation switches to an account that has one: the guest nation is dissolved
const F = await player('F');
const uidF0 = await open(F);
await found(F, 'Fenwick');
await until(() => nationDoc(uidF0));
await openAccount(F);
await googlePopup(F, '[data-ed="google"]', 'alice@example.com');
await F.waitForSelector('[data-ed="switch"]');
check('switching asks first', /Switch to that Google account/.test(await text(F, '#ed-dlg-h')));
await Promise.all([F.waitForNavigation({ timeout: 15000 }), F.click('[data-ed="switch"]')]);
check('after switching, F plays A’s nation', (await ready(F)) === uidA && await until(async () => (await sideName(F)) === 'Aldoria'));
check('the guest nation left the region', (await restGet('nations/' + uidF0)).status === 404);
await openAccount(F);
check('this browser keeps a copy of the guest nation to download', /Fenwick/.test(await text(F, '.ed-sec')));
await F.keyboard.press('Escape');

// d. a guest with a nation switches to an account without one: the nation moves into it
const G = await player('G');
await open(G);
await openAccount(G);
await googlePopup(G, '[data-ed="google"]', 'bob@example.com'); // bob: an account with no nation
const uidBob = await until(async () => { const t = await text(G, '.ed-acct-b'); return /bob@example/.test(t) ? ready(G) : null; });
await G.ctx.close();
const H = await player('H');
const uidH0 = await open(H);
await found(H, 'Hollin');
await until(() => nationDoc(uidH0));
await openAccount(H);
await googlePopup(H, '[data-ed="google"]', 'bob@example.com');
await H.waitForSelector('[data-ed="switch"]');
await Promise.all([H.waitForNavigation({ timeout: 15000 }), H.click('[data-ed="switch"]')]);
check('H is now bob’s account', (await ready(H)) === uidBob);
check('Hollin moved into bob’s account', await until(async () => (await sideName(H)) === 'Hollin') && await until(async () => ((await nationDoc(uidBob)) || {}).name === 'Hollin', 10000));
check('and left its guest account', (await restGet('nations/' + uidH0)).status === 404);

// e. signing out: a fresh guest, the nation stays with the account
await openAccount(E);
await E.click('[data-ed="signout"]');
check('signing out asks first', /Sign out\?/.test(await text(E, '#ed-dlg-h')));
await Promise.all([E.waitForNavigation({ timeout: 15000 }), E.click('[data-ed="signout-yes"]')]);
const uidE2 = await ready(E);
check('after signing out, the browser is a new guest', uidE2 && uidE2 !== uidA);
check('on the founding screen, with no nation in this browser', !!(await E.$('#d-name')) && !(await localNation(E)));
check('the account’s nation is still in the region', ((await nationDoc(uidA)) || {}).name === 'Aldoria');

/* ── 10. how it looks ───────────────────────────────────────────────────── */
for (const [vp, dark] of [[{ width: 1280, height: 900 }, false], [{ width: 390, height: 844 }, true]]) {
  const S = await player('S' + vp.width, { vp, dark });
  await open(S);
  await S.screenshot({ path: path.join(OUT, `found-${vp.width}.png`) });
  await found(S, 'Shotland');
  const box = await S.$('.ed-acct');
  await box.scrollIntoViewIfNeeded();
  await S.screenshot({ path: path.join(OUT, `control-${vp.width}.png`) });
  await openAccount(S);
  await S.screenshot({ path: path.join(OUT, `dialog-${vp.width}.png`) });
  check(`no sideways scroll with the dialog open at ${vp.width}`, (await S.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await S.ctx.close();
}

console.log('elapsed', Math.round((Date.now() - t0) / 1000) + 's', 'screenshots and files in', OUT, errors.length ? '' : '');
await finish();
