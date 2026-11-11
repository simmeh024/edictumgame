import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { eligibility, refuse } from './eligibility.js';
import { pushChatMention } from './letters.js';

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
   admin portal removes (functions/admin.js, delete_post).
   Staff (an admin or mod claim) also, from the admin portal's Region chats page or a line's menu:
     - write in any region's chat as the Edictum team (rcPost team: a line {tm: true, nm 'Edictum team', a: the staff
       member's uid}), which needs no nation there;
     - silence a player (rcMute: rcMute/{uid} {until, perm?, why, by, t, nm, reg}), for an hour, a day, a week, 30 days
       or until lifted, optionally removing their lines of the last 24 hours in that region; rcPost refuses a silenced
       player, who reads their own silence (firestore.rules) and sees it in place of the writing box; admins read every
       one. rcUnmute lifts it. Both are in the audit log; staff cannot be silenced.
   A line may answer another line of the same chat (re: it keeps r {id, a, nm, x} with a few of its words) and @mention
   up to RC_MN nations of the region (mn: the ids the writer's game picked; the server keeps those whose saved name
   follows an @ in the words, who have not blocked the writer, as mn {uid: name}). Each one mentioned, and the author of
   the line answered, gets mentions/{uid}/m/{id} {k: 'chat', by, nm, reg, rc, x, t, rp?} for their bell, and a push
   notification when they are not in the game (functions/letters.js, pushChatMention). Reactions (rcReact): one of
   RC_REACT per nation per line, kept as rv {uid: kind} on the line; rcForget takes a nation's away with its account. */
export const RC_TEXT = 300, RC_GAP = 1500, RC_MINUTE = 12, RC_HOUR = 150, RC_SAME = 120000, RC_KEEP = 30 * 86400000;
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* the same words, however they are spaced or capitalised, for the repeat check */
const sameKey = x => line(x, RC_TEXT).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const RC_OPS = ['rcPost', 'rcDelete', 'rcMute', 'rcUnmute', 'rcReact'];
export const RC_MN = 5, RC_REACT = ['hear', 'ha', 'bravo', 'shame'], RC_RV_MAX = 300;
export const isRegionChatOp = op => RC_OPS.includes(op);
/* how long a silence lasts, in hours: 0 is until lifted (kept as a far-off until, with perm) */
export const RC_MUTE_HOURS = [1, 24, 168, 720, 0], RC_FOREVER = Date.UTC(2100, 0, 1), RC_WIPE = 86400000;
const uidOf = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-') ? v : '';
const staffOnly = who => { if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Only Edictum staff can do that.'); };
/* a silence still running at `now`, or null */
export function rcSilence(data, now) {
  if (!data || !Number.isFinite(data.until) || data.until <= now) return null;
  return { until: data.until, perm: data.perm === true, why: typeof data.why === 'string' ? data.why : '' };
}
const whenText = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

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
  const x = line(d.x, RC_TEXT), team = d.team === true, re = d.re ? id20(d.re) : '';
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  if (team) staffOnly(who);
  if (d.re && !re) throw new HttpsError('invalid-argument', 'Choose a line to answer.');
  const asked = [...new Set(Array.isArray(d.mn) ? d.mn.map(uidOf).filter(u => u && u !== who.uid) : [])].slice(0, RC_MN);
  let tell = [];
  const out = await db.runTransaction(async tx => {
    /* the team writes in any region, open or not, with no nation of its own there */
    const e = await eligibility(tx, who, team ? { linked: false, nation: false, hidden: true, allowClosedRegion: true } : {});
    const reg = team ? (typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '') : e.n.reg || e.saved.get('reg') || '';
    if (team && !reg) throw new HttpsError('invalid-argument', 'Choose a region.');
    if (!regions.has(reg)) refuse('rc_region', 'Your nation has no region to talk in.');
    if (!team && typeof d.reg === 'string' && d.reg && d.reg !== reg) refuse('rc_region', 'Your nation is in another region now. Reload the game to join its chat.');
    const pace = db.doc('rcPace/' + who.uid), [ps, ms] = await tx.getAll(pace, db.doc('rcMute/' + who.uid)), now = Date.now();
    const sil = rcSilence(ms.exists ? ms.data() : null, now);
    if (sil) throw new HttpsError('failed-precondition', `You are silenced in the region chat${sil.perm ? '' : ' until ' + whenText(sil.until)}${sil.why ? ': ' + sil.why : ''}.`, { code: 'rc_silenced', until: sil.until, perm: sil.perm, why: sil.why });
    const { wait, recent } = rcWait(ps.exists ? ps.get('p') : [], now);
    if (wait > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(wait / 1000)} ${Math.ceil(wait / 1000) === 1 ? 'second' : 'seconds'}.`, { code: 'rc_paced', wait });
    const h = hash(sameKey(x)), last = recent.length ? recent[recent.length - 1] : 0;
    if (ps.exists && ps.get('h') === h && now - last < RC_SAME) refuse('rc_same', 'You just wrote that.');
    /* the line answered: in the same chat, still there */
    let r = null;
    if (re) {
      const rs = await tx.get(db.doc('rchat/' + reg + '/chat/' + re));
      if (!rs.exists) refuse('rc_gone', 'That line is no longer in the chat.');
      r = { id: re, a: line(rs.get('a'), 128), nm: rs.get('tm') === true ? 'Edictum team' : line(rs.get('nm'), 80) || 'A nation', x: line(rs.get('x'), 90), ...(rs.get('tm') === true ? { tm: true } : {}) };
    }
    /* the nations mentioned: of this region, named after an @, not blocking the writer; and the author answered */
    const low = x.toLowerCase(), mn = {}, toTell = new Map();
    const ask = asked.concat(r && !r.tm && r.a !== who.uid && !asked.includes(r.a) ? [r.a] : []);
    const got = ask.length ? await tx.getAll(...ask.flatMap(u => [db.doc('nations/' + u), db.doc('lblock/' + u + '~' + who.uid)])) : [];
    ask.forEach((u, i) => {
      const n = got[2 * i], block = got[2 * i + 1], nm = n.exists ? line(n.get('name'), 80) : '';
      if (!nm || block.exists || n.get('reg') !== reg) return;
      if (asked.includes(u) && low.includes('@' + nm.toLowerCase())) { mn[u] = nm; toTell.set(u, false); }
      else if (r && u === r.a) toTell.set(u, true);
    });
    const ref = db.collection('rchat/' + reg + '/chat').doc(), me = team ? 'Edictum team' : line(e.saved.get('name'), 80) || 'A nation';
    tx.set(pace, { p: recent.concat(now).slice(-RC_HOUR), h });
    tx.create(ref, { a: who.uid, nm: me, x, t: now, exp: Timestamp.fromMillis(now + RC_KEEP),
      ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}), ...(team ? { tm: true } : {}), ...(r ? { r } : {}), ...(Object.keys(mn).length ? { mn } : {}) });
    for (const [u, rp] of toTell) tx.create(db.collection('mentions/' + u + '/m').doc(), { k: 'chat', by: who.uid, nm: me, reg, rc: ref.id, x: line(x, 160), t: now, ...(rp ? { rp: true } : {}) });
    tell = [...toTell].map(([u, rp]) => ({ u, rp, nm: me }));
    return { ok: true, id: ref.id, reg, t: now, ...(Object.keys(mn).length ? { mn } : {}) };
  });
  /* a push notification for those not in the game; never holds the line up */
  if (tell.length) await Promise.all(tell.map(t => pushChatMention(db, t.u, who.uid, t.nm, t.rp).catch(() => 0)));
  return out;
}

/* a reaction: the same one again takes it back; another replaces it */
async function rcReact(db, who, d, regions) {
  const reg = typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '', id = id20(d.id), kind = RC_REACT.includes(d.k) ? d.k : '';
  if (!reg || !id || !kind) throw new HttpsError('invalid-argument', 'Choose a line and a reaction.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false });
    if (!(who.admin || who.mod) && (e.n.reg || e.saved.get('reg')) !== reg) throw new HttpsError('permission-denied', 'React in your own region’s chat.');
    const ref = db.doc('rchat/' + reg + '/chat/' + id), s = await tx.get(ref);
    if (!s.exists) refuse('rc_gone', 'That line is no longer in the chat.');
    const rv = s.get('rv') && typeof s.get('rv') === 'object' ? s.get('rv') : {}, had = rv[who.uid] || '', pick = had === kind ? '' : kind;
    if (pick && !had && Object.keys(rv).length >= RC_RV_MAX) refuse('rc_full', 'This line has all the reactions it can hold.');
    tx.update(ref, new FieldPath('rv', who.uid), pick || FieldValue.delete());
    return { ok: true, k: pick };
  });
}
/* a nation's reactions go with its account (functions/accounts.js) or its removal by an admin (functions/admin.js) */
export async function rcForget(db, uid, regs) {
  if (!uidOf(uid)) return 0;
  const found = await Promise.all([...regs].map(reg => db.collection('rchat/' + reg + '/chat').where(new FieldPath('rv', uid), 'in', RC_REACT).get().catch(() => ({ docs: [] }))));
  const docs = found.flatMap(q => q.docs);
  if (!docs.length) return 0;
  const w = db.bulkWriter();
  await Promise.all([Promise.all(docs.map(s => w.update(s.ref, new FieldPath('rv', uid), FieldValue.delete()))), w.close()]);
  return docs.length;
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

/* staff silence a player in every region's chat; with wipe, their lines of the last 24 hours in `reg` (their own region
   if not given) go too. The audit log keeps who, why, until when and how many lines went */
async function rcMute(db, who, d, regions) {
  staffOnly(who);
  const uid = uidOf(d.uid), hours = Number(d.hours), why = line(d.why, 200);
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a player.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You cannot silence yourself.');
  if (!RC_MUTE_HOURS.includes(hours)) throw new HttpsError('invalid-argument', 'Choose how long.');
  let target = null;
  try { target = await getAuth().getUser(uid); } catch { /* an account Firebase no longer has: silenced all the same */ }
  if (target && (target.customClaims?.admin === true || target.customClaims?.mod === true)) refuse('rc_staff', 'Edictum staff cannot be silenced.');
  const nation = await db.doc('nations/' + uid).get(), now = Date.now();
  const nm = line(nation.get('name'), 80), home = line(nation.get('reg'), 40);
  const reg = typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : regions.has(home) ? home : '';
  const until = hours ? now + hours * 3600000 : RC_FOREVER;
  let removed = 0;
  if (d.wipe === true && reg) {
    const qs = await db.collection('rchat/' + reg + '/chat').where('a', '==', uid).get();
    const old = qs.docs.filter(s => Number(s.get('t')) > now - RC_WIPE && s.get('tm') !== true).slice(0, 450);
    if (old.length) { const b = db.batch(); old.forEach(s => b.delete(s.ref)); await b.commit(); removed = old.length; }
  }
  const b = db.batch();
  b.set(db.doc('rcMute/' + uid), { until, ...(hours ? {} : { perm: true }), why, by: who.uid, t: now, nm, reg: home });
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_silence', outcome: 'completed', at: FieldValue.serverTimestamp(),
    target: uid, name: nm, reg: reg || home, until, hours, removed, reason: why || 'Silenced in the region chat' });
  await b.commit();
  return { ok: true, until, perm: !hours, removed };
}
async function rcUnmute(db, who, d) {
  staffOnly(who);
  const uid = uidOf(d.uid);
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a player.');
  const ref = db.doc('rcMute/' + uid), s = await ref.get();
  if (!s.exists) return { ok: true };
  const b = db.batch();
  b.delete(ref);
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_unsilence', outcome: 'completed', at: FieldValue.serverTimestamp(),
    target: uid, name: line(s.get('nm'), 80), reg: line(s.get('reg'), 40), reason: line(d.why, 200) || 'Silence lifted' });
  await b.commit();
  return { ok: true };
}

const OPS = { rcPost, rcDelete, rcMute, rcUnmute, rcReact };
export function regionChat(db, who, d, regions) {
  return OPS[d.op](db, who, d, regions);
}
