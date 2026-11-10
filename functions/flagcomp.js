import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { eligibility, refuse, DAY } from './eligibility.js';
import { FC, FC_REPORT, fcId, fcIdOk, fcTimes, fcPhase, fcPrev, fcStars, fcDuty, fcRank, fcDeal, fcFlagText, fcScore, fcSuspect } from './flagcomp-core.js';
import { fcAward } from './flagcomp-prize.js';

/* The flag competition: one a month for every region together, kept wholly here (civic ops fc*), so nobody can see
   whose flag they are scoring, read a score before the end, or write one.
     flagc/{comp}                 public: {n: flags entered, st: 'open' | 'done', res?: the results, hw?: 1 once the hall is written}
                                  res {at, need, duty, all: flags that placed, top: [{e, u, nm, rg, fl, s, n, c}] the podium,
                                  club?: 1 once the winner's Chancery Club month is granted}
     flagc/{comp}/hall/{eid}      public, written when judging closes: every flag with its owner and score
                                  {u, nm, rg, fl, t, s, n, c, pl: place (0: did not place), why?: 'few' | 'duty'}
     flagc/{comp}/flags/{eid}     server only: an entry {u, nm, rg, fl: the design as JSON, t, n: ratings so far}
     flagc/{comp}/mine/{uid}      server only: {e: the entry of this player}
     flagc/{comp}/votes/{uid}     server only: a judge's ratings {v: {eid: '54353'}, t, k?: {eid: when skipped}}
     flagc/{comp}/reps/{eid~uid}  server only: a judge's report of a flag {e, by, why, note, t}; the flag keeps the
                                  count in rp, and the staff's page lists them
     fcDraft/{uid}                server only: the design a player is working on, so another device opens it {fl, t}
   comp is the month, '2026-12' (flagcomp-core.js has the calendar and the scoring). A competition is closed by the
   first request after its judging ends: there is no timer, and the prizes wait for nobody but the next player to
   open the page. Entering and scoring are for Registered Nations; scoring also needs a nation a day old. */
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const root = id => 'flagc/' + id;
/* the emulators may shift the competition's clock (flagcTest/clock {skew}), so a test can walk through a month */
async function clock(db) {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return Date.now();
  const s = await db.doc('flagcTest/clock').get();
  return Date.now() + (s.exists ? Number(s.get('skew')) || 0 : 0);
}
const stars = code => String(code || '').split('').map(Number);

/* what the page needs: the month, the phase by the server's clock, how many flags are in, the caller's own entry and
   how many flags they have scored. It also closes whatever is due. */
async function fcState(db, who) {
  const now = await clock(db), id = fcId(now);
  await closeDue(db, now);
  const phase = fcPhase(id, now);
  const [sum, mine, votes, draft] = await Promise.all([db.doc(root(id)).get(), db.doc(root(id) + '/mine/' + who.uid).get(), db.doc(root(id) + '/votes/' + who.uid).get(),
    phase === 'enter' ? db.doc('fcDraft/' + who.uid).get() : null]);
  let entry = null;
  if (mine.exists) { const e = await db.doc(root(id) + '/flags/' + mine.get('e')).get(); if (e.exists) entry = { fl: e.get('fl'), t: e.get('t') }; }
  const n = (sum.exists && sum.get('n')) || 0;
  return { id, now, phase, t: fcTimes(id), n, duty: fcDuty(n), mine: entry, judged: votes.exists ? Object.keys(votes.get('v') || {}).length : 0, reg: !!who.registered,
    ...(draft && draft.exists && typeof draft.get('fl') === 'string' ? { draft: { fl: draft.get('fl'), t: draft.get('t') || 0 } } : {}) };
}
/* the design being worked on, kept for the player's other devices (fl null forgets it) */
async function fcDraft(db, who, d) {
  const ref = db.doc('fcDraft/' + who.uid);
  if (d.fl === null) { await ref.delete(); return { ok: true }; }
  const text = fcFlagText(d.fl);
  if (!text) throw new HttpsError('invalid-argument', 'That design cannot be kept.');
  const now = await clock(db);
  await ref.set({ fl: text, t: now });
  return { ok: true, t: now };
}

/* enter a design, or replace the one entered, while entries are open */
async function fcEnter(db, who, d) {
  const text = fcFlagText(d.fl);
  if (!text) throw new HttpsError('invalid-argument', 'That design cannot be entered.');
  const now = await clock(db), id = fcId(now);
  if (fcPhase(id, now) !== 'enter') refuse('fc_closed', 'Entries are closed for this month’s competition.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: true }), mineRef = db.doc(root(id) + '/mine/' + who.uid), mine = await tx.get(mineRef);
    const ref = mine.exists ? db.doc(root(id) + '/flags/' + mine.get('e')) : db.collection(root(id) + '/flags').doc();
    const headRef = db.doc(root(id)), head = mine.exists ? null : await tx.get(headRef);   // first: no flag was in before this one
    tx.set(ref, { u: who.uid, nm: String(e.n.name || '').slice(0, 80), rg: String(e.n.reg || '').slice(0, 40), fl: text, t: now, n: 0 });
    if (!mine.exists) { tx.set(mineRef, { e: ref.id, t: now }); tx.set(headRef, { n: FieldValue.increment(1), st: 'open' }, { merge: true }); }
    return { ok: true, t: now, first: !!head && !(head.get('n') > 0) };
  });
}

async function drop(db, id, uid) {
  return db.runTransaction(async tx => {
    const mineRef = db.doc(root(id) + '/mine/' + uid), mine = await tx.get(mineRef);
    if (!mine.exists) return false;
    tx.delete(db.doc(root(id) + '/flags/' + mine.get('e'))); tx.delete(mineRef);
    tx.set(db.doc(root(id)), { n: FieldValue.increment(-1) }, { merge: true });
    return true;
  });
}
/* take one's flag out again, while entries are open */
async function fcWithdraw(db, who) {
  const now = await clock(db), id = fcId(now);
  if (fcPhase(id, now) !== 'enter') refuse('fc_closed', 'Entries are closed: the flag stays in.');
  return { ok: await drop(db, id, who.uid) };
}
async function judging(db, who) {
  const now = await clock(db), id = fcId(now);
  if (fcPhase(id, now) !== 'judge') refuse('fc_not_judging', 'Judging is not open.');
  return { now, id };
}
/* the next flags to score: designs only, no names; the least-rated first, never the judge's own or one already scored */
async function fcNext(db, who) {
  const { id } = await judging(db, who);
  await db.runTransaction(tx => eligibility(tx, who, { linked: true, age: DAY }));
  const [mine, votes] = await Promise.all([db.doc(root(id) + '/mine/' + who.uid).get(), db.doc(root(id) + '/votes/' + who.uid).get()]);
  const seen = new Set(votes.exists ? Object.keys(votes.get('v') || {}) : []), own = mine.exists ? mine.get('e') : '';
  const later = new Set(votes.exists ? Object.keys(votes.get('k') || {}) : []);
  const pool = [], by = new Map();
  let last = null, fresh = 0;
  /* skipped flags wait at the back: read on until a batch of others is found (or every flag is read) */
  for (let page = 0; page < 8 && fresh < FC.BATCH; page++) {
    let q = db.collection(root(id) + '/flags').orderBy('n').limit(60);
    if (last) q = q.startAfter(last);
    const qs = await q.get();
    for (const f of qs.docs) { by.set(f.id, f); pool.push({ id: f.id, n: f.get('n') || 0, skip: f.id === own }); if (f.id !== own && !seen.has(f.id) && !later.has(f.id)) fresh++; }
    if (qs.size < 60) break;
    last = qs.docs[qs.docs.length - 1];
  }
  const ids = fcDeal(pool, seen, who.uid, FC.BATCH, later);
  return { flags: ids.map(e => ({ id: e, fl: by.get(e).get('fl'), ...(later.has(e) ? { sk: 1 } : {}) })), judged: seen.size };
}
/* score a flag: five categories, one to five stars. A judge may change their mind until judging closes: first says
   whether this was the flag's first score from this judge (only those count towards the judge's tally). */
async function fcRate(db, who, d) {
  const s = fcStars(d.s), eid = id20(d.e);
  if (!s || !eid) throw new HttpsError('invalid-argument', 'Give every category one to five stars.');
  const { now, id } = await judging(db, who);
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: true, age: DAY });
    const fRef = db.doc(root(id) + '/flags/' + eid), vRef = db.doc(root(id) + '/votes/' + who.uid), f = await tx.get(fRef), v = await tx.get(vRef);
    if (!f.exists) refuse('fc_gone', 'That flag is no longer in the competition.');
    if (f.get('u') === who.uid) refuse('fc_own', 'You cannot score your own flag.');
    const had = v.exists ? v.get('v') || {} : {}, first = !had[eid], skipped = v.exists && v.get('k') && v.get('k')[eid];
    tx.set(vRef, { v: { [eid]: s.join('') }, t: now, ...(skipped ? { k: { [eid]: FieldValue.delete() } } : {}) }, { merge: true });
    if (first) tx.update(fRef, { n: FieldValue.increment(1) });
    return { ok: true, first, judged: Object.keys(had).length + (first ? 1 : 0) };
  });
}
/* put a flag aside: it is dealt again only once every other flag is scored */
async function fcSkip(db, who, d) {
  const eid = id20(d.e);
  if (!eid) throw new HttpsError('invalid-argument', 'Choose a flag.');
  const { now, id } = await judging(db, who);
  const v = await db.doc(root(id) + '/votes/' + who.uid).get();
  if (v.exists && (v.get('v') || {})[eid]) return { ok: true };
  if (v.exists && Object.keys(v.get('k') || {}).length >= 400) return { ok: true };
  await db.doc(root(id) + '/votes/' + who.uid).set({ k: { [eid]: now } }, { merge: true });
  return { ok: true };
}
/* the flags a judge has scored this month, with their stars, so a score can be changed until judging closes */
async function fcMine(db, who) {
  const { id } = await judging(db, who);
  const v = await db.doc(root(id) + '/votes/' + who.uid).get(), m = v.exists ? v.get('v') || {} : {};
  const ids = Object.keys(m).filter(e => id20(e)).slice(0, 300), out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const docs = await db.getAll(...ids.slice(i, i + 100).map(e => db.doc(root(id) + '/flags/' + e)));
    for (const f of docs) if (f.exists) out.push({ id: f.id, fl: f.get('fl'), s: stars(m[f.id]) });
  }
  return { flags: out };
}
/* a judge reports a flag to the staff (a symbol of hate, a copy of a nation's flag, anything else). Once per flag and
   judge; a second report replaces the first. At most REPORT_MAX flags a month. */
const REPORT_MAX = 20;
async function fcReport(db, who, d) {
  const eid = id20(d.e), why = FC_REPORT.includes(d.why) ? d.why : '', note = typeof d.note === 'string' ? d.note.replace(/[<>]/g, '').trim().slice(0, 300) : '';
  if (!eid || !why) throw new HttpsError('invalid-argument', 'Choose a flag and a reason.');
  const { now, id } = await judging(db, who);
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: true, age: DAY });
    const fRef = db.doc(root(id) + '/flags/' + eid), rRef = db.doc(root(id) + '/reps/' + eid + '~' + who.uid), vRef = db.doc(root(id) + '/votes/' + who.uid);
    const [f, r, v] = await Promise.all([tx.get(fRef), tx.get(rRef), tx.get(vRef)]);
    if (!f.exists) refuse('fc_gone', 'That flag is no longer in the competition.');
    if (f.get('u') === who.uid) refuse('fc_own', 'You cannot report your own flag.');
    const had = v.exists ? v.get('rp') || 0 : 0;
    if (!r.exists && had >= REPORT_MAX) refuse('fc_reports', 'You have reported as many flags as a judge may this month.');
    tx.set(rRef, { e: eid, by: who.uid, why, note, t: now });
    if (!r.exists) { tx.update(fRef, { rp: FieldValue.increment(1) }); tx.set(vRef, { rp: had + 1 }, { merge: true }); }
    return { ok: true };
  });
}

/* ── the staff's page (admin portal › Flag competition) ── */
const staff = who => { if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Staff only.'); };
const audit = (w, db, who, action, extra) => w.create(db.collection('adminAudit').doc(), { actor: who.uid, action, outcome: 'completed', at: FieldValue.serverTimestamp(), ...extra });
const line = (v, k) => String(v || '').slice(0, k);
/* a month as the staff see it: every entry with its owner, live score and reports, every judge with what looks odd */
async function fcAdmin(db, who, d) {
  staff(who);
  const now = await clock(db), cur = fcId(now), id = fcIdOk(d.id) && d.id <= cur ? d.id : cur;
  const [sum, flags, votes, reps] = await Promise.all([db.doc(root(id)).get(), db.collection(root(id) + '/flags').get(), db.collection(root(id) + '/votes').get(),
    db.collection(root(id) + '/reps').orderBy('t', 'desc').limit(300).get()]);
  const V = votes.docs.map(v => ({ uid: v.id, v: Object.fromEntries(Object.entries(v.get('v') || {}).map(([e, s]) => [e, stars(s)])) }));
  const per = new Map();
  for (const j of V) for (const [e, s] of Object.entries(j.v)) { if (!per.has(e)) per.set(e, []); per.get(e).push(s); }
  const sus = fcSuspect(V), judged = new Map(V.map(j => [j.uid, Object.keys(j.v).length]));
  /* the names (and founding times) of everyone involved, from the public summaries */
  const uids = [...new Set([...flags.docs.map(f => f.get('u')), ...V.map(j => j.uid), ...reps.docs.map(r => r.get('by'))].filter(Boolean))], who2 = new Map();
  for (const f of flags.docs) if (f.get('u')) who2.set(f.get('u'), { nm: line(f.get('nm'), 80), rg: line(f.get('rg'), 40), f: 0 });   // an entrant's name as it entered
  for (let i = 0; i < uids.length; i += 300) {
    const docs = await db.getAll(...uids.slice(i, i + 300).map(u => db.doc('summaries/' + u)), { fieldMask: ['name', 'reg', 'f'] });
    for (const s of docs) if (s.exists) { const was = who2.get(s.id) || {}; who2.set(s.id, { nm: line(s.get('name'), 80) || was.nm || '', rg: line(s.get('reg'), 40) || was.rg || '', f: Number(s.get('f')) || 0 }); }
  }
  const entries = flags.docs.map(f => {
    const sc = fcScore(per.get(f.id) || []), x = sus.flags[f.id];
    return { e: f.id, u: f.get('u'), nm: f.get('nm') || '', rg: f.get('rg') || '', fl: f.get('fl') || '', t: f.get('t') || 0, n: sc.n, s: sc.score, c: sc.cats, rp: f.get('rp') || 0,
      judged: judged.get(f.get('u')) || 0, ...(x && x.sus ? { sus: x.sus, clean: x.clean, cn: x.cn } : {}) };
  }).sort((a, b) => b.rp - a.rp || b.s - a.s || a.t - b.t);
  const judges = sus.judges.map(j => ({ ...j, ...(who2.get(j.uid) || {}), entered: flags.docs.some(f => f.get('u') === j.uid) }))
    .sort((a, b) => b.notes.length - a.notes.length || b.n - a.n);
  const reports = reps.docs.map(r => ({ id: r.id, e: r.get('e'), by: r.get('by'), byNm: (who2.get(r.get('by')) || {}).nm || '', why: r.get('why'), note: r.get('note') || '', t: r.get('t') || 0 }));
  const owners = Object.fromEntries([...who2].map(([u, x]) => [u, x]));
  return { id, cur, now, phase: fcPhase(id, now), t: fcTimes(id), st: sum.exists ? sum.get('st') || 'open' : '', res: sum.exists ? sum.get('res') || null : null,
    duty: fcDuty(flags.size), entries, judges, reports, owners };
}
/* staff take a flag out of the running, at any time before the results */
async function fcRemove(db, who, d) {
  staff(who);
  const eid = id20(d.e), now = await clock(db), id = fcId(now);
  if (!eid) throw new HttpsError('invalid-argument', 'Choose a flag.');
  if (fcPhase(id, now) === 'done') refuse('fc_closed', 'The results are in.');
  const f = await db.doc(root(id) + '/flags/' + eid).get();
  if (!f.exists) return { ok: false };
  const ok = await drop(db, id, f.get('u'));
  if (ok) { const b = db.batch(); audit(b, db, who, 'flagc_remove', { target: line(f.get('u'), 128), name: line(f.get('nm'), 80), reg: line(f.get('rg'), 40), reason: line(d.why, 300) || 'flag competition', comp: id, entry: eid }); await b.commit(); }
  return { ok };
}
/* staff close a flag's reports without taking it out */
async function fcDismiss(db, who, d) {
  staff(who);
  const eid = id20(d.e), now = await clock(db), id = fcIdOk(d.id) ? d.id : fcId(now);
  if (!eid) throw new HttpsError('invalid-argument', 'Choose a flag.');
  const reps = await db.collection(root(id) + '/reps').where('e', '==', eid).get(), b = db.batch(), f = await db.doc(root(id) + '/flags/' + eid).get();
  for (const r of reps.docs) b.delete(r.ref);
  if (f.exists) b.update(f.ref, { rp: 0 });
  audit(b, db, who, 'flagc_dismiss', { target: line(f.exists ? f.get('u') : '', 128), name: line(f.exists ? f.get('nm') : '', 80), comp: id, entry: eid, reports: reps.size });
  await b.commit();
  return { ok: true, n: reps.size };
}
/* staff run the close of whatever is due now (it also runs by itself on the first request after judging) */
async function fcCloseNow(db, who) {
  staff(who);
  await closeDue(db, await clock(db));
  return { ok: true };
}

/* close this month's competition once its judging is over, and last month's if nobody came by in time */
const closing = new Map();
async function closeDue(db, now) {
  const id = fcId(now);
  for (const c of [fcPrev(id), id]) if (fcPhase(c, now) === 'done') {
    if (!closing.has(c)) closing.set(c, fcClose(db, c, now).finally(() => closing.delete(c)));
    await closing.get(c);
  }
}
/* the results: work out the order, publish the podium (once), grant the winner's Club month (once), then write the
   hall. Every step can be taken again by a later request if this one is cut short. */
export async function fcClose(db, id, now) {
  const ref = db.doc(root(id)), sum = await ref.get();
  if (sum.exists && sum.get('st') === 'done' && sum.get('hw') === 1 && sum.get('res.club') === 1) return;
  const [flags, votes] = await Promise.all([db.collection(root(id) + '/flags').get(), db.collection(root(id) + '/votes').get()]);
  if (!flags.size && !sum.exists) return;   // a month nobody entered leaves nothing behind
  const per = new Map(), did = new Map();
  let judges = 0;
  for (const v of votes.docs) {
    const m = v.get('v') || {}, keys = Object.keys(m);
    if (keys.length) judges++;
    did.set(v.id, keys.length);
    for (const e of keys) { if (!per.has(e)) per.set(e, []); per.get(e).push(stars(m[e])); }
  }
  const info = new Map(flags.docs.map(f => [f.id, f]));
  const out = fcRank(flags.docs.map(f => ({ id: f.id, uid: f.get('u'), t: f.get('t'), ratings: per.get(f.id) || [], judged: did.get(f.get('u')) || 0 })), judges);
  const row = r => { const f = info.get(r.id); return { e: r.id, u: r.uid, nm: f.get('nm') || '', rg: f.get('rg') || '', fl: f.get('fl') || '', s: r.score, n: r.n, c: r.cats }; };
  const res = { at: now, need: out.need, duty: out.duty, all: out.ranked.length, top: out.ranked.slice(0, FC.PRIZES.length).map(row) };
  const kept = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists && s.get('st') === 'done') return s.get('res') || res;
    tx.set(ref, { st: 'done', n: flags.size, j: judges, res }, { merge: true });
    return res;
  });
  /* the winner's month of the Chancery Club: fcAward grants it once, whoever calls */
  if (kept.club !== 1) { if (kept.top && kept.top[0]) await fcAward(db, id, kept.top[0].u, now); await ref.set({ res: { club: 1 } }, { merge: true }); }
  if (!(sum.exists && sum.get('hw') === 1)) {
    const rows = [...out.ranked.map(r => ({ ...row(r), t: r.t, pl: r.place })), ...out.out.map(r => ({ ...row(r), t: r.t, pl: 0, why: r.why }))];
    for (let i = 0; i < rows.length; i += 400) {
      const b = db.batch();
      for (const r of rows.slice(i, i + 400)) { const { e, ...rest } = r; b.set(db.doc(root(id) + '/hall/' + e), rest); }
      await b.commit();
    }
    await ref.set({ hw: 1 }, { merge: true });
  }
}

/* a closed account, or a nation an admin removes: its flag leaves an open competition, its ratings go, and the halls
   forget its name (the flag and its score stay, as "a former nation") */
export async function fcForget(db, uid, now = Date.now()) {
  const id = fcId(now);
  for (const c of [id, fcPrev(id)]) {
    if (fcPhase(c, now) !== 'done') await drop(db, c, uid).catch(() => false);
    await db.doc(root(c) + '/votes/' + uid).delete().catch(() => {});
    await db.doc(root(c) + '/mine/' + uid).delete().catch(() => {});
    const reps = await db.collection(root(c) + '/reps').where('by', '==', uid).get().catch(() => ({ docs: [] }));
    for (const r of reps.docs) await r.ref.delete().catch(() => {});
  }
  await db.doc('fcDraft/' + uid).delete().catch(() => {});
  const halls = await db.collectionGroup('hall').where('u', '==', uid).get().catch(() => ({ docs: [] }));
  for (const h of halls.docs) {
    await h.ref.set({ u: '', nm: '', rg: '' }, { merge: true });
    const comp = h.ref.parent.parent, s = await comp.get(), top = (s.exists && s.get('res.top')) || [];
    if (top.some(r => r.u === uid)) await comp.set({ res: { top: top.map(r => (r.u === uid ? { ...r, u: '', nm: '', rg: '' } : r)) } }, { merge: true });
  }
}

const OPS = { fcState, fcEnter, fcWithdraw, fcRemove, fcNext, fcRate, fcSkip, fcMine, fcReport, fcDraft, fcAdmin, fcDismiss, fcCloseNow };
export const isFlagOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function flagOp(db, who, d) { return OPS[d.op](db, who, d); }
