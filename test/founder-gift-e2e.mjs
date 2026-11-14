// The founders' thank-you gift in the browser, against the emulators and a stand-in for Paddle (as shop-e2e plays it):
// a new founder sees the pop-up once, chooses the Central Bank Pack and holds its pieces; a second founder, on a phone,
// chooses Later, finds the gift waiting in the Shop and opens it from there; the admin portal's Shop statistics count
// the choice and the founder still to choose. Screenshots land in test/out (fgift-*.png).
//   npm run test:founder-gift
import { OUT, PROJECT, FN_HOST, check, finish, until, player, open, found, sleep, register, setClaims, ready, text } from './lib.mjs';
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
const db = getFirestore(), SECRET = 'pdl_ntfset_e2e_fgift';
const PRICES = { founder: 'pri_founder0000001', idpack: 'pri_idpack00000001', vip: 'pri_vip00000000001', orpack: 'pri_orpack00000001', sailpack: 'pri_sailpack000001', cbpack: 'pri_cbpack00000001' };
const rid = p => p + '_' + crypto.randomBytes(13).toString('hex');

/* ── Paddle, played by this test ── */
const P = new Map();
const server = http.createServer(async (req, res) => {
  let body = '';for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), b = body ? JSON.parse(body) : null, send = (c, d) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  let m;
  if (req.method === 'POST' && u.pathname === '/transactions') { const t = { id: rid('txn'), status: 'ready', items: b.items.map(i => ({ price: { id: i.price_id }, quantity: 1 })), custom_data: b.custom_data, created_at: new Date().toISOString() }; P.set(t.id, t); return send(201, { data: t }); }
  if ((m = /^\/transactions\/(txn_\w+)$/.exec(u.pathname))) return P.has(m[1]) ? send(200, { data: P.get(m[1]) }) : send(404, {});
  if (req.method === 'GET' && (u.pathname === '/transactions' || u.pathname === '/adjustments')) return send(200, { data: [] });
  send(404, {});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await db.doc('authConfig/paddle').set({ env: 'fake', apiKey: 'pdl_sdbx_apikey_e2e', webhookSecret: SECRET, clientToken: 'test_e2e', prices: PRICES, api: 'http://127.0.0.1:' + server.address().port });
async function hook(type, data) {
  const body = JSON.stringify({ event_id: rid('evt'), event_type: type, occurred_at: new Date().toISOString(), data });
  const r = await fetch(`http://${FN_HOST}/${PROJECT}/europe-west1/paddle`, { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': signature(Buffer.from(body), SECRET) }, body });
  return r.status;
}
const txt = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
const go = async (p, v) => { await p.evaluate(v => { const b = document.querySelector(`.nav [data-v="${v}"]`); if (b) b.click(); else location.hash = v; }, v); await sleep(400); };
const popup = p => p.evaluate(() => !!document.getElementById('fgf'));
/* a Registered Nation buys the Founder's Package in the Shop; Paddle takes the payment and reports it */
async function becomeFounder(p) {
  await go(p, 'shop');
  await p.waitForSelector('[data-act="shop-open"][data-p="founder"]', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('[data-act="shop-open"][data-p="founder"]').click());
  await p.waitForSelector('.shop-dr [data-act="shop-buy"][data-p="founder"]', { timeout: 20000 });
  await p.click('.shop-dr [data-act="shop-buy"][data-p="founder"]');
  const txn = await until(() => p.evaluate(() => window.__edictumCheckout && !window.__edictumCheckout.done && window.__edictumCheckout.txn), 10000);
  await p.evaluate(() => { window.__edictumCheckout.done = true; });
  const t = P.get(txn), now = new Date().toISOString();
  Object.assign(t, { status: 'completed', customer_id: 'ctm_e2e' + crypto.randomBytes(5).toString('hex'), billed_at: now, payments: [{ captured_at: now }] });
  await p.evaluate(() => window.__edictumCheckout.event('checkout.completed'));
  check('Paddle’s signed report is accepted', (await hook('transaction.completed', t)) === 200);
  return until(() => p.evaluate(() => G.SHOP.SHOP.doc && G.SHOP.SHOP.doc.owns && !!G.SHOP.SHOP.doc.owns.founder), 15000);
}

/* ── a new founder: the pop-up, a choice, the pack ── */
const A = await player('gift founder', { vp: { width: 1280, height: 900 }, cap: 500 });
await A.addInitScript(() => { window.EDICTUM_FG = 1; });
const aUid = await open(A); await found(A, 'Giftmark'); await register(A);
check('the shop starts with no pop-up for a nation that is not a founder', !(await popup(A)));
check('the Founder’s Package is bought', await becomeFounder(A));
check('the thank-you pop-up opens for the new founder', await until(() => popup(A), 15000));
await A.evaluate(() => document.querySelector('.shop-dr-x')?.click()).catch(() => {});
const pop = await text(A, '#fgf .fgf');
check('it thanks the founder by number and runs until 30 November', /Thank you, Founder No\. \d+/.test(pop) && /until 30 November/.test(pop), pop.slice(0, 200));
check('it offers the three packs, in the catalogue’s order, with what each is worth', (await A.evaluate(() => [...document.querySelectorAll('#fgf .fgf-pk')].map(b => b.dataset.fgf).join())) === CATALOGUE.founderGift.packs.join()
  && /Central Bank Pack/.test(pop) && /Age of Sail Pack/.test(pop) && /Old Republic Pack/.test(pop) && /12 pieces · worth €2\.49/.test(pop) && /worth €2\.99/.test(pop), pop);
check('each pack shows a picture', await A.evaluate(() => [...document.querySelectorAll('#fgf .fgf-art')].every(a => !!a.querySelector('svg'))));
check('nothing can be taken before a pack is chosen', await A.evaluate(() => document.getElementById('fgf-ok').disabled));
await sleep(300); await A.screenshot({ path: path.join(OUT, 'fgift-popup-desktop.png') });
await A.click('#fgf .fgf-pk[data-fgf="cbpack"]');
check('choosing a pack marks it and names it on the button', await A.evaluate(() => document.querySelector('.fgf-pk[data-fgf="cbpack"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.fgf-pk[data-fgf="orpack"]').getAttribute('aria-pressed') === 'false' && /Take the Central Bank Pack/.test(document.getElementById('fgf-ok').textContent) && !document.getElementById('fgf-ok').disabled));
await sleep(300); await A.screenshot({ path: path.join(OUT, 'fgift-popup-chosen.png') });
await A.click('#fgf-ok');
check('the pack is granted', await until(async () => /The Central Bank Pack is yours/.test(await text(A, '#fgf .fgf')), 15000), await text(A, '#fgf'));
await sleep(700); await A.screenshot({ path: path.join(OUT, 'fgift-granted.png') });
const sA = (await db.doc('shop/' + aUid).get()).data() || {};
check('the server holds it as owned, and as the founder’s gift', !!sA.owns?.cbpack && sA.fg === 'cbpack', JSON.stringify({ owns: sA.owns, fg: sA.fg }));
check('the choice is kept for the statistics', (await db.doc('shopFGift/' + aUid).get()).get('p') === 'cbpack');
check('its pieces are held on this device too', await until(() => A.evaluate(ids => ids.every(id => G.SHOP.held().includes(id)), CATALOGUE.products.cbpack.grants), 8000));
check('the nation remembers it was asked', await until(() => A.evaluate(() => G.S.nation.fgs === 1), 5000));
await A.click('#fgf-close'); await sleep(400);
check('closed', !(await popup(A)));
await go(A, 'shop');
check('the Shop shows no waiting gift once one is chosen', !(await A.$('.fgf-banner')));
check('and the Central Bank Pack’s card says it was the founder’s gift', /Founder’s gift/.test(await txt(A, '.shop-cd[data-p="cbpack"]')), await txt(A, '.shop-cd[data-p="cbpack"]'));
await A.reload(); await ready(A); await sleep(5000);
check('it does not come back after a reload', !(await popup(A)));

/* ── a second founder, on a phone: Later, then from the Shop ── */
const B = await player('gift later', { vp: { width: 390, height: 844 }, cap: 500 });
await B.addInitScript(() => { window.EDICTUM_FG = 1; });
await open(B); await found(B, 'Laterholm'); await register(B);
check('the second founder’s package is bought', await becomeFounder(B));
check('the pop-up opens on a phone too', await until(() => popup(B), 15000));
await B.evaluate(() => document.querySelector('.shop-dr-x')?.click()).catch(() => {});
check('on a phone the packs stack in one column and nothing scrolls sideways', await B.evaluate(() => getComputedStyle(document.querySelector('.fgf-packs')).gridTemplateColumns.split(' ').length === 1 && document.documentElement.scrollWidth <= innerWidth + 1));
await sleep(300); await B.screenshot({ path: path.join(OUT, 'fgift-popup-phone.png') });
await B.click('#fgf-later'); await sleep(400);
check('Later closes it, and the nation remembers it was asked', !(await popup(B)) && await until(() => B.evaluate(() => G.S.nation.fgs === 1), 5000));
await go(B, 'shop');
check('the Shop keeps the gift waiting', /Your thank-you gift is waiting/.test(await text(B, '.fgf-banner')) && /Central Bank, Age of Sail or Old Republic Pack/.test(await text(B, '.fgf-banner')), await text(B, '.fgf-banner'));
await B.locator('.fgf-banner').screenshot({ path: path.join(OUT, 'fgift-banner-phone.png') });
await B.reload(); await ready(B); await sleep(5000);
check('the pop-up does not come back by itself', !(await popup(B)));
await go(B, 'shop');
await B.waitForSelector('[data-act="fgf-open"]', { timeout: 10000 });
await B.click('[data-act="fgf-open"]');
check('the banner opens it again', await until(() => popup(B), 4000));
await B.keyboard.press('Escape'); await sleep(300);
check('Escape closes it, and the gift still waits', !(await popup(B)) && !!(await B.$('.fgf-banner')));
check('nothing was chosen for the second founder', !(await db.doc('shopFGift/' + (await ready(B))).get()).exists);

/* ── the admin portal counts the choices ── */
await setClaims(aUid, { admin: true }); await A.reload(); await ready(A);
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.click('.adm-nav [data-v="admin-shop"]');
const g = () => text(A, '#adsh-fgift');
check('Shop statistics count the founders’ choices by pack, and who has still to choose', await until(async () => { const t = await g(); return /Founders’ thank-you gift/.test(t) && /1\s*chose the Central Bank Pack/.test(t) && /0\s*chose the Age of Sail Pack/.test(t) && /1\s*founder still to choose/.test(t) && /Giftmark/.test(t); }, 30000), await g());
await A.locator('#adsh-fgift').screenshot({ path: path.join(OUT, 'fgift-admin.png') });

server.close();
await finish();
