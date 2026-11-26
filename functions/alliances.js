import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { pushChatMention } from './letters.js';
import { eligibility, refuse, nationJSON, DAY } from './eligibility.js';
/* Settings › Privacy › Who can reach me: a nation that takes none of a kind (rch[k] 'n') is kept to here too */
const closed = (N, k) => !!(N && N.rch && typeof N.rch === 'object' && N.rch[k] === 'n');
import { cabinetAffinity } from './affinity.js';
import { RS_AL_PROJ, RS_AL_SCALE, rsAlNeed, rsAlCost } from './research-rules.js';
import DATA from './civic-data.json' with { type: 'json' };
import { AL_TYPES, AL_ACCESS, AL_RES, AL_PROJECTS, AL_OFFICERS, AL_XP, AL_ALLY_MIN, AL_FOUND_POP, AL_REL_MAX, AL_REL_NOTICE, alLevel, alPlaces, alRelLive,
  AL_TY_PJ, alSeats, AL_SEAT_POP, AL_CLASH, AL_VOTE, AL_TYPE_WAIT, AL_XP_TY, AL_STUDIES, AL_STUDY_DAYS } from './alliance-rules.js';

/* Alliances, written only here (civic ops al*), so that an alliance outlives the nation that founded it.
     alliances/{aid}        {v, reg, name, tg?, mo, em, col, ac?, ar?, ty, acc, t, fd, ld, tyAt, mem, npc, iv, rq, xp, tt, tr, dn, pj, log}
                            tg its short code (2 to 4 capitals or digits, one per region), which the leader sets in
                            the charter; without it the game shows the name's initials
                            ac its second colour (beside col; without it the game takes one from the banner) and ar its
                            coat of arms {s, d, t: [field, second], c, ct} (without it the game draws arms from the
                            banner); the game keeps only the shields, divisions, tinctures and charges it knows
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
                            cl {uid: until} members whose seat of this type another alliance holds (the type changed
                            under them): each leaves one of the two by then, or leaves this one; tv a vote on a new type
                            {ty, t, end, by, y {uid: t}, n {uid: t}}; sd a research accord's study {k, t, end, by}; ct a
                            trade bloc's common tariff (true)
     allyOf/{id}            {v: 2, reg, t, s {ty: aid}, w {ty: [aid]}, a, npc?}: the alliances a nation (or a computer
                            nation) belongs to, one of each type (s, its seats; the referee counts the defence pact's
                            members as allies in war), those waiting for a seat it already holds (w), and the one whose
                            code it wears in chat and on the board (a). A record from before (no v) names one alliance
                            (a), whose type is read from the alliance itself.
     alPace/{uid}           {p}: the times of a member's channel posts in the last hour, server-only
   Alliances founded before this kept their founder's id as their own (alMigrate), so a legacy record's allyOf and the
   referee's allyOf/ agree while a region moves over. Every member of an alliance defends the others; its type adds a
   bonus, and its renown (xp) levels, member places and projects follow functions/alliance-rules.js. */
export const NPC = new Map(DATA.regions.flatMap(r => r.npcs.map(n => [n.id, { ...n, reg: r.id }])));
export function syncNPCTable(){for(const r of DATA.regions)for(const n of r.npcs)if(!NPC.has(n.id))NPC.set(n.id,{...n,reg:r.id});}
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
export const AL_NAME = 40, AL_TAG = 4, AL_MOTTO = 80, AL_NOTE = 200, AL_POST = 1000, AL_GAP = 8000, AL_HOUR = 40;
const AWAY = 7 * DAY, TALLY_EVERY = 20 * 3600000, TALLY_WINDOW = 2 * DAY, PEACE_WAIT = 3 * DAY;
const ROLE = { m: 1, o: 2, ld: 3 };

function emblem(e) {
  if (!e || typeof e !== 'object') return null;
  const c = Array.isArray(e.c) ? e.c.slice(0, 3).map(COL) : [];
  const p = KEY(e.p);
  if (!p || c.length !== 3 || c.some(x => !x)) return null;
  return { p, c, e: KEY(e.e) || 'none', ec: COL(e.ec) || '#F2C230' };
}
/* an alliance's coat of arms: a shield, a division, two tinctures, a charge (or none) and its tincture, each a key the
   game knows (it shows the banner's arms in place of one it does not) */
function armsOf(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const s = KEY(x.s), d = KEY(x.d), t = Array.isArray(x.t) ? x.t.slice(0, 2).map(KEY) : [], c = x.c === '' || x.c == null ? '' : KEY(x.c) || null, ct = KEY(x.ct);
  if (!s || !d || t.length !== 2 || t.some(v => !v) || c === null || !ct) return null;
  return { s, d, t, c, ct };
}
/* the short code as given: capitals and digits only, 2 to 4 of them, or '' for none (the initials) */
function tagOf(x) {
  const t = typeof x === 'string' ? x.trim().toUpperCase() : '';
  if (t && !new RegExp('^[A-Z0-9]{2,' + AL_TAG + '}$').test(t)) throw new HttpsError('invalid-argument', 'A short code is 2 to 4 letters (A to Z) or numbers.');
  return t;
}
const tagTaken = (same, tg, aid) => !!tg && same.docs.some(s => s.id !== aid && s.get('tg') === tg);
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
/* ── seats: the alliances a nation belongs to, one of each type (allyOf/{id}), each checked against the alliance it
   names. Read for several nations at once (two reads in all: their entries, then every alliance they name), and kept
   as {id, ref, had, s {ty: aid}, w {ty: [aid]}, a, npc, reg, docs}: docs holds the alliances read, shared by all of them,
   so that a change to one (a member leaving a clash) is written once with every other. ── */
const ix = (db, id) => db.doc('allyOf/' + id);
const seatTy = ty => AL_TYPES.includes(ty) ? ty : 'def';
const TY_WORD = { def: 'defence pact', trade: 'trade bloc', culture: 'cultural union', research: 'research accord' };
const held = S => [...AL_TYPES.map(t => S.s[t]).filter(Boolean), ...AL_TYPES.flatMap(t => S.w[t] || [])];
async function seatsMany(tx, db, ids, docs = new Map()) {
  ids = [...new Set(ids)];
  const snaps = ids.length ? await tx.getAll(...ids.map(id => ix(db, id))) : [];
  const want = snaps.map(s => {
    const raw = s.exists ? s.data() : null, out = [];
    if (raw && raw.v === 2) for (const ty of AL_TYPES) {
      if (raw.s && isAid(raw.s[ty])) out.push([raw.s[ty], 0]);
      for (const aid of raw.w && Array.isArray(raw.w[ty]) ? raw.w[ty] : []) if (isAid(aid)) out.push([aid, 1]);
    } else if (raw && isAid(raw.a)) out.push([raw.a, 0]);
    return { raw, out };
  });
  const need = [...new Set(want.flatMap(x => x.out.map(o => o[0])))].filter(aid => !docs.has(aid));
  if (need.length) (await tx.getAll(...need.map(aid => db.doc('alliances/' + aid)))).forEach((s, i) => docs.set(need[i], s.exists ? s.data() : null));
  return ids.map((id, i) => {
    const { raw, out } = want[i], snap = snaps[i];
    const S = { id, ref: snap.ref, had: snap.exists, s: {}, w: {}, a: '', npc: !!(raw && raw.npc), reg: (raw && raw.reg) || '', docs, old: !!raw && raw.v !== 2 };
    for (const [aid, wait] of out) {
      const A = docs.get(aid);
      if (!A || !((A.mem && A.mem[id]) || (A.npc && A.npc[id]))) { S.old = true; continue; }
      /* the alliance's type now: an entry from before names one alliance, and a type can move under an entry */
      const ty = seatTy(A.ty);
      if (!wait && !S.s[ty]) S.s[ty] = aid;
      else if (S.s[ty] !== aid && !(S.w[ty] || []).includes(aid)) (S.w[ty] = S.w[ty] || []).push(aid);
    }
    /* a seat left free goes to the first alliance waiting for it */
    for (const ty of AL_TYPES) if (!S.s[ty] && S.w[ty] && S.w[ty].length) { S.s[ty] = S.w[ty].shift(); S.old = true; }
    const all = held(S);
    S.a = raw && isAid(raw.a) && all.includes(raw.a) ? raw.a : S.s.def || all[0] || '';
    return S;
  });
}
async function seats(tx, db, id, docs) { return (await seatsMany(tx, db, [id], docs))[0]; }
function putSeats(tx, S, reg, now) {
  const all = held(S);
  if (!all.length) { if (S.had) tx.delete(S.ref); S.had = false; return; }
  if (!all.includes(S.a)) S.a = S.s.def || all[0];
  const s = {}, w = {};
  for (const t of AL_TYPES) { if (S.s[t]) s[t] = S.s[t]; if (S.w[t] && S.w[t].length) w[t] = S.w[t].slice(); }
  tx.set(S.ref, { v: 2, reg: reg || S.reg, t: now, s, w, a: S.a, ...(S.npc ? { npc: true } : {}) });
  S.had = true;
}
/* a nation's place in alliance aid given up: its seat, or its place waiting for one; a seat left free goes to the next
   alliance waiting for it, whose list of clashes forgets the nation */
function unseat(tx, db, S, aid) {
  for (const t of AL_TYPES) {
    if (S.w[t]) S.w[t] = S.w[t].filter(x => x !== aid);
    if (S.s[t] !== aid) continue;
    delete S.s[t];
    if (S.w[t] && S.w[t].length) {
      const y = S.w[t].shift(), Y = S.docs.get(y);
      S.s[t] = y;
      if (Y && Y.cl && Y.cl[S.id]) { delete Y.cl[S.id]; tx.update(db.doc('alliances/' + y), { cl: Y.cl }); }
    }
  }
}
/* a seat of alliance A's type for nation S: free (or A's own), and within what its people allow (pop, when given) */
function seatFor(S, A, aid, pop, self) {
  const ty = seatTy(A.ty), have = S.s[ty];
  if (have && have !== aid) {
    const B = S.docs.get(have), nm = B ? line(B.name, AL_NAME) : 'another';
    refuse('al_member', `${self ? 'You are' : 'That nation is'} already in a ${TY_WORD[ty]}, ${nm}. A nation belongs to one alliance of each type: ${self ? 'leave it first, or join an alliance of another type' : 'it would have to leave that one first'}.`);
  }
  if (pop != null && held(S).filter(x => x !== aid).length >= alSeats(pop)) {
    const next = AL_SEAT_POP[alSeats(pop)];
    refuse('al_seats', `${self ? 'Your nation is' : 'That nation is'} in as many alliances as ${self ? 'its' : 'its'} people allow. ${next ? `Another opens at ${next} million people.` : ''}`.trim());
  }
}
function join(tx, db, aid, A, S, nm, now, how, g) {
  const id = S.id;
  A.mem[id] = { t: now, ...(Number.isFinite(g) ? { g } : {}) }; delete A.iv[id]; delete A.rq[id];
  A.xp = (A.xp || 0) + AL_XP.join;
  logged(A, { k: how || 'join', a: id, b: nm });
  S.s[seatTy(A.ty)] = aid; if (!S.a) S.a = aid;
  putSeats(tx, S, A.reg, now);
}
/* who leads next: the longest-serving officer, then the longest-serving member; given a test, the first who passes it */
function successor(A, ok) {
  const list = Object.entries(A.mem).filter(([id]) => id !== A.ld).sort((a, b) => (b[1].r === 'o') - (a[1].r === 'o') || a[1].t - b[1].t).map(([id]) => id);
  return (ok ? list.find(ok) : null) || (ok ? null : list[0]) || null;
}
/* every member goes, each keeping its seats in other alliances (list: their seats, read before any write); the
   channel's posts are deleted after the transaction (dropPosts) */
const everyone = A => [...Object.keys(A.mem || {}), ...Object.keys(A.npc || {})];
function dissolve(tx, db, ref, A, list) {
  const aid = ref.id, now = Date.now();
  for (const S of list) { unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now); }
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
  const name = line(d.name, AL_NAME), mo = line(d.mo, AL_MOTTO), em = emblem(d.em) || DEF_EM, col = COL(d.col) || '#3A8FD1', ac = COL(d.ac);
  const ty = AL_TYPES.includes(d.ty) ? d.ty : 'def', acc = AL_ACCESS.includes(d.acc) ? d.acc : 'apply', tg = tagOf(d.tg);
  if (name.length < 3) throw new HttpsError('invalid-argument', 'Give the alliance a name of at least three characters.');
  let aid = '';
  await db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e);
    if ((Number(e.saved.get('pop')) || 0) < AL_FOUND_POP - 1e-6) refuse('al_small', `Founding an alliance unlocks at ${AL_FOUND_POP} million people. You can still join one.`);
    const [S, same] = await Promise.all([seats(tx, db, who.uid), tx.get(db.collection('alliances').where('reg', '==', reg))]);
    seatFor(S, { ty }, '', Number(e.saved.get('pop')) || 0, true);
    if (same.docs.some(s => fold(s.get('name')) === fold(name))) refuse('al_name', 'Another alliance in this region already has that name.');
    if (tagTaken(same, tg, '')) refuse('al_tag', 'Another alliance in this region already uses that short code.');
    const now = Date.now(), ref = db.collection('alliances').doc(); aid = ref.id;
    const A = { v: 1, reg, name, ...(tg ? { tg } : {}), mo, em, col, ...(ac ? { ac } : {}), ty, acc, t: now, fd: who.uid, ld: who.uid, mem: { [who.uid]: { t: now, g: e.generation } }, npc: {}, iv: {}, rq: {}, xp: 0, tt: now, tr: {}, dn: {}, pj: {}, log: [] };
    logged(A, { k: 'found', a: who.uid, b: nameOf(e.saved), x: name });
    tx.create(ref, A);
    S.s[ty] = aid; if (!S.a) S.a = aid;
    putSeats(tx, S, reg, now);
  });
  return { ok: true, aid };
}
async function alEdit(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d);need(A, who.uid, 'ld');
    const ch = {}, now = Date.now();
    /* the region's alliances, read once, when a new name or short code must be its own */
    let regionDocs = null;
    const region = async () => regionDocs || (regionDocs = await tx.get(db.collection('alliances').where('reg', '==', A.reg)));
    if (d.name !== undefined) {
      const name = line(d.name, AL_NAME);
      if (name.length < 3) throw new HttpsError('invalid-argument', 'Give the alliance a name of at least three characters.');
      if (fold(name) !== fold(A.name)) {
        const same = await region();
        if (same.docs.some(s => s.id !== ref.id && fold(s.get('name')) === fold(name))) refuse('al_name', 'Another alliance in this region already has that name.');
      }
      ch.name = name;
    }
    if (d.tg !== undefined) {
      const tg = tagOf(d.tg);
      if (tg !== (A.tg || '') && tagTaken(await region(), tg, ref.id)) refuse('al_tag', 'Another alliance in this region already uses that short code.');
      ch.tg = tg;
    }
    if (d.mo !== undefined) ch.mo = line(d.mo, AL_MOTTO);
    if (d.em !== undefined) { const em = emblem(d.em); if (!em) throw new HttpsError('invalid-argument', 'That banner cannot be used.'); ch.em = em; }
    if (d.col !== undefined) { const c = COL(d.col); if (!c) throw new HttpsError('invalid-argument', 'Choose a colour.'); ch.col = c; }
    /* the second colour ('' goes back to the banner's), and the coat of arms (null goes back to the banner's) */
    if (d.ac !== undefined) { const c = d.ac === '' ? '' : COL(d.ac); if (c === '' && d.ac !== '') throw new HttpsError('invalid-argument', 'Choose a second colour.'); ch.ac = c; }
    if (d.ar !== undefined) { const ar = d.ar === null ? null : armsOf(d.ar); if (ar === null && d.ar !== null) throw new HttpsError('invalid-argument', 'Those arms cannot be used.'); ch.ar = ar; }
    if (d.acc !== undefined) { if (!AL_ACCESS.includes(d.acc)) throw new HttpsError('invalid-argument', 'Choose who may join.'); ch.acc = d.acc; }
    /* a trade bloc's common tariff on goods from outside it */
    if (d.ct !== undefined) {
      if (seatTy(A.ty) !== 'trade') refuse('al_not_trade', 'Only a trade bloc sets a common tariff.');
      ch.ct = !!d.ct;
    }
    /* a new type: at once in an alliance of one player, otherwise put to the members' vote */
    let want = '';
    if (d.ty !== undefined && d.ty !== A.ty) {
      if (!AL_TYPES.includes(d.ty)) throw new HttpsError('invalid-argument', 'Choose a type of alliance.');
      if (A.tyAt && now - A.tyAt < AL_TYPE_WAIT) refuse('al_type_wait', 'The alliance changed its type in the last 7 days. It can change again ' + new Date(A.tyAt + AL_TYPE_WAIT).toISOString().slice(0, 10) + '.');
      if (A.tv && typeof A.tv === 'object' && now < (Number(A.tv.end) || 0)) refuse('al_vote_open', 'The members are already voting on a new type.');
      want = d.ty;
    }
    if (!Object.keys(ch).length && !want) return { ok: true };
    const list = want && Object.keys(A.mem).length <= 1 ? await seatsMany(tx, db, everyone(A)) : null;
    Object.assign(A, ch);
    if (Object.keys(ch).length) logged(A, { k: 'edit', a: who.uid, x: '' });
    let out = { ok: true };
    if (list) {
      const clash = applyType(tx, db, ref.id, A, want, list, who.uid, now);
      Object.assign(ch, { ty: A.ty, tyAt: A.tyAt, cl: A.cl, npc: A.npc, tv: null });
      out = { ok: true, ty: A.ty, clash };
    } else if (want) {
      ch.tv = A.tv = { ty: want, t: now, end: now + AL_VOTE, by: who.uid, y: { [who.uid]: now }, n: {} };
      logged(A, { k: 'vote', a: who.uid, x: want });
      out = { ok: true, vote: true };
    }
    tx.update(ref, { ...ch, log: A.log });
    return out;
  });
}
/* the alliance takes type ty (list: every member's seats, read before any write). Each member's seat moves with it; a
   member that already holds a seat of that type in another alliance keeps it there and waits here (cl) for a week,
   to leave one of the two; a computer nation in that case leaves this one at once. */
function applyType(tx, db, aid, A, ty, list, uid, now) {
  A.cl = A.cl && typeof A.cl === 'object' ? A.cl : {}; A.npc = A.npc || {};
  let clash = 0;
  for (const S of list) {
    unseat(tx, db, S, aid);
    if (S.s[ty] && S.s[ty] !== aid) {
      if (A.npc[S.id]) { delete A.npc[S.id]; logged(A, { k: 'npcleft', a: S.id, b: NPC.get(S.id)?.name || S.id, x: 'type' }); }
      else if (A.mem[S.id]) { (S.w[ty] = S.w[ty] || []).push(aid); A.cl[S.id] = now + AL_CLASH; clash++; }
    } else if (A.mem[S.id] || A.npc[S.id]) { S.s[ty] = aid; delete A.cl[S.id]; }
    putSeats(tx, S, A.reg, now);
  }
  A.ty = ty; A.tyAt = now; A.tv = null;
  logged(A, { k: 'type', a: uid, x: ty, ...(clash ? { b: String(clash) } : {}) });
  return clash;
}
/* a vote on a new type: passed once more than half the members say yes, lost once half say no, and otherwise decided
   when it closes by the votes cast ('' while it runs) */
function voteOutcome(A, V, now) {
  const p = Object.keys(A.mem).length, c = o => Object.keys(o && typeof o === 'object' ? o : {}).filter(id => A.mem[id]).length, y = c(V.y), n = c(V.n);
  if (2 * y > p) return 'pass';
  if (2 * n >= p) return 'fail';
  if (now >= (Number(V.end) || 0)) return y > n ? 'pass' : 'fail';
  return '';
}
async function alVote(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d); const r = need(A, who.uid, 'm');
    const now = Date.now(), V = A.tv && typeof A.tv === 'object' ? A.tv : null;
    if (!V || !AL_TYPES.includes(V.ty)) refuse('al_no_vote', 'The members are not voting on a new type.');
    if (d.cancel) {
      if (r !== 'ld') throw new HttpsError('permission-denied', 'Only the alliance’s leader can call off the vote.');
      logged(A, { k: 'votex', a: who.uid, x: V.ty }); tx.update(ref, { tv: null, log: A.log });
      return { ok: true, cancelled: true };
    }
    V.y = V.y && typeof V.y === 'object' ? V.y : {}; V.n = V.n && typeof V.n === 'object' ? V.n : {};
    if (typeof d.yes === 'boolean' && now < (Number(V.end) || 0)) { delete V.y[who.uid]; delete V.n[who.uid]; (d.yes ? V.y : V.n)[who.uid] = now; }
    const out = voteOutcome(A, V, now);
    if (out === 'pass') {
      const list = await seatsMany(tx, db, everyone(A));
      const clash = applyType(tx, db, aid, A, V.ty, list, V.by || who.uid, now);
      tx.update(ref, { ty: A.ty, tyAt: A.tyAt, cl: A.cl, npc: A.npc, tv: null, log: A.log });
      return { ok: true, passed: true, ty: A.ty, clash };
    }
    if (out === 'fail') { logged(A, { k: 'votefail', a: who.uid, x: V.ty }); tx.update(ref, { tv: null, log: A.log }); return { ok: true, failed: true }; }
    tx.update(ref, { tv: V });
    return { ok: true };
  });
}
/* the code a member wears beside its name in chat and on the board: one of its alliances, or its first */
async function alWear(db, who, d) {
  const aid = isAid(d.aid) ? d.aid : '';
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const S = await seats(tx, db, who.uid);
    if (aid && !held(S).includes(aid)) refuse('al_no_member', 'You are not a member of that alliance.');
    if (!held(S).length) return { ok: true };
    S.a = aid || S.s.def || held(S)[0];
    putSeats(tx, S, S.reg, Date.now());
    return { ok: true, a: S.a };
  });
}
/* a research accord's joint study: chosen by its leader or an officer, paid from the treasury, one at a time */
async function alStudy(db, who, d) {
  const St = AL_STUDIES[d.k];
  if (!St) throw new HttpsError('invalid-argument', 'Choose a study.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d); need(A, who.uid, 'o');
    if (seatTy(A.ty) !== 'research') refuse('al_not_research', 'Only a research accord runs joint studies.');
    const now = Date.now();
    if (A.sd && typeof A.sd === 'object' && now < (Number(A.sd.end) || 0)) refuse('al_study_on', 'A study is already under way. It ends ' + new Date(A.sd.end).toISOString().slice(0, 10) + '.');
    const short = AL_RES.filter(k => (Number(A.tr[k]) || 0) + 1e-9 < (St.cost[k] || 0));
    if (short.length) refuse('al_treasury', 'The treasury is short of ' + short.map(k => Math.ceil((St.cost[k] || 0) - (Number(A.tr[k]) || 0)) + ' ' + k).join(', ') + '.');
    for (const k of AL_RES) if (St.cost[k]) A.tr[k] = Math.round(((Number(A.tr[k]) || 0) - St.cost[k]) * 100) / 100;
    const days = AL_STUDY_DAYS + 2 * clamp(Number(A.pj.observatory) || 0, 0, AL_PROJECTS.observatory.max);
    A.sd = { k: d.k, t: now, end: now + days * DAY, by: who.uid };
    A.xp = (A.xp || 0) + AL_XP.study;
    logged(A, { k: 'study', a: who.uid, x: d.k });
    tx.update(ref, { tr: A.tr, sd: A.sd, xp: A.xp, log: A.log });
    return { ok: true, end: A.sd.end };
  });
}

/* ── national research (functions/research-rules.js): an alliance's research project, one at a time. Its leader or an
   officer begins one of the alliance's type (k 'p', or 'g' its Grand Challenge from alliance level 4), paid from the
   treasury; members give Research Credits by pledging them in their own record (nrp.ap [{t, a, q}], spent there, and
   held by the save permit), and alRsGive credits the pledges the saved record holds that are newer than the last one
   credited, at most a member's cap. Once the credits are gathered the members who gave have its discount for its days. */
const rpOf = A => A.rp && typeof A.rp === 'object' && !Array.isArray(A.rp) ? A.rp : null;
async function alRsStart(db, who, d) {
  const k = d.k === 'g' ? 'g' : 'p';
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, A } = await load(tx, db, d); need(A, who.uid, 'o');
    const ty = seatTy(A.ty), P = RS_AL_PROJ[ty], S = RS_AL_SCALE[k], now = Date.now(), cur = rpOf(A);
    if (!P) refuse('al_rs_type', 'This alliance has no research project of its type.');
    if (alLevel(A.xp) < S.lv) refuse('al_rs_level', 'Its Grand Challenge needs alliance level ' + S.lv + '.');
    if (cur && (!cur.done || now < (Number(cur.end) || 0))) refuse('al_rs_on', cur.done ? 'The last project’s discount still runs.' : 'A research project is already under way.');
    const cost = rsAlCost(ty, k), short = AL_RES.filter(r => (Number(A.tr[r]) || 0) + 1e-9 < (cost[r] || 0));
    if (short.length) refuse('al_treasury', 'The treasury is short of ' + short.map(r => Math.ceil((cost[r] || 0) - (Number(A.tr[r]) || 0)) + ' ' + r).join(', ') + '.');
    for (const r of AL_RES) if (cost[r]) A.tr[r] = Math.round(((Number(A.tr[r]) || 0) - cost[r]) * 100) / 100;
    const members = Object.keys(A.mem).length;
    A.rp = { k, ty, t: now, by: who.uid, need: rsAlNeed(k, members), got: 0, c: {}, w: {}, done: 0, end: 0 };
    logged(A, { k: 'rsproj', a: who.uid, x: P[k].n });
    tx.update(ref, { tr: A.tr, rp: A.rp, log: A.log });
    return { ok: true, need: A.rp.need };
  });
}
async function alRsGive(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d); need(A, who.uid, 'm');
    const R = rpOf(A), now = Date.now();
    if (!R || R.done) return { ok: true, credited: 0 };
    const S = RS_AL_SCALE[R.k === 'g' ? 'g' : 'p'], w = { ...(R.w || {}) }, c = { ...(R.c || {}) }, lt = Number(w[who.uid]) || 0;
    let top = lt, add = 0;
    const ap = e.n && e.n.nrp && Array.isArray(e.n.nrp.ap) ? e.n.nrp.ap : [];
    for (const p of ap) {
      if (!p || p.a !== aid || !Number.isFinite(p.t) || p.t <= lt || p.t > now + 60000) continue;
      add += Math.max(0, Math.min(1000, Number(p.q) || 0)); top = Math.max(top, p.t);
    }
    const room = Math.max(0, S.cap - (Number(c[who.uid]) || 0)), q = Math.round(Math.min(add, room, Math.max(0, R.need - (Number(R.got) || 0))) * 100) / 100;
    w[who.uid] = top;
    if (q > 0) c[who.uid] = Math.round(((Number(c[who.uid]) || 0) + q) * 100) / 100;
    const got = Math.round(((Number(R.got) || 0) + q) * 100) / 100, fin = got + 1e-6 >= R.need;
    A.rp = { ...R, w, c, got, ...(fin ? { done: now, end: now + S.days * DAY } : {}) };
    if (fin) { A.xp = (A.xp || 0) + S.xp; logged(A, { k: 'rsdone', a: who.uid, x: (RS_AL_PROJ[R.ty] || {})[R.k] ? RS_AL_PROJ[R.ty][R.k].n : '' }); }
    tx.update(ref, { rp: A.rp, ...(fin ? { xp: A.xp, log: A.log } : {}) });
    return { ok: true, credited: q, done: fin };
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
      if (id === 'npc-cloudspine-haalesh') {
        const story = await tx.get(db.doc('assemblyRegions/cloudspine')), h = story.get('haalesh');
        if (h?.v === 1 && Number.isFinite(h.t) && now >= h.t) refuse('al_bloc', 'Haalesh belongs to The Pact of Eternal Snows.');
      }
      const [S, leader] = await Promise.all([seats(tx, db, id), tx.get(db.doc('nations/' + A.ld))]);
      const L = nationJSON(leader), ty = seatTy(A.ty), have = S.s[ty];
      if (held(S).includes(aid)) return { ok: true };
      if (have) {
        /* a computer nation whose values have drifted from its alliance's leader has left it in every game, so it is free */
        const OA = S.docs.get(have), ol = await tx.get(db.doc('nations/' + OA.ld));
        if (npcAffinity(id, nationJSON(ol)) >= AL_ALLY_MIN - 10) refuse('al_taken', `That computer nation is already in another ${TY_WORD[ty]}.`);
        const nn = { ...OA.npc }; delete nn[id];
        tx.update(db.doc('alliances/' + have), { npc: nn });
        unseat(tx, db, S, have);
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
      S.npc = true; S.s[ty] = aid; putSeats(tx, S, A.reg, now);
      return { ok: true, joined: true };
    }
    if (!isUid(id) || id === who.uid) throw new HttpsError('invalid-argument', 'Choose a nation to invite.');
    const [target, S] = await Promise.all([tx.get(db.doc('nations/' + id)), seats(tx, db, id)]);
    if (!target.exists || (target.get('reg') || '') !== A.reg) refuse('al_region', 'That nation is not in this region.');
    if (closed(nationJSON(target), 'a')) refuse('al_closed', 'That nation takes no alliance invitations.');
    if (held(S).includes(aid)) refuse('al_taken', 'That nation is already a member.');
    if (S.s[seatTy(A.ty)]) refuse('al_taken', `That nation is already in another ${TY_WORD[seatTy(A.ty)]}.`);
    if (A.rq[id]) {
      roomFor(A);
      seatFor(S, A, aid, Number(target.get('pop')) || 0, false);
      join(tx, db, aid, A, S, nameOf(target), now, 'admit', target.createTime.toMillis());
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
    const S = await seats(tx, db, who.uid);
    if (held(S).includes(aid)) refuse('al_member', 'You are already a member.');
    seatFor(S, A, aid, Number(e.saved.get('pop')) || 0, true);
    const now = Date.now();
    if (A.iv[who.uid] || A.acc === 'open') {
      roomFor(A);
      join(tx, db, aid, A, S, nameOf(e.saved), now, '', e.generation);
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
    const [target, S] = await Promise.all([tx.get(db.doc('nations/' + id)), seats(tx, db, id)]);
    const ty = seatTy(A.ty), full = held(S).filter(x => x !== aid).length >= alSeats(Number(target.get('pop')) || 0);
    if (!target.exists || (target.get('reg') || '') !== A.reg || (S.s[ty] && S.s[ty] !== aid) || full) {
      delete A.rq[id]; tx.update(ref, { rq: A.rq });
      return { ok: false, why: target.exists && full && !(S.s[ty] && S.s[ty] !== aid) ? 'seats' : 'gone' };
    }
    roomFor(A);
    join(tx, db, aid, A, S, nameOf(target), Date.now(), 'admit', target.createTime.toMillis());
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
    const wasLeader = A.ld === who.uid, now = Date.now();
    delete A.mem[who.uid]; if (A.cl && typeof A.cl === 'object') delete A.cl[who.uid];
    const S = await seats(tx, db, who.uid);
    if (!Object.keys(A.mem).length || d.disband && wasLeader) {
      const list = await seatsMany(tx, db, everyone(A), S.docs);
      unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
      dissolve(tx, db, ref, A, list); gone = aid; return { ok: true, dissolved: true };
    }
    unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
    logged(A, { k: 'leave', a: who.uid, b: nameOf(e.saved) });
    if (wasLeader) { A.ld = successor(A); if (A.mem[A.ld]) delete A.mem[A.ld].r; logged(A, { k: 'leader', a: A.ld, x: 'left' }); }
    tx.update(ref, { mem: A.mem, ld: A.ld, log: A.log, ...(A.cl && typeof A.cl === 'object' ? { cl: A.cl } : {}) });
    return { ok: true };
  });
  if (gone) await dropPosts(db, gone);
  return r;
}
async function alRemove(db, who, d) {
  const id = typeof d.id === 'string' ? d.id : '';
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { aid, ref, A } = await load(tx, db, d);const me = need(A, who.uid, 'o');
    const now = Date.now();
    if (A.npc[id]) {
      const S = await seats(tx, db, id);
      delete A.npc[id]; unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
      logged(A, { k: 'remove', a: id, b: NPC.get(id)?.name || id, x: who.uid }); tx.update(ref, { npc: A.npc, log: A.log }); return { ok: true };
    }
    if (!A.mem[id] || id === who.uid) refuse('al_no_member', 'That nation is not a member.');
    if (me !== 'ld' && roleOf(A, id) !== 'm') throw new HttpsError('permission-denied', 'Only the leader can remove an officer.');
    const [s, S] = await Promise.all([tx.get(db.doc('nations/' + id)), seats(tx, db, id)]);
    delete A.mem[id]; if (A.cl && typeof A.cl === 'object') delete A.cl[id];
    unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
    logged(A, { k: 'remove', a: id, b: nameOf(s), x: who.uid });
    tx.update(ref, { mem: A.mem, log: A.log, ...(A.cl && typeof A.cl === 'object' ? { cl: A.cl } : {}) });
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
    if (AL_TY_PJ[d.p] && AL_TY_PJ[d.p] !== seatTy(A.ty)) refuse('al_pj_type', `That project belongs to a ${TY_WORD[AL_TY_PJ[d.p]]}.`);
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
  let tell = [], channel = '';
  const result = await db.runTransaction(async tx => {
    const e = await eligibility(tx, who);
    const { aid, A } = await load(tx, db, d);need(A, who.uid, 'm');
    channel = aid;
    const asked = [...new Set(Array.isArray(d.mn) ? d.mn.filter(u => isUid(u) && u !== who.uid && A.mem[u]) : [])].slice(0, 5);
    const got = asked.length ? await tx.getAll(...asked.flatMap(u => [db.doc('nations/' + u), db.doc('lblock/' + u + '~' + who.uid)])) : [];
    const mn = {};
    asked.forEach((u, i) => { const n = got[2*i], nm = n.exists ? line(n.get('name'), 80) : ''; if (nm && !got[2*i+1].exists) { const low = x.toLowerCase(), at = '@' + nm.toLowerCase(); let j = low.indexOf(at); while (j >= 0) { const next = low.charAt(j + at.length); if (!next || !/[\p{L}\p{N}]/u.test(next)) { mn[u] = nm; break; } j = low.indexOf(at, j + 1); } } });
    const pace = db.doc('alPace/' + who.uid), ps = await tx.get(pace), now = Date.now();
    const p = (ps.exists && Array.isArray(ps.get('p')) ? ps.get('p') : []).filter(t => typeof t === 'number' && t <= now && now - t < 3600000);
    const wait = Math.max(p.length ? Math.max(...p) + AL_GAP - now : 0, p.length >= AL_HOUR ? Math.min(...p.slice(-AL_HOUR)) + 3600000 - now : 0);
    if (wait > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(wait / 1000)} seconds.`, { code: 'al_paced', wait });
    const ref = db.collection('alliances/' + aid + '/chat').doc();
    tx.set(pace, { p: p.concat(now).slice(-AL_HOUR) });
    const me = nameOf(e.saved);
    tx.create(ref, { a: who.uid, nm: me, x, t: now, ...(Object.keys(mn).length ? { mn } : {}) });
    for (const u of Object.keys(mn)) tx.create(db.collection('mentions/' + u + '/m').doc(), { k: 'allianceChat', by: who.uid, nm: me, aid, rc: ref.id, x: line(x, 160), t: now });
    tell = Object.keys(mn).map(u => ({ u, me }));
    return { ok: true, id: ref.id };
  });
  await Promise.all(tell.map(t => pushChatMention(db, t.u, who.uid, t.me, false, 'alliance/' + channel).catch(() => 0)));
  return result;
}
const AL_REACT = ['hear', 'ha', 'bravo', 'shame', 'fire', 'love', 'wow', 'hmm'];
async function alReact(db, who, d) {
  const id = typeof d.id === 'string' && /^[A-Za-z0-9]{20}$/.test(d.id) ? d.id : '';
  if (!id || !AL_REACT.includes(d.k)) throw new HttpsError('invalid-argument', 'Choose a line and a reaction.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const { aid, A } = await load(tx, db, d); need(A, who.uid, 'm');
    const ref = db.doc('alliances/' + aid + '/chat/' + id), s = await tx.get(ref);
    if (!s.exists) refuse('al_gone', 'That line is no longer in the channel.');
    const rv = s.get('rv') && typeof s.get('rv') === 'object' ? s.get('rv') : {}, had = rv[who.uid] || '', pick = had === d.k ? '' : d.k;
    if (pick && !had && Object.keys(rv).length >= 300) refuse('al_full', 'This line has all the reactions it can hold.');
    tx.update(ref, new FieldPath('rv', who.uid), pick || FieldValue.delete());
    const own = db.doc('alReactions/' + who.uid + '/items/' + id);
    if (pick) tx.set(own, { aid }); else tx.delete(own);
    return { ok: true, k: pick };
  });
}
/* The per-player index lets account deletion remove reactions even after leaving an alliance. */
export async function alForgetReactions(db, uid) {
  const rows = await db.collection('alReactions/' + uid + '/items').get();
  if (rows.empty) return;
  const lines = await Promise.all(rows.docs.map(row => { const aid = row.get('aid'); return isAid(aid) ? db.doc('alliances/' + aid + '/chat/' + row.id).get() : null; }));
  const w = db.bulkWriter(), writes = [];
  rows.docs.forEach((row, i) => { if (lines[i] && lines[i].exists) writes.push(w.update(lines[i].ref, new FieldPath('rv', uid), FieldValue.delete())); writes.push(w.delete(row.ref)); });
  await Promise.all([Promise.all(writes), w.close()]);
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
    /* every member's seats, read before any write: members who are gone, computer nations that walk out and members
       still holding the same type elsewhere a week after the type changed give theirs up here */
    const list = await seatsMany(tx, db, everyone(A)), byId = new Map(list.map(S => [S.id, S]));
    const out = id => { const S = byId.get(id); if (S) { unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now); byId.delete(id); } };
    const w0 = Math.max(A.tt || A.t || 0, now - TALLY_WINDOW), inWin = t => Number.isFinite(t) && t > w0 && t <= now;
    const mem = new Set(recs.keys()), all = new Set([...mem, ...Object.keys(A.npc)]);
    /* each type counts its own kind of shared activity this many times over (AL_XP_TY) */
    const M = AL_XP_TY[seatTy(A.ty)] || {}, m = k => M[k] || 1;
    let xp = 0;
    const parts = { active: 0, deals: 0, gifts: 0, battles: 0, calls: 0 };
    for (const [id, n] of recs) {
      if (inWin(at.get(id)) || now - at.get(id) < DAY) { xp += AL_XP.active * m('active'); parts.active++; }
      for (const x of Array.isArray(n.deals) ? n.deals : []) {
        if (!x || x.a || !mem.has(x.w)) continue;
        const pd = recs.get(x.w);
        if (pd && (pd.deals || []).some(y => y && y.id === x.id && y.a && y.w === id)) { xp += AL_XP.deal * m('deal'); parts.deals++; }
      }
      const g = (Array.isArray(n.gft) ? n.gft : []).filter(x => x && all.has(x.to) && x.to !== id && inWin(x.t)).length;
      const b = (Array.isArray(n.conq) ? n.conq : []).filter(x => x && all.has(x.w) && inWin(x.t)).length;
      const c = (Array.isArray(n.cta) ? n.cta : []).filter(x => x && all.has(x.w) && inWin(x.t)).length;
      xp += Math.min(g, AL_XP.giftCap) * AL_XP.gift * m('gift') + Math.min(b, AL_XP.battleCap) * AL_XP.battle * m('battle') + Math.min(c, AL_XP.callCap) * AL_XP.call * m('call');
      parts.gifts += g; parts.battles += b; parts.calls += c;
      const rb = foes.size ? (Array.isArray(n.conq) ? n.conq : []).filter(x => x && foes.has(x.d) && inWin(x.t)).length : 0;
      if (rb) { xp += Math.min(rb, AL_XP.rivalCap) * AL_XP.rival; parts.rival = (parts.rival || 0) + rb; }
    }
    for (const id of ids) if (!recs.has(id)) { delete A.mem[id]; out(id); logged(A, { k: 'leave', a: id, x: 'gone' }); }
    /* a clash: settled once the member holds this alliance's seat (it left the other one), or ended by the member
       leaving this one when the week is up */
    A.cl = A.cl && typeof A.cl === 'object' ? A.cl : {};
    for (const [id, until] of Object.entries(A.cl)) {
      const S = byId.get(id);
      if (!A.mem[id] || !S) { delete A.cl[id]; continue; }
      if (S.s[seatTy(A.ty)] === aid) { delete A.cl[id]; continue; }
      if (now >= (Number(until) || 0)) { delete A.mem[id]; delete A.cl[id]; out(id); logged(A, { k: 'clashleft', a: id, b: (snaps[ids.indexOf(id)] && nameOf(snaps[ids.indexOf(id)])) || '' }); }
    }
    if (!Object.keys(A.mem).length) { dissolve(tx, db, ref, A, [...byId.values()]); return { ok: true, dissolved: true }; }
    if (!A.mem[A.ld] || now - (at.get(A.ld) || 0) > AWAY) {
      const next = successor(A, id => now - (at.get(id) || 0) <= AWAY);
      if (next) { delete A.mem[next].r; logged(A, { k: 'leader', a: next, x: A.mem[A.ld] ? 'away' : 'gone' }); A.ld = next; }
      else if (!A.mem[A.ld]) { A.ld = successor(A); if (A.ld) delete A.mem[A.ld].r; }
    }
    const L = recs.get(A.ld);
    if (L) for (const id of Object.keys(A.npc)) if (npcAffinity(id, L) < AL_ALLY_MIN - 10) { delete A.npc[id]; out(id); logged(A, { k: 'npcleft', a: id, b: NPC.get(id)?.name || id }); }
    /* a vote on the type that has run its two days */
    const V = A.tv && typeof A.tv === 'object' ? A.tv : null;
    let voted = '';
    if (V && AL_TYPES.includes(V.ty) && now >= (Number(V.end) || 0)) {
      voted = voteOutcome(A, V, now);
      if (voted === 'pass') applyType(tx, db, aid, A, V.ty, [...byId.values()], V.by || '', now);
      else { A.tv = null; logged(A, { k: 'votefail', x: V.ty }); }
    }
    /* entries from before: written again in the new shape */
    for (const S of byId.values()) if (S.old) putSeats(tx, S, A.reg, now);
    /* the Hall of Chronicles: a tenth more a level, rounded */
    const chron = Math.round(xp * AL_XP.chron * clamp(Number(A.pj.chronicle) || 0, 0, AL_PROJECTS.chronicle.max));
    if (chron > 0) { xp += chron; parts.chron = chron; }
    A.xp = (A.xp || 0) + xp; A.tt = now;
    if (xp) logged(A, { k: 'tally', x: String(xp), b: JSON.stringify(parts) });
    tx.update(ref, { mem: A.mem, npc: A.npc, ld: A.ld, xp: A.xp, tt: A.tt, log: A.log, cl: A.cl, ...(voted ? { tv: null, ty: A.ty, tyAt: A.tyAt || 0 } : {}) });
    return { ok: true, xp, parts, ...(voted ? { voted } : {}) };
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
    const raw = s.data() || {};
    const aids = raw.v === 2 ? [...AL_TYPES.map(t => raw.s && raw.s[t]), ...AL_TYPES.flatMap(t => raw.w && Array.isArray(raw.w[t]) ? raw.w[t] : [])] : [raw.a];
    for (const aid of [...new Set(aids.filter(isAid))]) {
      let gone = '';
      await db.runTransaction(async tx => {
        const ref = db.doc('alliances/' + aid), a = await tx.get(ref), S = await seats(tx, db, uid), now = Date.now();
        const A = a.exists ? a.data() : null;
        if (!A || !A.mem || !A.mem[uid]) { unseat(tx, db, S, aid); putSeats(tx, S, '', now); return; }
        A.npc = A.npc || {};
        delete A.mem[uid]; if (A.cl && typeof A.cl === 'object') delete A.cl[uid];
        if (!Object.keys(A.mem).length) {
          const list = await seatsMany(tx, db, everyone(A), S.docs);
          unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
          dissolve(tx, db, ref, A, list); gone = aid; return;
        }
        unseat(tx, db, S, aid); putSeats(tx, S, A.reg, now);
        logged(A, { k: 'leave', a: uid, x: 'gone' });
        if (A.ld === uid) { A.ld = successor(A); if (A.mem[A.ld]) delete A.mem[A.ld].r; }
        tx.update(ref, { mem: A.mem, ld: A.ld, log: A.log, ...(A.cl && typeof A.cl === 'object' ? { cl: A.cl } : {}) });
      });
      if (gone) await dropPosts(db, gone);
    }
    await db.doc('allyOf/' + uid).delete();
  } catch (e) { console.warn('alDrop', uid, e && e.message); }
}

const OPS = { alFound, alEdit, alInvite, alUninvite, alRequest, alCancel, alAnswer, alLeave, alRemove, alRole, alDonate, alBuild, alPost, alReact, alPostDel, alTally, alMigrate, alPact, alPactAnswer, alPactEnd, alRival, alVote, alWear, alStudy, alRsStart, alRsGive };
export const isAllianceOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function alliance(db, who, d) { return OPS[d.op](db, who, d); }
