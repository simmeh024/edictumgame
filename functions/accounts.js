import crypto from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { identity, eligibility, refuse, registered } from './eligibility.js';
import { forgetDiscord, discordStep } from './discord.js';
import { shopStep, forgetShop } from './shop.js';

const clean = value => typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
/* The address a player last played from, for the admins' Inspect (functions/admin.js). Only the latest is kept,
   in accountSeen/{uid} {ip, at, exp}, and Firestore deletes it SEEN_DAYS after it was last seen (TTL on exp,
   firestore.indexes.json; the privacy notices say so). Google's front end adds the address a request came from
   to the end of X-Forwarded-For, after anything the browser sent itself, so the last entry is the one to trust. */
const SEEN_DAYS = 90;
function address(raw) {
  const hops = String(raw.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const ip = String(hops.at(-1) || raw.ip || '').replace(/^::ffff:/, '');
  return /^[\da-f.:]{2,45}$/i.test(ip) ? ip : '';
}
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
  if (d.op === 'discord') return discordStep(uid, d);
  if (d.op === 'shop') return shopStep(uid, d);
  if (d.op === 'seen') {
    // Once a page load (src/shim.js, seenCheck); the same address writes at most once an hour, moving the expiry with it.
    const ip = address(req.rawRequest), ref = db.doc('accountSeen/' + uid), now = Date.now(), last = await ref.get();
    if (ip && !(last.get('ip') === ip && now - last.get('at') < 3600000)) await ref.set({ ip, at: now, exp: Timestamp.fromMillis(now + SEEN_DAYS * 86400000) });
    return { ok: true };
  }
  if (d.op === 'close') {
    // The player's browser has deleted the nation, posts and tickets (src/shim.js, doDelete); this ends the
    // account itself, which a browser may only do just after signing in, and frees a linked Discord account.
    // The address it last played from, the staff's notes on it (functions/admin.js) and what it owns from the
    // shop (functions/shop.js, which first ends any subscription) go with it.
    if ((await db.doc('nations/' + uid).get()).exists) refuse('nation_exists', 'Delete the nation first.');
    await forgetShop(uid);
    await Promise.all(['accountSeen/', 'staffNotes/'].map(c => db.doc(c + uid).delete()));
    await forgetDiscord(uid);
    await getAuth().deleteUser(uid);
    return { ok: true };
  }
  const who = await identity(uid);
  if (d.op === 'status') {
    const [a, n] = await Promise.all([db.doc('accountIdentity/' + uid).get(), db.doc('nations/' + uid).get()]);
    return { kind: who.registered ? 'registered' : 'guest', hasNation: n.exists, recoveryIssued: a.get('generation') === who.generation && !!(a.get('recoveryIssued') || a.get('recoveryHash')), recoveryVersion: a.get('generation') === who.generation ? a.get('recoveryVersion') || 0 : 0 };
  }
  if (d.op === 'issue' || d.op === 'regenerate') {
    const replace = d.op === 'regenerate';
    if (replace && (!Number.isSafeInteger(d.version) || d.version < 0)) throw new HttpsError('invalid-argument', 'Read the current recovery status first.');
    const code = clean(d.code);
    if (!/^EDC[A-F0-9]{40}$/.test(code)) throw new HttpsError('invalid-argument', 'A recovery code needs 160 random bits.');
    const hash = digest(code);
    return db.runTransaction(async tx => {
      const e = await eligibility(tx, who, { linked: false, hidden: true });
      if (who.registered) refuse('already_registered', 'Registered Nations recover through their linked sign-in.');
      const sameIdentity = e.account.get('generation') === who.generation, previous = sameIdentity ? e.account.get('recoveryHash') : '', version = sameIdentity ? e.account.get('recoveryVersion') || 0 : 0, now = Date.now();
      if (replace) {
        // A lost response retries the same replacement, without revoking a newer key from another tab.
        if (previous === hash && version === d.version + 1) return { ok: true };
        if (version !== d.version) refuse('recovery_changed', 'Your recovery key changed on another device. Start again to generate a new key.');
        if (previous === hash) refuse('same_recovery', 'Generate a different recovery key.');
        if (now - (e.account.get('recoveryRotatedAt') || 0) < 60000) throw new HttpsError('resource-exhausted', 'Wait a minute before regenerating your recovery key again.');
      } else if (sameIdentity && (e.account.get('recoveryIssued') || previous) && previous !== hash) refuse('already_issued', 'Your recovery code was already created. Use Regenerate recovery key from an active Guest session to replace it.');
      const ref = db.doc('guestRecovery/' + hash), existing = await tx.get(ref);
      if (existing.exists && (existing.get('uid') !== uid || existing.get('generation') !== who.generation || replace)) refuse('code_used', 'Generate another recovery code.');
      tx.set(db.doc('accountIdentity/' + uid), { recoveryHash: hash, recoveryIssued: true, generation: who.generation, nationGeneration: e.generation, nationAt: e.born, recoveryVersion: replace ? version + 1 : version, ...(replace ? { recoveryRotatedAt: now } : {}) }, { merge: true });
      // A non-identifying tombstone prevents an old key from ever being reused.
      if (replace && previous) tx.set(db.doc('guestRecovery/' + previous), { revoked: true });
      tx.set(ref, { uid, generation: who.generation, issuedAt: now });
      return { ok: true };
    });
  }
  throw new HttpsError('invalid-argument', 'Unknown account operation.');
});
