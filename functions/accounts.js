import crypto from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { identity, eligibility, refuse, registered, nationJSON, banMarks, DAY } from './eligibility.js';
import { liftBan } from './bans.js';
import { forgetDiscord, discordStep } from './discord.js';
import { shopStep, forgetShop } from './shop.js';
import { mailStep, mailUnsub, forgetMail, recoveryMail } from './mail.js';
import { noteGone, forgetGone } from './gone.js';
import { onceUse, forgetOnce } from './once.js';
import { lettersStep, forgetLetters } from './letters.js';
import { alDrop } from './alliances.js';
import { trDrop } from './treaties.js';
import { bdDrop } from './borders.js';
import { ldDrop } from './land.js';
import { scForget } from './supply.js';
import { jvDrop } from './ventures.js';
import { rdForget } from './riddles.js';
import { rmbForget, cbForget } from './board.js';
import { rcForget } from './regionchat.js';
import { fcForget } from './flagcomp.js';
import DATA from './civic-data.json' with { type: 'json' };
import { pace, ipRule } from './pace.js';
import { supportStep } from './support.js';

const clean = value => typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
/* Recruiting (game/edictum.html, rcClaim): a player who founded a nation through another player's link files
   recruits/<uid> {r, t} here, once; each side's game then pays itself the bonus. A recruit counts only as a
   Registered Nation (a linked sign-in account), founded in the last RECRUIT_DAYS and after the recruiter's own
   nation: so a player who had a nation already, or two players opening each other's links, earn nothing.
   → {ok: true} or {ok: false, why}: 'guest' (link an account first), 'done' (filed already), 'old', 'gone' (no such
   recruiter), or the code eligibility() refused with ('nation_required' while the first save is on its way).
   Later steps (recruitStep): the recruit's game asks once its nation has played a week (saved RECRUIT_WEEK after its
   founding) or holds a second city; this reads the saved nation and adds the step to recruits/<uid>.m (2 the week,
   4 the second city), which the recruiter's game reads with the list. Each side pays itself once per step.
   The trail for the admins' funnel (functions/stats.js, recruiting): recruitTrail/<uid> {r, o?, f?, l?}, the first
   recruiter whose link this account followed, and when it opened the link (recruitOpen), first claimed with a nation
   (f, a guest's claim too) and was filed (l). Server only; the admins read it. */
const RECRUIT_DAYS = 30, RECRUIT_WEEK = 7 * DAY;
const RC_UID = /^[A-Za-z0-9_-]{6,128}$/;
/* the first mark of each kind on this account's trail, naming the first recruiter only */
async function rcTrail(db, uid, by, key) {
  const ref = db.doc('recruitTrail/' + uid);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists && (s.get('r') !== by || s.get(key))) return;
    tx.set(ref, { r: by, [key]: FieldValue.serverTimestamp() }, { merge: true });
  });
}
async function recruitOpen(db, who, by) {
  if (typeof by !== 'string' || !RC_UID.test(by) || by === who.uid) return { ok: false };
  await rcTrail(db, who.uid, by, 'o');
  return { ok: true };
}
async function recruitStep(db, who) {
  const ref = db.doc('recruits/' + who.uid);
  return db.runTransaction(async tx => {
    const [rec, saved] = await tx.getAll(ref, db.doc('nations/' + who.uid));
    if (!rec.exists || !saved.exists) return { ok: false, why: 'none' };
    const n = nationJSON(saved), m0 = Number(rec.get('m')) || 0, founded = Number(n.founded) || 0;
    const at = Number(saved.get('updatedAt')) || (saved.updateTime ? saved.updateTime.toMillis() : 0);
    let m = m0;
    if (founded > 0 && at - founded >= RECRUIT_WEEK) m |= 2;
    if (Array.isArray(n.cities) && n.cities.length >= 2) m |= 4;
    if (m !== m0) tx.update(ref, { m });
    return { ok: true, m };
  });
}
const bornOf = (saved, account) => {
  const gen = saved.createTime.toMillis(), at = account.exists && account.get('nationGeneration') === gen ? account.get('nationAt') : gen;
  const f = Number(nationJSON(saved).founded);
  return f > 0 ? Math.min(at, f) : at;
};
async function recruit(db, who, by) {
  if (typeof by !== 'string' || !RC_UID.test(by) || by === who.uid) throw new HttpsError('invalid-argument', 'Name the player whose link you followed.');
  if (!who.registered) {
    /* a guest who founded a nation through the link: on the trail, unpaid until an account is linked */
    if ((await db.doc('nations/' + who.uid).get()).exists) await rcTrail(db, who.uid, by, 'f');
    return { ok: false, why: 'guest' };
  }
  const ref = db.doc('recruits/' + who.uid), trail = db.doc('recruitTrail/' + who.uid);
  return db.runTransaction(async tx => {
    const [filed, them, theirs] = await tx.getAll(ref, db.doc('nations/' + by), db.doc('accountIdentity/' + by));
    if (filed.exists) return { ok: false, why: 'done' };
    let e;
    try { e = await eligibility(tx, who); } catch (err) { if (err.details?.code) return { ok: false, why: err.details.code }; throw err; }
    if (!them.exists) return { ok: false, why: 'gone' };
    const born = bornOf(e.saved, e.account);
    if (Date.now() - born > RECRUIT_DAYS * DAY || bornOf(them, theirs) >= born) return { ok: false, why: 'old' };
    const tr = await tx.get(trail);
    tx.create(ref, { r: by, t: FieldValue.serverTimestamp() });
    if (!tr.exists || tr.get('r') === by) tx.set(trail, { r: by, l: FieldValue.serverTimestamp(), ...(tr.exists && tr.get('f') ? {} : { f: FieldValue.serverTimestamp() }) }, { merge: true });
    return { ok: true };
  });
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
/* How a Registered Nation signs in, in the words of the game's sign-in buttons (src/shim.js, LINK_OPTIONS), for the
   recovery code of a nation that has linked a sign-in since: the ways, never the address */
const SIGN_INS = [['Google', u => u.providerData.some(p => p.providerId === 'google.com')], ['Discord', u => !!u.customClaims?.dc],
  ['email', u => u.emailVerified && u.providerData.some(p => p.providerId === 'password')]];
const orList = list => list.length > 1 ? list.slice(0, -1).join(', ') + ' or ' + list.at(-1) : list[0] || '';
export const signInWays = u => orList(SIGN_INS.filter(([, has]) => has(u)).map(([w]) => w === 'email' ? 'your email address' : w)) || 'its linked sign-in';
export const signInButtons = u => orList(SIGN_INS.filter(([, has]) => has(u)).map(([w]) => `“Continue with ${w}”`)) || 'its sign-in button';
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
  // the stop-these-letters link in every letter (src/mail.html) works without signing in
  if (req.data && req.data.op === 'mail' && req.data.step === 'unsub') return mailUnsub(req.data);
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore(), uid = req.auth.uid, d = req.data || {};
  // functions/pace.js: a game opens with a step or two here; settings, sign-ins and the shop add a few more
  pace([['a:' + uid, 20, 0.5], ...ipRule(req, 'ai', 200, 10)]);
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
    if (u.disabled || u.metadata.creationTime !== s.get('generation')) fail();
    const a = await db.doc('accountIdentity/' + u.uid).get(), n = await db.doc('nations/' + u.uid).get();
    if (!a.exists || a.get('recoveryHash') !== hash || !n.exists || a.get('nationGeneration') !== n.createTime.toMillis()) fail();
    // The nation's own, current code, but the nation has linked a sign-in since: a code never opens a Registered Nation.
    // Saying so (and how it signs in, never the address) spares its player trying the code until the limit above; only
    // the code's holder learns it, and a guessed code still reads as invalid.
    if (registered(u)) refuse('recovery_linked', `${n.get('name') ? `“${String(n.get('name')).slice(0, 60)}”` : 'This nation'} now signs in with ${signInWays(u)}, so its guest recovery code no longer works. Sign in that way instead, with ${signInButtons(u)}.`);
    // A code proves access to the existing guest identity, never registration or political eligibility.
    return { token: await getAuth().createCustomToken(u.uid, { guestRecovery: true }) };
  }
  // a one-time sign-in link an admin made (functions/once.js): its caller is whatever this browser has, as with 'recover'
  if (d.op === 'once') return onceUse(db, uid, d, digest(String(req.rawRequest.ip || 'unknown')));
  if (d.op === 'discord') return discordStep(uid, d);
  if (d.op === 'shop') return shopStep(uid, d);
  if (d.op === 'mail') return mailStep(uid, d, String(req.rawRequest?.ip || ''));
  if (d.op === 'letters') return lettersStep(uid, d);
  // a nation about to be dissolved by its own browser: a copy for the admins' Recently dissolved (functions/gone.js),
  // or, deleted with its account, a line naming it
  if (d.op === 'gone') return noteGone(db, uid, d);
  // the player's side of a support ticket (functions/support.js); before identity(), so a banned player can still
  // write back about their appeal
  if (d.op === 'support') return supportStep(db, uid, d);
  // A timed ban that has run out (functions/admin.js, BAN_DAYS): the player's own game asks for it to be lifted when it
  // reads `until` on its ban and the time has passed. The server checks the time itself and lifts nothing early, so the
  // call is safe to make from anywhere; the marks on the account's sign-ins go with it, as an admin's Unban does. The
  // alerts job sweeps up the bans of players who never come back (functions/alerts.js).
  if (d.op === 'banExpired') {
    const ref = db.doc('bans/' + uid), ban = await ref.get(), until = +ban.get('until') || 0, now = Date.now();
    if (!ban.exists) return { lifted: false, banned: false };
    if (!until || until > now) return { lifted: false, banned: true, until };
    await liftBan(db, uid, { reason: 'The ban ran out', at: FieldValue.serverTimestamp() });
    return { lifted: true, banned: false };
  }
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
    // A banned account may close, but its sign-ins stay marked (functions/eligibility.js, identityHashes): signing in
    // with them again makes a new account that is banned as well. Bans from before the marks get them here.
    if ((await db.doc('bans/' + uid).get()).exists) {
      const b = db.batch(), t = Date.now();
      for (const h of await banMarks(uid)) b.set(db.doc('banIds/' + h), { u: uid, t });
      await b.commit();
    }
    await forgetShop(uid);
    // and the pacing of its posts, reports, tickets and bug reports, which players may not delete (firestore.rules)
    await Promise.all(['accountSeen/', 'recruitTrail/', 'staffNotes/', 'watch/', 'limits/', 'rlimits/', 'slimits/', 'blimits/', 'llimits/', 'cbPace/', 'rcPace/', 'rcMute/', 'rcNote/', 'rcHello/', 'ambassadors/'].map(c => db.doc(c + uid).delete()));
    await forgetDiscord(uid);
    await forgetMail(uid);
    // its one-time sign-in links and their record (functions/once.js)
    await forgetOnce(db, uid);
    // copies of nations it dissolved (functions/gone.js); their lines, naming them, stay until they expire
    await forgetGone(db, uid);
    // the counts, blocks and read receipts of its letters, and its devices' push subscriptions (functions/letters.js)
    await forgetLetters(uid);
    // its place in an alliance (functions/alliances.js), and the pacing of its alliance channel posts
    await alDrop(db, uid);
    // the treaties it was party to (functions/treaties.js)
    await trDrop(db, uid);
    // the border agreements it was party to (functions/borders.js)
    await bdDrop(db, uid);
    // the land deals it was party to (functions/land.js): open ones called off, finished ones gone
    await ldDrop(db, uid);
    // the Supply Caches it sent and received, with their messages (functions/supply.js)
    await scForget(db, uid);
    // the joint ventures it took part in (functions/ventures.js)
    await jvDrop(db, uid);
    // its guesses at the riddles of the week, and its name among their first solvers (functions/riddles.js)
    await rdForget(db, uid);
    // the @mentions waiting in its bell (functions/board.js)
    await db.recursiveDelete(db.collection('mentions/' + uid + '/m'));
    // its lines in the alliance channels and the region chats (functions/regionchat.js)
    const chat = await db.collectionGroup('chat').where('a', '==', uid).get();
    if (!chat.empty) { const w = db.bulkWriter(); await Promise.all([Promise.all(chat.docs.map(c => w.delete(c.ref))), w.close()]); }
    await db.doc('alPace/' + uid).delete();
    // its reactions on the region boards (functions/board.js)
    await rmbForget(db, uid, DATA.regions.map(r => r.id));
    // and on the Community Board: its reactions, the topics it followed and its board profile
    await cbForget(db, uid);
    // and in the region chats (functions/regionchat.js)
    await rcForget(db, uid, DATA.regions.map(r => r.id));
    // its flag in an open competition, its ratings, and its name in the halls (functions/flagcomp.js)
    await fcForget(db, uid);
    // the region newspapers: a Delegate's signature on a paper's name (functions/civic.js, paper) and the account
    // that printed an edition into the archive (papers/, firestore.rules); the name and the editions stay
    const [named, printed] = await Promise.all([db.collection('press').where('by', '==', uid).get(), db.collection('papers').where('by', '==', uid).get()]);
    if (!named.empty || !printed.empty) {
      const w = db.bulkWriter();
      await Promise.all([...named.docs.map(s => w.update(s.ref, { by: FieldValue.delete(), bn: FieldValue.delete() })), ...printed.docs.map(s => w.update(s.ref, { by: '' })), w.close()]);
    }
    await getAuth().deleteUser(uid);
    return { ok: true };
  }
  const who = await identity(uid);
  if (d.op === 'recruit') return recruit(db, who, d.by);
  if (d.op === 'recruitOpen') return recruitOpen(db, who, d.by);
  if (d.op === 'recruitStep') return recruitStep(db, who);
  // a guest's recovery code by email (functions/mail.js)
  if (d.op === 'recoveryMail') return recoveryMail(db, who, d, String(req.rawRequest?.ip || ''));
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
