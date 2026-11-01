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
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum', AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth(), DAY = 864e5, H = 36e5, SECRET = 'pdl_ntfset_test_secret';
const PRICES = { founder: 'pri_founder0000001', idpack: 'pri_idpack00000001', vip: 'pri_vip00000000001' };
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
  if (req.method === 'POST' && u.pathname === '/adjustments') { const a = { id: rid('adj'), action: b.action, type: b.type, transaction_id: b.transaction_id, status: 'pending_approval', reason: b.reason, updated_at: new Date().toISOString() }; P.adj.push(a); return send(201, { data: a }); }
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
  Object.assign(t, { status: 'completed', customer_id: ctm, billed_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString(), payments: [{ status: 'captured', captured_at: new Date(at).toISOString() }], currency_code: 'EUR', details: { totals: { total: '999' } } });
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

test('reconciliation: a payment whose notification never came is found when the player checks back', async () => {
  const p = await player(), c = await call(p, { step: 'checkout', product: 'idpack' });
  pay(c.txn);
  assert.ok(!(await shop(p.uid)).owns?.idpack);
  await call(p, { step: 'refresh' });
  assert.ok((await shop(p.uid)).owns.idpack);
  await rejects(call(p, { step: 'refresh' }), 'resource-exhausted'.toUpperCase().replace(/-/g, '_'));
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
