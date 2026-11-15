// World chat (functions/regionchat.js, RC_WORLD), on the emulators: the chat drawer's World tab, where the nations of every
// region talk to each other. A line written in one region reaches a nation of another at once, with the writer's flag, name
// and region; the World tab counts its new lines, while the Chat button counts only those that name the player (with a
// notice and a bell entry, which opens the tab at the line); @ offers the nations that wrote there; answers, reactions and
// reports cross regions, and the Reports queue removes a world line; Settings › Chat turns the tab off and on; the admin
// portal's Region chats reads the world chat and writes in it as the Edictum team; #chat/world opens the tab.
//   npm run test:world-chat
import { player, open, ready, found, register, until, check, finish, setClaims, text, restListAdmin, clearEmulators, sleep, nav, BASE, OUT } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('south'), F = await player('north'), P = await player('phone', { vp: { width: 390, height: 800 } });
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Chatterly');
await open(F); await F.evaluate(() => localStorage.setItem('statehood.region', 'frostmarch')); await F.reload(); const uidF = await ready(F);
await found(F, 'Frostia');
await register(A); await register(B); await register(F);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
const regB = await B.evaluate(() => G.S.nation.reg), regF = await F.evaluate(() => G.S.nation.reg);
check('the two nations live in two regions', regF === 'frostmarch' && regB !== regF, regB + ' / ' + regF);

const lines = async () => (await restListAdmin('rchat/world/chat')).map(d => ({ id: d.id, a: d.fields.a?.stringValue, nm: d.fields.nm?.stringValue, x: d.fields.x?.stringValue,
  rg: d.fields.rg?.stringValue, fl: d.fields.fl?.stringValue, tm: d.fields.tm?.booleanValue, mn: d.fields.mn?.mapValue?.fields || null, r: d.fields.r?.mapValue?.fields || null }));
const openChat = async p => { if (!(await p.$('#rgc-dock:not([hidden])'))) await p.click('.rgc-btn'); await p.waitForSelector('#rgc-dock:not([hidden])'); };
const closeChat = async p => { await p.evaluate(() => { const b = document.querySelector('#rgc-dock:not([hidden]) [data-rgc="close"]'); if (b) b.click(); }); await sleep(200); };
/* the chat's own counts (EDICTUM_PROBE CHAT): the Region tab's, the World tab's and the world lines naming the player */
const chat = p => p.evaluate(() => { const c = G.CHAT(); return { count: c.count, region: c.region, world: c.world, named: c.named, tab: c.tab, open: c.RGC.open, unread: c.RGC.list.filter(m => m.t > c.RGC.seen).map(m => m.nm + ': ' + m.x) }; });
const tabs = p => p.$$eval('#rgc-tabs [role="tab"]', l => l.map(b => b.childNodes[0].textContent));
const shown = p => p.$$eval('#rgc-list .rgc-l:not(.pend) .rgc-x', l => l.map(x => x.textContent));
const record = p => p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden && !window.__toasts.includes(t.textContent)) window.__toasts.push(t.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); });
const told = p => p.evaluate(() => (window.__toasts || []).join(' | '));
const bellText = async p => { await p.evaluate(() => document.querySelector('.bell').click()); await sleep(300); const t = await p.evaluate(() => [...document.querySelectorAll('.nt-item')].map(e => e.textContent).join(' | ')); await p.evaluate(() => document.querySelector('.bell').click()); return t; };
await record(B);

/* ── 1. the World tab ── */
await openChat(B);
check('the drawer has a World tab after Region', JSON.stringify(await tabs(B)) === JSON.stringify(['Region', 'World', 'Happenings']), JSON.stringify(await tabs(B)));
await B.click('#rgc-tab-world');
check('the World tab names itself and says who reads it', await until(async () => (await text(B, '.rgc-ht .eyebrow')) === 'World chat' && (await text(B, '#rgc-h')) === 'Every region'
  && /The nations of every region read this chat/.test(await text(B, '.rgc-intro'))), await text(B, '#rgc-dock'));
check('an empty world chat says so, and the box writes to every region', await until(async () => /No lines yet\. Say hello to every region\./.test(await text(B, '#rgc-list')))
  && await B.getAttribute('#rgc-x', 'placeholder') === 'Write to every region…');

/* ── 2. a line from one region ── */
await B.fill('#rgc-x', 'Hello from the south! Anyone trading furs?'); await B.press('#rgc-x', 'Enter');
check('it shows in the writer’s World tab', await until(async () => (await shown(B)).includes('Hello from the south! Anyone trading furs?')));
const w1 = await until(async () => (await lines()).find(l => /trading furs/.test(l.x || '')), 15000);
check('the server keeps it in the world chat with its author, region and flag', !!w1 && w1.a === uidB && w1.nm === 'Chatterly' && w1.rg === regB && !!w1.fl, JSON.stringify(w1));
check('beside the name, the writer’s own region', /\S/.test(await text(B, `#rgc-list .rgc-l[data-id="${w1?.id}"] .rgc-from`)));
await B.click('#rgc-tab-region');
check('it is not in the region chat', await until(async () => await B.getAttribute('#rgc-tab-region', 'aria-selected') === 'true' && !(await shown(B)).some(x => /trading furs/.test(x))));
await B.click('#rgc-tab-world');
check('the box keeps a draft for each chat', await (async () => { await B.fill('#rgc-x', 'a world draft'); await B.click('#rgc-tab-region'); const r = await B.inputValue('#rgc-x'); await B.click('#rgc-tab-world'); const w = await B.inputValue('#rgc-x'); return r === '' && w === 'a world draft'; })());
await B.fill('#rgc-x', '');
await closeChat(B);

/* ── 3. a nation of another region reads it ── */
await openChat(F);
check('in another region, the World tab counts it', await until(async () => (await text(F, '#rgc-tab-world .rgc-tn')) === '1', 15000), await text(F, '#rgc-tabs'));
await closeChat(F);
check('the Chat button does not count a world line that does not name the nation', await until(async () => { const c = await chat(F); return c.world === 1 && c.named === 0 && c.count === c.region; }), JSON.stringify(await chat(F)));
await openChat(F); await F.click('#rgc-tab-world');
const li1 = `#rgc-list .rgc-l[data-id="${w1?.id}"]`;
check('it reads there with the writer’s flag, name and region', await until(async () => (await shown(F)).includes('Hello from the south! Anyone trading furs?'))
  && !!(await F.$(li1 + ' .rgc-lh .mflag svg')) && (await text(F, li1 + ' .rgc-nm')) === 'Chatterly' && (await text(F, li1 + ' .rgc-from')).length > 2
  && !/Frostmarch/.test(await text(F, li1 + ' .rgc-from')), await text(F, li1));
check('a nation of another region has no link to its page', !(await F.$(li1 + ' button.rgc-nm')));
check('looking at the tab clears its count', await until(async () => !(await F.$('#rgc-tab-world .rgc-tn'))));

/* ── 4. @ and answers across regions ── */
/* the notices of B's founding and first line (achievements, settling) play out first: the notice queue keeps five, so a
   burst of them would crowd the mention's notice out */
let calm = 0;
await until(async () => { calm = await B.evaluate(() => { const t = document.getElementById('toast'); return !t || t.hidden; }) ? calm + 1 : 0; return calm >= 8; }, 90000, 250);
await F.focus('#rgc-x'); await F.keyboard.type('@Chat');
check('@ offers the nations that wrote in the world chat, of any region', await until(async () => /@Chatterly/.test(await text(F, '#rgc-mn')) && !(await F.$eval('#rgc-mn', u => u.hidden))));
await F.keyboard.press('Enter'); await F.keyboard.type('the north has furs aplenty.'); await F.keyboard.press('Enter');
const w2 = await until(async () => (await lines()).find(l => /furs aplenty/.test(l.x || '')), 15000);
check('the line keeps the mention of a nation of another region', !!w2 && w2.mn?.[uidB]?.stringValue === 'Chatterly' && w2.rg === 'frostmarch', JSON.stringify(w2));
check('the nation named is told in a notice, and its Chat button counts it', await until(async () => { const c = await chat(B); return /Frostia mentioned Chatterly in the world chat/.test(await told(B)) && c.named === 1 && (await text(B, '.rgc-btn .rgc-n')) === String(c.count); }, 20000), await told(B) + ' ' + JSON.stringify(await chat(B)));
check('and finds it in its bell', await until(async () => /Frostia mentioned you in the world chat: @Chatterly the north has furs aplenty\./.test(await bellText(B)), 15000));
await B.evaluate(() => document.querySelector('.bell').click()); await sleep(300);
await B.click(`[data-act="nt-go"][data-rc="world/${w2?.id}"]`);
check('the bell opens the World tab at the line', await until(async () => !!(await B.$('#rgc-dock:not([hidden])')) && await B.getAttribute('#rgc-tab-world', 'aria-selected') === 'true'
  && !!(await B.$(`#rgc-list .rgc-l[data-id="${w2?.id}"]`)), 10000));
check('read, the Chat button no longer counts it', await until(async () => { const c = await chat(B); return c.named === 0 && c.count === c.region && (c.count ? (await text(B, '.rgc-btn .rgc-n')) === String(c.count) : await B.$eval('.rgc-btn .rgc-n', n => n.hidden)); }), JSON.stringify(await chat(B)));
await sleep(4200);
await B.click(`#rgc-list .rgc-more[data-id="${w2?.id}"]`); await B.click('.rgc-menu [data-rgc="reply"]');
check('Answer quotes the line from another region', /Answering Frostia/.test(await text(B, '#rgc-rebar')));
await B.keyboard.type('Deal. Furs for wine.'); await B.keyboard.press('Enter');
const w3 = await until(async () => (await lines()).find(l => l.x === 'Deal. Furs for wine.'), 15000);
check('the answer keeps its quote', w3?.r?.id?.stringValue === w2?.id, JSON.stringify(w3));
check('its writer, in the other region, sees the quote', await until(async () => /Frostia/.test(await text(F, `#rgc-list .rgc-l[data-id="${w3?.id}"] .rgc-q`)), 15000));

/* ── 5. reactions and a report ── */
await B.click(`#rgc-list .rgc-more[data-id="${w2?.id}"]`); await B.click('.rgc-menu [data-rgc="react"][data-k="hear"]');
check('a reaction from another region shows under the line for its writer', await until(async () => /1/.test(await text(F, `#rgc-list .rgc-l[data-id="${w2?.id}"] .rgc-rx`)), 15000));
await F.click(`#rgc-list .rgc-more[data-id="${w3?.id}"]`); await F.click('.rgc-menu [data-rgc="report"]');
await F.waitForSelector('dialog.ed-dlg[open] input[value="spam"]');
check('reporting a world line quotes it', /Deal\. Furs for wine\./.test(await text(F, 'dialog.ed-dlg[open] .ed-quote')));
await F.check('dialog.ed-dlg[open] input[value="spam"]'); await F.click('dialog.ed-dlg[open] [data-ed="report-yes"]');
const rep = await until(async () => (await restListAdmin('reports')).find(d => d.fields.post?.stringValue === 'rc:world:' + w3?.id), 15000);
check('it is filed as rc:world:<line>, under its writer’s region', !!rep && rep.fields.target?.stringValue === uidB && rep.fields.reg?.stringValue === regB, JSON.stringify(rep?.fields));
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-reports"]');
check('the queue names it a world chat line', await until(async () => /World chat/.test(await text(A, '.adm-reps')) && /Deal\. Furs for wine\./.test(await text(A, '.adm-reps')), 15000));
await A.click('[data-act="adm-delpost"]');
check('Remove asks first, naming the world chat', await until(async () => /Remove this world chat line by/.test(await text(A, '.adm-rep .adm-ask'))));
await A.click('[data-act="adm-delpost-yes"]');
// the admin console's function may start cold here: give it time
check('removing it deletes the line in both regions', await until(async () => !(await shown(B)).includes('Deal. Furs for wine.') && !(await shown(F)).includes('Deal. Furs for wine.'), 45000),
  JSON.stringify({ act: await text(A, '.adm-main .info, .adm-main [role="status"]').catch(() => ''), server: (await lines()).map(l => l.x) }));

/* ── 6. staff: Region chats reads the world chat and writes in it as the team ── */
await A.click('.adm-nav [data-v="admin-chat"]');
check('Region chats lists the world chat first', await until(async () => (await A.$$eval('#acx-regs .acx-reg', l => l.map(b => b.dataset.v)))[0] === 'world' && /Every region/.test(await text(A, '#acx-regs [data-v="world"]')), 15000));
await A.click('#acx-regs [data-v="world"]');
check('chosen, it shows the world chat’s lines with each writer’s region', await until(async () => /furs aplenty/.test(await text(A, '#acx-log')) && /Frostmarch/.test(await text(A, '#acx-log')), 15000), await text(A, '#acx-log'));
await A.fill('#acx-x', 'Welcome to the world chat, everyone.'); await A.press('#acx-x', 'Enter');
check('the team’s line reaches both regions, signed Edictum team', await until(async () => (await shown(B)).includes('Welcome to the world chat, everyone.') && (await shown(F)).includes('Welcome to the world chat, everyone.'), 15000)
  && /Edictum team/.test(await text(F, '#rgc-list .rgc-team')));
await A.click('.adm-return'); await ready(A);

/* ── 7. Settings › Chat turns the World tab off and on ── */
await closeChat(B);
await nav(B, 'settings'); await B.click('#sg-tab-chat');
await B.uncheck('#set-chat-world [data-rgc="set-world"]');
check('turned off, the World tab goes', await until(async () => { await openChat(B); const t = await tabs(B); await closeChat(B); return JSON.stringify(t) === JSON.stringify(['Region', 'Happenings']); }));
check('the setting is kept with the nation', await until(() => B.evaluate(() => G.S.nation.dmx?.rw === 0)));
await B.check('#set-chat-world [data-rgc="set-world"]');
check('turned on, it is back', await until(async () => { await openChat(B); const t = await tabs(B); await closeChat(B); return t.includes('World'); }));

/* ── 8. #chat/world, a world mention's push link, opens the tab; on a phone it fits ── */
await open(P); await found(P, 'Pocketland');
await P.goto('about:blank'); await P.goto(BASE + '/#chat/world'); await ready(P);
check('#chat/world opens the drawer on the World tab', await until(async () => !!(await P.$('#rgc-dock:not([hidden])')) && await P.getAttribute('#rgc-tab-world', 'aria-selected') === 'true', 20000));
check('a guest reads the world chat too', await until(async () => (await shown(P)).includes('Welcome to the world chat, everyone.'), 15000));
check('on a phone the line’s heading fits the drawer', await P.$$eval('#rgc-list .rgc-lh', l => l.every(h => h.scrollWidth <= h.clientWidth + 1)));
/* the screenshots: the guest's recovery-code dialog put away first, and the World tab in view */
for (let i = 0; i < 20 && !(await P.$('dialog[open] [data-ed="recovery-saved"]')); i++) await sleep(250);
if (await P.$('dialog[open] [data-ed="recovery-saved"]')) { await P.click('dialog[open] [data-ed="recovery-saved"]'); await sleep(400); }
await P.screenshot({ path: OUT + '/world-chat-phone.png' });
await openChat(B); await B.click('#rgc-tab-world'); await sleep(400);
await B.screenshot({ path: OUT + '/world-chat.png' });

await finish();
