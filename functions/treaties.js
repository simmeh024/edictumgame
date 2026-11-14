import { HttpsError } from 'firebase-functions/v2/https';
import { eligibility, refuse, nationJSON } from './eligibility.js';
import { NPC, npcAffinity, warWithNpc } from './alliances.js';
import { TR_KINDS, TR_MAX, TR_NOTICE, TR_RECORD, TR_REOFFER, TR_NPC_MIN, trId, trLive, trVoid } from './treaty-rules.js';

/* Treaties between two nations, written only here (civic ops tr*): a non-aggression pact, a trade agreement or a
   research pact (functions/treaty-rules.js holds the data's shape and the rules). A player offers one; the other
   player accepts or declines it, and a computer nation answers at once by its affinity. Either side may end one with
   notice, or break it at once: a broken treaty stays on the breaker's record for a month, and no computer nation signs
   with a recent breaker. The referee (functions/index.js) refuses a battle between the two sides of a live
   non-aggression pact; the game applies the trade agreement and the research pact, and the goodwill a breaker loses. */
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const isUid = v => isId(v) && !v.startsWith('npc-');
const isTid = v => typeof v === 'string' && /^(nap|trade|research)_[\w-]{1,128}_[\w-]{1,128}$/.test(v);
const regOf = e => e.n.reg || e.saved.get('reg') || '';
const founded = n => Number.isFinite(Number(n && n.founded)) && Number(n.founded) > 0 ? Number(n.founded) : 0;
export const TR_NAME = { nap: 'non-aggression pact', trade: 'trade agreement', research: 'research pact' };
const PLURAL = { nap: 'non-aggression pacts', trade: 'trade agreements', research: 'research pacts' };

/* every treaty a nation is party to, read in the transaction */
async function partyTo(tx, db, id) {
  const qs = await tx.get(db.collection('treaties').where('p', 'array-contains', id));
  return qs.docs.map(s => ({ id: s.id, ref: s.ref, T: s.data() }));
}
/* those that count against its limit of a kind: in force, or offered by it */
const holding = (list, id, k, now, skip) => list.filter(x => x.id !== skip && x.T.k === k && (trLive(x.T, now) || (x.T.st === 'offered' && x.T.a === id))).length;
/* finished: a notice run out, or a break off the record; these go when the transaction writes */
const done = (T, now) => (T.st === 'ending' && now >= (Number(T.end) || 0)) || (T.st === 'broken' && now - (Number(T.bt) || 0) >= TR_RECORD);
const brokeLately = (list, id, now) => list.some(x => x.T.st === 'broken' && x.T.by === id && now - (Number(x.T.bt) || 0) < TR_RECORD);
function full(list, id, k, now, skip, whose) {
  if (holding(list, id, k, now, skip) >= TR_MAX[k])
    refuse('tr_max', whose ? `${whose} already holds ${TR_MAX[k]} ${PLURAL[k]}, the most a nation may.` : `You already hold ${TR_MAX[k]} ${PLURAL[k]}, the most a nation may. End one first.`);
}
async function loadTreaty(tx, db, d) {
  const tid = isTid(d.tid) ? d.tid : '';
  if (!tid) throw new HttpsError('invalid-argument', 'Choose a treaty.');
  const ref = db.doc('treaties/' + tid), s = await tx.get(ref);
  return { tid, ref, T: s.exists ? s.data() : null };
}

/* an offer: to a player, waiting for their answer (or signed, if they had offered the same); to a computer nation,
   answered at once */
async function trOffer(db, who, d) {
  const k = TR_KINDS.includes(d.k) ? d.k : '', id = isId(d.id) ? d.id : '';
  if (!k || !id || id === who.uid) throw new HttpsError('invalid-argument', 'Choose a nation and a kind of treaty.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e), now = Date.now(), tid = trId(k, who.uid, id), ref = db.doc('treaties/' + tid);
    const npc = NPC.get(id);
    if (!npc && !isUid(id)) throw new HttpsError('invalid-argument', 'Choose a nation of your region.');
    const other = npc ? null : await tx.get(db.doc('nations/' + id));
    if (npc ? npc.reg !== reg : !other.exists || (other.get('reg') || '') !== reg) refuse('tr_region', 'That nation is not in your region.');
    const [cur, mine, theirs] = await Promise.all([tx.get(ref), partyTo(tx, db, who.uid), npc ? Promise.resolve([]) : partyTo(tx, db, id)]);
    const O = npc ? null : nationJSON(other), recs = { [who.uid]: e.n, ...(O ? { [id]: O } : {}) };
    let T = cur.exists ? cur.data() : null;
    if (T && (done(T, now) || trVoid(T, recs))) T = null;
    if (T && trLive(T, now)) refuse('tr_exists', `A ${TR_NAME[k]} with that nation is already in force.`);
    if (T && T.st === 'offered' && T.a === who.uid) refuse('tr_offered', 'You have already offered it. It waits for their answer.');
    if (T && T.st === 'broken' && now - (Number(T.bt) || 0) < TR_REOFFER) refuse('tr_wait', `That ${TR_NAME[k]} was broken less than ${TR_REOFFER / 86400000} days ago. It can be signed again from ${new Date((Number(T.bt) || 0) + TR_REOFFER).toISOString().slice(0, 10)}.`);
    const f = { ...(founded(e.n) ? { [who.uid]: founded(e.n) } : {}), ...(O && founded(O) ? { [id]: founded(O) } : {}) };
    const base = { k, reg, p: [who.uid, id].sort(), f };
    let out;
    if (npc) {
      if (warWithNpc(e.n, id)) refuse('tr_war', `You are at war with ${npc.name}. Make peace first.`);
      if (brokeLately(mine, who.uid, now)) refuse('tr_breaker', `${npc.name} signs nothing with a nation that broke a treaty in the last ${TR_RECORD / 86400000} days.`);
      const af = npcAffinity(id, e.n);
      if (af < TR_NPC_MIN[k]) refuse('tr_npc', `${npc.name} declined: its affinity with you is ${af}, and a ${TR_NAME[k]} needs ${TR_NPC_MIN[k]}.`);
      full(mine, who.uid, k, now, tid);
      tx.set(ref, { ...base, a: who.uid, b: id, st: 'active', t: now, at: now, npc: true });
      out = { ok: true, tid, signed: true };
    } else if (T && T.st === 'offered' && T.a === id) {
      /* they had offered the same: signing it is accepting theirs */
      full(mine, who.uid, k, now, tid); full(theirs, id, k, now, tid, nameOf(O));
      tx.set(ref, { ...base, a: id, b: who.uid, st: 'active', t: Number(T.t) || now, at: now });
      out = { ok: true, tid, signed: true };
    } else {
      full(mine, who.uid, k, now, tid); full(theirs, id, k, now, tid, nameOf(O));
      tx.set(ref, { ...base, a: who.uid, b: id, st: 'offered', t: now });
      out = { ok: true, tid, signed: false };
    }
    for (const x of mine.concat(theirs)) if (x.id !== tid && done(x.T, now)) tx.delete(x.ref);
    return out;
  });
}
const nameOf = n => (n && typeof n.name === 'string' && n.name.slice(0, 80)) || 'That nation';

/* the other side's answer: accepted, it is in force; declined, it is gone */
async function trAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, d.yes ? {} : { linked: false, hidden: true }), now = Date.now();
    const { tid, ref, T } = await loadTreaty(tx, db, d);
    if (!T || T.st !== 'offered' || T.b !== who.uid) refuse('tr_gone', 'That offer is no longer there.');
    if (!d.yes) { tx.delete(ref); return { ok: true }; }
    const ps = await tx.get(db.doc('nations/' + T.a)), P = nationJSON(ps);
    if (!ps.exists || (ps.get('reg') || '') !== regOf(e) || trVoid(T, { [T.a]: P })) { tx.delete(ref); return { ok: false, why: 'gone' }; }
    const [mine, theirs] = await Promise.all([partyTo(tx, db, who.uid), partyTo(tx, db, T.a)]);
    full(mine, who.uid, T.k, now, tid); full(theirs, T.a, T.k, now, tid, nameOf(P));
    const f = { ...(founded(P) ? { [T.a]: founded(P) } : {}), ...(founded(e.n) ? { [who.uid]: founded(e.n) } : {}) };
    tx.update(ref, { st: 'active', at: now, f });
    return { ok: true, signed: true };
  });
}
/* an offer taken back before it is answered */
async function trCancel(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, T } = await loadTreaty(tx, db, d);
    if (T && T.st === 'offered' && T.a === who.uid) tx.delete(ref);
    return { ok: true };
  });
}
/* ending with notice (in force until it runs out), or breaking at once */
async function trEnd(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, T } = await loadTreaty(tx, db, d), now = Date.now();
    if (!T || !Array.isArray(T.p) || !T.p.includes(who.uid) || !trLive(T, now)) refuse('tr_gone', 'That treaty is not in force.');
    if (d.now) {
      tx.update(ref, { st: 'broken', bt: now, by: who.uid });
      return { ok: true, broken: true, k: T.k, other: T.p.find(x => x !== who.uid) };
    }
    if (T.st === 'ending') return { ok: true, end: T.end };
    const end = now + TR_NOTICE;
    tx.update(ref, { st: 'ending', end, by: who.uid });
    return { ok: true, end };
  });
}

/* a nation that is deleted (its account, or by an admin) is party to nothing; called outside any other transaction */
export async function trDrop(db, uid) {
  try {
    const qs = await db.collection('treaties').where('p', 'array-contains', uid).get();
    if (qs.empty) return;
    const b = db.batch(); qs.docs.forEach(s => b.delete(s.ref)); await b.commit();
  } catch (e) { console.warn('trDrop', uid, e && e.message); }
}

const OPS = { trOffer, trAnswer, trCancel, trEnd };
export const isTreatyOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function treaty(db, who, d) { return OPS[d.op](db, who, d); }
