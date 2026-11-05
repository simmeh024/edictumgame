// Quieter notices: the first hour's rewards wait in the bell, the bell counts what needs the player, Settings
// chooses, and the Nation page has one card for what waits (emulators).
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, clearEmulators } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Notice tests require demo emulators');
await clearEmulators();
const A = await player('notices');
// this suite tests the default: no saved choice, so a new nation's first hour is quiet
await A.ctx.addInitScript(() => { try { if (!sessionStorage.getItem('nt-set')) { localStorage.removeItem('statehood.notif'); sessionStorage.setItem('nt-set', '1'); } } catch (e) {}
  window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true })); });
await open(A); await found(A, 'Hushland');
await sleep(2500);
const rw = await A.evaluate(() => [...new Set(window.__toasts)].filter(t => /Achievements? earned|new artefacts|New in the Museum|Museum of Progress has opened/.test(t)));
check('a new nation’s first hour shows no reward pop-ups, while other notices still do', rw.length === 0 && (await A.evaluate(() => window.__toasts.length)) > 0, JSON.stringify(rw));
check('its rewards are in the bell', await A.evaluate(() => { document.querySelector('.bell').click(); const t = document.querySelector('.notif-pop')?.textContent || ''; document.querySelector('.bell').click(); return /Honours|Museum/.test(t); }));
await nav(A, 'nation');
check('the Nation page has one card for what waits', await until(() => A.evaluate(() => document.querySelectorAll('.nx-card').length <= 1 && !document.querySelector('.notice.land'))));
await nav(A, 'settings'); await A.click('#sg-tab-notif');
check('Settings has a Notifications section', !!(await A.$('#set-notif')));
await A.click('#ntf-badge-all'); await A.uncheck('[data-ntf-mute="ach"]'); await sleep(200);
const pref = await A.evaluate(() => JSON.parse(localStorage.getItem('statehood.notif')));
check('choices are kept on this device', pref.badge === 'all' && pref.mute.includes('ach'), JSON.stringify(pref));
check('a muted kind leaves the bell', await A.evaluate(() => { document.querySelector('.bell').click(); const t = document.querySelector('.notif-pop')?.textContent || ''; document.querySelector('.bell').click(); return !/Honours/.test(t); }));
await A.locator('#set-notif').screenshot({ path: OUT + '/notices-settings.png' });
await nav(A, 'map');
check('the map’s layers and key are one panel', await A.evaluate(() => !!document.getElementById('ml-sheet') && !!document.getElementById('ml-key')));
await finish();
