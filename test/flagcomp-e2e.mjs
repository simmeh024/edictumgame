// The flag competition in the browser, against the emulators: four nations enter a design made in the flag designer,
// score each other's flags blind, and open the results; the podium's goods, the winner's Club month and rosette, the
// Hall of Flags, the menu badge and the bell. The competition's clock is moved by flagcTest/clock (emulators only).
//   npm run test:flagcomp-e2e
import { player, open, ready, found, register, until, check, finish, text, nav, clearEmulators, sleep, restListAdmin, setClaims, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const doc = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
const clockTo = t => fetch(doc('flagcTest/clock'), { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { skew: { integerValue: String(t - Date.now()) } } }) });
const admin = async path => { const r = await fetch(doc(path), { headers: { authorization: 'Bearer owner' } }); return r.status === 200 ? (await r.json()).fields || {} : null; };
const M = '2031-03', CATS = ['simple', 'colour', 'comp', 'orig', 'fly'];
const page = async p => { await nav(p, 'flagcomp'); await p.waitForSelector('.flc-steps', { timeout: 15000 }); };
const fresh = async p => { await p.reload(); await ready(p); await p.waitForSelector('.layout'); await page(p); };
const flc = p => p.evaluate(() => { const F = G.FLC().FLC; return { st: F.st, deal: F.deal, draft: F.draft, tab: F.tab }; });
const stock = p => p.evaluate(() => G.WH.stockNow(G.S.nation));
// FC_SHOTS=<folder> keeps a picture of each phase
const shot = async (p, name) => { if (process.env.FC_SHOTS) { await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.scrollTo(0, 0); }); await p.screenshot({ path: `${process.env.FC_SHOTS}/${name}.png`, fullPage: true }).catch(() => {}); } };

await clockTo(Date.UTC(2031, 2, 5, 12));   // before the 12th: nothing is open yet
const A = await player('a'), B = await player('b'), C = await player('c'), D = await player('d'), Gp = await player('guest');
const names = ['Aland', 'Bland', 'Cland', 'Dland'], ps = [A, B, C, D], uids = [];
for (const [i, p] of ps.entries()) { uids.push(await open(p)); await found(p, names[i]); }
await open(Gp); await found(Gp, 'Guestland');
for (const p of ps) await register(p, { old: true });

/* ── entries ── */
check('the Flag Competition sits under Abroad, after the Games', /Games\s*Flag Competition/.test(await text(A, '.side .nav-grp[data-g="abroad"]')), await text(A, '.side .nav-grp[data-g="abroad"]'));
await page(A);
check('before the 12th the page says when the next competition opens', /The next competition opens on 12 March/.test(await text(A, '.flc-wait')) && /12 March to 19 March/.test(await text(A, '.flc-steps')) && await A.locator('#flc-enter').count() === 0, await text(A, '.flc-steps'));
await shot(A, 'fc-0-waiting');
await clockTo(Date.UTC(2031, 2, 14, 12));
await fresh(A);
check('the page opens on this month’s entries', /Enter a flag for March 2031/.test(await text(A, '.flc-box')) && /Entries/.test(await text(A, '.flc-steps li.on')), await text(A, '.flc-steps'));
check('no flag is in yet', /No flag is in yet/.test(await text(A, '.flc-box')));
check('the entry has the flag designer, on a draft of its own', await A.locator('#fc-prev svg').count() === 1 && await A.locator('[id^="fc-p-"]').count() > 5);
const national = await A.evaluate(() => JSON.stringify(G.S.nation.flag));
const pick = async (p, i) => { const ids = await p.$$eval('[id^="fc-p-"]:not([data-ux-unlock])', l => l.filter(b => b.tagName === 'BUTTON' && b.getAttribute('aria-pressed') !== 'true').map(b => b.id)); await p.click('#' + ids[i % ids.length]); await sleep(150); return ids[i % ids.length].slice(5); };
const pA = await pick(A, 1);
check('choosing a pattern changes the draft and its preview, not the national flag', (await flc(A)).draft.p === pA && await A.evaluate(() => JSON.stringify(G.S.nation.flag)) === national, pA);
/* the draft follows the player: the server keeps it a few seconds after a change, and at once when the page is left */
await nav(A, 'nation'); await page(A);
check('the design in progress is kept on the server too', await until(async () => { const d = await admin('fcDraft/' + uids[0]); return !!d && JSON.parse(d.fl.stringValue).p === pA; }, 15000), JSON.stringify(await admin('fcDraft/' + uids[0])));
await A.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('edictum.flc.draft.')) localStorage.removeItem(k); });
await fresh(A);
check('so another device, with nothing kept, opens the same design', await until(async () => ((await flc(A)).draft || {}).p === pA), JSON.stringify((await flc(A)).draft));
// the national flag itself is refused: the judges must not know whose it is
await A.evaluate(() => { const F = G.FLC().FLC; F.draft = G.FD.flagNorm(G.clone(G.S.nation.flag), G.S.nation); G.render(); });
await A.click('#flc-enter');
check('the national flag cannot be entered', await until(async () => /That is your national flag/.test(await text(A, '.toast,[class*="toast"]'))) && !(await flc(A)).st.mine);
await pick(A, 2); await A.click('#flc-enter');
check('entering a design files it with the server', await until(async () => !!(await flc(A)).st.mine && (await restListAdmin(`flagc/${M}/flags`)).length === 1));
await shot(A, 'fc-1-enter');
check('the page shows the entry and counts it', /Your flag is entered/.test(await text(A, '.flc-mine')) && /only flag in so far/.test(await text(A, '.flc-mine')));
for (const [i, p] of [B, C, D].entries()) { await page(p); await pick(p, 3 + i * 2); await p.click('#flc-enter'); await until(async () => !!(await flc(p)).st.mine); }
await pick(A, 9); await A.click('#flc-enter'); await sleep(900);
const entries = await restListAdmin(`flagc/${M}/flags`), owner = new Map(entries.map(e => [e.id, e.fields.u.stringValue]));
check('four nations, four flags: replacing an entry adds none', entries.length === 4 && new Set(owner.values()).size === 4, entries.length);
check('each entry is a design of its own, not the nation’s flag', entries.every(e => { const f = JSON.parse(e.fields.fl.stringValue); return f && f.p && e.fields.fl.stringValue !== national; }));
await page(Gp);
check('a guest is told to link a sign-in', /Only Registered Nations enter and score flags/.test(await text(Gp, '.flc-box')));
await Gp.click('#flc-enter'); await sleep(1500);
const refused = await Gp.evaluate(async () => { try { await (await window.claude.use('civic')).request({ op: 'fcEnter', fl: { p: 'tri-h', c: ['#FFFFFF', '#C8102E', '#152450'], e: 'none', ec: '#C8102E' } }); return 'entered'; } catch (e) { return e.code; } });
check('and the server refuses a guest’s entry', refused === 'registration_required' && !(await flc(Gp)).st.mine && (await restListAdmin(`flagc/${M}/flags`)).length === 4, refused);
check('entering earns its achievement tally', await A.evaluate(() => (G.S.nation.tly || {}).fcin === 1));
check('the first flag in, a second go at the design and the month itself are on the record', await A.evaluate(m => { const n = G.S.nation, t = n.tly || {}; return t.fcfirst === 1 && t.fcre === 1 && JSON.stringify(n.fce) === JSON.stringify([m]) && ['fc-enter', 'fc-first', 'fc-redo'].every(id => (n.ach || {})[id]); }, M)
  && await B.evaluate(() => { const n = G.S.nation, t = n.tly || {}; return t.fcin === 1 && !t.fcfirst && !t.fcre && !(n.ach || {})['fc-first']; }), JSON.stringify(await A.evaluate(() => [G.S.nation.tly, G.S.nation.fce, Object.keys(G.S.nation.ach || {}).filter(k => /^fc-/.test(k))])));

/* ── judging ── */
await clockTo(Date.UTC(2031, 2, 19, 12));   // the first day of judging
await fresh(A);
check('judging opens on the same page', /Score the flags/.test(await text(A, '.flc-box')) && /Judging/.test(await text(A, '.flc-steps li.on')));
await A.waitForSelector('.flc-judge', { timeout: 15000 });
check('a flag is shown without a name, with five categories of five stars', await A.locator('.flc-big .flag-frame svg').count() === 1 && await A.locator('.flc-cat').count() === 5 && await A.locator('.flc-st').count() === 25 && !/land/i.test(await text(A, '.flc-judge')));
check('the score cannot be sent until every category has stars', await A.locator('#flc-rate').isDisabled());
check('the flag is shown three ways: up close, small as on the map, and flying from a pole', await A.locator('.flc-views .mflag svg').count() === 2 && await A.locator('.flc-pole .flc-wv svg').count() === 18);
await A.click('#flc-st-simple-4'); await A.click('#flc-st-colour-3');
await shot(A, 'fc-2-judge');
check('still not with two of five', await A.locator('#flc-rate').isDisabled() && await A.locator('.flc-st.on').count() === 7);
await fresh(B);
check('a nation with flags to score has a mark on the menu', await until(async () => /\S/.test(await text(B, '.nav [data-v="flagcomp"] .badge'))), await text(B, '.nav [data-v="flagcomp"]'));
const bell = p => p.evaluate(() => { document.querySelector('.bell').click(); const t = document.querySelector('.notif-pop')?.textContent || ''; document.querySelector('.bell').click(); return t; });
check('an entrant with flags still to score is told so in the bell', await until(async () => /Judging is open: score 3 flags of the others to keep your entry in the running/.test(await bell(B))), await bell(B));
/* each judge scores every other flag: Bland's 5 stars, Cland's 4, Dland's 3, Aland's 2 */
const worth = new Map([[uids[1], 5], [uids[2], 4], [uids[3], 3], [uids[0], 2]]);
async function judge(p, me, max = 6) {
  for (let k = 0; k < max; k++) {
    if (!(await until(async () => await p.locator('.flc-judge').count() === 1 || /scored every flag/.test(await text(p, '.flc-box')), 15000))) break;
    if (await p.locator('.flc-judge').count() === 0) break;
    const cur = (await flc(p)).deal[0];
    if (owner.get(cur.id) === me) return 'own';
    const v = worth.get(owner.get(cur.id));
    for (const c of CATS) await p.click(`#flc-st-${c}-${v}`);
    await p.click('#flc-rate');
    await until(async () => { const d = (await flc(p)).deal; return !d || !d.length || d[0].id !== cur.id; }, 15000);
  }
  return 'ok';
}
/* judging pays in land: a credit for every five flags scored, ten at most, and the scoring goes on after that. Aland
   comes with four flags scored in earlier months, Bland with forty-eight and nine credits */
/* (a commit alone does not redraw the page: the test draws it, as the game does after a score is sent) */
const seed = (p, k, l) => p.evaluate(([k, l]) => { const m = G.clone(G.S.nation); m.tly = Object.assign({}, m.tly, { fcj: k }); if (l) m.fcl = l; G.commit(m); G.render(); }, [k, l]);
const land = async p => JSON.stringify(await p.evaluate(() => { const n = G.S.nation, bare = G.clone(n); delete bare.fcl; return [n.fcl || 0, G.RK.landEarned(n) - G.RK.landEarned(bare), (n.tly || {}).fcj || 0]; }));
const toasted = (p, re) => until(async () => re.test(await text(p, '#toast')), 30000);
await seed(A, 4, 0); await seed(B, 48, 9);
check('the judging page says what scoring earns', await until(async () => /Every 5 flags you score earn a land credit, 10 at most: 0 earned so far, the next after 1 more flag\./.test(await text(A, '.flc-land'))), await text(A, '.flc-land'));
/* while judging is open the daily desk has one more task (the desk is off in these tests until a test turns it on) */
await A.evaluate(() => { window.EDICTUM_NO_DESK = false; G.commit(G.clone(G.S.nation)); });
await nav(A, 'issues');
check('while judging is open the daily desk asks for three flags scored', await until(async () => /Score 3 flags in the flag competition/.test(await text(A, '.dd-fc')) && /0 of 3/.test(await text(A, '.dd-fc'))), await text(A, '.dd'));
check('apart from the day’s three tasks', await A.locator('.dd .dd-t:not(.dd-rare):not(.dd-fc)').count() === 3);
await page(A); await A.waitForSelector('.flc-judge', { timeout: 15000 });
/* a skipped flag goes to the back of the queue, on the server, and comes again once the others are scored */
const skippedId = (await flc(A)).deal[0].id;
await A.click('[data-act="flc-skip"]');
check('skipping shows the next flag, and the server keeps the skip', await until(async () => { const d = (await flc(A)).deal; return !!d && d.length > 0 && d[0].id !== skippedId; })
  && await until(async () => { const v = await admin(`flagc/${M}/votes/${uids[0]}`); return !!(v && v.k && v.k.mapValue.fields && v.k.mapValue.fields[skippedId]); }), JSON.stringify(await admin(`flagc/${M}/votes/${uids[0]}`)));
const ran = [await judge(A, uids[0], 1)];
check('the fifth flag scored earns a land credit, and says so', await toasted(A, /5 more flags scored: a land credit for your trouble \(1 of 10\)/) && await land(A) === '[1,1,5]', await land(A) + ' ' + await text(A, '#toast'));
ran.push(await judge(A, uids[0]));
check('the skipped flag came back last, and was scored', await until(async () => { const v = await admin(`flagc/${M}/votes/${uids[0]}`); return !!v.v.mapValue.fields[skippedId] && !(v.k && v.k.mapValue.fields && v.k.mapValue.fields[skippedId]); }), JSON.stringify(await admin(`flagc/${M}/votes/${uids[0]}`)));
check('three flags scored complete the desk’s judging task', await until(async () => A.evaluate(() => { const f = G.S.nation.dd && G.S.nation.dd.f; return !!f && f.p === 1 && f.c === 3; })), JSON.stringify(await A.evaluate(() => G.S.nation.dd)));
await A.evaluate(() => { window.EDICTUM_NO_DESK = true; });
/* a judge may report a flag to the staff */
await B.waitForSelector('.flc-judge', { timeout: 15000 });
const repId = (await flc(B)).deal[0].id;
await B.click('[data-act="flc-rep-open"]');
check('the report asks why', await B.locator('#flc-rep-send').isDisabled() && await B.locator('input[name="flc-rep"]').count() === 3);
await B.check('input[name="flc-rep"][value="copy"]');
await B.fill('#flc-rep-note', 'It is the flag of a neighbour');
await B.click('#flc-rep-send');
check('reporting a flag sends it to the staff, with the reason', await until(async () => /You reported this flag/.test(await text(B, '.flc-judge')))
  && await until(async () => { const r = await restListAdmin(`flagc/${M}/reps`); return r.length === 1 && r[0].fields.why.stringValue === 'copy' && r[0].fields.e.stringValue === repId && /neighbour/.test(r[0].fields.note.stringValue); }), JSON.stringify(await restListAdmin(`flagc/${M}/reps`)));
ran.push(await judge(B, uids[1], 1));
check('the forty-ninth flag earns none', await land(B) === '[9,9,49]', await land(B));
ran.push(await judge(B, uids[1], 1));
check('the fiftieth earns the tenth and last credit', await toasted(B, /50 flags scored: the last of the 10 land credits for judging is yours/) && await land(B) === '[10,10,50]', await land(B) + ' ' + await text(B, '#toast'));
ran.push(await judge(B, uids[1]));
check('after that the scoring goes on, for no more land', await land(B) === '[10,10,51]' && Object.keys((await admin(`flagc/${M}/votes/${uids[1]}`)).v.mapValue.fields).length === 3 && await until(async () => /You have earned all 10 land credits for judging/.test(await text(B, '.flc-land'))), await land(B) + ' ' + await text(B, '.flc-land'));
check('fifty flags scored is an achievement', await until(async () => B.evaluate(() => !!(G.S.nation.ach || {})['fc-judge50'] && !(G.S.nation.ach || {})['fc-judge100'])));
for (const i of [2, 3]) { await fresh(ps[i]); ran.push(await judge(ps[i], uids[i])); }
check('nobody is dealt their own flag', ran.every(r => r === 'ok'), ran.join());
check('when all are scored the page says so', await until(async () => /You have scored every flag/.test(await text(A, '.flc-box'))));
const votesA = await admin(`flagc/${M}/votes/${uids[0]}`), mineA = [...owner].find(([e, u]) => u === uids[0])[0];
check('a judge’s ratings are kept by the server: three flags, never their own', !!votesA && Object.keys(votesA.v.mapValue.fields).length === 3 && !votesA.v.mapValue.fields[mineA]);
check('scoring counts toward its achievements: the flags, the first day, a full share', await A.evaluate(m => { const n = G.S.nation, t = n.tly || {}; return t.fcj === 7 && t.fcearly === 3 && t.fcduty === 1 && n.fcd === m && !t.fcall && !!(n.ach || {})['fc-early']; }, M), JSON.stringify(await A.evaluate(() => [G.S.nation.tly, G.S.nation.fcd])));
check('the competition has a category of its own among the achievements', await A.evaluate(() => G.RK.ACH.filter(a => a.c === 'flag').length === 17 && !G.RK.ACH.some(a => /^fc-/.test(a.id) && a.c !== 'flag')));
check('with its share done, the mark leaves the menu', await until(async () => !/\S/.test(await text(B, '.nav [data-v="flagcomp"] .badge'))));
check('and the bell lets it go', !/Judging is open/.test(await bell(B)));
/* a score can be changed until judging closes, with the keyboard too; a changed score counts for nothing new */
const eD = [...owner].find(([e, u]) => u === uids[3])[0], votesOf = async () => (await admin(`flagc/${M}/votes/${uids[0]}`)).v.mapValue.fields;
await A.click('[data-act="flc-mine"]');
check('the flags scored are listed, to change a score', await until(async () => await A.locator('.flc-mine-l li').count() === 3), await text(A, '.flc-mylist'));
await A.click(`[data-act="flc-edit"][data-e="${eD}"]`);
check('changing one opens it with its stars', await until(async () => await A.locator('.flc-editing').count() === 1) && await A.locator('.flc-st.on').count() === 15 && /Changing your score/.test(await text(A, '.flc-big')));
for (let i = 0; i < 5; i++) await A.keyboard.press('2');
check('the number keys give each category its stars in turn', await A.locator('.flc-st.on').count() === 10 && await A.evaluate(() => document.activeElement && document.activeElement.id === 'flc-rate'));
await A.keyboard.press('Enter');
check('and Enter saves: the server holds the new score', await until(async () => (await votesOf())[eD].stringValue === '22222') && await until(async () => /Your score is changed/.test(await text(A, '#toast'))), JSON.stringify(await votesOf()));
await A.click('[data-act="flc-mine"]');
await until(async () => await A.locator(`[data-act="flc-edit"][data-e="${eD}"]`).count() === 1);
await A.click(`[data-act="flc-edit"][data-e="${eD}"]`);
await until(async () => await A.locator('.flc-editing').count() === 1);
for (const c of CATS) await A.click(`#flc-st-${c}-3`);
await A.click('#flc-rate');
check('changed back with the mouse', await until(async () => (await votesOf())[eD].stringValue === '33333'));
check('a changed score adds nothing: the same three ratings, the same tally', Object.keys(await votesOf()).length === 3 && (await admin(`flagc/${M}/flags/${eD}`)).n.integerValue === '3' && await A.evaluate(() => G.S.nation.tly.fcj === 7));
/* the staff's page */
await setClaims(uids[3], { admin: true }); await D.reload(); await ready(D); await D.waitForSelector('.layout');
await D.click('.side-who .adm-pill'); await D.click('.adm-nav [data-v="admin-flagc"]');
check('the staff page lists every entry with its nation and score', await until(async () => await D.locator('.fca-tbl').first().locator('tbody tr').count() === 4, 20000) && /Aland/.test(await text(D, '.adm-main')) && /Judging/.test(await text(D, '.adm-kpis')), (await text(D, '.adm-main')).slice(0, 300));
check('with the report, its reason and its note', /A copy of another nation’s flag/.test(await text(D, '.fca-reps')) && /It is the flag of a neighbour/.test(await text(D, '.fca-reps')) && /Bland/.test(await text(D, '.fca-reps')), await text(D, '.fca-reps'));
check('and every judge', await D.locator('.fca-tbl').nth(1).locator('tbody tr').count() === 4);
await D.click(`[data-act="fca-dismiss"][data-e="${repId}"]`);
check('dismissing the report clears it', await until(async () => await D.locator('.fca-reps').count() === 0 && (await restListAdmin(`flagc/${M}/reps`)).length === 0), await text(D, '.adm-main'));
await shot(D, 'fc-2b-staff');
await setClaims(uids[3], {}); await D.reload(); await ready(D);
check('nothing is published while judging runs', (await admin('flagc/' + M)).st.stringValue === 'open');

/* ── results ── */
await clockTo(Date.UTC(2031, 2, 25));
/* a place also earns achievements, and each achievement rank gained is a gift of 15 goods of its own (the game's
   RANK_GIFT): the prize is checked net of the ranks gained since this moment */
const rank = p => p.evaluate(() => G.RK.achRank(G.RK.achPoints(G.S.nation)).i);
const before = await Promise.all(ps.map(stock)), rank0 = await Promise.all(ps.map(rank));
await fresh(A);
check('the results arrive sealed', await until(async () => /The results of March 2031 are in/.test(await text(A, '.flc-box')), 20000), (await text(A, '.flc-box')).slice(0, 160));
check('a podium waiting to be seen marks the menu', /\S/.test(await text(A, '.nav [data-v="flagcomp"] .badge')));
await A.click('#flc-reveal');
await A.waitForSelector('.flc-podium');
const pod = await A.$$eval('.flc-podium .flc-pod', l => l.map(e => ({ cls: e.className, nm: e.querySelector('.flc-nm').textContent, sc: e.querySelector('.flc-sc').textContent, flag: !!e.querySelector('.flc-fl svg') })));
const first = pod.find(x => /flc-pod1/.test(x.cls)), second = pod.find(x => /flc-pod2/.test(x.cls)), third = pod.find(x => /flc-pod3/.test(x.cls));
check('the podium: Bland, Cland, Dland', first && first.nm === 'Bland' && second.nm === 'Cland' && third.nm === 'Dland' && pod.every(x => x.flag), JSON.stringify(pod));
await shot(A, 'fc-3-podium');
check('with each flag’s score', /^5\.00/.test(first.sc) && /^4\.00/.test(second.sc) && /3 scores/.test(first.sc), first.sc);
check('the nation that did not place sees where its flag came', await until(async () => /Your flag placed 4th of 4/.test(await text(A, '.flc-res .flc-mine'))), await text(A, '.flc-res'));
await A.click('.flc-all summary');
check('every flag entered is listed with its owner', await A.locator('.flc-grid li').count() === 4 && /Aland/.test(await text(A, '.flc-grid')));
check('opening the envelope clears the mark', await until(async () => !/\S/.test(await text(A, '.nav [data-v="flagcomp"] .badge'))));
/* the prizes: each podium nation adds its goods once; the winner's month of the Club is the server's */
for (const p of [B, C, D]) await fresh(p);
const want = async (p, i, amt) => before[i].goods + amt + 15 * Math.max(0, await rank(p) - rank0[i]);
const prize = async (p, i, amt) => until(async () => { const s = await stock(p), w = await want(p, i, amt); return s.goods >= Math.min(399.5, w - 1) && s.goods <= w + 8; }, 15000);
check('the winner is paid 300 goods', await prize(B, 1, 300), JSON.stringify([before[1].goods, (await stock(B)).goods, rank0[1], await rank(B)]));
check('second place 150', await prize(C, 2, 150), JSON.stringify([before[2].goods, (await stock(C)).goods, rank0[2], await rank(C)]));
check('third place 75', await prize(D, 3, 75), JSON.stringify([before[3].goods, (await stock(D)).goods, rank0[3], await rank(D)]));
check('and each place is on the nation’s record', await B.evaluate(m => (G.S.nation.fcp || []).includes(m + '/1'), M) && await C.evaluate(m => (G.S.nation.fcp || []).includes(m + '/2'), M) && await D.evaluate(m => (G.S.nation.fcp || []).includes(m + '/3'), M));
const gB = (await stock(B)).goods; await fresh(B); await sleep(1500);
check('never twice', Math.abs((await stock(B)).goods - gB) < 5 && await B.evaluate(() => (G.S.nation.fcp || []).length === 1));
check('fourth place is paid nothing, and the bell says the results are in', (await stock(A)).goods < await want(A, 0, 0) + 20 && await A.evaluate(() => (G.S.nation.log || []).some(l => l.k === 'fcres')) && !(await A.evaluate(() => G.S.nation.fcp)));
check('the winner’s bell tells of first place', await B.evaluate(() => (G.S.nation.log || []).some(l => l.k === 'fcwin' && l.b === '1')));
const won = await admin('shopPrize/' + uids[1]), vip = await admin('shop/' + uids[1]);
check('the winner is given a month of the Chancery Club, by the server', !!won && !!won.m.mapValue.fields['fc-' + M] && vip && vip.vip && vip.vip.mapValue.fields.plan.stringValue === 'gift', JSON.stringify(vip && vip.vip));
check('nobody else is', (await admin('shopPrize/' + uids[2])) === null);
await nav(B, 'nation');
check('the winner wears a rosette on its nation page', await until(async () => await B.locator('.hero .flc-ros').count() === 1) && /Winner of the March 2031 flag competition/.test(await B.locator('.hero .flc-ros').getAttribute('title')), (await text(B, '.hero')).slice(0, 160));
await nav(C, 'nation');
check('the runner-up does not', await C.locator('.hero .flc-ros').count() === 0);
/* the hall */
await page(A); await A.click('#flc-tab-hall');
check('the Hall of Flags hangs the podium', await until(async () => /March 2031/.test(await text(A, '.flc-month')) && await A.locator('.flc-row li').count() === 3 && /Bland/.test(await text(A, '.flc-row'))), await text(A, '.flc-box'));
await shot(A, 'fc-4-hall');
await nav(A, 'help');
check('How to play explains the competition', /The Flag Competition/.test(await text(A, '#help-flagcomp')) && /300 goods/.test(await text(A, '#help-flagcomp')));

/* ── the next month, on a phone ── */
await clockTo(Date.UTC(2031, 3, 13));
const P = await player('phone', { vp: { width: 390, height: 844 } });
await open(P); await found(P, 'Phoneland'); await register(P, { old: true });
await P.evaluate(() => { location.hash = '#flagcomp'; }); await P.waitForSelector('.flc-steps', { timeout: 15000 });
check('a new month opens for entries, with the last podium still in the Hall', /Enter a flag for April 2031/.test(await text(P, '.flc-box')));
await shot(P, 'fc-5-phone-enter');
check('the page fits a phone', await P.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), await P.evaluate(() => document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth));
await fetch(doc('flagcTest/clock'), { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
await finish();
