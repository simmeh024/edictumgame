// The Great Dam: the region's third wonder, opened by the lit Great Lighthouse (emulators, four player nations). The menu
// link and the page switch to it, the Office of Monuments writes, a phase needs three nations and no nation may give more
// than 40% of it, a nation that gives 1,105 in all earns 4 land credits, the top givers at the opening earn 5/4/3/2 more and
// the Floodgate pattern, the blue dam edicts reach every desk every five phases, and tier II works make 10% more once open.
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, localNation, clearEmulators, regionTab, text, errors } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Dam tests require demo emulators');
await clearEmulators();
const P = {}, uid = {};
for (const [k, nm] of [['A', 'Weirholm'], ['B', 'Sluiceby'], ['C', 'Turbinia'], ['D', 'Floodmere']]) { P[k] = await player('dam ' + k); uid[k] = await open(P[k]); await found(P[k], nm); }
const { A, B, C, D } = P;
for (const p of [A, B, C, D]) await until(() => p.evaluate(ids => ids.every(id => G.allNations().some(x => x.id === id)), Object.values(uid)), 30000);
const refresh = p => p.evaluate(() => { G.DAM().reopen(); G.render(); });
const label = p => p.evaluate(() => document.querySelector('.nav [data-v="wonder"]')?.textContent.replace(/\s+/g, ' ').trim() || '');
const rich = p => p.evaluate(() => { const n = G.clone(G.S.nation); n.stock = { food: 2000, timber: 2000, iron: 2000, oil: 2000, goods: 2000 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); });
const give = async (p, r, v) => { await nav(p, 'wonder'); await p.click(`[data-act="dm-give"][data-r="${r}"][data-v="${v}"]`); await sleep(300); };
const dam = async p => (await localNation(p)).dam || {};

check('before the lighthouse is lit, the dam is closed', !(await B.evaluate(() => G.DAM().open())));

/* A's record says it saw the lighthouse lit, and every nation of the region sees the dam open */
await A.evaluate(() => { const n = G.clone(G.S.nation), now = Date.now(); n.lth = { r: G.DAM().reg(), p: { 0: { timber: 100 } }, ph: 12, t: now - 60000, t0: now - 864e5 }; G.commit(n); G.render(); });
for (const p of [A, B, C, D]) check('the lit lighthouse opens the dam for ' + (await p.evaluate(() => G.S.nation.name)), await until(async () => { await refresh(p); return p.evaluate(() => G.DAM().open()); }, 30000));
check('the menu link switches to the Great Dam', await until(async () => { await refresh(B); return /Great Dam/.test(await label(B)); }, 10000), await label(B));
await nav(B, 'wonder');
check('the page shows the dam, with the lighthouse and the statue under past projects', /Great Dam/.test(await text(B, '.vh h1')) && /Great Lighthouse/.test(await text(B, '#wd-past')), await text(B, '.vh h1'));
check('the dam stands on a river hex, away from the lighthouse', await B.evaluate(() => { const D = G.DAM(), c = D.cell(), l = D.lcell(); return c >= 0 && c !== l; }));
await nav(B, 'messages');
check('the Office of Monuments writes to begin the dam', await until(async () => { await B.evaluate(() => G.render()); return /Office of Monuments/.test(await text(B, '.conv-list')); }, 20000));
await B.click('[data-act="dm-peer"][data-id="office-monuments"]'); await sleep(300);
check('its letter states the rules', /Work begins on the Great Dam[\s\S]*40%[\s\S]*1,105[\s\S]*in blue/.test(await text(B, '.bubs')), (await text(B, '.bubs')).slice(-700));

/* phase 1, the survey (300 timber, 100 goods, 500 food; 40% is 360): A gives all the food it may, B the rest of the food
   and 220 timber, and C the last 80 timber and the goods */
for (const p of [A, B, C, D]) await rich(p);
await give(A, 'food', 'max');
check('a nation’s gifts to a phase stop at 40% of it', (await dam(A)).p?.[0]?.food === 360, JSON.stringify((await dam(A)).p));
await until(() => B.evaluate(() => G.DAM().state().need.food === 140), 20000);
await give(B, 'food', 'max'); await give(B, 'timber', 'max');
check('two nations are not enough: the page asks for a third', await until(async () => { await nav(C, 'wonder'); return /2 nations have given to this phase: it needs at least 3/.test(await text(C, '.dm-hands')); }, 20000), await text(C, '.dm-hands'));
await until(() => C.evaluate(() => G.DAM().state().need.timber === 80), 20000);
await give(C, 'timber', 'max'); await give(C, 'goods', 'max');
check('three hands finish the survey', await until(async () => { await A.evaluate(() => G.render()); return A.evaluate(() => G.DAM().state().done === 1); }, 20000), JSON.stringify(await A.evaluate(() => G.DAM().state().need)));
await nav(A, 'wonder'); await A.screenshot({ path: OUT + '/dam-page.png', fullPage: true });

/* the opening: B, C, A and D give goods to the nineteen phases after the survey (B 100 each, C 80, A 60, D 20), and D's
   record says it saw all twenty finished; the others see it at their next save, with their place on the plaque */
const fill = (p, amt) => p.evaluate(amt => { const n = G.clone(G.S.nation), now = Date.now(), w = n.dam || { r: G.DAM().reg(), p: {}, ph: 0, t0: now };
  w.p = Object.assign({}, w.p); for (let i = 1; i < 20; i++) w.p[i] = { goods: amt }; w.t = now; n.dam = w; G.commit(n); G.render(); }, amt);
await fill(B, 100); await fill(C, 80); await fill(A, 60); await fill(D, 20);
await until(() => D.evaluate(() => G.allNations().filter(x => x.n && x.n.dam && x.n.dam.p && x.n.dam.p[19]).length === 4), 30000);
await D.evaluate(() => { const n = G.clone(G.S.nation); n.dam = Object.assign({}, n.dam, { ph: 20, t: Date.now() }); G.commit(n); G.render(); });
check('the dam opens for everyone', await until(() => B.evaluate(() => { G.render(); return G.DAM().state().done === 20; }), 30000));
const place = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); const n = G.S.nation; return { k: n.dam?.k || 0, s: n.dam?.s || 0, land: G.DAM().land(n), flood: G.WND.unlocks(n).includes('p-flood') }; });
const got = async p => until(async () => { const x = await place(p); return x.k && x; }, 20000), pB = await got(B), pC = await got(C), pA = await got(A), pD = await got(D);
check('the biggest giver (2,260) is first: 4 + 5 land credits and the Floodgate', pB && pB.k === 1 && pB.s === 1 && pB.land === 9 && pB.flood, JSON.stringify(pB));
check('the second (1,700) is second: 4 + 4', pC && pC.k === 2 && pC.land === 8 && pC.flood, JSON.stringify(pC));
check('the third (1,500) is third: 4 + 3', pA && pA.k === 3 && pA.land === 7, JSON.stringify(pA));
check('the fourth gave only 380, below the 1,105 share: 0 + 2', pD && pD.k === 4 && pD.s === 0 && pD.land === 2, JSON.stringify(pD));
/* once open, the page moves on to the Hall of Edicts, and the dam's plaque is under Past projects */
await nav(D, 'wonder');
const PL = '#wd-past .wd-who';
check('the page moves on to the Hall of Edicts once the dam is open', await until(async () => { await D.evaluate(() => G.render()); return /Hall of Edicts/.test(await text(D, '.vh h1')); }, 10000), await text(D, '.vh h1'));
await D.evaluate(() => document.querySelectorAll('#wd-past details').forEach(d => { d.open = true; }));
check('the plaque names the top givers', /Sluiceby\s*Gold/.test(await text(D, PL + ' li.wd-m1')), await text(D, PL));
await D.locator(PL).first().screenshot({ path: OUT + '/dam-plaque.png' });

/* the dam edicts: all four reach the desk, blue, outside the edict clock */
const desk = p => p.evaluate(() => { const n = G.syncInbox(G.S.nation, Date.now()); G.commit(n); G.render(); return G.S.nation.inbox.map(x => x.id).filter(id => /^dam-/.test(id)); });
const ids = await until(async () => { const d = await desk(C); return d.length === 4 && d; }, 20000);
check('the four dam edicts are on the desk', !!ids, JSON.stringify(await desk(C)));
await nav(C, 'issues');
check('they are marked Great Dam, in blue', await C.evaluate(() => { const t = document.querySelector('.issue-item .edict-dam'); return !!t && getComputedStyle(t.closest('.issue-item').querySelector('.issue-card')).borderLeftColor !== ''; }));
await C.locator('#main').screenshot({ path: OUT + '/dam-desk.png' });
const before = await C.evaluate(() => Math.floor(G.MD.stockNow(G.S.nation).goods));
await C.click('[data-act="open"][data-id="dam-valley"]'); await C.waitForSelector('.edict [data-act="answer"]');
await C.screenshot({ path: OUT + '/dam-edict.png' });
await C.click('[data-act="answer"][data-id="dam-valley"][data-o="0"]'); await sleep(400);
const after = await C.evaluate(() => Math.floor(G.MD.stockNow(G.S.nation).goods));
check('paying the families of Lower Wending costs 60 goods', before - after >= 59 && before - after <= 61, `${before} → ${after}`);
await regionTab(D, 'happenings');
check('the choice is in the region’s happenings', await until(async () => { await D.evaluate(() => G.render()); return /Great Dam’s “The Valley Must Be Flooded”, Turbinia paid the families of Lower Wending/.test(await text(D, '#rgn-p-happenings')); }, 30000), (await text(D, '#rgn-p-happenings')).slice(0, 400));

/* the opened dam powers tier II works: an Assembly Plant's 12 goods become 13.2 */
check('tier II works make 10% more once the dam is open', await B.evaluate(() => G.DAM().bEff('factory', 2, 'asm').res.goods[1]) === 13.2);
const ach = await B.evaluate(() => { G.commit(G.clone(G.S.nation)); return Object.keys(G.S.nation.ach || {}).filter(id => /^bld-dam/.test(id)); });
check('Dam Builder and Top Five of the Dam are earned', ach.includes('bld-damtop') && ach.includes('bld-dam1000'), JSON.stringify(ach));
await sleep(2000); await B.reload(); await B.waitForFunction(() => window.G && G.S && G.S.nation && G.S.world);
const kept = await B.evaluate(() => ({ k: G.S.nation.dam?.k, s: G.S.nation.dam?.s, ph: G.S.nation.dam?.ph, land: G.DAM().land(G.S.nation) }));
check('the record keeps its share, phases and place after a reload', kept.k === 1 && kept.s === 1 && kept.ph === 20 && kept.land === 9, JSON.stringify(kept));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await finish();
