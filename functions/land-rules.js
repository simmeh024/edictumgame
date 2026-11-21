/* The rules of land deals that the server (functions/land.js) and the game must agree on. game/edictum.html keeps the
   same table (LD_RULES, with the section "land deals"), and test/land.test.mjs checks that the two copies match.

   A land deal is land/{uid}_{x}: hexes that change hands between two players of one region, for stock or for other
   hexes, or for nothing (a gift). The server keeps no land: each game hands over its own hexes (n.bx), and the server
   only records who agreed to what, holds the payments the payer's own save has set aside (n.lne, as Supply Caches do)
   and says when each side has handed its land over.
     {reg, cv (the map's version the hexes are numbered on), k 'deal'|'list'|'auction', a (who offered it), an, b (the
      other side: '' for a listing or an auction until bought or won), bn, ga [hexes a gives], gb [hexes b gives],
      pa {res: n} (a pays b), pb {res: n} (b pays a), ins {by: 'a'|'b', r: {res: n}, n (days)} or null (paid a day at a
      time after the land has moved, by the side that receives it), ds (a whole province: its name), ro 1 (a ransom:
      land taken in war going back to its nation), val (the land valuer's worth when offered), st, t (offered), x (an
      offer or a listing lapses), end (an auction closes), cur (an auction's resource), res (its reserve), bids
      [{by, bn, v, t}], at (agreed), ca, cb (a and b handed their land over), dt (done), pd (instalments paid), pt,
      vt (called off), why, f {uid: founded}}
   st: 'offered' (to b), 'listed' (to anyone), 'open' (an auction taking bids) → 'agreed' (paid for, the land still to be
   handed over) → 'done' (handed over; instalments, if any, still running) or 'default' (instalments called in: the land
   goes back); 'void' (declined, withdrawn, or called off: the land could not be handed over) and 'closed' (an auction
   with no bid) end it. */
const DAY = 86400000, HOUR = 3600000;
export const LD_RES = ['food', 'timber', 'iron', 'oil', 'goods'];
export const LD_RULES = {
  /* hexes one side gives in a deal; deals a nation has open at once (offers, listings, auctions, deals still being
     handed over), and auctions among them */
  hexes: 40, open: 8, auctions: 2,
  /* an offer waits a week for an answer, a listing two; an auction runs 24 or 48 hours, and a bid in its last ten
     minutes keeps it open ten minutes more */
  offer: 7 * DAY, list: 14 * DAY, hours: [24, 48], snipe: 10 * 60000,
  /* a bid beats the one before by 5% (at least 1) */
  raise: 0.05,
  /* once agreed, the land is handed over within three days, or either side may call it off */
  settle: 3 * DAY,
  /* stamp duty: the share of every payment lost on the way */
  duty: 0.1,
  /* the most of one resource in a payment, and in one day's instalment; instalments run for one of these numbers of days */
  max: 5000, perDay: 500, days: [7, 14, 30],
  /* instalments behind before the receiving side's land can be called back */
  grace: 2,
  /* a finished deal stays on the record this long (the Statistics page's land prices) */
  keep: 30 * DAY
};
export const LD_HOUR = HOUR;
/* a deal's id in its offerer's record (lne, for the payment set aside) and its document's (land/{uid}_{x}) */
export const LD_X = /^[a-z0-9]{8,16}$/;
export const LD_DOC = /^[\w-]{1,128}_[a-z0-9]{8,16}$/;
/* the payment set aside for an instalment k of deal id: its key in the payer's record */
export const ldKey = (id, k) => k ? id + '~' + k : id;

const isHex = c => Number.isInteger(c) && c >= 0 && c < 1e6;
/* a payment: whole numbers of known resources, none over the limit (an empty one is {}), or null when malformed */
export function ldPay(r, max = LD_RULES.max) {
  if (r == null) return {};
  if (typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (!LD_RES.includes(k) || !Number.isInteger(v) || v < 0 || v > max) return null;
    if (v) out[k] = v;
  }
  return out;
}
export const ldTotal = r => Object.values(r || {}).reduce((s, v) => s + (Number(v) || 0), 0);
/* every resource of want is covered by have */
export const ldCovers = (have, want) => Object.entries(want || {}).every(([k, v]) => (Number(have && have[k]) || 0) >= v);
function cells(a) {
  if (a == null) return [];
  if (!Array.isArray(a) || a.length > LD_RULES.hexes || a.some(c => !isHex(c)) || new Set(a).size !== a.length) return null;
  return a.slice();
}
/* who pays instalments: the side that receives land while giving none */
export function ldInsBy(ga, gb) { return ga.length && !gb.length ? 'b' : gb.length && !ga.length ? 'a' : ''; }
/* the shape of an offer: what each side gives. Land moves one way at least; a hex is on one side only; instalments
   come from the side that receives the land. null when it will not do. k: 'deal' (to one nation), 'list' (to anyone
   at the price pb), 'auction' (bids in one resource, from a reserve) */
export function ldShape(k, d) {
  if (!['deal', 'list', 'auction'].includes(k) || !d || typeof d !== 'object') return null;
  const ga = cells(d.ga), gb = cells(d.gb), pa = ldPay(d.pa), pb = ldPay(d.pb);
  if (!ga || !gb || !pa || !pb || (!ga.length && !gb.length) || ga.some(c => gb.includes(c))) return null;
  let ins = null;
  if (d.ins != null) {
    const by = ldInsBy(ga, gb), r = ldPay(d.ins && d.ins.r, LD_RULES.perDay), n = d.ins && d.ins.n;
    if (!by || !r || !ldTotal(r) || !LD_RULES.days.includes(n) || (d.ins.by && d.ins.by !== by)) return null;
    ins = { by, r, n };
  }
  if (k === 'deal') return { ga, gb, pa, pb, ins };
  /* a listing or an auction sells the offerer's own land, and the offerer pays nothing */
  if (gb.length || ldTotal(pa) || !ga.length) return null;
  if (k === 'list') return ldTotal(pb) ? { ga, gb, pa, pb, ins: ins && ins.by === 'b' ? ins : null } : null;
  if (ins) return null;
  const cur = LD_RES.includes(d.cur) ? d.cur : '', res = Number.isInteger(d.res) && d.res >= 1 && d.res <= LD_RULES.max ? d.res : 0;
  const hours = LD_RULES.hours.includes(d.hours) ? d.hours : 0;
  return cur && res && hours ? { ga, gb, pa, pb: {}, ins: null, cur, res, hours } : null;
}
/* the least the next bid may be */
export function ldMinBid(D) {
  const b = Array.isArray(D && D.bids) ? D.bids : [], top = b.length ? Number(b[b.length - 1].v) || 0 : 0;
  return top ? Math.max(top + 1, Math.ceil(top * (1 + LD_RULES.raise))) : Math.max(1, Number(D && D.res) || 1);
}
/* what the payee receives of a payment, after the stamp duty */
export const ldNet = v => Math.floor((Number(v) || 0) * (1 - LD_RULES.duty) + 1e-9);
export function ldNetPay(r) { const o = {}; for (const [k, v] of Object.entries(r || {})) { const q = ldNet(v); if (q) o[k] = q; } return o; }
/* instalments due by now (the first a day after the land moved), and how many behind the payer is */
export function ldDue(D, now) {
  if (!D || !D.ins || !(Number(D.dt) > 0)) return 0;
  return Math.max(0, Math.min(D.ins.n, Math.floor((now - Number(D.dt)) / DAY)));
}
export const ldBehind = (D, now) => Math.max(0, ldDue(D, now) - (Number(D && D.pd) || 0));
/* still open to an answer, a buyer or a bid */
export const LD_OPEN = ['offered', 'listed', 'open'];
/* holding a slot of the nation's: open, or agreed and not yet handed over */
export const ldHolds = st => LD_OPEN.includes(st) || st === 'agreed';
/* finished: nothing more will happen to it (instalments all paid, or called in); when it finished, or 0 */
export function ldEnded(D) {
  if (!D) return 0;
  if (D.st === 'void' || D.st === 'closed') return Number(D.vt) || Number(D.t) || 1;
  if (D.st === 'default') return Number(D.vt) || Number(D.dt) || 1;
  if (D.st === 'done') return !D.ins || (Number(D.pd) || 0) >= D.ins.n ? Math.max(Number(D.pt) || 0, Number(D.dt) || 0) || 1 : 0;
  return 0;
}
