import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { eligibility, refuse, DAY } from './eligibility.js';
import { FC, fcId, fcTimes, fcPhase, fcPrev, fcStars, fcDuty, fcRank, fcDeal, fcFlagText } from './flagcomp-core.js';
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
     flagc/{comp}/votes/{uid}     server only: a judge's ratings {v: {eid: '54353'}, t}
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
  const [sum, mine, votes] = await Promise.all([db.doc(root(id)).get(), db.doc(root(id) + '/mine/' + who.uid).get(), db.doc(root(id) + '/votes/' + who.uid).get()]);
  let entry = null;
  if (mine.exists) { const e = await db.doc(root(id) + '/flags/' + mine.get('e')).get(); if (e.exists) entry = { fl: e.get('fl'), t: e.get('t') }; }
  const n = (sum.exists && sum.get('n')) || 0;
  return { id, now, phase: fcPhase(id, now), t: fcTimes(id), n, duty: fcDuty(n), mine: entry, judged: votes.exists ? Object.keys(votes.get('v') || {}).length : 0, reg: !!who.registered };
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
    tx.set(ref, { u: who.uid, nm: String(e.n.name || '').slice(0, 80), rg: String(e.n.reg || '').slice(0, 40), fl: text, t: now, n: 0 });
    if (!mine.exists) { tx.set(mineRef, { e: ref.id, t: now }); tx.set(db.doc(root(id)), { n: FieldValue.increment(1), st: 'open' }, { merge: true }); }
    return { ok: true, t: now };
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
/* staff take a flag out of the running, at any time before the results */
async function fcRemove(db, who, d) {
  if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Staff only.');
  const eid = id20(d.e), now = await clock(db), id = fcId(now);
  if (!eid) throw new HttpsError('invalid-argument', 'Choose a flag.');
  if (fcPhase(id, now) === 'done') refuse('fc_closed', 'The results are in.');
  const f = await db.doc(root(id) + '/flags/' + eid).get();
  return { ok: f.exists ? await drop(db, id, f.get('u')) : false };
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
  const pool = [], by = new Map();
  let last = null, fresh = 0;
  for (let page = 0; page < 8 && fresh < FC.BATCH; page++) {
    let q = db.collection(root(id) + '/flags').orderBy('n').limit(60);
    if (last) q = q.startAfter(last);
    const qs = await q.get();
    for (const f of qs.docs) { by.set(f.id, f); pool.push({ id: f.id, n: f.get('n') || 0, skip: f.id === own }); if (f.id !== own && !seen.has(f.id)) fresh++; }
    if (qs.size < 60) break;
    last = qs.docs[qs.docs.length - 1];
  }
  const ids = fcDeal(pool, seen, who.uid);
  return { flags: ids.map(e => ({ id: e, fl: by.get(e).get('fl') })), judged: seen.size };
}
/* score a flag: five categories, one to five stars. A judge may change their mind until judging closes. */
async function fcRate(db, who, d) {
  const s = fcStars(d.s), eid = id20(d.e);
  if (!s || !eid) throw new HttpsError('invalid-argument', 'Give every category one to five stars.');
  const { now, id } = await judging(db, who);
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: true, age: DAY });
    const fRef = db.doc(root(id) + '/flags/' + eid), vRef = db.doc(root(id) + '/votes/' + who.uid), f = await tx.get(fRef), v = await tx.get(vRef);
    if (!f.exists) refuse('fc_gone', 'That flag is no longer in the competition.');
    if (f.get('u') === who.uid) refuse('fc_own', 'You cannot score your own flag.');
    const had = v.exists ? v.get('v') || {} : {}, first = !had[eid];
    tx.set(vRef, { v: { [eid]: s.join('') }, t: now }, { merge: true });
    if (first) tx.update(fRef, { n: FieldValue.increment(1) });
    return { ok: true, judged: Object.keys(had).length + (first ? 1 : 0) };
  });
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
  }
  const halls = await db.collectionGroup('hall').where('u', '==', uid).get().catch(() => ({ docs: [] }));
  for (const h of halls.docs) {
    await h.ref.set({ u: '', nm: '', rg: '' }, { merge: true });
    const comp = h.ref.parent.parent, s = await comp.get(), top = (s.exists && s.get('res.top')) || [];
    if (top.some(r => r.u === uid)) await comp.set({ res: { top: top.map(r => (r.u === uid ? { ...r, u: '', nm: '', rg: '' } : r)) } }, { merge: true });
  }
}

const OPS = { fcState, fcEnter, fcWithdraw, fcRemove, fcNext, fcRate };
export const isFlagOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function flagOp(db, who, d) { return OPS[d.op](db, who, d); }
