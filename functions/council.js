// The World Assembly Council (WAC; game/edictum.html, the Council page; 2026-11-27). Every region's Delegate of the
// Regional Assembly (assembly-engine.js, asmDelegateAt: the player member with the most endorsements) holds that region's
// seat. The seat belongs to the region: when endorsements make another nation Delegate, the seat passes at once, and so
// does anything the seat holds (its ballot, its votes on motions, the chair).
//
// The Chair of the Council is elected by region. The vote opens at 00:00 UTC on the 1st of every month and closes at 00:00
// UTC on the 6th (WAC_VOTE_DAYS). Each seat casts one ballot for another region with a seat (never its own). The region
// with the most ballots holds the chair until the next close; a tie goes to the region that already holds it, then to the
// region that reached its count first (its last ballot cast earliest), then by id. The chair is whoever is that region's
// Delegate. A region that has no Delegate at all passes the chair down the count (rank) to the next region that has one;
// a month with no ballots leaves the chair where it was. The first vote is WAC_FIRST.
//
// Motions: any seat tables a council resolution (k 'res', a statement to the world, printed in every region's Daily
// Dispatch) or an idea for an edict (k 'edict'). The seat that tables it votes For at once. A motion passes the moment
// more than half of the filled seats, and at least two, vote For; it fails if that has not happened in WAC_MOTION_MS. A
// passed edict idea goes to the admins (admin portal › World Assembly Council), who accept it, decline it or mark it
// built; the Council page shows what became of it.
//
// The agenda: matters a seat puts to the others (councilAgenda/{id}), with replies and reactions. The chair pins up to
// WAC_PINS and closes them; the author may close their own.
//
// What is stored (firestore.rules):
//   council/state       the public record, read by every signed-in game: seats {reg: {id, nm, t, k}}, ch (the chair now),
//                        term and rank (the last vote counted), hist (past counts, ballots published), chairs (the roll),
//                        sh (seat changes), msg (the chair's address), res (passed resolutions), ideas (passed edict ideas)
//   councilVotes/{m}     a month's ballots b {reg: {v, id, nm, t}} and statements st {reg: {x, id, nm, t}}: server only,
//                        secret until the close (then copied into council/state.hist)
//   councilMotions/{id}  {k, ti, x, o, cat, by, bn, reg, t, u, v {reg: {v, id, nm, t}}, st, f, y, n, a, s, ad}
//   councilAgenda/{id}   {ti, x, a, an, ar, t, la, pin, cl, r [{k, a, an, ar, x, t, cl}], rx {uid: kind}}
//   councilSeats/{uid}   {reg, t}: this account holds a seat (the rules let it read the Council chat, rchat/wac)
//   councilPace/{uid}    {p, r, m}: times of its agenda posts, replies and motions
// All are written by the server alone; only council/state is read by the game directly.
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';

export const WAC_OPS = ['wacState', 'wacVote', 'wacStatement', 'wacAddress', 'wacPost', 'wacReply', 'wacPin', 'wacClose', 'wacReact',
  'wacMotion', 'wacMotionVote', 'wacWithdraw'];
export const isCouncilOp = op => WAC_OPS.includes(op);
export const WAC_ADMIN_OPS = ['wacAdmin', 'wacMod', 'wacVoid', 'wacIdea'];

export const DAY = 86400000, HOUR = 3600000;
export const WAC_FIRST = '2026-12', WAC_VOTE_DAYS = 5, WAC_MOTION_MS = 3 * DAY, WAC_NOTE_MS = 10 * 60000, WAC_PINS = 3;
export const WAC_TEXT = { st: 200, msg: 300, agTi: 80, agX: 1000, agR: 600, moTi: 80, moX: 1000, edQ: 700, edT: 240, edFx: 140, note: 300 };
export const WAC_KEEP = { hist: 24, chairs: 36, sh: 60, res: 20, ideas: 30 };
export const WAC_REACT = ['up', 'down', 'think'];
export const WAC_CATS = ['gov', 'rights', 'world', 'econ', 'tech', 'society', 'welfare', 'nature', 'culture', 'weird'];
export const WAC_IDEA = ['accepted', 'declined', 'built'];
/* how often a seat may: put a matter on the agenda (a day), reply (an hour), table a motion (a day) */
export const WAC_PACE = { p: [4, DAY], r: [30, HOUR], m: [3, DAY] };
/* open at once, in all; each seat one of each kind */
export const WAC_OPEN_MAX = 8;

const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* a longer text keeps its paragraphs (at most two line breaks in a row) */
const para = (x, max) => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const refuse = (code, message) => { throw new HttpsError('failed-precondition', message, { code }); };
const pad = n => String(n).padStart(2, '0');

/* ── the calendar: months as 'YYYY-MM' ── */
export const wacMonth = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };
const ym = m => { const [y, mo] = m.split('-').map(Number); return [y, mo - 1]; };
export const wacOpenAt = m => { const [y, mo] = ym(m); return Date.UTC(y, mo, 1); };
export const wacCloseAt = m => { const [y, mo] = ym(m); return Date.UTC(y, mo, 1 + WAC_VOTE_DAYS); };
export const wacNext = m => { const [y, mo] = ym(m); return mo === 11 ? (y + 1) + '-01' : y + '-' + pad(mo + 2); };
/* the vote of `now`: this month's while it has not closed, else next month's; on, while its ballots are taken */
export function wacWindow(now) {
  let m = wacMonth(now);
  if (now >= wacCloseAt(m)) m = wacNext(m);
  if (m < WAC_FIRST) m = WAC_FIRST;
  const open = wacOpenAt(m), close = wacCloseAt(m);
  return { m, open, close, on: now >= open && now < close };
}
/* the months whose vote has closed by `now` and are not counted yet (after `term`), oldest first */
export function wacDue(term, now) {
  const out = [];
  for (let m = term ? wacNext(term) : WAC_FIRST; wacCloseAt(m) <= now && out.length < 24; m = wacNext(m)) out.push(m);
  return out;
}

/* ── the count: ballots {voter region: {v: region voted for, t}} → regions ranked, chair first. A ballot for its own
   region, or for nothing, does not count. Ties: the region already in the chair (inc), then the one whose last ballot came
   first (it reached the count first), then by id ── */
export function wacCount(ballots, inc) {
  const T = new Map();
  for (const [from, b] of Object.entries(ballots || {})) {
    if (!b || typeof b.v !== 'string' || !b.v || b.v === from) continue;
    const x = T.get(b.v) || { reg: b.v, n: 0, at: 0 };
    x.n++; x.at = Math.max(x.at, Number(b.t) || 0); T.set(b.v, x);
  }
  const rows = [...T.values()].sort((a, b) => b.n - a.n || (b.reg === inc) - (a.reg === inc) || a.at - b.at || (a.reg < b.reg ? -1 : 1));
  const rank = rows.map(r => r.reg);
  if (!rank.length && inc) rank.push(inc);
  return { rank, n: Object.fromEntries(rows.map(r => [r.reg, r.n])) };
}
/* the chair: the first region of the count that has a Delegate now */
export function wacChairFrom(rank, seats) {
  for (const reg of rank || []) { const s = seats && seats[reg]; if (s && s.id) return { reg, id: s.id, nm: s.nm || '' }; }
  return null;
}
/* does a motion pass with these votes and this many seats: more than half of the seats, and at least two, For */
export function wacPasses(v, seatCount) {
  const y = Object.values(v || {}).filter(x => x && x.v === 1).length;
  return y >= 2 && y > seatCount / 2;
}
export function wacTally(v) {
  const L = Object.values(v || {});
  return { y: L.filter(x => x && x.v === 1).length, n: L.filter(x => x && x.v === -1).length, a: L.filter(x => x && x.v === 0).length };
}

/* ── the seats. Reading every region's Delegate afresh would read every nation of every region, so nothing here does:
   a region's seat is noted whenever its Delegate is read anyway, when a nation of the region loads its Assembly (civic.js,
   assembly → wacNote; every game asks every ten minutes, and at once after an endorsement) or a seat acts here (its own
   region, read afresh). A region nobody plays in keeps its seat as last noted. wacNote writes only when the seat changed,
   or WAC_NOTE_MS after this instance last noted it (to bring the chair and a closed vote up to date) ── */
const noted = new Map();
export const resetCouncil = () => noted.clear();
export async function wacNote(db, regions, reg, D) {
  if (!regions.has(reg)) return null;
  const id = D && D.id ? D.id : '', was = noted.get(reg), now = Date.now();
  if (was && was.id === id && now - was.t < WAC_NOTE_MS) return null;
  noted.set(reg, { id, t: now });
  try { return await wacRefresh(db, regions, { [reg]: D && D.id ? D : null }); }
  catch (e) { noted.delete(reg); console.warn('council: the seat of', reg, 'was not noted:', e.message); return null; }
}

const stateRef = db => db.doc('council/state');
const blank = () => ({ v: 1, seats: {}, kn: [], at: 0, ch: null, term: '', rank: [], hist: [], chairs: [], sh: [], msg: null, res: [], ideas: [] });
const stateOf = s => Object.assign(blank(), s.exists ? s.data() : {});

/* Bring council/state up to `now`: the seats read just now (live: {region: {id, nm, k} or null}; every other region keeps
   its seat as last noted), every vote closed since the last count, and the chair. Writes only what changed. */
export async function wacRefresh(db, regions, live = {}) {
  const now = Date.now();
  return db.runTransaction(async tx => {
    const s = await tx.get(stateRef(db)), S = stateOf(s), before = JSON.stringify({ ...S, at: 0 }), known = new Set(S.kn || []);
    const due = wacDue(S.term, now), votes = due.length ? await tx.getAll(...due.map(m => db.doc('councilVotes/' + m))) : [];
    const seats = {}, gone = [], came = [];
    for (const reg of regions) {
      const was = S.seats[reg] || null, got = reg in live ? live[reg] : was;
      if (got && got.id) {
        const keep = was && was.id === got.id;
        seats[reg] = { id: got.id, nm: line(got.nm, 80) || (keep ? was.nm : '') || 'A nation', t: keep ? was.t : now, k: Number(got.k) || 0 };
        if (!keep) { came.push([reg, seats[reg]]); if (was) gone.push([reg, was]); }
      } else if (was) gone.push([reg, was]);
    }
    // a region's seat as first noted (at launch, each region once its players load their Assembly) was held before the
    // Council kept a record: nobody "took" it then, so nothing is logged (kn: the regions noted at least once)
    for (const [reg, w] of gone) S.sh.unshift({ t: now, reg, id: seats[reg]?.id || '', nm: seats[reg]?.nm || '', p: w.id, pn: w.nm });
    for (const [reg, x] of came) if (known.has(reg) && !S.sh.some(e => e.t === now && e.reg === reg)) S.sh.unshift({ t: now, reg, id: x.id, nm: x.nm, p: '', pn: '' });
    for (const reg of Object.keys(live)) if (regions.has(reg)) known.add(reg);
    S.kn = [...known].sort();
    S.sh = S.sh.slice(0, WAC_KEEP.sh);
    // an account holds a seat (the Council chat's rule): one record per holder, gone with the seat
    const had = new Set(Object.values(S.seats).map(x => x && x.id).filter(Boolean)), has = new Set(Object.values(seats).map(x => x.id));
    for (const id of had) if (!has.has(id)) tx.delete(db.doc('councilSeats/' + id));
    for (const [reg, x] of Object.entries(seats)) if (!S.seats[reg] || S.seats[reg].id !== x.id) tx.set(db.doc('councilSeats/' + x.id), { reg, t: x.t });
    S.seats = seats;
    // the votes closed since: counted in order, each one's ballots published
    due.forEach((m, i) => {
      const V = votes[i].exists ? votes[i].data() : {}, b = V.b && typeof V.b === 'object' ? V.b : {}, inc = S.ch ? S.ch.reg : (S.rank[0] || '');
      const { rank, n } = wacCount(b, inc), at = wacCloseAt(m), ch = wacChairFrom(rank, seats);
      S.term = m; S.rank = rank;
      S.hist.unshift({ m, t: at, rank: rank.slice(0, 27), n, b: Object.fromEntries(Object.entries(b).filter(([, x]) => x && x.v).map(([r, x]) => [r, x.v])), c: Object.keys(b).length });
      S.chairs.unshift({ m, reg: ch ? ch.reg : '', h: ch ? [{ id: ch.id, nm: ch.nm, reg: ch.reg, t: at }] : [] });
      S.ch = ch ? { ...ch, t: at } : null;
    });
    S.hist = S.hist.slice(0, WAC_KEEP.hist); S.chairs = S.chairs.slice(0, WAC_KEEP.chairs);
    // the chair as the seats stand now: a new Delegate of the chair's region takes it at once
    const ch = S.term ? wacChairFrom(S.rank, seats) : null;
    if ((ch && ch.id) !== (S.ch && S.ch.id) || (ch && ch.reg) !== (S.ch && S.ch.reg)) {
      S.ch = ch ? { ...ch, t: now } : null;
      if (ch && S.chairs[0]) S.chairs[0].h = (S.chairs[0].h || []).concat({ id: ch.id, nm: ch.nm, reg: ch.reg, t: now }).slice(-12);
    }
    if (S.ch && seats[S.ch.reg]) S.ch.nm = seats[S.ch.reg].nm;
    // at: when the record last changed; nothing is written when nothing did
    if (JSON.stringify({ ...S, at: 0 }) !== before) { S.at = now; tx.set(stateRef(db), S); }
    return S;
  });
}

/* ── who is asking: a sitting Delegate (their region's seat, asked of the engine afresh), or staff to read ── */
async function seatOf(db, who, eligibility, delegateOf) {
  const e = await db.runTransaction(tx => eligibility(tx, who, { linked: true }), { readOnly: true });
  const reg = e.n.reg || e.saved.get('reg') || '', D = reg ? await delegateOf(reg) : null;
  if (!D || D.id !== who.uid) refuse('wac_seat', 'Only a sitting Delegate has a seat at the World Assembly Council.');
  return { reg, nm: line(D.nm, 80) || line(e.saved.get('name'), 80) || 'A nation', e, live: { [reg]: D } };
}
/* the seats as they stand, with the caller's own region read afresh */
const fresh = (db, ctx, me) => wacRefresh(db, ctx.regions, me ? me.live : {});
function pace(P, k, now) {
  const [max, span] = WAC_PACE[k], L = (Array.isArray(P[k]) ? P[k] : []).filter(t => now - t < span);
  if (L.length >= max) refuse('wac_paced', k === 'p' ? `A seat can put ${max} matters on the agenda a day.` : k === 'r' ? `A seat can reply ${max} times an hour.` : `A seat can table ${max} motions a day.`);
  return L.concat(now);
}

/* a motion as the page shows it */
const motionOut = (id, x) => ({ id, k: x.k, ti: x.ti, x: x.x || '', o: x.o || [], cat: x.cat || '', by: x.by, bn: x.bn, reg: x.reg, t: x.t, u: x.u, v: x.v || {}, st: x.st,
  ...(x.f ? { f: x.f } : {}), ...(x.ad ? { ad: x.ad } : {}), ...(x.cl ? { cl: 1 } : {}) });
const agendaOut = (id, x) => ({ id, ti: x.ti, x: x.x || '', a: x.a, an: x.an, ar: x.ar, t: x.t, la: x.la, pin: x.pin ? 1 : 0, cl: x.cl ? 1 : 0, r: x.r || [], rx: x.rx || {}, ...(x.mo ? { mo: 1 } : {}) });

/* open motions past their time fail (the passed ones were settled when the deciding vote came in) */
async function motionsDue(db, now) {
  const open = await db.collection('councilMotions').where('st', '==', 'open').get();
  const late = open.docs.filter(s => (Number(s.get('u')) || 0) <= now);
  if (late.length) { const b = db.batch(); for (const s of late) { const T = wacTally(s.get('v')); b.update(s.ref, { st: 'failed', f: Number(s.get('u')) || now, ...T }); } await b.commit(); }
  return open.docs.filter(s => !late.includes(s));
}

/* everything the Council page shows */
async function wacState(db, who, ctx) {
  const now = Date.now();
  /* staff read the page without a seat; a member of staff who is also a Delegate sits like any other */
  let mine = null;
  try { mine = await seatOf(db, who, ctx.eligibility, ctx.delegateOf); } catch (e) { if (!(who.admin || who.mod)) throw e; }
  const S = await fresh(db, ctx, mine), W = wacWindow(now), open = await motionsDue(db, now);
  const [vs, done, agenda, flags] = await Promise.all([db.doc('councilVotes/' + W.m).get(),
    db.collection('councilMotions').orderBy('t', 'desc').limit(40).get(), db.collection('councilAgenda').orderBy('la', 'desc').limit(40).get(),
    ctx.flagsOf ? ctx.flagsOf(Object.values(S.seats).map(x => x.id)).catch(() => ({})) : {}]);
  const V = vs.exists ? vs.data() : {}, b = V.b || {}, st = V.st || {}, reg = mine ? mine.reg : '';
  return { now, win: W, first: WAC_FIRST, me: { reg, seat: !!mine, chair: !!(mine && S.ch && S.ch.reg === reg), staff: !mine },
    seats: Object.entries(S.seats).map(([r, x]) => ({ reg: r, ...x, fl: flags[x.id] || null })), ch: S.ch, term: S.term, rank: S.rank,
    vote: { m: W.m, on: W.on, mine: reg && b[reg] && b[reg].v ? { v: b[reg].v, t: b[reg].t, nm: b[reg].nm } : null,
      cast: Object.values(b).filter(x => x && x.v).length, who: Object.entries(b).filter(([, x]) => x && x.v).map(([r]) => r), st: Object.fromEntries(Object.entries(st).filter(([, x]) => x && x.x).map(([r, x]) => [r, { x: x.x, nm: x.nm, t: x.t }])) },
    msg: S.msg, hist: S.hist.slice(0, 12), chairs: S.chairs, sh: S.sh.slice(0, 40), res: S.res, ideas: S.ideas,
    motions: done.docs.map(s => motionOut(s.id, s.data())).concat(open.filter(s => !done.docs.some(d => d.id === s.id)).map(s => motionOut(s.id, s.data()))),
    agenda: agenda.docs.map(s => agendaOut(s.id, s.data())) };
}

/* a ballot: during the vote, for another region with a seat now; v '' takes it back */
async function wacVote(db, who, d, ctx) {
  const now = Date.now(), W = wacWindow(now);
  if (!W.on) refuse('wac_closed', `The vote for the chair opens at 00:00 UTC on the 1st of each month and runs for ${WAC_VOTE_DAYS} days.`);
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), S = await fresh(db, ctx, me);
  const v = typeof d.v === 'string' ? d.v : '';
  if (v && !ctx.regions.has(v)) throw new HttpsError('invalid-argument', 'Choose a region.');
  if (v === me.reg) refuse('wac_self', 'A seat cannot vote for its own region.');
  if (v && !(S.seats[v] && S.seats[v].id)) refuse('wac_empty', 'That region has no Delegate, so it has no seat to vote for.');
  const ref = db.doc('councilVotes/' + W.m);
  await ref.set({ m: W.m, b: { [me.reg]: v ? { v, id: who.uid, nm: me.nm, t: now } : FieldValue.delete() } }, { merge: true });
  return { ok: true, m: W.m, v };
}
/* the seat's line on the ballot, for the vote now open or the next one */
async function wacStatement(db, who, d, ctx) {
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), W = wacWindow(Date.now()), x = line(d.x, WAC_TEXT.st);
  await db.doc('councilVotes/' + W.m).set({ m: W.m, st: { [me.reg]: x ? { x, id: who.uid, nm: me.nm, t: Date.now() } : FieldValue.delete() } }, { merge: true });
  return { ok: true, m: W.m, x };
}
/* the chair's address: once an hour; empty takes it down */
async function wacAddress(db, who, d, ctx) {
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), x = line(d.x, WAC_TEXT.msg), now = Date.now();
  await fresh(db, ctx, me);
  return db.runTransaction(async tx => {
    const S = stateOf(await tx.get(stateRef(db)));
    if (!S.ch || S.ch.reg !== me.reg || S.ch.id !== who.uid) refuse('wac_chair', 'Only the Chair of the Council can do that.');
    if (S.msg && S.msg.id === who.uid && now - S.msg.t < HOUR && x) refuse('wac_msg_wait', 'The chair can change the address once an hour.');
    tx.update(stateRef(db), { msg: x ? { x, id: who.uid, nm: me.nm, reg: me.reg, t: now } : null });
    return { ok: true, x };
  });
}

/* the agenda */
async function wacPost(db, who, d, ctx) {
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), ti = line(d.ti, WAC_TEXT.agTi), x = para(d.x, WAC_TEXT.agX), now = Date.now();
  if (ti.length < 4) throw new HttpsError('invalid-argument', 'Give the matter a title of at least 4 characters.');
  if (!x) throw new HttpsError('invalid-argument', 'Say what the matter is.');
  return db.runTransaction(async tx => {
    const pr = db.doc('councilPace/' + who.uid), P = (await tx.get(pr)).data() || {}, p = pace(P, 'p', now), ref = db.collection('councilAgenda').doc();
    tx.set(pr, { p }, { merge: true });
    tx.create(ref, { ti, x, a: who.uid, an: me.nm, ar: me.reg, t: now, la: now, pin: 0, cl: 0, r: [], rx: {} });
    return { ok: true, id: ref.id };
  });
}
async function wacReply(db, who, d, ctx) {
  const id = id20(d.id), x = para(d.x, WAC_TEXT.agR), now = Date.now();
  if (!id || !x) throw new HttpsError('invalid-argument', 'Write a reply first.');
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf);
  return db.runTransaction(async tx => {
    const ref = db.doc('councilAgenda/' + id), pr = db.doc('councilPace/' + who.uid), [s, ps] = await tx.getAll(ref, pr);
    if (!s.exists) refuse('wac_gone', 'That matter is no longer on the agenda.');
    if (s.get('cl')) refuse('wac_shut', 'That matter is closed.');
    const r = s.get('r') || [];
    if (r.length >= 60) refuse('wac_full', 'That matter has all the replies it can hold. Put a new one on the agenda.');
    const P = ps.data() || {}, rp = pace(P, 'r', now), k = Math.random().toString(36).slice(2, 10);
    tx.set(pr, { r: rp }, { merge: true });
    tx.update(ref, { r: r.concat({ k, a: who.uid, an: me.nm, ar: me.reg, x, t: now }), la: now });
    return { ok: true, k };
  });
}
async function wacPin(db, who, d, ctx) {
  const id = id20(d.id), on = d.on !== false;
  if (!id) throw new HttpsError('invalid-argument', 'Choose a matter.');
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf);
  await fresh(db, ctx, me);
  return db.runTransaction(async tx => {
    const S = stateOf(await tx.get(stateRef(db)));
    if (!S.ch || S.ch.reg !== me.reg) refuse('wac_chair', 'Only the Chair of the Council can pin a matter.');
    const ref = db.doc('councilAgenda/' + id), s = await tx.get(ref);
    if (!s.exists) refuse('wac_gone', 'That matter is no longer on the agenda.');
    if (on && !s.get('pin')) { const pinned = await tx.get(db.collection('councilAgenda').where('pin', '==', 1)); if (pinned.size >= WAC_PINS) refuse('wac_pins', `The chair can pin ${WAC_PINS} matters at once. Unpin one first.`); }
    tx.update(ref, { pin: on ? 1 : 0 });
    return { ok: true, on };
  });
}
async function wacClose(db, who, d, ctx) {
  const id = id20(d.id), on = d.on !== false;
  if (!id) throw new HttpsError('invalid-argument', 'Choose a matter.');
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf);
  await fresh(db, ctx, me);
  return db.runTransaction(async tx => {
    const S = stateOf(await tx.get(stateRef(db))), ref = db.doc('councilAgenda/' + id), s = await tx.get(ref), chair = !!(S.ch && S.ch.reg === me.reg);
    if (!s.exists) refuse('wac_gone', 'That matter is no longer on the agenda.');
    if (!chair && !(on && s.get('a') === who.uid)) refuse('wac_chair', on ? 'Only the chair or the seat that raised it can close a matter.' : 'Only the chair can open a closed matter again.');
    tx.update(ref, { cl: on ? 1 : 0, ...(on ? { pin: 0 } : {}), la: Date.now() });
    return { ok: true, on };
  });
}
async function wacReact(db, who, d, ctx) {
  const id = id20(d.id), k = WAC_REACT.includes(d.k) ? d.k : '';
  if (!id || !k) throw new HttpsError('invalid-argument', 'Choose a matter and a reaction.');
  await seatOf(db, who, ctx.eligibility, ctx.delegateOf);
  return db.runTransaction(async tx => {
    const ref = db.doc('councilAgenda/' + id), s = await tx.get(ref);
    if (!s.exists) refuse('wac_gone', 'That matter is no longer on the agenda.');
    const rx = { ...(s.get('rx') || {}) }, had = rx[who.uid] || '';
    if (had === k) delete rx[who.uid]; else rx[who.uid] = k;
    tx.update(ref, { rx });
    return { ok: true, k: had === k ? '' : k };
  });
}

/* motions: a council resolution or an edict idea */
function motionIn(d) {
  const k = d.k === 'edict' ? 'edict' : d.k === 'res' ? 'res' : '';
  if (!k) throw new HttpsError('invalid-argument', 'Choose a resolution or an edict idea.');
  const ti = line(d.ti, WAC_TEXT.moTi);
  if (ti.length < 6) throw new HttpsError('invalid-argument', 'Give it a title of at least 6 characters.');
  if (k === 'res') {
    const x = para(d.x, WAC_TEXT.moX);
    if (x.length < 20) throw new HttpsError('invalid-argument', 'Write the resolution: at least 20 characters.');
    return { k, ti, x };
  }
  const x = para(d.x, WAC_TEXT.edQ), cat = WAC_CATS.includes(d.cat) ? d.cat : '';
  if (x.length < 40) throw new HttpsError('invalid-argument', 'Describe the situation the edict puts to a nation: at least 40 characters.');
  if (!cat) throw new HttpsError('invalid-argument', 'Choose what the edict is about.');
  const o = (Array.isArray(d.o) ? d.o : []).slice(0, 4).map(c => ({ t: para(c && c.t, WAC_TEXT.edT), fx: line(c && c.fx, WAC_TEXT.edFx) })).filter(c => c.t);
  if (o.length < 2) throw new HttpsError('invalid-argument', 'Give the edict two to four options.');
  if (o.some(c => c.t.length < 10)) throw new HttpsError('invalid-argument', 'Each option needs at least 10 characters.');
  return { k, ti, x, cat, o };
}
/* a vote that brings a motion to a majority passes it at once (in the same transaction): a resolution joins the public
   record, an edict idea goes to the admins */
function motionPass(tx, db, S, ref, M, seatCount, now) {
  const T = wacTally(M.v);
  M.st = 'passed'; M.f = now; Object.assign(M, T, { s: seatCount });
  if (M.k === 'edict') M.ad = { st: 'waiting', t: now };
  const pub = { id: ref.id, ti: M.ti, by: M.by, bn: M.bn, reg: M.reg, t: now, y: T.y, n: T.n };
  if (M.k === 'res') S.res = [{ ...pub, x: M.x }].concat((S.res || []).filter(r => r.id !== ref.id)).slice(0, WAC_KEEP.res);
  else S.ideas = [{ ...pub, st: 'waiting' }].concat((S.ideas || []).filter(r => r.id !== ref.id)).slice(0, WAC_KEEP.ideas);
  tx.set(stateRef(db), S);
}
async function wacMotion(db, who, d, ctx) {
  const M0 = motionIn(d), now = Date.now();
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), S0 = await fresh(db, ctx, me), seatCount = Object.keys(S0.seats).length;
  return db.runTransaction(async tx => {
    const pr = db.doc('councilPace/' + who.uid), [ps, st] = await tx.getAll(pr, stateRef(db)), open = await tx.get(db.collection('councilMotions').where('st', '==', 'open'));
    const live = open.docs.filter(s => (Number(s.get('u')) || 0) > now);
    if (live.length >= WAC_OPEN_MAX) refuse('wac_busy', `${WAC_OPEN_MAX} motions are open already. Wait for one to be decided.`);
    if (live.some(s => s.get('reg') === me.reg && s.get('k') === M0.k)) refuse('wac_one', M0.k === 'edict' ? 'Your seat has an edict idea open already.' : 'Your seat has a resolution open already.');
    const m = pace(ps.data() || {}, 'm', now), ref = db.collection('councilMotions').doc();
    const M = { ...M0, by: who.uid, bn: me.nm, reg: me.reg, t: now, u: now + WAC_MOTION_MS, v: { [me.reg]: { v: 1, id: who.uid, nm: me.nm, t: now } }, st: 'open' };
    tx.set(pr, { m }, { merge: true });
    if (wacPasses(M.v, seatCount)) motionPass(tx, db, stateOf(st), ref, M, seatCount, now);
    tx.create(ref, M);
    return { ok: true, id: ref.id, st: M.st };
  });
}
async function wacMotionVote(db, who, d, ctx) {
  const id = id20(d.id), v = [1, -1, 0].includes(d.v) ? d.v : null, now = Date.now();
  if (!id || v === null) throw new HttpsError('invalid-argument', 'Choose a motion and For, Against or Abstain.');
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf), S0 = await fresh(db, ctx, me), seatCount = Object.keys(S0.seats).length;
  return db.runTransaction(async tx => {
    const ref = db.doc('councilMotions/' + id), [s, st] = await tx.getAll(ref, stateRef(db));
    if (!s.exists) refuse('wac_gone', 'That motion is no longer before the Council.');
    const M = s.data();
    if (M.st !== 'open' || M.u <= now) refuse('wac_decided', 'That motion has been decided.');
    M.v = { ...(M.v || {}), [me.reg]: { v, id: who.uid, nm: me.nm, t: now } };
    if (wacPasses(M.v, seatCount)) motionPass(tx, db, stateOf(st), ref, M, seatCount, now);
    tx.set(ref, M);
    return { ok: true, st: M.st };
  });
}
async function wacWithdraw(db, who, d, ctx) {
  const id = id20(d.id);
  if (!id) throw new HttpsError('invalid-argument', 'Choose a motion.');
  const me = await seatOf(db, who, ctx.eligibility, ctx.delegateOf);
  return db.runTransaction(async tx => {
    const ref = db.doc('councilMotions/' + id), s = await tx.get(ref);
    if (!s.exists || s.get('st') !== 'open') refuse('wac_decided', 'That motion has been decided.');
    if (s.get('reg') !== me.reg) refuse('wac_not_yours', 'Only the seat that tabled a motion can withdraw it.');
    tx.update(ref, { st: 'withdrawn', f: Date.now(), ...wacTally(s.get('v')) });
    return { ok: true };
  });
}

/* ctx: {regions (Set), delegateOf(reg) → {id, nm, k} | null (the region's Delegate now), eligibility, flagsOf(ids) → {id: flag}} */
export function council(db, who, d, ctx) {
  switch (d.op) {
    case 'wacState': return wacState(db, who, ctx);
    case 'wacVote': return wacVote(db, who, d, ctx);
    case 'wacStatement': return wacStatement(db, who, d, ctx);
    case 'wacAddress': return wacAddress(db, who, d, ctx);
    case 'wacPost': return wacPost(db, who, d, ctx);
    case 'wacReply': return wacReply(db, who, d, ctx);
    case 'wacPin': return wacPin(db, who, d, ctx);
    case 'wacClose': return wacClose(db, who, d, ctx);
    case 'wacReact': return wacReact(db, who, d, ctx);
    case 'wacMotion': return wacMotion(db, who, d, ctx);
    case 'wacMotionVote': return wacMotionVote(db, who, d, ctx);
    case 'wacWithdraw': return wacWithdraw(db, who, d, ctx);
  }
  throw new HttpsError('invalid-argument', 'Unknown request.');
}

/* ── the admin portal (functions/admin.js): staff read everything, the ballots of the vote now open too; moderators
   clear words (a statement, the chair's address, a matter or a reply, a motion's text); an admin voids a ballot and
   decides what becomes of an edict idea the Council passed. Each is in the admin audit log. ── */
const audit = (db, actor, action, target, extra) => db.collection('adminAudit').doc().set({ actor, action, target, ...extra, outcome: 'completed', at: FieldValue.serverTimestamp() });
export async function councilAdmin(db, actor, d, role) {
  const admin = role === 'admin', now = Date.now();
  if (d.op === 'wacAdmin') {
    const W = wacWindow(now), [s, vs, mo, ag] = await Promise.all([stateRef(db).get(), db.doc('councilVotes/' + W.m).get(),
      db.collection('councilMotions').orderBy('t', 'desc').limit(80).get(), db.collection('councilAgenda').orderBy('la', 'desc').limit(60).get()]);
    const S = stateOf(s), V = vs.exists ? vs.data() : {};
    return { now, win: W, first: WAC_FIRST, state: S, ballots: V.b || {}, statements: V.st || {}, motions: mo.docs.map(x => motionOut(x.id, x.data())), agenda: ag.docs.map(x => agendaOut(x.id, x.data())) };
  }
  if (d.op === 'wacMod') {
    const what = ['statement', 'address', 'post', 'reply', 'motion'].includes(d.what) ? d.what : '', why = line(d.why, 200);
    if (!what) throw new HttpsError('invalid-argument', 'Choose what to clear.');
    const mark = { by: actor, t: now, ...(why ? { why } : {}) };
    if (what === 'statement') {
      const m = typeof d.m === 'string' && /^\d{4}-\d{2}$/.test(d.m) ? d.m : '', reg = line(d.reg, 40);
      if (!m || !reg) throw new HttpsError('invalid-argument', 'Choose a statement.');
      await db.doc('councilVotes/' + m).set({ st: { [reg]: FieldValue.delete() } }, { merge: true });
      await audit(db, actor, 'wac_statement_clear', reg, { m, ...(why ? { why } : {}) });
    } else if (what === 'address') {
      await stateRef(db).set({ msg: null }, { merge: true });
      await audit(db, actor, 'wac_address_clear', 'council', why ? { why } : {});
    } else {
      const id = id20(d.id), col = what === 'motion' ? 'councilMotions' : 'councilAgenda';
      if (!id) throw new HttpsError('invalid-argument', 'Choose what to clear.');
      await db.runTransaction(async tx => {
        const ref = db.doc(col + '/' + id), s = await tx.get(ref);
        if (!s.exists) throw new HttpsError('not-found', 'It is no longer there.');
        if (what === 'reply') {
          const k = line(d.k, 12), r = (s.get('r') || []).map(x => x.k === k ? { ...x, x: '', cl: mark } : x);
          tx.update(ref, { r });
        } else if (what === 'post') tx.update(ref, { x: '', ti: 'Removed by a moderator', mo: 1, cl: 1, pin: 0, clm: mark });
        else {
          tx.update(ref, { x: '', o: [], cl: mark, ...(s.get('st') === 'open' ? { st: 'withdrawn', f: now, ...wacTally(s.get('v')) } : {}) });
          const S = stateOf(await tx.get(stateRef(db)));
          const res = (S.res || []).filter(r => r.id !== id), ideas = (S.ideas || []).filter(r => r.id !== id);
          if (res.length !== (S.res || []).length || ideas.length !== (S.ideas || []).length) tx.update(stateRef(db), { res, ideas });
        }
      });
      await audit(db, actor, 'wac_' + what + '_clear', id, why ? { why } : {});
    }
    return { ok: true };
  }
  if (!admin) throw new HttpsError('permission-denied', 'Only Edictum admins can do that.');
  if (d.op === 'wacVoid') {
    const W = wacWindow(now), reg = line(d.reg, 40);
    if (!W.on) refuse('wac_closed', 'Only a ballot in the vote now open can be voided.');
    if (!reg) throw new HttpsError('invalid-argument', 'Choose a ballot.');
    await db.doc('councilVotes/' + W.m).set({ b: { [reg]: FieldValue.delete() } }, { merge: true });
    await audit(db, actor, 'wac_ballot_void', reg, { m: W.m, ...(line(d.why, 200) ? { why: line(d.why, 200) } : {}) });
    return { ok: true };
  }
  if (d.op === 'wacIdea') {
    const id = id20(d.id), st = WAC_IDEA.includes(d.st) ? d.st : '', note = line(d.note, WAC_TEXT.note);
    if (!id || !st) throw new HttpsError('invalid-argument', 'Choose an idea and what becomes of it.');
    await db.runTransaction(async tx => {
      const ref = db.doc('councilMotions/' + id), [s, ss] = await tx.getAll(ref, stateRef(db));
      if (!s.exists || s.get('k') !== 'edict' || s.get('st') !== 'passed') refuse('wac_not_idea', 'Only an edict idea the Council passed can be decided.');
      const ad = { st, t: now, by: actor, ...(note ? { note } : {}) }, S = stateOf(ss);
      tx.update(ref, { ad });
      const ideas = (S.ideas || []).map(r => { if (r.id !== id) return r; const o = { ...r, st, tt: now }; if (note) o.note = note; else delete o.note; return o; });
      tx.update(stateRef(db), { ideas });
    });
    await audit(db, actor, 'wac_idea_' + st, id, note ? { note } : {});
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown console request.');
}

/* an account deleted (functions/index.js): its seat record goes, and its words on the agenda lose its name */
export async function wacForget(db, uid) {
  await db.doc('councilSeats/' + uid).delete().catch(() => {});
  await db.doc('councilPace/' + uid).delete().catch(() => {});
  const posts = await db.collection('councilAgenda').where('a', '==', uid).get().catch(() => ({ docs: [] }));
  for (const s of posts.docs) await s.ref.update({ a: '', an: 'A former nation' }).catch(() => {});
}
