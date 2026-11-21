// War, round two between three players (emulators): A goes to war with B and C for conquest; the wars cost A
// materials, wear it down and cost it people; A fortifies a hex; A lays siege to both capitals (the referee keeps the
// sieges), B is told and surrenders (the war ends, a 14-day truce, tribute), C holds out and falls in the final assault a
// day later: C leaves the map, its player sees the fallen screen and rises again in the same region, with what it
// earned, 3 land credits and a week in which nobody may attack it; the region remembers the fall.
// The sieges are laid through the referee from A's page, as wrSiegeStart does once a capital stands alone, and a day
// is skipped by moving the siege's start back (the Firestore emulator takes "Bearer owner" past the rules).
import { check, finish, until, player, open, found, register, nationDoc, errors, clearEmulators, restListAdmin, OUT, sleep, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const H = 3600000, DAY = 864e5, vp = { width: 1366, height: 900 };
const A = await player('wr-a', { vp }), B = await player('wr-b', { vp }), C = await player('wr-c', { vp });
const ua = await open(A); await found(A, 'Axetere');
const ub = await open(B); await found(B, 'Bevton');
const uc = await open(C); await found(C, 'Vesad');
await register(A, { old: true });
const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const box = (p, id) => p.evaluate(id => { const x = G.allNations().find(y => y.id === id); return x ? G.WR2().warControls(x) : ''; }, id).then(plain);

/* C earns something to keep: its record's achievements and Customise choices before the war */
const before = await C.evaluate(() => ({ ach: Object.keys(G.S.nation.ach || {}).sort(), flag: JSON.stringify(G.S.nation.flag), cap: G.S.nation.capital }));

/* A declares wars of conquest on B and C (saved as the game saves a declaration) */
await A.evaluate(([b, c]) => { const n = G.clone(G.S.nation), t = Date.now(); n.wars = { ...(n.wars || {}), [b]: { t, g: 'c' }, [c]: { t, g: 'c' } }; G.commit(n); }, [ub, uc]);
check('the wars are saved with their aim', await until(async () => { const d = await nationDoc(ua); return d?.rec?.wars?.[ub]?.g === 'c' && d.rec.wars[uc]?.g === 'c'; }, 15000));
check('B sees the war and its aim', await until(async () => /Their aim: Conquest/.test(await box(B, ua)), 20000), await box(B, ua));
check('A fights two wars', await A.evaluate(() => G.WR2().wrWarsOf(G.S.uid).length) === 2);

/* what two wars cost: materials (2.8 times one war), weariness, people */
const army = () => A.evaluate(() => { const W = G.WR2(), T = W.territory(); return W.armyBlock(T, T.byId[G.S.uid]); }).then(plain);
check('the army block shows weariness, the wars\' upkeep and what two wars cost', await until(async () => { const t = await army(); return /War weariness/.test(t) && /War upkeep .*(food|iron).* a day/.test(t) && /Fighting 2 wars at once costs 2\.8 times/.test(t); }, 15000), await army());
await A.evaluate(() => { const n = G.clone(G.S.nation); n.wwyAt = Date.now() - 2 * 864e5; G.commit(n); });
const rec1 = await A.evaluate(() => ({ wwy: G.S.nation.wwy, pwl: G.S.nation.pwl, pr: G.S.nation.pr }));
check('two days at war, two wars of conquest: weariness climbs (4 a day × 3^1.3)', rec1.wwy > 30 && rec1.wwy < 40, rec1);
check('and the nation loses people: a share a day (pwl)', rec1.pwl >= 0.008, rec1);
check('both kept in the saved record', await until(async () => { const d = await nationDoc(ua); return d?.rec?.wwy > 30 && d.rec.pwl >= 0.008; }, 15000));

/* active defence: A fortifies one of its own hexes with a point of readiness */
const fort = await A.evaluate(() => { const W = G.WR2(), T = W.territory(), mi = T.byId[G.S.uid]; let c = -1; for (let i = 0; i < T.owner.length; i++) if (T.owner[i] === mi && i !== T.list[mi].cap) { c = i; break; } const r0 = G.S.nation.ready; W.wrFortify(c); return { c, r0, r1: G.S.nation.ready, f: G.S.nation.fort }; });
check('A fortifies a hex for 12 hours, spending readiness', fort.f && fort.f[fort.c] > Date.now() + 11 * H, fort);

/* the sieges: laid through the referee */
const capOf = (p, id) => p.evaluate(id => { const T = G.WR2().territory(), i = T.byId[id]; return i === undefined ? -1 : T.list[i].cap; }, id);
const siege = (d, c) => A.evaluate(async ([d, c]) => { const api = await window.claude.use('referee'); return api.siege({ d, c }); }, [d, c]);
const cb = await capOf(A, ub), cc = await capOf(A, uc);
const sB = await siege(ub, cb), sC = await siege(uc, cc);
check('the referee lays both sieges', sB.ok && sC.ok && sB.doc.st === 'on' && sC.doc.c === cc, [sB, sC]);
check('A sees its siege, the final assault a day off', await until(() => A.evaluate(id => !!G.WR2().wrSiege(G.S.uid, id), ub), 15000));
check('B is told on its home page', await until(async () => /Siege Axetere has laid siege to/.test(plain(await B.evaluate(() => G.WR2().warNotice()))), 20000), plain(await B.evaluate(() => G.WR2().warNotice())));
check('and offered to surrender', /Surrender…/.test(await box(B, ua)), await box(B, ua));
await B.screenshot({ path: OUT + '/war-fall-siege-notice.png' }).catch(() => {});
check('a final assault before the day is up is refused', (await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [uc, cc])).why === 'siege');

/* B surrenders */
await B.evaluate(id => { G.S.wrSurr = id; G.WR2().wrSurrender(id); }, ua);
const bRec = await B.evaluate(id => ({ surr: G.S.nation.surr && G.S.nation.surr[id], trib: G.S.nation.trib }), ua);
check('B surrenders: saved with 14 days of tribute', bRec.surr > 0 && bRec.trib && bRec.trib[0].u - bRec.trib[0].t === 14 * DAY, bRec);
check('for A the war with B is over, under a 14-day truce', await until(() => A.evaluate(id => { const w = G.WR2().warWith(id); return !w.war && w.surr === id && w.truceUntil > Date.now() + 13 * 864e5; }, ub), 20000));
check('and no final assault on B', (await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [ub, cb])).why === 'surr');
check('A is paid tribute from B\'s spare materials', await until(() => A.evaluate(() => Object.values(G.WR2().wrTribute(G.S.nation)).some(v => v > 0)), 15000), await A.evaluate(() => G.WR2().wrTribute(G.S.nation)));

/* C holds out: a day later, the final assault */
const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/sieges/${sC.id}?updateMask.fieldPaths=t`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { t: { integerValue: String(Date.now() - 25 * H) } } }) });
check('(a day passes)', r.status === 200, r.status);
check('A\'s page knows the capital is open to the final assault', await until(() => A.evaluate(([id, c]) => { const s = G.WR2().wrSiege(G.S.uid, id); return !!s && Date.now() - s.t > 24 * 3600000; }, [uc, cc]), 15000));
let won = null;
for (let i = 0; i < 6 && !(won && won.win); i++) won = await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [uc, cc]);
check('the final assault takes the capital, and C falls', won && won.win && won.fell, won);
await A.evaluate(([d, c, s, s2, t]) => { const n = G.clone(G.S.nation); n.conq = (n.conq || []).concat({ c, t, d, s, s2 }); n.log.unshift({ t: Date.now(), k: 'sack', a: d, b: 'Vesad', fx: '' }); G.commit(n); }, [uc, cc, won.s, won.s2, won.t]);
const falls = await restListAdmin('sieges');
check('the siege is marked fallen', falls.some(d => d.id === sC.id && d.fields.st.stringValue === 'fell'));
check('C leaves A\'s map, and its capital is A\'s', await until(() => A.evaluate(([id, c]) => { const T = G.WR2().territory(); return T.byId[id] === undefined && T.owner[c] === T.byId[G.S.uid] && T.spoil.get(c) === id; }, [uc, cc]), 20000));
check('the region remembers the fall', /Fallen nations Vesad fell to Axetere/.test(plain(await A.evaluate(() => G.WR2().wrFallenCard()))));
check('the sack is A\'s achievement', await until(() => A.evaluate(() => !!(G.S.nation.ach || {})['war-sack']), 15000));

/* C's player sees the fall, and rises again */
check('C sees the fallen screen', await until(async () => /Vesad has fallen/.test(plain(await C.evaluate(() => G.WR2().nationView()))), 20000));
await C.evaluate(() => G.render());
await C.waitForSelector('.wr-fall', { timeout: 10000 });
await C.screenshot({ path: OUT + '/war-fall-fallen.png', fullPage: true }).catch(() => {});
check('with both ways to begin again', !!(await C.$('[data-act="wr-rise"][data-m="same"]')) && !!(await C.$('[data-act="wr-rise"][data-m="anew"]')));
await C.click('[data-act="wr-rise"][data-m="same"]');
await C.waitForSelector('#found-btn', { timeout: 15000 });
check('the founding page says it rises again', /Vesad rises again in/.test(plain(await C.$eval('.wr-rs', e => e.textContent).catch(() => ''))));
check('the draft keeps its name', await C.$eval('#d-name', e => e.value) === 'Vesad');
/* the old record is cleared away first (dissolve): founding waits for that, and says so */
let foundErr = '';
for (let i = 0; i < 8 && !(await C.$('.layout')); i++) {
  await C.click('#found-btn').catch(() => {});
  await C.waitForSelector('.layout', { timeout: 4000 }).catch(() => {});
  foundErr = await C.evaluate(() => G.S.foundErr || '').catch(() => '');
}
check('the nation is founded again', !!(await C.$('.layout')), foundErr);
const risen = await until(async () => { const n = await C.evaluate(() => G.S.nation); return n && n.fel ? n : null; }, 15000);
check('the new nation remembers its fall', risen && risen.fel.nm === 'Vesad' && risen.fel.bn === 'Axetere', risen && risen.fel);
check('with 3 bonus land credits and a week of peace', risen && risen.lcb >= 3 && risen.shd > Date.now() + 6 * DAY, risen && { lcb: risen.lcb, shd: risen.shd });
check('and what it earned', risen && before.ach.every(k => k in (risen.ach || {})) && JSON.stringify(risen.flag) === before.flag, { before: before.ach, after: Object.keys((risen && risen.ach) || {}) });
check('Ashes and Embers', await until(() => C.evaluate(() => !!(G.S.nation.ach || {})['war-fallen']), 15000));
check('saved so', await until(async () => { const d = await nationDoc(uc); return d?.rec?.fel?.nm === 'Vesad' && d.rec.shd > Date.now(); }, 15000));
check('A may not declare war on it this week', await until(async () => /has risen again from its fall/.test(await box(A, uc)), 20000), await box(A, uc));
await A.screenshot({ path: OUT + '/war-fall-a.png' }).catch(() => {});
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
