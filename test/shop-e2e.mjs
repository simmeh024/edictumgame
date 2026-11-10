// The Bureau of National Finery in the browser, against the emulators and a stand-in for Paddle's API (the server
// answers env 'fake', so the page opens no Paddle.js; this test plays Paddle: it marks the payment taken and sends
// the signed notification). One player buys the Founder's Package and wears it; a neighbour sees it, and does not see
// the same finery on a nation that only wrote it into its own record; the Chancery Club comes first on the page, gives
// a desk of ten, a pick, a seal beside the name (seen by the neighbour), presets and a Chronicle, and when it ends the ten
// edicts stay and the seal comes down; a full desk outside the Club says so once. Screenshots land in test/out (shop-*.png).
//   npm run test:shop-e2e
import { BASE, OUT, PROJECT, FN_HOST, check, finish, until, player, open, found, nav, czSection, sleep, register, restGet } from './lib.mjs';
import { signature, CATALOGUE } from '../functions/shop-core.js';
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
const PRICES = { founder: 'pri_founder0000001', idpack: 'pri_idpack00000001', vip: 'pri_vip00000000001', vipyear: 'pri_vipyear0000001', giftvip: 'pri_giftvip0000001', bfpack: 'pri_bfpack00000001', orpack: 'pri_orpack00000001', sailpack: 'pri_sailpack000001', cbpack: 'pri_cbpack00000001', tulippack: 'pri_tulippack00001' };
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
  const byPrice = Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [v, k]));
  const lines = t.items.map(i => ({ id: rid('txnitm'), price_id: i.price.id, quantity: 1, totals: { total: String(CATALOGUE.products[byPrice[i.price.id]]?.amount || 0) } }));
  Object.assign(t, { status: 'completed', customer_id: 'ctm_e2e000000001', billed_at: now, payments: [{ captured_at: now }], currency_code: 'EUR', details: { line_items: lines, totals: { total: String(lines.reduce((a, l) => a + Number(l.totals.total), 0)) } } });
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
/* the Shop's items open in a drawer; a script click reaches the card even behind another drawer's scrim */
const openDr = async (p, k) => { await p.waitForSelector(`[data-act="shop-open"][data-p="${k}"]`, { timeout: 8000 }); await p.evaluate(k => document.querySelector(`[data-act="shop-open"][data-p="${k}"]`).click(), k); await p.waitForSelector(`.shop-dr .shop-${k}`, { timeout: 8000 }); await sleep(250); };

/* ── a guest: the Shop says what linking is for, and nothing is bought ── */
/* the public pages Paddle's site review asks for: prices and a refund policy, linked from the home page */
{ const get = async u => { const r = await fetch(BASE + u); return r.ok ? r.text() : ''; };
  const [pricing, precios, refunds, reembolsos, home] = await Promise.all(['/pricing', '/precios', '/refunds', '/reembolsos', '/'].map(get));
  check('a public prices page lists the three purchases at the catalogue’s prices', /€9\.99/.test(pricing) && /€2\.99/.test(pricing) && /€4\.99/.test(pricing) && /Merchant of Record/.test(pricing) && /€9\.99/.test(precios));
  check('a public refund policy, in English and Spanish', /Refund policy/.test(refunds) && /14 days/.test(refunds) && /Política de reembolsos/.test(reembolsos));
  check('the home page links to both', home.includes('href="/pricing"') && home.includes('href="/refunds"')); }
const G = await player('shop guest', { cap: 500 });await open(G);await found(G, 'Guestovia');
await go(G, 'shop');
check('the Shop is under its own heading', /Bureau of National Finery/.test(await txt(G, 'h1')));
check('the Shop sits in the menu under Other, not Options', await G.evaluate(() => !!document.querySelector('.side .nav-grp[data-g="other"] [data-v="shop"]') && !document.querySelector('.side .nav-grp[data-g="opts"] [data-v="shop"]')));
check('a guest is told purchases need a linked sign-in', /Purchases belong to your account/.test(await txt(G, '.shop-link')));
/* the buy buttons come with the server's status, whose first call can be slow on a cold functions emulator */
await G.waitForSelector('[data-act="shop-buy"][data-p="founder"]', { timeout: 20000 });
await click(G, '[data-act="shop-buy"][data-p="founder"]');
check('buying as a guest asks for a link instead', /link a sign-in first/i.test(await txt(G, '.shop-err')) && !(await G.evaluate(() => window.__edictumCheckout)));
check('and remembers the purchase, to open its checkout once the sign-in is linked', await G.evaluate(() => !!(G.SHOP.SHOP.after && G.SHOP.SHOP.after.p === 'founder')) && /opens by itself/.test(await txt(G, '.shop-err')));
await G.evaluate(() => { G.SHOP.SHOP.after = null; G.SHOP.SHOP.err = ''; G.render(); });
/* (by script: the sign-in dialog the founder's button opened may still cover the page) */
await G.evaluate(() => document.querySelector('.shop-cd [data-act="shop-bag"][data-p="orpack"]').click());await sleep(300);
check('a guest can fill a basket', /1 item in your basket/.test(await txt(G, '.shop-bagbar')));
await G.evaluate(() => document.querySelector('.shop-bagbar [data-act="shop-buy"][data-p="bag"]').click());await sleep(300);
check('paying for it asks for a link first, and remembers the basket', /link a sign-in first/i.test(await txt(G, '.shop-err')) && await G.evaluate(() => !!(G.SHOP.SHOP.after && G.SHOP.SHOP.after.p === 'bag')) && !(await G.evaluate(() => window.__edictumCheckout)));
await G.evaluate(() => { G.SHOP.SHOP.after = null; G.SHOP.SHOP.bag = []; G.render(); });
check('without an answer from Paddle the prices stay in euros alone', !(await G.evaluate(() => document.querySelector('.shop-local'))) && /€9\.99/.test(await txt(G, '#shop-founder-tag')));

/* ── a Registered Nation buys the Founder's Package ── */
const A = await player('shop founder', { vp: { width: 1280, height: 1000 }, cap: 500 });const aUid = await open(A);await found(A, 'Gildmark');await register(A);
/* Paddle answers in the player's own currency (here Mexican pesos), as it does for a player in Mexico */
/* (set again after a reload, before the Shop is next drawn) */
const pesos = p => p.evaluate(P => { const L = { [P.founder]: 'MX$209.39', [P.idpack]: 'MX$62.71', [P.vip]: 'MX$104.66', [P.orpack]: 'MX$62.71', [P.sailpack]: 'MX$62.71', [P.cbpack]: 'MX$52.25', [P.tulippack]: 'MX$62.71' };
  const N = { [P.founder]: 20939, [P.idpack]: 6271, [P.vip]: 10466, [P.orpack]: 6271, [P.sailpack]: 6271, [P.cbpack]: 5225, [P.tulippack]: 6271 };
  window.__edictumPrices = items => ({ cur: 'MXN', prices: Object.fromEntries(items.map(id => [id, L[id]])), amounts: Object.fromEntries(items.filter(id => N[id]).map(id => [id, N[id]])) }); }, PRICES);
await pesos(A);
await go(A, 'shop');
check('the Chancery Club leads the page, before the cards', await A.evaluate(() => { const c = document.querySelector('.shop-club'), g = document.querySelector('.shop-grid'); return !!c && !!g && !!(c.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING); }));
check('the items sit in a grid of cards, two to a row on a desktop', await A.evaluate(() => { const g = document.querySelector('.shop-grid'); return !!g && getComputedStyle(g).gridTemplateColumns.split(' ').length >= 2 && document.querySelectorAll('.shop-cd').length >= 2; }));
await A.evaluate(() => scrollTo(0, 0));await A.screenshot({ path: path.join(OUT, 'shop-front.png'), fullPage: true });
/* the Black Friday Pack: a limited card, and a drawer previewing the shield and the owl on the player's own arms and flag */
check('the Black Friday Pack is on sale, with its end date', /Black Friday Pack/.test(await txt(A, '.shop-cd[data-p="bfpack"]')) && /Ends in|Last day/.test(await txt(A, '.shop-cd[data-p="bfpack"]')));
/* (shot retries: the local prices can redraw the card mid-shot) */
await shot(A, '.shop-cd[data-p="bfpack"]', 'shop-bf-card.png');
await openDr(A, 'bfpack');
check('its drawer previews the Midnight Tag shield and the Night Owl', (await A.evaluate(() => document.querySelectorAll('.shop-bf-pv svg').length)) >= 4 && (await A.evaluate(() => document.querySelectorAll('.shop-bfpack .lp-i-receipt').length)) === 1 && (await A.evaluate(() => document.querySelectorAll('.shop-bf-cardpv .hero').length)) === 1 && /Bargain-Hunter/.test(await txt(A, '.shop-bfpack')) && /€1\.99|1\.99/.test(await txt(A, '#shop-bfpack-price')) && /30 November/.test(await txt(A, '.shop-bfpack')));
await shot(A, '.shop-dr .shop-bfpack', 'shop-bf-drawer.png');
/* the Old Republic Pack: a card, and a drawer previewing all ten pieces on the player's own nation */
check('the Old Republic Pack is on sale', /Old Republic Pack/.test(await txt(A, '.shop-cd[data-p="orpack"]')));
await openDr(A, 'orpack');
check('its drawer previews the card, arms, flag, stamp, marker and paper', !!(await A.$('.shop-orpack .hero.cd-marble')) && (await A.evaluate(() => document.querySelectorAll('.shop-or-grid figure').length)) === 5 && /2\.99/.test(await txt(A, '#shop-orpack-price')));
await shot(A, '.shop-dr .shop-orpack', 'shop-or-drawer.png');
check('the Age of Sail Pack is on sale', /Age of Sail Pack/.test(await txt(A, '.shop-cd[data-p="sailpack"]')));
await openDr(A, 'sailpack');
check('its drawer previews the chart card, arms, flag, stamp, lighthouse and log', !!(await A.$('.shop-sailpack .hero.cd-chart')) && (await A.evaluate(() => document.querySelectorAll('.shop-sailpack .shop-or-grid figure').length)) === 5 && /2\.99/.test(await txt(A, '#shop-sailpack-price')));
await shot(A, '.shop-dr .shop-sailpack', 'shop-sail-drawer.png');
check('the Central Bank Pack is on sale', /Central Bank Pack/.test(await txt(A, '.shop-cd[data-p="cbpack"]')));
await openDr(A, 'cbpack');
check('its drawer previews the notes with the clear window, the coin, the card, stamp, bullion and paper', !!(await A.$('.shop-cbpack .hero.cd-treasury')) && (await A.evaluate(() => document.querySelectorAll('.shop-cbpack .cu-note').length)) === 2 && !!(await A.$('.shop-cbpack svg.cu-coin')) && (await A.evaluate(() => document.querySelectorAll('.shop-cbpack .shop-or-grid figure').length)) === 3 && /2\.49/.test(await txt(A, '#shop-cbpack-price')));
await shot(A, '.shop-dr .shop-cbpack', 'shop-cb-drawer.png');
check('the Tulip Mania Pack is on sale, eleven pieces', /Tulip Mania Pack/.test(await txt(A, '.shop-cd[data-p="tulippack"]')) && /11 pieces/.test(await txt(A, '.shop-cd[data-p="tulippack"]')));
await openDr(A, 'tulippack');
check('its drawer previews the Delftware card, the tulip banknote, arms, flag, stamp, auction house and contract', !!(await A.$('.shop-tulippack .hero.cd-delft')) && !!(await A.$('.shop-tulippack .shop-cb-cur svg')) && (await A.evaluate(() => document.querySelectorAll('.shop-tulippack .shop-or-grid figure').length)) === 5 && (await A.evaluate(() => document.querySelectorAll('.shop-tulippack .lp-i-bulb').length)) === 1 && /2\.99/.test(await txt(A, '#shop-tulippack-price')));
await shot(A, '.shop-dr .shop-tulippack', 'shop-tulip-drawer.png');
await openDr(A, 'founder');
const page = await txt(A, '.shop-founder');
check('the Founder’s Package is priced in euros', /€9\.99/.test(page), page.slice(0, 120));
check('the founder card’s drawer holds its full page', await A.evaluate(() => !!document.querySelector('.shop-dr .shop-founder')));
const founderEyebrow = await txt(A, '.shop-founder .eyebrow');
await openDr(A, 'vip');
const cmp = (await A.evaluate(() => [...document.querySelectorAll('.shop-cmp tbody tr')].map(r => [...r.children].map(c => c.textContent.trim()).join('|')))).join(' / ');
check('beside free play, in a table', /Waiting edicts on your desk\|5\|10/.test(cmp) && /Chancery seal/.test(cmp) && /nothing here adds any/.test(cmp), cmp.slice(0, 200));
const drops = CATALOGUE.products.vip.drops.map(d => ({ from: Date.parse(d.from), ids: d.ids })), later = drops.filter(d => d.from > Date.now());
if (later.length) check('the Club says when new pieces join its collection', /Two new pieces join on/.test(await txt(A, '.shop-vip')));
check('only pieces released so far are in the collection', await A.evaluate(ids => ids.every(id => !document.querySelector(`.shop-picks [data-id="${id}"]`)) && document.querySelectorAll('.shop-picks li').length >= 8, later.flatMap(d => d.ids)));
const local = await until(() => A.evaluate(() => { const f = document.querySelector('#shop-founder-tag'), v = document.querySelector('#shop-vip-price .shop-local'); return f && v && /MX/.test(f.textContent) ? [f.textContent, v.textContent] : null; }), 8000);
check('each price carries what it comes to in the player’s currency', !!local && local[0] === 'MX$209.39' && local[1] === 'MX$104.66 a month in your currency', JSON.stringify(local));
check('the Club’s button asks for the amount Paddle will charge', /MX\$104\.66 a month/.test(await txt(A, '[data-act="shop-buy"][data-p="vip"]')));
const vipEyebrow = await txt(A, '.shop-vip .eyebrow');
await openDr(A, 'founder');
check('and so does the founder’s', /MX\$209\.39/.test(await txt(A, '[data-act="shop-buy"][data-p="founder"]')));
check('the small print says Paddle charges in the player’s own currency', /charges in your own currency/.test(await txt(A, '.shop-small')));
check('the deadline is given in UTC and in the player’s own time', /1 February 2027, 23:59:59 UTC/.test(page) && /where you are/.test(page));
check('permanent and recurring are told apart', /Permanent/.test(founderEyebrow) && /Recurring/.test(vipEyebrow));
check('the humour survives', /Your citizens will remain unimpressed/.test(await txt(A, '.shop-vh')));
for (const v of ['banner', 'stamp', 'passport', 'land']) { await click(A, `[data-act="shop-pv"][data-v="${v}"]`); await shot(A, '.shop-founder .shop-pv-box', `shop-preview-${v}.png`); }
check('the passport preview carries the inscription', /FOUNDING SUPPORTER · FIRST EDITION/.test(await A.evaluate(() => { const b = document.querySelector('[data-act="shop-pv"][data-v="passport"]'); b.click(); return new Promise(r => setTimeout(() => r(document.querySelector('.shop-pv-pp')?.textContent || ''), 300)); })));
await click(A, '[data-act="shop-pv"][data-v="banner"]');
await A.evaluate(() => scrollTo(0, 0));await A.screenshot({ path: path.join(OUT, 'shop-desktop.png'), fullPage: true });
/* a checkout closed without paying: no "checkout was opened" notice, here or (once the server has looked at Paddle) anywhere */
await click(A, '[data-act="shop-buy"][data-p="founder"]');
await until(() => A.evaluate(() => window.__edictumCheckout && window.__edictumCheckout.txn), 10000);
check('an opened checkout is awaited on every device', !!(await until(async () => ((await db.doc('shop/' + aUid).get()).get('pend') || {}).founder, 5000)));
await A.evaluate(() => { window.__edictumCheckout.done = true; window.__edictumCheckout.event('checkout.closed'); });await sleep(400);
check('closing it unpaid leaves no “checkout was opened” notice and the buy button back', !/A checkout was opened/.test(await txt(A, '.shop-note')) && /Buy the Founder/.test(await txt(A, '[data-act="shop-buy"][data-p="founder"]')));
check('and the server stops awaiting it on every device', !!(await until(async () => !((await db.doc('shop/' + aUid).get()).get('pend') || {}).founder, 10000)));
await click(A, '[data-act="shop-buy"][data-p="founder"]');
const fTxn = await payFor(A);
check('the checkout was opened for a transaction the server made', !!fTxn && P.tx.get(fTxn).custom_data.uid === aUid && P.tx.get(fTxn).items[0].price.id === PRICES.founder);
check('owned once Paddle confirms it', !!(await until(() => A.evaluate(() => /Owned/.test(document.querySelector('.shop-founder')?.textContent || '')), 10000)));
check('the founder cosmetics are held, by the server’s word, with the whole Card Pack and the flag pieces', (await A.evaluate(() => G.SHOP.held().length)) === 20);
const fno = await until(() => A.evaluate(() => G.SHOP.SHOP.doc && G.SHOP.SHOP.doc.fno), 8000);
check('the founder has a number', Number.isInteger(fno) && fno > 0, String(fno));
check('and the Card Pack shows as included, not for sale', await A.evaluate(() => !document.querySelector('[data-act="shop-buy"][data-p="idpack"]')));

/* ── wearing it: the badge from the start, the rest chosen in Customise ── */
await go(A, 'nation');await A.evaluate(() => scrollTo(0, 0));await sleep(400);
check('the Founding Supporter badge is on the card without choosing it', await until(() => A.evaluate(() => !!document.querySelector('.hero .founder-pill') && !(G.S.nation.cz && G.S.nation.cz.bg)), 8000));
await go(A, 'customise');
/* only the open section is on the page: banner (b), decrees (s), finery (z) */
const CZ_SEC_FOR = { p: 'b', f: 'b', pn: 'b', st: 's', bg: 'z', ins: 'z', te: 'z' };
for (const id of ['cz-p-p-firsted', 'cz-f-f-engraver', 'cz-st-s-firsted', 'cz-pn-pn-founder', 'cz-ins-in-founder', 'cz-te-te-gilt']) {
  await czSection(A, CZ_SEC_FOR[id.split('-')[1]]);
  const ok = await until(() => A.evaluate(id => { const b = document.getElementById(id); if (!b) return false; if (b.getAttribute('aria-pressed') !== 'true') b.click(); return document.getElementById(id)?.getAttribute('aria-pressed') === 'true'; }, id), 6000);
  if (!ok) check('equipped in Customise: ' + id, false);
}
check('Customise says the badge is always worn, with nothing to choose', /Always shown beside your nation’s name/.test(await txt(A, '#cz-sec-z .cz-fixed')) && !(await A.$('#cz-bg-bg-founder')));
const worn = await A.evaluate(() => G.SHOP.cz(G.S.nation));
check('all seven founder pieces equipped in Customise', worn.p === 'p-firsted' && worn.f === 'f-engraver' && worn.st === 's-firsted' && worn.pn === 'pn-founder' && worn.bg === 'bg-founder' && worn.ins === 'in-founder' && worn.te === 'te-gilt', JSON.stringify(worn));
await go(A, 'nation');await A.evaluate(() => scrollTo(0, 0));await sleep(400);
check('the badge and the First Edition banner on the nation card', await A.evaluate(() => !!document.querySelector('.hero .founder-pill') && !!document.querySelector('.hero svg.shop-fe')));
await shot(A, '.hero.id-sec', 'shop-hero-founder.png');
await go(A, 'museum');
check('the Founders’ Wall in the museum names the founder, with their number', !!(await until(async () => /Gildmark/.test(await txt(A, '#fwall')) && /No\. \d{4}/.test(await txt(A, '#fwall .fwall-p.me')), 8000)), (await txt(A, '#fwall')).slice(0, 200));
await shot(A, '#fwall', 'shop-founders-wall.png');
check('the certificate hangs in the museum, with the nation’s name', !!(await until(() => A.evaluate(() => { const s = document.querySelector('#shop-cert svg'); return s && /Gildmark/.test(s.textContent); }), 5000)));
await shot(A, '#shop-cert', 'shop-certificate.png');
await go(A, 'shop');await openDr(A, 'idpack');
for (const cd of ['cd-ledger', 'cd-atlas', 'cd-civic', 'cd-embassy', 'cd-telegram', 'cd-holo', 'cd-starlit']) { await click(A, `[data-act="shop-cd"][data-v="${cd}"]`); await shot(A, '.shop-idpack .shop-pv-box', `shop-card-${cd.slice(3)}.png`); }
check('the card pack offers seven designs and two letter papers', (await A.evaluate(() => document.querySelectorAll('.shop-idpack [data-act="shop-cd"]').length)) === 7 && /Embassy Letterhead/.test(await txt(A, '.shop-lps')) && /Telegram Form/.test(await txt(A, '.shop-lps')));
check('the animated cards move, and say so', await A.evaluate(() => { const h = document.querySelector('.shop-idpack .hero.cd-starlit'); return !!h && getComputedStyle(h, '::before').animationName === 'cdTwinkle' && document.querySelectorAll('.shop-idpack .shop-anim').length === 2; }));
const dr = await A.evaluate(async () => { const d = document.querySelector('.shop-dr'); d.scrollTop = 300; const top = d.scrollTop; document.querySelector('[data-act="shop-cd"][data-v="cd-atlas"]').click(); await new Promise(r => setTimeout(r, 300)); const e = document.querySelector('.shop-dr'), nm = e.querySelector('.shop-pv-hero .hero-name'); return [e.scrollTop > top - 60, !e.classList.contains('in'), !!nm && nm.getBoundingClientRect().width > 150, top, e.scrollTop, nm && nm.getBoundingClientRect().width]; }); check('a click inside the drawer keeps its scroll, and the card preview is not squeezed', dr.slice(0, 3).every(Boolean), JSON.stringify(dr));
await go(A, 'map');await sleep(1200);
check('Founder’s Gilt drawn on the player’s own land', !!(await until(() => A.evaluate(() => !!document.querySelector('canvas[data-map="main"]')?._gilt), 6000)));
await A.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.remove(); });await shot(A, 'canvas[data-map="main"]', 'shop-map-gilt.png');
await A.evaluate(() => G.PG.saveSoon());await sleep(2500);

/* ── a neighbour sees it; a forger's own record does not count ── */
const B = await player('shop neighbour', { cap: 500 });const bUid = await open(B);await found(B, 'Plainholm');
const seen = await until(() => B.evaluate(id => { const n = G.S.world && G.S.world[id]; if (!n) return null; const c = G.SHOP.cz(n); return c.te === 'te-gilt' && c.bg === 'bg-founder' && c.p === 'p-firsted' ? c : null; }, aUid), 15000);
const diag = seen ? '' : JSON.stringify(await B.evaluate(id => { const n = G.S.world && G.S.world[id]; return { reg: G.S.nation && G.S.nation.reg, inWorld: !!n, worldN: Object.keys(G.S.world || {}).length, rawCz: n && n.cz, fin: [...(G.SHOP.fin(id) || [])], finN: G.SHOP.SHOP.fin.size, uid: G.S.uid }; }, aUid)) + ' A=' + JSON.stringify(await A.evaluate(() => ({ reg: G.S.nation.reg, cz: G.S.nation.cz }))) + ' finery=' + JSON.stringify((await restGet('finery/' + aUid)).body);
check('another player sees the founder finery, vouched for by the server', !!seen, JSON.stringify(seen) + diag);
await B.evaluate(id => { location.hash = 'visit/' + id; }, aUid);await sleep(900);
check('the badge beside the name on the visit page', await B.evaluate(() => !!document.querySelector('.hero .founder-pill')));
check('the badge carries the founder’s number', !!(await until(async () => /No\. \d{4}/.test(await txt(B, '.hero .founder-pill')), 8000)));
await B.click('.hero .founder-pill');await sleep(300);
check('a tap on the badge says what it is and where it comes from', /Founding Supporter/.test(await txt(B, '#fdr-pop')) && !!(await B.$('#fdr-pop [data-act="fdr-shop"]')));
await shot(B, '#fdr-pop', 'shop-founder-pop.png');
await click(B, '#fdr-pop [data-act="fdr-shop"]');
check('and leads to the Founder’s Package in the Shop', await B.evaluate(() => G.S.view === 'shop' && !!document.querySelector('.shop-dr .shop-founder')));
const tipTxt = await B.evaluate(id => G.SHOP.mapTip(id), aUid);
/* the founder's flag pieces: shown on a founder's flag, and on nobody else's */
await A.evaluate(() => { const m = G.clone(G.S.nation); m.flag = Object.assign({}, m.flag, { p: 'fdawn', e: 'e-rosette' }); G.commit(m); G.PG.saveSoon(); });
check('a founder flies Founder’s Dawn with the Founder’s Rosette', await A.evaluate(() => { const f = G.SHOP.flagNorm(G.S.nation.flag, G.S.nation); return f.p === 'fdawn' && f.e === 'e-rosette'; }));
await A.evaluate(() => G.PG.saveSoon());await sleep(2500);
check('and a neighbour sees them', !!(await until(() => B.evaluate(id => { const n = G.S.world && G.S.world[id]; if (!n) return false; const f = G.SHOP.flagNorm(n.flag, n); return f.p === 'fdawn' && f.e === 'e-rosette'; }, aUid), 12000)));
check('a nation that is no founder falls back to a plain design', await B.evaluate(() => { const n = G.clone(G.S.nation); n.flag = Object.assign({}, n.flag, { p: 'fcharter', e: 'e-keystone' }); const f = G.SHOP.flagNorm(n.flag, n); return f.p === 'border' && f.e === 'none'; }));
await A.evaluate(() => { const s = document.createElement('div'); s.id = 'fdr-flags'; s.style.cssText = 'display:flex;gap:8px;padding:8px;background:#fff'; s.innerHTML = ['fdawn', 'fcharter'].map(p => G.SHOP.flagSVG({ p, c: ['#1d3557', '#e9c46a', '#8a2a1c'], e: p === 'fdawn' ? 'e-keystone' : 'e-rosette', ec: p === 'fdawn' ? '#1d3557' : '#e9c46a' }, '')).join(''); s.querySelectorAll('svg').forEach(v => { v.style.width = '240px'; v.style.height = '160px'; }); document.body.prepend(s); });
await shot(A, '#fdr-flags', 'shop-founder-flags.png');await A.evaluate(() => document.getElementById('fdr-flags').remove());
check('a founder’s land says so on the map', /Founding Supporter No\. \d{4}/.test(tipTxt), tipTxt);
const C = await player('shop forger', { cap: 500 });const cUid = await open(C);await found(C, 'Forgeria');
/* a tampered client: the record saved as it stands, past the game's own commit (which would rewrite cz.u) */
/* the game's own first save may land in between ("Another device saved this nation"): forge again from the fresh copy */
await sleep(1500);
await C.evaluate(async () => { for (let k = 0; ; k++) { const n = G.clone(G.S.nation); n.cz = Object.assign({}, n.cz, { te: 'te-gilt', bg: 'bg-founder', p: 'p-firsted', u: ['te-gilt', 'bg-founder', 'p-firsted'] }); n.updatedAt = Date.now();
  try { await (await window.claude.use('db')).doc('nations/' + G.S.uid).set(n); G.S.nation = n; return; } catch (e) { if (k >= 4 || !/Another device/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 1000)); } } });
const forged = await until(() => B.evaluate(id => { const n = G.S.world && G.S.world[id]; return n && n.cz && n.cz.te === 'te-gilt' ? G.SHOP.cz(n) : null; }, cUid), 15000);
check('finery written into a nation’s own record is not shown to others', !!forged && forged.te === '' && forged.bg === '' && forged.p !== 'p-firsted', JSON.stringify(forged));
check('nor to its own player’s game', await C.evaluate(() => { const c = G.SHOP.cz(G.S.nation); return c.te === '' && c.bg === ''; }));

/* ── trying finery on in Customise: the neighbour tries the Engraver's frame on, and nothing is saved ── */
await go(B, 'customise');
await czSection(B, 'b');
await B.waitForSelector('[data-act="cz-try"][data-id="f-engraver"]', { timeout: 15000 });
check('the Shop’s pieces are in Customise, to try on', /Try it on/.test(await txt(B, '[data-act="cz-try"][data-id="f-engraver"]')) && !!(await B.$('[data-act="cz-try"][data-id="f-ribbon"]')));
if (drops.some(d => d.ids.includes('f-marquetry') && d.from > Date.now())) check('a piece of a later month is not offered yet', !(await B.$('[data-act="cz-try"][data-id="f-marquetry"]')));
await click(B, '[data-act="cz-try"][data-id="f-engraver"]');
check('tried on, it shows on the nation in Customise', await B.evaluate(() => G.SHOP.cz(G.S.nation).f === 'f-engraver') && /Trying on/.test(await txt(B, '.cz-lv-try')));
check('and nothing is saved', await B.evaluate(() => !(G.S.nation.cz && G.S.nation.cz.f === 'f-engraver')));
await shot(B, '.cz-live', 'shop-tryon.png');
await click(B, '[data-act="cz-try-off"]');
check('taken off with one click', await B.evaluate(() => G.SHOP.cz(G.S.nation).f !== 'f-engraver' && !document.querySelector('.cz-lv-try')));
await click(B, '[data-act="cz-try"][data-id="f-engraver"]');
await go(B, 'nation');
check('leaving Customise takes it off', await B.evaluate(() => G.SHOP.cz(G.S.nation).f !== 'f-engraver' && !G.SHOP.SHOP.tryOn));

/* ── a gift: the card pack, from Gildmark to Plainholm (a week old by the server's clock) ── */
await db.doc('authConfig/paddle').update({ skew: 8 * DAY });
await until(() => A.evaluate(id => !!(G.S.world && G.S.world[id]), bUid), 15000);
await go(A, 'shop');await openDr(A, 'idpack');
await click(A, '[data-act="shop-gift-open"][data-p="idpack"]');
await A.selectOption('#shop-gift-to', bUid);
await shot(A, '.shop-gift', 'shop-gift.png');
await click(A, '[data-act="shop-gift-buy"][data-p="idpack"]');
const gTxn = await payFor(A);
check('the gift’s checkout names the nation it is for', !!gTxn && P.tx.get(gTxn).custom_data.to === bUid && P.tx.get(gTxn).custom_data.uid === aUid);
check('the giver is told it is on its way, not kept waiting', /Gift paid/.test(await txt(A, '.shop-sent')) && !(await A.$('.shop-wait')));
check('the neighbour owns it', !!(await until(() => B.evaluate(() => G.SHOP.SHOP.doc && G.SHOP.SHOP.doc.owns && G.SHOP.SHOP.doc.owns.idpack), 10000)));
await go(B, 'shop');await openDr(B, 'idpack');
check('with the giver named in the Shop', /A gift from Gildmark/.test(await txt(B, '.shop-idpack')));
await db.doc('authConfig/paddle').update({ skew: 0 });

/* ── the Chancery Club ── */
await go(A, 'shop');await openDr(A, 'vip');
check('a desk of five before joining', (await A.evaluate(() => G.SHOP.cap(Date.now()))) === 5);
check('the Club can be paid yearly, two months free', !!(await A.$('[data-act="shop-plan"][data-v="year"]')) && /two months free/.test(await txt(A, '.shop-plan')));
await click(A, '[data-act="shop-plan"][data-v="year"]');
await shot(A, '.shop-vip', 'shop-vip-yearly.png');
check('and the button then asks for the year', /€49\.99 a year/.test(await txt(A, '[data-act="shop-buy"][data-p="vipyear"]')) && /a year/.test(await txt(A, '#shop-vip-price')));
await click(A, '[data-act="shop-plan"][data-v="month"]');
await click(A, '[data-act="shop-buy"][data-p="vip"]');
const vSub = rid('sub'), t0 = Date.now() - 13 * H;  // paid since before the hours the desk catches up on
const vTxn = await payFor(A, { sub: vSub, period: { s: t0, e: t0 + 30 * DAY } });
check('a member once the payment is confirmed', !!(await until(() => A.evaluate(() => G.SHOP.cap(Date.now()) === 10), 10000)));
/* the renewal date comes with Paddle's subscription report, a moment after the payment's */
check('paid-until and renewal shown, with Manage subscription', !!(await until(async () => { const v = await txt(A, '.shop-vip'); return /Paid until/.test(v) && /Renews on/.test(v) && !!(await A.$('[data-act="shop-portal"]')); }, 8000)), (await txt(A, '.shop-vip')).slice(0, 160));
await A.evaluate(() => { const n = G.clone(G.S.nation); n.freq = 60; n.issueClock = Date.now() - 12 * 36e5 - 60000; const v = G.syncInbox(n, Date.now()); G.commit(v); G.PG.saveSoon(); G.render(); });
check('ten edicts wait on a member’s desk', (await A.evaluate(() => G.S.nation.inbox.length)) === 10);
await until(async () => { const r = await restGet('nations/' + aUid); return r.status === 200 && r.body.fields.iq && r.body.fields.iq.integerValue === '1'; }, 10000);
check('the saved nation carries the marker that keeps older builds from cutting the queue', (await restGet('nations/' + aUid)).body.fields.iq?.integerValue === '1');
await go(A, 'issues');
check('the Edicts page counts to ten', /10 of 10 on your desk/.test(await txt(A, '.issue-meta')));
/* the monthly pick */
await go(A, 'shop');await openDr(A, 'vip');await click(A, '[data-act="shop-pick"][data-id="p-moire"]');
check('the monthly pick is kept on the public list', !!(await until(async () => { const r = await restGet('finery/' + aUid); return r.status === 200 && JSON.stringify(r.body).includes('p-moire'); }, 8000)));
await shot(A, '.shop-vip', 'shop-vip-member.png');
/* the Chancery seal: chosen in the Shop, then beside the name for the player and for the neighbour */
check('a member of a month may show the wax seal, not yet the brass', !!(await A.$('[data-act="shop-seal"][data-id="csl-member"]')) && !(await A.$('[data-act="shop-seal"][data-id="csl-brass"]')));
await click(A, '[data-act="shop-seal"][data-id="csl-member"]');
check('the seal is published for every game', !!(await until(async () => { const r = await restGet('finery/' + aUid); return r.status === 200 && JSON.stringify(r.body).includes('csl-member'); }, 8000)));
check('and shown as chosen', !!(await until(async () => /Shown/.test(await txt(A, '.club-sl.on')), 6000)));
await go(A, 'nation');await A.evaluate(() => scrollTo(0, 0));
check('beside the name on the player’s own nation card', !!(await until(() => A.evaluate(() => !!document.querySelector('.hero .club-seal[data-seal="member"]')), 6000)));
await shot(A, '.hero.id-sec', 'shop-hero-seal.png');
await B.evaluate(id => { location.hash = 'visit/' + id; }, aUid);await sleep(900);
check('and on the neighbour’s view of it', !!(await until(() => B.evaluate(() => { G.render(); return !!document.querySelector('.hero .club-seal[data-seal="member"]'); }), 10000)));
/* presets */
await go(A, 'customise');await czSection(A, 'z');
await click(A, '[data-act="pre-save"][data-k="1"]');
check('a preset saved while a member', !!(await until(() => A.evaluate(() => !!(G.SHOP.PRE.doc && G.SHOP.PRE.doc[1])), 6000)));
await czSection(A, 'b');await A.evaluate(() => document.getElementById('cz-p-p-guilloche').click());await sleep(500);await czSection(A, 'z');
await click(A, '[data-act="pre-load"][data-k="1"]');
check('loading it puts the saved look back on', (await A.evaluate(() => G.SHOP.cz(G.S.nation).p)) === 'p-firsted');
/* presets saved on another device since this page read them are kept (a save here once wrote its old copy over them) */
const presetSlots = () => A.evaluate(async () => { const s = await (await window.claude.use('db')).doc('presets/' + G.S.uid).get(); return Object.keys((s.exists && s.data().p) || {}).sort(); });
const elsewhere = k => A.evaluate(async k => { const db = await window.claude.use('db'), s = await db.doc('presets/' + G.S.uid).get(), p = { ...s.data().p };
  p[k] = { n: 'From another device ' + k, cz: {}, fj: '{}', t: Date.now() }; await db.doc('presets/' + G.S.uid).set({ p }); }, k);
await elsewhere('2');
check('this page has not seen the other device’s preset', await A.evaluate(() => !G.SHOP.PRE.doc[2]));
await click(A, '[data-act="pre-save"][data-k="3"]');
check('saving one keeps the one another device saved', !!(await until(async () => JSON.stringify(await presetSlots()) === '["1","2","3"]', 6000)), JSON.stringify(await presetSlots()));
await elsewhere('4');
await click(A, '[data-act="pre-save"][data-k="4"]');
check('a slot another device filled meanwhile is asked about first, not saved over', !!(await until(() => A.evaluate(() => G.SHOP.PRE.confirm === '4' && /From another device 4/.test(G.SHOP.PRE.doc[4].n)), 6000)));
await click(A, '[data-act="pre-cancel"]');
/* presets that could not be read show as not loaded, never as empty slots to save over */
await A.evaluate(() => { Object.assign(G.SHOP.PRE, { doc: null, uid: '', failAt: Date.now() }); G.render(); });
check('presets that could not be read cannot be saved over', await A.evaluate(() => !!document.getElementById('pre-wait') && !document.querySelector('[data-act="pre-save"]')));
await A.evaluate(() => { G.SHOP.PRE.failAt = 0; G.render(); });
check('and they load again', !!(await until(() => A.evaluate(() => !!document.querySelector('[data-act="pre-load"][data-k="2"]') && !!G.SHOP.PRE.doc && Object.keys(G.SHOP.PRE.doc).length === 4), 8000)));
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
await B.evaluate(() => { location.hash = 'map'; });await sleep(300);await B.evaluate(id => { location.hash = 'visit/' + id; }, aUid);
check('the wax seal ends with the membership, for the neighbour too', !!(await until(() => B.evaluate(() => { G.render(); return !!document.querySelector('.hero') && !document.querySelector('.hero .club-seal'); }), 10000)));
await go(A, 'customise');await sleep(600);
check('presets still load after, but cannot be saved', await A.evaluate(() => !!document.querySelector('[data-act="pre-load"][data-k="1"]') && !document.querySelector('[data-act="pre-save"]')));
await go(A, 'chronicle');
check('the Chronicle is read-only after', /Read-only/.test(await txt(A, '.notice')));

/* ── a full desk outside the Club: one quiet line once an edict could not arrive, put away for a day ── */
await B.evaluate(() => { let n = G.clone(G.S.nation); n.freq = 60; n.issueClock = Date.now() - 6 * 36e5; n = G.syncInbox(n, Date.now()); G.commit(n);
  const m = G.clone(G.S.nation); m.issueClock = Date.now() - 2 * 36e5 - 60000; G.commit(m); G.render(); });
await go(B, 'issues');
const hint = await until(async () => (await txt(B, '.desk-hint')) || null, 15000);
check('a full desk says edicts could not arrive, and what a desk in the Club holds', !!hint && /2 edicts could not arrive/.test(hint) && /holds ten/.test(hint), String(hint));
await shot(B, '.desk-hint', 'shop-desk-hint.png');
await click(B, '[data-act="desk-hint-off"]');
check('“Not now” puts it away', !(await B.$('.desk-hint')));
check('a member’s desk shows no such line', !(await A.$('.desk-hint')));

/* ── a basket: three packs in one checkout and one payment ── */
await pesos(A);await go(A, 'shop');await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);
check('a pack on sale can go in the basket from its card', await A.evaluate(() => ['orpack', 'sailpack', 'cbpack'].every(p => document.querySelector(`.shop-cd [data-act="shop-bag"][data-p="${p}"]`))));
check('nothing owned, included, given or joined can', await A.evaluate(() => ['founder', 'idpack', 'vip', 'vipyear', 'giftvip'].every(p => !document.querySelector(`[data-act="shop-bag"][data-p="${p}"]`))));
check('no basket bar while the basket is empty', !(await A.$('.shop-bagbar')));
await click(A, '.shop-cd [data-act="shop-bag"][data-p="orpack"]');await click(A, '.shop-cd [data-act="shop-bag"][data-p="sailpack"]');
const bar = await txt(A, '.shop-bagbar');
check('the bar counts two, with their sum in the player’s currency', /2 items in your basket · MX\$125\.42/.test(bar) && /Old Republic Pack, Age of Sail Pack/.test(bar), bar);
check('a card in the basket says so, and its button takes it out again', /Added/.test(await txt(A, '.shop-cd[data-p="orpack"] .shop-bag-b')) && !!(await A.$('.shop-cd[data-p="orpack"] [data-act="shop-bag-del"]')));
await shot(A, '.shop-bagbar', 'shop-basket-bar.png');
await openDr(A, 'cbpack');await click(A, '.shop-dr [data-act="shop-bag"][data-p="cbpack"]');
check('a drawer’s own button adds it too', /In your basket/.test(await txt(A, '.shop-dr .shop-bag-b')));
check('the basket is kept on this device', JSON.stringify(await A.evaluate(() => JSON.parse(localStorage.getItem('edictum.shop.bag')))) === '["orpack","sailpack","cbpack"]');
await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);
await click(A, '.shop-bagbar [data-act="shop-open"][data-p="bag"]');await A.waitForSelector('.shop-dr .shop-bag', { timeout: 8000 });
const bag = await txt(A, '.shop-dr .shop-bag');
check('the basket lists each pack with its price, and the sum', (await A.evaluate(() => document.querySelectorAll('.shop-dr .shop-bag-r').length)) === 3 && /MX\$177\.67/.test(bag) && /€8\.47/.test(bag), bag.slice(0, 300));
check('while it is open, its button is the only one that pays', (await A.evaluate(() => document.querySelectorAll('[data-act="shop-buy"][data-p="bag"]').length)) === 1);
await A.screenshot({ path: path.join(OUT, 'shop-basket.png') });
await click(A, '.shop-dr [data-act="shop-bag-del"][data-p="cbpack"]');
check('Remove takes one out', (await A.evaluate(() => document.querySelectorAll('.shop-dr .shop-bag-r').length)) === 2 && /MX\$125\.42/.test(await txt(A, '.shop-dr .shop-bag')));
check('and the basket suggests it again', !!(await A.$('.shop-dr .shop-mini[data-p="cbpack"]')));
await A.evaluate(() => document.querySelector('.shop-dr .shop-mini[data-p="cbpack"]').click());await sleep(300);
await click(A, '.shop-dr [data-act="shop-bag"][data-p="cbpack"]');
await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);
await click(A, '.shop-bagbar [data-act="shop-open"][data-p="bag"]');await A.waitForSelector('.shop-dr .shop-bag', { timeout: 8000 });
await click(A, '.shop-dr [data-act="shop-buy"][data-p="bag"]');
check('an opened basket is awaited on every device, for each pack in it', !!(await until(async () => { const pd = (await db.doc('shop/' + aUid).get()).get('pend') || {}; return pd.orpack && pd.sailpack && pd.cbpack; }, 6000)));
const bTxn = await payFor(A);
check('one checkout for all three, at the server’s prices', !!bTxn && P.tx.get(bTxn).items.map(i => i.price.id).join() === [PRICES.orpack, PRICES.sailpack, PRICES.cbpack].join() && P.tx.get(bTxn).custom_data.product === 'basket' && P.tx.get(bTxn).custom_data.uid === aUid);
check('paid, the basket empties at once', await A.evaluate(() => G.SHOP.SHOP.bag.length === 0 && !document.querySelector('.shop-bagbar')));
check('all three owned once Paddle confirms it', !!(await until(() => A.evaluate(() => ['orpack', 'sailpack', 'cbpack'].every(p => G.SHOP.SHOP.doc && G.SHOP.SHOP.doc.owns && G.SHOP.SHOP.doc.owns[p])), 10000)));
check('their pieces are held, by the server’s word', await A.evaluate(ids => ids.every(id => G.SHOP.held().includes(id)), [...CATALOGUE.products.orpack.grants, ...CATALOGUE.products.sailpack.grants, ...CATALOGUE.products.cbpack.grants]));
check('and nothing is awaited any more', !!(await until(() => A.evaluate(() => !G.SHOP.SHOP.wait && !document.querySelector('.shop-wait')), 8000)));
check('owned packs can no longer go in a basket', await A.evaluate(() => ['orpack', 'sailpack', 'cbpack'].every(p => !document.querySelector(`[data-act="shop-bag"][data-p="${p}"]`))));
await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);

/* ── in the dark theme ── */
await A.emulateMedia({ colorScheme: 'dark' });await go(A, 'shop');await sleep(600);await A.evaluate(() => scrollTo(0, 0));
await A.screenshot({ path: path.join(OUT, 'shop-dark.png') });
await openDr(A, 'idpack');await A.screenshot({ path: path.join(OUT, 'shop-drawer-dark.png') });
check('Escape closes the drawer', await A.evaluate(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await new Promise(r => setTimeout(r, 200)); return !document.querySelector('.shop-dr'); }));
await A.emulateMedia({ colorScheme: 'light' });

/* ── on a phone ── */
await A.setViewportSize({ width: 390, height: 844 });await go(A, 'shop');await sleep(600);
check('no sideways scrolling on a phone', await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await A.screenshot({ path: path.join(OUT, 'shop-phone.png'), fullPage: true });
await openDr(A, 'idpack');await A.screenshot({ path: path.join(OUT, 'shop-phone-drawer.png') });
check('the drawer is a bottom sheet on a phone, with no sideways scrolling', await A.evaluate(() => { const d = document.querySelector('.shop-dr').getBoundingClientRect(); return d.bottom >= innerHeight - 1 && d.top > 0 && document.documentElement.scrollWidth <= innerWidth + 1; }));
/* the basket's bar on a phone: above the tab bar, no sideways scrolling */
await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);
if (Date.now() < Date.parse(CATALOGUE.products.bfpack.until)) {
  await click(A, '.shop-cd [data-act="shop-bag"][data-p="bfpack"]');
  check('on a phone the basket’s bar sits above the tab bar, with no sideways scrolling', await A.evaluate(() => { const b = document.querySelector('.shop-bagbar'), t = document.querySelector('.tabbar'); if (!b) return false; const r = b.getBoundingClientRect();
    return r.right <= innerWidth + 1 && r.left >= 0 && (!t || getComputedStyle(t).display === 'none' || r.bottom <= t.getBoundingClientRect().top + 1) && document.documentElement.scrollWidth <= innerWidth + 1; }));
  await shot(A, '.shop-bagbar', 'shop-phone-basket-bar.png');
  await A.evaluate(() => { G.SHOP.SHOP.bag = []; G.render(); });await sleep(200);
}
/* the wishlist and Hide owned are this device's own */
await A.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));await sleep(300);
await click(A, '[data-act="shop-wish"][data-p="idpack"]');await click(A, '[data-act="shop-f"][data-v="wish"]');
check('a hearted item shows under Wishlist', (await A.evaluate(() => [...document.querySelectorAll('.shop-cd')].map(c => c.dataset.p))).join() === 'idpack');
await click(A, '[data-act="shop-f"][data-v="all"]');await click(A, '#shop-ho');
check('Hide owned leaves out what the nation owns (the Card Pack comes with the founder’s), and keeps the rest', await A.evaluate(() => !document.querySelector('.shop-cd[data-p="founder"]') && !document.querySelector('.shop-cd[data-p="idpack"]') && !!document.querySelector('.shop-cd[data-p="giftvip"]')));
await click(A, '#shop-ho');

server.close();
await db.doc('authConfig/paddle').delete();
await finish();
