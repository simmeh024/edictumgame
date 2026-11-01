// The shop's rules without Firestore or Paddle: signatures, the Founder's deadline, refunds and chargebacks,
// subscriptions and their months, duplicates in any order; the edict desk's capacity across a membership's start
// and end (the game's own syncInbox); and that the game and the server sell the same catalogue.
//   node --test test/shop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { verifySignature, signature, txFacts, subFacts, adjFacts, entitlement, pickPeriod, refundState, voided, addMonth,
  CATALOGUE, FOUNDER_CUTOFF, FOUNDER_GRACE, VIP_COLLECTION, SIG_TOLERANCE } from '../functions/shop-core.js';

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

test('monthly picks: the paid month now falls in, kept in the public list for good', () => {
  const t0 = Date.UTC(2026, 10, 2), m1 = addMonth(t0), vip = { per: [{ s: t0, e: m1 }] };
  assert.deepEqual(pickPeriod(vip, t0 + DAY), { s: t0, e: m1 }); assert.equal(pickPeriod(vip, m1), null); assert.equal(pickPeriod(null, t0), null);
  const e = entitlement({ picks: { [t0]: 'p-moire', [m1]: 'not-a-cosmetic' } });
  assert.deepEqual(e.cosmetics, ['p-moire'], 'only the collection, and kept with no membership at all');
  assert.equal(VIP_COLLECTION.length, 8);
});

test('the game sells what the server sells: every cosmetic in the catalogue is in the game, from the right source', () => {
  assert.ok(src.includes('/*SHOP_CATALOGUE*/null'), 'build.py puts the catalogue here');
  const def = new Map();
  for (const m of src.matchAll(/\['([a-z]{1,3}-[a-z]+)','(badge|pattern|frame|stamp|pin|inscription|territory|title|accent)','[^']+'\]/g)) def.set(m[1], m[2]);
  for (const m of src.matchAll(/\['(cd-[a-z]+)','[^']+'\]/g)) def.set(m[1], 'card');
  const block = src.slice(src.indexOf('const SHOP_NONE='), src.indexOf('/* the new places a cosmetic can go'));
  for (const [p, src2] of [['founder', "'founder'"], ['idpack', "'idpack'"], ['vip', "'vip'"]]) {
    const ids = p === 'vip' ? CATALOGUE.products.vip.collection : CATALOGUE.products[p].grants;
    for (const id of ids) { assert.ok(def.has(id), id + ' is drawn in the game'); assert.ok(block.includes(`'${id}'`), id); }
    assert.ok(block.includes(src2));
  }
  assert.equal(CATALOGUE.products.founder.amount, 999); assert.equal(CATALOGUE.products.idpack.amount, 299); assert.equal(CATALOGUE.products.vip.amount, 499);
  assert.equal(CATALOGUE.currency, 'EUR');
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
