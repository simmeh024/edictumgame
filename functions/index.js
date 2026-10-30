/* The referee: Edictum's battles, rolled on the server (README.md, Fair play).

   A nation's record is written by its own player's browser, so a battle rolled there could be rolled again
   (reload the page before the save) or never rolled at all (a conquest typed into the record). Here the
   server rolls it: it keeps each army's readiness, rolls the dice, and seals every victory with a signature
   that every player's game checks before the conquest counts. The odds are the attacker's game's own, held
   to what the armies saved beside the two records allow.

   referee({op: 'battle', d, c, p, w, h})
     d  the nation attacked: a player's uid, or a computer nation's id (npc-…)
     c  the hex (its cell number); p the odds the attacker's game worked out; w the ally whose war it is
        ('' in a war of its own); h the allied nations joining the assault
     → {ok: true, win, t, s?, p, r}: t the server's time (the conquest's), s the seal of a victory, p the odds
       used, r the readiness left; or {ok: false, why, next?}: why 'ready' (next: ms until the next point),
       'nation' (no saved nation yet) or 'banned'
   referee({op: 'forget'}): a player deleting their account clears their army's record, once the nation is
     gone (before that, clearing it would refill the army)

   Storage (only this code writes it; see firestore.rules):
     referee/key            {priv, pub, at}: the signing key, made on first use; nobody else reads it
     referee/pub            {k, at}: its public half (SPKI, base64), which every game reads
     armies/{uid}           {r, at, n, w, last}: readiness r as of at (ms); battles n, won w, the last at last
     armies/{uid}/log/{id}  {d, c, p, pe, cap, roll, win, t}: every battle, for the admins
   The seal: ECDSA P-256 with SHA-256 (64 bytes, base64url) over "edictum-battle-1|<uid>|<c>|<t>|<w>". */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
export { adminConsole } from './admin.js';
export { accounts } from './accounts.js';
export { civic } from './civic.js';
import { identity, eligibility, refuse } from './eligibility.js';
import DATA from './civic-data.json' with { type: 'json' };

initializeApp();
const db = getFirestore();

const REGION = 'europe-west1';  // beside Firestore (eur3); src/shim.js calls it here
const SEAL = 'edictum-battle-1';
const P_MIN = 0.05, P_MAX = 0.95;      // the game's own bounds on the odds (battle() in game/edictum.html)
const READY_BASE = 6, SLACK = 1;       // readiness as the game keeps it, plus one point for a master spy's gift
/* The most the game's own factors can tilt a battle beyond the two armies: borders held around the hex,
   distance from each capital, terrain, spies, policies, buildings. Claimed odds above that are cut to it. */
const TILT = 20;

let KEY = null;
async function signingKey() {
  if (KEY) return KEY;
  const ref = db.doc('referee/key');
  let s = await ref.get();
  if (!s.exists) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }), pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), at = Date.now();
    /* create() fails if another instance made the key first; then theirs stands */
    try { await db.batch().create(ref, { priv, pub, at }).set(db.doc('referee/pub'), { k: pub, at }).commit(); } catch (e) { /* made meanwhile */ }
    s = await ref.get();
  }
  KEY = crypto.createPrivateKey(s.get('priv'));
  return KEY;
}
function sealText(uid, c, t, w) { return [SEAL, uid, c, t, w || ''].join('|'); }

const record = s => { try { const j = s && s.exists ? s.get('j') : null; return typeof j === 'string' ? JSON.parse(j) || {} : {}; } catch (e) { return {}; } };
const army = s => s && s.exists && typeof s.get('army') === 'number' ? s.get('army') : 0;
/* the alliance a record belongs to: its founder's id */
const allianceOf = (id, n) => n.alli && n.alli.name ? id : typeof n.allyOf === 'string' ? n.allyOf : '';
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

/* the game's readiness (readiness() and spendReady() in game/edictum.html): a point returns every 15
   minutes (10 with Rapid Mobilisation), up to 6 (8 with an Army Reserve) */
function readiness(state, pol, now) {
  const max = READY_BASE + (pol.reservists ? 2 : 0) + SLACK, ms = (pol.rapidMobilisation ? 10 : 15) * 60000;
  if (!Number.isInteger(state.r) || typeof state.at !== 'number') return { r: max, max, ms, g: 0, at: now };
  const g = Math.max(0, Math.floor((now - state.at) / ms));
  return { r: Math.min(max, state.r + g), max, ms, g, at: state.at };
}

async function battle(uid, data) {
  const who = await identity(uid);
  const c = data.c, d = data.d, w = isId(data.w) ? data.w : '';
  if (!Number.isInteger(c) || c < 0 || c > 1e6 || !isId(d) || d === uid || typeof data.p !== 'number' || !isFinite(data.p))
    throw new HttpsError('invalid-argument', 'A battle needs a hex, a nation and the odds.');
  const npc = DATA.regions.some(r => r.npcs.some(n => n.id === d));
  const help = [...new Set(Array.isArray(data.h) ? data.h.filter(isId) : [])].filter(id => id !== uid && id !== d && !id.startsWith('npc-')).slice(0, 8);
  const meRef = db.doc('nations/' + uid), armyRef = db.doc('armies/' + uid), logRef = armyRef.collection('log').doc();
  const key = await signingKey();
  return db.runTransaction(async tx => {
    const refs = [meRef, armyRef, db.doc('bans/' + uid)];
    if (!npc) refs.push(db.doc('nations/' + d));
    help.forEach(id => refs.push(db.doc('nations/' + id)));
    const [me, st, ban, ...rest] = await tx.getAll(...refs);
    if (ban.exists) return { ok: false, why: 'banned' };
    if (!me.exists) return { ok: false, why: 'nation' };
    const foe = npc ? null : rest.shift(), mine = record(me), now = Date.now();
    const regions = [...new Set([me.get('reg'), foe?.get('reg')].filter(Boolean))];
    const availability = regions.length ? await tx.getAll(...regions.map(r => db.doc('regionStatus/' + r))) : [];
    const unavailable = availability.find(r => r.get('enabled') === false);
    if (unavailable) return { ok: false, why: unavailable.get('mode') === 'coming_soon' ? 'coming_soon' : 'maintenance' };
    await eligibility(tx, who, { linked: false });
    if (!npc && !who.registered && !(foe?.exists && record(foe).wars?.[uid]))
      refuse('registration_required', 'A Registered Nation is required for offensive wars against players.');
    const rd = readiness(st.exists ? st.data() : {}, mine.policies || {}, now);
    if (rd.r < 1) return { ok: false, why: 'ready', next: rd.at + (rd.g + 1) * rd.ms - now };
    /* the odds: the attacker's own, within the game's bounds, and no better than its army, with its allies'
       help, could make them against the defender's, both as their last saves declared */
    const al = allianceOf(uid, mine);
    let att = army(me);
    rest.forEach((s, i) => { if (al && allianceOf(help[i], record(s)) === al) att += 0.5 * army(s); });
    const def = npc ? 0 : army(foe), cap = att > 0 && def > 0 ? Math.min(P_MAX, TILT * att / (TILT * att + def)) : P_MAX;
    const p = Math.min(P_MAX, Math.max(P_MIN, data.p)), pe = Math.min(p, cap);
    const roll = crypto.randomInt(0, 1e6) / 1e6, win = roll < pe;
    const out = { ok: true, win, t: now, w, p: Math.round(pe * 1e4) / 1e4, r: rd.r - 1 };
    if (win) out.s = crypto.sign('sha256', Buffer.from(sealText(uid, c, now, w)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const prev = st.exists ? st.data() : {};
    tx.set(armyRef, { r: rd.r - 1, at: rd.r >= rd.max ? now : rd.at + rd.g * rd.ms, n: (prev.n || 0) + 1, w: (prev.w || 0) + (win ? 1 : 0), last: now });
    tx.set(logRef, { d, c, p: data.p, pe, cap, roll, win, t: now, ...(w ? { ally: w } : {}) });
    return out;
  });
}

async function forget(uid) {
  if ((await db.doc('nations/' + uid).get()).exists) return { ok: false, why: 'nation' };
  const ref = db.doc('armies/' + uid);
  await db.recursiveDelete(ref);
  const account = await db.doc('accountIdentity/' + uid).get();
  if (account.get('recoveryHash')) await db.doc('guestRecovery/' + account.get('recoveryHash')).delete();
  if (account.exists) await account.ref.set({ generation: account.get('generation') || '', recoveryIssued: !!(account.get('recoveryIssued') || account.get('recoveryHash')) });
  await db.recursiveDelete(db.doc('nationPermits/' + uid));
  const [proposals, votes] = await Promise.all(['proposals','votes'].map(c => db.collectionGroup(c).where('uid','==',uid).get()));
  const writer = db.bulkWriter();
  DATA.regions.forEach(r => writer.delete(db.doc('assemblyRegions/' + r.id + '/actors/' + uid)));
  proposals.docs.concat(votes.docs).forEach(s => writer.delete(s.ref));
  await writer.close();
  return { ok: true };
}

export const referee = onCall({ region: REGION, maxInstances: 20, memory: '256MiB', timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const data = req.data && typeof req.data === 'object' ? req.data : {};
  if (data.op === 'battle') return battle(uid, data);
  if (data.op === 'forget') return forget(uid);
  throw new HttpsError('invalid-argument', 'Unknown request.');
});
