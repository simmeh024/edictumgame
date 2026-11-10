import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';
import { deflateNation } from './nationtext.js';
import { identity, eligibility, nationJSON, refuse, registered, regionMessage, regionClosed, refuseBannedIdentity, DAY } from './eligibility.js';
import { cabinetAffinity } from './affinity.js';
import { assemblyEngine } from './assembly-engine.js';
import DATA from './civic-data.json' with { type: 'json' };
import { cbTopic, cbReply, cbEdit, cbDelete, cbMod, cbPost, TEAM_OK, asTeam, teamMark, rmbParent, rmbReact, cbCounted } from './board.js';
import { alliance, isAllianceOp } from './alliances.js';
import { flagOp, isFlagOp } from './flagcomp.js';
import { pace, ipRule } from './pace.js';

const regions = new Set(DATA.regions.map(r => r.id));
const statKeys = Object.keys(DATA.regions[0].npcs[0].s);
const savedStats = n => Object.fromEntries(statKeys.map(k=>[k,Number.isFinite(n.s?.[k])?Math.max(0,Math.min(100,n.s[k])):50]));
const npcIds = new Set(DATA.regions.flatMap(r => r.npcs.map(n => n.id)));
const text = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const politicalKeys = new Set(['r','e','s','v','p','a','m','o','j','ox','pw']);
export const politicalPart = a => Object.fromEntries(Object.entries(a || {}).filter(([k]) => politicalKeys.has(k)));
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

/* The population a nation's record may start with. firestore.rules (grows) holds every update to x1.35 a day plus
   3 million a day since the last save, but a create has no last save: a record deleted and saved again, or one saved
   from a fresh account, could start at any size, and army and land are bounded by it. So a create is held here to
   the most of: a new nation (FOUND_POP, 5 million in the game) grown since the account began; this account's last
   save (accountIdentity/<uid>.hw, kept by every save below); and, for a guest's nation carried into an account on
   signing in (src/shim.js, doSwitch), that guest account's last save, once (d.from; the guest's record is gone by
   then, or is a guest's of the same name). A carry needs the guest's carry key (d.fk): a secret only that guest's
   browser holds, whose hash its own saves note beside hw (d.ck, hw.k), so nobody can start a nation from another
   player's population by naming their account. Never from a banned account. */
const FOUND_POP = 20, HW_STEP = 1.05, HW_EVERY = 6 * 3600000, CARRY_MS = 7 * DAY;
const grown = (pop, at, now) => { const days = Math.max(0, (now - at) / DAY); return pop * Math.pow(1.35, days) + 3 * days; };
const hwOf = s => { const h = s && s.exists ? s.get('hw') : null; return h && Number.isFinite(h.pop) && Number.isFinite(h.at) ? h : null; };
/* a carry key as the server keeps it: never the key itself */
export const carryHash = k => typeof k === 'string' && /^[0-9a-f]{32,64}$/.test(k) ? createHash('sha256').update('carry:' + k).digest('hex') : '';
async function createCap(tx, db, who, e, p, from, fk, now) {
  let cap = grown(FOUND_POP, Date.parse(who.generation) || now, now);
  const hw = hwOf(e.account);
  if (hw) cap = Math.max(cap, grown(hw.pop * HW_STEP, hw.at, now));
  if (p.pop <= cap + 1e-4 || !isId(from) || from === who.uid || !fk) return { cap };
  const [fa, fn, fb] = await tx.getAll(db.doc('accountIdentity/' + from), db.doc('nations/' + from), db.doc('bans/' + from)), fh = hwOf(fa);
  if (!fh || now - fh.at > CARRY_MS || (fh.to && fh.to !== who.uid) || fh.k !== fk || fb.exists) return { cap };
  if (fn.exists) {
    if (fn.get('name') !== p.name) return { cap };
    let guest = true;
    try { guest = !registered(await getAuth().getUser(from)); } catch { /* the guest account is gone */ }
    if (!guest) return { cap };
  }
  return { cap: Math.max(cap, grown(fh.pop * HW_STEP, fh.at, now)), carry: fa.ref, fh };
}

/* the races this save may stamp (stamps/<reg>/<key>/<uid>, firestore.rules): the claims (c<cell>) and finds (s<site>)
   it carries that the saved record did not, so no stamp can be written ahead of its claim (src/shim.js raceKeys) */
function raceKeys(n, before) {
  const had = new Set((Array.isArray(before.claims) ? before.claims : []).map(e => e && e.c));
  const found = e => e && (e.o === 'found' || e.o === 'great') && Number.isInteger(e.s) && e.s >= 0 && e.s < 1e6;
  const sites = new Set((Array.isArray(before.disc) ? before.disc : []).filter(found).map(e => e.s)), out = new Set();
  for (const e of Array.isArray(n.claims) ? n.claims : []) if (e && Number.isInteger(e.c) && e.c >= 0 && e.c < 1e6 && !had.has(e.c)) out.add('c' + e.c);
  for (const e of Array.isArray(n.disc) ? n.disc : []) if (found(e) && !sites.has(e.s)) out.add('s' + e.s);
  return [...out].slice(0, 200);
}

async function permit(db, who, d) {
  const p = d.record;
  if (!p || typeof p.j !== 'string' || p.j.length > 700000 || typeof p.name !== 'string' || p.name.length > 80 || !['pop','army','cl','updatedAt'].every(k=>Number.isFinite(p[k])) || !regions.has(p.reg) || !Number.isSafeInteger(d.rev) || d.rev < 0)
    throw new HttpsError('invalid-argument', 'Invalid nation save.');
  let n;
  try { n = JSON.parse(p.j); } catch { throw new HttpsError('invalid-argument', 'Invalid nation JSON.'); }
  if (!n || Array.isArray(n) || typeof n !== 'object' || n.reg !== p.reg || n.name !== p.name || own(n, 'asm'))
    throw new HttpsError('invalid-argument', 'Political records must be changed through the protected Assembly service.');
  /* the rules take a save's time no more than a day ahead of the server's (a record dated later would never fall dormant) */
  /* a new record: not from a sign-in a banned account used (functions/eligibility.js, identityHashes) */
  if (d.rev === 0) await refuseBannedIdentity(db, who);
  if (p.updatedAt > Date.now() + DAY) refuse('clock_ahead', 'This device’s clock is more than a day ahead, so the nation cannot be saved. Set the date and time right, and it saves again.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true, nation: false, allowClosedRegion: true });
    if ((e.saved.get('rev') || 0) !== d.rev) refuse('save_conflict', 'Another device saved this nation.');
    const control = await tx.get(db.doc('regionStatus/' + p.reg));
    if (regionClosed(control, p.reg) && !who.admin) refuse('region_disabled', regionMessage(control));
    const actor = await tx.get(db.doc('assemblyRegions/' + p.reg + '/actors/' + who.uid));
    const before = e.n;
    // Validate changes, not the continued presence of old data. Guests can leave existing alliances.
    const founded = n.alli && (!before.alli || JSON.stringify(n.alli) !== JSON.stringify(before.alli));
    const attacks = Object.keys(n.wars || {}).filter(id => JSON.stringify(n.wars[id]) !== JSON.stringify(before.wars?.[id]));
    const pvp = attacks.filter(id => !npcIds.has(id));
    if (founded || pvp.length) await eligibility(tx, who);
    if (pvp.length > 10) throw new HttpsError('invalid-argument', 'Too many simultaneous war declarations.');
    for (const id of pvp) {
      if (!/^[\w-]{1,128}$/.test(id) || id === who.uid) throw new HttpsError('invalid-argument', 'Invalid opponent.');
      const target = await tx.get(db.doc('nations/' + id));
      if (!target.exists || target.get('reg') !== p.reg) refuse('invalid_opponent', 'Choose a nation in your region.');
    }
    // Invalid NPC-looking strings must not evade registration requirements.
    if (actor.exists && actor.get('generation') === e.generation) n.asm = actor.get('record');
    else n.asm = { r: p.reg, e: [], s: [], v: [] };
    /* the population: a create held to createCap; an update only noted, at no more than the rules will let it save */
    const now = Date.now();
    let most = Infinity;
    if (!e.saved.exists) {
      const c = await createCap(tx, db, who, e, p, d.from, carryHash(d.fk), now);
      if (p.pop > c.cap + 1e-4) refuse('population_limit', 'This nation is larger than a new record can start. Sign in to the account that held it.');
      if (c.carry) tx.set(c.carry, { hw: { ...c.fh, to: who.uid } }, { mergeFields: ['hw'] });
    } else if (typeof e.saved.get('pop') === 'number' && e.saved.get('ts')?.toMillis) most = grown(e.saved.get('pop'), e.saved.get('ts').toMillis(), now) + 1e-4;
    /* a guest's carry key (src/shim.js, carryKey), noted with its last save so only its own browser can carry it */
    const hw = hwOf(e.account), noted = Math.min(p.pop, most), ck = who.registered ? '' : carryHash(d.ck), k = ck || (hw && typeof hw.k === 'string' ? hw.k : '');
    if (!hw || noted > hw.pop * HW_STEP || now - hw.at > HW_EVERY || hw.to || (ck && hw.k !== ck)) tx.set(db.doc('accountIdentity/' + who.uid), { hw: { pop: noted, at: now, ...(k ? { k } : {}) } }, { mergeFields: ['hw'] });
    /* letters a game from before letters were private left in the shared record (dm, now in the own half: src/shim.js):
       when the record is first saved without them, those to players become letters/ documents, so their readers
       keep them. The same id as the game's own, so a save tried again writes them again, not twice. A save may only
       keep that old list as it was or drop it, never add to it or change it: a list of its own would turn into letters
       written here, past the blocks and limits firestore.rules hold every letter to. They expire like any other. */
    if (own(n, 'dm') && JSON.stringify(n.dm) !== JSON.stringify(before.dm)) { if (Array.isArray(before.dm)) n.dm = before.dm; else delete n.dm; }
    if (Array.isArray(before.dm) && !own(n, 'dm')) for (const m of before.dm.slice(-80))
      if (m && !m.i && isId(m.w) && m.w !== who.uid && !npcIds.has(m.w) && !/^(npc|office)-/.test(m.w) && typeof m.x === 'string' && m.x.trim() && Number.isSafeInteger(m.t) && m.t > 0)
        tx.set(db.doc('letters/' + who.uid + '~' + m.w + '~' + m.t), { by: who.uid, to: m.w, x: m.x.slice(0, 500), t: m.t, ts: FieldValue.serverTimestamp(), exp: Timestamp.fromMillis(now + 365 * DAY) });
    const result = { j: JSON.stringify(n), reg: p.reg, name: p.name, pop: p.pop, army: p.army, cl: p.cl, updatedAt: p.updatedAt, rev: d.rev + 1 };
    const ref = db.collection('nationPermits/' + who.uid + '/requests').doc(), sk = raceKeys(n, before);
    /* the text deflated as well (z): a client that asks (zip) saves that instead of j, and the rules compare it with
       this permit's z; a build from before saves j as it always did */
    const z = deflateNation(result.j);
    tx.create(ref, { ...result, z, sk, exp: Timestamp.fromMillis(Date.now() + 120000), authGeneration: who.generation, sensitive: !!(founded || pvp.length), nationGeneration: e.generation });
    if (d.zip === 1) { const { j, ...rest } = result; return { ...rest, z: z.toString('base64'), sk, permit: ref.id }; }
    return { ...result, sk, permit: ref.id };
  });
}

/* a guest's carry key, noted before it switches to another account (src/shim.js, otherAccount), should none of its saves
   have sent it yet: only beside a last save it already has, and only for a guest */
async function noteCarryKey(db, who, d) {
  const ck = carryHash(d.ck), ref = db.doc('accountIdentity/' + who.uid);
  if (who.registered || !ck) return { ok: false };
  return db.runTransaction(async tx => {
    const hw = hwOf(await tx.get(ref));
    if (!hw || hw.to) return { ok: false };
    if (hw.k !== ck) tx.set(ref, { hw: { ...hw, k: ck } }, { mergeFields: ['hw'] });
    return { ok: true };
  });
}

/* A moderator's forced rename (functions/admin.js, 'rename') hides the nation until its player saves it under a new
   name. The game asks here once that save is in: a saved name other than the one the moderator objected to (ignoring
   case, accents and spacing) shows the nation again, and the audit log records it. */
const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
async function renamed(db, who) {
  const ref = db.doc('mod/' + who.uid), event = db.collection('adminAudit').doc();
  return db.runTransaction(async tx => {
    const [m, n] = await Promise.all([tx.get(ref), tx.get(db.doc('nations/' + who.uid))]);
    if (m.get('rename') !== true) return { ok: true };
    const name = text(n.get('name'), 80), before = String(m.get('name') || '');
    if (!n.exists || name.length < 2 || fold(name) === fold(before)) return { ok: false, why: 'unchanged' };
    tx.delete(ref);
    tx.create(event, { actor: who.uid, action: 'renamed', target: who.uid, name, reason: 'New name chosen after a forced rename; it was ' + text(before, 80), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
    return { ok: true };
  });
}

/* one nation's Assembly record. valid: a Registered Nation that is not banned, hidden or removed */
function civicRecord(reg, saved, account, actor, valid, hidden) {
  const generation = saved.createTime.toMillis(), born = account.get('nationGeneration') === generation ? account.get('nationAt') : generation;
  const a = actor?.get('generation') === generation ? actor.get('record') : { r: reg, e: [], s: [], v: [] };
  const n = nationJSON(saved), ts = saved.get('ts'), lastSave = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : saved.updateTime ? saved.updateTime.toMillis() : 0;
  // Never import political decisions from a legacy, player-writable JSON record. lastSave, the server's time of its
  // last save, tells an absent member (game/edictum.html asmAbsentAt)
  return { id: saved.id, n: { name: saved.get('name'), reg, founded: born, s: savedStats(n), flag: n.flag || {}, civicAffinity: cabinetAffinity(n), gw: n.gw || {}, civicAt: valid ? born + DAY : 0, lastSave, asm: a }, generation, hidden };
}

/* the region's records as stored: every nation in it (dormant ones too: their endorsements and the computer
   nations' backing still count) with its ban, moderation, account and sign-in, and the Assembly's actors and
   last twelve cycles. tx: an action's transaction, or a read-only one (regionBase) */
async function regionRecords(tx, db, reg) {
  const root = db.doc('assemblyRegions/' + reg);
  const [meta, nations, actors, cycles] = await Promise.all([
    tx.get(root), tx.get(db.collection('nations').where('reg', '==', reg)),
    tx.get(root.collection('actors')), tx.get(root.collection('cycles').orderBy('c', 'desc').limit(12))
  ]);
  // Fresh provider data prevents an unlinked/disabled identity retaining political power through a cache: actions
  // and the closing of a cycle read it here, in their transaction; only the read-only view (regionBase) is kept.
  const users = [];
  for (let i = 0; i < nations.docs.length; i += 100) users.push(...(await getAuth().getUsers(nations.docs.slice(i, i + 100).map(s => ({ uid: s.id })))).users);
  const auth = new Map(users.map(u => [u.uid, u]));
  const records = [], byId = new Map(actors.docs.map(s => [s.id, s]));
  const checks = nations.empty ? [] : await tx.getAll(...nations.docs.flatMap(s => ['bans/','mod/','accountIdentity/'].map(p => db.doc(p+s.id))));
  for (const [index,saved] of nations.docs.entries()) {
    const [ban, mod, account] = checks.slice(index*3,index*3+3), generation = saved.createTime.toMillis();
    const u = auth.get(saved.id), valid = !!(u && !u.disabled && registered(u) && !ban.exists && !mod.get('hidden') && !(mod.get('removed') >= generation));
    records.push(civicRecord(reg, saved, account, byId.get(saved.id), valid, !!mod.get('hidden')));
  }
  return { root, meta, records, actors: byId, locks: cycles.docs.map(s => s.data()) };
}

async function regionState(tx, db, reg, now) {
  const base = await regionRecords(tx, db, reg);
  return { ...base, ...regionDue(reg, base.root, base.records, base.locks, now) };
}

/* what the Assembly owes at `now`: cycles past their close to finalise and cycles to lock, as writes (pending),
   also added to locks. Cycles close in order, each keeping the rulebook as it leaves it (bk, bx) and its page in the
   Book of Resolutions (book: asmBook/{c}); the cycle locked now opens its debate on the Community Board (debate) */
function regionDue(reg, root, records, locks, now) {
  const engine = assemblyEngine(reg, records, locks), c = engine.cycle(now);
  const pending = [], book = [];
  let debate = null;
  const close = (L, eng) => {
    const at = eng.t0(L.c + 1) - 1, D = eng.delegate(records, at).D, V = eng.tally(L, L.c, records, at, D);
    Object.assign(L, { y: V.y, n: V.n, ok: V.ok ? 1 : 0, f: now, r: reg });
    const step = eng.bookStep(eng.book(L.c), L);
    L.bk = step.bk; if (step.bx.length) L.bx = step.bx; else delete L.bx;
    book.push([root.collection('asmBook').doc(String(L.c)), bookEntry(L, V, D)]);
  };
  // Cut over at the current cycle; only protected cycles can become binding results.
  for (const L of locks.filter(L => L.c < c && !L.f).sort((a, b) => a.c - b.c)) {
    close(L, engine);
    pending.push([root.collection('cycles').doc(String(L.c)), L]);
  }
  const last = locks.length ? Math.max(...locks.map(L=>L.c)) : c-1;
  for(let next=Math.max(last+1,c-6);next<=c;next++){
    const currentEngine=assemblyEngine(reg,records,locks),L=currentEngine.pick(next,new Set(locks.map(x=>x.k)));
    if(L){
      L.lt=now;
      if(next<c)close(L,currentEngine);
      else{L.dt=debateId(next);debate=L;}
      locks.push(L);pending.push([root.collection('cycles').doc(String(next)),L]);
    }
  }
  return { pending, book, debate, c, engine: assemblyEngine(reg, records, locks) };
}

/* A finished cycle in the Book of Resolutions (assemblyRegions/{reg}/asmBook/{c}): the resolution and its count, with
   how each player member voted (vm), the reasons they gave (vx), the computer nations' votes (nv), the player members
   at the close (vu: also how an account's deletion finds its votes, functions/index.js) and the Delegate's weight (dl) */
function bookEntry(L, V, D) {
  const vm = {}, vx = {}, nv = {}, vu = [];
  for (const r of V.rows) {
    if (r.npc) { if (r.v !== null) nv[r.id] = r.v; continue; }
    vu.push(r.id);
    if (!r.t) continue;
    vm[r.id] = r.v; if (r.x) vx[r.id] = r.x;
  }
  const { bk, ...rest } = L;
  return { ...rest, vm, vx, nv, vu, ...(D ? { dl: { id: D.id, w: V.rows.find(r => r.id === D.id)?.w || 1 } } : {}) };
}

/* The debate of the resolution at the vote: a topic on its region's Community Board, opened by the Assembly's clerk
   (functions/board.js; as: it shows as the Assembly, not as a nation or the Edictum team). Its id follows from the
   cycle, so the lock names it (dt) and a second try writes the same topic. */
export const debateId = c => 'AsmDebate' + String(c).padStart(11, '0');
function debateTopic(reg, L, t1, now) {
  const R = DATA.regions.find(r => r.id === reg), name = 'The ' + (R ? R.name : reg) + ' Assembly';
  const when = new Date(t1).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const how = L.w === 'd' ? ', at the Delegate’s choosing' : L.w === 's' ? ', as the proposal with the most support' : '';
  const first = L.w === 'n' ? `No member tabled a proposal in time, so ${L.bn} has put one of its own to the vote: “${L.ti}”.` : `${L.bn} has put “${L.ti}” to the vote${how}.`;
  const x = [first, L.rp ? `It would repeal “${L.rt || 'a resolution in force'}” and lift its effects from every member.` : '', L.tx ? `“${L.tx}”` : '',
    `The count closes at 00:00 UTC on ${when}. Cast your vote on the Assembly page, and make your case here.`].filter(Boolean).join('\n\n');
  return { a: 'assembly', nm: name, rg: reg, as: true, rl: 'Clerk of the Assembly', ti: text(`Resolution No. ${L.c + 1}: ${L.ti}`, 120), x, tg: 'assembly', t: now, la: now, rc: 0 };
}

function output(ctx, uid, now, e) {
  const st = ctx.engine.state(now);
  const simpleD = D => D ? { id: D.id, k: D.k, by: D.by, np: D.np } : null;
  // the rulebook travels with the latest finished cycle only: the game folds the rest in as the server does
  const lastF = ctx.locks.reduce((m, L) => L.f && L.c > m ? L.c : m, -Infinity);
  const locks = ctx.locks.map(L => { if (L.c === lastF || !L.bk) return L; const { bk, ...rest } = L; return rest; });
  return { c: st.c, t0: st.t0, t1: st.t1, now, reg: e.n.reg, cur: st.cur, D: simpleD(st.D),
    recs: ctx.records.filter(r=>!r.hidden||r.id===uid), locks, V: st.V ? { ...st.V, rows: st.V.rows.map(({ n, ...row }) => row) } : null,
    info: [...st.DD.info].map(([id, v]) => [id, { k: v.k, by: v.by, np: v.np, reach: v.reach, ...(v.ab ? { ab: 1 } : {}) }]),
    npc: st.DD.npc.map(b => ({ id: b.x.id, player: b.r?.id || '', a: b.a })),
    account: { kind: e.kind, readyAt: e.readyAt, eligible: e.kind === 'registered' && now >= e.readyAt && !e.moderated, reason: e.moderated ? 'moderated' : '' },
    own: ctx.records.find(r => r.id === uid)?.n.asm || { r: e.n.reg, e: [], s: [], v: [] } };
}

/* Every player's game asks for the Assembly ('state') while it is open, so the region-wide part is kept here,
   per region, for a minute (REGION_TTL), and read again at once when the region's root document changes:
   every action and every cycle closed or locked writes it in the same transaction. Other nations' saves,
   registrations and moderation reach the view within that minute; the caller's own record and account are
   read on every call. Nothing binding uses it: actions and the closing of a cycle run in a transaction on
   fresh records, as before. Shared by concurrent requests, so nothing here changes a cached record. */
const REGION_TTL = 60000, regionCache = new Map(), closing = new Map();
const rootKey = meta => meta.exists ? String(meta.updateTime.valueOf()) : '';
function regionBase(db, reg, key) {
  const hit = regionCache.get(reg);
  if (hit && hit.key === key && Date.now() - hit.at < REGION_TTL) return hit.p;
  const entry = { key, at: Date.now() };
  // read-only: one consistent snapshot of the region, without the locks a transaction holds against saves
  entry.p = db.runTransaction(tx => regionRecords(tx, db, reg), { readOnly: true });
  entry.p.then(base => { entry.key = rootKey(base.meta); }, () => { if (regionCache.get(reg) === entry) regionCache.delete(reg); });
  regionCache.set(reg, entry);
  return entry.p;
}

/* op 'state' from the kept region; null when the transactional path must answer instead */
async function regionView(db, who, waited) {
  const now = Date.now();
  const { e, meta } = await db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true });
    return { e, meta: regions.has(e.n.reg) ? await tx.get(db.doc('assemblyRegions/' + e.n.reg)) : null };
  }, { readOnly: true });
  const reg = e.n.reg, uid = who.uid;
  // the region's query would not find this nation: the transactional path answers, as it always has
  if (!meta || e.saved.get('reg') !== reg) return null;
  const base = await regionBase(db, reg, rootKey(meta));
  const mine = civicRecord(reg, e.saved, e.account, base.actors.get(uid), who.registered && !e.moderated, !!e.mod.get('hidden'));
  const records = base.records.filter(r => r.id !== uid), at = records.findIndex(r => r.id > uid);
  records.splice(at < 0 ? records.length : at, 0, mine);  // in the query's order, by document id
  const locks = base.locks.map(L => ({ ...L })), due = regionDue(reg, base.root, records, locks, now);
  if (!due.pending.length) return output({ records, locks, engine: due.engine }, uid, now, e);
  // a cycle to close or lock: one transaction per region at a time here, and the rest read what it wrote
  const busy = closing.get(reg);
  if (busy && !waited) { await busy.catch(() => {}); return regionView(db, who, true); }
  const run = assemblyTx(db, who, { op: 'state' });
  closing.set(reg, run);
  try { return await run; } finally { if (closing.get(reg) === run) closing.delete(reg); }
}

/* An admin observing a region (the game's observer mode) reads its Assembly as a player there sees it, without a seat:
   the same cached region view, with no record of their own, and nothing closed or locked on their account. */
async function observeView(db, who, reg) {
  if (!who.admin) throw new HttpsError('permission-denied', 'Only Edictum admins can observe a region.');
  if (!regions.has(reg)) throw new HttpsError('invalid-argument', 'Choose a region.');
  const now = Date.now(), meta = await db.doc('assemblyRegions/' + reg).get();
  const base = await regionBase(db, reg, rootKey(meta));
  const records = base.records.slice(), locks = base.locks.map(L => ({ ...L })), due = regionDue(reg, base.root, records, locks, now);
  return output({ records, locks, engine: due.engine }, '', now, { n: { reg }, kind: 'observer', readyAt: 0, moderated: false });
}

/* The Book of Resolutions: a region's finished cycles, newest first, a page at a time (before: the cycle to start
   below), each with its count and how the members voted. Any nation reads its own region's; an admin observing
   reads the one it observes. A cycle closed before the Book was kept (no asmBook/{c}) is written up once from its
   lock and its votes, so the reads that takes happen only the first time. */
export const BOOK_PAGE = 12;
async function bookRead(db, who, d) {
  let reg = '';
  if (typeof d.obs === 'string' && d.obs) {
    if (!who.admin) throw new HttpsError('permission-denied', 'Only Edictum admins can observe a region.');
    reg = d.obs;
  } else reg = (await db.runTransaction(tx => eligibility(tx, who, { linked: false, hidden: true }), { readOnly: true })).n.reg;
  if (!regions.has(reg)) throw new HttpsError('invalid-argument', 'Choose a region.');
  const root = db.doc('assemblyRegions/' + reg), before = Number.isSafeInteger(d.before) ? d.before : null;
  let q = root.collection('cycles').orderBy('c', 'desc');
  if (before !== null) q = q.where('c', '<', before);
  const cycles = (await q.limit(BOOK_PAGE + 1).get()).docs.map(s => s.data()).filter(L => Number.isInteger(L.c));
  const more = cycles.length > BOOK_PAGE, locks = cycles.slice(0, BOOK_PAGE).filter(L => L.f);
  const kept = locks.length ? await db.getAll(...locks.map(L => root.collection('asmBook').doc(String(L.c)))) : [];
  const out = [], late = [];
  for (const [i, L] of locks.entries()) {
    if (kept[i].exists) { out.push(kept[i].data()); continue; }
    const vs = await root.collection('cycles').doc(String(L.c)).collection('votes').get(), vm = {}, vx = {};
    for (const v of vs.docs) { const x = v.data(); if (x.key !== L.k || ![-1, 0, 1].includes(x.value)) continue; vm[v.id] = x.value; if (typeof x.why === 'string' && x.why) vx[v.id] = text(x.why, 100); }
    const { bk, ...rest } = L, entry = { ...rest, vm, vx, nv: {}, vu: Object.keys(vm) };
    out.push(entry); late.push([root.collection('asmBook').doc(String(L.c)), entry]);
  }
  if (late.length) { const b = db.batch(); for (const [ref, entry] of late) b.set(ref, entry); await b.commit().catch(() => {}); }
  return { reg, list: out, more, next: cycles.length ? cycles[Math.min(cycles.length, BOOK_PAGE) - 1].c : null };
}

async function assembly(db, who, d) {
  if (d.op === 'state' && typeof d.obs === 'string' && d.obs) return observeView(db, who, d.obs);
  if (d.op === 'state') return await regionView(db, who) || assemblyTx(db, who, d);
  return assemblyTx(db, who, d);
}

/* The Delegate names the region's newspaper (the game's Daily Dispatch) and gives it a motto: press/<region> {nm, mo,
   by, bn, t}, which every player of the region reads. Empty fields put the paper back to its own name. The same
   Delegate may change them once every six hours; a new Delegate may at once. Moderators reset them (functions/admin.js,
   press_reset), and the advertisements they remove share the document (x). */
const PAPER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '’&.,-]*$/u, PAPER_MOTTO = /^[\p{L}\p{N} '’&.,;:!?()“”"-]*$/u;
async function paperName(tx, db, reg, who, mine, d, now) {
  const nm = text(d.name, 40), mo = text(d.motto, 90), ref = db.doc('press/' + reg);
  if (nm && (nm.length < 3 || !PAPER_NAME.test(nm) || !/\p{L}/u.test(nm))) throw new HttpsError('invalid-argument', 'A name for the paper has 3 to 40 letters, numbers, spaces and simple punctuation.');
  if (mo && (!PAPER_MOTTO.test(mo) || !/\p{L}/u.test(mo))) throw new HttpsError('invalid-argument', 'A motto has up to 90 letters, numbers, spaces and simple punctuation.');
  if (mo && !nm) throw new HttpsError('invalid-argument', 'Give the paper a name before its motto.');
  const s = await tx.get(ref);
  if (s.get('by') === who.uid && now - (Number(s.get('t')) || 0) < 6 * 3600000) refuse('paper_cooldown', 'The Delegate can rename the paper once every six hours.');
  return { ref, doc: { nm, mo, by: who.uid, bn: text(mine?.n?.name, 40), t: now } };
}
async function assemblyTx(db, who, d) {
  const action = d.op !== 'state';
  let written = '', paper = null;
  const out = await db.runTransaction(async tx => {
    const now = Date.now();
    const e = await eligibility(tx, who, { linked: action, age: action ? DAY : 0, hidden: !action });
    const reg = e.n.reg, ctx = await regionState(tx, db, reg, now), mine = ctx.records.find(r => r.id === who.uid);
    const st = ctx.engine.state(now), a = structuredClone(mine.n.asm), previousProposal = a.p, op = d.op;
    if (action && a.o && (!a.j || a.j <= a.o) && op !== 'rejoin') refuse('resigned', 'Rejoin the Assembly before taking political actions.');
    const queue = ctx.records.filter(r => r.n.asm.p).map(r => ({ r, p: r.n.asm.p, k: ctx.engine.key(r.id, r.n.asm.p) }));
    const queued = k => queue.find(x => x.k === k && ctx.engine.cycle(x.p.t) >= ctx.c - 2 && !ctx.locks.some(L => L.k === k));
    if (op === 'vote') {
      if (![-1,0,1].includes(d.vote) || d.cycle !== ctx.c || d.key !== st.cur?.k) refuse('vote_closed', 'This vote has closed or changed. Refresh the Assembly.');
      /* the reason a member gives for its vote, shown beside it (up to 100 characters) */
      const why = text(d.why, 100);
      a.v = [...(a.v || []).filter(v => v.c >= ctx.c - 3 && v.c !== ctx.c), { c: ctx.c, k: st.cur.k, v: d.vote, t: now, ...(why ? { x: why } : {}) }];
    } else if (op === 'propose') {
      const ti = text(d.title, 60), body = text(d.body, 280);
      /* a repeal names a resolution in the rulebook, and takes its category and strength from it */
      let category = d.category, strength = d.strength, repeal = null;
      if (!d.edit && typeof d.repeal === 'string' && d.repeal) {
        repeal = ctx.engine.book(ctx.c).find(x => x.k === d.repeal);
        if (!repeal) refuse('repeal_gone', 'That resolution is no longer in the rulebook.');
        category = repeal.cat; strength = repeal.g ? 1 : 0;
      }
      if (ti.length < 4 || body.length < 10 || !own(ctx.engine.cats, category) || ![0,1].includes(strength)) throw new HttpsError('invalid-argument', 'Choose a category, title and proposal text.');
      const current = a.p && queued(ctx.engine.key(who.uid, a.p));
      if (d.edit) {
        if (!current) refuse('proposal_locked', 'This proposal can no longer be edited.');
        Object.assign(a.p, { ti, tx: body, ed: now });
      } else {
        if (current || (a.p && st.cur?.k === ctx.engine.key(who.uid,a.p))) refuse('proposal_exists', 'You already have a proposal before the Assembly.');
        if (a.pw && now - a.pw < 6 * 3600000) refuse('proposal_cooldown', 'Wait six hours after withdrawing a proposal.');
        a.p = { t: now, ti, tx: body, c: category, g: strength, ...(repeal ? { rp: repeal.k, rt: text(repeal.ti, 60) } : {}) };
      }
    } else if (op === 'withdraw') {
      if (!a.p || st.cur?.k === ctx.engine.key(who.uid, a.p)) refuse('proposal_locked', 'A proposal at the vote cannot be withdrawn.');
      a.pw = now; delete a.p;
    } else if (op === 'endorse' || op === 'support') {
      const endorse = op === 'endorse', key = endorse ? 'i' : 'k', target = endorse ? d.target : d.key;
      const valid = endorse ? ctx.records.find(r => r.id === target && r.id !== who.uid && r.n.civicAt && r.n.civicAt <= now && (!r.n.asm.o || r.n.asm.j > r.n.asm.o)) : queued(target);
      if (typeof d.on !== 'boolean') throw new HttpsError('invalid-argument', 'Choose whether to support or withdraw.');
      if (d.on && (!valid || (!endorse && valid.r.id === who.uid))) refuse('invalid_target', 'That nation or proposal is not eligible.');
      const field = endorse ? 'e' : 's', entries = a[field] || [], active = entries.find(x => x[key] === target && !x.w);
      if (d.on === true && !active) {
        if (entries.filter(x => !x.w).length >= (endorse ? 24 : 12)) refuse('limit', 'You have reached the active support limit.');
        if (endorse && entries.some(x => x.i === target && now - x.w < DAY)) refuse('endorsement_cooldown', 'Wait 24 hours before endorsing that nation again.');
        entries.push({ [key]: target, t: now });
      } else if (d.on === false && active) active.w = now;
      a[field] = entries.filter(x => !x.w || now - x.w < 4 * DAY);
    } else if (op === 'agenda' || op === 'message' || op === 'paper') {
      if (st.D?.id !== who.uid) refuse('delegate_required', 'Only the current Delegate can do that.');
      if (op === 'paper') paper = await paperName(tx, db, reg, who, mine, d, now);
      else if (op === 'agenda') {
        if (!queued(d.key)) refuse('invalid_target', 'Choose a queued proposal.');
        if (a.a?.k === d.key && a.a.c === ctx.c + 1) delete a.a;
        else a.a = { c: ctx.c + 1, k: d.key, t: now };
      } else {
        const x = text(d.message, 100);
        if (a.m && now - a.m.t < 3600000 && a.m.x !== x) refuse('message_cooldown', 'The Delegate can change the message once an hour.');
        a.m = { x, t: now };
      }
    } else if (op === 'resign') { a.o = now; a.ox = text(d.reason, 100); delete a.a;
    } else if (op === 'rejoin') {
      if (!a.o || now - a.o < 3 * DAY) refuse('rejoin_cooldown', 'Wait three days after resigning before rejoining.');
      a.j = now;
    } else if (op !== 'state') throw new HttpsError('invalid-argument', 'Unknown political action.');
    // All reads precede writes. The region revision serializes boundary finalization, votes and elections.
    const cbMeta = ctx.debate ? await tx.get(db.doc('cb/' + reg)) : null;
    for (const [ref, L] of ctx.pending) tx.set(ref, L);
    for (const [ref, entry] of ctx.book) tx.set(ref, entry);
    if (ctx.debate) {
      tx.set(db.doc('cb/' + reg + '/posts/' + ctx.debate.dt), debateTopic(reg, ctx.debate, ctx.engine.t0(ctx.debate.c + 1), now));
      tx.set(cbMeta.ref, cbCounted(cbMeta, now, { n: 1 }));
    }
    if (paper) tx.set(paper.ref, paper.doc, { merge: true });
    if (action) {
      mine.n.asm = a;
      tx.set(ctx.root.collection('actors').doc(who.uid), { generation: e.generation, record: a, at: now });
      if (op === 'vote') { const v = a.v[a.v.length - 1]; tx.set(ctx.root.collection('cycles').doc(String(ctx.c)).collection('votes').doc(who.uid), { uid: who.uid, cycle: ctx.c, key: st.cur.k, value: d.vote, at: now, ...(v.x ? { why: v.x } : {}) }); }
      if (op === 'propose' || op === 'withdraw') {
        const p = a.p || previousProposal;
        if (p) tx.set(ctx.root.collection('proposals').doc(ctx.engine.key(who.uid,p)), { uid: who.uid, ...p, status: op === 'withdraw' ? 'withdrawn' : 'queued', at: now });
      }
      ctx.engine = assemblyEngine(reg, ctx.records, ctx.locks);
    }
    // Avoid a write on every read when nothing changed; boundary creation still owns a revision.
    if (action || ctx.pending.length) {
      const D = ctx.engine.state(now).D;
      tx.set(ctx.root.collection('leadership').doc('current'), { id: D?.id || '', endorsements: D?.k || 0, at: now });
    }
    if (op === 'vote' && Date.now() >= st.t1) refuse('vote_closed', 'This vote has closed. Refresh the Assembly.');
    if (action || ctx.pending.length) tx.set(ctx.root, { rev: (ctx.meta.get('rev') || 0) + 1, startCycle: ctx.meta.get('startCycle') ?? ctx.c, at: now }, { merge: true });
    written = action || ctx.pending.length ? reg : '';
    return output(ctx, who.uid, now, e);
  });
  // other instances see the root document change; this one need not wait for the read
  if (written) regionCache.delete(written);
  return out;
}

/* Development news comments: devnews/<post>/posts/<id>, written here so the board's checks apply (a linked
   account, no ban or moderation, one post every 20 seconds across boards and news). The comment keeps the
   nation's name, region and flag as they were, since readers in other regions do not load that nation. */
const newsId = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const commentText = x => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000) : '';
async function newsComment(db, who, d) {
  const post = newsId(d.post), x = commentText(d.text), re = newsId(d.re);
  if (!post) throw new HttpsError('invalid-argument', 'Choose a news post.');
  if (!x) throw new HttpsError('invalid-argument', 'Write a comment first.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), limit = db.doc('limits/' + who.uid);
    const [s, p, parent] = await Promise.all([tx.get(limit), tx.get(db.doc('devnews/' + post)), re ? tx.get(db.doc('devnews/' + post + '/posts/' + re)) : null]);
    if (!p.exists || p.get('pub') !== true) refuse('news_missing', 'This post is no longer published.');
    // a reply answers a comment, not another reply: the thread stays one level deep
    if (re && (!parent.exists || parent.get('re'))) refuse('news_reply_missing', 'That comment is no longer there to reply to.');
    if (p.get('lk') === true) refuse('news_locked', 'Comments on this post are closed.');
    if (s.exists && Date.now() - s.get('p').toMillis() < 20000) throw new HttpsError('resource-exhausted', 'Wait 20 seconds between community posts.');
    const flag = e.n.flag && typeof e.n.flag === 'object' ? JSON.stringify(e.n.flag) : '';
    const ref = db.collection('devnews/' + post + '/posts').doc();
    tx.create(ref, { a: who.uid, t: FieldValue.serverTimestamp(), x, nm: text(e.saved.get('name'), 80) || 'A nation', rg: e.n.reg || e.saved.get('reg'),
      ...(flag && flag.length <= 4000 ? { fl: flag } : {}), ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}), ...(re ? { re } : {}) });
    tx.set(limit, { p: FieldValue.serverTimestamp() });
    return { id: ref.id };
  });
}
/* an admin or moderator removes a comment; the audit log keeps what it said */
async function newsModerate(db, who, d) {
  if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Only Edictum moderators can remove comments.');
  const post = newsId(d.post), id = newsId(d.comment), reason = text(d.reason, 300) || 'Removed from development news';
  if (!post || !id) throw new HttpsError('invalid-argument', 'Choose a comment.');
  const ref = db.doc('devnews/' + post + '/posts/' + id), c = await ref.get();
  if (!c.exists) return { ok: true };
  const report = typeof d.report === 'string' && /^[\w-]{1,128}$/.test(d.report) ? d.report : '';
  const b = db.batch();
  b.delete(ref);
  if (report) b.delete(db.doc('reports/' + report));
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'news_comment_remove', target: text(c.get('a'), 128), name: text(c.get('nm'), 80), post, comment: id,
    x: text(c.get('x'), 1000), reason, outcome: 'completed', at: FieldValue.serverTimestamp() });
  await b.commit();
  return { ok: true };
}

/* Reactions and poll votes on a post: the player's own choice is devnews/<post>/me/<uid> {e?, v?}, which only
   they read, and the totals are devnewsStat/<post> {r: {kind: n}, v: [n, ...], n?: reads}, which everyone reads. Both are
   written here, in one transaction, so a total always matches the choices behind it. */
const NEWS_REACT = ['up', 'heart', 'party', 'think'];
async function newsTally(db, who, d, kind) {
  const post = newsId(d.post);
  if (!post) throw new HttpsError('invalid-argument', 'Choose a news post.');
  return db.runTransaction(async tx => {
    // anyone with a nation reacts; a vote, like a comment, needs a linked sign-in
    await eligibility(tx, who, { linked: kind === 'v' });
    const me = db.doc('devnews/' + post + '/me/' + who.uid), st = db.doc('devnewsStat/' + post);
    const [p, m, s] = await Promise.all([tx.get(db.doc('devnews/' + post)), tx.get(me), tx.get(st)]);
    if (!p.exists || p.get('pub') !== true) refuse('news_missing', 'This post is no longer published.');
    const mine = m.exists ? m.data() : {}, tot = s.exists ? s.data() : {}, r = { ...(tot.r || {}) }, v = Array.isArray(tot.v) ? tot.v.slice() : [];
    if (kind === 'e') {
      const pick = NEWS_REACT.includes(d.e) && d.e !== mine.e ? d.e : '';
      if (mine.e) r[mine.e] = Math.max(0, (r[mine.e] || 0) - 1);
      if (pick) r[pick] = (r[pick] || 0) + 1;
      mine.e = pick; if (!pick) delete mine.e;
    } else {
      const pl = p.get('pl'), n = pl && Array.isArray(pl.o) ? pl.o.length : 0, o = Number(d.o);
      if (!n) refuse('poll_missing', 'This post has no poll.');
      if (pl.end && Date.now() > pl.end) refuse('poll_closed', 'This poll has closed.');
      if (!Number.isInteger(o) || o < 0 || o >= n) throw new HttpsError('invalid-argument', 'Choose one of the answers.');
      if (Number.isInteger(mine.v)) refuse('poll_voted', 'Your nation has already voted in this poll.');
      while (v.length < n) v.push(0);
      v[o]++; mine.v = o;
    }
    // merged: the read count (n) beside them is written by the readers' browsers (see firestore.rules)
    tx.set(st, { r, v }, { merge: true });
    if (Object.keys(mine).length) tx.set(me, mine); else tx.delete(me);
    return { r, v, e: mine.e || '', o: Number.isInteger(mine.v) ? mine.v : -1 };
  });
}

/* what civic answers: anything else is refused before it reads a thing. An Assembly action reads every nation of the
   region in its transaction (only a Registered Nation a day old gets that far), so it is paced more closely (functions/pace.js) */
const ASSEMBLY_ACTS = new Set(['vote', 'propose', 'withdraw', 'endorse', 'support', 'agenda', 'message', 'paper', 'resign', 'rejoin']);
const CIVIC_OPS = new Set(['authorizeSave', 'carryKey', 'newsComment', 'newsModerate', 'newsReact', 'newsVote', 'renamed',
  'cbTopic', 'cbReply', 'cbEdit', 'cbDelete', 'cbMod', 'cbPost', 'topic', 'topicReact', 'state', 'book', ...ASSEMBLY_ACTS]);

/* One vCPU serves up to 80 requests at once; a smaller share of one serves a single request, and every nation
   save asks here for its permit. maxInstances still caps the bill. */
export const civic = onCall({ region: 'europe-west1', maxInstances: 10, cpu: 1, memory: '512MiB', concurrency: 80, timeoutSeconds: 60 }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const d = req.data && typeof req.data === 'object' ? req.data : {}, uid = req.auth.uid, op = typeof d.op === 'string' ? d.op : '';
  if (!CIVIC_OPS.has(op) && !isAllianceOp(op) && !isFlagOp(op)) throw new HttpsError('invalid-argument', 'Unknown request.');
  // a nation saves at most once a second (firestore.rules), so 30 at once and one a second is more than any game sends
  // a reaction rewrites a message every reader of the region's board listens to: 20 at once, then one every 4 seconds
  pace([['c:' + uid, 30, 1], ...ipRule(req, 'ci', 300, 15), ...(ASSEMBLY_ACTS.has(op) ? [['ca:' + uid, 20, 1 / 3]] : []), ...(op === 'topicReact' ? [['cr:' + uid, 20, 1 / 4]] : []),
    // scoring a flag: a judge clicks through a batch of ten, then one every two seconds
    ...(op === 'fcRate' ? [['fr:' + uid, 30, 1 / 2]] : []),
    // a page of the Book of Resolutions: ten at once, then one every five seconds
    ...(op === 'book' ? [['cbk:' + uid, 10, 1 / 5]] : [])]);
  const db = getFirestore(), who = await identity(uid);
  if (d.op === 'authorizeSave') return permit(db, who, d);
  if (d.op === 'carryKey') return noteCarryKey(db, who, d);
  if (d.op === 'newsComment') return newsComment(db, who, d);
  if (d.op === 'newsModerate') return newsModerate(db, who, d);
  if (d.op === 'newsReact') return newsTally(db, who, d, 'e');
  if (d.op === 'newsVote') return newsTally(db, who, d, 'v');
  if (d.op === 'renamed') return renamed(db, who);
  if (d.op === 'cbTopic') return cbTopic(db, who, d, regions);
  if (d.op === 'cbReply') return cbReply(db, who, d, regions);
  if (d.op === 'cbEdit') return cbEdit(db, who, d, regions);
  if (d.op === 'cbDelete') return cbDelete(db, who, d, regions);
  if (d.op === 'cbMod') return cbMod(db, who, d, regions);
  if (d.op === 'cbPost') return cbPost(db, who, d, regions);
  if (d.op === 'topicReact') return rmbReact(db, who, d);
  if (d.op === 'book') return bookRead(db, who, d);
  if (isAllianceOp(d.op)) return alliance(db, who, d);
  if (isFlagOp(d.op)) return flagOp(db, who, d);
  /* a message on a region's board: a nation on its own region's, or an admin, as the Edictum team (board.js teamMark),
     on any region's (from its region page, observing it or not), unpaced. With re, it replies to a message on the same
     board that is not itself a reply (board.js rmbParent) */
  if (d.op === 'topic') return db.runTransaction(async tx => {
    const team = asTeam(who, d), e = await eligibility(tx, who, team ? TEAM_OK : {}), limit = db.doc('limits/' + who.uid), s = await tx.get(limit);
    const reg = team ? (typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '') : e.n.reg;
    if (team && !reg) throw new HttpsError('invalid-argument', 'Choose a region.');
    if (!team && d.reg && d.reg !== e.n.reg) throw new HttpsError('permission-denied', 'Post to your own region.');
    const x = text(d.text, 400), now = Date.now();
    if (!x) throw new HttpsError('invalid-argument', 'Write a message first.');
    if (!team && s.exists && now - s.get('p').toMillis() < 20000) throw new HttpsError('resource-exhausted', 'Wait 20 seconds between community posts.');
    const re = d.re ? await rmbParent(tx, db, reg, d.re) : '';
    const ref = db.collection('boards/' + reg + '/posts').doc();
    tx.create(ref, { a: who.uid, t: FieldValue.serverTimestamp(), x, ...(re ? { re } : {}), ...(team ? teamMark(d) : {}) });
    tx.set(limit, { p: FieldValue.serverTimestamp() });
    return { id: ref.id };
  });
  return assembly(db, who, d);
});
