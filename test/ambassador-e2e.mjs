// Edictum Ambassadors (functions/admin.js setAmb, functions/regionchat.js rcMute), on the emulators: an admin appoints one
// on the player's portal page; every player sees the blue Ambassador pill on the nation card and beside their lines in
// the chat at once; the ambassador has no portal, finds Silence in a player's line menu (and nothing to remove, and no
// taking the last day's lines), not on staff's lines; the silenced player is told an ambassador did it, and keeps their
// lines; stood down, the pill goes.
//   npm run test:ambassador
import { player, open, ready, found, until, check, finish, setClaims, text, restListAdmin, clearEmulators, sleep, OUT } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), M = await player('envoy'), B = await player('writer');
const uidA = await open(A); await found(A, 'Adminland');
const uidM = await open(M); await found(M, 'Envoyland');
const uidB = await open(B); await found(B, 'Chatterly');
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
const reg = await B.evaluate(() => G.S.nation.reg);
check('the test nations share one region', (await Promise.all([A, M].map(p => p.evaluate(() => G.S.nation.reg)))).every(r => r === reg), reg);
const openChat = async p => { if (!(await p.$('#rgc-dock:not([hidden])'))) await p.click('.rgc-btn'); await p.waitForSelector('#rgc-dock:not([hidden])'); };
const closeChat = async p => { if (await p.$('#rgc-dock:not([hidden])')) { await p.click('#rgc-dock [data-rgc="close"]'); await p.waitForSelector('#rgc-dock', { state: 'hidden' }); } };
const reopenChat = async p => { await closeChat(p); await openChat(p); };
const say = async (p, x) => { await openChat(p); await p.fill('#rgc-x', x); await p.press('#rgc-x', 'Enter'); };
const lineOf = (p, x) => p.$$eval('#rgc-list .rgc-l', (l, x) => (l.find(li => li.querySelector('.rgc-x')?.textContent === x) || {}).dataset?.id || '', x);
const pillOn = (p, x) => p.$$eval('#rgc-list .rgc-l', (l, x) => { const li = l.find(li => li.querySelector('.rgc-x')?.textContent === x); const s = li && li.querySelector('.rgc-lh .staff-pill'); return s ? { cls: s.className, t: s.textContent, bg: getComputedStyle(s).backgroundColor } : null; }, x);
const menuOf = async (p, x) => { const id = await lineOf(p, x); if (!id) return null; await p.click(`#rgc-list .rgc-more[data-id="${id}"]`); await p.waitForSelector('.rgc-menu'); const t = await text(p, '.rgc-menu'); await p.click(`#rgc-list .rgc-more[data-id="${id}"]`); return t; };
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const BLUE = 'rgb(29, 95, 168)';

/* ── 1. lines before the appointment ── */
await say(B, 'Hello from Chatterly!');
await say(M, 'Envoy here.');
await say(A, 'Admin here.');
await openChat(B);
check('everyone’s lines reach the region', await until(async () => !!(await lineOf(B, 'Hello from Chatterly!')) && !!(await lineOf(B, 'Envoy here.')) && !!(await lineOf(B, 'Admin here.')), 15000));
check('before the appointment, the envoy’s line has no pill', (await pillOn(B, 'Envoy here.')) === null);

/* ── 2. an admin appoints the ambassador on the player's portal page ── */
await closeChat(A);
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.click('.adm-nav [data-v="admin-players"]'); await until(async () => !(await A.$('.adm-main [role="status"]')));
await A.fill('#admin-q', uidM); await A.click('#admin-search button:not([type])');
await until(async () => !!(await A.$(`.tbl [data-act="admin-inspect"][data-id="${uidM}"]`)), 15000);
await A.click(`.tbl [data-act="admin-inspect"][data-id="${uidM}"]`);
check('the player page has an Ambassador section with Appoint', await until(async () => (await text(A, '.adm-detail')).includes(uidM) && /Ambassador\s*Not an ambassador\s*Appoint as ambassador/.test(await text(A, '.adm-detail')), 15000), (await text(A, '.adm-detail')).slice(-600));
await A.click(`[data-act="admin-ambrole"][data-v="on"][data-id="${uidM}"]`);
check('appointing says so, and shows the blue pill', await until(async () => /Appointed\. Everyone sees the blue Ambassador pill now/.test(await text(A, '.adm-detail')) && !!(await A.$('.adm-detail .staff-pill.amb')) && !!(await A.$(`[data-act="admin-ambrole"][data-v="off"]`)), 15000));
check('the server keeps the list every player reads', await until(async () => (await restListAdmin('ambassadors')).some(d => d.id === uidM)));
check('and the audit log keeps the appointment', await until(async () => (await restListAdmin('adminAudit')).some(d => d.fields.action?.stringValue === 'amb_appointed' && d.fields.target?.stringValue === uidM)));

/* ── 3. every player sees the blue pill at once: in the chat and on the nation card ── */
const pill = await until(async () => { const p = await pillOn(B, 'Envoy here.'); return p && /amb/.test(p.cls) ? p : null; }, 15000);
check('in the chat, the ambassador’s line carries the blue Edictum Ambassador pill', !!pill && pill.t === 'Edictum Ambassador' && pill.bg === BLUE, JSON.stringify(pill));
check('a player’s own line has none, and the admin’s keeps the staff pill', (await pillOn(B, 'Hello from Chatterly!')) === null && /Edictum staff/.test((await pillOn(B, 'Admin here.'))?.t || ''));
await closeChat(B);
await B.evaluate(id => { location.hash = '#visit/' + id; }, uidM);
check('the ambassador’s nation card carries the pill', await until(async () => /Envoyland/.test(await text(B, '.hero-name')) && (await text(B, '.hero-cat .staff-pill.amb')) === 'Edictum Ambassador', 15000), await text(B, '.hero-cat'));
check('in blue', (await B.$eval('.hero-cat .staff-pill.amb', s => getComputedStyle(s).backgroundColor)) === BLUE);
await B.screenshot({ path: OUT + '/ambassador-nation-card.png' });
await B.evaluate(() => { location.hash = '#nation'; });
check('the player’s own nation card has no pill', await until(async () => /Chatterly/.test(await text(B, '.hero-name')) && !(await B.$('.hero-cat .staff-pill'))));

/* ── 4. the ambassador: no portal, Silence on a player's line only ── */
await M.reload(); await ready(M);
check('reloaded, the game knows the ambassador', await until(() => M.evaluate(() => G.S.isAmb === true && !G.S.isMod && !G.S.isOwner), 15000));
check('the ambassador’s own nation card shows the pill', await until(async () => (await text(M, '.hero-cat .staff-pill.amb')) === 'Edictum Ambassador', 15000));
check('there is no Admin or Mod link to a portal', !(await M.$('.adm-pill')));
await M.evaluate(() => { location.hash = '#admin-reports'; }); await sleep(800);
check('nor does the portal open by its address', !(await M.$('.adm-main')) && !(await M.$('.adm-nav')) && !/Reports/.test(await text(M, 'main h1')), await text(M, 'main h1'));
await M.evaluate(() => { location.hash = '#nation'; }); await sleep(300);
await openChat(M);
await until(async () => !!(await lineOf(M, 'Hello from Chatterly!')), 15000);
const onPlayer = await menuOf(M, 'Hello from Chatterly!');
check('on a player’s line: Silence, and nothing to remove', /Silence Chatterly…/.test(onPlayer || '') && !/Remove the line/.test(onPlayer || ''), onPlayer);
const onStaff = await menuOf(M, 'Admin here.');
check('on staff’s line: no Silence', onStaff !== null && !/Silence/.test(onStaff), onStaff);
const onOwn = await menuOf(M, 'Envoy here.');
check('on their own line: Delete, as anyone’s own', /Delete/.test(onOwn || '') && !/Silence/.test(onOwn || ''), onOwn);
const hello = await lineOf(M, 'Hello from Chatterly!');
await M.click(`#rgc-list .rgc-more[data-id="${hello}"]`); await M.click('.rgc-menu [data-rgc="mute-ask"]');
check('Silence asks how long and why, with nothing about removing lines', await until(async () => /Silence Chatterly in every region’s chat\?/.test(await text(M, '#rgc-list .rgc-mute'))) && !(await M.$('#rgc-list .rgc-mute [data-rgc="mute-wipe"]')));
await M.selectOption(`#rgc-mh-${hello}`, '1'); await M.fill(`#rgc-mw-${hello}`, 'Rudeness');
await M.click(`#rgc-list .rgc-mute [data-rgc="mute"]`);
check('silencing says so', await until(async () => /Chatterly is silenced in the region chat for/.test(await toasts(M)), 30000), await toasts(M));
check('the server keeps the silence, marked as an ambassador’s', await until(async () => { const s = (await restListAdmin('rcMute')).find(d => d.id === uidB); return !!s && s.fields.amb?.booleanValue === true && s.fields.by?.stringValue === uidM && s.fields.why?.stringValue === 'Rudeness'; }));
check('the player’s lines stay', !!(await lineOf(M, 'Hello from Chatterly!')));

/* ── 4b. the ambassadors' chat: a tab of its own, for ambassadors and staff alone ── */
const tabsOf = p => p.evaluate(() => G.CHAT().tabs);
const AMB_LINE = 'A player in this region asked about borders.';
check('the ambassador has an Ambassadors tab', await until(async () => (await tabsOf(M)).includes('amb') && (await text(M, '#rgc-tab-amb')).startsWith('Ambassadors'), 15000), JSON.stringify(await tabsOf(M)));
check('the admin has it too', await until(async () => (await tabsOf(A)).includes('amb'), 15000), JSON.stringify(await tabsOf(A)));
check('a player has none', !(await tabsOf(B)).includes('amb'), JSON.stringify(await tabsOf(B)));
await M.click('#rgc-tab-amb');
check('its header and intro say who reads it', await until(async () => (await text(M, '.rgc-ht .eyebrow')) === 'Ambassadors’ chat' && /Only Edictum Ambassadors, moderators and the team read this chat/.test(await text(M, '#rgc-list .rgc-intro'))), await text(M, '#rgc-dock'));
await M.fill('#rgc-x', AMB_LINE); await M.press('#rgc-x', 'Enter');
check('the ambassador’s line shows in the ambassadors’ chat', await until(async () => !!(await lineOf(M, AMB_LINE)), 15000));
check('the server keeps it there, not in the region chat', await until(async () => (await restListAdmin('rchat/amb/chat')).some(d => d.fields.x?.stringValue === AMB_LINE))
  && !(await restListAdmin(`rchat/${reg}/chat`)).some(d => d.fields.x?.stringValue === AMB_LINE));
check('the admin reads it, and their Chat button counts it', await until(() => A.evaluate(x => G.CHAT().RGA.list.some(m => m.x === x) && G.CHAT().amb >= 1, AMB_LINE), 15000));
check('the player never hears it', !(await B.evaluate(x => G.CHAT().RGA.list.some(m => m.x === x) || !!G.CHAT().RGA.on, AMB_LINE)));
await M.screenshot({ path: OUT + '/ambassador-chat-tab.png' });
await M.click('#rgc-tab-region');

/* ── 5. the silenced player is told an ambassador did it ── */
await openChat(B); await reopenChat(B);
check('the silenced player sees it was an ambassador, and why', await until(async () => /An ambassador has silenced you in the region chat until .+\. Reason: Rudeness\./.test(await text(B, '#rgc-foot')) && !(await B.$('#rgc-x')), 15000), await text(B, '#rgc-foot'));

/* ── 6. stood down, the pill goes for everyone ── */
await A.click(`[data-act="admin-ambrole"][data-v="off"][data-id="${uidM}"]`);
check('standing down says so', await until(async () => /No longer an ambassador\./.test(await text(A, '.adm-detail')), 15000));
check('the line loses its pill', await until(async () => (await pillOn(B, 'Envoy here.')) === null, 15000));
check('the list no longer has them', !(await restListAdmin('ambassadors')).some(d => d.id === uidM));
check('and their Ambassadors tab goes at once', await until(async () => !(await tabsOf(M)).includes('amb'), 15000), JSON.stringify(await tabsOf(M)));
await finish();
