import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { eligibility, refuse, nationJSON } from './eligibility.js';
import { SC_DAY, SC_MAX, SC_MSG, SC_AGE, SC_OLD, SC_KEEP, SC_ID, SC_DOC, scDay, scContents, scTotal } from './supply-rules.js';

/* Supply Caches between players, written only here (civic ops sc*; functions/supply-rules.js holds the rules).
     supply/{uid}_{id}  {f, fn, to, tn, reg, r, q, m, t, d, x, exp, o}: from f (its nation's name fn) to (tn), in region
                        reg; r the contents {resource: amount} and q their total; m the sender's message ('' if none);
                        t when it was filed and d that UTC day; x when it goes (t + SC_KEEP) for the game's queries, and
                        exp the same for Firestore's TTL; o when it was opened (0 until then)
   The sender's save takes the materials from its stock and lists the cache in its record (scx: [{id, to, r, t, k?}],
   the shared half, as alliance pledges are: functions/alliances.js, alDonate). scSend files the cache the saved record
   holds, so nothing is filed that was not taken, and only once (the document's id is the cache's). The message comes
   with the request and is kept only here, never in the nation's record, which every nation of the region reads.
   Only a Registered Nation sends caches (a linked sign-in, as eligibility() checks; never a guest), and any nation
   receives them. The two nations read the cache (firestore.rules); the recipient opens it with scOpen, which marks it opened once,
   and its game pays the contents only when this says it was the first opening. */
const isUid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-');
const body = (x, max) => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const nameOf = n => (n && typeof n.name === 'string' && n.name.trim().slice(0, 80)) || 'A nation';
const regOf = e => e.n.reg || e.saved.get('reg') || '';

async function scSend(db, who, d) {
  const id = typeof d.id === 'string' && SC_ID.test(d.id) ? d.id : '';
  if (!id) throw new HttpsError('invalid-argument', 'Choose a cache to send.');
  const m = body(d.m, SC_MSG);
  return db.runTransaction(async tx => {
    /* a Registered Nation only (a linked sign-in): eligibility refuses a guest (registration_required) */
    const e = await eligibility(tx, who), now = Date.now(), reg = regOf(e);
    const ref = db.doc('supply/' + who.uid + '_' + id), cur = await tx.get(ref);
    if (cur.exists) return { ok: true, dup: true, t: Number(cur.get('t')) || now };
    if (now - e.born < SC_AGE) refuse('sc_young', 'Supply Caches can be sent from a day after your nation was founded.');
    const c = (Array.isArray(e.n.scx) ? e.n.scx : []).find(x => x && x.id === id);
    if (!c) refuse('sc_none', 'That cache is not in your saved nation yet. It goes as soon as your nation is saved.');
    if (!Number.isFinite(c.t) || now - c.t > SC_OLD || c.t > now + 60000) refuse('sc_old', 'That cache waited too long to be sent, so its materials go back to your stockpile.');
    const r = scContents(c.r);
    if (!r) refuse('sc_bad', `A Supply Cache holds 1 to ${SC_MAX} materials.`);
    const to = isUid(c.to) && c.to !== who.uid ? c.to : '';
    if (!to) refuse('sc_target', 'Choose another player’s nation in your region.');
    const [other, ban] = await tx.getAll(db.doc('nations/' + to), db.doc('bans/' + to));
    if (!other.exists || (other.get('reg') || '') !== reg || ban.exists) refuse('sc_target', 'That nation is no longer in your region.');
    const today = scDay(now), sent = await tx.get(db.collection('supply').where('f', '==', who.uid).where('d', '==', today));
    if (sent.size >= SC_DAY) refuse('sc_day', `You have sent ${SC_DAY} Supply Caches today. More after midnight UTC.`);
    const x = now + SC_KEEP;
    tx.create(ref, { f: who.uid, fn: nameOf(e.n), to, tn: nameOf(nationJSON(other)), reg, r, q: scTotal(r), m, t: now, d: today, x, exp: Timestamp.fromMillis(x), o: 0 });
    return { ok: true, t: now };
  });
}

async function scOpen(db, who, d) {
  const id = typeof d.id === 'string' && SC_DOC.test(d.id) ? d.id : '';
  if (!id) throw new HttpsError('invalid-argument', 'Choose a cache to open.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const ref = db.doc('supply/' + id), s = await tx.get(ref), now = Date.now();
    if (!s.exists || s.get('to') !== who.uid || (Number(s.get('x')) || 0) < now) refuse('sc_gone', 'That Supply Cache is no longer there.');
    const o = Number(s.get('o')) || 0;
    if (!o) tx.update(ref, { o: now });
    return { ok: true, first: !o, o: o || now, r: scContents(s.get('r')) || {}, f: s.get('f') || '', fn: s.get('fn') || '', m: s.get('m') || '', t: Number(s.get('t')) || 0 };
  });
}

/* an account that is deleted takes its caches with it, sent and received (and the messages in them); called outside any
   other transaction */
export async function scForget(db, uid) {
  try {
    const qs = await Promise.all(['f', 'to'].map(k => db.collection('supply').where(k, '==', uid).get()));
    const docs = qs.flatMap(q => q.docs);
    if (!docs.length) return;
    const w = db.bulkWriter();
    await Promise.all([Promise.all(docs.map(s => w.delete(s.ref))), w.close()]);
  } catch (e) { console.warn('scForget', uid, e && e.message); }
}

const OPS = { scSend, scOpen };
export const isSupplyOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function supply(db, who, d) { return OPS[d.op](db, who, d); }
