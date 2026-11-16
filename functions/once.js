/* One-time sign-in links (Admin › Players › a player › One-time sign-in).

   For a player who cannot get back into their nation (a phone that lost its sign-in, a Google sign-in that will not
   finish, an email link that never arrives), an admin makes a link that signs whoever opens it in to that player's
   account: once, within ONCE_MS. The admin either has the Herald email it to the verified address on the account
   (the safe way: only its owner reads it) or copies it to send by another way the player is known by. Opening it,
   the game asks first, signs in, and then guides the player to make sure they can get back in on their own
   (src/shim.js, the 'secure' view).

   adminConsole({op: 'once', step: 'mail' | 'copy', uid}) → {once, link?, sent?}: a new link (the last one stops
                                                            working); copy shows it to the admin, once
   adminConsole({op: 'once', step: 'revoke', uid})         → {once}: the waiting link stops working
   accounts({op: 'once', step: 'peek', code})              → {uid, name}: whose link it is, without using it
   accounts({op: 'once', step: 'use', code})               → {token, uid, name}: used up; a custom token to sign in with

   Storage (server only, firestore.rules), never the code itself:
     onceLinks/{sha256(code)}  {uid, by, at, exp (TTL), via}
     onceFor/{uid}             {h?, at, exp, by, via, to?, usedAt?}: the player's one waiting link, and the last one used
     onceLog/{uid}             {t: [ms]}: when one-time links signed this account in (the last ONCE_LOG), which the
                               player reads (rules: their own): the Edictum Team writes them a letter for each, so a link
                               opened by someone else does not go unnoticed */
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import crypto from 'node:crypto';
import { refuse } from './eligibility.js';
import { mailConfig, send, onceLetter } from './mail-core.js';

export const ONCE_MS = 24 * 3600000;
const ONCE_LOG = 10, CODE = /^EDO[A-F0-9]{40}$/;
const digest = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const clean = v => typeof v === 'string' ? v.toUpperCase().replace(/[\s-]/g, '') : '';
export const onceCode = () => 'EDO' + crypto.randomBytes(20).toString('hex').toUpperCase();
export const onceUrl = (site, code) => String(site).replace(/\/+$/, '') + '/?once=' + code;
/* an address as the admin page shows it: enough to recognise, not to copy (pascal@example.com → p•••l@example.com) */
export const maskEmail = e => { const [u, d] = String(e || '').split('@'); return d ? (u.length > 2 ? u[0] + '•••' + u.at(-1) : u[0] + '•••') + '@' + d : ''; };
/* the verified address a link may be emailed to: the account's own (an email sign-in, confirmed) or its Google address */
export function verifiedEmail(u) {
  if (!u) return '';
  if (u.email && u.emailVerified) return u.email;
  const g = (u.providerData || []).find(p => p.providerId === 'google.com' && p.email);
  return g ? g.email : '';
}

/* what the admin page shows: a link waiting (until when, how sent, by whom), the last one used, and where one can be emailed */
export async function onceStatus(db, uid, u) {
  const s = await db.doc('onceFor/' + uid).get(), now = Date.now();
  const exp = s.exists ? s.get('exp') : null, expMs = exp && exp.toMillis ? exp.toMillis() : 0;
  const live = s.exists && !!s.get('h') && expMs > now;
  return { live, at: live ? s.get('at') || 0 : 0, exp: live ? expMs : 0, by: live ? s.get('by') || '' : '', via: live ? s.get('via') || '' : '', to: live ? s.get('to') || '' : '',
    usedAt: s.exists ? s.get('usedAt') || 0 : 0, mail: maskEmail(verifiedEmail(u)) };
}

async function target(db, uid) {
  const [u, n, ban] = await Promise.all([getAuth().getUser(uid).catch(() => null), db.doc('nations/' + uid).get(), db.doc('bans/' + uid).get()]);
  return { u, n, ban };
}

export async function onceAdmin(db, actor, uid, d) {
  const step = d.step, now = Date.now(), ref = db.doc('onceFor/' + uid), event = db.collection('adminAudit').doc();
  const { u, n, ban } = await target(db, uid), name = String(n.exists ? n.get('name') || '' : '').slice(0, 80);
  const audit = (action, reason, extra = {}) => ({ actor, action, target: uid, reason, ...(name ? { name } : {}), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp(), ...extra });
  if (step === 'revoke') {
    await db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists || !s.get('h')) throw new HttpsError('failed-precondition', 'No link is waiting for this player.');
      tx.delete(db.doc('onceLinks/' + s.get('h')));
      tx.update(ref, { h: FieldValue.delete(), exp: Timestamp.fromMillis(now) });
      tx.create(event, audit('once_revoked', 'One-time sign-in link cancelled'));
    });
    return { once: await onceStatus(db, uid, u) };
  }
  if (step !== 'mail' && step !== 'copy') throw new HttpsError('invalid-argument', 'Email the link or copy it.');
  if (!u) refuse('no_account', 'This player has no sign-in account any more.');
  if (u.disabled) refuse('disabled', 'This account is disabled.');
  if (ban.exists) refuse('banned', 'This player is banned.');
  if (!n.exists) refuse('no_nation', 'This player has no nation to sign in to.');
  const email = step === 'mail' ? verifiedEmail(u) : '';
  if (step === 'mail' && !email) refuse('no_email', 'This account has no verified email address. Copy a link instead, and send it to the player yourself.');
  const code = onceCode(), h = digest(code), exp = Timestamp.fromMillis(now + ONCE_MS), to = maskEmail(email);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists && s.get('h')) tx.delete(db.doc('onceLinks/' + s.get('h')));
    tx.set(db.doc('onceLinks/' + h), { uid, by: actor, at: now, exp, via: step });
    tx.set(ref, { h, at: now, exp, by: actor, via: step, ...(to ? { to } : {}), usedAt: s.exists ? s.get('usedAt') || 0 : 0 });
    tx.create(event, audit('once_link', step === 'mail' ? 'One-time sign-in link emailed to ' + to : 'One-time sign-in link copied by the admin'));
  });
  const cfg = await mailConfig(db), link = onceUrl(cfg.site, code);
  if (step === 'mail') {
    try { await send(db, [onceLetter(cfg, { to: email, nation: name, link })], cfg); }
    catch (e) {
      /* the link is no good to anyone unsent: it goes, and the admin can copy one instead */
      await db.runTransaction(async tx => { tx.delete(db.doc('onceLinks/' + h)); tx.update(ref, { h: FieldValue.delete(), exp: Timestamp.fromMillis(Date.now()) }); });
      throw new HttpsError('unavailable', 'The Herald could not send the letter (' + (e.code || 'mail error') + '). Copy a link instead.');
    }
    return { once: await onceStatus(db, uid, u), sent: to };
  }
  return { once: await onceStatus(db, uid, u), link };
}

/* the player's side. Before identity() in functions/accounts.js: the caller is whatever this browser has (a fresh
   guest, mostly), and a code that is wrong, old or used is counted against both it and its address, as recovery codes
   are, so fresh guest accounts do not buy more guesses (160 random bits are not guessed anyway) */
export async function onceUse(db, caller, d, ipHash) {
  const now = Date.now(), limits = [db.doc('recoveryLimits/ou_' + caller), db.doc('recoveryLimits/oi_' + ipHash)];
  await db.runTransaction(async tx => {
    const docs = await tx.getAll(...limits);
    const counts = docs.map(s => s.exists && now - s.get('at') < 3600000 ? s.get('count') : 0);
    if (counts[0] >= 10 || counts[1] >= 100) throw new HttpsError('resource-exhausted', 'Too many tries with sign-in links. Try again in an hour.');
    docs.forEach((s, i) => tx.set(s.ref, { at: s.exists && now - s.get('at') < 3600000 ? s.get('at') : now, count: counts[i] + 1, exp: Timestamp.fromMillis(now + 7200000) }));
  });
  const code = clean(d.code), h = digest(code), gone = () => refuse('once_invalid', 'This sign-in link has expired or was already used. Ask the Edictum team for a new one from the Help page.');
  if (!CODE.test(code)) gone();
  const link = db.doc('onceLinks/' + h), s = await link.get();
  if (!s.exists || !(s.get('exp') && s.get('exp').toMillis() > now)) gone();
  const uid = s.get('uid'), { u, n, ban } = await target(db, uid);
  if (!u || u.disabled || ban.exists || !n.exists) gone();
  const name = String(n.get('name') || '').slice(0, 80);
  if (d.step === 'peek') return { uid, name };
  if (d.step !== 'use') throw new HttpsError('invalid-argument', 'Peek at the link or use it.');
  await db.runTransaction(async tx => {
    const [l, log] = await tx.getAll(link, db.doc('onceLog/' + uid));
    if (!l.exists || !(l.get('exp') && l.get('exp').toMillis() > now)) gone();
    tx.delete(link);
    tx.set(db.doc('onceFor/' + uid), { h: FieldValue.delete(), usedAt: now, exp: Timestamp.fromMillis(now) }, { merge: true });
    tx.set(db.doc('onceLog/' + uid), { t: [...(log.exists && Array.isArray(log.get('t')) ? log.get('t') : []), now].slice(-ONCE_LOG) });
  });
  return { token: await getAuth().createCustomToken(uid, { once: true }), uid, name };
}

/* an account deleted: its links and their record go with it */
export async function forgetOnce(db, uid) {
  const s = await db.doc('onceFor/' + uid).get();
  if (s.exists && s.get('h')) await db.doc('onceLinks/' + s.get('h')).delete();
  await Promise.all([db.doc('onceFor/' + uid).delete(), db.doc('onceLog/' + uid).delete()]);
}
