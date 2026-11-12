/* Letters by post (Settings › Letters by post; functions/mail-core.js has the letters and the sender).

   It runs inside the accounts callable (functions/accounts.js), like discord.js: a brand-new public function
   cannot be deployed by CI (the invoker IAM on Cloud Run).
   accounts({op: 'mail', step: 'status'})          → {email, ok, p, wait}: the address, whether it is confirmed,
                                                     the kinds chosen, and whether a code is waiting
   accounts({op: 'mail', step: 'set', email})      → {ok: true}: sends a six-figure code to the address
   accounts({op: 'mail', step: 'verify', code})    → {ok: true}: confirms it, and the first time sends the welcome
   accounts({op: 'mail', step: 'prefs', p})        → {ok: true, p}
   accounts({op: 'mail', step: 'remove'})          → {ok: true}: forgets the address altogether
   accounts({op: 'mail', step: 'unsub', t})        → {ok: true}: no sign-in needed; the link in every letter
                                                     (src/mail.html) turns every kind off

   Storage (server only; firestore.rules):
     mailAccounts/{uid}  {e, ok, p, tok, code?, codeAt?, tries?, sends: [ms], welcomed?, last?, away?}
     mailTokens/{tok}    {uid}: the unsubscribe link's key
     mailAddr/{sha256}   {n: [ms]}: codes sent to one address in the last day, against using us to pester people
     mailIp/{sha256}     {n: [ms]}: codes asked for from one IP address in the last day (fresh guest accounts are free,
                         so a limit per player alone does not stop anyone sending codes to a list of addresses)
     mailState/verify    {d, n}: codes sent today (d, whole days since 1970) across the game, at most VERIFY_DAY

   A code goes only to a player with a nation, and its letter names no nation: the address's owner never asked for
   it, so it carries no words a player chose. */
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
import { refuse } from './eligibility.js';
import { mailConfig, send, verifyLetter, welcomeLetter, recoveryLetter, digest, token, validEmail, cleanPrefs, defaultPrefs } from './mail-core.js';

const DAY = 86400000, CODE_MS = 30 * 60000, IP_DAY = 30, VERIFY_DAY = 500, RECOVERY_DAY = 300;

async function who(db, uid) {
  const s = await db.doc('summaries/' + uid).get(), n = s.exists ? s.get('name') : '';
  return { nation: typeof n === 'string' ? n : '' };
}

export async function mailUnsub(d) {
  const db = getFirestore(), t = typeof d.t === 'string' && /^[\w-]{10,40}$/.test(d.t) ? d.t : '';
  const s = t ? await db.doc('mailTokens/' + t).get() : null;
  if (!s || !s.exists) refuse('mail_link', 'This link is no longer valid. Choose your letters in Settings instead.');
  const ref = db.doc('mailAccounts/' + s.get('uid'));
  if ((await ref.get()).exists) await ref.update({ p: Object.fromEntries(Object.keys(defaultPrefs()).map(k => [k, false])) });
  return { ok: true };
}

export async function forgetMail(uid) {
  const db = getFirestore(), ref = db.doc('mailAccounts/' + uid), s = await ref.get();
  if (!s.exists) return;
  if (s.get('tok')) await db.doc('mailTokens/' + s.get('tok')).delete();
  await ref.delete();
}

/* accounts({op: 'recoveryMail', email, code}) → {ok: true}: a guest's recovery code, mailed once to the address it
   typed (src/shim.js, mailRecovery). Only the code the account holds now (its hash in accountIdentity, for this
   sign-in's generation: functions/accounts.js, issue) can go, so the letter carries nothing else a player chose.
   Neither the code nor the address is kept: only the limits, per account (recoveryLimits/m_{uid}, which expires),
   per address and per IP address (mailAddr, mailIp, shared with the confirmation codes) and the day's total
   (mailState/recovery). */
export async function recoveryMail(db, who, d, ip = '') {
  const now = Date.now(), e = String(d.email || '').trim().toLowerCase(), code = typeof d.code === 'string' ? d.code.toUpperCase().replace(/[\s-]/g, '') : '';
  if (!validEmail(e)) throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  if (!/^EDC[A-F0-9]{40}$/.test(code)) throw new HttpsError('invalid-argument', 'That is not a recovery code.');
  if (who.registered) refuse('already_registered', 'Registered Nations recover through their linked sign-in.');
  const mine = db.doc('recoveryLimits/m_' + who.uid), addr = db.doc('mailAddr/' + digest(e)), from = db.doc('mailIp/' + digest('ip:' + (ip || 'unknown')));
  const total = db.doc('mailState/recovery'), today = Math.floor(now / DAY);
  await db.runTransaction(async tx => {
    const [a, m, ad, f, g] = await tx.getAll(db.doc('accountIdentity/' + who.uid), mine, addr, from, total);
    if (!a.exists || a.get('generation') !== who.generation || a.get('recoveryHash') !== digest(code))
      refuse('recovery_not_current', 'That is not your current recovery code. Regenerate your key to get a new one.');
    const recent = s => (s.exists && s.get('n') || []).filter(t => now - t < DAY);
    const mN = recent(m), aN = recent(ad), fN = recent(f), gN = g.exists && g.get('d') === today ? g.get('n') || 0 : 0;
    if (mN.length && now - mN.at(-1) < 60000) throw new HttpsError('resource-exhausted', 'Wait a minute before sending it again.');
    if (mN.length >= 3) throw new HttpsError('resource-exhausted', 'That is enough letters for today. Copy or download the code instead.');
    if (aN.length >= 3) throw new HttpsError('resource-exhausted', 'That address has had enough letters for today. Try again tomorrow.');
    if (fN.length >= IP_DAY || gN >= RECOVERY_DAY) throw new HttpsError('resource-exhausted', 'The Herald has sent all the letters it can for today. Copy or download the code instead.');
    tx.set(mine, { n: mN.concat(now), exp: Timestamp.fromMillis(now + DAY) });
    tx.set(addr, { n: aN.concat(now) });
    tx.set(from, { n: fN.concat(now) });
    tx.set(total, { d: today, n: gN + 1 });
  });
  const cfg = await mailConfig(db);
  try { await send(db, [recoveryLetter(cfg, { to: e, code })], cfg); }
  catch (err) { if (err.code === 'mail_off') refuse('mail_off', err.message); throw new HttpsError('unavailable', 'The Herald could not send the letter. Try again in a while.'); }
  return { ok: true };
}

export async function mailStep(uid, d, ip = '') {
  const db = getFirestore(), ref = db.doc('mailAccounts/' + uid), now = Date.now();
  if (d.step === 'status') {
    const s = await ref.get();
    if (!s.exists) return { email: '', ok: false, p: defaultPrefs(), wait: false };
    return { email: s.get('e') || '', ok: !!s.get('ok'), p: cleanPrefs(s.get('p')), wait: !s.get('ok') && !!s.get('code') && now - (s.get('codeAt') || 0) < CODE_MS };
  }
  if (d.step === 'remove') { await forgetMail(uid); return { ok: true }; }
  if (d.step === 'prefs') {
    const s = await ref.get();
    if (!s.exists || !s.get('ok')) refuse('mail_unconfirmed', 'Confirm your address first.');
    const p = cleanPrefs(d.p);
    await ref.update({ p });
    return { ok: true, p };
  }
  if (d.step === 'set') {
    const e = String(d.email || '').trim().toLowerCase();
    if (!validEmail(e)) throw new HttpsError('invalid-argument', 'That does not look like an email address.');
    if (!(await db.doc('summaries/' + uid).get()).exists) refuse('nation_required', 'Found and save a nation first.');
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'), addr = db.doc('mailAddr/' + digest(e));
    const from = db.doc('mailIp/' + digest('ip:' + (ip || 'unknown'))), total = db.doc('mailState/verify'), today = Math.floor(now / DAY);
    await db.runTransaction(async tx => {
      const [s, a, f, g] = await tx.getAll(ref, addr, from, total);
      const sends = (s.exists && s.get('sends') || []).filter(t => now - t < DAY), aN = (a.exists && a.get('n') || []).filter(t => now - t < DAY);
      const fN = (f.exists && f.get('n') || []).filter(t => now - t < DAY), gN = g.exists && g.get('d') === today ? g.get('n') || 0 : 0;
      if (sends.length && now - sends.at(-1) < 60000) throw new HttpsError('resource-exhausted', 'Wait a minute before asking for another code.');
      if (sends.length >= 5) throw new HttpsError('resource-exhausted', 'That is enough codes for today. Try again tomorrow.');
      if (aN.length >= 3) throw new HttpsError('resource-exhausted', 'That address has had enough codes for today. Try again tomorrow.');
      if (fN.length >= IP_DAY || gN >= VERIFY_DAY) throw new HttpsError('resource-exhausted', 'The Herald has sent all the codes it can for today. Try again tomorrow.');
      const keep = s.exists && s.get('ok') && s.get('e') === e;
      if (keep) refuse('mail_same', 'That address is already confirmed.');
      tx.set(ref, { e, ok: false, code: digest(uid + ':' + code), codeAt: now, tries: 0, sends: sends.concat(now), p: s.exists ? cleanPrefs(s.get('p')) : defaultPrefs(), tok: s.exists && s.get('tok') || '', welcomed: s.exists && !!s.get('welcomed') }, { merge: false });
      tx.set(addr, { n: aN.concat(now) });
      tx.set(from, { n: fN.concat(now) });
      tx.set(total, { d: today, n: gN + 1 });
    });
    const cfg = await mailConfig(db);
    try { await send(db, [verifyLetter(cfg, { to: e, code })], cfg); }
    catch (err) { if (err.code === 'mail_off') refuse('mail_off', err.message); throw new HttpsError('unavailable', 'The Herald could not send the letter. Try again in a while.'); }
    return { ok: true };
  }
  if (d.step === 'verify') {
    const code = String(d.code || '').replace(/\D/g, '');
    const res = await db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists || s.get('ok') || !s.get('code')) refuse('mail_nocode', 'Ask for a code first.');
      if (now - s.get('codeAt') > CODE_MS) refuse('mail_expired', 'That code has expired. Ask for a new one.');
      if ((s.get('tries') || 0) >= 5) refuse('mail_tries', 'Too many wrong codes. Ask for a new one.');
      if (digest(uid + ':' + code) !== s.get('code')) { tx.update(ref, { tries: (s.get('tries') || 0) + 1 }); return { wrong: true }; }
      const tok = s.get('tok') || token();
      tx.update(ref, { ok: true, code: '', tries: 0, tok, okAt: now, welcomed: true });
      tx.set(db.doc('mailTokens/' + tok), { uid });
      return { e: s.get('e'), tok, welcome: !s.get('welcomed') };
    });
    if (res.wrong) refuse('mail_wrong', 'That is not the code we sent. Check the letter and try again.');
    if (res.welcome) {
      const cfg = await mailConfig(db), { nation } = await who(db, uid);
      try { await send(db, [welcomeLetter(cfg, { to: res.e, nation, tok: res.tok })], cfg); } catch (err) { console.error('welcome letter', err.message); }
    }
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown mail step.');
}
