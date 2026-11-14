import { HttpsError } from 'firebase-functions/v2/https';
import { eligibility, refuse, nationJSON, DAY } from './eligibility.js';
import { cabinetAffinity } from './affinity.js';
import DATA from './civic-data.json' with { type: 'json' };
import { AL_TYPES, AL_ACCESS, AL_RES, AL_PROJECTS, AL_OFFICERS, AL_XP, AL_ALLY_MIN, AL_FOUND_POP, AL_REL_MAX, AL_REL_NOTICE, alLevel, alPlaces, alRelLive } from './alliance-rules.js';

/* Alliances, written only here (civic ops al*), so that an alliance outlives the nation that founded it.
     alliances/{aid}        {v, reg, name, mo, em, col, ty, acc, t, fd, ld, tyAt, mem, npc, iv, rq, xp, tt, tr, dn, pj, log}
                            mem {uid: {t: joined, r?: 'o' an officer}}; ld the leader (a member); fd who founded it
                            npc {id: t} computer members; iv {uid: t} invitations; rq {uid: {t, x}} requests with a note
                            xp renown and tt its last daily tally; tr the treasury and dn {uid: {res totals, lt, xd, xq}}
                            the donations credited from each member's pledges (alp in their record); pj {project: level}
                            log the last 40 events [{t, k, a, b?, x?}]
                            rel {aid: …} its relations with other alliances: a pact {k:'pact', st, t, at?, end?, by}
                            (st 'offered' by this one, 'asked' of it, 'active', 'ending' until end) or a rivalry
                            {k:'rival', me (this one named the other), them (the other named this one), t}
     alliances/{aid}/chat/{id}   the members' channel {a, nm, x, t}, which only members read (firestore.rules); not
                            'posts', which every player may read (the rule for deleting one's own posts)
     allyOf/{id}            {a, reg, t, npc?}: the alliance a nation (or a computer nation) belongs to, for the referee
     alPace/{uid}           {p}: the times of a member's channel posts in the last hour, server-only
   Alliances founded before this kept their founder's id as their own (alMigrate), so a legacy record's allyOf and the
   referee's allyOf/ agree while a region moves over. Every member of an alliance defends the others; its type adds a
   bonus, and its renown (xp) levels, member places and projects follow functions/alliance-rules.js. */
export const NPC = new Map(DATA.regions.flatMap(r => r.npcs.map(n => [n.id, { ...n, reg: r.id }])));
/* the computer nations' own alliances (NPC_BLOCS in the game): their members cannot be invited */
const BLOC = new Set(['npc-vellmark', 'npc-karvesk', 'npc-lucanto', 'npc-ilsund', 'npc-marrowmere']);
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const body = (x, max) => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
const isUid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-');
const isAid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const COL = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : '';
const KEY = v => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v) ? v : '';
const day = t => new Date(t).toISOString().slice(0, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const AL_NAME = 40, AL_MOTTO = 80, AL_NOTE = 200, AL_POST = 1000, AL_GAP = 8000, AL_HOUR = 40;
const AWAY = 7 * DAY, TALLY_EVERY = 20 * 3600000, TALLY_WINDOW = 2 * DAY, PEACE_WAIT = 3 * DAY;
const ROLE = { m: 1, o: 2, ld: 3 };

function emblem(e) {
  if (!e || typeof e !== 'object') return null;
  const c = Array.isArray(e.c) ? e.c.slice(0, 3).map(COL) : [];
  const p = KEY(e.p);
  if (!p || c.length !== 3 || c.some(x => !x)) return null;
  return { p, c, e: KEY(e.e) || 'none', ec: COL(e.ec) || '#F2C230' };
}
const DEF_EM = { p: 'bi-h', c: ['#1C4D9E', '#F2C230', '#FFFFFF'], e: 'star', ec: '#FFFFFF' };
function roleOf(A, uid) { if (!A.mem || !A.mem[uid]) return ''; if (A.ld === uid) return 'ld'; return A.mem[uid].r === 'o' ? 'o' : 'm'; }
function need(A, uid, min) {
  const r = roleOf(A, uid);
  if (!r) throw new HttpsError('permission-denied', 'You are not a member of this alliance.');
  if (ROLE[r] < ROLE[min]) throw new HttpsError('permission-denied', min === 'ld' ? 'Only the alliance’s leader can do that.' : 'Only the alliance’s leader and officers can do that.');
  return r;
}
const logged = (A, e) => { A.log = [{ t: Date.now(), ...e }, ...(Array.isArray(A.log) ? A.log : [])].slice(0, 40); };
const count = A => Object.keys(A.mem || {}).length + Object.keys(A.npc || {}).length;
function roomFor(A) { if (count(A) >= alPlaces(A.xp, A.pj)) refuse('al_full', `This alliance has no place left: ${alPlaces(A.xp, A.pj)} at its level. More places come with renown and an Alliance Hall.`); }
const regOf = e => e.n.reg || e.saved.get('reg') || '';
/* how a computer nation regards a player, as the game's affinity(): political distance, the cabinet, goodwill */
export function npcAffinity(id, rec) {
  const npc = NPC.get(id); if (!npc) return 0;
  const s = npc.s || {}, b = rec.s || {}, d = ['civil', 'econ', 'pol'].reduce((v, k) => v + Math.abs((s[k] ?? 50) - (b[k] ?? 50)), 0) / 3;
  return Math.round(clamp(100 - d + cabinetAffinity(rec) + clamp(Number(rec.gw?.[id]) || 0, -20, 20), 0, 100));
}
/* a war between a record and a computer nation: declared later than any peace either side made */
export function warWithNpc(rec, id) { const w = rec.wars?.[id]?.t || 0, p = rec.peace?.[id] || 0; return w > 0 && w > p; }

/* the alliance being acted on, read in the action's transaction */
async function load(tx, db, d) {
  const aid = isAid(d.aid) ? d.aid : '';
  if (!aid) throw new HttpsError('invalid-argument', 'Choose an alliance.');
  const ref = db.doc('alliances/' + aid), s = await tx.get(ref);
  if (!s.exists) refuse('al_missing', 'This alliance no longer exists.');
  const A = s.data();
  for (const k of ['mem', 'npc', 'iv', 'rq', 'tr', 'dn', 'pj', 'rel']) if (!A[k] || typeof A[k] !== 'object') A[k] = {};
  return { aid, ref, A };
}
/* whether a nation already belongs to an alliance: its allyOf/ entry, checked against the alliance it names */
async function belongs(tx, db, id) {
  const ix = await tx.get(db.doc('allyOf/' + id));
  if (!ix.exists) return null;
  const aid = ix.get('a'), s = isAid(aid) ? await tx.get(db.doc('alliances/' + aid)) : null;
  if (!s || !s.exists) return { stale: true };
  const A = s.data();
  return (A.mem && A.mem[id]) || (A.npc && A.npc[id]) ? { aid, A } : { stale: true };
}
const ix = (db, id) => db.doc('allyOf/' + id);
function join(tx, db, aid, A, id, nm, now, how, g) {
  A.mem[id] = { t: now, ...(Number.isFinite(g) ? { g } : {}) }; delete A.iv[id]; delete A.rq[id];
  A.xp = (A.xp || 0) + AL_XP.join;
  logged(A, { k: how || 'join', a: id, b: nm });
  tx.set(ix(db, id), { a: aid, reg: A.reg, t: now });
}
/* who leads next: the longest-serving officer, then the longest-serving member; given a test, the first who passes it */
function successor(A, ok) {
  const list = Object.entries(A.mem).filter(([id]) => id !== A.ld).sort((a, b) => (b[1].r === 'o') - (a[1].r === 'o') || a[1].t - b[1].t).map(([id]) => id);
  return (ok ? list.find(ok) : null) || (ok ? null : list[0]) || null;
}
/* every member goes; the channel's posts are deleted after the transaction (dropPosts) */
function dissolve(tx, db, ref, A) {
  for (const id of Object.keys(A.mem)) tx.delete(ix(db, id));
  for (const id of Object.keys(A.npc)) tx.delete(ix(db, id));
  tx.delete(ref);
}
async function dropPosts(db, aid) {
  for (;;) {
    const qs = await db.collection('alliances/' + aid + '/chat').limit(400).get();
    if (qs.empty) break;
    const b = db.batch(); qs.docs.forEach(r => b.delete(r.ref)); await b.commit();
  }
}
const nameOf = s => (s && s.exists && line(s.get('name'), 80)) || 'A nation';

/* ── founding and the charter ── */
async function alFound(db, who, d) {
  const name = line(d.name, AL_NAME), mo = line(d.mo, AL_MOTTO), em = emblem(d.em) || DEF_EM, col = COL(d.col) || '#3A8FD1';
  const ty = AL_TYPES.includes(d.ty) ? d.ty : 'def', acc = AL_ACCESS.includes(d.acc) ? d.acc : 'apply';
  if (name.length < 3) throw new HttpsError('invalid-argument', 'Give the alliance a name of at least three characters.');
  let aid = '';
  await db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e);
    if ((Number(e.saved.get('pop')) || 0) < AL_FOUND_POP - 1e-6) refuse('al_small', `Founding an alliance unlocks at ${AL_FOUND_POP} million people. You can still join one.`);
    const [mine, same] = await Promise.all([belongs(tx, db, who.uid), tx.get(db.collection('alliances').where('reg', '==', reg))]);
    if (mine && !mine.stale) refuse('al_member', 'Leave your current alliance first.');
    if (same.docs.some(s => fold(s.get('name')) === fold(name))) refuse('al_name', 'Another alliance in this region already has that name.');
    const now = Date.now(), ref = db.collection('alliances').doc(); aid = ref.id;
    const A = { v: 1, reg, name, mo, em, col, ty, acc, t: now, fd: who.uid, ld: who.uid, mem: { [who.uid]: { t: now, g: e.generation } }, npc: {}, iv: {}, rq: {}, xp: 0, tt: now, tr: {}, dn: {}, pj: {}, log: [] };
    logged(A, { k: 'found', a: who.uid, b: nameOf(e.saved), x: name });
    tx.create(ref, A);
    tx.set(ix(db, who.uid), { a: aid, reg, t: now });
  });
  return { ok: true, aid };
}
async function alEdit(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d);need(A, who.uid, 'ld');
    const ch = {}, now = Date.now();
    if (d.name !== undefined) {
      const name = line(d.name, AL_NAME);
      if (name.length < 3) throw new HttpsError('invalid-argument', 'Give the alliance a name of at least three characters.');
      if (fold(name) !== fold(A.name)) {
        const same = await tx.get(db.collection('alliances').where('reg', '==', A.reg));
        if (same.docs.some(s => s.id !== ref.id && fold(s.get('name')) === fold(name))) refuse('al_name', 'Another alliance in this region already has that name.');
      }
      ch.name = name;
    }
    if (d.mo !== undefined) ch.mo = line(d.mo, AL_MOTTO);
    if (d.em !== undefined) { const em = emblem(d.em); if (!em) throw new HttpsError('invalid-argument', 'That banner cannot be used.'); ch.em = em; }
    if (d.col !== undefined) { const c = COL(d.col); if (!c) throw new HttpsError('invalid-argument', 'Choose a colour.'); ch.col = c; }
    if (d.acc !== undefined) { if (!AL_ACCESS.includes(d.acc)) throw new HttpsError('invalid-argument', 'Choose who may join.'); ch.acc = d.acc; }
    if (d.ty !== undefined && d.ty !== A.ty) {
      if (!AL_TYPES.includes(d.ty)) throw new HttpsError('invalid-argument', 'Choose a type of alliance.');
      if (A.tyAt && now - A.tyAt < 7 * DAY) refuse('al_type_wait', 'The alliance changed its type in the last 7 days. It can change again ' + new Date(A.tyAt + 7 * DAY).toISOString().slice(0, 10) + '.');
      ch.ty = d.ty; ch.tyAt = now;
    }
    if (!Object.keys(ch).length) return { ok: true };
    Object.assign(A, ch);
    logged(A, { k: ch.ty ? 'type' : 'edit', a: who.uid, x: ch.ty || '' });
    tx.update(ref, { ...ch, log: A.log });
    return { ok: true };
  });
}

/* ── members: invitations, requests, admissions, departures and roles ── */
async function alInvite(db, who, d) {
  const id = typeof d.id === 'string' ? d.id : '';
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { aid, ref, A } = await load(tx, db, d);need(A, who.uid, 'o');
    const now = Date.now();
    if (NPC.has(id)) {
      const npc = NPC.get(id);
      if (npc.reg !== A.reg) refuse('al_region', 'That nation is in another region.');
      if (BLOC.has(id)) refuse('al_bloc', 'That computer nation belongs to an alliance of its own.');
      const [held, leader] = await Promise.all([belongs(tx, db, id), tx.get(db.doc('nations/' + A.ld))]);
      const L = nationJSON(leader);
      if (held && !held.stale) {
        if (held.aid === aid) return { ok: true };
        /* a computer nation whose values have drifted from its alliance's leader has left it in every game, so it is free */
        const ol = await tx.get(db.doc('nations/' + held.A.ld));
        if (npcAffinity(id, nationJSON(ol)) >= AL_ALLY_MIN - 10) refuse('al_taken', 'That computer nation is already in another alliance.');
        const nn = { ...held.A.npc }; delete nn[id];
        tx.update(db.doc('alliances/' + held.aid), { npc: nn });
      }
      if (warWithNpc(L, id)) refuse('al_war', 'Your leader is at war with that nation. Make peace first.');
      const pz = Number(L.peace?.[id]) || 0;
      if (pz && now - pz < PEACE_WAIT) refuse('al_peace_wait', 'That nation made peace with your leader less than 3 days ago and will not join yet.');
      const af = npcAffinity(id, L);
      if (af < AL_ALLY_MIN) refuse('al_affinity', `It declined: its values are too far from your leader’s (affinity ${af} of the ${AL_ALLY_MIN} needed).`);
      roomFor(A);
      A.npc[id] = now; A.xp = (A.xp || 0) + AL_XP.join;
      logged(A, { k: 'npc', a: id, b: npc.name || id });
      tx.update(ref, { npc: A.npc, xp: A.xp, log: A.log });
      tx.set(ix(db, id), { a: aid, reg: A.reg, t: now, npc: true });
      return { ok: true, joined: true };
    }
    if (!isUid(id) || id === who.uid) throw new HttpsError('invalid-argument', 'Choose a nation to invite.');
    const [target, held] = await Promise.all([tx.get(db.doc('nations/' + id)), belongs(tx, db, id)]);
    if (!target.exists || (target.get('reg') || '') !== A.reg) refuse('al_region', 'That nation is not in this region.');
    if (held && !held.stale) refuse('al_taken', held.aid === aid ? 'That nation is already a member.' : 'That nation is already in another alliance.');
    if (A.rq[id]) {
      roomFor(A);
      join(tx, db, aid, A, id, nameOf(target), now, 'admit', target.createTime.toMillis());
      tx.update(ref, { mem: A.mem, iv: A.iv, rq: A.rq, xp: A.xp, log: A.log });
      return { ok: true, joined: true };
    }
    A.iv[id] = now;
    tx.update(ref, { iv: A.iv });
    return { ok: true };
  });
}
async function alUninvite(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { ref, A } = await load(tx, db, d);need(A, who.uid, 'o');
    if (typeof d.id === 'string') delete A.iv[d.id];
    tx.update(ref, { iv: A.iv });
    return { ok: true };
  });
}
/* asking to join: an invited nation, or one asking an open alliance, joins at once; others wait for an officer */
async function alRequest(db, who, d) {
  const x = line(d.x, AL_NOTE);
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d);
    if (regOf(e) !== A.reg) refuse('al_region', 'That alliance is in another region.');
    const held = await belongs(tx, db, who.uid);
    if (held && !held.stale) refuse('al_member', held.aid === aid ? 'You are already a member.' : 'Leave your current alliance first.');
    const now = Date.now();
    if (A.iv[who.uid] || A.acc === 'open') {
      roomFor(A);
      join(tx, db, aid, A, who.uid, nameOf(e.saved), now, '', e.generation);
      tx.update(ref, { mem: A.mem, iv: A.iv, rq: A.rq, xp: A.xp, log: A.log });
      return { ok: true, joined: true };
    }
    if (A.acc === 'invite') refuse('al_closed', 'This alliance admits only the nations it invites.');
    A.rq[who.uid] = { t: now, ...(x ? { x } : {}) };
    tx.update(ref, { rq: A.rq });
    return { ok: true };
  });
}
async function alCancel(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, A } = await load(tx, db, d);
    const had = !!A.rq[who.uid] || !!A.iv[who.uid];
    delete A.rq[who.uid]; if (d.decline) delete A.iv[who.uid];
    if (had) tx.update(ref, { rq: A.rq, iv: A.iv });
    return { ok: true };
  });
}
async function alAnswer(db, who, d) {
  const id = isUid(d.id) ? d.id : '';
  if (!id) throw new HttpsError('invalid-argument', 'Choose a request.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { aid, ref, A } = await load(tx, db, d);need(A, who.uid, 'o');
    if (!A.rq[id]) refuse('al_no_request', 'That request is no longer there.');
    if (!d.yes) { delete A.rq[id]; tx.update(ref, { rq: A.rq }); return { ok: true }; }
    const [target, held] = await Promise.all([tx.get(db.doc('nations/' + id)), belongs(tx, db, id)]);
    if (!target.exists || (target.get('reg') || '') !== A.reg || (held && !held.stale)) {
      delete A.rq[id]; tx.update(ref, { rq: A.rq });
      return { ok: false, why: 'gone' };
    }
    roomFor(A);
    join(tx, db, aid, A, id, nameOf(target), Date.now(), 'admit', target.createTime.toMillis());
    tx.update(ref, { mem: A.mem, iv: A.iv, rq: A.rq, xp: A.xp, log: A.log });
    return { ok: true, joined: true };
  });
}
async function alLeave(db, who, d) {
  let gone = '';
  const r = await db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true });
    const { aid, ref, A } = await load(tx, db, d);
    if (!A.mem[who.uid]) return { ok: true };
    const wasLeader = A.ld === who.uid;
    delete A.mem[who.uid];
    if (!Object.keys(A.mem).length || d.disband && wasLeader) { tx.delete(ix(db, who.uid)); dissolve(tx, db, ref, A); gone = aid; return { ok: true, dissolved: true }; }
    tx.delete(ix(db, who.uid));
    logged(A, { k: 'leave', a: who.uid, b: nameOf(e.saved) });
    if (wasLeader) { A.ld = successor(A); if (A.mem[A.ld]) delete A.mem[A.ld].r; logged(A, { k: 'leader', a: A.ld, x: 'left' }); }
    tx.update(ref, { mem: A.mem, ld: A.ld, log: A.log });
    return { ok: true };
  });
  if (gone) await dropPosts(db, gone);
  return r;
}
async function alRemove(db, who, d) {
  const id = typeof d.id === 'string' ? d.id : '';
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { ref, A } = await load(tx, db, d);const me = need(A, who.uid, 'o');
    if (A.npc[id]) { delete A.npc[id]; tx.delete(ix(db, id)); logged(A, { k: 'remove', a: id, b: NPC.get(id)?.name || id, x: who.uid }); tx.update(ref, { npc: A.npc, log: A.log }); return { ok: true }; }
    if (!A.mem[id] || id === who.uid) refuse('al_no_member', 'That nation is not a member.');
    if (me !== 'ld' && roleOf(A, id) !== 'm') throw new HttpsError('permission-denied', 'Only the leader can remove an officer.');
    const s = await tx.get(db.doc('nations/' + id));
    delete A.mem[id]; tx.delete(ix(db, id));
    logged(A, { k: 'remove', a: id, b: nameOf(s), x: who.uid });
    tx.update(ref, { mem: A.mem, log: A.log });
    return { ok: true };
  });
}
async function alRole(db, who, d) {
  const id = isUid(d.id) ? d.id : '', r = ['o', 'm', 'ld'].includes(d.r) ? d.r : '';
  if (!id || !r) throw new HttpsError('invalid-argument', 'Choose a member and a role.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d);need(A, who.uid, 'ld');
    if (!A.mem[id] || id === who.uid) refuse('al_no_member', 'That nation is not a member.');
    if (r === 'ld') { A.mem[who.uid].r = 'o'; delete A.mem[id].r; A.ld = id; logged(A, { k: 'leader', a: id, x: 'chosen' }); }
    else if (r === 'o') {
      if (Object.values(A.mem).filter(m => m.r === 'o').length >= AL_OFFICERS) refuse('al_officers', `An alliance has at most ${AL_OFFICERS} officers.`);
      A.mem[id].r = 'o'; logged(A, { k: 'role', a: id, x: 'o' });
    } else { delete A.mem[id].r; logged(A, { k: 'role', a: id, x: 'm' }); }
    tx.update(ref, { mem: A.mem, ld: A.ld, log: A.log });
    return { ok: true };
  });
}

/* ── the treasury and its projects ──
   A member pledges resources in their own record (alp: [{t, k, q, a}], taken from their stock in the same save), and
   this credits the pledges the saved record holds that are newer than the last one credited, so nothing is counted
   twice and nothing is given that was not taken. */
async function alDonate(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d);need(A, who.uid, 'm');
    const now = Date.now(), mine = { ...(A.dn[who.uid] || {}) }, lt = Number(mine.lt) || 0, add = {};
    let top = lt;
    for (const p of Array.isArray(e.n.alp) ? e.n.alp : []) {
      if (!p || p.a !== aid || !AL_RES.includes(p.k) || !Number.isFinite(p.t) || p.t <= lt || p.t > now + 60000) continue;
      const q = Math.round(clamp(Number(p.q) || 0, 0, 1000) * 100) / 100; if (!q) continue;
      add[p.k] = (add[p.k] || 0) + q; top = Math.max(top, p.t);
    }
    const total = Object.values(add).reduce((s, v) => s + v, 0);
    if (!total) return { ok: true, credited: {} };
    for (const [k, q] of Object.entries(add)) { A.tr[k] = Math.round(((Number(A.tr[k]) || 0) + q) * 100) / 100; mine[k] = Math.round(((Number(mine[k]) || 0) + q) * 100) / 100; }
    const today = day(now), xq = mine.xd === today ? Number(mine.xq) || 0 : 0, gain = Math.max(0, Math.min(AL_XP.donateDay - xq, Math.floor(total / AL_XP.donatePer)));
    Object.assign(mine, { lt: top, xd: today, xq: xq + gain });
    A.dn[who.uid] = mine; A.xp = (A.xp || 0) + gain;
    logged(A, { k: 'donate', a: who.uid, b: nameOf(e.saved), x: AL_RES.filter(k => add[k]).map(k => Math.round(add[k] * 10) / 10 + ' ' + k).join(', ') });
    tx.update(ref, { tr: A.tr, dn: A.dn, xp: A.xp, log: A.log });
    return { ok: true, credited: add, xp: gain };
  });
}
async function alBuild(db, who, d) {
  const P = AL_PROJECTS[d.p];
  if (!P) throw new HttpsError('invalid-argument', 'Choose a project.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d);need(A, who.uid, 'o');
    const at = Number(A.pj[d.p]) || 0;
    if (at >= P.max) refuse('al_built', 'That project is complete.');
    if (alLevel(A.xp) < P.lv[at]) refuse('al_level', `That needs an alliance of level ${P.lv[at]}.`);
    const cost = P.cost[at], short = AL_RES.filter(k => (Number(A.tr[k]) || 0) + 1e-9 < (cost[k] || 0));
    if (short.length) refuse('al_treasury', 'The treasury is short of ' + short.map(k => Math.ceil((cost[k] || 0) - (Number(A.tr[k]) || 0)) + ' ' + k).join(', ') + '.');
    for (const k of AL_RES) if (cost[k]) A.tr[k] = Math.round(((Number(A.tr[k]) || 0) - cost[k]) * 100) / 100;
    A.pj[d.p] = at + 1;
    logged(A, { k: 'build', a: who.uid, x: d.p + ':' + (at + 1) });
    tx.update(ref, { tr: A.tr, pj: A.pj, log: A.log });
    return { ok: true, level: at + 1 };
  });
}

/* ── the members' channel ── */
async function alPost(db, who, d) {
  const x = body(d.x, AL_POST);
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who);
    const { aid, A } = await load(tx, db, d);need(A, who.uid, 'm');
    const pace = db.doc('alPace/' + who.uid), ps = await tx.get(pace), now = Date.now();
    const p = (ps.exists && Array.isArray(ps.get('p')) ? ps.get('p') : []).filter(t => typeof t === 'number' && t <= now && now - t < 3600000);
    const wait = Math.max(p.length ? Math.max(...p) + AL_GAP - now : 0, p.length >= AL_HOUR ? Math.min(...p.slice(-AL_HOUR)) + 3600000 - now : 0);
    if (wait > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(wait / 1000)} seconds.`, { code: 'al_paced', wait });
    const ref = db.collection('alliances/' + aid + '/chat').doc();
    tx.set(pace, { p: p.concat(now).slice(-AL_HOUR) });
    tx.create(ref, { a: who.uid, nm: nameOf(e.saved), x, t: now });
    return { ok: true, id: ref.id };
  });
}
async function alPostDel(db, who, d) {
  const pid = typeof d.pid === 'string' && /^[A-Za-z0-9]{20}$/.test(d.pid) ? d.pid : '';
  if (!pid) throw new HttpsError('invalid-argument', 'Choose a message.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { aid, A } = await load(tx, db, d);
    const ref = db.doc('alliances/' + aid + '/chat/' + pid), s = await tx.get(ref);
    if (!s.exists) return { ok: true };
    if (s.get('a') !== who.uid) need(A, who.uid, 'o');
    tx.delete(ref);
    return { ok: true };
  });
}

/* ── the daily tally: renown for what the members did together, and the alliance kept tidy ──
   Asked by any member's game once the last tally is 20 hours old. It reads every member's saved record: renown for each
   member who played, each trade deal between members, each gift between members, each battle fought in an ally's war
   and each call to arms answered since the last tally (at most two days back). Members whose nations are gone leave,
   computer nations whose values have drifted from the leader's leave, and a leader away for 7 days hands over to the
   longest-serving officer or member who has played in that time. A Hall of Chronicles adds a tenth a level. */
async function alTally(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d);need(A, who.uid, 'm');
    const now = Date.now();
    if (now - (A.tt || 0) < TALLY_EVERY) return { ok: true, skipped: true };
    const ids = Object.keys(A.mem), snaps = ids.length ? await tx.getAll(...ids.map(id => db.doc('nations/' + id))) : [];
    const recs = new Map(), at = new Map();
    /* a nation founded again since it joined (the same account, a new nation) is not the member that joined */
    snaps.forEach((s, i) => { const g = A.mem[ids[i]].g; if (s.exists && !(g && s.createTime.toMillis() !== g)) { recs.set(ids[i], nationJSON(s)); at.set(ids[i], Number(s.get('updatedAt')) || 0); } });
    /* the members of its rivals (named by it, or naming it): battles against them earn renown */
    const rv = Object.keys(A.rel).filter(id => isAid(id) && A.rel[id] && A.rel[id].k === 'rival' && (A.rel[id].me || A.rel[id].them)).slice(0, 8);
    const foes = new Set();
    if (rv.length) (await tx.getAll(...rv.map(id => db.doc('alliances/' + id)))).forEach(s => { if (s.exists) Object.keys(s.get('mem') || {}).forEach(id => foes.add(id)); });
    const w0 = Math.max(A.tt || A.t || 0, now - TALLY_WINDOW), inWin = t => Number.isFinite(t) && t > w0 && t <= now;
    const mem = new Set(recs.keys()), all = new Set([...mem, ...Object.keys(A.npc)]);
    let xp = 0;
    const parts = { active: 0, deals: 0, gifts: 0, battles: 0, calls: 0 };
    for (const [id, n] of recs) {
      if (inWin(at.get(id)) || now - at.get(id) < DAY) { xp += AL_XP.active; parts.active++; }
      for (const x of Array.isArray(n.deals) ? n.deals : []) {
        if (!x || x.a || !mem.has(x.w)) continue;
        const pd = recs.get(x.w);
        if (pd && (pd.deals || []).some(y => y && y.id === x.id && y.a && y.w === id)) { xp += AL_XP.deal; parts.deals++; }
      }
      const g = (Array.isArray(n.gft) ? n.gft : []).filter(x => x && all.has(x.to) && x.to !== id && inWin(x.t)).length;
      const b = (Array.isArray(n.conq) ? n.conq : []).filter(x => x && all.has(x.w) && inWin(x.t)).length;
      const c = (Array.isArray(n.cta) ? n.cta : []).filter(x => x && all.has(x.w) && inWin(x.t)).length;
      xp += Math.min(g, AL_XP.giftCap) * AL_XP.gift + Math.min(b, AL_XP.battleCap) * AL_XP.battle + Math.min(c, AL_XP.callCap) * AL_XP.call;
      parts.gifts += g; parts.battles += b; parts.calls += c;
      const rb = foes.size ? (Array.isArray(n.conq) ? n.conq : []).filter(x => x && foes.has(x.d) && inWin(x.t)).length : 0;
      if (rb) { xp += Math.min(rb, AL_XP.rivalCap) * AL_XP.rival; parts.rival = (parts.rival || 0) + rb; }
    }
    for (const id of ids) if (!recs.has(id)) { delete A.mem[id]; tx.delete(ix(db, id)); logged(A, { k: 'leave', a: id, x: 'gone' }); }
    if (!Object.keys(A.mem).length) { dissolve(tx, db, ref, A); return { ok: true, dissolved: true }; }
    if (!A.mem[A.ld] || now - (at.get(A.ld) || 0) > AWAY) {
      const next = successor(A, id => now - (at.get(id) || 0) <= AWAY);
      if (next) { delete A.mem[next].r; logged(A, { k: 'leader', a: next, x: A.mem[A.ld] ? 'away' : 'gone' }); A.ld = next; }
      else if (!A.mem[A.ld]) { A.ld = successor(A); if (A.ld) delete A.mem[A.ld].r; }
    }
    const L = recs.get(A.ld);
    if (L) for (const id of Object.keys(A.npc)) if (npcAffinity(id, L) < AL_ALLY_MIN - 10) { delete A.npc[id]; tx.delete(ix(db, id)); logged(A, { k: 'npcleft', a: id, b: NPC.get(id)?.name || id }); }
    /* the Hall of Chronicles: a tenth more a level, rounded */
    const chron = Math.round(xp * AL_XP.chron * clamp(Number(A.pj.chronicle) || 0, 0, AL_PROJECTS.chronicle.max));
    if (chron > 0) { xp += chron; parts.chron = chron; }
    A.xp = (A.xp || 0) + xp; A.tt = now;
    if (xp) logged(A, { k: 'tally', x: String(xp), b: JSON.stringify(parts) });
    tx.update(ref, { mem: A.mem, npc: A.npc, ld: A.ld, xp: A.xp, tt: A.tt, log: A.log });
    return { ok: true, xp, parts };
  });
}

/* ── relations between alliances ──
   A pact: one leader offers it (rel[to] {k:'pact', st:'offered'} here, rel[aid] {st:'asked'} there) and the other's
   leader accepts. While it is in force no member of either may attack a member of the other (the game refuses the
   declaration, and the referee the battle). It ends with notice, or at once at a cost in renown. A rivalry: one leader
   names another alliance (me here, them there); battles against a rival's members earn renown in the daily tally,
   whichever side named the other. A pact and a rivalry between the same two cannot stand together. */
const relOf = (A, id, now) => { const r = A.rel[id]; if (!r || typeof r !== 'object') return null; if (r.k === 'pact' && r.st === 'ending' && now >= (Number(r.end) || 0)) return null; return r; };
async function loadPair(tx, db, d, uid) {
  const L = await load(tx, db, d); need(L.A, uid, 'ld');
  const to = isAid(d.to) ? d.to : '';
  if (!to || to === L.aid) throw new HttpsError('invalid-argument', 'Choose another alliance.');
  const oref = db.doc('alliances/' + to), os = await tx.get(oref);
  if (!os.exists) refuse('al_missing', 'That alliance no longer exists.');
  const B = os.data(); if (!B.rel || typeof B.rel !== 'object') B.rel = {};
  if (B.reg !== L.A.reg) refuse('al_region', 'That alliance is in another region.');
  return { ...L, to, oref, B };
}
/* pacts in force or offered by it, and rivals it named */
const pactsOf = (A, now) => Object.keys(A.rel).filter(id => { const r = relOf(A, id, now); return r && r.k === 'pact' && r.st !== 'asked'; }).length;
const rivalsOf = A => Object.values(A.rel).filter(r => r && r.k === 'rival' && r.me).length;
function relWrite(tx, P) {
  tx.update(P.ref, { rel: P.A.rel, log: P.A.log, xp: P.A.xp || 0 });
  tx.update(P.oref, { rel: P.B.rel, log: Array.isArray(P.B.log) ? P.B.log : [] });
}
function signPact(P, r, uid, now) {
  const { A, B, aid, to } = P, s = { k: 'pact', st: 'active', t: Number(r.t) || now, at: now, by: r.by || '' };
  A.rel[to] = { ...s }; B.rel[aid] = { ...s };
  logged(A, { k: 'pact', a: uid, b: B.name, x: to }); logged(B, { k: 'pact', a: uid, b: A.name, x: aid });
}
async function alPact(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const P = await loadPair(tx, db, d, who.uid), { A, B, aid, to } = P, now = Date.now();
    const r = relOf(A, to, now), q = relOf(B, aid, now);
    if ((r && r.k === 'rival') || (q && q.k === 'rival')) refuse('al_rival', 'The two alliances are rivals. The rivalry must be withdrawn before a pact.');
    if (alRelLive(r, now)) refuse('al_pact_exists', 'The two alliances already have a pact.');
    if (r && r.k === 'pact' && r.st === 'offered') return { ok: true, signed: false };
    if (pactsOf(A, now) >= AL_REL_MAX.pact) refuse('al_pacts', `An alliance holds at most ${AL_REL_MAX.pact} pacts, in force or offered.`);
    /* they had offered one: proposing it is accepting theirs */
    if (r && r.k === 'pact' && r.st === 'asked') { signPact(P, r, who.uid, now); relWrite(tx, P); return { ok: true, signed: true }; }
    if (pactsOf(B, now) >= AL_REL_MAX.pact) refuse('al_pacts_them', `${line(B.name, AL_NAME)} already holds ${AL_REL_MAX.pact} pacts.`);
    A.rel[to] = { k: 'pact', st: 'offered', t: now, by: who.uid }; B.rel[aid] = { k: 'pact', st: 'asked', t: now, by: who.uid };
    logged(A, { k: 'pactoffer', a: who.uid, b: B.name, x: to }); logged(B, { k: 'pactask', a: who.uid, b: A.name, x: aid });
    relWrite(tx, P);
    return { ok: true, signed: false };
  });
}
/* the answer to an offer (yes signs it, no declines it), or the offer taken back (no, from the side that made it) */
async function alPactAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, d.yes ? {} : { linked: false });
    const P = await loadPair(tx, db, d, who.uid), { A, B, aid, to } = P, now = Date.now(), r = relOf(A, to, now);
    if (!r || r.k !== 'pact' || (r.st !== 'asked' && r.st !== 'offered')) refuse('al_no_offer', 'That offer is no longer there.');
    if (d.yes) {
      if (r.st !== 'asked') refuse('al_no_offer', 'Only the other alliance can accept your offer.');
      if (pactsOf(A, now) >= AL_REL_MAX.pact) refuse('al_pacts', `An alliance holds at most ${AL_REL_MAX.pact} pacts, in force or offered.`);
      signPact(P, r, who.uid, now); relWrite(tx, P);
      return { ok: true, signed: true };
    }
    delete A.rel[to]; if (B.rel[aid] && B.rel[aid].k === 'pact') delete B.rel[aid];
    relWrite(tx, P);
    return { ok: true };
  });
}
/* a pact ended with notice (in force until it runs out), or broken at once, which costs the breaker renown */
async function alPactEnd(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const P = await loadPair(tx, db, d, who.uid), { A, B, aid, to } = P, now = Date.now(), r = relOf(A, to, now);
    if (!alRelLive(r, now)) refuse('al_no_pact', 'The two alliances have no pact in force.');
    if (d.now) {
      delete A.rel[to]; if (B.rel[aid] && B.rel[aid].k === 'pact') delete B.rel[aid];
      A.xp = Math.max(0, (A.xp || 0) - AL_XP.pactBreak);
      logged(A, { k: 'pactbrk', a: who.uid, b: B.name, x: to }); logged(B, { k: 'pactbrk', a: who.uid, b: A.name, x: aid });
      relWrite(tx, P);
      return { ok: true, broken: true, xp: AL_XP.pactBreak };
    }
    if (r.st === 'ending') return { ok: true, end: r.end };
    const end = now + AL_REL_NOTICE;
    A.rel[to] = { ...r, st: 'ending', end }; B.rel[aid] = { ...(B.rel[aid] && B.rel[aid].k === 'pact' ? B.rel[aid] : r), st: 'ending', end };
    logged(A, { k: 'pactend', a: who.uid, b: B.name, x: to }); logged(B, { k: 'pactend', a: who.uid, b: A.name, x: aid });
    relWrite(tx, P);
    return { ok: true, end };
  });
}
/* naming another alliance a rival (on), or withdrawing it */
async function alRival(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, d.on ? {} : { linked: false });
    const P = await loadPair(tx, db, d, who.uid), { A, B, aid, to } = P, now = Date.now(), r = relOf(A, to, now), q = relOf(B, aid, now);
    if (d.on) {
      if ((r && r.k === 'pact') || (q && q.k === 'pact')) refuse('al_pact', 'The two alliances have a pact, or one is offered. It must end before they can be rivals.');
      if (r && r.k === 'rival' && r.me) return { ok: true };
      if (rivalsOf(A) >= AL_REL_MAX.rival) refuse('al_rivals', `An alliance names at most ${AL_REL_MAX.rival} rivals.`);
      A.rel[to] = { k: 'rival', me: true, them: !!(r && r.k === 'rival' && r.them), t: now };
      B.rel[aid] = { k: 'rival', me: !!(q && q.k === 'rival' && q.me), them: true, t: now };
      logged(A, { k: 'rival', a: who.uid, b: B.name, x: to }); logged(B, { k: 'rivaled', a: who.uid, b: A.name, x: aid });
    } else {
      if (!r || r.k !== 'rival' || !r.me) return { ok: true };
      if (r.them) A.rel[to] = { ...r, me: false }; else delete A.rel[to];
      if (q && q.k === 'rival') { if (q.me) B.rel[aid] = { ...q, them: false }; else delete B.rel[aid]; }
      logged(A, { k: 'rivalx', a: who.uid, b: B.name, x: to });
    }
    relWrite(tx, P);
    return { ok: true };
  });
}

/* ── an alliance from before: kept in its founder's record (alli {name, t, inv}) with each member's allyOf naming the
   founder, moved here under the founder's id by the founder or any of its members ── */
async function alMigrate(db, who, d) {
  const f = isUid(d.f) ? d.f : '';
  if (!f) throw new HttpsError('invalid-argument', 'Choose an alliance.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const ref = db.doc('alliances/' + f), [have, fs] = await Promise.all([tx.get(ref), tx.get(db.doc('nations/' + f))]);
    if (have.exists) return { ok: true, aid: f };
    const F = nationJSON(fs), al = F.alli;
    if (!fs.exists || !al || typeof al !== 'object' || !line(al.name, AL_NAME)) refuse('al_missing', 'This alliance no longer exists.');
    const reg = F.reg || fs.get('reg') || '', inv = (Array.isArray(al.inv) ? al.inv : []).filter(e => e && typeof e.id === 'string' && Number.isFinite(e.t)).slice(-30);
    const players = inv.filter(e => isUid(e.id) && e.id !== f), npcs = inv.filter(e => NPC.has(e.id));
    const [ps, pix, nix, fix] = await Promise.all([
      players.length ? tx.getAll(...players.map(e => db.doc('nations/' + e.id))) : [],
      players.length ? tx.getAll(...players.map(e => ix(db, e.id))) : [],
      npcs.length ? tx.getAll(...npcs.map(e => ix(db, e.id))) : [],
      tx.get(ix(db, f))]);
    const now = Date.now(), A = { v: 1, reg, name: line(al.name, AL_NAME), mo: '', em: DEF_EM, col: '#3A8FD1', ty: 'def', acc: 'apply', t: Number(al.t) || now, fd: f, ld: f,
      mem: { [f]: { t: Number(al.t) || now, g: fs.createTime ? fs.createTime.toMillis() : 0 } }, npc: {}, iv: {}, rq: {}, xp: 0, tt: now, tr: {}, dn: {}, pj: {}, log: [] };
    if (fix.exists && fix.get('a') !== f) refuse('al_member', 'The founder belongs to another alliance now.');
    players.forEach((e, i) => {
      const s = ps[i], n = nationJSON(s);
      if (!s.exists || (s.get('reg') || '') !== reg || pix[i].exists) return;
      if (n.allyOf === f && e.t > (Number(n.alLeft) || 0)) A.mem[e.id] = { t: e.t, g: s.createTime.toMillis() };
      else if (!(Number(n.alLeft) > e.t)) A.iv[e.id] = e.t;
    });
    npcs.forEach((e, i) => { if (!nix[i].exists && NPC.get(e.id).reg === reg && !BLOC.has(e.id) && npcAffinity(e.id, F) >= AL_ALLY_MIN - 10 && !warWithNpc(F, e.id)) A.npc[e.id] = e.t; });
    /* a head start in renown for the time it has stood: 5 a day, at most 500 */
    A.xp = Math.min(500, Math.floor(Math.max(0, now - A.t) / DAY) * 5);
    logged(A, { k: 'found', a: f, b: nameOf(fs), x: A.name });
    tx.create(ref, A);
    for (const id of Object.keys(A.mem)) tx.set(ix(db, id), { a: f, reg, t: now });
    for (const id of Object.keys(A.npc)) tx.set(ix(db, id), { a: f, reg, t: now, npc: true });
    return { ok: true, aid: f };
  });
}

/* a nation that is deleted (its account, or by an admin) leaves its alliance; called outside any other transaction */
export async function alDrop(db, uid) {
  try {
    const s = await db.doc('allyOf/' + uid).get();
    if (!s.exists) return;
    const aid = s.get('a');
    let gone = '';
    await db.runTransaction(async tx => {
      const ref = db.doc('alliances/' + aid), a = await tx.get(ref);
      if (!a.exists) { tx.delete(ix(db, uid)); return; }
      const A = a.data(); A.mem = A.mem || {};
      if (!A.mem[uid]) { tx.delete(ix(db, uid)); return; }
      delete A.mem[uid];
      if (!Object.keys(A.mem).length) { A.npc = A.npc || {}; dissolve(tx, db, ref, A); gone = aid; return; }
      tx.delete(ix(db, uid));
      logged(A, { k: 'leave', a: uid, x: 'gone' });
      if (A.ld === uid) { A.ld = successor(A); if (A.mem[A.ld]) delete A.mem[A.ld].r; }
      tx.update(ref, { mem: A.mem, ld: A.ld, log: A.log });
    });
    if (gone) await dropPosts(db, gone);
  } catch (e) { console.warn('alDrop', uid, e && e.message); }
}

const OPS = { alFound, alEdit, alInvite, alUninvite, alRequest, alCancel, alAnswer, alLeave, alRemove, alRole, alDonate, alBuild, alPost, alPostDel, alTally, alMigrate, alPact, alPactAnswer, alPactEnd, alRival };
export const isAllianceOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function alliance(db, who, d) { return OPS[d.op](db, who, d); }
