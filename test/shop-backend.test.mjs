// The shop's server against the emulators, with a stand-in for Paddle's API (an HTTP server in this process that the
// Functions emulator calls) and Paddle's notifications signed here as Paddle signs them.
//   npm run test:shop-backend
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { signature, FOUNDER_CUTOFF, FOUNDER_GRACE, CATALOGUE } from '../functions/shop-core.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum', AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth(), DAY = 864e5, H = 36e5, SECRET = 'pdl_ntfset_test_secret';
const PRICES = { founder: 'pri_founder0000001', idpack: 'pri_idpack00000001', vip: 'pri_vip00000000001', vipyear: 'pri_vipyear0000001', giftvip: 'pri_giftvip0000001', bfpack: 'pri_bfpack00000001', orpack: 'pri_orpack00000001', sailpack: 'pri_sailpack000001', cbpack: 'pri_cbpack00000001' };
const rid = p => p + '_' + crypto.randomBytes(13).toString('hex');

/* ── the stand-in for Paddle ── */
const P = { tx: new Map(), subs: new Map(), adj: [], calls: [] };
let base = '';
const server = http.createServer(async (req, res) => {
  let body = '';for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), b = body ? JSON.parse(body) : null, send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  P.calls.push({ m: req.method, p: u.pathname, q: u.search, b, auth: req.headers.authorization });
  if (req.headers.authorization !== 'Bearer pdl_sdbx_apikey_test') return send(403, { error: { code: 'forbidden' } });
  let m;
  if (req.method === 'POST' && u.pathname === '/transactions') {
    const t = { id: rid('txn'), status: 'ready', items: b.items.map(i => ({ price: { id: i.price_id }, quantity: i.quantity })), custom_data: b.custom_data, customer_id: b.customer_id || null, created_at: new Date().toISOString(), origin: 'api' };
    P.tx.set(t.id, t); return send(201, { data: t });
  }
  if (req.method === 'GET' && u.pathname === '/transactions') return send(200, { data: [...P.tx.values()].filter(t => t.subscription_id === u.searchParams.get('subscription_id') && t.status === 'completed') });
  if ((m = /^\/transactions\/(txn_\w+)$/.exec(u.pathname)) && req.method === 'GET') return P.tx.has(m[1]) ? send(200, { data: P.tx.get(m[1]) }) : send(404, { error: { code: 'not_found' } });
  if ((m = /^\/subscriptions\/(sub_\w+)$/.exec(u.pathname))) {
    const s = P.subs.get(m[1]);if (!s) return send(404, { error: { code: 'not_found' } });
    if (req.method === 'PATCH' && b && 'scheduled_change' in b) { s.scheduled_change = b.scheduled_change; s.updated_at = new Date().toISOString(); }
    return send(200, { data: s });
  }
  if ((m = /^\/subscriptions\/(sub_\w+)\/cancel$/.exec(u.pathname)) && req.method === 'POST') {
    const s = P.subs.get(m[1]);if (!s) return send(404, { error: { code: 'not_found' } });
    s.status = 'canceled'; s.canceled_at = new Date().toISOString(); s.updated_at = s.canceled_at; return send(200, { data: s });
  }
  if (req.method === 'POST' && u.pathname === '/adjustments') { const a = { id: rid('adj'), action: b.action, type: b.type || 'partial', transaction_id: b.transaction_id, status: 'pending_approval', reason: b.reason, items: b.items || [], updated_at: new Date().toISOString() }; P.adj.push(a); return send(201, { data: a }); }
  if (req.method === 'GET' && u.pathname === '/adjustments') { const ids = (u.searchParams.get('transaction_id') || '').split(','); return send(200, { data: P.adj.filter(a => ids.includes(a.transaction_id)) }); }
  if ((m = /^\/customers\/(ctm_\w+)\/portal-sessions$/.exec(u.pathname)) && req.method === 'POST')
    return send(201, { data: { id: 'cpls_1', customer_id: m[1], urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/cpl_test?action=overview&token=t' }, subscriptions: (b.subscription_ids || []).map(id => ({ id, cancel_subscription: 'https://sandbox-customer-portal.paddle.com/cpl_test?action=cancel&token=t', update_subscription_payment_method: 'https://sandbox-customer-portal.paddle.com/cpl_test?action=pay&token=t' })) } } });
  send(404, { error: { code: 'not_found' } });
});

/* ── helpers ── */
async function sign(method, data) { const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, returnSecureToken: true }) }); const b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return { uid: b.localId, token: b.idToken }; }
async function player(linked = true, reg = 'meridian') {
  let p;
  if (linked) { const email = `shop-${crypto.randomUUID()}@example.test`, password = 'test-only-password'; await auth.createUser({ email, password, emailVerified: true }); p = await sign('signInWithPassword', { email, password }); }
  else p = await sign('signUp', {});
  await db.doc('nations/' + p.uid).set({ v: 1, j: JSON.stringify({ reg, name: 'N' + p.uid.slice(0, 6), pop: 10, s: {} }), reg, name: 'N' + p.uid.slice(0, 6), pop: 10, army: 1, cl: 0, updatedAt: Date.now(), rev: 1, ts: new Date() });
  return p;
}
async function call(p, data) { const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.token }, body: JSON.stringify({ data: { op: 'shop', ...data } }) }); const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.details?.code, status: b.error.status }); return b.result; }
const rejects = (pr, code) => assert.rejects(pr, e => { assert.equal(e.code || e.status, code, e.message); return true; });
async function hook(type, data, { occurred = new Date().toISOString(), id = rid('evt'), secret = SECRET, raw } = {}) {
  const body = raw || JSON.stringify({ event_id: id, event_type: type, occurred_at: occurred, notification_id: rid('ntf'), data });
  const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/paddle`, { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': signature(Buffer.from(body), secret) }, body });
  return { status: r.status, id };
}
/* Paddle takes the payment: the transaction completes (and a subscription starts, for the Club) */
function pay(txnId, { at = Date.now(), ctm = 'ctm_' + crypto.randomBytes(8).toString('hex'), sub = null, period = null } = {}) {
  const t = P.tx.get(txnId);
  /* each line by its own id, as Paddle names them (a basket's lines are refunded by these) */
  const byPrice = Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [v, k]));
  const lines = t.items.map(i => ({ id: rid('txnitm'), price_id: i.price.id, quantity: i.quantity, totals: { total: String(CATALOGUE.products[byPrice[i.price.id]]?.amount || 999) } }));
  Object.assign(t, { status: 'completed', customer_id: ctm, billed_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString(), payments: [{ status: 'captured', captured_at: new Date(at).toISOString() }], currency_code: 'EUR',
    details: { line_items: lines, totals: { total: String(lines.reduce((a, l) => a + Number(l.totals.total), 0)) } } });
  if (sub) { t.subscription_id = sub; t.billing_period = { starts_at: new Date(period.s).toISOString(), ends_at: new Date(period.e).toISOString() };
    if (!P.subs.has(sub)) P.subs.set(sub, { id: sub, status: 'active', customer_id: ctm, transaction_id: txnId, current_billing_period: t.billing_period, next_billed_at: t.billing_period.ends_at, scheduled_change: null, items: [{ price: { id: PRICES.vip } }], updated_at: new Date(at).toISOString() }); }
  return t;
}
const shop = async uid => (await db.doc('shop/' + uid).get()).data() || {};
const finery = async uid => (await db.doc('finery/' + uid).get()).data();
const config = (extra = {}) => db.doc('authConfig/paddle').set({ env: 'sandbox', apiKey: 'pdl_sdbx_apikey_test', webhookSecret: SECRET, clientToken: 'test_clienttoken', prices: PRICES, api: base, ...extra });
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return v; };

before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; await config(); });
after(async () => { server.close(); await db.doc('authConfig/paddle').delete(); });

test('not set up, a guest, an unknown product: refused, and nothing reaches Paddle', async () => {
  const g = await player(false), r = await player();
  await db.doc('authConfig/paddle').delete();
  assert.equal((await call(r, { step: 'status' })).on, false);
  await rejects(call(r, { step: 'checkout', product: 'founder' }), 'shop_off');
  await config();
  const st = await call(r, { step: 'status' });
  assert.equal(st.on, true); assert.equal(st.env, 'sandbox'); assert.equal(st.token, 'test_clienttoken'); assert.equal(st.until, FOUNDER_CUTOFF); assert.deepEqual(st.catalogue, CATALOGUE);
  assert.ok(!('apiKey' in st) && !JSON.stringify(st).includes('pdl_'), 'no secret leaves the server');
  assert.deepEqual(st.prices, PRICES, 'the prices on sale, for the local-currency preview');
  const n = P.calls.length;
  await rejects(call(g, { step: 'checkout', product: 'founder' }), 'registration_required');
  await assert.rejects(call(r, { step: 'checkout', product: 'gold-bars' }), e => e.status === 'INVALID_ARGUMENT');
  assert.equal(P.calls.length, n);
});

test('the Founder’s Package: the server’s price, a signed report, ownership on every device, the public list, the checkout reused', async () => {
  const p = await player();
  const c = await call(p, { step: 'checkout', product: 'founder', price: 1 });
  assert.match(c.txn, /^txn_/); assert.equal(c.env, 'sandbox');
  const made = P.calls.find(x => x.m === 'POST' && x.p === '/transactions' && x.b.custom_data.uid === p.uid);
  assert.deepEqual(made.b.items, [{ price_id: PRICES.founder, quantity: 1 }], 'the price is the server’s'); assert.equal(made.b.custom_data.product, 'founder');
  assert.equal((await call(p, { step: 'checkout', product: 'founder' })).txn, c.txn, 'two tabs, one bill');
  assert.ok((await shop(p.uid)).pend.founder, 'awaiting confirmation on every device');
  const t = pay(c.txn);
  /* a forged or unsigned report changes nothing */
  const body = JSON.stringify({ event_id: rid('evt'), event_type: 'transaction.completed', occurred_at: new Date().toISOString(), data: t });
  assert.equal((await hook('', null, { raw: body, secret: 'not-the-secret' })).status, 401);
  assert.equal((await fetch(`http://${FN}/${PROJECT}/europe-west1/paddle`, { method: 'POST', body })).status, 401);
  assert.ok(!(await shop(p.uid)).owns?.founder);
  const ev = await hook('transaction.completed', t);
  assert.equal(ev.status, 200);
  const s = await shop(p.uid);
  assert.ok(s.owns.founder); assert.deepEqual(s.pend, {}); assert.equal(s.reg, 'meridian');
  assert.deepEqual((await finery(p.uid)).c.sort(), [...CATALOGUE.products.founder.grants].sort());
  /* the same notification again (Paddle retries): handled once */
  const adj = P.adj.length;assert.equal((await hook('transaction.completed', t, { id: ev.id })).status, 200);assert.equal(P.adj.length, adj);
  /* the notification simulator's signed sample: acknowledged, nothing stored, nothing refunded */
  const sim = await hook('transaction.completed', { ...t, id: rid('txn'), custom_data: null }, { id: rid('ntfsimevt') });
  assert.equal(sim.status, 200); assert.ok(!(await db.doc('shopEvents/' + sim.id).get()).exists); assert.equal(P.adj.length, adj);
  await rejects(call(p, { step: 'checkout', product: 'founder' }), 'owned');
  /* another device: the same account reads the same ownership */
  const again = await sign('signInWithPassword', { email: (await auth.getUser(p.uid)).email, password: 'test-only-password' });
  assert.equal(again.uid, p.uid); assert.ok((await shop(again.uid)).owns.founder);
});

test('the Founder’s deadline: the server’s clock closes the sale; a late payment is refunded, and delivered if the refund is turned down', async () => {
  const a = await player(), b = await player();
  await config({ skew: FOUNDER_CUTOFF - 60000 - Date.now() });
  const ca = await call(a, { step: 'checkout', product: 'founder' }), cb = await call(b, { step: 'checkout', product: 'founder' });
  await config({ skew: FOUNDER_CUTOFF - Date.now() });
  await rejects(call(await player(), { step: 'checkout', product: 'founder' }), 'sale_ended');
  await config();
  /* a: opened in time, paid an hour after the end: delivered */
  await hook('transaction.completed', pay(ca.txn, { at: FOUNDER_CUTOFF + H }));
  assert.ok((await shop(a.uid)).owns.founder);
  /* b: paid after the grace: refunded in full, not delivered */
  await hook('transaction.completed', pay(cb.txn, { at: FOUNDER_CUTOFF + FOUNDER_GRACE + 60000 }));
  const refund = await until(() => P.adj.find(x => x.transaction_id === cb.txn));
  assert.equal(refund.action, 'refund'); assert.equal(refund.type, 'full'); assert.match(refund.reason, /ended/);
  assert.ok(!(await shop(b.uid)).owns?.founder); assert.equal(await finery(b.uid), undefined);
  assert.ok((await shop(b.uid)).notes.some(x => x.k === 'late'));
  /* Paddle turns the refund down: the package is delivered after all */
  await hook('adjustment.updated', { ...refund, status: 'rejected' });
  assert.ok((await shop(b.uid)).owns.founder, 'nobody is charged without receiving it');
});

test('refunds, chargebacks and their reversal follow the money; reports out of order change nothing', async () => {
  const p = await player();
  const c = await call(p, { step: 'checkout', product: 'idpack' }), t = pay(c.txn);
  const adjId = rid('adj'), base0 = Date.now();
  /* the chargeback reported before the payment itself */
  await hook('adjustment.created', { id: adjId, action: 'chargeback', type: 'full', status: 'approved', transaction_id: c.txn }, { occurred: new Date(base0 + 2000).toISOString() });
  await hook('transaction.completed', t, { occurred: new Date(base0).toISOString() });
  assert.ok(!(await shop(p.uid)).owns?.idpack, 'charged back');
  await hook('adjustment.created', { id: rid('adj'), action: 'chargeback_reverse', type: 'full', status: 'approved', transaction_id: c.txn });
  assert.ok((await shop(p.uid)).owns.idpack, 'won back');
  /* an older report of the same adjustment arriving late does not undo a newer one */
  await hook('adjustment.updated', { id: adjId, action: 'chargeback', type: 'full', status: 'pending_approval', transaction_id: c.txn }, { occurred: new Date(base0).toISOString() });
  assert.equal((await db.doc('shopAdj/' + adjId).get()).get('status'), 'approved');
  await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: c.txn });
  assert.ok(!(await shop(p.uid)).owns?.idpack, 'refunded'); assert.equal(await finery(p.uid), undefined);
});

test('a refund made in Paddle’s dashboard takes the item back while it awaits approval, though Paddle calls it partial', async () => {
  const p = await player();
  const c = await call(p, { step: 'checkout', product: 'idpack' });
  await hook('transaction.completed', pay(c.txn));
  assert.ok((await shop(p.uid)).owns.idpack);
  /* shaped as the live one came: type partial, its one item refunded in full */
  const a = { id: rid('adj'), action: 'refund', type: 'partial', status: 'pending_approval', transaction_id: c.txn, subscription_id: null, reason: 'Accidental purchase',
    items: [{ id: rid('adjitm'), type: 'full', amount: '299', item_id: rid('txnitm'), proration: null }], totals: { total: '299', currency_code: 'EUR' } };
  await hook('adjustment.created', a);
  assert.ok(!(await shop(p.uid)).owns?.idpack, 'taken back on the request'); assert.equal(await finery(p.uid), undefined);
  await hook('adjustment.updated', { ...a, status: 'approved' });
  assert.ok(!(await shop(p.uid)).owns?.idpack, 'and once approved');
  /* part of the price given back keeps the item */
  const q = await player(), d = await call(q, { step: 'checkout', product: 'idpack' });
  await hook('transaction.completed', pay(d.txn));
  await hook('adjustment.created', { ...a, id: rid('adj'), transaction_id: d.txn, status: 'approved', items: [{ ...a.items[0], type: 'partial', amount: '100' }], totals: { total: '100', currency_code: 'EUR' } });
  assert.ok((await shop(q.uid)).owns.idpack, 'a partial refund keeps it');
});

test('the Chancery Club: months paid, cancellation kept to the end of the month, renewal, failed renewal, refund, portal and resume', async () => {
  const p = await player(), t0 = Date.now() - H, m1 = t0 + 30 * DAY, m2 = m1 + 30 * DAY, sub = rid('sub');
  const c = await call(p, { step: 'checkout', product: 'vip' });
  await hook('transaction.completed', pay(c.txn, { sub, period: { s: t0, e: m1 } }));
  let s = await shop(p.uid);
  assert.equal(s.vip.until, m1); assert.deepEqual(s.vip.runs, [{ s: t0, e: m1 }]); assert.equal(s.vip.status, 'active');
  await rejects(call(p, { step: 'checkout', product: 'vip' }), 'vip_active');
  /* cancelled from the portal: still a member to the end of the month */
  const ps = P.subs.get(sub);
  Object.assign(ps, { scheduled_change: { action: 'cancel', effective_at: new Date(m1).toISOString() }, updated_at: new Date().toISOString() });
  await hook('subscription.updated', ps);
  s = await shop(p.uid);
  assert.equal(s.vip.cancelAt, m1); assert.equal(s.vip.until, m1); assert.equal(s.vip.renews, 0);
  /* an older notification (from before the cancellation) arriving late changes nothing */
  await hook('subscription.updated', { ...ps, scheduled_change: null }, { occurred: new Date(Date.now() - 60000).toISOString() });
  assert.equal((await shop(p.uid)).vip.cancelAt, m1);
  /* the portal: links that come straight from Paddle; resume takes the cancellation back */
  const portal = await call(p, { step: 'portal' });
  assert.match(portal.url, /^https:\/\/sandbox-customer-portal\.paddle\.com\//); assert.match(portal.cancel, /action=cancel/);
  await call(p, { step: 'resume' });
  assert.ok(P.calls.some(x => x.m === 'PATCH' && x.p === '/subscriptions/' + sub && x.b.scheduled_change === null));
  assert.equal((await shop(p.uid)).vip.cancelAt, 0);
  /* the renewal, reported before the subscription's own update */
  const r = { id: rid('txn'), status: 'completed', origin: 'subscription_recurring', subscription_id: sub, customer_id: ps.customer_id, items: [{ price: { id: PRICES.vip }, quantity: 1 }], billing_period: { starts_at: new Date(m1).toISOString(), ends_at: new Date(m2).toISOString() }, payments: [{ captured_at: new Date(m1).toISOString() }] };
  P.tx.set(r.id, r);
  await hook('transaction.completed', r);
  s = await shop(p.uid); assert.equal(s.vip.until, m2); assert.equal(s.vip.n, 2);
  /* the next renewal fails: past due, no payment, no more months */
  Object.assign(ps, { status: 'past_due', updated_at: new Date().toISOString() });
  await hook('subscription.past_due', ps);
  s = await shop(p.uid); assert.equal(s.vip.until, m2); assert.equal(s.vip.status, 'past_due');
  /* the renewal refunded: back to one month */
  await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: r.id, subscription_id: sub });
  assert.equal((await shop(p.uid)).vip.until, m1);
});

test('two notifications at once: the newer one is kept, and the membership shows it', async () => {
  /* a cancellation from the portal, and a notification from before it, reported at the same moment, in either order:
     each reads, compares and writes in one transaction now, and the membership is worked out from what it reads in its own */
  const p = await player(), t0 = Date.now() - H, m1 = t0 + 30 * DAY, sub = rid('sub');
  const c = await call(p, { step: 'checkout', product: 'vip' });
  await hook('transaction.completed', pay(c.txn, { sub, period: { s: t0, e: m1 } }));
  const ps = P.subs.get(sub);
  for (let k = 0; k < 4; k++) {
    const at = Date.now() + k * 1000;
    const newer = () => hook('subscription.updated', { ...ps, scheduled_change: { action: 'cancel', effective_at: new Date(m1).toISOString() }, updated_at: new Date(at).toISOString() }, { occurred: new Date(at).toISOString() });
    const older = () => hook('subscription.updated', { ...ps, scheduled_change: null }, { occurred: new Date(at - 60000).toISOString() });
    await Promise.all(k % 2 ? [newer(), older()] : [older(), newer()]);
    const s = await shop(p.uid);
    assert.equal(s.vip.cancelAt, m1, 'round ' + k + ': the cancellation stands');
    assert.equal(s.vip.until, m1);
  }
});

test('two subscriptions paid side by side: the second is cancelled and refunded', async () => {
  const p = await player(), t0 = Date.now() - H, m1 = t0 + 30 * DAY;
  const c1 = await call(p, { step: 'checkout', product: 'vip' });
  P.tx.get(c1.txn).status = 'canceled';  // as if the first tab's checkout had lapsed, so the second gets a new one
  const c2 = await call(p, { step: 'checkout', product: 'vip' });
  assert.notEqual(c1.txn, c2.txn);
  P.tx.get(c1.txn).status = 'ready';
  const s1 = rid('sub'), s2 = rid('sub');
  await hook('transaction.completed', pay(c1.txn, { at: t0, sub: s1, period: { s: t0, e: m1 } }));
  await hook('transaction.completed', pay(c2.txn, { at: t0 + 60000, sub: s2, period: { s: t0 + 60000, e: m1 + 60000 } }));
  await until(() => P.calls.find(x => x.p === '/subscriptions/' + s2 + '/cancel'));
  assert.equal(P.subs.get(s2).status, 'canceled'); assert.equal(P.subs.get(s1).status, 'active');
  assert.ok(P.adj.some(a => a.transaction_id === c2.txn && a.action === 'refund'));
  assert.equal((await shop(p.uid)).vip.until, m1);
});

test('the monthly pick: one per paid month, from the collection, kept after the membership ends', async () => {
  const p = await player(), q = await player(), t0 = Date.now() - H, m1 = t0 + 30 * DAY;
  await rejects(call(q, { step: 'pick', key: 'p-moire' }), 'vip_required');
  const c = await call(p, { step: 'checkout', product: 'vip' });
  await hook('transaction.completed', pay(c.txn, { sub: rid('sub'), period: { s: t0, e: m1 } }));
  await assert.rejects(call(p, { step: 'pick', key: 'bg-founder' }), e => e.status === 'INVALID_ARGUMENT');
  const r = await call(p, { step: 'pick', key: 'p-moire' });
  assert.equal(r.key, 'p-moire'); assert.equal(r.period.s, t0);
  await rejects(call(p, { step: 'pick', key: 'f-ribbon' }), 'picked');
  assert.ok((await finery(p.uid)).c.includes('p-moire'));
  /* the month refunded: no membership, the pick stays */
  await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: c.txn });
  const s = await shop(p.uid);
  assert.equal(s.vip, undefined); assert.deepEqual(Object.values(s.picks), ['p-moire']); assert.deepEqual((await finery(p.uid)).c, ['p-moire']);
});

test('the collection grows on its day, a month’s choice stays open five weeks, and a missed one can still be made', async () => {
  const drop = CATALOGUE.products.vip.drops[0], first = Date.parse(drop.from), now0 = first - DAY;
  await config({ skew: now0 - Date.now() });
  try {
    /* one paid month that ended ten days ago, with no choice made for it */
    const p = await player(), t0 = now0 - 40 * DAY, m1 = now0 - 10 * DAY;
    const c = await call(p, { step: 'checkout', product: 'vip' });
    await hook('transaction.completed', pay(c.txn, { sub: rid('sub'), period: { s: t0, e: m1 } }));
    assert.ok((await shop(p.uid)).vip.until < now0, 'no longer a member');
    await rejects(call(p, { step: 'pick', key: drop.ids[0] }), 'not_yet');
    await assert.rejects(call(p, { step: 'pick', key: 'not-a-piece' }), e => e.status === 'INVALID_ARGUMENT');
    /* the first of the month: the new pieces can be chosen, for the month still open */
    await config({ skew: first + H - Date.now() });
    const r = await call(p, { step: 'pick', key: drop.ids[0] });
    assert.equal(r.period.s, t0);
    assert.ok((await finery(p.uid)).c.includes(drop.ids[0]));
    await rejects(call(p, { step: 'pick', key: 'p-moire' }), 'vip_required');
    /* five weeks after the month ended, a choice not made lapses */
    const q = await player(), d = await call(q, { step: 'checkout', product: 'vip' });
    await config({ skew: m1 + 35 * DAY + H - Date.now() });
    await hook('transaction.completed', pay(d.txn, { sub: rid('sub'), period: { s: t0, e: m1 } }));
    await rejects(call(q, { step: 'pick', key: 'p-moire' }), 'vip_required');
  } finally { await config(); }
});

test('Chancery seals: chosen by the player, held by months of membership, published for every game and taken down again', async () => {
  const later = () => new Promise(r => setTimeout(r, 2100));
  /* a member of one month: the wax seal, not yet brass */
  const p = await player(), t0 = Date.now() - H, sp = rid('sub');
  const c = await call(p, { step: 'checkout', product: 'vip' });
  await hook('transaction.completed', pay(c.txn, { sub: sp, period: { s: t0, e: t0 + 30 * DAY } }));
  await assert.rejects(call(p, { step: 'seal', id: 'csl-nope' }), e => e.status === 'INVALID_ARGUMENT');
  await rejects(call(p, { step: 'seal', id: 'csl-brass' }), 'seal_locked');
  await later();
  assert.equal((await finery(p.uid)), undefined, 'nothing is published before a seal is chosen');
  const r = await call(p, { step: 'seal', id: 'csl-member' });
  assert.equal(r.seal, 'csl-member');
  assert.equal((await shop(p.uid)).seal, 'csl-member');
  const f = await finery(p.uid);
  assert.deepEqual(f.cl, { s: 'csl-member', u: t0 + 30 * DAY, m: 1, f: [] }); assert.deepEqual(f.c, []); assert.equal(f.reg, 'meridian');
  await rejects(call(p, { step: 'seal', id: '' }), 'RESOURCE_EXHAUSTED');
  /* a pick keeps the seal's figures */
  await call(p, { step: 'pick', key: 'p-moire' });
  assert.deepEqual((await finery(p.uid)).cl.s, 'csl-member');
  /* a later notification keeps the choice */
  await hook('subscription.updated', P.subs.get(sp));
  assert.equal((await shop(p.uid)).seal, 'csl-member'); assert.equal((await finery(p.uid)).cl.s, 'csl-member');
  await later();
  await call(p, { step: 'seal', id: '' });
  const g = await finery(p.uid);
  assert.ok(!('cl' in g), 'taken down'); assert.deepEqual(g.c, ['p-moire']);
  /* three months of membership: brass; a record kept before months were counted is counted once on status. The year
     begins on 31 August and the server's clock stands 70 days later, so its months cross the 30ths and February the same
     way whatever day this runs (a year begun on the 29th–31st once came to thirteen months) */
  const y0 = Date.UTC(2026, 7, 31, 10), y1 = y0 + 365 * DAY;
  await config({ skew: y0 + 70 * DAY - Date.now() });
  try {
    const q = await player();
    const d = await call(q, { step: 'checkout', product: 'vipyear' }), sub = rid('sub');
    await hook('transaction.completed', pay(d.txn, { at: y0, sub, period: { s: y0, e: y1 } }));
    const v = (await shop(q.uid)).vip;
    assert.equal(v.m, 3, '31 August, 30 September and 31 October have begun'); assert.equal(v.n, 12, 'twelve months, not a thirteenth');
    assert.deepEqual(v.f.slice(0, 4), [Date.UTC(2026, 10, 30, 10), Date.UTC(2026, 11, 31, 10), Date.UTC(2027, 0, 31, 10), Date.UTC(2027, 1, 28, 10)]);
    await db.doc('shop/' + q.uid).update({ 'vip.m': FieldValue.delete() });
    await call(q, { step: 'status' });
    assert.equal((await shop(q.uid)).vip.m, 3, 'counted again');
    await call(q, { step: 'seal', id: 'csl-brass' });
    await later();
    await rejects(call(q, { step: 'seal', id: 'csl-silver' }), 'seal_locked');
    assert.equal((await finery(q.uid)).cl.s, 'csl-brass'); assert.equal((await finery(q.uid)).cl.f.length, 9, 'the year’s months still to come');
  } finally { await config(); }
  /* not a member at all */
  const x = await player();
  await rejects(call(x, { step: 'seal', id: 'csl-member' }), 'seal_locked');
});

test('reconciliation: a payment whose notification never came is found when the player checks back', async () => {
  const p = await player(), c = await call(p, { step: 'checkout', product: 'idpack' });
  pay(c.txn);
  assert.ok(!(await shop(p.uid)).owns?.idpack);
  await call(p, { step: 'refresh' });
  assert.ok((await shop(p.uid)).owns.idpack);
  await rejects(call(p, { step: 'refresh' }), 'resource-exhausted'.toUpperCase().replace(/-/g, '_'));
});

test('gifts: to a player’s nation a week old, theirs once paid, the giver named, the payer’s billing kept apart', async () => {
  const a = await player(), b = await player();
  await rejects(call(a, { step: 'checkout', product: 'idpack', to: b.uid }), 'gift_new');
  /* the record keeps its founding inside its JSON (src/shim.js encode) */
  await db.doc('nations/' + b.uid).update({ j: JSON.stringify({ reg: 'meridian', name: 'N' + b.uid.slice(0, 6), founded: Date.now() - 8 * DAY }) });
  await rejects(call(a, { step: 'checkout', product: 'idpack', to: a.uid }), 'gift_self');
  await rejects(call(a, { step: 'checkout', product: 'idpack', to: 'nosuchnation0000000000' }), 'gift_unknown');
  await assert.rejects(call(a, { step: 'checkout', product: 'vip', to: b.uid }), e => e.status === 'INVALID_ARGUMENT', 'a subscription is not given');
  await assert.rejects(call(a, { step: 'checkout', product: 'giftvip' }), e => e.status === 'INVALID_ARGUMENT', 'a gifted month needs a nation');
  const c = await call(a, { step: 'checkout', product: 'idpack', to: b.uid });
  assert.equal(c.gift, true);
  assert.equal(P.calls.find(x => x.m === 'POST' && x.p === '/transactions' && x.b.custom_data.to === b.uid).b.custom_data.uid, a.uid);
  assert.deepEqual((await shop(a.uid)).pend || {}, {}, 'a gift is not awaited by the giver');
  assert.equal((await hook('transaction.completed', pay(c.txn, { ctm: 'ctm_giver000000001' }))).status, 200);
  const s = await shop(b.uid);
  assert.ok(s.owns.idpack); assert.equal(s.gifts[0].p, 'idpack'); assert.equal(s.gifts[0].name, 'N' + a.uid.slice(0, 6));
  assert.ok(!(await shop(a.uid)).owns?.idpack, 'the giver does not own it');
  assert.equal((await db.doc('shopAcct/' + a.uid).get()).get('ctm'), 'ctm_giver000000001', 'the Paddle customer stays the payer’s');
  assert.ok(!(await db.doc('shopAcct/' + b.uid).get()).exists, 'the recipient gets no access to the payer’s billing');
  await rejects(call(a, { step: 'checkout', product: 'idpack', to: b.uid }), 'gift_owned');
  /* a month of the Club, given */
  const g = await call(a, { step: 'checkout', product: 'giftvip', to: b.uid });
  await hook('transaction.completed', pay(g.txn, { ctm: 'ctm_giver000000001' }));
  const v = (await shop(b.uid)).vip;
  assert.equal(v.plan, 'gift'); assert.ok(v.until > Date.now() + 27 * DAY); assert.equal(v.renews, 0);
  /* the card pack refunded to the giver: the recipient no longer owns it */
  await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: c.txn });
  assert.ok(!(await shop(b.uid)).owns?.idpack);
});

test('the Chancery Club yearly, and the optional products offered only once their price is set', async () => {
  const p = await player();
  await config({ prices: { founder: PRICES.founder, idpack: PRICES.idpack, vip: PRICES.vip } });
  const st = await call(p, { step: 'status' });
  assert.equal(st.on, true, 'the shop opens without the optional prices'); assert.ok(!('vipyear' in st.prices) && !('giftvip' in st.prices));
  await rejects(call(p, { step: 'checkout', product: 'vipyear' }), 'not_on_sale');
  await config();
  const c = await call(p, { step: 'checkout', product: 'vipyear' });
  assert.deepEqual(P.calls.find(x => x.m === 'POST' && x.p === '/transactions' && x.b.custom_data.uid === p.uid && x.b.custom_data.product === 'vipyear').b.items, [{ price_id: PRICES.vipyear, quantity: 1 }]);
  const sub = rid('sub'), t0 = Date.now() - H, y1 = t0 + 365 * DAY;
  await hook('transaction.completed', pay(c.txn, { sub, period: { s: t0, e: y1 } }));
  await hook('subscription.created', P.subs.get(sub));
  const v = (await shop(p.uid)).vip;
  assert.equal(v.plan, 'year'); assert.equal(v.until, y1); assert.ok(v.per.length >= 12, 'the year, month by month'); assert.ok(v.per[0].e - v.per[0].s < 32 * DAY);
  await rejects(call(p, { step: 'checkout', product: 'vip' }), 'vip_active');
  await call(p, { step: 'pick', key: 'p-moire' });
  assert.deepEqual(Object.values((await shop(p.uid)).picks), ['p-moire'], 'the first month’s pick');
});

test('a checkout closed without paying stops being awaited when the player checks; one Paddle has taken money for does not', async () => {
  const p = await player();
  await call(p, { step: 'checkout', product: 'idpack' });
  assert.ok((await shop(p.uid)).pend.idpack);
  await call(p, { step: 'refresh' });
  assert.deepEqual((await shop(p.uid)).pend || {}, {}, 'closed unpaid: nothing awaited');
  const q = await player(), d = await call(q, { step: 'checkout', product: 'founder' });
  P.tx.get(d.txn).status = 'paid';
  await call(q, { step: 'refresh' });
  assert.ok((await shop(q.uid)).pend.founder, 'paid, not yet completed: still awaited');
});

test('a purchase this game never opened is refunded; a closing account has its membership cancelled first', async () => {
  const orphan = { id: rid('txn'), status: 'completed', items: [{ price: { id: PRICES.idpack }, quantity: 1 }], customer_id: 'ctm_' + crypto.randomBytes(8).toString('hex'), custom_data: { uid: 'someone-else' }, payments: [{ captured_at: new Date().toISOString() }] };
  P.tx.set(orphan.id, orphan);
  await hook('transaction.completed', orphan);
  assert.ok(P.adj.some(a => a.transaction_id === orphan.id && a.action === 'refund' && /not started from the game/.test(a.reason)));
  assert.equal((await db.doc('shop/someone-else').get()).exists, false, 'custom data never decides an owner');
  const p = await player(), sub = rid('sub'), c = await call(p, { step: 'checkout', product: 'vip' });
  await hook('transaction.completed', pay(c.txn, { sub, period: { s: Date.now() - H, e: Date.now() + 30 * DAY } }));
  await call(p, { step: 'closing' });
  assert.equal(P.subs.get(sub).status, 'canceled');
});

test('a pack that has grown: an owner settled under an older grants version gets the new pieces when the game asks for the status', async () => {
  const p = await player(), c = await call(p, { step: 'checkout', product: 'idpack' });
  await hook('transaction.completed', pay(c.txn));
  assert.deepEqual((await finery(p.uid)).c.sort(), [...CATALOGUE.products.idpack.grants].sort(), 'every piece of the pack, papers too');
  const GV = Math.max(...Object.values(CATALOGUE.products).map(x => x.grantsV || 1));
  assert.equal((await shop(p.uid)).gv, GV);
  /* as an account settled before the pack grew: the first three cards, no version */
  await db.doc('finery/' + p.uid).update({ c: ['cd-ledger', 'cd-atlas', 'cd-civic'] });
  await db.doc('shop/' + p.uid).update({ gv: FieldValue.delete() });
  await call(p, { step: 'status' });
  assert.deepEqual((await finery(p.uid)).c.sort(), [...CATALOGUE.products.idpack.grants].sort(), 'settled again, with the new pieces');
  assert.equal((await shop(p.uid)).gv, GV);
});

test('founders are numbered by when they paid, kept on the Founders’ Wall, and get the Card Pack with the package', async () => {
  const a = await player(), b = await player();
  const ca = await call(a, { step: 'checkout', product: 'founder' }), cb = await call(b, { step: 'checkout', product: 'founder' });
  const t0 = Date.now() - 60000;
  /* the reports may come in any order: each founder gets a number of their own */
  await hook('transaction.completed', pay(cb.txn, { at: t0 + 1000 }));
  await hook('transaction.completed', pay(ca.txn, { at: t0 }));
  const na = (await shop(a.uid)).fno, nb = (await shop(b.uid)).fno;
  assert.ok(na > 0 && nb > 0 && na !== nb, `numbered: ${na}, ${nb}`);
  assert.equal((await finery(a.uid)).fno, na, 'every game can show it');
  const wall = (await db.doc('founders/' + a.uid).get()).data();
  assert.equal(wall.no, na); assert.equal(wall.reg, 'meridian'); assert.ok(wall.n, 'the nation’s name is on the wall');
  /* settling again never moves a number */
  await call(a, { step: 'refresh' }).catch(() => {});
  assert.equal((await shop(a.uid)).fno, na);
  /* the Card Pack comes with the package: its pieces are held, and it is not sold to them again */
  const c = (await finery(a.uid)).c;
  for (const id of CATALOGUE.products.idpack.grants) assert.ok(c.includes(id), id + ' comes with the Founder’s Package');
  await rejects(call(a, { step: 'checkout', product: 'idpack' }), 'owned');
});

test('the Black Friday Pack: €1.99, its three pieces held, gifts allowed, and no checkout after 30 November', async () => {
  assert.equal(CATALOGUE.products.bfpack.amount, 199);
  const p = await player(), c = await call(p, { step: 'checkout', product: 'bfpack' });
  await hook('transaction.completed', pay(c.txn));
  const f = (await finery(p.uid)).c;
  for (const id of ['sh-midnight', 'c-nowl', 'e-nowl', 'cd-midnight', 's-sold', 'p-barcode', 'pn-tag', 'lp-i-receipt', 't-bargain', 'a-midgold']) assert.ok(f.includes(id), id + ' is held');
  await rejects(call(p, { step: 'checkout', product: 'bfpack' }), 'owned');
  /* after the end of 30 November, by the server's clock */
  await config({ skew: Date.parse(CATALOGUE.products.bfpack.until) + 3600e3 - Date.now() });
  try { const q = await player(); await rejects(call(q, { step: 'checkout', product: 'bfpack' }), 'sale_ended'); } finally { await config(); }
});

test('the Old Republic Pack: €2.99 and all ten of its pieces held', async () => {
  assert.equal(CATALOGUE.products.orpack.amount, 299);assert.equal(CATALOGUE.products.orpack.grants.length, 10);
  const p = await player(), c = await call(p, { step: 'checkout', product: 'orpack' });
  await hook('transaction.completed', pay(c.txn));
  const f = (await finery(p.uid)).c;
  for (const id of CATALOGUE.products.orpack.grants) assert.ok(f.includes(id), id + ' is held');
  await rejects(call(p, { step: 'checkout', product: 'orpack' }), 'owned');
});

test('the Age of Sail Pack: €2.99 and all ten of its pieces held', async () => {
  assert.equal(CATALOGUE.products.sailpack.amount, 299);assert.equal(CATALOGUE.products.sailpack.grants.length, 10);
  const p = await player(), c = await call(p, { step: 'checkout', product: 'sailpack' });
  await hook('transaction.completed', pay(c.txn));
  const f = (await finery(p.uid)).c;
  for (const id of CATALOGUE.products.sailpack.grants) assert.ok(f.includes(id), id + ' is held');
  await rejects(call(p, { step: 'checkout', product: 'sailpack' }), 'owned');
});

test('the Central Bank Pack: €2.49 and all ten of its pieces held', async () => {
  assert.equal(CATALOGUE.products.cbpack.amount, 249);assert.equal(CATALOGUE.products.cbpack.grants.length, 10);
  const p = await player(), c = await call(p, { step: 'checkout', product: 'cbpack' });
  await hook('transaction.completed', pay(c.txn));
  const f = (await finery(p.uid)).c;
  for (const id of CATALOGUE.products.cbpack.grants) assert.ok(f.includes(id), id + ' is held');
  await rejects(call(p, { step: 'checkout', product: 'cbpack' }), 'owned');
});

test('a basket: several packs in one checkout at the server’s prices, the same basket reused, each delivered, refusals named', async () => {
  const p = await player();
  const c = await call(p, { step: 'checkout', products: ['sailpack', 'orpack'], prices: [1] });
  assert.match(c.txn, /^txn_/); assert.deepEqual(c.products, ['orpack', 'sailpack'], 'in the Shop’s order');
  const made = P.calls.find(x => x.m === 'POST' && x.p === '/transactions' && x.b.custom_data.uid === p.uid);
  assert.deepEqual(made.b.items, [{ price_id: PRICES.orpack, quantity: 1 }, { price_id: PRICES.sailpack, quantity: 1 }], 'one line each, the server’s prices');
  assert.equal(made.b.custom_data.product, 'basket'); assert.deepEqual(made.b.custom_data.products, ['orpack', 'sailpack']);
  assert.equal((await call(p, { step: 'checkout', products: ['orpack', 'sailpack'] })).txn, c.txn, 'two tabs, one bill');
  const pend = (await shop(p.uid)).pend; assert.ok(pend.orpack && pend.sailpack, 'awaiting confirmation for each');
  /* what a basket may not hold: refused before Paddle hears of it */
  const n = P.calls.length;
  await rejects(call(p, { step: 'checkout', products: ['orpack', 'vip'] }), 'basket_alone');
  await rejects(call(p, { step: 'checkout', products: ['orpack', 'giftvip'] }), 'basket_alone');
  await rejects(call(p, { step: 'checkout', products: ['founder', 'idpack'] }), 'basket_included');
  for (const bad of [[], ['orpack', 'orpack'], ['orpack', 'gold-bars'], Array(11).fill('orpack')]) await assert.rejects(call(p, { step: 'checkout', products: bad }), e => e.status === 'INVALID_ARGUMENT', JSON.stringify(bad));
  await assert.rejects(call(p, { step: 'checkout', products: ['orpack', 'sailpack'], to: p.uid }), e => e.status === 'INVALID_ARGUMENT', 'a gift is bought on its own');
  await rejects(call(await player(false), { step: 'checkout', products: ['orpack', 'sailpack'] }), 'registration_required');
  assert.equal(P.calls.length, n);
  /* paid: everything in it is owned, and every game shows it */
  await hook('transaction.completed', pay(c.txn));
  const s = await shop(p.uid);
  assert.ok(s.owns.orpack && s.owns.sailpack); assert.deepEqual(s.pend, {});
  assert.deepEqual((await finery(p.uid)).c.sort(), [...CATALOGUE.products.orpack.grants, ...CATALOGUE.products.sailpack.grants].sort());
  const rec = (await db.doc('shopTx/' + c.txn).get()).data();
  assert.equal(rec.product, 'basket'); assert.deepEqual(rec.products, ['orpack', 'sailpack']); assert.equal(rec.items.length, 2); assert.equal(rec.total, 598);
  /* something owned cannot go in a basket again, and is named */
  await assert.rejects(call(p, { step: 'checkout', products: ['cbpack', 'sailpack'] }), e => e.code === 'owned' && /Age of Sail/.test(e.message));
  /* one product is an ordinary checkout */
  const one = await call(p, { step: 'checkout', products: ['cbpack'] });
  assert.equal((await db.doc('shopCheckouts/' + one.txn).get()).get('product'), 'cbpack');
});

test('a basket refunded one line at a time: that line goes, the rest stays; the whole basket refunded takes all of it', async () => {
  const p = await player(), c = await call(p, { step: 'checkout', products: ['orpack', 'cbpack'] }), t = pay(c.txn);
  await hook('transaction.completed', t);
  const [orLine, cbLine] = t.details.line_items;
  /* shaped as Paddle's dashboard sends it: partial, the one line in full */
  const a = { id: rid('adj'), action: 'refund', type: 'partial', status: 'pending_approval', transaction_id: c.txn, items: [{ id: rid('adjitm'), type: 'full', amount: '249', item_id: cbLine.id }] };
  await hook('adjustment.created', a);
  let s = await shop(p.uid);
  assert.ok(s.owns.orpack && !s.owns.cbpack, 'the refunded line only');
  await hook('adjustment.updated', { ...a, status: 'approved' });
  s = await shop(p.uid);
  assert.ok(s.owns.orpack && !s.owns.cbpack);
  assert.ok(!(await finery(p.uid)).c.includes('cn-deco') && (await finery(p.uid)).c.includes('sh-scutum'));
  /* the rest of it refunded too */
  await hook('adjustment.created', { ...a, id: rid('adj'), status: 'approved', items: [{ id: rid('adjitm'), type: 'full', amount: '299', item_id: orLine.id }] });
  assert.ok(!(await shop(p.uid)).owns?.orpack);
  /* another basket, refunded whole */
  const q = await player(), d = await call(q, { step: 'checkout', products: ['orpack', 'sailpack'] });
  await hook('transaction.completed', pay(d.txn));
  await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: d.txn });
  s = await shop(q.uid);
  assert.ok(!s.owns?.orpack && !s.owns?.sailpack); assert.equal(await finery(q.uid), undefined);
});

test('a pack paid twice, on its own and in a basket: only that line of the basket is refunded, the rest delivered', async () => {
  const p = await player();
  const single = await call(p, { step: 'checkout', product: 'orpack' }), bag = await call(p, { step: 'checkout', products: ['orpack', 'sailpack'] });
  assert.notEqual(single.txn, bag.txn);
  await hook('transaction.completed', pay(single.txn, { at: Date.now() - 60000 }));
  const t = pay(bag.txn);
  await hook('transaction.completed', t);
  const orLine = t.details.line_items.find(l => l.price_id === PRICES.orpack);
  const asked = await until(() => P.adj.find(x => x.transaction_id === bag.txn));
  assert.equal(asked.action, 'refund'); assert.equal(asked.type, 'partial'); assert.deepEqual(asked.items, [{ item_id: orLine.id, type: 'full' }]);
  assert.ok(!P.adj.some(x => x.transaction_id === single.txn), 'the first payment stands');
  let s = await shop(p.uid);
  assert.ok(s.owns.orpack && s.owns.sailpack, 'everything delivered');
  assert.ok(s.notes.some(x => x.k === 'duplicate' && x.p === 'orpack'));
  /* asked once: another report changes nothing */
  const before = P.adj.length;
  await hook('transaction.completed', t);
  assert.equal(P.adj.length, before);
  assert.equal(Object.values((await db.doc('shopTx/' + bag.txn).get()).get('refundItems')).length, 1);
  /* Paddle approves the line's refund (as it reports it): the Old Republic Pack stays, from the first payment */
  await hook('adjustment.updated', { ...asked, status: 'approved', items: [{ id: rid('adjitm'), type: 'full', amount: '299', item_id: orLine.id }] });
  s = await shop(p.uid);
  assert.equal(s.owns.orpack, Date.parse(P.tx.get(single.txn).billed_at)); assert.ok(s.owns.sailpack);
});

test('a basket closed without paying stops being awaited; paid and not yet completed, each of it is still awaited', async () => {
  const p = await player();
  await call(p, { step: 'checkout', products: ['orpack', 'cbpack'] });
  await call(p, { step: 'refresh' });
  assert.deepEqual((await shop(p.uid)).pend || {}, {});
  const q = await player(), d = await call(q, { step: 'checkout', products: ['orpack', 'cbpack'] });
  P.tx.get(d.txn).status = 'paid';
  await call(q, { step: 'refresh' });
  const pend = (await shop(q.uid)).pend;
  assert.ok(pend.orpack && pend.cbpack);
});
