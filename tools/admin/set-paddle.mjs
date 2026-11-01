// Set up the shop's payments for a Firebase project (functions/shop.js; docs/shop.md, the owner's steps).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-paddle.mjs --env sandbox
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-paddle.mjs --check
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-paddle.mjs --off
//
// It asks for Paddle's server-side API key and the notification destination's secret key (neither is shown as you
// type it), the client-side token, and the three price IDs, and keeps them in Firestore at authConfig/paddle, which
// only the Cloud Functions read (firestore.rules). Then it checks them with Paddle (as --check does alone): each price
// is active, in euros, at the catalogue's amount (functions/shop-catalogue.json), one-off or monthly as it should be,
// and a notification destination sends the events the shop needs to the paddle function. --env live switches to
// Paddle's live API (keys pdl_live_…, tokens live_…); sandbox is the default. --off removes the set-up: the Shop then
// says it is not open, and what players own stays theirs. Prices may be given as --prices founder=pri_…,idpack=pri_…,
// vip=pri_…; a product may keep older prices after the first (vip=pri_new+pri_old) so renewals at an old price count.
// With FIRESTORE_EMULATOR_HOST set, this talks to the Firestore emulator instead and needs no key.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';

const CAT = JSON.parse(readFileSync(new URL('../../functions/shop-catalogue.json', import.meta.url), 'utf8'));
const PRODUCTS = Object.keys(CAT.products);
const EVENTS = ['transaction.completed', 'subscription.created', 'subscription.updated', 'subscription.canceled', 'subscription.past_due', 'subscription.activated', 'adjustment.created', 'adjustment.updated'];
const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? String(args[i + 1] || '') : null; };
const off = args.includes('--off'), checkOnly = args.includes('--check');
const env = arg('--env') || 'sandbox';
if (!['sandbox', 'live'].includes(env)) { console.error('--env is sandbox or live.'); process.exit(2); }
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON file.'); process.exit(2); }
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-edictum' } : { credential: applicationDefault() });
const ref = getFirestore().doc('authConfig/paddle');
const priceList = v => [].concat(v || []);
const priceOk = v => /^pri_[a-z0-9]{8,64}$/.test(v);

async function check(cfg) {
  const api = cfg.env === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  const get = async path => { const r = await fetch(api + path, { headers: { authorization: 'Bearer ' + cfg.apiKey } }); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${b.error?.code || ''} ${b.error?.detail || ''}`); return b.data; };
  let bad = 0;
  const say = (ok, msg) => { console.log((ok ? '  ok    ' : '  WRONG ') + msg); if (!ok) bad++; };
  console.log(`Checking with Paddle (${cfg.env}):`);
  for (const p of PRODUCTS) {
    const want = CAT.products[p], [id] = priceList(cfg.prices[p]);
    let pr;
    try { pr = await get('/prices/' + id); } catch (e) { say(false, `${p}: ${e.message}`); continue; }
    say(pr.status === 'active', `${p}: price ${id} is ${pr.status}`);
    say(pr.unit_price?.currency_code === CAT.currency, `${p}: in ${pr.unit_price?.currency_code} (want ${CAT.currency})`);
    say(String(pr.unit_price?.amount) === String(want.amount), `${p}: ${pr.unit_price?.amount} cents (the catalogue says ${want.amount})`);
    const monthly = pr.billing_cycle && pr.billing_cycle.interval === 'month' && pr.billing_cycle.frequency === 1;
    say(want.kind === 'monthly' ? monthly : !pr.billing_cycle, `${p}: ${pr.billing_cycle ? 'every ' + pr.billing_cycle.frequency + ' ' + pr.billing_cycle.interval : 'one payment'} (want ${want.kind === 'monthly' ? 'monthly' : 'one payment'})`);
    say(pr.tax_mode !== 'external', `${p}: tax mode ${pr.tax_mode} (the shop shows prices with tax included: account setting or internal)`);
  }
  try {
    const dests = (await get('/notification-settings')).filter(d => d.active && /\/paddle\/?$/.test(String(d.destination || '')));
    say(dests.length > 0, dests.length ? `notifications go to ${dests.map(d => d.destination).join(', ')}` : 'no active notification destination ends in /paddle');
    const have = new Set(dests.flatMap(d => (d.subscribed_events || []).map(e => e.name)));
    for (const e of EVENTS) say(have.has(e), `notification ${e}`);
  } catch (e) { say(false, 'notification destinations: ' + e.message); }
  console.log(bad ? `${bad} thing(s) to fix in Paddle before the shop opens.` : 'Everything Paddle needs is in place.');
  return bad;
}

try {
  if (off) { await ref.delete(); console.log('The shop is closed. What players own stays theirs; reopen it by running this again.'); process.exit(0); }
  if (checkOnly) {
    const s = await ref.get();
    if (!s.exists) { console.error('Not set up yet: run this without --check.'); process.exit(1); }
    process.exit(await check(s.data()) ? 1 : 0);
  }
  let muted = false;
  const out = new Writable({ write(chunk, enc, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: !!process.stdin.isTTY }), lines = rl[Symbol.asyncIterator]();
  const ask = async (q, hide) => { process.stdout.write(q); muted = hide; const { value } = await lines.next(); muted = false; if (hide) process.stdout.write('\n'); return String(value || '').trim(); };
  const live = env === 'live';
  const apiKey = (process.env.PADDLE_API_KEY || await ask(`Paddle API key (pdl_${live ? 'live' : 'sdbx'}_apikey_…, not shown): `, true)).trim();
  if (!new RegExp(`^pdl_${live ? 'live' : 'sdbx'}_apikey_[A-Za-z0-9_]{10,}$`).test(apiKey)) { rl.close(); console.error(`That is not a ${env} API key.`); process.exit(2); }
  const webhookSecret = (process.env.PADDLE_WEBHOOK_SECRET || await ask('Notification destination secret key (pdl_ntfset_…, not shown): ', true)).trim();
  if (!/^pdl_ntfset_[A-Za-z0-9_]{10,}$/.test(webhookSecret)) { rl.close(); console.error('That is not a notification secret key.'); process.exit(2); }
  const clientToken = (process.env.PADDLE_CLIENT_TOKEN || await ask(`Client-side token (${live ? 'live' : 'test'}_…): `, false)).trim();
  if (!new RegExp(`^${live ? 'live' : 'test'}_[A-Za-z0-9]{10,}$`).test(clientToken)) { rl.close(); console.error(`That is not a ${env} client-side token.`); process.exit(2); }
  const prices = {};
  const given = Object.fromEntries((arg('--prices') || '').split(',').filter(Boolean).map(s => s.split('=')).map(([k, v]) => [k.trim(), String(v || '').split('+').map(x => x.trim())]));
  for (const p of PRODUCTS) {
    const v = given[p] || [await ask(`Price ID for ${CAT.products[p].name} (${(CAT.products[p].amount / 100).toFixed(2)} ${CAT.currency}${CAT.products[p].kind === 'monthly' ? ' a month' : ''}): `, false)];
    if (!v.length || !v.every(priceOk)) { rl.close(); console.error(`${p}: price IDs look like pri_…`); process.exit(2); }
    prices[p] = v.length === 1 ? v[0] : v;
  }
  rl.close();
  const cfg = { env, apiKey, webhookSecret, clientToken, prices, at: Date.now() };
  await ref.set(cfg);
  console.log(`Saved for Paddle ${env}. The Shop opens at the next page load.`);
  process.exit(await check(cfg) ? 1 : 0);
} catch (e) {
  console.error('Could not save the set-up: ' + e.message);
  process.exit(1);
}
