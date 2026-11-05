// The Community Board: every region's board under Other, the player's own first and open, the rest collapsed;
// Registered Nations open topics and reply anywhere; posts show the author's flag, name, online state and badges;
// staff pin, lock, hide and delete from inside the board, and guests read only.
import { player, open, ready, found, register, until, check, finish, setClaims, text, clearEmulators, sleep, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('player'), C = await player('reader'), G = await player('guest');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Playerland');
const uidC = await open(C); await found(C, 'Readerland');
await open(G); await found(G, 'Guestland');
await register(A); await register(B); await register(C);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
// B bought the Founder's Package (only the shop's server writes this)
await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/shop/${uidB}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { owns: { mapValue: { fields: { founder: { integerValue: String(Date.now()) } } } } } }) });
const go = (p, v) => p.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v);

// the page: under Other, the player's own region first, highlighted and open, the others collapsed
check('the Community Board sits under Other', /Community Board/.test(await text(B, '.side .nav-grp[data-g="other"] .nav-g')));
await go(B, 'community');
await B.waitForSelector('.cb-reg');
const regs = await B.$$eval('.cb-reg', l => l.map(s => ({ reg: s.dataset.reg, mine: s.classList.contains('mine'), open: s.querySelector('.cb-reg-tg').getAttribute('aria-expanded') === 'true' })));
const home = await B.evaluate(() => G.S.nation.reg);
check('the own region comes first, highlighted and open', regs[0].reg === home && regs[0].mine && regs[0].open, JSON.stringify(regs[0]));
check('every other region is collapsed', regs.length > 3 && regs.slice(1).every(r => !r.mine && !r.open), regs.length);
check('an empty board says so', await until(async () => /No topics yet/.test(await text(B, '.cb-reg.mine'))));

// B opens a topic on another region's board
const far = regs[1].reg;
await B.click('.cb-start [data-act="cb-new"]');
await B.selectOption('#cb-f-reg', far); await B.selectOption('#cb-f-tg', 'trade');
await B.fill('#cb-f-ti', 'Grain for steel'); await B.fill('#cb-f-x', 'Who sells steel?\nWe pay in grain.');
await B.click('#cb-nf button[type="submit"]');
check('posting opens the new topic', await until(async () => /Grain for steel/.test(await text(B, '.cb-post .cb-ti'))));
const au = await text(B, '.cb-post .cb-au');
check('the author column shows the flag, name, online state and the Founder badge', await B.$('.cb-post .cb-au .nw-fl svg') && /Playerland/.test(au) && /Online/.test(au) && /Founder/.test(au), au);
check('line breaks survive', await B.$eval('.cb-post .cb-x', e => e.innerHTML.includes('<br>')));
check('the topic has its own link', /^#community\/[a-z]+\/[A-Za-z0-9]{20}$/.test(await B.evaluate(() => location.hash)));
await B.waitForSelector('#cb-r-x'); await B.fill('#cb-r-x', 'And iron, too.'); await B.click('#cb-rf button[type="submit"]');
check('posting again at once is paced, and says when it can', await until(async () => /Slow down a little\. You can post again in \d+ seconds/.test(await B.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '))), 30000));

// C, from their own region, finds it on the other board and replies
await go(C, 'community'); await C.waitForSelector('.cb-reg');
await C.click(`[data-act="cb-tg"][data-reg="${far}"]`);
check('opening a collapsed board lists its topics', await until(async () => /Grain for steel/.test(await text(C, `.cb-reg[data-reg="${far}"]`))));
check('the collapsed header counts its topics', /1 topic/.test(await text(C, `.cb-reg[data-reg="${far}"] .cb-reg-c`)));
await C.click(`.cb-reg[data-reg="${far}"] [data-act="cb-topic"]`);
await C.waitForSelector('#cb-r-x');
await C.fill('#cb-r-x', 'Steel for sale, ten tons.'); await C.click('#cb-rf button[type="submit"]');
check('the reply appears for everyone', await until(async () => /ten tons/.test(await text(B, '.cb-reps'))));
check('B, who did not write it, may report it but not edit it', await until(async () => !!(await B.$('.cb-reps [data-act="cb-rep"]')) && !(await B.$('.cb-reps [data-act="cb-edit"]'))));

// the author edits their own reply
await C.click('.cb-reps [data-act="cb-edit"]'); await C.fill('#cb-e-x', 'Steel for sale, twelve tons.'); await C.click('#cb-ef button[type="submit"]');
check('an edit shows, marked as edited', await until(async () => /twelve tons/.test(await text(B, '.cb-reps')) && /edited/.test(await text(B, '.cb-reps .cb-when'))));

// players see no staff controls; the admin sees them inside the board
check('players see no moderation controls', !(await B.$('.cb-modbar')) && !(await C.$('.cb-modbar')));
await A.goto(await B.evaluate(() => location.href)); await ready(A);
check('the admin opens the shared link and sees staff controls on the topic and the reply', await until(async () => (await A.$$('.cb-modbar')).length === 2));
await A.click('.cb-post:not(.cb-reps .cb-post) [data-act="cb-mod"][data-v="lock"]');
check('a locked topic takes no more replies', await until(async () => /locked/.test(await text(C, '.main')) && !(await C.$('#cb-rf'))));
await A.click('.cb-reps [data-act="cb-mod"][data-v="hide"]');
check('a hidden reply disappears for players', await until(async () => !/twelve tons/.test(await text(B, '.main'))));
check('the admin still sees it, marked hidden, and can read what it said', await until(async () => /Hidden by staff/.test(await text(A, '.cb-reps'))) && (await A.click('.cb-reps [data-act="cb-was"]'), await until(async () => /twelve tons/.test(await text(A, '.cb-was')))));
await A.click('.cb-post:not(.cb-reps .cb-post) [data-act="cb-mod"][data-v="pin"]');
await A.click('[data-act="cb-back"]');
if (await A.$eval(`.cb-reg[data-reg="${far}"] .cb-reg-tg`, b => b.getAttribute('aria-expanded')) !== 'true') await A.click(`[data-act="cb-tg"][data-reg="${far}"]`);
check('a pinned topic is marked on the board', await until(async () => /Pinned/.test(await text(A, `.cb-reg[data-reg="${far}"]`))));

// a guest reads but cannot post
await go(G, 'community'); await G.waitForSelector('.cb-reg');
await G.click('.cb-start [data-act="cb-new"]');
check('a guest is told to link a sign-in to post', await until(async () => /Creating community topics|Registered|Link/i.test(await text(G, '.cb-start, .info'))));

// B deletes the topic, and its replies go with it
await B.waitForSelector('[data-act="cb-own-del"]'); await B.click('.cb-post [data-act="cb-own-del"]'); await B.click('[data-act="cb-del-yes"]');
check('the author deletes their topic', await until(async () => /deleted/i.test(await text(B, '.toast, .main')) || !(await B.$('.cb-post'))));
await sleep(500);
await C.click('[data-act="cb-back"]');
check('the board counts are back to nothing', await until(async () => /0 topics/.test(await text(C, `.cb-reg[data-reg="${far}"] .cb-reg-c`))));
await finish();
