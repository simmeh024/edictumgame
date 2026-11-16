// A one-time sign-in link, from the admin's page to the player's phone (functions/once.js; src/shim.js, onceOpen and
// the 'secure' view): the admin copies a link, a phone that lost its sign-in opens it, is asked first, plays the nation,
// and is guided to check its way back in (Google, on a phone: there and back). The link works once; the player gets a
// letter from the Edictum Team; an emailed link goes to the account's verified address; Cancel stops a link working.
import path from 'node:path';
import { BASE, OUT, check, finish, until, sleep, player, open, ready, found, openAccount, text, sideName, nationDoc, restListAdmin, clearEmulators, googlePopup, setClaims, register } from './lib.mjs';

await clearEmulators();
const PHONE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
const GMAIL = 'farhold@example.com';
/* the Auth emulator's stand-in for Google's page, in the same tab (a phone goes there and back) */
async function googleHere(p, email) {
  await p.waitForURL(/\/emulator\/auth\/handler/, { timeout: 15000 });
  await p.waitForSelector('#accounts-list, #add-user');
  const existing = p.locator('li.js-reuse-account', { hasText: email });
  if (await existing.count()) await existing.first().click();
  else { await p.click('#add-account-button button'); await p.fill('#email-input', email); await p.fill('#display-name-input', email.split('@')[0]); await p.click('#sign-in'); }
  await p.waitForURL(u => u.href.startsWith(BASE), { timeout: 20000 });
}
const heading = p => text(p, 'dialog.ed-dlg[open] #ed-dlg-h');

// the player: a nation with an email sign-in and Google, on a computer
const T = await player('T');
const uidT = await open(T);
await found(T, 'Farhold');
await until(() => nationDoc(uidT));
await register(T);
await openAccount(T);
await googlePopup(T, '[data-ed="google"]', GMAIL);
check('the player has email and Google', await until(async () => /farhold@example\.com/.test(await text(T, '.ed-acct-b'))));
await T.ctx.close();

// the admin finds the player
const A = await player('admin');
const uidA = await open(A);
await found(A, 'Adminland');
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.click('.adm-nav [data-v="admin-players"]');
await until(async () => !await A.$('.adm-main [role="status"]'));
await A.fill('#admin-q', uidT); await A.click('#admin-search button:not([type])');
await until(async () => !!await A.$(`.tbl [data-act="admin-inspect"][data-id="${uidT}"]`));
await A.click(`.tbl [data-act="admin-inspect"][data-id="${uidT}"]`);
const detail = () => text(A, '.adm-detail');
check('the player page has a One-time sign-in section, with no link yet', await until(async () => /One-time sign-in\s*No link made for this player yet/.test(await detail())), (await detail()).slice(0, 300));
check('it offers to email a link to the verified address, masked', await A.isVisible('[data-act="admin-once"][data-v="mail"]') && /Email a link to .•••.@registered\.example\.test/.test(await text(A, '[data-act="admin-once"][data-v="mail"]')), await text(A, '[data-act="admin-once"][data-v="mail"]'));

// 1. a copied link
await A.click('[data-act="admin-once"][data-v="copy"]');
check('copying asks first, and says who can use the link', /Anyone who opens it can sign in to this nation/.test(await text(A, '#admin-once-ask')));
await A.click('[data-act="admin-once-yes"][data-v="copy"]');
const link = await until(async () => await A.inputValue('#admin-once-link').catch(() => ''), 15000);
check('the admin gets the link, shown once', /^https:\/\/edictumgame\.com\/\?once=EDO[A-F0-9]{40}$/.test(link), link);
check('and the page says a link is waiting', /A link is waiting: made .* by you, copied to send by hand/.test(await detail()));
await A.screenshot({ path: path.join(OUT, 'once-admin.png') });
const code = new URL(link).searchParams.get('once');

// 2. a phone that lost its sign-in opens it
const P = await player('P', { vp: { width: 390, height: 844 }, ua: PHONE });
const uidP0 = await open(P, BASE + '/?once=' + code);
check('the phone is a fresh guest', !!uidP0 && uidP0 !== uidT);
check('the link is taken out of the address bar', !/once=/.test(P.url()), P.url());
check('the game asks first, naming the nation', await until(async () => /Sign in to “Farhold”\?/.test(await heading(P)), 15000), await heading(P));
await P.screenshot({ path: path.join(OUT, 'once-ask-phone.png') });
await Promise.all([P.waitForNavigation({ timeout: 20000 }).catch(() => {}), P.click('[data-ed="once-yes"]')]);
check('Sign in takes the phone into the account', await until(async () => (await ready(P).catch(() => null)) === uidT, 25000));
check('and its nation', await until(async () => (await sideName(P)) === 'Farhold', 15000), await sideName(P));
check('then the guide: make sure you can get back in', await until(async () => /Make sure you can get back in/.test(await heading(P)), 15000), await heading(P));
const guide = () => text(P, 'dialog.ed-dlg[open]');
check('it lists Google with its address, with a check to do, and the email sign-in', /Google \(farhold@example\.com\)/.test(await guide()) && await P.isVisible('[data-ed="gcheck"]') && /Email \(.*@registered\.example\.test\)/.test(await guide()), await guide());
check('the guide fits the phone', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await P.screenshot({ path: path.join(OUT, 'once-guide-phone.png') });

// the phone checks Google: to Google and back
await P.click('[data-ed="gcheck"]');
await googleHere(P, GMAIL);
check('back from Google, the check is done', await until(async () => /Google works on this device/.test(await text(P, 'dialog.ed-dlg[open] .ed-msg')) && await P.isVisible('dialog.ed-dlg[open] .ed-ok'), 20000), await text(P, 'dialog.ed-dlg[open]'));
check('still the same account', (await ready(P)) === uidT);
await P.screenshot({ path: path.join(OUT, 'once-checked-phone.png') });
await P.reload(); await ready(P); await sleep(2500);
check('once checked, the guide does not come back', !/Make sure you can get back in/.test(await heading(P)));
check('the Edictum Team writes a letter about the one-time sign-in', await until(async () => /signed in with a one-time link that the Edictum team made for you/.test(await P.evaluate(() => (G.LTR().dmThreads(Date.now()).get('office-team') || []).map(m => m.x).join(' | '))), 15000));

// 3. the link works once
const R = await player('R');
await open(R, BASE + '/?once=' + code);
check('opened again, the link is used up', await until(async () => /This link cannot be used/.test(await heading(R)) && /expired or was already used/.test(await text(R, 'dialog.ed-dlg[open] .ed-msg')), 15000), await text(R, 'dialog.ed-dlg[open]'));
check('and the browser stays its own guest', (await ready(R)) !== uidT);
await A.click(`[data-act="admin-inspect"][data-id="${uidT}"]`).catch(async () => { await A.fill('#admin-q', uidT); await A.click('#admin-search button:not([type])'); await A.click(`.tbl [data-act="admin-inspect"][data-id="${uidT}"]`); });
check('the admin page says the last link signed the player in', await until(async () => /No link waiting\. The last one signed the player in/.test(await detail()), 15000), (await detail()).match(/One-time sign-in.{0,200}/)?.[0]);

// 4. emailed to the account's address, then cancelled
await A.click('[data-act="admin-once"][data-v="mail"]');
await A.click('[data-act="admin-once-yes"][data-v="mail"]');
check('the Herald emails the link', await until(async () => /The Herald emailed the link to .•••.@registered\.example\.test/.test(await detail()), 15000));
const mails = (await restListAdmin('mailOutbox')).filter(m => m.fields.to?.stringValue === (uidT + '@registered.example.test').toLowerCase() /* Firebase keeps addresses in lower case */ && /once=EDO/.test(m.fields.text?.stringValue || ''));
check('to the verified address on the account, naming the nation', mails.length === 1 && /Farhold/.test(mails[0].fields.text.stringValue));
const mailed = /once=(EDO[A-F0-9]{40})/.exec(mails[0]?.fields.text.stringValue || '')?.[1];
await A.click('[data-act="admin-once-yes"][data-v="revoke"]');
check('Cancel the link', await until(async () => /The link no longer works/.test(await detail())));
const S2 = await player('S2');
await open(S2, BASE + '/?once=' + mailed);
check('a cancelled link opens nothing', await until(async () => /This link cannot be used/.test(await heading(S2)), 15000), await heading(S2));

await finish();
