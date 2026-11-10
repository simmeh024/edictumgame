// The flag competition's rules (functions/flagcomp-core.js): the monthly calendar, ratings, dealing flags to judges, the
// trimmed score and the podium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FC, FC_SUS, fcId, fcIdOk, fcTimes, fcPhase, fcPrev, fcStars, fcScore, fcNeed, fcDuty, fcRank, fcDeal, fcFlagText, fcSuspect } from '../functions/flagcomp-core.js';
import { KINDS, fcWanted, fcLetter } from '../functions/mail-core.js';

const DAY = 86400000;

test('one competition a month, from the 12th: a week of entries, five days of judging, then the results until the next 12th', () => {
  assert.equal(FC.START_DAY, 12);
  assert.equal(fcId(Date.UTC(2026, 11, 12)), '2026-12', 'it opens on the 12th');
  assert.equal(fcId(Date.UTC(2026, 11, 31, 23, 59)), '2026-12');
  assert.equal(fcId(Date.UTC(2027, 0, 1)), '2026-12', 'and runs into the next month');
  assert.equal(fcId(Date.UTC(2027, 0, 11, 23, 59)), '2026-12', 'up to the 11th');
  assert.equal(fcId(Date.UTC(2027, 0, 12)), '2027-01');
  assert.equal(fcId(Date.UTC(2026, 10, 10)), '2026-10', 'the days before the 12th belong to the month before');
  assert.equal(fcId(Date.UTC(2026, 10, 12)), '2026-11');
  assert.equal(fcId(Date.UTC(2027, 2, 5)), '2027-02', 'across a short month');
  const t = fcTimes('2026-12');
  assert.equal(t.open, Date.UTC(2026, 11, 12)); assert.equal(t.judge, Date.UTC(2026, 11, 19)); assert.equal(t.close, Date.UTC(2026, 11, 24)); assert.equal(t.end, Date.UTC(2027, 0, 12));
  assert.equal(fcTimes('2027-01').open, t.end, 'one ends where the next opens');
  assert.equal(fcPhase('2026-12', t.open - 1), 'soon');
  assert.equal(fcPhase('2026-12', t.open), 'enter'); assert.equal(fcPhase('2026-12', t.judge - 1), 'enter');
  assert.equal(fcPhase('2026-12', t.judge), 'judge'); assert.equal(fcPhase('2026-12', t.close - 1), 'judge');
  assert.equal(fcPhase('2026-12', t.close), 'done'); assert.equal(fcPhase('2026-12', t.end + 40 * DAY), 'done');
  assert.equal(fcPrev('2027-01'), '2026-12'); assert.equal(fcPrev('2026-03'), '2026-02');
  assert.equal(fcTimes('2027-02').end, Date.UTC(2027, 2, 12), 'February’s runs to 12 March');
  for (let t0 = Date.UTC(2026, 10, 1); t0 < Date.UTC(2028, 3, 1); t0 += 7 * 3600e3) { const id = fcId(t0), x = fcTimes(id); assert.ok(x.open <= t0 && t0 < x.end, 'every moment lies inside its own competition: ' + new Date(t0).toISOString()); }
  for (const ok of ['2026-12', '2031-01']) assert.ok(fcIdOk(ok));
  for (const bad of ['2026-13', '2026-1', '1999-12', '', null, '2026-12x', 202612]) assert.ok(!fcIdOk(bad), String(bad));
});

test('a rating is five whole stars, one to five each', () => {
  assert.deepEqual(fcStars([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
  for (const bad of [[1, 2, 3, 4], [1, 2, 3, 4, 5, 5], [0, 2, 3, 4, 5], [1, 2, 3, 4, 6], [1, 2, 3, 4, 4.5], ['5', 5, 5, 5, 5], null, 'x', { 0: 5 }]) assert.equal(fcStars(bad), null, JSON.stringify(bad));
  assert.equal(FC.CATS.length, 5);
});

test('the score is the mean of the judges’ averages, without the kindest and the harshest once there are five', () => {
  assert.deepEqual(fcScore([]), { n: 0, score: 0, cats: [0, 0, 0, 0, 0] });
  assert.equal(fcScore([[4, 4, 4, 4, 4]]).score, 4);
  assert.equal(fcScore([[5, 5, 5, 5, 5], [3, 3, 3, 3, 3]]).score, 4, 'two judges: a plain mean');
  const four = [[5, 5, 5, 5, 5], [1, 1, 1, 1, 1], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3]];
  assert.equal(fcScore(four).score, 3, 'four judges: nothing is left out yet');
  const five = [[5, 5, 5, 5, 5], [1, 1, 1, 1, 1], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]];
  assert.equal(fcScore(five).score, 3.3333, 'five: the 5.0 and the 1.0 are left out');
  const friend = fcScore([[3, 3, 3, 3, 3], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3], [5, 5, 5, 5, 5]]);
  assert.equal(friend.score, 3, 'one friend’s five stars move nothing');
  const s = fcScore([[5, 4, 3, 2, 1], [5, 4, 3, 2, 1], [1, 1, 1, 1, 1]]);
  assert.equal(s.n, 3); assert.deepEqual(s.cats, [3.67, 3, 2.33, 1.67, 1], 'each category’s plain mean, for the breakdown');
  assert.equal(fcScore([[5, 5, 5, 5, 5], 'junk', [0, 0, 0, 0, 0]]).n, 1, 'anything that is not a rating is ignored');
});

test('what it takes to place: enough ratings for the turnout, and an entrant’s own share of judging', () => {
  assert.equal(fcNeed(0), 2); assert.equal(fcNeed(3), 2); assert.equal(fcNeed(6), 3); assert.equal(fcNeed(9), 5); assert.equal(fcNeed(200), 5);
  assert.equal(fcDuty(1), 0, 'a lone entrant has nothing to score'); assert.equal(fcDuty(4), 3); assert.equal(fcDuty(11), 10); assert.equal(fcDuty(80), 10);
});

test('the podium: best score first; ties go to more ratings, then the better “would you fly it”, then the earlier entry', () => {
  const r = (v, n) => Array.from({ length: n }, () => [v, v, v, v, v]);
  const entries = [
    { id: 'a', uid: 'A', t: 5, ratings: r(4, 6), judged: 10 },
    { id: 'b', uid: 'B', t: 1, ratings: r(5, 6), judged: 10 },
    { id: 'c', uid: 'C', t: 2, ratings: r(5, 6), judged: 2 },          // scored too few flags
    { id: 'd', uid: 'D', t: 3, ratings: r(5, 1), judged: 10 },          // too few ratings
    { id: 'e', uid: 'E', t: 4, ratings: r(4, 7), judged: 10 },          // ties with a, but has more ratings
    { id: 'f', uid: 'F', t: 9, ratings: [...r(4, 5), [4, 4, 4, 4, 5], [4, 4, 4, 4, 3]], judged: 10 },
    ...['g', 'h', 'i', 'j', 'k'].map((id, i) => ({ id, uid: id.toUpperCase(), t: 20 + i, ratings: r(2, 6), judged: 10 }))
  ];
  const out = fcRank(entries, 30);
  assert.equal(out.need, 5); assert.equal(out.duty, 10);
  assert.deepEqual(out.ranked.slice(0, 4).map(x => x.id), ['b', 'e', 'f', 'a']);
  assert.deepEqual(out.ranked.slice(0, 3).map(x => x.place), [1, 2, 3]);
  assert.deepEqual(out.out.map(x => [x.id, x.why]).sort(), [['c', 'duty'], ['d', 'few']]);
  const same = fcRank([{ id: 'y', uid: 'Y', t: 9, ratings: r(3, 5), judged: 1 }, { id: 'x', uid: 'X', t: 2, ratings: r(3, 5), judged: 1 }], 10);
  assert.deepEqual(same.ranked.map(x => x.id), ['x', 'y'], 'all else equal, the earlier entry');
  assert.deepEqual(fcRank([], 0).ranked, []);
  assert.equal(fcRank([{ id: 'solo', uid: 'S', t: 1, ratings: [], judged: 0 }], 0).out[0].why, 'few', 'no winner without votes');
  const small = fcRank([{ id: 'p', uid: 'P', t: 1, ratings: r(5, 2), judged: 2 }, { id: 'q', uid: 'Q', t: 2, ratings: r(4, 2), judged: 2 }, { id: 'r', uid: 'R', t: 3, ratings: r(3, 2), judged: 2 }], 3);
  assert.deepEqual(small.ranked.map(x => x.id), ['p', 'q', 'r'], 'three players can still hold a competition');
  assert.deepEqual([...FC.PRIZES], [300, 150, 75]); assert.equal(FC.CLUB_DAYS, 30);
});

test('flags are dealt least-rated first, never one the judge has scored or may not score, in an order of their own', () => {
  const entries = [{ id: 'a', n: 3 }, { id: 'b', n: 0 }, { id: 'c', n: 0 }, { id: 'mine', n: 0, skip: true }, { id: 'd', n: 1 }, { id: 'e', n: 0 }];
  const got = fcDeal(entries, new Set(['e']), 'judge-1', 3);
  assert.equal(got.length, 3); assert.ok(!got.includes('mine') && !got.includes('e'));
  assert.deepEqual([...got].sort(), ['b', 'c', 'd'], 'the unrated ones, then the least rated');
  assert.equal(got[2], 'd');
  assert.deepEqual(fcDeal(entries, new Set(['e']), 'judge-1', 3), got, 'the same judge sees the same order');
  const many = Array.from({ length: 40 }, (x, i) => ({ id: 'f' + i, n: 0 }));
  assert.notDeepEqual(fcDeal(many, [], 'judge-1'), fcDeal(many, [], 'judge-2'), 'another judge another');
  assert.equal(fcDeal(many, [], 'judge-1').length, FC.BATCH);
  assert.deepEqual(fcDeal([], [], 'x'), []);
});

test('a stored design is a small plain object without markup', () => {
  assert.equal(fcFlagText({ p: 'tri-h', c: ['#fff', '#000'] }), '{"p":"tri-h","c":["#fff","#000"]}');
  for (const bad of [null, 'x', [], 7, { x: '<svg onload=1>' }, { x: 'a'.repeat(FC.FLAG_MAX) }]) assert.equal(fcFlagText(bad), null);
  const loop = {}; loop.me = loop; assert.equal(fcFlagText(loop), null);
});

test('the game’s page repeats the server’s calendar and numbers', async () => {
  const fs = await import('node:fs'), vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
  const line = start => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf('\n', at)); };
  const ctx = vm.createContext({ DAY });
  vm.runInContext(['const FLC_RULES=', 'const FLC_CAT=', 'const flcId=', 'const flcTimes=', 'const flcPhase=', 'const flcPrev='].map(line).join('\n') + '\nthis.X={FLC_RULES,FLC_CAT,flcId,flcTimes,flcPhase,flcPrev};', ctx);
  const X = ctx.X;
  assert.deepEqual([...X.FLC_RULES.CATS], [...FC.CATS]); assert.deepEqual([...X.FLC_RULES.PRIZES], [...FC.PRIZES]);
  for (const k of ['ENTER_DAYS', 'JUDGE_DAYS', 'DUTY', 'CLUB_DAYS']) assert.equal(X.FLC_RULES[k], FC[k], k);
  assert.deepEqual(Object.keys(X.FLC_CAT), [...FC.CATS], 'a name and a question for every category');
  for (const t of [Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 11, 23, 59), Date.UTC(2026, 10, 12), Date.UTC(2026, 10, 18, 23, 59), Date.UTC(2026, 10, 19), Date.UTC(2026, 10, 24), Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 11, 23), Date.UTC(2026, 11, 12), Date.UTC(2027, 0, 31, 23), Date.UTC(2027, 1, 28, 12), Date.UTC(2027, 2, 5), Date.UTC(2028, 1, 29)]) {
    const id = fcId(t);
    assert.equal(X.flcId(t), id); assert.deepEqual({ ...X.flcTimes(id) }, fcTimes(id)); assert.equal(X.flcPhase(id, t), fcPhase(id, t)); assert.equal(X.flcPrev(id), fcPrev(id));
  }
  assert.match(html, /FLAG_SCOPES\.fc=\{get:\(\)=>FLC\.draft/, 'the entry is designed on a draft of its own');
  assert.match(html, /if\(flcCanon\(e\)===flcCanon\(n\.flag\)\)\{toast\('That is your national flag/, 'and may not be the national flag');
});

test('judging pays in land: a credit for every five flags, ten at most; and the achievements have a category of their own', async () => {
  const fs = await import('node:fs'), vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
  const from = (start, end) => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf(end, at) + end.length); };
  const ctx = vm.createContext({});
  vm.runInContext([from('const FLC_RULES=', '\n'), from('const flcLand=', '\n'), from('function flcStreak(n){', 'return best;}')].join('\n') + '\nthis.X={FLC_RULES,flcLand,flcStreak};', ctx);
  const { FLC_RULES: R, flcLand, flcStreak } = ctx.X;
  assert.equal(R.JUDGE_PER, 5); assert.equal(R.JUDGE_LAND, 10);
  assert.equal(flcLand({ fcl: 3 }), 3); assert.equal(flcLand({ fcl: 10 }), 10); assert.equal(flcLand({ fcl: 99 }), 10, 'never more than ten');
  for (const n of [null, {}, { fcl: 0 }, { fcl: -2 }, { fcl: 2.5 }, { fcl: '4' }, { fcl: 4, npc: true }]) assert.equal(flcLand(n), 0);
  // the credit is counted wherever land is, for the nation itself and for those who look at it, and scoring is never stopped
  assert.match(html, /\nlandEarned=\(f=>function\(n\)\{return f\.apply\(this,arguments\)\+flcLand\(n\);\}\)\(landEarned\);\n/);
  assert.match(html, /\nearnedAt=\(f=>function\(n\)\{return f\.apply\(this,arguments\)\+flcLand\(n\);\}\)\(earnedAt\);\n/);
  assert.match(html, /const due=Math\.min\(M,Math\.floor\(tallyOf\(m,'fcj'\)\/P\)\);if\(due>had\)m\.fcl=due;/);
  // months entered one after another
  assert.equal(flcStreak({ fce: ['2026-11', '2026-12', '2027-01'] }), 3, 'a run goes on over the new year');
  assert.equal(flcStreak({ fce: ['2026-11', '2027-01', '2027-02', '2027-04'] }), 2);
  assert.equal(flcStreak({ fce: ['2027-03', '2027-03', 'x', 7] }), 1); assert.equal(flcStreak({}), 0); assert.equal(flcStreak(null), 0);
  // the achievements
  const defs = [...html.matchAll(/^achDef\('flag','(fc-[a-z0-9]+)','([bsgp])','([^']+)','([^']+)'/gm)].map(m => ({ id: m[1], t: m[2], n: m[3], d: m[4] }));
  assert.equal(defs.length, 17); assert.equal(new Set(defs.map(a => a.id)).size, 17);
  const named = [...html.matchAll(/'[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => m[1]);   // every achievement's name: a tier, then the name, in achDef calls and in rows
  for (const a of defs) assert.equal(named.filter(x => x === a.n).length, 1, a.n + ' is the name of one achievement');
  assert.ok(!defs.some(a => /stars? in every category/.test(a.d)), 'none is paid for what the stars were');
  assert.match(html, /ACH_CATS\.splice\(ACH_CATS\.length-1,0,\['flag','The Flag Competition'\]\);ACH_CAT\.flag='The Flag Competition';/);
  assert.doesNotMatch(html, /achDef\('odd','fc-/, 'none is left among the oddities');
});

test('a skipped flag goes to the back of the judge’s queue, and comes again once the others are scored', () => {
  const pool = [{ id: 'a', n: 0 }, { id: 'b', n: 0 }, { id: 'c', n: 1 }, { id: 'd', n: 2 }];
  const plain = fcDeal(pool, [], 'judge', 10);
  assert.equal(plain.length, 4);
  const later = fcDeal(pool, [], 'judge', 10, new Set(['a']));
  assert.equal(later[later.length - 1], 'a', 'the skipped flag is dealt last');
  assert.deepEqual(later.slice(0, 3), plain.filter(x => x !== 'a'), 'the others keep their order');
  assert.deepEqual(fcDeal(pool, ['b', 'c', 'd'], 'judge', 10, ['a']), ['a'], 'with every other flag scored it comes back');
  assert.deepEqual(fcDeal(pool, [], 'judge', 2, ['a', 'b']), ['c', 'd'], 'a batch is filled with unskipped flags first');
});

test('the staff’s marks: a drive-by visit, a flag lifted far above the other judges’ view, the same score for everything', () => {
  const s = x => [x, x, x, x, x];
  const votes = [
    { uid: 'drive', v: { f1: s(5) } },                                          // scored one flag, five stars
    { uid: 'shy', v: { f2: s(3) } },                                            // one flag, an ordinary score: no mark
    { uid: 'fav', v: { f1: s(2), f2: s(2), f3: s(5), f4: s(3) } },             // f3: five stars where the others give it two
    { uid: 'flat', v: { f1: s(3), f2: s(3), f3: s(3), f4: s(3), f5: s(3) } },  // the same for all
    { uid: 'fair', v: { f1: s(4), f2: s(2), f3: s(1), f4: s(4), f5: s(1) } },  // a judge who judges
    { uid: 'fair2', v: { f1: s(4), f3: s(2), f5: s(2) } }
  ];
  const { judges, flags } = fcSuspect(votes), J = Object.fromEntries(judges.map(j => [j.uid, j]));
  assert.deepEqual(J.drive.notes, ['drive']); assert.equal(J.drive.fav, 'f1');
  assert.deepEqual(J.shy.notes, []); assert.deepEqual(J.fair.notes, []); assert.deepEqual(J.fair2.notes, []);
  assert.deepEqual(J.fav.notes, ['fav']); assert.equal(J.fav.fav, 'f3');
  assert.deepEqual(J.flat.notes, ['flat']); assert.equal(J.flat.fav, undefined);
  assert.equal(flags.f1.sus, 2, 'f1: the drive-by and the flat judge'); assert.equal(flags.f1.cn, 3); assert.equal(flags.f1.clean, 3.3333);
  assert.equal(flags.f3.sus, 2, 'f3: the lifted rating and the flat judge'); assert.equal(flags.f5.sus, 1);
  assert.equal(J.fair.mean, 2.4);
  /* a judge who loves the month's best flag, as everyone does, is not marked */
  const best = fcSuspect([{ uid: 'a', v: { b: s(5), c: s(2), d: s(2) } }, { uid: 'b', v: { b: s(5), c: s(3), d: s(2) } }, { uid: 'c', v: { b: s(5), c: s(2), d: s(3) } }]);
  assert.ok(best.judges.every(j => !j.notes.length), JSON.stringify(best.judges));
  assert.deepEqual(fcSuspect([]), { judges: [], flags: {} });
  assert.deepEqual(fcSuspect([{ uid: 'x', v: { f1: [9, 9, 9, 9, 9] } }]).judges, [], 'a broken rating is no rating');
  assert.ok(FC_SUS.DRIVE >= 1 && FC_SUS.FAV_GAP > 0 && FC_SUS.FAV_OTHERS >= 1);
});

test('the reminder by post: who wants it, and what it says', () => {
  assert.ok(KINDS.includes('fc'));
  assert.equal(fcWanted({ msg: true, fc: false }), false, 'switched off');
  assert.equal(fcWanted({ msg: false, fc: true }), true, 'switched on');
  assert.equal(fcWanted({ msg: true, war: false }), true, 'an account from before the kind existed, still taking letters');
  assert.equal(fcWanted({ msg: false, now: false, war: false, dip: false, news: false, away: false }), false, 'one that stopped every letter');
  assert.equal(fcWanted({ now: true }), false); assert.equal(fcWanted(null), false);
  const cfg = { site: 'https://example.test' }, close = Date.UTC(2026, 10, 24);
  const a = fcLetter(cfg, { to: 'a@example.test', nation: 'Eternia <b>', left: 4, duty: 10, close, last: false, tok: 't1' });
  assert.match(a.subject, /^Judging is open: your flag needs you to score 4 more flags$/);
  assert.match(a.html, /10 flags<\/b> of the others/); assert.match(a.html, /#flagcomp/); assert.doesNotMatch(a.html, /Eternia <b>/, 'the name is escaped');
  assert.match(a.html, /Tue, 24 Nov 2026 00:00 UTC/);
  const b = fcLetter(cfg, { to: 'a@example.test', nation: 'Eternia', left: 1, duty: 3, close, last: true, tok: 't1' });
  assert.equal(b.subject, 'Last day: score one more flag to keep your flag in');
  assert.match(b.text, /mail\?t=t1/); assert.equal(b.unsub, 'https://example.test/mail?t=t1');
});

test('the page: a changed score adds nothing, a skip goes to the server, the draft follows the player, the desk task counts first scores', async () => {
  const fs = await import('node:fs'), vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
  const from = (start, end) => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf(end, at) + end.length); };
  // only a flag's first score moves the tally, and so land, achievements and the desk
  const rate = from('async function flcRate(){', '\n}\n');
  assert.match(rate, /const first=!\(r&&r\.first===false\);/);
  assert.match(rate, /if\(first\)\{\n\s*const m=clone\(S\.nation\)[^]*gbBump\(m,'fcj',1,t\);/);
  assert.match(from('async function flcSkip(){', '\n}\n'), /cbCall\(\{op:'fcSkip',e:cur\.id\}\)/);
  // the server's ops, all reachable through civic
  const core = fs.readFileSync(new URL('../functions/flagcomp.js', import.meta.url), 'utf8');
  assert.match(core, /const OPS = \{ fcState, fcEnter, fcWithdraw, fcRemove, fcNext, fcRate, fcSkip, fcMine, fcReport, fcDraft, fcAdmin, fcDismiss, fcCloseNow \};/);
  // this device's draft: the new {f, t}, or a bare design kept before, counted as old
  const store = {}, ctx = vm.createContext({ localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } });
  vm.runInContext(from('const flcDraftKey=', '\n') + '\n' + from('function flcLocal(n){', 'return o.p?{f:o,t:0}:null;}catch(e){return null;}}') + '\nthis.X={flcDraftKey,flcLocal};', ctx);
  const { flcDraftKey, flcLocal } = ctx.X, n = { seed: 7 };
  assert.equal(flcLocal(n), null);
  store[flcDraftKey(n)] = JSON.stringify({ p: 'bi-v', c: ['#000000', '#FFFFFF', '#FF0000'] });
  assert.deepEqual(JSON.parse(JSON.stringify(flcLocal(n))), { f: { p: 'bi-v', c: ['#000000', '#FFFFFF', '#FF0000'] }, t: 0 });
  store[flcDraftKey(n)] = JSON.stringify({ f: { p: 'tri-h' }, t: 99 });
  assert.equal(flcLocal(n).t, 99); assert.equal(flcLocal(n).f.p, 'tri-h');
  store[flcDraftKey(n)] = '[1,2]'; assert.equal(flcLocal(n), null); store[flcDraftKey(n)] = '{'; assert.equal(flcLocal(n), null);
  // the desk task: counted from the tally fcj, and kept through a reload
  const desk = from('COMMIT_HOOKS.push((n,old,now)=>{\n  if(!n||n.npc||!n.name||!n.dd||!ddOn())return;', '\n});\n');
  assert.match(desk, /tallyOf\(n,'fcj'\)-tallyOf\(base,'fcj'\)/);
  assert.match(html, /NORM_HOOKS\.push\(\(n,d\)=>\{const F=d&&d\.dd&&d\.dd\.f;if\(n\.dd&&F&&d\.dd\.d===n\.dd\.d/);
});
