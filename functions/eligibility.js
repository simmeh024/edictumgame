import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export const DAY = 86400000;
export const registered = user => user.providerData.some(p => p.providerId !== 'password' || user.emailVerified);
export const nationJSON = snap => { try { return snap.exists ? JSON.parse(snap.get('j')) : {}; } catch { return {}; } };
export function refuse(code, message) { throw new HttpsError('failed-precondition', message, { code }); }
export async function identity(uid) {
  const u = await getAuth().getUser(uid);
  if (u.disabled) refuse('account_disabled', 'This account is disabled. Contact support.');
  return { uid, registered: registered(u), generation: u.metadata.creationTime };
}
// All sensitive systems use this check. Birth is Firestore's document creation time, never JSON.founded.
// Call inside the same transaction as the protected action so moderation and region changes race safely.
export async function eligibility(tx, who, { linked = true, age = 0, hidden = false, nation = true } = {}) {
  const db = getFirestore(), uid = who.uid;
  const refs = ['nations/', 'bans/', 'mod/', 'accountIdentity/'].map(p => db.doc(p + uid));
  const [saved, ban, mod, account] = await tx.getAll(...refs);
  if (ban.exists) refuse('banned', 'This account is banned. You can contact support.');
  if (nation && !saved.exists) refuse('nation_required', 'Found and save a nation first.');
  const generation = saved.exists ? saved.createTime.toMillis() : 0;
  const born = account.exists && account.get('nationGeneration') === generation ? account.get('nationAt') : generation;
  if (!hidden && mod.exists && (mod.get('hidden') || (mod.get('removed') && generation <= mod.get('removed'))))
    refuse('moderated', 'This nation cannot take multiplayer actions while under moderation.');
  const n = nationJSON(saved), region = n.reg || saved.get('reg');
  if (region) {
    const control = await tx.get(db.doc('regionStatus/' + region));
    if (control.exists && control.get('enabled') === false) refuse('region_disabled', 'Current region is disabled and undergoing maintainance, check back soon.');
  }
  if (linked && !who.registered) refuse('registration_required', 'A Registered Nation is required. Link a sign-in account in your account settings.');
  const readyAt = born + age;
  if (age && Date.now() < readyAt) throw new HttpsError('failed-precondition', 'Assembly participation unlocks 24 hours after your nation was founded.', { code: 'nation_too_young', readyAt });
  return { saved, n, born, generation, account, kind: who.registered ? 'registered' : 'guest', readyAt: born + DAY };
}
