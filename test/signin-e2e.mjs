// Signing in with an email link or with Discord, on the emulators: linking keeps a guest's uid and makes it a
// Registered Nation with the first-link gift, another browser signs in to that account, a guest with a nation
// switches to it, and deleting the account frees its Discord account. Email links come from the Auth emulator's
// outbox; Discord is functions/discord.js's emulator stand-in (window.EDICTUM_DISCORD_EMU).
import path from 'node:path';
import { BASE, OUT, AUTH_HOST, PROJECT, check, finish, until, player, open, ready, found, openAccount, text, sideName, localNation, nationDoc, restGet,
  restListAdmin, accountExists, clearEmulators } from './lib.mjs';

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
check('and says so', await until(async () => /kept with your linked sign-in\. \+5 land credits/.test(await toasts(A)), 20000));

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

await finish();
