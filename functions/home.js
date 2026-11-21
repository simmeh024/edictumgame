// The front page's live figures (game/edictum.html, "the front page"): what homeLive (home-live.js) gathers every five minutes
// into home/live, one public document that every visitor reads once (never listens to), so a visitor's cost is a read
// however many players there are. Only what the server already keeps, nothing new is tracked:
//   - the public summaries (summaries/<uid>: one for every player nation, none for the computer's): how many nations,
//     how many were active in the past day, and per region; the foundings (f, the founding time)
//   - the shared half of the records saved since the last run (nations/<uid>, which every player of the region already
//     downloads): the public entries of the nation's own event log (cities, alliances, wars, peace, wonders, population
//     milestones, trade deals, the Games) and its rulings (n.answered), for the edicts decided in the past day
//   - the treaties signed lately (treaties/, functions/treaties.js), which both sides' pages show
// Nothing private: no letters, no spying, no reports, no uids in the public document. A nation a moderator has hidden or
// removed, or a banned player's, never shows; names are read again at every run, so a renamed nation shows its new name.
// homeState/main is the job's own memory (only the server reads it): the decisions of the past day per nation, the
// latest log entry it has seen per nation and the events it has gathered.
import { nationText } from './nationtext.js';

export const HOME_V = 1, DAY = 864e5, WEEK = 7 * DAY, EV_KEEP = 7 * DAY, EV_MAX = 40, DORM_MS = 250 * DAY;
/* the kinds of a record's log entry the front page tells of, and the words beside the nation's name (x) */
const ALLY = l => str(l.b, 60);
export const LOG_PUBLIC = {
  city: l => str(l.a, 60),
  alfound: ALLY,
  aljoin: ALLY,
  war: l => ({ other: l.a, x: str(l.b, 40) }),
  peace: l => ({ other: l.a, x: str(l.b, 40) }),
  trade: l => ({ other: l.a, x: str(l.b, 40) }),
  wonder: l => str(l.b, 60),
  mile: l => str(l.a, 30),
  hostwin: l => str(l.a, 60),
};
export const TREATY_NAME = { nap: 'non-aggression pact', trade: 'trade agreement', research: 'research pact' };
const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const isUid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-');

/* a nations/ document's record (shared half), or null */
export function recordOf(d) {
  try { const t = nationText(d); const r = t ? JSON.parse(t) : null; return r && typeof r === 'object' ? r : null; } catch { return null; }
}
/* the times of a record's rulings in the past day (a veto, o -1, decides nothing) */
export function decisionsSince(rec, since) {
  return (Array.isArray(rec && rec.answered) ? rec.answered : []).filter(a => a && num(a.o) >= 0 && a.o !== -1 && num(a.t) > since).map(a => a.t).slice(-200);
}
/* the public events in a record's log after `after` (and within EV_KEEP of now): {k, t, uid, other?, x} */
export function logEvents(uid, rec, after, now) {
  const out = [], from = Math.max(after || 0, now - EV_KEEP);
  for (const l of Array.isArray(rec && rec.log) ? rec.log : []) {
    if (!l || typeof l !== 'object' || !LOG_PUBLIC[l.k]) continue;
    const t = num(l.t);
    if (!(t > from) || t > now + 60000) continue;
    const v = LOG_PUBLIC[l.k](l), e = { k: l.k, t, uid };
    if (v && typeof v === 'object') { if (isUid(v.other) || /^npc-/.test(String(v.other || ''))) e.other = String(v.other).slice(0, 128); e.x = v.x; } else e.x = v || '';
    out.push(e);
  }
  return out;
}
/* the newest log entry's time, so the next run starts after it */
export const lastLog = rec => (Array.isArray(rec && rec.log) ? rec.log : []).reduce((m, l) => Math.max(m, num(l && l.t)), 0);

/* the new memory from the old one and what changed: the records saved since (changed: [{uid, rec}]) */
export function absorb(state, changed, now) {
  const dec = { ...(state.dec || {}) }, seen = { ...(state.seen || {}) }, evs = (state.ev || []).slice();
  for (const { uid, rec } of changed) {
    if (!rec) continue;
    const d = decisionsSince(rec, now - DAY);
    if (d.length) dec[uid] = d; else delete dec[uid];
    evs.push(...logEvents(uid, rec, seen[uid] || 0, now));
    seen[uid] = Math.max(seen[uid] || 0, lastLog(rec));
  }
  /* yesterday's rulings go, and the memory of nations that saved nothing for a week */
  for (const u of Object.keys(dec)) { dec[u] = dec[u].filter(t => t > now - DAY); if (!dec[u].length) delete dec[u]; }
  for (const u of Object.keys(seen)) if (seen[u] < now - EV_KEEP) delete seen[u];
  return { dec, seen, ev: mergeEvents(evs, now) };
}
/* each event once, the newest first, within EV_KEEP */
export function mergeEvents(list, now, max = 200) {
  const seen = new Set(), out = [];
  for (const e of list) {
    if (!e || !(e.t > now - EV_KEEP)) continue;
    const key = [e.k, e.uid, e.t, e.other || '', e.x || ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out.sort((a, b) => b.t - a.t).slice(0, max);
}
export const decided = (dec, now) => Object.values(dec || {}).reduce((s, l) => s + l.filter(t => t > now - DAY).length, 0);

/* the public document. names: uid -> {name, reg} (current summaries); hide: uids never shown; npcName: id -> name.
   counts: {n, a} overall and r: {reg: {n, a, w}} */
export function liveDoc({ now, counts, regions, foundings, state, names, hide, npcName, def }) {
  const nameOf = id => isUid(id) ? (hide.has(id) ? '' : names.get(id)?.name || '') : npcName(id) || '';
  const ev = [];
  for (const f of foundings) if (!hide.has(f.uid) && names.has(f.uid)) ev.push({ k: 'found', t: f.t, uid: f.uid, reg: f.reg });
  for (const e of state.ev || []) {
    const me = names.get(e.uid);
    if (!me || hide.has(e.uid)) continue;
    if (e.other && isUid(e.other) && (hide.has(e.other) || !names.has(e.other))) continue;
    ev.push({ ...e, reg: me.reg, x: e.other ? nameOf(e.other) || e.x : e.x });
  }
  const pub = mergeEvents(ev, now, EV_MAX).map(e => {
    const o = { k: e.k, t: e.t, nm: names.get(e.uid)?.name || '', reg: e.reg || '' };
    if (e.x) o.x = String(e.x).slice(0, 60);
    if (e.y) o.y = String(e.y).slice(0, 40);
    return o;
  }).filter(e => e.nm);
  return { v: HOME_V, at: now, c: { n: counts.n, a: counts.a, e: decided(state.dec, now) }, r: regions, ev: pub, ...(def ? { def } : {}) };
}
/* treaties signed in the past week, as events of the one who offered them (y: what was signed) */
export function treatyEvents(docs, now) {
  return docs.map(d => {
    const T = d.data ? d.data() : d;
    if (!T || T.st !== 'active' || !(num(T.at) > now - EV_KEEP) || !TREATY_NAME[T.k]) return null;
    const a = isUid(T.a) ? T.a : isUid(T.b) ? T.b : null, b = a === T.a ? T.b : T.a;
    if (!a) return null;
    return { k: 'treaty', t: T.at, uid: a, other: String(b || '').slice(0, 128), y: TREATY_NAME[T.k] };
  }).filter(Boolean);
}

/* One run: reads, works out, writes home/live and the memory. opts: {now, regions: [{id, npcs: [{id, name}]}], dry}.
   Returns a report. */
export async function runHome(db, { now = Date.now(), regions, dry = false, Timestamp } = {}) {
  const sumCol = db.collection('summaries'), stRef = db.doc('homeState/main');
  const st = await stRef.get(), state0 = st.exists ? st.data() : {};
  const sinceTs = num(state0.ts);
  /* the records saved since the last run (the first run reads every one, once), shared half only */
  let q = db.collection('nations');
  if (sinceTs > 0) q = q.where('ts', '>', Timestamp.fromMillis(sinceTs - 60000));
  const nat = await q.select('j', 'z', 'reg', 'ts').get();
  let maxTs = sinceTs;
  const changed = nat.docs.map(d => { const ts = d.get('ts'); const ms = ts && ts.toMillis ? ts.toMillis() : 0; if (ms > maxTs) maxTs = ms; return { uid: d.id, rec: recordOf(d) }; });
  const state = absorb(state0, changed, now);
  /* the counts: the summaries saved within DORM_MS (dormant ones excepted, as the game counts a region's room) and those
     of the past day, per region; a summary dated more than a day ahead is not counted, as the game does */
  const cnt = async query => (await query.count().get()).data().count;
  const [all, day, week] = await Promise.all([
    cnt(sumCol),
    sumCol.where('t', '>', now - DAY).where('t', '<=', now + DAY).select('reg').get(),
    sumCol.where('f', '>', now - WEEK).orderBy('f', 'desc').limit(300).select('reg', 'f', 'name').get(),
  ]);
  const regs = {};
  const perReg = await Promise.all(regions.map(async R => {
    const Q = sumCol.where('reg', '==', R.id);
    const [a, h] = await Promise.all([cnt(Q.where('t', '>', now - DORM_MS).where('t', '<=', now + DAY)), cnt(Q.where('t', '<=', now - DORM_MS).where('e', '>', now - DORM_MS)).catch(() => 0)]);
    return [R.id, a + h];
  }));
  for (const [id, n] of perReg) if (n > 0) regs[id] = { n, a: 0, w: 0 };
  for (const d of day.docs) { const r = d.get('reg'); if (regs[r]) regs[r].a++; }
  for (const d of week.docs) { const r = d.get('reg'); if (regs[r]) regs[r].w++; }
  /* the treaties of the past week */
  const tr = await db.collection('treaties').where('at', '>', now - EV_KEEP).limit(200).get().catch(() => ({ docs: [] }));
  state.ev = mergeEvents(state.ev.concat(treatyEvents(tr.docs, now)), now);
  /* who may be shown: not hidden or removed by a moderator, not banned; names and regions as they are now */
  const [mod, bans] = await Promise.all([db.collection('mod').get(), db.collection('bans').select().get()]);
  const hide = new Set([...mod.docs.filter(d => d.get('hidden') || d.get('removed')).map(d => d.id), ...bans.docs.map(d => d.id)]);
  const want = new Set();
  for (const e of state.ev) { want.add(e.uid); if (isUid(e.other)) want.add(e.other); }
  const foundings = week.docs.map(d => ({ uid: d.id, t: num(d.get('f')), reg: str(d.get('reg'), 40) })).filter(f => f.t > now - EV_KEEP);
  const names = new Map();
  for (const d of week.docs) names.set(d.id, { name: str(d.get('name'), 40), reg: str(d.get('reg'), 40) });
  const ids = [...want].filter(u => !names.has(u));
  for (let i = 0; i < ids.length; i += 300) {
    const docs = await db.getAll(...ids.slice(i, i + 300).map(u => sumCol.doc(u)), { fieldMask: ['name', 'reg'] });
    for (const d of docs) if (d.exists && d.get('name')) names.set(d.id, { name: str(d.get('name'), 40), reg: str(d.get('reg'), 40) });
  }
  const npc = new Map(); for (const R of regions) for (const x of R.npcs || []) npc.set(x.id, x.name);
  /* the default region newcomers are shown (Region control in the admin portal: regionStatus/<id> def) */
  const rs = await db.collection('regionStatus').where('def', '==', true).limit(1).get().catch(() => ({ docs: [] }));
  const def = rs.docs[0] ? rs.docs[0].id : '';
  const live = liveDoc({ now, counts: { n: all, a: day.size }, regions: regs, foundings, state, names, hide, npcName: id => npc.get(id) || '', def });
  const mem = { ts: maxTs, at: now, dec: state.dec, seen: state.seen, ev: state.ev.slice(0, 200) };
  if (!dry) {
    const b = db.batch();
    b.set(db.doc('home/live'), live);
    b.set(stRef, mem);
    await b.commit();
  }
  return { at: new Date(now).toISOString(), read: { nations: nat.size, day: day.size, week: week.size, treaties: tr.docs.length }, counters: live.c,
    regions: Object.keys(regs).length, events: live.ev.length, dry, live: dry ? live : undefined };
}
