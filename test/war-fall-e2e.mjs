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
/* both capitals as A's page knows them (on a busy machine the region's records can arrive after the declarations) */
await until(async () => await capOf(A, ub) >= 0 && await capOf(A, uc) >= 0, 20000);
const cb = await capOf(A, ub), cc = await capOf(A, uc);
const sB = await siege(ub, cb), sC = await siege(uc, cc);
check('the referee lays both sieges', sB.ok && sC.ok && sB.doc.st === 'on' && sC.doc.c === cc, [sB, sC]);
check('A sees its siege, the final assault a day off', await until(() => A.evaluate(id => !!G.WR2().wrSiege(G.S.uid, id), ub), 15000));
check('B is told on its home page', await until(async () => /Siege Axetere has laid siege to/.test(plain(await B.evaluate(() => G.WR2().warNotice()))), 20000), plain(await B.evaluate(() => G.WR2().warNotice())));
check('and offered to surrender', /Surrender…/.test(await box(B, ua)), await box(B, ua));
/* war, round three: the sieges on the war layer of A's map, and both wars counted in A's record */
check('the war layer shows both sieges', await until(() => A.evaluate(ids => { const T = G.WR2().territory(), D = G.WR3().wr3MapData(T); return ids.every(id => D.sieges.some(s => s.c === T.list[T.byId[id]].cap)); }, [ub, uc]), 15000));
await A.evaluate(() => { const b = document.querySelector('[data-ed="recovery-saved"]'); if (b) b.click(); });
await A.evaluate(id => G.WR3().openMapAt(id), uc);await sleep(1200);
await A.evaluate(() => { const c = document.querySelector('canvas[data-map="main"]'); if (c) c.scrollIntoView({ block: 'center' }); });await sleep(600);
await A.locator('canvas[data-map="main"]').screenshot({ path: OUT + '/war-fall-siege-map.png' }).catch(() => A.screenshot({ path: OUT + '/war-fall-siege-map.png' }).catch(() => {}));
await A.evaluate(() => G.commit(G.clone(G.S.nation)));
check('A counts both wars while they last', await until(() => A.evaluate(([b, c]) => !!(G.S.nation.wst && G.S.nation.wst[b] && G.S.nation.wst[c]), [ub, uc]), 15000), await A.evaluate(() => G.S.nation.wst));
await B.screenshot({ path: OUT + '/war-fall-siege-notice.png' }).catch(() => {});
check('a final assault before the day is up is refused', (await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [uc, cc])).why === 'siege');

/* B surrenders */
await B.evaluate(id => { G.S.wrSurr = id; G.WR2().wrSurrender(id); }, ua);
const bRec = await B.evaluate(id => ({ surr: G.S.nation.surr && G.S.nation.surr[id], trib: G.S.nation.trib }), ua);
check('B surrenders: saved with 14 days of tribute', bRec.surr > 0 && bRec.trib && bRec.trib[0].u - bRec.trib[0].t === 14 * DAY, bRec);
check('for A the war with B is over, under a 14-day truce', await until(() => A.evaluate(id => { const w = G.WR2().warWith(id); return !w.war && w.surr === id && w.truceUntil > Date.now() + 13 * 864e5; }, ub), 20000));
check('and no final assault on B', (await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [ub, cb])).why === 'surr');
check('A’s war report on B: they surrendered, a victory', await until(async () => { await A.evaluate(() => G.commit(G.clone(G.S.nation))); return A.evaluate(id => (G.S.nation.wrp || []).some(r => r.id === id && r.how === 'surr-them' && r.res === 'won'), ub); }, 20000), await A.evaluate(() => G.S.nation.wrp));
check('and B’s: it surrendered, a defeat', await until(async () => { await B.evaluate(() => G.commit(G.clone(G.S.nation))); return B.evaluate(id => (G.S.nation.wrp || []).some(r => r.id === id && r.how === 'surr-me' && r.res === 'lost'), ua); }, 20000), await B.evaluate(() => G.S.nation.wrp));
check('A is paid tribute from B\'s spare materials', await until(() => A.evaluate(() => Object.values(G.WR2().wrTribute(G.S.nation)).some(v => v > 0)), 15000), await A.evaluate(() => G.WR2().wrTribute(G.S.nation)));

/* C holds out: a day later, the final assault */
const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/sieges/${sC.id}?updateMask.fieldPaths=t`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { t: { integerValue: String(Date.now() - 25 * H) } } }) });
check('(a day passes)', r.status === 200, r.status);
check('A\'s page knows the capital is open to the final assault', await until(() => A.evaluate(([id, c]) => { const s = G.WR2().wrSiege(G.S.uid, id); return !!s && Date.now() - s.t > 24 * 3600000; }, [uc, cc]), 15000));
/* battles fought in the war with C (as A's attacks count them), so its veterans come home to an edict */
await A.evaluate(id => { const n = G.clone(G.S.nation); n.wst = { ...n.wst, [id]: { ...n.wst[id], a: 5, w: 3 } }; G.commit(n); }, uc);
let won = null;
for (let i = 0; i < 6 && !(won && won.win); i++) won = await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95, cap: 1 })), [uc, cc]);
check('the final assault takes the capital, and C falls', won && won.win && won.fell, won);
await A.evaluate(([d, c, s, s2, t]) => { const n = G.clone(G.S.nation); n.conq = (n.conq || []).concat({ c, t, d, s, s2 }); n.log.unshift({ t: Date.now(), k: 'csack', a: d, b: 'Vesad', fx: '' }); G.commit(n); }, [uc, cc, won.s, won.s2, won.t]);
const falls = await restListAdmin('sieges');
check('the siege is marked fallen', falls.some(d => d.id === sC.id && d.fields.st.stringValue === 'fell'));
check('C leaves A\'s map, and its capital is A\'s', await until(() => A.evaluate(([id, c]) => { const T = G.WR2().territory(); return T.byId[id] === undefined && T.owner[c] === T.byId[G.S.uid] && T.spoil.get(c) === id; }, [uc, cc]), 20000));
check('the region remembers the fall', /Fallen nations Vesad fell to Axetere/.test(plain(await A.evaluate(() => G.WR2().wrFallenCard()))));
check('A’s war report on C: its capital fell, a victory', await until(async () => { await A.evaluate(() => G.commit(G.clone(G.S.nation))); return A.evaluate(id => (G.S.nation.wrp || []).some(r => r.id === id && r.how === 'fell-them' && r.res === 'won' && r.a === 5), uc); }, 20000), JSON.stringify(await A.evaluate(() => ({ me: G.S.uid, falls: G.WR2().wrFallsAt(null).map(f => ({ d: f.d, a: f.a, ft: f.ft })), wrp: G.S.nation.wrp, log: G.S.nation.log.slice(0, 8).map(l => l.k + ':' + l.t) }))));
const wars = plain(await A.evaluate(() => { const x = G.allNations().find(y => y.me); return G.WR3().wr3WarsSection(x, true); }));
check('the Wars section on A’s page lists both reports', /War reports/.test(wars) && /Conquest with Vesad Victory/.test(wars) && /Conquest with Bevton Victory/.test(wars) && /Their capital fell/.test(wars) && /They surrendered/.test(wars), wars);
await A.evaluate(() => { location.hash = '#nation'; });await A.waitForSelector('#wr3-wars', { timeout: 10000 }).catch(() => {});
await A.evaluate(() => { const el = document.getElementById('wr3-wars'); if (el) el.scrollIntoView({ block: 'start' }); });await sleep(400);
await A.locator('#wr3-wars').screenshot({ path: OUT + '/war-fall-wars.png' }).catch(() => {});
check('its veterans come home: the Coming Home edict lands on the desk', await until(() => A.evaluate(() => (G.syncInbox(G.S.nation, Date.now()).inbox || []).some(x => x.id === 'wr-home')), 20000), await A.evaluate(() => G.syncInbox(G.S.nation, Date.now()).inbox.map(x => x.id)));
/* the capital taken: one of fifteen edicts lands on A's desk; taking it over makes Vesad's capital a city of A that does
   not count against the cities A may found */
const cqd = await A.evaluate(() => { const d = G.syncInbox(G.S.nation, Date.now()).inbox.find(x => G.WR3().CQ_ISSUES.some(i => i.id === x.id)); return d ? d.id : null; });
check('a capital-taken edict lands on A’s desk', !!cqd, cqd);
if (cqd) {
  /* its card on the desk opens it (23 Nov 2026: it arrived at Date.now(), a new time on each draw of the desk, so the card
     asked for an edict no later draw had, and nothing opened); so does Coming Home's */
  const toDesk = () => A.evaluate(() => { G.S.openIssue = null; G.S.result = null; location.hash = '#edicts'; G.render(); });
  const openCard = async id => { await toDesk(); await until(() => A.$(`.issue-card[data-id="${id}"]`), 10000); await sleep(300); await A.click(`.issue-card[data-id="${id}"]`).catch(() => {}); return until(() => A.evaluate(id => G.S.openIssue === id, id), 10000); };
  check('Coming Home opens from its card', await openCard('wr-home'));
  const fcn = await A.evaluate(id => (G.WR2().wrFallsAt(null).find(f => f.d === id) || {}).cn || '', uc);
  check('the capital-taken edict opens from its card, naming the capital', await openCard(cqd) && await until(() => A.evaluate(cn => !!cn && (document.querySelector('.paper.edict')?.textContent || '').includes(cn) && !/the fallen capital/.test(document.querySelector('.paper.edict')?.textContent || ''), fcn), 5000), fcn);
  check('and the desk keeps it, read', await until(() => A.evaluate(id => G.S.nation.inbox.some(x => x.id === id && x.read === 1), cqd), 5000));
  await toDesk();
  const oi = await A.evaluate(id => G.WR3().CQ_ISSUES.find(i => i.id === id).o.findIndex(o => o.e.cqc), cqd);
  const before = await A.evaluate(() => ({ all: G.S.nation.cities.length, founded: G.WR3().cityFounded(G.S.nation) }));
  await A.evaluate(([id, o]) => G.answer(id, o), [cqd, oi]);
  check('taken over, the capital is a city of A, marked captured', await until(() => A.evaluate(c => (G.S.nation.cities || []).some(x => x.c === c && x.cq === 'Vesad'), cc), 10000), JSON.stringify(await A.evaluate(() => G.S.nation.cities)));
  check('and it does not count against the cities A may found', await A.evaluate(b => G.WR3().cityFounded(G.S.nation) === b.founded && G.S.nation.cities.length === b.all + 1, before));
  check('the capital’s fate is decided once', await A.evaluate(() => (G.S.nation.cqd || []).length === 1 && !G.syncInbox(G.S.nation, Date.now()).inbox.some(x => /^cq-/.test(x.id))));
  check('saved so', await until(async () => { const d = await nationDoc(ua); return (d?.rec?.cities || []).some(x => x.c === cc && x.cq === 'Vesad'); }, 15000));
  await A.evaluate(() => { location.hash = '#cities'; });await sleep(1500);
  check('the Cities page marks it Captured', /Captured/.test(await A.evaluate(() => document.querySelector('.cx-list, .cx-items, main')?.textContent || '')));
  await A.screenshot({ path: OUT + '/war-fall-captured-city.png' }).catch(() => {});
}
check('the war layer shows the ruins', await A.evaluate(c => G.WR3().wr3MapData(G.WR2().territory()).ruins.some(r => r.c === c), cc));
check('the sack is A\'s achievement', await until(() => A.evaluate(() => !!(G.S.nation.ach || {})['war-sack']), 15000));
check('the fall is logged as a capital taken, not a minister sacked (the Dispatch read "Axetere sacks its <id>")', await A.evaluate(() => G.S.nation.log.some(l => l.k === 'csack') && !G.S.nation.log.some(l => l.k === 'sack')));

/* monuments to fallen nations: the referee kept what Vesad was with its fall; a monument stands where its capital fell,
   and a click on it tells of the nation, also to a player who does not hold the hex. The First Flame is drawn here for
   Vesad by naming it the first nation for a moment (the real one is Moradara's) */
const sm = (await restListAdmin('sieges')).find(d => d.id === sC.id), mf = sm && sm.fields.m && sm.fields.m.mapValue.fields;
check('the referee kept what Vesad was with its fall', !!mf && typeof mf.pre.stringValue === 'string' && Number(mf.ct.integerValue) >= 1 && !!mf.fl.mapValue, JSON.stringify(mf || null).slice(0, 300));
const showCell = async (p, c, z = 5) => {
  await p.evaluate(() => { G.S.openIssue = null; G.S.result = null; location.hash = '#map'; });
  await until(() => p.evaluate(() => G.S.view === 'map'), 8000);
  await p.evaluate(([c, z]) => { G.MD.centerMain(c, z); G.render(); }, [c, z]);
  const cv = p.locator('canvas[data-map="main"]'); await cv.scrollIntoViewIfNeeded();
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pos = await p.evaluate(c => { const cv = document.querySelector('canvas[data-map="main"]'), v = G.MD.viewOf('main', cv), s = G.MD.mapScale(cv, v); return { x: cv.clientWidth / 2 + (G.MAP.cx[c] - v.cx) * s, y: cv.clientHeight / 2 + (G.MAP.cy[c] - v.cy) * s }; }, c);
  return { cv, pos };
};
const monText = p => p.evaluate(() => (document.querySelector('#map-panel .mon-card') || {}).textContent || '').then(plain);
check('a monument stands on Vesad’s old capital', await until(() => A.evaluate(c => G.WR3().monSites().some(s => s.c === c), cc), 15000));
{ const { cv, pos } = await showCell(A, cc, 14); await cv.click({ position: pos }); await sleep(500);
  const t = await monText(A);
  check('A clicks it: the card tells of the nation that fell', /A monument to a fallen nation/.test(t) && /Here stood .*capital of Vesad/.test(t) && /Fell\s*\d.*to Axetere/.test(t) && /Cities\s*\d/.test(t), t);
  await cv.screenshot({ path: OUT + '/monument-map.png' }).catch(() => {});await A.locator('#map-panel').screenshot({ path: OUT + '/monument-card.png' }).catch(() => {}); }
{ const { cv, pos } = await showCell(B, cc); await cv.click({ position: pos }); await sleep(500);
  check('B, who does not hold the hex, clicks it and reads the same card', /Here stood .*capital of Vesad/.test(await monText(B)), await monText(B)); }
{ const real = await A.evaluate(id => { const M = G.WR3().MON_FIRST, was = M.id; M.id = id; return was; }, uc);
  const { cv, pos } = await showCell(A, cc, 14); await cv.click({ position: pos }); await sleep(500);
  const t = await monText(A);
  check('the First Flame: its own card for the first nation', /The First Flame · the monument to the first nation/.test(t) && /Before there were borders, treaties or wars, there was Vesad/.test(t) && await A.evaluate(() => !!document.querySelector('#map-panel .mon-card.mon-first')), t);
  await cv.screenshot({ path: OUT + '/first-flame-map.png' }).catch(() => {});await A.locator('#map-panel').screenshot({ path: OUT + '/first-flame-card.png' }).catch(() => {});
  await A.evaluate(id => { G.WR3().MON_FIRST.id = id; G.render(); }, real); }

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
