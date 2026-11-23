import { HttpsError } from 'firebase-functions/v2/https';
import { eligibility, refuse, nationJSON } from './eligibility.js';
import { BD_RULES, bdLive, bdDone, bdVoid, bdShape, bdSideOf } from './border-rules.js';

/* Border agreements (asked 2026-11-18: "draw some borders to expand to and agree with a neighbouring nation not to claim
   outside of them"), written only here (civic ops bd*). A Registered Nation paints which hexes are whose, for itself and
   one to three other players of its region, and sends it; each of the others accepts, declines, or paints it again and
   sends it back (a counter-proposal, which only its sender has then accepted). Once every nation has accepted, it is in
   force for the days chosen (or until ended), and can be renewed by all. A nation that claims a hex past the line breaks
   it (its own game reports it: bdBreach), which keeps it on that nation's record for a month. Two sides may swap a hex
   each; each game then cedes its own hex (n.bx), as the server keeps no land. functions/border-rules.js holds the shape. */
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const isUid = v => isId(v) && !v.startsWith('npc-');
const isBid = v => typeof v === 'string' && /^[a-z0-9]{12}$/.test(v);
const regOf = e => e.n.reg || e.saved.get('reg') || '';
const founded = n => Number.isFinite(Number(n && n.founded)) && Number(n.founded) > 0 ? Number(n.founded) : 0;
const nameOf = n => (n && typeof n.name === 'string' && n.name.slice(0, 80)) || 'That nation';
const newId = () => { let s = ''; while (s.length < 12) s += Math.random().toString(36).slice(2); return s.slice(0, 12); };
const DAY = 86400000;

async function partyTo(tx, db, id) {
  const qs = await tx.get(db.collection('borders').where('p', 'array-contains', id));
  return qs.docs.map(s => ({ id: s.id, ref: s.ref, B: s.data() }));
}
/* agreements that count against a nation's limit: waiting, or in force */
const holding = (list, now, skip) => list.filter(x => x.id !== skip && (x.B.st === 'offered' || bdLive(x.B, now))).length;
async function load(tx, db, d) {
  const bid = isBid(d.bid) ? d.bid : '';
  if (!bid) throw new HttpsError('invalid-argument', 'Choose a border agreement.');
  const ref = db.doc('borders/' + bid), s = await tx.get(ref);
  return { bid, ref, B: s.exists ? s.data() : null };
}
/* the other nations, in the caller's region and still as they signed */
/* Settings › Privacy › Who can reach me: a nation that takes none of a kind (rch[k] 'n') is kept to here too */
const closed = (N, k) => !!(N && N.rch && typeof N.rch === 'object' && N.rch[k] === 'n');
/* ...and mv, the newest map any of their records was saved on (the rules' mv on nations/) */
async function others(tx, db, ids, reg, offer) {
  const snaps = await Promise.all(ids.map(id => tx.get(db.doc('nations/' + id))));
  const recs = {};
  let mv = 0;
  snaps.forEach((s, i) => {
    if (!s.exists || (s.get('reg') || '') !== reg) refuse('bd_region', 'Every nation in a border agreement must be a player of your region.');
    recs[ids[i]] = nationJSON(s);
    mv = Math.max(mv, mapOf(s));
    if (offer && closed(recs[ids[i]], 'b')) refuse('bd_closed', 'One of those nations takes no border proposals.');
  });
  return { recs, mv };
}
const mapOf = s => { const v = Number(s && s.get('mv')); return Number.isInteger(v) && v > 0 ? v : 0; };
/* turned down: kept as void for BD_RULES.told, so every other side hears who declined it, or that it was withdrawn */
const voidIt = (tx, ref, B, uid, now) =>
  tx.update(ref, { st: 'void', why: B.a === uid && (B.acc || []).length <= 1 ? 'withdrawn' : 'declined', by: uid, vt: now });

/* a new proposal, or a counter-proposal: the drawn sides of the nations p (the caller among them). d.mv is the map the
   sending page numbers hexes on (the game's MAP_VER), kept as cv. A page still on an older map than any party's record
   is refused: its hexes are another grid's (19 Nov 2026, Saffron Coast: a proposal drawn in a tab opened before the
   frontier landed scattered over the grown map). */
async function bdOffer(db, who, d) {
  const mv = Number.isInteger(d.mv) && d.mv >= 1 && d.mv <= 999 ? d.mv : 0;
  if (!mv) refuse('bd_reload', 'The game has been updated since this page was opened. Reload the page, then draw the border again.');
  const p = Array.isArray(d.p) ? [...new Set(d.p.filter(isId))] : [];
  if (!p.includes(who.uid) || p.length < 2 || p.length > BD_RULES.maxP || p.some(id => !isUid(id)))
    throw new HttpsError('invalid-argument', `Choose one to ${BD_RULES.maxP - 1} other players for a border agreement.`);
  const shape = bdShape(p, d.s, d.buf);
  if (!shape) throw new HttpsError('invalid-argument', `Paint at least one hex for every nation, each hex once, at most ${BD_RULES.maxCells} in all.`);
  const dur = BD_RULES.durs.includes(d.dur) ? d.dur : BD_RULES.durs[0];
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e), now = Date.now();
    let bid = '', ref = null, prev = null;
    if (d.bid != null) {
      ({ bid, ref, B: prev } = await load(tx, db, d));
      if (!prev || prev.st !== 'offered' || !Array.isArray(prev.p) || !prev.p.includes(who.uid)) refuse('bd_gone', 'That proposal is no longer there.');
      if (prev.p.length !== p.length || prev.p.some(id => !p.includes(id))) refuse('bd_parties', 'A counter-proposal keeps the same nations.');
    }
    const rest = p.filter(id => id !== who.uid), { recs, mv: theirs } = await others(tx, db, rest, reg, true);
    if (mv < Math.max(theirs, mapOf(e.saved))) refuse('bd_old_map', 'This page is still on an older map of the region. Reload the page, then draw the border again.');
    const lists = await Promise.all(p.map(id => partyTo(tx, db, id)));
    if (!bid) { bid = newId(); ref = db.doc('borders/' + bid); }
    lists.forEach((L, i) => {
      if (holding(L, now, bid) >= BD_RULES.max)
        refuse('bd_max', p[i] === who.uid ? `You already hold ${BD_RULES.max} border agreements, the most a nation may. End one first.` : `${nameOf(recs[p[i]])} already holds ${BD_RULES.max} border agreements, the most a nation may.`);
    });
    const f = {};
    for (const id of p) { const r = id === who.uid ? e.n : recs[id], v = founded(r); if (v) f[id] = v; }
    tx.set(ref, { reg, p, a: who.uid, acc: [who.uid], v: (prev ? Number(prev.v) || 1 : 0) + 1, st: 'offered', t: now, dur, s: shape.s, buf: shape.buf, f, sw: [], cv: mv });
    for (const L of lists) for (const x of L) if (x.id !== bid && bdDone(x.B, now)) tx.delete(x.ref);
    return { ok: true, bid, counter: !!prev };
  });
}

/* an answer: yes adds the caller's acceptance (in force once all have accepted); no turns the whole proposal down
   (declined, or withdrawn by its sender), and the others are told */
async function bdAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, d.yes ? {} : { linked: false, hidden: true }), now = Date.now();
    const { ref, B } = await load(tx, db, d);
    if (!B || B.st !== 'offered' || !Array.isArray(B.p) || !B.p.includes(who.uid)) refuse('bd_gone', 'That proposal is no longer there.');
    if (Number(d.v) && Number(d.v) !== Number(B.v)) refuse('bd_changed', 'The proposal was drawn again since you looked. Look at the new version first.');
    if (!d.yes) { voidIt(tx, ref, B, who.uid, now); return { ok: true }; }
    const rest = B.p.filter(id => id !== who.uid), { recs } = await others(tx, db, rest, regOf(e));
    if (bdVoid(B, { ...recs, [who.uid]: e.n })) { tx.delete(ref); return { ok: false, why: 'gone' }; }
    const acc = [...new Set([...(B.acc || []), who.uid])];
    if (B.p.every(id => acc.includes(id))) {
      const mine = await partyTo(tx, db, who.uid);
      if (holding(mine, now, ref.id) >= BD_RULES.max) refuse('bd_max', `You already hold ${BD_RULES.max} border agreements, the most a nation may. End one first.`);
      tx.update(ref, { acc, st: 'active', at: now, exp: B.dur ? now + B.dur * DAY : 0, rn: [] });
      return { ok: true, signed: true };
    }
    tx.update(ref, { acc });
    return { ok: true, signed: false };
  });
}
/* ending with notice, by any side */
async function bdEnd(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, B } = await load(tx, db, d), now = Date.now();
    if (!B || !Array.isArray(B.p) || !B.p.includes(who.uid)) refuse('bd_gone', 'That border agreement is not there.');
    if (B.st === 'offered') { voidIt(tx, ref, B, who.uid, now); return { ok: true }; }
    if (!bdLive(B, now)) refuse('bd_gone', 'That border agreement is not in force.');
    if (B.st === 'ending') return { ok: true, end: B.end };
    const end = now + BD_RULES.notice;
    tx.update(ref, { st: 'ending', end, by: who.uid });
    return { ok: true, end };
  });
}
/* renewing for as long again: in force once every side has asked */
async function bdRenew(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, B } = await load(tx, db, d), now = Date.now();
    if (!B || !Array.isArray(B.p) || !B.p.includes(who.uid) || B.st !== 'active' || !bdLive(B, now)) refuse('bd_gone', 'That border agreement is not in force.');
    if (!B.dur) return { ok: true, renewed: false, forever: true };
    const rn = [...new Set([...(B.rn || []), who.uid])];
    if (B.p.every(id => rn.includes(id))) {
      const exp = Math.max(Number(B.exp) || now, now) + B.dur * DAY;
      tx.update(ref, { rn: [], exp });
      return { ok: true, renewed: true, exp };
    }
    tx.update(ref, { rn });
    return { ok: true, renewed: false };
  });
}
/* a claim past the line, reported by the claimer's own game: the agreement is broken by it */
async function bdBreach(db, who, d) {
  const c = Number.isInteger(d.c) && d.c >= 0 && d.c < 1e6 ? d.c : -1;
  if (c < 0) throw new HttpsError('invalid-argument', 'Name the hex.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, B } = await load(tx, db, d), now = Date.now();
    if (!B || !Array.isArray(B.p) || !B.p.includes(who.uid) || !bdLive(B, now)) return { ok: true, broken: false };
    const side = bdSideOf(B, c);
    if (!side || side === who.uid) return { ok: true, broken: false };
    tx.update(ref, { st: 'broken', bt: now, by: who.uid, bc: c });
    return { ok: true, broken: true, p: B.p.filter(id => id !== who.uid) };
  });
}
/* a swap: the caller gives hex g for hex k of nation to, both parties to the agreement in force */
async function bdSwap(db, who, d) {
  const hex = c => Number.isInteger(c) && c >= 0 && c < 1e6;
  if (!hex(d.g) || !hex(d.k) || d.g === d.k || !isUid(d.to)) throw new HttpsError('invalid-argument', 'Choose a hex of yours and one of theirs.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    const { ref, B } = await load(tx, db, d), now = Date.now();
    if (!B || !Array.isArray(B.p) || !B.p.includes(who.uid) || !B.p.includes(d.to) || d.to === who.uid || !bdLive(B, now)) refuse('bd_gone', 'That border agreement is not in force.');
    const sw = (B.sw || []).filter(x => x && (x.st === 'offered' || now - (Number(x.at) || 0) < 7 * DAY));
    if (sw.filter(x => x.st === 'offered').length >= BD_RULES.swaps) refuse('bd_swaps', `${BD_RULES.swaps} swaps already wait for an answer in this agreement.`);
    if (sw.some(x => x.st === 'offered' && [x.g, x.k].some(c => c === d.g || c === d.k))) refuse('bd_swap_twice', 'One of those hexes is already in a swap waiting for an answer.');
    const id = newId().slice(0, 8);
    sw.push({ id, by: who.uid, to: d.to, g: d.g, k: d.k, t: now, st: 'offered' });
    tx.update(ref, { sw });
    return { ok: true, id };
  });
}
/* the answer to a swap: yes, and each side's line moves with its hex (each game cedes its own); no, and it is gone. The
   one who offered it may withdraw it with no. */
async function bdSwapAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, d.yes ? {} : { linked: false, hidden: true });
    const { ref, B } = await load(tx, db, d), now = Date.now();
    const sw = (B && B.sw) || [], x = sw.find(y => y && y.id === d.sid && y.st === 'offered');
    if (!B || !x || (x.to !== who.uid && !(x.by === who.uid && !d.yes))) refuse('bd_gone', 'That swap is no longer there.');
    if (!d.yes) { tx.update(ref, { sw: sw.filter(y => y !== x) }); return { ok: true }; }
    if (!bdLive(B, now)) refuse('bd_gone', 'That border agreement is not in force.');
    const s = {};
    for (const id of B.p) s[id] = (B.s[id] || []).filter(c => c !== x.g && c !== x.k);
    s[x.to].push(x.g); s[x.by].push(x.k);
    const buf = (B.buf || []).filter(c => c !== x.g && c !== x.k);
    tx.update(ref, { s, buf, sw: sw.map(y => y === x ? { ...y, st: 'done', at: now } : y) });
    return { ok: true, done: true, g: x.g, k: x.k, by: x.by };
  });
}

/* a nation that is deleted is party to nothing; called outside any other transaction */
export async function bdDrop(db, uid) {
  try {
    const qs = await db.collection('borders').where('p', 'array-contains', uid).get();
    if (qs.empty) return;
    const b = db.batch(); qs.docs.forEach(s => b.delete(s.ref)); await b.commit();
  } catch (e) { console.warn('bdDrop', uid, e && e.message); }
}

const OPS = { bdOffer, bdAnswer, bdEnd, bdRenew, bdBreach, bdSwap, bdSwapAnswer };
export const isBorderOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function border(db, who, d) { return OPS[d.op](db, who, d); }
