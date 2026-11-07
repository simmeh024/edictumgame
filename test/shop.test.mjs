// The shop's rules without Firestore or Paddle: signatures, the Founder's deadline, refunds and chargebacks,
// subscriptions and their months, duplicates in any order; the edict desk's capacity across a membership's start
// and end (the game's own syncInbox); and that the game and the server sell the same catalogue.
//   node --test test/shop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { verifySignature, signature, txFacts, subFacts, adjFacts, entitlement, pickPeriod, refundState, voided, addMonth, addMonths, months, pickFor,
  CATALOGUE, FOUNDER_CUTOFF, FOUNDER_GRACE, VIP_COLLECTION, SIG_TOLERANCE, CLUB_IDS, CLUB_DROPS, clubReleased, PICK_GRACE, SEALS, tenure, sealHeld } from '../functions/shop-core.js';

const DAY = 864e5, H = 36e5, src = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const tx = (id, product, o = {}) => ({ id, product, ok: true, ck: true, status: 'completed', created: Date.UTC(2026, 10, 1), paid: Date.UTC(2026, 10, 1, 1), period: null, sub: '', ...o });
const adj = (txn, action, status, type = 'full') => ({ txn, action, status, type });

test('signatures: Paddle-Signature over "<ts>:<raw body>", within five minutes, any of several h1', () => {
  const raw = Buffer.from('{"event_id":"evt_01"}'), now = Date.now(), ts = Math.floor(now / 1000);
  assert.ok(verifySignature(raw, signature(raw, 'secret', ts), 'secret', now));
  assert.ok(!verifySignature(raw, signature(raw, 'other', ts), 'secret', now), 'another secret');
  assert.ok(!verifySignature(Buffer.from('{"event_id":"evt_02"}'), signature(raw, 'secret', ts), 'secret', now), 'another body');
  assert.ok(!verifySignature(raw, signature(raw, 'secret', ts - SIG_TOLERANCE - 1), 'secret', now), 'too old');
  assert.ok(verifySignature(raw, signature(raw, 'old', ts) + ';h1=' + signature(raw, 'secret', ts).split('h1=')[1], 'secret', now), 'rotation: two h1');
  for (const bad of ['', 'ts=;h1=', 'h1=abc', 'ts=1;h1=zz', null]) assert.ok(!verifySignature(raw, bad, 'secret', now));
  assert.ok(!verifySignature(raw, signature(raw, 'secret', ts), '', now), 'no secret, no trust');
});

test("Paddle's entities become facts: the product only from a known price, one item, quantity one", () => {
  const prices = { founder: 'pri_founder01', idpack: 'pri_idpack001', vip: ['pri_vipnew01', 'pri_vipold01'] };
  const t = txFacts({ id: 'txn_1', status: 'completed', items: [{ price: { id: 'pri_vipold01' }, quantity: 1 }], payments: [{ captured_at: '2026-11-02T10:00:00Z' }],
    billing_period: { starts_at: '2026-11-02T10:00:00Z', ends_at: '2026-12-02T10:00:00Z' }, subscription_id: 'sub_1', customer_id: 'ctm_1' }, prices);
  assert.equal(t.product, 'vip', 'an older price of a product still counts (renewals carry it)');
  assert.ok(t.ok); assert.equal(t.paid, Date.parse('2026-11-02T10:00:00Z')); assert.deepEqual(t.period, { s: Date.parse('2026-11-02T10:00:00Z'), e: Date.parse('2026-12-02T10:00:00Z') });
  assert.ok(!txFacts({ id: 'txn_2', items: [{ price: { id: 'pri_founder01' }, quantity: 2 }] }, prices).ok, 'two of them');
  assert.ok(!txFacts({ id: 'txn_3', items: [{ price: { id: 'pri_founder01' } }, { price: { id: 'pri_idpack001' } }] }, prices).ok, 'two items');
  assert.ok(!txFacts({ id: 'txn_4', items: [{ price: { id: 'pri_unknown' } }] }, prices).ok, 'a price this game does not sell');
  const s = subFacts({ id: 'sub_1', status: 'active', scheduled_change: { action: 'cancel', effective_at: '2026-12-02T10:00:00Z' }, transaction_id: 'txn_1' });
  assert.equal(s.cancelAt, Date.parse('2026-12-02T10:00:00Z')); assert.equal(s.firstTxn, 'txn_1');
  assert.deepEqual(adjFacts({ id: 'adj_1', transaction_id: 'txn_1', action: 'refund', type: 'partial', status: 'approved' }).type, 'partial');
  /* a refund from Paddle's dashboard: 'partial', with its one item refunded in full (as a live one came) */
  const dash = { id: 'adj_2', transaction_id: 'txn_1', action: 'refund', type: 'partial', status: 'pending_approval',
    items: [{ id: 'adjitm_1', type: 'full', amount: '299', item_id: 'txnitm_1' }], totals: { total: '299', currency_code: 'EUR' } };
  assert.equal(adjFacts(dash).type, 'full', 'every item refunded in full is the whole transaction');
  assert.equal(adjFacts({ ...dash, items: [{ id: 'adjitm_1', type: 'partial', amount: '100', item_id: 'txnitm_1' }] }).type, 'partial', 'part of an item');
  assert.equal(adjFacts({ ...dash, items: [] }).type, 'partial');
});

test('the Founder’s Package: delivered for a checkout opened before the cutoff and paid within the grace, refunded after it', () => {
  const at = (created, paid) => entitlement({ txs: [tx('txn_f', 'founder', { created, paid })] });
  assert.ok(at(FOUNDER_CUTOFF - 1, FOUNDER_CUTOFF - 1).owns.founder, 'the last moment of the sale');
  assert.ok(at(FOUNDER_CUTOFF - 1, FOUNDER_CUTOFF + FOUNDER_GRACE - 1).owns.founder, 'opened in time, paid inside the grace');
  const late = at(FOUNDER_CUTOFF - 1, FOUNDER_CUTOFF + FOUNDER_GRACE);
  assert.ok(!late.owns.founder); assert.deepEqual(late.refunds, [{ txn: 'txn_f', why: 'late' }]);
  const after = at(FOUNDER_CUTOFF, FOUNDER_CUTOFF + 1);
  assert.ok(!after.owns.founder, 'a checkout opened at the cutoff never counts'); assert.equal(after.refunds.length, 1);
  /* refund asked and still pending: not delivered, not asked again; turned down: delivered after all */
  const pending = entitlement({ txs: [tx('txn_f', 'founder', { created: FOUNDER_CUTOFF - 1, paid: FOUNDER_CUTOFF + 5 * H })], adjs: [adj('txn_f', 'refund', 'pending_approval')] });
  assert.ok(!pending.owns.founder); assert.equal(pending.refunds.length, 0);
  const rejected = entitlement({ txs: [tx('txn_f', 'founder', { created: FOUNDER_CUTOFF - 1, paid: FOUNDER_CUTOFF + 5 * H })], adjs: [adj('txn_f', 'refund', 'rejected')] });
  assert.ok(rejected.owns.founder, 'nobody is charged without receiving it');
  assert.equal(CATALOGUE.products.founder.until, '2027-02-02T00:00:00Z'); assert.equal(FOUNDER_CUTOFF, Date.UTC(2027, 1, 2));
});

test('refunds and chargebacks take back what they paid for; a won chargeback gives it back; partial refunds do not', () => {
  const t = [tx('txn_a', 'founder')];
  assert.ok(entitlement({ txs: t }).owns.founder);
  assert.ok(!entitlement({ txs: t, adjs: [adj('txn_a', 'refund', 'approved')] }).owns.founder);
  assert.ok(entitlement({ txs: t, adjs: [adj('txn_a', 'refund', 'approved', 'partial')] }).owns.founder);
  assert.ok(!entitlement({ txs: t, adjs: [adj('txn_a', 'chargeback', 'approved')] }).owns.founder);
  assert.ok(entitlement({ txs: t, adjs: [adj('txn_a', 'chargeback', 'approved'), adj('txn_a', 'chargeback_reverse', 'approved')] }).owns.founder);
  assert.ok(entitlement({ txs: t, adjs: [adj('txn_a', 'chargeback_warning', 'approved')] }).owns.founder, 'a warning is not a chargeback');
  assert.equal(refundState('txn_a', [adj('txn_a', 'refund', 'rejected'), adj('txn_a', 'refund', 'approved')]), 'approved');
  assert.ok(!voided('txn_b', [adj('txn_a', 'refund', 'approved')]));
  const fin = entitlement({ txs: t, adjs: [adj('txn_a', 'refund', 'approved')] });
  assert.equal(fin.cosmetics.length, 0, 'the public list loses them too');
});

test('a second payment for something owned is refunded, whichever arrives first; a purchase this server never opened never counts', () => {
  const a = tx('txn_a', 'idpack', { paid: 100 }), b = tx('txn_b', 'idpack', { paid: 200 });
  for (const txs of [[a, b], [b, a]]) {
    const e = entitlement({ txs });
    assert.equal(e.owns.idpack, 100); assert.deepEqual(e.refunds, [{ txn: 'txn_b', why: 'duplicate' }]);
  }
  /* the first refunded: the second now owns it, and nothing more is refunded */
  const e = entitlement({ txs: [a, b], adjs: [adj('txn_a', 'refund', 'approved'), adj('txn_b', 'refund', 'pending_approval')] });
  assert.ok(!e.owns.idpack, 'the second is on its way back too: a payment with a refund pending delivers nothing');
  assert.ok(!entitlement({ txs: [tx('txn_x', 'founder', { ck: false })] }).owns.founder, 'not opened by this server');
  assert.ok(!entitlement({ txs: [tx('txn_y', 'founder', { ok: false })] }).owns.founder, 'wrong item');
  assert.deepEqual(entitlement({ txs: [tx('txn_z', 'idpack')] }).cosmetics, CATALOGUE.products.idpack.grants);
});

test('the Chancery Club: paid months, renewals, a scheduled cancellation, a failed renewal and a refunded month', () => {
  const t0 = Date.UTC(2026, 10, 2, 10), m1 = addMonth(t0), m2 = addMonth(m1);
  const first = tx('txn_v1', 'vip', { sub: 'sub_1', paid: t0, period: { s: t0, e: m1 } });
  const subs = { sub_1: { status: 'active', next: m1, firstTxn: 'txn_v1' } };
  let e = entitlement({ txs: [first], subs });
  assert.equal(e.vip.until, m1); assert.equal(e.vip.from, t0); assert.equal(e.vip.renews, m1); assert.equal(e.vip.status, 'active');
  /* the renewal arrives first, the first payment after: the same months */
  const renew = tx('txn_v2', 'vip', { sub: 'sub_1', ck: false, paid: m1, period: { s: m1, e: m2 } });
  for (const txs of [[first, renew], [renew, first]]) { e = entitlement({ txs, subs }); assert.equal(e.vip.until, m2); assert.equal(e.vip.from, t0); assert.equal(e.vip.n, 2); assert.deepEqual(e.vip.runs, [{ s: t0, e: m2 }]); }
  /* cancelled at the end of the month: still a member until then, no renewal date */
  e = entitlement({ txs: [first], subs: { sub_1: { status: 'active', cancelAt: m1, next: 0 } } });
  assert.equal(e.vip.until, m1); assert.equal(e.vip.cancelAt, m1); assert.equal(e.vip.renews, 0);
  /* a renewal that never got paid (past due) adds nothing: membership ends with the paid month */
  e = entitlement({ txs: [first], subs: { sub_1: { status: 'past_due', next: m1 } } });
  assert.equal(e.vip.until, m1); assert.equal(e.vip.status, 'past_due'); assert.equal(e.vip.renews, 0);
  /* the renewal refunded: back to the first month */
  e = entitlement({ txs: [first, renew], subs, adjs: [adj('txn_v2', 'refund', 'approved')] });
  assert.equal(e.vip.until, m1);
  /* no billing period on the first payment: the subscription's, or a calendar month */
  e = entitlement({ txs: [{ ...first, period: null }], subs: { sub_1: { status: 'active', firstTxn: 'txn_v1', period: { s: t0, e: m1 + 5 } } } });
  assert.equal(e.vip.until, m1 + 5);
  e = entitlement({ txs: [{ ...first, period: null }], subs: { sub_1: { status: 'active' } } });
  assert.equal(e.vip.until, addMonth(t0)); assert.equal(addMonth(Date.UTC(2027, 0, 31)), Date.UTC(2027, 1, 28));
  /* a lapse, then a new subscription: two runs, the latest counts for "from" */
  const late = Date.UTC(2027, 2, 10), sub2 = tx('txn_w1', 'vip', { sub: 'sub_2', paid: late, period: { s: late, e: addMonth(late) } });
  e = entitlement({ txs: [first, sub2], subs: { sub_1: { status: 'canceled' }, sub_2: { status: 'active', next: addMonth(late) } } });
  assert.equal(e.vip.from, late); assert.equal(e.vip.runs.length, 2); assert.equal(e.cancels.length, 0, 'rejoining is not a duplicate');
});

test('two subscriptions paid side by side: the second is cancelled and refunded, in either order', () => {
  const t0 = Date.UTC(2026, 10, 2, 10), m1 = addMonth(t0);
  const a = tx('txn_a', 'vip', { sub: 'sub_a', paid: t0, period: { s: t0, e: m1 } }), b = tx('txn_b', 'vip', { sub: 'sub_b', paid: t0 + 60000, period: { s: t0 + 60000, e: m1 + 60000 } });
  for (const txs of [[a, b], [b, a]]) {
    const e = entitlement({ txs, subs: { sub_a: { status: 'active' }, sub_b: { status: 'active' } } });
    assert.deepEqual(e.cancels, [{ sub: 'sub_b', why: 'duplicate' }]); assert.deepEqual(e.refunds, [{ txn: 'txn_b', why: 'duplicate' }]); assert.equal(e.vip.until, m1);
  }
  const done = entitlement({ txs: [a, b], subs: { sub_a: { status: 'active' }, sub_b: { status: 'canceled', dup: true, cancelAsked: 1 } }, adjs: [adj('txn_b', 'refund', 'pending_approval')] });
  assert.equal(done.cancels.length, 0); assert.equal(done.refunds.length, 0, 'asked once');
});

test('monthly picks: one per paid month, open until five weeks after it ends, kept in the public list for good', () => {
  const t0 = Date.UTC(2026, 10, 2), m1 = addMonth(t0), m2 = addMonth(m1), vip = { per: [{ s: t0, e: m1 }, { s: m1, e: m2 }] };
  assert.deepEqual(pickPeriod(vip, t0 + DAY), { s: t0, e: m1 }); assert.equal(pickPeriod(null, t0), null);
  assert.equal(pickPeriod(vip, t0 - DAY), null, 'not before the month begins');
  assert.equal(pickPeriod(vip, t0 + DAY, { [t0]: 'p-moire' }), null, 'chosen: the next month is not open yet');
  assert.deepEqual(pickPeriod(vip, m1 + DAY), { s: t0, e: m1 }, 'a month not chosen for comes first, while its choice is open');
  assert.deepEqual(pickPeriod(vip, m1 + DAY, { [t0]: 'p-moire' }), { s: m1, e: m2 });
  assert.equal(PICK_GRACE, 35 * DAY);
  assert.deepEqual(pickPeriod({ per: [{ s: t0, e: m1 }] }, m1 + PICK_GRACE - 1), { s: t0, e: m1 });
  assert.equal(pickPeriod({ per: [{ s: t0, e: m1 }] }, m1 + PICK_GRACE), null, 'a choice not made by then lapses');
  const e = entitlement({ picks: { [t0]: 'p-moire', [m1]: 'not-a-cosmetic', [m2]: 'a-petrol' } });
  assert.deepEqual(e.cosmetics, ['p-moire', 'a-petrol'], 'only the collection (released later pieces too), and kept with no membership at all');
  assert.equal(VIP_COLLECTION.length, 8);
});

test('the collection grows: two pieces at the start of each month, never one twice, none sold elsewhere', () => {
  assert.ok(CLUB_DROPS.length >= 6, 'at least six months of new pieces');
  assert.equal(new Set(CLUB_IDS).size, CLUB_IDS.length, 'no piece twice');
  assert.equal(CLUB_IDS.length, VIP_COLLECTION.length + CLUB_DROPS.reduce((a, d) => a + d.ids.length, 0));
  for (const d of CLUB_DROPS) {
    assert.equal(d.ids.length, 2, 'two pieces each month');
    const t = new Date(d.from);
    assert.ok(t.getUTCDate() === 1 && t.getUTCHours() === 0 && t.getUTCMinutes() === 0, 'at the start of a month, UTC');
  }
  for (let i = 1; i < CLUB_DROPS.length; i++) assert.equal(CLUB_DROPS[i].from, addMonth(CLUB_DROPS[i - 1].from), 'one month after another, no gap');
  const first = CLUB_DROPS[0].from;
  assert.deepEqual(clubReleased(first - 1), VIP_COLLECTION);
  assert.deepEqual(clubReleased(first), [...VIP_COLLECTION, ...CLUB_DROPS[0].ids]);
  assert.deepEqual(clubReleased(CLUB_DROPS.at(-1).from).sort(), [...CLUB_IDS].sort());
  /* a member from the first day, choosing every month, always has something left to choose while new pieces come */
  for (let k = 0; k < CLUB_DROPS.length + 1; k++) {
    const at = CLUB_DROPS[0].from + k * 31 * DAY - DAY;
    assert.ok(clubReleased(at).length > k + 1, 'month ' + (k + 1) + ' still has a piece to choose');
  }
  /* a new piece is defined by the Shop alone, not also by another part of the game */
  for (const id of CLUB_DROPS.flatMap(d => d.ids)) assert.ok(!src.includes(`'${id}':{k:`), id + ' is not also an unlock elsewhere');
});

test('months of membership and the Chancery seals', () => {
  const t0 = Date.UTC(2026, 10, 3), y1 = Array.from({ length: 12 }).reduce(addMonth, t0);
  assert.deepEqual(SEALS, { 'csl-member': 0, 'csl-brass': 3, 'csl-silver': 6, 'csl-gold': 12, 'csl-grand': 24 });
  /* a paid year: its months count as each begins, not all at once */
  const subs = { sub_y: { status: 'active', next: y1, period: { s: t0, e: y1 }, firstTxn: 'txn_y' } };
  const year = tx('txn_y', 'vipyear', { sub: 'sub_y', paid: t0, period: { s: t0, e: y1 } });
  const e = entitlement({ txs: [year], subs, now: t0 + DAY });
  assert.equal(e.vip.m, 1); assert.equal(e.vip.f.length, 11);
  assert.equal(tenure(e.vip, t0 + DAY), 1);
  const m3 = Array.from({ length: 3 }).reduce(addMonth, t0), m6 = Array.from({ length: 6 }).reduce(addMonth, t0);
  assert.equal(tenure(e.vip, m3 - 1), 3); assert.equal(tenure(e.vip, m3), 4);
  assert.ok(sealHeld('csl-member', e.vip, t0 + DAY)); assert.ok(!sealHeld('csl-brass', e.vip, t0 + DAY));
  assert.ok(sealHeld('csl-brass', e.vip, m3 - 1), 'the third month has begun'); assert.ok(sealHeld('csl-silver', e.vip, m6 - 1));
  assert.ok(!sealHeld('csl-gold', e.vip, y1 - DAY + 1) || tenure(e.vip, y1 - 1) >= 12);
  assert.equal(tenure(e.vip, y1 - 1), 12);
  assert.ok(!sealHeld('csl-member', e.vip, y1), 'the plain seal ends with the membership');
  assert.ok(sealHeld('csl-gold', e.vip, y1 + 400 * DAY), 'a seal for months of membership is kept');
  assert.ok(!sealHeld('csl-nope', e.vip, t0 + DAY)); assert.ok(!sealHeld('csl-member', null, t0));
  /* a refunded month counts no more */
  const t1 = addMonth(t0), t2 = addMonth(t1);
  const months = [tx('txn_1', 'vip', { sub: 'sub_m', paid: t0, period: { s: t0, e: t1 } }), tx('txn_2', 'vip', { sub: 'sub_m', paid: t1, period: { s: t1, e: t2 } })];
  assert.equal(entitlement({ txs: months, subs: { sub_m: { status: 'active', firstTxn: 'txn_1' } }, now: t1 + DAY }).vip.m, 2);
  assert.equal(entitlement({ txs: months, subs: { sub_m: { status: 'active', firstTxn: 'txn_1' } }, adjs: [adj('txn_2', 'refund', 'approved')], now: t1 + DAY }).vip.m, 1);
  /* a free month an admin grants alongside a paid one adds none */
  const both = entitlement({ txs: [months[0]], subs: { sub_m: { status: 'active', firstTxn: 'txn_1' } }, comp: { at: t0 + DAY, until: t0 + 20 * DAY }, now: t0 + 2 * DAY });
  assert.equal(both.vip.m, 1);
});

test('the game sells what the server sells: every cosmetic in the catalogue is in the game, from the right source', () => {
  assert.ok(src.includes('/*SHOP_CATALOGUE*/null'), 'build.py puts the catalogue here');
  const def = new Map();
  for (const m of src.matchAll(/\['([a-z]{1,3}-[a-z]+)','(badge|pattern|frame|stamp|pin|inscription|territory|title|accent)','[^']+'\]/g)) def.set(m[1], m[2]);
  for (const m of src.matchAll(/\['(cd-[a-z]+)','[^']+'\]/g)) def.set(m[1], 'card');
  const block = src.slice(src.indexOf('const SHOP_NONE='), src.indexOf('/* the new places a cosmetic can go'));
  for (const [p, src2] of [['founder', "'founder'"], ['idpack', "'idpack'"], ['vip', "'vip'"]]) {
    const ids = p === 'vip' ? CLUB_IDS : CATALOGUE.products[p].grants;
    for (const id of ids) { assert.ok(def.has(id), id + ' is drawn in the game'); assert.ok(block.includes(`'${id}'`), id); }
    assert.ok(block.includes(src2));
  }
  assert.equal(CATALOGUE.products.founder.amount, 999); assert.equal(CATALOGUE.products.idpack.amount, 299); assert.equal(CATALOGUE.products.vip.amount, 499);
  assert.equal(CATALOGUE.products.vipyear.amount, 4999); assert.equal(CATALOGUE.products.giftvip.amount, 499);
  assert.ok(CATALOGUE.products.vipyear.optional && CATALOGUE.products.giftvip.optional, 'the shop opens without them');
  assert.equal(CATALOGUE.currency, 'EUR');
});

test('the Chancery Club yearly: a paid year, picked from month by month without another word from Paddle', () => {
  const t0 = Date.UTC(2026, 10, 3), y1 = Array.from({ length: 12 }).reduce(addMonth, t0);
  const subs = { sub_y: { status: 'active', next: y1, period: { s: t0, e: y1 }, firstTxn: 'txn_y' } };
  const year = tx('txn_y', 'vipyear', { sub: 'sub_y', paid: t0, period: { s: t0, e: y1 } });
  const e = entitlement({ txs: [year], subs, now: t0 + DAY });
  assert.equal(e.vip.until, y1); assert.equal(e.vip.plan, 'year'); assert.equal(e.vip.n, 12); assert.equal(e.vip.renews, y1);
  assert.equal(e.vip.per.length, 12, 'every month of the year is kept for picking');
  const m6 = Array.from({ length: 6 }).reduce(addMonth, t0);
  const picked = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [Array.from({ length: i }).reduce(addMonth, t0), 'p-moire']));
  assert.deepEqual(pickPeriod(e.vip, m6 + DAY, picked), { s: m6, e: addMonth(m6) }, 'the seventh month is a pick of its own');
  const open = e.vip.per.find(p => m6 + DAY < p.e + PICK_GRACE);
  assert.equal(open.s, Array.from({ length: 4 }).reduce(addMonth, t0), 'the fifth month ended under five weeks ago');
  assert.equal(pickPeriod(e.vip, m6 + DAY).s, open.s, 'the earliest month not chosen for whose choice is still open comes first');
  /* a monthly subscription paid inside the year is a second subscription: cancelled and refunded */
  const month = tx('txn_m', 'vip', { sub: 'sub_m', paid: t0 + 40 * DAY, period: { s: t0 + 40 * DAY, e: addMonth(t0 + 40 * DAY) } });
  const e2 = entitlement({ txs: [year, month], subs: { ...subs, sub_m: { status: 'active', firstTxn: 'txn_m' } }, now: t0 + 41 * DAY });
  assert.deepEqual(e2.cancels, [{ sub: 'sub_m', why: 'duplicate' }]); assert.ok(e2.refunds.some(r => r.txn === 'txn_m'));
});

test('a year begun on the 29th–31st is still twelve months, each on its first day where the month has it; choices made before keep their month', () => {
  const iso = t => new Date(t).toISOString().slice(0, 10);
  /* every first day over two years (one crossing 29 February 2028), as Paddle bills a year and as twelve calendar months */
  for (let d = Date.UTC(2026, 0, 1, 2, 7); d < Date.UTC(2028, 0, 1); d += DAY) {
    assert.equal(months({ s: d, e: d + 365 * DAY }).length, 12, `a year of 365 days from ${iso(d)}`);
    assert.equal(months({ s: d, e: addMonths(d, 12) }).length, 12, `twelve calendar months from ${iso(d)}`);
  }
  const aug29 = Date.UTC(2026, 7, 29, 2, 7);
  assert.deepEqual(months({ s: aug29, e: aug29 + 365 * DAY }).map(p => iso(p.s)), ['2026-08-29', '2026-09-29', '2026-10-29', '2026-11-29', '2026-12-29',
    '2027-01-29', '2027-02-28', '2027-03-29', '2027-04-29', '2027-05-29', '2027-06-29', '2027-07-29'], 'back on the 29th after February');
  assert.equal(iso(addMonths(Date.UTC(2028, 0, 31), 1)), '2028-02-29'); assert.equal(iso(addMonths(Date.UTC(2028, 0, 31), 2)), '2028-03-31');
  assert.equal(iso(addMonths(Date.UTC(2026, 10, 30), 3)), '2027-02-28', 'across the year end');
  /* a year paid with no period from Paddle ends a calendar year on, not three days short */
  const jan31 = Date.UTC(2027, 0, 31), y = entitlement({ txs: [tx('txn_y', 'vipyear', { sub: 'sub_y', paid: jan31 })], subs: { sub_y: { status: 'active' } }, now: jan31 + DAY });
  assert.equal(iso(y.vip.until), '2028-01-31'); assert.equal(y.vip.per.length, 12); assert.equal(iso(y.vip.per[2].s), '2027-03-31');
  /* choices made while months slipped (31 August, 30 September, 30 October …) still count for the month they were for */
  const aug31 = Date.UTC(2026, 7, 31), e = entitlement({ txs: [tx('txn_z', 'vipyear', { sub: 'sub_z', paid: aug31, period: { s: aug31, e: addMonths(aug31, 12) } })], subs: { sub_z: { status: 'active' } }, now: aug31 + DAY });
  assert.deepEqual(e.vip.per.slice(0, 3).map(p => iso(p.s)), ['2026-08-31', '2026-09-30', '2026-10-31']);
  const old = { [aug31]: 'p-moire', [Date.UTC(2026, 8, 30)]: 'a-petrol', [Date.UTC(2026, 9, 30)]: 'p-damask' }, nov5 = Date.UTC(2026, 10, 5);
  assert.equal(pickFor(old, e.vip.per[2], e.vip.per), 'p-damask', 'the choice under 30 October is the month from 31 October');
  assert.equal(pickPeriod(e.vip, nov5, old), null, 'so no month is open for a second choice');
  assert.equal(pickPeriod(e.vip, nov5, { [aug31]: 'p-moire', [Date.UTC(2026, 8, 30)]: 'a-petrol' }).s, Date.UTC(2026, 9, 31), 'one not made is still open');
  /* a month that starts days from another keeps its own choice: a start some month still has is never borrowed */
  const n2 = Date.UTC(2026, 10, 2), n4 = Date.UTC(2026, 10, 4), side = { per: [{ s: n2, e: addMonth(n2) }, { s: n4, e: addMonth(n4) }] };
  assert.deepEqual(pickPeriod(side, n4 + DAY, { [n2]: 'p-moire' }), side.per[1]);
  /* the game reads the choices the same way */
  const g = { DAY }; vm.createContext(g);
  vm.runInContext(src.slice(src.indexOf('function clubPickFor('), src.indexOf('return undefined;}', src.indexOf('function clubPickFor(')) + 18), g);
  assert.equal(g.clubPickFor(old, e.vip.per[2], e.vip.per), 'p-damask');
  assert.equal(g.clubPickFor({ [n2]: 'p-moire' }, side.per[1], side.per), undefined);
  assert.match(src, /used=cur&&clubPickFor\(picks,cur,v\.per\)/);
});

test('gifts: what was given belongs to the nation it went to; a gifted month starts where the paid membership ends', () => {
  const t0 = Date.UTC(2026, 10, 3), m1 = addMonth(t0);
  let e = entitlement({ txs: [tx('txn_g', 'idpack', { gift: true, payer: 'giver', paid: t0 })] });
  assert.ok(e.owns.idpack); assert.deepEqual(e.gifts, [{ p: 'idpack', from: 'giver', t: t0, txn: 'txn_g' }]);
  /* given twice (two friends at once): the second is refunded to whoever paid it */
  e = entitlement({ txs: [tx('txn_g', 'idpack', { gift: true, payer: 'a', paid: t0 }), tx('txn_h', 'idpack', { gift: true, payer: 'b', paid: t0 + H })] });
  assert.deepEqual(e.refunds, [{ txn: 'txn_h', why: 'duplicate' }]);
  /* two gifted months: one after the other, a pick each, and nothing renews */
  e = entitlement({ txs: [tx('txn_1', 'giftvip', { gift: true, payer: 'a', paid: t0 }), tx('txn_2', 'giftvip', { gift: true, payer: 'b', paid: t0 + DAY })], now: t0 + 2 * DAY });
  assert.equal(e.vip.until, addMonth(m1)); assert.equal(e.vip.plan, 'gift'); assert.equal(e.vip.status, 'gift'); assert.equal(e.vip.renews, 0); assert.equal(e.vip.n, 2);
  assert.equal(pickPeriod(e.vip, t0 + DAY).s, t0);
  /* a month given during a paid one waits for it to end */
  e = entitlement({ txs: [tx('txn_m', 'vip', { sub: 'sub_m', paid: t0, period: { s: t0, e: m1 } }), tx('txn_g', 'giftvip', { gift: true, payer: 'a', paid: t0 + DAY })],
    subs: { sub_m: { status: 'canceled', firstTxn: 'txn_m' } }, now: t0 + 2 * DAY });
  assert.equal(e.vip.until, addMonth(m1)); assert.deepEqual(e.vip.runs, [{ s: t0, e: addMonth(m1) }]);
  /* refunded: the month no longer counts, and the gift is no longer listed */
  e = entitlement({ txs: [tx('txn_1', 'giftvip', { gift: true, payer: 'a', paid: t0 })], adjs: [adj('txn_1', 'refund', 'approved')], now: t0 + DAY });
  assert.equal(e.vip, null); assert.deepEqual(e.gifts, []);
});

/* ── the desk: the game's own syncInbox, holidays and all ── */
function desk() {
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
  const ctx = vm.createContext({});
  vm.runInContext(`
    const CAP_BASE=5,CAP_VIP=10,EDICT_KEEP=CAP_VIP,DAY=864e5,window={},document={addEventListener(){}},NORM_HOOKS=[],S={};let VIP_RUNS=[];${src.match(/function edictCapAt\(t\) \{[^\n]*\}/)[0]}
    const clone=o=>JSON.parse(JSON.stringify(o));function incomingShared(){return [];}function sharedInto(){}
    function b1Draw(m){return {id:'e'+m.issueSeq,at:m.issueClock};}
    ${cut('const AWAY_MIN=10*60000;', 'function foundStats(')}
    this.D={syncInbox,setRuns:r=>{VIP_RUNS=r;},cap:t=>edictCapAt(t)};`, ctx);
  return ctx.D;
}
const MIN = 60000, nation = (o = {}) => ({ freq: 60, inbox: [], issueClock: 0, issueSeq: 0, ...o });
const ids = n => n.inbox.length;

test('capacity: five waiting edicts, ten while a membership is paid, at the same pace', () => {
  const D = desk(), now = Date.UTC(2026, 10, 10, 12);
  D.setRuns([]);
  let v = D.syncInbox(nation({ issueClock: now - 12 * H - MIN }), now);
  assert.equal(ids(v), 5); assert.equal(v.issueClock, now, 'a full desk restarts the clock: no hidden backlog');
  D.setRuns([[now - 30 * DAY, now + 30 * DAY]]);
  v = D.syncInbox(nation({ issueClock: now - 12 * H - MIN }), now);
  assert.equal(ids(v), 10); assert.equal(v.iqv, 1, 'marked, so a build that cuts queues may not save it');
  v = D.syncInbox(nation({ issueClock: now - 3 * H - MIN }), now);
  assert.equal(ids(v), 3, 'the same pace: three hours, three edicts'); assert.equal(v.issueClock, now - MIN);
});

test('capacity across the end of a membership: the paid hours fill to ten, the rest wait; all ten stay', () => {
  const D = desk(), now = Date.UTC(2026, 10, 10, 12);
  D.setRuns([[now - 30 * DAY, now - 3 * H + 1]]);
  let v = D.syncInbox(nation({ issueClock: now - 12 * H - MIN }), now);
  assert.equal(ids(v), 9, 'nine slots while paid (each fills up to ten), none after it ends');
  /* ten waiting, membership over: nothing is lost, nothing new arrives */
  const ten = nation({ issueClock: now - 6 * H, inbox: Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i, at: 1 })) });
  v = D.syncInbox(ten, now); assert.equal(ids(v), 10); assert.equal(v.issueClock, now);
  /* down to four: the next arrives one interval later, not a pile at once */
  const four = nation({ issueClock: now, inbox: ten.inbox.slice(0, 4) });
  assert.equal(ids(D.syncInbox(four, now + 30 * MIN)), 4); assert.equal(ids(D.syncInbox(four, now + 61 * MIN)), 5); assert.equal(ids(D.syncInbox(four, now + 10 * H)), 5);
});

test('capacity across the start of a membership: nothing from before it, ten after it; holidays still pause', () => {
  const D = desk(), now = Date.UTC(2026, 10, 10, 12), start = now - 2 * H - 30 * MIN;
  D.setRuns([[start, now + 30 * DAY]]);
  let v = D.syncInbox(nation({ issueClock: now - 12 * H - MIN }), now);
  assert.equal(ids(v), 8, 'five before it began (the rest of those slots lost), three since');
  v = D.syncInbox(nation({ issueClock: now - 400 * DAY }), now);
  assert.equal(ids(v), 8, 'a long absence: no retroactive edicts either');
  /* a holiday over the start: the time away has no slots */
  v = D.syncInbox(nation({ issueClock: now - 12 * H - MIN, away: { a: now - 6 * H, b: now - 30 * MIN } }), now);
  assert.equal(ids(v), 5, 'six slots before the holiday fill five; the holiday has none; no slot since');
  /* nothing known of a membership (offline, a stale device): a desk of ten is kept as it is */
  D.setRuns([]);
  v = D.syncInbox(nation({ issueClock: now - 2 * H, inbox: Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i, at: 1 })) }), now);
  assert.equal(ids(v), 10);
});

test('loading, saving and the stale-device paths keep up to ten waiting edicts; every queue cut uses EDICT_KEEP', () => {
  for (const f of ['function normalizeGeo(', 'function normalizeWorld(', 'function normalizeBase(']) {
    const i = src.indexOf(f), body = src.slice(i, src.indexOf('\n}\n', i));
    assert.ok(/inbox[^;]*slice\(0,EDICT_KEEP\)/.test(body), f + ' keeps ten');
  }
  assert.ok(!/(>=|<|slice\(0,)CAP\b|const CAP\b|\$\{CAP\}/.test(src), 'no use of the old constant is left');
  const cv = src.slice(src.indexOf('let placed=n.inbox.some(x=>x.id===op.is);'), src.indexOf('const tt=ISSUE_BY_ID[op.is].t;'));
  assert.ok(/splice\(i,1\);n\.inbox\.push/.test(cv), 'a planted scandal replaces one edict, never drops one without taking its place');
  assert.ok(src.includes("if (d.iqv === 1) out.iq = 1;") || fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8').includes('if (d.iqv === 1) out.iq = 1;'));
});

test('a free membership an admin grants counts as the Club, split into monthly picks, beside or without a paid one', () => {
  const at = Date.UTC(2026, 10, 4), until = at + 90 * DAY;
  const e = entitlement({ comp: { at, until }, now: at });
  assert.equal(e.vip.until, until);
  assert.equal(e.vip.plan, 'comp');
  assert.equal(e.vip.status, 'comp');
  assert.equal(e.vip.renews, 0);
  assert.ok(e.vip.per.length >= 3, 'a month at a time for the monthly pick');
  assert.ok(pickPeriod(e.vip, at + DAY));
  assert.equal(entitlement({ comp: { at, until: at }, now: at }).vip, null, 'switched off');
  const paid = entitlement({ txs: [tx('txn_a', 'vip', { sub: 'sub_a', paid: at, period: { s: at, e: addMonth(at) } })], subs: { sub_a: { status: 'active', next: addMonth(at) } }, comp: { at, until: at + 7 * DAY }, now: at });
  assert.equal(paid.vip.plan, 'month', 'the paid month outlasts a week free');
  assert.equal(paid.vip.until, addMonth(at));
});
