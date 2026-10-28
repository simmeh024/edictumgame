// Staff-only operations. Audit events use authenticated identities and server time; clients cannot edit them.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const REGIONS = new Set('meridian frostmarch northernpale driftlands silentmoors wildwood saffron hollow ashen ironsteppe gilded verdantbasin coralreach emberisles lanterncoast jadeterraces highcrags cloudspine obsidianrim ambershallows sunkenkingdoms mistral stormwrack longvalley greywater scatteredcrown'.split(' '));
export const MAINTENANCE = 'Current region is disabled and undergoing maintainance, check back soon.';
const text = (v, max = 128) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const id = v => { const s = text(v); if (!s || s.includes('/')) throw new HttpsError('invalid-argument', 'A valid record ID is required.'); return s; };
const ms = v => v?.toMillis?.() || 0;
const key = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
let directory = null, directoryAt = 0;

async function players(db, data) {
  // Read only the small public summaries, cached for a minute. Legacy nations need no migration.
  if (!directory || data.refresh === true || Date.now() - directoryAt > 60000) {
    const qs = await db.collection('summaries').select('name', 'reg', 'pop', 't').get();
    directory = qs.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    directoryAt = Date.now();
  }
  const q = key(text(data.q, 128)), reg = text(data.reg, 40);
  const matches = directory.filter(p => (!reg || p.reg === reg) && (!q || key(p.name).includes(q) || key(p.uid).includes(q)));
  if (q && !text(data.q).includes('/') && !matches.some(p => p.uid === text(data.q))) {
    const direct = await db.doc('summaries/' + text(data.q)).get();
    if (direct.exists && (!reg || direct.get('reg') === reg)) matches.unshift({ uid: direct.id, ...direct.data() });
  }
  const offset = Number.isSafeInteger(data.offset) && data.offset >= 0 ? data.offset : 0;
  return { players: matches.slice(offset, offset + 50), total: matches.length, next: offset + 50 < matches.length ? offset + 50 : null, at: directoryAt };
}
async function player(db, uid) {
  const [n, ban, mod, sessions] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('bans/' + uid).get(), db.doc('mod/' + uid).get(), db.collection('saveHealth').where('uid', '==', uid).limit(30).get()]);
  const d = n.data() || {};
  return { uid, exists: n.exists, name: d.name || ban.get('name') || mod.get('name') || uid, reg: d.reg || '', pop: d.pop ?? null, revision: d.rev || 0, savedAt: ms(d.ts), banned: ban.exists, hidden: mod.get('hidden') === true, note: ban.get('note') || mod.get('note') || '', sessions: sessions.docs.map(s => { const { expiresAt, ...value } = s.data(); return { id: s.id, ...value, t: ms(s.get('t')) }; }) };
}
async function health(db) {
  const qs = await db.collection('saveHealth').where('t', '>', Timestamp.fromMillis(Date.now() - 86400000)).orderBy('t', 'desc').limit(250).get();
  const uids = [...new Set(qs.docs.map(d => d.get('uid')))];
  const ns = uids.length ? await db.getAll(...uids.map(uid => db.doc('nations/' + uid)), { fieldMask: ['name', 'reg', 'rev', 'ts'] }) : [];
  const nations = new Map(ns.map(n => [n.id, n.data() || {}]));
  return { at: Date.now(), limited: qs.size === 250, sessions: qs.docs.map(d => {
    const s = d.data(), n = nations.get(s.uid) || {};
    return { id: d.id, uid: s.uid, reg: n.reg || s.reg, name: n.name || s.uid, device: s.device, status: s.status, pending: s.pending, error: s.error, conflicts: s.conflicts, revision: s.revision, t: ms(s.t), savedAt: ms(n.ts), serverRevision: n.rev || 0 };
  }) };
}
async function audit(db, data) {
  let q = db.collection('adminAudit');
  if (text(data.target)) q = q.where('target', '==', text(data.target));
  q = q.orderBy('at', 'desc').limit(50);
  if (text(data.after)) { const cursor = await db.doc('adminAudit/' + id(data.after)).get(); if (cursor.exists) q = q.startAfter(cursor); }
  const qs = await q.get();
  return { events: qs.docs.map(d => ({ id: d.id, ...d.data(), at: ms(d.get('at')) })), next: qs.size === 50 ? qs.docs.at(-1).id : null };
}
async function setRegion(db, actor, data) {
  const target = id(data.reg), reason = text(data.reason, 300);
  if (!REGIONS.has(target) || typeof data.enabled !== 'boolean' || !reason) throw new HttpsError('invalid-argument', 'Choose a region, availability and a reason.');
  const mode = data.enabled ? 'enabled' : data.mode ?? 'maintenance';
  if (!['enabled', 'maintenance', 'coming_soon'].includes(mode) || (!data.enabled && mode === 'enabled')) throw new HttpsError('invalid-argument', 'Choose Maintenance or Coming soon.');
  const ref = db.doc('regionStatus/' + target), event = db.collection('adminAudit').doc();
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref), before = previous.get('enabled') !== false;
    const beforeMode = before ? 'enabled' : previous.get('mode') === 'coming_soon' ? 'coming_soon' : 'maintenance';
    // Public availability contains no staff notes or actor identity; those belong to the private audit.
    tx.set(ref, { enabled: data.enabled, mode, at: FieldValue.serverTimestamp() });
    tx.create(event, { actor, action: data.enabled ? 'region_enabled' : 'region_disabled', target, reason, before, after: data.enabled, beforeMode, mode, outcome: 'completed', at: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}
async function mutate(db, actor, data) {
  const action = text(data.action, 40), target = id(data.target), reason = text(data.reason, 300) || 'Admin console action';
  const allowed = ['hide', 'unhide', 'remove', 'ban', 'unban', 'delete_post', 'close_report', 'support_answer', 'support_close', 'support_delete'];
  if (!allowed.includes(action)) throw new HttpsError('invalid-argument', 'Unknown admin action.');
  if (['hide', 'remove', 'ban'].includes(action) && target === actor) throw new HttpsError('failed-precondition', 'You cannot moderate your own account.');
  const event = db.collection('adminAudit').doc(), common = { actor, action, target, reason, operation: event.id };
  // Record intent before a multi-document cleanup, and its outcome separately, so a partial failure is visible.
  await event.create({ ...common, outcome: 'started', at: FieldValue.serverTimestamp() });
  try {
    const nation = await db.doc('nations/' + target).get(), name = text(nation.get('name'), 80) || text(data.name, 80);
    const now = Date.now();
    if (action === 'hide') await db.doc('mod/' + target).set({ hidden: true, note: reason, name, t: now, by: actor });
    if (action === 'unhide') await db.doc('mod/' + target).delete();
    if (action === 'unban') await db.doc('bans/' + target).delete();
    if (action === 'remove' || action === 'ban') {
      // Publish the ban/tombstone together with removal; open browsers follow the tombstone.
      const b = db.batch();
      b.set(db.doc('mod/' + target), { hidden: false, removed: now, note: reason, name, t: now, by: actor });
      if (action === 'ban') b.set(db.doc('bans/' + target), { note: reason, name, t: now, by: actor });
      ['nations', 'nationx', 'summaries', 'space'].forEach(c => b.delete(db.doc(c + '/' + target)));
      await b.commit();
      const [posts, reports] = await Promise.all([db.collectionGroup('posts').where('a', '==', target).get(), db.collection('reports').where('target', '==', target).get()]);
      const writer = db.bulkWriter(), writes = posts.docs.concat(reports.docs).map(d => writer.delete(d.ref)); await Promise.all([Promise.all(writes), writer.close()]);
    }
    if (action === 'delete_post') { if (!REGIONS.has(text(data.reg))) throw new HttpsError('invalid-argument', 'Choose a region.'); await db.doc('boards/' + data.reg + '/posts/' + target).delete(); }
    if (action === 'close_report') await db.doc('reports/' + target).delete();
    if (action.startsWith('support_')) {
      const ref = db.doc('support/' + target);
      if (action === 'support_delete') await ref.delete();
      else await db.runTransaction(async tx => {
        const s = await tx.get(ref);
        if (!s.exists || s.get('st') !== 'open') throw new HttpsError('failed-precondition', 'This ticket is already closed or removed.');
        const reply = text(data.reply, 2000);
        if (action === 'support_answer' && !reply) throw new HttpsError('invalid-argument', 'Write an answer first.');
        tx.update(ref, { st: 'closed', ct: FieldValue.serverTimestamp(), rby: actor, exp: Timestamp.fromMillis(now + 90 * 86400000), ...(reply ? { reply } : {}) });
      });
    }
    if (text(data.report)) await db.doc('reports/' + id(data.report)).delete();
    await db.collection('adminAudit').add({ ...common, name, outcome: 'completed', at: FieldValue.serverTimestamp() });
    directoryAt = 0;
    return { ok: true };
  } catch (e) {
    await db.collection('adminAudit').add({ ...common, outcome: 'failed', error: text(e.code || 'unknown', 64), at: FieldValue.serverTimestamp() });
    throw e;
  }
}
export const adminConsole = onCall({ region: 'europe-west1', maxInstances: 5, memory: '256MiB', timeoutSeconds: 120 }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Only Edictum admins can use the console.');
  const d = req.data || {}, db = getFirestore(), actor = req.auth.uid;
  if (d.op === 'search') return players(db, d);
  if (d.op === 'player') return player(db, id(d.uid));
  if (d.op === 'health') return health(db);
  if (d.op === 'audit') return audit(db, d);
  if (d.op === 'region') return setRegion(db, actor, d);
  if (d.op === 'moderate') return mutate(db, actor, d);
  throw new HttpsError('invalid-argument', 'Unknown console request.');
});
