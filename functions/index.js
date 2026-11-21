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
     → {ok: true, win, t, s?, s2?, d, p, r}: t the server's time (the conquest's), s and s2 the seals of a victory,
       d the defender they name, p the odds used, r the readiness left; or {ok: false, why, next?}: why 'ready'
       (next: ms until the next point), 'nation' (no saved nation yet), 'gone' (no such defender in the
       attacker's region), 'banned', or 'hidden' (a moderator has hidden the attacker or the defender)
   referee({op: 'forget'}): a player deleting their account clears their army's record, once the nation is
     gone (before that, clearing it would refill the army)
   referee({op: 'siege', d, c}) (war, round two): lay siege to player d's capital, hex c, in a war of conquest
     -> {ok: true, t, id, doc, again?} or {ok: false, why}: why also 'war' (no war of conquest, or a peace offered),
       'grace' (d may not be attacked now); d is told at once (functions/letters.js, warWord)
   A battle with cap: 1 is the final assault on that capital: it needs this nation's siege of d, begun at least SIEGE_MS
     and at most SIEGE_MAX ago on hex c, and the war still on ('siege', 'war', 'surr', 'grace' otherwise). Won, the
     siege is marked fallen (st 'fell', ft, foes: the fallen nation's enemies), d is told, and the answer carries
     fell: true with the siege's id and doc. Every game then takes the fallen nation off its map (territory).

   Storage (only this code writes it; see firestore.rules):
     referee/key            {priv, pub, at}: the signing key, made on first use; nobody else reads it
     referee/pub            {k, at}: its public half (SPKI, base64), which every game reads
     armies/{uid}           {r, at, n, w, last}: readiness r as of at (ms); battles n, won w, the last at last
     armies/{uid}/log/{id}  {d, c, p, pe, cap, roll, win, t}: every battle, for the admins
     sieges/{a}_{d}_{t}     {reg, a, d, c, t, st: 'on'|'fell', an, dn, df, cn, ft?, foes?}: a siege by a of d's capital
                            (an, dn the names, df d's founding, cn its capital's name), read by every game of the region
   The seals: ECDSA P-256 with SHA-256 (64 bytes, base64url) over "edictum-battle-1|<uid>|<c>|<t>|<w>" (s) and
   "edictum-battle-2|<uid>|<c>|<t>|<w>|<d>" (s2). The first names no defender, so the odds held to one nation's army
   could be spent on another's hex; since SEAL2_AT (game/edictum.html) a conquest counts only with s2, and only
   when the hex was d's. s stays for builds older than that, which check only it. */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
export { adminConsole } from './admin.js';
export { accounts } from './accounts.js';
export { civic } from './civic.js';
export { paddle } from './shop.js';
export { homeLive } from './home-live.js';
import { identity, eligibility, refuse, regionClosed } from './eligibility.js';
import { nationText } from './nationtext.js';
import DATA from './civic-data.json' with { type: 'json' };
import { pace, ipRule } from './pace.js';
import { trId, trLive, trVoid, trReadyMs, TR_FX, TR_RECORD } from './treaty-rules.js';
import { alRelLive } from './alliance-rules.js';
import { warWord } from './letters.js';
import { warOf, shielded, num, SIEGE_MS, SIEGE_MAX } from './war-rules.js';

initializeApp();
const db = getFirestore();

const REGION = 'europe-west1';  // beside Firestore (eur3); src/shim.js calls it here
const SEAL = 'edictum-battle-1', SEAL2 = 'edictum-battle-2';
const P_MIN = 0.05, P_MAX = 0.95;      // the game's own bounds on the odds (battle() in game/edictum.html)
const READY_BASE = 6, SLACK = 1;       // readiness as the game keeps it, plus one point for a master spy's gift
/* The most the game's own factors can tilt a battle beyond the two armies: borders held around the hex,
   distance from each capital, terrain, spies, policies, buildings. Claimed odds above that are cut to it. */
const TILT = 20;
const str = (v, k = 40) => typeof v === 'string' ? v.slice(0, k) : '';

let KEY = null;
async function signingKey() {
  if (KEY) return KEY;
  const ref = db.doc('referee/key');
  let s = await ref.get();
  if (!s.exists) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }), pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), at = Date.now();
    /* create() fails if another instance (or a request beside this one) made the key first; then theirs stands */
    try { await db.batch().create(ref, { priv, pub, at }).set(db.doc('referee/pub'), { k: pub, at }).commit(); } catch (e) { /* made meanwhile */ }
    s = await ref.get();
  }
  KEY = crypto.createPrivateKey(s.get('priv'));
  return KEY;
}
function sealText(uid, c, t, w) { return [SEAL, uid, c, t, w || ''].join('|'); }
function sealText2(uid, c, t, w, d) { return [SEAL2, uid, c, t, w || '', d].join('|'); }

const record = s => { try { const j = s && s.exists ? nationText(s) : null; return typeof j === 'string' ? JSON.parse(j) || {} : {}; } catch (e) { return {}; } };
const army = s => s && s.exists && typeof s.get('army') === 'number' ? s.get('army') : 0;
/* the alliance a record belongs to: its founder's id */
const allianceOf = (id, n) => n.alli && n.alli.name ? id : typeof n.allyOf === 'string' ? n.allyOf : '';
/* a nation's entry in allyOf/ (functions/alliances.js): its defence pact, whose members fight beside it (an entry from
   before names one alliance, of any type, in a); and every alliance it belongs to, for a pact between alliances */
const ixDef = s => { if (!s || !s.exists) return ''; const v = s.data() || {}; if (v.v !== 2) return typeof v.a === 'string' ? v.a : '';
  const a = (v.s && v.s.def) || (v.w && Array.isArray(v.w.def) && v.w.def[0]) || ''; return typeof a === 'string' ? a : ''; };
const ixAll = s => { if (!s || !s.exists) return []; const v = s.data() || {}; if (v.v !== 2) return typeof v.a === 'string' && v.a ? [v.a] : [];
  return [...new Set(Object.values(v.s || {}).filter(a => typeof a === 'string' && a))].slice(0, 4); };
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

/* the game's readiness (readiness() and spendReady() in game/edictum.html): a point returns every 15
   minutes (10 with Rapid Mobilisation), 5% sooner for each pact of joint military training in force (drills; the game
   counts only those at work, so never more than here), up to 6 (8 with an Army Reserve) */
function readiness(state, pol, now, drills) {
  const max = READY_BASE + (pol.reservists ? 2 : 0) + SLACK, ms = trReadyMs((pol.rapidMobilisation ? 10 : 15) * 60000, drills || 0);
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
    /* the final assault on a capital: this nation's sieges of d */
    const sieges = data.cap === 1 && !npc ? await tx.get(db.collection('sieges').where('a', '==', uid).where('d', '==', d)) : null;
    const ixs = await tx.getAll(...[uid, ...help].map(id => db.doc('allyOf/' + id))), alliances = ixs.map(ixDef);
    /* a non-aggression pact or joint military training between the two (functions/treaties.js), and the defender's
       alliance (for a pact between the two alliances, functions/alliances.js) */
    const [nap, drill, dIx] = await tx.getAll(db.doc('treaties/' + trId('nap', uid, d)), db.doc('treaties/' + trId('drill', uid, d)), db.doc('allyOf/' + d));
    /* the attacker's own pacts of joint training, which ready its army sooner */
    const mineTr = await tx.get(db.collection('treaties').where('p', 'array-contains', uid));
    if (ban.exists) return { ok: false, why: 'banned' };
    if (!me.exists) return { ok: false, why: 'nation' };
    /* a nation a moderator has hidden (mod/<uid> hidden) keeps its land and fights nobody, either way, until it is shown again */
    const [modMe, modFoe] = await tx.getAll(db.doc('mod/' + uid), db.doc('mod/' + (npc ? uid : d)));
    if (modMe.get('hidden') === true || (!npc && modFoe.get('hidden') === true)) return { ok: false, why: 'hidden' };
    const foe = npc ? null : rest.shift(), mine = record(me), now = Date.now();
    /* the defender is a nation of the attacker's own region: one of its computer nations, or a player whose nation
       is saved there (an id made up, or one from elsewhere, would have no army to hold the odds to) */
    const myReg = me.get('reg') || 'meridian';
    if (npc ? !DATA.regions.some(r => r.id === myReg && r.npcs.some(n => n.id === d)) : !foe.exists || (foe.get('reg') || 'meridian') !== myReg)
      return { ok: false, why: 'gone' };
    const regions = [...new Set([me.get('reg'), foe?.get('reg')].filter(Boolean))];
    const availability = regions.length ? await tx.getAll(...regions.map(r => db.doc('regionStatus/' + r))) : [];
    const unavailable = availability.find(r => regionClosed(r, r.id));
    if (unavailable) return { ok: false, why: !unavailable.exists || unavailable.get('mode') === 'coming_soon' ? 'coming_soon' : 'maintenance' };
    await eligibility(tx, who, { linked: false });
    if (!npc && !who.registered && !(foe?.exists && record(foe).wars?.[uid]))
      refuse('registration_required', 'A Registered Nation is required for offensive wars against players.');
    let sg = null;
    if (data.cap === 1) {
      if (npc) return { ok: false, why: 'npc' };
      const them = record(foe), w = warOf(mine, uid, them, d, now);
      if (!w) return { ok: false, why: 'war' };
      if (w.surr) return { ok: false, why: 'surr' };
      if (w.g !== 'c' || w.offA) return { ok: false, why: 'war' };
      if (shielded(them, now)) return { ok: false, why: 'grace' };
      sg = sieges.docs.find(s => { const x = s.data(); return x.st === 'on' && x.c === c && num(x.df) === num(them.founded) && now - num(x.t) >= SIEGE_MS && now - num(x.t) <= SIEGE_MAX; }) || null;
      if (!sg) return { ok: false, why: 'siege' };
    }
    const drills = mineTr.docs.filter(s => { const T = s.data(); return T.k === 'drill' && trLive(T, now) && !trVoid(T, { [uid]: mine }); }).length;
    const rd = readiness(st.exists ? st.data() : {}, mine.policies || {}, now, drills);
    if (rd.r < 1) return { ok: false, why: 'ready', next: rd.at + (rd.g + 1) * rd.ms - now };
    /* the odds: the attacker's own, within the game's bounds, and no better than its army, with its allies'
       help, could make them against the defender's, both as their last saves declared */
    /* an alliance is the server's (allyOf/, functions/alliances.js); one not yet moved there, its founder's record's */
    const al = alliances[0] || allianceOf(uid, mine);
    /* no battle while a non-aggression pact binds the two, or a pact binds their alliances: a side that means to fight
       ends it with notice or breaks it first (a nation founded again since it signed is not bound) */
    const recs = { [uid]: mine, ...(npc ? {} : { [d]: record(foe) }) };
    for (const t of [nap, drill]) if (t.exists && trLive(t.data(), now) && !trVoid(t.data(), recs)) return { ok: false, why: 'pact' };
    /* a pact between any alliance of the attacker's and any of the defender's */
    const mineAl = ixAll(ixs[0]).length ? ixAll(ixs[0]) : al ? [al] : [], theirs = ixAll(dIx).filter(a => !mineAl.includes(a));
    if (mineAl.length && theirs.length) {
      for (const as of await tx.getAll(...mineAl.map(a => db.doc('alliances/' + a)))) {
        const rel = as.exists ? as.get('rel') : null;
        if (rel && typeof rel === 'object' && theirs.some(b => alRelLive(rel[b], now))) return { ok: false, why: 'pact' };
      }
    }
    let att = army(me);
    rest.forEach((s, i) => { if (al && (alliances[i + 1] || allianceOf(help[i], record(s))) === al) att += 0.5 * army(s); });
    /* joint training broken in the last month: the side that was let down fights the breaker 10% the stronger */
    let def = npc ? 0 : army(foe);
    const DB = drill.exists ? drill.data() : null;
    if (DB && DB.st === 'broken' && now - (Number(DB.bt) || 0) < TR_RECORD && !trVoid(DB, recs)) {
      if (DB.by === d) att *= 1 + TR_FX.drill.edge; else if (DB.by === uid) def *= 1 + TR_FX.drill.edge;
    }
    /* held to the armies whenever the defender has one: an attacker with none gets no odds at all, not the best */
    const cap = def > 0 ? Math.min(P_MAX, TILT * att / (TILT * att + def)) : P_MAX;
    const p = Math.min(P_MAX, Math.max(P_MIN, data.p)), pe = Math.min(p, cap);
    const roll = crypto.randomInt(0, 1e6) / 1e6, win = roll < pe;
    const out = { ok: true, win, t: now, w, d, p: Math.round(pe * 1e4) / 1e4, r: rd.r - 1 };
    const sign = text => crypto.sign('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    if (win) { out.s = sign(sealText(uid, c, now, w)); out.s2 = sign(sealText2(uid, c, now, w, d)); }
    if (win && sg) {
      /* the capital has fallen: the siege says so, with the fallen nation's enemies, whose conquests stay theirs */
      const them = record(foe), foes = [...new Set([uid, ...Object.keys(them.wars || {}).filter(isId)])].slice(0, 40);
      const doc = { ...sg.data(), st: 'fell', ft: now, foes };
      tx.set(sg.ref, doc);
      Object.assign(out, { fell: true, id: sg.id, doc, _word: { to: d, by: str(mine.name), nation: str(them.name), capital: str(them.capital) } });
    }
    const prev = st.exists ? st.data() : {};
    tx.set(armyRef, { r: rd.r - 1, at: rd.r >= rd.max ? now : rd.at + rd.g * rd.ms, n: (prev.n || 0) + 1, w: (prev.w || 0) + (win ? 1 : 0), last: now });
    tx.set(logRef, { d, c, p: data.p, pe, cap, roll, win, t: now, ...(w ? { ally: w } : {}) });
    return out;
  });
}

/* lay siege to a player's capital (war, round two): see the top of this file */
async function siege(uid, data) {
  const who = await identity(uid);
  const d = data.d, c = data.c;
  if (!isId(d) || d === uid || d.startsWith('npc-') || !Number.isInteger(c) || c < 0 || c > 1e6)
    throw new HttpsError('invalid-argument', 'A siege needs a nation and its capital.');
  const r = await db.runTransaction(async tx => {
    const [me, foe, ban, modMe, modFoe] = await tx.getAll(db.doc('nations/' + uid), db.doc('nations/' + d), db.doc('bans/' + uid), db.doc('mod/' + uid), db.doc('mod/' + d));
    const q = await tx.get(db.collection('sieges').where('a', '==', uid).where('d', '==', d));
    if (ban.exists) return { ok: false, why: 'banned' };
    if (!me.exists) return { ok: false, why: 'nation' };
    if (modMe.get('hidden') === true || modFoe.get('hidden') === true) return { ok: false, why: 'hidden' };
    const myReg = me.get('reg') || 'meridian';
    if (!foe.exists || (foe.get('reg') || 'meridian') !== myReg) return { ok: false, why: 'gone' };
    const rs = await tx.get(db.doc('regionStatus/' + myReg));
    if (regionClosed(rs, myReg)) return { ok: false, why: !rs.exists || rs.get('mode') === 'coming_soon' ? 'coming_soon' : 'maintenance' };
    await eligibility(tx, who, { linked: false });
    const mine = record(me), them = record(foe), now = Date.now(), w = warOf(mine, uid, them, d, now);
    if (!who.registered && !them.wars?.[uid]) refuse('registration_required', 'A Registered Nation is required for offensive wars against players.');
    if (!w || w.surr || w.g !== 'c' || w.offA) return { ok: false, why: 'war' };
    if (shielded(them, now)) return { ok: false, why: 'grace' };
    const df = num(them.founded);
    for (const s of q.docs) {
      const x = s.data();
      if (num(x.df) !== df) continue;
      if (x.st === 'fell') return { ok: false, why: 'gone' };
      if (x.st === 'on' && now - num(x.t) <= SIEGE_MAX) return { ok: true, t: x.t, id: s.id, doc: x, again: true };
    }
    const id = `${uid}_${d}_${now}`, doc = { reg: myReg, a: uid, d, c, t: now, st: 'on', an: str(mine.name), dn: str(them.name), df, cn: str(them.capital) };
    tx.set(db.doc('sieges/' + id), doc);
    return { ok: true, t: now, id, doc, _word: { to: d, by: doc.an, nation: doc.dn, capital: doc.cn, at: now + SIEGE_MS } };
  });
  if (r && r._word) { const w = r._word; delete r._word; try { await warWord(db, w.to, 'siege', w); } catch (e) { /* the game shows it anyway */ } }
  return r;
}

async function forget(uid) {
  if ((await db.doc('nations/' + uid).get()).exists) return { ok: false, why: 'nation' };
  const ref = db.doc('armies/' + uid);
  await db.recursiveDelete(ref);
  const account = await db.doc('accountIdentity/' + uid).get();
  if (account.get('recoveryHash')) await db.doc('guestRecovery/' + account.get('recoveryHash')).delete();
  /* hw stays: the population a new record on this account may start from (functions/civic.js, createCap) */
  if (account.exists) await account.ref.set({ generation: account.get('generation') || '', recoveryIssued: !!(account.get('recoveryIssued') || account.get('recoveryHash')), ...(account.get('hw') ? { hw: account.get('hw') } : {}) });
  await db.recursiveDelete(db.doc('nationPermits/' + uid));
  const [proposals, votes] = await Promise.all(['proposals','votes'].map(c => db.collectionGroup(c).where('uid','==',uid).get()));
  /* the Book of Resolutions keeps each member's vote and reason (functions/civic.js, bookEntry): this account's go */
  const books = await Promise.all(DATA.regions.map(r => db.collection('assemblyRegions/' + r.id + '/asmBook').where('vu', 'array-contains', uid).get()));
  const writer = db.bulkWriter();
  DATA.regions.forEach(r => writer.delete(db.doc('assemblyRegions/' + r.id + '/actors/' + uid)));
  proposals.docs.concat(votes.docs).forEach(s => writer.delete(s.ref));
  for (const q of books) for (const s of q.docs) writer.update(s.ref, new FieldPath('vm', uid), FieldValue.delete(), new FieldPath('vx', uid), FieldValue.delete(), 'vu', FieldValue.arrayRemove(uid));
  await writer.close();
  return { ok: true };
}

/* one vCPU serves up to 80 battles at once (a smaller share of one serves a single request); KEY, the only state
   kept between requests, is the same key for all of them */
export const referee = onCall({ region: REGION, maxInstances: 20, cpu: 1, memory: '512MiB', concurrency: 80, timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const data = req.data && typeof req.data === 'object' ? req.data : {};
  // functions/pace.js: battles are held back by readiness anyway; forgetting (many deletes and queries) is rare
  if (data.op === 'battle') {
    pace([['rb:' + uid, 60, 1], ...ipRule(req, 'ri', 300, 10)]);
    const r = await battle(uid, data);
    if (r && r._word) { const w = r._word; delete r._word; try { await warWord(db, w.to, 'fell', w); } catch (e) { /* told in the game anyway */ } }
    return r;
  }
  if (data.op === 'siege') { pace([['rs:' + uid, 10, 1 / 60]]); return siege(uid, data); }
  if (data.op === 'forget') { pace([['rf:' + uid, 3, 1 / 60]]); return forget(uid); }
  throw new HttpsError('invalid-argument', 'Unknown request.');
});
