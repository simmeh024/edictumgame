// The Great Statue, field digs and gifts between two player nations in one region (emulators).
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, localNation, clearEmulators, regionTab, text } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Region wonder tests require demo emulators');
await clearEmulators();
const A = await player('wonder A'), uidA = await open(A); await found(A, 'Statuaria');
const B = await player('wonder B'), uidB = await open(B); await found(B, 'Bronzeholm');
await until(() => A.evaluate(id => G.allNations().some(x => x.id === id), uidB), 20000);
await until(() => B.evaluate(id => G.allNations().some(x => x.id === id), uidA), 20000);
const C = await player('wonder C'), uidC = await open(C); await found(C, 'Idlemark');
await until(() => C.evaluate(ids => ids.every(id => G.allNations().some(x => x.id === id)), [uidA, uidB]), 20000);
const rich = p => p.evaluate(() => { const n = G.clone(G.S.nation); n.stock = { food: 400, timber: 400, iron: 400, oil: 400, goods: 400 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); });
const give = async (p, r, v) => { await nav(p, 'wonder'); await p.click(`[data-act="wd-give"][data-r="${r}"][data-v="${v}"]`); await sleep(300); };

/* the statue: both nations give, and each sees the other's gifts */
await rich(A); await rich(B);
await give(A, 'timber', '50');
check('a gift to the statue is kept in the giver’s own record', ((await localNation(A)).wnd || {}).c?.timber === 50);
await nav(B, 'wonder');
check('the other nation sees it in the pooled total', await until(() => B.evaluate(() => { G.render(); return /70 still needed/.test(document.querySelector('.wd-give')?.textContent || ''); }), 20000));

/* the call for help: the Office of Monuments writes to the region's nations, and takes no reply */
check('the first gift is dated in the giver’s record', typeof (await localNation(A)).wnd?.t0 === 'number');
await nav(B, 'messages');
check('the other nation gets the office’s letter in Messages', await until(() => B.evaluate(() => { G.render(); return /Office of Monuments/.test(document.querySelector('.conv-list')?.textContent || ''); }), 20000));
await B.click('[data-act="dm-peer"][data-id="office-monuments"]'); await sleep(300);
check('the letter says the statue has begun and asks for help, without a reply box', await B.evaluate(() => /Great Statue of .+ has begun[\s\S]*All help is requested/.test(document.querySelector('.bubs')?.textContent || '') && !document.getElementById('dm-text')));
check('opening it marks it read', await until(async () => ((await localNation(B)).seenDm || {})['office-monuments'] > 0, 10000));
await B.locator('.msg-layout').screenshot({ path: OUT + '/statue-letter.png' });
await give(B, 'timber', 'max'); await give(B, 'iron', 'max');
check('together they finish the first phase', await until(() => A.evaluate(() => { G.render(); return /Phase 2 of 10/.test(document.querySelector('.wd-fig figcaption')?.textContent || ''); }), 20000));
check('both are on the plaque, the bigger giver first', await A.evaluate(() => [...document.querySelectorAll('.wd-who li')].map(li => li.textContent).join('|')).then(t => /Bronzeholm.*Statuaria/.test(t)));
await A.screenshot({ path: OUT + '/wonder-two.png' });

/* the first phase's rewards: 2 land credits and its keepsake for each nation that gave to it, and nothing for the rest */
const reward = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); const n = G.S.nation, u = G.WND.unlocks(n);
  return { land: G.WND.land(n), keep: u.includes(G.WND.KEEP[0]), next: u.includes(G.WND.KEEP[1]), log: (n.log || []).some(l => l.k === 'wndr' && l.a === '0') }; });
const rA = await until(async () => { const r = await reward(A); return r.keep && r; }, 20000), rB = await reward(B);
check('each nation that gave to the finished phase gets 2 land credits', rA.land === 2 && rB.land === 2);
check('and the phase’s keepsake, with a notice in its log', rA.keep && rB.keep && rA.log && rB.log);
check('the next phase’s keepsake waits for that phase', !rA.next && !rB.next);
await until(() => C.evaluate(() => G.allNations().filter(x => x.n && x.n.wnd).length >= 2), 20000);
const rC = await reward(C);
check('a nation that gave nothing gets neither', rC.land === 0 && !rC.keep && !rC.log);

/* every gift is a happening of the region, seen by the nation that gave nothing: a few in a row by one nation are one */
const haps = /Statuaria gave 50 timber to the Great Statue of the Meridian Reach\./, hapsB = /Bronzeholm gave 70 timber and 60 iron to the Great Statue of the Meridian Reach\. That finished phase 1 of 10: foundations\./;
await regionTab(C, 'happenings');
check('the Region page’s happenings list each gift to the statue, and the gift that finished a phase says so', await until(async () => { await C.evaluate(() => G.render()); const t = await text(C, '#rgn-p-happenings'); return haps.test(t) && hapsB.test(t); }, 30000), (await text(C, '#rgn-p-happenings')).slice(0, 500));
await C.click('#rgn-p-happenings [data-act="go"][data-v="wonder"]');
check('the statue’s name there opens the statue', await until(async () => await C.evaluate(() => G.S.view) === 'wonder'));
await C.click('.rgc-btn'); await C.waitForSelector('#rgc-dock:not([hidden])'); await C.click('#rgc-tab-haps');
check('and the region chat’s Happenings tab lists them too', await until(async () => { const t = await text(C, '#rgc-list'); return haps.test(t) && hapsB.test(t); }, 30000), (await text(C, '#rgc-list')).slice(0, 500));
await C.locator('#rgc-list').screenshot({ path: OUT + '/statue-happenings.png' });
check('the statue page marks the reward as the giver’s', await A.evaluate(() => { G.render(); return /Yours/.test(document.querySelector('.wd-ph .wd-ph-r')?.textContent || ''); }));
await A.locator('.wd-phs').screenshot({ path: OUT + '/wonder-rewards.png' });

/* the ten keepsakes, drawn side by side (looked at, not checked) */
await A.evaluate(() => { const W = G.WND.art, n = G.S.nation, box = (t, h) => `<figure style="margin:0;display:flex;flex-direction:column;gap:6px;align-items:center;font:12px sans-serif">${h}<figcaption>${t}</figcaption></figure>`;
  const d = document.createElement('div'); d.id = 'wnd-art'; d.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:#f3f1ea;padding:20px;display:grid;grid-template-columns:repeat(5,1fr);gap:18px;align-items:center;color:#24302b');
  d.innerHTML = box('Site hoarding', `<div style="position:relative;overflow:hidden;width:220px;height:70px;border:1px solid #ccc;color:#2e4a3f">${W.pat('p-hoarding')}</div>`)
    + box('Dressed stone', `<div style="width:200px">${W.framed('f-stone', G.FD.flagSVG(n.flag, 'flag'))}</div>`)
    + box('Cast in bronze', `<div style="padding:12px;background:#fff">${W.stamp('s-cast', n)}</div>`)
    + box('Raised arm', `<svg viewBox="0 0 100 100" width="90" style="background:#2457a6">${W.emblem('e-arm', 50, 50, 40, '#f2f1ea')}</svg>`)
    + box('Scroll', `<div style="width:90px">${W.arms(Object.assign({}, W.arms0(n), { c: 'c-scroll', ct: 'or', t: ['azure', 'gules'], d: 'plain' }))}</div>`)
    + box('Gold leaf', `<div style="position:relative;overflow:hidden;width:220px;height:70px;border:1px solid #ccc;color:#b8861c">${W.pat('p-leaf')}</div>`)
    + box('Little statue', `<div style="width:120px;color:#24302b">${W.pin('pn-statue', n)}</div>`)
    + box('Drapery', '<span class="cz-mf mf-drape" style="font:italic 15px serif">Ever upward</span>')
    + box('Verdigris', '<span class="cz-asw" data-a="verdigris" style="display:inline-block;width:40px;height:40px;border-radius:50%"></span>')
    + box('the Monumental', `<b style="font:600 15px serif">${n.name} the Monumental</b>`);
  document.body.appendChild(d); });
await A.locator('#wnd-art').screenshot({ path: OUT + '/wonder-keepsakes.png' });
await A.evaluate(() => document.getElementById('wnd-art').remove());

/* gifts between players */
await A.evaluate(id => { location.hash = '#visit/' + id; }, uidB); await sleep(600);
await A.click('[data-act="gf-k"][data-v="dish"]'); await A.click('[data-act="gf-send"]'); await sleep(300);
check('a gift to a player is recorded by the sender', ((await localNation(A)).gft || []).some(g => g.to === uidB && g.k === 'dish'));
await nav(B, 'diplomacy');
check('the recipient sees it waiting for thanks', await until(() => B.evaluate(() => { G.render(); return !!document.querySelector('[data-act="gf-answer"]'); }), 20000));
await B.click('#dp-tab-gifts'); /* gifts have their own tab on the Diplomacy page */
await B.click('[data-act="gf-ak"][data-v="card"]'); await B.click('[data-act="gf-answer"]'); await sleep(300);
check('the reply is kept by the replier', ((await localNation(B)).gfr || []).length === 1);
await nav(A, 'diplomacy');
check('and reaches the sender', await until(() => A.evaluate(() => { G.render(); return /Replies/.test(document.querySelector('.gf-sec')?.textContent || ''); }), 20000));
await A.click('#dp-tab-gifts'); await A.locator('.gf-sec').screenshot({ path: OUT + '/gifts-two.png' });
/* an answered gift stays answered: replies are kept for the 60 days a gift can be answered, and up to 200 (only the last 40
   once were, and a gift answered before them came back as waiting for thanks) */
await B.evaluate(() => { const n = G.clone(G.S.nation), now = Date.now();
  n.gfr = n.gfr.concat(Array.from({ length: 45 }, (_, i) => ({ id: 'gfx' + i, f: n.gfr[0].f, k: 'card', m: 0, t: now + i }))); G.commit(n); G.render(); });
await sleep(1500); await B.reload(); await B.waitForFunction(() => window.G && G.S && G.S.nation && G.S.world); await nav(B, 'diplomacy');
check('an answered gift stays answered behind 45 newer replies', await until(() => B.evaluate(() => { G.render(); return G.S.nation.gfr.length === 46 && !!document.querySelector('.gf-sec') && !document.querySelector('[data-act="gf-answer"]'); }), 15000),
  JSON.stringify(await B.evaluate(() => ({ replies: G.S.nation.gfr.length, waiting: document.querySelectorAll('[data-act="gf-answer"]').length }))));
/* and a gift older than those 60 days waits for no thanks (its reply may have gone) */
check('a gift past sixty days waits for no thanks', await B.evaluate(() => { const n = G.clone(G.S.nation); n.gfr = []; G.S.nation = n;
  for (const r of Object.values(G.S.world || {})) for (const g of (r && r.gft) || []) g.t = Date.now() - 61 * 864e5;
  G.render(); return !document.querySelector('[data-act="gf-answer"]'); }));

/* Magnanimous: for peace made with the land handed back, not for an offer the other side has not taken up (in A's page only:
   A declared war on B moments ago, after B was founded (an older war would not count), and offers peace, handing the land
   back; then B makes peace too) */
const mag = await A.evaluate(id => {
  const a = G.RK.ACH.find(x => x.id === 'dip-return'), me = G.S.uid, t = Date.now(), n0 = G.S.nation, b0 = G.S.world[id];
  G.S.nation = { ...n0, wars: { ...(n0.wars || {}), [id]: { t: t - 3000 } }, peace: { ...(n0.peace || {}), [id]: t - 2000 }, pterm: { [id]: 'return' }, log: [] };
  const x = { n: G.S.nation, id: me, now: t, me: true, npc: false, m: {} }, offered = a.f(x);
  G.S.world[id] = { ...b0, peace: { ...(b0.peace || {}), [me]: t - 1000 } };
  const made = a.f(x);
  G.S.nation = n0; G.S.world[id] = b0;
  return { offered, made };
}, uidB);
check('Magnanimous waits for the peace to be made', mag.offered === 0 && mag.made === 1, JSON.stringify(mag));

/* field digs, on the Museum page */
await A.evaluate(() => { G.S.muHall = 'digs'; location.hash = '#museum'; }); await sleep(400);
await A.click('[data-act="dig-send"][data-k="3"]'); await sleep(300);
check('a dig sets out from the Museum', ((await localNation(A)).dig || []).length === 1);
await finish();
