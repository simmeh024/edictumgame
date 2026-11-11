// Region chat (functions/regionchat.js), on the emulators: the Chat button beside the bell opens a drawer on any page;
// Registered Nations of the region write lines that reach every other nation of it at once, paced by the server; a
// line naming a nation is marked and told; guests read only; a line's menu reports it (the moderators' queue, which
// removes it), blocks its nation (its lines hidden, and its letters stopped) or deletes it; staff remove any line;
// Settings › Letters turns the chat off.
//   npm run test:region-chat
import { player, open, ready, found, register, until, check, finish, setClaims, text, restListAdmin, clearEmulators, sleep, nav } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('writer'), C = await player('reader'), G = await player('guest'), P = await player('phone', { vp: { width: 390, height: 800 } });
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Chatterly');
const uidC = await open(C); await found(C, 'Quillmark');
await open(G); await found(G, 'Guestonia');
await open(P); await found(P, 'Pocketland');
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

/* ── 1. the button and the drawer ── */
check('the Chat button sits beside the bell', !!(await B.$('.brand-actions .bell + .rgc-btn')) && /Region chat/.test(await B.getAttribute('.rgc-btn', 'aria-label')));
await nav(B, 'cities');
await B.click('.rgc-btn');
await B.waitForSelector('#rgc-dock:not([hidden])');
check('it opens a drawer over any page, which names the region and says who reads it', await until(async () => (await text(B, '#rgc-h')).length > 2 && /Everyone in .+ can read this chat/.test(await text(B, '.rgc-intro')) && /online|Talk with the nations of/.test(await text(B, '#rgc-sub'))) && await B.evaluate(() => G.S.view) === 'cities');
check('the button says it is open', await B.getAttribute('.rgc-btn', 'aria-expanded') === 'true');
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

/* ── 4. guests read only; the server refuses them too ── */
await openChat(G);
check('a guest reads the chat', await until(async () => (await shown(G)).includes('We pay in grain.')));
check('a guest has no writing box, and is offered a sign-in', !(await G.$('#rgc-x')) && /needs a Registered Nation/.test(await text(G, '#rgc-foot')) && !!(await G.$('#rgc-foot [data-act="acct-open"]')));
const guest = await civic(G, { op: 'rcPost', x: 'Let me in' });
check('the server refuses a guest’s line', !guest.ok && guest.code === 'registration_required', JSON.stringify(guest));

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
check('Settings › Letters lists the blocked nation and has a Region chat card', await until(async () => /Chatterly/.test(await text(C, '#set-letters-bl')) && /Show the region chat/.test(await text(C, '#set-letters-chat'))));
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

/* ── 9. a phone: the drawer fills the screen; a nation's name opens its page ── */
await P.click('.rgc-btn'); await P.waitForSelector('#rgc-dock:not([hidden])');
const fills = () => P.$eval('#rgc-dock', d => { const r = d.getBoundingClientRect(); return { left: r.left, w: Math.round(r.width), h: Math.round(r.height), iw: innerWidth, ih: innerHeight }; });
check('on a phone the drawer fills the screen', await until(async () => { const r = await fills(); return r.left === 0 && r.w === r.iw && r.h >= r.ih - 1; }), JSON.stringify(await fills()));
check('the page behind it does not scroll', await P.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));
await until(async () => (await shown(P)).includes('Welcome, everyone. Be kind.'));
check('the page has no sideways scroll with the drawer open', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await P.click(`#rgc-list button.rgc-nm[data-id="${uidA}"]`);
check('a nation’s name opens its page and the drawer steps aside', await until(async () => await P.evaluate(() => G.S.view) === 'visit' && !!(await P.$('#rgc-dock[hidden]'))));

/* ── 10. Settings › Letters turns the chat off ── */
await nav(C, 'settings'); await C.click('#sg-tab-letters');
await C.uncheck('#set-letters-chat [data-rgc="set-on"]');
check('turning the chat off removes the button and closes the drawer', await until(async () => !(await C.$('.rgc-btn')) && !(await C.$('#rgc-dock:not([hidden])'))));
check('the setting is kept with the nation', await until(() => C.evaluate(() => G.S.nation.dmx?.rc === 0)));
await C.check('#set-letters-chat [data-rgc="set-on"]');
check('turning it on again brings the button back', await until(async () => !!(await C.$('.rgc-btn'))));

await finish();
