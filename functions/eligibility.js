import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import DATA from './civic-data.json' with { type: 'json' };

export const DAY = 86400000;
/* A region marked soon in the game (Terra) is closed until an admin opens it: with no status document it reads as
   coming soon. firestore.rules (regionEnabled) keeps the same list. */
const SOON = new Set(DATA.regions.filter(r => r.soon).map(r => r.id));
export const regionClosed = (control, region) => control.exists ? control.get('enabled') === false : SOON.has(region);
export const regionMessage = control => !control.exists || control.get('mode') === 'coming_soon' ? 'This region is coming soon. Please check back later.' : 'Current region is disabled and undergoing maintainance, check back soon.';
// A linked Discord account is a custom claim (functions/discord.js), not a provider Firebase knows.
export const registered = user => !!user.customClaims?.dc || user.providerData.some(p => p.providerId !== 'password' || user.emailVerified);
export const nationJSON = snap => { try { return snap.exists ? JSON.parse(snap.get('j')) : {}; } catch { return {}; } };
export function refuse(code, message) { throw new HttpsError('failed-precondition', message, { code }); }
/* The sign-ins an account is known by, as one-way hashes (banIds/<hash> {u, t}): a ban notes them (functions/admin.js),
   so the same Google account, verified email address or Discord account cannot come back as a new player by closing
   the account and signing in again. Only what the player cannot set for someone else: a provider's own id, a
   verified address, the Discord id the server linked (functions/discord.js, dc). */
const idHash = (kind, v) => createHash('sha256').update('ban:' + kind + ':' + v).digest('hex');
export function identityHashes(u) {
  const out = new Set();
  for (const p of u.providerData || []) if (p.providerId && p.providerId !== 'password' && p.uid) out.add(idHash(p.providerId, p.uid));
  if (u.email && u.emailVerified) out.add(idHash('email', u.email.trim().toLowerCase()));
  if (u.customClaims?.dc) out.add(idHash('discord', String(u.customClaims.dc)));
  return [...out].slice(0, 8);
}
/* the sign-in hashes a ban notes: none for an account Firebase no longer has */
export async function banMarks(uid) {
  try { return identityHashes(await getAuth().getUser(uid)); } catch { return []; }
}
/* a new nation from a sign-in a banned account used: the account is banned as well, and refused */
export async function refuseBannedIdentity(db, who) {
  if (!who.ids?.length) return;
  const hit = (await db.getAll(...who.ids.map(h => db.doc('banIds/' + h)))).find(s => s.exists);
  if (!hit) return;
  await db.doc('bans/' + who.uid).set({ note: 'The same sign-in as a banned account', name: '', t: Date.now(), by: 'system', of: String(hit.get('u') || '') });
  refuse('banned', 'This account is banned. You can contact support.');
}
export async function identity(uid) {
  const u = await getAuth().getUser(uid);
  if (u.disabled) refuse('account_disabled', 'This account is disabled. Contact support.');
  return { uid, admin: u.customClaims?.admin === true, mod: u.customClaims?.mod === true, registered: registered(u), generation: u.metadata.creationTime, ids: identityHashes(u) };
}
// All sensitive systems use this check. Birth is Firestore's document creation time, never JSON.founded.
// Call inside the same transaction as the protected action so moderation and region changes race safely.
export async function eligibility(tx, who, { linked = true, age = 0, hidden = false, nation = true, allowClosedRegion = false } = {}) {
  const db = getFirestore(), uid = who.uid;
  const refs = ['nations/', 'bans/', 'mod/', 'accountIdentity/'].map(p => db.doc(p + uid));
  const [saved, ban, mod, account] = await tx.getAll(...refs);
  if (ban.exists) refuse('banned', 'This account is banned. You can contact support.');
  if (nation && !saved.exists) refuse('nation_required', 'Found and save a nation first.');
  const generation = saved.exists ? saved.createTime.toMillis() : 0;
  const born = account.exists && account.get('nationGeneration') === generation ? account.get('nationAt') : generation;
  const moderated = !!(mod.exists && (mod.get('hidden') || (mod.get('removed') && generation <= mod.get('removed'))));
  if (!hidden && moderated)
    refuse('moderated', 'This nation cannot take multiplayer actions while under moderation.');
  const n = nationJSON(saved), region = n.reg || saved.get('reg');
  if (region) {
    const control = await tx.get(db.doc('regionStatus/' + region));
    if (regionClosed(control, region) && !(allowClosedRegion && who.admin)) refuse('region_disabled', regionMessage(control));
  }
  if (linked && !who.registered) refuse('registration_required', 'A Registered Nation is required. Link a sign-in account in your account settings.');
  const readyAt = born + age;
  if (age && Date.now() < readyAt) throw new HttpsError('failed-precondition', 'Assembly participation unlocks 24 hours after your nation was founded.', { code: 'nation_too_young', readyAt });
  return { saved, n, born, generation, account, mod, moderated, kind: who.registered ? 'registered' : 'guest', readyAt: born + DAY };
}
