import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { eligibility, refuse } from './eligibility.js';
import { RD_TRIES, RD_TOP, RD_ID } from './riddle-rules.js';

/* The riddle of the week (functions/riddle-rules.js holds the data's shape): a nation of the region guesses which hex the
   riddle points at (civic op rdGuess). The answer is in riddleKeys/, which only this reads; a guess is told right or
   wrong, never where the answer is. The first RD_TOP to solve it are named on the riddle. Guests guess too. */
const nameOf = n => (n && typeof n.name === 'string' && n.name.trim().slice(0, 80)) || 'A nation';

async function rdGuess(db, who, d) {
  const rid = typeof d.rid === 'string' && RD_ID.test(d.rid) ? d.rid : '', c = Number.isInteger(d.c) && d.c >= 0 && d.c < 1e7 ? d.c : -1;
  if (!rid || c < 0) throw new HttpsError('invalid-argument', 'Choose a hex for the riddle.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false }), now = Date.now(), reg = e.n.reg || e.saved.get('reg') || '';
    if (!reg || rid.slice(0, rid.lastIndexOf('_')) !== reg) refuse('rd_region', 'Each region has its own riddle: answer your own.');
    const ref = db.doc('riddles/' + rid), gref = db.doc('riddles/' + rid + '/guesses/' + who.uid);
    const [R, G, K] = await tx.getAll(ref, gref, db.doc('riddleKeys/' + rid));
    if (!R.exists || !K.exists || now < (Number(R.get('t')) || 0) || now >= (Number(R.get('x')) || 0)) refuse('rd_closed', 'That riddle is closed. A new one comes every Monday.');
    const g = G.exists && Array.isArray(G.get('g')) ? G.get('g').filter(Number.isInteger).slice(0, RD_TRIES) : [], ok = G.exists ? Number(G.get('ok')) || 0 : 0;
    if (ok) return { ok: true, right: true, again: true, rank: Number(G.get('r')) || 0, left: Math.max(0, RD_TRIES - g.length) };
    if (g.includes(c)) return { ok: true, right: false, same: true, left: Math.max(0, RD_TRIES - g.length) };
    if (g.length >= RD_TRIES) refuse('rd_out', `You have used your ${RD_TRIES} guesses for this week’s riddle.`);
    const right = Number(K.get('c')) === c, g2 = g.concat(c);
    if (!right) {
      tx.set(gref, { u: who.uid, g: g2, ok: 0, r: 0, t: now });
      return { ok: true, right: false, left: RD_TRIES - g2.length };
    }
    const n = (Number(R.get('n')) || 0) + 1, top = Array.isArray(R.get('top')) ? R.get('top') : [];
    tx.update(ref, n <= RD_TOP && top.length < RD_TOP
      ? { n, top: top.concat({ u: who.uid, nm: nameOf(e.n), t: now }), tu: FieldValue.arrayUnion(who.uid) }
      : { n });
    tx.set(gref, { u: who.uid, g: g2, ok: now, r: n, t: now });
    return { ok: true, right: true, rank: n, left: RD_TRIES - g2.length };
  });
}

/* an account that is deleted: its guesses go, and its name leaves the riddles' lists of first solvers; called outside any
   other transaction */
export async function rdForget(db, uid) {
  try {
    const [gs, rs] = await Promise.all([db.collectionGroup('guesses').where('u', '==', uid).get(), db.collection('riddles').where('tu', 'array-contains', uid).get()]);
    const w = db.bulkWriter(), jobs = gs.docs.map(s => w.delete(s.ref));
    for (const s of rs.docs) jobs.push(w.update(s.ref, { top: (s.get('top') || []).filter(x => x && x.u !== uid), tu: FieldValue.arrayRemove(uid) }));
    await Promise.all([Promise.all(jobs), w.close()]);
  } catch (e) { console.warn('rdForget', uid, e && e.message); }
}

const OPS = { rdGuess };
export const isRiddleOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function riddle(db, who, d) { return OPS[d.op](db, who, d); }
