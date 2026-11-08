// Menu icons and Settings › Navigation: every page has an icon; a player reorders pages and groups, renames and adds
// groups, hides pages, picks a menu style (icons and labels, labels only, an icons-only rail) and the phone tab bar.
// The layout is saved with the nation, in its private half, and survives a reload; hidden pages stay in the search;
// Reset puts everything back (emulators).
import { OUT, check, finish, sleep, until, player, open, found, nav, text, localNation, nationDoc, errors, clearEmulators } from './lib.mjs';
await clearEmulators();
const side = p => p.$$eval('.side .nav-grp', gs => gs.map(g => ({ k: g.dataset.g, l: (g.querySelector('.nav-gl') || {}).textContent, v: [...g.querySelectorAll('.nav-btn')].map(b => b.dataset.v) })));
const inSide = async (p, v) => (await side(p)).some(g => g.v.includes(v));
const groupOf = async (p, v) => (await side(p)).find(g => g.v.includes(v)) || null;
const navOf = async p => (await localNation(p))?.nav;

const A = await player('nav desktop', { recovery: true, vp: { width: 1366, height: 900 } });
const uidA = await open(A); await found(A, 'Navigata');
await A.waitForSelector('#ed-recovery-code', { timeout: 25000 }); await A.click('[data-ed="recovery-saved"]');

// icons: every page in the side bar, each with its label
const icons = await A.$$eval('.side .nav-btn', bs => bs.map(b => [b.dataset.v, !!b.querySelector('.nav-ic svg'), (b.querySelector('.nav-l') || {}).textContent || '']));
check('every page in the side bar has an icon and its name', icons.length > 20 && icons.every(([, ic, l]) => ic && l.length > 1), JSON.stringify(icons.filter(x => !x[1] || !x[2])));
check('no page falls back to the blank icon', await A.evaluate(() => [...document.querySelectorAll('.side .nav-ic svg')].every(s => !/r="7.5"/.test(s.innerHTML))));
check('the usual groups, in the usual order', JSON.stringify((await side(A)).map(g => g.k)) === JSON.stringify(['nation', 'land', 'abroad', 'news', 'coll', 'other', 'opts']));
await A.screenshot({ path: OUT + '/nav-icons-1366.png' });

// the Navigation tab
await nav(A, 'settings'); await A.click('#sg-tab-nav');
check('Settings has a Navigation tab, between Display and Account', JSON.stringify(await A.$$eval('.sg-tab .sg-tl', b => b.map(x => x.textContent))) === JSON.stringify(['Your nation', 'Edicts', 'Notifications', 'Letters', 'Display', 'Navigation', 'Account']));
check('it is in the address', await A.evaluate(() => location.hash) === '#settings/nav');
check('a new nation has the usual menu and nothing to reset', /The usual menu/.test(await text(A, '[data-sg-sub="nav"]')) && await A.$eval('#nv-reset', b => b.disabled) && !(await navOf(A)));
check('every page is listed, with Nation and Settings locked', await A.$$eval('.nve-r', r => r.length) === icons.length && !await A.$('#nv-eye-nation') && !await A.$('#nv-eye-settings') && !!await A.$('.nve-r[data-v="nation"] .nve-lock'));

// hide a page
await A.click('#nv-eye-world');
check('a hidden page leaves the side bar', await until(async () => !await inSide(A, 'world')));
check('it is saved at once, and the tab says so', (await navOf(A))?.x?.includes('world') && /1 hidden/.test(await text(A, '[data-sg-sub="nav"]')) && /Saved/.test(await text(A, '[data-sg-saved="nav"]')));
check('the eye keeps the focus and says the page is hidden', await A.evaluate(() => document.activeElement?.id) === 'nv-eye-world' && await A.$eval('#nv-eye-world', b => b.getAttribute('aria-pressed')) === 'false');

// move pages: arrows, and the group menu
await A.click('#nv-up-census');
const yn = await groupOf(A, 'census');
check('the arrows move a page within its group', yn.k === 'nation' && yn.v.indexOf('census') < yn.v.indexOf('stats'));
await A.selectOption('#nv-mv-trade', 'nation');
check('the group menu moves a page to another group', (await groupOf(A, 'trade'))?.k === 'nation');
await A.click('#nv-up-region');
check('the first page of a group moves up into the group before it', (await groupOf(A, 'region'))?.k === 'land');

// a group of one's own
await A.click('#nv-gadd');
check('a new group starts empty, with its name ready to type', await A.evaluate(() => document.activeElement?.id) === 'nv-gn-c1' && !!await A.$('#nv-gdel-c1'));
await A.keyboard.type('Favourites'); await A.keyboard.press('Enter');
check('Enter keeps the name', await until(async () => /Favourites/.test((await navOf(A))?.o || '')));
await A.selectOption('#nv-mv-help', 'c1'); await A.selectOption('#nv-mv-shop', 'c1');
const fav = await groupOf(A, 'help');
check('the new group shows in the side bar under its name', fav?.k === 'c1' && fav.l === 'Favourites' && fav.v.join() === 'help,shop');
await A.locator('.nve-r[data-v="shop"] .nve-grip').dragTo(A.locator('.nve-r[data-v="help"]'), { targetPosition: { x: 60, y: 3 } });
check('a page can be dragged into place', await until(async () => (await groupOf(A, 'help'))?.v.join() === 'shop,help'));
check('a new group is added last, so it cannot move further down', await A.$eval('#nv-gdn-c1', b => b.disabled));
await A.click('#nv-gup-c1');
check('groups move with their arrows', await until(async () => (await side(A)).map(g => g.k).slice(-2).join() === 'c1,opts'));

// a hidden page with a badge shows on its group; the search still finds it
await A.click('#nv-eye-issues');
check('a hidden page’s badge becomes its group’s dot', await until(async () => !await inSide(A, 'issues')) && await A.$eval('.side .nav-grp[data-g="nation"] .nav-dot.nav-hb', e => getComputedStyle(e).display !== 'none').catch(() => false));
await A.keyboard.press('Control+k'); await A.waitForSelector('#qj-in'); await A.fill('#qj-in', 'World');
check('a hidden page is still in the search', !!await A.$('#qj-list [data-v="world"]'));
await A.click('#qj-list [data-v="world"]'); await sleep(400);
check('and while it is open it shows in the menu', await A.$eval('.side .nav-btn.on', b => b.dataset.v).catch(() => '') === 'world');
await nav(A, 'settings'); await A.click('#sg-tab-nav');

// menu style and headings
await A.click('#nv-s-i');
check('Icons only makes the side bar a narrow rail', await until(async () => await A.$eval('.layout', e => e.classList.contains('nav-rail'))) && await A.$eval('.side', e => e.getBoundingClientRect().width) < 100);
check('the names stay for screen readers', await A.$eval('.side .nav-btn[data-v="map"] .nav-l', e => e.textContent === 'Map' && e.getBoundingClientRect().width <= 1));
await A.hover('.side .nav-btn[data-v="map"]');
check('and show on hover', await until(async () => await A.$eval('#nav-tip', e => !e.hidden && e.textContent === 'Map').catch(() => false), 3000));
await A.screenshot({ path: OUT + '/nav-rail-1366.png' });
await A.click('#nv-s-l');
check('Labels only hides the icons', await until(async () => await A.$eval('.side .nav-ic', e => getComputedStyle(e).display === 'none')));
await A.click('#nv-s-b'); await A.click('#nv-heads');
check('without headings the menu is one plain list', await until(async () => await A.$eval('.layout', e => e.classList.contains('nav-flat'))) && !await A.locator('.side .nav-gh').first().isVisible());
await A.click('#nv-heads');

// saved with the nation, in its private half, and there after a reload
const want = await navOf(A);
check('the layout is saved with the nation', await until(async () => JSON.stringify((await nationDoc(uidA))?.rec?.nav) === JSON.stringify(want), 12000), JSON.stringify(want));
const doc = await nationDoc(uidA);
check('in its private half, not the record every player downloads', doc && !('nav' in doc.shared));
const before = await side(A);
await open(A); await A.waitForSelector('.layout'); await sleep(500);
check('a reload brings the same menu back', JSON.stringify(await side(A)) === JSON.stringify(before));

// presets and Reset
await nav(A, 'settings'); await A.click('#sg-tab-nav'); await A.click('#nv-p-az');
const az = await side(A);
check('One list, A to Z: every shown page in one alphabetical list', az.length === 1 && az[0].v.length > 20 && await A.$eval('.layout', e => e.classList.contains('nav-flat')));
await A.click('#nv-reset');
check('Reset puts the usual menu back and saves nothing', await until(async () => !(await navOf(A))) && JSON.stringify((await side(A)).map(g => g.k)) === JSON.stringify(['nation', 'land', 'abroad', 'news', 'coll', 'other', 'opts']) && await inSide(A, 'world') && await A.$eval('#nv-reset', b => b.disabled));
await A.ctx.close();

// a phone: the tab bar is the player's choice, and the More sheet shows icon tiles
const P = await player('nav phone', { vp: { width: 390, height: 844 } });
await open(P); await found(P, 'Pocketa');
await P.click('#tab-more'); await P.waitForSelector('#more-sheet');
check('the More sheet shows every page as a tile with its icon', await P.$$eval('#more-sheet .more-b', bs => bs.length > 20 && bs.every(b => b.querySelector('.nav-ic svg') && b.querySelector('.nav-l'))));
await P.screenshot({ path: OUT + '/nav-more-390.png' });
await P.click('#more-sheet [data-v="settings"]'); await P.waitForSelector('#sg'); await P.click('#sg-tab-nav');
await P.selectOption('#nv-tab-3', 'messages');
check('a tab bar page can be swapped', await until(async () => !!await P.$('.tabbar #tab-messages') && !await P.$('.tabbar #tab-region')));
await P.locator('#nv-eye-map').scrollIntoViewIfNeeded(); await P.click('#nv-eye-map');
check('a hidden tab gives way to the next page', await until(async () => !await P.$('.tabbar #tab-map')) && await P.$$eval('.tabbar .tab', t => t.length) === 5);
await P.screenshot({ path: OUT + '/nav-settings-390.png' });
await P.ctx.close();

check('no page errors', errors.length === 0, errors.join('; '));
await finish();
