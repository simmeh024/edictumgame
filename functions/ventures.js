import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { eligibility, refuse, nationJSON } from './eligibility.js';
import { NPC, npcAffinity } from './alliances.js';
import { JV_KINDS, JV_HOURS, JV_MAX, JV_ANSWER, JV_NOTICE, JV_KEEP, JV_OLD, JV_NPC_MIN, JV_ID, JV_DOC, jvLive, jvWaiting, jvHolds, jvVoid, jvRoute } from './venture-rules.js';

/* Joint ventures between two neighbouring nations, written only here (civic ops jv*; functions/venture-rules.js holds the
   data's shape and the rules). A Registered Nation proposes one to a nation of its region: a player accepts or declines
   it within two days, and a computer nation answers at once by its affinity. Each side's half is taken by its own save
   and listed in its record (jvp), where this reads it: jvOffer files what the proposer's saved record holds, and jvAnswer
   accepts only once the accepting nation's saved record holds its half. Either side may end one with notice; one that
   is declined, withdrawn or ended stays on record for a while, so both games settle what they paid. The game works out
   what a venture gives, and only while the two nations still hold its route and are at peace. */
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const isUid = v => isId(v) && !v.startsWith('npc-');
const regOf = e => e.n.reg || e.saved.get('reg') || '';
const founded = n => Number.isFinite(Number(n && n.founded)) && Number(n.founded) > 0 ? Number(n.founded) : 0;
const nameOf = n => (n && typeof n.name === 'string' && n.name.slice(0, 80)) || 'That nation';
const paid = n => Array.isArray(n && n.jvp) ? n.jvp.filter(x => x && typeof x === 'object') : [];
/* at war: a war declared later than any peace either side made (the record keeps both, for players and computer nations) */
const atWar = (rec, id) => { const w = Number(rec?.wars?.[id]?.t) || 0, p = Number(rec?.peace?.[id]) || 0; return w > 0 && w > p; };
export const JV_WORD = { road: 'border road', rail: 'border railway', bridge: 'toll bridge' };

/* every venture a nation is party to, read in the transaction */
async function partyTo(tx, db, id) {
  const qs = await tx.get(db.collection('ventures').where('p', 'array-contains', id));
  return qs.docs.map(s => ({ id: s.id, V: s.data() }));
}
function full(list, recs, now, skip, whose) {
  const n = list.filter(x => x.id !== skip && jvHolds(x.V, now) && !jvVoid(x.V, recs)).length;
  if (n >= JV_MAX) refuse(whose ? 'jv_max_them' : 'jv_max', whose ? `${whose} already takes part in ${JV_MAX} joint ventures, the most a nation may.` : `You already take part in ${JV_MAX} joint ventures, the most a nation may. End one, or withdraw an offer, first.`);
}
async function loadVenture(tx, db, d) {
  const vid = typeof d.vid === 'string' && JV_DOC.test(d.vid) ? d.vid : '';
  if (!vid) throw new HttpsError('invalid-argument', 'Choose a joint venture.');
  const ref = db.doc('ventures/' + vid), s = await tx.get(ref);
  return { vid, ref, V: s.exists ? s.data() : null };
}

/* a proposal: the half and the route the proposer's saved record holds (jvp, w 'a', id), filed once; to a player it waits
   for an answer, a computer nation answers at once */
async function jvOffer(db, who, d) {
  const id = typeof d.id === 'string' && JV_ID.test(d.id) ? d.id : '';
  if (!id) throw new HttpsError('invalid-argument', 'Choose a joint venture to propose.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e), now = Date.now(), vid = who.uid + '_' + id, ref = db.doc('ventures/' + vid);
    const cur = await tx.get(ref);
    if (cur.exists) return { ok: true, dup: true, vid, st: cur.get('st') || '' };
    const c = paid(e.n).find(x => x.w === 'a' && x.id === id);
    if (!c) refuse('jv_none', 'That joint venture is not in your saved nation yet. It goes as soon as your nation is saved.');
    if (!Number.isFinite(c.t) || now - c.t > JV_OLD || c.t > now + 60000) refuse('jv_old', 'That proposal waited too long to be sent, so your half is back in your stockpile.');
    const k = JV_KINDS.includes(c.k) ? c.k : '', path = k ? jvRoute(k, c.ca, c.cb, c.path) : null;
    if (!path) refuse('jv_bad', 'That joint venture’s route could not be read.');
    const to = isId(c.to) && c.to !== who.uid ? c.to : '', npc = to ? NPC.get(to) : null;
    if (!to || (!npc && !isUid(to))) refuse('jv_target', 'Choose a nation of your region.');
    const other = npc ? null : await tx.get(db.doc('nations/' + to));
    if (npc ? npc.reg !== reg : !other.exists || (other.get('reg') || '') !== reg) refuse('jv_target', 'That nation is not in your region.');
    const O = npc ? null : nationJSON(other), recs = { [who.uid]: e.n, ...(O ? { [to]: O } : {}) };
    if (atWar(e.n, to) || (O && atWar(O, who.uid))) refuse('jv_war', 'You are at war with that nation. Make peace first.');
    const [mine, theirs] = await Promise.all([partyTo(tx, db, who.uid), npc ? Promise.resolve([]) : partyTo(tx, db, to)]);
    full(mine, recs, now, vid);
    if (!npc) full(theirs, recs, now, vid, nameOf(O));
    if (mine.some(x => x.V.k === k && Array.isArray(x.V.p) && x.V.p.includes(to) && jvHolds(x.V, now) && !jvVoid(x.V, recs)))
      refuse('jv_exists', `You already have a ${JV_WORD[k]} with that nation, built or offered.`);
    const f = { ...(founded(e.n) ? { [who.uid]: founded(e.n) } : {}), ...(O && founded(O) ? { [to]: founded(O) } : {}) };
    const base = { k, reg, p: [who.uid, to].sort(), a: who.uid, b: to, ca: c.ca, cb: c.cb, path, t: now, f };
    if (npc) {
      const af = npcAffinity(to, e.n);
      if (af < JV_NPC_MIN) refuse('jv_npc', `${npc.name} declined: its affinity with you is ${af}, and a joint venture needs ${JV_NPC_MIN}.`);
      const dd = now + JV_HOURS[k] * 3600000;
      tx.create(ref, { ...base, st: 'active', at: now, d: dd, npc: true });
      return { ok: true, vid, st: 'active', d: dd };
    }
    const x = now + JV_ANSWER;
    tx.create(ref, { ...base, st: 'offered', x, exp: Timestamp.fromMillis(x + JV_KEEP) });
    return { ok: true, vid, st: 'offered', x };
  });
}

/* the other side's answer: accepted (once its own saved record holds its half, jvp w 'b', v), it is built; declined, it
   is kept as declined, so the proposer's game gives its half back */
async function jvAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, d.yes ? {} : { linked: false, hidden: true }), now = Date.now();
    const { vid, ref, V } = await loadVenture(tx, db, d);
    if (!V || V.b !== who.uid || !jvWaiting(V, now)) refuse('jv_gone', 'That offer is no longer there.');
    if (!d.yes) { tx.update(ref, { st: 'declined', by: who.uid, dt: now, exp: Timestamp.fromMillis(now + JV_KEEP) }); return { ok: true }; }
    const c = paid(e.n).find(x => x.w === 'b' && x.v === vid);
    if (!c || c.k !== V.k) refuse('jv_none', 'Your half is not in your saved nation yet. The answer goes as soon as your nation is saved.');
    if (!Number.isFinite(c.t) || now - c.t > JV_OLD || c.t > now + 60000) refuse('jv_old', 'That answer waited too long to be sent, so your half is back in your stockpile.');
    const ps = await tx.get(db.doc('nations/' + V.a)), P = nationJSON(ps);
    if (!ps.exists || (ps.get('reg') || '') !== regOf(e) || jvVoid(V, { [V.a]: P })) {
      /* written, not refused, so it stays declined: both games give their halves back */
      tx.update(ref, { st: 'declined', by: who.uid, dt: now, exp: Timestamp.fromMillis(now + JV_KEEP) });
      return { ok: false, why: 'gone' };
    }
    if (atWar(e.n, V.a) || atWar(P, who.uid)) refuse('jv_war', 'You are at war with that nation. Make peace first.');
    full(await partyTo(tx, db, who.uid), { [who.uid]: e.n, [V.a]: P }, now, vid);
    const f = { ...(V.f || {}), ...(founded(e.n) ? { [who.uid]: founded(e.n) } : {}) };
    const dd = now + JV_HOURS[V.k] * 3600000;
    tx.update(ref, { st: 'active', at: now, d: dd, f, x: FieldValue.delete(), exp: FieldValue.delete() });
    return { ok: true, vid, st: 'active', d: dd };
  });
}
/* an offer taken back before it is answered */
async function jvCancel(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, V } = await loadVenture(tx, db, d), now = Date.now();
    if (V && V.st === 'offered' && V.a === who.uid) tx.update(ref, { st: 'declined', by: who.uid, dt: now, exp: Timestamp.fromMillis(now + JV_KEEP) });
    return { ok: true };
  });
}
/* ending with notice: in force until it runs out, then kept on record a while */
async function jvEnd(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, V } = await loadVenture(tx, db, d), now = Date.now();
    if (!V || !Array.isArray(V.p) || !V.p.includes(who.uid) || !jvLive(V, now)) refuse('jv_gone', 'That joint venture is not in force.');
    if (V.st === 'ending') return { ok: true, end: V.end };
    const end = now + JV_NOTICE;
    tx.update(ref, { st: 'ending', end, by: who.uid, exp: Timestamp.fromMillis(end + JV_KEEP) });
    return { ok: true, end, other: V.p.find(x => x !== who.uid) };
  });
}

/* a nation that is deleted (its account, or by an admin) is party to nothing; called outside any other transaction */
export async function jvDrop(db, uid) {
  try {
    const qs = await db.collection('ventures').where('p', 'array-contains', uid).get();
    if (qs.empty) return;
    const b = db.batch(); qs.docs.forEach(s => b.delete(s.ref)); await b.commit();
  } catch (e) { console.warn('jvDrop', uid, e && e.message); }
}

const OPS = { jvOffer, jvAnswer, jvCancel, jvEnd };
export const isVentureOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function venture(db, who, d) { return OPS[d.op](db, who, d); }
