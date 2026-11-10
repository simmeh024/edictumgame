// The flag competition's rules, with no Firebase in them: the calendar, what a rating is, how entries are dealt to
// judges, and how the scores decide the podium. functions/flagcomp.js applies them; game/edictum.html keeps a copy of
// the calendar and the numbers for the page (test/flagcomp.test.mjs checks the two agree).
//
// One competition a month, for every region together. It opens on the 12th (UTC): entries for a week, judging for the
// five days after, and the results stand until the next one opens on the 12th of the month after. A competition is
// named after the month it opens in. Judges give each flag one to five stars in five
// categories; a flag's score is the mean of its judges' averages, with the kindest and the harshest judge left out once
// there are enough of them, so one friend or one grudge moves nothing.
export const FC = Object.freeze({
  CATS: Object.freeze(['simple', 'colour', 'comp', 'orig', 'fly']),
  START_DAY: 12,    // the day of the month a competition opens
  ENTER_DAYS: 7, JUDGE_DAYS: 5,
  MIN_RATINGS: 5,   // ratings a flag needs to place (fewer when there are few judges: see fcNeed)
  TRIM_FROM: 5,     // from this many ratings on, the highest and the lowest judge are left out
  DUTY: 10,         // flags an entrant must score to stay in the running (all the others, when there are fewer)
  BATCH: 10,        // flags dealt to a judge at a time
  PRIZES: Object.freeze([300, 150, 75]), CLUB_DAYS: 30,
  FLAG_MAX: 6000    // most characters of a stored flag design
});
const DAY = 86400000;

/* the competition of a moment: '2026-12' from 12 December to 11 January (the days before the 12th belong to the
   month before) */
export function fcId(now) {
  const d = new Date(now), o = d.getUTCDate() < FC.START_DAY ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)) : d;
  return o.getUTCFullYear() + '-' + String(o.getUTCMonth() + 1).padStart(2, '0');
}
export function fcIdOk(id) { return typeof id === 'string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(id); }
/* its calendar: entries from open, judging from judge, results from close, the next one at end */
export function fcTimes(id) {
  const y = +id.slice(0, 4), m = +id.slice(5, 7) - 1, open = Date.UTC(y, m, FC.START_DAY), judge = open + FC.ENTER_DAYS * DAY;
  return { open, judge, close: judge + FC.JUDGE_DAYS * DAY, end: Date.UTC(y, m + 1, FC.START_DAY) };
}
export function fcPhase(id, now) { const t = fcTimes(id); return now < t.open ? 'soon' : now < t.judge ? 'enter' : now < t.close ? 'judge' : 'done'; }
export function fcPrev(id) { const y = +id.slice(0, 4), m = +id.slice(5, 7) - 1; return fcId(Date.UTC(y, m - 1, 15)); }

/* five whole stars, one to five each, or null */
export function fcStars(v) {
  if (!Array.isArray(v) || v.length !== FC.CATS.length) return null;
  const out = v.map(x => (Number.isInteger(x) && x >= 1 && x <= 5 ? x : 0));
  return out.every(Boolean) ? out : null;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const round = (x, k) => Math.round(x * k) / k;
/* a flag's score from its ratings (each five stars): the mean of the judges' averages, trimmed of the highest and the
   lowest judge once there are TRIM_FROM of them; and each category's plain mean, for the breakdown */
export function fcScore(ratings) {
  const ok = (ratings || []).map(fcStars).filter(Boolean), n = ok.length;
  if (!n) return { n: 0, score: 0, cats: FC.CATS.map(() => 0) };
  let js = ok.map(mean).sort((a, b) => a - b);
  if (n >= FC.TRIM_FROM) js = js.slice(1, -1);
  return { n, score: round(mean(js), 10000), cats: FC.CATS.map((c, i) => round(mean(ok.map(r => r[i])), 100)) };
}
/* ratings a flag needs to place: MIN_RATINGS, or half the judges who turned up when they were few (never under two) */
export function fcNeed(judges) { return Math.max(2, Math.min(FC.MIN_RATINGS, Math.ceil((judges || 0) / 2))); }
/* flags an entrant must have scored: DUTY, or every other entry when there are fewer */
export function fcDuty(entries) { return Math.min(FC.DUTY, Math.max(0, (entries || 0) - 1)); }

/* the final order. entries: [{id, uid, t, ratings: [[5 stars]…], judged: flags this entrant scored}], judges: how many
   players scored anything. Returns ranked (best first, with place from 1) and out (why an entry did not place). Ties go
   to the flag with more ratings, then the better "would you fly it", then the earlier entry. */
export function fcRank(entries, judges) {
  const need = fcNeed(judges), duty = fcDuty((entries || []).length), ranked = [], out = [];
  for (const e of entries || []) {
    const s = fcScore(e.ratings), row = { id: e.id, uid: e.uid, t: e.t || 0, n: s.n, score: s.score, cats: s.cats };
    if ((e.judged || 0) < duty) out.push({ ...row, why: 'duty' });
    else if (s.n < need) out.push({ ...row, why: 'few' });
    else ranked.push(row);
  }
  const fly = FC.CATS.length - 1;
  ranked.sort((a, b) => b.score - a.score || b.n - a.n || b.cats[fly] - a.cats[fly] || a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranked.forEach((r, i) => { r.place = i + 1; });
  return { ranked, out, need, duty };
}

function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/* the next flags for a judge: never their own, never one they have scored or may not score; the least-rated first, so
   every flag gets its share, and in an order of the judge's own among equals. A flag the judge skipped (later) comes
   only after every other, so a skip sends it to the back instead of dealing it again at once. entries: [{id, n, skip}] */
export function fcDeal(entries, seen, seed, k = FC.BATCH, later) {
  const s = seen instanceof Set ? seen : new Set(seen || []), l = later instanceof Set ? later : new Set(later || []);
  return (entries || []).filter(e => e && !e.skip && !s.has(e.id))
    .map(e => ({ id: e.id, n: e.n || 0, h: hash(String(seed) + ':' + e.id), l: l.has(e.id) ? 1 : 0 }))
    .sort((a, b) => a.l - b.l || a.n - b.n || a.h - b.h).slice(0, k).map(e => e.id);
}

/* ratings that do not look like a judgement of the flag, for the staff's page (never applied to the results by
   itself). votes: [{uid, v: {eid: [5 stars]}}]. A judge is marked
     'drive': scored at most DRIVE flags and gave one of them FAV_HIGH or more: a visit to lift one flag;
     'fav':   gave a flag FAV_GAP stars or more above what the other judges gave it (at least FAV_OTHERS of them):
              a friend's flag lifted. Measured against the other judges, not the judge's own other scores, so a
              judge who simply loves the best flag of the month is not marked;
     'flat':  scored FLAT_MIN or more, every one within FLAT_BAND of the same mean: not judging at all.
   The suspect ratings are the lifted flag's (drive, fav) or all of the judge's (flat). For each flag: how many of its
   ratings are suspect, and its score without them. */
export const FC_SUS = Object.freeze({ DRIVE: 2, FAV_HIGH: 4.6, FAV_GAP: 2, FAV_OTHERS: 2, FLAT_MIN: 5, FLAT_BAND: 0.4 });
export function fcSuspect(votes) {
  const J = [], per = new Map();   // per flag: [uid, stars, the judge's average]
  for (const j of votes || []) {
    const rows = Object.entries((j && j.v) || {}).map(([e, s]) => [e, fcStars(s)]).filter(x => x[1]).map(([e, s]) => [e, s, mean(s)]);
    if (!rows.length) continue;
    J.push({ uid: j.uid, rows });
    for (const [e, s, a] of rows) { if (!per.has(e)) per.set(e, []); per.get(e).push([j.uid, s, a]); }
  }
  const judges = [], bad = new Map();
  for (const { uid, rows } of J) {
    const all = mean(rows.map(r => r[2])), notes = [], sus = new Set(), top = rows.reduce((a, b) => (b[2] > a[2] ? b : a));
    if (rows.length <= FC_SUS.DRIVE && top[2] >= FC_SUS.FAV_HIGH) { notes.push('drive'); sus.add(top[0]); }
    else {
      let best = null;
      for (const [e, , a] of rows) {
        const others = per.get(e).filter(x => x[0] !== uid).map(x => x[2]);
        if (others.length < FC_SUS.FAV_OTHERS) continue;
        const gap = a - mean(others);
        if (gap >= FC_SUS.FAV_GAP && (!best || gap > best[1])) best = [e, gap];
      }
      if (best) { notes.push('fav'); sus.add(best[0]); }
    }
    if (rows.length >= FC_SUS.FLAT_MIN && rows.every(r => Math.abs(r[2] - all) <= FC_SUS.FLAT_BAND)) { notes.push('flat'); for (const [e] of rows) sus.add(e); }
    bad.set(uid, sus);
    judges.push({ uid, n: rows.length, mean: round(all, 100), notes, ...(sus.size === 1 && !notes.includes('flat') ? { fav: [...sus][0] } : {}) });
  }
  const flags = {};
  for (const [e, list] of per) {
    const ok = list.filter(([u]) => !bad.get(u).has(e)).map(x => x[1]);
    flags[e] = { sus: list.length - ok.length, clean: fcScore(ok).score, cn: ok.length };
  }
  return { judges, flags };
}
/* why a judge reports a flag */
export const FC_REPORT = Object.freeze(['hate', 'copy', 'other']);

/* a stored design is JSON of a plain object, small enough to keep, with no markup in its strings: the game's own
   flagNorm decides what is drawn, on every player's page, so the server only refuses what could not be a design */
export function fcFlagText(flag) {
  if (!flag || typeof flag !== 'object' || Array.isArray(flag)) return null;
  let text; try { text = JSON.stringify(flag); } catch (e) { return null; }
  if (typeof text !== 'string' || text.length < 2 || text.length > FC.FLAG_MAX || /[<>]/.test(text)) return null;
  return text;
}
