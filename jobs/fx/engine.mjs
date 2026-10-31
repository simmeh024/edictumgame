// The currency engine: what a nation's currency is worth, and how far it is trusted. Pure functions,
// no I/O; jobs/fx/daily.mjs runs them once a day for every region and stores the results.
//
// Two numbers, kept apart on purpose:
//
//   VALUE    what one unit of the currency buys, in the region's standard unit. It is the product of a
//            nominal denomination fixed by the system from the nation's id (so rates such as 1:0.82 or
//            1:32.88 look like real ones and no two currencies line up by accident) and an economic
//            strength multiplier from the nation's real figures. Rates are derived: RATE(A→B) = V(A)/V(B).
//   PRESTIGE 0 to 100: how stable and credible the currency is. It never reads the value or the
//            denomination, only the economy, the government, the currency's own day-to-day volatility
//            (in percent, which a denomination cannot change), trade and monetary credibility.
//
// Every regional standard unit has the same definition, so values are comparable across regions and a
// future interregional benchmark can be added without rewriting any history.
//
// Inputs are the figures the game itself simulates and stores in each nation's record (see
// game/edictum.html): the twenty census scales n.s, laws n.policies, the budget, the population curve
// (pop, popAt, pk, pr, gm), the history snapshots n.hist {t, p, s, e} (e is the game's own prosperity
// multiplier from trade, buildings and cabinet), trade deals n.deals, wars and peace. The small formulas
// below copy the game's (income, govApproval, inflOf, debtOf, creditOf, unempOf, lawOf, industries,
// npcBudget, bpOf); test/fx.test.mjs checks them against the game's own source so the two cannot drift.

export const DAY = 864e5;
export const VERSION = 1;

/* ── the game's formulas ───────────────────────────────────────────────── */
export const STAT_KEYS = ['civil', 'econ', 'pol', 'wealth', 'equal', 'health', 'edu', 'safety', 'crime', 'env', 'relig', 'cons', 'happy', 'mil', 'corrupt', 'tax', 'culture', 'tour', 'sci', 'weird'];
export const BUDGET_KEYS = ['admin', 'defence', 'edu', 'env', 'health', 'commerce', 'aid', 'law', 'transport', 'equality', 'spirit', 'welfare'];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function income(s) { const w = s.wealth; return 4000 + 90 * w + 6.5 * w * w; }
export function govApproval(s) { return clamp(s.happy * 0.45 + (100 - s.corrupt) * 0.25 + s.pol * 0.1 + s.civil * 0.05 + (s.wealth - 50) * 0.15 + 10, 3, 97); }
export function inflOf(s, p) { return clamp(1.2 + Math.abs(s.econ - 55) * 0.05 + s.corrupt * 0.03 - (p.priceCaps ? 0.6 : 0) + (p.cashless ? -0.3 : 0), 0.2, 25); }
export function bpOf(n, k) { const tot = BUDGET_KEYS.reduce((a, q) => a + (n.budget[q] || 0), 0) || 1; return (n.budget[k] || 0) / tot * 100; }
export function debtOf(n, s, p) { return clamp(25 + s.tax * 0.35 - s.wealth * 0.25 + s.corrupt * 0.4 - (p.oilFund ? 15 : 0) + bpOf(n, 'welfare') * 0.8, 2, 240); }
export const CREDIT = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'];
export function creditOf(debt, s) { return CREDIT[clamp(Math.floor((debt * 0.5 + s.corrupt * 0.6 + (100 - s.econ) * 0.2) / 22), 0, 6)]; }
export function unempOf(s, p) { return clamp(2 + (100 - s.econ) * 0.06 + (100 - s.wealth) * 0.05 + (p.minimumWage ? 0.8 : 0) - (s.tax > 70 ? 1 : 0), 1, 30); }
export function lawOf(s) { return clamp((100 - s.corrupt) * 0.6 + s.safety * 0.25 + s.pol * 0.15, 0, 100); }
export function industries(n) {
  const s = n.s, p = n.policies || {};
  return [
    ['Arms Manufacturing', s.mil * 1.2 + s.econ * 0.4], ['Tourism', s.tour * 1.3 + s.culture * 0.2], ['Information Technology', s.sci + s.edu * 0.4 + s.econ * 0.2],
    ['Book Publishing', s.culture * 0.8 + s.edu * 0.6], ['Retail', s.econ * 0.7 + s.wealth * 0.6], ['Woodchip Exports', (100 - s.env) * 1.1 + s.econ * 0.3],
    ['Basket Weaving', (100 - s.econ) * 0.9 + (100 - s.sci) * 0.4], ['Gambling', s.econ * 0.4 + (100 - s.cons) * 0.4 + s.tour * 0.4 + (p.gambling ? 40 : 0)],
    ['Insurance', s.econ * 0.6 + (100 - s.equal) * 0.6], ['Pizza Delivery', s.weird * 1.1 + s.happy * 0.3], ['Trout Farming', s.env * 0.9 + (100 - s.wealth) * 0.3],
    ['Cheese Exports', s.happy * 0.5 + s.env * 0.4 + s.cons * 0.3], ['Uranium Mining', s.mil * 0.5 + s.sci * 0.5 + (100 - s.env) * 0.4],
    ['Beef-Based Agriculture', s.cons * 0.6 + (100 - s.sci) * 0.3 + s.env * 0.2], ['Furniture Restoration', 71]
  ].sort((a, b) => b[1] - a[1]);
}
export function npcBudget(s) {
  return { admin: 4 + s.corrupt / 12, defence: 2 + s.mil / 6, edu: 2 + s.edu / 8, env: 1 + s.env / 10, health: 2 + s.health / 8, commerce: 2 + s.econ / 12, aid: 1 + (100 - s.mil) / 30, law: 2 + s.safety / 12, transport: 2 + s.env / 20 + s.equal / 20, equality: 1 + s.equal / 10, spirit: 0.5 + s.relig / 10, welfare: 1 + s.equal / 10 + s.tax / 20 };
}
function rateOf(n) { const s = n.s; return 0.06 * (0.55 + s.health / 250 + s.safety / 400 + s.happy / 400 + s.wealth / 500) * (n.gm || 1) * (1 - Math.max(0, s.tax - 50) / 150); }
function logistic(P0, K, r, dt) { return P0 <= K ? K / (1 + (K - P0) / P0 * Math.exp(-r * dt)) : K + (P0 - K) * Math.exp(-0.02 * dt); }

/* ── reading a record safely ───────────────────────────────────────────── */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* the census scales, each a number from 0 to 100; a missing or broken one counts as 50 */
export function statsOf(s) {
  const o = {};
  if (Array.isArray(s)) STAT_KEYS.forEach((k, i) => { o[k] = clamp(num(s[i], 50), 0, 100); });
  else for (const k of STAT_KEYS) o[k] = clamp(num(isObj(s) ? s[k] : undefined, 50), 0, 100);
  return o;
}
function budgetOf(b, s) {
  if (!isObj(b)) return npcBudget(s);
  const o = {}; for (const k of BUDGET_KEYS) o[k] = clamp(num(b[k], 0), 0, 1000);
  return BUDGET_KEYS.some(k => o[k] > 0) ? o : npcBudget(s);
}
function policiesOf(p) {
  if (Array.isArray(p)) return Object.fromEntries(p.filter(k => typeof k === 'string').map(k => [k, true]));
  return isObj(p) ? Object.fromEntries(Object.keys(p).filter(k => p[k]).map(k => [k, true])) : {};
}

/* ── computer-run nations ──────────────────────────────────────────────── */
/* npc = {id, s: [20 numbers], pol: [laws], pop (founding papers), room}; ctx = {npcPop, npcEpoch} from the game */
export function npcPopAt(npc, now, ctx) {
  const P0 = Math.max(0.1, num(npc.pop, 10) * ctx.npcPop), K = P0 * num(npc.room, 1.5), t = Math.max(0, now - ctx.npcEpoch) / DAY;
  return K / (1 + (K - P0) / P0 * Math.exp(-0.012 * t));
}

/* ── trade and war, worked out from the region's records ───────────────── */
/* A deal is live when the proposer's record holds it and the partner's holds the mirrored acceptance, or
   the partner is a computer-run nation (which accepts at once), as the game's collectDeals() has it. Deals
   are suspended while the two are at war. Returns id → {partners: Set, volume: units a day both ways}. */
export function tradeOf(recs, npcIds) {
  const out = new Map(), at = id => { let o = out.get(id); if (!o) out.set(id, o = { partners: new Set(), volume: 0 }); return o; };
  const seen = new Set(), mirrored = (x, y) => Array.isArray(x.g) && Array.isArray(y.r) && x.g[0] === y.r[0] && x.g[1] === y.r[1] && x.r[0] === y.g[0] && x.r[1] === y.g[1];
  for (const [id, n] of recs) {
    for (const x of Array.isArray(n.deals) ? n.deals : []) {
      if (!isObj(x) || x.a || typeof x.w !== 'string' || x.w === id || !Array.isArray(x.g) || !Array.isArray(x.r) || seen.has(x.id)) continue;
      const tg = recs.get(x.w);
      if (tg && num(x.t, 0) < num(tg.founded, 0)) continue;
      let live = npcIds.has(x.w);
      if (!live && tg) live = (Array.isArray(tg.deals) ? tg.deals : []).some(y => isObj(y) && y.id === x.id && y.a && y.w === id && mirrored(x, y));
      if (!live) continue;
      seen.add(x.id);
      const vol = clamp(num(x.g[1], 0), 0, 100) + clamp(num(x.r[1], 0), 0, 100);
      const A = at(id), B = at(x.w); A.partners.add(x.w); B.partners.add(id); A.volume += vol; B.volume += vol;
    }
  }
  return out;
}
/* direct wars: declared by either side and not yet ended by both (a computer-run nation's peace is its
   opponent's), as the game's pairWar() has it. Returns id → number of wars. */
export function warsOf(recs, npcIds) {
  const out = new Map(), pairs = new Set();
  const add = id => out.set(id, (out.get(id) || 0) + 1);
  for (const [a, A] of recs) {
    for (const b of Object.keys(isObj(A.wars) ? A.wars : {})) {
      const key = a < b ? a + '|' + b : b + '|' + a; if (pairs.has(key) || a === b) continue; pairs.add(key);
      const B = recs.get(b), nb = npcIds.has(b); if (!B && !nb) continue;
      const dA = num(A.wars[b] && A.wars[b].t, 0), dB = nb ? 0 : num(isObj(B.wars) && B.wars[a] && B.wars[a].t, 0), decl = Math.max(dA, dB);
      if (!decl) continue;
      let pA = num(isObj(A.peace) ? A.peace[b] : 0, 0), pB = nb ? pA : num(isObj(B.peace) ? B.peace[a] : 0, 0);
      if (pA > decl && pB > decl) continue;
      add(a); add(b);
    }
  }
  return out;
}

/* Successful counterfeit operations use the game's deterministic roll. Only one verification hold
   applies per currency; additional attackers can neither deepen it nor make it permanent. Read the
   regional operations directly, so a target need not log in for the daily rating to reflect it. */
export function counterfeitsOf(recs, now, region) {
  const out = new Map();
  for (const [by, n] of recs) for (const o of Array.isArray(n.cov) ? n.cov.slice(0, 20) : []) {
    const target = isObj(o) && recs.get(o.tg);
    if (!target || o.k !== 'c' || by === o.tg || o.rg !== region || typeof o.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(o.id)
      || !Number.isFinite(o.t) || o.t > now || now - o.t >= DAY || o.t <= num(target.founded, 0) || o.t < num(target.mvAt, 0)
      || o.t < num(n.mvAt, 0) || !Number.isFinite(o.p) || o.p < 0.1 || o.p > 0.9) continue;
    let a = (hash('cov|' + o.id + '|' + o.t + '|' + o.tg + '|' + o.k) + 0x6D2B79F5) | 0;
    let r = Math.imul(a ^ a >>> 15, 1 | a); r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
    if (((r ^ r >>> 14) >>> 0) / 4294967296 >= o.p) continue;
    out.set(o.tg, Math.max(out.get(o.tg) || 0, o.t + DAY));
  }
  return out;
}

/* whether a player's record shows a finished Central Bank (cities[].b[] {k, d}); it steadies the currency */
export function hasCentralBank(rec, now) {
  return Array.isArray(rec && rec.cities) && rec.cities.some(c => isObj(c) && Array.isArray(c.b)
    && c.b.some(b => isObj(b) && b.k === 'cbank' && Number.isFinite(b.d) && b.d <= now));
}
/* how much of a forgery's damage gets through: a Central Bank halves it, holographic banknotes take a further quarter */
export const forgeryMult = I => (I.bank ? (I.holo ? 0.375 : 0.5) : 1);

/* ── indicators: one nation's real figures, read from its record ───────── */
/* rec is a player's shared record or, with npc set, a computer-run nation's definition. Every figure comes
   from what the game simulates; nothing here is invented to fill a formula. */
export function indicators(id, rec, now, ctx) {
  const npc = !!ctx.npc, s = statsOf(rec.s), p = policiesOf(npc ? rec.pol : rec.policies), n = { s, policies: p, budget: budgetOf(npc ? null : rec.budget, s) };
  const hist = npc ? [] : (Array.isArray(rec.hist) ? rec.hist : []).filter(h => isObj(h) && isFinite(h.t) && h.t < now && Array.isArray(h.s) && isFinite(h.p) && h.p > 0).sort((a, b) => a.t - b.t);
  const last = hist[hist.length - 1], prosper = npc ? 1 : clamp(num(last && last.e, 1), 0.3, 3);
  let pop;
  if (npc) pop = npcPopAt(rec, now, ctx);
  else {
    const P0 = Math.max(0.1, num(rec.pop, 5)), dt = Math.max(0, now - num(rec.popAt, now)) / DAY, K = num(rec.pk, 0) || Math.max(50, P0 * 1.5), r = num(rec.pr, 0) || rateOf({ s, gm: num(rec.gm, 1) });
    pop = Math.max(0.1, logistic(P0, K, r, Math.min(dt, 3650)));
  }
  const gpc = income(s) * prosper, out = gpc * pop * 1e6;
  /* growth: output now against output about a week ago (at least a day back), per day, in percent */
  let gOut = 0, gPc = 0, span = 0;
  if (npc) {
    const t0 = Math.max(ctx.npcEpoch, now - 7 * DAY); span = (now - t0) / DAY;
    if (span >= 1) gOut = Math.log(pop / npcPopAt(rec, t0, ctx)) / span * 100;
  } else {
    let b = null; for (const h of hist) { if (now - h.t < DAY) continue; if (!b || Math.abs(now - 7 * DAY - h.t) < Math.abs(now - 7 * DAY - b.t)) b = h; }
    if (b) {
      const s0 = statsOf(b.s), g0 = income(s0) * clamp(num(b.e, prosper), 0.3, 3), o0 = g0 * b.p * 1e6; span = (now - b.t) / DAY;
      if (o0 > 0 && g0 > 0) { gOut = Math.log(out / o0) / span * 100; gPc = Math.log(gpc / g0) / span * 100; }
    }
  }
  /* how much output per person has swung across the record's recent snapshots (log points, in percent) */
  let outVol = 0;
  const recent = hist.filter(h => now - h.t <= 14 * DAY);
  if (recent.length >= 3) {
    const xs = recent.map(h => Math.log(income(statsOf(h.s)) * clamp(num(h.e, prosper), 0.3, 3))), m = xs.reduce((a, v) => a + v, 0) / xs.length;
    outVol = Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / xs.length) * 100;
  }
  const debt = debtOf(n, s, p), ind = industries(n).slice(0, 5), tot = ind.reduce((a, c) => a + Math.max(0, c[1]), 0) || 1;
  /* diversification: how evenly the five largest industries share the economy (1 = evenly) */
  const div = -ind.reduce((a, c) => { const q = Math.max(0, c[1]) / tot; return a + (q > 0 ? q * Math.log(q) : 0); }, 0) / Math.log(5);
  const tr = ctx.trade || { partners: new Set(), volume: 0 }, bank = !npc && hasCentralBank(rec, now), holo = !!p.bankHolograms;
  return {
    npc, gpc, out, pop, prosper, gOut: clamp(num(gOut, 0), -50, 50), gPc: clamp(num(gPc, 0), -50, 50), span, outVol: clamp(num(outVol, 0), 0, 100),
    approval: govApproval(s), law: lawOf(s), safety: s.safety, corrupt: s.corrupt, sci: s.sci, edu: s.edu, econ: s.econ, div: clamp(div, 0, 1),
    infl: inflOf(s, p), debt, credit: creditOf(debt, s), unemp: unempOf(s, p),
    cbi: !!p.centralBankIndependence, pbank: !!p.peoplesBank, oilFund: !!p.oilFund, tariffs: !!p.importTariffs,
    bank, holo, counterfeit: ctx.counterfeit > now ? (p.counterIntel ? 4 : 8) * forgeryMult({ bank, holo }) : 0,
    wars: clamp(num(ctx.wars, 0), 0, 20), partners: tr.partners.size, volume: clamp(tr.volume, 0, 10000),
    days: npc ? Infinity : Math.max(0, (now - num(rec.founded, now)) / DAY)
  };
}

/* ── valuation ─────────────────────────────────────────────────────────── */
/* strength factors, each 0 to 100, and their weights (the design's 30/20/20/20/10) */
export const V_KEYS = ['prod', 'gro', 'stab', 'trade', 'dev'];
export const V_W = { prod: 0.30, gro: 0.20, stab: 0.20, trade: 0.20, dev: 0.10 };
const GPC_LO = Math.log(4000), GPC_HI = Math.log(120000);
export const priceStab = infl => clamp(100 - (infl - 2) * 8, 0, 100);
export function valuationFactors(I) {
  const warPen = Math.min(30, I.wars * 15);
  return {
    /* productivity: output per person, the game's average income times its prosperity, on a log scale */
    prod: clamp((Math.log(Math.max(1, I.gpc)) - GPC_LO) / (GPC_HI - GPC_LO) * 100, 0, 100),
    /* growth: mostly output per person (productivity), partly the whole economy (scale), per day */
    gro: clamp(50 + 30 * Math.tanh(I.gPc / 0.4) + 20 * Math.tanh(I.gOut / 2), 0, 100),
    /* stability and confidence: approval, the rule of law, safe streets, stable prices; wars weigh it down */
    stab: clamp(0.35 * I.approval + 0.30 * I.law + 0.15 * I.safety + 0.20 * priceStab(I.infl) - warPen, 0, 100),
    /* trade: partners and volume of live deals, open markets; import tariffs shut some trade out */
    trade: clamp(55 * Math.min(1, I.partners / 4) + 30 * Math.min(1, I.volume / 20) + 15 * I.econ / 100 - (I.tariffs ? 8 : 0), 0, 100),
    /* development and diversification: science, education and how evenly industries share the economy */
    dev: clamp(0.4 * I.sci + 0.3 * I.edu + 0.3 * I.div * 100, 0, 100)
  };
}
export const strengthOf = f => V_KEYS.reduce((a, k) => a + V_W[k] * f[k], 0);

/* the nominal denomination: fixed by the system from the nation's immutable id, between 0.05 and 20
   standard units, spread evenly on a log scale. Renaming or redesigning a currency cannot touch it. */
export function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const DENOM_LO = 0.05, DENOM_HI = 20;
export function denomination(id) {
  const u = hash(String(id) + ':cu-denom') / 4294967296;
  return Math.exp(Math.log(DENOM_LO) + u * (Math.log(DENOM_HI) - Math.log(DENOM_LO)));
}
/* strength 0..100 to a multiplier from 1/4 to 4: strength 50 leaves the denomination as it is */
export const strengthMult = S => Math.pow(4, (clamp(S, 0, 100) - 50) / 50);
export const valueOf = (id, S) => denomination(id) * strengthMult(S);
/* exchange rates are derived, never stored: one unit of A buys this many units of B */
export const rate = (vA, vB) => vA / vB;

/* ── prestige ──────────────────────────────────────────────────────────── */
export const P_KEYS = ['econ', 'gov', 'vol', 'trade', 'prod', 'mon'];
export const P_W = { econ: 0.25, gov: 0.20, vol: 0.20, trade: 0.15, prod: 0.10, mon: 0.10 };
const CREDIT_SCORE = { AAA: 100, AA: 85, A: 70, BBB: 55, BB: 38, B: 20, CCC: 0 };
/* volSd: the currency's own day-to-day swings (standard deviation, percent), or null before it has any */
export function prestigeFactors(I, volSd) {
  const warPen = Math.min(40, I.wars * 20);
  return {
    /* economic stability and resilience: steady output, jobs, a large and growing economy */
    econ: clamp(0.30 * clamp(100 - I.outVol * 10, 0, 100) + 0.25 * clamp(100 - (I.unemp - 2) * 4, 0, 100)
      + 0.20 * clamp(20 * Math.log10(Math.max(1, I.out) / 1e9), 0, 100) + 0.25 * clamp(50 + 50 * Math.tanh(I.gOut / 1), 0, 100), 0, 100),
    /* government stability and institutions: rule of law, approval, clean government; wars shake it */
    gov: clamp(0.40 * I.law + 0.30 * I.approval + 0.30 * (100 - I.corrupt) - warPen, 0, 100),
    /* the currency's own volatility, in percent a day: steady currencies are trusted */
    vol: volSd == null ? 50 : clamp(100 - volSd * 40, 0, 100),
    /* trade participation: partners and volume */
    trade: clamp(60 * Math.min(1, I.partners / 5) + 40 * Math.min(1, I.volume / 25), 0, 100),
    /* productivity and development */
    prod: clamp(0.6 * clamp((Math.log(Math.max(1, I.gpc)) - GPC_LO) / (GPC_HI - GPC_LO) * 100, 0, 100) + 0.4 * (I.sci + I.edu) / 2, 0, 100),
    /* monetary and fiscal credibility: inflation, public debt, credit rating and the laws that bear on them */
    mon: clamp(0.35 * priceStab(I.infl) + 0.30 * clamp(100 - (I.debt - 30) * 0.6, 0, 100) + 0.35 * CREDIT_SCORE[I.credit]
      + (I.cbi ? 12 : 0) - (I.pbank ? 8 : 0) + (I.oilFund ? 5 : 0) - clamp(I.counterfeit || 0, 0, 8), 0, 100)
  };
}
export const prestigeRaw = g => P_KEYS.reduce((a, k) => a + P_W[k] * g[k], 0);
/* a track record: a player's currency is trusted only so far until the nation has been around a while
   (50 at founding, rising to no limit after 180 days); computer-run nations are long established */
export const TRACK_DAYS = 180;
export const prestigeCap = days => 50 + 50 * Math.min(1, Math.max(0, days) / TRACK_DAYS);

/* tiers: 0–19 Fragile, 20–39 Vulnerable, 40–59 Established, 60–79 Trusted, 80–100 Highly Trusted */
export const TIERS = ['Fragile', 'Vulnerable', 'Established', 'Trusted', 'Highly Trusted'];
export const tierOf = p => clamp(Math.floor(clamp(p, 0, 100) / 20), 0, 4);
/* with a point of hysteresis on the way down, so a rating hovering at a boundary does not flap */
export function tierStep(p, prev) {
  const t = tierOf(p);
  if (prev == null || t >= prev) return t;
  return p < prev * 20 - 1 ? t : prev;
}

/* ── one day for one nation ────────────────────────────────────────────── */
/* smoothing: strength moves 35% of the way to its new level each day, at most enough to move the value 3%
   (a Central Bank halves both, so its currency moves half as far);
   prestige moves 10% of the way to its target, at most 1.5 points up or 2 down a day (5 down in a crisis:
   a new war, or government or economic stability falling 15 points in a day) */
export const S_ALPHA = 0.35, V_MAX = 0.03, S_MAX = 50 * Math.log(1 + V_MAX) / Math.log(4);
export const P_ALPHA = 0.10, P_UP = 1.5, P_DOWN = 2, P_CRISIS = 5;
export const VOL_KEEP = 0.9; // the weight of yesterday in the running variance of daily value changes
export const RING_V = 91, RING_P = 31;
const r4 = v => Math.round(v * 1e4) / 1e4, r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
const sig = (v, d) => (v === 0 || !isFinite(v) ? 0 : Number(v.toPrecision(d)));

/* prev: yesterday's state for the nation (or null); I: today's indicators. Returns today's state.
   state = {S, P, t (tier), vv (running variance), n (days observed), f, g, hv (values), hp (prestige),
            hd (day of the last ring entry), w (wars), le {event: day}} */
export function stepNation(id, prev, I, day) {
  const f = valuationFactors(I), Sraw = strengthOf(f);
  let S, P, vv, n, hv, hp, crisis = false;
  const volSd = prev && prev.n >= 7 ? Math.sqrt(prev.vv) : null, g = prestigeFactors(I, volSd);
  const cap = I.npc ? 100 : prestigeCap(I.days), T = Math.min(prestigeRaw(g), cap);
  if (!prev) {
    S = Sraw; P = T; vv = 0; n = 1; hv = []; hp = [];
  } else {
    const st = I.bank ? 0.5 : 1;
    S = prev.S + clamp(st * S_ALPHA * (Sraw - prev.S), -st * S_MAX, st * S_MAX);
    crisis = I.wars > (prev.w || 0) || (prev.g && (prev.g.gov - g.gov >= 15 || prev.g.econ - g.econ >= 15));
    P = prev.P + clamp(P_ALPHA * (T - prev.P), -(crisis ? P_CRISIS : P_DOWN), P_UP);
    const dv = Math.log(valueOf(id, S) / valueOf(id, prev.S)) * 100;
    vv = VOL_KEEP * (prev.vv || 0) + (1 - VOL_KEEP) * dv * dv; n = (prev.n || 0) + 1;
    /* the rings hold one entry a day; a day the job missed repeats the day before */
    const gap = Math.max(1, Math.min(RING_V, day - (prev.hd || day - 1)));
    hv = (prev.hv || []).slice(); hp = (prev.hp || []).slice();
    for (let k = 1; k < gap; k++) { if (hv.length) hv.push(hv[hv.length - 1]); if (hp.length) hp.push(hp[hp.length - 1]); }
  }
  S = clamp(S, 0, 100); P = clamp(P, 0, 100);
  hv.push(sig(valueOf(id, S), 6)); hp.push(r1(P));
  return {
    S: r4(S), Sraw: r2(Sraw), P: r2(P), T: r2(T), cap: r1(cap), t: tierStep(P, prev ? prev.t : null), vv: sig(vv, 6), n, crisis,
    f: Object.fromEntries(V_KEYS.map(k => [k, r1(f[k])])), g: Object.fromEntries(P_KEYS.map(k => [k, r1(g[k])])),
    hv: hv.slice(-RING_V), hp: hp.slice(-RING_P), hd: day, w: I.wars, le: Object.assign({}, prev && prev.le), fd: prev ? prev.fd : day
  };
}

/* the state of a currency that has a history but no state in this region (its nation moved here): strength
   from its last value (the denomination is known), prestige, volatility and the rings as they were, so a move
   neither resets nor shortcuts the smoothing. days: [[day, value, prestige]], oldest first, before today. */
export function seedState(id, days) {
  const ok = days.filter(d => d[1] > 0 && isFinite(d[1]) && isFinite(d[2]));
  if (!ok.length) return null;
  const last = ok[ok.length - 1], hv = ok.slice(-RING_V).map(d => d[1]);
  let vv = 0; for (let i = 1; i < hv.length; i++) { const dv = Math.log(hv[i] / hv[i - 1]) * 100; vv = VOL_KEEP * vv + (1 - VOL_KEEP) * dv * dv; }
  const P = clamp(last[2], 0, 100);
  return { S: clamp(50 + 50 * Math.log(last[1] / denomination(id)) / Math.log(4), 0, 100), P, t: tierOf(P), vv, n: ok.length, hv, hp: ok.slice(-RING_P).map(d => d[2]), hd: last[0], w: 0, le: {}, fd: ok[0][0] };
}

/* the change of a ring over k days, in percent (values) or points (prestige); null without the history */
export function ringChange(ring, k, pct) {
  if (!Array.isArray(ring) || ring.length <= k) return null;
  const a = ring[ring.length - 1 - k], b = ring[ring.length - 1];
  if (!(isFinite(a) && isFinite(b))) return null;
  return pct ? (a > 0 ? r2((b / a - 1) * 100) : null) : r1(b - a);
}

/* why the value moved since yesterday: the factors whose weighted change moved strength the most */
export function valuationWhy(prevF, f) {
  if (!prevF) return [];
  return V_KEYS.map(k => [k, r2(V_W[k] * (f[k] - (prevF[k] == null ? f[k] : prevF[k])))]).filter(x => Math.abs(x[1]) >= 0.05).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
}

/* ── one day for one region ────────────────────────────────────────────── */
/* nations: [{id, I}] (today's indicators); prevState: {id: state} from yesterday; day: days since 1970 (UTC).
   Returns {state, pub, events}: pub is what players read (the region's currencies, ranked), events the
   milestones of the day. Ranks go by prestige, never by value. */
export const EVENT_GAP = { hi: 30, lo: 30, t5: 14, top: 7 };
export function stepRegion(nations, prevState, day) {
  const state = {}, events = [];
  for (const { id, I } of nations) state[id] = stepNation(id, prevState[id] || null, I, day);
  const ids = Object.keys(state);
  const ranked = ids.slice().sort((a, b) => state[b].P - state[a].P || (a < b ? -1 : 1));
  const prevRank = {}; ids.filter(id => prevState[id] && prevState[id].r).forEach(id => { prevRank[id] = prevState[id].r; });
  const prevTop = Object.keys(prevState).find(id => prevState[id] && prevState[id].r === 1);
  ranked.forEach((id, i) => { state[id].r = i + 1; });
  const ev = (id, code, arg) => {
    const st = state[id], last = st.le[code];
    if (EVENT_GAP[code] && last != null && day - last < EVENT_GAP[code]) return;
    st.le[code] = day; events.push([id, code, arg]);
  };
  for (const id of ids) {
    const st = state[id], pv = prevState[id];
    if (!pv) continue;
    if (st.t > pv.t) ev(id, 'tu', st.t); else if (st.t < pv.t) ev(id, 'td', st.t);
    if (ids.length >= 3 && st.r === 1 && prevTop !== id && prevTop && st.P >= 40) ev(id, 'top', 1);
    else if (ids.length >= 8 && st.r <= 5 && (prevRank[id] || 99) > 5 && st.P >= 40) ev(id, 't5', st.r);
    /* the highest or lowest value in ninety days, once there are thirty days to compare with */
    const hv = st.hv;
    if (hv.length >= 31) {
      const past = hv.slice(-RING_V, -1), cur = hv[hv.length - 1], mx = Math.max(...past), mn = Math.min(...past);
      if (cur > mx * 1.001) ev(id, 'hi', 90); else if (cur < mn * 0.999) ev(id, 'lo', 90);
    }
  }
  const pub = {};
  for (const id of ids) {
    const st = state[id], pv = prevState[id];
    pub[id] = {
      v: sig(valueOf(id, st.S), 7), s: r1(st.S), p: r1(st.P), pt: r1(st.T), cap: st.cap, t: st.t, r: st.r,
      d1: ringChange(st.hv, 1, true), d7: ringChange(st.hv, 7, true), d30: ringChange(st.hv, 30, true),
      p7: ringChange(st.hp, 7, false), p30: ringChange(st.hp, 30, false),
      sd: st.n >= 7 ? r2(Math.sqrt(st.vv)) : null, f: V_KEYS.map(k => st.f[k]), g: P_KEYS.map(k => st.g[k]),
      why: valuationWhy(pv && pv.f, st.f), cr: st.crisis ? 1 : 0, since: st.fd
    };
  }
  return { state, pub, events };
}
