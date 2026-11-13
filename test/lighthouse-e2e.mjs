// The Great Lighthouse: the region's second wonder, opened by the finished Great Statue (emulators, four player nations).
// The menu link and the page switch to it, the Office of Monuments writes, a phase needs three nations and no nation may give
// more than 40% of it, a phase pays 4 land credits only to nations that gave at least 5% of it, and the three biggest
// givers are named in gold, silver and bronze when the lamp is lit and receive the Keeper's Beam pattern.
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, localNation, clearEmulators, regionTab, text, errors } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Lighthouse tests require demo emulators');
await clearEmulators();
const P = {}, uid = {};
for (const [k, nm] of [['A', 'Harbourne'], ['B', 'Lampwick'], ['C', 'Saltcoat'], ['D', 'Driftly']]) { P[k] = await player('lighthouse ' + k); uid[k] = await open(P[k]); await found(P[k], nm); }
const { A, B, C, D } = P;
for (const p of [A, B, C, D]) await until(() => p.evaluate(ids => ids.every(id => G.allNations().some(x => x.id === id)), Object.values(uid)), 30000);
const refresh = p => p.evaluate(() => { G.LTH().reopen(); G.render(); });
const label = p => p.evaluate(() => document.querySelector('.nav [data-v="wonder"]')?.textContent.replace(/\s+/g, ' ').trim() || '');
const rich = p => p.evaluate(() => { const n = G.clone(G.S.nation); n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); });
const give = async (p, r, v) => { await nav(p, 'wonder'); await p.click(`[data-act="lt-give"][data-r="${r}"][data-v="${v}"]`); await sleep(300); };
const lth = async p => (await localNation(p)).lth || {};

check('before the statue is finished, the menu shows the Great Statue', /Great Statue/.test(await label(B)), await label(B));
check('and the lighthouse is closed', !(await B.evaluate(() => G.LTH().open())));

/* A finishes the statue (its record says it saw all ten phases), and every nation of the region sees the lighthouse open */
await A.evaluate(() => { const n = G.clone(G.S.nation), now = Date.now(); n.wnd = { r: G.LTH().reg(), c: { timber: 120, iron: 60 }, ph: 10, t: now - 60000, t0: now - 864e5, g: [0] }; G.commit(n); G.render(); });
for (const p of [A, B, C, D]) check('the finished statue opens the lighthouse for ' + (await p.evaluate(() => G.S.nation.name)), await until(async () => { await refresh(p); return p.evaluate(() => G.LTH().open()); }, 30000));
check('the menu link switches to the Great Lighthouse', await until(async () => { await refresh(B); return /Great Lighthouse/.test(await label(B)); }, 10000), await label(B));
await nav(B, 'wonder');
check('the page shows the lighthouse, with the statue under past projects', /Great Lighthouse/.test(await text(B, '.vh h1')) && /Great Statue/.test(await text(B, '#wd-past')));
await nav(B, 'messages');
check('the Office of Monuments writes to begin the lighthouse', await until(async () => { await B.evaluate(() => G.render()); return /Office of Monuments/.test(await text(B, '.conv-list')); }, 20000));
await B.click('[data-act="dm-peer"][data-id="office-monuments"]'); await sleep(300);
check('its letter states the rules', /Work begins on the Great Lighthouse[\s\S]*40%[\s\S]*at least 3 nations/.test(await text(B, '.bubs')), (await text(B, '.bubs')).slice(-600));
await B.locator('.msg-layout').screenshot({ path: OUT + '/lighthouse-letter.png' });
await regionTab(C, 'overview').catch(() => {});
check('the region overview card shows the lighthouse', await until(async () => { await C.evaluate(() => G.render()); return /Great Lighthouse/.test(await text(C, '#rgn-st-h')); }, 10000), await text(C, '#rgn-st-h'));

/* phase 1, the causeway (200 timber, 80 iron, 60 food): A gives all it may (40% = 136), B the rest of the timber and some iron */
for (const p of [A, B, C, D]) await rich(p);
await give(A, 'timber', 'max');
check('a nation’s gifts to a phase stop at 40% of it', (await lth(A)).p?.[0]?.timber === 136, JSON.stringify((await lth(A)).p));
check('and its buttons are then disabled', await A.evaluate(() => { G.render(); return [...document.querySelectorAll('[data-act="lt-give"]')].every(b => b.disabled); }));
await until(() => B.evaluate(() => G.LTH().state().need.timber === 64), 20000);
await give(B, 'timber', 'max'); await give(B, 'iron', 'max');
check('the second nation fills its own 40%: 64 timber and 72 iron', JSON.stringify((await lth(B)).p?.[0]) === '{"timber":64,"iron":72}', JSON.stringify((await lth(B)).p));
check('two nations are not enough: the page asks for a third', await until(async () => { await nav(C, 'wonder'); return /2 nations have given to this phase: it needs at least 3/.test(await text(C, '.lt-hands')); }, 20000), await text(C, '.lt-hands'));
/* D gives a token 5 food (below the 5% share of 17), and C gives the rest, which finishes the causeway */
await give(D, 'food', '10'); /* 10 is under the 17 a share takes */
await until(() => C.evaluate(() => G.LTH().state().need.food === 50), 20000);
await give(C, 'iron', 'max'); await give(C, 'food', 'max');
check('three hands finish the causeway', await until(async () => { await A.evaluate(() => G.render()); return A.evaluate(() => G.LTH().state().done === 1); }, 20000), JSON.stringify(await A.evaluate(() => G.LTH().state())));
check('the finishing gift is marked in the giver’s record', (await lth(C)).fx?.[0] > 0 && (await lth(C)).h?.[0]?.f === 1);
const reward = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); const n = G.S.nation; return { land: G.LTH().land(n), log: (n.log || []).some(l => l.k === 'lthr' && l.a === '0') }; });
for (const [k, p] of [['A', A], ['B', B], ['C', C]]) { const r = await until(async () => { const x = await reward(p); return x.land === 4 && x; }, 20000); check(`${k} gave its share and gets 4 land credits, with a notice`, !!r && r.log, JSON.stringify(r || await reward(p))); }
await until(() => D.evaluate(() => G.LTH().state().done === 1), 20000);
const rD = await reward(D);
check('a token gift below the 5% share gets nothing', rD.land === 0 && !rD.log, JSON.stringify(rD));
await nav(D, 'wonder');
check('and the phase list tells it how much it would have taken', /You gave 10 of the 17 it takes/.test(await text(D, '.wd-phs')), (await text(D, '.wd-phs')).slice(0, 400));
await nav(A, 'wonder'); await A.screenshot({ path: OUT + '/lighthouse-page.png', fullPage: true });

/* the happenings: each gift, and the one that finished the causeway */
await regionTab(D, 'happenings');
check('the region’s happenings list the gift that finished a phase', await until(async () => { await D.evaluate(() => G.render()); return /Saltcoat gave .* to the Great Lighthouse of the Meridian Reach\. That finished phase 1 of 12: the causeway\./.test(await text(D, '#rgn-p-happenings')); }, 30000), (await text(D, '#rgn-p-happenings')).slice(0, 400));

/* the lighting: B, C and A give goods to the eleven phases after the causeway (B 796 in all, C 498, A 466, D 10), and D's
   record says it saw all twelve finished; the others see it at their next save, with their place on the plaque */
const lit = (p, amt, ph) => p.evaluate(([amt, ph]) => { const n = G.clone(G.S.nation), now = Date.now(), w = n.lth;
  w.p = Object.assign({}, w.p); for (let i = 1; i < 12; i++) w.p[i] = { goods: amt }; w.t = now; if (ph) w.ph = ph; G.commit(n); G.render(); }, [amt, ph]);
await lit(B, 60, 0); await lit(C, 40, 0); await lit(A, 30, 0);
await until(() => D.evaluate(() => G.allNations().filter(x => x.n && x.n.lth && x.n.lth.p && x.n.lth.p[11]).length === 3), 30000);
await D.evaluate(() => { const n = G.clone(G.S.nation); n.lth = Object.assign({}, n.lth, { ph: 12, t: Date.now() }); G.commit(n); G.render(); });
check('the lamp is lit for everyone', await until(() => D.evaluate(() => G.LTH().state().done === 12), 30000));
const place = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); const n = G.S.nation; return { k: n.lth?.k || 0, top: G.LTH().top(n), beam: G.WND.unlocks(n).includes('p-beam') }; });
const got = async p => until(async () => { const x = await place(p); return x.k && x; }, 20000), pB = await got(B), pC = await got(C), pA = await got(A);
check('the biggest giver is first, in gold, with the Keeper’s Beam', pB && pB.k === 1 && pB.beam, JSON.stringify(pB));
check('the second biggest is second, in silver', pC && pC.k === 2 && pC.beam, JSON.stringify(pC));
check('and the third, in bronze', pA && pA.k === 3 && pA.beam, JSON.stringify(pA));
const pD = await place(D);
check('a nation outside the top three has no medal and no pattern', pD.k === 0 && !pD.beam, JSON.stringify(pD));
await nav(D, 'wonder');
check('the plaque names gold, silver and bronze', await until(() => D.evaluate(() => { G.render(); return ['wd-m1', 'wd-m2', 'wd-m3'].every(c => document.querySelector('.wd-side .wd-who li.' + c + ' .wd-mt')); }), 10000));
check('Lampwick is in gold', /Lampwick\s*Gold/.test(await text(D, '.wd-side .wd-who li.wd-m1')), await text(D, '.wd-side .wd-who li.wd-m1'));
await D.locator('.wd-side .wd-who').screenshot({ path: OUT + '/lighthouse-plaque.png' });
const ach = await B.evaluate(() => { G.commit(G.clone(G.S.nation)); return Object.keys(G.S.nation.ach || {}).filter(id => /^bld-(lth|wonders2|laststone)/.test(id)); });
check('Top of the Plaque is earned', ach.includes('bld-lthtop'), JSON.stringify(ach));
const achC = await C.evaluate(() => { G.commit(G.clone(G.S.nation)); return Object.keys(G.S.nation.ach || {}); });
check('The Last Stone for the gift that finished a phase', achC.includes('bld-laststone'), JSON.stringify(achC.filter(id => /^bld-/.test(id))));
check('Statue and Signal for the nation that gave to both', await A.evaluate(() => { G.commit(G.clone(G.S.nation)); return !!(G.S.nation.ach || {})['bld-wonders2']; }));
/* and what the record keeps survives a reload */
await sleep(2000); await B.reload(); await B.waitForFunction(() => window.G && G.S && G.S.nation && G.S.world);
const kept = await B.evaluate(() => ({ k: G.S.nation.lth?.k, p0: G.S.nation.lth?.p?.[0], ph: G.S.nation.lth?.ph, land: G.LTH().land(G.S.nation) }));
check('the record keeps its gifts, phases and place after a reload', kept.k === 1 && kept.ph === 12 && kept.p0?.timber === 64 && kept.land === 48, JSON.stringify(kept));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await finish();
