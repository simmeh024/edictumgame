// Letters by post in the game: Settings › Letters by post takes an address, the code from the letter confirms it,
// the kinds can be switched, and a letter written to another player leaves a ping for the mail job.
//   npm run test:mail-e2e
import { player, open, found, until, check, finish, nav, text, restListAdmin, clearEmulators, sleep } from './lib.mjs';
await clearEmulators();
const A = await player('writer'), B = await player('reader');
await open(A); await found(A, 'Inkwell');
const uidB = await open(B); await found(B, 'Postland');
const to = 'reader@example.test';
const outbox = async () => (await restListAdmin('mailOutbox')).map(d => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue })).filter(l => l.to === to);

await nav(B, 'settings');
check('Settings has a Letters by post card with an address field', await until(async () => !!(await B.$('#set-mail #ml-email'))), await text(B, '#set-mail'));
await B.click('#set-mail [data-f="send"]');
check('an empty address is refused', /Write your email address first/.test(await text(B, '#set-mail')));
await B.fill('#ml-email', to);
await B.click('#set-mail [data-f="send"]');
check('after sending, the card asks for the code', await until(async () => !!(await B.$('#ml-code'))), await text(B, '#set-mail'));
const seal = await until(async () => (await outbox())[0]);
check('a confirmation seal went to the address', seal && /^\d{6} is your Edictum confirmation seal$/.test(seal.subject));
await B.fill('#ml-code', '12');
await B.click('#set-mail [data-f="verify"]');
check('a short code is refused in the page', /six figures/.test(await text(B, '#set-mail')));
await B.fill('#ml-code', seal.subject.slice(0, 6));
await B.click('#set-mail [data-f="verify"]');
check('the confirmed address and five kinds of letter show', await until(async () => (await B.$$('#set-mail [data-ml-pref]')).length === 5 && /Letters go to reader@example\.test/.test(await text(B, '#set-mail'))), await text(B, '#set-mail'));
check('a welcome letter followed', await until(async () => (await outbox()).some(l => /^Welcome to the rolls, Postland/.test(l.subject))));
await B.uncheck('#set-mail [data-ml-pref="away"]');
await sleep(1500);
await nav(B, 'nation'); await nav(B, 'settings');
check('switching a kind off is kept', await until(async () => (await B.$('#set-mail [data-ml-pref="away"]')) && !(await B.isChecked('#set-mail [data-ml-pref="away"]')) && await B.isChecked('#set-mail [data-ml-pref="msg"]')));

// A writes to B: a ping, with the writer's nation name and no text
await A.evaluate(uid => { G.S.msgPeer = uid; }, uidB);
await nav(A, 'messages');
await A.fill('#dm-text', 'A private word');
await A.click('#dm-form button[type="submit"]');
const ping = await until(async () => (await restListAdmin('mailQ')).find(d => d.fields.to.stringValue === uidB));
check('a letter to another player leaves a ping for the mail job', ping && ping.fields.k.stringValue === 'msg' && ping.fields.nm.stringValue === 'Inkwell' && !JSON.stringify(ping.fields).includes('private word'), JSON.stringify(ping && ping.fields));
await finish();
