// The shop's rules without Firestore or Paddle: signatures, the Founder's deadline, refunds and chargebacks,
// subscriptions and their months, duplicates in any order; the edict desk's capacity across a membership's start
// and end (the game's own syncInbox); and that the game and the server sell the same catalogue.
//   node --test test/shop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { verifySignature, signature, txFacts, subFacts, adjFacts, entitlement, pickPeriod, refundState, voided, addMonth, addMonths, months,
  CATALOGUE, FOUNDER_CUTOFF, FOUNDER_GRACE, FOUNDER_GIFT, VIP_COLLECTION, SIG_TOLERANCE, CLUB_IDS, CLUB_DROPS, clubReleased, PICK_GRACE, SEALS, tenure, sealHeld } from '../functions/shop-core.js';

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
  assert.ok(!txFacts({ id: 'txn_3', items: [{ price: { id: 'pri_founder01' } }, { price: { id: 'pri_idpack001' } }] }, prices).ok, 'two items, and Paddle named no line');
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

test('a basket: each line by its own id; delivered line by line, refunded line by line, charged back as a whole', () => {
  const prices = { founder: 'pri_founder01', idpack: 'pri_idpack001', orpack: 'pri_orpack001', sailpack: 'pri_sailpk001', vip: 'pri_vipnew01' };
  const line = (id, price, total) => ({ id, price_id: price, quantity: 1, totals: { total: String(total) } });
  const paddle = (lines, extra = {}) => ({ id: 'txn_bk', status: 'completed', items: lines.map(l => ({ price: { id: l.price_id }, quantity: 1 })), payments: [{ captured_at: '2026-11-10T10:00:00Z' }],
    details: { line_items: lines, totals: { total: String(lines.reduce((a, l) => a + Number(l.totals.total), 0)) } }, customer_id: 'ctm_1', ...extra });
  const f = txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), line('txnitm_sl000001', 'pri_sailpk001', 299)]), prices);
  assert.ok(f.ok); assert.equal(f.product, 'basket'); assert.deepEqual(f.products, ['orpack', 'sailpack']); assert.equal(f.total, 598);
  assert.deepEqual(f.items, [{ i: 'txnitm_or000001', p: 'orpack', tot: 299 }, { i: 'txnitm_sl000001', p: 'sailpack', tot: 299 }]);
  const single = txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299)]), prices);
  assert.ok(single.ok); assert.equal(single.product, 'orpack'); assert.deepEqual(single.products, ['orpack']); assert.equal(single.items, undefined, 'one item: no basket');
  assert.ok(!txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), line('txnitm_or000002', 'pri_orpack001', 299)]), prices).ok, 'the same product twice');
  assert.ok(!txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), line('txnitm_vp000001', 'pri_vipnew01', 499)]), prices).ok, 'the Club is never in a basket');
  assert.ok(!txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), line('', 'pri_sailpk001', 299)]), prices).ok, 'a line without its id');
  assert.ok(!txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), line('txnitm_xx000001', 'pri_unknown', 299)]), prices).ok, 'a price this game does not sell');
  assert.ok(!txFacts(paddle([line('txnitm_or000001', 'pri_orpack001', 299), { ...line('txnitm_sl000001', 'pri_sailpk001', 299), quantity: 2 }]), prices).ok, 'two of one');
  /* an adjustment names the lines it gives back in full */
  const a = adjFacts({ id: 'adj_b1', transaction_id: 'txn_bk', action: 'refund', type: 'partial', status: 'approved', items: [{ type: 'full', item_id: 'txnitm_sl000001' }, { type: 'partial', amount: '50', item_id: 'txnitm_or000001' }] });
  assert.equal(a.all, false); assert.deepEqual(a.full, ['txnitm_sl000001']);
  assert.equal(adjFacts({ id: 'adj_b2', transaction_id: 'txn_bk', action: 'refund', type: 'full', status: 'approved' }).all, true);

  const basket = (o = {}) => tx('txn_bk', 'basket', { items: f.items, products: f.products, ...o });
  let e = entitlement({ txs: [basket()] });
  assert.ok(e.owns.orpack && e.owns.sailpack, 'everything in it');
  assert.deepEqual(e.cosmetics.sort(), [...CATALOGUE.products.orpack.grants, ...CATALOGUE.products.sailpack.grants].sort());
  /* one line refunded from the dashboard: only that one goes; asked or pending, it delivers nothing meanwhile */
  const one = (status) => ({ txn: 'txn_bk', action: 'refund', type: 'full', status, all: false, full: ['txnitm_sl000001'] });
  for (const st of ['approved', 'pending_approval']) { e = entitlement({ txs: [basket()], adjs: [one(st)] }); assert.ok(e.owns.orpack && !e.owns.sailpack, st); assert.equal(e.refunds.length, 0); }
  assert.ok(entitlement({ txs: [basket()], adjs: [{ ...one('approved'), full: [] , type: 'partial' }] }).owns.sailpack, 'part of a line given back keeps it');
  /* the whole basket refunded, or charged back: all of it goes; a won chargeback brings all of it back */
  for (const x of [[{ txn: 'txn_bk', action: 'refund', type: 'full', status: 'approved', all: true, full: [] }], [adj('txn_bk', 'chargeback', 'approved')]]) {
    e = entitlement({ txs: [basket()], adjs: x }); assert.ok(!e.owns.orpack && !e.owns.sailpack); }
  assert.ok(entitlement({ txs: [basket()], adjs: [adj('txn_bk', 'chargeback', 'approved'), adj('txn_bk', 'chargeback_reverse', 'approved')] }).owns.orpack);
  /* a line already owned from another payment: that line is refunded on its own, and the rest of the basket stays */
  e = entitlement({ txs: [tx('txn_or', 'orpack', { paid: 100 }), basket({ paid: 200 })] });
  assert.equal(e.owns.orpack, 100); assert.ok(e.owns.sailpack);
  assert.deepEqual(e.refunds, [{ txn: 'txn_bk', why: 'duplicate', item: 'txnitm_or000001', p: 'orpack' }]);
  assert.equal(e.notes[0].p, 'orpack');
  /* the basket paid first: the single payment is the second, refunded whole */
  e = entitlement({ txs: [tx('txn_or', 'orpack', { paid: 300 }), basket({ paid: 200 })] });
  assert.deepEqual(e.refunds, [{ txn: 'txn_or', why: 'duplicate' }]);
  /* the Founder's Package in a basket paid too late: only its line is refunded; turned down, it is delivered */
  const fb = (o = {}) => tx('txn_fb', 'basket', { created: FOUNDER_CUTOFF - 1, paid: FOUNDER_CUTOFF + FOUNDER_GRACE + 1, items: [{ i: 'txnitm_fd000001', p: 'founder', tot: 999 }, { i: 'txnitm_or000009', p: 'orpack', tot: 299 }], ...o });
  e = entitlement({ txs: [fb()] });
  assert.ok(!e.owns.founder && e.owns.orpack); assert.deepEqual(e.refunds, [{ txn: 'txn_fb', why: 'late', item: 'txnitm_fd000001', p: 'founder' }]);
  e = entitlement({ txs: [fb()], adjs: [{ txn: 'txn_fb', action: 'refund', type: 'full', status: 'rejected', all: false, full: ['txnitm_fd000001'] }] });
  assert.ok(e.owns.founder && e.owns.orpack, 'nobody is charged without receiving it');
  /* the founders' thank-you gift chosen first, then the same pack paid for in a basket: only that line is refunded */
  e = entitlement({ txs: [tx('txn_fd', 'founder', { paid: 50 }), basket({ paid: 200 })], fgift: { p: 'orpack', at: 100 } });
  assert.ok(e.owns.orpack && e.owns.sailpack && e.owns.founder); assert.equal(e.fgift, 'orpack');
  assert.deepEqual(e.refunds, [{ txn: 'txn_bk', why: 'duplicate', item: 'txnitm_or000001', p: 'orpack' }]);
  /* refundState and voided by line; a transaction of one item keeps its old meaning */
  assert.equal(refundState('txn_bk', [one('approved')], { i: 'txnitm_sl000001' }), 'approved');
  assert.equal(refundState('txn_bk', [one('approved')], { i: 'txnitm_or000001' }), '');
  assert.ok(voided('txn_bk', [adj('txn_bk', 'chargeback', 'approved')], { i: 'txnitm_or000001' }));
  assert.equal(refundState('txn_a', [adj('txn_a', 'refund', 'approved')]), 'approved');
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
  for (const m of src.matchAll(/\['([a-z]{1,3}(?:-[a-z])?-[a-z]+)','(badge|pattern|frame|stamp|pin|inscription|territory|title|accent|fpat|emblem|shield|charge|card|paper|cunote|cumetal|cushape|custrip)','[^']+'\]/g)) def.set(m[1], m[2]);
  for (const m of src.matchAll(/\['(cd-[a-z]+)','[^']+'\]/g)) def.set(m[1], 'card');
  for (const m of src.matchAll(/\['(lp-i-[a-z]+)','[^']+'\]/g)) def.set(m[1], 'paper');
  for (const id of CATALOGUE.products.idpack.grants.filter(id => id.startsWith('lp-'))) assert.ok(src.includes(`'${id}':{n:`), id + ' has its paper in LP_X');
  const block = src.slice(src.indexOf('const SHOP_NONE='), src.indexOf('/* the new places a cosmetic can go'));
  for (const [p, src2] of [['founder', "'founder'"], ['idpack', "'idpack'"], ['vip', "'vip'"], ['bfpack', "'bfpack'"], ['orpack', "'orpack'"], ['sailpack', "'sailpack'"], ['cbpack', "'cbpack'"], ['tulippack', "'tulippack'"]]) {
    const ids = p === 'vip' ? CLUB_IDS : CATALOGUE.products[p].grants;
    for (const id of ids) { assert.ok(def.has(id), id + ' is drawn in the game'); assert.ok(block.includes(`'${id}'`), id); }
    assert.ok(block.includes(src2));
  }
  assert.equal(CATALOGUE.products.founder.amount, 999); assert.equal(CATALOGUE.products.idpack.amount, 299); assert.equal(CATALOGUE.products.vip.amount, 499);
  assert.equal(CATALOGUE.products.vipyear.amount, 4999); assert.equal(CATALOGUE.products.giftvip.amount, 499);
  assert.ok(CATALOGUE.products.vipyear.optional && CATALOGUE.products.giftvip.optional, 'the shop opens without them');
  assert.equal(CATALOGUE.currency, 'EUR');
  /* the Central Bank Pack's currency designs are lockable choices of the designer, each under its own piece */
  for (const [id, re] of [['cn-deco', /pat:\{[^}]*deco:'cn-deco'/], ['cn-acanthus', /acanthus:'cn-acanthus'/], ['cm-patina', /patina:'cm-patina'/], ['cs-sqhole', /sqhole:'cs-sqhole'/], ['cx-window', /4:'cx-window'/]])
    assert.ok(CATALOGUE.products.cbpack.grants.includes(id) && re.test(src), id + ' is in CU_LOCK');
  assert.ok(src.includes("'lp-i-cheque':{n:"), 'the Bank Draft paper is in LP_X');
  /* the Tulip Mania Pack: eleven pieces, its banknote engraving locked like the Central Bank Pack's, its shield sold in the Shop */
  assert.equal(CATALOGUE.products.tulippack.amount, 299); assert.equal(CATALOGUE.products.tulippack.grants.length, 11);
  assert.ok(CATALOGUE.products.tulippack.giftable && CATALOGUE.products.tulippack.optional, 'giftable, and offered once its price is set');
  assert.ok(/pat:\{[^}]*tulip:'cn-tulip'/.test(src) && CATALOGUE.products.tulippack.grants.includes('cn-tulip'), 'cn-tulip is in CU_LOCK');
  assert.ok(/CZ_SH_SHOP=\{[^}]*gable:'sh-gable'/.test(src), 'the Bell Gable shield is sold in the Shop');
  assert.ok(src.includes("'lp-i-bulb':{n:") && src.includes("case 'tulip':return S(") && src.includes("'e-tulip':'tulip'") && src.includes("'pn-auction':'<path"), 'its paper, charge, emblem and marker are drawn');
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

test('a paid year begun on the 29th–31st is twelve months, each from that day, not a thirteenth of a day', () => {
  const s = Date.UTC(2026, 7, 29, 10), e = addMonths(s, 12), m = months({ s, e, plan: 'year' });
  assert.equal(e, Date.UTC(2027, 7, 29, 10));
  assert.equal(m.length, 12);
  assert.deepEqual(m.slice(5, 8).map(p => new Date(p.s).toISOString().slice(0, 10)), ['2027-01-29', '2027-02-28', '2027-03-29']);
  assert.equal(m[11].e, e);
  assert.equal(months({ s, e: s + 365 * DAY }).length, 12, 'a year of 365 days as well');
  const j = Date.UTC(2027, 0, 31), y = months({ s: j, e: addMonths(j, 12) });
  assert.equal(y.length, 12); assert.equal(y[1].s, Date.UTC(2027, 1, 28)); assert.equal(y[2].s, Date.UTC(2027, 2, 31));
  assert.equal(addMonth(j), Date.UTC(2027, 1, 28));
});

test('a year begun on the 29th, 30th or 31st, through an ordinary or a leap February, or on a leap day: twelve months from that day', () => {
  const day = t => new Date(t).toISOString().slice(0, 10), last = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const starts = s => months({ s, e: addMonths(s, 12), plan: 'year' }).map(p => day(p.s));
  assert.deepEqual(starts(Date.UTC(2026, 7, 30, 10)), ['2026-08-30', '2026-09-30', '2026-10-30', '2026-11-30', '2026-12-30', '2027-01-30',
    '2027-02-28', '2027-03-30', '2027-04-30', '2027-05-30', '2027-06-30', '2027-07-30']);
  assert.deepEqual(starts(Date.UTC(2026, 7, 31, 10)), ['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31',
    '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31']);
  /* a leap February takes the 29th, and the 30th and 31st come back in March */
  assert.deepEqual(starts(Date.UTC(2027, 7, 29)).slice(5, 8), ['2028-01-29', '2028-02-29', '2028-03-29']);
  assert.deepEqual(starts(Date.UTC(2027, 7, 30)).slice(5, 8), ['2028-01-30', '2028-02-29', '2028-03-30']);
  assert.deepEqual(starts(Date.UTC(2027, 7, 31)).slice(5, 8), ['2028-01-31', '2028-02-29', '2028-03-31']);
  /* begun on a leap day: the 29th of every month, and the year ends on the 28th of the next February */
  const leap = Date.UTC(2028, 1, 29, 12);
  assert.equal(day(addMonths(leap, 12)), '2029-02-28');
  assert.deepEqual(starts(leap), ['2028-02-29', '2028-03-29', '2028-04-29', '2028-05-29', '2028-06-29', '2028-07-29',
    '2028-08-29', '2028-09-29', '2028-10-29', '2028-11-29', '2028-12-29', '2029-01-29']);
  /* every day of 2026 to 2028, at any hour: twelve months end to end, each on that day or its month's last */
  for (let s = Date.UTC(2026, 0, 1, 7, 30); s < Date.UTC(2029, 0, 1); s += DAY) {
    const d = new Date(s).getUTCDate(), e = addMonths(s, 12), m = months({ s, e });
    assert.equal(m.length, 12, day(s)); assert.equal(m[0].s, s); assert.equal(m[11].e, e);
    m.forEach((p, k) => {
      const at = new Date(p.s);
      if (k) assert.equal(p.s, m[k - 1].e, day(s) + ': no gap, no overlap');
      assert.equal(at.getUTCDate(), Math.min(d, last(at.getUTCFullYear(), at.getUTCMonth())), day(s) + ', month ' + (k + 1));
      assert.equal(at.getUTCHours() * 60 + at.getUTCMinutes(), 7 * 60 + 30, 'the same time of day');
      assert.ok(p.e - p.s >= 28 * DAY && p.e - p.s <= 31 * DAY, day(s) + ', month ' + (k + 1) + ' is a month long');
    });
    /* a year Paddle bills as 365 or 366 days, a day short of its anniversary or a day past it, is twelve months too */
    for (const len of [365, 366]) {
      const q = months({ s, e: s + len * DAY });
      assert.equal(q.length, 12, day(s) + ', ' + len + ' days'); assert.equal(q[11].e, s + len * DAY);
    }
  }
});

test('the months behind the seals: a paid year from the 31st, a free membership from the 31st, and gifted months, none counted twice', () => {
  const s = Date.UTC(2026, 7, 31, 10), y1 = addMonths(s, 12);
  /* a paid year as Paddle reports it, and as this server works it out when it does not (from the payment) */
  const subs = { sub_y: { status: 'active', next: y1, period: { s, e: y1 }, firstTxn: 'txn_y' } };
  for (const period of [{ s, e: y1 }, null]) {
    const e = entitlement({ txs: [tx('txn_y', 'vipyear', { sub: 'sub_y', paid: s, period })], subs: period ? subs : { sub_y: { status: 'active' } }, now: s + 70 * DAY });
    assert.equal(e.vip.until, y1); assert.equal(e.vip.n, 12, 'twelve months');
    assert.equal(e.vip.m, 3, '31 August, 30 September and 31 October have begun'); assert.equal(e.vip.f.length, 9);
    assert.deepEqual(e.vip.f.slice(0, 4), [Date.UTC(2026, 10, 30, 10), Date.UTC(2026, 11, 31, 10), Date.UTC(2027, 0, 31, 10), Date.UTC(2027, 1, 28, 10)]);
    assert.equal(tenure(e.vip, y1 - 1), 12); assert.ok(!sealHeld('csl-gold', e.vip, addMonths(s, 11) - 1)); assert.ok(sealHeld('csl-gold', e.vip, addMonths(s, 11)));
  }
  /* a free membership of three months from 31 January: three, not a fourth from the 28ths that followed February */
  const at = Date.UTC(2027, 0, 31), comp = entitlement({ comp: { at, until: addMonths(at, 3) }, now: at });
  assert.equal(comp.vip.n, 3); assert.deepEqual(comp.vip.per.map(p => p.s), [at, Date.UTC(2027, 1, 28), Date.UTC(2027, 2, 31)]);
  assert.equal(comp.vip.f.length, 2);
  /* two gifted months bought on 31 January: one month each, the second from where the first ends */
  const g = entitlement({ txs: [tx('txn_g1', 'giftvip', { paid: at }), tx('txn_g2', 'giftvip', { paid: at + H })], now: at + DAY });
  assert.equal(g.vip.n, 2); assert.equal(g.vip.until, Date.UTC(2027, 2, 28));
});

test('months won in the game: a month from where the membership so far ends, never spent on days already covered', () => {
  const t0 = Date.UTC(2026, 11, 13), m1 = addMonth(t0);
  /* no membership: the month begins when it is won, and nothing renews */
  let e = entitlement({ prizes: [t0], now: t0 + DAY });
  assert.equal(e.vip.from, t0); assert.equal(e.vip.until, m1); assert.equal(e.vip.plan, 'gift'); assert.equal(e.vip.status, 'gift'); assert.equal(e.vip.renews, 0);
  assert.equal(pickPeriod(e.vip, t0 + DAY).s, t0, 'with the month’s pick of the collection');
  /* a paying member keeps it for later: it begins where the paid month ends, and again after each renewal */
  const paid = [tx('txn_a', 'vip', { sub: 'sub_a', paid: t0 - 10 * DAY, period: { s: t0 - 10 * DAY, e: addMonth(t0 - 10 * DAY) } })];
  e = entitlement({ txs: paid, subs: { sub_a: { status: 'active', firstTxn: 'txn_a', next: addMonth(t0 - 10 * DAY) } }, prizes: [t0], now: t0 + DAY });
  assert.equal(e.vip.until, addMonth(addMonth(t0 - 10 * DAY)), 'one month after the paid one');
  const renewed = [...paid, tx('txn_b', 'vip', { sub: 'sub_a', paid: addMonth(t0 - 10 * DAY), period: { s: addMonth(t0 - 10 * DAY), e: addMonth(addMonth(t0 - 10 * DAY)) } })];
  e = entitlement({ txs: renewed, subs: { sub_a: { status: 'active', firstTxn: 'txn_a' } }, prizes: [t0], now: addMonth(t0) });
  assert.equal(e.vip.until, addMonth(addMonth(addMonth(t0 - 10 * DAY))), 'a renewal pushes the won month back, whole');
  assert.equal(e.vip.n, 3);
  /* a free membership an admin granted counts as covered too */
  e = entitlement({ comp: { at: t0 - DAY, until: t0 + 20 * DAY }, prizes: [t0], now: t0 + DAY });
  assert.equal(e.vip.until, addMonth(t0 + 20 * DAY));
  /* two wins: one month after the other; anything that is not a time is ignored */
  e = entitlement({ prizes: [addMonth(t0) - DAY, t0, NaN, 0, 'x'], now: t0 + DAY });
  assert.equal(e.vip.until, addMonth(m1)); assert.equal(e.vip.n, 2);
  assert.equal(entitlement({ prizes: [] }).vip, null); assert.equal(entitlement({}).vip, null);
});

test('the founders’ thank-you gift: one pack, free, owned while the Founder’s Package is; a later payment for it is refunded', () => {
  assert.deepEqual(FOUNDER_GIFT.packs, ['cbpack', 'sailpack', 'orpack']);
  assert.equal(FOUNDER_GIFT.until, Date.parse('2026-12-01T00:00:00Z'), 'November 2026 only');
  const f = tx('txn_f', 'founder'), at = Date.UTC(2026, 10, 10);
  let e = entitlement({ txs: [f], fgift: { p: 'cbpack', at } });
  assert.equal(e.owns.cbpack, at); assert.equal(e.fgift, 'cbpack');
  for (const id of CATALOGUE.products.cbpack.grants) assert.ok(e.cosmetics.includes(id), id + ' is shown to other players');
  assert.ok(!e.owns.sailpack && !e.owns.orpack, 'one pack only');
  /* the Founder's Package refunded: the gift goes with it */
  e = entitlement({ txs: [f], adjs: [adj('txn_f', 'refund', 'approved')], fgift: { p: 'cbpack', at } });
  assert.ok(!e.owns.cbpack && !e.fgift); assert.ok(!e.cosmetics.includes('cn-deco'));
  /* no Founder's Package, or a pack the offer does not name: nothing */
  assert.ok(!entitlement({ txs: [], fgift: { p: 'cbpack', at } }).owns.cbpack);
  assert.ok(!entitlement({ txs: [f], fgift: { p: 'bfpack', at } }).owns.bfpack);
  assert.ok(!entitlement({ txs: [f], fgift: { p: 'idpack', at } }).fgift);
  /* paid for after it was chosen (a checkout left open in another tab): the payment is the second one, and refunded */
  const later = tx('txn_s', 'sailpack', { paid: at + H });
  e = entitlement({ txs: [f, later], fgift: { p: 'sailpack', at } });
  assert.equal(e.owns.sailpack, at); assert.deepEqual(e.refunds, [{ txn: 'txn_s', why: 'duplicate' }]);
  /* its refund on its way: the gift still holds, nothing asked twice */
  e = entitlement({ txs: [f, later], adjs: [adj('txn_s', 'refund', 'pending_approval')], fgift: { p: 'sailpack', at } });
  assert.equal(e.owns.sailpack, at); assert.deepEqual(e.refunds, []);
  /* paid for before (the choice is refused then, but two tabs): the purchase stands, nothing refunded */
  const before = tx('txn_o', 'orpack', { paid: at - H });
  e = entitlement({ txs: [f, before], fgift: { p: 'orpack', at } });
  assert.equal(e.owns.orpack, at - H); assert.ok(!e.fgift); assert.deepEqual(e.refunds, []);
  /* a refund Paddle turned down: the payment stands */
  e = entitlement({ txs: [f, later], adjs: [adj('txn_s', 'refund', 'rejected')], fgift: { p: 'sailpack', at } });
  assert.equal(e.owns.sailpack, at + H); assert.deepEqual(e.refunds, []);
});

test('the founders’ gift in the game: the pop-up offers the catalogue’s packs, asks once, and is kept by the nation’s record', () => {
  assert.match(src, /function fgfOffer\(\)\{const c=shopCat\(\),g=c&&c\.founderGift/);
  assert.match(src, /NORM_HOOKS\.push\(\(n,d\)=>\{if\(d&&d\.fgs===1\)n\.fgs=1;else delete n\.fgs;\}\)/, 'n.fgs survives loading');
  assert.match(src, /shopReq\(\{step:'fgift',p\}\)/);
  for (const p of FOUNDER_GIFT.packs) assert.ok(src.includes(p + ":['"), p + ' has a line and a picture in the pop-up');
});
