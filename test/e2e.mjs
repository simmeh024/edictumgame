// End-to-end tests of the built site on the Firebase emulators:
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/e2e.mjs"
// Covers: two players sharing a region and its message board, a player in another region (not
// downloaded, but counted and listed on the World page), reloads, the security rules as the game
// meets them, admin moderation, region steering when a region is full, browser-only mode when Firebase is blocked,
// keeping a founding draft across a region switch, and Google sign-in (linking, switching, signing out) with the
// Auth emulator's stand-in for Google.
import path from 'node:path';
import {
  BASE, OUT, check, finish, sleep, until, player, open, ready, found, nav, text, sideName, localNation,
  restGet, restList, restListAdmin, accountExists, restPatch, nationDoc, clearEmulators, setClaims, googlePopup, openAccount, errors
} from './lib.mjs';

await clearEmulators();
const t0 = Date.now();

/* ── 1. two players in one region ───────────────────────────────────────── */
const A = await player('A');
const uidA = await open(A);
check('A gets an anonymous account at once', typeof uidA === 'string' && uidA.length > 10, uidA);
await found(A, 'Aldoria');
const docA = await until(() => nationDoc(uidA));
check('A’s nation is saved to nations/<uid> in the stored shape', docA && docA.v === 1 && docA.name === 'Aldoria' && docA.rec && docA.rec.name === 'Aldoria' && docA.keys.join() === 'j,name,reg,ts,updatedAt,v', docA && docA.keys.join());
const sumA = await restGet('summaries/' + uidA);
check('its summary is saved beside it', sumA.status === 200 && sumA.body.fields.name.stringValue === 'Aldoria' && sumA.body.fields.reg.stringValue === 'meridian');
check('a nation with no Moon, Mars or belt data has no space record', (await restGet('space/' + uidA)).status === 404);
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
const postsM = await restList('boards/meridian/posts');
check('the post is its own document in boards/meridian/posts', postsM.some(p => p.fields.a.stringValue === uidA && p.fields.x.stringValue === 'Greetings from Aldoria' && p.fields.t.timestampValue));
await A.fill('#rmb-text', 'Too soon');
await A.click('#rmb-form button[type="submit"]');
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
// toasts show one at a time, and founding queued several: allow for the queue
check('a second post within 20 seconds waits, and the player is told', await until(async () => /every 20 seconds/.test(await toasts(A)), 40000) && (await A.inputValue('#rmb-text')) === 'Too soon');
await A.fill('#rmb-text', '');

// the decisions page is called Edicts, at #edicts; an old #issues link still opens it
await nav(A, 'issues');
check('the Edicts page is at #edicts', /#edicts$/.test(A.url()) && (await text(A, 'main h1, .vh h1')) === 'Edicts' && /Edictum [MDCLXVI]+ · arrived/.test(await text(A, '.issue-list')));
await A.goto(BASE + '/#issues'); await ready(A);
check('an old #issues link opens it too', await until(async () => (await text(A, '.vh h1')) === 'Edicts'));

/* ── 2b. other regions are not downloaded, but are counted and listed ──── */
const R = await player('R');
await open(R);
await R.evaluate(() => localStorage.setItem('statehood.region', 'frostmarch'));
await R.reload(); const uidR = await ready(R);
await found(R, 'Frostia');
check('R founds in the Frostmarch', await until(async () => ((await nationDoc(uidR)) || {}).reg === 'frostmarch'));
await nav(A, 'region');
await sleep(1500);
check('A’s region does not list a nation of another region', !/Frostia/.test(await text(A, '.tbl')) && /Borvia/.test(await text(A, '.tbl')));
await nav(A, 'world');
const frostCard = await until(async () => { const t = await text(A, '.wr-card:has([data-id="frostmarch"]) .wr-meta'); return /1 player/.test(t) ? t : ''; }, 10000);
check('the World page counts the Frostmarch’s player', !!frostCard, frostCard);
await A.click('[data-act="wr-sel"][data-id="frostmarch"]');
check('and lists it when the region is opened', await until(async () => /Player nations: Frostia/.test(await text(A, '.wr-detail'))));
await nav(R, 'region');
check('R’s board is the Frostmarch’s, without Meridian’s posts', !/Greetings from Aldoria/.test(await text(R, '.posts')));

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
const tryDo = (p, fn, arg) => p.evaluate(async ([fn, arg]) => {
  const db = await window.claude.use('db');
  try { await (new Function('db', 'arg', 'return (' + fn + ')(db, arg)'))(db, arg); return 'ok'; } catch (e) { return e.code; }
}, [fn.toString(), arg]);
check('A cannot write B’s nation (code not_granted)', (await tryWrite(A, 'nations/' + uidB, { name: 'Stolen', s: {} })) === 'not_granted');
check('A cannot post to another region’s board (code not_granted)', (await tryDo(A, (db, reg) => db.post(reg, 'Hello, Frostmarch'), 'frostmarch')) === 'not_granted');
const pidA = (postsM.find(p => p.fields.a.stringValue === uidA) || {}).id;
check('B cannot delete A’s post (code not_granted)', !!pidA && (await tryDo(B, (db, path) => db.doc(path).delete(), 'boards/meridian/posts/' + pidA)) === 'not_granted');
check('the old board format is closed (code not_granted)', (await tryWrite(A, 'rmb/' + uidA, { posts: [] })) === 'not_granted');
const anonRead = await restGet('nations/' + uidB);
check('a visitor who is not signed in can read a nation', anonRead.status === 200);
check('a visitor who is not signed in cannot write one', (await restPatch('nations/' + uidB, { name: { stringValue: 'x' } })) === 403);
check('B’s nation is unchanged', (await nationDoc(uidB)).name === 'Borvia');

/* ── 5. an admin moderates the board ────────────────────────────────────── */
await B.fill('#rmb-text', 'A rude remark from Borvia');
await B.click('#rmb-form button[type="submit"]');
await until(async () => /rude remark/.test(await text(A, '.posts')));
check('before the claim, A has no Remove button on B’s post', !(await A.$(`.posts [data-act="del-post"][data-a="${uidB}"]`)));
check('before the claim, no player has the Admin pill', !(await A.$('.adm-pill')) && !(await B.$('.adm-pill')));
check('the admin claim is set (Auth emulator)', (await setClaims(uidA, { admin: true })) === 200);
await A.reload(); await ready(A); // the game asks for a fresh token on load, so no sign-out is needed
check('user.isOwner() is true with the claim', await A.evaluate(() => window.claude.use('user').then(u => u.isOwner())));
check('the admin has a purple Admin pill beside the nation’s name', await until(async () => (await text(A, '.side-who .adm-pill')) === 'Admin'));
check('other players still do not', !(await B.$('.adm-pill')));
await A.click('.side-who .adm-pill');
check('the pill opens the admin portal at #admin', await until(async () => !!(await A.$('.adm')) && (await A.evaluate(() => location.hash)) === '#admin'));
const admText = await until(async () => { const t = await text(A, '.adm'); return /players \(active/.test(t) ? t : ''; }, 15000);
check('it shows the player count, the regions and the largest nations', !!admText && /Meridian Reach/.test(admText) && /Aldoria/.test(admText) && /Borvia/.test(admText), (admText.match(/(\d+) players \(active/) || [])[0]);
check('it counts the players in Meridian and the Frostmarch', await A.evaluate(() => { const row = n => [...document.querySelectorAll('.adm tbody tr')].find(r => r.cells[0].textContent === n); const a = row('Meridian Reach'), f = row('Frostmarch'); return !!a && Number(a.cells[1].textContent) >= 2 && !!f && Number(f.cells[1].textContent) >= 1; }));
await A.click('[data-act="admin-close"]');
check('Back to the game returns to the nation page', await until(async () => !!(await A.$('.layout')) && !(await A.$('.adm'))));
await nav(A, 'region');
const del = await until(() => A.$(`.posts [data-act="del-post"][data-a="${uidB}"]`));
check('the admin sees Remove on B’s post', !!del);
if (del) await del.click();
check('the admin deleted B’s post document', await until(async () => !(await restList('boards/meridian/posts')).some(p => /rude remark/.test(p.fields.x.stringValue))));
check('B no longer sees the removed post', await until(async () => !/rude remark/.test(await text(B, '.posts'))));
check('B still sees A’s post', /Greetings from Aldoria/.test(await text(B, '.posts')));
await B.goto(BASE + '/#admin'); await ready(B);
check('#admin shows a non-admin the game, not the portal', await until(async () => !!(await B.$('.layout')) && !(await B.$('.adm'))));

/* ── 5b. reports, and hiding a nation ──────────────────────────────────── */
const M = await player('M');
const uidM = await open(M);
await found(M, 'Spamland');
await nav(M, 'region');
await M.fill('#rmb-text', 'Buy cheap gold at spam.example');
await M.click('#rmb-form button[type="submit"]');
await nav(B, 'region');
const repBtn = await until(() => B.$(`.posts [data-act="report-post"][data-a="${uidM}"]`));
check('players see Report on other players’ posts, not on their own', !!repBtn && !(await B.$(`.posts [data-act="report-post"][data-a="${uidB}"]`)));
await B.click(`.posts [data-act="report-post"][data-a="${uidM}"]`);
await B.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
check('the report dialog quotes the post', /Buy cheap gold/.test(await text(B, 'dialog.ed-dlg .ed-quote')));
await B.check('input[name="ed-reason"][value="spam"]');
await B.fill('#ed-note', 'Advertising');
await B.click('[data-ed="report-yes"]');
check('the report is sent, and the player thanked', await until(async () => /with the moderators/.test(await toasts(B))));
const reps1 = await until(async () => { const l = await restListAdmin('reports'); return l.length ? l : null; });
check('the report keeps what was reported, and why', !!reps1 && reps1[0].fields.kind.stringValue === 'post' && reps1[0].fields.target.stringValue === uidM && /Buy cheap gold/.test(reps1[0].fields.x.stringValue) && reps1[0].fields.reason.stringValue === 'spam' && reps1[0].fields.note.stringValue === 'Advertising');
check('players cannot read reports', (await restGet('reports')).status === 403);
await B.click(`.tbl [data-act="visit"][data-id="${uidM}"]`);
await B.waitForSelector('[data-act="report-nation"]');
await B.click('[data-act="report-nation"]');
await B.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
await B.click('[data-ed="report-yes"]');
check('a second report within 30 seconds is refused, with the reason', await until(async () => /every 30 seconds/.test(await text(B, '.ed-msg'))));
await B.keyboard.press('Escape');
const N = await player('N');
const uidN = await open(N);
await found(N, 'Nettleton');
await nav(N, 'region');
await (await until(() => N.$(`.tbl [data-act="visit"][data-id="${uidM}"]`))).click();
await N.click('[data-act="report-nation"]');
await N.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
check('a nation report starts at the nation’s name', await N.isChecked('input[name="ed-reason"][value="name"]'));
await N.click('[data-ed="report-yes"]');
await until(async () => (await restListAdmin('reports')).length === 2);
// the admin deals with the tickets from the portal, opened with the pill
await A.click('.side-who .adm-pill');
const repList = await until(async () => { const t = await text(A, '.adm-reps'); return /Spamland/.test(t) && /Buy cheap gold/.test(t) ? t : ''; }, 15000);
check('the portal’s ticket queue lists both reports, with what was reported', !!repList, repList ? '' : (await text(A, '.adm')).replace(/\s+/g, ' ').slice(0, 600));
await A.click('.adm-rep:has(.adm-quote) [data-act="adm-delpost"]');
check('Remove the post deletes it and closes its ticket', await until(async () => !(await restList('boards/meridian/posts')).some(p => /cheap gold/.test(p.fields.x.stringValue)) && (await restListAdmin('reports')).length === 1));
check('the other players no longer see the post', await until(async () => !/cheap gold/.test(await text(B, '.posts'))));
await A.click('.adm-rep [data-act="adm-hide"]');
check('Hide the nation records it in mod/<uid>, readable by all', await until(async () => (await restGet('mod/' + uidM)).status === 200));
await nav(B, 'region');
check('a hidden nation leaves the other players’ region', await until(async () => !/Spamland/.test(await text(B, '.tbl')) && /Aldoria/.test(await text(B, '.tbl'))));
await M.reload(); await ready(M);
check('its owner still plays it, and is told why', await until(async () => (await sideName(M)) === 'Spamland' && /moderator has hidden Spamland/.test(await toasts(M)), 15000));
check('the portal lists it under Hidden nations', await until(async () => !!(await A.$('[data-act="adm-unhide"]'))));
await A.click('[data-act="adm-unhide"]');
check('Unhide brings it back', await until(async () => (await restGet('mod/' + uidM)).status === 404) && await until(async () => /Spamland/.test(await text(B, '.tbl'))));

// a third report, and the admin bans the player behind Spamland
const O = await player('O');
await open(O);
await found(O, 'Ostrava');
await nav(O, 'region');
await (await until(() => O.$(`.tbl [data-act="visit"][data-id="${uidM}"]`))).click();
await O.click('[data-act="report-nation"]');
await O.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
await O.check('input[name="ed-reason"][value="cheating"]');
await O.click('[data-ed="report-yes"]');
await until(async () => (await restListAdmin('reports')).length === 1);
await A.click('[data-act="admin-refresh"]');
await (await until(() => A.$('.adm-rep [data-act="adm-ban"]'))).click();
check('banning asks to confirm first, and says what happens', await until(async () => /can no longer play/.test(await text(A, '.adm-ask'))) && !(await restGet('bans/' + uidM).then(r => r.status === 200)));
await A.click('[data-act="adm-ban-yes"]');
check('Ban removes the nation and its records, and closes its tickets', await until(async () => (await restGet('nations/' + uidM)).status === 404 && (await restGet('summaries/' + uidM)).status === 404 && (await restListAdmin('reports')).length === 0, 15000));
check('the ban is recorded in bans/<uid>, not readable by strangers', (await restListAdmin('bans')).some(b => b.id === uidM) && (await restGet('bans/' + uidM)).status === 403);
check('the portal lists the banned player', await until(async () => !!(await A.$(`[data-act="adm-unban"][data-id="${uidM}"]`))));
await M.reload(); await ready(M);
check('the banned player’s browser drops the nation, and they are told', await until(async () => !!(await M.$('#d-name')) && /banned/.test(await toasts(M)), 15000));
await M.fill('#d-name', 'Spamland Reborn'); await M.click('[data-act="found-suggest"]'); await M.click('#found-btn');
check('and they cannot found a new nation', await until(async () => /This account is banned/.test(await text(M, 'form .err'))) && !(await M.$('.layout')));
await A.click(`[data-act="adm-unban"][data-id="${uidM}"]`);
check('Unban lifts it', await until(async () => !(await restListAdmin('bans')).some(b => b.id === uidM)));

// a ticket the admin simply closes
const P = await player('P');
await open(P);
await found(P, 'Pellmell');
await nav(P, 'region');
await (await until(() => P.$(`.tbl [data-act="visit"][data-id="${uidB}"]`))).click();
await P.click('[data-act="report-nation"]');
await P.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
await P.click('[data-ed="report-yes"]');
await until(async () => (await restListAdmin('reports')).length === 1);
await A.click('[data-act="admin-refresh"]');
await (await until(() => A.$('.adm-rep [data-act="adm-close"]'))).click();
check('Close ticket closes it and leaves the nation alone', await until(async () => (await restListAdmin('reports')).length === 0) && (await restGet('nations/' + uidB)).status === 200);
await A.click('[data-act="admin-close"]');
await O.ctx.close(); await P.ctx.close();

/* ── 5b2. support tickets, and the admin's Help queries page ───────────── */
await nav(N, 'help');
await (await until(() => N.$('#sup-box [data-act="sup-new"]'))).click();
await N.waitForSelector('dialog.ed-dlg[open] [data-ed="support-yes"]');
check('the Help page opens a support ticket form', /Create a support ticket/.test(await text(N, '#ed-dlg-h')));
await N.click('[data-ed="support-yes"]');
check('an empty ticket is refused, with the reason', await until(async () => /Write a few words/.test(await text(N, '.ed-msg'))));
await N.check('input[name="ed-topic"][value="account"]');
await N.fill('#ed-sup-x', 'My nation shrank overnight. Is that a bug?');
await N.fill('#ed-sup-mail', 'not-an-email');
await N.click('[data-ed="support-yes"]');
check('a malformed email address is refused', await until(async () => /does not look right/.test(await text(N, '.ed-msg'))));
await N.fill('#ed-sup-mail', 'nettleton@example.com');
await N.click('[data-ed="support-yes"]');
check('the ticket is sent, and the player told where the answer will appear', await until(async () => /answer will appear on the Help page/.test(await toasts(N))));
const tk = await until(async () => { const l = await restListAdmin('support'); return l.length ? l : null; });
const tf = tk && tk[0].fields;
check('the ticket keeps the player, nation, topic, text and email', !!tf && tf.by.stringValue === uidN && tf.name.stringValue === 'Nettleton' && tf.topic.stringValue === 'account' && /shrank overnight/.test(tf.x.stringValue) && tf.email.stringValue === 'nettleton@example.com' && tf.st.stringValue === 'open');
check('strangers cannot read support tickets', (await restGet('support')).status === 403);
check('the Help page lists it as open', await until(async () => { const t = await text(N, '#sup-box .sup-list'); return /Open/.test(t) && /shrank overnight/.test(t); }));
await N.click('#sup-box [data-act="sup-new"]');
await N.waitForSelector('dialog.ed-dlg[open] [data-ed="support-yes"]');
await N.fill('#ed-sup-x', 'And another thing');
await N.click('[data-ed="support-yes"]');
check('a second ticket within a minute is refused, with the reason', await until(async () => /one ticket a minute/.test(await text(N, '.ed-msg'))));
await N.keyboard.press('Escape');
await A.click('.side-who .adm-pill');
await (await until(() => A.$('.adm-nav [data-v="admin-help"]'))).click();
const hq = await until(async () => { const t = await text(A, '.adm-reps'); return /shrank overnight/.test(t) ? t : ''; }, 15000);
check('the admin portal has a Help queries page listing the ticket', !!hq && /#admin-help$/.test(A.url()) && /Nettleton/.test(hq) && /nettleton@example\.com/.test(hq), hq ? '' : (await text(A, '.adm')).slice(0, 400));
check('its tab shows how many are open', /Help queries 1/.test(await text(A, '.adm-nav')));
await A.click('[data-act="admh-answer"]');
check('an empty answer is refused', await until(async () => /Write an answer first/.test(await text(A, '.adm'))));
await A.fill('.admh-in', 'Nations shrink when their people leave. See Migration on the Help page.');
await A.click('[data-act="admh-answer"]');
check('Send answer closes the ticket, with the answer and an expiry', await until(async () => {
  const f = ((await restListAdmin('support'))[0] || {}).fields;
  return !!f && f.st.stringValue === 'closed' && /Migration/.test(f.reply.stringValue) && !!(f.exp && f.exp.timestampValue) && f.rby.stringValue === uidA;
}));
check('the page moves it to Recently closed', await until(async () => { const t = await text(A, '.adm'); return /No open help queries/.test(t) && /Answered: .*Migration/.test(t); }));
await nav(N, 'nation');                                                      // on the Help page itself the answer simply shows
await N.reload(); await ready(N);
check('the player is told the answer has come', await until(async () => /answered your support ticket/.test(await toasts(N)), 15000));
await nav(N, 'help');
check('and reads it on the Help page', await until(async () => /Answered/.test(await text(N, '#sup-box .sup-list')) && /Migration/.test(await text(N, '#sup-box .sup-a'))));
await A.click('[data-act="adm-tab"][data-v="admin"]');
check('the Overview tab leads back, counting no open help queries', await until(async () => /open help queries/.test(await text(A, '.adm-kpis')) && !!(await A.$('.adm-nav [data-v="admin"][aria-current="page"]'))));
await A.click('[data-act="admin-close"]');

/* ── 5c. deleting a nation and account ─────────────────────────────────── */
const Q = await player('Q');
const uidQ = await open(Q);
await Q.click('[data-act="found-help"]');
check('the founding page’s help offers a support ticket too', !!(await until(() => Q.$('#sup-box [data-act="sup-new"]'))));
await Q.click('[data-act="found-help-close"]');
await found(Q, 'Fleeting');
await nav(Q, 'help');
await (await until(() => Q.$('#sup-box [data-act="sup-new"]'))).click();
await Q.waitForSelector('dialog.ed-dlg[open] [data-ed="support-yes"]');
await Q.fill('#ed-sup-x', 'How do I leave for good?');
await Q.click('[data-ed="support-yes"]');
await until(async () => (await restListAdmin('support')).some(t => t.fields.by.stringValue === uidQ));
await nav(Q, 'region');
await Q.fill('#rmb-text', 'Goodbye, region');
await Q.click('#rmb-form button[type="submit"]');
await until(async () => (await restList('boards/meridian/posts')).some(p => p.fields.a.stringValue === uidQ));
await openAccount(Q);
await Q.click('[data-ed="delete"]');
check('deleting asks first, and says what goes', /Delete your nation and account/.test(await text(Q, '#ed-dlg-h')) && /cannot be undone/.test(await text(Q, 'dialog.ed-dlg')));
await Promise.all([Q.waitForNavigation({ timeout: 20000 }), Q.click('[data-ed="delete-yes"]')]);
const uidQ2 = await ready(Q);
check('the browser starts again as a new guest, on the founding page', !!uidQ2 && uidQ2 !== uidQ && !!(await Q.$('#d-name')));
check('the player is told', await until(async () => /have been deleted/.test(await toasts(Q))));
check('the nation, its summary and its posts are gone', (await restGet('nations/' + uidQ)).status === 404 && (await restGet('summaries/' + uidQ)).status === 404 && !(await restList('boards/meridian/posts')).some(p => p.fields.a.stringValue === uidQ));
check('and so is the account', !(await accountExists(uidQ)));
check('and the player’s support tickets', !(await restListAdmin('support')).some(t => t.fields.by.stringValue === uidQ) && !(await restListAdmin('slimits')).some(t => t.id === uidQ));

/* ── 5d. the privacy notice and the terms ──────────────────────────────── */
for (const [path, h] of [['/privacy', 'Privacy notice'], ['/privacidad', 'Aviso de privacidad'], ['/terms', 'Terms of use'], ['/terminos', 'Términos de uso']]) {
  const r = await fetch(BASE + path), t = await r.text();
  check(`${path} is served`, r.status === 200 && t.includes('<h1>' + h + '</h1>') && t.includes('p.slettenaar@gmail.com'));
}
for (const [from, to] of [['/privacy', '/privacidad'], ['/privacidad', '/privacy'], ['/terms', '/terminos'], ['/terminos', '/terms']]) {
  const t = await (await fetch(BASE + from)).text();
  check(`${from} has a button to ${to}`, new RegExp('class="lang" href="' + to + '"').test(t));
}
const home = await (await fetch(BASE + '/')).text();
check('the home page’s own HTML says what Edictum is and links to the privacy notice and terms', /multiplayer nation simulator/.test(home) && home.includes('href="/privacy"') && home.includes('href="/terms"'));
check('the game replaces that loading screen when it starts', !(await A.$('.boot')) && !(await Q.$('.boot')));
check('the side bar and the founding page link to both', !!(await A.$('.side-legal a[href="/privacy"]')) && !!(await A.$('.side-legal a[href="/terms"]')) && !!(await Q.$('.found-legal a[href="/terms"]')));
await M.ctx.close(); await N.ctx.close(); await Q.ctx.close();

/* ── 5e. edicts before the Senate (or the Crown), and the passport ───────── */
await nav(A, 'issues');
await until(() => A.$('.issue-card')); await A.click('.issue-card');
await A.waitForSelector('.edict .opt');
check('in a republic an edict goes before the Senate, its motions in Roman numerals', /Curia of Aldoria · Anno I/.test(await text(A, '.edict .form-code')) && /Speeches before the Senate/.test(await text(A, '.edict')) && /^Vote for motion I$/.test(await text(A, '.edict [data-act="answer"]')) && /^Veto$/.test(await text(A, '.edict [data-act="dismiss"]')));
await A.click('[data-act="close-issue"]');
const KG = await player('KG');
await open(KG);
await KG.waitForSelector('#d-name');
await KG.fill('#d-name', 'Kingsmoor'); await KG.click('[data-act="found-suggest"]');
await KG.selectOption('#d-pretitle', 'Kingdom'); await KG.click('#found-btn'); await KG.waitForSelector('.layout', { timeout: 10000 });
await nav(KG, 'issues');
await until(() => KG.$('.issue-card')); await KG.click('.issue-card'); await KG.waitForSelector('.edict .opt');
check('in a kingdom it goes before the Privy Council', /Privy Council of Kingsmoor/.test(await text(KG, '.edict .form-code')) && /^Assent to motion I$/.test(await text(KG, '.edict [data-act="answer"]')));
await KG.click('.edict [data-act="answer"]'); await KG.waitForSelector('.result');
check('and comes back a royal decree under a REX or REGINA seal', /^By royal decree of the \S+ of Kingsmoor, /.test(await text(KG, '.result-fx')) && /REX|REGINA/.test(await text(KG, '.result .stamp')), await text(KG, '.result-fx'));
await KG.ctx.close();
// the passport: A opens B's page and collects its entry stamp
await nav(A, 'region');
await until(() => A.$(`.tbl [data-act="visit"][data-id="${uidB}"]`)); await A.click(`.tbl [data-act="visit"][data-id="${uidB}"]`);
check('opening a nation’s page stamps its entry stamp into your passport', await until(async () => { const r = await nationDoc(uidA); return !!(r && r.rec.pp && r.rec.pp.v[uidB] && r.rec.pp.p[0].includes(uidB)); }, 15000));
check('its page shows the stamp and where it went', await until(async () => /In your passport since .* on page I\./.test(await text(A, '.pp-visit'))));
check('the first stamp earns First Stamp', await until(async () => !!(((await nationDoc(uidA)) || { rec: {} }).rec.ach || {})['pass-1'], 15000));
// B opens A's passport from A's page
await nav(B, 'region');
await until(() => B.$(`.tbl [data-act="visit"][data-id="${uidA}"]`)); await B.click(`.tbl [data-act="visit"][data-id="${uidA}"]`);
await until(() => B.$('.visit-acts [data-act="pp-view"]')); await B.click('.visit-acts [data-act="pp-view"]');
check('every nation’s page has View passport, which opens on the cover', !!(await until(() => B.$('#pp-view[aria-modal="true"] .pp-cover'))) && /Aldoria/.test(await text(B, '#pp-view-h')));
await B.keyboard.press('ArrowRight');                                        // the identity page and page I, side by side
check('its pages turn with the arrow keys, and carry the stamps', !!(await until(() => B.$(`#pp-view .pp-st[data-id="${uidB}"]`))));
check('turning the cover swings it open over the spine, and the page block shows at the edge', !!(await B.$('#pp-view .pp-flip, #pp-view .pp-spread')) && !!(await B.$('#pp-view .pp-edge')));
await B.click('#pp-view [data-act="pp-uv"]');
check('the UV lamp shows the fluorescent print', !!(await until(() => B.$('#pp-view .pp-book.uv .pp-uvl'))));
await B.click('#pp-view [data-act="pp-uv"]');
await until(() => B.$(`#pp-view .pp-st[data-id="${uidB}"]`));
await B.click(`#pp-view .pp-st[data-id="${uidB}"]`);
check('a stamp says where it came from', await until(async () => /Borvia/.test(await text(B, '#pp-view .pp-info'))));
await B.selectOption('#pp-view .pp-jump', '1');
check('the identity page shows the holder: a citizen with a photograph, a name and a matching machine-readable zone', await until(async () => {
  const ts = await B.$$eval('#pp-view .pp-bio text', els => els.map(e => e.textContent)), sur = ts[ts.indexOf('SURNAME') + 1] || '';
  return !!sur && ts.includes('DATE OF BIRTH') && ts.includes('PLACE OF BIRTH') && ts.some(t => t.startsWith('P<ALD' + sur.replace(/[^A-Z]+/g, '<') + '<<')) && (await B.$$('#pp-view .pp-bio svg[viewBox="0 0 80 100"]')).length === 2;
}));
await B.selectOption('#pp-view .pp-jump', '22');
check('the last page carries the observations, under the seal of state', await until(async () => /OBSERVATIONS/.test(await text(B, '#pp-view .pp-stage')) && /Curia of Aldoria/.test(await text(B, '#pp-view .pp-stage'))));
await B.keyboard.press('Escape');
check('Esc closes it', await until(async () => !(await B.$('#pp-view'))));
// A designs the passport and moves a stamp
await nav(A, 'passport');
await A.click('[data-act="pp-tab"][data-v="design"]');
await until(() => A.$('[data-act="pp-set"][data-f="c.col"][data-v="pc-green"]')); await A.click('[data-act="pp-set"][data-f="c.col"][data-v="pc-green"]');
await A.click('[data-act="pp-set"][data-f="c.col"][data-v="pc-purple"]');
check('a locked choice is marked, says how to earn it, and is not applied', !!(await A.$('.pp-tile.locked[data-v="pc-purple"]')) && await until(async () => /Locked\. Earn/.test(await toasts(A)), 40000) && (await localNation(A)).pp.c.col === 'pc-green');
await A.click('[data-act="pp-dtab"][data-v="s"]');
await until(() => A.$('[data-act="pp-set"][data-f="s.sh"][data-v="ps-ticket"]')); await A.click('[data-act="pp-set"][data-f="s.sh"][data-v="ps-ticket"]');
await A.fill('#pp-t2', 'Salve amice'); await A.press('#pp-t2', 'Tab');
check('the design is saved with the nation', await until(async () => { const r = await nationDoc(uidA); const p = r && r.rec.pp; return !!p && p.c.col === 'pc-green' && p.s.sh === 'ps-ticket' && p.s.t2 === 'SALVE AMICE' && (p.ds & 5) === 5; }, 15000));
await A.click('[data-act="pp-tab"][data-v="arrange"]');
await until(() => A.$(`.pp-arr .pp-st[data-id="${uidB}"]`)); await A.click(`.pp-arr .pp-st[data-id="${uidB}"]`);
await A.selectOption('#pp-move', '4');
check('the editor moves a stamp to another page', await until(async () => { const p = (await localNation(A)).pp.p; return p[4].includes(uidB) && !p[0].includes(uidB); }));
await A.fill('.pp-arr-t[data-pp-title="4"]', 'Old friends'); await A.press('.pp-arr-t[data-pp-title="4"]', 'Tab');
check('and titles pages', await until(async () => (await localNation(A)).pp.l[4] === 'Old friends'));
await A.click('[data-act="pp-tab"][data-v="design"]'); await A.click('[data-act="pp-dtab"][data-v="g"]');
const holder1 = await until(() => A.$eval('.pp-grp .hint b', e => e.textContent).catch(() => ''));
await A.click('[data-act="pp-holder"]');
check('the owner can issue the passport to another citizen', await until(async () => { const h = await A.$eval('.pp-grp .hint b', e => e.textContent).catch(() => ''); return !!h && h !== holder1 && Number.isInteger((await localNation(A)).pp.hs); }));
check('the tutorial counts a first stamp and a passport design, a land credit each', await until(async () => { const t = ((await nationDoc(uidA)) || { rec: {} }).rec.tut || {}; return Array.isArray(t.lc) && t.lc.includes('stamp') && t.lc.includes('ppdes'); }, 15000));

/* ── 6. Firebase blocked: browser-only mode ─────────────────────────────── */
const C = await player('C', { block: /\/vendor\/firebase\/|\/__\/firebase\//, inject: false });
const uidC = await open(C);
check('with Firebase blocked, use() resolves null', uidC === null);
await found(C, 'Cornmarsh');
check('the game plays in this browser only', /Offline/.test(await text(C, '.side-foot .mode')));
check('the account control says the game is offline', /Playing offline/.test(await text(C, '.ed-acct-b')));
await openAccount(C);
check('and offers no nation files any more', !(await C.$('[data-ed="export"], [data-ed="import"], .ed-file')));
await C.keyboard.press('Escape');
await C.reload(); await ready(C);
check('the local nation survives a reload', (await sideName(C)) === 'Cornmarsh');
// every 20 stamps earn a land credit: give the book 19, then open a computer nation's page
await C.evaluate(() => {
  const k = 'statehood.nation.v1', n = JSON.parse(localStorage.getItem(k)), v = {}, p = Array.from({ length: 20 }, () => Array(10).fill(0));
  for (let i = 0; i < 19; i++) { v['test-' + i] = ['Testland ' + i, 'meridian', Date.now() - i * 864e5, 'ps-circle', 'pb-single', 'pi-blue', 'c-star', '', 'ADMITTED']; p[Math.floor(i / 10)][i % 10] = 'test-' + i; }
  n.pp = { v, p, l: [] }; localStorage.setItem(k, JSON.stringify(n));
});
await C.reload(); await ready(C);
await nav(C, 'region');
const npc1 = await until(() => C.$eval('.tbl [data-act="visit"][data-id^="npc-"]', e => e.dataset.id).catch(() => null));
await C.click(`.tbl [data-act="visit"][data-id="${npc1}"]`);
check('the 20th stamp earns a land credit', await until(async () => { const n = await localNation(C); return !!n.pp && Object.keys(n.pp.v).length === 20 && n.pp.cr === 1; }, 10000));
check('and the player is told', await until(async () => /20 stamps in your passport: a land credit/.test(await toasts(C)), 40000));
// the Diplomata: one per nation, and it unlocks more passport designs
await nav(C, 'cities'); await until(() => C.$('[data-act="ct-open"]')); await C.click('[data-act="ct-open"]');
check('a city can build a Diplomata, one per nation', await until(async () => { const t = await text(C, '#app'); return /Diplomata/.test(t) && /Immigration \+3%\. One per nation\./.test(t); }));
await C.evaluate(() => { const k = 'statehood.nation.v1', n = JSON.parse(localStorage.getItem(k)); n.cities[0].b = (n.cities[0].b || []).concat([{ k: 'diplo', s: 1, d: 2, a: 1 }]); localStorage.setItem(k, JSON.stringify(n)); });
await C.reload(); await ready(C);
await nav(C, 'passport'); await C.click('[data-act="pp-tab"][data-v="design"]');
check('a finished Diplomata unlocks its typefaces and devices', await until(async () => (await C.$$('.pp-tiles-font .pp-tile')).length === 7 && !(await C.$('.pp-tiles-font .pp-tile.locked')) && !(await C.$('[data-f="c.emb"][data-v="pk-globe"].locked'))));
// a passport edict: its first answer unlocks a design no other way can (here, ultraviolet ink)
await C.click('[data-act="pp-dtab"][data-v="s"]');
check('a design that comes with an edict says which one', await until(async () => /Ink You Cannot See/.test(await text(C, '[data-f="s.ink"][data-v="pi-uv"]')) && !!(await C.$('[data-f="s.ink"][data-v="pi-uv"].locked'))));
await C.evaluate(() => { const k = 'statehood.nation.v1', n = JSON.parse(localStorage.getItem(k)); n.inbox = [{ id: 'pp-uv-ink', at: Date.now() }].concat(n.inbox || []).slice(0, 5); localStorage.setItem(k, JSON.stringify(n)); });
await C.reload(); await ready(C);
await nav(C, 'issues');
await until(() => C.$('.issue-card[data-id="pp-uv-ink"]')); await C.click('.issue-card[data-id="pp-uv-ink"]');
await C.waitForSelector('.edict [data-act="answer"]'); await C.click('.edict [data-act="answer"][data-o="0"]');
check('answering it that way unlocks the design, and the result says so', await until(async () => /Passport office/.test(await text(C, '.result')) && /Ultraviolet ink/.test(await text(C, '.result')) && ((await localNation(C)).ppx || []).includes('pi-uv')));
await nav(C, 'passport'); await C.click('[data-act="pp-tab"][data-v="design"]'); await C.click('[data-act="pp-dtab"][data-v="s"]');
check('and the editor offers it', await until(async () => !!(await C.$('[data-f="s.ink"][data-v="pi-uv"]')) && !(await C.$('[data-f="s.ink"][data-v="pi-uv"].locked'))));

/* ── 7. no injected config: init.json and the local emulators are found on their own ── */
const D0 = await player('D0', { inject: false });
check('the Hosting emulator’s init.json plus a demo project id reach the emulators', typeof (await open(D0)) === 'string');
await D0.ctx.close();

/* ── 8. Google sign-in (Auth emulator) ──────────────────────────────────── */
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
check('the guest nation left the region, summary and all', (await restGet('nations/' + uidF0)).status === 404 && (await restGet('summaries/' + uidF0)).status === 404);

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

/* ── 9. a full region sends newcomers on ───────────────────────────────── */
// with room for one active nation per region, Meridian (Aldoria, Borvia...) and the Frostmarch (Frostia)
// are full: a newcomer who has not chosen goes to the fullest region with room, here the next in the list
const Z = await player('Z', { cap: 1 });
await open(Z);
const zRegion = await until(async () => { const t = await text(Z, '.fr-now'); return t && !/Meridian Reach/.test(t) ? t : ''; }, 15000);
check('a newcomer facing a full region is moved to one with room', !!zRegion && !/Frostmarch/.test(zRegion), zRegion);
await ready(Z);
check('the full regions are marked in the region list', await until(async () => /Frostmarch Full/.test(await text(Z, '.fr-list'))));
await Z.evaluate(() => localStorage.setItem('statehood.region', 'meridian'));
await Z.reload(); await ready(Z);
await until(async () => /is full/.test(await text(Z, '.fr-box')));
await Z.fill('#d-name', 'Latecomer'); await Z.click('[data-act="found-suggest"]'); await Z.click('#found-btn');
check('founding in a full region is refused, with the reason', await until(async () => /Meridian Reach is full/.test(await text(Z, 'form .err'))) && !(await Z.$('.layout')));
await Z.ctx.close();

/* ── 10. switching region while founding keeps what was filled in ─────── */
const K = await player('K');
const uidK = await open(K);
await K.fill('#d-name', 'Keepsake');
await K.fill('#d-motto', 'Nothing Lost');
await K.click('#q0-2');
await K.click('[data-act="found-suggest"]');
await K.click('[data-act="found-browse"]');
await K.waitForSelector('.fr-grid [data-act="found-region"][data-id="driftlands"]');
check('section V has a region browser with every region', (await K.$$('.fr-grid .wr-card')).length === 26);
await Promise.all([K.waitForNavigation(), K.click('.fr-grid [data-act="found-region"][data-id="driftlands"]')]);
await ready(K);
check('choosing a region in the browser switches to it', (await K.evaluate(() => localStorage.getItem('statehood.region'))) === 'driftlands' && !/Meridian Reach/.test(await text(K, '.fr-now')));
check('the name, motto and answers come along', (await K.inputValue('#d-name')) === 'Keepsake' && (await K.inputValue('#d-motto')) === 'Nothing Lost' && (await K.getAttribute('#q0-2', 'aria-checked')) === 'true');
check('the capital’s spot, which belonged to the old map, does not', /No location chosen yet/.test(await text(K, '#found-loc')));
await K.reload(); await ready(K);
check('a reload keeps the draft too', (await K.inputValue('#d-name')) === 'Keepsake');
await K.click('.fr-more summary');
await Promise.all([K.waitForNavigation(), K.click('.fr-list [data-act="found-region"][data-id="frostmarch"]')]);
await ready(K);
check('the region list at the top keeps it as well', (await K.inputValue('#d-name')) === 'Keepsake' && (await K.evaluate(() => localStorage.getItem('statehood.region'))) === 'frostmarch');
await found(K, 'Keepsake');
check('the nation is founded in the chosen region, with its motto', await until(async () => { const d = await nationDoc(uidK); return d && d.reg === 'frostmarch' && d.rec.motto === 'Nothing Lost'; }));
check('and the draft is cleared once founded', (await K.evaluate(() => sessionStorage.getItem('statehood.draft'))) === null);
await K.ctx.close();

/* ── 10b. full-screen maps ──────────────────────────────────────────────── */
const FS = await player('FS');
await open(FS);
const fills = () => FS.evaluate(() => { const w = document.querySelector('.map-wrap.is-full'); if (!w) return false; const r = w.getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && document.documentElement.classList.contains('map-full-open'); });
await FS.click('.map-found [data-act="map-fs"]');
check('the founding map’s Full screen button fills the window', await until(fills));
check('its bar shows where the capital will stand', /No location chosen yet|will stand/.test(await text(FS, '#found-loc-fs')));
await FS.keyboard.press('Escape');
check('Esc leaves full screen', await until(async () => !(await FS.$('.map-wrap.is-full')) && !(await FS.evaluate(() => document.documentElement.classList.contains('map-full-open')))));
await found(FS, 'Fullview');
await FS.click('.map-fs-mini');
check('a nation page’s territory map opens full screen, as a map you can move and zoom', await until(async () => !!(await FS.$('.map-wrap.is-full canvas[data-map="visit"]')) && !!(await FS.$('.map-wrap.is-full [data-act="map-zoom"]')) && await fills()));
check('its bar names the nation', /Fullview/.test(await text(FS, '.map-fs-bar')));
await FS.click('.map-wrap.is-full [data-act="map-zoom"][data-d="1"]');
check('zooming in full screen keeps it open', await until(fills));
await FS.click('.map-wrap.is-full [data-act="map-fs-world"]');
check('Open in the world map goes there and leaves full screen', await until(async () => (await FS.evaluate(() => location.hash)) === '#map' && !(await FS.$('.map-wrap.is-full'))));
await FS.ctx.close();

/* ── 11. how it looks ───────────────────────────────────────────────────── */
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
