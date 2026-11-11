// Flock between leaders (emulators): one player's leader peeps; another replies to it, quotes it and mentions them
// with @ (the picker offers the region's leaders). The reply shows under the first peep for both, the quote carries the
// peep it quotes, and the first player hears of all three in the bell and under Mentions, whose notice opens at the peep.
// A deleted peep leaves its quote saying so; blocking a nation in Letters silences its notices; a phone fits five tabs.
import { OUT, check, finish, sleep, until, player, open, found, text, clearEmulators } from './lib.mjs';
await clearEmulators();
const A = await player('flock-a'), B = await player('flock-b');
const uidA = await open(A); await found(A, 'Talkland');
const uidB = await open(B); await found(B, 'Answerland');
const flock = async (p, tab = 'home') => { await p.evaluate(t => { G.S.view = 'flock'; G.S.flkTab = t; G.S.flkScope = 'all'; G.render(); }, tab); await p.waitForSelector('.fk'); };
const peep = async (p, x) => { await p.fill('#flk-text', x); await p.click('#flk-form .fk-pbtn'); await sleep(300); };
const bell = p => p.evaluate(() => { const b = document.querySelector('.bell'); if (!b.classList.contains('on')) b.click(); return [...document.querySelectorAll('.nt-item')].map(e => e.textContent).join(' | '); });
const closeBell = p => p.evaluate(() => { const b = document.querySelector('.bell'); if (b.classList.contains('on')) b.click(); });

// A peeps
await flock(A); await peep(A, 'Talkland welcomes every neighbour. #OpenBorders');
const tA = await A.evaluate(() => G.S.nation.flk.at(-1).t), pid = uidA + ':me:' + tA;

// B sees it and answers
await flock(B);
const post = `.fk-feed > article[data-id="${pid}"]`;
check('B sees A’s peep in the region feed, with Reply and Quote', await until(async () => { await B.evaluate(() => G.render()); return !!(await B.$(post + ' [data-act="flk-reply"]')) && !!(await B.$(post + ' [data-act="flk-quote"]')); }, 30000));
check('citizens’ posts have no Reply button', await B.evaluate(() => [...document.querySelectorAll('.fk-feed > article')].filter(a => !/:me:/.test(a.dataset.id)).every(a => !a.querySelector('[data-act="flk-reply"]'))));
await B.click(post + ' [data-act="flk-reply"]');
check('the composer says whom it answers and takes the focus', await until(async () => /Replying to @/.test(await text(B, '.fk-ctx')) && await B.evaluate(() => document.activeElement && document.activeElement.id === 'flk-text')));
check('and the button says Reply', /^Reply$/.test(await text(B, '#flk-form .fk-pbtn')));
await B.keyboard.type('Thank you, ');
await B.keyboard.type('@Talk');
check('typing @ offers the leaders of the region', await until(async () => /Talkland/.test(await text(B, '#flk-mn'))));
check('the picker is a list box the text field points at', await B.evaluate(() => document.getElementById('flk-text').getAttribute('aria-activedescendant') === 'flk-mn-0' && document.querySelector('#flk-mn [role="option"][aria-selected="true"]') !== null));
await B.keyboard.press('Enter');
const typed = await B.$eval('#flk-text', t => t.value);
check('Enter puts the leader’s handle in, and closes the list', /^Thank you, @[A-Za-z0-9_]+ $/.test(typed) && !(await B.$('#flk-mn')), typed);
const atA = typed.match(/@([A-Za-z0-9_]+)/)[1];
await B.keyboard.type('glad to be neighbours.');
await B.click('#flk-form .fk-pbtn');
const reB = await B.evaluate(() => G.S.nation.flk.at(-1));
check('the reply is saved on B’s own peep, pointing at A’s, with the mention', reB.r && reB.r.n === uidA && reB.r.t === tA && Array.isArray(reB.m) && reB.m[0] === uidA, JSON.stringify(reB));
check('the composer is back to a plain peep', !(await B.$('.fk-ctx')) && /^Peep$/.test(await text(B, '#flk-form .fk-pbtn')));
const rpid = uidB + ':me:' + reB.t;
check('B’s reply says what it answers', await until(async () => { await B.evaluate(() => G.render()); return new RegExp('Replying to @' + atA).test(await text(B, `.fk-feed > article[data-id="${rpid}"] .fk-to`)); }));
check('and shows under A’s peep', await until(async () => !!(await B.$(`${post} .fk-th article[data-id="${rpid}"]`))));
check('the mention in the text links to A’s leader', await B.evaluate(([id, h]) => { const b = document.querySelector(`.fk-feed > article[data-id="${id}"] .fk-x .fk-atb`); return !!b && b.textContent === '@' + h && b.dataset.k.endsWith('|L'); }, [rpid, atA]));

// B quotes A's peep, and mentions A in a peep of its own
await B.click(post + ' [data-act="flk-quote"]');
check('Quote shows the peep inside the composer', await until(async () => /Quoting @/.test(await text(B, '.fk-ctx')) && /welcomes every neighbour/.test(await text(B, '.fk-ctx .fk-qp'))));
check('the composer’s copy of the peep has no buttons (it sits in the form)', await B.evaluate(() => !document.querySelector('.fk-ctx button:not([data-act="flk-recancel"])')));
await B.fill('#flk-text', 'Open borders, open hearts.'); await B.click('#flk-form .fk-pbtn');
const qB = await B.evaluate(() => G.S.nation.flk.at(-1));
check('the quote is saved with its pointer', qB.q && qB.q.n === uidA && qB.q.t === tA && !qB.r, JSON.stringify(qB));
const qpid = uidB + ':me:' + qB.t;
check('the quote carries A’s peep', await until(async () => { await B.evaluate(() => G.render()); return /welcomes every neighbour/.test(await text(B, `.fk-feed > article[data-id="${qpid}"] .fk-qp`)); }));
await peep(B, `Big day in the region. Say hello to @${atA}!`);
const mB = await B.evaluate(() => G.S.nation.flk.at(-1));
check('a plain peep keeps the mention', Array.isArray(mB.m) && mB.m.includes(uidA) && !mB.r && !mB.q, JSON.stringify(mB));
check('replying to another leader counts toward the new achievements', await B.evaluate(() => (G.S.nation.tly || {}).flkx === 2));

// Escape leaves a reply that has no text yet
await B.click(post + ' [data-act="flk-reply"]'); await until(async () => !!(await B.$('.fk-ctx')));
await B.focus('#flk-text'); await B.keyboard.press('Escape');
check('Escape in an empty reply cancels it', await until(async () => !(await B.$('.fk-ctx'))));

// A hears of all three
await flock(A);
check('A’s Mentions tab counts three new', await until(async () => { await A.evaluate(() => G.render()); return /3/.test(await text(A, '.fk-tab[data-k="ment"] .fk-tn')); }, 30000));
const notes = await until(async () => { const t = await bell(A); return /replied to your peep/.test(t) && /quoted your peep/.test(t) && /mentioned you/.test(t) ? t : false; }, 20000);
check('the bell tells A of the reply, the quote and the mention', !!notes, notes || await bell(A));
check('each notice quotes the peep', /Thank you, @/.test(notes || '') && /Open borders/.test(notes || ''));
await A.evaluate(() => { const b = [...document.querySelectorAll('.nt-item .nt')].find(e => /replied to your peep/.test(e.textContent)); b.click(); });
check('the notice opens Flock at Mentions', await until(() => A.evaluate(() => G.S.view === 'flock' && G.S.flkTab === 'ment')));
check('Mentions lists B’s three peeps, newest first', await until(async () => (await A.$$eval('.fk-feed > article', l => l.map(a => a.dataset.id))).join() === [uidB + ':me:' + mB.t, qpid, rpid].join()));
check('and the reply it came from is picked out', await until(() => A.evaluate(id => { const e = [...document.querySelectorAll('article')].find(a => a.dataset.id === id); return !!e && (e.classList.contains('fk-flash') || e.getBoundingClientRect().top < innerHeight); }, rpid)));
check('the count is gone once Mentions is open', !(await A.$('.fk-tab[data-k="ment"] .fk-tn')));
await A.screenshot({ path: OUT + '/flock-mentions.png' });
await flock(A);
check('A sees B’s reply under A’s own peep', await until(async () => { await A.evaluate(() => G.render()); return !!(await A.$(`${post} .fk-th article[data-id="${rpid}"]`)); }));
check('and the reply count includes it', await A.evaluate(p => { const b = document.querySelector(p + ' > .fk-b > .fk-acts .fk-rp b'); return !!b && +b.textContent >= 1; }, post));
// "Replying to @…" goes to the peep it answers
await A.evaluate(id => { const b = document.querySelector(`.fk-feed > article[data-id="${id}"] .fk-to .fk-atb`); b.click(); }, rpid);
check('Replying to @… opens the answered peep’s thread', await until(() => A.evaluate(p => G.S.flkOpen === p, pid)));
await A.screenshot({ path: OUT + '/flock-thread.png' });

// a deleted peep leaves the quote saying so
await A.evaluate(() => { G.S.flkTab = 'me'; G.render(); });
await A.click(`article[data-id="${pid}"] [data-act="flk-del"]`);
check('B’s quote says the peep was deleted', await until(async () => { await B.evaluate(() => G.render()); return /This peep has been deleted/.test(await text(B, `.fk-feed > article[data-id="${qpid}"] .fk-qp`)); }, 30000));
check('and the reply line still names A', new RegExp('@' + atA).test(await text(B, `.fk-feed > article[data-id="${rpid}"] .fk-to`)));

// blocking B in Letters silences B's notices and Mentions for A
await closeBell(A);
await A.evaluate(id => { const n = G.clone(G.S.nation); n.dmx = Object.assign({}, n.dmx, { bl: [id] }); G.commit(n); G.render(); }, uidB);
check('a blocked nation’s notices leave the bell', await until(async () => !/Answerland|replied to your peep|quoted your peep|mentioned you/.test(await bell(A))));
await closeBell(A);
await flock(A, 'ment');
check('and Mentions is empty', /Nobody has answered/.test(await text(A, '.fk-c')));

// a phone: five tabs in one row, none cut off
await B.setViewportSize({ width: 375, height: 800 }); await flock(B); await sleep(300);
check('on a phone the five tabs fit the width', await B.evaluate(() => { const n = document.querySelector('.fk-tabs'), t = [...n.querySelectorAll('.fk-tab')]; return t.length === 5 && n.scrollWidth <= n.clientWidth + 1 && t.every(b => b.getBoundingClientRect().right <= innerWidth); }));
await B.screenshot({ path: OUT + '/flock-phone.png' });

await finish();
