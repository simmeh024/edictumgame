// Google on a phone: the game goes to Google and back in the same tab (linkWithRedirect), as a phone's pop-ups open
// as tabs that often lose their way back. A guest who comes back with a Google account that already holds a nation
// switches to it: at once when the guest has no nation, after one question when it has one, and with no pop-up either
// way. Reported 16 Nov 2026: a player on Android Chrome signed in with Google and stayed a guest.
import path from 'node:path';
import { BASE, OUT, check, finish, until, player, open, ready, found, openAccount, text, sideName, nationDoc, restGet, clearEmulators, googlePopup } from './lib.mjs';

await clearEmulators();
const PHONE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
const EMAIL = 'phone@example.com';

/* the Auth emulator's stand-in for Google's page, in the same tab: pick the account, or add it */
async function googleHere(p, email) {
  await p.waitForURL(/\/emulator\/auth\/handler/, { timeout: 15000 });
  await p.waitForSelector('#accounts-list, #add-user');
  const existing = p.locator('li.js-reuse-account', { hasText: email });
  if (await existing.count()) await existing.first().click();
  else {
    await p.click('#add-account-button button');
    await p.fill('#email-input', email);
    await p.fill('#display-name-input', email.split('@')[0]);
    await p.click('#sign-in');
  }
  await p.waitForURL(u => u.href.startsWith(BASE), { timeout: 20000 });
}
const popups = p => { p.popups = 0; p.on('popup', () => { p.popups++; }); };

// the account: a nation linked to Google on a computer
const A = await player('A');
const uidA = await open(A);
await found(A, 'Lowmarch');
await until(() => nationDoc(uidA));
await openAccount(A);
await googlePopup(A, '[data-ed="google"]', EMAIL);
check('the account is linked to Google on the computer', await until(async () => /phone@example\.com/.test(await text(A, '.ed-acct-b'))));
await A.ctx.close();

// 1. a phone that lost its sign-in: a fresh guest with no nation
const P = await player('P', { vp: { width: 390, height: 844 }, ua: PHONE });
popups(P);
const uidP0 = await open(P);
check('the phone starts as a new guest', !!uidP0 && uidP0 !== uidA);
await openAccount(P);
await P.click('[data-ed="google"]');
await googleHere(P, EMAIL);
check('back from Google, the phone switches to the account by itself', await until(async () => (await ready(P).catch(() => null)) === uidA, 25000), String(await ready(P).catch(() => null)));
check('and plays its nation', await until(async () => (await sideName(P)) === 'Lowmarch', 15000), await sideName(P));
check('with no pop-up opened', P.popups === 0, String(P.popups));
check('and no question left open', !(await P.$('dialog.ed-dlg[open] [data-ed="switch"]')));
await P.screenshot({ path: path.join(OUT, 'phone-google-switch.png') });

// 2. a phone guest that founded a nation of its own meanwhile: one question, then the switch, still with no pop-up
const Q = await player('Q', { vp: { width: 390, height: 844 }, ua: PHONE });
popups(Q);
const uidQ0 = await open(Q);
await found(Q, 'Pocketon');
await until(() => nationDoc(uidQ0));
await openAccount(Q);
await Q.click('[data-ed="google"]');
await googleHere(Q, EMAIL);
await Q.waitForSelector('dialog.ed-dlg[open] [data-ed="switch"]', { timeout: 15000 }).catch(() => {});
check('a guest with a nation is asked first', /Switch to that Google account/.test(await text(Q, '#ed-dlg-h')), await text(Q, '#ed-dlg-h'));
await Q.screenshot({ path: path.join(OUT, 'phone-google-ask.png') });
await Promise.all([Q.waitForNavigation({ timeout: 20000 }).catch(() => {}), Q.click('[data-ed="switch"]')]);
check('Switch takes it to the account', await until(async () => (await ready(Q).catch(() => null)) === uidA, 25000), String(await ready(Q).catch(() => null)));
check('and its nation', await until(async () => (await sideName(Q)) === 'Lowmarch', 15000), await sideName(Q));
check('with no pop-up opened', Q.popups === 0, String(Q.popups));
check('the guest nation left the region', await until(async () => (await restGet('nations/' + uidQ0)).status === 404, 10000));

await finish();
