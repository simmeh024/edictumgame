// The daily currency job: once per game day (a UTC day), for every region, value each nation's currency
// and rate its prestige, from the region's nation records and the game's computer-run nations.
//
// Documents (see firestore.rules; only this job writes them, with the Admin SDK):
//   fx/<region>    {v, day, t, j}: what players read, once a session. j is JSON text:
//                  {u: the regional unit's name, n: {<nation id>: entry}, ev: [recent milestones]}, one
//                  entry per currency (value in the region's standard unit, strength, prestige and its tier
//                  and rank, 1/7/30-day changes, factor scores, why the value moved, recent milestones).
//   fxs/<region>   {v, day, t, j, lock?}: the job's own state, never read by the game: each currency's
//                  smoothed strength and prestige, running volatility, and 91 days of values (31 of
//                  prestige) for the changes and milestones. lock is a lease against two runs at once.
//   fxh/<nation>   {reg, t, d: {'YYYY-MM-DD': [value, prestige]}}: a currency's whole history, one entry a
//                  day, merged in (no read needed). Charts read one of these per currency shown.
// Per region and day: 2 + (player nations) reads, plus one for each nation new to the region (its history, if
// any), and 2 + (currencies) writes. Exchange rates between pairs are
// never stored: V(A)/V(B) on demand.
//
// Safe to run more than once: a region already done today is skipped (a day is never stepped twice, so the
// smoothing never runs twice), and a run holds a lease on the region (in a transaction) while it works, so two
// runs at once never both write it; a run that dies leaves a lease that lapses after ten minutes. History
// entries are keyed by day, so writing one twice changes nothing.
//
// It speaks only the part of the Firestore API that the Admin SDK and the client SDK share (doc, collection,
// where, get, batch, runTransaction), so the tests run it against the emulator with either.
import { DAY, VERSION, indicators, stepRegion, seedState, tradeOf, warsOf, counterfeitsOf, TIERS } from './engine.mjs';
import { loadWorld } from './world.mjs';

export const DORMANT_DAYS = 260; // a nation unsaved this long (250 days' dormancy and a month's holiday) is left out
export const LEASE_MS = 10 * 60000;
const EVENTS_KEPT = 8, REGION_EVENTS_KEPT = 30, CHUNK = 400;

export const dayNum = t => Math.floor(t / DAY);
export const isoDay = d => new Date(d * DAY).toISOString().slice(0, 10);
const parse = s => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch (e) { return null; } };

/* the records of one region's nations, parsed; anything unreadable is skipped, not fatal */
async function regionRecords(db, reg, now) {
  const qs = await db.collection('nations').where('reg', '==', reg).get();
  const recs = new Map();
  for (const d of qs.docs) {
    const raw = d.data() || {}, rec = parse(raw.j);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const at = Number(raw.updatedAt) || Number(rec.updatedAt) || 0;
    if (now - at > DORMANT_DAYS * DAY) continue;
    /* held to the population its save declared, which the rules bound, as every player's game holds it */
    if (typeof raw.pop === 'number' && isFinite(raw.pop) && !(Number(rec.pop) <= raw.pop)) rec.pop = raw.pop;
    recs.set(d.id, rec);
  }
  return recs;
}

/* moderation: removed nations are left out; hidden ones are valued but marked, so only their owner sees them */
async function moderation(db) {
  const out = new Map();
  try { const qs = await db.collection('mod').get(); for (const d of qs.docs) { const v = d.data() || {}; if (v.hidden || v.removed) out.set(d.id, { hidden: !!v.hidden, removed: !!v.removed }); } } catch (e) { /* none */ }
  return out;
}

/* a currency new to this region's state but with a history (its nation moved here): its state, from that history */
async function seeded(db, ids, day) {
  const out = {};
  await Promise.all(ids.map(async id => {
    try {
      const s = await db.doc('fxh/' + id).get(), h = s.exists && s.data() && s.data().d;
      if (!h || typeof h !== 'object') return;
      const days = Object.keys(h).filter(k => /^\d{4}-\d\d-\d\d$/.test(k) && Array.isArray(h[k])).map(k => [dayNum(Date.parse(k + 'T00:00:00Z')), +h[k][0], +h[k][1]]).filter(d => d[0] < day).sort((a, b) => a[0] - b[0]);
      const st = seedState(id, days); if (st) out[id] = st;
    } catch (e) { /* a new currency */ }
  }));
  return out;
}

/* take the region for this run, or say why not: 'done' (already today), 'busy' (another run holds it) */
async function lease(db, reg, day, now, runId) {
  const ref = db.doc('fxs/' + reg);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref), d = s.exists ? s.data() : null;
    if (d && d.day === isoDay(day)) return { ok: false, why: 'done' };
    if (d && d.lock && d.lock.until > now && d.lock.by !== runId) return { ok: false, why: 'busy' };
    tx.set(ref, Object.assign({}, d || { v: VERSION, day: '', t: 0, j: '{}' }, { lock: { by: runId, until: now + LEASE_MS } }));
    return { ok: true, prev: d ? parse(d.j) || {} : {} };
  });
}

async function commitAll(db, ops) {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const b = db.batch();
    for (const [kind, ref, data, opt] of ops.slice(i, i + CHUNK)) { if (kind === 'del') b.delete(ref); else if (opt) b.set(ref, data, opt); else b.set(ref, data); }
    await b.commit();
  }
}

/* one region: read, value, rank, write. Returns a short report. */
export async function runRegion(db, region, { now, day, world, mod, runId }) {
  const L = await lease(db, region.id, day, now, runId);
  if (!L.ok) return { reg: region.id, skipped: L.why };
  const prev = L.prev || {}, prevState = prev.n || {};
  const recs = await regionRecords(db, region.id, now);
  for (const id of [...recs.keys()]) if (mod.get(id) && mod.get(id).removed) recs.delete(id);
  const npcIds = new Set(region.npcs.map(x => x.id)), trade = tradeOf(recs, npcIds), wars = warsOf(recs, npcIds);
  const forged = counterfeitsOf(new Map([...region.npcs.map(x => [x.id, x]), ...recs]), now, region.id);
  const nations = [];
  for (const x of region.npcs) nations.push({ id: x.id, I: indicators(x.id, x, now, { npc: true, npcPop: world.npcPop, npcEpoch: world.npcEpoch, trade: trade.get(x.id), wars: wars.get(x.id), counterfeit: forged.get(x.id) }) });
  for (const [id, rec] of recs) nations.push({ id, I: indicators(id, rec, now, { trade: trade.get(id), wars: wars.get(id), counterfeit: forged.get(id) }) });
  const prior = Object.assign(await seeded(db, [...recs.keys()].filter(id => !prevState[id]), day), prevState);
  const { state, pub, events } = stepRegion(nations, prior, day);
  /* milestones: kept on each currency (its last few) and for the region (the last thirty) */
  const evs = prev.ev && Array.isArray(prev.ev) ? prev.ev.slice() : [];
  for (const [id, code, arg] of events) {
    const e = [day, code, arg];
    state[id].ev = (state[id].ev || prevState[id] && prevState[id].ev || []).concat([e]).slice(-EVENTS_KEPT);
    evs.push([day, id, code, arg]);
  }
  for (const id of Object.keys(state)) {
    if (!state[id].ev && prevState[id] && prevState[id].ev) state[id].ev = prevState[id].ev;
    if (state[id].ev) pub[id].ev = state[id].ev;
    if (mod.get(id) && mod.get(id).hidden) pub[id].hd = 1;
    if (npcIds.has(id)) pub[id].npc = 1;
  }
  const t = now, iso = isoDay(day), regionEvents = evs.filter(e => recs.has(e[1]) || npcIds.has(e[1])).slice(-REGION_EVENTS_KEPT);
  const ops = [];
  for (const id of Object.keys(state)) ops.push(['set', db.doc('fxh/' + id), { reg: region.id, t, d: { [iso]: [pub[id].v, pub[id].p] } }, { merge: true }]);
  await commitAll(db, ops);
  /* last, and only while the lease is still ours: the public document and the state, marking the day done */
  const gone = Object.keys(prevState).filter(id => !state[id]);
  await db.runTransaction(async tx => {
    const ref = db.doc('fxs/' + region.id), s = await tx.get(ref), d = s.exists ? s.data() : null;
    if (!d || !d.lock || d.lock.by !== runId) throw new Error('lease lost for ' + region.id);
    tx.set(db.doc('fx/' + region.id), { v: VERSION, day: iso, t, j: JSON.stringify({ u: region.name, n: pub, ev: regionEvents }) });
    tx.set(ref, { v: VERSION, day: iso, t, j: JSON.stringify({ n: state, ev: regionEvents }) });
  });
  return { reg: region.id, currencies: Object.keys(state).length, players: recs.size, events: events.length, gone, ids: Object.keys(state) };
}

/* every region of the game (or those named), one after another. Histories of nations that are in no region
   any more (deleted, removed or long dormant) are deleted, but only after a run that covered every region. */
export async function runCurrencyDay(db, opts = {}) {
  const now = opts.now || Date.now(), day = dayNum(now), world = opts.world || loadWorld();
  const runId = opts.runId || (now.toString(36) + Math.random().toString(36).slice(2, 8));
  const only = opts.regions ? new Set(opts.regions) : null, regions = world.regions.filter(r => !only || only.has(r.id));
  const mod = await moderation(db), reports = [];
  for (const region of regions) {
    try { reports.push(await runRegion(db, region, { now, day, world, mod, runId })); }
    catch (e) { reports.push({ reg: region.id, error: String(e && e.message || e) }); }
  }
  if (!only && reports.every(r => !r.error && !r.skipped)) {
    const alive = new Set(reports.flatMap(r => r.ids || [])), gone = [...new Set(reports.flatMap(r => r.gone || []))].filter(id => !alive.has(id));
    if (gone.length) await commitAll(db, gone.map(id => ['del', db.doc('fxh/' + id)]));
    reports.push({ deletedHistories: gone.length });
  }
  for (const r of reports) delete r.ids;
  return { day: isoDay(day), reports };
}

export { TIERS };
