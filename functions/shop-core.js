/* The shop's rules, apart from Firestore and Paddle (functions/shop.js uses them; test/shop.test.mjs tests them).

   Everything a player owns is worked out again from the payment records each time one arrives: the transactions
   Paddle reported completed, the adjustments (refunds, chargebacks) made to them, and the subscriptions. So the
   order in which Paddle's notifications arrive, or how often the same one arrives, never changes the outcome.

   The Founder's Package rule (also in docs/shop.md and on the Shop page): it is delivered for a payment on a
   checkout that this server opened before FOUNDER_CUTOFF (2 February 2027 00:00 UTC: the sale runs to the end of
   1 February) and that completed no later than FOUNDER_GRACE after it. No checkout opens from the cutoff on. A
   payment that completes later still is refunded in full automatically; if Paddle turns that refund down, the
   package is delivered after all, so nobody is ever charged without receiving it. */
import crypto from 'node:crypto';
import CAT from './shop-catalogue.json' with { type: 'json' };

export const CATALOGUE = CAT;
export const PRODUCTS = Object.keys(CAT.products);
export const ONCE = PRODUCTS.filter(p => CAT.products[p].kind === 'once');
/* the Chancery Club, monthly or yearly; a month of it given as a gift; what can be given; what must be on sale for
   the shop to open (an optional product is offered only once its price is set) */
export const CLUB = PRODUCTS.filter(p => CAT.products[p].club);
export const GIFT_MONTH = PRODUCTS.filter(p => CAT.products[p].kind === 'giftmonth');
export const GIFTABLE = PRODUCTS.filter(p => CAT.products[p].giftable);
export const REQUIRED = PRODUCTS.filter(p => !CAT.products[p].optional);
export const FOUNDER_CUTOFF = Date.parse(CAT.products.founder.until);
export const FOUNDER_GRACE = CAT.products.founder.graceMinutes * 60000;
export const VIP_COLLECTION = CAT.products.vip.collection;
/* The Club's collection grows: the pieces it opened with, and two more at the start of each month (the catalogue's
   drops, from 00:00 UTC on their day). A piece can be chosen once its month has begun, and one chosen is kept for good. */
export const CLUB_DROPS = (CAT.products.vip.drops || []).map(d => ({ from: Date.parse(d.from), ids: d.ids })).filter(d => Number.isFinite(d.from)).sort((a, b) => a.from - b.from);
export const CLUB_IDS = [...new Set([...VIP_COLLECTION, ...CLUB_DROPS.flatMap(d => d.ids)])];
export const clubReleased = now => [...VIP_COLLECTION, ...CLUB_DROPS.filter(d => d.from <= now).flatMap(d => d.ids)];
/* a paid month's choice stays open this long after the month ends: a month with nothing left to choose waits for the
   next pieces, and a member who missed a month can still choose for it */
export const PICK_GRACE = (CAT.products.vip.pickGraceDays || 35) * 86400000;
/* The Chancery seals a player may show beside the nation's name, by months of membership: the plain seal (0) while a
   member, and the others once that many months have begun, kept for good. Nothing is shown unless the player chooses. */
export const SEALS = CAT.products.vip.seals || {};
/* The founders' thank-you gift (November 2026): every holder of the Founder's Package may choose one of these packs once,
   free, until `until` (the server's clock). The choice is kept in shopFGift/{uid} and owned while the package is. */
export const FOUNDER_GIFT = (() => {
  const g = CAT.founderGift || {}, until = Date.parse(g.until);
  return { until: Number.isFinite(until) ? until : 0, packs: (Array.isArray(g.packs) ? g.packs : []).filter(p => CAT.products[p] && CAT.products[p].kind === 'once' && p !== 'founder') };
})();
/* Paddle's own libraries allow 5 seconds between signing and checking; a cold start can take longer than that, and a
   replayed notification changes nothing here (see above), so this allows five minutes */
export const SIG_TOLERANCE = 300;
const RUN_GAP = 36 * 3600000;  // two paid months closer than this make one unbroken membership

const ms = v => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };

/* Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>"> (more than one h1 while a secret
   is being rotated) */
export function verifySignature(raw, header, secret, now = Date.now()) {
  if (!secret || typeof header !== 'string' || !Buffer.isBuffer(raw)) return false;
  let ts = '';
  const sigs = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 'ts') ts = v; else if (k === 'h1') sigs.push(v);
  }
  if (!/^\d{1,12}$/.test(ts) || !sigs.length || Math.abs(now / 1000 - Number(ts)) > SIG_TOLERANCE) return false;
  const want = crypto.createHmac('sha256', secret).update(ts + ':').update(raw).digest();
  return sigs.some(h => /^[0-9a-f]{64}$/i.test(h) && crypto.timingSafeEqual(Buffer.from(h, 'hex'), want));
}
export function signature(raw, secret, ts = Math.floor(Date.now() / 1000)) {
  return 'ts=' + ts + ';h1=' + crypto.createHmac('sha256', secret).update(ts + ':').update(raw).digest('hex');
}

/* A basket: several one-off products for the player's own nation, paid together in one checkout (functions/shop.js,
   basket). Paddle keeps each as its own line with its own id (details.line_items[].id, txnitm_…), and a refund can give
   back one line in full without the others, so what a basket delivers is worked out line by line. */
export const BASKET = 'basket';
export const BASKET_MAX = 10;
export const BASKETABLE = ONCE.filter(p => !CAT.products[p].giftOnly);
/* the lines of a transaction as entitlement() counts them: a basket's own ({i: Paddle's line id, p: product, tot}), or
   the transaction itself as one line (i ''), as every transaction before baskets was */
export function txUnits(t) {
  return Array.isArray(t.items) && t.items.length
    ? t.items.map(x => ({ i: String(x && x.i || ''), p: String(x && x.p || ''), tot: Number(x && x.tot) || 0 }))
    : [{ i: '', p: String(t.product || ''), tot: Number(t.total) || 0 }];
}

/* the facts kept from Paddle's entities */
export function txFacts(d, prices) {
  const byPrice = Object.fromEntries(Object.entries(prices || {}).flatMap(([k, v]) => [].concat(v || []).map(id => [id, k])));
  const items = Array.isArray(d.items) ? d.items : [], one = items.length === 1 ? items[0] : null;
  const pay = (Array.isArray(d.payments) ? d.payments : []).find(p => p && ms(p.captured_at));
  const bp = d.billing_period;
  const out = {
    id: String(d.id || ''), status: String(d.status || ''), product: '', products: [], price: '', ok: false,
    paid: ms(pay?.captured_at) || ms(d.billed_at) || ms(d.updated_at),
    period: bp && ms(bp.starts_at) && ms(bp.ends_at) > ms(bp.starts_at) ? { s: ms(bp.starts_at), e: ms(bp.ends_at) } : null,
    sub: typeof d.subscription_id === 'string' ? d.subscription_id : '', ctm: typeof d.customer_id === 'string' ? d.customer_id : '',
    origin: String(d.origin || ''), cur: String(d.currency_code || ''), total: Number(d.details?.totals?.total) || 0
  };
  if (items.length > 1) {
    /* a basket: each line by its id, product and total; delivered only if every line is a different one-off product, one of
       each, and Paddle named every line */
    const lines = Array.isArray(d.details?.line_items) ? d.details.line_items : [];
    const units = lines.map(l => ({ i: typeof l?.id === 'string' ? l.id : '', p: byPrice[String(l?.price_id || l?.price?.id || '')] || '', q: l?.quantity, tot: Number(l?.totals?.total) || 0 }));
    out.product = BASKET; out.products = units.map(u => u.p);
    out.items = units.map(({ i, p, tot }) => ({ i, p, tot }));
    out.ok = units.length === items.length && units.every(u => /^txnitm_[a-z0-9]{8,64}$/.test(u.i) && BASKETABLE.includes(u.p) && (u.q == null || u.q === 1))
      && new Set(units.map(u => u.p)).size === units.length && new Set(units.map(u => u.i)).size === units.length;
    return out;
  }
  out.price = one ? String(one.price?.id || one.price_id || '') : '';
  out.product = byPrice[out.price] || '';
  out.products = out.product ? [out.product] : [];
  out.ok = !!out.product && !!one && (one.quantity == null || one.quantity === 1);
  return out;
}
export function subFacts(d) {
  const bp = d.current_billing_period, sc = d.scheduled_change;
  return {
    id: String(d.id || ''), status: String(d.status || ''),
    period: bp && ms(bp.starts_at) && ms(bp.ends_at) ? { s: ms(bp.starts_at), e: ms(bp.ends_at) } : null,
    cancelAt: sc && sc.action === 'cancel' ? ms(sc.effective_at) : 0,
    next: ms(d.next_billed_at), canceledAt: ms(d.canceled_at),
    firstTxn: typeof d.transaction_id === 'string' ? d.transaction_id : '',
    ctm: typeof d.customer_id === 'string' ? d.customer_id : ''
  };
}
/* whole or not: a refund made in Paddle's dashboard comes as type 'partial' even when it gives back every item in full
   (a live €2.99 refund did), so for a transaction of one item an adjustment whose items are each refunded in full is the
   whole transaction (type). A basket has several lines, so the adjustment also keeps whether Paddle adjusted the whole
   transaction (all) and which lines it gave back in full (full: their ids) */
export function adjFacts(d) {
  const items = Array.isArray(d.items) ? d.items : [];
  const whole = d.type !== 'partial' || (items.length > 0 && items.every(i => i && i.type === 'full'));
  return { id: String(d.id || ''), txn: String(d.transaction_id || ''), sub: typeof d.subscription_id === 'string' ? d.subscription_id : '',
    action: String(d.action || ''), type: whole ? 'full' : 'partial', status: String(d.status || ''),
    all: d.type !== 'partial', full: items.filter(i => i && i.type === 'full' && typeof i.item_id === 'string').map(i => i.item_id).slice(0, 50) };
}

/* whether an adjustment reaches a line (txUnits): a transaction of one item by its type, as always; a basket's line when
   the whole transaction was adjusted, or that line was given back in full */
const reaches = (a, u) => !u || !u.i ? a.type === 'full'
  : a.all === true || (a.all == null && a.type === 'full') || (Array.isArray(a.full) && a.full.includes(u.i));
/* a refund of the whole transaction (or, given a basket's line, of that line), as it stands: '' (none), 'pending',
   'approved', 'rejected' */
export function refundState(txn, adjs, u) {
  const r = adjs.filter(a => a.txn === txn && a.action === 'refund' && reaches(a, u));
  return r.some(a => a.status === 'approved') ? 'approved' : r.some(a => a.status === 'pending_approval') ? 'pending'
    : r.some(a => a.status === 'rejected') ? 'rejected' : '';
}
/* the payment (or a basket's line) no longer counts: refunded in full, or charged back (and not won back): a chargeback
   takes back the whole transaction */
export function voided(txn, adjs, u) {
  if (refundState(txn, adjs, u) === 'approved') return true;
  const mine = adjs.filter(a => a.txn === txn);
  return mine.some(a => a.action === 'chargeback' && a.status === 'approved') && !mine.some(a => a.action === 'chargeback_reverse' && a.status === 'approved');
}
export const founderInTime = t => t.created > 0 && t.created < FOUNDER_CUTOFF && t.paid > 0 && t.paid < FOUNDER_CUTOFF + FOUNDER_GRACE;

/* k calendar months on, in UTC, counted from the same day (31 January → 28 or 29 February, and 31 March a month later) */
export function addMonths(t, k) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + k, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
export const addMonth = t => addMonths(t, 1);

/* a paid period cut into calendar months, for the monthly pick (a year gives twelve). Each month is counted from the
   period's first day: stepping a month at a time from the last would lose the 29th–31st at February for good, and leave
   a year begun on those days a thirteenth month of a day or two. What is left after the last whole month, up to TAIL
   (a period that ends a day or two past its anniversary), belongs to that month and is no month of its own. */
const TAIL = 3 * 864e5;
export function months(p) {
  const out = [];
  for (let k = 1, a = p.s; a < p.e - 3600000; k++) {
    let b = Math.min(addMonths(p.s, k), p.e);
    if (p.e - b < TAIL) b = p.e;
    out.push({ ...p, s: a, e: b }); a = b;
  }
  return out;
}

/* What an account owns, from its records:
     txs   [{id, product, ok, ck, created, paid, period, sub, status, payer, gift, items?}]: its completed transactions (created:
           when this server opened the checkout; ck: it did; payer: who paid, when another account gave it as a gift;
           items: a basket's lines, each delivered, refunded and charged back on its own terms: txUnits)
     adjs  [{txn, action, type, status, all?, full?}]: adjustments to them
     subs  {id: {status, period, cancelAt, next, firstTxn, dup}}: its subscriptions
     picks {periodStart: cosmetic}: the Chancery Club's monthly picks
     now   the server's time: which paid months to keep for picking (without it, the last three)
     comp  {at, until}: a membership an admin granted for free (shopComp/{uid}), counted like a paid one
     prizes [when]: months of the Club won in the game (shopPrize/{uid}: the flag competition), each when it was won
     fgift {p, at}: the pack a founder chose as the thank-you gift (shopFGift/{uid}), owned from then while the Founder's
           Package is; a payment for the same pack made after the choice is a second payment, and refunded (in a basket,
           that line only)
   → {owns: {founder?, idpack?: when paid}, fgift?: the pack the gift gave, vip: null | {until, from, runs: [{s, e}], per: [{s, e}], status, plan, cancelAt, renews, n, m, f},
      gifts: [{p, from, t, txn}], refunds: [{txn, why, item?, p?}], cancels: [{sub, why}], notes: [{k, txn, t, st, p?}], cosmetics: [ids shown to other players]}
   A month of the Club given as a gift begins when it is paid, or where the membership already paid for ends; a month
   won begins the same way, after whatever is paid, given or granted, so it is never spent on days already covered. */
export function entitlement({ txs = [], adjs = [], subs = {}, picks = {}, now, comp = null, prizes = [], fgift = null }) {
  const out = { owns: {}, vip: null, gifts: [], refunds: [], cancels: [], notes: [], cosmetics: [] };
  /* a checkout this server opened, or a renewal of a subscription one of those started */
  const valid = txs.filter(t => t.status === 'completed' && t.ok && (t.ck || t.sub && subs[t.sub]));
  /* a refund the rules call for: of the whole transaction, or of one of a basket's lines (item: Paddle's line id), so the
     rest of the basket stays delivered */
  const refund = (t, why, u) => {
    const line = u && u.i ? { item: u.i, p: u.p } : null, st = refundState(t.id, adjs, u);
    if (!st) out.refunds.push({ txn: t.id, why, ...line });
    out.notes.push({ k: why, txn: t.id, t: t.paid, st: st || 'asked', ...(line ? { p: u.p } : {}) });
  };
  /* what delivered each product: the transaction and its line */
  const owners = {};
  for (const p of ONCE) {
    let owner = null;
    const lines = valid.filter(t => t.ck).flatMap(t => txUnits(t).filter(u => u.p === p && !voided(t.id, adjs, u)).map(u => ({ t, u }))).sort((a, b) => a.t.paid - b.t.paid);
    for (const { t, u } of lines) {
      const st = refundState(t.id, adjs, u), turnedDown = st === 'rejected';
      /* money on its way back delivers nothing (a membership's month counts until its refund is made) */
      if (st === 'pending') { out.notes.push({ k: 'refund', txn: t.id, t: t.paid, st: 'pending', ...(u.i ? { p } : {}) }); continue; }
      if (p === 'founder' && !founderInTime(t) && !turnedDown) { refund(t, 'late', u); continue; }
      if (!owner) owner = { t, u };
      else if (!turnedDown) refund(t, 'duplicate', u);
    }
    if (owner) { out.owns[p] = owner.t.paid; owners[p] = owner; }
  }
  /* the founders' thank-you gift: the chosen pack, while the Founder's Package is owned. Paid for before it was chosen
     (two tabs; the choice is refused otherwise), the gift adds nothing; paid for after, that payment is the second one
     (in a basket, only its line is refunded) */
  if (fgift && out.owns.founder && FOUNDER_GIFT.packs.includes(fgift.p) && Number.isFinite(fgift.at) && fgift.at > 0) {
    const o = owners[fgift.p], later = o && o.t.paid > fgift.at && refundState(o.t.id, adjs, o.u) !== 'rejected';
    if (later) refund(o.t, 'duplicate', o.u);
    if (!o || later) { out.owns[fgift.p] = fgift.at; out.fgift = fgift.p; }
  }
  /* the Chancery Club: every paid month that still counts. A second subscription whose first payment fell inside a
     month another live subscription had already paid for (two checkouts paid side by side) is cancelled and refunded */
  const vt = valid.filter(t => CLUB.includes(t.product) && t.sub && !voided(t.id, adjs));
  const bySub = new Map();
  for (const t of vt) {
    const yearly = CAT.products[t.product].kind === 'yearly', s = subs[t.sub] || {};
    const period = t.period || (s.firstTxn === t.id && s.period) || { s: t.paid, e: addMonths(t.paid, yearly ? 12 : 1) };
    if (!bySub.has(t.sub)) bySub.set(t.sub, []);
    bySub.get(t.sub).push({ ...period, sub: t.sub, txn: t, plan: yearly ? 'year' : 'month' });
  }
  const order = [...bySub.entries()].map(([sub, ps]) => ({ sub, ps, first: Math.min(...ps.map(p => p.txn.paid)) })).sort((a, b) => a.first - b.first);
  const kept = [];
  for (const o of order) {
    const s = subs[o.sub] || {};
    const clash = s.dup || kept.some(p => p.sub !== o.sub && p.s <= o.first && o.first < p.e && (subs[p.sub]?.status || 'active') !== 'canceled');
    if (clash) {
      if ((s.status || 'active') !== 'canceled' && !s.cancelAsked) out.cancels.push({ sub: o.sub, why: 'duplicate' });
      for (const p of o.ps) if (refundState(p.txn.id, adjs) !== 'rejected') refund(p.txn, 'duplicate');
      continue;
    }
    kept.push(...o.ps);
  }
  /* months given as gifts, one after another from where the paid membership ends */
  const cover = kept.map(p => ({ s: p.s, e: p.e }));
  for (const t of valid.filter(t => GIFT_MONTH.includes(t.product) && t.ck && !voided(t.id, adjs)).sort((a, b) => a.paid - b.paid)) {
    if (refundState(t.id, adjs) === 'pending') { out.notes.push({ k: 'refund', txn: t.id, t: t.paid, st: 'pending' }); continue; }
    let s = t.paid, c;
    while ((c = cover.find(p => p.s <= s && s < p.e))) s = c.e;
    const g = { s, e: addMonth(s), sub: '', txn: t, plan: 'gift' };
    cover.push(g); kept.push(g);
  }
  /* a membership granted by an admin: from when it was granted to when it ends, alongside whatever is paid */
  if (comp && Number.isFinite(comp.at) && Number.isFinite(comp.until) && comp.until > comp.at) { kept.push({ s: comp.at, e: comp.until, sub: '', plan: 'comp' }); cover.push({ s: comp.at, e: comp.until }); }
  /* months won: like a gift, each begins where everything above ends (a member who pays keeps the month for later) */
  for (const t of (Array.isArray(prizes) ? prizes : []).filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b)) {
    let s = t, c;
    while ((c = cover.find(p => p.s <= s && s < p.e))) s = c.e;
    const g = { s, e: addMonth(s), sub: '', plan: 'gift' };
    cover.push(g); kept.push(g);
  }
  if (kept.length) {
    /* a paid year in calendar months; a paid month stays as Paddle billed it (its end need not be a calendar month on) */
    const per = kept.flatMap(p => { const q = { s: p.s, e: p.e, sub: p.sub, plan: p.plan }; return p.plan === 'year' || p.plan === 'comp' ? months(q) : [q]; }).sort((a, b) => a.s - b.s), runs = [];
    for (const p of per) { const r = runs[runs.length - 1]; if (r && p.s <= r[1] + RUN_GAP) r[1] = Math.max(r[1], p.e); else runs.push([p.s, p.e]); }
    const last = per.reduce((a, b) => b.e > a.e ? b : a), s = subs[last.sub] || {}, gift = last.plan === 'gift' || last.plan === 'comp';
    const status = gift ? last.plan : s.status || 'active', until = runs[runs.length - 1][1];
    /* the months still to come (a paid year is picked from month by month without another word from Paddle), or the last three */
    const keep = now ? per.filter(p => p.e > now - PICK_GRACE) : [];
    /* months of membership, for the seals: each month counted once (free months an admin granted alongside paid ones add
       none), those begun by now (m), and when each of the rest begins (f: a paid year's months begin without another word
       from Paddle, so the games count them in as their day comes) */
    let m = 0, end = -Infinity;
    const f = [];
    for (const p of per) {
      if (p.s < end - 3600000) { end = Math.max(end, p.e); continue; }
      end = Math.max(end, p.e);
      if (!now || p.s <= now) m++; else f.push(p.s);
    }
    /* maps, not pairs: Firestore stores no arrays inside arrays */
    out.vip = { until, from: runs[runs.length - 1][0], runs: runs.slice(-4).map(r => ({ s: r[0], e: r[1] })), per: (keep.length ? keep.slice(0, 14) : per.slice(-3)).map(p => ({ s: p.s, e: p.e })),
      status, plan: last.plan, cancelAt: gift ? 0 : s.cancelAt || 0, renews: !gift && status === 'active' && !s.cancelAt ? s.next || 0 : 0, n: per.length, m, f: f.slice(0, 13) };
  }
  out.gifts = valid.filter(t => t.gift && t.payer && !voided(t.id, adjs)).sort((a, b) => a.paid - b.paid).slice(-10).map(t => ({ p: t.product, from: t.payer, t: t.paid, txn: t.id }));
  const grant = p => out.owns[p] ? CAT.products[p].grants : [];
  out.cosmetics = [...new Set([...ONCE.flatMap(p => grant(p)), ...Object.values(picks || {}).filter(k => CLUB_IDS.includes(k))])];
  return out;
}

/* the paid month a pick is for: the earliest month begun by now with no choice made yet, while its choice is open (until
   PICK_GRACE after the month ends), or null */
export function pickPeriod(vip, now, picks = {}) {
  const per = vip && Array.isArray(vip.per) ? vip.per : [];
  return per.filter(p => p.s <= now && now < p.e + PICK_GRACE && !(picks && picks[p.s])).sort((a, b) => a.s - b.s)[0] || null;
}
/* months of membership begun by now; a seal held now */
export function tenure(vip, now) {
  if (!vip || typeof vip !== 'object') return 0;
  return (Number(vip.m) || 0) + (Array.isArray(vip.f) ? vip.f.filter(s => s <= now).length : 0);
}
export function sealHeld(id, vip, now) {
  if (!Object.hasOwn(SEALS, id) || !vip) return false;
  return SEALS[id] ? tenure(vip, now) >= SEALS[id] : now < vip.until;
}
