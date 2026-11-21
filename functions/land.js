import { HttpsError } from 'firebase-functions/v2/https';
import { eligibility, refuse, nationJSON } from './eligibility.js';
import { LD_RULES, LD_X, LD_DOC, LD_OPEN, ldKey, ldShape, ldPay, ldCovers, ldMinBid, ldDue, ldBehind, ldHolds, ldEnded } from './land-rules.js';

/* Land deals (asked 2026-11-21: "add a land trading system"; the owner picked hex sales, open swaps, whole provinces,
   gifts, payment set aside, instalments, stamp duty, a valuer, a land market, for-sale signs, auctions, the map's
   rules, ransoms and the news), written only here (civic ops ld*). functions/land-rules.js holds the rules.

   A Registered Nation offers a deal to another player of its region (hexes each side gives, stock each side pays,
   instalments), lists its own hexes on the region's land market at a price, or puts them up for auction. The server
   keeps no land and no stock. A payer's game sets its payment aside in its own record first (n.lde [{id, r, t}], the
   shared half, as Supply Caches do: functions/supply.js), and the server reads the saved record to see it there before
   it takes the offer, the answer or the bid. Once agreed, each game hands over its own hexes (n.bx) and says so
   (ldCede); the server reads them in the saved record, and the deal is done when every side has. Then each payee's
   game takes in what was set aside for it, less the stamp duty, and the payer's game lets its entry go. A deal that
   cannot be handed over is called off (ldFail): the payments set aside go back, and land already handed over is
   handed back by the game that received it. Instalments are set aside one a day by the receiving side's game and
   counted here (ldPay); too far behind, the deal is called in (ldCall) and that game hands the land back. */
const isId = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
const isUid = v => isId(v) && !v.startsWith('npc-');
const regOf = e => e.n.reg || e.saved.get('reg') || '';
const founded = n => n && Number.isFinite(Number(n.founded)) && Number(n.founded) > 0 ? Number(n.founded) : 0;
const nameOf = n => (n && typeof n.name === 'string' && n.name.trim().slice(0, 80)) || 'A nation';
/* Settings › Privacy › Who can reach me: land offers count as trade offers ('t'); a nation that takes none is kept to here */
const closed = (N, k) => !!(N && N.rch && typeof N.rch === 'object' && N.rch[k] === 'n');
const text = (v, m) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, m) : '';

async function load(tx, db, d) {
  const id = typeof d.id === 'string' && LD_DOC.test(d.id) ? d.id : '';
  if (!id) throw new HttpsError('invalid-argument', 'Choose a land deal.');
  const ref = db.doc('land/' + id), s = await tx.get(ref);
  return { id, ref, D: s.exists ? s.data() : null };
}
/* the payment set aside in a nation's saved record under key, if it covers want */
function setAside(n, key, want) {
  const e = (Array.isArray(n && n.lde) ? n.lde : []).find(x => x && x.id === key);
  return !!e && ldCovers(ldPay(e.r) || {}, want);
}
/* every deal a nation is party to: as the offerer and as the other side */
async function partyTo(tx, db, uid) {
  const [a, b] = await Promise.all([tx.get(db.collection('land').where('a', '==', uid)), tx.get(db.collection('land').where('b', '==', uid))]);
  const seen = new Set(), out = [];
  for (const s of [...a.docs, ...b.docs]) if (!seen.has(s.id)) { seen.add(s.id); out.push({ id: s.id, ref: s.ref, D: s.data() }); }
  return out;
}
/* still to be answered, bought or bid on, as of now (past its time it lapses) */
function stillOpen(D, now) {
  if (!D || !LD_OPEN.includes(D.st)) return false;
  return D.st === 'open' ? now < (Number(D.end) || 0) : now < (Number(D.x) || 0);
}
const holding = (D, now) => D && (D.st === 'agreed' || stillOpen(D, now) || (D.st === 'open' && (D.bids || []).length > 0));
/* the hexes a nation has promised in deals still open or being handed over */
function promised(list, uid, now, skip) {
  const out = new Set();
  for (const { id, D } of list) {
    if (id === skip || !holding(D, now)) continue;
    for (const c of D.a === uid ? D.ga || [] : D.b === uid ? D.gb || [] : []) out.add(c);
  }
  return out;
}
/* a finished deal past its keep, or an open one long lapsed: gone when its offerer next writes */
function stale(D, now) {
  const fin = ldEnded(D) || (LD_OPEN.includes(D.st) && !holding(D, now) ? Number(D.end) || Number(D.x) || 0 : 0);
  return fin > 0 && now - fin > LD_RULES.keep;
}
async function nationIn(tx, db, uid, reg) {
  const [s, ban] = await tx.getAll(db.doc('nations/' + uid), db.doc('bans/' + uid));
  if (!s.exists || (s.get('reg') || '') !== reg || ban.exists) return null;
  return nationJSON(s);
}

/* an offer to one nation, a listing on the land market, or an auction. The caller's payment (pa), if any, is set aside
   in its saved record under the deal's id first */
async function ldOffer(db, who, d) {
  const x = typeof d.x === 'string' && LD_X.test(d.x) ? d.x : '';
  if (!x) throw new HttpsError('invalid-argument', 'Choose a land deal.');
  const k = ['deal', 'list', 'auction'].includes(d.k) ? d.k : 'deal';
  const shape = ldShape(k, d);
  if (!shape) throw new HttpsError('invalid-argument', `Choose up to ${LD_RULES.hexes} hexes a side, each once, and what is paid for them.`);
  const cv = Number.isInteger(d.cv) && d.cv > 0 && d.cv < 1e6 ? d.cv : 0;
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), reg = regOf(e), now = Date.now(), id = who.uid + '_' + x;
    const ref = db.doc('land/' + id), cur = await tx.get(ref);
    if (cur.exists) return { ok: true, id, dup: true };
    let to = '', other = null;
    if (k === 'deal') {
      to = isUid(d.to) && d.to !== who.uid ? d.to : '';
      if (!to) refuse('ld_target', 'Choose another player of your region.');
      other = await nationIn(tx, db, to, reg);
      if (!other) refuse('ld_target', 'That nation is no longer in your region.');
      if (closed(other, 't')) refuse('ld_closed', 'That nation takes no trade offers.');
    }
    const mine = await partyTo(tx, db, who.uid);
    const held = mine.filter(m => holding(m.D, now));
    if (held.length >= LD_RULES.open) refuse('ld_max', `You already have ${LD_RULES.open} land deals open, the most a nation may. Withdraw one first.`);
    if (k === 'auction' && held.filter(m => m.D.k === 'auction').length >= LD_RULES.auctions) refuse('ld_auctions', `You already run ${LD_RULES.auctions} auctions, the most a nation may.`);
    const prom = promised(mine, who.uid, now);
    if (shape.ga.some(c => prom.has(c))) refuse('ld_twice', 'One of those hexes is already in another land deal of yours.');
    if (Object.keys(shape.pa).length && !setAside(e.n, id, shape.pa)) refuse('ld_unpaid', 'Your payment is not set aside in your saved nation yet. Try again in a moment.');
    const f = {}, fa = founded(e.n), fb = founded(other);
    if (fa) f[who.uid] = fa;
    if (to && fb) f[to] = fb;
    const doc = { reg, cv, k, a: who.uid, an: nameOf(e.n), b: to, bn: to ? nameOf(other) : '', ga: shape.ga, gb: shape.gb, pa: shape.pa, pb: shape.pb, ins: shape.ins,
      ds: text(d.ds, 40), ro: d.ro === 1 && k === 'deal' ? 1 : 0, val: Number.isFinite(d.val) && d.val >= 0 && d.val < 1e7 ? Math.round(d.val) : 0,
      st: k === 'deal' ? 'offered' : k === 'list' ? 'listed' : 'open', t: now, f };
    if (k === 'auction') Object.assign(doc, { cur: shape.cur, res: shape.res, end: now + shape.hours * 3600000, x: now + shape.hours * 3600000, bids: [] });
    else doc.x = now + (k === 'deal' ? LD_RULES.offer : LD_RULES.list);
    tx.create(ref, doc);
    for (const m of mine) if (m.D.a === who.uid && stale(m.D, now)) tx.delete(m.ref);
    return { ok: true, id };
  });
}

/* the answer to an offer (its other side), or buying a listing (anyone of the region but its offerer). Yes needs the
   caller's payment (pb) set aside in its saved record under the deal's id; no turns the offer down */
async function ldAnswer(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, d.yes ? {} : { linked: false, hidden: true }), now = Date.now();
    const { id, ref, D } = await load(tx, db, d);
    if (!D || !stillOpen(D, now) || (D.st !== 'offered' && D.st !== 'listed')) refuse('ld_gone', 'That land deal is no longer there.');
    if (D.st === 'offered' && D.b !== who.uid) refuse('ld_gone', 'That land deal is no longer there.');
    if (D.st === 'listed' && (D.a === who.uid || D.reg !== regOf(e))) refuse('ld_gone', 'That land is not for sale to you.');
    if (!d.yes) {
      if (D.st !== 'offered') return { ok: true };
      tx.update(ref, { st: 'void', why: 'declined', vt: now });
      return { ok: true };
    }
    const seller = await nationIn(tx, db, D.a, D.reg);
    if (!seller || (D.f && D.f[D.a] && founded(seller) !== D.f[D.a])) { tx.update(ref, { st: 'void', why: 'gone', vt: now }); return { ok: false, why: 'gone' }; }
    if (D.f && D.f[who.uid] && founded(e.n) !== D.f[who.uid]) { tx.update(ref, { st: 'void', why: 'gone', vt: now }); return { ok: false, why: 'gone' }; }
    const mine = await partyTo(tx, db, who.uid);
    if (D.st === 'listed' && mine.filter(m => holding(m.D, now)).length >= LD_RULES.open) refuse('ld_max', `You already have ${LD_RULES.open} land deals open, the most a nation may.`);
    if ((D.gb || []).length) { const prom = promised(mine, who.uid, now, id); if (D.gb.some(c => prom.has(c))) refuse('ld_twice', 'One of your hexes in it is already promised in another land deal.'); }
    if (Object.keys(D.pb || {}).length && !setAside(e.n, id, D.pb)) refuse('ld_unpaid', 'Your payment is not set aside in your saved nation yet. Try again in a moment.');
    const up = { st: 'agreed', at: now };
    if (D.st === 'listed') { up.b = who.uid; up.bn = nameOf(e.n); up.f = { ...(D.f || {}), ...(founded(e.n) ? { [who.uid]: founded(e.n) } : {}) }; }
    tx.update(ref, up);
    return { ok: true, at: now };
  });
}

/* withdrawn by its offerer: an offer, a listing, or an auction nobody has bid on */
async function ldWithdraw(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, D } = await load(tx, db, d), now = Date.now();
    if (!D || D.a !== who.uid || !LD_OPEN.includes(D.st)) refuse('ld_gone', 'That land deal is no longer there.');
    if (D.st === 'open' && (D.bids || []).length) refuse('ld_bids', 'An auction with a bid on it runs to its end.');
    tx.update(ref, { st: 'void', why: 'withdrawn', vt: now });
    return { ok: true };
  });
}

/* a bid at an auction: v of its resource, set aside in the bidder's saved record under the deal's id */
async function ldBid(db, who, d) {
  const v = Number.isInteger(d.v) && d.v >= 1 && d.v <= LD_RULES.max ? d.v : 0;
  if (!v) throw new HttpsError('invalid-argument', `Bid 1 to ${LD_RULES.max}.`);
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who), now = Date.now();
    const { id, ref, D } = await load(tx, db, d);
    if (!D || D.st !== 'open' || now >= (Number(D.end) || 0)) refuse('ld_gone', 'That auction has closed.');
    if (D.a === who.uid || D.reg !== regOf(e)) refuse('ld_gone', 'That auction is not open to you.');
    const min = ldMinBid(D);
    if (v < min) throw new HttpsError('failed-precondition', `The next bid must be at least ${min}.`, { code: 'ld_low', min });
    if (!setAside(e.n, id, { [D.cur]: v })) refuse('ld_unpaid', 'Your bid is not set aside in your saved nation yet. Try again in a moment.');
    const bids = (Array.isArray(D.bids) ? D.bids : []).concat({ by: who.uid, bn: nameOf(e.n), v, t: now }).slice(-30);
    const end = Math.max(Number(D.end) || 0, now + LD_RULES.snipe);
    tx.update(ref, { bids, end, x: end });
    return { ok: true, end, min: ldMinBid({ bids, res: D.res }) };
  });
}

/* an auction past its end: won by the highest bid, if its bidder is still a player of the region; else closed unsold.
   Any player of the region may ask, so it closes without its seller */
async function ldClose(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true }), now = Date.now();
    const { ref, D } = await load(tx, db, d);
    if (!D || D.st !== 'open') return { ok: true, st: D ? D.st : 'gone' };
    if (now < (Number(D.end) || 0)) return { ok: true, st: 'open' };
    if (D.reg !== regOf(e)) refuse('ld_gone', 'That auction is in another region.');
    const bids = Array.isArray(D.bids) ? D.bids : [], top = bids[bids.length - 1];
    const winner = top && await nationIn(tx, db, top.by, D.reg);
    if (!top || !winner) { tx.update(ref, { st: 'closed', vt: now }); return { ok: true, st: 'closed' }; }
    tx.update(ref, { st: 'agreed', at: now, b: top.by, bn: nameOf(winner), pb: { [D.cur]: top.v }, f: { ...(D.f || {}), ...(founded(winner) ? { [top.by]: founded(winner) } : {}) } });
    return { ok: true, st: 'agreed', b: top.by, v: top.v };
  });
}

/* a side has handed over its hexes: each is in its saved record (n.bx) as given to the other side since the deal was
   agreed. Done once every side that gives land has */
async function ldCede(db, who, d) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true }), now = Date.now();
    const { ref, D } = await load(tx, db, d);
    if (!D || D.st !== 'agreed' || (D.a !== who.uid && D.b !== who.uid)) refuse('ld_gone', 'That land deal is not being handed over.');
    const side = D.a === who.uid ? 'a' : 'b', other = side === 'a' ? D.b : D.a, mine = side === 'a' ? D.ga || [] : D.gb || [];
    const bx = Array.isArray(e.n.bx) ? e.n.bx : [], since = (Number(D.at) || 0) - 120000;
    const gone = mine.filter(c => !bx.some(x => x && x.c === c && x.to === other && x.fr === who.uid && Number(x.t) >= since));
    if (gone.length) throw new HttpsError('failed-precondition', 'Your hexes are not handed over in your saved nation yet. Try again in a moment.', { code: 'ld_unceded', gone });
    const up = { ['c' + side]: now }, ca = side === 'a' ? now : D.ca, cb = side === 'b' ? now : D.cb;
    const done = (!(D.ga || []).length || ca) && (!(D.gb || []).length || cb);
    if (done) { up.st = 'done'; up.dt = now; if (D.ins) { up.pd = 0; up.pt = 0; } }
    tx.update(ref, up);
    return { ok: true, done: !!done };
  });
}

/* called off while being handed over: why 'lost' (the caller no longer holds a hex it gives) or 'late' (the other side
   has not handed its land over in LD_RULES.settle) */
async function ldFail(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, D } = await load(tx, db, d), now = Date.now();
    if (!D || D.st !== 'agreed' || (D.a !== who.uid && D.b !== who.uid)) return { ok: true, st: D ? D.st : 'gone' };
    const why = d.why === 'late' ? 'late' : 'lost';
    if (why === 'late') {
      const side = D.a === who.uid ? 'b' : 'a', owes = ((side === 'a' ? D.ga : D.gb) || []).length > 0 && !(side === 'a' ? D.ca : D.cb);
      if (!owes || now - (Number(D.at) || 0) < LD_RULES.settle) refuse('ld_wait', 'The other side still has time to hand its land over.');
    }
    tx.update(ref, { st: 'void', why, vt: now, by: who.uid });
    return { ok: true, st: 'void' };
  });
}

/* instalment k of a deal, set aside in the payer's saved record (ldKey(id, k)) */
async function ldPayIns(db, who, d) {
  const k = Number.isInteger(d.k) && d.k >= 1 && d.k <= 60 ? d.k : 0;
  if (!k) throw new HttpsError('invalid-argument', 'Choose an instalment.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false, hidden: true }), now = Date.now();
    const { id, ref, D } = await load(tx, db, d);
    if (!D || D.st !== 'done' || !D.ins) refuse('ld_gone', 'That land deal takes no instalments now.');
    const payer = D.ins.by === 'a' ? D.a : D.b;
    if (payer !== who.uid) refuse('ld_gone', 'Those instalments are not yours to pay.');
    const pd = Number(D.pd) || 0;
    if (k <= pd) return { ok: true, pd };
    if (k !== pd + 1 || k > D.ins.n) refuse('ld_order', 'Instalments are paid in order.');
    if (!setAside(e.n, ldKey(id, k), D.ins.r)) refuse('ld_unpaid', 'That instalment is not set aside in your saved nation yet.');
    tx.update(ref, { pd: k, pt: now });
    return { ok: true, pd: k };
  });
}

/* instalments called in: by the payee once the payer is more than LD_RULES.grace behind, or by the payer, who stops
   paying. Either way the land goes back (the payer's game hands it over) and what was paid stays paid */
async function ldCall(db, who, d) {
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, hidden: true });
    const { ref, D } = await load(tx, db, d), now = Date.now();
    if (!D || D.st !== 'done' || !D.ins || (Number(D.pd) || 0) >= D.ins.n) refuse('ld_gone', 'Those instalments are not running.');
    const payer = D.ins.by === 'a' ? D.a : D.b, payee = payer === D.a ? D.b : D.a;
    if (who.uid !== payer && who.uid !== payee) refuse('ld_gone', 'That land deal is not yours.');
    if (who.uid === payee && ldBehind(D, now) <= LD_RULES.grace) throw new HttpsError('failed-precondition', `Instalments can be called in once more than ${LD_RULES.grace} are late.`, { code: 'ld_wait', due: ldDue(D, now) });
    tx.update(ref, { st: 'default', vt: now, why: who.uid === payer ? 'stopped' : 'behind', by: who.uid });
    return { ok: true };
  });
}

/* a nation that is deleted is party to nothing more: its open deals are called off (so the other side's payments go
   back) and its finished ones go. Called outside any other transaction */
export async function ldDrop(db, uid) {
  try {
    const qs = await Promise.all(['a', 'b'].map(k => db.collection('land').where(k, '==', uid).get()));
    const docs = qs.flatMap(q => q.docs), now = Date.now();
    if (!docs.length) return;
    const w = db.bulkWriter(), jobs = [];
    for (const s of docs) {
      const D = s.data();
      jobs.push(ldEnded(D) || (LD_OPEN.includes(D.st) && !holding(D, now)) ? w.delete(s.ref) : w.update(s.ref, { st: 'void', why: 'gone', vt: now }));
    }
    await Promise.all([Promise.all(jobs), w.close()]);
  } catch (e) { console.warn('ldDrop', uid, e && e.message); }
}

const OPS = { ldOffer, ldAnswer, ldWithdraw, ldBid, ldClose, ldCede, ldFail, ldPay: ldPayIns, ldCall };
export const isLandOp = op => Object.prototype.hasOwnProperty.call(OPS, op);
export function land(db, who, d) { return OPS[d.op](db, who, d); }
