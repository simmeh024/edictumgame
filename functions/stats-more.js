// More statistics for the admin portal's Statistics page (functions/admin.js, ops 'stats' and 'statsExport'):
//   content use   – edicts enacted now (nation.policies), achievement rarity (nation.ach), the daily desk by task
//                   kind (nation.dd), how far the newer parts of the game reach (museum, press, Mission Control …)
//   regions/social – fill and growth per region, alliance sizes, players with no contact at all, board posts by day
//   operations    – save reports (saveHealth, kept 7 days): tabs, errors, conflicts, sessions per player, pages
//                   visited; bug reports and support tickets: volume, backlog, time to the team's first answer
// The per-nation parts (rowMore) ride on functions/stats.js nationRow; the rest is read here (gatherMore) and
// counted per world or region (moreSummary). Pure apart from gatherMore, which is handed a Firestore instance.

export const DAY = 86400000;
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const arr = v => Array.isArray(v) ? v : [];
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* the newer parts of the game, read from the record as the game keeps it (game/edictum.html) */
export const REACH = {
  museum: r => Object.keys(obj(r.coll) || {}).length > 0,
  press: r => !!r.dsp,
  mission: r => !!r.mc,
  willow: r => !!r.ws,
  edicts: r => Object.keys(obj(r.policies) || {}).length > 0,
  achievements: r => Object.keys(obj(r.ach) || {}).length > 0,
};
const DESK_RX = /^\d{4}-\d{2}-\d{2}$/;

/* one nation's extra numbers: the edicts in force, achievements earned, its latest daily desk */
export function rowMore(r, now) {
  const f2 = [];
  for (const [k, ok] of Object.entries(REACH)) { try { if (ok(r)) f2.push(k); } catch { /* odd record */ } }
  const D = obj(r.dd);
  let dd = null;
  /* the desk is kept per local day; one from the last two days is today's or yesterday's for every time zone */
  if (D && typeof D.d === 'string' && DESK_RX.test(D.d) && D.d >= dayKey(now - 2 * DAY)) {
    const c = arr(D.c), p = arr(D.p);
    dd = arr(D.q).filter(q => Array.isArray(q) && typeof q[0] === 'string').slice(0, 3).map((q, i) => [q[0].slice(0, 12), p[i] === 1 || num(c[i]) >= num(q[1]) ? 1 : 0]);
    const R = obj(D.r);
    if (R && typeof R.k === 'string') dd.push(['rare:' + R.k.slice(0, 12), R.p === 1 || num(R.c) >= num(R.g) ? 1 : 0]);
  }
  return {
    pol: Object.keys(obj(r.policies) || {}).slice(0, 400).map(k => k.slice(0, 40)),
    ach: Object.keys(obj(r.ach) || {}).slice(0, 600).map(k => k.slice(0, 40)),
    dd, f2,
  };
}

/* everything outside the nations: save reports of the last week, bugs, tickets, board posts, alliances */
export async function gatherMore(db, now = Date.now()) {
  const safe = p => p.catch(() => ({ docs: [] })), week = new Date(now - 7 * DAY), month = new Date(now - 30 * DAY), q90 = new Date(now - 90 * DAY);
  const [health, bugs, tickets, postsT, postsN, alliances] = await Promise.all([
    safe(db.collection('saveHealth').where('t', '>', week).select('uid', 'reg', 'device', 'error', 'conflicts', 'status', 'pg', 't').limit(40000).get()),
    safe(db.collection('bugs').where('t', '>', q90).select('t', 'st', 'reg', 'often').get()),
    safe(db.collection('support').where('t', '>', q90).select('t', 'st', 'm', 'ct', 'reg').get()),
    // posts keep their time as a server timestamp (region boards, news comments) or in ms (the Community Board)
    safe(db.collectionGroup('posts').where('t', '>', month).select('t', 'as').get()),
    safe(db.collectionGroup('posts').where('t', '>', now - 30 * DAY).select('t', 'as').get()),
    safe(db.collection('alliances').select('reg', 'mem', 'npc', 't').get()),
  ]);
  const where = path => { const p = path.split('/'); return p[0] === 'boards' ? 'board:' + p[1] : p[0] === 'devnews' ? 'news' : p[0] === 'cboard' || p[0] === 'community' ? 'community' : p[0]; };
  return {
    health: health.docs.map(d => ({ id: String(d.get('uid') || ''), reg: String(d.get('reg') || ''), device: String(d.get('device') || ''), error: String(d.get('error') || ''),
      conflicts: num(d.get('conflicts')), status: String(d.get('status') || ''), pg: String(d.get('pg') || ''), t: ms(d.get('t')) })),
    bugs: bugs.docs.map(d => ({ t: ms(d.get('t')), st: String(d.get('st') || 'new'), reg: String(d.get('reg') || ''), often: String(d.get('often') || '') })),
    tickets: tickets.docs.map(d => {
      const m = arr(d.get('m')), team = m.find(x => x && x.a === 's');
      return { t: ms(d.get('t')), st: String(d.get('st') || ''), reg: String(d.get('reg') || ''), msgs: m.length, first: team ? num(team.t) : 0, closed: ms(d.get('ct')) };
    }),
    // not the Assembly's debate topics (functions/civic.js, debateTopic): no player wrote them
    posts: postsT.docs.concat(postsN.docs).filter(d => d.get('as') !== true).map(d => ({ t: ms(d.get('t')), where: where(d.ref.path) })).filter(p => p.t),
    alliances: alliances.docs.map(d => ({ reg: String(d.get('reg') || ''), mem: Object.keys(obj(d.get('mem')) || {}).length, npc: Object.keys(obj(d.get('npc')) || {}).length, t: ms(d.get('t')) || num(d.get('t')) })),
  };
}

const SOCIAL = ['trade', 'alliance', 'war', 'letters', 'assembly', 'covert', 'games'];
const days = (now, n) => { const today = Date.parse(dayKey(now)), L = []; for (let i = n - 1; i >= 0; i--) L.push(dayKey(today - i * DAY)); return L; };

/* the extra figures for the whole world (reg '') or one region; g is stats.js gather(), m is gatherMore() */
export function moreSummary(g, m, reg = '', now = g.at) {
  const R = reg ? g.rows.filter(x => x.reg === reg) : g.rows, since = d => now - d * DAY, act30 = R.filter(x => x.t > since(30));
  const inReg = x => !reg || x.reg === reg;

  /* content: edicts in force, achievements, the desk, reach */
  const edicts = {}, ach = {}, desk = {}, reach = {};
  for (const x of R) {
    for (const k of x.pol || []) add(edicts, k);
    for (const k of x.ach || []) add(ach, k);
  }
  for (const x of act30) {
    for (const k of x.f2 || []) add(reach, k);
    for (const k of x.f || []) add(reach, k);
    for (const [k, done] of x.dd || []) { const e = desk[k] || (desk[k] = { shown: 0, done: 0 }); e.shown++; e.done += done; }
  }
  const deskDays = act30.filter(x => x.dd && x.dd.length), deskClear = deskDays.filter(x => x.dd.filter(t => !t[0].startsWith('rare:')).every(t => t[1])).length;

  /* regions: nations, the active and the founded per week for the last eight weeks (the page forecasts the fill) */
  const today = Date.parse(dayKey(now)), monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const regs = {};
  for (const x of g.rows) {
    if (!x.reg || !inReg(x)) continue;
    const e = regs[x.reg] || (regs[x.reg] = { nations: 0, a30: 0, a7: 0, weeks: Array(8).fill(0), alliances: 0, inAlliance: 0, loners: 0 });
    e.nations++; if (x.t > since(30)) e.a30++; if (x.t > since(7)) e.a7++;
    const w = Math.floor((monday + 7 * DAY - x.founded) / (7 * DAY));
    if (x.founded && w >= 0 && w < 8) e.weeks[7 - w]++;
  }

  /* social: alliance sizes, nations with no contact with any other, board posts by day */
  const sizes = {}, A = m.alliances.filter(a => inReg(a));
  for (const a of A) { add(sizes, a.mem >= 10 ? '10+' : a.mem >= 5 ? '5-9' : a.mem >= 2 ? '2-4' : '1'); if (regs[a.reg]) regs[a.reg].alliances++; }
  let loners = 0, allied = 0, writers = 0, traders = 0;
  for (const x of act30) {
    const s = (x.f || []).filter(k => SOCIAL.includes(k));
    if (!s.length) { loners++; if (regs[x.reg]) regs[x.reg].loners++; }
    if (s.includes('alliance')) { allied++; if (regs[x.reg]) regs[x.reg].inAlliance++; }
    if (s.includes('letters')) writers++;
    if (s.includes('trade')) traders++;
  }
  const D30 = days(now, 30), posts = Object.fromEntries(D30.map(d => [d, 0])), postWhere = {};
  for (const p of m.posts) {
    if (reg && p.where !== 'board:' + reg) continue;
    const d = dayKey(p.t); if (d in posts) posts[d]++;
    add(postWhere, p.where.startsWith('board:') ? 'region boards' : p.where);
  }

  /* operations: save reports of the last 7 days, a report per game tab (session) */
  const H = m.health.filter(h => inReg(h)), D7 = days(now, 7), opsDays = Object.fromEntries(D7.map(d => [d, { tabs: 0, players: new Set(), errors: 0, conflicts: 0, offline: 0 }]));
  const errors = {}, pages = {}, perPlayerDay = {};
  for (const h of H) {
    const d = opsDays[dayKey(h.t)];
    if (d) { d.tabs++; d.players.add(h.id); if (h.error) d.errors++; if (h.conflicts) d.conflicts++; if (h.status === 'offline') d.offline++; }
    if (h.error) add(errors, h.error.slice(0, 64));
    const pg = h.pg || 'start', e = pages[pg] || (pages[pg] = { tabs: 0, players: new Set() });
    e.tabs++; e.players.add(h.id);
    add(perPlayerDay, h.id + ':' + dayKey(h.t));
  }
  const tabsEach = Object.values(perPlayerDay);

  /* bug reports and support tickets of the last 90 days */
  const B = m.bugs.filter(b => inReg(b)), T = m.tickets.filter(t => inReg(t)), D90w = [];
  for (let w = 12; w >= 0; w--) { const a = monday - w * 7 * DAY; D90w.push({ w: a, bugs: 0, tickets: 0 }); }
  const wk = t => { const i = 12 - Math.floor((monday + 7 * DAY - t) / (7 * DAY)) ; return D90w[i]; };
  const bugSt = {};
  for (const b of B) { add(bugSt, b.st); const w = wk(b.t); if (w) w.bugs++; }
  const firstAns = [], tkSt = {};
  for (const t of T) { add(tkSt, t.st || 'open'); const w = wk(t.t); if (w) w.tickets++; if (t.first && t.first >= t.t) firstAns.push((t.first - t.t) / 3600000); }

  return {
    content: {
      edicts, ach, nations: R.length, active30: act30.length, reach,
      desk, deskNations: deskDays.length, deskClear,
    },
    regions: regs,
    social: { alliances: A.length, sizes, allied, loners, writers, traders, active30: act30.length,
      posts: D30.map(d => ({ d, n: posts[d] })), postWhere },
    ops: {
      days: D7.map(d => ({ d, tabs: opsDays[d].tabs, players: opsDays[d].players.size, errors: opsDays[d].errors, conflicts: opsDays[d].conflicts, offline: opsDays[d].offline })),
      errors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 15),
      pages: Object.entries(pages).map(([pg, e]) => ({ pg, tabs: e.tabs, players: e.players.size })).sort((a, b) => b.players - a.players || b.tabs - a.tabs).slice(0, 60),
      tabsPerPlayerDay: median(tabsEach), players7: new Set(H.map(h => h.id)).size,
      bugs: { n: B.length, st: bugSt }, tickets: { n: T.length, st: tkSt, open: T.filter(t => t.st === 'open').length, unanswered: T.filter(t => t.st === 'open' && !t.first).length,
        firstAnswerH: median(firstAns), answered: firstAns.length },
      weeks: D90w,
    },
  };
}

/* the shop's buyers beside their nations: how long they had played and how much they had decided when they first paid */
export function buyerTiming(txs, rows) {
  const byId = new Map(rows.map(x => [x.id, x])), first = new Map();
  for (const t of txs) {
    if (t.status && t.status !== 'completed') continue;
    const u = t.payer || t.uid, at = num(t.paid); if (!u || !at) continue;
    const f = first.get(u); if (!f || at < f.at) first.set(u, { at, product: t.product || '' });
  }
  const bands = { 'same day': 0, '1-6 days': 0, '7-29 days': 0, '30+ days': 0, 'no nation': 0 }, dayList = [], decList = [], firstProduct = {};
  for (const [u, f] of first) {
    add(firstProduct, f.product);
    const x = byId.get(u);
    if (!x || !x.founded) { bands['no nation']++; continue; }
    const d = Math.max(0, (f.at - x.founded) / DAY); dayList.push(d); decList.push(x.dec);
    bands[d < 1 ? 'same day' : d < 7 ? '1-6 days' : d < 30 ? '7-29 days' : '30+ days']++;
  }
  return { buyers: first.size, bands, medianDays: median(dayList), medianDecided: median(decList), firstProduct };
}
