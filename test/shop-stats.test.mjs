// The Shop statistics page's counting (functions/shop-stats.js), on hand-made billing records: no emulator needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopSummary, DAY } from '../functions/shop-stats.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const tx = (id, product, o = {}) => ({ id, product, uid: 'u-' + id, status: 'completed', ck: true, paid: NOW - DAY / 2, cur: 'EUR', total: 999, env: 'live', ...o });
function records() {
  return {
    txs: [
      tx('txn_a', 'founder'),
      tx('txn_b', 'idpack', { total: 6267, cur: 'MXN', paid: NOW - 10 * DAY }),
      tx('txn_c', 'idpack', { total: 299 }),                              // refunded
      tx('txn_d', 'vip', { total: 499, sub: 'sub_1', paid: NOW - 40 * DAY }),
      tx('txn_e', 'vip', { total: 499, sub: 'sub_1', ck: false, uid: 'u-txn_d' }), // its renewal
      tx('txn_f', 'founder', { gift: true, payer: 'u-txn_a', uid: 'u-friend' }),
      tx('txn_s', 'founder', { env: 'sandbox' })                          // a sandbox test on the live shop
    ],
    subs: [{ id: 'sub_1', uid: 'u-txn_d', status: 'active', firstTxn: 'txn_d', cancelAt: NOW + 5 * DAY }, { id: 'sub_2', uid: 'u-x', status: 'canceled' }],
    adjs: [{ txn: 'txn_c', action: 'refund', type: 'full', status: 'approved' }, { txn: 'txn_b', action: 'refund', type: 'full', status: 'pending_approval' }],
    cks: [{ id: 'txn_a', product: 'founder', at: NOW - DAY, env: 'live' }, { id: 'txn_x', product: 'founder', at: NOW - DAY, env: 'live' },
      { id: 'txn_y', product: 'vip', at: NOW - 40 * DAY, env: 'live' }]
  };
}

test('sales, refunds and takings per currency', () => {
  const s = shopSummary(records(), NOW, 'live');
  assert.equal(s.sold, 6);
  assert.equal(s.kept, 5);
  assert.equal(s.refunded, 1);
  assert.equal(s.pendingRefunds, 1);
  assert.equal(s.gifts, 1);
  assert.deepEqual(s.money, { EUR: 999 + 999 + 499 + 499, MXN: 6267 });
  assert.deepEqual(s.refundedMoney, { EUR: 299 });
  assert.equal(s.listKept, 999 + 299 + 499 + 499 + 999);
  assert.equal(s.sold1, 4);
  assert.equal(s.sold30, 5);
  assert.equal(s.buyers, 4); // a, b, c, d (the gift's payer is a)
});

test('products, Club and checkouts', () => {
  const s = shopSummary(records(), NOW, 'live');
  const by = Object.fromEntries(s.products.map(p => [p.k, p]));
  assert.equal(by.founder.sold, 2);
  assert.equal(by.founder.gifts, 1);
  assert.equal(by.idpack.refunded, 1);
  assert.equal(by.vip.kept, 2);
  assert.deepEqual(s.club, { members: 1, canceling: 1, monthlyList: 499, status: { active: 1, canceled: 1 } });
  assert.deepEqual(s.checkouts, { opened30: 2, paid30: 1 });
  assert.equal(s.days.length, 60);
  assert.equal(s.days.at(-1).n, 4);
  assert.equal(s.recent[0].refund, '');
  assert.equal(s.recent.find(r => r.id === 'txn_e').renewal, true);
  assert.equal(s.recent.find(r => r.id === 'txn_c').refund, 'refunded');
});

test('without an environment every record counts', () => {
  assert.equal(shopSummary(records(), NOW).sold, 7);
});
