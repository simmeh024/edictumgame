// Player statistics: how players use the game, for the admin portal's Statistics page (functions/admin.js, op
// 'stats') and the daily record of it (jobs/stats). Every nation's record and every sign-in account is boiled down
// to a few numbers per nation (nationRow, accountRow), and those to counts for the whole world or one region
// (summarize). Nation names leave here only for the admin portal (a region's nations, the onboarding funnel, the most
// engaged players and the recruiters), and they are public in the game anyway.
// Pure: it is handed a Firestore instance and a way to list accounts, so the job and the tests can use it as well.
import { nationText } from './nationtext.js';
import { rowMore } from './stats-more.js';

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
  alliance: r => !!obj(r.alli) || !!r.allyOf || !!r.alm,
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
  const text = nationText(shared), own = text != null ? parse(text) : obj(shared); // a record saved before the JSON text is the document itself
  if (!own || typeof own.name !== 'string') return null;
  const r = Object.assign({}, parse(priv?.j) || {}, own), tut = obj(r.tut) || {}, ans = [], f = [];
  for (const a of arr(r.answered))
    if (a && typeof a.id === 'string' && num(a.t) > now - KEEP && num(a.t) <= now + 60000) ans.push([num(a.t), a.id.slice(0, 40), Number.isInteger(a.o) ? a.o : -1]);
  for (const [k, ok] of Object.entries(FEATURES)) { try { if (ok(r, now)) f.push(k); } catch { /* an odd record uses nothing */ } }
  /* the days of the last fortnight the nation was played: its history takes a point every few hours while the game
     is open (recordHistory in the game), and every ruling has its time */
  const days = new Set(), from = now - 14 * DAY;
  for (const h of arr(r.hist)) { const t = num(h?.t); if (t > from && t <= now + 60000) days.add(dayKey(t)); }
  for (const a of ans) if (a[0] > from) days.add(dayKey(a[0]));
  const row = {
    id, reg: String(shared.reg || r.reg || ''), name: String(shared.name || r.name || '').slice(0, 40), pop: num(shared.pop) || num(r.pop),
    t: num(shared.updatedAt) || num(r.updatedAt) || ms(shared.ts), founded: num(r.founded),
    dec: Math.max(Math.floor(num(r.dec)), arr(r.answered).filter(a => a && a.o >= 0).length), ans,
    inbox: arr(r.inbox).length, freq: num(r.freq) || 30, cities: arr(r.cities).length, claims: arr(r.claims).length,
    tut: arr(tut.lc).filter(k => typeof k === 'string').slice(0, 80), lists: typeof tut.ch === 'string' ? tut.ch : '', glk: r.glk === 1, f,
    d14: days.size, r14: ans.filter(a => a[2] >= 0 && a[0] > from).length,
  };
  row.eng = engagement(row);
  Object.assign(row, rowMore(r, now));
  return row;
}
/* How engaged a player is, 0 to 100, from four parts: the days of the last fortnight they played (40), the edicts they
   decided in it (25, full at 30), the parts of the game their nation uses now (15, full at 8 of USES) and how many of
   them involve other nations (20, full at 3 of SOCIAL). Kept as [score, days, rulings, uses, social]. */
export const SOCIAL = ['trade', 'alliance', 'war', 'letters', 'assembly', 'covert', 'games'];
export const USES = Object.keys(FEATURES).filter(k => k !== 'settled' && k !== 'holiday');
export function engagement(x) {
  const d = Math.min(14, x.d14 || 0), r = x.r14 || 0, u = x.f.filter(k => USES.includes(k)).length, c = x.f.filter(k => SOCIAL.includes(k)).length;
  return [Math.round(40 * d / 14 + 25 * Math.min(1, r / 30) + 15 * Math.min(1, u / 8) + 20 * Math.min(1, c / 3)), d, r, u, c];
}
/* The steps from founding to a nation that is settled in, in the order the game leads a newcomer through them: each a
   bit of the mask funnelMask() gives. A step is what the record shows now (land lost in a war no longer counts). */
export const FUNNEL = ['settled', 'land', 'build', 'ruled', 'cities', 'charter', 'registered'];
export function funnelMask(x, registered) {
  const has = [x.f.includes('settled'), x.f.includes('land'), x.f.includes('build'), x.dec > 0, x.f.includes('cities'), x.lists.includes('c'), !!registered];
  return has.reduce((m, ok, i) => ok ? m | (1 << i) : m, 0);
}
/* the engagement scores of every nation, for Player search: written as ENG_PARTS documents statsEngage/<n>
   {at, m: {uid: [score, days, rulings, uses, social]}} whenever the statistics are counted (the admin portal, at most
   every ten minutes, and the nightly job) */
export const ENG_PARTS = 8;
const engPart = uid => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % ENG_PARTS; };
export function engageParts(rows) {
  const parts = Array.from({ length: ENG_PARTS }, () => ({}));
  for (const x of rows) if (x.eng) parts[engPart(x.id)][x.id] = x.eng;
  return parts;
}
export async function saveEngage(db, g) {
  const b = db.batch();
  engageParts(g.rows).forEach((m, i) => b.set(db.doc('statsEngage/' + i), { at: g.at, m }));
  await b.commit();
}
export async function loadEngage(db) {
  const docs = await db.getAll(...Array.from({ length: ENG_PARTS }, (_, i) => db.doc('statsEngage/' + i)));
  const m = new Map(); let at = 0;
  for (const d of docs) if (d.exists) { at = Math.max(at, num(d.get('at'))); for (const [k, v] of Object.entries(obj(d.get('m')) || {})) if (Array.isArray(v)) m.set(k, v); }
  return { at, m };
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
  const [health, posts, finery, days, recruits, news] = await Promise.all([
    db.collection('saveHealth').where('t', '>', new Date(now - DAY)).select('uid', 'reg', 'device').limit(5000).get(),
    Promise.all(regions.map(reg => Promise.all([count(db.collection('boards/' + reg + '/posts')), count(db.collection('boards/' + reg + '/posts').where('t', '>', week))]))),
    db.collection('finery').select('reg').get(),
    db.collection('statsDays').orderBy('d', 'desc').limit(SPAN).get().catch(() => ({ docs: [] })),
    db.collection('recruits').select('r', 't').get().catch(() => ({ docs: [] })),
    db.collection('devnews').where('pub', '==', true).orderBy('t', 'desc').limit(80).get().catch(() => ({ docs: [] })),
  ]);
  return { at: now, rows, accts, limited,
    devices: health.docs.map(d => ({ id: String(d.get('uid') || ''), reg: String(d.get('reg') || ''), device: String(d.get('device') || '') })),
    posts: Object.fromEntries(regions.map((reg, i) => [reg, { all: posts[i][0], week: posts[i][1] }])),
    finery: finery.docs.map(d => String(d.get('reg') || '')),
    days: days.docs.map(d => d.data()).reverse(),
    recruits: recruits.docs.map(d => ({ id: d.id, r: String(d.get('r') || ''), t: ms(d.get('t')) || num(d.get('t')) })).filter(x => x.r),
    news: news.docs.map(d => ({ id: d.id, t: ms(d.get('t')) || num(d.get('t')), ti: String(d.get('ti') || '').slice(0, 120), tg: String(d.get('tg') || '').slice(0, 20) })).filter(x => x.t) };
}
/* Recruiting: of the nations recruited through another player's link (recruits/<uid> {r, t}), how many were still
   playing a week after founding, beside every other nation, and the same for each recruiter. R is the region's nations
   (or all); a recruiter may live elsewhere. */
export function recruiting(R, g, now) {
  const byId = new Map(g.rows.map(x => [x.id, x])), mine = new Set(R.map(x => x.id)), recruited = new Set(), per = new Map();
  const kept7 = x => x.founded && x.founded <= now - 7 * DAY ? (x.t - x.founded >= 7 * DAY ? 1 : 0) : null;
  let of = 0, kept = 0;
  for (const c of g.recruits || []) {
    const x = byId.get(c.id); if (!x || !mine.has(c.id)) continue;
    recruited.add(c.id);
    const p = per.get(c.r) || { r: c.r, n: 0, of: 0, kept: 0, a7: 0, last: 0 }, k = kept7(x);
    p.n++; if (k != null) { p.of++; p.kept += k; of++; kept += k; }
    if (x.t > now - 7 * DAY) p.a7++;
    p.last = Math.max(p.last, c.t || 0); per.set(c.r, p);
  }
  let oOf = 0, oKept = 0;
  for (const x of R) { if (recruited.has(x.id)) continue; const k = kept7(x); if (k != null) { oOf++; oKept += k; } }
  const list = [...per.values()].map(p => ({ ...p, name: byId.get(p.r)?.name || '', reg: byId.get(p.r)?.reg || '' }))
    .sort((a, b) => b.n - a.n || b.kept - a.kept || b.last - a.last).slice(0, 100);
  return { n: recruited.size, recruiters: per.size, of, kept, others: { of: oOf, kept: oKept }, list };
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
    /* the nations founded in the last eight weeks with the steps each has taken (FUNNEL), for the onboarding funnel */
    funnel: funnelList(R, g, monday - 7 * 7 * DAY),
    /* development news published in the charts' span: the page marks those days as releases */
    releases: (g.news || []).filter(p => p.t > today - SPAN * DAY && p.t <= now + DAY).map(p => ({ t: p.t, ti: p.ti, tg: p.tg })),
    recruits: recruiting(R, g, now),
    eng: engageBands(active30),
  };
}
const FUNNEL_MAX = 3000;
function funnelList(R, g, from) {
  const regd = new Set(g.accts.filter(a => a.registered).map(a => a.id)), L = R.filter(x => x.founded >= from).sort((a, b) => b.founded - a.founded);
  return { steps: FUNNEL, from, total: L.length, nations: L.slice(0, FUNNEL_MAX).map(x => [x.id, x.name, x.reg, x.founded, x.t, funnelMask(x, regd.has(x.id))]) };
}
/* this month's players by engagement score, in quarters, and the most engaged of them */
function engageBands(active30) {
  const bands = [0, 0, 0, 0];
  for (const x of active30) bands[Math.min(3, Math.floor((x.eng?.[0] || 0) / 25))]++;
  const top = active30.slice().sort((a, b) => (b.eng?.[0] || 0) - (a.eng?.[0] || 0) || b.t - a.t).slice(0, 10).map(x => ({ id: x.id, name: x.name, reg: x.reg, eng: x.eng }));
  return { bands, median: median(active30.map(x => x.eng?.[0] || 0)), top };
}
/* the day's record (jobs/stats writes it as statsDays/<date>): the headline figures, for the world and each region,
   and what this month's players use (act30 of them; feat counts each part of the game) for the feature history */
export function snapshot(g, now = g.at) {
  const regs = {}, since = d => now - d * DAY;
  const use = rows => { const a = rows.filter(x => x.t > since(30)); return { act30: a.length, feat: tally(a, x => x.f) }; };
  for (const r of new Set(g.rows.map(x => x.reg))) if (r) { const rows = g.rows.filter(x => x.reg === r); regs[r] = { ...headline(rows, now), ...use(rows) }; }
  return { d: dayKey(now - DAY / 2), at: now, all: { ...headline(g.rows, now), ...use(g.rows), accounts: g.accts.length, visitors1: g.accts.filter(a => a.created > since(1)).length,
    registered: g.accts.filter(a => a.registered).length }, regs };
}
