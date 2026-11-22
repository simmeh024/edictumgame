// The National Research Programme for the admin portal's Statistics page (functions/admin.js, op 'stats', the Research
// tab): where each nation stands on the way from its first edicts to the laboratory and the 360 technologies, and what
// the research world looks like in counts. One nation's research (rowResearch) rides on functions/stats.js nationRow as
// `rs`; researchSummary counts a world or a region. Pure: it reads the record as the game keeps it (game/edictum.html,
// "the National Research Programme": the shared n.nrp, the private n.nrx, n.ws.e, n.rsd) and the server's catalogue
// (functions/research-rules.js).
import { RS_N, RS_TIERS, RS_CHALLENGES, rsBits, rsHas, rsDone, rsTopTier, rsEra, rsTrack } from './research-rules.js';

export const DAY = 86400000;
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const arr = v => Array.isArray(v) ? v : [];
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* the game's own figures: the petition after RS_AT enacted edicts, again RS_AGAIN after a veto (game: RS_AT, RS_AGAIN) */
export const RS_AT = 75, RS_AGAIN = 5;
/* the laws research brings (game: POLICIES, "the National Research Programme") */
export const RS_LAWS = ['openScience', 'classifiedResearch', 'researchEthics', 'healthCoop', 'sciExchange', 'tradeStandards', 'natureConvention', 'researchFund', 'nuclearSafety', 'armsControl'];
/* Where a nation stands, in the order a nation goes through it:
     early    – fewer than RS_AT enacted edicts: no petition yet
     vetoed   – it set the petition aside; it comes back RS_AGAIN enacted edicts later
     due      – the petition is on its desk (or comes with its next edicts)
     site     – the petition granted; the laboratory's site not yet chosen and founded
     building – being built, stage `st` of 5
     open     – inaugurated, at work
     lost     – its hex held by an enemy (as the owner's game last saw it): research kept, none done
     ruined   – destroyed by an occupier, or left behind in another region: to be rebuilt on a new site
     rebuild  – being rebuilt after that (research is not done until it reopens) */
export const RS_PHASES = ['early', 'vetoed', 'due', 'site', 'building', 'open', 'lost', 'ruined', 'rebuild'];
/* the journey as steps reached (at some time, so a laboratory now lost or ruined still counts as built) */
export const RS_STEPS = ['e75', 'granted', 'placed', 'st1', 'st2', 'st3', 'st4', 'open', 'd1', 'tier5', 'n50', 'n100', 'n200', 'n300', 'n360'];
const TECH_BANDS = [[0, 0], [1, 9], [10, 24], [25, 49], [50, 99], [100, 199], [200, 299], [300, 359], [360, 360]];
const EDICT_BANDS = [[0, 24], [25, 49], [50, 64], [65, 74]];

/* one nation's research, from its record (both halves joined): a few numbers, or the phase alone before the petition */
export function rowResearch(r, now) {
  const p = obj(r.nrp), x = obj(r.nrx) || {}, e = Math.max(0, num(obj(r.ws)?.e) | 0);
  const razed = arr(r.rsd).filter(d => obj(d) && num(d.t) > 0).length;
  if (!p || !(num(p.a) > 0)) {
    const dv = Number.isInteger(x.dv) && x.dv >= 0 ? x.dv : -1;
    const ph = e < RS_AT ? 'early' : dv >= 0 && e < dv + RS_AGAIN ? 'vetoed' : 'due';
    const o = { ph, e };
    if (dv >= 0) { o.dv = dv; if (num(x.dvt)) o.dvt = num(x.dvt); }
    if (ph === 'due') o.desk = arr(r.inbox).some(i => i && i.id === 'rs-discovery') ? 1 : 0;
    if (razed) o.razed = razed;
    return { rs: o };
  }
  const placed = Number.isInteger(p.c) && p.c >= 0, st = Math.max(0, Math.min(5, num(p.st) | 0)), i = num(p.i), open = i > 0 && st >= 5;
  /* the scientific record, newest first: [time, kind, a, b]; a destruction ('rz') names the destroyer in a, or none */
  const h = arr(x.h).filter(v => Array.isArray(v) && num(v[0]) > 0 && typeof v[1] === 'string');
  const rz = h.find(v => v[1] === 'rz'), disc = h.filter(v => v[1] === 'd').map(v => num(v[0]));
  const ph = !placed ? (num(p.rz) || i ? 'ruined' : 'site') : num(p.lo) ? 'lost' : !open ? (i ? 'rebuild' : 'building') : 'open';
  const b = rsBits(typeof p.k === 'string' ? p.k : ''), d = rsDone(b), tt = [0, 1, 2].map(k => rsTopTier(d, k));
  let n = 0; const tk = [0, 0, 0];
  for (let j = 0; j < RS_N; j++) if (rsHas(b, j)) { n++; tk[rsTrack(j)]++; }
  const ch = {};
  for (const id of RS_CHALLENGES) { const c = obj(obj(p.ch)?.[id]); if (c) ch[id] = num(c.d) ? 'done' : 'run'; }
  const q = arr(p.q).filter(v => Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] < RS_N).map(v => rsTrack(v[0]));
  const ap = arr(p.ap).filter(v => obj(v) && num(v.q) > 0);
  const o = {
    ph, e, o: [0, 1, 2].includes(p.o) ? p.o : -1, st, l: Math.max(0, Math.min(8, num(p.l) | 0)), n, tk, tt, far: Math.max(...tt),
    k: typeof p.k === 'string' && p.k.length === 60 ? p.k : '',
    re: Math.round(num(p.re)), sp: Math.round(num(p.rs)), bal: Math.round(num(p.re) - num(p.rs)),
    a: num(p.a), ft: num(p.ft), i, q, ch, lc: arr(p.lc).length, lr: arr(x.lr).length, ap: ap.length, apq: Math.round(ap.reduce((s, v) => s + num(v.q), 0)),
    md: Object.keys(obj(x.md) || {}).length, last: disc.length ? Math.max(...disc) : 0, dd: disc.filter(t => t > now - 30 * DAY && t <= now + 60000),
    pol: Object.keys(obj(r.policies) || {}).filter(k => RS_LAWS.includes(k)),
    dil: arr(r.answered).filter(v => v && typeof v.id === 'string' && v.id.startsWith('rse-') && Number.isInteger(v.o)).map(v => [v.id.slice(0, 24), v.o]),
    lt: Object.entries(obj(x.lt) || {}).filter(([k, v]) => k.startsWith('rsl-') && Number.isInteger(v)).map(([k, v]) => [k.slice(0, 32), v]),
  };
  if (num(p.lo)) o.lo = num(p.lo);
  if (num(p.rz)) { o.rz = num(p.rz); o.rzBy = rz && rz[2] ? 1 : 0; }
  if (razed) o.razed = razed;
  return { rs: o };
}

/* the Research tab for a world or a region: R is the rows (functions/stats.js nationRow), all whether it is the world */
export function researchSummary(R, now, all = false) {
  const since = d => now - d * DAY, act30 = R.filter(x => x.t > since(30)), P = R.filter(x => x.rs && x.rs.a > 0);
  const phase = {}, phase30 = {};
  for (const x of R) if (x.rs) add(phase, x.rs.ph);
  for (const x of act30) if (x.rs) add(phase30, x.rs.ph);
  /* the journey: how many nations reached each step (RS_STEPS) */
  const reached = s => {
    const has = { e75: s.e >= RS_AT || s.a > 0, granted: s.a > 0, placed: s.a > 0 && (s.ft > 0 || s.i > 0), open: s.i > 0, d1: s.n >= 1, tier5: s.far >= 5,
      n50: s.n >= 50, n100: s.n >= 100, n200: s.n >= 200, n300: s.n >= 300, n360: s.n >= RS_N };
    for (let k = 1; k <= 4; k++) has['st' + k] = s.a > 0 && (s.st >= k || s.i > 0);
    return has;
  };
  const steps = Object.fromEntries(RS_STEPS.map(k => [k, 0])), steps30 = Object.fromEntries(RS_STEPS.map(k => [k, 0]));
  for (const x of R) if (x.rs) { const h = reached(x.rs); for (const k of RS_STEPS) if (h[k]) { steps[k]++; if (x.t > since(30)) steps30[k]++; } }
  /* on the way to the petition: this month's players without one, by enacted edicts */
  const early = act30.filter(x => x.rs && x.rs.ph === 'early');
  const approach = EDICT_BANDS.map(([a, b]) => ({ a, b, n: early.filter(x => x.rs.e >= a && x.rs.e <= b).length }));
  /* the laboratories */
  const sites = [0, 0, 0], stages = [0, 0, 0, 0, 0], levels = Array(9).fill(0), techs = TECH_BANDS.map(([a, b]) => ({ a, b, n: 0 }));
  const eras = Array(7).fill(0), per = Array(RS_N).fill(0), tracks = [0, 1, 2].map(() => ({ n: 0, top: Array(RS_TIERS + 1).fill(0) }));
  const ch = Object.fromEntries(RS_CHALLENGES.map(id => [id, { run: 0, done: 0 }])), laws = {}, dil = {}, lt = {};
  const studies = [0, 0, 0], bal = [], days = [], dayAt = {};
  const today = Date.parse(dayKey(now));
  for (let j = 29; j >= 0; j--) { const d = dayKey(today - j * DAY); dayAt[d] = days.length; days.push({ d, petitions: 0, opened: 0, disc: 0, researchers: 0 }); }
  const slot = t => dayAt[dayKey(t)];
  let earned = 0, spent = 0, lc = 0, lr = 0, ap = 0, apq = 0, md = 0, razed = 0, destroyed = 0, left = 0;
  const toOpen = [], toPetition = [];
  for (const x of R) if (x.rs && x.rs.razed) razed += x.rs.razed;
  for (const x of P) {
    const s = x.rs;
    if (s.o >= 0) sites[s.o]++;
    if (s.ph === 'building') stages[Math.min(4, s.st)]++;
    if (s.i > 0) levels[s.l]++;
    const band = techs.find(b => s.n >= b.a && s.n <= b.b); if (band) band.n++;
    eras[s.far ? rsEra(s.far) + 1 : 0]++;
    if (s.k) { const b = rsBits(s.k); for (let j = 0; j < RS_N; j++) if (rsHas(b, j)) per[j]++; }
    s.tk.forEach((v, k) => { tracks[k].n += v; tracks[k].top[s.tt[k]]++; });
    for (const [id, v] of Object.entries(s.ch || {})) if (ch[id]) ch[id][v]++;
    for (const k of s.pol || []) add(laws, k);
    for (const [id, o] of s.dil || []) { dil[id] = dil[id] || {}; add(dil[id], o); }
    for (const [id, o] of s.lt || []) { lt[id] = lt[id] || {}; add(lt[id], o); }
    for (const k of s.q || []) studies[k]++;
    earned += s.re; spent += s.sp; lc += s.lc; lr += s.lr; ap += s.ap; apq += s.apq; md += s.md;
    if (s.i > 0) bal.push(s.bal);
    if (s.ph === 'ruined') s.rzBy ? destroyed++ : left++;
    if (s.i > 0 && s.a > 0 && s.i >= s.a) toOpen.push((s.i - s.a) / 3600000);
    if (x.founded > 0 && s.a >= x.founded) toPetition.push((s.a - x.founded) / DAY);
    let i = slot(s.a); if (i != null) days[i].petitions++;
    i = slot(s.i); if (i != null) days[i].opened++;
    const seen = new Set();
    for (const t of s.dd || []) { const j = slot(t); if (j == null) continue; days[j].disc++; if (!seen.has(j)) { seen.add(j); days[j].researchers++; } }
  }
  const top = per.map((v, j) => [j, v]).filter(v => v[1] > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  /* the nations with a programme, the furthest on first */
  const list = P.slice().sort((a, b) => b.rs.n - a.rs.n || b.rs.l - a.rs.l || b.rs.st - a.rs.st || b.t - a.t).slice(0, 300)
    .map(x => ({ id: x.id, name: x.name, reg: x.reg, t: x.t, ph: x.rs.ph, n: x.rs.n, tt: x.rs.tt, l: x.rs.l, o: x.rs.o, st: x.rs.st, bal: x.rs.bal, last: x.rs.last,
      d7: (x.rs.dd || []).filter(t => t > since(7)).length, q: (x.rs.q || []).length, a: x.rs.a, i: x.rs.i, lo: x.rs.lo || 0, e: x.rs.e }));
  /* the nations nearest the petition: this month's players with the most enacted edicts and none yet */
  const next = early.slice().sort((a, b) => b.rs.e - a.rs.e || b.t - a.t).slice(0, 20).map(x => ({ id: x.id, name: x.name, reg: x.reg, e: x.rs.e, t: x.t }));
  /* the waiting: granted or due but not yet at work, the longest waiting first */
  const stuck = R.filter(x => x.rs && ['due', 'site', 'building', 'vetoed'].includes(x.rs.ph) && x.t > since(30))
    .sort((a, b) => (a.rs.a || Infinity) - (b.rs.a || Infinity) || b.rs.e - a.rs.e).slice(0, 40)
    .map(x => ({ id: x.id, name: x.name, reg: x.reg, ph: x.rs.ph, e: x.rs.e, a: x.rs.a || 0, st: x.rs.st || 0, t: x.t, desk: x.rs.desk || 0 }));
  const out = {
    nations: R.length, active30: act30.length, programmes: P.length, phase, phase30, steps, steps30, approach,
    /* this week: discoveries made, and the nations that made one */
    d7: P.reduce((k, x) => k + (x.rs.dd || []).filter(t => t > since(7)).length, 0), r7: P.filter(x => (x.rs.dd || []).some(t => t > since(7))).length,
    medOpen: median(P.filter(x => x.rs.i > 0).map(x => x.rs.n)),
    sites, stages, levels, techs, eras, tracks, top: top.slice(0, 20), rare: top.slice(-10).reverse(), per, never: per.filter(v => !v).length,
    credits: { earned, spent, med: median(bal), p90: pct(bal, 0.9), max: bal.length ? Math.max(...bal) : 0 },
    studies, ch, laws, dil, lt, coop: { lc, lr, ap, apq }, md,
    war: { lost: phase.lost || 0, destroyed, left, razed },
    timing: { toOpenH: median(toOpen), toOpenN: toOpen.length, toPetitionD: median(toPetition), toPetitionN: toPetition.length },
    days, list, next, stuck,
  };
  /* by region, for the whole world */
  if (all) {
    const regs = {};
    for (const x of R) {
      if (!x.reg || !x.rs) continue;
      const g = regs[x.reg] || (regs[x.reg] = { nations: 0, e75: 0, granted: 0, open: 0, techs: 0, best: 0, lost: 0 });
      g.nations++; if (x.rs.e >= RS_AT || x.rs.a > 0) g.e75++; if (x.rs.a > 0) g.granted++; if (x.rs.i > 0) g.open++;
      if (x.rs.ph === 'lost' || x.rs.ph === 'ruined') g.lost++;
      g.techs += x.rs.n || 0; g.best = Math.max(g.best, x.rs.n || 0);
    }
    out.regs = regs;
  }
  return out;
}

/* one nation's research for the export and the Nations tab's panel: the row's numbers, without the bitset */
export function researchBrief(rs) {
  if (!rs) return null;
  const { k, dd, dil, lt, ...o } = rs;
  return { ...o, d30: arr(dd).length };
}
