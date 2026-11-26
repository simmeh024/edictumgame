// The Hall of Edicts: the region's fourth wonder, opened by the open Great Dam (emulators, four player nations). The menu
// link and the page switch to it, the Office of Monuments writes, a phase needs four nations and no nation may give more
// than 30% of it, every finished phase pays 2 land credits to each nation that gave 5% of it, the top givers at the
// opening earn 20/15/10/5 more and the first the Portico, the purple hall edicts reach every desk every five phases, and
// once open the region's Assembly rulebook holds six resolutions instead of five.
import { OUT, PROJECT, check, finish, sleep, until, player, open, found, nav, localNation, clearEmulators, regionTab, text, errors } from './lib.mjs';
if (!PROJECT.startsWith('demo-')) throw Error('Hall tests require demo emulators');
await clearEmulators();
const P = {}, uid = {};
for (const [k, nm] of [['A', 'Archivia'], ['B', 'Quillmouth'], ['C', 'Scrollby'], ['D', 'Lexmere']]) { P[k] = await player('hall ' + k); uid[k] = await open(P[k]); await found(P[k], nm); }
const { A, B, C, D } = P;
for (const p of [A, B, C, D]) await until(() => p.evaluate(ids => ids.every(id => G.allNations().some(x => x.id === id)), Object.values(uid)), 30000);
const refresh = p => p.evaluate(() => { window.EDICTUM_PROBE.hal.reopen(); G.render(); });
const label = p => p.evaluate(() => document.querySelector('.nav [data-v="wonder"]')?.textContent.replace(/\s+/g, ' ').trim() || '');
const rich = p => p.evaluate(() => { const n = G.clone(G.S.nation); n.stock = { food: 2000, timber: 2000, iron: 2000, oil: 2000, goods: 2000 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); });
const give = async (p, r, v) => { await nav(p, 'wonder'); await p.click(`[data-act="hl-give"][data-r="${r}"][data-v="${v}"]`); await sleep(300); };
const hal = async p => (await localNation(p)).hal || {};
const bookNow = p => p.evaluate(() => { const X = window.EDICTUM_PROBE.hal; return X.bookMax(X.cyc(Date.now())); });

check('before the dam is open, the hall is closed', !(await B.evaluate(() => window.EDICTUM_PROBE.hal.open())));
check('and the rulebook holds five', await bookNow(B) === 5, String(await bookNow(B)));

/* A's record says it saw the dam open, and every nation of the region sees the hall open */
await A.evaluate(() => { const n = G.clone(G.S.nation), now = Date.now(); n.dam = { r: window.EDICTUM_PROBE.hal.reg(), p: { 0: { food: 100 } }, ph: 20, t: now - 60000, t0: now - 864e5 }; G.commit(n); G.render(); });
for (const p of [A, B, C, D]) check('the open dam opens the hall for ' + (await p.evaluate(() => G.S.nation.name)), await until(async () => { await refresh(p); return p.evaluate(() => window.EDICTUM_PROBE.hal.open()); }, 30000));
check('the menu link switches to the Hall of Edicts', await until(async () => { await refresh(B); return /Hall of Edicts/.test(await label(B)); }, 10000), await label(B));
await nav(B, 'wonder');
check('the page shows the hall, with the dam under past projects', /Hall of Edicts/.test(await text(B, '.vh h1')) && /Great Dam/.test(await text(B, '#wd-past')), await text(B, '.vh h1'));
check('the hall stands on a land hex near the statue', await B.evaluate(() => window.EDICTUM_PROBE.hal.cell() >= 0));
check('the archive box says the rulebook will hold six', /holds 6 resolutions instead of 5/.test(await text(B, '.hl-arch')), await text(B, '.hl-arch'));
await nav(B, 'messages');
check('the Office of Monuments writes to begin the hall', await until(async () => { await B.evaluate(() => G.render()); return /Office of Monuments/.test(await text(B, '.conv-list')); }, 20000));
await B.click('[data-act="dm-peer"][data-id="office-monuments"]'); await sleep(300);
check('its letter states the rules', /Work begins on the Hall of Edicts[\s\S]*30%[\s\S]*2 land credits[\s\S]*20, 15, 10, 5,? and 3[\s\S]*Portico[\s\S]*6 resolutions[\s\S]*in purple/.test(await text(B, '.bubs')), (await text(B, '.bubs')).slice(-900));

/* phase 1, the competition (300 food, 100 timber, 500 goods; 30% is 270): A gives all the goods it may, B the rest of
   the goods and 40 food, C 260 food and 10 timber, and D the last 90 timber */
for (const p of [A, B, C, D]) await rich(p);
await give(A, 'goods', 'max');
check('a nation’s gifts to a phase stop at 30% of it', (await hal(A)).p?.[0]?.goods === 270, JSON.stringify((await hal(A)).p));
await until(() => B.evaluate(() => window.EDICTUM_PROBE.hal.state().need.goods === 230), 20000);
await give(B, 'goods', 'max'); await give(B, 'food', 'max');
await until(() => C.evaluate(() => window.EDICTUM_PROBE.hal.state().need.food === 260), 20000);
await give(C, 'food', 'max'); await give(C, 'timber', 'max');
check('three nations are not enough: the page asks for a fourth', await until(async () => { await nav(D, 'wonder'); return /3 nations have given to this phase: it needs at least 4/.test(await text(D, '.hl-hands')); }, 20000), await text(D, '.hl-hands'));
await until(() => D.evaluate(() => window.EDICTUM_PROBE.hal.state().need.timber === 90), 20000);
await give(D, 'timber', 'max');
check('four hands finish the competition', await until(async () => { await A.evaluate(() => G.render()); return A.evaluate(() => window.EDICTUM_PROBE.hal.state().done === 1); }, 20000), JSON.stringify(await A.evaluate(() => window.EDICTUM_PROBE.hal.state().need)));
const credits = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); return window.EDICTUM_PROBE.hal.land(G.S.nation); });
for (const [k, p] of [['A', A], ['B', B], ['C', C], ['D', D]]) check(`${k} gave 5% of the phase or more: 2 land credits`, await until(async () => (await credits(p)) === 2, 20000), String(await credits(p)));
await nav(A, 'wonder'); await A.screenshot({ path: OUT + '/hall-page.png', fullPage: true });

/* the opening: B, C, A and D give goods to the twenty-four phases after the competition (B 100 each, C 80, A 60, D 20),
   and D's record says it saw all twenty-five finished; the others see it at their next save, with their place */
const AMT = { B: 100, C: 80, A: 60, D: 20 }, FIRST = { A: 270, B: 270, C: 270, D: 90 };
const fill = (p, amt) => p.evaluate(amt => { const n = G.clone(G.S.nation), now = Date.now(), w = n.hal;
  w.p = Object.assign({}, w.p); for (let i = 1; i < 25; i++) w.p[i] = { goods: amt }; w.t = now; n.hal = w; G.commit(n); G.render(); }, amt);
await fill(B, AMT.B); await fill(C, AMT.C); await fill(A, AMT.A); await fill(D, AMT.D);
await until(() => D.evaluate(() => G.allNations().filter(x => x.n && x.n.hal && x.n.hal.p && x.n.hal.p[24]).length === 4), 30000);
await D.evaluate(() => { const n = G.clone(G.S.nation); n.hal = Object.assign({}, n.hal, { ph: 25, t: Date.now(), fx: { 24: Date.now() } }); G.commit(n); G.render(); });
check('the hall opens for everyone', await until(() => B.evaluate(() => { G.render(); return window.EDICTUM_PROBE.hal.state().done === 25; }), 30000));
const share = await B.evaluate(() => window.EDICTUM_PROBE.hal.PH.map((p, i) => window.EDICTUM_PROBE.hal.share(i)));
const want = k => 2 * share.filter((s, i) => (i ? AMT[k] : FIRST[k]) >= s).length;
const place = p => p.evaluate(() => { G.commit(G.clone(G.S.nation)); const n = G.S.nation; return { k: n.hal?.k || 0, land: window.EDICTUM_PROBE.hal.land(n), portico: G.WND.unlocks(n).includes('c-portico') && G.WND.unlocks(n).includes('e-portico') }; });
const got = async p => until(async () => { const x = await place(p); return x.k && x; }, 20000), pB = await got(B), pC = await got(C), pA = await got(A), pD = await got(D);
check(`the biggest giver is first: ${want('B')} for its phases + 20, and the Portico`, pB && pB.k === 1 && pB.land === want('B') + 20 && pB.portico, JSON.stringify(pB));
check(`the second: ${want('C')} + 15, no Portico`, pC && pC.k === 2 && pC.land === want('C') + 15 && !pC.portico, JSON.stringify(pC));
check(`the third: ${want('A')} + 10`, pA && pA.k === 3 && pA.land === want('A') + 10, JSON.stringify(pA));
check(`the fourth gave 20 a phase, below every share after the first: ${want('D')} + 5`, pD && pD.k === 4 && pD.land === want('D') + 5 && want('D') === 2, JSON.stringify(pD));
check('the rulebook holds six now, for every nation of the region', (await bookNow(A)) === 6 && (await bookNow(D)) === 6, `${await bookNow(A)} ${await bookNow(D)}`);
await nav(D, 'wonder');
check('the plaque names the top givers', /Quillmouth\s*Gold/.test(await text(D, '.wd-side .wd-who li.wd-m1')), await text(D, '.wd-side .wd-who'));
check('the page says the hall is open and the rulebook holds six', /Its rulebook now holds 6 resolutions/.test(await text(D, '.wd-side')), (await text(D, '.wd-side')).slice(0, 300));
await D.locator('.wd-side .wd-who').screenshot({ path: OUT + '/hall-plaque.png' });
await D.locator('.wd-grid').screenshot({ path: OUT + '/hall-open.png' });
check('the Portico draws as a charge', await B.evaluate(() => /<path/.test(window.EDICTUM_PROBE.hal.charge())));

/* the hall edicts: all five reach the desk, purple, outside the edict clock */
/* a desk holds ten at most and the dam's four edicts are on it too: the hall's come once there is room, so the desk is
   cleared of everything else first */
const desk = p => p.evaluate(() => { const m = G.clone(G.S.nation); m.inbox = (m.inbox || []).filter(x => /^hall-/.test(x.id)); const n = G.syncInbox(m, Date.now()); G.commit(n); G.render(); return G.S.nation.inbox.map(x => x.id).filter(id => /^hall-/.test(id)); });
const ids = await until(async () => { const d = await desk(C); return d.length === 5 && d; }, 20000);
check('the five hall edicts are on the desk', !!ids, JSON.stringify(await desk(C)));
await nav(C, 'issues');
check('they are marked Hall of Edicts, in purple', await C.evaluate(() => { const t = document.querySelector('.issue-item .edict-hall'); return !!t && /Hall of Edicts/.test(t.textContent); }));
await C.locator('#main').screenshot({ path: OUT + '/hall-desk.png' });
const before = await C.evaluate(() => Math.floor(G.MD.stockNow(G.S.nation).goods));
await C.click('[data-act="open"][data-id="hall-vaults"]'); await C.waitForSelector('.edict [data-act="answer"]');
await C.screenshot({ path: OUT + '/hall-edict.png' });
await C.click('[data-act="answer"][data-id="hall-vaults"][data-o="0"]'); await sleep(400);
const after = await C.evaluate(() => Math.floor(G.MD.stockNow(G.S.nation).goods));
check('sending the whole archive costs 40 goods', before - after >= 39 && before - after <= 41, `${before} → ${after}`);
await regionTab(D, 'happenings');
check('the choice is in the region’s happenings', await until(async () => { await D.evaluate(() => G.render()); return /Hall of Edicts’ “What Goes in the Vaults\?”, Scrollby sent its whole archive/.test(await text(D, '#rgn-p-happenings')); }, 30000), (await text(D, '#rgn-p-happenings')).slice(0, 400));
const ach = await B.evaluate(() => { G.commit(G.clone(G.S.nation)); return Object.keys(G.S.nation.ach || {}).filter(id => /^bld-hall/.test(id)); });
check('Hall Builder and Top Five of the Hall are earned', ach.includes('bld-halltop') && ach.includes('bld-hall1500'), JSON.stringify(ach));
await sleep(2000); await B.reload(); await B.waitForFunction(() => window.G && G.S && G.S.nation && G.S.world);
const kept = await B.evaluate(() => ({ k: G.S.nation.hal?.k, ph: G.S.nation.hal?.ph, land: window.EDICTUM_PROBE.hal.land(G.S.nation) }));
check('the record keeps its phases and place after a reload', kept.k === 1 && kept.ph === 25 && kept.land === want('B') + 20, JSON.stringify(kept));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await finish();
