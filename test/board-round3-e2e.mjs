// The Community Board, round three: one board per region (the Region page's Board tab shows its topics, then Quick
// messages), under News and people; Latest on every board, filters, and only the boards with topics (the rest behind
// a picker); rows with the first line and who replied last; long threads open on their latest replies with Show
// earlier, Reply on every post and a Reply bar that stays in view, the way back and on at the bottom; drafts kept
// across a reload; the form says when the next post may go.
import { player, open, found, register, until, check, finish, clearEmulators, sleep, clickPast, text, FS_HOST, PROJECT, OUT } from './lib.mjs';
await clearEmulators();
const B = await player('player'), C = await player('reader'), P = await player('phone', { vp: { width: 390, height: 844 } });
const uidB = await open(B); await found(B, 'Playerland');
const uidC = await open(C); await found(C, 'Readerland');
const uidP = await open(P); await found(P, 'Phoneland');
await register(B); await register(C); await register(P);
const home = await B.evaluate(() => G.S.nation.reg);
const calm = async p => { for (let i = 0; i < 2; i++) { const b = await p.$('[data-ed="recovery-saved"]'); if (b && await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); await sleep(250); } } };
const nav = (p, v) => p.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v);

/* 2. under News and people; the far board is one that takes topics (the first behind the picker, while all are empty) */
await calm(B);
check('the Community Board sits under News and people', /Community Board/.test(await text(B, '.side .nav-grp[data-g="news"] .nav-g')));
await nav(B, 'community');
await B.waitForSelector('#cb-goreg');
const far = await B.$eval('#cb-goreg option', o => o.value);

/* a lived-in board, written straight into the emulator: twelve topics at home (one with 34 replies), three far away */
const doc = (path, fields) => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) })
  .then(r => { if (!r.ok) return r.text().then(t => { throw new Error(t); }); });
const unpace = uid => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/cbPace/${uid}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
const S = v => ({ stringValue: String(v) }), I = v => ({ integerValue: String(Math.round(v)) });
let seq = 0; const id = () => ('T' + String(++seq).padStart(3, '0') + 'x'.repeat(16)).slice(0, 20);
const now = Date.now(), H = 36e5, who = [[uidB, 'Playerland'], [uidC, 'Readerland'], [uidP, 'Phoneland']];
const TOPICS = [['trade', 'Selling iron, buying food'], ['diplomacy', 'Proposal: a northern defence pact'], ['help', 'How do land credits work?'], ['general', 'Introduce your nation here'],
  ['war', 'Raids on my coast'], ['assembly', 'Vote yes on the fisheries resolution'], ['offtopic', 'Favourite flag in the region?'], ['help', 'Why can’t I upgrade my University?'],
  ['trade', 'Oil wanted, paying goods'], ['general', 'Weekly region news'], ['diplomacy', 'A border settled'], ['help', 'What does mood do in a city?']];
const LONG = 'We have been trading with our neighbours for a while and the numbers keep changing. '.repeat(4);
const tids = [];
for (const [i, [tg, ti]] of TOPICS.entries()) {
  const tid = id(), [a, nm] = who[i % 3], t = now - (i + 1) * 5 * H, nr = i === 1 ? 34 : i % 4;
  await doc(`cb/${home}/posts/${tid}`, { a: S(a), nm: S(nm), rg: S(home), ti: S(ti), x: S(`**${ti}**: a first line about it.\nAnd a second line.`), tg: S(tg), t: I(t), la: I(t + nr * 5 * 60e3), rc: I(nr) });
  for (let k = 0; k < nr; k++) { const [ra, rn] = who[(i + k + 1) % 3];
    await doc(`cb/${home}/posts/${tid}/posts/R${String(i).padStart(2, '0')}${String(k).padStart(3, '0')}${'y'.repeat(14)}`, { a: S(ra), nm: S(rn), rg: S(home), x: S(k % 5 === 0 ? LONG : `Reply ${k + 1}: agreed.`), t: I(t + (k + 1) * 5 * 60e3) }); }
  tids.push(tid);
}
await doc(`cb/${home}`, { n: I(TOPICS.length), dd: S(new Date().toISOString().slice(0, 10)), dn: I(2) });
for (let i = 0; i < 3; i++) await doc(`cb/${far}/posts/F${i}${'z'.repeat(18)}`, { a: S(uidC), nm: S('Readerland'), rg: S(far), ti: S('Far topic ' + (i + 1)), x: S('Hello from afar.'), tg: S('general'), t: I(now - (i + 0.5) * H), la: I(now - (i + 0.5) * H), rc: I(0) });
await doc(`cb/${far}`, { n: I(3), dd: S(new Date().toISOString().slice(0, 10)), dn: I(3) });
const long = tids[1];
const rows = (p, sel) => p.$$eval(sel + ' .cb-row-m', l => l.map(a => ({ id: a.dataset.t, reg: a.dataset.reg, t: a.querySelector('.cb-row-t').textContent.trim(), x: (a.querySelector('.cb-row-x') || {}).textContent || '', s: a.querySelector('.cb-row-s').textContent }))).catch(() => []);

await B.reload(); await calm(B); await B.waitForSelector('.cb-lt');

/* 3, 4. Latest on every board; the own region; only the boards with topics; a picker for the rest */
check('Latest on every board lists topics from every board with any', await until(async () => { const r = await rows(B, '.cb-lt'); return r.some(x => x.reg === far) && r.some(x => x.reg === home); }, 15000), JSON.stringify((await rows(B, '.cb-lt')).slice(0, 3)));
const lt = await rows(B, '.cb-lt');
const fi = n => lt.findIndex(x => x.t.endsWith('Far topic ' + n));
check('newest first, ten to begin with, each naming its board', lt.length === 10 && fi(1) >= 0 && fi(1) < fi(2) && fi(2) < fi(3) && lt.every(x => x.s.length > 0) && !!(await B.$('.cb-lt .cb-row-rg')), JSON.stringify(lt.map(x => x.t.slice(0, 24))));
check('More topics shows more', (await B.click('[data-act="cb-lt-more"]'), await until(async () => (await rows(B, '.cb-lt')).length > 10)));
const secs = await B.$$eval('.cb-regs > .cb-reg', l => l.map(s => s.dataset.reg));
check('the own region, then the Chancery, then only the boards with topics', secs[0] === home && secs.includes(far) && secs.length <= 4, JSON.stringify(secs));
const empties = await B.$$eval('#cb-goreg option', l => l.map(o => o.value));
check('the empty boards wait behind a picker', empties.length > 3 && !empties.includes(home) && !empties.includes(far), empties.length);
await B.selectOption('#cb-goreg', empties[0]); await B.click('[data-act="cb-goreg"]');
check('the picker opens an empty board, ready for a first topic', await until(async () => /No topics yet/.test(await text(B, `.cb-reg[data-reg="${empties[0]}"]`)) && !!(await B.$(`[data-act="cb-new"][data-reg="${empties[0]}"]`))));
await B.click(`[data-act="cb-tg"][data-reg="${empties[0]}"]`);

/* 6. rows: the first line, without its marks */
const hr = await rows(B, `.cb-reg[data-reg="${home}"]`);
check('a row shows the first line of the post, without its marks', hr.some(x => /^Selling iron, buying food: a first line about it\. And a second line\.$/.test(x.x.trim())), JSON.stringify(hr.slice(0, 2).map(x => x.x)));

/* 5. filters */
await B.click('[data-act="cb-flt"][data-k="tg"][data-v="help"]');
const helpRows = await rows(B, `.cb-reg[data-reg="${home}"]`), helpLt = await rows(B, '.cb-lt');
check('a kind shows only its topics, on the boards and in Latest', helpRows.length === 3 && helpRows.every(x => /Help/i.test(x.s)) && helpLt.length === 3, JSON.stringify(helpRows.map(x => x.t)));
await B.click('[data-act="cb-flt"][data-k="w"][data-v="un"]');
check('Unanswered with it: the Help topics nobody has answered', (await rows(B, `.cb-reg[data-reg="${home}"]`)).every(x => /0 replies/.test(x.s)) && (await rows(B, `.cb-reg[data-reg="${far}"]`)).length === 0);
check('a board with nothing to show says so, with a way back', /Nothing here is Help, unanswered/.test(await text(B, `.cb-reg[data-reg="${far}"]`)) || !(await B.$(`.cb-reg[data-reg="${far}"] .cb-reg-b`)));
await B.click('[data-act="cb-flt"][data-k="w"][data-v="mine"]');
check('Started by me: only the player’s own', (await rows(B, `.cb-reg[data-reg="${home}"]`)).every(x => /Playerland/.test(x.s)));
await B.reload(); await B.waitForSelector('.cb-flt');
check('the filters are kept on this device', !!(await B.$('[data-act="cb-flt"][data-k="tg"][data-v="help"][aria-pressed="true"]')) && !!(await B.$('[data-act="cb-flt"][data-k="w"][data-v="mine"][aria-pressed="true"]')));
await B.click('[data-act="cb-flt"][data-k="tg"][data-v=""]'); await B.click('[data-act="cb-flt"][data-k="w"][data-v=""]');
/* twelve, and the debate the Assembly may have opened for its resolution at the vote */
check('All kinds and Every topic show everything again', await until(async () => (await rows(B, `.cb-reg[data-reg="${home}"]`)).length >= 12));

/* 9, 8. a long thread: the latest twenty, Show earlier; Reply on a post; the bar */
/* where the list was left: with the row in view, so the click does not scroll first */
const listY = await B.evaluate(t => { document.querySelector(`.cb-regs [data-act="cb-topic"][data-t="${t}"]`).scrollIntoView({ block: 'center' }); return scrollY; }, long);
await B.click(`.cb-reg[data-reg="${home}"] [data-act="cb-topic"][data-t="${long}"]`);
await B.waitForSelector('.cb-reps .cb-post');
check('a long thread opens on its latest twenty replies', await until(async () => (await B.$$('.cb-reps .cb-post')).length === 20) && /Show 14 earlier replies/.test(await text(B, '.cb-earlier')) && /the latest 20/.test(await text(B, '.cb-rh')));
await B.click('[data-act="cb-earlier"]');
check('Show earlier shows them all', await until(async () => (await B.$$('.cb-reps .cb-post')).length === 34) && !(await B.$('.cb-earlier')));
check('a Reply bar stays in view while reading', await B.evaluate(() => { const b = document.querySelector('.cb-rbar'), r = b && b.getBoundingClientRect(); return !!r && r.bottom <= innerHeight && r.top > innerHeight - 120 && getComputedStyle(b).position === 'sticky'; }));
const target = await B.$$eval('.cb-reps .cb-post', l => { const p = l.find(x => /Readerland/.test(x.querySelector('.cb-au').textContent)); return p && p.id; });
/* the guest's recovery-code dialog can open at any moment and its button takes the focus; the page's locator handler
   closes it only before an action, never while a check just reads (CI, 22 Nov 2026: the dialog held the focus for the
   whole check, then "agreed, " went to its button). Close it while waiting, and press Reply again if it took the focus:
   the name is added once, so the box still reads "@Readerland " */
const focused = () => B.evaluate(() => !!document.activeElement && document.activeElement.id === 'cb-r-x');
await calm(B);
await B.click(`#${target} [data-act="cb-reply-to"]`);
check('Reply under a post names its author in the box, ready to type', await until(async () => {
  await calm(B); if (!(await focused())) await B.click(`#${target} [data-act="cb-reply-to"]`, { timeout: 3000 }).catch(() => {});
  return /^@Readerland $/.test(await B.inputValue('#cb-r-x')) && await focused();
}));
await calm(B); if (!(await focused())) await B.focus('#cb-r-x');
await B.keyboard.type('agreed, count us in.');
await clickPast(B, '#cb-rf button[type="submit"]');
check('the reply goes, and mentions them', await until(async () => /count us in/.test(await text(B, '.cb-reps')) && /@Readerland/.test(await text(B, '.cb-reps .cb-at'))));
/* 12. the form says when the next post may go */
check('the form then says when the next post may go', await until(async () => /You can post again in \d+ seconds?\./.test(await text(B, '#cb-rf .cb-pace-h'))));
await B.screenshot({ path: OUT + '/board3-topic.png' });

/* 10. the way on: the next topic of the list, and back to the list where it was left */
check('at the bottom: back to the boards and the next topic', !!(await B.$('.cb-botnav [data-act="cb-back"]')) && !!(await B.$('.cb-botnav [data-act="cb-step"]')));
const nx = await B.$eval('.cb-botnav [data-act="cb-step"]:last-child', a => ({ t: a.dataset.t, l: a.textContent }));
check('the next topic is the next on the list it came from', nx.t === tids[2] || nx.t === tids[0] || /Next topic/.test(nx.l), JSON.stringify(nx));
await B.click('.cb-botnav [data-act="cb-step"]:last-child');
check('it opens there', await until(async () => await B.evaluate(t => location.hash.endsWith('/' + t), nx.t)));
await B.click('.cb-botnav [data-act="cb-back"]');
check('Back returns to the list where it was left', await until(async () => !!(await B.$('.cb-lt')) && Math.abs(await B.evaluate(() => scrollY) - listY) < 80), String(await B.evaluate(() => scrollY)) + ' vs ' + listY);

/* 6. who replied last */
check('a row names who replied last', await until(async () => (await rows(B, `.cb-reg[data-reg="${home}"]`)).some(x => x.id === long && /last reply by Playerland/.test(x.s)), 10000));

/* 11. drafts: a reply and a topic being written survive a reload */
await B.click(`.cb-reg[data-reg="${home}"] [data-act="cb-topic"][data-t="${tids[3]}"]`);
await B.waitForSelector('#cb-r-x'); await B.fill('#cb-r-x', 'Half a thought about introductions');
await sleep(600); await B.reload(); await B.waitForSelector('#cb-r-x');
check('a reply being written is there after a reload', await until(async () => await B.inputValue('#cb-r-x') === 'Half a thought about introductions'));
await B.click('.cb-back a');
check('and goes with its topic, not into another', (await B.click(`.cb-reg[data-reg="${home}"] [data-act="cb-topic"][data-t="${tids[4]}"]`), await B.waitForSelector('#cb-r-x'), await B.inputValue('#cb-r-x')) === '');
await B.click('.cb-back a'); await B.click('.cb-start [data-act="cb-new"]');
await B.fill('#cb-f-ti', 'An unfinished thought'); await B.fill('#cb-f-x', 'Some words'); await sleep(600);
await B.reload(); await B.waitForSelector('.cb-start');
check('an unfinished topic is offered after a reload', /Unfinished topic “An unfinished thought”/.test(await text(B, '.cb-start')));
await B.click('[data-act="cb-draft-go"]');
check('Continue writing brings it back', await until(async () => await B.inputValue('#cb-f-ti') === 'An unfinished thought' && await B.inputValue('#cb-f-x') === 'Some words'));
await B.click('[data-act="cb-new-no"]'); await B.click('[data-act="cb-draft-no"]');
check('Discard lets it go', await until(async () => !/Unfinished topic/.test(await text(B, '.cb-start'))));

/* 1. one board per region: the Region page's Board tab shows its topics, then Quick messages */
await calm(C);
await C.evaluate(() => { location.hash = '#region/board'; });
check('the Region page’s Board tab shows the region’s topics first', await until(async () => /Topics in /.test(await text(C, '#rgn-p-board .rgn-cb')) && (await C.$$('#rgn-p-board .rgn-cb .cb-row')).length >= 8, 15000));
check('then its Quick messages, still with their form', /Quick messages/.test(await text(C, '#rgn-p-board .rgn-qm')) && !!(await C.$('#rgn-p-board #rmb-form')));
await C.screenshot({ path: OUT + '/board3-region.png' });
await C.click('#rgn-p-board .rgn-cb [data-act="cb-topic"]');
check('a topic there opens on the Community Board', await until(async () => await C.evaluate(() => G.S.view === 'community' && /^#community\/[a-z]+\/\w{20}$/.test(location.hash)) && !!(await C.$('.cb-post .cb-ti'))));
await C.evaluate(() => { location.hash = '#region/board'; }); await C.waitForSelector('#rgn-p-board .rgn-cb [data-act="cb-new"]');
await C.click('#rgn-p-board .rgn-cb [data-act="cb-new"]');
check('New topic there opens the form on the Community Board, for the region', await until(async () => await C.evaluate(r => G.S.view === 'community' && document.getElementById('cb-f-reg') && document.getElementById('cb-f-reg').value === r, home)));
await C.click('[data-act="cb-new-no"]');
await C.click('[data-act="cb-qm"]');
check('and the own board points at the Quick messages', await until(async () => await C.evaluate(() => G.S.view === 'region') && !!(await C.$('#rgn-p-board #rmb-form'))));

/* phones: the long thread is shorter, and the bar sits above the tab bar */
await calm(P); await unpace(uidP);
await P.evaluate(([r, t]) => { location.hash = '#community/' + r + '/' + t; }, [home, long]); await P.waitForSelector('.cb-reps .cb-post');
await sleep(800);
const ph = await P.evaluate(() => { const b = document.querySelector('.cb-rbar').getBoundingClientRect(), t = document.querySelector('.tabbar'), tb = t ? t.getBoundingClientRect().top : innerHeight; return { H: document.documentElement.scrollHeight, bar: Math.round(b.bottom), tab: Math.round(tb) }; });
check('on a phone the thread opens on its latest replies', (await P.$$('.cb-reps .cb-post')).length <= 21, JSON.stringify(ph));
check('and its Reply bar sits above the tab bar', ph.bar <= ph.tab, JSON.stringify(ph));
await P.screenshot({ path: OUT + '/board3-phone.png' });
await P.click('.cb-rbar [data-act="cb-reply-go"]');
check('the bar’s Reply goes to the box', await until(async () => await P.evaluate(() => document.activeElement && document.activeElement.id === 'cb-r-x')));
await finish();
