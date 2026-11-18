// What nations do, for the admin portal's Statistics page (its Activity and Nations tabs) and the nightly record:
//   actions  – the timed things a nation's record keeps of what its player did: an edict decided, a building or an
//              upgrade started, a hex claimed, a city founded, a trade, a war declared, a hex taken, a peace, an
//              alliance move, a spy mission, an expedition, an Assembly vote (ACT). Counted per day, per kind and per
//              nation. Lists the game caps (the event log keeps 60 entries, the rulings 80, spy reports 12) lose the
//              oldest entries of the busiest nations, so days further back count low; the nightly record keeps each
//              day as it was counted just after it ended.
//   events   – the nation's own event log (n.log), its last week: the mix of kinds and the latest across nations
//   builds   – the buildings standing in every city, by kind, with their upgrades and tiers
//   styles   – each nation's play style this week: the kind of action it took most, weighed (STYLE)
//   lifetime – the nation's own tally of what it has done over its life (n.tly, kept by the game's tallyScan)
// Letters are left out but for the tally's count: a nation's letters are in its own half (nationp), never read here.
// Pure: rowActs is handed the record as functions/stats.js nationRow joins it, actSummary the rows.

export const DAY = 86400000;
const WEEK = 7 * DAY, SPAN = 60;
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const arr = v => Array.isArray(v) ? v : [];
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

/* the kinds of action, in the order the page lists them */
export const ACT = ['edict', 'build', 'upgrade', 'claim', 'city', 'trade', 'war', 'conq', 'peace', 'ally', 'spy', 'exp', 'vote'];
const ALLY_LOG = new Set(['alfound', 'aljoin', 'aladmit', 'alremove', 'alleave', 'aldisband']);
/* log entries that happened to the nation rather than by its player: never its latest action */
const PASSIVE = new Set(['lost', 'npcwar', 'npcleft', 'mile', 'sym', 'fxm', 'cat', 'caught', 'incident', 'restore', 'wake']);
/* a play style is the kind of action a nation took most this week, each action weighed: a city counts as four hexes,
   a war as two hexes taken. A nation whose only actions were edicts is 'edicts'; one with none, 'quiet'. */
export const STYLE = {
  builder: { build: 2, upgrade: 2 },
  expander: { claim: 1, city: 4 },
  warlord: { war: 4, conq: 2, spy: 1 },
  trader: { trade: 3 },
  diplomat: { ally: 4, peace: 3 },
  politician: { vote: 2 },
  explorer: { exp: 3 },
};
export const STYLES = Object.keys(STYLE).concat('edicts', 'quiet');
/* the lifetime tally's counts the page sums (n.tly keys) */
export const LIFE = ['iss', 'build', 'wonder', 'claim', 'cities', 'conq', 'lostc', 'log:war', 'log:peace', 'log:trade', 'deal', 'spy', 'exp', 'dm', 'asm:vote', 'games', 'medal:g'];
/* the tally keys a nation's detail may show: none naming another nation (war:<uid>, dm:<uid>, deal:<uid> …) */
const TALLY_SHOW = /^(?:[a-z]+|(?:build|iss|isp|spy|exp|site|first|medal|log|asm|crs|gmb|mile):[a-z0-9:_-]{1,40})$/i;

/* every timed action of a record since `from`: [time, kind], oldest first */
export function actions(r, from, now) {
  const L = [], put = (t, k) => { t = num(t); if (t > from && t <= now + 60000) L.push([t, k]); };
  for (const a of arr(r.answered)) if (a && Number.isInteger(a.o) && a.o >= 0) put(a.t, 'edict');
  for (const c of arr(r.cities)) {
    if (!obj(c)) continue;
    put(c.t, 'city');
    for (const b of arr(c.b)) {
      if (!obj(b)) continue;
      put(b.s, 'build');
      if (obj(b.uu)) put(b.uu.s, 'upgrade');
      if (obj(b.tu)) put(b.tu.s, 'upgrade');
    }
  }
  for (const e of arr(r.claims)) if (obj(e)) put(e.t, 'claim');
  /* an offer made to a player; a deal signed (the log's 'trade', which an NPC deal writes at once) */
  for (const x of arr(r.deals)) if (obj(x) && !x.a && !String(x.w || '').startsWith('npc-')) put(x.t, 'trade');
  for (const l of arr(r.log)) {
    if (!obj(l)) continue;
    const k = l.k === 'trade' ? 'trade' : l.k === 'war' ? 'war' : l.k === 'conq' ? 'conq' : l.k === 'peace' ? 'peace' : ALLY_LOG.has(l.k) ? 'ally' : '';
    if (k) put(l.t, k);
  }
  for (const x of arr(r.intel)) if (obj(x)) put(x.t, 'spy');
  for (const e of arr(r.disc)) if (obj(e)) put(e.t, 'exp');
  for (const h of arr(obj(r.asm)?.h)) if (obj(h) && h.mv !== undefined) put(h.f, 'vote');
  return L.sort((a, b) => a[0] - b[0]);
}
const countKinds = L => { const o = {}; for (const [, k] of L) add(o, k); return o; };
/* a nation's play style from its counts of actions */
export function styleOf(c) {
  let best = '', top = 0;
  for (const [s, w] of Object.entries(STYLE)) {
    let v = 0; for (const [k, x] of Object.entries(w)) v += (c[k] || 0) * x;
    if (v > top) { top = v; best = s; }
  }
  return best || (c.edict ? 'edicts' : 'quiet');
}

/* one nation's part: its actions of the last SPAN days, its event log of the last week, its latest action, its
   buildings, its style this week and its lifetime tally */
export function rowActs(r, now) {
  const acts = actions(r, now - SPAN * DAY, now), wk = acts.filter(a => a[0] > now - WEEK), a7 = countKinds(wk);
  const evs = [];
  let last = acts.length ? [acts.at(-1)[0], acts.at(-1)[1]] : null;
  for (const l of arr(r.log)) {
    if (!obj(l) || typeof l.k !== 'string') continue;
    const t = num(l.t);
    if (t > now - WEEK && t <= now + 60000) evs.push([t, l.k.slice(0, 12), str(l.a, 128), str(l.b, 60), str(l.fx, 60)]);
    if (!PASSIVE.has(l.k) && t <= now + 60000 && (!last || t > last[0])) last = [t, 'log:' + l.k.slice(0, 12)];
  }
  const bld = [], bwk = {};
  let bq = 0;
  for (const c of arr(r.cities)) for (const b of arr(obj(c)?.b)) {
    if (!obj(b) || typeof b.k !== 'string') continue;
    if (num(b.s) > now - WEEK && num(b.s) <= now + 60000) add(bwk, b.k.slice(0, 16));
    if (num(b.d) > now) { bq++; continue; }
    const ug = Number.isInteger(b.ug) && b.ug >= 1 && b.ug <= 5 ? b.ug : b.lv === 3 ? 5 : b.lv === 2 ? 4 : 0;
    bld.push([b.k.slice(0, 16), ug, Number.isInteger(b.tr) && b.tr >= 2 ? b.tr : 1]);
  }
  const T = obj(r.tly) || {}, life = {};
  for (const k of LIFE) if (num(T[k])) life[k] = num(T[k]);
  return { acts, evs, last, a7, wk: wk.length, style: styleOf(a7), bld, bq, bwk, life };
}

const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/* the actions of a set of rows between two times, by kind */
export function actCount(R, from, to) {
  const o = {};
  for (const x of R) for (const [t, k] of x.acts || []) if (t >= from && t < to) add(o, k);
  return o;
}

/* the Activity tab for a set of rows R (the world or one region); history is the nightly record (statsDays) */
export function actSummary(R, now, history = [], regOf = null) {
  const since = d => now - d * DAY, today = Date.parse(dayKey(now));
  /* actions day by day: the night's record where there is one, else counted now */
  const rec = new Map(history.filter(h => obj(h?.act)).map(h => [h.d, h.act]));
  const days = [];
  for (let i = SPAN - 1; i >= 0; i--) {
    const a = today - i * DAY, d = dayKey(a), r = rec.get(d);
    days.push({ d, rec: !!r, ...(r || actCount(R, a, a + DAY)) });
  }
  const d1 = actCount(R, since(1), Infinity), d7 = actCount(R, since(7), Infinity), nat7 = {};
  for (const x of R) for (const k of Object.keys(x.a7 || {})) add(nat7, k);
  /* the event log: each kind's count in the last day and week, the nations that logged it, and the latest events */
  const kinds = {}, latest = [];
  for (const x of R) {
    const seen = new Set();
    for (const [t, k, a, b, fx] of x.evs || []) {
      const e = kinds[k] || (kinds[k] = [0, 0, 0]);
      if (t > since(1)) e[0]++;
      e[1]++;
      if (!seen.has(k)) { seen.add(k); e[2]++; }
      latest.push({ t, k, id: x.id, name: x.name, reg: x.reg, a, b, fx });
    }
  }
  latest.sort((p, q) => q.t - p.t);
  /* buildings: by kind, standing (finished), the nations with one, upgrades, at gold, above tier I, under way and
     started this week */
  const builds = {}, b0 = { n: 0, nations: 0, ug: 0, gold: 0, t2: 0, wk: 0 };
  let wip = 0, withB = 0, upWk = 0;
  for (const x of R) {
    const mine = new Set();
    for (const [k, ug, tr] of x.bld || []) {
      const e = builds[k] || (builds[k] = { ...b0 });
      e.n++; e.ug += ug; if (ug >= 5) e.gold++; if (tr >= 2) e.t2++;
      if (!mine.has(k)) { mine.add(k); e.nations++; }
    }
    if (mine.size) withB++;
    wip += x.bq || 0;
    upWk += (x.a7 || {}).upgrade || 0;
  }
  /* the buildings started this week, by kind: the started ones a record keeps with their time */
  for (const x of R) for (const [k, n] of Object.entries(x.bwk || {})) (builds[k] || (builds[k] = { ...b0 })).wk += n;
  /* play styles this week, of the nations active this week, and the nations that lead each */
  const act7 = R.filter(x => x.t > since(7)), styles = {}, leaders = {}, byReg = {};
  for (const x of act7) {
    add(styles, x.style);
    (leaders[x.style] || (leaders[x.style] = [])).push(x);
    if (regOf) add(byReg[x.reg] || (byReg[x.reg] = {}), x.style);
  }
  const lead = {};
  for (const [s, L] of Object.entries(leaders)) lead[s] = L.sort((a, b) => b.wk - a.wk || b.t - a.t).slice(0, 5).map(x => ({ id: x.id, name: x.name, reg: x.reg, wk: x.wk }));
  const life = {};
  for (const x of R) for (const [k, v] of Object.entries(x.life || {})) add(life, k, v);
  return {
    d1, d7, nat7, days, life, active7: act7.length, perNation7: median(act7.map(x => x.wk)),
    events: { kinds, latest: latest.slice(0, 60) },
    builds, withBuildings: withB, wip, upgrades7: upWk,
    styles, lead, styleRegs: regOf ? byReg : null,
  };
}

/* the day's actions for the nightly record (statsDays): the day from `from`, for the world and each region */
export function actDay(rows, from) {
  const all = actCount(rows, from, from + DAY), regs = {};
  for (const x of rows) if (x.reg) { const o = regs[x.reg] || (regs[x.reg] = {}); for (const [t, k] of x.acts || []) if (t >= from && t < from + DAY) add(o, k); }
  return { all, regs };
}

/* one nation in full, for its detail on the Nations tab (functions/admin.js, op 'statsNation'): what it has done and
   when, what it holds and builds, and its history. r is the joined record (shared over private half). */
export function nationDetail(id, r, now) {
  const T = obj(r.tly) || {}, F = obj(r.tlf) || {}, tally = {}, firsts = {};
  for (const [k, v] of Object.entries(T)) if (TALLY_SHOW.test(k) && num(v)) tally[k] = num(v);
  for (const [k, v] of Object.entries(F)) if (/^[a-z]+$/i.test(k) && num(v)) firsts[k] = num(v);
  const acts = actions(r, now - 30 * DAY, now), perDay = {};
  for (const [t, k] of acts) { const d = perDay[dayKey(t)] || (perDay[dayKey(t)] = {}); add(d, k); }
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = dayKey(now - i * DAY); days.push({ d, ...(perDay[d] || {}) }); }
  /* a city keeps its name (nm) but the capital, named by the nation's own capital field (cityLabel in the game) */
  const cities = arr(r.cities).filter(obj).slice(0, 60).map(c => ({ nm: str(c.nm, 40) || str(r.capital, 40), t: num(c.t), cap: !c.nm && !!r.capital,
    b: arr(c.b).filter(b => obj(b) && typeof b.k === 'string').map(b => ({ k: b.k.slice(0, 16), s: num(b.s), d: num(b.d), ug: Number.isInteger(b.ug) ? b.ug : 0, tr: Number.isInteger(b.tr) ? b.tr : 1,
      up: obj(b.uu) && num(b.uu.d) > now ? num(b.uu.d) : 0 })) }));
  const stock = {}, S = obj(r.stock) || {};
  for (const k of ['food', 'timber', 'iron', 'oil', 'goods']) if (k in S) stock[k] = Math.round(num(S[k]));
  return {
    id, name: str(r.name, 40), reg: str(r.reg, 40), pop: num(r.pop), founded: num(r.founded), t: num(r.updatedAt),
    a7: countKinds(acts.filter(a => a[0] > now - WEEK)), days, tally, firsts,
    log: arr(r.log).filter(l => obj(l) && typeof l.k === 'string').slice(0, 60).map(l => ({ t: num(l.t), k: l.k.slice(0, 12), a: str(l.a, 128), b: str(l.b, 60), fx: str(l.fx, 80) })),
    rulings: arr(r.answered).filter(a => obj(a) && typeof a.id === 'string').map(a => ({ t: num(a.t), id: a.id.slice(0, 40), o: Number.isInteger(a.o) ? a.o : -1 })).sort((a, b) => b.t - a.t).slice(0, 40),
    cities, policies: Object.keys(obj(r.policies) || {}).slice(0, 400).map(k => k.slice(0, 40)),
    hist: arr(r.hist).filter(h => obj(h) && num(h.t)).slice(-90).map(h => [num(h.t), num(h.p), num(h.e), num(h.q) || 1]),
    stock, stockAt: num(r.stockAt), wars: Object.keys(obj(r.wars) || {}).length, ally: !!(obj(r.alli) || r.allyOf),
  };
}
