// The Bureau of National Finery in the browser, against the emulators and a stand-in for Paddle's API (the server
// answers env 'fake', so the page opens no Paddle.js; this test plays Paddle: it marks the payment taken and sends
// the signed notification). One player buys the Founder's Package and wears it; a neighbour sees it, and does not see
// the same finery on a nation that only wrote it into its own record; the Chancery Club gives a desk of ten, a pick,
// presets and a Chronicle, and when it ends the ten edicts stay. Screenshots land in test/out (shop-*.png).
//   npm run test:shop-e2e
import { OUT, PROJECT, FN_HOST, check, finish, until, player, open, found, nav, sleep, register, restGet } from './lib.mjs';
import { signature } from '../functions/shop-core.js';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
if (!PROJECT.startsWith('demo-')) throw Error('This suite requires demo emulators');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: PROJECT });
const db = getFirestore(), SECRET = 'pdl_ntfset_e2e', H = 36e5, DAY = 864e5;
const PRICES = { founder: 'pri_founder0000001', idpack: 'pri_idpack00000001', vip: 'pri_vip00000000001' };
const rid = p => p + '_' + crypto.randomBytes(13).toString('hex');

/* ── Paddle, played by this test ── */
const P = { tx: new Map(), subs: new Map(), adj: [] };
const server = http.createServer(async (req, res) => {
  let body = '';for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), b = body ? JSON.parse(body) : null, send = (c, d) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  let m;
  if (req.method === 'POST' && u.pathname === '/transactions') { const t = { id: rid('txn'), status: 'ready', items: b.items.map(i => ({ price: { id: i.price_id }, quantity: 1 })), custom_data: b.custom_data, created_at: new Date().toISOString() }; P.tx.set(t.id, t); return send(201, { data: t }); }
  if ((m = /^\/transactions\/(txn_\w+)$/.exec(u.pathname))) return P.tx.has(m[1]) ? send(200, { data: P.tx.get(m[1]) }) : send(404, {});
  if (req.method === 'GET' && u.pathname === '/transactions') return send(200, { data: [] });
  if ((m = /^\/subscriptions\/(sub_\w+)(\/cancel)?$/.exec(u.pathname))) { const s = P.subs.get(m[1]);if (!s) return send(404, {});if (m[2]) s.status = 'canceled';return send(200, { data: s }); }
  if (req.method === 'POST' && u.pathname === '/adjustments') { const a = { id: rid('adj'), ...b, status: 'pending_approval' }; P.adj.push(a); return send(201, { data: a }); }
  if (req.method === 'GET' && u.pathname === '/adjustments') return send(200, { data: [] });
  if ((m = /^\/customers\/(ctm_\w+)\/portal-sessions$/.exec(u.pathname))) return send(201, { data: { urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/cpl_e2e' }, subscriptions: [] } } });
  send(404, {});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await db.doc('authConfig/paddle').set({ env: 'fake', apiKey: 'pdl_sdbx_apikey_e2e', webhookSecret: SECRET, clientToken: 'test_e2e', prices: PRICES, api: 'http://127.0.0.1:' + server.address().port });
async function hook(type, data) {
  const body = JSON.stringify({ event_id: rid('evt'), event_type: type, occurred_at: new Date().toISOString(), data });
  const r = await fetch(`http://${FN_HOST}/${PROJECT}/europe-west1/paddle`, { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': signature(Buffer.from(body), SECRET) }, body });
  return r.status;
}
/* the page's checkout opened (window.__edictumCheckout); Paddle takes the payment and reports it */
async function payFor(p, { sub = null, period = null } = {}) {
  const txn = await until(() => p.evaluate(() => window.__edictumCheckout && !window.__edictumCheckout.done && window.__edictumCheckout.txn), 10000);
  if (!txn) return null;
  await p.evaluate(() => { window.__edictumCheckout.done = true; });
  const t = P.tx.get(txn), now = new Date().toISOString();
  Object.assign(t, { status: 'completed', customer_id: 'ctm_e2e000000001', billed_at: now, payments: [{ captured_at: now }] });
  if (sub) { t.subscription_id = sub; t.billing_period = { starts_at: new Date(period.s).toISOString(), ends_at: new Date(period.e).toISOString() };
    P.subs.set(sub, { id: sub, status: 'active', transaction_id: txn, customer_id: t.customer_id, current_billing_period: t.billing_period, next_billed_at: t.billing_period.ends_at, scheduled_change: null }); }
  await p.evaluate(() => window.__edictumCheckout.event('checkout.completed'));
  check('Paddle’s signed report is accepted', (await hook('transaction.completed', t)) === 200);
  if (sub) await hook('subscription.created', P.subs.get(sub));
  return txn;
}
const go = async (p, v) => { await p.evaluate(v => { const b = document.querySelector(`.nav [data-v="${v}"]`); if (b) b.click(); else location.hash = v; }, v); await sleep(400); };
const txt = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
const shot = async (p, sel, file) => { for (let k = 0; ; k++) { try { return await p.locator(sel).first().screenshot({ path: path.join(OUT, file) }); } catch (e) { if (k >= 3) { check('screenshot ' + file, false, e.message); return; } await sleep(300); } } };
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 8000 }); await p.click(sel); await sleep(350); };

/* ── a guest: the Shop says what linking is for, and nothing is bought ── */
const G = await player('shop guest', { cap: 500 });await open(G);await found(G, 'Guestovia');
await go(G, 'shop');
check('the Shop is under its own heading', /Bureau of National Finery/.test(await txt(G, 'h1')));
check('a guest is told purchases need a linked sign-in', /Purchases belong to your account/.test(await txt(G, '.shop-link')));
await click(G, '[data-act="shop-buy"][data-p="founder"]');
check('buying as a guest asks for a link instead', /link a sign-in first/i.test(await txt(G, '.shop-err')) && !(await G.evaluate(() => window.__edictumCheckout)));

/* ── a Registered Nation buys the Founder's Package ── */
const A = await player('shop founder', { vp: { width: 1280, height: 1000 }, cap: 500 });const aUid = await open(A);await found(A, 'Gildmark');await register(A);
await go(A, 'shop');
const page = await txt(A, '.shop-founder');
check('the Founder’s Package comes first, priced in euros', /€9\.99/.test(page) && (await A.evaluate(() => document.querySelector('.shop-item').classList.contains('shop-founder'))), page.slice(0, 120));
check('the deadline is given in UTC and in the player’s own time', /1 February 2027, 23:59:59 UTC/.test(page) && /where you are/.test(page));
check('permanent and recurring are told apart', /Permanent/.test(await txt(A, '.shop-founder .eyebrow')) && /Recurring/.test(await txt(A, '.shop-vip .eyebrow')));
check('the humour survives', /Your citizens will remain unimpressed/.test(await txt(A, '.shop-vh')));
for (const v of ['banner', 'stamp', 'passport', 'land']) { await click(A, `[data-act="shop-pv"][data-v="${v}"]`); await shot(A, '.shop-founder .shop-pv-box', `shop-preview-${v}.png`); }
check('the passport preview carries the inscription', /FOUNDING SUPPORTER · FIRST EDITION/.test(await A.evaluate(() => { const b = document.querySelector('[data-act="shop-pv"][data-v="passport"]'); b.click(); return new Promise(r => setTimeout(() => r(document.querySelector('.shop-pv-pp')?.textContent || ''), 300)); })));
await click(A, '[data-act="shop-pv"][data-v="banner"]');
await A.evaluate(() => scrollTo(0, 0));await A.screenshot({ path: path.join(OUT, 'shop-desktop.png'), fullPage: true });
await click(A, '[data-act="shop-buy"][data-p="founder"]');
const fTxn = await payFor(A);
check('the checkout was opened for a transaction the server made', !!fTxn && P.tx.get(fTxn).custom_data.uid === aUid && P.tx.get(fTxn).items[0].price.id === PRICES.founder);
check('owned once Paddle confirms it', !!(await until(() => A.evaluate(() => /Owned/.test(document.querySelector('.shop-founder')?.textContent || '')), 10000)));
check('the founder cosmetics are held, by the server’s word', (await A.evaluate(() => G.SHOP.held().length)) === 7);

/* ── wearing it ── */
await go(A, 'customise');
for (const id of ['cz-p-p-firsted', 'cz-f-f-engraver', 'cz-st-s-firsted', 'cz-pn-pn-founder', 'cz-bg-bg-founder', 'cz-ins-in-founder', 'cz-te-te-gilt']) {
  const ok = await until(() => A.evaluate(id => { const b = document.getElementById(id); if (!b) return false; if (b.getAttribute('aria-pressed') !== 'true') b.click(); return document.getElementById(id)?.getAttribute('aria-pressed') === 'true'; }, id), 6000);
  if (!ok) check('equipped in Customise: ' + id, false);
}
const worn = await A.evaluate(() => G.SHOP.cz(G.S.nation));
check('all seven founder pieces equipped in Customise', worn.p === 'p-firsted' && worn.f === 'f-engraver' && worn.st === 's-firsted' && worn.pn === 'pn-founder' && worn.bg === 'bg-founder' && worn.ins === 'in-founder' && worn.te === 'te-gilt', JSON.stringify(worn));
await go(A, 'nation');await A.evaluate(() => scrollTo(0, 0));await sleep(400);
check('the badge and the First Edition banner on the nation card', await A.evaluate(() => !!document.querySelector('.hero .founder-pill') && !!document.querySelector('.hero svg.shop-fe')));
await shot(A, '.hero.id-sec', 'shop-hero-founder.png');
await go(A, 'museum');
check('the certificate hangs in the museum, with the nation’s name', !!(await until(() => A.evaluate(() => { const s = document.querySelector('#shop-cert svg'); return s && /Gildmark/.test(s.textContent); }), 5000)));
await shot(A, '#shop-cert', 'shop-certificate.png');
await go(A, 'shop');
for (const cd of ['cd-ledger', 'cd-atlas', 'cd-civic']) { await click(A, `[data-act="shop-cd"][data-v="${cd}"]`); await shot(A, '.shop-idpack .shop-pv-box', `shop-card-${cd.slice(3)}.png`); }
await go(A, 'map');await sleep(1200);
check('Founder’s Gilt drawn on the player’s own land', !!(await until(() => A.evaluate(() => !!document.querySelector('canvas[data-map="main"]')?._gilt), 6000)));
await A.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.remove(); });await shot(A, 'canvas[data-map="main"]', 'shop-map-gilt.png');
await A.evaluate(() => G.PG.saveSoon());await sleep(2500);

/* ── a neighbour sees it; a forger's own record does not count ── */
const B = await player('shop neighbour', { cap: 500 });await open(B);await found(B, 'Plainholm');
const seen = await until(() => B.evaluate(id => { const n = G.S.world && G.S.world[id]; if (!n) return null; const c = G.SHOP.cz(n); return c.te === 'te-gilt' && c.bg === 'bg-founder' && c.p === 'p-firsted' ? c : null; }, aUid), 15000);
const diag = seen ? '' : JSON.stringify(await B.evaluate(id => { const n = G.S.world && G.S.world[id]; return { reg: G.S.nation && G.S.nation.reg, inWorld: !!n, worldN: Object.keys(G.S.world || {}).length, rawCz: n && n.cz, fin: [...(G.SHOP.fin(id) || [])], finN: G.SHOP.SHOP.fin.size, uid: G.S.uid }; }, aUid)) + ' A=' + JSON.stringify(await A.evaluate(() => ({ reg: G.S.nation.reg, cz: G.S.nation.cz }))) + ' finery=' + JSON.stringify((await restGet('finery/' + aUid)).body);
check('another player sees the founder finery, vouched for by the server', !!seen, JSON.stringify(seen) + diag);
await B.evaluate(id => { location.hash = 'visit/' + id; }, aUid);await sleep(900);
check('the badge beside the name on the visit page', await B.evaluate(() => !!document.querySelector('.hero .founder-pill')));
const C = await player('shop forger', { cap: 500 });const cUid = await open(C);await found(C, 'Forgeria');
/* a tampered client: the record saved as it stands, past the game's own commit (which would rewrite cz.u) */
await sleep(1500);
await C.evaluate(async () => { const n = G.clone(G.S.nation); n.cz = Object.assign({}, n.cz, { te: 'te-gilt', bg: 'bg-founder', p: 'p-firsted', u: ['te-gilt', 'bg-founder', 'p-firsted'] }); n.updatedAt = Date.now();
  await (await window.claude.use('db')).doc('nations/' + G.S.uid).set(n); G.S.nation = n; });
const forged = await until(() => B.evaluate(id => { const n = G.S.world && G.S.world[id]; return n && n.cz && n.cz.te === 'te-gilt' ? G.SHOP.cz(n) : null; }, cUid), 15000);
check('finery written into a nation’s own record is not shown to others', !!forged && forged.te === '' && forged.bg === '' && forged.p !== 'p-firsted', JSON.stringify(forged));
check('nor to its own player’s game', await C.evaluate(() => { const c = G.SHOP.cz(G.S.nation); return c.te === '' && c.bg === ''; }));

/* ── the Chancery Club ── */
await go(A, 'shop');
check('a desk of five before joining', (await A.evaluate(() => G.SHOP.cap(Date.now()))) === 5);
await click(A, '[data-act="shop-buy"][data-p="vip"]');
const vSub = rid('sub'), t0 = Date.now() - 13 * H;  // paid since before the hours the desk catches up on
const vTxn = await payFor(A, { sub: vSub, period: { s: t0, e: t0 + 30 * DAY } });
check('a member once the payment is confirmed', !!(await until(() => A.evaluate(() => G.SHOP.cap(Date.now()) === 10), 10000)));
check('paid-until and renewal shown, with Manage subscription', /Paid until/.test(await txt(A, '.shop-vip')) && /Renews on/.test(await txt(A, '.shop-vip')) && !!(await A.$('[data-act="shop-portal"]')));
await A.evaluate(() => { const n = G.clone(G.S.nation); n.freq = 60; n.issueClock = Date.now() - 12 * 36e5 - 60000; const v = G.syncInbox(n, Date.now()); G.commit(v); G.PG.saveSoon(); G.render(); });
check('ten edicts wait on a member’s desk', (await A.evaluate(() => G.S.nation.inbox.length)) === 10);
await until(async () => { const r = await restGet('nations/' + aUid); return r.status === 200 && r.body.fields.iq && r.body.fields.iq.integerValue === '1'; }, 10000);
check('the saved nation carries the marker that keeps older builds from cutting the queue', (await restGet('nations/' + aUid)).body.fields.iq?.integerValue === '1');
await go(A, 'issues');
check('the Edicts page counts to ten', /10 of 10 on your desk/.test(await txt(A, '.issue-meta')));
/* the monthly pick */
await go(A, 'shop');await click(A, '[data-act="shop-pick"][data-id="p-moire"]');
check('the monthly pick is kept on the public list', !!(await until(async () => { const r = await restGet('finery/' + aUid); return r.status === 200 && JSON.stringify(r.body).includes('p-moire'); }, 8000)));
await shot(A, '.shop-vip', 'shop-vip-member.png');
/* presets */
await go(A, 'customise');
await click(A, '[data-act="pre-save"][data-k="1"]');
check('a preset saved while a member', !!(await until(() => A.evaluate(() => !!(G.SHOP.PRE.doc && G.SHOP.PRE.doc[1])), 6000)));
await A.evaluate(() => document.getElementById('cz-p-p-guilloche').click());await sleep(500);
await click(A, '[data-act="pre-load"][data-k="1"]');
check('loading it puts the saved look back on', (await A.evaluate(() => G.SHOP.cz(G.S.nation).p)) === 'p-firsted');
/* the Chronicle */
await A.evaluate(() => { const x = G.S.nation.inbox.find(e => !e.ws && e.id !== 'fd-settle'); G.answer(x.id, 0); });
await sleep(600);await A.evaluate(() => G.SHOP.chrFlush());
await go(A, 'chronicle');
check('the decision is in the Chronicle, private to the player', !!(await until(() => A.evaluate(() => document.querySelectorAll('.chr-dec li').length >= 1), 8000)));
check('it can be exported and printed', await A.evaluate(() => ['chr-x-dcsv', 'chr-x-scsv', 'chr-x-json', 'chr-print'].every(a => document.querySelector(`[data-act="${a}"]`))));
check('nobody else can read it', (await restGet(`chron/${aUid}/m/${new Date().toISOString().slice(0, 7)}`)).status === 403);
/* reload: nine wait now (one was decided), all kept */
await A.reload();await A.waitForFunction(() => window.G && G.S && G.S.nation);await sleep(1500);
check('a reload keeps every waiting edict', (await A.evaluate(() => G.S.nation.inbox.length)) === 9);

/* ── the membership ends (its month refunded): every edict stays, no new one until fewer than five ── */
await A.evaluate(() => { const n = G.clone(G.S.nation); n.issueClock = Date.now() - 2 * 36e5; const v = G.syncInbox(n, Date.now()); G.commit(v); G.PG.saveSoon(); });
const ten = await A.evaluate(() => G.S.nation.inbox.length);
check('back to ten before it ends', ten === 10, String(ten));
await sleep(1500);
check('the refund is reported', (await hook('adjustment.created', { id: rid('adj'), action: 'refund', type: 'full', status: 'approved', transaction_id: vTxn, subscription_id: vSub })) === 200);
check('no longer a member', !!(await until(() => A.evaluate(() => G.SHOP.cap(Date.now()) === 5), 10000)));
check('all ten edicts stay', (await A.evaluate(() => G.syncInbox(G.S.nation, Date.now() + 5 * 36e5).inbox.length)) === 10);
await go(A, 'issues');
check('the Edicts page says why nothing new arrives', /membership has ended\. All 10 waiting edicts stay/.test(await txt(A, '.vh')));
await A.reload();await A.waitForFunction(() => window.G && G.S && G.S.nation);await sleep(1500);
check('and after a reload, still ten', (await A.evaluate(() => G.S.nation.inbox.length)) === 10);
check('the pick stays after the membership', (await A.evaluate(() => G.SHOP.held())).includes('p-moire'));
await go(A, 'customise');await sleep(600);
check('presets still load after, but cannot be saved', await A.evaluate(() => !!document.querySelector('[data-act="pre-load"][data-k="1"]') && !document.querySelector('[data-act="pre-save"]')));
await go(A, 'chronicle');
check('the Chronicle is read-only after', /Read-only/.test(await txt(A, '.notice')));

/* ── in the dark theme ── */
await A.emulateMedia({ colorScheme: 'dark' });await go(A, 'shop');await sleep(600);await A.evaluate(() => scrollTo(0, 0));
await A.screenshot({ path: path.join(OUT, 'shop-dark.png') });
await A.emulateMedia({ colorScheme: 'light' });

/* ── on a phone ── */
await A.setViewportSize({ width: 390, height: 844 });await go(A, 'shop');await sleep(600);
check('no sideways scrolling on a phone', await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await A.screenshot({ path: path.join(OUT, 'shop-phone.png'), fullPage: true });

server.close();
await db.doc('authConfig/paddle').delete();
await finish();
