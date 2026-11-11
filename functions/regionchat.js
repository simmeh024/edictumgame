import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { eligibility, refuse } from './eligibility.js';

/* Region chat: one live channel per region, where the region's nations talk in short lines. Written only here (civic
   ops rcPost, rcDelete), so every line carries the author the server knows; read only by the region's own nations and
   admins (firestore.rules).
     rchat/{reg}/chat/{id}   a line {a, nm, x, t, exp, st?}: the author's uid and nation name as it was, the words, the
                             server's time (ms), when Firestore's time-to-live policy may delete it (exp, RC_KEEP on)
                             and an Edictum staff mark (st 'admin' or 'mod')
     rcPace/{uid}            {p, h}: the times of the player's lines in the last hour and a hash of their last words,
                             server-only
   The lines are a 'chat' collection with the author in `a`, as the alliance channels are, so deleting an account or an
   admin removing or banning a nation takes them too (functions/accounts.js, functions/admin.js).
   Any Registered Nation writes in its own region's chat; a guest reads it. Blocking a nation (lblock, Letters) hides
   its lines in the blocker's game; the author is not told. A reported line is a 'post' report rc:<reg>:<id>, which the
   admin portal removes (functions/admin.js, delete_post). */
export const RC_TEXT = 300, RC_GAP = 1500, RC_MINUTE = 12, RC_HOUR = 150, RC_SAME = 120000, RC_KEEP = 30 * 86400000;
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* the same words, however they are spaced or capitalised, for the repeat check */
const sameKey = x => line(x, RC_TEXT).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const isRegionChatOp = op => op === 'rcPost' || op === 'rcDelete';

/* how long the player must wait before another line: a second and a half after the last, at most RC_MINUTE in any
   minute and RC_HOUR in any hour. p: the times of their lines (ms), newest last */
export function rcWait(p, now) {
  const recent = (Array.isArray(p) ? p : []).filter(t => typeof t === 'number' && t <= now && now - t < 3600000).sort((a, b) => a - b);
  let wait = recent.length ? recent[recent.length - 1] + RC_GAP - now : 0;
  const minute = recent.filter(t => now - t < 60000);
  if (minute.length >= RC_MINUTE) wait = Math.max(wait, minute[minute.length - RC_MINUTE] + 60000 - now);
  if (recent.length >= RC_HOUR) wait = Math.max(wait, recent[recent.length - RC_HOUR] + 3600000 - now);
  return { wait: Math.max(0, wait), recent };
}

async function rcPost(db, who, d, regions) {
  const x = line(d.x, RC_TEXT);
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who);
    const reg = e.n.reg || e.saved.get('reg') || '';
    if (!regions.has(reg)) refuse('rc_region', 'Your nation has no region to talk in.');
    if (typeof d.reg === 'string' && d.reg && d.reg !== reg) refuse('rc_region', 'Your nation is in another region now. Reload the game to join its chat.');
    const pace = db.doc('rcPace/' + who.uid), ps = await tx.get(pace), now = Date.now();
    const { wait, recent } = rcWait(ps.exists ? ps.get('p') : [], now);
    if (wait > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(wait / 1000)} ${Math.ceil(wait / 1000) === 1 ? 'second' : 'seconds'}.`, { code: 'rc_paced', wait });
    const h = hash(sameKey(x)), last = recent.length ? recent[recent.length - 1] : 0;
    if (ps.exists && ps.get('h') === h && now - last < RC_SAME) refuse('rc_same', 'You just wrote that.');
    const ref = db.collection('rchat/' + reg + '/chat').doc();
    tx.set(pace, { p: recent.concat(now).slice(-RC_HOUR), h });
    tx.create(ref, { a: who.uid, nm: line(e.saved.get('name'), 80) || 'A nation', x, t: now, exp: Timestamp.fromMillis(now + RC_KEEP),
      ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}) });
    return { ok: true, id: ref.id, reg, t: now };
  });
}

/* the author deletes their own line; staff delete anyone's, which the audit log keeps (with the words) */
export async function rcDelete(db, who, d, regions) {
  const reg = typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '', id = id20(d.id);
  if (!reg || !id) throw new HttpsError('invalid-argument', 'Choose a line.');
  const ref = db.doc('rchat/' + reg + '/chat/' + id), s = await ref.get();
  if (!s.exists) return { ok: true };
  const staff = who.admin || who.mod;
  if (s.get('a') !== who.uid && !staff) throw new HttpsError('permission-denied', 'You can only delete your own lines.');
  const b = db.batch();
  b.delete(ref);
  if (s.get('a') !== who.uid) {
    b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_delete', outcome: 'completed', at: FieldValue.serverTimestamp(),
      target: line(s.get('a'), 128), name: line(s.get('nm'), 80), reg, line: id, x: line(s.get('x'), RC_TEXT), reason: line(d.reason, 300) || 'Removed from the region chat' });
    const report = typeof d.report === 'string' && /^[\w-]{1,128}$/.test(d.report) ? d.report : '';
    if (report) b.delete(db.doc('reports/' + report));
  }
  await b.commit();
  return { ok: true };
}

export function regionChat(db, who, d, regions) {
  return d.op === 'rcPost' ? rcPost(db, who, d, regions) : rcDelete(db, who, d, regions);
}
