// Signing in with an email link or with Discord, on the emulators: linking keeps a guest's uid and makes it a
// Registered Nation with the first-link gift, another browser signs in to that account, a guest with a nation
// switches to it, and deleting the account frees its Discord account. Email links come from the Auth emulator's
// outbox; Discord is functions/discord.js's emulator stand-in (window.EDICTUM_DISCORD_EMU).
import path from 'node:path';
import { BASE, OUT, AUTH_HOST, PROJECT, check, finish, until, player, open, ready, found, openAccount, text, sideName, localNation, nationDoc, restGet,
  restList, restListAdmin, accountExists, clearEmulators, nav } from './lib.mjs';

await clearEmulators();
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const heading = p => text(p, '#ed-dlg-h');
const registered = p => until(() => p.evaluate(() => G.S.civic?.account.kind === 'registered'), 15000);
const gift = p => until(async () => (await localNation(p))?.glk === 1, 15000);
// the newest sign-in link the Auth emulator "sent" to an address, as this site's address
async function emailLink(email) {
  const r = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const codes = ((await r.json()).oobCodes || []).filter(c => c.email === email && c.requestType === 'EMAIL_SIGNIN');
  return codes.length ? BASE + '/' + new URL(codes[codes.length - 1].oobLink).search : null;
}
// whether any account holds this address (the Auth emulator's admin lookup)
async function emailHasAccount(email) {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ email: [email] })
  });
  return ((await r.json().catch(() => ({}))).users || []).length > 0;
}
// A guest's first save brings the recovery-code dialog once; dismiss it before using the account dialog, which
// it would otherwise replace mid-step.
async function founded(p, name) {
  const uid = await ready(p);
  await found(p, name);
  await until(() => nationDoc(uid));
  if (await p.waitForSelector('[data-ed="recovery-saved"]', { timeout: 15000 }).catch(() => null))
    await p.evaluate(() => document.querySelector('[data-ed="recovery-saved"]')?.click());
  await until(async () => !(await p.isVisible('dialog.ed-dlg[open]')), 5000);
}
async function sendLink(p, email) {
  if (!(await p.isVisible('#ed-email'))) {
    if (!(await p.isVisible('dialog.ed-dlg[open]'))) await openAccount(p);
    await p.click('[data-ed="email"]');
  }
  await p.fill('#ed-email', email);
  await p.press('#ed-email', 'Enter');
  return until(async () => /Open the link we sent/.test(await heading(p)) && emailLink(email));
}
async function discordPopup(p, id, name, click = '[data-ed="discord"]') {
  await p.evaluate(([id, name]) => { window.EDICTUM_DISCORD_EMU = { id, name }; }, [id, name]);
  /* once more if the guest's recovery-code dialog took the account dialog's place */
  for (let attempt = 0; ; attempt++) {
    try {
      const [pop] = await Promise.all([p.waitForEvent('popup', { timeout: 15000 }), p.click(click, { timeout: 15000 })]);
      await pop.waitForEvent('close', { timeout: 15000 }).catch(() => {});
      return;
    } catch (e) {
      if (attempt) {
        await p.screenshot({ path: path.join(OUT, 'signin-' + p.tag + '.png') }).catch(() => {});
        console.log('no Discord window for ' + p.tag + ': ' + JSON.stringify(await p.evaluate(() => ({ h: document.querySelector('#ed-dlg-h')?.textContent, m: document.querySelector('.ed-msg')?.textContent })).catch(() => null)));
        throw e;
      }
      if (!(await p.isVisible('dialog.ed-dlg[open]'))) await openAccount(p);
    }
  }
}

/* ── 1. a guest with a nation links an email address ───────────────────────── */
const A = await player('A');
const uidA = await open(A);
await founded(A, 'Avalon');
await openAccount(A);
check('a guest is offered Google, Discord and email', await A.isVisible('[data-ed="google"]') && await A.isVisible('[data-ed="discord"]') && await A.isVisible('[data-ed="email"]'));
const linkA = await sendLink(A, 'ava@example.com');
check('the link is on its way', !!linkA && /ava@example\.com/.test(await text(A, 'dialog.ed-dlg')));
await A.goto(linkA);
check('opening it keeps the guest’s uid', await until(async () => (await ready(A)) === uidA));
check('and takes the code out of the address bar', await until(() => !/oobCode/.test(A.url())));
check('the control shows the address', await until(async () => /ava@example\.com/.test(await text(A, '.ed-acct-b')), 15000));
check('the nation is now a Registered Nation', await registered(A));
check('linking pays the first-link gift', await gift(A));
check('and says so', await until(async () => /kept with your linked sign-in\. \+10 land credits/.test(await toasts(A)), 20000));

/* ── 2. another browser: asked for the address, then signs in to that account ── */
const B = await player('B');
await open(B);
await openAccount(B);
await B.click('[data-ed="email"]');
check('a guest without a nation is offered sign-in by email', /Sign in with email/.test(await heading(B)));
const linkB = await sendLink(B, 'ava@example.com');
const C = await player('C');
const uidC0 = await open(C);
await C.goto(linkB);
await C.waitForSelector('#ed-email[data-enter="email-finish"]', { timeout: 15000 });
check('a link opened in another browser asks which address it was sent to', /Which address/.test(await heading(C)));
await C.fill('#ed-email', 'ava@example.com');
await Promise.all([C.waitForNavigation({ timeout: 15000 }), C.click('[data-ed="email-finish"]')]);
check('and then plays that account’s nation', (await ready(C)) === uidA && uidC0 !== uidA && await until(async () => (await sideName(C)) === 'Avalon'));

/* ── 3. a guest with a nation links an address that has an account: switching asks first ── */
const D = await player('D');
const uidD0 = await open(D);
await founded(D, 'Dunmore');
const firstD = await sendLink(D, 'ava@example.com');
await D.goto(firstD);
await D.waitForSelector('[data-ed="switch"]', { timeout: 15000 });
check('switching asks first', /Switch to that email address/.test(await heading(D)));
const switched = D.waitForNavigation({ timeout: 15000 }).then(() => true, () => false);
await D.click('[data-ed="switch"]');
/* Firebase counts the attempt to link as the link's one use: then a fresh link is sent, and opening it switches */
if (!(await switched)) {
  check('a used-up link sends a fresh one at once', /Open the link we sent/.test(await heading(D)) && /sent a new one/.test(await text(D, '.ed-msg')));
  const secondD = await until(async () => { const l = await emailLink('ava@example.com'); return l !== firstD && l; });
  await D.goto(secondD); /* the page then reloads as that account */
}
check('after switching, D plays that account’s nation', await until(async () => (await ready(D)) === uidA, 20000) && await until(async () => (await sideName(D)) === 'Avalon'));
check('and the guest nation left the region', (await restGet('nations/' + uidD0)).status === 404 && (await restGet('summaries/' + uidD0)).status === 404);

/* ── 4. a guest with a nation links Discord ─────────────────────────────────── */
const DC = '700000000000000001';
const E = await player('E');
const uidE = await open(E);
await founded(E, 'Elmara');
await openAccount(E);
await discordPopup(E, DC, 'Dana');
check('linking Discord keeps the guest’s uid', await until(async () => (await ready(E)) === uidE));
check('the control shows the Discord name', await until(async () => /Dana/.test(await text(E, '.ed-acct-b')), 15000));
check('the account dialog lists the Discord sign-in', /Discord \(Dana\)/.test(await text(E, 'dialog.ed-dlg')) && !(await E.isVisible('[data-ed="discord"]')));
check('the nation is now a Registered Nation', await registered(E));
check('linking pays the first-link gift', await gift(E));
check('the server knows which account holds the Discord account', (await restListAdmin('discordLinks')).some(d => d.id === DC && d.fields.uid.stringValue === uidE));
check('and nobody else can read that', (await restGet('discordLinks/' + DC)).status === 403);

/* ── 5. another browser signs in with that Discord account ─────────────────── */
const F = await player('F');
await open(F);
await openAccount(F);
const signedIn = F.waitForNavigation({ timeout: 20000 });
await discordPopup(F, DC, 'Dana');
await signedIn;
check('a new browser signs in to the Discord account’s nation', (await ready(F)) === uidE && await until(async () => (await sideName(F)) === 'Elmara'));
check('and says so', await until(async () => /Signed in with Discord\. Welcome back to “Elmara”/.test(await toasts(F))));

/* ── 6. a guest with a nation asks first; a Registered Nation keeps its own ── */
const G2 = await player('G');
const uidG = await open(G2);
await founded(G2, 'Galwick');
await openAccount(G2);
await discordPopup(G2, DC, 'Dana');
check('switching to a Discord account asks first', await until(async () => /Switch to that Discord account/.test(await heading(G2))));
await G2.click('[data-ed="back"]');
check('cancelling keeps the guest', (await ready(G2)) === uidG);
await A.keyboard.press('Escape');
await openAccount(A);
await discordPopup(A, DC, 'Dana');
check('a Registered Nation is told the Discord account is someone else’s', await until(async () => /belongs to another Edictum account/.test(await text(A, '.ed-msg'))) && (await ready(A)) === uidA);

/* ── 7. deleting the account frees its Discord account ─────────────────────── */
await F.keyboard.press('Escape').catch(() => {});
await openAccount(F);
await F.click('[data-ed="delete"]');
await Promise.all([F.waitForNavigation({ timeout: 20000 }), F.click('[data-ed="delete-yes"]')]);
check('the account is deleted', await until(async () => !(await accountExists(uidE)), 10000));
check('and its Discord account is free again', !(await restListAdmin('discordLinks')).some(d => d.id === DC));
await G2.keyboard.press('Escape').catch(() => {});
await openAccount(G2);
await discordPopup(G2, DC, 'Dana');
check('so another nation can link it', await until(async () => /Dana/.test(await text(G2, '.ed-acct-b')), 15000) && (await ready(G2)) === uidG);

/* ── 8. a browser loses its sign-in but keeps a Registered Nation ──────────── */
// The browser's storage without Firebase's sign-in (IndexedDB, which storageState leaves out): what a browser
// keeps when its site data is partly cleared. It starts as a new guest.
const ORIGIN = new URL(BASE).origin;
async function withoutSignIn(p, edit) {
  await until(() => p.evaluate(() => window.__edictum.syncStatus === 'synced'), 15000);
  const state = await p.ctx.storageState();
  await p.ctx.close();
  const o = state.origins.find(x => x.origin === ORIGIN);
  o.localStorage = o.localStorage.filter(e => !e.name.startsWith('firebase:'));
  edit(o.localStorage);
  return state;
}
const harrowgates = async () => (await restList('nations')).filter(d => d.fields.name?.stringValue === 'Harrowgate').length;
const settled = async p => { for (let i = 0; i < 40; i++) { const uid = await ready(p).catch(() => null); if (uid) return uid; await new Promise(r => setTimeout(r, 250)); } return null; };
const H = await player('H');
const uidH = await open(H);
await founded(H, 'Harrowgate');
await H.goto(await sendLink(H, 'hal@example.com'));
check('H links an email address', await until(async () => /hal@example\.com/.test(await text(H, '.ed-acct-b')), 15000) && await registered(H));
const lost = await withoutSignIn(H, ls => {
  /* a change the game made just before the sign-in went, not yet saved */
  const e = ls.find(x => x.name === 'statehood.nation.v1'), n = JSON.parse(e.value);
  n.motto = 'Kept by this browser'; n._dirty = true; e.value = JSON.stringify(n);
});
const H2 = await player('H2', { storageState: lost });
await H2.goto(BASE + '/');
const uidH2 = await settled(H2);
check('the browser starts again as a new guest', !!uidH2 && uidH2 !== uidH);
check('without playing the nation as a second one', await until(() => H2.isVisible('#d-name'), 15000) && !(await localNation(H2)) && (await restGet('nations/' + uidH2)).status === 404 && await harrowgates() === 1);
check('and says why', await until(async () => /signed out of the account that holds “Harrowgate”/.test(await toasts(H2))));
check('the copy is kept for its account', await H2.evaluate(() => JSON.parse(localStorage.getItem('edictum.parked') || 'null')?.uid) === uidH);
await H2.goto(await sendLink(H2, 'hal@example.com'));
check('signing in again plays the nation', await until(async () => (await ready(H2).catch(() => null)) === uidH, 20000) && await until(async () => (await sideName(H2)) === 'Harrowgate', 15000));
check('with the change the browser kept', (await localNation(H2))?.motto === 'Kept by this browser' && await until(async () => (await nationDoc(uidH))?.rec?.motto === 'Kept by this browser', 15000));
check('and the region still has one Harrowgate', await harrowgates() === 1 && !(await H2.evaluate(() => localStorage.getItem('edictum.parked'))));

/* ── 9. a browser already playing such a copy as a guest (the game before this fix) ── */
// Without the account it belonged to, the copy carries on under the new guest, as it did then; its first save
// is refused, and the browser then finds the account by the nation's name and founding.
const stuck = await withoutSignIn(H2, ls => { const i = ls.findIndex(x => x.name === 'edictum.uid'); if (i >= 0) ls.splice(i, 1); });
const H3 = await player('H3', { storageState: stuck });
await H3.goto(BASE + '/');
const uidH3 = await settled(H3);
check('a stray copy is noticed and kept for its account', await until(async () => await H3.evaluate(() => JSON.parse(localStorage.getItem('edictum.parked') || 'null')?.uid).catch(() => null) === uidH, 20000));
check('the browser starts again as a guest, and says why', await until(() => H3.isVisible('#d-name'), 15000) && await until(async () => /signed out of the account that holds “Harrowgate”/.test(await toasts(H3))));
check('nothing was saved for the guest', !!uidH3 && uidH3 !== uidH && (await restGet('nations/' + uidH3)).status === 404 && await harrowgates() === 1);

/* ── 10. a guest nation carried into an account names the guest on its first save there ── */
// doSwitch notes {from, to} (edictum.carry); the first save under `to` (revision 0) sends `from`, so the server may
// let the record start as large as the guest's last save (functions/civic.js, createCap), and the note then goes.
const M = await player('M');
const uidM = await open(M);
const sent = [];
await M.route('**/europe-west1/civic', route => { const d = route.request().postDataJSON()?.data; if (d?.op === 'authorizeSave') sent.push({ rev: d.rev, from: d.from }); route.continue(); });
await M.evaluate(([to]) => localStorage.setItem('edictum.carry', JSON.stringify({ from: 'guest-carried-from', to, at: Date.now() })), [uidM]);
await founded(M, 'Movingham');
check('the first save of a carried nation names the guest it came from', await until(() => sent.some(x => x.rev === 0)) && sent.find(x => x.rev === 0).from === 'guest-carried-from', JSON.stringify(sent));
check('and the note goes once it is saved', await until(() => M.evaluate(() => localStorage.getItem('edictum.carry') === null)));
await M.evaluate(() => { const n = G.clone(G.S.nation); n.motto = 'Settled in'; G.commit(n); });
check('later saves name nobody', await until(() => sent.some(x => x.rev > 0), 30000) && sent.filter(x => x.rev > 0).every(x => x.from === undefined), JSON.stringify(sent));


/* ── 11. no save can go from here (view-only): signing out keeps the latest changes in this browser ── */
// Sign-out waits for the latest changes to be saved; with view-only access (or a region closed for maintenance) none
// can be, so it used to be refused for good. Now the copy goes with the account, offered in its account menu.
/* once the saves above have landed: one landing later would mark this change as saved */
await until(() => M.evaluate(() => window.__edictum.syncStatus === 'synced'), 20000);
await M.evaluate(() => { G.S.mode = 'readonly'; const n = G.clone(G.S.nation); n.motto = 'Kept for later'; G.commit(n); });
check('in view-only mode a change waits, unsent', (await localNation(M))?._dirty === true && (await localNation(M))?.motto === 'Kept for later');
await openAccount(M);
await M.click('[data-ed="signout"]');
await M.check('#ed-guest-code-saved');
await M.click('[data-ed="signout-yes"]');
check('signing out is allowed', await until(async () => { const u = await ready(M).catch(() => null); return !!u && u !== uidM; }, 35000), await text(M, '.ed-msg'));
check('and says the latest changes are kept in this browser', await until(async () => /kept in this browser/.test(await toasts(M)), 15000), await toasts(M));
check('the copy is kept for that account', await M.evaluate(u => JSON.parse(localStorage.getItem('edictum.unsaved.' + u) || 'null')?.nation?.motto, uidM) === 'Kept for later');

/* ── 12. a nation founded in this browser after signing out carries on ──────── */
// Signed out with no connection, the browser has no account to start a new guest with; a nation founded then holds no
// revision (no save carried it), and the next load with a connection used to wipe it without a word.
const uidM2 = await settled(M);
const noSave = route => route.request().postDataJSON()?.data?.op === 'authorizeSave' ? route.abort() : route.continue();
await M.route('**/europe-west1/civic', noSave);
await found(M, 'Newfound');
check('a nation founded with no save reaching the region', !!uidM2 && (await localNation(M))?.name === 'Newfound' && !(await localNation(M))?._rev);
const offline = await M.ctx.storageState();
await M.ctx.close();
const asSignedOut = (state, uid) => {
  const o = state.origins.find(x => x.origin === ORIGIN);
  o.localStorage = o.localStorage.filter(e => !e.name.startsWith('firebase:') && e.name !== 'edictum.uid' && e.name !== 'edictum.signedOut');
  o.localStorage.push({ name: 'edictum.uid', value: '-' }, { name: 'edictum.signedOut', value: uid });
  return state;
};
const M3 = await player('M3', { storageState: asSignedOut(offline, uidM) });
await M3.goto(BASE + '/');
const uidM3 = await settled(M3);
check('the next load plays it rather than wiping it', !!uidM3 && await until(async () => (await sideName(M3)) === 'Newfound', 15000) && (await localNation(M3))?.name === 'Newfound');
check('and saves it as this browser’s guest nation', await until(async () => (await nationDoc(uidM3))?.rec?.name === 'Newfound', 45000));
await until(async () => { const n = await localNation(M3); return n && n._rev > 0 && !n._dirty; }, 15000);

/* ── 13. a copy saved under the account that signed out is kept for that account ── */
// A tab still open after the sign-out can save that account's nation into this browser again: that copy has a
// revision, so it is the account's, and it is kept for it as when a sign-in is lost (8), not played by a new guest.
const left = await M3.ctx.storageState();
await M3.ctx.close();
const M4 = await player('M4', { storageState: asSignedOut(left, uidM3) });
await M4.goto(BASE + '/');
const uidM4 = await settled(M4);
check('a saved copy left after signing out is kept for its account', await until(async () => await M4.evaluate(() => JSON.parse(localStorage.getItem('edictum.parked') || 'null')?.uid).catch(() => null) === uidM3, 20000));
check('the browser starts again as a guest, and says why', await until(() => M4.isVisible('#d-name'), 15000) && await until(async () => /signed out of the account that holds “Newfound”/.test(await toasts(M4))) && !!uidM4 && uidM4 !== uidM3 && (await restGet('nations/' + uidM4)).status === 404);

/* ── 14. a sign-in that fails after the guest's region copy went ───────────── */
// Switching to an email address drops the guest nation from the region before the sign-in, as only the guest can.
// When the sign-in then fails and putting the copy back fails too, the game saves it again as a new record, rather
// than taking the missing record for a nation dissolved on another device.
const P = await player('P');
const uidP = await open(P);
await founded(P, 'Pellmont');
const realP = await sendLink(P, 'ava@example.com');
await P.ctx.addInitScript(() => { window.EDICTUM_SAVE_LIMIT = 4000; window.EDICTUM_SAVE_RETRY = [2000, 3000, 4000]; });
await P.evaluate(() => localStorage.setItem('edictum.emailLink', JSON.stringify({ email: 'ava@example.com', mode: 'switch' })));
let blockP = true;
await P.route('**/europe-west1/civic', route => blockP && route.request().postDataJSON()?.data?.op === 'authorizeSave' ? route.abort() : route.continue());
await P.goto(realP.replace(/oobCode=[^&]+/, 'oobCode=used-up-code'));
check('a sign-in that fails leaves the guest playing', await until(async () => /sent a new one/.test(await text(P, '.ed-msg')), 20000) && (await ready(P)) === uidP && (await sideName(P)) === 'Pellmont', await text(P, '.ed-msg'));
check('with its region copy gone for now', (await restGet('nations/' + uidP)).status === 404);
blockP = false;
check('its next save puts it back in the region', await until(async () => (await nationDoc(uidP))?.rec?.name === 'Pellmont', 45000));
check('and it is never taken for a nation dissolved elsewhere', !/dissolved on another device/.test(await toasts(P)) && (await localNation(P))?.name === 'Pellmont');

/* ── 15. the copy moved into an account without a nation survives a write at unload ── */
// doSwitch's "that account holds no nation" branch leaves with the moved copy (revision 0). leave() writes it back on
// pagehide, after the page's own pagehide handlers (registered earlier, so run first), so a save the game makes
// while the page unloads cannot replace it.
const R = await player('R');
const uidR = await open(R);
await founded(R, 'Rookhaven');
await R.goto(await sendLink(R, 'rook@example.com'));
check('R links an email address', await until(async () => /rook@example\.com/.test(await text(R, '.ed-acct-b')), 15000) && await registered(R));
await R.keyboard.press('Escape').catch(() => {});
await until(async () => !(await R.isVisible('dialog.ed-dlg[open]')), 5000);
await nav(R, 'settings'); await R.click('#sg-tab-account'); await R.click('[data-act="dissolve-ask"]');
await R.fill('#dz-type', 'Rookhaven'); await R.click('[data-act="dissolve-confirm"]');
check('and dissolves its nation, keeping the account', await until(async () => (await restGet('nations/' + uidR)).status === 404, 15000) && await accountExists(uidR));
const Q = await player('Q');
await open(Q);
await founded(Q, 'Quayside');
/* a write at pagehide, made only as the switch leaves the page (doSwitch has just noted edictum.carry, which no
   other unload here sees), in a handler registered at the page's start, so before leave()'s own. Every unload notes
   what it saw, for the check's detail */
await Q.ctx.addInitScript(() => {
  addEventListener('pagehide', () => {
    const carry = localStorage.getItem('edictum.carry'), n = JSON.parse(localStorage.getItem('statehood.nation.v1') || 'null');
    const seen = JSON.parse(sessionStorage.getItem('test.unloadSeen') || '[]');
    seen.push({ carry: !!carry, name: n && n.name, rev: n && n._rev, msg: (document.querySelector('.ed-msg')?.textContent || '').slice(0, 60) });
    sessionStorage.setItem('test.unloadSeen', JSON.stringify(seen));
    if (!carry || !n || n.name !== 'Quayside') return;
    n.motto = 'Written at unload'; n._rev = 7; localStorage.setItem('statehood.nation.v1', JSON.stringify(n)); sessionStorage.setItem('test.unloadWrote', '1');
  });
});
const firstQ = await sendLink(Q, 'rook@example.com');
await Q.goto(firstQ);
await Q.waitForSelector('[data-ed="switch"]', { timeout: 15000 });
const switchedQ = Q.waitForNavigation({ timeout: 15000 }).then(() => true, () => false);
await Q.click('[data-ed="switch"]');
if (!(await switchedQ)) {
  const secondQ = await until(async () => { const l = await emailLink('rook@example.com'); return l !== firstQ && l; });
  await Q.goto(secondQ);
}
check('Q switches into the account without a nation, taking Quayside along', await until(async () => (await ready(Q).catch(() => null)) === uidR, 20000) && await until(async () => (await sideName(Q)) === 'Quayside', 15000));
/* the new account answers ready() as soon as the sign-in lands, before leave() reloads the page: wait for that unload */
check('the write at unload did run', await until(async () => await Q.evaluate(() => sessionStorage.getItem('test.unloadWrote')) === '1', 20000), JSON.stringify({ switchedAtOnce: await switchedQ, unloads: await Q.evaluate(() => JSON.parse(sessionStorage.getItem('test.unloadSeen') || '[]')) }));
check('and a write at unload did not replace the moved copy', (await localNation(Q))?.motto !== 'Written at unload' && await until(async () => (await nationDoc(uidR))?.rec?.name === 'Quayside', 20000) && (await nationDoc(uidR)).rec.motto !== 'Written at unload');

/* ── 16. a link to keep a nation, opened in another browser (an email app's own) ── */
// It must not sign in there: that made a separate, empty account for the address while the nation stayed a guest in
// the first browser. The other browser shows the link to paste where the nation is, and there it links as usual.
const S = await player('S');
const uidS = await open(S);
await founded(S, 'Selbourne');
const linkS = await sendLink(S, 'sel@example.com');
check('a link to keep a nation names the account that asked', /elk(=|%3D)[0-9a-f]{8}/.test(linkS));
check('and the sent page says to copy it over from an email app’s browser', /copy the link into this one/.test(await text(S, 'dialog.ed-dlg')));
const T = await player('T');
const uidT0 = await open(T);
await T.goto(linkS);
await T.waitForSelector('#ed-link', { timeout: 15000 });
check('opened in another browser, it says to open it where the nation is', /where your nation is/.test(await heading(T)));
const pasted = await T.inputValue('#ed-link');
check('and holds the link to paste there', /oobCode=/.test(pasted));
check('it signs nobody in there', (await ready(T)) === uidT0 && await T.evaluate(() => G.S.civic?.account.kind) !== 'registered');
check('and makes no account for the address', !(await emailHasAccount('sel@example.com')));
await S.goto(pasted);
check('pasted into the browser that asked, it links the nation there', await until(async () => (await ready(S)) === uidS) && await until(async () => /sel@example\.com/.test(await text(S, '.ed-acct-b')), 15000) && await registered(S) && (await sideName(S)) === 'Selbourne');
/* a plain sign-in link (asked for by a guest without a nation) still works in any browser: section 2 */

/* ── 17. a new guest emails itself its recovery code ────────────────────────── */
const V = await player('V', { recovery: true });   // keep the recovery-code dialog open (lib.mjs dismisses it otherwise)
const uidV = await open(V);
await found(V, 'Velmora', { newPlayer: true });   // no settling: the recovery dialog, left open here, would cover the map
await until(() => nationDoc(uidV));
await V.waitForSelector('[data-ed="recovery-saved"]', { timeout: 20000 });
const shownV = (await text(V, '#ed-recovery-code')).trim();
await V.click('[data-ed="recovery-mail-open"]');
await V.fill('#ed-rc-email', 'vel@example.com');
await V.click('[data-ed="recovery-mail"]');
check('the recovery code can be emailed from its dialog', await until(async () => /Sent to vel@example\.com/.test(await text(V, '.ed-msg')), 15000), await text(V, '.ed-msg'));
const letterV = await until(async () => (await restListAdmin('mailOutbox')).map(d => d.fields).find(f => f.to?.stringValue === 'vel@example.com'));
check('and the letter holds that code, naming no nation', !!letterV && /^EDC-/.test(shownV) && letterV.text.stringValue.includes(shownV) && !/Velmora/.test(letterV.html.stringValue));
check('the dialog still asks the player to confirm they saved it', await V.isVisible('[data-ed="recovery-saved"]'));
await V.click('[data-ed="recovery-saved"]');

await finish();
