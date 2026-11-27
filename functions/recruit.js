/* Recruiting, the server's side (game/edictum.html, section "recruiting"; the ops arrive through the accounts callable,
   functions/accounts.js, because a new public function could not be deployed).

   recruit {by, dev?, via?}: a player who founded a nation through another player's link files recruits/<uid> here,
   once; each side's game then pays itself the bonus. A recruit counts only as a Registered Nation (a linked sign-in
   account), founded in the last RECRUIT_DAYS and after the recruiter's own nation: so a player who had a nation
   already, or two players opening each other's links, earn nothing.
   → {ok: true, e?, x?} or {ok: false, why}: 'guest' (link an account first), 'done' (filed already, with e and x, so a
   recruit whose claim was held can collect once the staff release it), 'held' (waiting for a staff check), 'refused'
   (the staff turned it down), 'old', 'gone' (no such recruiter), or the code eligibility() refused with
   ('nation_required' while the first save is on its way).
     The record, recruits/<uid> {r, t, p, m?, g?, h?, e?, x?, xm?, v?} (p: filed under the recruits' pact,
     functions/recruit-rules.js):
     h   held for a staff check, nothing paid to either side until an admin releases it (admin op recruitRule): 'ip' when
         the recruit plays from the address the recruiter last played from (accountSeen, functions/accounts.js), or
         when the two last played from the same one; 'dev' when the recruit's browser has played as the recruiter
         (the game keeps the accounts that played on the device, RC_UIDS, and says so). Families and schools share
         addresses, so nothing is refused here: a person looks. 'no' once refused: never paid.
     g   the recruiter's own recruiter, who earns a little from each recruit of their recruits (the lineage)
     e   founded in a region that needs players (RC_QUIET): a bigger founding gift for both sides
     x   filed during a double-rewards weekend (rcEvent/live, set from the admin portal): the founding gift doubled;
         xm, the later steps reached during one, each doubled too
     v   the channel the link came through (the share button: wa, fb, x…; 'qr' for the card's code; 'j' a /join link),
         from the visitor's first open, for the admins' funnel
   recruitStep: the recruit's game asks once its nation could have reached a later step; this reads the saved nation
   and adds the step to recruits/<uid>.m: 2 a week of play (saved RECRUIT_WEEK after founding), 4 a second city, 8 the
   joint goal (a trade with the recruiter within RECRUIT_GOAL of being filed). The recruiter's game reads m with the
   list. Each side pays itself once per step.
   recruitOpen {by, via?}: the visit, on the admins' funnel: recruitTrail/<uid> {r, o?, f?, l?, v?}, the first recruiter
   whose link this account followed, when it opened the link (o), first claimed with a nation (f, a guest's claim
   too) and was filed (l). Server only; the admins read it.
   recruitMine: the recruiter's own funnel, from the trails naming them: how many opened their link (o), founded through
   it (f) and were filed (n), and the guests who founded but have not linked an account yet (wait), with their names.
   recruitNote {m}: the recruiter's own words on their invitation (recruitNote/<uid> {m, t}, readable by anyone, shown
   to whoever opens their link before founding and on their card); no links, at most NOTE_MAX characters, '' to clear.
   The staff can clear one (admin op recruitNoteClear).
   joinLink: the caller's /join/<slug> (functions/join.js), made once from the nation's name.
   joinCard {img}: the caller's preview picture for it, a 1200 × 630 JPEG data URL the game drew. */
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { RC_PACT } from './recruit-rules.js';
import crypto from 'node:crypto';
import { eligibility, refuse, nationJSON, regionClosed, DAY } from './eligibility.js';
import { pace } from './pace.js';
import { rcPicData } from './regionchat.js';
import { slugOf, JOIN_SLUG, JOIN_VIA } from './join.js';
import DATA from './civic-data.json' with { type: 'json' };

export const RECRUIT_DAYS = 30, RECRUIT_WEEK = 7 * DAY, RECRUIT_GOAL = 14 * DAY, NOTE_MAX = 140;
const RC_UID = /^[A-Za-z0-9_-]{6,128}$/;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
const via = v => typeof v === 'string' && JOIN_VIA.test(v) ? v : '';
const emu = () => process.env.FUNCTIONS_EMULATOR === 'true';
/* an address worth comparing: in the emulators every test player calls from the loopback address, which says nothing */
const known = ip => typeof ip === 'string' && /^[\da-f.:]{2,45}$/i.test(ip) && !(emu() && /^(127\.|::1$|::ffff:127\.)/.test(ip)) ? ip : '';

/* why a claim is held for a staff check, or '' (see h above) */
export function holdOf({ dev, ip, seenBy, seenMe }) {
  if (dev === true) return 'dev';
  const by = known(seenBy), me = known(seenMe), now = known(ip);
  return by && (by === now || by === me) ? 'ip' : '';
}

/* the joint goal: a trade between the recruit and the recruiter, from the recruit's founding to RECRUIT_GOAL after it
   was filed. Only the side that accepts a deal logs it ('trade', a: the other side; 'tradeend' when one ends it), so
   both records are read; a deal either accepted (n.deals {w, a: 1, t}) counts too, while the log has rolled past it */
export const TRADE_KINDS = new Set(['trade', 'tradeend']);
export function goalMet(n, other, from, until) {
  const ok = t => Number(t) >= from && Number(t) <= until;
  return (Array.isArray(n && n.log) && n.log.some(l => l && TRADE_KINDS.has(l.k) && l.a === other && ok(l.s || l.t)))
    || (Array.isArray(n && n.deals) && n.deals.some(x => x && x.w === other && x.a === 1 && ok(x.t)));
}
export const goalOf = (recruit, recruiter, rid, cid, filedAt) => {
  const from = Number(recruit && recruit.founded) || 0, until = (filedAt || Date.now()) + RECRUIT_GOAL;
  return goalMet(recruit, rid, from, until) || goalMet(recruiter, cid, from, until);
};

/* a double-rewards weekend: rcEvent/live {m, from, until}, written by the admin portal (functions/admin.js, rcEvent) */
export async function rcEventOn(db, now = Date.now()) {
  const s = await db.doc('rcEvent/live').get().catch(() => null);
  return s && s.exists && Number(s.get('m')) > 1 && now >= ms(s.get('from')) && now < ms(s.get('until')) ? 2 : 0;
}

/* a region that needs players (e): open, and holding at most RC_QUIET of the average open region's active nations.
   counts: {id: active nations}, from home/live (functions/home.js, every five minutes: the counts the game's region
   picker shows); open: the open regions. The game shows the same (game/edictum.html, rcQuiet). */
export const RC_QUIET = 0.6, RC_QUIET_K = 1.5;
export function quietRegion(reg, counts, open) {
  if (!counts || !open.includes(reg) || open.length < 2) return false;
  const avg = open.reduce((s, id) => s + (counts[id] || 0), 0) / open.length;
  return avg > 0 && (counts[reg] || 0) <= avg * RC_QUIET;
}
let QUIET = { at: 0, counts: null, open: null };
export async function regionCounts(db, now = Date.now()) {
  if (QUIET.counts && now - QUIET.at < 5 * 60e3) return QUIET;
  const ids = DATA.regions.map(r => r.id);
  const [live, ...status] = await db.getAll(db.doc('home/live'), ...ids.map(id => db.doc('regionStatus/' + id)));
  const r = live.exists && live.get('r') && typeof live.get('r') === 'object' ? live.get('r') : null;
  QUIET = { at: now, counts: r ? Object.fromEntries(ids.map(id => [id, Number(r[id]?.n) || 0])) : null, open: ids.filter((id, i) => !regionClosed(status[i], id)) };
  return QUIET;
}

/* the first mark of each kind on this account's trail, naming the first recruiter only; extra fields go with the first */
async function rcTrail(db, uid, by, key, extra = {}) {
  const ref = db.doc('recruitTrail/' + uid);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (s.exists && (s.get('r') !== by || s.get(key))) return;
    const add = Object.fromEntries(Object.entries(extra).filter(([k, v]) => v && !(s.exists && s.get(k))));
    tx.set(ref, { r: by, [key]: FieldValue.serverTimestamp(), ...add }, { merge: true });
  });
}
export async function recruitOpen(db, who, by, v) {
  if (typeof by !== 'string' || !RC_UID.test(by) || by === who.uid) return { ok: false };
  await rcTrail(db, who.uid, by, 'o', { v: via(v) });
  return { ok: true };
}

/* what a filed record pays beyond the plain gift, for the game */
const bonusOf = s => ({ ...(s.get('e') ? { e: 1 } : {}), ...(Number(s.get('x')) > 1 ? { x: Number(s.get('x')) } : {}) });

export async function recruitStep(db, who) {
  const ref = db.doc('recruits/' + who.uid);
  const x = await rcEventOn(db);
  return db.runTransaction(async tx => {
    const rec = await tx.get(ref);
    if (!rec.exists) return { ok: false, why: 'none' };
    const r = String(rec.get('r') || ''), [saved, theirs] = await tx.getAll(db.doc('nations/' + who.uid), db.doc('nations/' + (RC_UID.test(r) ? r : '-')));
    if (!saved.exists) return { ok: false, why: 'none' };
    const n = nationJSON(saved), m0 = Number(rec.get('m')) || 0, founded = Number(n.founded) || 0, xm0 = Number(rec.get('xm')) || 0;
    const at = Number(saved.get('updatedAt')) || (saved.updateTime ? saved.updateTime.toMillis() : 0);
    let m = m0;
    if (founded > 0 && at - founded >= RECRUIT_WEEK) m |= 2;
    if (Array.isArray(n.cities) && n.cities.length >= 2) m |= 4;
    if (!(m & 8) && goalOf(n, theirs.exists ? nationJSON(theirs) : null, r, who.uid, ms(rec.get('t')))) m |= 8;
    const xm = x ? xm0 | (m & ~m0) : xm0;
    if (m !== m0) tx.update(ref, { m, ...(xm !== xm0 ? { xm } : {}) });
    return { ok: true, m, ...(xm ? { xm } : {}) };
  });
}

const bornOf = (saved, account) => {
  const gen = saved.createTime.toMillis(), at = account.exists && account.get('nationGeneration') === gen ? account.get('nationAt') : gen;
  const f = Number(nationJSON(saved).founded);
  return f > 0 ? Math.min(at, f) : at;
};
/* d: {by, dev?, via?}; ip: the caller's address (functions/accounts.js, address) */
export async function recruit(db, who, d, ip) {
  const by = d && d.by;
  if (typeof by !== 'string' || !RC_UID.test(by) || by === who.uid) throw new HttpsError('invalid-argument', 'Name the player whose link you followed.');
  if (!who.registered) {
    /* a guest who founded a nation through the link: on the trail, unpaid until an account is linked */
    if ((await db.doc('nations/' + who.uid).get()).exists) await rcTrail(db, who.uid, by, 'f', { v: via(d.via) });
    return { ok: false, why: 'guest' };
  }
  const ref = db.doc('recruits/' + who.uid), trail = db.doc('recruitTrail/' + who.uid);
  const [x, q, mine] = await Promise.all([rcEventOn(db), regionCounts(db).catch(() => null), db.doc('summaries/' + who.uid).get().catch(() => null)]);
  const reg = mine && mine.exists ? String(mine.get('reg') || '') : '';
  const e = !!(q && reg && quietRegion(reg, q.counts, q.open));
  return db.runTransaction(async tx => {
    const [filed, them, theirs, seenBy, seenMe, parent] = await tx.getAll(ref, db.doc('nations/' + by), db.doc('accountIdentity/' + by),
      db.doc('accountSeen/' + by), db.doc('accountSeen/' + who.uid), db.doc('recruits/' + by));
    if (filed.exists) {
      const h = filed.get('h');
      if (filed.get('r') !== by) return { ok: false, why: 'done' };
      return h === 'no' ? { ok: false, why: 'refused' } : h ? { ok: false, why: 'held' } : { ok: false, why: 'done', ...bonusOf(filed) };
    }
    let el;
    try { el = await eligibility(tx, who); } catch (err) { if (err.details?.code) return { ok: false, why: err.details.code }; throw err; }
    if (!them.exists) return { ok: false, why: 'gone' };
    const born = bornOf(el.saved, el.account);
    if (Date.now() - born > RECRUIT_DAYS * DAY || bornOf(them, theirs) >= born) return { ok: false, why: 'old' };
    const tr = await tx.get(trail);
    const h = holdOf({ dev: d.dev, ip, seenBy: seenBy.exists ? seenBy.get('ip') : '', seenMe: seenMe.exists ? seenMe.get('ip') : '' });
    const pr = parent.exists ? parent.get('r') : '';
    const g = typeof pr === 'string' && RC_UID.test(pr) && pr !== who.uid && pr !== by && parent.get('h') !== 'no' ? pr : '';
    const v = (tr.exists && tr.get('r') === by && via(tr.get('v'))) || via(d.via);
    tx.create(ref, { r: by, t: FieldValue.serverTimestamp(), p: 1, ...(g ? { g } : {}), ...(h ? { h } : {}), ...(e ? { e: 1 } : {}), ...(x ? { x } : {}), ...(v ? { v } : {}) });
    if (!tr.exists || tr.get('r') === by) tx.set(trail, { r: by, l: FieldValue.serverTimestamp(), ...(tr.exists && tr.get('f') ? {} : { f: FieldValue.serverTimestamp() }), ...(v && !(tr.exists && tr.get('v')) ? { v } : {}) }, { merge: true });
    return h ? { ok: false, why: 'held' } : { ok: true, ...(e ? { e: 1 } : {}), ...(x ? { x } : {}) };
  });
}

/* the recruiter's own funnel and the guests still to link an account */
export const MINE_WAIT = 30;
export async function recruitMine(db, who) {
  pace([['rm:' + who.uid, 10, 1 / 30]]);
  const qs = await db.collection('recruitTrail').where('r', '==', who.uid).select('o', 'f', 'l').limit(1000).get();
  let o = 0, f = 0, n = 0; const wait = [];
  for (const s of qs.docs) {
    /* whoever founded through the link opened it, whether or not the visit was noted first */
    if (s.get('o') || s.get('f') || s.get('l')) o++;
    if (s.get('f') || s.get('l')) f++;
    if (s.get('l')) n++; else if (s.get('f')) wait.push({ id: s.id, f: ms(s.get('f')) });
  }
  wait.sort((a, b) => b.f - a.f);
  const some = wait.slice(0, MINE_WAIT), sums = some.length ? await db.getAll(...some.map(w => db.doc('summaries/' + w.id)), { fieldMask: ['name', 'reg'] }) : [];
  return { ok: true, o, f, n, wait: some.map((w, i) => sums[i] && sums[i].exists ? { ...w, name: String(sums[i].get('name') || '').slice(0, 80), reg: String(sums[i].get('reg') || '') } : null).filter(Boolean) };
}

/* the recruiter's note: plain words, no links */
const LINKISH = /(https?:|www\.|:\/\/|\b[a-z0-9-]{2,}\.(?:com|net|org|io|gg|co|ly|me|app|xyz|ru|cn|tk|info|biz|link|site|online|shop|store|live|tv)\b|discord\.gg)/i;
export function noteText(m) {
  if (typeof m !== 'string') return '';
  return m.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
}
export async function recruitNote(db, who, d) {
  pace([['rn:' + who.uid, 5, 1 / 30]]);
  const m = noteText(d && d.m);
  if (m && LINKISH.test(m)) refuse('rc_note_link', 'Leave links and web addresses out of your note: your recruiting link is on the card already.');
  if (!(await db.doc('nations/' + who.uid).get()).exists) refuse('nation_required', 'Found and save a nation first.');
  if ((await db.doc('bans/' + who.uid).get()).exists) refuse('banned', 'This account is banned. You can contact support.');
  const ref = db.doc('recruitNote/' + who.uid);
  if (!m) await ref.delete(); else await ref.set({ m, t: Date.now() });
  return { ok: true, m };
}

/* the caller's /join/ slug: the one they have, else a new one from their nation's name (-2, -3… when taken) */
export async function joinLink(db, who) {
  pace([['jl:' + who.uid, 6, 1 / 30]]);
  const card = db.doc('joinCard/' + who.uid), have = await card.get();
  if (have.exists && JOIN_SLUG.test(String(have.get('s') || ''))) return { ok: true, s: have.get('s') };
  const sum = await db.doc('summaries/' + who.uid).get();
  if (!sum.exists) refuse('nation_required', 'Found and save a nation first.');
  const base = slugOf(sum.get('name'));
  const tries = [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map(k => base.slice(0, 37) + '-' + k), ...[0, 1, 2].map(() => base.slice(0, 34) + '-' + crypto.randomBytes(3).toString('hex'))];
  for (const s of tries) {
    const got = await db.runTransaction(async tx => {
      const [slug, mine] = await tx.getAll(db.doc('joinSlug/' + s), card);
      if (mine.exists && JOIN_SLUG.test(String(mine.get('s') || ''))) return mine.get('s');
      if (slug.exists && slug.get('u') !== who.uid) return '';
      tx.set(db.doc('joinSlug/' + s), { u: who.uid, t: Date.now() });
      tx.set(card, { s }, { merge: true });
      return s;
    });
    if (got) return { ok: true, s: got };
  }
  throw new HttpsError('aborted', 'Try again in a moment.');
}

/* a JPEG's size from its frame header: [width, height] or null */
export function jpegSize(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const k = b[i + 1], len = b.readUInt16BE(i + 2);
    if (k >= 0xc0 && k <= 0xcf && k !== 0xc4 && k !== 0xc8 && k !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    if (k === 0xd9 || k === 0xda || len < 2) return null;
    i += 2 + len;
  }
  return null;
}
export const CARD_MAX = 200 * 1024, CARD_W = 1200, CARD_H = 630;
export async function joinCard(db, who, d) {
  pace([['jc:' + who.uid, 3, 1 / 300]]);
  const pic = rcPicData(d && d.img, CARD_MAX, ['jpeg']);
  const b = pic ? Buffer.from(String(d.img).split(',')[1], 'base64') : null, wh = b && jpegSize(b);
  if (!b || !wh || wh[0] !== CARD_W || wh[1] !== CARD_H) throw new HttpsError('invalid-argument', 'That is not an invitation card.');
  const ref = db.doc('joinCard/' + who.uid), have = await ref.get(), h = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
  if (!have.exists || !have.get('s')) refuse('join_link', 'Ask for your link first.');
  if ((await db.doc('bans/' + who.uid).get()).exists) refuse('banned', 'This account is banned. You can contact support.');
  if (have.get('h') !== h) await ref.set({ img: b, h, at: Date.now() }, { merge: true });
  return { ok: true, h };
}

/* what the account's deletion takes with it (functions/accounts.js, close) */
export async function recruitForget(db, uid) {
  const card = await db.doc('joinCard/' + uid).get(), s = card.exists ? String(card.get('s') || '') : '';
  const b = db.batch();
  b.delete(db.doc('recruitNote/' + uid));
  b.delete(db.doc('joinCard/' + uid));
  if (JOIN_SLUG.test(s)) b.delete(db.doc('joinSlug/' + s));
  await b.commit();
}

/* ── the staff's side (functions/admin.js passes these through; every one is in the audit log) ── */
const sid = v => { const s = typeof v === 'string' ? v.trim() : ''; if (!RC_UID.test(s)) throw new HttpsError('invalid-argument', 'A valid record ID is required.'); return s; };
const why = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
async function audit(db, a) { await db.collection('adminAudit').doc().set({ ...a, outcome: 'completed', at: FieldValue.serverTimestamp() }); }

/* the claims held for a check, newest first, with both sides' names and why, and the double-rewards weekend now running */
export async function recruitHeld(db) {
  const qs = await db.collection('recruits').where('h', 'in', ['ip', 'dev']).limit(200).get();
  const rows = qs.docs.map(s => ({ id: s.id, r: String(s.get('r') || ''), t: ms(s.get('t')), h: String(s.get('h')) })).sort((a, b) => b.t - a.t);
  const ids = [...new Set(rows.flatMap(x => [x.id, x.r]).filter(u => RC_UID.test(u)))];
  const names = {};
  for (let i = 0; i < ids.length; i += 300) for (const n of await db.getAll(...ids.slice(i, i + 300).map(u => db.doc('summaries/' + u)), { fieldMask: ['name', 'reg'] }))
    if (n.exists) names[n.id] = { name: String(n.get('name') || '').slice(0, 80), reg: String(n.get('reg') || '') };
  return { held: rows.map(x => ({ ...x, name: names[x.id]?.name || '', reg: names[x.id]?.reg || '', rname: names[x.r]?.name || '', rreg: names[x.r]?.reg || '' })), ev: await rcEventNow(db) };
}
/* {uid, ok, reason?}: release a held claim (both sides then collect) or refuse it (neither ever does) */
export async function recruitRule(db, actor, data) {
  const uid = sid(data.uid), ok = data.ok === true, reason = why(data.reason);
  const ref = db.doc('recruits/' + uid);
  const r = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', 'That recruit is no longer on file.');
    const h = s.get('h');
    if (h !== 'ip' && h !== 'dev') throw new HttpsError('failed-precondition', 'That recruit is not waiting for a check.');
    tx.update(ref, ok ? { h: FieldValue.delete(), hk: actor } : { h: 'no', hk: actor });
    return { r: String(s.get('r') || ''), h };
  });
  await audit(db, { actor, action: ok ? 'recruit_released' : 'recruit_refused', target: uid, with: r.r, reason: reason || (r.h === 'ip' ? 'Same address as the recruiter' : 'Same device as the recruiter') });
  return { ok: true };
}
/* {uid, reason}: take down a recruiter's note */
export async function recruitNoteClear(db, actor, data) {
  const uid = sid(data.uid), reason = why(data.reason);
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  const ref = db.doc('recruitNote/' + uid), s = await ref.get();
  if (!s.exists) return { ok: true, gone: true };
  await ref.delete();
  await audit(db, { actor, action: 'recruit_note_removed', target: uid, reason: reason + ' (it read: ' + String(s.get('m') || '').slice(0, NOTE_MAX) + ')' });
  return { ok: true };
}
/* {hours}: a double-rewards weekend from now for `hours` (1 to 96), or hours 0 to end it now */
export const RC_EVENT_MAX_H = 96;
export async function rcEventSet(db, actor, data) {
  const hours = Number(data.hours), m = 2, now = Date.now(), ref = db.doc('rcEvent/live');
  if (!Number.isInteger(hours) || hours < 0 || hours > RC_EVENT_MAX_H) throw new HttpsError('invalid-argument', `Choose between 1 and ${RC_EVENT_MAX_H} hours, or 0 to end it.`);
  if (!hours) await ref.set({ m: 1, from: now, until: now, by: actor });
  else await ref.set({ m, from: now, until: now + hours * 3600000, by: actor });
  await audit(db, { actor, action: hours ? 'recruit_event_started' : 'recruit_event_ended', target: 'rcEvent', reason: hours ? `×${m} recruiting rewards for ${hours} hours` : 'Ended early' });
  return { ok: true, ev: hours ? { m, from: now, until: now + hours * 3600000 } : null };
}
/* the weekend now running, for the portal: {m, from, until} or null */
export async function rcEventNow(db, now = Date.now()) {
  const s = await db.doc('rcEvent/live').get().catch(() => null);
  return s && s.exists && Number(s.get('m')) > 1 && ms(s.get('until')) > now ? { m: Number(s.get('m')), from: ms(s.get('from')), until: ms(s.get('until')) } : null;
}
/* the console's player page: who recruited this player (and whether it is held), how many they recruited, their note */
export async function recruitInfo(db, uid) {
  if (!RC_UID.test(uid)) return null;
  const [rec, note, n] = await Promise.all([db.doc('recruits/' + uid).get(), db.doc('recruitNote/' + uid).get(),
    db.collection('recruits').where('r', '==', uid).count().get().then(s => s.data().count, () => 0)]);
  const by = rec.exists ? String(rec.get('r') || '') : '', sum = RC_UID.test(by) ? await db.doc('summaries/' + by).get() : null;
  return { by, byName: sum && sum.exists ? String(sum.get('name') || '').slice(0, 80) : '', h: rec.exists ? String(rec.get('h') || '') : '', t: rec.exists ? ms(rec.get('t')) : 0,
    n, note: note.exists ? String(note.get('m') || '').slice(0, NOTE_MAX) : '' };
}
export { RC_PACT };
