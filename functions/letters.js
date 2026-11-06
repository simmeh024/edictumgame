/* Letters between players, told to their readers (src/shim.js, lettersApi.notify and push; game/edictum.html).

   It runs inside the accounts callable (functions/accounts.js), like mail.js: a brand-new public function cannot be
   deployed by CI (the invoker IAM on Cloud Run).
   accounts({op: 'letters', step: 'key'})               → {key}: the push service's public key ('' until set up)
   accounts({op: 'letters', step: 'add', sub})          → {ok: true}: keeps this device's push subscription (five a player)
   accounts({op: 'letters', step: 'remove', endpoint})  → {ok: true}
   accounts({op: 'letters', step: 'status', endpoint})  → {on}: whether that subscription is kept
   accounts({op: 'letters', step: 'notify', ids})       → {ok: true, n}: the caller's letters just delivered
       (letters/<id>, written by the caller in the last 15 minutes). Each reader who is not in the game just now hears
       of them, at most once per writer every 10 minutes, unless they blocked or muted the writer (their own half,
       nationp: dmx.bl, dmx.mu): a push notification on every device that asked for them, and a letter by post when
       they chose letters right away (mailAccounts p.msg and p.now). Neither carries the letter's words.

   Storage (server only; firestore.rules): pushSubs/<uid> {s: [{e, k: {p256dh, auth}, at}]}, lnote/<by>~<to> {t},
   mailAccounts/<uid>.nowN {d, n}: letters by post sent right away today. The keys are in authConfig/push {pub, priv,
   subject}, set by the owner with tools/admin/set-push.mjs. Without them nothing is pushed: in the emulators each
   notification is written to pushOutbox/<id> instead, so the tests can read it. */
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { mailConfig, send, nowLetter } from './mail-core.js';

const NOTE_GAP = 10 * 60000, FRESH = 15 * 60000, ONLINE = 3 * 60000, SUBS_MAX = 5, NOW_DAY = 40, DAY = 86400000;
const emulated = () => process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
const ms = v => typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const LETTER_ID = /^([\w-]{1,128})~([\w-]{1,128})~(\d{1,16})$/;

let keysAt = 0, keys = null;
async function pushKeys(db) {
  if (keys && Date.now() - keysAt < 300000) return keys;
  const s = await db.doc('authConfig/push').get();
  keys = s.exists && s.get('pub') && s.get('priv') ? { pub: s.get('pub'), priv: s.get('priv'), subject: s.get('subject') || 'mailto:herald@edictumgame.com' } : null;
  keysAt = Date.now();
  return keys;
}
function cleanSub(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const e = sub.endpoint, k = sub.keys || {};
  if (typeof e !== 'string' || e.length > 800 || !/^https:\/\/[^\s]+$/.test(e)) return null;
  if (typeof k.p256dh !== 'string' || k.p256dh.length > 200 || typeof k.auth !== 'string' || k.auth.length > 100) return null;
  return { e, k: { p256dh: k.p256dh, auth: k.auth }, at: Date.now() };
}
/* what a player chose about letters, from their own half (the game's dmx) */
async function choices(db, uid) {
  const s = await db.doc('nationp/' + uid).get();
  let o = null;
  try { o = s.exists && typeof s.get('j') === 'string' ? JSON.parse(s.get('j')) : null; } catch (e) { o = null; }
  const x = o && typeof o.dmx === 'object' && o.dmx ? o.dmx : {};
  return { bl: new Set(Array.isArray(x.bl) ? x.bl.filter(isId) : []), mu: x.mu && typeof x.mu === 'object' ? x.mu : {} };
}
async function pushTo(db, uid, payload) {
  const ref = db.doc('pushSubs/' + uid), s = await ref.get(), subs = s.exists && Array.isArray(s.get('s')) ? s.get('s') : [];
  if (!subs.length) return 0;
  const k = await pushKeys(db);
  if (!k) {
    if (!emulated()) return 0;
    await db.collection('pushOutbox').add({ to: uid, n: subs.length, payload, t: Date.now() });
    return subs.length;
  }
  webpush.setVapidDetails(k.subject, k.pub, k.priv);
  let sent = 0;
  const gone = [];
  for (const x of subs) {
    try { await webpush.sendNotification({ endpoint: x.e, keys: x.k }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' }); sent++; }
    catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push(x.e); }
  }
  if (gone.length) await ref.set({ s: subs.filter(x => !gone.includes(x.e)) });
  return sent;
}

export async function forgetLetters(uid) {
  const db = getFirestore();
  const q = await Promise.all([
    db.collection('lpair').where('by', '==', uid).get(), db.collection('lpair').where('to', '==', uid).get(),
    db.collection('lblock').where('b', '==', uid).get(), db.collection('lblock').where('x', '==', uid).get(),
    db.collection('lseen').where('r', '==', uid).get(), db.collection('lseen').where('w', '==', uid).get()
  ]);
  const refs = q.flatMap(r => r.docs.map(d => d.ref)).concat([db.doc('pushSubs/' + uid)]);
  for (let i = 0; i < refs.length; i += 400) { const b = db.batch(); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
}

export async function lettersStep(uid, d) {
  const db = getFirestore(), now = Date.now();
  if (d.step === 'key') { const k = await pushKeys(db); return { key: k ? k.pub : '' }; }
  if (d.step === 'add') {
    const x = cleanSub(d.sub);
    if (!x) throw new HttpsError('invalid-argument', 'That is not a push subscription.');
    const ref = db.doc('pushSubs/' + uid);
    await db.runTransaction(async tx => {
      const s = await tx.get(ref), subs = s.exists && Array.isArray(s.get('s')) ? s.get('s') : [];
      tx.set(ref, { s: subs.filter(o => o.e !== x.e).concat(x).slice(-SUBS_MAX) });
    });
    return { ok: true };
  }
  if (d.step === 'remove' || d.step === 'status') {
    const e = typeof d.endpoint === 'string' ? d.endpoint : '', ref = db.doc('pushSubs/' + uid), s = await ref.get();
    const subs = s.exists && Array.isArray(s.get('s')) ? s.get('s') : [];
    if (d.step === 'status') return { on: !!e && subs.some(o => o.e === e) };
    if (subs.some(o => o.e === e)) await ref.set({ s: subs.filter(o => o.e !== e) });
    return { ok: true };
  }
  if (d.step !== 'notify') throw new HttpsError('invalid-argument', 'Unknown step.');
  const ids = Array.isArray(d.ids) ? [...new Set(d.ids.filter(x => typeof x === 'string'))].slice(0, 13) : [];
  const fresh = [];
  for (const id of ids) {
    const m = LETTER_ID.exec(id);
    if (!m || m[1] !== uid) continue;
    const s = await db.doc('letters/' + id).get();
    if (!s.exists || s.get('by') !== uid || now - ms(s.get('ts')) > FRESH) continue;
    fresh.push({ to: s.get('to'), g: s.get('g') && typeof s.get('g').id === 'string' ? s.get('g') : null });
  }
  if (!fresh.length) return { ok: true, n: 0 };
  const me = await db.doc('summaries/' + uid).get(), name = me.exists && typeof me.get('name') === 'string' ? me.get('name') : 'A nation';
  let told = 0, cfg = null;
  for (const f of fresh) {
    const to = f.to;
    if (!isId(to)) continue;
    const noteRef = db.doc('lnote/' + uid + '~' + to), note = await noteRef.get();
    if (note.exists && now - (note.get('t') || 0) < NOTE_GAP) continue;
    const pres = await db.doc('presence/' + to).get();
    if (pres.exists && now - ms(pres.get('t')) < ONLINE) continue;
    const c = await choices(db, to);
    if (c.bl.has(uid) || c.mu[uid] || (f.g && c.mu[f.g.id])) continue;
    await noteRef.set({ t: now });
    const group = f.g && typeof f.g.nm === 'string' && f.g.nm ? f.g.nm : '';
    const payload = { title: group ? `${name} wrote to ${group}` : `A letter from ${name}`, body: group ? 'A new letter in your group conversation.' : `${name} has written to you.`, tag: 'letter-' + (f.g ? f.g.id : uid), url: '/#messages' };
    const pushed = await pushTo(db, to, payload);
    /* a letter by post, right away, for a reader who asked for that */
    const acc = await db.doc('mailAccounts/' + to).get();
    let mailed = 0;
    if (acc.exists && acc.get('ok') && acc.get('e') && acc.get('p') && acc.get('p').msg && acc.get('p').now) {
      const day = Math.floor(now / DAY), nn = acc.get('nowN') || {}, count = nn.d === day ? nn.n || 0 : 0;
      if (count < NOW_DAY) {
        const them = await db.doc('summaries/' + to).get();
        cfg = cfg || await mailConfig(db);
        try {
          mailed = await send(db, [nowLetter(cfg, { to: acc.get('e'), nation: them.exists ? them.get('name') : '', from: name, group, tok: acc.get('tok') })], cfg);
          await acc.ref.update({ nowN: { d: day, n: count + 1 } });
        } catch (e) { mailed = 0; }
      }
    }
    if (pushed || mailed) told++;
  }
  return { ok: true, n: told };
}
