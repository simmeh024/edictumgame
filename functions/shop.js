/* The Bureau of National Finery: the shop's server (docs/shop.md has the owner's setup).

   Payments go through Paddle, the merchant of record: it takes the payment, charges and pays the sales taxes, and
   runs the subscription. The game never decides what a player owns. This code does, from what Paddle reports:
   its signed notifications to the paddle function below, and what this code asks Paddle's API itself when a player
   checks back (refresh). Returning from the checkout grants nothing.

   accounts({op: 'shop', step, …}) for a signed-in player (functions/accounts.js; inside that callable because a new
   public function needs its invoker set on Cloud Run, which the deploy's service account may not do):
     status                → {on, env, token, now, until, catalogue}: whether the shop is set up, Paddle's environment
                             and client-side token for its checkout, the server's clock and the Founder's cutoff
     checkout {product}    → {txn, env, token}: a Paddle transaction for that product, at the price this server keeps
                             (authConfig/paddle prices), bound to the caller; the page opens it in Paddle's checkout.
                             Only a Registered Nation (a linked sign-in) may buy, so purchases can follow the account
                             to any device. An open checkout for the same product is reused, so two tabs pay one bill.
     refresh               asks Paddle about the caller's open checkouts and subscriptions, for anything its
                             notifications have not yet brought, and works out what the caller owns again
     portal                → {url, cancel, payment}: links into Paddle's customer portal (they expire; never stored)
     resume                takes back a cancellation the caller scheduled, while the paid month still runs
     pick {key}            the Chancery Club's monthly pick: one cosmetic from its collection per paid month, from the
                             pieces released by then; a month's choice stays open until PICK_GRACE after it ends
     seal {id}             the Chancery seal the player shows beside the nation's name ('' for none): the plain one
                             while a member, the others after so many months of membership (shop-core.js, SEALS)
     closing               cancels the caller's subscriptions before the account is deleted

   Storage (only this code writes it; see firestore.rules):
     authConfig/paddle      {env, apiKey, webhookSecret, clientToken, prices: {founder, idpack, vip}}
                            (tools/admin/set-paddle.mjs). Nobody reads it but this code.
     shop/{uid}             what the player owns, which only they read: {owns: {founder?, idpack?}, vip?: {until,
                            from, runs, per, status, cancelAt, renews, n, m, f}, picks: {periodStart: id}, seal?, pend, notes, reg}
     finery/{uid}           {c: [cosmetic ids], reg, cl?}: the shop cosmetics every other player's game checks before it
                            shows them (a nation's own record cannot vouch for them); cl {s, u, m, f}, only once the player
                            has chosen a Chancery seal to show: which, and the membership's end and months that decide it
     shopCheckouts/{txn}    {uid, product, at, env, price}: each checkout this server opened
     shopTx/{txn}           a completed transaction: {uid, product, ok, ck, created, paid, period, sub, ctm, …}
     shopSubs/{sub}         a subscription: {uid, status, period, cancelAt, next, firstTxn, occ, …}
     shopAdj/{adj}          a refund or chargeback: {txn, sub, action, type, status, occ}
     shopAcct/{uid}         {ctm}: the player's Paddle customer; shopCustomers/{ctm} {uids}: the reverse
     shopEvents/{evt}       notifications already handled (Firestore deletes them after 90 days: TTL on exp)
     shopLimits/{uid}       {n, at, r}: pacing of checkouts and refreshes
     shopComp/{uid}         {at, until, by, why}: a Club membership an admin granted for free (functions/admin.js, setComp)
   Billing records stay when an account is deleted (accounting needs them); shop/ and finery/ go with it.

   In the emulators (FUNCTIONS_EMULATOR) authConfig/paddle may also carry api (a stand-in for Paddle's API that the
   tests run) and skew (ms added to the server's clock), and env 'fake', with which the page skips Paddle.js. */
import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { refuse, eligibility, identity, DAY } from './eligibility.js';
import { CATALOGUE, PRODUCTS, CLUB, GIFTABLE, REQUIRED, FOUNDER_CUTOFF, CLUB_IDS, SEALS, clubReleased, sealHeld, verifySignature, txFacts, subFacts, adjFacts, entitlement, pickPeriod } from './shop-core.js';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const LIVE_API = 'https://api.paddle.com', SANDBOX_API = 'https://sandbox-api.paddle.com';
const isId = (v, p) => typeof v === 'string' && new RegExp('^' + p + '_[a-z0-9]{8,64}$').test(v);
const REASON = {
  late: 'The Founder’s Package sale ended before this payment completed.',
  duplicate: 'This was a second payment for something already owned.',
  orphan: 'This purchase was not started from the game, so it could not be delivered.'
};

async function settings(need = true) {
  const s = await getFirestore().doc('authConfig/paddle').get(), d = s.exists ? s.data() : {};
  const env = d.env === 'live' ? 'live' : d.env === 'fake' && EMULATOR ? 'fake' : 'sandbox';
  const prices = d.prices && typeof d.prices === 'object' ? d.prices : {};
  /* a product's price, or a list whose first is sold now and whose others are older prices that renewals may still carry;
     the shop opens with the products it cannot do without, and offers an optional one (the yearly Club, a gifted month)
     once its price is set too */
  const priced = p => [].concat(prices[p] || []).length > 0 && [].concat(prices[p]).every(v => /^pri_[a-z0-9]{8,64}$/.test(v));
  const on = !!(d.apiKey && d.webhookSecret && d.clientToken && REQUIRED.every(priced));
  for (const p of PRODUCTS) if (!priced(p)) delete prices[p];
  if (need && !on) refuse('shop_off', 'The Bureau of National Finery is not open yet.');
  return { on, env, apiKey: d.apiKey || '', secret: d.webhookSecret || '', token: d.clientToken || '', prices,
    api: EMULATOR && typeof d.api === 'string' ? d.api : env === 'live' ? LIVE_API : SANDBOX_API,
    skew: EMULATOR && Number.isFinite(d.skew) ? d.skew : 0 };
}
const clock = cfg => Date.now() + cfg.skew;

async function api(cfg, method, path, body) {
  let r, b;
  try {
    r = await fetch(cfg.api + path, { method, headers: { authorization: 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    b = await r.json().catch(() => ({}));
  } catch (e) { throw Object.assign(new Error('Paddle could not be reached: ' + e.message), { paddle: 'unreachable' }); }
  if (!r.ok) throw Object.assign(new Error(`Paddle answered ${r.status}: ${b.error?.code || ''} ${b.error?.detail || ''}`.trim()), { paddle: b.error?.code || String(r.status) });
  return b.data;
}
/* for a player: Paddle's trouble, said once */
async function asked(fn) {
  try { return await fn(); } catch (e) {
    if (!e.paddle) throw e;
    console.error('paddle', e.message);
    refuse('shop_unavailable', 'The payment service did not answer. Nothing was charged. Try again in a minute.');
  }
}

/* ───────── what Paddle reports ───────── */
async function bindCustomer(uid, ctm) {
  if (!uid || !isId(ctm, 'ctm')) return;
  const db = getFirestore();
  await Promise.all([db.doc('shopAcct/' + uid).set({ ctm }, { merge: true }), db.doc('shopCustomers/' + ctm).set({ uids: FieldValue.arrayUnion(uid) }, { merge: true })]);
}
async function ingestTx(cfg, d) {
  const db = getFirestore();
  if (!isId(d.id, 'txn')) return '';
  const f = txFacts(d, cfg.prices);
  if (f.status !== 'completed') return '';
  const [ck, prev] = await db.getAll(db.doc('shopCheckouts/' + f.id), db.doc('shopTx/' + f.id));
  /* a gift belongs to the nation it was given to; the Paddle customer stays the payer's */
  let uid = ck.exists ? ck.get('to') || ck.get('uid') : '';
  const payer = ck.exists ? ck.get('uid') : '', gift = !!(ck.exists && ck.get('to'));
  if (ck.exists && ck.get('product') !== f.product) f.ok = false;
  if (!uid && isId(f.sub, 'sub')) uid = (await db.doc('shopSubs/' + f.sub).get()).get('uid') || '';
  if (!uid && prev.exists) uid = prev.get('uid') || '';
  await prev.ref.set({ uid, payer: payer || uid, gift, product: f.product, ok: f.ok, ck: ck.exists, created: ck.exists ? ck.get('at') : 0, paid: f.paid, period: f.period,
    sub: f.sub, ctm: f.ctm, origin: f.origin, cur: f.cur, total: f.total, price: f.price, status: 'completed', env: cfg.env }, { merge: true });
  if (uid) await bindCustomer(payer || uid, f.ctm);
  if (uid && ck.exists && isId(f.sub, 'sub')) await db.doc('shopSubs/' + f.sub).set({ uid, firstTxn: f.id }, { merge: true });
  /* a one-off purchase this server never opened (Paddle's checkout opened by hand with the price): nobody to deliver to */
  if (!uid && !f.sub && !prev.get('refundAsked')) {
    await api(cfg, 'POST', '/adjustments', { action: 'refund', type: 'full', transaction_id: f.id, reason: REASON.orphan });
    await prev.ref.update({ refundAsked: Date.now(), refundWhy: 'orphan' });
  }
  return uid;
}
async function ingestSub(cfg, d, occ) {
  const db = getFirestore();
  const f = subFacts(d);
  if (!isId(f.id, 'sub')) return '';
  const ref = db.doc('shopSubs/' + f.id), { id, ...facts } = f;
  /* an older notification arriving after a newer one changes nothing: read, compared and written in one transaction, so two
     arriving together cannot both pass the check and the older be written last */
  const { prev, uid } = await db.runTransaction(async tx => {
    const prev = await tx.get(ref);
    let uid = prev.get('uid') || '';
    if (!uid && isId(f.firstTxn, 'txn')) uid = (await tx.get(db.doc('shopCheckouts/' + f.firstTxn))).get('uid') || '';
    if (!(prev.get('occ') > occ)) tx.set(ref, { ...facts, firstTxn: prev.get('firstTxn') || f.firstTxn, uid, occ }, { merge: true });
    else if (uid && !prev.get('uid')) tx.update(ref, { uid });
    return { prev, uid };
  });
  if (uid) await bindCustomer(uid, f.ctm);
  /* a subscription started outside the game: end it and give the money back */
  if (!uid && isId(f.firstTxn, 'txn') && f.status !== 'canceled' && !prev.get('cancelAsked')) {
    await api(cfg, 'POST', '/subscriptions/' + f.id + '/cancel', { effective_from: 'immediately' });
    await ref.set({ cancelAsked: Date.now() }, { merge: true });
    for (const t of (await db.collection('shopTx').where('sub', '==', f.id).get()).docs) if (!t.get('refundAsked')) {
      await api(cfg, 'POST', '/adjustments', { action: 'refund', type: 'full', transaction_id: t.id, reason: REASON.orphan });
      await t.ref.update({ refundAsked: Date.now(), refundWhy: 'orphan' });
    }
  }
  return uid;
}
async function ingestAdj(cfg, d, occ) {
  const db = getFirestore();
  const f = adjFacts(d);
  if (!isId(f.id, 'adj') || !isId(f.txn, 'txn')) return '';
  const ref = db.doc('shopAdj/' + f.id), { id, ...facts } = f;
  await db.runTransaction(async tx => { const prev = await tx.get(ref); if (!(prev.get('occ') > occ)) tx.set(ref, { ...facts, occ }, { merge: true }); });
  const [t, ck] = await db.getAll(db.doc('shopTx/' + f.txn), db.doc('shopCheckouts/' + f.txn));
  let uid = t.get('uid') || ck.get('uid') || '';
  if (!uid && isId(f.sub, 'sub')) uid = (await db.doc('shopSubs/' + f.sub).get()).get('uid') || '';
  return uid;
}
async function ingest(cfg, ev) {
  const type = String(ev.event_type || ''), d = ev.data && typeof ev.data === 'object' ? ev.data : {}, occ = Date.parse(ev.occurred_at) || Date.now();
  let uid = '';
  if (type.startsWith('transaction.')) uid = d.status === 'completed' ? await ingestTx(cfg, d) : '';
  else if (type.startsWith('subscription.')) uid = await ingestSub(cfg, d, occ);
  else if (type.startsWith('adjustment.')) uid = await ingestAdj(cfg, d, occ);
  if (uid) await settle(cfg, uid);
}

/* ───────── what a player owns, worked out again ───────── */
async function settle(cfg, uid) {
  const db = getFirestore(), shopRef = db.doc('shop/' + uid), finRef = db.doc('finery/' + uid);
  /* everything it is worked out from is read inside the transaction: a notification stored meanwhile (two settling at once)
     makes it run again on the new facts. Read before it, the later of two could write what the earlier one saw, and a paid
     member was then no member until the next refresh. */
  const { e, txDocs, subMap } = await db.runTransaction(async tx => {
    const subs = (await tx.get(db.collection('shopSubs').where('uid', '==', uid))).docs;
    const txDocs = new Map((await tx.get(db.collection('shopTx').where('uid', '==', uid))).docs.map(s => [s.id, s]));
    const subIds = subs.map(s => s.id);
    for (let i = 0; i < subIds.length; i += 30)
      for (const s of (await tx.get(db.collection('shopTx').where('sub', 'in', subIds.slice(i, i + 30)))).docs) txDocs.set(s.id, s);
    const ids = [...txDocs.keys()], adjs = [];
    for (let i = 0; i < ids.length; i += 30) adjs.push(...(await tx.get(db.collection('shopAdj').where('txn', 'in', ids.slice(i, i + 30)))).docs.map(s => s.data()));
    const txs = [...txDocs.values()].map(s => ({ ...s.data(), id: s.id }));
    const subMap = Object.fromEntries(subs.map(s => [s.id, s.data()]));
    const [compDoc, shop, nation] = await tx.getAll(db.doc('shopComp/' + uid), shopRef, db.doc('nations/' + uid));
    const comp = compDoc.exists ? { at: compDoc.get('at'), until: compDoc.get('until') } : null;
    const now = clock(cfg), picks = shop.get('picks') || {}, e = entitlement({ txs, adjs, subs: subMap, picks, now, comp });
    /* who gave what: the giving nation's name, as it is now */
    const from = [...new Set(e.gifts.map(g => g.from))], names = from.length ? Object.fromEntries((await tx.getAll(...from.map(u => db.doc('nations/' + u)))).map(s => [s.id, String(s.get('name') || '').slice(0, 60)])) : {};
    const reg = (nation.exists && nation.get('reg')) || shop.get('reg') || '';
    /* a checkout opened in the last two hours and not yet paid: "awaiting confirmation" on every device */
    const pend = Object.fromEntries(Object.entries(shop.get('pend') || {}).filter(([p, t]) => now - t < 2 * 3600000 && !(CLUB.includes(p) ? e.vip && e.vip.until > now : e.owns[p])));
    const doc = { v: 1, owns: e.owns, picks, pend, notes: e.notes.slice(-10), reg, at: now };
    if (e.gifts.length) doc.gifts = e.gifts.map(g => ({ p: g.p, name: names[g.from] || '', at: g.t, txn: g.txn }));
    if (e.vip) doc.vip = e.vip;
    /* the seal the player chose to show stays chosen; the games show it only while it is held (by cl's figures) */
    const seal = Object.hasOwn(SEALS, shop.get('seal') || '') ? shop.get('seal') : '';
    if (seal) doc.seal = seal;
    const cl = seal && e.vip ? { s: seal, u: e.vip.until, m: e.vip.m, f: e.vip.f } : null;
    /* renewals reported before their subscription was known to be this player's */
    for (const s of txDocs.values()) if (s.get('uid') !== uid) tx.update(s.ref, { uid });
    tx.set(shopRef, doc);
    if (e.cosmetics.length || cl) tx.set(finRef, cl ? { c: e.cosmetics, reg, cl } : { c: e.cosmetics, reg }); else tx.delete(finRef);
    return { e, txDocs, subMap };
  });
  /* refunds and cancellations the rules call for, each asked once */
  for (const r of e.refunds) {
    const s = txDocs.get(r.txn);
    if (!s || s.get('refundAsked')) continue;
    await api(cfg, 'POST', '/adjustments', { action: 'refund', type: 'full', transaction_id: r.txn, reason: REASON[r.why] || REASON.duplicate });
    await s.ref.update({ refundAsked: Date.now(), refundWhy: r.why });
  }
  for (const c of e.cancels) {
    if (subMap[c.sub]?.cancelAsked) continue;
    await api(cfg, 'POST', '/subscriptions/' + c.sub + '/cancel', { effective_from: 'immediately' });
    await db.doc('shopSubs/' + c.sub).update({ cancelAsked: Date.now(), dup: true });
  }
  return e;
}

/* ───────── the player's requests ───────── */
async function pace(uid, field, gap, max) {
  const db = getFirestore(), ref = db.doc('shopLimits/' + uid), now = Date.now();
  await db.runTransaction(async tx => {
    const s = await tx.get(ref), d = s.exists ? s.data() : {};
    if (field === 'r' || field === 's') {
      if (now - (d[field] || 0) < gap) throw new HttpsError('resource-exhausted', field === 's' ? 'Changed a moment ago. Try again in a few seconds.' : 'Checked a moment ago. Try again in a few seconds.');
      tx.set(ref, { [field]: now }, { merge: true });
    } else {
      const fresh = now - (d.at || 0) < 3600000, n = fresh ? d.n || 0 : 0;
      if (n >= max) throw new HttpsError('resource-exhausted', 'Too many checkouts opened this hour. Try again later.');
      tx.set(ref, { n: n + 1, at: fresh ? d.at : now }, { merge: true });
    }
  });
}
function liveSub(vip) { return vip && ['active', 'past_due', 'trialing', 'paused'].includes(vip.status); }

/* a gift: to another player's nation, a week old at least, that does not own it already (a gifted month of the Club:
   not while the nation pays for the Club itself) */
async function giftCheck(uid, to, product, now) {
  if (!/^[A-Za-z0-9]{10,64}$/.test(to)) throw new HttpsError('invalid-argument', 'Choose a nation to give it to.');
  if (to === uid) refuse('gift_self', 'A gift goes to another nation. To buy it for yourself, use the button above.');
  const db = getFirestore(), [nation, shop] = await db.getAll(db.doc('nations/' + to), db.doc('shop/' + to));
  if (!nation.exists) refuse('gift_unknown', 'That nation cannot receive gifts.');
  /* the record itself is kept as JSON beside a few headline fields (src/shim.js encode) */
  let rec = {};
  try { rec = JSON.parse(nation.get('j') || '{}') || {}; } catch { rec = {}; }
  const founded = Number(rec.founded) || 0;
  if (!founded || now - founded < 7 * DAY) refuse('gift_new', 'Gifts go to nations founded at least a week ago.');
  if (CATALOGUE.products[product].kind === 'once' && (shop.get('owns') || {})[product]) refuse('gift_owned', 'That nation already owns it.');
  if (CATALOGUE.products[product].kind === 'giftmonth' && liveSub(shop.get('vip'))) refuse('gift_member', 'That nation already pays for The Chancery Club, so a gifted month would add nothing yet.');
}

async function checkout(cfg, who, d) {
  const db = getFirestore(), uid = who.uid, product = d.product;
  if (!PRODUCTS.includes(product)) throw new HttpsError('invalid-argument', 'Unknown product.');
  if (!cfg.prices[product]) refuse('not_on_sale', 'That is not on sale yet.');
  const P = CATALOGUE.products[product], to = typeof d.to === 'string' ? d.to : '', club = CLUB.includes(product);
  if (P.giftOnly && !to) throw new HttpsError('invalid-argument', 'Choose a nation to give it to.');
  if (to && !GIFTABLE.includes(product)) throw new HttpsError('invalid-argument', 'That cannot be given as a gift.');
  if (product === 'founder' && clock(cfg) >= FOUNDER_CUTOFF) refuse('sale_ended', 'The Founder’s Package is no longer on sale. The sale ended on 1 February 2027 at 23:59:59 UTC.');
  await db.runTransaction(tx => eligibility(tx, who));
  if (to) await giftCheck(uid, to, product, clock(cfg));
  const [shop, acct, open] = await Promise.all([db.doc('shop/' + uid).get(), db.doc('shopAcct/' + uid).get(), db.collection('shopCheckouts').where('uid', '==', uid).get()]);
  const owns = shop.get('owns') || {}, vip = shop.get('vip'), now = clock(cfg);
  if (!to) {
    if (!club && owns[product]) refuse('owned', 'You already own this.');
    if (club && liveSub(vip)) vip.status === 'past_due'
      ? refuse('vip_past_due', 'Your last membership payment did not go through. Update the payment method under Manage subscription to carry on.')
      : refuse('vip_active', 'You are already a member of The Chancery Club. Manage your membership from the Shop.');
    if (club && vip && vip.until > now) refuse('vip_paid', 'Your membership is paid until ' + new Date(vip.until).toUTCString() + '. You can join again once it ends.');
  }
  /* the same checkout again (for the same nation), while Paddle still holds it open */
  const mine = open.docs.filter(s => s.get('product') === product && (s.get('to') || '') === to && s.get('env') === cfg.env && now - s.get('at') < 20 * 3600000).sort((a, b) => b.get('at') - a.get('at'))[0];
  if (mine) {
    const t = await asked(() => api(cfg, 'GET', '/transactions/' + mine.id));
    if (t && (t.status === 'draft' || t.status === 'ready')) {
      if (!to) await db.doc('shop/' + uid).set({ pend: { [product]: now } }, { merge: true });
      return { txn: mine.id, env: cfg.env, token: cfg.token, gift: !!to };
    }
    if (t && t.status === 'completed') { const owner = await ingestTx(cfg, t); if (owner) await settle(cfg, owner); return { done: true, gift: !!to }; }
  }
  await pace(uid, 'n', 0, 12);
  const price = [].concat(cfg.prices[product])[0];
  const body = { items: [{ price_id: price, quantity: 1 }], custom_data: to ? { uid, product, to } : { uid, product }, collection_mode: 'automatic' };
  if (isId(acct.get('ctm'), 'ctm')) body.customer_id = acct.get('ctm');
  const t = await asked(() => api(cfg, 'POST', '/transactions', body));
  if (!t || !isId(t.id, 'txn')) refuse('shop_unavailable', 'The payment service did not answer. Nothing was charged. Try again in a minute.');
  await db.doc('shopCheckouts/' + t.id).set({ uid, product, at: now, env: cfg.env, price, ...(to ? { to } : {}) });
  /* "a checkout was opened" is for the buyer's own purchases; a gift shows as sent once paid */
  if (!to) await db.doc('shop/' + uid).set({ pend: { [product]: now } }, { merge: true });
  return { txn: t.id, env: cfg.env, token: cfg.token, gift: !!to };
}

async function refresh(cfg, uid) {
  const db = getFirestore();
  await pace(uid, 'r', 15000);
  const [cks, subs, done] = await Promise.all([
    db.collection('shopCheckouts').where('uid', '==', uid).get(), db.collection('shopSubs').where('uid', '==', uid).get(), db.collection('shopTx').where('uid', '==', uid).get()]);
  const have = new Set(done.docs.map(s => s.id)), now = clock(cfg), taken = new Set(), others = new Set();
  await asked(async () => {
    for (const s of cks.docs) if (!have.has(s.id) && s.get('env') === cfg.env && now - s.get('at') < 7 * DAY) {
      const t = await api(cfg, 'GET', '/transactions/' + s.id);
      if (t && t.status === 'completed') { const o = await ingestTx(cfg, t); have.add(s.id); if (o && o !== uid) others.add(o); }
      else if (t && ['paid', 'billed', 'past_due'].includes(t.status)) taken.add(s.get('product'));
    }
    for (const s of subs.docs) {
      const sub = await api(cfg, 'GET', '/subscriptions/' + s.id);
      if (sub) await ingestSub(cfg, sub, Date.parse(sub.updated_at) || 0);
      for (const t of await api(cfg, 'GET', '/transactions?subscription_id=' + s.id + '&status=completed&per_page=50') || []) { await ingestTx(cfg, t); have.add(t.id); }
    }
    const ids = [...have].slice(-50);
    for (let i = 0; i < ids.length; i += 25)
      for (const a of await api(cfg, 'GET', '/adjustments?transaction_id=' + ids.slice(i, i + 25).join(',') + '&per_page=50') || [])
        await ingestAdj(cfg, a, Date.parse(a.updated_at) || 0);
  });
  /* a checkout closed without paying waits no longer, on any device: only a payment Paddle has taken and not yet
     completed keeps "a checkout was opened" up (a completed one becomes owned, which settle clears it for) */
  const ref = db.doc('shop/' + uid), drop = Object.keys((await ref.get()).get('pend') || {}).filter(p => !taken.has(p));
  if (drop.length) await ref.set({ pend: Object.fromEntries(drop.map(p => [p, FieldValue.delete()])) }, { merge: true });
  if (have.size || subs.size) await asked(() => settle(cfg, uid));
  for (const o of others) await asked(() => settle(cfg, o));
  return { ok: true };
}

async function portal(cfg, uid) {
  const db = getFirestore(), ctm = (await db.doc('shopAcct/' + uid).get()).get('ctm');
  if (!isId(ctm, 'ctm')) refuse('no_customer', 'There is nothing to manage yet.');
  const subs = (await db.collection('shopSubs').where('uid', '==', uid).get()).docs.filter(s => s.get('status') !== 'canceled').map(s => s.id).slice(0, 25);
  const r = await asked(() => api(cfg, 'POST', '/customers/' + ctm + '/portal-sessions', subs.length ? { subscription_ids: subs } : {}));
  const https = v => typeof v === 'string' && /^https:\/\//.test(v) ? v : '', sub = r?.urls?.subscriptions?.[0];
  return { url: https(r?.urls?.general?.overview), cancel: https(sub?.cancel_subscription), payment: https(sub?.update_subscription_payment_method) };
}

async function resume(cfg, uid) {
  const db = getFirestore();
  const s = (await db.collection('shopSubs').where('uid', '==', uid).get()).docs.find(s => s.get('cancelAt') > clock(cfg) && s.get('status') !== 'canceled');
  if (!s) refuse('nothing_to_resume', 'Your membership is not set to end.');
  const sub = await asked(() => api(cfg, 'PATCH', '/subscriptions/' + s.id, { scheduled_change: null }));
  if (sub) await ingestSub(cfg, sub, Date.now());
  await settle(cfg, uid);
  return { ok: true };
}

async function pick(cfg, uid, d) {
  const db = getFirestore(), key = d.key;
  if (!CLUB_IDS.includes(key)) throw new HttpsError('invalid-argument', 'Choose one of the Chancery Club’s cosmetics.');
  const ref = db.doc('shop/' + uid), fin = db.doc('finery/' + uid), now = clock(cfg);
  if (!clubReleased(now).includes(key)) refuse('not_yet', 'That piece joins the collection later. Choose one from the collection as it is now.');
  return db.runTransaction(async tx => {
    const [s, f] = await tx.getAll(ref, fin), picks = { ...(s.get('picks') || {}) }, vip = s.get('vip'), per = pickPeriod(vip, now, picks);
    if (!per) {
      const current = (vip && Array.isArray(vip.per) ? vip.per : []).some(p => p.s <= now && now < p.e);
      if (current) refuse('picked', 'You have already chosen this month’s cosmetic. The next choice comes with your next paid month.');
      refuse('vip_required', 'The monthly pick is for members of The Chancery Club.');
    }
    if (Object.values(picks).includes(key)) refuse('held', 'You already hold that one. Choose another.');
    picks[per.s] = key;
    tx.update(ref, { picks, at: now });
    /* merged: the seal's figures (cl) stay as they are */
    tx.set(fin, { c: [...new Set([...(f.get('c') || []), key])], reg: s.get('reg') || '' }, { merge: true });
    return { ok: true, key, period: per };
  });
}

/* the Chancery seal shown beside the nation's name, or none. Choosing one needs it to be held now; the games then show
   it while it is held, by the figures settle() publishes with it (finery cl). */
async function seal(cfg, uid, d) {
  const id = typeof d.id === 'string' ? d.id : '';
  if (id && !Object.hasOwn(SEALS, id)) throw new HttpsError('invalid-argument', 'Choose one of the Chancery seals.');
  await pace(uid, 's', 2000);
  const db = getFirestore(), ref = db.doc('shop/' + uid);
  if (id) {
    let vip = (await ref.get()).get('vip');
    /* a record from before months were counted (vip.m) is worked out again first */
    if (vip && vip.m == null) vip = (await settle(cfg, uid)).vip;
    if (!sealHeld(id, vip, clock(cfg))) refuse('seal_locked', SEALS[id] ? `That seal comes with ${SEALS[id]} months of membership of the Chancery Club.` : 'The Chancery seal is for members of the Club.');
  }
  await ref.set({ seal: id }, { merge: true });
  await settle(cfg, uid);
  return { ok: true, seal: id };
}

/* before the account is deleted (src/shim.js, doDelete): no subscription may go on billing an account that is gone */
async function closing(cfg, uid) {
  const db = getFirestore();
  for (const s of (await db.collection('shopSubs').where('uid', '==', uid).get()).docs)
    if (s.get('status') !== 'canceled' && !s.get('closed')) {
      await asked(() => api(cfg, 'POST', '/subscriptions/' + s.id + '/cancel', { effective_from: 'immediately' }));
      await s.ref.update({ closed: Date.now() });
    }
  return { ok: true };
}
/* with the account (functions/accounts.js, close) */
export async function forgetShop(uid) {
  const db = getFirestore();
  if ((await db.collection('shopSubs').where('uid', '==', uid).get()).docs.some(s => s.get('status') !== 'canceled' && !s.get('closed')))
    { const cfg = await settings(false); if (cfg.on) await closing(cfg, uid); }
  await Promise.all(['shop/', 'finery/', 'presets/', 'shopComp/'].map(c => db.doc(c + uid).delete()));
  await db.recursiveDelete(db.doc('chron/' + uid));
}

/* an admin turns a free Club membership on (until a time) or off (until 0), and the player's shop is worked out again.
   A paid membership is Paddle's to end; switching the free one off leaves it alone. */
export async function setComp(uid, until, by, why) {
  const db = getFirestore(), cfg = await settings(false), now = clock(cfg), ref = db.doc('shopComp/' + uid);
  if (until > now) {
    const prev = await ref.get();
    await ref.set({ at: prev.exists && prev.get('until') > now ? prev.get('at') : now, until, by, why });
  } else await ref.delete();
  const e = await settle(cfg, uid);
  return { vip: e.vip, comp: until > now ? until : 0 };
}

export async function shopStep(uid, d) {
  const db = getFirestore();
  if (d.step === 'status') {
    const cfg = await settings(false), [shop, nation] = await db.getAll(db.doc('shop/' + uid), db.doc('nations/' + uid));
    /* a nation founded in another region since: the projection follows it; a membership kept before its months were
       counted (vip.m, for the Chancery seals) is counted now, once */
    const moved = shop.exists && nation.exists && shop.get('reg') !== nation.get('reg'), uncounted = shop.exists && !!shop.get('vip') && shop.get('vip').m == null;
    if (cfg.on && (moved || uncounted)) await settle(cfg, uid).catch(e => console.error('shop settle', e.message));
    /* the prices on sale now (public: the page asks Paddle what they come to in the player's own currency) */
    const prices = cfg.on ? Object.fromEntries(PRODUCTS.filter(p => cfg.prices[p]).map(p => [p, [].concat(cfg.prices[p])[0]])) : {};
    return { on: cfg.on, env: cfg.on ? cfg.env : '', token: cfg.on ? cfg.token : '', prices, now: clock(cfg), until: FOUNDER_CUTOFF, catalogue: CATALOGUE };
  }
  const cfg = await settings(d.step !== 'closing');
  if (!cfg.on) return { ok: true };
  const who = await identity(uid);
  if (d.step === 'checkout') return checkout(cfg, who, d);
  if (d.step === 'refresh') return refresh(cfg, uid);
  if (d.step === 'portal') return portal(cfg, uid);
  if (d.step === 'resume') return resume(cfg, uid);
  if (d.step === 'pick') return pick(cfg, uid, d);
  if (d.step === 'seal') return seal(cfg, uid, d);
  if (d.step === 'closing') return closing(cfg, uid);
  throw new HttpsError('invalid-argument', 'Unknown shop step.');
}

/* Paddle's notifications. Answered within Paddle's five seconds in the ordinary run; a failure answers 500, so
   Paddle sends it again (live: for about two days), and a notification already handled is answered at once. */
export const paddle = onRequest({ region: 'europe-west1', maxInstances: 5, memory: '256MiB', timeoutSeconds: 30, concurrency: 20 }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send(''); return; }
  const cfg = await settings(false).catch(() => null);
  if (!cfg || !cfg.secret || !verifySignature(req.rawBody, req.get('paddle-signature'), cfg.secret)) { res.status(401).send(''); return; }
  let ev;
  try { ev = JSON.parse(req.rawBody.toString('utf8')); } catch { res.status(400).send(''); return; }
  /* Paddle's notification simulator signs its sample data like the real thing: say it arrived, act on none of it */
  if (ev && /^ntfsimevt_[a-z0-9]{8,64}$/.test(String(ev.event_id))) { res.status(200).send('simulated'); return; }
  if (!ev || !/^evt_[a-z0-9]{8,64}$/.test(String(ev.event_id))) { res.status(400).send(''); return; }
  const seen = getFirestore().doc('shopEvents/' + ev.event_id);
  if ((await seen.get()).exists) { res.status(200).send('ok'); return; }
  try { await ingest(cfg, ev); } catch (e) { console.error('paddle event', ev.event_id, ev.event_type, e.message); res.status(500).send(''); return; }
  await seen.set({ t: String(ev.event_type || '').slice(0, 60), at: Date.now(), exp: Timestamp.fromMillis(Date.now() + 90 * DAY) });
  res.status(200).send('ok');
});
