// Letters by post in the game: Settings › Letters by post takes an address, the code from the letter confirms it,
// the kinds can be switched, and a letter written to another player leaves a ping for the mail job.
//   npm run test:mail-e2e
import { player, open, found, until, check, finish, nav, text, restListAdmin, clearEmulators, sleep, BASE, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const A = await player('writer'), B = await player('reader');
const uidA = await open(A); await found(A, 'Inkwell');
const uidB = await open(B); await found(B, 'Postland');
const to = 'reader@example.test';
const outbox = async () => (await restListAdmin('mailOutbox')).map(d => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue })).filter(l => l.to === to);

await nav(B, 'settings'); await B.click('#sg-tab-notif');
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
check('the confirmed address and seven kinds of letter show', await until(async () => (await B.$$('#set-mail [data-ml-pref]')).length === 7 && /Letters go to reader@example\.test/.test(await text(B, '#set-mail'))), await text(B, '#set-mail'));
check('a welcome letter followed', await until(async () => (await outbox()).some(l => /^Welcome to the rolls, Postland/.test(l.subject))), JSON.stringify((await restListAdmin('mailOutbox')).map(d => [d.fields.to?.stringValue, d.fields.subject?.stringValue])));
await B.uncheck('#set-mail [data-ml-pref="away"]');
await sleep(1500);
await nav(B, 'nation'); await nav(B, 'settings'); await B.click('#sg-tab-notif');
check('switching a kind off is kept', await until(async () => (await B.$('#set-mail [data-ml-pref="away"]')) && !(await B.isChecked('#set-mail [data-ml-pref="away"]')) && await B.isChecked('#set-mail [data-ml-pref="msg"]')));

// A writes to B: a ping, with the writer's nation name and no text
await A.evaluate(uid => { G.S.msgPeer = uid; }, uidB);
await nav(A, 'messages');
await A.fill('#dm-text', 'A private word');
await A.click('#dm-form button[type="submit"]');
const ping = await until(async () => (await restListAdmin('mailQ')).find(d => d.fields.to.stringValue === uidB));
check('a letter to another player leaves a ping for the mail job', ping && ping.fields.k.stringValue === 'msg' && ping.fields.nm.stringValue === 'Inkwell' && !JSON.stringify(ping.fields).includes('private word'), JSON.stringify(ping && ping.fields));

// The emailed confirmation link (bug run item 62). A status check that fails is tried again, by a button and by itself,
// and the code from the link waits for it. A link for another account, or opened after its code expired, says so.
let failStatus = false;
await A.route(u => /\/accounts$/.test(u.pathname), r => failStatus && r.request().method() === 'POST' && (r.request().postData() || '').includes('"step":"status"') ? r.abort() : r.continue());
failStatus = true;
await open(A, BASE + '/?mailcode=123456');
await nav(A, 'settings'); await A.click('#sg-tab-notif');
check('a failed status check offers Try again', await until(async () => /could not be reached/.test(await text(A, '#set-mail')) && !!(await A.$('#set-mail [data-f="retry"]'))), await text(A, '#set-mail'));
failStatus = false;
await A.click('#set-mail [data-f="retry"]');
check('Try again reads the status, and the kept link is answered: it was for another account', await until(async () => /sent for another account/.test(await text(A, '#set-mail'))), await text(A, '#set-mail'));
check('the address field shows after the retry', !!(await A.$('#set-mail #ml-email')));
const toA = 'writer@example.test';
await A.fill('#ml-email', toA);
failStatus = true;
await A.click('#set-mail [data-f="send"]');
check('the status check after sending a code fails at first', await until(async () => /could not be reached/.test(await text(A, '#set-mail'))), await text(A, '#set-mail'));
failStatus = false;
check('the game tries the status again by itself', await until(async () => !!(await A.$('#ml-code')), 15000), await text(A, '#set-mail'));
const sealA = await until(async () => (await restListAdmin('mailOutbox')).map(d => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue })).find(l => l.to === toA));
const aged = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/mailAccounts/${uidA}?updateMask.fieldPaths=codeAt`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { codeAt: { integerValue: String(Date.now() - 31 * 60000) } } }) });
check('the code was aged past 30 minutes', aged.status === 200, String(aged.status));
await open(A, BASE + '/?mailcode=' + sealA.subject.slice(0, 6));
await nav(A, 'settings'); await A.click('#sg-tab-notif');
check('a link opened after its code expired says so', await until(async () => /has expired/.test(await text(A, '#set-mail'))), await text(A, '#set-mail'));
check('and offers to send a new code to the same address', !!(await A.$('#set-mail [data-f="send"]')) && (await A.inputValue('#ml-email')) === toA);
check('nothing points to another device', !/on the device where/.test(await text(A, '#set-mail')));
await open(B, BASE + '/?mailcode=123456');
await nav(B, 'settings'); await B.click('#sg-tab-notif');
check('a link for a confirmed address says it is confirmed', await until(async () => /already confirmed/.test(await text(B, '#set-mail'))), await text(B, '#set-mail'));
await finish();
