// French chat (functions/regionchat.js, RC_FR), on the emulators: a second chat every region shares, for the nations that
// play in French. Its tab, Français, shows by itself when the interface is in French (Settings › Display › Language) and
// for anyone who turns it on in Settings › Chat (dmx.rf), and goes when they turn it off. A line written in one region
// reaches a nation of another, with the writer's region beside the name; it never shows in the world chat. The admin
// portal's Region chats lists it beside the world chat, whatever the staff member's language, and writes in it as the
// Edictum team. When the drawer's tabs do not fit its row, arrows at its ends show there is more and step through it.
//   npm run test:french-chat
import { player, open, ready, found, register, until, check, finish, setClaims, text, restListAdmin, clearEmulators, sleep, nav, BASE, OUT } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('francais'), F = await player('north');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Bretonnie');
await open(F); await F.evaluate(() => localStorage.setItem('statehood.region', 'frostmarch')); await F.reload(); await ready(F);
await found(F, 'Frostia');
await register(A); await register(B); await register(F);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
const regB = await B.evaluate(() => G.S.nation.reg), regF = await F.evaluate(() => G.S.nation.reg);
check('the two nations live in two regions', regF === 'frostmarch' && regB !== regF, regB + ' / ' + regF);

const lines = async ch => (await restListAdmin('rchat/' + ch + '/chat')).map(d => ({ id: d.id, a: d.fields.a?.stringValue, x: d.fields.x?.stringValue, rg: d.fields.rg?.stringValue, tm: d.fields.tm?.booleanValue }));
const openChat = async p => { if (!(await p.$('#rgc-dock:not([hidden])'))) await p.click('.rgc-btn'); await p.waitForSelector('#rgc-dock:not([hidden])'); };
const closeChat = async p => { await p.evaluate(() => { const b = document.querySelector('#rgc-dock:not([hidden]) [data-rgc="close"]'); if (b) b.click(); }); await sleep(200); };
/* the tabs by their ids: the labels are translated in the French interface */
const tabs = p => p.$$eval('#rgc-tabs [role="tab"]', l => l.map(b => b.id.replace('rgc-tab-', '')));
const tabsNow = async p => { await openChat(p); const t = await tabs(p); await closeChat(p); return t; };
const shown = p => p.$$eval('#rgc-list .rgc-l:not(.pend) .rgc-x', l => l.map(x => x.textContent));
const chat = p => p.evaluate(() => { const c = G.CHAT(); return { frOn: c.frOn, fr: c.fr, frNamed: c.frNamed, count: c.count, tab: c.tab }; });

/* ── 1. in English, no Français tab; in French, it shows by itself ── */
check('a nation playing in English has no Français tab', JSON.stringify(await tabsNow(B)) === JSON.stringify(['region', 'world', 'haps']), JSON.stringify(await tabsNow(B)));
await B.evaluate(() => localStorage.setItem('statehood.lang.v1', 'fr')); await B.reload(); await ready(B);
check('with the game in French, the Français tab shows after World', await until(async () => JSON.stringify(await tabsNow(B)) === JSON.stringify(['region', 'world', 'fr', 'haps'])), JSON.stringify(await tabsNow(B)));
check('nothing was written for it: the tab follows the language', await B.evaluate(() => G.S.nation.dmx?.rf === undefined));
await openChat(B); await B.click('#rgc-tab-fr');
check('the tab is named Français, and its header and intro are in French', await until(async () => (await text(B, '#rgc-tab-fr')).startsWith('Français') && (await text(B, '.rgc-ht .eyebrow')) === 'Chat francophone'
  && (await text(B, '#rgc-h')) === 'En français' && /Les nations francophones de toutes les régions discutent ici/.test(await text(B, '.rgc-intro'))), await text(B, '#rgc-dock'));
check('an empty French chat says so, and the box asks for French', await until(async () => /Aucune ligne pour l’instant/.test(await text(B, '#rgc-list'))) && await B.getAttribute('#rgc-x', 'placeholder') === 'Écrire en français…');

/* ── 2. a line in French reaches the server's French chat, and only it ── */
await B.fill('#rgc-x', 'Bonjour à toutes les régions ! Qui parle français ?'); await B.press('#rgc-x', 'Enter');
check('it shows in the writer’s Français tab', await until(async () => (await shown(B)).includes('Bonjour à toutes les régions ! Qui parle français ?')));
const f1 = await until(async () => (await lines('fr')).find(l => /Qui parle français/.test(l.x || '')), 15000);
check('the server keeps it in the French chat with its author and region', !!f1 && f1.a === uidB && f1.rg === regB, JSON.stringify(f1));
check('it is not in the world chat', !(await lines('world')).some(l => /Qui parle français/.test(l.x || '')));
await B.click('#rgc-tab-world');
check('nor on the World tab', await until(async () => await B.getAttribute('#rgc-tab-world', 'aria-selected') === 'true' && !(await shown(B)).some(x => /Qui parle français/.test(x))));
await closeChat(B);

/* ── 3. a nation playing in English turns it on in Settings › Chat ── */
await nav(F, 'settings'); await F.click('#sg-tab-chat');
check('Settings › Chat has a French chat card, off for a nation playing in English', await until(async () => !!(await F.$('#set-chat-fr')) && !(await F.isChecked('#set-chat-fr [data-rgc="set-fr"]'))));
check('it says the tab shows by itself in French', /shows by itself when the game is in French/.test(await text(F, '#set-chat-fr')));
await F.check('#set-chat-fr [data-rgc="set-fr"]');
check('turned on, it is kept with the nation (dmx.rf 1)', await until(() => F.evaluate(() => G.S.nation.dmx?.rf === 1)));
check('and the Français tab shows, though the game is in English', await until(async () => (await tabsNow(F)).includes('fr')));
await openChat(F);
check('the tab counts the line from another region', await until(async () => (await text(F, '#rgc-tab-fr .rgc-tn')) === '1', 15000), await text(F, '#rgc-tabs'));
await F.click('#rgc-tab-fr');
const li1 = `#rgc-list .rgc-l[data-id="${f1?.id}"]`;
check('the line reads there with the writer’s name, flag and region; the box asks for French in English', await until(async () => (await shown(F)).includes('Bonjour à toutes les régions ! Qui parle français ?'))
  && (await text(F, li1 + ' .rgc-nm')) === 'Bretonnie' && !!(await F.$(li1 + ' .rgc-lh .mflag svg')) && (await text(F, li1 + ' .rgc-from')).length > 2
  && (await text(F, '.rgc-ht .eyebrow')) === 'French chat' && await F.getAttribute('#rgc-x', 'placeholder') === 'Write in French…', await text(F, li1));
check('looking at the tab clears its count', await until(async () => !(await F.$('#rgc-tab-fr .rgc-tn'))));
await sleep(4200);
await F.focus('#rgc-x'); await F.keyboard.type('@Bret');
check('@ offers the nations that wrote in the French chat, of any region', await until(async () => /@Bretonnie/.test(await text(F, '#rgc-mn'))));
await F.keyboard.press('Enter'); await F.keyboard.type('oui, un peu !'); await F.keyboard.press('Enter');
const f2 = await until(async () => (await lines('fr')).find(l => /oui, un peu/.test(l.x || '')), 15000);
check('its answer reaches the French chat from the Frostmarch', !!f2 && f2.rg === 'frostmarch', JSON.stringify(f2));
check('and the nation named counts it on its Chat button', await until(async () => (await chat(B)).frNamed === 1, 15000), JSON.stringify(await chat(B)));
await closeChat(F);

/* ── 4. the French player turns it off, and on again ── */
await nav(B, 'settings'); await B.click('#sg-tab-chat');
check('in French, the card is on and says why', await until(async () => await B.isChecked('#set-chat-fr [data-rgc="set-fr"]')) && /because the game is in French/.test(await text(B, '#set-chat-fr')));
await B.uncheck('#set-chat-fr [data-rgc="set-fr"]');
check('turned off, the tab goes though the game is in French (dmx.rf 0)', await until(async () => await B.evaluate(() => G.S.nation.dmx?.rf === 0) && !(await tabsNow(B)).includes('fr')));
check('and its line no longer counts on the Chat button', await until(async () => { const c = await chat(B); return !c.frOn && c.frNamed === 0; }), JSON.stringify(await chat(B)));
await B.check('#set-chat-fr [data-rgc="set-fr"]');
check('turned on, it is back', await until(async () => (await tabsNow(B)).includes('fr')));

/* ── 5. staff read it in the admin portal, whatever their language ── */
check('the admin plays in English, without the Français tab', !(await tabsNow(A)).includes('fr'));
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-chat"]');
check('Region chats lists the world chat, then the French chat, first', await until(async () => JSON.stringify((await A.$$eval('#acx-regs .acx-reg', l => l.map(b => b.dataset.v))).slice(0, 2)) === '["world","fr"]'
  && /In French/.test(await text(A, '#acx-regs [data-v="fr"]')), 15000), JSON.stringify(await A.$$eval('#acx-regs .acx-reg', l => l.map(b => b.dataset.v))));
await A.click('#acx-regs [data-v="fr"]');
check('chosen, it shows the French chat’s lines with each writer’s region', await until(async () => /Qui parle français/.test(await text(A, '#acx-log')) && /Frostmarch/.test(await text(A, '#acx-log')), 15000), await text(A, '#acx-log'));
check('and the team writes to the French chat', /Write to the French chat as the Edictum team/.test(await text(A, '#acx-f')));
await A.fill('#acx-x', 'Bienvenue dans le chat francophone !'); await A.press('#acx-x', 'Enter');
check('the team’s line reaches both regions’ Français tabs', await until(async () => { await openChat(B); await B.click('#rgc-tab-fr'); await openChat(F); await F.click('#rgc-tab-fr');
  return (await shown(B)).includes('Bienvenue dans le chat francophone !') && (await shown(F)).includes('Bienvenue dans le chat francophone !'); }, 20000));
check('the line went to the French chat only', (await lines('fr')).some(l => l.tm && /Bienvenue/.test(l.x)) && !(await lines('world')).some(l => /Bienvenue/.test(l.x || '')));
await A.click('.adm-return'); await ready(A);

/* ── 6. a row of tabs that does not fit gets arrows ── */
await openChat(F); await F.click('#rgc-tab-region');
const arrows = p => p.evaluate(() => { const r = document.getElementById('rgc-tabs'), a = [...document.querySelectorAll('#rgc-dock .rgc-tarr')];
  return { over: r.scrollWidth > r.clientWidth + 1, x: Math.round(r.scrollLeft), max: r.scrollWidth - r.clientWidth, shown: a.map(b => !b.hidden), off: a.map(b => b.disabled) }; });
check('when the tabs fit, there are no arrows', await until(async () => { const s = await arrows(F); return !s.over && s.shown.every(v => !v); }), JSON.stringify(await arrows(F)));
/* a narrow drawer, as on a small phone */
await F.evaluate(() => { const d = document.getElementById('rgc-dock'); d.style.width = '250px'; d.style.minWidth = '0'; d.style.maxWidth = '250px'; });
check('when they overflow, both arrows show, the left one dimmed at the start', await until(async () => { const s = await arrows(F); return s.over && s.shown.every(Boolean) && s.off[0] && !s.off[1]; }), JSON.stringify(await arrows(F)));
await F.screenshot({ path: OUT + '/french-chat-arrows.png' });
await F.click('#rgc-dock .rgc-tarr[data-v="1"]');
check('the right arrow steps the row on, and the left one wakes', await until(async () => { const s = await arrows(F); return s.x > 0 && !s.off[0]; }), JSON.stringify(await arrows(F)));
await F.click('#rgc-dock .rgc-tarr[data-v="1"]'); await F.click('#rgc-dock .rgc-tarr[data-v="1"]');
check('at the end, the right arrow is dimmed', await until(async () => { const s = await arrows(F); return s.x >= s.max - 1 && s.off[1]; }), JSON.stringify(await arrows(F)));
await F.click('#rgc-dock .rgc-tarr[data-v="-1"]'); await F.click('#rgc-dock .rgc-tarr[data-v="-1"]'); await F.click('#rgc-dock .rgc-tarr[data-v="-1"]');
check('the left arrow steps back to the start', await until(async () => { const s = await arrows(F); return s.x <= 1 && s.off[0]; }), JSON.stringify(await arrows(F)));
await F.focus('#rgc-tab-region'); await F.keyboard.press('End');
check('the keyboard’s End picks the last tab and brings it into view', await until(async () => {
  if (await F.getAttribute('#rgc-tab-haps', 'aria-selected') !== 'true') return false;
  return F.evaluate(() => { const r = document.getElementById('rgc-tabs').getBoundingClientRect(), b = document.getElementById('rgc-tab-haps').getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; }); }), JSON.stringify(await arrows(F)));
await F.evaluate(() => { const d = document.getElementById('rgc-dock'); d.style.width = d.style.minWidth = d.style.maxWidth = ''; });
check('given room again, the arrows go', await until(async () => { const s = await arrows(F); return !s.over && s.shown.every(v => !v); }), JSON.stringify(await arrows(F)));

/* ── 7. #chat/fr, a French mention's push link, opens the tab ── */
await closeChat(B);
await B.goto('about:blank'); await B.goto(BASE + '/#chat/fr'); await ready(B);
check('#chat/fr opens the drawer on the Français tab', await until(async () => !!(await B.$('#rgc-dock:not([hidden])')) && await B.getAttribute('#rgc-tab-fr', 'aria-selected') === 'true', 20000));
await sleep(400);
await B.screenshot({ path: OUT + '/french-chat.png' });

await finish();
