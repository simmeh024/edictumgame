// The Assembly in five tabs (emulators): the vote with its chamber, a reason beside a vote and an abstention shown as
// one; the tabs in the address and on the arrow keys; the debate the Assembly opens on the Community Board; the rulebook,
// a resolution in it bound to a member's nation and a repeal proposed from it; the result card of a closed count; the
// Records tab's attendance, Book of Resolutions and voting record, also on the nation page; a commendation tabled
// from the form and a passed one's laurel; and an absent member, who keeps its seat but not the chair.
import { createRequire } from 'node:module';
import { check, finish, until, sleep, player, open, ready, found, nav, text, clearEmulators, register, OUT, PROJECT } from './lib.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp({ projectId: PROJECT });
const db = getFirestore(), DAY = 86400000;
const shot = (p, name) => p.screenshot({ path: OUT + '/assembly-' + name + '.png', fullPage: true }).catch(() => {});
const shown = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
const tab = p => p.evaluate(() => document.getElementById('asmx')?.dataset.tab || '');
const refresh = p => p.evaluate(() => window.dispatchEvent(new Event('edictum:linked')));
await clearEmulators();

const A = await player('asm-a', { vp: { width: 1366, height: 900 } }), B = await player('asm-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Aldmere');
const ub = await open(B); await found(B, 'Brackwater');
await register(A, { old: true }); await register(B, { old: true });
const reg = await A.evaluate(() => G.ASMX().REG.id), now = Date.now(), c = Math.floor((now - Date.UTC(2026, 0, 5)) / (3 * DAY)), t0 = Date.UTC(2026, 0, 5) + c * 3 * DAY;

/* the count before this one, closed and passed, keeping the rulebook; its page in the Book with both votes */
const entry = { k: 'test~hen', c: c - 1, ti: 'The Happy Hen Convention', tx: 'Cages are banned, and every hen may roam.', cat: 'animals', g: 0, by: ub, bn: 'Brackwater' };
const root = db.doc('assemblyRegions/' + reg), closed = { ...entry, w: 's', lt: t0 - 2 * DAY, y: 2, n: 1, ok: 1, f: t0 + 1000, r: reg };
await root.collection('cycles').doc(String(c - 1)).set({ ...closed, bk: [entry] });
await root.collection('asmBook').doc(String(c - 1)).set({ ...closed, vm: { [ua]: 1, [ub]: -1 }, vx: { [ua]: 'Free the hens.' }, nv: {}, vu: [ua, ub] });
await root.set({ at: Date.now() }, { merge: true });
for (const p of [A, B]) { await p.reload(); await ready(p); await p.waitForSelector('.layout'); await until(() => p.evaluate(() => G.S.civic?.account.kind === 'registered'), 15000); }

/* ── 1. the tabs, the vote and the chamber ── */
await nav(A, 'assembly'); await A.waitForSelector('#asmx');
check('the Assembly page has five tabs', JSON.stringify(await A.$$eval('.asmx-tab', b => b.map(x => x.childNodes[0].textContent.trim()))) === JSON.stringify(['The vote', 'Proposals', 'Members', 'Rulebook', 'Records']));
check('it opens on the vote, one pane at a time', await tab(A) === 'vote' && await until(() => shown(A, '#asmx-p-vote .asm-vote')) && !await shown(A, '#asmx-p-prop .asm-qs'));
check('the vote tab has a dot while this member has not voted', !!await A.$('#asmx-tab-vote .gv-dot'));
check('the chamber draws a seat for every member of the count', await until(async () => { const n = await A.$$eval('#asmx-p-vote .asm-ch circle', x => x.length); return n > 0 && n === await A.evaluate(() => G.S.civic.V.rows.length); }));
check('the resolution at the vote has its debate on the Community Board', await until(() => shown(A, '#asmx-p-vote .asm-deb a[data-act="cba-open"]')));
await shot(A, 'vote');

/* ── 2. a reason beside a vote; an abstention shown as one ── */
await A.fill('#asm-why', 'For the ducks, who cannot vote.');
await A.click('#asmx-p-vote [data-act="asm-vote"][data-v="1"]');
check('a vote goes in with its reason', await until(() => A.evaluate(() => G.S.civic?.own.v.some(v => v.v === 1 && v.x === 'For the ducks, who cannot vote.'))));
check('the reason shows beside the vote, and the dot is gone', await until(async () => /For the ducks/.test(await text(A, '#asmx-p-vote .asm-vl .asm-vx'))) && !await A.$('#asmx-tab-vote .gv-dot'));
await A.fill('#asm-why', 'For the geese as well.'); await A.click('[data-act="asm-why-save"]');
check('a reason can be changed, the vote standing', await until(() => A.evaluate(() => G.S.civic?.own.v.some(v => v.v === 1 && v.x === 'For the geese as well.'))));
await nav(B, 'assembly'); await B.waitForSelector('#asmx-p-vote [data-act="asm-vote"][data-v="0"]');
check('before voting, no vote button is pressed (abstain included)', (await B.$$eval('#asmx-p-vote [data-act="asm-vote"]', b => b.filter(x => x.getAttribute('aria-pressed') === 'true').length)) === 0);
const seatB = await until(() => B.evaluate(() => { const b = document.querySelector('#asmx-p-vote [data-act="asm-vote"][data-v="0"]'); return !!b && !b.disabled; }), 20000);
check('Brackwater holds a seat', seatB, seatB ? '' : JSON.stringify(await B.evaluate(id => ({ reg: G.S.nation.reg, acct: G.S.civic?.account, rec: G.S.civic?.recs.find(r => r.id === id)?.n, now: Date.now(), founded: G.S.nation.founded, mvAt: G.S.nation.mvAt }), ub)).slice(0, 900));
await B.click('#asmx-p-vote [data-act="asm-vote"][data-v="0"]');
check('an abstention is pressed as one', await until(async () => await B.getAttribute('#asmx-p-vote [data-act="asm-vote"][data-v="0"]', 'aria-pressed') === 'true'));
await refresh(A);
check('and others see it as an abstention, not as no vote yet', await until(async () => { const t = await A.$$eval('#asmx-p-vote .asm-vl li', li => li.filter(x => x.textContent.includes('Brackwater')).map(x => x.textContent).join('')); return /Abstains/.test(t) && !/Not yet/.test(t); }, 15000));

/* ── 3. the tabs in the address and on the arrow keys ── */
await A.click('#asmx-tab-prop');
check('a tab shows its pane, and the address says which', await tab(A) === 'prop' && await A.evaluate(() => location.hash) === '#assembly/prop' && await shown(A, '#asm-form'));
await A.focus('#asmx-tab-prop'); await A.keyboard.press('ArrowRight');
check('the arrow keys move along the tabs', await tab(A) === 'mem' && await A.evaluate(() => document.activeElement?.id) === 'asmx-tab-mem');
await A.goto(A.url().split('#')[0] + '#assembly/book'); await ready(A); await A.waitForSelector('#asmx');
check('an address with a tab opens on it', await until(async () => await tab(A) === 'book'));

/* ── 4. the rulebook: the resolution in force binds the member; its repeal ── */
check('the Rulebook lists the resolution in force', await until(async () => /The Happy Hen Convention/.test(await text(A, '#asmx-p-book')) && /1 of at most 5/.test(await text(A, '#asmx-p-book')), 15000));
check('a member follows it: bound to its nation once, with what it did kept to lift it again', await until(async () => {
  await A.evaluate(() => G.commit(G.clone(G.S.nation)));
  return A.evaluate(() => { const f = (G.S.nation.asm.f || []).filter(x => x.k === 'test~hen'); return f.length === 1 && !!f[0].ds && Object.keys(f[0].ds).length > 0; });
}, 20000));
check('the Rulebook says since when', await until(async () => /Aldmere has followed it since/.test(await text(A, '#asmx-p-book'))));
/* bound once for good: more saves, and a reload from the saved record, apply it no again */
const bound = await A.evaluate(() => G.S.nation.asm.f.find(x => x.k === 'test~hen').t);
for (let i = 0; i < 3; i++) { await A.evaluate(() => G.commit(G.clone(G.S.nation))); await sleep(400); }
await sleep(4000); await A.reload(); await ready(A); await A.waitForSelector('.layout');
await until(() => A.evaluate(() => G.S.civic?.account.kind === 'registered'), 15000); await A.evaluate(() => G.commit(G.clone(G.S.nation)));
check('it stays bound once, through more saves and a reload', await A.evaluate(t => { const f = (G.S.nation.asm.f || []).filter(x => x.k === 'test~hen'); return f.length === 1 && f[0].t === t; }, bound), JSON.stringify(await A.evaluate(() => G.S.nation.asm.f)));
await nav(A, 'assembly'); await A.click('#asmx-tab-book');
await shot(A, 'rulebook');
await A.click('#asmx-p-book [data-act="asm-repeal"][data-k="test~hen"]');
check('proposing its repeal opens the Proposals tab with the repeal begun', await tab(A) === 'prop' && await shown(A, '.asm-rpf') && (await A.inputValue('#asm-ti')).startsWith('Repeal of'));
await A.fill('#asm-tx', 'The hens have all gone home.'); await A.click('.asm-rpf [type="submit"]');
check('the repeal is tabled, naming its resolution, in its category', await until(() => A.evaluate(() => G.S.civic?.own.p?.rp === 'test~hen' && G.S.civic.own.p.c === 'animals')));
check('it waits in the queue as a repeal', await until(async () => /Repeal/.test(await text(A, '#asmx-p-prop .asm-q')) && /Repeals “The Happy Hen Convention”/.test(await text(A, '#asmx-p-prop .asm-q'))));
check('and the Rulebook marks its resolution', await until(async () => /Repeal proposed/.test(await text(A, '#asmx-p-book')) && !await A.$('#asmx-p-book [data-act="asm-repeal"]')));

/* ── 5. the result card of a closed count ── */
await A.evaluate(c => { const X = G.ASMX(), n = G.S.nation; n.asm.h = (n.asm.h || []).filter(h => h.c !== c).concat([{ c, r: X.REG.id, k: 'test~hen', ti: 'The Happy Hen Convention', cat: 'animals', g: 0, by: 'x', bn: 'Brackwater', y: 2, n: 1, ok: 1, f: Date.now(), at: Date.now(), m: 1, mv: 1, dx: [['env', 40, 41.2], ['happy', 50, 51]] }]); X.ASMX.tab = 'vote'; G.render(); }, c - 1);
check('a closed count has its result card: the count, the stamp, your vote and what changed', await until(async () => { const t = await text(A, '.asm-cer'); return /Resolution No\./.test(t) && /Passed/.test(t) && /You voted for/.test(t) && /40 → 41\.2/.test(t); }));
await shot(A, 'result-card');
await A.click('[data-act="asm-cer-ok"]');
check('Done puts it away, and it stays away', !await A.$('.asm-cer') && await A.evaluate(() => { G.render(); return !document.querySelector('.asm-cer'); }));

/* ── 6. the records: attendance, the Book of Resolutions and the voting record ── */
await A.click('#asmx-tab-rec');
check('the Book of Resolutions lists the closed count from the server', await until(async () => /The Happy Hen Convention/.test(await text(A, '#asmx-p-rec .asm-hist')) && /Passed/.test(await text(A, '#asmx-p-rec .asm-hist')), 15000));
await A.click('#asmx-p-rec .asm-hv summary');
check('with how each member voted and the reasons they gave', /Free the hens/.test(await text(A, '#asmx-p-rec .asm-hv')) && /Brackwater/.test(await text(A, '#asmx-p-rec .asm-hv')));
check('the voting record, and attendance in three figures', /1 for, 0 against/.test(await text(A, '#asmx-p-rec .asm-rec')) && await A.$$eval('#asmx-p-rec .asm-figs .fig', f => f.length) === 3);
await shot(A, 'records');
await nav(A, 'nation');
check('the nation page shows its voting record', await until(async () => /Your last count: 1 for/.test(await text(A, '.asm-nsec'))));

/* ── 6b. commendations and condemnations: naming a nation in the form, the proposal in the queue, and a passed
   commendation marking its nation: the Rulebook tab, the nation page, its cities' mood and the Trade page ── */
await nav(B, 'assembly'); await B.click('#asmx-tab-prop'); await B.waitForSelector('#asm-cat');
await B.selectOption('#asm-cat', 'condemn');
check('choosing a condemnation swaps the strength for the nation to name', await until(() => shown(B, '#asm-tg')) && !await B.$('[data-act="asm-g"]') && /The nation to condemn/.test(await text(B, '#asm-form')));
check('a nation in its first fortnight is listed but cannot be condemned', await B.$eval(`#asm-tg option[value="${ua}"]`, o => o.disabled && /first fortnight/.test(o.textContent)));
check('computer nations can be named too', await B.$$eval('#asm-tg optgroup[label="Computer nations"] option', o => o.length > 0 && o.every(x => !x.disabled)));
await B.selectOption('#asm-cat', 'commend');
check('a newcomer may be commended', await until(() => B.$eval(`#asm-tg option[value="${ua}"]`, o => !o.disabled).catch(() => false)));
await B.selectOption('#asm-tg', ua);
check('the box says what a commendation does to the nation named', await until(async () => /\+5 mood in each of its cities/.test(await text(B, '#asm-fx-prev')) && /never enters the rulebook/.test(await text(B, '#asm-fx-prev'))));
await B.click('[data-act="asm-idea"]');
check('borrowing an idea writes the nation’s name into it', await until(async () => /Aldmere/.test(await B.inputValue('#asm-ti') + ' ' + await B.inputValue('#asm-tx'))));
await B.click('#asm-form [type="submit"]');
check('the commendation is tabled, naming Aldmere', await until(() => B.evaluate(id => G.S.civic?.own.p?.c === 'commend' && G.S.civic.own.p.tg === id && G.S.civic.own.p.tn === 'Aldmere', ua)));
check('it waits in the queue as a commendation of Aldmere', await until(async () => { const t = await text(B, '#asmx-p-prop .asm-q'); return /Commendation/i.test(t) && /Names Aldmere/.test(t); }));
await shot(B, 'commend-queue');

/* a commendation of Aldmere passed two counts ago: its laurel runs for seven days from that close */
await root.collection('cycles').doc(String(c - 2)).set({ c: c - 2, k: 'test~laurel', ti: 'Laurels for Aldmere', tx: 'For its hens.', cat: 'commend', g: 0, by: ub, bn: 'Brackwater', w: 's', lt: t0 - 5 * DAY, y: 2, n: 0, ok: 1, f: t0 - 3 * DAY + 1000, r: reg, tg: ua, tn: 'Aldmere' });
await root.set({ at: Date.now() }, { merge: true });
await refresh(A);
check('the server sends the laurel with the counts', await until(() => A.evaluate(() => G.S.civic?.locks.some(L => L.k === 'test~laurel')), 15000));
await nav(A, 'assembly'); await A.click('#asmx-tab-book');
check('the Rulebook tab lists Aldmere under laurels and censures, not in the rulebook', await until(async () => /Laurels and censures/.test(await text(A, '#asmx-p-book')) && /Aldmere · commended until/.test(await text(A, '#asmx-p-book .asm-mkl')) && /1 of at most 5/.test(await text(A, '#asmx-p-book'))));
await shot(A, 'laurels');
check('each of Aldmere’s cities is in better spirits for it', await until(() => A.evaluate(() => { const cs = G.CX.cityState(G.territory()), mine = cs.all.filter(ct => ct.fid === G.S.uid && !ct.npc); return mine.length > 0 && mine.every(ct => G.CX.mood(ct, Date.now()).parts.some(([d, t]) => d === 5 && /laurel/.test(t))); })));
await nav(A, 'nation');
check('the nation page wears the laurel', await until(async () => /Commended by the .+ Assembly/.test(await text(A, '.asm-nsec')) && /Laurels for Aldmere/.test(await text(A, '.asm-nsec'))));
await nav(A, 'trade');
check('the Trade page says computer nations ask less of it', await until(async () => /laurel: computer nations ask 10% less of you/.test(await text(A, '.main'))));
await refresh(B); await nav(B, 'assembly'); await B.click('#asmx-tab-book');
check('and Brackwater sees the same laurel', await until(async () => /Aldmere · commended until/.test(await text(B, '#asmx-p-book')), 15000));
/* the count now open turns out to condemn Brackwater: the vote card names it and its rule; Brackwater hears of it */
await root.collection('cycles').doc(String(c)).set({ cat: 'condemn', tg: ub, tn: 'Brackwater' }, { merge: true });
await root.set({ at: Date.now() }, { merge: true }); await refresh(A); await refresh(B);
await nav(A, 'assembly'); await A.click('#asmx-tab-vote');
check('a condemnation at the vote names its nation and needs two votes to one', await until(async () => { const t = await text(A, '#asmx-p-vote .asm-vote'); return /Condemnation/.test(t) && /Condemns\s*Brackwater/.test(t) && /two votes for every one against/.test(t) && /−3 mood in each of its cities/.test(t); }, 15000));
await shot(A, 'condemn-vote');
check('and the bell tells Brackwater', await until(() => B.evaluate(() => { const b = G.NEWS.bell(Date.now()); return [...b.pin, ...b.ev].some(x => /whether to condemn Brackwater/.test(x.txt)); }), 15000));

/* ── 7. the debate topic on the Community Board ── */
await nav(A, 'assembly'); await A.click('#asmx-tab-vote');
await A.click('#asmx-p-vote .asm-deb a');
check('the debate opens on the Community Board, signed by the Assembly’s clerk', await until(async () => /Clerk of the Assembly/.test(await text(A, '.main')) && /Resolution No\./.test(await text(A, '.main'))));
await shot(A, 'debate');

/* ── 8. an absent member keeps its seat, not the chair ── */
await nav(A, 'assembly'); await A.click('#asmx-tab-mem');
await A.click(`#asmx-p-mem [data-act="asm-end"][data-id="${ub}"]`);
check('an endorsement counts for Brackwater', await until(() => A.evaluate(id => G.S.civic?.info.some(([i, v]) => i === id && v.k >= 1), ub)));
await B.ctx.close();
await db.doc('nations/' + ub).update({ ts: Timestamp.fromMillis(Date.now() - 20 * DAY) });
await root.set({ at: Date.now() }, { merge: true });
await refresh(A);
check('absent for twenty days, it keeps its seat but cannot hold the chair', await until(() => A.evaluate(id => G.S.civic?.D?.id !== id && G.S.civic.info.some(([i, v]) => i === id && v.ab), ub), 15000));
check('the Members tab says why', await until(async () => /Absent/.test(await text(A, '#asmx-p-mem .asm-ends')) && /cannot hold the chair/.test(await text(A, '#asmx-p-mem .asm-ends'))));
await shot(A, 'members');

/* ── 9. at phone width ── */
await A.setViewportSize({ width: 390, height: 844 });
for (const t of ['vote', 'prop', 'book', 'rec']) { await A.click('#asmx-tab-' + t); await shot(A, 'phone-' + t); }
check('at phone width the page does not scroll sideways', await A.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await finish();
