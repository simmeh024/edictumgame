import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { identity, eligibility, nationJSON, refuse, registered, regionMessage, DAY } from './eligibility.js';
import { cabinetAffinity } from './affinity.js';
import { assemblyEngine } from './assembly-engine.js';
import DATA from './civic-data.json' with { type: 'json' };

const regions = new Set(DATA.regions.map(r => r.id));
const statKeys = Object.keys(DATA.regions[0].npcs[0].s);
const savedStats = n => Object.fromEntries(statKeys.map(k=>[k,Number.isFinite(n.s?.[k])?Math.max(0,Math.min(100,n.s[k])):50]));
const npcIds = new Set(DATA.regions.flatMap(r => r.npcs.map(n => n.id)));
const text = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const politicalKeys = new Set(['r','e','s','v','p','a','m','o','j','ox','pw']);
export const politicalPart = a => Object.fromEntries(Object.entries(a || {}).filter(([k]) => politicalKeys.has(k)));

async function permit(db, who, d) {
  const p = d.record;
  if (!p || typeof p.j !== 'string' || p.j.length > 700000 || typeof p.name !== 'string' || p.name.length > 80 || !['pop','army','cl','updatedAt'].every(k=>Number.isFinite(p[k])) || !regions.has(p.reg) || !Number.isSafeInteger(d.rev) || d.rev < 0)
    throw new HttpsError('invalid-argument', 'Invalid nation save.');
  let n;
  try { n = JSON.parse(p.j); } catch { throw new HttpsError('invalid-argument', 'Invalid nation JSON.'); }
  if (!n || Array.isArray(n) || typeof n !== 'object' || n.reg !== p.reg || n.name !== p.name || own(n, 'asm'))
    throw new HttpsError('invalid-argument', 'Political records must be changed through the protected Assembly service.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true, nation: false });
    if ((e.saved.get('rev') || 0) !== d.rev) refuse('save_conflict', 'Another device saved this nation.');
    const control = await tx.get(db.doc('regionStatus/' + p.reg));
    if (control.exists && control.get('enabled') === false) refuse('region_disabled', regionMessage(control));
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
    const result = { j: JSON.stringify(n), reg: p.reg, name: p.name, pop: p.pop, army: p.army, cl: p.cl, updatedAt: p.updatedAt, rev: d.rev + 1 };
    const ref = db.collection('nationPermits/' + who.uid + '/requests').doc();
    tx.create(ref, { ...result, exp: Timestamp.fromMillis(Date.now() + 120000), authGeneration: who.generation, sensitive: !!(founded || pvp.length), nationGeneration: e.generation });
    return { ...result, permit: ref.id };
  });
}

async function regionState(tx, db, reg, now) {
  const root = db.doc('assemblyRegions/' + reg);
  const [meta, nations, actors, cycles] = await Promise.all([
    tx.get(root), tx.get(db.collection('nations').where('reg', '==', reg)),
    tx.get(root.collection('actors')), tx.get(root.collection('cycles').orderBy('c', 'desc').limit(12))
  ]);
  // Fresh provider data prevents an unlinked/disabled identity retaining political power through a cache.
  const users = [];
  for (let i = 0; i < nations.docs.length; i += 100) users.push(...(await getAuth().getUsers(nations.docs.slice(i, i + 100).map(s => ({ uid: s.id })))).users);
  const auth = new Map(users.map(u => [u.uid, u]));
  const records = [], byId = new Map(actors.docs.map(s => [s.id, s]));
  const checks = nations.empty ? [] : await tx.getAll(...nations.docs.flatMap(s => ['bans/','mod/','accountIdentity/'].map(p => db.doc(p+s.id))));
  for (const [index,saved] of nations.docs.entries()) {
    const [ban, mod, account] = checks.slice(index*3,index*3+3);
    const generation = saved.createTime.toMillis(), born = account.get('nationGeneration') === generation ? account.get('nationAt') : generation;
    const u = auth.get(saved.id), valid = !!(u && !u.disabled && registered(u) && !ban.exists && !mod.get('hidden') && !(mod.get('removed') >= generation));
    const actor = byId.get(saved.id), a = actor?.get('generation') === generation ? actor.get('record') : { r: reg, e: [], s: [], v: [] };
    const n = nationJSON(saved);
    // Never import political decisions from a legacy, player-writable JSON record.
    records.push({ id: saved.id, n: { name: saved.get('name'), reg, founded: born, s: savedStats(n), flag: n.flag || {}, civicAffinity: cabinetAffinity(n), gw: n.gw || {}, civicAt: valid ? born + DAY : 0, asm: a }, generation });
  }
  const locks = cycles.docs.map(s => s.data()), engine = assemblyEngine(reg, records, locks), c = engine.cycle(now);
  const pending = [];
  // Cut over at the current cycle; only protected cycles can become binding results.
  for (const L of locks) if (L.c < c && !L.f) {
    const at = engine.t0(L.c + 1) - 1, D = engine.delegate(records, at).D, V = engine.tally(L, L.c, records, at, D);
    Object.assign(L, { y: V.y, n: V.n, ok: V.ok ? 1 : 0, f: now, r: reg });
    pending.push([root.collection('cycles').doc(String(L.c)), L]);
  }
  const last = locks.length ? Math.max(...locks.map(L=>L.c)) : c-1;
  for(let next=Math.max(last+1,c-6);next<=c;next++){
    const currentEngine=assemblyEngine(reg,records,locks),L=currentEngine.pick(next,new Set(locks.map(x=>x.k)));
    if(L){
      L.lt=now;
      if(next<c){const at=currentEngine.t0(next+1)-1,D=currentEngine.delegate(records,at).D,V=currentEngine.tally(L,next,records,at,D);Object.assign(L,{y:V.y,n:V.n,ok:V.ok?1:0,f:now,r:reg});}
      locks.push(L);pending.push([root.collection('cycles').doc(String(next)),L]);
    }
  }
  return { root, meta, records, actors: byId, locks, pending, c, engine: assemblyEngine(reg, records, locks) };
}

function output(ctx, uid, now, e) {
  const st = ctx.engine.state(now);
  const simpleD = D => D ? { id: D.id, k: D.k, by: D.by, np: D.np } : null;
  return { c: st.c, t0: st.t0, t1: st.t1, now, reg: e.n.reg, cur: st.cur, D: simpleD(st.D),
    recs: ctx.records, locks: ctx.locks, V: st.V ? { ...st.V, rows: st.V.rows.map(({ n, ...row }) => row) } : null,
    info: [...st.DD.info].map(([id, v]) => [id, { k: v.k, by: v.by, np: v.np, reach: v.reach }]),
    npc: st.DD.npc.map(b => ({ id: b.x.id, player: b.r?.id || '', a: b.a })),
    account: { kind: e.kind, readyAt: e.readyAt, eligible: e.kind === 'registered' && now >= e.readyAt },
    own: ctx.records.find(r => r.id === uid)?.n.asm || { r: e.n.reg, e: [], s: [], v: [] } };
}

async function assembly(db, who, d) {
  const action = d.op !== 'state';
  return db.runTransaction(async tx => {
    const now = Date.now();
    const e = await eligibility(tx, who, { linked: action, age: action ? DAY : 0, hidden: !action });
    const reg = e.n.reg, ctx = await regionState(tx, db, reg, now), mine = ctx.records.find(r => r.id === who.uid);
    const st = ctx.engine.state(now), a = structuredClone(mine.n.asm), previousProposal = a.p, op = d.op;
    if (action && a.o && (!a.j || a.j <= a.o) && op !== 'rejoin') refuse('resigned', 'Rejoin the Assembly before taking political actions.');
    const queue = ctx.records.filter(r => r.n.asm.p).map(r => ({ r, p: r.n.asm.p, k: ctx.engine.key(r.id, r.n.asm.p) }));
    const queued = k => queue.find(x => x.k === k && ctx.engine.cycle(x.p.t) >= ctx.c - 2 && !ctx.locks.some(L => L.k === k));
    if (op === 'vote') {
      if (![-1,0,1].includes(d.vote) || d.cycle !== ctx.c || d.key !== st.cur?.k) refuse('vote_closed', 'This vote has closed or changed. Refresh the Assembly.');
      a.v = [...(a.v || []).filter(v => v.c >= ctx.c - 3 && v.c !== ctx.c), { c: ctx.c, k: st.cur.k, v: d.vote, t: now }];
    } else if (op === 'propose') {
      const ti = text(d.title, 60), body = text(d.body, 280);
      if (ti.length < 4 || body.length < 10 || !own(ctx.engine.cats, d.category) || ![0,1].includes(d.strength)) throw new HttpsError('invalid-argument', 'Choose a category, title and proposal text.');
      const current = a.p && queued(ctx.engine.key(who.uid, a.p));
      if (d.edit) {
        if (!current) refuse('proposal_locked', 'This proposal can no longer be edited.');
        Object.assign(a.p, { ti, tx: body, ed: now });
      } else {
        if (current || (a.p && st.cur?.k === ctx.engine.key(who.uid,a.p))) refuse('proposal_exists', 'You already have a proposal before the Assembly.');
        if (a.pw && now - a.pw < 6 * 3600000) refuse('proposal_cooldown', 'Wait six hours after withdrawing a proposal.');
        a.p = { t: now, ti, tx: body, c: d.category, g: d.strength };
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
    } else if (op === 'agenda' || op === 'message') {
      if (st.D?.id !== who.uid) refuse('delegate_required', 'Only the current Delegate can do that.');
      if (op === 'agenda') {
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
    for (const [ref, L] of ctx.pending) tx.set(ref, L);
    if (action) {
      mine.n.asm = a;
      tx.set(ctx.root.collection('actors').doc(who.uid), { generation: e.generation, record: a, at: now });
      if (op === 'vote') tx.set(ctx.root.collection('cycles').doc(String(ctx.c)).collection('votes').doc(who.uid), { uid: who.uid, cycle: ctx.c, key: st.cur.k, value: d.vote, at: now });
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
    return output(ctx, who.uid, now, e);
  });
}

export const civic = onCall({ region: 'europe-west1', maxInstances: 10, memory: '256MiB', timeoutSeconds: 60 }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore(), who = await identity(req.auth.uid), d = req.data || {};
  if (d.op === 'authorizeSave') return permit(db, who, d);
  if (d.op === 'topic') return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), limit = db.doc('limits/' + who.uid), s = await tx.get(limit);
    if (d.reg && d.reg !== e.n.reg) throw new HttpsError('permission-denied', 'Post to your own region.');
    const x = text(d.text, 400), now = Date.now();
    if (!x) throw new HttpsError('invalid-argument', 'Write a message first.');
    if (s.exists && now - s.get('p').toMillis() < 20000) throw new HttpsError('resource-exhausted', 'Wait 20 seconds between community posts.');
    const ref = db.collection('boards/' + e.n.reg + '/posts').doc();
    tx.create(ref, { a: who.uid, t: FieldValue.serverTimestamp(), x });
    tx.set(limit, { p: FieldValue.serverTimestamp() });
    return { id: ref.id };
  });
  return assembly(db, who, d);
});
