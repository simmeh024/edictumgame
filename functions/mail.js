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
     mailAddr/{sha256}   {n: [ms]}: codes sent to one address in the last day, against using us to pester people */
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
import { refuse } from './eligibility.js';
import { mailConfig, send, verifyLetter, welcomeLetter, digest, token, validEmail, cleanPrefs, defaultPrefs } from './mail-core.js';

const DAY = 86400000, CODE_MS = 30 * 60000;

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

export async function mailStep(uid, d) {
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
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'), addr = db.doc('mailAddr/' + digest(e));
    await db.runTransaction(async tx => {
      const [s, a] = await tx.getAll(ref, addr);
      const sends = (s.exists && s.get('sends') || []).filter(t => now - t < DAY), aN = (a.exists && a.get('n') || []).filter(t => now - t < DAY);
      if (sends.length && now - sends.at(-1) < 60000) throw new HttpsError('resource-exhausted', 'Wait a minute before asking for another code.');
      if (sends.length >= 5) throw new HttpsError('resource-exhausted', 'That is enough codes for today. Try again tomorrow.');
      if (aN.length >= 3) throw new HttpsError('resource-exhausted', 'That address has had enough codes for today. Try again tomorrow.');
      const keep = s.exists && s.get('ok') && s.get('e') === e;
      if (keep) refuse('mail_same', 'That address is already confirmed.');
      tx.set(ref, { e, ok: false, code: digest(uid + ':' + code), codeAt: now, tries: 0, sends: sends.concat(now), p: s.exists ? cleanPrefs(s.get('p')) : defaultPrefs(), tok: s.exists && s.get('tok') || '', welcomed: s.exists && !!s.get('welcomed') }, { merge: false });
      tx.set(addr, { n: aN.concat(now) });
    });
    const cfg = await mailConfig(db), { nation } = await who(db, uid);
    try { await send(db, [verifyLetter(cfg, { to: e, code, nation })], cfg); }
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
