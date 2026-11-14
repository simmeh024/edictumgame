// Region chat (functions/regionchat.js), on the emulators: the floating Chat button opens a drawer on any page;
// Registered Nations of the region write lines that reach every other nation of it at once, paced by the server; a
// line naming a nation is marked and told; guests write ten lines an hour; a line's menu reports it (the moderators' queue, which
// removes it), blocks its nation (its lines hidden, and its letters stopped) or deletes it; staff remove any line;
// Settings › Chat turns the chat off and puts the button beside the bell, floating (dragged to either side) or both; staff read every region's chat in the admin portal, write as the Edictum
// team and silence a player (and lift it); the drawer's tabs (Region, Alliance, Happenings with Welcome), @mentions,
// answers, reactions, the badges beside a name, docking beside the page, the tutorial's Say hi in the region chat, and
// an admin's pictures (a small copy in the line, the picture over the page on a click).
//   npm run test:region-chat
import { player, open, ready, found, register, until, check, finish, setClaims, text, restListAdmin, clearEmulators, sleep, nav, nationDoc, FS_HOST, PROJECT, OUT } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('writer'), C = await player('reader'), G = await player('guest'), P = await player('phone', { vp: { width: 390, height: 800 } });
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Chatterly');
const uidC = await open(C); await found(C, 'Quillmark');
await open(G); await found(G, 'Guestonia');
const uidP = await open(P); await found(P, 'Pocketland');
await register(A); await register(B); await register(C); await register(P);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
const reg = await B.evaluate(() => G.S.nation.reg);
const record = p => p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden && !window.__toasts.includes(t.textContent)) window.__toasts.push(t.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); });
const told = p => p.evaluate(() => (window.__toasts || []).join(' | '));
await record(C);
check('the test nations share one region', [A, C, G, P].length === (await Promise.all([A, C, G, P].map(p => p.evaluate(() => G.S.nation.reg)))).filter(r => r === reg).length, reg);
const lines = async () => (await restListAdmin(`rchat/${reg}/chat`)).map(d => ({ id: d.id, a: d.fields.a?.stringValue, nm: d.fields.nm?.stringValue, x: d.fields.x?.stringValue, t: Number(d.fields.t?.integerValue || 0), exp: d.fields.exp?.timestampValue, st: d.fields.st?.stringValue }));
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const openChat = async p => { if (!(await p.$('#rgc-dock:not([hidden])'))) await p.click('.rgc-btn'); await p.waitForSelector('#rgc-dock:not([hidden])'); };
const say = async (p, x) => { await openChat(p); await p.fill('#rgc-x', x); await p.press('#rgc-x', 'Enter'); };
const shown = p => p.$$eval('#rgc-list .rgc-l:not(.pend) .rgc-x', l => l.map(x => x.textContent));
const lineOf = async (p, x) => p.$$eval('#rgc-list .rgc-l', (l, x) => (l.find(li => li.querySelector('.rgc-x')?.textContent === x) || {}).dataset?.id || '', x);
const civic = (p, d) => p.evaluate(d => Promise.resolve(window.claude.use('civic')).then(api => api.request(d)).then(r => ({ ok: true, r }), e => ({ ok: false, code: e.details?.code || e.code, message: e.message })), d);

/* ── 0. each nation founded is welcomed in the chat (functions/regionchat.js, rcHello); the setup's welcomes are cleared
   for the checks that follow, and section 13 looks at one in the drawer ── */
const welcomes = async () => (await restListAdmin(`rchat/${reg}/chat`)).filter(d => d.fields.sys?.stringValue === 'found');
const founded = ['Adminland', 'Chatterly', 'Quillmark', 'Guestonia', 'Pocketland'];
const hello = await until(async () => { const w = await welcomes(); return w.length >= founded.length ? w : null; }, 30000);
check('each nation founded is welcomed once in its region’s chat, guests too', !!hello && hello.length === founded.length
  && founded.every(nm => hello.some(d => d.fields.nm?.stringValue === nm && d.fields.x?.stringValue === `${nm} has been founded, welcome to #Meridian Reach!`)), JSON.stringify(hello && hello.map(d => d.fields.x?.stringValue)));
check('the welcome carries the new nation as its author, so it goes with the account', hello?.find(d => d.fields.nm?.stringValue === 'Chatterly')?.fields.a?.stringValue === uidB);
for (const d of hello || []) await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/rchat/${reg}/chat/${d.id}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
check('the welcomes count as new lines for the others until they go', await until(async () => (await welcomes()).length === 0 && await C.$eval('.rgc-btn .rgc-n', n => n.hidden), 15000));

/* ── 1. the button and the drawer ── */
const fabAt = p => p.evaluate(() => { const b = document.querySelector('.rgc-fab'); if (!b) return null; const r = b.getBoundingClientRect(), t = document.querySelector('.tabbar'); return { l: Math.round(r.left), r: Math.round(innerWidth - r.right), b: Math.round(innerHeight - r.bottom), t: Math.round(r.top), w: Math.round(r.width), shown: !!b.getClientRects().length && getComputedStyle(b).display !== 'none', tab: t && t.getClientRects().length ? Math.round(t.getBoundingClientRect().top) : null }; });
check('the Chat button floats in the bottom-right corner, not beside the bell', await until(async () => { const f = await fabAt(B); return f && f.shown && f.w === 52 && Math.abs(f.r - 16 - (await B.evaluate(() => innerWidth - document.documentElement.clientWidth))) <= 1 && f.b === 22; }) && !(await B.$('.brand-actions .rgc-btn')) && /Region chat/.test(await B.getAttribute('.rgc-fab', 'aria-label')), JSON.stringify(await fabAt(B)));
const clearOfToast = p => p.evaluate(() => { const f = document.querySelector('.rgc-fab'), t = document.getElementById('toast'); if (!f || !t || t.hidden) return null; const a = f.getBoundingClientRect(), b = t.getBoundingClientRect(); return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top; });
await B.evaluate(() => G.UX.toast('A notice while the chat button floats in the corner.'));
check('a notice stands to the left of it, not over it', await until(async () => await clearOfToast(B) === true));
await nav(B, 'cities');
await B.click('.rgc-btn');
await B.waitForSelector('#rgc-dock:not([hidden])');
check('it opens a drawer over any page, which names the region and says who reads it', await until(async () => (await text(B, '#rgc-h')).length > 2 && /Everyone in .+ can read this chat/.test(await text(B, '.rgc-intro')) && /online|Talk with the nations of/.test(await text(B, '#rgc-sub'))) && await B.evaluate(() => G.S.view) === 'cities');
check('the button says it is open', await B.getAttribute('.rgc-btn', 'aria-expanded') === 'true');
check('with the drawer open on a wide screen, the button moves beside it', await until(async () => { const f = await fabAt(B), d = await B.$eval('#rgc-dock', d => Math.round(d.getBoundingClientRect().left)); return f && f.shown && f.l + f.w <= d - 10; }), JSON.stringify(await fabAt(B)));
check('the writing box takes the focus', await until(() => B.evaluate(() => document.activeElement?.id === 'rgc-x')));
check('an empty chat says so', await until(async () => /No lines yet\. Say hello to/.test(await text(B, '#rgc-list'))));

/* ── 2. writing: the line reaches the region at once; the server stamps the author ── */
await B.fill('#rgc-x', '  Good morning,   Quillmark!  Anyone selling <b>steel</b>? ');
await B.press('#rgc-x', 'Enter');
check('Enter sends, and the box empties', await until(async () => (await B.inputValue('#rgc-x')) === ''));
check('the line shows in the writer’s drawer', await until(async () => (await shown(B)).includes('Good morning, Quillmark! Anyone selling <b>steel</b>?')));
let all = await lines();
const first = all.find(l => /Good morning/.test(l.x));
check('the server keeps the line with its author, nation name, time and expiry', first && first.a === uidB && first.nm === 'Chatterly' && first.t > 0 && Date.parse(first.exp) > Date.now() + 29 * 864e5 && !first.st, JSON.stringify(first));
check('nothing in the line is drawn as markup', !(await B.$('#rgc-list .rgc-x b')));
check('the reader’s button counts the new line without opening', await until(async () => (await text(C, '.rgc-btn .rgc-n')) === '1' && /1 new/.test(await C.getAttribute('.rgc-btn', 'aria-label')), 15000));
check('a line naming the reader’s nation is told in a notice', await until(async () => /Chatterly mentioned Quillmark in the region chat/.test(await told(C)), 60000), await told(C));
await openChat(C);
check('the reader sees it with the writer’s flag, name and time', await until(async () => (await shown(C)).some(x => /Good morning/.test(x))) && !!(await C.$('#rgc-list .rgc-l .rgc-lh .mflag svg')) && /Chatterly/.test(await text(C, '#rgc-list .rgc-lh')) && /\d\d:\d\d/.test(await text(C, '#rgc-list .rgc-lh time')));
check('the line naming the reader is marked, the name highlighted', !!(await C.$('#rgc-list .rgc-l.named mark')) && (await text(C, '#rgc-list .rgc-l.named mark')) === 'Quillmark');
check('a first look at the chat has no divider: every line is new', !(await C.$('#rgc-list .rgc-new')));
check('opening the drawer clears the count', await until(async () => await C.$eval('.rgc-btn .rgc-n', n => n.hidden)));
check('the writer’s own name is not a link; another’s opens its page', !(await B.$('#rgc-list .rgc-l.me button.rgc-nm')) && !!(await C.$(`#rgc-list button.rgc-nm[data-act="visit"][data-id="${uidB}"]`)));

/* ── 3. pacing, repeats, runs ── */
await sleep(1700);
const one = await civic(B, { op: 'rcPost', x: 'One moment, please.' }), fast = await civic(B, { op: 'rcPost', x: 'Too quick' });
check('a second line at once is paced, and says when it can come', one.ok && !fast.ok && fast.code === 'rc_paced' && /Slow down a little\. You can write again in \d+ second/.test(fast.message), JSON.stringify([one, fast]));
await sleep(1700);
await say(B, 'one moment PLEASE!');
check('the same words again are refused, and the draft comes back', await until(async () => /You just wrote that/.test(await text(B, '#rgc-msg'))) && /one moment PLEASE!/.test(await B.inputValue('#rgc-x')));
await B.fill('#rgc-x', '');
await sleep(1700);
await say(B, 'We pay in grain.');
check('lines by one nation run together under one heading', await until(async () => (await shown(C)).includes('We pay in grain.')) && await C.$$eval('#rgc-list .rgc-l', l => { const i = l.findIndex(li => li.querySelector('.rgc-x')?.textContent === 'We pay in grain.'); return i > 0 && l[i].classList.contains('run') && !l[i].querySelector('.rgc-lh'); }));
await C.keyboard.press('Escape');
await sleep(1700);
await say(B, 'Or in timber.');
check('the line comes in while the reader’s drawer is shut', await until(async () => (await text(C, '.rgc-btn .rgc-n')) === '1'));
await openChat(C);
check('opened again, a divider marks the first line not yet read', await until(async () => await C.$$eval('#rgc-list .rgc-new + .rgc-l .rgc-x', l => l.map(x => x.textContent).join()) === 'Or in timber.'));
await say(C, 'I have steel. Twelve tons.');
check('a line written with the drawer open moves no divider', await until(async () => (await shown(C)).includes('I have steel. Twelve tons.')) && (await C.$$('#rgc-list .rgc-new')).length === 1);
check('another nation’s line starts a new heading', await until(async () => (await shown(B)).includes('I have steel. Twelve tons.')) && /Quillmark/.test(await B.$$eval('#rgc-list .rgc-l', l => l[l.length - 1].querySelector('.rgc-lh')?.textContent || '')));
check('a long line is cut at 300 characters by the box', await B.getAttribute('#rgc-x', 'maxlength') === '300');

/* ── 4. guests write ten lines an hour, counted under the box, with a sign-in offered ── */
await openChat(G);
check('a guest reads the chat', await until(async () => (await shown(G)).includes('We pay in grain.')));
check('a guest has a writing box, told of ten lines an hour and offered a sign-in', !!(await G.$('#rgc-x')) && /Guests can send 10 lines an hour: 10 are left\./.test(await text(G, '#rgc-gq')) && !!(await G.$('#rgc-gq [data-act="acct-open"]')), await text(G, '#rgc-foot'));
check('a Registered Nation sees no such count', !(await B.$('#rgc-gq')));
await G.fill('#rgc-x', 'A guest says hello.'); await G.press('#rgc-x', 'Enter');
check('the guest’s line reaches the region', await until(async () => (await shown(C)).includes('A guest says hello.')));
check('and the count goes down', await until(async () => /: 9 are left\./.test(await text(G, '#rgc-gq'))), await text(G, '#rgc-gq'));
// the rest of the hour used up (rcPace, as the server keeps it): the next line is refused, and the box says when to write again
await G.waitForTimeout(1600);
const guest = await civic(G, { op: 'rcPost', x: 'One more' });
check('the server tells a guest how many lines are left', guest.ok === true && guest.r.guest === true && guest.r.left === 8, JSON.stringify(guest));
const gp = Array.from({ length: 10 }, (_, i) => Date.now() - 50 * 60000 + i * 60000);
await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/rcPace/${await G.evaluate(() => G.S.uid)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { p: { arrayValue: { values: gp.map(t => ({ integerValue: String(t) })) } }, h: { stringValue: 'x' } } }) });
await G.fill('#rgc-x', 'The eleventh line.'); await G.press('#rgc-x', 'Enter');
check('the eleventh line in an hour is refused: the count says the hour is used up, and when it frees', await until(async () => /You have sent your 10 lines for this hour\. You can write again at \d\d:\d\d\./.test(await text(G, '#rgc-gq'))), await text(G, '#rgc-gq'));
check('said once, as an alert, not again above it', await G.$eval('#rgc-gq', e => e.classList.contains('err') && e.getAttribute('role') === 'alert') && await text(G, '#rgc-msg') === '', await text(G, '#rgc-msg'));
check('the refused words stay in the box', await G.inputValue('#rgc-x') === 'The eleventh line.');
await G.fill('#rgc-x', '');

/* ── 5. a line's menu: report ── */
const grain = await lineOf(C, 'We pay in grain.');
await B.click(`#rgc-list .rgc-more[data-id="${grain}"]`); await B.waitForSelector('.rgc-menu');
const own = await text(B, '.rgc-menu'); await B.keyboard.press('Escape');
check('the writer’s own line offers Delete, not Report or Block', !/Report|Block/.test(own) && /Delete/.test(own), own);
await C.click(`#rgc-list .rgc-more[data-id="${grain}"]`);
await C.waitForSelector('.rgc-menu');
check('another’s line offers Report and Block, not Delete', /Report to the moderators/.test(await text(C, '.rgc-menu')) && /Block Chatterly/.test(await text(C, '.rgc-menu')) && !/Delete|Remove/.test(await text(C, '.rgc-menu')));
check('the menu takes the focus, and Escape closes it back onto its button', await C.evaluate(() => !!document.activeElement?.closest('.rgc-menu')) && (await C.keyboard.press('Escape'), await until(async () => !(await C.$('.rgc-menu')) && await C.evaluate(id => document.activeElement?.dataset?.id === id, grain))));
check('the drawer stays open after the menu closes', !!(await C.$('#rgc-dock:not([hidden])')));
await C.click(`#rgc-list .rgc-more[data-id="${grain}"]`); await C.click('.rgc-menu [data-rgc="report"]');
await C.waitForSelector('dialog.ed-dlg[open] input[value="spam"]');
check('the report dialog quotes the message', /Report this chat message\?/.test(await text(C, 'dialog.ed-dlg[open]')) && /We pay in grain\./.test(await text(C, 'dialog.ed-dlg[open] .ed-quote')));
await C.check('dialog.ed-dlg[open] input[value="spam"]'); await C.click('dialog.ed-dlg[open] [data-ed="report-yes"]');
check('the report goes to the moderators', await until(async () => /with the moderators/.test(await toasts(C)), 8000));
const reps = (await restListAdmin('reports')).map(d => ({ id: d.id, kind: d.fields.kind?.stringValue, post: d.fields.post?.stringValue, target: d.fields.target?.stringValue, x: d.fields.x?.stringValue, reason: d.fields.reason?.stringValue }));
const rep = reps.find(r => r.post === `rc:${reg}:${grain}`);
check('it is filed as a post, with the line and its author', rep && rep.kind === 'post' && rep.target === uidB && rep.x === 'We pay in grain.' && rep.reason === 'spam', JSON.stringify(reps));

/* ── 6. the admin removes the reported line from the queue ── */
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-reports"]');
check('the report arrives in the queue as a region chat line', await until(async () => /Region chat/.test(await text(A, '.adm-reps')) && /We pay in grain\./.test(await text(A, '.adm-reps')), 15000));
await A.click('[data-act="adm-delpost"]');
check('Remove the line asks first', await until(async () => /Remove this region chat line by/.test(await text(A, '.adm-rep .adm-ask'))));
await A.click('[data-act="adm-delpost-yes"]');
check('removing it deletes the line for everyone', await until(async () => !(await shown(B)).includes('We pay in grain.') && !(await shown(C)).includes('We pay in grain.'), 15000),
  JSON.stringify({ b: await shown(B), c: await shown(C), bOpen: !!(await B.$('#rgc-dock:not([hidden])')), cOpen: !!(await C.$('#rgc-dock:not([hidden])')), server: (await lines()).map(l => l.x) }));
check('and the ticket is closed', await until(async () => !(await restListAdmin('reports')).some(d => d.fields.post?.stringValue === `rc:${reg}:${grain}`)));
await A.click('.adm-return'); await ready(A);

/* ── 7. block: the blocked nation's lines are hidden, and its letters stop ── */
const morning = await lineOf(C, 'Good morning, Quillmark! Anyone selling <b>steel</b>?');
await C.click(`#rgc-list .rgc-more[data-id="${morning}"]`); await C.click('.rgc-menu [data-rgc="block-ask"]');
check('blocking asks first, and says what it does', await until(async () => /Block Chatterly\? Its lines in this chat are hidden and its letters no longer reach you/.test(await text(C, '.rgc-ask'))));
await C.click('.rgc-ask [data-rgc="block"]');
const hiddenB = (await lines()).filter(l => l.a === uidB).length;
check('the blocked nation’s lines are hidden, and the drawer says how many', await until(async () => !(await shown(C)).some(x => /Good morning|grain|timber|moment/.test(x)) && new RegExp(hiddenB + ' lines from nations you blocked are hidden').test(await text(C, '.rgc-intro'))), hiddenB);
check('the focus stays in the drawer', await C.evaluate(() => document.activeElement?.id === 'rgc-x'));
check('the block is the Letters block, kept on the server', await until(async () => (await restListAdmin('lblock')).some(d => d.id === `${uidC}~${uidB}`)));
await C.keyboard.press('Escape');
check('Escape closes the drawer and returns the focus to the button', await until(async () => !!(await C.$('#rgc-dock[hidden]')) && await C.evaluate(() => document.activeElement?.classList.contains('rgc-btn'))));
await sleep(1700);
await say(B, 'Is anyone there?');
check('the blocked nation still sees its own lines', await until(async () => (await shown(B)).includes('Is anyone there?')));
await sleep(2500);
check('new lines from the blocked nation are not counted, nor shown', await C.$eval('.rgc-btn .rgc-n', n => n.hidden) && (await openChat(C), await sleep(300), !(await shown(C)).includes('Is anyone there?')));
await C.keyboard.press('Escape');
await nav(C, 'settings'); await C.click('#sg-tab-letters');
check('Settings › Letters lists the blocked nation; the chat’s switches have a tab of their own', await until(async () => /Chatterly/.test(await text(C, '#set-letters-bl')) && !(await C.$('#set-letters-chat')) && /Show the region chat/.test(await text(C, '#sg-p-chat #set-chat-on'))));
await C.click('#set-letters-bl [data-act="dm-block"][data-off="1"]');
await openChat(C);
check('unblocking shows its lines again', await until(async () => (await shown(C)).includes('Is anyone there?')));

/* ── 8. deleting: one's own line; staff any line, from the drawer ── */
const there = await lineOf(B, 'Is anyone there?');
await B.click(`#rgc-list .rgc-more[data-id="${there}"]`); await B.click('.rgc-menu [data-rgc="del-ask"]');
check('deleting one’s own line asks first', /Delete this line\? It goes for everyone\./.test(await text(B, '.rgc-ask')));
await B.click('.rgc-ask [data-rgc="del"]');
check('the deleted line goes for everyone', await until(async () => !(await shown(C)).includes('Is anyone there?') && !(await lines()).some(l => l.x === 'Is anyone there?'), 15000));
const twelve = await lineOf(B, 'I have steel. Twelve tons.');
const notMine = await civic(B, { op: 'rcDelete', reg, id: twelve });
check('a player cannot delete another’s line', !notMine.ok && /only delete your own/.test(notMine.message));
await openChat(A);
await until(async () => (await shown(A)).includes('I have steel. Twelve tons.'));
await A.click(`#rgc-list .rgc-more[data-id="${twelve}"]`);
check('staff may remove any line, but not report or block it', /Remove the line/.test(await text(A, '.rgc-menu')));
await A.click('.rgc-menu [data-rgc="del-ask"]');
check('removing another’s line says the audit log keeps it', /Remove this line by Quillmark\? It goes for everyone, and the audit log keeps it\./.test(await text(A, '.rgc-ask')));
await A.click('.rgc-ask [data-rgc="del"]');
check('the removed line goes for everyone', await until(async () => !(await shown(C)).includes('I have steel. Twelve tons.'), 15000));
check('the audit log keeps who removed what', await until(async () => (await restListAdmin('adminAudit')).some(d => d.fields.action?.stringValue === 'chat_delete' && d.fields.line?.stringValue === twelve && d.fields.actor?.stringValue === uidA && d.fields.x?.stringValue === 'I have steel. Twelve tons.')));
await sleep(1700);
await say(A, 'Welcome, everyone. Be kind.');
check('a staff line carries the staff mark', await until(async () => /Edictum staff/.test(await B.$$eval('#rgc-list .rgc-l', l => l.map(li => li.textContent).join(' | ')))) && (await lines()).some(l => l.x === 'Welcome, everyone. Be kind.' && l.st === 'admin'));

/* ── 9. a phone: the button floats above the tab bar, steps up over the save bar and hides while typing; the drawer
   fills the screen; a nation's name opens its page ── */
check('on a phone the button floats above the tab bar, on the right', await until(async () => { const f = await fabAt(P); return f && f.shown && f.r === 16 && f.tab != null && Math.abs(f.t + f.w - (f.tab - 12)) <= 1; }), JSON.stringify(await fabAt(P)));
await P.evaluate(() => G.UX.toast('A notice while the chat button floats above the tab bar.'));
check('on a phone a notice stands above it, not over it', await until(async () => await clearOfToast(P) === true));
await nav(P, 'settings');
await P.fill('#s-motto', 'Small but chatty');
check('it hides while the player types in the page', await until(async () => !(await fabAt(P)).shown));
await P.evaluate(() => document.activeElement?.blur());
const clear = async () => { const f = await fabAt(P), s = await P.$eval('.save-bar.is-dirty', e => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom }; }); return f && f.shown && (f.t + f.w <= s.t - 9 || f.t >= s.b); };
check('typing done, it comes back, clear of the bar of unsaved changes', await until(clear), JSON.stringify(await fabAt(P)));
await P.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
check('the bar scrolled up the page, it goes back down above the tab bar', await until(async () => { const f = await fabAt(P); return f && f.shown && Math.abs(f.t + f.w - (f.tab - 12)) <= 1; }), JSON.stringify(await fabAt(P)));
await P.click('[data-act="reset-settings"]');
await P.click('.rgc-fab'); await P.waitForSelector('#rgc-dock:not([hidden])');
const fills = () => P.$eval('#rgc-dock', d => { const r = d.getBoundingClientRect(); return { left: r.left, w: Math.round(r.width), h: Math.round(r.height), iw: innerWidth, ih: innerHeight }; });
check('on a phone the drawer fills the screen', await until(async () => { const r = await fills(); return r.left === 0 && r.w === r.iw && r.h >= r.ih - 1; }), JSON.stringify(await fills()));
check('the page behind it does not scroll', await P.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));
await until(async () => (await shown(P)).includes('Welcome, everyone. Be kind.'));
check('the page has no sideways scroll with the drawer open', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('the floating button hides under the drawer', !(await fabAt(P)).shown);
await P.click(`#rgc-list button.rgc-nm[data-id="${uidA}"]`);
check('a nation’s name opens its page and the drawer steps aside', await until(async () => await P.evaluate(() => G.S.view) === 'visit' && !!(await P.$('#rgc-dock[hidden]'))));

/* ── 10. Settings › Chat: where the button sits, dragging it, and turning the chat off ── */
if (await C.$('#rgc-dock:not([hidden])')) await C.click('#rgc-dock [data-rgc="close"]');
await nav(C, 'settings'); await C.click('#sg-tab-chat');
check('Settings › Chat is in the address and says where the button sits', await until(async () => await C.evaluate(() => location.hash) === '#settings/chat' && /Floating button · mentions on/.test(await text(C, '[data-sg-sub="chat"]')) && await C.getAttribute('#rgcs-p-f', 'aria-pressed') === 'true'));
await C.click('#rgcs-p-h');
check('Beside the bell: the button goes back to the top bar, and the floating one goes', await until(async () => !!(await C.$('.brand-actions .bell + .ux-search-button + .rgc-btn')) && !(await C.$('.rgc-fab'))) && await C.evaluate(() => localStorage.getItem('edictum.rgc.place')) === 'h' && /Button beside the bell/.test(await text(C, '[data-sg-sub="chat"]')));
await C.click('#rgcs-p-b');
check('Both: one beside the bell and one floating', await until(async () => !!(await C.$('.brand-actions .rgc-btn')) && (await fabAt(C))?.shown && (await C.$$('.rgc-btn')).length === 2));
await C.click('#rgcs-p-f');
check('Floating again', await until(async () => !(await C.$('.brand-actions .rgc-btn')) && (await fabAt(C))?.shown) && await C.isDisabled('#rgcs-home'));
{ const f = await fabAt(C), x = f.l + 26, y = f.t + 26;
  await C.mouse.move(x, y); await C.mouse.down(); await C.mouse.move(x - 300, y - 200, { steps: 6 }); await C.mouse.move(200, 380, { steps: 6 }); await C.mouse.up(); }
check('dragged, it snaps to the nearer side and keeps its height', await until(async () => { const f = await fabAt(C); return f && f.l === 16 && Math.abs(f.t - 354) <= 2; }), JSON.stringify(await fabAt(C)));
check('the drag opens nothing', !(await C.$('#rgc-dock:not([hidden])')));
check('the place is kept on this device', await C.evaluate(() => { const o = JSON.parse(localStorage.getItem('edictum.rgc.fab') || '{}'); return o.s === 'l' && o.b > 0.5 && o.b < 0.6; }));
await sleep(500); await C.click('.rgc-fab');
check('a click still opens the chat', await until(async () => !!(await C.$('#rgc-dock:not([hidden])'))));
await C.keyboard.press('Escape');
check('and the focus comes back to it', await until(async () => await C.evaluate(() => document.activeElement?.classList.contains('rgc-fab'))));
await C.reload(); await ready(C);
check('after a reload it is where it was left', await until(async () => { const f = await fabAt(C); return f && f.shown && f.l === 16 && Math.abs(f.t - 354) <= 2; }), JSON.stringify(await fabAt(C)));
await nav(C, 'settings'); await C.click('#sg-tab-chat');
await C.click('#rgcs-home');
check('Put it back in the corner', await until(async () => { const f = await fabAt(C); return f && f.b === 22 && f.r <= 32 && f.l > 600; }) && await C.evaluate(() => localStorage.getItem('edictum.rgc.fab')) === null, JSON.stringify(await fabAt(C)));
await C.uncheck('#set-chat-on [data-rgc="set-on"]');
check('turning the chat off removes the button and closes the drawer', await until(async () => !(await C.$('.rgc-btn')) && !(await C.$('#rgc-dock:not([hidden])'))));
check('the setting is kept with the nation', await until(() => C.evaluate(() => G.S.nation.dmx?.rc === 0)));
await C.check('#set-chat-on [data-rgc="set-on"]');
check('turning it on again brings the button back', await until(async () => !!(await C.$('.rgc-btn'))));

/* ── 11. staff: the admin portal's Region chats, the team's lines, silencing and lifting ── */
await sleep(1700);
await say(B, 'Selling cheap iron!');
await until(async () => (await lines()).some(l => l.x === 'Selling cheap iron!'));
await A.keyboard.press('Escape'); await openChat(C);
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-chat"]');
check('the admin portal has a Region chats page under Moderation', await until(async () => /Region chats/.test(await text(A, '.adm-main h1')) && /Region chats/.test(await text(A, '.adm-nav-group[aria-label="Moderation"]'))));
check('it lists the regions, busiest first, with their newest line', await until(async () => /Selling cheap iron!/.test(await text(A, '#acx-regs li:first-child')) && (await A.$$('#acx-regs .acx-reg')).length > 20));
check('the admin’s region is open, with its chat as it happens', await until(async () => /Selling cheap iron!/.test(await text(A, '#acx-log'))) && !!(await A.$('#acx-regs .acx-reg.on[aria-current="true"]')));
await A.fill('#acx-x', 'Maintenance tonight at 22:00 UTC.'); await A.press('#acx-x', 'Enter');
check('staff write as the Edictum team, and the region reads it at once', await until(async () => (await shown(B)).includes('Maintenance tonight at 22:00 UTC.'), 15000));
const team = (await lines()).find(l => l.x === 'Maintenance tonight at 22:00 UTC.');
check('the team’s line is signed Edictum team, by the staff member, with the team mark', team && team.nm === 'Edictum team' && team.a === uidA && team.st === 'admin', JSON.stringify(team));
check('players see the team’s mark and name', await B.$$eval('#rgc-list .rgc-l', l => { const li = l.find(x => x.querySelector('.rgc-x')?.textContent === 'Maintenance tonight at 22:00 UTC.'); return !!li && /Edictum team/.test(li.textContent) && !!li.querySelector('.rgc-tmfl'); }));
const teamLine = await lineOf(B, 'Maintenance tonight at 22:00 UTC.');
await B.click(`#rgc-list .rgc-more[data-id="${teamLine}"]`);
check('the team’s line can be answered or reacted to, but not reported or blocked', await until(async () => { const t = await text(B, '.rgc-menu'); return /Answer/.test(t) && !/Report|Block/.test(t); }));
await B.keyboard.press('Escape');
const iron = await A.$$eval('#acx-log .acx-l', l => (l.find(li => /Selling cheap iron!/.test(li.textContent)) || {}).dataset?.id || '');
await A.click(`#acx-log [data-act="acx-mute-ask"][data-id="${iron}"]`);
check('Silence… asks how long and why, about the right nation', await until(async () => /Silence Chatterly in every region’s chat\?/.test(await text(A, '#acx-mute'))));
await A.selectOption('#acx-mh', '24'); await A.fill('#acx-mw', 'Spam'); await A.check('#acx-mx');
await A.click('#acx-mute-go');
check('silencing takes the nation’s lines of the last day', await until(async () => !(await shown(C)).includes('Selling cheap iron!') && !(await lines()).some(l => l.x === 'Selling cheap iron!'), 15000));
/* and says so: toasts take turns, and the admin's own rewards of a moment ago (Hello, Neighbours, the tutorial's Say hi,
   up to 8 s each) can be shown first, so the notice is waited for apart from the lines, long enough for them to pass */
check('and says so, with how many lines were removed', await until(async () => /Chatterly is silenced in the region chat for 24 hours\. \d+ lines? (was|were) removed\./.test(await toasts(A)), 45000), await toasts(A));
check('the silenced players list it, with its reason and Lift', await until(async () => /Chatterly/.test(await text(A, '.acx-mt')) && /Spam/.test(await text(A, '.acx-mt')) && !!(await A.$(`.acx-mt [data-act="acx-lift"][data-id="${uidB}"]`))));
check('the audit log keeps the silence', await until(async () => (await restListAdmin('adminAudit')).some(d => d.fields.action?.stringValue === 'chat_silence' && d.fields.target?.stringValue === uidB && d.fields.reason?.stringValue === 'Spam')));
await B.keyboard.press('Escape'); await openChat(B);
check('the silenced player sees why, and until when, in place of the writing box', await until(async () => /A moderator has silenced you in the region chat until .+\. Reason: Spam\./.test(await text(B, '#rgc-foot')) && !(await B.$('#rgc-x'))));
const silenced = await civic(B, { op: 'rcPost', x: 'Let me speak' });
check('the server refuses the silenced player too', !silenced.ok && silenced.code === 'rc_silenced', JSON.stringify(silenced));
check('the silenced player still reads the chat', (await shown(B)).includes('Maintenance tonight at 22:00 UTC.'));
await A.click(`.acx-mt [data-act="acx-lift"][data-id="${uidB}"]`);
check('Lift ends the silence', await until(async () => /Nobody is silenced/.test(await text(A, '.adm-main'))));
await B.keyboard.press('Escape'); await openChat(B);
check('the player gets the writing box back', await until(async () => !!(await B.$('#rgc-x'))));
await sleep(1700); await say(B, 'Sorry, everyone.');
check('and writes again', await until(async () => (await shown(C)).includes('Sorry, everyone.') && (await lines()).some(l => l.x === 'Sorry, everyone.' && l.a === uidB)));
await A.click('.adm-return'); await ready(A); await openChat(A);
const sorry = await lineOf(A, 'Sorry, everyone.');
await A.click(`#rgc-list .rgc-more[data-id="${sorry}"]`);
check('in the chat itself, staff find Silence in a line’s menu', /Silence Chatterly…/.test(await text(A, '.rgc-menu')));
await A.click('.rgc-menu [data-rgc="mute-ask"]');
check('it asks how long and why there too', await until(async () => !!(await A.$('#rgc-list .rgc-mute select[data-rgc="mute-h"]')) && /Silence Chatterly in every region’s chat\?/.test(await text(A, '#rgc-list .rgc-mute'))));
await A.keyboard.press('Escape');

/* ── 12. tabs, Happenings and Welcome, @mentions, answers, reactions, badges, the Alliance tab, docking, the tutorial ── */
const docUrl = p => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, owner = { 'content-type': 'application/json', authorization: 'Bearer owner' };
const bell = async p => { await p.evaluate(() => document.querySelector('.bell').click()); await sleep(300); const t = await p.evaluate(() => [...document.querySelectorAll('.nt-item')].map(e => e.textContent).join(' | ')); await p.evaluate(() => document.querySelector('.bell').click()); return t; };
await openChat(B);
check('the drawer has a Region and a Happenings tab, and no Alliance tab outside an alliance', JSON.stringify(await B.$$eval('#rgc-tabs [role="tab"]', l => l.map(b => b.childNodes[0].textContent))) === JSON.stringify(['Region', 'Happenings']));
await B.click('#rgc-tab-haps');
check('Happenings lists what the region’s nations did, and hides the writing box', await until(async () => /Pocketland was founded in/.test(await text(B, '#rgc-list'))) && await B.$eval('#rgc-foot', f => f.hidden) && await B.getAttribute('#rgc-tab-haps', 'aria-selected') === 'true');
check('a nation founded this week has a Welcome button', !!(await B.$(`#rgc-list [data-rgc="welcome"][data-id="${uidP}"]`)));
await sleep(1700);
await B.click(`#rgc-list [data-rgc="welcome"][data-id="${uidP}"]`);
check('Welcome starts a line in the region chat that mentions the nation', await until(async () => await B.getAttribute('#rgc-tab-region', 'aria-selected') === 'true' && (await B.inputValue('#rgc-x')) === 'Welcome to the Meridian Reach, @Pocketland!'));
await B.press('#rgc-x', 'Enter');
const welcome = await until(async () => (await lines()).find(l => l.x === 'Welcome to the Meridian Reach, @Pocketland!'), 15000);
const wdoc = welcome && (await restListAdmin(`rchat/${reg}/chat`)).find(d => d.id === welcome.id);
check('the server keeps the mention on the line', wdoc && wdoc.fields.mn?.mapValue?.fields?.[uidP]?.stringValue === 'Pocketland', JSON.stringify(wdoc && wdoc.fields.mn));
check('the mention is marked in the line', await until(async () => /@Pocketland/.test(await text(B, '#rgc-list .rgc-at'))));
check('the nation mentioned finds it in its bell', await until(async () => /Chatterly mentioned you in the region chat: Welcome to the Meridian Reach/.test(await bell(P)), 15000));
// @ offers the region's nations as one types; Enter picks one
await openChat(C); await sleep(1700);
await C.fill('#rgc-x', ''); await C.focus('#rgc-x'); await C.keyboard.type('@Chat');
check('typing @ offers the matching nations of the region', await until(async () => /@Chatterly/.test(await text(C, '#rgc-mn')) && !(await C.$eval('#rgc-mn', u => u.hidden))));
await C.keyboard.press('Enter');
check('Enter picks it and writes the full name', (await C.inputValue('#rgc-x')) === '@Chatterly ' && await C.$eval('#rgc-mn', u => u.hidden));
await C.keyboard.type('how much for the iron?'); await C.keyboard.press('Enter');
check('the line goes out with its mention', await until(async () => (await lines()).some(l => l.x === '@Chatterly how much for the iron?'), 15000));
// answering a line quotes it and tells its writer
await sleep(1700);
const wid = await lineOf(C, 'Welcome to the Meridian Reach, @Pocketland!');
await C.click(`#rgc-list .rgc-more[data-id="${wid}"]`); await C.click('.rgc-menu [data-rgc="reply"]');
check('Answer shows what is being answered above the box', /Answering Chatterly: Welcome to the Meridian Reach/.test(await text(C, '#rgc-rebar')) && await C.evaluate(() => document.activeElement?.id === 'rgc-x'));
await C.fill('#rgc-x', 'Seconded!'); await C.press('#rgc-x', 'Enter');
check('the answer quotes the line it answers', await until(async () => await B.$$eval('#rgc-list .rgc-l', l => { const li = l.find(x => x.querySelector('.rgc-x')?.textContent === 'Seconded!'); return !!li && /Chatterly/.test(li.querySelector('.rgc-q')?.textContent || ''); }), 15000));
check('and its writer is told in the bell', await until(async () => /Quillmark answered you in the region chat: Seconded!/.test(await bell(B)), 15000));
const sec = await lineOf(C, 'Seconded!');
await C.click(`#rgc-list .rgc-l[data-id="${sec}"] .rgc-q`);
check('a click on the quote shows the line it answers', await until(async () => !!(await C.$(`#rgc-list .rgc-l.flash[data-id="${wid}"]`))));
// reactions: one per nation, shown under the line, taken back with a second click
await B.click(`#rgc-list .rgc-more[data-id="${sec}"]`);
check('a line’s menu offers four reactions', (await B.$$('.rgc-menu .rgc-rxp button')).length === 4);
await B.click('.rgc-menu .rgc-rxp [data-k="hear"]');
check('a reaction shows under the line for everyone', await until(async () => /1/.test(await text(C, `#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`)) && await B.getAttribute(`#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`, 'aria-pressed') === 'true', 15000));
check('the server keeps one reaction for the nation', await until(async () => (await restListAdmin(`rchat/${reg}/chat`)).find(d => d.id === sec)?.fields.rv?.mapValue?.fields?.[uidB]?.stringValue === 'hear'));
await C.click(`#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`);
check('another nation adds its own to the count', await until(async () => / 2$/.test((await text(B, `#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`)).trim())));
await B.click(`#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`);
check('clicking one’s own reaction again takes it back', await until(async () => / 1$/.test((await text(C, `#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`)).trim()) && await B.getAttribute(`#rgc-list .rgc-l[data-id="${sec}"] .rgc-rx[data-k="hear"]`, 'aria-pressed') === 'false'));
// badges beside a name: the rank's colour, and the alliance's initials
await B.evaluate(() => { const R = G.RK, n = G.clone(G.S.nation), ach = { ...(n.ach || {}) }, lo = R.ACH_RANKS[2][0]; let p = R.achPoints({ ach });
  for (const a of R.ACH.slice().sort((x, y) => R.ACH_TIER[y.t].p - R.ACH_TIER[x.t].p)) { if (p >= lo) break; if (ach[a.id]) continue; ach[a.id] = Date.now(); p += R.ACH_TIER[a.t].p; } n.ach = ach; G.commit(n); });
check('a nation’s rank shows as a coloured mark beside its name', await until(async () => !!(await C.$(`#rgc-list .rgc-lh:has(button[data-id="${uidB}"]) .rgc-rk`)), 25000));
for (let i = 0; i < 5; i++) {
  await fetch(docUrl('nations/' + uidB) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: 12 } } }) });
  await B.evaluate(() => { const n = G.clone(G.S.nation); n.pop = 12; n.popAt = Date.now(); G.commit(n); });
  if (await until(async () => { const d = await nationDoc(uidB); return d && d.rec && d.rec.pop >= 11.9; }, 8000)) break;
}
const made = await civic(B, { op: 'alFound', name: 'The Chat Pact', ty: 'def', acc: 'open' });
const aid = made.ok ? (made.r.aid || made.r.id || made.r.data?.aid) : '';
check('an alliance is founded for the next checks', made.ok, JSON.stringify(made));
const joined = await civic(C, { op: 'alRequest', aid: aid || await B.evaluate(() => G.ALX().alMine()?.id) });
check('and the other nation joins it', joined.ok, JSON.stringify(joined));
check('a member gets the Alliance tab', await until(async () => JSON.stringify(await C.$$eval('#rgc-tabs [role="tab"]', l => l.map(b => b.childNodes[0].textContent))) === JSON.stringify(['Region', 'Alliance', 'Happenings']), 20000));
check('the alliance’s initials show beside a member’s name', await until(async () => /CP/.test(await text(C, `#rgc-list .rgc-lh:has(button[data-id="${uidB}"]) .rgc-al`)), 20000));
await C.click('#rgc-tab-ally');
check('the Alliance tab is the alliance’s channel, for its members only', await until(async () => /Only the members of The Chat Pact read this channel/.test(await text(C, '#rgc-list')) && !!(await C.$('#rgc-ax'))));
await C.fill('#rgc-ax', 'Allies, to the iron mines!'); await C.press('#rgc-ax', 'Enter');
check('a message there reaches the other members, counted on their Alliance tab', await until(async () => /1/.test(await text(B, '#rgc-tab-ally .rgc-tn')), 20000));
await B.click('#rgc-tab-ally');
check('and it reads there', await until(async () => /Allies, to the iron mines!/.test(await text(B, '#rgc-list'))) && !(await B.$('#rgc-tab-ally .rgc-tn')));
await B.click('#rgc-tab-region');
// docked beside the page on a wide screen, and floating again
await openChat(A);
check('on a wide screen the drawer offers to dock', await A.isVisible('[data-rgc="dock"]'));
await A.click('[data-rgc="dock"]');
check('docked, the page makes room for the drawer', await until(() => A.evaluate(() => document.documentElement.classList.contains('rgc-docked') && getComputedStyle(document.body).paddingRight === '400px' && document.querySelector('.main').getBoundingClientRect().right <= innerWidth - 399)));
check('docked, the drawer stays as the pages change', (await nav(A, 'cities'), await A.isVisible('#rgc-dock')));
await A.click('[data-rgc="dock"]');
check('and floats over the page again', await until(() => A.evaluate(() => !document.documentElement.classList.contains('rgc-docked') && getComputedStyle(document.body).paddingRight === '0px')));
check('a phone has no dock button', (await openChat(P), !(await P.isVisible('[data-rgc="dock"]'))));
// the tutorial: Say hi in the region chat
check('Say hi in the region chat is a step of the tutorial, done by a first line', await until(() => B.evaluate(() => (G.S.nation.tut?.lc || []).includes('rch')), 20000));

/* ── 13. a nation founded now: its welcome line in the drawer, Welcome from the others, Say hello from itself ── */
const W = await player('welcomed'), uidW = await open(W); await found(W, 'Welcomia');
const sysLi = `#rgc-list .rgc-l.rgc-sys`;
check('a nation founded now is welcomed in the open chat at once', await until(async () => /Welcomia has been founded, welcome to #Meridian Reach!/.test(await text(B, sysLi + ' .rgc-x')), 30000), await text(B, '#rgc-list'));
check('drawn as an announcement of a new nation, not a line of its own', /New nation/.test(await text(B, sysLi + ' .rgc-sh')) && !(await B.$(sysLi + ' .rgc-lh')));
check('the others get a Welcome button', !!(await B.$(`${sysLi} [data-rgc="welcome"][data-id="${uidW}"]`)));
await B.locator(sysLi).screenshot({ path: OUT + '/chat-welcome-line.png' });
const sysId = await B.$eval(sysLi, li => li.dataset.id);
await B.click(`#rgc-list .rgc-more[data-id="${sysId}"]`);
const sysMenu = await B.$$eval('.rgc-menu button', l => l.map(b => b.getAttribute('aria-label') || b.textContent));
check('its menu reacts and reports, and answers or blocks nothing', sysMenu.includes('Bravo') && sysMenu.includes('Report to the moderators') && !sysMenu.includes('Answer') && !sysMenu.some(x => /^Block/.test(x)), JSON.stringify(sysMenu));
await B.click(`#rgc-list .rgc-more[data-id="${sysId}"]`); await sleep(1700);
await B.click(`${sysLi} [data-rgc="welcome"]`);
check('Welcome starts a line that greets the new nation', await until(async () => (await B.inputValue('#rgc-x')) === 'Welcome to the Meridian Reach, @Welcomia!'));
await B.press('#rgc-x', 'Enter');
check('once greeted, the Welcome button goes', await until(async () => (await lines()).some(l => l.a === uidB && l.x === 'Welcome to the Meridian Reach, @Welcomia!') && !(await B.$(`${sysLi} [data-rgc="welcome"]`)), 15000));
await openChat(W);
check('the new nation sees its own welcome with Say hello, not Welcome', await until(async () => !!(await W.$(`${sysLi}.me [data-rgc="hello"]`)) && !(await W.$(`${sysLi} [data-rgc="welcome"]`)), 15000));
check('its own welcome is not a line of its own: the guest still has all ten', await until(async () => /: 10 are left/.test(await text(W, '#rgc-gq'))), await text(W, '#rgc-gq'));
await W.click(`${sysLi} [data-rgc="hello"]`);
check('Say hello starts a first line', await until(async () => (await W.inputValue('#rgc-x')) === 'Hello, everyone!'));
await W.press('#rgc-x', 'Enter');
check('and goes once it is said', await until(async () => (await lines()).some(l => l.a === uidW && l.x === 'Hello, everyone!') && !(await W.$(`${sysLi} [data-rgc="hello"]`)), 15000));
check('a reload asks for no second welcome', (await W.reload(), await ready(W), await sleep(4000), (await welcomes()).filter(d => d.fields.a?.stringValue === uidW).length === 1));

/* ── 14. pictures: an admin adds one to a line (the picture button, a paste, the team's box), everyone sees a small copy, a click shows it ── */
// a picture drawn in the page: a gradient, a word and some lines, as a PNG
const pngOf = (p, w, h, hue) => p.evaluate(([w, h, hue]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, `hsl(${hue},60%,45%)`); gr.addColorStop(1, `hsl(${hue + 60},70%,75%)`); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `bold ${Math.round(h / 6)}px sans-serif`; g.fillText('Harbour', w / 10, h / 2);
  for (let i = 0; i < 60; i++) { g.strokeStyle = `hsla(${(hue + i * 9) % 360},80%,40%,.6)`; g.lineWidth = 3; g.beginPath(); g.moveTo((i * 97) % w, (i * 53) % h); g.lineTo((i * 31) % w, (i * 71) % h); g.stroke(); }
  return c.toDataURL('image/png').split(',')[1]; }, [w, h, hue]).then(b => Buffer.from(b, 'base64'));
const paste = (p, b64, name) => p.evaluate(([b64, name]) => { const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer(); dt.items.add(new File([u], name, { type: 'image/png' }));
  document.getElementById('rgc-x').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, [b64, name]);
await openChat(B); await openChat(C); await openChat(A);
// the reader was left on its Alliance tab (section 12)
await C.click('#rgc-tab-region');
check('a player has no picture button', !(await B.$('#rgc-foot [data-pic="pick"]')) && !(await B.$('#rgc-file')));
check('an admin has one beside Send', await A.isVisible('#rgc-foot [data-pic="pick"]'));
await A.setInputFiles('#rgc-file', { name: 'harbour.png', mimeType: 'image/png', buffer: await pngOf(A, 1600, 900, 200) });
check('a picture chosen is prepared and shown above the box, with its size', await until(async () => /Picture added/.test(await text(A, '#rgc-picbar')) && /1600 × 900/.test(await text(A, '#rgc-picbar')) && !(await A.$eval('#rgc-picbar', e => e.hidden)), 15000), await text(A, '#rgc-foot'));
await sleep(1700);
await A.fill('#rgc-x', 'The new harbour, as promised.'); await A.press('#rgc-x', 'Enter');
const picLine = await until(async () => (await restListAdmin(`rchat/${reg}/chat`)).find(d => d.fields.x?.stringValue === 'The new harbour, as promised.'), 15000);
const im = picLine?.fields.im?.mapValue?.fields;
check('the line keeps a small copy, at most 440 × 360, with the picture’s own size', !!im && /^data:image\/(webp|jpeg);base64,/.test(im.s.stringValue) && Number(im.w.integerValue) === 440 && Number(im.h.integerValue) === 248
  && Number(im.fw.integerValue) === 1600 && Number(im.fh.integerValue) === 900 && im.s.stringValue.length < 70000, JSON.stringify(im && { w: im.w, h: im.h, fw: im.fw, fh: im.fh, n: im.s?.stringValue?.length }));
const kept = picLine && (await restListAdmin(`rcimg/${reg}/chat`)).find(d => d.id === picLine.id);
check('and the picture itself beside it, under the line’s id, with the same expiry', !!kept && /^data:image\/(webp|jpeg);base64,/.test(kept.fields.d.stringValue) && kept.fields.a.stringValue === uidA && kept.fields.exp.timestampValue === picLine.fields.exp.timestampValue);
check('the box and the bar empty once it is sent', (await A.inputValue('#rgc-x')) === '' && await until(() => A.$eval('#rgc-picbar', e => e.hidden)));
const pli = `#rgc-list .rgc-l[data-id="${picLine?.id}"]`;
check('the others see the words and the small copy under them', await until(async () => (await text(C, `${pli} .rgc-x`)) === 'The new harbour, as promised.' && !!(await C.$(`${pli} button.rgc-pic img`)), 15000));
check('the small copy is laid out at its size before it is drawn', await C.$eval(`${pli} .rgc-pic img`, i => i.getAttribute('width') === '240' && i.getAttribute('height') === '135'));
await C.locator('#rgc-dock').screenshot({ path: OUT + '/chat-picture-line.png' });
await C.click(`${pli} button.rgc-pic`);
check('a click shows the picture over the page, fetched at its full size', await until(() => C.$eval('#rgc-lb', d => d.open && d.classList.contains('full') && d.querySelector('#rgc-lb-img').naturalWidth === 1600).catch(() => false), 15000));
check('with who posted it, when, and its words', /Adminland/.test(await text(C, '#rgc-lb-h')) && (await text(C, '#rgc-lb .rgc-lbx')) === 'The new harbour, as promised.');
await C.locator('#rgc-lb').screenshot({ path: OUT + '/chat-picture-open.png' });
await C.click('#rgc-lb-img');
check('a click on it shows it at its own size', await until(() => C.$eval('#rgc-lb', d => d.classList.contains('zoom') && Math.round(d.querySelector('#rgc-lb-img').getBoundingClientRect().width) === 1600)));
await C.keyboard.press('Escape');
check('Escape closes it, and the drawer stays open', await until(async () => !(await C.$('#rgc-lb')) && !!(await C.$('#rgc-dock:not([hidden])'))));
// pasted into the box, it is taken too; it may be taken away again, and goes with no words
const tall = (await pngOf(A, 900, 1200, 20)).toString('base64');
await paste(A, tall, 'tall.png');
check('a picture pasted into the box is taken too', await until(async () => /900 × 1200/.test(await text(A, '#rgc-picbar')), 15000), await text(A, '#rgc-foot'));
await A.click('#rgc-picbar [data-pic="no"]');
check('and can be taken away again', await until(() => A.$eval('#rgc-picbar', e => e.hidden)));
await paste(A, tall, 'tall.png');
await until(async () => /900 × 1200/.test(await text(A, '#rgc-picbar')), 15000);
await sleep(1700); await A.focus('#rgc-x'); await A.press('#rgc-x', 'Enter');
const alone = await until(async () => (await restListAdmin(`rchat/${reg}/chat`)).find(d => d.fields.im && !d.fields.x?.stringValue && d.fields.a?.stringValue === uidA), 15000);
check('a picture goes with no words', !!alone && Number(alone.fields.im.mapValue.fields.fh.integerValue) === 1200, JSON.stringify(alone?.fields?.x));
const ali = `#rgc-list .rgc-l[data-id="${alone?.id}"]`;
check('drawn as the picture alone', await until(async () => !!(await C.$(`${ali} button.rgc-pic`)) && !(await C.$(`${ali} .rgc-x`)), 15000));
check('a phone fits it in the drawer', await until(async () => !!(await P.$(`${ali} button.rgc-pic`)), 15000) && await P.$eval(`${ali} button.rgc-pic`, b => b.getBoundingClientRect().right <= innerWidth));
await C.click(`#rgc-list .rgc-more[data-id="${alone?.id}"]`); await C.click('.rgc-menu [data-rgc="reply"]');
check('answering a picture says so above the box', /Answering Adminland: 📷 A picture/.test(await text(C, '#rgc-rebar')), await text(C, '#rgc-rebar'));
await C.keyboard.press('Escape');
const fake = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const refused = await civic(B, { op: 'rcPost', x: 'Me too', pic: { th: fake, w: 1, h: 1, d: fake, fw: 1, fh: 1 } });
check('the server refuses a picture from anyone but an admin', !refused.ok && refused.code === 'not_granted' && /Only Edictum admins can post pictures/.test(refused.message), JSON.stringify(refused));
// the admin portal: the small copies in the log, a picture as a region's newest line, and a picture from the team's box
await A.keyboard.press('Escape');
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-chat"]');
check('the admin portal’s Region chats shows the small copies', await until(async () => !!(await A.$(`#acx-log .acx-l[data-id="${picLine?.id}"] button.rgc-pic img`)), 15000));
check('and a picture as a region’s newest line', await until(async () => /📷 A picture/.test(await text(A, '#acx-regs .acx-reg.on')), 15000), await text(A, '#acx-regs .acx-reg.on'));
await A.setInputFiles('#acx-file', { name: 'map.png', mimeType: 'image/png', buffer: await pngOf(A, 800, 600, 120) });
check('the team’s box takes a picture too', await until(async () => /800 × 600/.test(await text(A, '#acx-picbar')), 15000));
await sleep(1700);
await A.fill('#acx-x', 'Tonight’s map of the region.'); await A.press('#acx-x', 'Enter');
check('the team’s picture reaches the region, signed Edictum team', await until(() => C.$$eval('#rgc-list .rgc-l', l => { const li = l.find(x => x.querySelector('.rgc-x')?.textContent === 'Tonight’s map of the region.'); return !!li && !!li.querySelector('.rgc-team') && !!li.querySelector('button.rgc-pic'); }), 15000));
await A.click(`#acx-log [data-act="acx-del"][data-id="${picLine?.id}"]`); await A.click(`#acx-log [data-act="acx-del-yes"][data-id="${picLine?.id}"]`);
check('removing a line takes its picture with it', await until(async () => !(await restListAdmin(`rcimg/${reg}/chat`)).some(d => d.id === picLine?.id) && !(await restListAdmin(`rchat/${reg}/chat`)).some(d => d.id === picLine?.id), 15000));
check('and it goes from the drawers', await until(async () => !(await C.$(pli))));
await A.click('.adm-return'); await ready(A);

await finish();
