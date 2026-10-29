import crypto from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { identity, eligibility, refuse, registered } from './eligibility.js';

const clean = value => typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const accounts = onCall({ region: 'europe-west1', maxInstances: 10, memory: '256MiB' }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore(), uid = req.auth.uid, d = req.data || {};
  if (d.op === 'recover') {
    // Both a caller and IP budget: creating fresh anonymous accounts does not bypass guessing limits.
    const ip = digest(String(req.rawRequest.ip || 'unknown'));
    const now = Date.now(), limits = [db.doc('recoveryLimits/u_' + uid), db.doc('recoveryLimits/i_' + ip)];
    await db.runTransaction(async tx => {
      const docs = await tx.getAll(...limits);
      const counts = docs.map(s => s.exists && now - s.get('at') < 3600000 ? s.get('count') : 0);
      if (counts[0] >= 10 || counts[1] >= 100) throw new HttpsError('resource-exhausted', 'Too many recovery attempts. Try again in an hour.');
      docs.forEach((s, i) => tx.set(s.ref, { at: s.exists && now - s.get('at') < 3600000 ? s.get('at') : now, count: counts[i] + 1, exp: Timestamp.fromMillis(now + 7200000) }));
    });
    const code = clean(d.code), hash = digest(code), s = await db.doc('guestRecovery/' + hash).get();
    const fail = () => refuse('invalid_recovery', 'That recovery code is invalid or no longer available. Check the code and try again.');
    if (!/^EDC[A-F0-9]{40}$/.test(code) || !s.exists) fail();
    let u;
    try { u = await getAuth().getUser(s.get('uid')); } catch { fail(); }
    if (u.disabled || registered(u) || u.metadata.creationTime !== s.get('generation')) fail();
    const a = await db.doc('accountIdentity/' + u.uid).get(), n = await db.doc('nations/' + u.uid).get();
    if (!a.exists || a.get('recoveryHash') !== hash || !n.exists || a.get('nationGeneration') !== n.createTime.toMillis()) fail();
    // A code proves access to the existing guest identity, never registration or political eligibility.
    return { token: await getAuth().createCustomToken(u.uid, { guestRecovery: true }) };
  }
  const who = await identity(uid);
  if (d.op === 'status') {
    const [a, n] = await Promise.all([db.doc('accountIdentity/' + uid).get(), db.doc('nations/' + uid).get()]);
    return { kind: who.registered ? 'registered' : 'guest', hasNation: n.exists, recoveryIssued: a.get('generation') === who.generation && !!(a.get('recoveryIssued') || a.get('recoveryHash')) };
  }
  if (d.op === 'issue') {
    const code = clean(d.code);
    if (!/^EDC[A-F0-9]{40}$/.test(code)) throw new HttpsError('invalid-argument', 'A recovery code needs 160 random bits.');
    const hash = digest(code);
    return db.runTransaction(async tx => {
      const e = await eligibility(tx, who, { linked: false, hidden: true });
      if (who.registered) refuse('already_registered', 'Registered Nations recover through their linked sign-in.');
      if (e.account.get('generation') === who.generation && (e.account.get('recoveryIssued') || e.account.get('recoveryHash')) && e.account.get('recoveryHash') !== hash) refuse('already_issued', 'Your recovery code was already created. It cannot be displayed again or replaced.');
      const ref = db.doc('guestRecovery/' + hash), existing = await tx.get(ref);
      if (existing.exists && existing.get('uid') !== uid) refuse('code_used', 'Generate another recovery code.');
      tx.set(db.doc('accountIdentity/' + uid), { recoveryHash: hash, recoveryIssued: true, generation: who.generation, nationGeneration: e.generation, nationAt: e.born }, { merge: true });
      tx.set(ref, { uid, generation: who.generation, issuedAt: Date.now() });
      return { ok: true };
    });
  }
  throw new HttpsError('invalid-argument', 'Unknown account operation.');
});
