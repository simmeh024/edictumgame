// The Shop statistics page's counting (functions/shop-stats.js), on hand-made billing records: no emulator needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shopSummary, founderGiftSummary, parseEcb, DAY } from '../functions/shop-stats.js';

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

test('a basket counts as a sale of each product in it, each line refunded on its own', () => {
  const r = records();
  r.txs.push(tx('txn_bk', 'basket', { total: 897, products: ['orpack', 'sailpack', 'cbpack'], items: [{ i: 'txnitm_or1', p: 'orpack', tot: 299 }, { i: 'txnitm_sl1', p: 'sailpack', tot: 299 }, { i: 'txnitm_cb1', p: 'cbpack', tot: 299 }] }));
  r.adjs.push({ txn: 'txn_bk', action: 'refund', type: 'full', status: 'approved', all: false, full: ['txnitm_sl1'] });
  r.cks.push({ id: 'txn_bk', product: 'basket', products: ['orpack', 'sailpack', 'cbpack'], at: NOW - DAY, env: 'live' });
  const s = shopSummary(r, NOW, 'live'), by = Object.fromEntries(s.products.map(p => [p.k, p]));
  assert.equal(s.sold, 6 + 3); assert.equal(s.kept, 5 + 2); assert.equal(s.refunded, 1 + 1);
  assert.deepEqual(s.money, { EUR: 999 + 999 + 499 + 499 + 299 + 299, MXN: 6267 });
  assert.deepEqual(s.refundedMoney, { EUR: 299 + 299 });
  assert.equal(by.orpack.kept, 1); assert.equal(by.sailpack.refunded, 1); assert.deepEqual(by.cbpack.money, { EUR: 299 });
  assert.equal(by.sailpack.opened30, 1);
  const row = s.recent.find(x => x.id === 'txn_bk');
  assert.deepEqual(row.products, ['orpack', 'sailpack', 'cbpack']); assert.equal(row.refund, 'part refunded'); assert.equal(row.total, 897);
});

test('without an environment every record counts', () => {
  assert.equal(shopSummary(records(), NOW).sold, 7);
});

test('the founders’ thank-you gift: choices by pack, against the founders there are now', () => {
  const choices = [{ uid: 'f1', p: 'cbpack', at: NOW - DAY, fno: 1 }, { uid: 'f2', p: 'orpack', at: NOW - 2 * DAY, fno: 2 }, { uid: 'f3', p: 'cbpack', at: NOW - 3 * DAY, fno: 3 },
    { uid: 'gone', p: 'sailpack', at: NOW - 4 * DAY, fno: 4 }];
  const g = founderGiftSummary(choices, ['f1', 'f2', 'f3', 'f5', 'f6'], NOW);
  assert.deepEqual(g.packs.map(x => [x.k, x.n]), [['cbpack', 2], ['sailpack', 1], ['orpack', 1]], 'in the order the pop-up offers them');
  assert.equal(g.chosen, 4); assert.equal(g.founders, 5); assert.equal(g.waiting, 2, 'two founders have not chosen');
  assert.equal(g.open, true); assert.equal(g.until, Date.parse('2026-12-01T00:00:00Z'));
  assert.deepEqual(g.recent.map(r => r.uid), ['f1', 'f2', 'f3', 'gone'], 'newest first');
  assert.equal(g.recent.find(r => r.uid === 'gone').founder, false, 'a refunded founder keeps the choice on the list, marked');
  assert.equal(founderGiftSummary([], [], Date.parse('2026-12-01T00:00:00Z')).open, false, 'closed from 1 December');
});

test('the ECB’s reference rates: a day and each currency per euro, or nothing without a peso rate', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-11-11'>
    <Cube currency='USD' rate='1.1127'/><Cube currency='JPY' rate='177.18'/><Cube currency='MXN' rate='20.7623'/><Cube currency='XXX' rate='0'/></Cube></Cube></gesmes:Envelope>`;
  assert.deepEqual(parseEcb(xml), { date: '2026-11-11', rates: { USD: 1.1127, JPY: 177.18, MXN: 20.7623 } }, 'a rate that is not positive is left out');
  assert.equal(parseEcb(xml.replace("<Cube currency='MXN' rate='20.7623'/>", '')), null);
  assert.equal(parseEcb('<html>Service unavailable</html>'), null);
  assert.equal(parseEcb(undefined), null);
});

/* the page's own money helpers (game/edictum.html), run on their own */
function pageMoney() {
  const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
  const a = src.indexOf('function shMoney('), b = src.indexOf('/* where the peso figures come from */', a);
  assert.ok(a > 0 && b > a);
  const ctx = vm.createContext({ stN: v => String(v), Intl });
  vm.runInContext(src.slice(a, b) + ';this.T={shTo,shTwo,shSumTwo,shAsPaid,shOther};', ctx);
  return ctx.T;
}
test('every amount in euro and peso, converted at the ECB rate; what has no rate stays as paid', () => {
  const T = pageMoney(), fx = { date: '2026-11-11', rates: { MXN: 20, USD: 1.25, JPY: 160 } };
  assert.equal(T.shTo(999, 'EUR', 'MXN', fx), 19980);
  assert.equal(T.shTo(20939, 'MXN', 'EUR', fx), 1047, 'MX$209.39 is €10.47 (rounded to the cent)');
  assert.equal(T.shTo(1000, 'USD', 'MXN', fx), 16000, '$10 is €8, so MX$160');
  assert.equal(T.shTo(1600, 'JPY', 'EUR', fx), 1000, 'yen have no smaller unit');
  assert.equal(T.shTo(500, 'ARS', 'EUR', fx), null, 'no ECB rate');
  assert.equal(T.shTwo(999, 'EUR', fx), '€9.99 · MX$199.80');
  assert.equal(T.shTwo(999, 'EUR', fx, true), '€9.99<span class="adsh-alt">MX$199.80</span>');
  assert.equal(T.shTwo(999, 'EUR', null), '€9.99', 'no rates: euro only');
  assert.equal(T.shSumTwo({ EUR: 299, MXN: 20939, USD: 1000 }, fx), '€21.46 · MX$429.19', '2.99 + 10.47 + 8.00 euro; 59.80 + 209.39 + 160.00 peso');
  assert.match(T.shSumTwo({ EUR: 299, ARS: 50000 }, fx), /^€2\.99 · MX\$59\.80 \+ ARS.*500\.00 <span class="hint">\(no ECB rate\)<\/span>$/);
  assert.equal(T.shSumTwo({}, fx, 'none'), 'none');
  assert.equal(T.shSumTwo({ EUR: 299, MXN: 20939 }, null), 'MX$209.39 · €2.99', 'no rates: by currency, as before');
  assert.equal(T.shAsPaid({ MXN: 20939 }), '', 'one currency of the two says nothing more');
  assert.match(T.shAsPaid({ EUR: 299, MXN: 20939 }), /as paid: MX\$209\.39 · €2\.99/);
  assert.match(T.shAsPaid({ USD: 1000 }), /as paid: US\$10\.00/);
  assert.equal(T.shOther(299, 'EUR', fx), ' <span class="hint">≈ MX$59.80</span>');
  assert.equal(T.shOther(1000, 'USD', fx), ' <span class="hint">≈ €8.00 · MX$160.00</span>');
});
