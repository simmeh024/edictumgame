// Settings in nine tabs: Your nation is a draft with a live preview and Save; Edicts applies at once; the open tab is in
// the address; a jump from elsewhere opens the right tab; leaving with unsaved changes asks first; a phone gets a row of
// tabs that sticks under the top bar (emulators).
import { OUT, check, finish, sleep, until, player, open, found, nav, text, localNation, nationDoc, errors, clearEmulators } from './lib.mjs';
await clearEmulators();
const shown = (p, sel) => p.locator(sel).isVisible();
const tab = p => p.evaluate(() => document.getElementById('sg')?.dataset.tab || '');
/* the guest recovery dialog takes focus when it opens, so it is acknowledged first */
const A = await player('settings desktop', { recovery: true, vp: { width: 1366, height: 900 } });
const uidA = await open(A); await found(A, 'Tabularia');
await A.waitForSelector('#ed-recovery-code', { timeout: 25000 }); await A.click('[data-ed="recovery-saved"]');

// the page: six tabs, one pane at a time, Your nation first
await nav(A, 'settings'); await A.waitForSelector('#sg');
check('Settings has ten tabs', JSON.stringify(await A.$$eval('.sg-tab .sg-tl', b => b.map(x => x.textContent))) === JSON.stringify(['Your nation', 'Edicts', 'Land', 'Notifications', 'Letters', 'Chat', 'Display', 'Sound', 'Navigation', 'Account']));
check('it opens on Your nation, with the other panes hidden', await tab(A) === 'nation' && await shown(A, '#s-motto') && !await shown(A, '#s-freq') && !await shown(A, '#set-notif') && !await shown(A, '#set-appearance'));
check('on a wide screen the tabs are a list down the side', await A.$eval('.sg-rail', e => getComputedStyle(e).flexDirection) === 'column');
check('the old section menu and fold controls are gone', !await A.$('#ux-section-select') && !await A.$('.ux-fold-toggle'));
check('the currency is no longer a second place to rename it', !await A.$('#s-currency') && /currency designer/.test(await text(A, '#set-particulars')));
check('nor is the flag a section of its own', !await A.$('#settings-form .flag-preview-row'));

// Your nation: a draft, previewed as it is typed, and counted on the tab
await A.fill('#s-motto', 'Order in Every Column'); await A.fill('#s-ruler', 'Ada Brook');
check('the preview follows the draft', /Order in Every Column/.test(await text(A, '#sg-pv-in')) && /Led by President Ada Brook/.test(await text(A, '#sg-pv-in')));
check('the tab counts the changes not yet saved', /2 changes not saved/.test(await text(A, '[data-sg-sub="nation"]')));
check('and the save bar stays in view', await A.$eval('#sg-save', e => e.classList.contains('is-dirty') && getComputedStyle(e).position === 'sticky'));
check('nothing is saved yet', (await localNation(A)).motto !== 'Order in Every Column');
await A.click('[data-act="mapc"][data-val="#3A8FD1"]');
check('a map colour is part of the draft too', (await localNation(A)).mapc !== '#3A8FD1' && /3 changes not saved/.test(await text(A, '[data-sg-sub="nation"]')));
await A.fill('#s-lang', 'Tabular'); await A.fill('#s-dish', 'Ledger loaf');
check('the culture count follows', /2 of 6 filled/.test(await text(A, '#sg-cult-n')));

// Edicts: a tab of its own, in the address, applied at once; the draft waits meanwhile
await A.click('#sg-tab-edicts');
check('the Edicts tab shows its own pane', await tab(A) === 'edicts' && await shown(A, '#s-freq') && await shown(A, '#away-box') && !await shown(A, '#s-motto'));
check('and the address says so', await A.evaluate(() => location.hash) === '#settings/edicts');
await A.selectOption('#s-freq', '240');
check('the pace is saved at once', await until(async () => (await localNation(A)).freq === 240) && /Saved/.test(await text(A, '[data-sg-saved="edicts"]')));
check('and the tab line says it', /Every 4 hours/.test(await text(A, '[data-sg-sub="edicts"]')));
await A.click('[data-act="topic"][data-k="weird"][data-v="1"]'); await A.click('[data-act="topic"][data-k="econ"][data-v="-1"]');
check('a topic is saved at once', await until(async () => { const t = (await localNation(A)).topics || {}; return t.weird === 1 && t.econ === -1; }));
check('the topics count their changes', /2 changed/.test(await text(A, '#sg-topics .sg-ch')) && /2 topics changed/.test(await text(A, '[data-sg-sub="edicts"]')));
await A.click('[data-act="sg-topics-reset"]');
check('and can all go back to normal', await until(async () => !Object.keys((await localNation(A)).topics || {}).length) && !await A.$('[data-act="sg-topics-reset"]'));
check('the Your nation draft waited meanwhile', /3 changes not saved|4 changes not saved|5 changes not saved/.test(await text(A, '[data-sg-sub="nation"]')) && await A.$eval('#s-motto', e => e.value) === 'Order in Every Column');
await A.screenshot({ path: OUT + '/settings-edicts-1366.png' });

// leaving with the draft unsaved asks first, in the save bar
await nav(A, 'map');
check('leaving with unsaved changes asks first', await A.evaluate(() => G.S.view) === 'settings' && await tab(A) === 'nation' && /not saved/.test(await text(A, '.sg-leave-t')));
check('the first answer has the focus', await A.evaluate(() => document.activeElement?.dataset.act) === 'sg-leave-save');
await A.click('[data-act="sg-leave-stay"]');
check('Stay here keeps the draft', !await A.$('.sg-leave-t') && await A.$eval('#s-motto', e => e.value) === 'Order in Every Column');
await nav(A, 'map'); await A.click('[data-act="sg-leave-save"]');
check('Save and go on saves, then goes', await until(async () => await A.evaluate(() => G.S.view) === 'map') && await until(async () => { const n = await localNation(A); return n.motto === 'Order in Every Column' && n.ruler === 'Ada Brook' && n.mapc === '#3A8FD1' && n.lang === 'Tabular'; }));
await nav(A, 'settings'); await A.click('#sg-tab-nation'); await A.fill('#s-animal', 'heron'); await nav(A, 'nation'); await A.click('[data-act="sg-leave-go"]');
check('Leave without saving drops the draft', await until(async () => await A.evaluate(() => G.S.view) === 'nation') && (await localNation(A)).animal !== 'heron');
await nav(A, 'settings'); await A.click('#sg-tab-nation');
check('and it is gone when Settings opens again', await A.$eval('#s-animal', e => e.value) !== 'heron' && /Seen by other players/.test(await text(A, '[data-sg-sub="nation"]')));

// the address opens a tab, and plain #settings opens Your nation
await A.evaluate(() => { location.hash = '#settings/display'; }); await sleep(400);
check('#settings/display opens Display', await tab(A) === 'display' && await shown(A, '#set-appearance'));
check('and sound is no longer part of Display', !await shown(A, '#set-sound'));
await A.click('#sg-tab-sound');
check('Sound is a tab of its own, in the address', await tab(A) === 'sound' && await shown(A, '#set-sound') && !await shown(A, '#set-appearance') && await A.evaluate(() => location.hash) === '#settings/sound');
check('sounds are on at first, and the tab line says so', await A.$eval('[data-act="sg-sfx"]', e => e.checked) && /Sounds on/.test(await text(A, '[data-sg-sub="sound"]')));
await A.click('[data-act="sg-sfx"]');
check('turning them off is kept on this device, and the tab line follows', await A.evaluate(() => localStorage.getItem('edictum.sfx')) === '0' && /Sounds off/.test(await text(A, '[data-sg-sub="sound"]')));
await A.click('[data-act="sg-sfx"]');
check('and on again', await A.evaluate(() => localStorage.getItem('edictum.sfx')) === '1' && /Sounds on/.test(await text(A, '[data-sg-sub="sound"]')));
await A.click('#sg-tab-display');
await A.reload(); await A.waitForSelector('#sg');
check('and still does after a reload', await tab(A) === 'display' && await shown(A, '[data-act="theme"][data-v="dark"]'));
await A.evaluate(() => { location.hash = '#nation'; }); await sleep(300); await A.evaluate(() => { location.hash = '#settings'; }); await sleep(400);
check('#settings opens Your nation', await tab(A) === 'nation');

// Land: pausing land credit gains keeps a nation small; its credits are stored, and all of them come back with gains
const lh = () => A.evaluate(() => { const L = G.LH(), n = G.S.nation; return { paused: L.paused(n), stored: L.stored(n), credits: L.credits(n) }; });
await A.click('#sg-tab-land');
check('the Land tab shows its own pane, in the address', await tab(A) === 'land' && await shown(A, '#lh-pause') && !await shown(A, '#s-freq') && await A.evaluate(() => location.hash) === '#settings/land');
const lh0 = await lh();
check('gains are on at first, with credits to spend', !lh0.paused && lh0.credits > 0 && !await A.$eval('#lh-pause', e => e.checked) && /Gains on/.test(await text(A, '[data-sg-sub="land"]')));
await A.click('#lh-pause');
check('pausing is saved at once', await until(async () => (await localNation(A)).lcp > 0) && /Saved/.test(await text(A, '[data-sg-saved="land"]')));
const lh1 = await lh();
check('while paused nothing can be spent, and every credit is stored', lh1.paused && lh1.credits === 0 && lh1.stored === lh0.credits);
check('the tab line and the pane say so', (await text(A, '[data-sg-sub="land"]')).includes(`Gains paused · ${lh0.credits} stored`) && /Paused since .* land credits? stored/.test(await text(A, '#lh-state')));
check('the bell has no land to spend', await A.evaluate(() => !G.RGNX().notifItems(Date.now()).pin.some(p => p.k === 'land')));
// the reload must come after the pause has reached the server: reloading within the save gap (80 ms after the click, as
// this did) left it to chance which copy the page kept, and on CI the server's older one sometimes won
check('the pause reaches the server', await until(async () => { const d = await nationDoc(uidA); return !!(d && d.rec && d.rec.lcp > 0); }, 15000));
await A.reload(); await A.waitForSelector('#sg');
check('the pause holds after a reload', await tab(A) === 'land' && await A.$eval('#lh-pause', e => e.checked) && (await lh()).credits === 0);
await nav(A, 'map');
check('the map’s land office shows what is stored', await until(() => shown(A, '.lc-box.lc-paused'), 5000) && (await text(A, '.lc-box.lc-paused .lc-v')) === String(lh0.credits) && !await A.$('[data-act="lc-auto"]'));
await A.screenshot({ path: OUT + '/settings-land-map-1366.png' }); /* the panel redraws with the clock, so not an element shot */
await A.click('.lc-box.lc-paused [data-sg-tab="land"]'); await sleep(500);
check('and its link opens Settings at Land', await A.evaluate(() => G.S.view) === 'settings' && await tab(A) === 'land');
await A.screenshot({ path: OUT + '/settings-land-1366.png' });
await A.click('#lh-pause');
check('turning gains back on makes every stored credit available', await until(async () => !('lcp' in await localNation(A))) && (await lh()).credits === lh0.credits && /Gains on/.test(await text(A, '[data-sg-sub="land"]')));
await A.click('#lh-auto');
check('the Land tab also turns on automatic spending', await until(async () => (await localNation(A)).autoLand === true) && /spent automatically/.test(await text(A, '[data-sg-sub="land"]')));
await A.click('#lh-auto');
check('and off again', await until(async () => (await localNation(A)).autoLand === false));

// jumps from elsewhere open the right tab
const search = async (q, v) => { await nav(A, 'map'); await A.keyboard.press('Control+k'); await A.waitForSelector('#qj-in'); await A.fill('#qj-in', q); await A.click(`.qj-o[data-v="${v}"]`); await sleep(600); };
await search('holiday', 'focus:away-box');
check('searching “holiday” opens Edicts at holiday mode', await tab(A) === 'edicts' && await until(() => A.evaluate(() => document.activeElement?.id === 'away-box'), 3000));
await search('email', 'focus:set-mail');
check('searching “email” opens Notifications at letters by post', await tab(A) === 'notif' && await shown(A, '#set-mail'));
await search('recruit', 'focus:set-social');
check('searching “recruit” opens Account', await tab(A) === 'account' && await shown(A, '#set-social'));
await search('anthem', 'focus:s-lang');
check('searching “anthem” opens Your nation at culture', await tab(A) === 'nation' && await until(() => A.evaluate(() => document.activeElement?.id === 's-lang'), 3000));
await nav(A, 'customise'); await A.click('[data-act="cz-show-disp"]'); await sleep(600);
check('Customise’s link to the theme opens Display', await A.evaluate(() => G.S.view) === 'settings' && await tab(A) === 'display');
await A.click('#sg-tab-nation'); await A.click('[data-act="go"][data-cu-jump]'); await sleep(500);
check('the currency link opens the Money tab of Customise', await A.evaluate(() => G.S.view) === 'customise' && await shown(A, '#cz-sec-c'));
await nav(A, 'settings'); await A.click('#sg-tab-account');
check('Account has sign-in, recruiting, the tutorial and dissolving', await shown(A, '[data-act="acct-open"]') && await shown(A, '#set-social') && await shown(A, '#set-tut') && await shown(A, '[data-act="dissolve-ask"]'));
check('the danger zone is a red box headed Danger zone', /^Danger zone$/.test(await text(A, '#set-danger .dz-h')) && await A.$eval('#set-danger', s => { const b = getComputedStyle(s.querySelector('.dz-box')), h = getComputedStyle(s.querySelector('.dz-h')); return b.borderTopStyle === 'solid' && parseFloat(b.borderTopWidth) >= 1 && b.borderTopColor === h.color; }));
check('the danger zone has Start over, Dissolve and Delete nation and account', JSON.stringify(await A.$$eval('#set-danger .dz-t', e => e.map(x => x.textContent))) === JSON.stringify(['Start over', 'Dissolve nation', 'Delete nation and account']));
await A.click('[data-act="dissolve-ask"]');
check('dissolving asks once more, inside the box', /Dissolve Tabularia for good\?/.test(await text(A, '#set-dissolve .dz-sure')) && await shown(A, '[data-act="dissolve-confirm"]') && await A.$eval('#set-dissolve', e => e.classList.contains('dz-on')));
check('with the name to type, and the last button off until then', await A.evaluate(() => document.activeElement?.id) === 'dz-type' && await A.$eval('#dz-go', b => b.disabled));
await A.fill('#dz-type', 'Tabulari');
check('a wrong name keeps it off', await A.$eval('#dz-go', b => b.disabled));
await A.fill('#dz-type', 'tabularia ');
check('the name in any case turns it on', await A.$eval('#dz-go', b => !b.disabled));
await A.click('[data-act="dissolve-cancel"]');
check('and Keep my nation backs out', !await A.$('[data-act="dissolve-confirm"]') && (await localNation(A))?.name === 'Tabularia');
await A.click('[data-act="acct-delete"]'); await A.waitForSelector('dialog.ed-dlg[open]');
check('Delete opens the account panel at its own delete step', /Delete your nation and account\?/.test(await text(A, 'dialog.ed-dlg[open]')));
await A.keyboard.press('Escape'); await sleep(300);
check('and closing it deletes nothing', !await A.$('dialog.ed-dlg[open]') && (await localNation(A))?.name === 'Tabularia');
await A.click('#sg-tab-account'); await A.keyboard.press('ArrowUp');
check('arrow keys move between tabs', await tab(A) === 'nav' && await A.evaluate(() => document.activeElement?.id) === 'sg-tab-nav');
await A.keyboard.press('ArrowUp');
check('and on to the one before', await tab(A) === 'sound' && await A.evaluate(() => document.activeElement?.id) === 'sg-tab-sound');
await A.keyboard.press('ArrowUp');
check('and the one before that', await tab(A) === 'display' && await A.evaluate(() => document.activeElement?.id) === 'sg-tab-display');
await A.screenshot({ path: OUT + '/settings-display-1366.png' });

// Start over: the founding page with the same name, the culture, look and edict settings carried, the rest afresh
await A.click('#sg-tab-account'); const old = await localNation(A);
await A.click('[data-act="restart-ask"]'); await A.fill('#dz-type', 'Tabularia');
await A.locator('#set-danger').screenshot({ path: OUT + '/settings-danger-1366.png' });
await A.click('#dz-go'); await A.waitForSelector('#found-btn');
check('Start over opens the founding page with the name filled in and says what comes along', await A.inputValue('#d-name') === 'Tabularia' && /Starting over as Tabularia/.test(await text(A, '.sg-rs')) && !await localNation(A));
check('the old record is cleared from the region first', await until(async () => !(await nationDoc(uidA)) && await A.evaluate(() => !G.S.dissolving), 15000));
await A.click('#found-btn');
check('founded again, it keeps the culture, look and edict pace, and starts the rest afresh', await until(async () => { const n = await localNation(A); return n && n.name === 'Tabularia' && n.lang === 'Tabular' && n.mapc === '#3A8FD1' && n.ruler === 'Ada Brook' && n.freq === 240 && n.founded > old.founded && !(n.answered || []).length; }), JSON.stringify(await localNation(A))?.slice(0, 300));
check('and the region has the new nation', await until(async () => { const d = await nationDoc(uidA); return !!d && d.name === 'Tabularia' && d.rec && d.rec.founded > old.founded && d.rec.lang === 'Tabular'; }, 20000));
check('nothing is left waiting to be carried', await A.evaluate(() => !localStorage.getItem('edictum.restart')));
await A.ctx.close();

// a phone: a row of tabs under the top bar, and nothing wider than the screen
const P = await player('settings phone', { vp: { width: 390, height: 844 } });
await open(P); await found(P, 'Pocketania');
await nav(P, 'settings'); await P.waitForSelector('#sg');
check('on a phone the tabs are a row', await P.$eval('.sg-rail', e => getComputedStyle(e).flexDirection) === 'row' && await P.$eval('.sg-rail', e => getComputedStyle(e).position) === 'sticky');
check('and the page is no wider than the screen', await P.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await P.fill('#s-motto', 'Small but Thorough');
check('an unsaved change marks the tab', await P.$eval('#sg-tab-nation', e => e.classList.contains('dirty')));
await P.evaluate(() => window.scrollTo(0, 600)); await sleep(200);
check('the tab row stays in view while scrolling', await P.$eval('.sg-rail', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < 120; }));
await P.screenshot({ path: OUT + '/settings-nation-390.png' });
await P.click('#sg-tab-account'); await sleep(200);
check('a tab far along the row scrolls into view', await P.$eval('#sg-tab-account', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
await P.screenshot({ path: OUT + '/settings-account-390.png' });
await P.ctx.close();

check('no page errors', errors.length === 0, errors.join('; '));
await finish();
