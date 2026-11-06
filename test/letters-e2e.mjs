// Letters between nations, on the emulators, with three players: the Messages page's Settings and Customise buttons,
// drafts kept per conversation, formal notes, answers, attachments with the buttons of their own page, a notice when a
// letter arrives, read receipts, ten unanswered letters, blocking, reporting, group letters, muting, searching,
// archiving, deleting, the offices' switches, stationery, push notifications and letters by post told right away
// (functions/letters.js), and the computer nations' letters.
//   npm run test:letters
import path from 'node:path';
import { player, open, found, until, check, finish, nav, text, restListAdmin, clearEmulators, sleep, OUT, FS_HOST, PROJECT, czSection, nationDoc } from './lib.mjs';
await clearEmulators();
const A = await player('A'), B = await player('B'), C = await player('C');
const uidA = await open(A); await found(A, 'Inkwell');
const uidB = await open(B); await found(B, 'Postland');
const uidC = await open(C); await found(C, 'Quillmark');
const owner = (p, init) => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, Object.assign({ headers: { 'content-type': 'application/json', authorization: 'Bearer owner' } }, init));
const ownerSet = (p, fields) => owner(p, { method: 'PATCH', body: JSON.stringify({ fields }) });
const letters = async () => (await restListAdmin('letters')).map(d => ({ id: d.id, by: d.fields.by?.stringValue, to: d.fields.to?.stringValue, x: d.fields.x?.stringValue, k: d.fields.k?.stringValue,
  a: d.fields.a?.mapValue?.fields, r: d.fields.r?.mapValue?.fields, g: d.fields.g?.mapValue?.fields, exp: d.fields.exp?.timestampValue }));
const find = async (by, to, x) => (await letters()).find(l => l.by === by && l.to === to && (typeof x === 'string' ? l.x === x : x.test(l.x)));
const hasOption = (p, id) => until(() => p.$(`#dm-new option[value="${id}"]`), 20000);
const write = async (p, peer, x) => { await nav(p, 'messages'); await hasOption(p, peer); await p.selectOption('#dm-new', peer); await p.waitForSelector('#dm-text'); await p.fill('#dm-text', x); await p.click('#dm-form button[type="submit"]'); };
const openThread = async (p, id) => { await nav(p, 'messages'); await until(() => p.$(`[data-act="dm-peer"][data-id="${id}"]`), 25000); await p.click(`[data-act="dm-peer"][data-id="${id}"]`); await sleep(300); };
const clickJs = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const bubbleText = p => p.$$eval('.bub p:not(.dm-note-h):not(.dm-att-k):not(.dm-att-t)', ps => ps.map(x => x.textContent));

/* ── 1. the page's buttons: Settings › Letters and Customise › Stationery ── */
await nav(A, 'messages');
check('Messages has a Settings and a Customise button side by side', !!(await A.$('.dm-head-b [data-v="settings"][data-sg-tab="letters"] + [data-act="dm-cz"]')));
check('the page says letters to players arrive at once', /arrive at once/.test(await text(A, '.dm-head')));
await A.click('.dm-head-b [data-v="settings"]');
check('Settings opens on its Letters tab', await until(async () => (await A.evaluate(() => location.hash)) === '#settings/letters' && await A.isVisible('#sg-p-letters #set-letters-off')));
check('which lists the offices, every one switched on', (await A.$$('#set-letters-off [data-act="sl-off"]')).length >= 5 && (await A.$$('#set-letters-off [data-act="sl-off"]:not(:checked)')).length === 0);
check('and has read receipts, notices, notifications and blocking', (await A.$$('#set-letters-rr [data-act="sl-rr"]:checked')).length === 1 && !!(await A.$('#set-letters-push')) && /not blocked anyone/.test(await text(A, '#set-letters-bl')));
await nav(A, 'messages'); await A.click('.dm-head-b [data-act="dm-cz"]');
check('Customise opens on Stationery', await until(async () => (await A.evaluate(() => location.hash)) === '#customise/stationery' && await A.isVisible('#cz-sec-l')));
check('Stationery is in the side list of sections', !!(await A.$('#cz-go-l')) || !!(await A.$('#cz-sub-l')));
check('with papers, seals and signatures, some to be earned', (await A.$$('#cz-sec-l .cz-g-lp .cz-tile')).length >= 9 && (await A.$$('#cz-sec-l .cz-g-ls .cz-tile.locked')).length >= 3);
await A.click('#cz-lp-lp-cream'); await sleep(300); await A.click('#cz-ls-ls-red'); await sleep(300); await A.click('#cz-lg-lg-name'); await sleep(300);
check('choosing paper, seal and signature saves them', await until(async () => { const c = await A.evaluate(() => G.S.nation.cz || {}); return c.lp === 'lp-cream' && c.ls === 'ls-red' && c.lg === 'lg-name'; }));
if (await A.$('[data-act="cz-ctx"][data-v="letter"]')) await A.click('[data-act="cz-ctx"][data-v="letter"]');
check('the preview shows a letter on that paper, sealed and signed', await until(async () => !!(await A.$('.cz-lv-letter .bub.lp-cream .dm-wax.ls-red')) && !!(await A.$('.cz-lv-letter .dm-sig'))));
await A.locator('#cz-sec-l').screenshot({ path: path.join(OUT, 'letters-stationery.png') }).catch(() => {});

/* ── 2. each conversation keeps its own half-written letter ── */
await nav(A, 'messages'); await hasOption(A, uidB); await hasOption(A, uidC);
await A.selectOption('#dm-new', uidB); await A.fill('#dm-text', 'half a letter to Postland');
await A.selectOption('#dm-new', uidC); await A.waitForSelector('#dm-text');
check('another conversation starts with an empty letter', (await A.inputValue('#dm-text')) === '');
await A.selectOption('#dm-new', uidB); await A.waitForSelector('#dm-text');
check('and the first keeps its half-written letter', (await A.inputValue('#dm-text')) === 'half a letter to Postland');

/* ── 3. a formal note with a trade offer attached; it arrives with a notice ── */
await nav(A, 'trade'); await A.selectOption('#tr-w', uidB); await A.selectOption('#tr-gr', 'food'); await A.selectOption('#tr-rr', 'iron'); await A.fill('#tr-ga', '2'); await A.fill('#tr-ra', '1'); await A.click('#deal-form button[type="submit"]');
check('A offers B a deal', await until(() => A.evaluate(uid => (G.S.nation.deals || []).some(d => d.w === uid && !d.a), uidB)));
await nav(B, 'nation');
await nav(A, 'messages'); await A.selectOption('#dm-new', uidB); await A.waitForSelector('#dm-text');
await A.selectOption('#dm-kind', 'friend'); await A.fill('#dm-text', 'Shall our nations be friends? A small trade to begin.');
check('the composer offers the trade offer as an attachment', await until(() => A.$('.dm-att [data-act="dm-attmenu"]')));
await A.click('.dm-att [data-act="dm-attmenu"]'); await A.click('.dm-att-p [data-act="dm-attach"]');
check('and shows it on the letter', /Trade offer/.test(await text(A, '.dm-att-chip')));
await A.click('#dm-form button[type="submit"]');
const note = await until(() => find(uidA, uidB, /^Shall our nations be friends/), 20000);
check('the letter goes out as a Note of Friendship with the offer, kept for a year', !!note && note.k === 'friend' && note.a?.k?.stringValue === 'deal' && !!note.exp && Date.parse(note.exp) - Date.now() > 360 * 864e5);
// (the notice may wait its turn behind the rewards of founding)
check('the reader gets a notice, with a link to the letter', await until(async () => /A letter from Inkwell/.test(await text(B, '#toast')) && !!(await B.$('#toast [data-kind="letter"]')), 60000), await text(B, '#toast'));
await B.click('#toast [data-kind="letter"]');
check('which opens the conversation', await until(async () => (await B.evaluate(() => G.S.view)) === 'messages' && (await B.evaluate(() => G.S.msgPeer)) === uidA));
check('the note shows its kind, and the writer’s paper, seal and signature', await until(async () => /Note of Friendship/.test(await text(B, '.bub:not(.mine) .dm-note-h')) && !!(await B.$('.bub.lp-cream .dm-wax.ls-red')) && /Inkwell/.test(await text(B, '.bub .dm-sig'))));
check('the trade offer is a card with Accept and Decline', !!(await B.$('.dm-att-c [data-act="tr-accept"]')) && !!(await B.$('.dm-att-c [data-act="tr-decline"]')));
await B.locator('.thread').screenshot({ path: path.join(OUT, 'letters-note.png') }).catch(() => {});
await B.click('.dm-att-c [data-act="tr-accept"]');
check('accepting it in the letter signs the deal', await until(() => B.evaluate(uid => (G.S.nation.deals || []).some(d => d.w === uid && d.a), uidA)));

/* ── 4. read receipts, kept private ── */
const seenDoc = async () => (await restListAdmin('lseen')).find(d => d.fields.r?.stringValue === uidB && d.fields.w?.stringValue === uidA);
check('reading it leaves a read receipt', !!(await until(seenDoc, 15000)));
await nav(A, 'messages'); await A.click(`[data-act="dm-peer"][data-id="${uidB}"]`);
check('which the writer sees as Seen', await until(async () => /Seen/.test(await text(A, '.bub.mine:last-of-type .bub-t')) || (await A.$$eval('.bub.mine .bub-t', ts => ts.some(t => /Seen/.test(t.textContent)))), 20000));
check('what B has read is no longer in its public record', await until(async () => { const r = await nationDoc(uidB); return !!r && !('seenDm' in (r.shared || {})); }, 20000));

/* ── 5. an answer, quoting the letter ── */
await clickJs(B, '.bub:not(.mine) [data-act="dm-reply"]');
check('Reply puts the letter above the answer', await until(async () => /Shall our nations be friends/.test(await text(B, '.dm-quoting'))));
await B.fill('#dm-text', 'Gladly, friend.'); await B.click('#dm-form button[type="submit"]');
const ans = await until(() => find(uidB, uidA, 'Gladly, friend.'), 20000);
check('the answer carries the words it answers', !!ans && /Shall our nations/.test(ans.r?.x?.stringValue || ''));
check('and A sees them quoted', await until(async () => /Shall our nations/.test(await text(A, '.bub:not(.mine) .dm-q')), 20000));

/* ── 6. ten letters in a row wait for an answer ── */
await ownerSet('lpair/' + uidA + '~' + uidB, { by: { stringValue: uidA }, to: { stringValue: uidB }, u: { integerValue: '9' }, l: { timestampValue: new Date(Date.now() - 60000).toISOString() } });
await A.fill('#dm-text', 'The tenth'); await A.click('#dm-form button[type="submit"]');
check('a tenth letter in a row still goes', !!(await until(() => find(uidA, uidB, 'The tenth'), 25000)));
await sleep(3500);
await A.fill('#dm-text', 'The eleventh'); await A.click('#dm-form button[type="submit"]');
check('an eleventh waits for an answer, and says so', await until(async () => /Waiting for a reply/.test(await text(A, '.thread')), 30000), await text(A, '.thread .bub.mine:last-of-type'));
check('and is not delivered', !(await find(uidA, uidB, 'The eleventh')));
await openThread(B, uidA); await B.fill('#dm-text', 'Do go on.'); await B.click('#dm-form button[type="submit"]');
await until(() => find(uidB, uidA, 'Do go on.'), 20000);
await until(() => A.evaluate(uid => G.LTR().dmThreads(Date.now()).get(uid).some(m => !m.mine && m.x === 'Do go on.'), uidB), 20000);
await A.evaluate(() => G.LTR().dmFlush());
check('once B answers, it goes', !!(await until(() => find(uidA, uidB, 'The eleventh'), 30000)));

/* ── 7. reporting a letter ── */
await openThread(B, uidA);
await clickJs(B, '.bub:not(.mine) [data-act="dm-report"]');
check('Report opens the report dialog, with the letter', await until(async () => /Report this letter/.test(await text(B, 'dialog.ed-dlg[open]'))));
await B.click('[data-ed="report-yes"]');
const rep = async () => (await restListAdmin('reports')).find(d => d.fields.kind?.stringValue === 'letter' && d.fields.target?.stringValue === uidA);
check('the report reaches the moderators with the letter’s words', !!(await until(rep, 15000)) && !!(await rep()).fields.x?.stringValue);

/* ── 8. blocking ── */
await B.waitForSelector('dialog.ed-dlg[open]', { state: 'detached' }).catch(() => {});
await openThread(B, uidA);
await B.click('.thread-h [data-act="dm-menu"]'); await B.click('[data-act="dm-block-ask"]');
check('Block asks first', /Block Inkwell\?/.test(await text(B, '.dm-confirm')));
await B.click('.dm-confirm [data-act="dm-block"]');
const blk = async () => (await restListAdmin('lblock')).some(d => d.id === uidB + '~' + uidA);
check('a block is kept on the server and in the record', await until(blk, 15000) && await B.evaluate(uid => (G.S.nation.dmx.bl || []).includes(uid), uidA));
await sleep(3500);
await openThread(A, uidB); await A.fill('#dm-text', 'Are you there?'); await A.click('#dm-form button[type="submit"]');
check('a letter to a nation that blocked you says it was not delivered', await until(async () => /Not delivered/.test(await text(A, '.thread')), 30000));
check('and never reaches it', !(await find(uidA, uidB, 'Are you there?')));
await nav(B, 'settings'); await B.click('#sg-tab-letters');
check('Settings › Letters lists the blocked nation', /Inkwell/.test(await text(B, '#set-letters-bl')));
await B.click('#set-letters-bl [data-act="dm-block"]');
check('and unblocks it', await until(async () => !(await blk()) && /not blocked anyone/.test(await text(B, '#set-letters-bl')), 15000));

/* ── 9. a group letter, and its answer to everyone ── */
await nav(A, 'messages'); await A.click('[data-act="dm-gpick"]');
await A.check(`.dm-gl input[value="${uidB}"]`); await A.check(`.dm-gl input[value="${uidC}"]`); await A.fill('#dm-gname', 'The Inkwell Circle');
await A.click('[data-act="dm-gstart"]'); await A.waitForSelector('#dm-text');
await A.fill('#dm-text', 'Hello, all of you.'); await A.click('#dm-form button[type="submit"]');
const gB = await until(() => find(uidA, uidB, 'Hello, all of you.'), 30000), gC = await until(() => find(uidA, uidC, 'Hello, all of you.'), 30000);
check('a group letter reaches every member, as one conversation', !!gB && !!gC && gB.g?.id?.stringValue === gC.g?.id?.stringValue && /^gr:/.test(gB.g.id.stringValue));
const gid = gB.g.id.stringValue;
await openThread(C, gid);
check('C sees the group by its name, with its members', /The Inkwell Circle/.test(await text(C, '.thread-h')) && /Inkwell/.test(await text(C, '.dm-members')) && /Postland/.test(await text(C, '.dm-members')));
await C.fill('#dm-text', 'Hello back, everyone.'); await C.click('#dm-form button[type="submit"]');
check('an answer goes to every other member', !!(await until(() => find(uidC, uidA, 'Hello back, everyone.'), 30000)) && !!(await until(() => find(uidC, uidB, 'Hello back, everyone.'), 30000)));
await openThread(B, gid);
check('and shows who wrote each letter', await until(async () => { const w = await B.$$eval('.bub:not(.mine) .bub-who', ws => ws.map(x => x.textContent)); return w.includes('Quillmark') && w.includes('Inkwell'); }));

/* ── 10. mute, search, archive, delete ── */
await B.click('.thread-h [data-act="dm-menu"]'); await B.click('[data-act="dm-mute"]');
check('a muted conversation is marked, and kept off the count', await until(async () => !!(await B.$(`[data-act="dm-peer"][data-id="${gid}"] .dm-mu`)) && await B.evaluate(g => {
  const L = G.LTR(), now = Date.now(), seen = G.S.nation.seenDm || {}; let c = 0;
  for (const [p, a] of L.dmThreads(now)) if (p !== g) c += a.filter(m => !m.mine && m.t > (seen[p] || 0)).length;
  return (G.S.nation.dmx.mu || {})[g] === 1 && L.dmUnread(now) === c; }, gid)));
await B.fill('#dm-s', 'back, every');
check('search finds a letter by its words, and marks them', await until(async () => (await B.$$('.conv-list .conv')).length === 1 && /back, every/.test(await text(B, '.conv-list mark'))));
await B.fill('#dm-s', '');
await openThread(B, uidA); await B.click('.thread-h [data-act="dm-menu"]'); await B.click('[data-act="dm-arc"]');
check('an archived conversation leaves the inbox', await until(async () => !(await B.$(`.conv-list [data-id="${uidA}"]`))));
await B.click('[data-act="dm-filter"][data-v="archived"]');
check('and waits under Archived', await until(() => B.$(`.conv-list [data-id="${uidA}"]`)));
await B.click(`[data-act="dm-peer"][data-id="${uidA}"]`); await B.click('.thread-h [data-act="dm-menu"]'); await B.click('[data-act="dm-del-ask"]'); await B.click('.dm-confirm [data-act="dm-del"]');
check('deleting a conversation removes the letters it received from the server (not the group’s)', await until(async () => { const l = await letters(); return !l.some(x => x.by === uidA && x.to === uidB && !x.g) && l.some(x => x.by === uidA && x.to === uidB && x.g); }, 15000));
await B.click('[data-act="dm-filter"][data-v="all"]');
check('and from the list', !(await B.$(`.conv-list [data-id="${uidA}"]`)));

/* ── 11. the offices: switched off in Settings ── */
await nav(A, 'messages');
check('the Regional Gazette writes to every nation', await until(() => A.$('.conv-list [data-id="office-gazette"]')));
await nav(A, 'settings'); await A.click('#sg-tab-letters'); await A.uncheck('#set-letters-off [data-id="office-gazette"]');
check('switching it off is kept in the record', await until(() => A.evaluate(() => !!(G.S.nation.dmx.off || {})['office-gazette'])));
await nav(A, 'messages');
check('and its letters leave Messages', !(await A.$('.conv-list [data-id="office-gazette"]')));

/* ── 12. push notifications, and a letter by post right away, for a reader who is away ── */
await nav(A, 'settings'); await A.click('#sg-tab-letters');
check('Settings says whether this device can have notifications', await until(async () => /notification|Notifications/.test(await text(A, '.sl-push'))), await text(A, '.sl-push'));
if (await A.$('[data-act="sl-push-on"]:not([disabled])')) { await A.click('[data-act="sl-push-on"]'); check('without keys, notifications say they are not set up yet', await until(async () => /not set up|cannot|blocked/.test(await text(A, '.sl-push')), 15000), await text(A, '.sl-push')); }
await C.ctx.close();
const ts = v => ({ timestampValue: new Date(v).toISOString() });
await ownerSet('presence/' + uidC, { t: ts(Date.now() - 3600000) });
await ownerSet('pushSubs/' + uidC, { s: { arrayValue: { values: [{ mapValue: { fields: { e: { stringValue: 'https://push.example.test/sub/1' }, k: { mapValue: { fields: { p256dh: { stringValue: 'BAAA' }, auth: { stringValue: 'aaaa' } } } }, at: { integerValue: String(Date.now()) } } } }] } } });
await ownerSet('mailAccounts/' + uidC, { e: { stringValue: 'quill@example.test' }, ok: { booleanValue: true }, tok: { stringValue: 'tok-quill' }, p: { mapValue: { fields: { msg: { booleanValue: true }, now: { booleanValue: true } } } } });
await sleep(3500);
await write(A, uidC, 'Are you away?');
check('the letter to C is delivered', !!(await until(() => find(uidA, uidC, 'Are you away?'), 25000)));
const pushed = async () => (await restListAdmin('pushOutbox')).find(d => d.fields.to?.stringValue === uidC);
check('C, away, gets a push notification that names the writer but not the words', !!(await until(pushed, 20000)) && /Inkwell/.test(JSON.stringify((await pushed()).fields)) && !/Are you away/.test(JSON.stringify((await pushed()).fields)));
const mailed = async () => (await restListAdmin('mailOutbox')).find(d => d.fields.to?.stringValue === 'quill@example.test');
check('and a letter by post right away, as C chose', !!(await until(mailed, 20000)) && /A letter from Inkwell/.test((await mailed()).fields.subject.stringValue));

/* ── 13. the computer nations write first ── */
const npc = await A.evaluate(() => { const x = G.allNations().find(y => y.npc); const n = G.clone(G.S.nation), now = Date.now(); n.log.unshift({ t: now, k: 'war', a: x.id, b: x.n.name }); n.log = n.log.slice(0, 60); G.commit(n); return x.id; });
check('a computer nation answers a declaration of war with a letter of its own', await until(() => A.evaluate(id => (G.S.nation.dm || []).some(m => m.i && m.w === id && /declaration of war/.test(m.x)), npc)));
await nav(A, 'settings'); await A.click('#sg-tab-letters'); await A.uncheck('#sl-npc input');
check('Settings › Letters can stop the letters they write unasked', await until(() => A.evaluate(() => G.S.nation.dmx.npc === 0)));
const quiet = await A.evaluate(id => { const n = G.clone(G.S.nation), now = Date.now(); n.log.unshift({ t: now + 1, k: 'peace', a: id, b: 'x' }); n.log = n.log.slice(0, 60); G.commit(n); return (G.S.nation.dm || []).filter(m => m.i && m.w === id && /guns are silent/.test(m.x)).length; }, npc);
check('after which a peace brings no letter', quiet === 0);
check('and, about once a week, the closest one proposes a trade', await A.evaluate(() => { const m = G.LTR().npcIdea(G.S.nation, Date.now()); return !!m && m.a.k === 'idea' && m.i === 1; }));

await finish();
