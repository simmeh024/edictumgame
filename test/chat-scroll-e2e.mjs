// Every chat keeps to its newest line, on the emulators: the chat drawer's Region, World and Alliance tabs and the
// alliance's channel on the Diplomacy page open on their newest line and follow each new one; a box that changes size
// under the lines (a long draft, the answer bar, a taller writing box) keeps the newest line in sight; only the reader's
// own scrolling lets go of the bottom, a new line then waits behind Latest lines, and writing goes back down.
//   npm run test:chat-scroll
import { player, open, found, register, until, check, finish, text, clearEmulators, sleep, nav, nationDoc, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const B = await player('writer'), C = await player('reader');
const uidB = await open(B); await found(B, 'Chatterly');
const uidC = await open(C); await found(C, 'Quillmark');
await register(B); await register(C);
const reg = await C.evaluate(() => G.S.nation.reg);
check('the two nations share one region', reg && reg === await B.evaluate(() => G.S.nation.reg), reg);

const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
const put = (path, fields) => fetch(docUrl(path), { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) });
const s = v => ({ stringValue: v }), n = v => ({ integerValue: String(v) });
const chatLine = (x, t, extra = {}) => ({ a: s(uidB), nm: s('Chatterly'), x: s(x), t: n(t), exp: { timestampValue: new Date(t + 30 * 864e5).toISOString() }, ...extra });
const words = i => `Line ${i}: the harbour master reports ${i % 3 ? 'a quiet tide' : 'a long queue of grain ships waiting for a berth, and asks every nation to be patient with the cranes'}.`;
const T0 = Date.now() - 70 * 60000;
await Promise.all(Array.from({ length: 60 }, (_, i) => put(`rchat/${reg}/chat/seed${String(i).padStart(3, '0')}`, chatLine(words(i), T0 + i * 60000))));
await Promise.all(Array.from({ length: 60 }, (_, i) => put(`rchat/world/chat/wseed${String(i).padStart(3, '0')}`, chatLine('World ' + words(i), T0 + i * 60000, { rg: s(reg) }))));

/* how far the box is from its bottom, and whether the newest line is in sight */
const gap = (p, sel) => p.$eval(sel, el => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)).catch(() => -1);
const atEnd = async (p, sel) => { const g = await gap(p, sel); return g >= 0 && g <= 2; };
const newestSeen = p => p.evaluate(() => { const b = document.getElementById('rgc-body'), l = [...document.querySelectorAll('#rgc-list .rgc-l')].pop(); if (!b || !l) return false; const r = l.getBoundingClientRect(), q = b.getBoundingClientRect(); return r.bottom <= q.bottom + 1 && r.bottom > q.top; });
const lines = p => p.$$eval('#rgc-list .rgc-l', l => l.length);
const jumpShown = p => p.$eval('.rgc-jump', b => !b.hidden).catch(() => false);
const wheelUp = async (p, sel, dy = -900) => { const b = await p.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); await p.mouse.move(b.x, b.y); await p.mouse.wheel(0, dy); await sleep(400); };

/* ── 1. the drawer opens on the newest line of each tab ── */
await C.click('.rgc-btn'); await C.waitForSelector('#rgc-dock:not([hidden])');
check('the region chat opens with its lines', await until(async () => (await lines(C)) >= 60, 20000), String(await lines(C)));
check('it opens on the newest line', await until(() => atEnd(C, '#rgc-body')) && await newestSeen(C), String(await gap(C, '#rgc-body')));
await C.click('#rgc-tab-world');
check('the World tab opens on its newest line', await until(async () => (await lines(C)) >= 60 && /World Line 59/.test(await text(C, '#rgc-list')) && await atEnd(C, '#rgc-body'), 20000), String(await gap(C, '#rgc-body')));
await C.click('#rgc-tab-region');
check('and back on Region, its newest line again', await until(() => atEnd(C, '#rgc-body')) && /Line 59/.test(await text(C, '#rgc-list')));

/* ── 2. a new line follows at once ── */
await put(`rchat/${reg}/chat/fresh1`, chatLine('A fresh line from the harbour, just in.', Date.now()));
check('a new line shows, and the chat follows it down', await until(async () => /A fresh line from the harbour/.test(await text(C, '#rgc-list .rgc-l:last-child')) && await atEnd(C, '#rgc-body') && await newestSeen(C), 15000), String(await gap(C, '#rgc-body')));

/* ── 3. a box that changes size keeps the newest line in sight ── */
await C.fill('#rgc-x', 'A long draft about the grain ships, the cranes, the tides and the harbour master, who has been on duty since dawn and would very much like a cup of tea and a chair, if anybody has one to spare. '.repeat(3));
check('a long draft grows the writing box', await until(() => C.$eval('#rgc-x', t => t.offsetHeight > 90)), String(await C.$eval('#rgc-x', t => t.offsetHeight)));
check('and the newest line stays in sight above it', await until(async () => await atEnd(C, '#rgc-body') && await newestSeen(C)), String(await gap(C, '#rgc-body')));
await C.fill('#rgc-x', '');
const last = await C.$eval('#rgc-list .rgc-l:last-child', l => l.dataset.id);
await C.click(`#rgc-list .rgc-more[data-id="${last}"]`); await C.click(`.rgc-menu [data-rgc="reply"][data-id="${last}"]`);
check('answering a line shows the answer bar over the box', await until(async () => !(await C.$eval('#rgc-rebar', b => b.hidden))));
check('and the newest line stays in sight above it', await until(async () => await atEnd(C, '#rgc-body') && await newestSeen(C)), String(await gap(C, '#rgc-body')));
await C.click('[data-rgc="re-no"]');
await C.evaluate(() => { document.getElementById('rgc-foot').style.paddingBottom = '180px'; });
check('a box squeezed from below with no scrolling of its own still shows the newest line', await until(async () => await atEnd(C, '#rgc-body') && await newestSeen(C)) && !(await jumpShown(C)), String(await gap(C, '#rgc-body')));
await C.evaluate(() => { document.getElementById('rgc-foot').style.paddingBottom = ''; });

/* ── 4. the reader scrolls up: the chat stays put, Latest lines brings it back ── */
await wheelUp(C, '#rgc-body');
check('scrolled up by the reader, the chat lets go of the bottom', (await gap(C, '#rgc-body')) > 200 && await until(() => jumpShown(C)) && await C.evaluate(() => G.CHAT().RGC.stick) === false, String(await gap(C, '#rgc-body')));
const held = await C.$eval('#rgc-body', b => b.scrollTop);
await put(`rchat/${reg}/chat/fresh2`, chatLine('Another line while the reader looks back.', Date.now()));
check('a new line then does not pull the reader down', await until(async () => /Another line while the reader looks back/.test(await text(C, '#rgc-list'))) && Math.abs(await C.$eval('#rgc-body', b => b.scrollTop) - held) <= 2 && await jumpShown(C));
await C.click('.rgc-jump');
check('Latest lines goes back to the newest line', await until(() => atEnd(C, '#rgc-body')) && !(await jumpShown(C)));
await wheelUp(C, '#rgc-body');
await C.fill('#rgc-x', 'Writing takes me back down.'); await C.press('#rgc-x', 'Enter');
check('writing a line goes back to the newest line', await until(async () => /Writing takes me back down/.test(await text(C, '#rgc-list .rgc-l:last-child')) && await atEnd(C, '#rgc-body'), 15000), String(await gap(C, '#rgc-body')));
await wheelUp(C, '#rgc-body');
await C.click('[data-rgc="close"]'); await C.click('.rgc-btn'); await C.waitForSelector('#rgc-dock:not([hidden])');
check('closed while scrolled up, the chat opens again on its newest line', await until(() => atEnd(C, '#rgc-body')) && await newestSeen(C));
await C.click('[data-rgc="close"]');

/* ── 5. the alliance's channel on the Diplomacy page, and the drawer's Alliance tab ── */
const civic = (p, d) => p.evaluate(d => Promise.resolve(window.claude.use('civic')).then(api => api.request(d)).then(r => ({ ok: true, r }), e => ({ ok: false, code: e.details?.code || e.code, message: e.message })), d);
for (let i = 0; i < 5; i++) {
  await fetch(docUrl('nations/' + uidB) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: 12 } } }) });
  await B.evaluate(() => { const n = G.clone(G.S.nation); n.pop = 12; n.popAt = Date.now(); G.commit(n); });
  if (await until(async () => { const d = await nationDoc(uidB); return d && d.rec && d.rec.pop >= 11.9; }, 8000)) break;
}
const made = await civic(B, { op: 'alFound', name: 'The Scroll Pact', ty: 'def', acc: 'open' });
const aid = made.ok ? (made.r.aid || made.r.id || made.r.data?.aid) || await B.evaluate(() => G.ALX().alMine()?.id) : '';
check('an alliance is founded', made.ok && !!aid, JSON.stringify(made));
const joined = await civic(C, { op: 'alRequest', aid });
check('and the reader joins it', joined.ok, JSON.stringify(joined));
const alLine = (x, t, a = uidB, nm = 'Chatterly') => ({ a: s(a), nm: s(nm), x: s(x), t: n(t) });
await Promise.all(Array.from({ length: 50 }, (_, i) => put(`alliances/${aid}/chat/aseed${String(i).padStart(3, '0')}`, alLine('Ally ' + words(i), T0 + i * 60000))));
check('the reader is a member', await until(() => C.evaluate(() => !!G.ALX().alMine()), 20000));
await nav(C, 'diplomacy'); await C.click('#dp-tab-alliance');
await C.waitForSelector('[data-act="dp-sub"][data-v="channel"]', { timeout: 20000 }); await C.click('[data-act="dp-sub"][data-v="channel"]');
check('the channel opens with its messages', await until(async () => /Ally Line 49/.test(await text(C, '#al-chat')), 20000));
check('on its newest message', await until(() => atEnd(C, '#al-chat')), String(await gap(C, '#al-chat')));
await put(`alliances/${aid}/chat/afresh1`, alLine('Allies, the grain ships are in.', Date.now()));
check('a new message follows at once', await until(async () => /Allies, the grain ships are in/.test(await text(C, '#al-chat li:last-child')) && await atEnd(C, '#al-chat'), 15000), String(await gap(C, '#al-chat')));
await C.evaluate(() => G.render());
check('the page drawn anew keeps the newest message in sight', await until(() => atEnd(C, '#al-chat')), String(await gap(C, '#al-chat')));
await nav(C, 'cities'); await nav(C, 'diplomacy');
if (!(await C.$('#al-chat'))) { await C.click('#dp-tab-alliance'); await C.click('[data-act="dp-sub"][data-v="channel"]'); }
check('opened again from another page, the newest message', await until(async () => !!(await C.$('#al-chat')) && await atEnd(C, '#al-chat')), String(await gap(C, '#al-chat')));
await wheelUp(C, '#al-chat', -600);
const alHeld = await C.$eval('#al-chat', b => b.scrollTop);
check('the reader scrolls up in the channel', (await gap(C, '#al-chat')) > 200, String(await gap(C, '#al-chat')));
await put(`alliances/${aid}/chat/afresh2`, alLine('A second message while the reader looks back.', Date.now()));
check('a new message then does not pull the reader down', await until(async () => /A second message while the reader looks back/.test(await text(C, '#al-chat'))) && Math.abs(await C.$eval('#al-chat', b => b.scrollTop) - alHeld) <= 2, `${alHeld} → ${await C.$eval('#al-chat', b => b.scrollTop)}`);
await C.fill('#al-chat-x', 'On my way to the harbour.'); await C.click('#al-chat-form button[type="submit"]');
check('sending a message goes back to the newest one', await until(async () => /On my way to the harbour/.test(await text(C, '#al-chat li:last-child')) && await atEnd(C, '#al-chat'), 15000), String(await gap(C, '#al-chat')));
await C.click('.rgc-btn'); await C.waitForSelector('#rgc-dock:not([hidden])'); await C.click('#rgc-tab-ally');
check('the drawer’s Alliance tab opens on its newest message too', await until(async () => /On my way to the harbour/.test(await text(C, '#rgc-list .rgc-l:last-child')) && await atEnd(C, '#rgc-body'), 15000), String(await gap(C, '#rgc-body')));

/* ── 6. on a phone, the chat fills the screen and opens on its newest line ── */
await C.click('[data-rgc="close"]');
await C.setViewportSize({ width: 390, height: 760 });
await C.click('.rgc-btn'); await C.waitForSelector('#rgc-dock:not([hidden])'); await C.click('#rgc-tab-region');
check('on a phone it opens on the newest line', await until(async () => await atEnd(C, '#rgc-body') && await newestSeen(C)), String(await gap(C, '#rgc-body')));
await C.setViewportSize({ width: 390, height: 460 });
check('and a screen made shorter (a keyboard opening) keeps the newest line in sight', await until(async () => await atEnd(C, '#rgc-body') && await newestSeen(C)), String(await gap(C, '#rgc-body')));

await finish();
