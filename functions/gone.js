/* Recently dissolved nations, and putting one back.

   A nation leaves the region when its player dissolves it or starts over (Settings › Account, game/edictum.html
   dissolve) or when a guest switches to another account that already holds one (src/shim.js, doSwitch). The
   browser deletes the nation itself (src/shim.js, dropNation), so the server never saw it go: a mistaken dissolve
   could only be explained and undone by hand. Just before the deletion, the browser now files it here
   (accounts({op: 'gone', how})), and the server keeps a copy of the nation's last save in gone/{uid}_{created}:

     {uid, name, reg, founded, pop, rev, how: dissolve|restart|switch, at (ms), exp (Timestamp, GONE_DAYS on),
      created (ms, the nations/ createTime), docs: {nations, nationx, nationp, summaries, space} as saved, copy}

   Firestore deletes it GONE_DAYS after it was filed (TTL on exp; firestore.indexes.json, which also keeps docs out
   of the indexes). Deleting the account (accounts close) deletes it at once. Only the server reads or writes it
   (firestore.rules). The copy is the last save the server holds, as dissolve() waits for any save on its way.

   The admin portal (functions/admin.js) lists them (goneList) and restores one (goneRestore): the documents go back
   exactly as they were saved, for the same account, if that account still exists, holds no nation now, and no
   nation of the region now holds any of its land or has taken its name. */
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { nationText } from './nationtext.js';
import { registered } from './eligibility.js';

export const GONE_DAYS = 8;
export const GONE_HOW = ['dissolve', 'restart', 'switch'];
const DAY = 86400000, PARTS = ['nations', 'nationx', 'nationp', 'summaries', 'space'];
/* a document holds at most 1 MiB: a copy larger than this is filed without its documents (copy false) */
const COPY_MAX = 900000;
const size = v => v == null ? 0 : typeof v === 'string' ? v.length : Buffer.isBuffer(v) || v instanceof Uint8Array ? v.length
  : typeof v === 'object' ? Object.entries(v).reduce((s, [k, x]) => s + k.length + size(x), 0) : 8;
const text = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
const key = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();
const record = data => { try { return JSON.parse(nationText(data) || 'null'); } catch { return null; } };
/* every hex a nation holds: its claims and its cities' hexes */
function cells(n) {
  const out = new Set();
  for (const c of Array.isArray(n?.claims) ? n.claims : []) if (Number.isInteger(c?.c)) out.add(c.c);
  for (const c of Array.isArray(n?.cities) ? n.cities : []) if (Number.isInteger(c?.c)) out.add(c.c);
  return out;
}

/* accounts({op: 'gone', how}) from the player's own browser, just before it deletes the nation → {ok} */
export async function noteGone(db, uid, d) {
  const how = GONE_HOW.includes(d?.how) ? d.how : 'dissolve';
  const snaps = await db.getAll(...PARTS.map(c => db.doc(c + '/' + uid)));
  const nation = snaps[0];
  if (!nation.exists) return { ok: false };
  const n = record(nation.data()) || {}, created = nation.createTime.toMillis(), now = Date.now();
  const docs = Object.fromEntries(PARTS.map((c, i) => [c, snaps[i].exists ? snaps[i].data() : null]).filter(([, v]) => v));
  const copy = size(docs) <= COPY_MAX;
  /* one record per founding: a second call for the same nation (a retry) files its latest copy in the same place */
  await db.doc(`gone/${uid}_${created}`).set({
    uid, name: text(nation.get('name') || n.name, 80), reg: text(nation.get('reg') || n.reg, 40), founded: Number(n.founded) || 0,
    pop: Number(nation.get('pop') ?? n.pop) || 0, rev: Number(nation.get('rev')) || 0, how, at: now, exp: Timestamp.fromMillis(now + GONE_DAYS * DAY),
    created, copy, ...(copy ? { docs } : {})
  });
  return { ok: true };
}

/* the account's records go with the account (functions/accounts.js, close) */
export async function forgetGone(db, uid) {
  const qs = await db.collection('gone').where('uid', '==', uid).get();
  if (!qs.empty) { const b = db.batch(); qs.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
}

/* the admin page's list: the last GONE_DAYS, newest first, each with what its account holds now */
export async function goneList(db) {
  const since = Date.now() - GONE_DAYS * DAY;
  const qs = await db.collection('gone').where('at', '>', since).orderBy('at', 'desc').limit(300)
    .select('uid', 'name', 'reg', 'founded', 'pop', 'rev', 'how', 'at', 'copy', 'restoredAt', 'restoredBy').get();
  const rows = qs.docs.map(d => ({ id: d.id, ...d.data() }));
  const uids = [...new Set(rows.map(r => r.uid))];
  const now = uids.length ? await db.getAll(...uids.map(u => db.doc('summaries/' + u)), { fieldMask: ['name', 'reg'] }) : [];
  const held = new Map(now.filter(s => s.exists).map(s => [s.id, { name: s.get('name') || '', reg: s.get('reg') || '' }]));
  const accounts = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const r = await getAuth().getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
    for (const u of r.users) accounts.set(u.uid, registered(u) ? 'registered' : 'guest');
  }
  return { at: Date.now(), days: GONE_DAYS, rows: rows.map(r => ({ ...r, account: accounts.get(r.uid) || 'deleted', now: held.get(r.uid) || null })) };
}

/* adminConsole({op: 'restore', id, reason}) → {ok, uid, name}; refused with what stands in the way */
export async function goneRestore(db, actor, d) {
  const id = text(d?.id, 200);
  if (!/^[\w-]{6,128}_\d{10,16}$/.test(id)) throw new HttpsError('invalid-argument', 'Choose a dissolved nation.');
  const ref = db.doc('gone/' + id), g = await ref.get();
  if (!g.exists) throw new HttpsError('not-found', 'That record has expired or was deleted with its account.');
  const { uid, name, reg } = g.data();
  if (g.get('restoredAt')) throw new HttpsError('failed-precondition', `${name} was restored already.`);
  if (!g.get('copy') || !g.get('docs')?.nations) throw new HttpsError('failed-precondition', `No copy of ${name} was kept (it was too large), so it cannot be restored here.`);
  const account = await getAuth().getUser(uid).catch(e => { if (e.code === 'auth/user-not-found') return null; throw e; });
  if (!account) throw new HttpsError('failed-precondition', `The account behind ${name} was deleted, so there is nobody to restore it for.`);
  const docs = g.get('docs'), n = record(docs.nations) || {};
  const now = await db.doc('nations/' + uid).get();
  if (now.exists) throw new HttpsError('failed-precondition', `This account holds a nation again (${text(now.get('name'), 80) || 'unnamed'}). Restoring would replace it.`);
  /* the region as it is now: its land and its names */
  const mine = cells(n), taken = [], same = [];
  const region = await db.collection('nations').where('reg', '==', reg).get();
  for (const s of region.docs) {
    if (s.id === uid) continue;
    const o = record(s.data());
    if (key(s.get('name') || o?.name) === key(name)) same.push(text(s.get('name'), 80));
    let k = 0; for (const c of cells(o)) if (mine.has(c)) k++;
    if (k) taken.push(`${text(s.get('name') || o?.name, 80) || 'A nation'} (${k} ${k === 1 ? 'hex' : 'hexes'})`);
  }
  if (same.length) throw new HttpsError('failed-precondition', `Another nation of the region is called ${same[0]} now.`);
  if (taken.length) throw new HttpsError('failed-precondition', `Some of ${name}'s land is held by other nations now: ${taken.slice(0, 5).join(', ')}${taken.length > 5 ? ' and more' : ''}.`);
  /* back as saved, only where nothing is: a save that lands meanwhile makes the whole batch fail */
  const b = db.batch();
  for (const c of PARTS) if (docs[c]) b.create(db.doc(c + '/' + uid), docs[c]);
  const res = await b.commit();
  /* the founding the account's records go by is the nations/ document's creation (functions/accounts.js recover,
     functions/eligibility.js born): the new document's, with the nation's own founding time kept */
  const ai = db.doc('accountIdentity/' + uid), a = await ai.get();
  const born = a.exists && a.get('nationGeneration') === g.get('created') && a.get('nationAt') ? a.get('nationAt') : Number(n.founded) || g.get('created');
  await ai.set({ nationGeneration: res[0].writeTime.toMillis(), nationAt: born }, { merge: true });
  await ref.update({ restoredAt: Date.now(), restoredBy: actor });
  await db.collection('adminAudit').add({ actor, action: 'restore', target: uid, name, reason: text(d?.reason, 300) || 'Restored a dissolved nation',
    outcome: 'completed', at: FieldValue.serverTimestamp() });
  return { ok: true, uid, name };
}
