// End-to-end tests of the built site on the Firebase emulators:
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/e2e.mjs"
// Covers: two players sharing a region and its message board, a player in another region (not
// downloaded, but counted and listed on the World page), reloads, the security rules as the game
// meets them, battles rolled by the referee (functions/index.js) and its seals checked by other players,
// admin moderation, region steering when a region is full, browser-only mode when Firebase is blocked,
// keeping a founding draft across a region switch, the front page (its first paint, sample edict, region
// counts and Found buttons), and Google sign-in (linking, switching, signing out) with the Auth emulator's
// stand-in for Google.
import path from 'node:path';
import {
  BASE, OUT, register, check, finish, sleep, until, player, open, ready, found, nav, text, sideName, localNation,
  restGet, restList, restListAdmin, accountExists, restPatch, nationDoc, clearEmulators, setClaims, googlePopup, openAccount, errors, FS_HOST, PROJECT
} from './lib.mjs';

await clearEmulators();
const t0 = Date.now();

/* ── 1. two players in one region ───────────────────────────────────────── */
const A = await player('A');
const uidA = await open(A);
check('A gets an anonymous account at once', typeof uidA === 'string' && uidA.length > 10, uidA);
await found(A, 'Aldoria');
await until(()=>nationDoc(uidA));await register(A,{old:true});
const docA = await until(() => nationDoc(uidA));
check('A’s nation is saved to nations/<uid> in the stored shape, with the headline numbers the rules bound', docA && docA.v === 1 && docA.name === 'Aldoria' && docA.rec && docA.rec.name === 'Aldoria' && docA.keys.join() === 'army,cl,j,name,permit,pop,reg,rev,ts,updatedAt,v', docA && docA.keys.join());
const xA = await until(async () => { const r = await restGet('nationx/' + uidA); return r.status === 200 ? r.body.fields : null; });
const xrec = xA && xA.j ? JSON.parse(xA.j.stringValue) : {};
check('its private half is saved to nationx/<uid>, and the shared half leaves it out', xA && Object.keys(xA).sort().join() === 'j,t,ts' && Array.isArray(xrec.inbox) && typeof xrec.issueClock === 'number'
  && docA && docA.shared && !('inbox' in docA.shared) && !('issueClock' in docA.shared) && !('tly' in docA.shared), xA && Object.keys(xA).join());
const sumA = await restGet('summaries/' + uidA);
check('its summary is saved beside it', sumA.status === 200 && sumA.body.fields.name.stringValue === 'Aldoria' && sumA.body.fields.reg.stringValue === 'meridian');
check('a nation with no Moon, Mars or belt data has no space record', (await restGet('space/' + uidA)).status === 404);
check('the mode line says the region is connected', /Connected to/.test(await text(A, '.mode.world')));

const B = await player('B');
const uidB = await open(B);
await found(B, 'Borvia');
await until(()=>nationDoc(uidB));await register(B,{old:true});
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
check('a reload keeps the same account', uidA2 === uidA);
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
check('admin navigation is grouped into World, Moderation, Support, Game content and Operations', (await A.locator('.adm-nav-label').allTextContents()).join('|') === 'World|Moderation|Support|Game content|Operations');
check('the desktop admin menu sits to the left of its content', await A.evaluate(() => {
  const s = document.querySelector('.adm-sidebar').getBoundingClientRect(), m = document.querySelector('.adm-main').getBoundingClientRect();
  return s.width >= 200 && s.right < m.left && Math.abs(s.top - m.top) < 10;
}));
for (const [view, title] of [['admin-regions','Regions'],['admin-reports','Reports'],['admin-hidden','Hidden nations'],['admin-bans','Banned players'],['admin-sus','Suspicious nations'],['admin-help','Help queries']]) {
  await A.click(`.adm-nav [data-v="${view}"]`);
  check('the sidebar opens ' + title, await until(async () => await text(A, '.adm-main h1') === title && !!await A.$(`.adm-nav [data-v="${view}"][aria-current="page"]`) && new URL(A.url()).hash === '#' + view));
}
await A.click('.adm-nav [data-v="admin-reports"]');
await A.reload(); await ready(A);
check('a direct admin page survives reloading', await until(async () => await text(A, '.adm-main h1') === 'Reports'));
await A.click('.adm-nav [data-v="admin-regions"]');
await A.goBack();
check('browser Back restores the previous admin page', await until(async () => await text(A, '.adm-main h1') === 'Reports'));
await A.goForward();
check('browser Forward restores the next admin page', await until(async () => await text(A, '.adm-main h1') === 'Regions'));
await A.waitForSelector('.adm-main .tbl tbody tr');
await A.screenshot({ path: OUT + '/admin-sidebar-desktop.png', fullPage: true });
await A.setViewportSize({ width: 390, height: 844 });
check('on a phone the content fits and the drawer starts closed', await until(async () => await A.evaluate(() => !document.querySelector('#adm-menu').open && document.documentElement.scrollWidth <= innerWidth)));
await A.click('[data-act="adm-menu-open"]');
check('the phone menu opens as a modal drawer on the left', await A.evaluate(() => {
  const d = document.querySelector('#adm-menu'), r = d.getBoundingClientRect();
  return d.matches(':modal') && r.left === 0 && r.width <= innerWidth && d.getAttribute('role') === 'dialog';
}));
await A.screenshot({ path: OUT + '/admin-sidebar-phone.png' });
await A.evaluate(() => G.render());
check('a background redraw keeps the phone menu open', await A.evaluate(() => document.querySelector('#adm-menu').matches(':modal')));
await A.keyboard.press('Escape');
check('Escape closes the drawer and restores focus to its button', await until(async () => await A.evaluate(() => !document.querySelector('#adm-menu').open && document.activeElement.dataset.act === 'adm-menu-open')));
await A.evaluate(() => G.render());
check('a redraw after dismissal keeps the drawer closed and focus on its button', await A.evaluate(() => !document.querySelector('#adm-menu').open && document.activeElement.dataset.act === 'adm-menu-open'));
await A.click('[data-act="adm-menu-open"]');
await A.click('.adm-nav [data-v="admin-help"]');
check('choosing a phone menu item opens its page and closes the drawer', await until(async () => await text(A, '.adm-main h1') === 'Help queries' && !await A.evaluate(() => document.querySelector('#adm-menu').open)));
await A.click('[data-act="adm-menu-open"]');
await A.click('[data-act="adm-menu-close"]');
check('the close button dismisses the phone menu', !await A.evaluate(() => document.querySelector('#adm-menu').open));
await A.click('[data-act="adm-menu-open"]');
await A.setViewportSize({ width: 1280, height: 900 });
check('resizing to desktop restores the sidebar without a modal overlay', await until(async () => await A.evaluate(() => { const m = document.querySelector('#adm-menu'); return m.open && !m.matches(':modal') && m.getAttribute('role') === 'complementary'; })));
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
for (const view of ['admin-regions','admin-reports','admin-hidden','admin-bans']) {
  await B.goto(BASE + '/#' + view); await ready(B);
  check('a non-admin cannot open #' + view, await until(async () => !!await B.$('.layout') && !await B.$('.adm')));
}

/* ── 5b. reports, and hiding a nation ──────────────────────────────────── */
const M = await player('M');
const uidM = await open(M);
await found(M, 'Spamland');
await nav(M, 'region');
await register(M);
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
await until(() => N.$(`.tbl [data-act="visit"][data-id="${uidM}"]`)); await N.click(`.tbl [data-act="visit"][data-id="${uidM}"]`);
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
await until(() => O.$(`.tbl [data-act="visit"][data-id="${uidM}"]`)); await O.click(`.tbl [data-act="visit"][data-id="${uidM}"]`);
await O.click('[data-act="report-nation"]');
await O.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
await O.check('input[name="ed-reason"][value="cheating"]');
await O.click('[data-ed="report-yes"]');
await until(async () => (await restListAdmin('reports')).length === 1);
await A.click('[data-act="admin-refresh"]');
await A.locator('.adm-rep [data-act="adm-ban"]').first().click();
check('banning asks to confirm first, and says what happens', await until(async () => /can no longer play/.test(await text(A, '.adm-ask'))) && !(await restGet('bans/' + uidM).then(r => r.status === 200)));
await A.click('[data-act="adm-ban-yes"]');
check('Ban removes the nation and its records, and closes its tickets', await until(async () => (await restGet('nations/' + uidM)).status === 404 && (await restGet('nationx/' + uidM)).status === 404 && (await restGet('summaries/' + uidM)).status === 404 && (await restListAdmin('reports')).length === 0, 15000));
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
await until(() => P.$(`.tbl [data-act="visit"][data-id="${uidB}"]`)); await P.click(`.tbl [data-act="visit"][data-id="${uidB}"]`);
await P.click('[data-act="report-nation"]');
await P.waitForSelector('dialog.ed-dlg[open] [data-ed="report-yes"]');
await P.click('[data-ed="report-yes"]');
await until(async () => (await restListAdmin('reports')).length === 1);
await A.click('[data-act="admin-refresh"]');
await A.locator('.adm-rep [data-act="adm-close"]').first().click();
check('Close ticket closes it and leaves the nation alone', await until(async () => (await restListAdmin('reports')).length === 0) && (await restGet('nations/' + uidB)).status === 200);
await A.click('[data-act="admin-close"]');
await O.ctx.close(); await P.ctx.close();

/* ── 5b2. support tickets, and the admin's Help queries page ───────────── */
await nav(N, 'help');
await N.locator('#sup-box [data-act="sup-new"]').first().click();
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
await A.locator('.adm-nav [data-v="admin-help"]').first().click();
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
await Q.locator('#sup-box [data-act="sup-new"]').first().click(); // a locator, not a handle: the page may redraw in between
await Q.waitForSelector('dialog.ed-dlg[open] [data-ed="support-yes"]');
await Q.fill('#ed-sup-x', 'How do I leave for good?');
await Q.click('[data-ed="support-yes"]');
await until(async () => (await restListAdmin('support')).some(t => t.fields.by.stringValue === uidQ));
await nav(Q, 'region');
await register(Q);
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
const leftQ = async () => [(await restGet('nations/' + uidQ)).status !== 404 && 'nation', (await restGet('nationx/' + uidQ)).status !== 404 && 'private half', (await restGet('summaries/' + uidQ)).status !== 404 && 'summary', (await restList('boards/meridian/posts')).some(p => p.fields.a.stringValue === uidQ) && 'posts'].filter(Boolean);
check('the nation, its summary and its posts are gone', await until(async () => !(await leftQ()).length), 'still there: ' + (await leftQ()).join(', '));
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
await nav(KG, 'nation'); // founding opens the map to claim the first land
await KG.click('[data-act="pg-charter"]');
await nav(KG, 'issues');
await until(() => KG.$('.issue-card')); await KG.click('.issue-card'); await KG.waitForSelector('.edict .opt');
check('in a kingdom it goes before the Privy Council', /Privy Council of Kingsmoor/.test(await text(KG, '.edict .form-code')) && /^Assent to motion I$/.test(await text(KG, '.edict [data-act="answer"]')));
await KG.click('.edict [data-act="answer"]'); await KG.waitForSelector('.result');
check('and comes back a royal decree under a REX or REGINA seal', /^By royal decree of the \S+ of Kingsmoor, /.test(await text(KG, '.result-fx')) && /REX|REGINA/.test(await text(KG, '.result .stamp')), await text(KG, '.result-fx'));
check('signed by the nation’s own leader, by title while the leader has no name', /^By royal decree of the President of Kingsmoor, /.test(await text(KG, '.result-fx')), await text(KG, '.result-fx'));
// who signs decrees is a choice on the Customise page
await nav(KG, 'settings'); await KG.fill('#s-ruler', 'Ada Brook'); await KG.click('#settings-form button[type="submit"]');
await until(async () => ((await localNation(KG)) || {}).ruler === 'Ada Brook');
await nav(KG, 'customise');
check('once the leader has a name, decrees give it', await until(async () => /By royal decree of President Ada Brook of Kingsmoor, …/.test(await text(KG, '.cz-ds-ex'))), await text(KG, '.cz-ds-ex'));
await KG.click('#cz-l-ds-s');
check('signed by the type of state, they read as they used to', await until(async () => /By royal decree of the Crown of Kingsmoor/.test(await text(KG, '.cz-ds-ex')) && ((await localNation(KG)).cz || {}).ds === 's'));
await KG.click('#cz-l-ds-t');
check('and by the leader’s title, without the name', await until(async () => /By royal decree of the President of Kingsmoor/.test(await text(KG, '.cz-ds-ex')) && ((await localNation(KG)).cz || {}).ds === 't'));
await KG.click('#cz-l-ds-l');
await until(async () => (await KG.getAttribute('#cz-l-ds-l', 'aria-pressed')) === 'true');
await KG.locator('#cz-sec-s').screenshot({ path: path.join(OUT, 'customise-decrees.png') }); // a locator: choosing redraws the page
await KG.ctx.close();
// the passport: A opens B's page and collects its entry stamp
await nav(A, 'region');
await until(() => A.$(`.tbl [data-act="visit"][data-id="${uidB}"]`)); await A.click(`.tbl [data-act="visit"][data-id="${uidB}"]`);
check('opening a nation’s page stamps its entry stamp into your passport', await until(async () => { const r = await nationDoc(uidA); return !!(r && r.rec.pp && r.rec.pp.v[uidB] && r.rec.pp.p[0].includes(uidB)); }, 15000));
check('the stamps stay in the private half; the shared half counts them by hash', await until(async () => { const r = await nationDoc(uidA); return !!(r && !r.shared.pp.v && Array.isArray(r.shared.pph) && r.shared.pph.length === Object.keys(r.rec.pp.v).length); }, 15000));
check('its page shows the stamp and where it went', await until(async () => /In your passport since .* on page I\./.test(await text(A, '.pp-visit'))));
check('the first stamp earns First Stamp', await until(async () => !!(((await nationDoc(uidA)) || { rec: {} }).rec.ach || {})['pass-1'], 15000));
// the banner's stamps: a seat in the Assembly, the Delegate's chair, an alliance
// its seat shows as Member, or as Delegate when the computer nations happen to back it (only the highest stamp shows)
check('a player nation’s banner is stamped with its Assembly seat, and with no alliance it has none', await until(async () => /Meridian Reach Assembly\s*Member|Assembly\s*Delegate\s*of Meridian Reach/.test(await text(A, '.hero .hero-stamps'))) && !(await A.$('.hero .hs-al')));
if (await A.$(`[data-act="asm-end"][data-id="${uidB}"]`)) {
  await A.click(`[data-act="asm-end"][data-id="${uidB}"]`);
  if(!await until(()=>A.evaluate(id=>G.S.civic?.own.e.some(e=>e.i===id&&!e.w),uidB),15000))throw Error('The endorsement was not confirmed by the Assembly.');
}
await nav(A, 'region');
await until(() => A.$('.tbl [data-act="visit"][data-id="npc-vellmark"]')); await A.click('.tbl [data-act="visit"][data-id="npc-vellmark"]');
check('a computer nation’s shows its seat and its alliance', await until(async () => /Member/.test(await text(A, '.hero .hs-asm')) && /The Iron Compact/.test(await text(A, '.hero .hs-al'))));
await until(async()=>{await A.locator('.hero').screenshot({ path: path.join(OUT, 'banner-stamps.png') });return true;});
await nav(A, 'assembly');
const delName = await until(() => text(A, '.asm-del-n'));
await nav(A, 'nation');
const delA = !!(await A.$('.hero .hs-del')), memA = !!(await A.$('.hero .hs-asm'));
await nav(A, 'region'); await until(() => A.$(`.tbl [data-act="visit"][data-id="${uidB}"]`)); await A.click(`.tbl [data-act="visit"][data-id="${uidB}"]`); await A.waitForSelector('.hero');
const delB = !!(await A.$('.hero .hs-del')), memB = !!(await A.$('.hero .hs-asm'));
check('the Delegate’s stamp is on the nation the Assembly names, and on no other', !!delName && /Aldoria/.test(delName) === delA && /Borvia/.test(delName) === delB && !(delA && delB), JSON.stringify({ delName, delA, delB }));
check('each member shows only its highest seat: the Delegate, or a member', delA !== memA && delB !== memB, JSON.stringify({ delA, memA, delB, memB }));
check('an admin sees no staff pill on a player’s banner', !(await A.$('.hero .staff-pill')));
// B opens A's passport from A's page
await nav(B, 'region');
await until(() => B.$(`.tbl [data-act="visit"][data-id="${uidA}"]`)); await B.click(`.tbl [data-act="visit"][data-id="${uidA}"]`);
check('an admin’s nation is marked Edictum staff on its banner, for other players too', await until(async () => /Edictum staff/.test(await text(B, '.hero .hero-cat')), 15000));
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
check('a nation in browser-only mode has an Offline sync indicator', await text(C, '.ed-sync') === 'Offline');
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

/* ── 7b. Edictum staff, in posts and messages ───────────────────────────── */
await nav(B, 'region');
check('an admin’s board posts carry the staff pill', await until(async () => B.$$eval('.post', ps => ps.some(p => /Aldoria/.test((p.querySelector('.post-h') || {}).textContent || '') && !!p.querySelector('.staff-pill'))), 15000));
await nav(A, 'messages');
await A.selectOption('#dm-new', uidB); await A.waitForSelector('#dm-text');
await A.fill('#dm-text', 'Hello from the Edictum team.'); await A.click('#dm-form button[type="submit"]');
await nav(B, 'messages');
await until(() => B.$(`[data-act="dm-peer"][data-id="${uidA}"]`), 20000); await B.click(`[data-act="dm-peer"][data-id="${uidA}"]`);
check('a message from staff says it comes from the Edictum team', await until(async () => /Edictum team/.test(await text(B, '.staff-note')) && /Edictum staff/.test(await text(B, '.bub.staff .bub-staff')) && /Edictum staff/.test(await text(B, `[data-act="dm-peer"][data-id="${uidA}"]`))));
await B.locator('.thread').screenshot({ path: path.join(OUT, 'staff-message.png') });

/* ── 7c. battles, rolled by the referee ─────────────────────────────────── */
const ownerDoc = (p, init) => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, Object.assign({ headers: { 'content-type': 'application/json', authorization: 'Bearer owner' } }, init));
const ownerFields = async p => ((await (await ownerDoc(p)).json()) || {}).fields || {};
// The battle fixture must start from a confirmed revision, as a real client now does.
await until(async () => { const n = await localNation(A); return n && !n._dirty && await text(A, '.ed-sync') === 'Synced'; }, 15000);
// A has grown past the 10 million war needs, with an army that can win, its capital beside a computer
// nation's border, and is at war with it (its record written past the rules, as a long game would have it)
const war = await A.evaluate(() => {
  const keep = G.S.nation, now = Date.now(), M = G.MAP;
  try {
    // free land a few hexes from a computer nation's, nearest first
    const T0 = G.territory(), dist = new Int16Array(M.N).fill(-1), q = [];
    for (let c = 0; c < M.N; c++) { const o = T0.owner[c]; if (o >= 0 && T0.list[o].npc) { dist[c] = 0; q.push(c); } }
    for (let i = 0; i < q.length; i++) for (let d = 0; d < 6; d++) { const nb = M.nbr[q[i] * 6 + d]; if (nb >= 0 && dist[nb] < 0) { dist[nb] = dist[q[i]] + 1; q.push(nb); } }
    const spots = [];
    for (let c = 0; c < M.N; c++) if (M.T[c] >= 2 && T0.owner[c] < 0 && dist[c] >= 3 && dist[c] <= 5) spots.push(c);
    spots.sort((a, b) => dist[a] - dist[b]);
    for (const pop of [12, 50, 200]) for (const spot of spots.slice(0, 24)) {
      const n = G.clone(keep); Object.assign(n, { pop, popAt: now, updatedAt: now, loc: G.locOf(spot), claims: [], wars: {} }); n.s = { ...n.s, mil: 100 };
      for (const x of G.allNations()) if (x.npc) n.wars[x.id] = { t: now - 60000 };
      G.S.nation = n;
      const T = G.territory(), mi = T.byId[G.myId()];let best = null;
      if (mi === undefined) continue;
      for (const [cell, reach] of G.frontier(T)) { const bi = T.owner[cell], o = T.list[bi]; if (!o || !o.npc) continue; const p = G.battle(T, cell, mi, bi, reach).p; if (!best || p > best.p) best = { cell, p, npc: o.id }; }
      if (best && best.p >= 0.7) { n.wars = { [best.npc]: { t: now - 60000 } }; n.apw = Math.round(G.armyPower(n) * 1000) / 1000; return { n, keep: G.clone(keep), ...best }; }
    }
    return null;
  } finally { G.S.nation = keep; }
});
check('A can reach a computer nation’s land, with good odds', !!war, war ? `${Math.round(war.p * 100)}% against ${war.npc}` : 'no target');
const putA = rec => ownerDoc('nations/' + uidA, { method: 'PATCH', body: JSON.stringify({ fields: { v: { integerValue: '1' }, j: { stringValue: JSON.stringify(rec) }, reg: { stringValue: rec.reg },
  name: { stringValue: rec.name }, updatedAt: { integerValue: String(rec.updatedAt) }, ts: { timestampValue: new Date().toISOString() }, pop: { doubleValue: Math.round(rec.pop * 1e4) / 1e4 },
  army: { doubleValue: rec.apw || 0 }, cl: { integerValue: String((rec.claims || []).length) }, rev: { integerValue: String(rec._rev) } } }) });
await putA(war.n);
await A.evaluate(n => { G.S.nation = n; G.saveLocal(n); G.render(); }, war.n);
await nav(A, 'map');
const pick = () => A.evaluate(npc => { const T = G.territory(), mi = T.byId[G.myId()];let best = null;
  for (const [cell, reach] of G.frontier(T)) { const bi = T.owner[cell], o = T.list[bi]; if (!o || o.id !== npc) continue; const p = G.battle(T, cell, mi, bi, reach).p; if (!best || p > best.p) best = { cell, p }; }
  return best; }, war.npc);
const fight = async cell => {
  await A.evaluate(c => { G.S.mapTarget = c; G.S.warMsg = ''; G.updateMapPanel(); }, cell);
  await A.click('#map-panel [data-act="attack"]');
  return until(() => A.evaluate(() => /Victory|held the line|not ready|could not be reached/.test(G.S.warMsg || '') ? G.S.warMsg : ''), 20000);
};
let fights = 0, won = null, msg = '';
while (fights < 4 && won == null) { const tg = await pick(); if (!tg) break; fights++; msg = await fight(tg.cell); if (/^Victory/.test(msg || '')) won = tg.cell; }
check('an attack from the war map is rolled by the referee, and a victory takes the hex', won != null, msg);
const army = await ownerFields('armies/' + uidA);
check('the referee keeps the battles and the army’s readiness', army.n && Number(army.n.integerValue) === fights && Number(army.r.integerValue) === 7 - fights, JSON.stringify(army));
const own = await A.evaluate(c => { const e = (G.S.nation.conq || []).find(x => x.c === c); return e ? { e, ok: G.REF.ok.get(G.refK(G.myId(), e)), ready: G.readiness(G.S.nation, Date.now()).r } : null; }, won);
check('the conquest carries the server’s time and the referee’s seal', own && typeof own.e.s === 'string' && own.e.s.length > 80 && own.ok === true && own.ready === 6 - fights, JSON.stringify(own));
check('and another player’s game counts it, having checked the seal', await until(() => B.evaluate(([c, a]) => { const T = G.territory(); return T.owner[c] === T.byId[a]; }, [won, uidA]), 20000));
await A.screenshot({ path: path.join(OUT, 'referee-victory.png') });
// Keep the sender from overwriting the administrator's tamper fixture during the observer assertion.
await A.evaluate(()=>{G.S.mode='readonly';G.render();});
// conquests typed into A's record past the game: one without a seal, one with the seal of another hex
await sleep(2500);
const spare = await A.evaluate(npc => { const T = G.territory(), out = []; for (const [cell] of G.frontier(T)) { const o = T.list[T.owner[cell]]; if (o && o.id === npc) out.push(cell); } return out.slice(0, 2); }, war.npc);
const fA = await ownerFields('nations/' + uidA), recA = JSON.parse(fA.j.stringValue), at = Date.now();
recA.conq = recA.conq.concat({ c: spare[0], t: at - 2000 }, { c: spare[1], t: at - 1000, s: own.e.s }); recA.updatedAt = at;
await ownerDoc('nations/' + uidA, { method: 'PATCH', body: JSON.stringify({ fields: { ...fA, j: { stringValue: JSON.stringify(recA) }, updatedAt: { integerValue: String(at) }, ts: { timestampValue: new Date().toISOString() } } }) });
check('another player’s game counts neither, and says why', spare.length === 2 && await until(() => B.evaluate(([a, at, cs]) => {
  const x = G.S.world[a]; if (!x || x.updatedAt !== at) return false;
  const T = G.territory(), why = (G.AUDIT.get(a) || {}).why || [];
  return cs.every(c => T.owner[c] !== T.byId[a]) && why.some(w => /no seal from the referee/.test(w)) && why.some(w => /a seal the referee did not make/.test(w)); }, [uidA, at, spare]), 20000), JSON.stringify(spare));
await A.evaluate(()=>{G.S.mode='world';G.render();});
// the referee's count of readiness is the one that holds: spent elsewhere, the page's next attack is refused
const drained = await A.evaluate(async npc => { const api = await window.claude.use('referee'); for (let i = 0; i < 9; i++) { const r = await api.battle({ d: npc, c: 0, p: 0.05 }); if (!r.ok) return r.why; } return 'never'; }, war.npc);
const tg = await pick();
msg = tg ? await fight(tg.cell) : '';
check('with the referee’s readiness spent, an attack is refused and the page shows none left', drained === 'ready' && /not ready/.test(msg || '') && await A.evaluate(() => G.readiness(G.S.nation, Date.now()).r === 0), `${drained}: ${msg}`);
// A goes back to the nation it was, for what follows
await until(async () => { const n = await localNation(A); return n && !n._dirty && await text(A, '.ed-sync') === 'Synced'; }, 15000);
await A.evaluate(n => { n._rev = G.S.nation._rev; n.updatedAt = Date.now(); G.S.nation = n; G.saveLocal(n); G.S.warMsg = ''; G.S.mapTarget = null; G.commit(G.clone(n)); }, war.keep);
await nav(A, 'nation');

/* ── 7d. fair play ──────────────────────────────────────────────────────── */
// the rules refuse a save that grows a nation tenfold since its last
const forged = await B.evaluate(async uid => { const db = await window.claude.use('db'); const r = (await db.doc('nations/' + uid).get()).data(); r.pop = r.pop * 10; r.updatedAt = Date.now();
  try { await db.doc('nations/' + uid).set(r); return 'saved'; } catch (e) { return (e && e.code) || String(e); } }, uidB);
check('a save that grows a nation tenfold since its last is refused', forged !== 'saved', forged);
// a record written past the game: every game holds it to its save's figures, and the admin portal lists it
const cheatRec = JSON.parse((await restGet('nations/' + uidB)).body.fields.j.stringValue);
Object.assign(cheatRec, { name: 'Cheatonia', pop: 900, popAt: Date.now(), founded: Date.now() - 2 * 864e5, updatedAt: Date.now(), stock: { food: 60, timber: 9999, iron: 25, oil: 10, goods: 40 } });
for (const k of ['loc', 'claims', 'conq', 'cities', 'alli', 'allyOf', 'wars', 'peace', 'asm', 'dm', 'pp']) delete cheatRec[k];
cheatRec.conq = [{ c: 5, t: Date.now() - 60000 }, { c: 6, t: Date.now() - 30000, s: own.e.s }];  // no seal, and another's
await ownerDoc('nations/cheat-1', { method: 'PATCH', body: JSON.stringify({ fields: { v: { integerValue: '1' }, j: { stringValue: JSON.stringify(cheatRec) }, reg: { stringValue: 'meridian' }, name: { stringValue: 'Cheatonia' },
  updatedAt: { integerValue: String(cheatRec.updatedAt) }, ts: { timestampValue: new Date().toISOString() }, pop: { doubleValue: 10 }, army: { doubleValue: 1 }, cl: { integerValue: '0' } } }) });
await nav(A, 'region');
check('every game holds a forged record to its save’s figures: 10 million people, not 900', await until(async () => A.$$eval('.tbl tr', rs => rs.some(r => /Cheatonia/.test(r.textContent) && /(^|[^\d.])10\.\d million/.test(r.textContent) && !/900 million/.test(r.textContent))), 15000));
await A.evaluate(() => { location.hash = '#admin-sus'; });
check('the admin portal lists it as suspicious, with the reasons', await until(async () => { const t = await text(A, '.sus-list'); return /Cheatonia/.test(t) && /claims 900 million people; its save declared 10\.0 million/.test(t)
  && /One of its conquests carries no seal from the referee/.test(t) && /One of its conquests carries a seal the referee did not make/.test(t); }, 15000), await text(A, '.sus-list'));
await A.screenshot({ path: path.join(OUT, 'admin-suspicious.png'), fullPage: true });
await A.click('.sus-list [data-act="sus-hide"][data-id="cheat-1"]');
check('and Hide hides it from the other players', await until(async () => { const r = await restGet('mod/cheat-1'); return r.status === 200 && r.body.fields.hidden.booleanValue === true; }));
await ownerDoc('nations/cheat-1', { method: 'DELETE' }); await ownerDoc('mod/cheat-1', { method: 'DELETE' });
await A.evaluate(() => { location.hash = '#nation'; }); await sleep(300);

await B.evaluate(async()=>{await firebase.auth().currentUser.unlink('password');await firebase.auth().currentUser.reload();window.dispatchEvent(new Event('edictum:linked'));});
check('the unlinked fixture returns to Guest eligibility',await until(()=>B.evaluate(()=>G.S.civic?.account.kind==='guest')));
/* ── 8. Google sign-in (Auth emulator) ──────────────────────────────────── */
// the first steps offer it, with what it pays; the button opens the account dialog
await nav(B, 'nation');
check('a guest’s first steps offer linking to Google, for 5 land credits', /Keep your nation on every device\s*\+5 land/.test(await text(B, '.stp')),JSON.stringify(await B.evaluate(()=>({name:G.S.nation?.name,onb:G.S.nation?.onb,glk:G.S.nation?.glk,google:G.S.google,account:G.S.civic?.account,view:G.S.view,steps:[...document.querySelectorAll('.stp')].map(e=>e.textContent.trim().slice(0,160))}))));
await B.click('.stp [data-act="acct-open"]');
check('its button opens the account dialog', !!(await until(() => B.$('dialog.ed-dlg[open] [data-ed="google"]'))));
await B.keyboard.press('Escape');
// a. A guest with a nation links Google: same uid
const glA0 = await localNation(A);
await openAccount(A);
await googlePopup(A, '[data-ed="google"]', 'alice@example.com');
check('linking keeps the guest’s uid', await until(async () => (await ready(A)) === uidA));
check('the control shows the Google account', await until(async () => /alice@example\.com/.test(await text(A, '.ed-acct-b'))));
check('the dialog says the nation is kept with the account', /Linked/.test(await text(A, '.ed-msg')));
await A.keyboard.press('Escape');
const glA1 = await until(async () => { const n = await localNation(A); return n && n.glk === 1 ? n : null; }, 10000);
const glGain = r => glA1.stock[r] - glA0.stock[r];
check('linking completes the first step, once, with 5 iron, 5 timber and 5 goods', !!glA1 && ['iron', 'timber', 'goods'].every(r => glGain(r) > 4.9 && glGain(r) < 6), JSON.stringify(glA1 && [glA0.stock, glA1.stock]));
check('and says so, with its 5 land credits', await until(async () => /kept with your Google account\. \+5 land credits/.test(await toasts(A)), 40000)); // behind the battles' toasts

// b. a new device signs in to that account from the founding screen
const E = await player('E');
const uidE0 = await open(E);
check('the founding screen has a sign-in control', /Sign in/.test(await text(E, '.found-head .ed-acct-b')));
check('the founding screen has no nation sync indicator', !(await E.isVisible('.ed-sync')));
await openAccount(E);
await Promise.all([E.waitForNavigation({ timeout: 15000 }), googlePopup(E, '[data-ed="google"]', 'alice@example.com')]);
const uidE = await ready(E);
check('the second device is now A’s account', uidE === uidA && uidE0 !== uidA);
check('and plays A’s nation', await until(async () => (await sideName(E)) === 'Aldoria'));
// On another device, a completed Google step must not re-enter the ordinary tutorial reward loop.
await E.evaluate(() => {
  window.googleStepToasts=[];
  new MutationObserver(()=>{for(const el of document.querySelectorAll('.toast'))if(/Step done: Keep your nation on every device/.test(el.textContent))window.googleStepToasts.push(el.textContent);}).observe(document.body,{childList:true,subtree:true,characterData:true});
  for(let i=0;i<3;i++)window.G.commit(window.G.clone(window.G.S.nation));
});
await sleep(7500);
check('the second device keeps the paid Google reward after repeated saves', (await localNation(E)).glk === 1);
check('repeated saves do not show the ordinary Google step toast again', await E.evaluate(() => window.googleStepToasts.length === 0));

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
check('the guest nation left the region, summary and all', (await restGet('nations/' + uidF0)).status === 404 && (await restGet('nationx/' + uidF0)).status === 404 && (await restGet('summaries/' + uidF0)).status === 404);

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
check('a Google account has a Sign out button under the account control', await E.isVisible('.side-foot .ed-out'));
check('the sync indicator sits directly above Sign out', await E.locator('.ed-out').evaluate(el => el.previousElementSibling.classList.contains('ed-sync') && !el.previousElementSibling.hidden && el.previousElementSibling.getBoundingClientRect().bottom <= el.getBoundingClientRect().top));
for (const scheme of ['light', 'dark']) {
  await E.emulateMedia({ colorScheme: scheme });
  await E.hover('.side-foot .ed-out');
  for(let attempt=0;;attempt++)try{
    await E.locator('.side-foot').screenshot({ path: path.join(OUT, `signout-button-${scheme}.png`) });break;
  }catch(e){if(attempt>=2||!/not attached|detached/i.test(e.message))throw e;await sleep(100);}
}
await E.emulateMedia({ colorScheme: 'light' });
check('a Guest Nation also has a Sign out button', !!(await B.$('.side-foot .ed-acct')) && await B.isVisible('.ed-out'));
await openAccount(E);
await E.click('[data-ed="signout"]');
check('signing out from the account dialog asks first', /Sign out\?/.test(await text(E, '#ed-dlg-h')));
await E.click('[data-ed="back"]');
check('and Cancel there goes back to the account', /Your linked account/.test(await text(E, '#ed-dlg-h')));
await E.keyboard.press('Escape');
await E.click('.side-foot .ed-out');
await E.waitForSelector('dialog.ed-dlg[open]');
check('the Sign out button asks first too', /Sign out\?/.test(await text(E, '#ed-dlg-h')));
await E.click('[data-ed="close"]');
check('and its Cancel simply closes the dialog', await until(async () => !(await E.$('dialog.ed-dlg[open]'))));
await E.click('.side-foot .ed-out');
await E.waitForSelector('[data-ed="signout-yes"]');
await E.screenshot({ path: path.join(OUT, 'signout-dialog-1280.png') });
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
// the world map itself, with its panel floating over it
const fillsMain = () => FS.evaluate(() => { const w = document.querySelector('.map-wrap.is-full'); if (!w || !w.querySelector('canvas[data-map="main"]')) return false; const r = w.getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; });
await FS.click('.map-main [data-act="map-fs"]');
check('the world map’s Full screen button fills the window', await until(fillsMain));
check('its bar names the region and the date', /^Map of \S/.test(await text(FS, '.map-fs-bar .map-fs-t')) && /\d/.test(await text(FS, '.map-fs-bar .map-fs-loc')));
check('and the map’s panel floats over it, clear of the controls', await FS.evaluate(() => { const p = document.getElementById('map-panel'), c = document.querySelector('.map-wrap.is-full .map-ctrl'); if (!p || !c) return false; const a = p.getBoundingClientRect(), b = c.getBoundingClientRect(); return getComputedStyle(p).position === 'fixed' && a.width > 200 && a.right <= b.left; }));
await FS.waitForTimeout(400);
await FS.screenshot({ path: path.join(OUT, 'map-full-1280.png') });
await FS.click('.map-wrap.is-full [data-act="map-zoom"][data-d="1"]');
check('zooming the world map in full screen keeps it open', await until(fillsMain));
await FS.click('.map-fs-bar [data-act="map-fs-close"]');
check('Close leaves full screen, on the map page', await until(async () => !(await FS.$('.map-wrap.is-full')) && (await FS.evaluate(() => location.hash)) === '#map'));
await FS.ctx.close();

/* ── 10c. the front page ────────────────────────────────────────────────── */
// The page itself (build.py) opens with the front page's heading copy, the same as the game then draws.
const raw = await (await fetch(BASE + '/')).text();
const plain = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rawOf = re => { const m = raw.match(re); return m ? plain(m[1]) : null; };
const HP = await player('HP');
await open(HP);
await HP.waitForSelector('#hm-try');
const drawn = await HP.evaluate(() => ({
  title: document.title, h1: document.querySelector('.found-intro h1').textContent, lede: document.querySelector('.found-intro .lede').textContent,
  feats: [...document.querySelectorAll('.hm-feats li')].map(li => li.textContent), free: document.querySelector('.hm-free').textContent
}));
check('before the game’s script runs, the page shows the front page’s title, heading, lede and features as the game draws them',
  rawOf(/<title>([^<]*)<\/title>/) === drawn.title && rawOf(/class="found home-static">[\s\S]*?<h1 class="display">([^<]*)<\/h1>/) === drawn.h1
  && rawOf(/class="found home-static">[\s\S]*?<p class="lede">([^<]*)<\/p>/) === drawn.lede && rawOf(/<p class="hm-free">([^<]*)<\/p>/) === drawn.free
  && JSON.stringify([...raw.matchAll(/<li><span class="hm-ic[^>]*><\/span>([^<]*)<\/li>/g)].map(m => plain(m[1]))) === JSON.stringify(drawn.feats) && drawn.feats.length >= 4,
  JSON.stringify(drawn).slice(0, 200));
check('it tells search engines what the game is', /"@type": "VideoGame"/.test(raw));
// a sample edict, worded for the nation being drafted, that changes nothing
await HP.fill('#d-name', 'Quillon'); await HP.fill('#d-currency', 'florin');
check('the sample edict is worded for the nation being drafted', await until(async () => /Quillon/.test(await text(HP, '#hm-try .form-code')) && /counterfeit florin notes/.test(await text(HP, '#hm-try'))));
await HP.click('#hm-try [data-act="hm-try"][data-o="2"]');
check('answering it shows the decree and what it would change', await until(async () => /By decree of the President, with the Senate and People of Quillon, notes featuring a cat are accepted as legal tender/.test(await text(HP, '.hm-fx')) && /Weirdness/.test(await text(HP, '.hm-chg'))));
const try1 = await text(HP, '.hm-try-t');
await HP.click('[data-act="hm-next"]');
check('Try another edict brings a different one, unanswered', await until(async () => (await text(HP, '.hm-try-t')) !== try1 && !!(await HP.$('#hm-try [data-act="hm-try"]'))));
check('nothing chosen there founds or changes a nation', !(await localNation(HP)));
check('the region box counts the player nations here and shows their flags', await until(async () => /\d+ player nations? and \d+ computer-run nations live here/.test(await text(HP, '#found-life')) && (await HP.$$('#found-life .fr-flags li')).length === 9));
// the Found button beside the preview
await HP.click('#found-now');
check('the Found button beside the preview founds the nation', await until(async () => !!(await HP.$('.layout')) && ((await localNation(HP)) || {}).name === 'Quillon'));
check('the title follows the game’s pages again', await until(async () => / · Edictum$/.test(await HP.title()) && (await HP.title()) !== drawn.title));
await HP.route(/\/assets\/game\./, r => r.abort());
await HP.reload();
check('a returning player gets a loading screen for a failed download, not the front page', await HP.evaluate(() => document.documentElement.classList.contains('ed-back')) && await until(() => HP.isVisible('.boot')) && !(await HP.isVisible('.home-static')));
await HP.ctx.close();
// on a phone: the preview makes way, and a bar at the foot keeps the Found button in reach
const HQ = await player('HQ', { vp: { width: 390, height: 844 } });
await open(HQ);
await HQ.fill('#d-name', 'Barnstow'); await HQ.evaluate(() => document.activeElement.blur());
check('on a phone a bar at the foot shows the nation and its Found button', await until(async () => /Barnstow/.test(await text(HQ, '#found-bar')) && await HQ.isVisible('#found-now-bar')));
check('the preview card makes way for the form', !(await HQ.isVisible('.found-side')));
await HQ.focus('#d-motto');
check('the bar keeps out of the way while typing', await until(async () => !(await HQ.isVisible('#found-now-bar'))));
await HQ.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, document.body.scrollHeight); });
check('and while the charter’s own Found button is on screen', await until(async () => !(await HQ.isVisible('#found-now-bar'))));
await HQ.evaluate(() => window.scrollTo(0, 0));
await until(() => HQ.isVisible('#found-now-bar'));
await HQ.click('#found-now-bar');
check('the bar’s button founds the nation from the top of the page', await until(async () => ((await localNation(HQ)) || {}).name === 'Barnstow'));
await HQ.ctx.close();

/* ── 10d. national symbols open as the population grows ─────────────────── */
// browser-only, so the test can set the population in the browser's copy of the nation
const SY = await player('SY', { block: /\/vendor\/firebase\/|\/__\/firebase\//, inject: false });
await open(SY);
await found(SY, 'Symbolia');
const toCz = async () => { await SY.evaluate(() => { location.hash = '#customise'; }); await SY.waitForSelector('#cz-sym-form'); };
const setPop = async p => { await SY.evaluate(p => { const n = JSON.parse(localStorage.getItem('statehood.nation.v1')); n.pop = p; n.popAt = Date.now(); localStorage.setItem('statehood.nation.v1', JSON.stringify(n)); }, p); await SY.reload(); await SY.waitForSelector('.layout'); };
const saveSym = async () => { await SY.click('#cz-sym-form button[type="submit"]'); await sleep(300); };
await toCz();
check('at 5 million people the holiday is open and the flower waits for 5.5 million', await SY.isEnabled('#cz-s-hol') && await SY.isDisabled('#cz-s-flower') && /Unlocks at 5\.5 million people/.test(await SY.getAttribute('#cz-s-flower', 'placeholder') || '') && await SY.isDisabled('#cz-s-nick'));
await SY.fill('#cz-s-hol', 'Founding Day'); await saveSym();
const sy0 = await localNation(SY);
check('saving the holiday unlocks nothing yet', ((sy0.cz || {}).sy || {}).hol === 'Founding Day' && !(sy0.syu || []).length && !!sy0.stock);
await setPop(7.2); await toCz();
check('at 7.2 million the flower, tree and bird are open, the instrument not yet', await SY.isEnabled('#cz-s-flower') && await SY.isEnabled('#cz-s-tree') && await SY.isEnabled('#cz-s-bird') && await SY.isDisabled('#cz-s-inst'));
await SY.fill('#cz-s-flower', 'Edelweiss'); await saveSym();
const sy1 = await until(async () => { const n = await localNation(SY); return n && (n.syu || []).length ? n : null; });
const gain = (a, b, r) => b.stock[r] - a.stock[r];
check('the next save grants the three, once, with 15 timber and 15 iron', !!sy1 && ['flower', 'tree', 'bird'].every(k => sy1.syu.includes(k)) && sy1.syu.length === 3 && Math.abs(gain(sy0, sy1, 'timber') - 15) < 0.5 && Math.abs(gain(sy0, sy1, 'iron') - 15) < 0.5 && ((sy1.cz || {}).sy || {}).flower === 'Edelweiss', JSON.stringify([sy0.stock, sy1 && sy1.stock, sy1 && sy1.syu]));
check('and says so', await until(async () => /Symbolia can now choose its national flower, tree, and bird\. The College of Arms sends 15 timber and 15 iron\./.test(await toasts(SY)), 15000));
await SY.click('.bell'); await SY.waitForSelector('.notif-pop');
check('the bell keeps the notice, from the College of Arms', /College of Arms/.test(await text(SY, '.notif-pop')) && /can now choose its national flower, tree, and bird/.test(await text(SY, '.notif-pop')));
await SY.click('.bell');
await SY.fill('#cz-s-tree', 'Silver birch'); await saveSym();
check('saving again gives nothing more', ((await localNation(SY)).syu || []).length === 3 && Math.abs(gain(sy1, await localNation(SY), 'timber')) < 0.5);
await SY.locator('#cz-sec-y').screenshot({ path: path.join(OUT, 'symbols-unlocks.png') });
await setPop(25); await toCz(); await saveSym();
const sy2 = await until(async () => { const n = await localNation(SY); return n && (n.syu || []).length === 6 ? n : null; });
check('at 25 million the instrument, colours and capital nickname follow', !!sy2 && Math.abs(gain(sy1, sy2, 'iron') - 15) < 0.5);
await setPop(5.1); await toCz();
check('and a nation that shrinks keeps what it opened', await SY.isEnabled('#cz-s-flower') && await SY.isEnabled('#cz-s-nick'));
await SY.ctx.close();

/* ── 10e. the pace of edicts, and holiday mode ──────────────────────────── */
// browser-only, so the test can move the clocks in the browser's copy of the nation
const HM = await player('HM', { block: /\/vendor\/firebase\/|\/__\/firebase\//, inject: false });
await open(HM);
await found(HM, 'Restford');
const toSettings = async () => { await HM.evaluate(() => { location.hash = '#settings'; }); await HM.waitForSelector('#s-freq'); };
const edit = async f => { await HM.evaluate(src => { const n = JSON.parse(localStorage.getItem('statehood.nation.v1')); (0, eval)(src)(n, Date.now()); localStorage.setItem('statehood.nation.v1', JSON.stringify(n)); }, f.toString()); await HM.reload(); await HM.waitForSelector('.layout, #dorm-name'); };
const cards = async () => { await HM.evaluate(() => { location.hash = '#edicts'; }); await sleep(400); return (await HM.$$('.issue-card')).length; };
await toSettings();
check('edicts come every 30 minutes, hour, 4, 8 or 12 hours, or once a day, 30 minutes for a new nation', JSON.stringify(await HM.$$eval('#s-freq option', o => o.map(x => x.textContent))) === JSON.stringify(['Every 30 minutes', 'Every hour', 'Every 4 hours', 'Every 8 hours', 'Every 12 hours', 'Once a day']) && (await HM.inputValue('#s-freq')) === '30');
await edit((n) => { n.freq = 2; });
await toSettings();
check('a nation saved at the old two minutes loads at thirty', (await HM.inputValue('#s-freq')) === '30');
// starting holiday mode from Settings, with a time and date
const back = await HM.evaluate(() => { const d = new Date(Date.now() + 3 * 864e5), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; });
await HM.locator('#away-box').screenshot({ path: path.join(OUT, 'holiday-off.png') });
await HM.fill('#away-to', back); await HM.click('[data-act="away-start"]');
const hm1 = await until(async () => { const n = await localNation(HM); return n && n.away ? n : null; });
check('holiday mode starts, until the chosen time', !!hm1 && Math.abs(hm1.away.b - new Date(back).getTime()) < 60e3 && hm1.away.a <= Date.now());
check('Settings says until when, with a way to end it', /On holiday until/.test(await text(HM, '#away-box')) && !!(await HM.$('[data-act="away-end"]')));
await HM.locator('#away-box').screenshot({ path: path.join(OUT, 'holiday-on.png') });
await HM.evaluate(() => { location.hash = '#nation'; }); await sleep(300);
check('the nation page says so', /Holiday mode/.test(await HM.$$eval('.notice', ns => ns.map(x => x.textContent).join(' | '))));
check('and the Edicts page', (await cards(), /Holiday mode: no new edicts until/.test(await text(HM, '.vh'))));
// the edict clock: three hours away from an empty desk, ten minutes after the last edict
await edit((n, now) => { n.inbox = []; n.issueClock = now - 190 * 6e4; n.away = { a: now - 180 * 6e4, b: now + 3 * 864e5 }; });
check('while away no new edicts arrive', (await cards()) === 0);
await edit((n, now) => { n.inbox = []; n.issueClock = now - 190 * 6e4; n.away = { a: now - 180 * 6e4, b: now - 60 * 6e4 }; });
check('after a two-hour holiday only the edict time outside it counts: 70 minutes, two edicts', (await cards()) === 2);
await edit((n, now) => { n.inbox = []; n.issueClock = now - 190 * 6e4; delete n.away; });
check('without a holiday the same three hours fill the desk', (await cards()) === 5);
// ending early, and the month limit
await edit((n, now) => { n.away = { a: now - 60 * 6e4, b: now + 2 * 864e5 }; });
await toSettings(); await HM.click('[data-act="away-end"]');
check('holiday mode can end early', await until(async () => { const n = await localNation(HM); return n.away && Math.abs(n.away.b - Date.now()) < 60e3; }) && await until(async () => /Welcome back/.test(await toasts(HM)), 10000));
const far = await HM.evaluate(() => { const d = new Date(Date.now() + 40 * 864e5), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; });
await HM.fill('#away-to', far); await HM.click('[data-act="away-start"]');
check('and lasts up to a month', await until(async () => /lasts up to a month/.test(await text(HM, '#away-box .err'))) && !((await localNation(HM)).away.b > Date.now() + 864e5));
// the inactivity clock: 260 days since the last save is dormant, unless 27 of them were a holiday
await edit((n, now) => { n.updatedAt = now - 260 * 864e5; delete n.away; });
check('260 days without a save: the nation sleeps', !!(await HM.$('#dorm-name')));
await edit((n, now) => { n.updatedAt = now - 260 * 864e5; n.away = { a: now - 255 * 864e5, b: now - 228 * 864e5 }; });
check('but a 27-day holiday in that time keeps it awake', !(await HM.$('#dorm-name')) && !!(await HM.$('.layout')));
await HM.ctx.close();
// a nation on holiday: its summary counts the holiday (e), and the regions' counts follow it
const HW = await player('HW');
const uidHW = await open(HW);
await found(HW, 'Lakeshore');
// a claim is stamped with the server's time in the save that first carries it
const fv = v => Number(v && (v.integerValue ?? v.doubleValue));
await nav(HW, 'issues'); await until(() => HW.$('.issue-card')); await HW.click('.issue-card');
await HW.waitForSelector('.edict [data-act="answer"]'); await HW.click('.edict [data-act="answer"][data-o="0"]'); await HW.waitForSelector('.result');
await nav(HW, 'map'); // with its first hexes unclaimed, the map opens on the land card's picked block
const lcHW = await until(() => HW.$('#lc-coach [data-act="lc-block"]'), 10000); if (lcHW) await HW.click('#lc-coach [data-act="lc-block"]');
const clHW = await until(async () => { const n = await localNation(HW); return n && Array.isArray(n.claims) && n.claims.length ? n.claims : null; }, 10000);
const stHW = clHW && await until(async () => { const r = await restGet(`stamps/meridian/c${clHW[0].c}/${uidHW}`); return r.status === 200 ? r.body.fields : null; }, 15000);
check('a claim is stamped with the server’s time in the save that carries it', !!stHW && Math.abs(new Date(stHW.t.timestampValue).getTime() - clHW[0].t) < 60e3, JSON.stringify({ lc: !!lcHW, cl: clHW && clHW.length, st: stHW }));
const docHW = await until(async () => { const r = await restGet('nations/' + uidHW); const f = r.status === 200 && r.body.fields; return f && f.cl && fv(f.cl) >= 1 ? f : null; }, 15000);
check('its save carries the headline numbers the rules bound', !!docHW && fv(docHW.pop) > 4 && fv(docHW.army) > 0 && fv(docHW.cl) === clHW.length, JSON.stringify(docHW && { pop: docHW.pop, army: docHW.army, cl: docHW.cl }));
await HW.evaluate(() => { location.hash = '#settings'; }); await HW.waitForSelector('#away-to');
const backHW = await HW.evaluate(() => { const d = new Date(Date.now() + 5 * 864e5), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; });
await HW.fill('#away-to', backHW); await HW.click('[data-act="away-start"]');
const fnum = v => Number(v && (v.integerValue ?? v.doubleValue));
const sumHW = await until(async () => { const r = await restGet('summaries/' + uidHW); const f = r.status === 200 && r.body.fields; return f && f.e ? f : null; }, 15000);
check('a nation on holiday has a summary that counts the holiday', !!sumHW && Math.abs(fnum(sumHW.e) - new Date(backHW).getTime()) < 120e3, JSON.stringify(sumHW));
await HW.ctx.close();
// as if it were saved 260 days ago, 20 days before a holiday ended: asleep by its save, awake by the holiday
const nowHW = Date.now(), sinceHW = nowHW - 250 * 864e5;
await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/summaries/${uidHW}?updateMask.fieldPaths=t&updateMask.fieldPaths=e`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { t: { integerValue: String(nowHW - 260 * 864e5) }, e: { integerValue: String(nowHW - 240 * 864e5) } } }) });
const cnt = w => B.evaluate(async w => (await window.claude.use('db')).count('summaries', w), w);
check('other regions count it as awake: saved before the cut-off, kept awake by its holiday', (await cnt([['reg', '==', 'meridian'], ['t', '<=', sinceHW], ['e', '>', sinceHW]])) === 1);

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
