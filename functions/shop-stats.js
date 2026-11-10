/* The admin portal's Shop statistics page (adminConsole op 'shopStats'): the shop's own billing records — shopTx,
   shopSubs, shopAdj and shopCheckouts, which only functions/shop.js writes — boiled down to sales, refunds,
   subscriptions and checkouts. Pure: admin.js reads the records and hands them in, so the tests need no emulator.

   Money: Paddle charges in the buyer's local currency (shopTx.cur, total in that currency's lowest unit), so takings
   are kept apart per currency. "At list price" adds each sale's catalogue euro price instead, for one comparable sum. */
import { CATALOGUE, FOUNDER_GIFT, refundState, voided } from './shop-core.js';

export const DAY = 86400000;
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

export function shopSummary({ txs = [], subs = [], adjs = [], cks = [] }, now = Date.now(), env = '') {
  /* the environment the shop runs in now: sandbox records left on a live shop are not sales */
  const mine = r => !env || !r.env || r.env === env;
  txs = txs.filter(mine); cks = cks.filter(mine);
  const P = CATALOGUE.products, list = k => P[k]?.amount || 0;
  const products = Object.fromEntries(Object.keys(P).map(k => [k, { sold: 0, kept: 0, refunded: 0, gifts: 0, list: 0, money: {}, opened30: 0, paid30: 0 }]));
  const money = {}, refundedMoney = {}, days = {}, buyers = new Set(), buyers30 = new Set();
  let sold = 0, kept = 0, refunded = 0, pendingRefunds = 0, chargebacks = 0, gifts = 0, listKept = 0, list30 = 0, sold30 = 0, sold7 = 0, sold1 = 0;
  for (let i = 59; i >= 0; i--) days[dayKey(now - i * DAY)] = { n: 0, list: 0 };
  const recent = [];
  for (const t of txs) {
    if (t.status && t.status !== 'completed') continue;
    const p = products[t.product], gone = voided(t.id, adjs), rs = refundState(t.id, adjs), at = t.paid || 0;
    sold++; if (p) p.sold++;
    if (t.gift) { gifts++; if (p) p.gifts++; }
    if (t.payer || t.uid) buyers.add(t.payer || t.uid);
    if (gone) {
      refunded++; if (p) p.refunded++;
      if (t.cur) add(refundedMoney, t.cur, Number(t.total) || 0);
    } else {
      kept++; listKept += list(t.product);
      if (p) { p.kept++; p.list += list(t.product); if (t.cur) add(p.money, t.cur, Number(t.total) || 0); }
      if (t.cur) add(money, t.cur, Number(t.total) || 0);
    }
    if (rs === 'pending') pendingRefunds++;
    if (at > now - 30 * DAY) { sold30++; if (!gone) list30 += list(t.product); if (t.payer || t.uid) buyers30.add(t.payer || t.uid); if (p) p.paid30++; }
    if (at > now - 7 * DAY) sold7++;
    if (at > now - DAY) sold1++;
    const d = days[dayKey(at)];
    if (d) { d.n++; if (!gone) d.list += list(t.product); }
    recent.push({ id: t.id, uid: t.uid || '', payer: t.payer || '', gift: !!t.gift, product: t.product || '', paid: at, cur: t.cur || '', total: Number(t.total) || 0,
      refund: gone ? 'refunded' : rs === 'pending' ? 'pending' : rs === 'rejected' ? 'rejected' : '', renewal: !!t.sub && !t.ck });
  }
  for (const a of adjs) if (a.action === 'chargeback' && a.status === 'approved') chargebacks++;
  recent.sort((a, b) => b.paid - a.paid);

  /* subscriptions: Paddle's status, and whether a cancellation is booked for the end of the paid period */
  const status = {}, clubNow = new Set();
  let canceling = 0, monthlyList = 0;
  for (const s of subs) {
    const st = s.status || 'unknown';
    add(status, st);
    if (['active', 'trialing', 'past_due'].includes(st)) {
      if (s.uid) clubNow.add(s.uid);
      if (s.cancelAt > now) canceling++;
      /* what the live subscriptions bring in a month at list price; a yearly one counts a twelfth */
      const firstTx = txs.find(t => t.id === s.firstTxn) || txs.find(t => t.sub === s.id);
      const k = firstTx?.product || 'vip';
      monthlyList += P[k]?.kind === 'yearly' ? Math.round(list(k) / 12) : list(k);
    }
  }

  /* checkouts opened in the last 30 days, and how many were paid */
  const paidIds = new Set(txs.map(t => t.id));
  let opened30 = 0, paid30 = 0;
  for (const c of cks) {
    if (!(c.at > now - 30 * DAY)) continue;
    opened30++; if (products[c.product]) products[c.product].opened30++;
    if (paidIds.has(c.id)) paid30++;
  }

  return {
    at: now, env, currency: CATALOGUE.currency,
    sold, kept, refunded, pendingRefunds, chargebacks, gifts, buyers: buyers.size, buyers30: buyers30.size,
    sold1, sold7, sold30, listKept, list30, money, refundedMoney,
    club: { members: clubNow.size, canceling, monthlyList, status },
    checkouts: { opened30, paid30 },
    products: Object.entries(products).map(([k, v]) => ({ k, name: P[k].name, kind: P[k].kind, amount: list(k), ...v })),
    days: Object.entries(days).map(([d, v]) => ({ d, ...v })),
    recent: recent.slice(0, 30)
  };
}

/* The founders' thank-you gift: the pack each founder chose (shopFGift/{uid}: {p, at, fno}), against the founders there are
   now (founders/, the Founders' Wall's list, which a refunded package leaves). Those still to choose are the founders with
   no choice; once the offer has ended they are the ones who let it pass. */
export function founderGiftSummary(choices = [], founders = [], now = Date.now()) {
  const fs = new Set(founders), chose = new Set(), packs = Object.fromEntries(FOUNDER_GIFT.packs.map(k => [k, 0]));
  for (const c of choices) { if (!c || !c.uid) continue; chose.add(c.uid); if (Object.hasOwn(packs, c.p)) packs[c.p]++; }
  const recent = choices.filter(c => c && c.uid).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, 100)
    .map(c => ({ uid: c.uid, p: String(c.p || ''), at: Number(c.at) || 0, fno: Number(c.fno) || 0, founder: fs.has(c.uid) }));
  return { until: FOUNDER_GIFT.until, open: now < FOUNDER_GIFT.until, chosen: chose.size, founders: fs.size, waiting: [...fs].filter(u => !chose.has(u)).length,
    packs: FOUNDER_GIFT.packs.map(k => ({ k, name: CATALOGUE.products[k].name, n: packs[k] })), recent };
}
