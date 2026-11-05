// Recruit a player: Settings › Social shows the player's own link and share buttons; a visitor who opens it and
// founds a nation files recruits/<uid>, and both sides get 15 goods, oil, timber and iron plus 3 land credits.
// The claim is filed once, never for oneself, and only the recruiter can list the recruits naming them.
import { BASE, player, open, found, until, check, finish, text, nav, restListAdmin, clearEmulators, sleep } from './lib.mjs';
await clearEmulators();
const RES = ['goods', 'oil', 'timber', 'iron'];
const stock = p => p.evaluate(() => { const n = G.S.nation; return Object.fromEntries(['goods', 'oil', 'timber', 'iron'].map(r => [r, Math.floor(G.stockNow(n, Date.now())[r] || 0)])); });
const credits = p => p.evaluate(() => G.RC().land(G.S.nation));

const A = await player('recruiter');
const uidA = await open(A); await found(A, 'Recruitland');

// the Social section in Settings
await nav(A, 'settings');
await A.waitForSelector('#set-social');
const link = await A.$eval('#rc-link', i => i.value);
check('Settings has a Social section with the player\'s own link', link === BASE.replace('127.0.0.1', '127.0.0.1') + '/?recruit=' + uidA || link.endsWith('/?recruit=' + uidA), link);
const shares = await A.$$eval('#set-social .rc-share a', as => as.map(a => a.textContent + ' ' + a.href));
check('share links for Facebook, X, Mastodon, WhatsApp and others', ['Facebook', 'X', 'Mastodon', 'WhatsApp', 'Bluesky', 'Telegram', 'Reddit', 'Email'].every(k => shares.some(s => s.startsWith(k + ' '))) && shares.every(s => s.includes(encodeURIComponent(link))), shares.join(' | '));
check('the section says no one has joined yet', /No one has founded a nation through your link yet/.test(await text(A, '#set-social')));
const aBefore = await stock(A);

// the recruit opens the link
const B = await player('recruit');
await open(B, BASE + '/?recruit=' + uidA);
check('the link is taken out of the address bar', !B.url().includes('recruit='), B.url());
check('and kept on the device until the nation is founded', await B.evaluate(() => G.RC().pending()) === uidA);
const uidB = await B.evaluate(() => window.claude.use('user').then(u => u.id()));
await found(B, 'Newland', { newPlayer: true });
check('the recruit gets the bonus once the nation is saved', await until(() => B.evaluate(() => !!G.S.nation.rcb), 30000), await B.evaluate(() => JSON.stringify(G.S.nation.rcb || null)));
const bStock = await stock(B);
check('15 goods, oil, timber and iron for the recruit', RES.every(r => bStock[r] >= 15), JSON.stringify(bStock));
check('and 3 land credits', await credits(B) === 3);
check('the pending link is forgotten', await B.evaluate(() => G.RC().pending()) === '');
const docs = (await restListAdmin('recruits'));
check('recruits/<uid> names the recruiter', docs.length === 1 && docs[0].name.endsWith('/' + uidB) && docs[0].fields.r.stringValue === uidA);

// a second claim is not paid again
check('a second claim finds the first', await B.evaluate(r => window.claude.use('recruit').claim(r), uidA) === 'done');

// the recruiter's side
await A.evaluate(() => G.RC().poll(true));
check('the recruiter is paid for the new recruit', await until(() => A.evaluate(() => (G.S.nation.rcp || []).length === 1), 15000));
const aAfter = await stock(A);
check('15 goods, oil, timber and iron for the recruiter', RES.every(r => aAfter[r] - aBefore[r] >= 14), JSON.stringify([aBefore, aAfter]));
check('and 3 land credits', await credits(A) === 3);
await A.evaluate(() => G.RC().poll(true)); await sleep(1500);
check('polling again pays nothing more', await A.evaluate(() => G.S.nation.rcp.length) === 1 && await credits(A) === 3);
await nav(A, 'nation'); await nav(A, 'settings');
check('Settings counts the recruit', await until(async () => /One player has founded a nation through your link, earning you 3 land credits/.test(await text(A, '#set-social'))), await text(A, '#set-social'));
check('Word of Mouth is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-rc1'])), 15000));

// abuse: no self-recruiting, and nobody else lists A's recruits
const C = await player('other');
await open(C, BASE + '/?recruit=' + uidA); await found(C, 'Otherland', { newPlayer: true });
const uidC = await C.evaluate(() => window.claude.use('user').then(u => u.id()));
check('a player cannot file a claim naming themself', await C.evaluate(id => window.claude.use('recruit').claim(id), uidC) === 'bad');
check('C was recruited by A too', await until(() => C.evaluate(() => !!G.S.nation.rcb), 30000));
const listed = await C.evaluate(id => window.claude.use('recruit').mine().then(l => l.map(x => x.id)), uidA);
check('a player lists only recruits naming them', Array.isArray(listed) && listed.length === 0, JSON.stringify(listed));
await A.evaluate(() => G.RC().poll(true));
check('the recruiter is paid for the second recruit', await until(() => A.evaluate(() => (G.S.nation.rcp || []).length === 2), 15000) && await credits(A) === 6);

await finish();
