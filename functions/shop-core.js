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
export const FOUNDER_CUTOFF = Date.parse(CAT.products.founder.until);
export const FOUNDER_GRACE = CAT.products.founder.graceMinutes * 60000;
export const VIP_COLLECTION = CAT.products.vip.collection;
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

/* the facts kept from Paddle's entities */
export function txFacts(d, prices) {
  const byPrice = Object.fromEntries(Object.entries(prices || {}).flatMap(([k, v]) => [].concat(v || []).map(id => [id, k])));
  const items = Array.isArray(d.items) ? d.items : [], one = items.length === 1 ? items[0] : null;
  const price = one ? String(one.price?.id || one.price_id || '') : '';
  const product = byPrice[price] || '';
  const pay = (Array.isArray(d.payments) ? d.payments : []).find(p => p && ms(p.captured_at));
  const bp = d.billing_period;
  return {
    id: String(d.id || ''), status: String(d.status || ''), product, price,
    ok: !!product && !!one && (one.quantity == null || one.quantity === 1),
    paid: ms(pay?.captured_at) || ms(d.billed_at) || ms(d.updated_at),
    period: bp && ms(bp.starts_at) && ms(bp.ends_at) > ms(bp.starts_at) ? { s: ms(bp.starts_at), e: ms(bp.ends_at) } : null,
    sub: typeof d.subscription_id === 'string' ? d.subscription_id : '', ctm: typeof d.customer_id === 'string' ? d.customer_id : '',
    origin: String(d.origin || ''), cur: String(d.currency_code || ''), total: Number(d.details?.totals?.total) || 0
  };
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
export function adjFacts(d) {
  return { id: String(d.id || ''), txn: String(d.transaction_id || ''), sub: typeof d.subscription_id === 'string' ? d.subscription_id : '',
    action: String(d.action || ''), type: d.type === 'partial' ? 'partial' : 'full', status: String(d.status || '') };
}

/* a refund of the whole transaction, as it stands: '' (none), 'pending', 'approved', 'rejected' */
export function refundState(txn, adjs) {
  const r = adjs.filter(a => a.txn === txn && a.action === 'refund' && a.type === 'full');
  return r.some(a => a.status === 'approved') ? 'approved' : r.some(a => a.status === 'pending_approval') ? 'pending'
    : r.some(a => a.status === 'rejected') ? 'rejected' : '';
}
/* the payment no longer counts: refunded in full, or charged back (and not won back) */
export function voided(txn, adjs) {
  if (refundState(txn, adjs) === 'approved') return true;
  const mine = adjs.filter(a => a.txn === txn);
  return mine.some(a => a.action === 'chargeback' && a.status === 'approved') && !mine.some(a => a.action === 'chargeback_reverse' && a.status === 'approved');
}
export const founderInTime = t => t.created > 0 && t.created < FOUNDER_CUTOFF && t.paid > 0 && t.paid < FOUNDER_CUTOFF + FOUNDER_GRACE;

/* one calendar month on, in UTC (31 January → 28 or 29 February) */
export function addMonth(t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/* What an account owns, from its records:
     txs   [{id, product, ok, ck, created, paid, period, sub, status}]: its completed transactions (created: when this
           server opened the checkout; ck: it did)
     adjs  [{txn, action, type, status}]: adjustments to them
     subs  {id: {status, period, cancelAt, next, firstTxn, dup}}: its subscriptions
     picks {periodStart: cosmetic}: the Chancery Club's monthly picks
   → {owns: {founder?, idpack?: when paid}, vip: null | {until, from, runs: [{s, e}], per: [{s, e}], status, cancelAt, renews, n},
      refunds: [{txn, why}], cancels: [{sub, why}], notes: [{k, txn, t}], cosmetics: [ids shown to other players]} */
export function entitlement({ txs = [], adjs = [], subs = {}, picks = {} }) {
  const out = { owns: {}, vip: null, refunds: [], cancels: [], notes: [], cosmetics: [] };
  /* a checkout this server opened, or a renewal of a subscription one of those started */
  const valid = txs.filter(t => t.status === 'completed' && t.ok && (t.ck || t.sub && subs[t.sub]));
  const refund = (t, why) => { const st = refundState(t.id, adjs); if (!st) out.refunds.push({ txn: t.id, why }); out.notes.push({ k: why, txn: t.id, t: t.paid, st: st || 'asked' }); };
  for (const p of ONCE) {
    let owner = null;
    for (const t of valid.filter(t => t.product === p && t.ck && !voided(t.id, adjs)).sort((a, b) => a.paid - b.paid)) {
      const turnedDown = refundState(t.id, adjs) === 'rejected';
      /* money on its way back delivers nothing (a membership's month counts until its refund is made) */
      if (refundState(t.id, adjs) === 'pending') { out.notes.push({ k: 'refund', txn: t.id, t: t.paid, st: 'pending' }); continue; }
      if (p === 'founder' && !founderInTime(t) && !turnedDown) { refund(t, 'late'); continue; }
      if (!owner) owner = t;
      else if (!turnedDown) refund(t, 'duplicate');
    }
    if (owner) out.owns[p] = owner.paid;
  }
  /* the Chancery Club: every paid month that still counts. A second subscription whose first payment fell inside a
     month another live subscription had already paid for (two checkouts paid side by side) is cancelled and refunded */
  const vt = valid.filter(t => t.product === 'vip' && t.sub && !voided(t.id, adjs));
  const bySub = new Map();
  for (const t of vt) {
    const s = subs[t.sub] || {}, period = t.period || (s.firstTxn === t.id && s.period) || { s: t.paid, e: addMonth(t.paid) };
    if (!bySub.has(t.sub)) bySub.set(t.sub, []);
    bySub.get(t.sub).push({ ...period, sub: t.sub, txn: t });
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
  if (kept.length) {
    const per = kept.map(p => ({ s: p.s, e: p.e, sub: p.sub })).sort((a, b) => a.s - b.s), runs = [];
    for (const p of per) { const r = runs[runs.length - 1]; if (r && p.s <= r[1] + RUN_GAP) r[1] = Math.max(r[1], p.e); else runs.push([p.s, p.e]); }
    const last = per.reduce((a, b) => b.e > a.e ? b : a), s = subs[last.sub] || {}, status = s.status || 'active', until = runs[runs.length - 1][1];
    /* maps, not pairs: Firestore stores no arrays inside arrays */
    out.vip = { until, from: runs[runs.length - 1][0], runs: runs.slice(-4).map(r => ({ s: r[0], e: r[1] })), per: per.slice(-3).map(p => ({ s: p.s, e: p.e })),
      status, cancelAt: s.cancelAt || 0, renews: status === 'active' && !s.cancelAt ? s.next || 0 : 0, n: per.length };
  }
  const grant = p => out.owns[p] ? CAT.products[p].grants : [];
  out.cosmetics = [...new Set([...grant('founder'), ...grant('idpack'), ...Object.values(picks || {}).filter(k => VIP_COLLECTION.includes(k))])];
  return out;
}

/* the paid month a monthly pick belongs to: the one now falls in, or null */
export function pickPeriod(vip, now) {
  const per = vip && Array.isArray(vip.per) ? vip.per : [];
  return per.find(p => p.s <= now && now < p.e) || null;
}
