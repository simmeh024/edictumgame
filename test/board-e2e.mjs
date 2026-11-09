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
const regs = await B.$$eval('.cb-reg:not([data-reg="chancery"])', l => l.map(s => ({ reg: s.dataset.reg, mine: s.classList.contains('mine'), open: s.querySelector('.cb-reg-tg').getAttribute('aria-expanded') === 'true' })));
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
// C mentions B: typing @ offers the nations on the board, Enter picks one
await C.fill('#cb-r-x', 'Steel for sale, ten tons. '); await C.focus('#cb-r-x'); await C.keyboard.type('@Play');
check('typing @ offers matching nations', await until(async () => /@Playerland/.test(await text(C, '#cb-mn'))));
await C.keyboard.press('Enter');
check('picking one writes the full name', /ten tons\. @Playerland $/.test(await C.$eval('#cb-r-x', t => t.value)) && !(await C.$('#cb-mn')));
await C.keyboard.type('interested?'); await C.click('#cb-rf button[type="submit"]');
check('the reply appears for everyone', await until(async () => /ten tons/.test(await text(B, '.cb-reps'))));
check('the mention is marked in the post', await until(async () => /@Playerland/.test(await text(B, '.cb-reps .cb-at.me'))));
await B.evaluate(() => document.querySelector('.bell').click());
check('the mentioned player gets a notice in the bell', await until(async () => /Readerland mentioned you in a reply to “Grain for steel”/.test(await B.evaluate(() => [...document.querySelectorAll('.nt-item')].map(e => e.textContent).join(' | ')))));
await B.evaluate(() => document.querySelector('.bell').click());
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

// the admin portal's Community boards page: one topic on every open board, signed as the Edictum team
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-board"]');
await A.waitForSelector('#cba-f');
const picked = await A.$$eval('[name="cba-reg"]', l => l.filter(i => i.checked).map(i => i.value));
check('every open region is chosen to begin with', picked.includes(home) && picked.includes(far) && picked.length >= 2, picked.join());
check('players never see the portal page', !(await B.$('.adm-nav [data-v="admin-board"]')));
await A.click('[data-act="cba-pick"][data-v="none"]');
check('choosing no board leaves nothing to post', await A.$eval('#cba-go', b => b.disabled && /Choose a board/.test(b.textContent)));
await A.check(`#cba-r-${home}`); await A.check(`#cba-r-${far}`);
check('the button counts the boards', /Post on 2 boards/.test(await text(A, '#cba-go')));
await A.fill('#cba-nm', 'Pascal'); await A.fill('#cba-rl', 'Lead developer');
await A.fill('#cba-ti', 'Welcome to the boards'); await A.fill('#cba-x', 'Say hello to your neighbours.\nBe kind.');
await A.click('#cba-go');
check('posting asks first, naming the boards and the signature', await until(async () => /Welcome to the boards.*2 boards.*Pascal.*pinned/.test(await text(A, '#cba-ask'))));
await A.click('#cba-yes');
check('it reports a link for each board', await until(async () => (await A.$$('.cba-done [data-act="cba-open"]')).length === 2));
check('the team’s topics are listed below the form', await until(async () => (await A.$$('.tbl-wrap tbody tr')).length === 2 && /Welcome to the boards/.test(await text(A, '.tbl-wrap'))),
  await A.evaluate(() => { const h = document.querySelector('.cba-lh'); return h ? h.parentElement.innerText.split('Topics signed by the team').pop().slice(0, 300) : 'no list'; }));
await go(C, 'community'); await C.waitForSelector('.cb-reg');
check('players find it pinned on their own board', await until(async () => /Pinned\s*Welcome to the boards/.test(await text(C, `.cb-reg[data-reg="${home}"]`))));
await C.click(`.cb-reg[data-reg="${home}"] [data-act="cb-topic"]`);
check('the author column shows the team, the role and the staff badge, with no flag or online dot', await until(async () => {
  const t = await text(C, '.cb-post .cb-au'); return /Pascal/.test(t) && /Lead developer/.test(t) && !!(await C.$('.cb-post .cb-au.cb-team .staff-pill')) && !(await C.$('.cb-post .cb-au .nw-fl')) && !/Online|Offline/.test(t); }));
check('nobody reports the team, and players cannot edit it', !(await C.$('.cb-post [data-act="cb-rep"]')) && !(await C.$('.cb-post [data-act="cb-edit"]')));
// the admin replies on the board, as the team by default under the team's topic
await A.click(`.cba-done [data-act="cba-open"][data-reg="${home}"]`);
await A.waitForSelector('#cb-r-x');
check('under a team topic the admin replies as the team by default', await A.$eval('#cb-r-team', i => i.checked));
await A.fill('#cb-r-x', 'Questions welcome.'); await A.click('#cb-rf button[type="submit"]');
check('the reply is signed by the team', await until(async () => /Questions welcome/.test(await text(C, '.cb-reps')) && /Pascal/.test(await text(C, '.cb-reps .cb-au'))));
// the Chancery: B (a Founding Supporter) posts there from its own New topic button, and the topic stays there
await go(B, 'community'); await B.waitForSelector('.cb-reg[data-reg="chancery"]');
await B.click('[data-act="cb-tg"][data-reg="chancery"]');
await B.waitForSelector('[data-act="cb-new"][data-reg="chancery"]'); await B.click('[data-act="cb-new"][data-reg="chancery"]');
check('the Chancery\'s New topic button chooses the Chancery', await B.$eval('#cb-f-reg', s => s.value) === 'chancery');
await sleep(31000);
await B.fill('#cb-f-ti', 'Members only'); await B.fill('#cb-f-x', 'Hello, fellow members.'); await B.click('#cb-nf button[type="submit"]');
check('the topic is posted on the Chancery board and opens', await until(async () => /Members only/.test(await text(B, '.cb-post .cb-ti')) && /The Chancery/.test(await text(B, '.cb-back')) && /^#community\/chancery\//.test(await B.evaluate(() => location.hash))));
await finish();
