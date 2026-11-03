// Quality-of-life fixes: the region table sorts, the board and happenings page back, the message list finds a nation,
// closing an edict keeps the place in the list, the peep limit says when it ends, a nation's link copies, the news
// editor asks for a link in the page and counts poll answers, and a toast clears the map's phone sheet (emulators).
import { OUT, check, finish, sleep, until, player, open, found, nav, text, register, setClaims, ready, clearEmulators } from './lib.mjs';
await clearEmulators();
const A = await player('qol', { vp: { width: 1280, height: 800 } });
const uidA = await open(A); await found(A, 'Tidyland');
await A.context().grantPermissions(['clipboard-read', 'clipboard-write']);

// 1. the region table sorts by the column clicked, and back again
await nav(A, 'region');
await A.waitForSelector('[data-act="reg-sort"][data-k="name"]');
const names = () => A.$$eval('.tbl tbody tr .nm-main', r => r.map(x => x.textContent.trim()));
check('the region table starts largest population first', await A.$eval('th[aria-sort="descending"] [data-k="pop"]', () => true).catch(() => false));
await A.click('[data-act="reg-sort"][data-k="name"]');
let N = await names();
check('a click on Nation sorts it A to Z', N.length > 3 && N.every((x, i) => !i || N[i - 1].localeCompare(x, 'en', { sensitivity: 'base' }) <= 0 || N[i - 1].toLowerCase() <= x.toLowerCase()), N.slice(0, 6).join(', '));
await A.click('[data-act="reg-sort"][data-k="name"]');
const Z = await names();
check('and a second click Z to A', Z[0] === N[N.length - 1] && await A.$eval('th[aria-sort="descending"] [data-k="name"]', () => true).catch(() => false));

// 2/3. older board posts and happenings are a click away
// the region's live board can replace S.rmb at any moment, so the test posts go back in before each look
const posts = () => A.evaluate(uid => { const t = Date.now(); G.S.rmb[uid] = { posts: Array.from({ length: 70 }, (_, i) => ({ id: 'q' + i, t: t - i * 60000, x: 'Post number ' + i })) }; G.render(); }, uidA);
await A.evaluate(() => { const n = G.clone(G.S.nation), t = Date.now(); for (let i = 0; i < 40; i++) n.log.push({ k: 'flag', t: t - i * 1000 }); G.commit(n); G.render(); });
check('the board shows 50 posts with a way to older ones', await until(async () => { await posts(); return (await A.$$('.posts .post')).length === 50 && !!await A.$('[data-act="rmb-more"]'); }));
await A.click('[data-act="rmb-more"]');
check('and then all 70', await until(async () => { await posts(); return (await A.$$('.posts .post')).length === 70 && !await A.$('[data-act="rmb-more"]'); }));
check('happenings stop at 30 with a way to older ones', (await A.$$('.haps li')).length === 30 && !!await A.$('[data-act="hap-more"]'));
await A.click('[data-act="hap-more"]');
check('and then show more', (await A.$$('.haps li')).length > 30);

// 9. a nation's page copies its link
const other = await A.$$eval('.tbl tbody tr:not(.me) [data-act="visit"]', b => b[0] && b[0].dataset.id);
await A.evaluate(id => G.S.visit = id, other); await A.evaluate(() => { G.S.view = 'visit'; G.render(); });
await A.waitForSelector('[data-act="visit-link"]'); await A.click('[data-act="visit-link"]');
check('Copy link puts the nation’s address on the clipboard', await until(async () => (await A.evaluate(() => navigator.clipboard.readText())).endsWith('#visit/' + other)));

// 4. the message list finds a nation by typing
await A.evaluate(() => { G.S.view = 'messages'; G.render(); });
await A.waitForSelector('#dm-q');
const target = await A.$$eval('#dm-new option', o => o.filter(x => x.value).at(-1).textContent.replace(/ \(.*\)$/, ''));
await A.fill('#dm-q', target.slice(0, 5));
check('typing narrows the list of nations', await A.$$eval('#dm-new option', o => o.filter(x => x.value && !x.hidden).length) < await A.$$eval('#dm-new option', o => o.filter(x => x.value).length));
await A.press('#dm-q', 'Enter');
check('and Enter opens the first one found', await until(async () => /Message to/.test(await text(A, '#dm-form'))));

// 5. closing an edict returns to the same place in the list
await A.evaluate(() => { const n = G.clone(G.S.nation); n.issueClock = Date.now() - 10 * 86400e3; G.syncInbox(n, Date.now()); G.commit(n); G.S.view = 'issues'; G.render(); });
await A.setViewportSize({ width: 1280, height: 420 });
const cards = await A.$$('.issue-card');
if (cards.length >= 3) {
  const last = cards[cards.length - 1]; await last.scrollIntoViewIfNeeded(); const y0 = await A.evaluate(() => scrollY); const id = await last.getAttribute('data-id');
  await last.click(); await A.waitForSelector('[data-act="close-issue"]'); await A.click('[data-act="close-issue"]');
  check('closing an edict returns to where the list was', await until(async () => Math.abs(await A.evaluate(() => scrollY) - y0) < 40 && await A.evaluate(id => document.activeElement?.dataset?.id === id, id)), `y0 ${y0}`);
} else check('closing an edict returns to where the list was (needs three edicts waiting)', false, `only ${cards.length} waiting; skipped`);
await A.setViewportSize({ width: 1280, height: 800 });

// 8. the peep limit says when the next one can go out
await A.evaluate(() => { const n = G.clone(G.S.nation), t = Date.now(); n.flk = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, t: t - (20 - i) * 3600e3 + 1800e3, x: 'Peep ' + i })); G.commit(n); G.S.view = 'flock'; G.S.flkTab = 'home'; G.render(); });
check('at ten peeps the composer says when it opens again', await until(async () => /You can peep again in \d+ h/.test(await text(A, '.fk-compose'))), await text(A, '.fk-compose'));

// 12. on a phone, a toast sits above the map's details sheet
await A.setViewportSize({ width: 390, height: 844 });
await A.evaluate(() => { G.S.view = 'map'; G.render(); });
await A.waitForSelector('#map-panel', { state: 'attached' });
await A.evaluate(() => { const p = document.getElementById('map-panel'); if (!p.classList.contains('sheet-open')) p.querySelector('.mp-grab')?.click(); });
await A.evaluate(() => { const t = document.getElementById('toast') || document.querySelector('.toast'); if (t) { t.hidden = false; t.textContent = 'A test notice'; } });
check('with the sheet open a toast moves to the top of the screen', await until(async () => await A.evaluate(() => { const t = document.querySelector('.toast:not([hidden])'), p = document.getElementById('map-panel'); if (!t || !p || !p.classList.contains('sheet-open')) return false; return t.getBoundingClientRect().bottom <= p.getBoundingClientRect().top + 1; })));
await A.screenshot({ path: OUT + '/qol-map-toast.png' });
await A.setViewportSize({ width: 1280, height: 800 });

// 10/11. the news editor asks for a link in the page and counts poll answers
await register(A); await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.click('.adm-nav [data-v="admin-news"]');
await A.waitForSelector('[data-act="nwe-new"]'); await A.click('[data-act="nwe-new"]');
await A.waitForSelector('#nwe-body');
let dialogs = 0; A.on('dialog', d => { dialogs++; d.dismiss(); });
await A.click('#nwe-body'); await A.keyboard.type('See the map');
await A.evaluate(() => { const t = document.querySelector('#nwe-body p')?.firstChild || document.querySelector('#nwe-body').firstChild, r = document.createRange(); r.setStart(t, t.length - 3); r.setEnd(t, t.length); getSelection().removeAllRanges(); getSelection().addRange(r); });
await A.click('.nwe-b[data-nwc="link"]');
check('Link opens a field in the page, not the browser’s prompt', await until(async () => await A.isVisible('#nwe-url')) && dialogs === 0);
await A.fill('#nwe-url', 'not a link'); await A.press('#nwe-url', 'Enter');
check('a bad address is explained beside the field, which keeps it', /https:\/\//.test(await text(A, '#nwe-lerr')) && await A.inputValue('#nwe-url') === 'not a link');
await A.fill('#nwe-url', 'https://edictumgame.com/pricing'); await A.press('#nwe-url', 'Enter');
check('a good one links the chosen words', await until(async () => await A.evaluate(() => { const a = document.querySelector('#nwe-body a'); return !!a && a.getAttribute('href') === 'https://edictumgame.com/pricing' && a.textContent === 'map'; })) && !await A.isVisible('#nwe-url'), await A.$eval('#nwe-body', e => e.innerHTML));
await A.click('.nwe-poll summary'); await A.fill('#nwe-po', 'Yes');
check('the poll counts its answers while typing', /at least two/.test(await text(A, '#nwe-pon')));
await A.fill('#nwe-po', 'Yes\nNo\nMaybe');
check('three answers are three', await text(A, '#nwe-pon') === '3 answers.');
await A.fill('#nwe-po', 'a\nb\nc\nd\ne\nf\ng');
check('seven are too many', /six at most/.test(await text(A, '#nwe-pon')));
await finish();
