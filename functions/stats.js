// Player statistics: how players use the game, for the admin portal's Statistics page (functions/admin.js, op
// 'stats') and the daily record of it (jobs/stats). Every nation's record and every sign-in account is boiled down
// to a few numbers per nation (nationRow, accountRow), and those to counts for the whole world or one region
// (summarize). The only names that leave here are those of one region's nations, which are public anyway.
// Pure: it is handed a Firestore instance and a way to list accounts, so the job and the tests can use it as well.
export const DAY = 86400000;
const KEEP = 30 * DAY;   // rulings older than this are not kept per nation (a record holds its latest 80 at most)
const SPAN = 60;         // days on the daily charts
const LIST = 500;        // nations listed for one region, the most recently active first
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const arr = v => Array.isArray(v) ? v : [];
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
const parse = s => { try { return obj(JSON.parse(s)); } catch { return null; } };
export const dayKey = t => new Date(t).toISOString().slice(0, 10);

/* what a nation uses now: each test reads the record as the game keeps it (game/edictum.html) */
export const FEATURES = {
  settled: r => !!obj(r.loc),
  land: r => arr(r.claims).length > 0,
  build: r => arr(r.cities).some(c => arr(c?.b).length > 0),
  cities: r => arr(r.cities).length >= 2,
  trade: r => arr(r.deals).length > 0,
  explore: r => arr(r.disc).length + arr(r.discArc).length > 0 || !!r.exp,
  alliance: r => !!obj(r.alli) || !!r.allyOf,
  war: r => Object.keys(obj(r.wars) || {}).length > 0,
  letters: r => arr(r.dm).some(m => m && !m.i) || num(obj(r.tly)?.dm) > 0, // dm itself is in the own half (nationp), unread here
  assembly: r => { const a = obj(r.asm); return !!a && (arr(a.v).length + arr(a.e).length + arr(a.s).length > 0 || !!a.p); },
  games: r => arr(obj(r.games)?.en).some(e => e && e.f),
  covert: r => arr(r.cov).length > 0,
  desk: r => num(r.ddc) > 0,
  space: r => !!(obj(r.sp)?.moon || obj(r.sp)?.mars || obj(r.belt)),
  moved: r => num(r.mvN) > 0,
  holiday: (r, now) => { const w = obj(r.away); return !!w && num(w.a) <= now && num(w.b) > now; },
};

/* one nation, from its shared half (nations/) and private half (nationx/), joined as src/shim.js joins them */
export function nationRow(id, shared, priv, now) {
  const own = typeof shared?.j === 'string' ? parse(shared.j) : obj(shared); // a record saved before the JSON text is the document itself
  if (!own || typeof own.name !== 'string') return null;
  const r = Object.assign({}, parse(priv?.j) || {}, own), tut = obj(r.tut) || {}, ans = [], f = [];
  for (const a of arr(r.answered))
    if (a && typeof a.id === 'string' && num(a.t) > now - KEEP && num(a.t) <= now + 60000) ans.push([num(a.t), a.id.slice(0, 40), Number.isInteger(a.o) ? a.o : -1]);
  for (const [k, ok] of Object.entries(FEATURES)) { try { if (ok(r, now)) f.push(k); } catch { /* an odd record uses nothing */ } }
  return {
    id, reg: String(shared.reg || r.reg || ''), name: String(shared.name || r.name || '').slice(0, 40), pop: num(shared.pop) || num(r.pop),
    t: num(shared.updatedAt) || num(r.updatedAt) || ms(shared.ts), founded: num(r.founded),
    dec: Math.max(Math.floor(num(r.dec)), arr(r.answered).filter(a => a && a.o >= 0).length), ans,
    inbox: arr(r.inbox).length, freq: num(r.freq) || 30, cities: arr(r.cities).length, claims: arr(r.claims).length,
    tut: arr(tut.lc).filter(k => typeof k === 'string').slice(0, 80), lists: typeof tut.ch === 'string' ? tut.ch : '', glk: r.glk === 1, f,
  };
}
/* one sign-in account (a Firebase Auth user record). Registered as functions/eligibility.js registered() has it. */
export function accountRow(u) {
  const c = u.customClaims || {}, p = (u.providerData || []).map(x => x.providerId);
  return { id: u.uid, created: Date.parse(u.metadata?.creationTime || '') || 0, registered: !!c.dc || p.some(x => x !== 'password' || u.emailVerified),
    google: p.includes('google.com'), email: p.includes('password') && !!u.emailVerified, discord: !!c.dc };
}

/* everything the page counts, read once: every nation in pages of `page`, every account, the devices that reported
   in the last day, board posts per region and the daily records. listUsers(max, token) is Auth's listUsers. */
export async function gather(db, listUsers, { regions = [], now = Date.now(), page = 300, maxAccounts = 50000 } = {}) {
  const rows = [], accts = [];
  for (let last = null; ;) {
    let q = db.collection('nations').limit(page);
    if (last) q = q.startAfter(last);
    const qs = await q.get();
    if (!qs.size) break;
    const priv = await db.getAll(...qs.docs.map(d => db.doc('nationx/' + d.id)));
    qs.docs.forEach((d, i) => { const r = nationRow(d.id, d.data(), priv[i].exists ? priv[i].data() : null, now); if (r) rows.push(r); });
    if (qs.size < page) break;
    last = qs.docs.at(-1);
  }
  let limited = false;
  for (let token; ;) {
    const res = await listUsers(1000, token);
    for (const u of res.users) accts.push(accountRow(u));
    token = res.pageToken;
    if (!token) break;
    if (accts.length >= maxAccounts) { limited = true; break; }
  }
  const count = q => q.count().get().then(s => s.data().count, () => null), week = new Date(now - 7 * DAY);
  const [health, posts, finery, days] = await Promise.all([
    db.collection('saveHealth').where('t', '>', new Date(now - DAY)).select('uid', 'reg', 'device').limit(5000).get(),
    Promise.all(regions.map(reg => Promise.all([count(db.collection('boards/' + reg + '/posts')), count(db.collection('boards/' + reg + '/posts').where('t', '>', week))]))),
    db.collection('finery').select('reg').get(),
    db.collection('statsDays').orderBy('d', 'desc').limit(SPAN).get().catch(() => ({ docs: [] })),
  ]);
  return { at: now, rows, accts, limited,
    devices: health.docs.map(d => ({ id: String(d.get('uid') || ''), reg: String(d.get('reg') || ''), device: String(d.get('device') || '') })),
    posts: Object.fromEntries(regions.map((reg, i) => [reg, { all: posts[i][0], week: posts[i][1] }])),
    finery: finery.docs.map(d => String(d.get('reg') || '')),
    days: days.docs.map(d => d.data()).reverse() };
}

const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const tally = (list, key) => { const o = {}; for (const x of list) for (const k of key(x)) o[k] = (o[k] || 0) + 1; return o; };
/* the headline figures of a set of nations: the daily record keeps these, and the page shows them per region */
function headline(R, now) {
  const since = d => now - d * DAY, n = f => R.reduce((k, x) => k + (f(x) ? 1 : 0), 0);
  let dec1 = 0;
  for (const x of R) for (const a of x.ans) if (a[2] >= 0 && a[0] > since(1)) dec1++;
  return { nations: R.length, a1: n(x => x.t > since(1)), a7: n(x => x.t > since(7)), a30: n(x => x.t > since(30)), new1: n(x => x.founded > since(1)),
    new7: n(x => x.founded > since(7)), new30: n(x => x.founded > since(30)), dec1, deciders1: n(x => x.ans.some(a => a[2] >= 0 && a[0] > since(1))) };
}
/* the Statistics page for the whole world (reg '') or one region */
export function summarize(g, reg = '', now = g.at) {
  const R = reg ? g.rows.filter(x => x.reg === reg) : g.rows, since = d => now - d * DAY, H = headline(R, now);
  const mine = new Set(R.map(x => x.id)), A = reg ? g.accts.filter(a => mine.has(a.id)) : g.accts, nationIds = new Set(g.rows.map(x => x.id));
  /* day by day: nations founded, accounts opened, rulings and the nations that ruled; the last SPAN UTC days */
  const today = Date.parse(dayKey(now)), days = [];
  for (let i = SPAN - 1; i >= 0; i--) days.push({ d: dayKey(today - i * DAY), founded: 0, visitors: 0, rulings: 0, rulers: 0 });
  const at = Object.fromEntries(days.map((x, i) => [x.d, i])), slot = t => at[dayKey(t)];
  for (const x of R) {
    const i = slot(x.founded); if (i != null) days[i].founded++;
    const seen = new Set();
    for (const a of x.ans) if (a[2] >= 0) { const j = slot(a[0]); if (j == null) continue; days[j].rulings++; if (!seen.has(j)) { seen.add(j); days[j].rulers++; } }
  }
  if (!reg) for (const a of A) { const i = slot(a.created); if (i != null) days[i].visitors++; }
  /* when nations rule: each ruling of the last 30 days by UTC weekday (0 Sunday) and hour, weekday * 24 + hour */
  const hours = Array(168).fill(0);
  for (const x of R) for (const a of x.ans) if (a[2] >= 0) { const d = new Date(a[0]); hours[d.getUTCDay() * 24 + d.getUTCHours()]++; }
  /* how long nations keep playing: of those at least N days old, how many saved N days or more after founding */
  const lasting = [1, 3, 7, 14, 30].map(d => { const of = R.filter(x => x.founded && x.founded <= since(d)); return { d, of: of.length, kept: of.filter(x => x.t - x.founded >= d * DAY).length }; });
  /* the nations founded in each of the last eight weeks (from Monday, UTC), and how many came back */
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY, weeks = [];
  for (let w = 7; w >= 0; w--) {
    const a = monday - w * 7 * DAY, C = R.filter(x => x.founded >= a && x.founded < a + 7 * DAY), back = d => { const of = C.filter(x => x.founded <= since(d)); return { of: of.length, kept: of.filter(x => x.t - x.founded >= d * DAY).length }; };
    weeks.push({ w: a, n: C.length, d1: back(1), d7: back(7), a7: C.filter(x => x.t > since(7)).length });
  }
  /* the edicts ruled on in the last 30 days, with how often each option was chosen and how often it was set aside */
  const ed = new Map();
  for (const x of R) for (const [, id, o] of x.ans) { const e = ed.get(id) || { id, n: 0, skip: 0, o: {} }; if (o >= 0) { e.n++; e.o[o] = (e.o[o] || 0) + 1; } else e.skip++; ed.set(id, e); }
  const active30 = R.filter(x => x.t > since(30)), active7 = R.filter(x => x.t > since(7));
  const ruled1 = R.map(x => x.ans.filter(a => a[2] >= 0 && a[0] > since(1)).length).filter(Boolean);
  let skip7 = 0, dec7 = 0;
  for (const x of R) for (const a of x.ans) if (a[0] > since(7)) a[2] >= 0 ? dec7++ : skip7++;
  /* accounts: every one is a browser that opened the game (a guest account is made on the first visit) */
  const withNation = A.filter(a => nationIds.has(a.id)), fresh30 = A.filter(a => a.created > since(30));
  const devices = {}, devSeen = new Set();
  for (const s of g.devices) { if (reg && s.reg !== reg) continue; const k = s.id + ':' + s.device; if (devSeen.has(k)) continue; devSeen.add(k); devices[s.device] = (devices[s.device] || 0) + 1; }
  const regionsList = reg ? null : [...new Set(g.rows.map(x => x.reg).concat(Object.keys(g.posts)))].filter(Boolean).map(r => ({ reg: r, ...headline(g.rows.filter(x => x.reg === r), now), posts: g.posts[r] || null }));
  return {
    at: g.at, reg, ...H, now15: R.filter(x => x.t > now - 15 * 60000).length, dec7, skip7, medRuled1: median(ruled1),
    pop: { p50: median(R.map(x => x.pop)), p90: pct(R.map(x => x.pop), 0.9), max: R.reduce((m, x) => Math.max(m, x.pop), 0) },
    ageDays: median(active30.filter(x => x.founded).map(x => (now - x.founded) / DAY)),
    days, hours, lasting, weeks,
    edicts: { distinct: ed.size, top: [...ed.values()].sort((a, b) => b.n - a.n || b.skip - a.skip).slice(0, 12) },
    pace: tally(active30, x => [x.freq]),
    waiting: tally(active7, x => [x.inbox === 0 ? 'none' : x.inbox < 5 ? 'some' : 'full']), active7: active7.length,
    tut: tally(R, x => x.tut.concat(x.glk ? ['google'] : [])), lists: tally(R, x => [...x.lists]),
    features: tally(active30, x => x.f), active30: active30.length,
    accounts: { total: A.length, withNation: withNation.length, registered: withNation.filter(a => a.registered).length,
      google: withNation.filter(a => a.google).length, email: withNation.filter(a => a.email).length, discord: withNation.filter(a => a.discord).length,
      new1: reg ? null : A.filter(a => a.created > since(1)).length, new7: reg ? null : A.filter(a => a.created > since(7)).length,
      new30: reg ? null : fresh30.length, new30Founded: reg ? null : fresh30.filter(a => nationIds.has(a.id)).length, limited: g.limited },
    devices, finery: g.finery.filter(r => !reg || r === reg).length,
    posts: reg ? g.posts[reg] || null : Object.values(g.posts).reduce((s, p) => ({ all: s.all + (p.all || 0), week: s.week + (p.week || 0) }), { all: 0, week: 0 }),
    regions: regionsList,
    list: reg ? R.slice().sort((a, b) => b.t - a.t).slice(0, LIST).map(x => ({ id: x.id, name: x.name, pop: x.pop, founded: x.founded, t: x.t, dec: x.dec,
      ruled1: x.ans.filter(a => a[2] >= 0 && a[0] > since(1)).length, cities: x.cities, claims: x.claims, tut: x.tut.length })) : null,
    nationCount: R.length,
    history: g.days.map(s => ({ d: s.d, ...(reg ? (s.regs || {})[reg] || {} : s.all || {}) })),
  };
}
/* the day's record (jobs/stats writes it as statsDays/<date>): the headline figures, for the world and each region */
export function snapshot(g, now = g.at) {
  const regs = {};
  for (const r of new Set(g.rows.map(x => x.reg))) if (r) regs[r] = headline(g.rows.filter(x => x.reg === r), now);
  const since = d => now - d * DAY;
  return { d: dayKey(now - DAY / 2), at: now, all: { ...headline(g.rows, now), accounts: g.accts.length, visitors1: g.accts.filter(a => a.created > since(1)).length,
    registered: g.accts.filter(a => a.registered).length }, regs };
}
