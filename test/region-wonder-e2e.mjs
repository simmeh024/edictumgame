// The Great Statue, field digs and gifts between two player nations in one region (emulators).
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, localNation, clearEmulators } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Region wonder tests require demo emulators');
await clearEmulators();
const A = await player('wonder A'), uidA = await open(A); await found(A, 'Statuaria');
const B = await player('wonder B'), uidB = await open(B); await found(B, 'Bronzeholm');
await until(() => A.evaluate(id => G.allNations().some(x => x.id === id), uidB), 20000);
await until(() => B.evaluate(id => G.allNations().some(x => x.id === id), uidA), 20000);
const rich = p => p.evaluate(() => { const n = G.clone(G.S.nation); n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); });
const give = async (p, r, v) => { await nav(p, 'wonder'); await p.click(`[data-act="wd-give"][data-r="${r}"][data-v="${v}"]`); await sleep(300); };

/* the statue: both nations give, and each sees the other's gifts */
await rich(A); await rich(B);
await give(A, 'timber', '50');
check('a gift to the statue is kept in the giver’s own record', ((await localNation(A)).wnd || {}).c?.timber === 50);
await nav(B, 'wonder');
check('the other nation sees it in the pooled total', await until(() => B.evaluate(() => { G.render(); return /70 still needed/.test(document.querySelector('.wd-give')?.textContent || ''); }), 20000));
await give(B, 'timber', 'max'); await give(B, 'iron', 'max');
check('together they finish the first phase', await until(() => A.evaluate(() => { G.render(); return /Phase 2 of 10/.test(document.querySelector('.wd-fig figcaption')?.textContent || ''); }), 20000));
check('both are on the plaque, the bigger giver first', await A.evaluate(() => [...document.querySelectorAll('.wd-who li')].map(li => li.textContent).join('|')).then(t => /Bronzeholm.*Statuaria/.test(t)));
await A.screenshot({ path: OUT + '/wonder-two.png' });

/* gifts between players */
await A.evaluate(id => { location.hash = '#visit/' + id; }, uidB); await sleep(600);
await A.click('[data-act="gf-k"][data-v="dish"]'); await A.click('[data-act="gf-send"]'); await sleep(300);
check('a gift to a player is recorded by the sender', ((await localNation(A)).gft || []).some(g => g.to === uidB && g.k === 'dish'));
await nav(B, 'diplomacy');
check('the recipient sees it waiting for thanks', await until(() => B.evaluate(() => { G.render(); return !!document.querySelector('[data-act="gf-answer"]'); }), 20000));
await B.click('[data-act="gf-ak"][data-v="card"]'); await B.click('[data-act="gf-answer"]'); await sleep(300);
check('the reply is kept by the replier', ((await localNation(B)).gfr || []).length === 1);
await nav(A, 'diplomacy');
check('and reaches the sender', await until(() => A.evaluate(() => { G.render(); return /Replies/.test(document.querySelector('.gf-sec')?.textContent || ''); }), 20000));
await A.locator('.gf-sec').screenshot({ path: OUT + '/gifts-two.png' });

/* field digs, on the Museum page */
await A.evaluate(() => { G.S.muHall = 'digs'; location.hash = '#museum'; }); await sleep(400);
await A.click('[data-act="dig-send"][data-k="3"]'); await sleep(300);
check('a dig sets out from the Museum', ((await localNation(A)).dig || []).length === 1);
await finish();
