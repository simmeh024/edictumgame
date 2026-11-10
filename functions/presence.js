/* Who of a region is online, for the green dot on the Region page (civic op online).

   A player counts as online while one of their game tabs has reported its save health in the last ONLINE_MS
   (saveHealth/<uid>_<session>, src/shim.js: a report each minute while the tab is in view, and at every change of
   page or sync state). Nothing new is written for it. A report with ho:true means the player chose not to show it
   (Settings › Account › Online status); the newest report of a player decides, so switching it either way counts
   from the next report.

   One query per region and minute for each instance of the function, however many players ask (memo); it needs the
   index saveHealth (reg, t) in firestore.indexes.json. The answer gives each online player's seconds since their
   last report, never the reports themselves (their device, errors and pages stay with the staff). */
import { Timestamp } from 'firebase-admin/firestore';

/* in the emulators a second, so the tests see a new report at once */
export const ONLINE_MS = 15 * 60000, ONLINE_MEMO_MS = process.env.FUNCTIONS_EMULATOR === 'true' ? 1000 : 60000, ONLINE_MAX = 3000;
const memo = new Map();

/* the reports [{uid, t (ms), ho}] as {uid: last seen (ms)}: the newest report of each player, unless it hides them */
export function lastSeen(reports) {
  const last = new Map();
  for (const r of reports) {
    if (!r || typeof r.uid !== 'string' || !r.uid || !Number.isFinite(r.t)) continue;
    const o = last.get(r.uid);
    if (!o || r.t > o.t) last.set(r.uid, r);
  }
  const out = {};
  for (const [uid, r] of last) if (r.ho !== true) out[uid] = r.t;
  return out;
}

/* {uid: last seen} as the reply: {uid: whole seconds ago}, only those seen within ONLINE_MS of now */
export function agesAt(seen, now) {
  const out = {};
  for (const [uid, t] of Object.entries(seen)) if (now - t < ONLINE_MS) out[uid] = Math.max(0, Math.round((now - t) / 1000));
  return out;
}

async function query(db, reg, now) {
  const qs = await db.collection('saveHealth').where('reg', '==', reg).where('t', '>', Timestamp.fromMillis(now - ONLINE_MS))
    .select('uid', 't', 'ho').limit(ONLINE_MAX).get();
  return lastSeen(qs.docs.map(d => { const t = d.get('t'); return { uid: d.get('uid'), t: t && typeof t.toMillis === 'function' ? t.toMillis() : NaN, ho: d.get('ho') }; }));
}

/* {reg, u: {uid: seconds ago}}: asked at once by many players, the region is read once */
export async function regionOnline(db, reg, now = Date.now()) {
  let hit = memo.get(reg);
  if (!hit || now - hit.at >= ONLINE_MEMO_MS) {
    hit = { at: now, p: query(db, reg, now) };
    memo.set(reg, hit);
    hit.p.catch(() => { if (memo.get(reg) === hit) memo.delete(reg); });
  }
  return { reg, u: agesAt(await hit.p, now) };
}

/* for the tests */
export const resetOnline = () => memo.clear();
