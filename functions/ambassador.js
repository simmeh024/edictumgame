// The Ambassador's Desk (game/edictum.html, the amb-* views): what an Edictum Ambassador (claim amb, appointed in
// functions/admin.js setAmb) does when they are not silencing somebody. The role's one power stays where it was, in
// functions/regionchat.js (rcMute), and nothing in this file takes anything away from a player: an ambassador here
// greets, answers, praises, tallies and hands things to the moderators. Deleting a line, hiding a nation, lifting a
// silence and reading the account behind a nation remain a moderator's.
//
// The ops, all through the civic callable, all refused to anyone without the claim:
//   ambDesk     the round: the newly founded of a region, how quiet every chat is, the board topics nobody has
//               answered, the silences running, and what is left of the week's commendations
//   ambGreet    mark a newly founded nation greeted (ambGreet/{uid}), so two ambassadors never write to it twice.
//               The welcome itself is an ordinary letter the ambassador's own game sends.
//   ambPass     hand something up (ambNotes/{id}): it waits for the moderators ahead of the ordinary reports
//   ambCommend  name a nation worth praising: AMB_CRED a week, a line in its region's chat and commended/{uid},
//               which every game reads for the mark on the nation card, for AMB_CRED_KEEP
//   ambAsk      tally a question players keep asking (ambAsks/{key}), for the developers to read
//   ambLedger   every silence this ambassador has set, and every note they have passed up
//
// What is stored, and who reads it (firestore.rules):
//   ambGreet/{uid}   {by, nm, t, reg, wrote}: an ambassador has greeted this newly founded nation
//   ambNotes/{id}    {by, nm, kind, x, target, name, reg, line, t, state}: passed to the moderators
//   ambAsks/{key}    {x, n, t, la, b}: a question and how often ambassadors have heard it
//   ambCred/{uid}    {w, n, t}: how many commendations this ambassador has given this week
//   commended/{uid}  {t, until, x, why, by, nm, reg}: the only one every game reads, for the mark on the card
// The server writes all five; only commended/ is readable by players.
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { regionOnline } from './presence.js';
import { RC_TEXT, RC_KEEP } from './regionchat.js';

export const AMB_OPS = ['ambDesk', 'ambGreet', 'ambPass', 'ambCommend', 'ambAsk', 'ambLedger'];
export const isAmbOp = op => AMB_OPS.includes(op);

export const DAY = 86400000;
/* a nation is newly founded for this long, a chat counts as quiet after this long with no line */
export const AMB_NEW = 3 * DAY, AMB_QUIET = 6 * 3600000;
/* an unanswered topic stops being worth an ambassador's time after this long */
export const AMB_TOPIC_AGE = 14 * DAY;
/* commendations: how many a week, and how long the mark stays on the nation's card */
export const AMB_CRED = 3, AMB_CRED_KEEP = 30 * DAY;
export const AMB_PASS_TEXT = 600, AMB_ASK_TEXT = 140, AMB_CRED_TEXT = 200;
/* what an ambassador may hand up, and the words the moderators' queue shows */
export const AMB_PASS_KINDS = { threat: 'Somebody is being threatened or harassed', scam: 'Looks like a scam or an advert',
  trouble: 'A player may be in real trouble', broken: 'Something is broken for this nation', silence: 'An ambassador thinks they got a silence wrong' };
/* what a commendation may be for */
export const AMB_CRED_WHY = { newcomer: 'Helped a new nation find its feet', answers: 'Answered questions on the board',
  civil: 'Kept a hard conversation civil', made: 'Made something the region enjoyed', own: 'In an ambassador’s own words' };

const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const uidOf = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-') ? v : '';
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const num = v => Number(v) || 0;
/* the same question however it was worded, so one tally counts it once: its long words, lower case, each once, in
   order. Word order, punctuation, capitals, the little words and saying a word twice all mean nothing. */
export const askKey = x => [...new Set(line(x, AMB_ASK_TEXT).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .split(' ').filter(w => w.length > 2))].sort().join('-').slice(0, 120);
/* the week a commendation falls in, counted from a Monday, so the allowance comes back on one */
export const weekOf = now => { const day = (new Date(now).getUTCDay() + 6) % 7; return Math.floor((now - day * DAY) / (7 * DAY)); };
const ambOnly = who => { if (who.amb !== true) throw new HttpsError('permission-denied', 'Only Edictum ambassadors have a desk.'); };
/* a source that fails (an index still building after a deploy) leaves its part of the round out, never the whole desk */
const safe = (p, fallback) => p.catch(e => { console.warn('ambassador: a part of the desk failed:', e.message); return fallback; });

/* the ambassador's own nation, for the name that signs what they do */
async function meOf(db, uid) {
  const s = await db.doc('summaries/' + uid).get();
  return { name: s.exists ? line(s.get('name'), 80) : 'An ambassador', reg: s.exists ? line(s.get('reg'), 40) : '' };
}

/* ── the round ── */

/* the nations of one region founded in the last AMB_NEW, the newest first: their public summary (summaries/<uid>.f is
   the founding time every game can already read), whether one of them has written in the chat since, and whether an
   ambassador has greeted them. Nothing private is read: this is what a visitor to the nation's page sees. */
async function deskNewly(db, reg, now, spoke) {
  const qs = await db.collection('summaries').where('reg', '==', reg).where('f', '>', now - AMB_NEW)
    .orderBy('f', 'desc').limit(60).select('name', 'pop', 't', 'f').get();
  if (!qs.size) return [];
  const greets = await db.getAll(...qs.docs.map(s => db.doc('ambGreet/' + s.id)));
  const by = new Map(greets.map(g => [g.id, g.exists ? g.data() : null]));
  return qs.docs.map(s => {
    const g = by.get(s.id);
    return { uid: s.id, name: line(s.get('name'), 80), pop: num(s.get('pop')), f: num(s.get('f')), t: num(s.get('t')),
      spoke: spoke.has(s.id), ...(g ? { greeted: { by: String(g.by || ''), nm: line(g.nm, 80), t: num(g.t), wrote: g.wrote === true } } : {}) };
  });
}

/* how alive each chat is: its last line, how many lines it took in a day, and how many nations of the region are
   online to read them. A room with nations in it and nothing being said is the one an ambassador should walk into. */
async function deskRooms(db, regions, now) {
  const rows = await Promise.all([...regions].map(async reg => {
    const chat = db.collection('rchat/' + reg + '/chat');
    const [last, day, online] = await Promise.all([
      safe(chat.orderBy('t', 'desc').limit(1).select('t').get(), { docs: [] }),
      safe(chat.where('t', '>', now - DAY).count().get(), null),
      safe(regionOnline(db, reg, now), { u: [] })]);
    return { reg, last: last.docs.length ? num(last.docs[0].get('t')) : 0,
      lines: day ? num(day.data().count) : -1, online: (online.u || []).length };
  }));
  /* The deadest first, which means the fewest lines for the most readers: a room with fourteen nations in it and
     three lines all day is where an ambassador is worth the most. A room nobody is in comes last, however silent
     it is, because there is nobody there to talk to; so does one whose lines could not be counted. */
  const dead = r => r.online > 0 ? (r.lines < 0 ? 1e6 : r.lines) / r.online : 1e9;
  return rows.sort((a, b) => dead(a) - dead(b) || b.online - a.online).slice(0, 12);
}

/* the board topics nobody has answered (rc, the reply count board.js keeps on the topic), the longest waiting first */
async function deskTopics(db, regions, now) {
  const lists = await Promise.all([...regions].map(reg => safe(
    db.collection('cb/' + reg + '/posts').where('rc', '==', 0).orderBy('t', 'desc').limit(10).select('ti', 'nm', 't', 'tg').get()
      .then(qs => qs.docs.map(s => ({ id: s.id, reg, ti: line(s.get('ti'), 120), nm: line(s.get('nm'), 80), t: num(s.get('t')), tg: line(s.get('tg'), 20) }))), [])));
  return lists.flat().filter(r => r.ti && r.t > now - AMB_TOPIC_AGE).sort((a, b) => a.t - b.t).slice(0, 12);
}

/* the silences running in the ambassador's region: their own, and the other ambassadors', so two of them never act on
   the same nation. A silence staff set is left out: moderation is not an ambassador's to read. */
async function deskSilences(db, who, reg, now) {
  const qs = await safe(db.collection('rcMute').where('reg', '==', reg).where('until', '>', now).limit(30).get(), { docs: [] });
  return qs.docs.filter(s => s.get('amb') === true).map(s => ({
    uid: s.id, nm: line(s.get('nm'), 80), why: line(s.get('why'), 200), until: num(s.get('until')),
    t: num(s.get('t')), mine: s.get('by') === who.uid, perm: s.get('perm') === true })).sort((a, b) => a.until - b.until);
}

/* how many commendations are left this week */
async function credLeft(db, uid, now) {
  const s = await db.doc('ambCred/' + uid).get(), w = weekOf(now);
  const used = s.exists && num(s.get('w')) === w ? num(s.get('n')) : 0;
  return { left: Math.max(0, AMB_CRED - used), of: AMB_CRED, week: w };
}

/* the questions ambassadors keep hearing, the most heard first */
async function deskAsks(db) {
  const qs = await safe(db.collection('ambAsks').orderBy('n', 'desc').limit(8).get(), { docs: [] });
  return qs.docs.map(s => ({ key: s.id, x: line(s.get('x'), AMB_ASK_TEXT), n: num(s.get('n')), la: num(s.get('la')) }));
}

/* the whole round in one read, kept a minute per instance so a desk left open costs nothing to watch */
const desks = new Map();
export const resetDesk = () => desks.clear();
async function ambDesk(db, who, d, regions) {
  ambOnly(who);
  const now = Date.now(), me = await meOf(db, who.uid);
  const asked = line(d.reg, 40);
  const reg = regions.has(asked) ? asked : regions.has(me.reg) ? me.reg : [...regions][0] || '';
  if (!reg) throw new HttpsError('failed-precondition', 'There is no region to walk round yet.');
  const key = who.uid + '|' + reg, hit = desks.get(key);
  if (hit && now - hit.at < 60000 && d.refresh !== true) return hit.d;
  /* the region's own chat is read once: it says who has written since being founded and how alive the room is */
  const recent = await safe(db.collection('rchat/' + reg + '/chat').where('t', '>', now - AMB_NEW).limit(400).select('a').get(), { docs: [] });
  const spoke = new Set(recent.docs.map(s => String(s.get('a') || '')));
  const [newly, rooms, topics, silences, cred, asks] = await Promise.all([
    safe(deskNewly(db, reg, now, spoke), []), deskRooms(db, regions, now), deskTopics(db, regions, now),
    deskSilences(db, who, reg, now), safe(credLeft(db, who.uid, now), { left: AMB_CRED, of: AMB_CRED, week: weekOf(now) }), deskAsks(db)]);
  const out = { at: now, reg, me: me.name, newly, rooms, topics, silences, cred, asks, quiet: AMB_QUIET, span: AMB_NEW };
  desks.set(key, { at: now, d: out });
  if (desks.size > 200) for (const [k, v] of desks) if (now - v.at > 60000) desks.delete(k);
  return out;
}

/* ── greeting a newly founded nation ── */

/* An ambassador takes a newly founded nation: the first to say so has it, and every other desk shows it greeted, so
   nobody gets three welcomes in an hour. The welcome itself is an ordinary letter the ambassador's game sends, which
   is why `wrote` only records whether one went: this file never writes to a player. */
async function ambGreet(db, who, d) {
  ambOnly(who);
  const uid = uidOf(d.uid);
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a nation.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You cannot greet your own nation.');
  const now = Date.now(), [them, me] = await Promise.all([db.doc('summaries/' + uid).get(), meOf(db, who.uid)]);
  if (!them.exists) throw new HttpsError('not-found', 'That nation is no longer there.');
  if (!(num(them.get('f')) > now - AMB_NEW)) throw new HttpsError('failed-precondition', 'That nation is no longer newly founded.');
  const wrote = d.wrote === true;
  const got = await db.runTransaction(async tx => {
    const ref = db.doc('ambGreet/' + uid), s = await tx.get(ref);
    if (s.exists) return { already: { by: String(s.get('by') || ''), nm: line(s.get('nm'), 80), t: num(s.get('t')), wrote: s.get('wrote') === true } };
    tx.create(ref, { by: who.uid, nm: me.name, t: now, reg: line(them.get('reg'), 40), wrote });
    return { taken: true };
  });
  if (got.taken) desks.clear();
  return { ok: true, uid, ...got };
}

/* ── handing something to the moderators ── */

/* The note waits in ambNotes, which the moderators' Needs attention reads ahead of the ordinary reports. An
   ambassador writes what they saw; the line, topic or nation it is about is carried along so nothing has to be
   copied out. Nothing here acts on the player. */
async function ambPass(db, who, d) {
  ambOnly(who);
  const kind = typeof d.kind === 'string' && Object.hasOwn(AMB_PASS_KINDS, d.kind) ? d.kind : '';
  const x = line(d.x, AMB_PASS_TEXT), target = uidOf(d.uid), now = Date.now();
  if (!kind) throw new HttpsError('invalid-argument', 'Choose what kind of note this is.');
  if (x.length < 10) throw new HttpsError('invalid-argument', 'Say a sentence or two about what you saw.');
  const [them, me] = await Promise.all([target ? db.doc('summaries/' + target).get() : null, meOf(db, who.uid)]);
  const ref = db.collection('ambNotes').doc();
  const note = { by: who.uid, nm: me.name, kind, x, t: now, state: 'waiting',
    ...(target ? { target, name: them && them.exists ? line(them.get('name'), 80) : '', reg: them && them.exists ? line(them.get('reg'), 40) : '' } : { reg: me.reg }),
    ...(id20(d.line) ? { line: id20(d.line) } : {}), ...(id20(d.topic) ? { topic: id20(d.topic) } : {}) };
  const b = db.batch();
  b.create(ref, note);
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'amb_note', outcome: 'completed', at: FieldValue.serverTimestamp(),
    ...(target ? { target, name: note.name || '' } : {}), role: 'amb', note: ref.id, reason: AMB_PASS_KINDS[kind] });
  await b.commit();
  return { ok: true, id: ref.id, t: now };
}

/* ── commendations ── */

/* The one thing an ambassador may hand out, and the only reason the role can give a player anything at all: AMB_CRED
   a week, so it keeps meaning something. It posts a line in the nation's own region chat under the ambassador's name
   (the blue pill comes with it) and writes commended/{uid}, which every game reads for the mark on the nation card.
   Not the ambassador's own nation, and not the same nation twice within AMB_CRED_KEEP. It cannot be taken back. */
async function ambCommend(db, who, d, regions) {
  ambOnly(who);
  const uid = uidOf(d.uid), x = line(d.x, AMB_CRED_TEXT);
  const why = typeof d.why === 'string' && Object.hasOwn(AMB_CRED_WHY, d.why) ? d.why : '';
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a nation.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You cannot commend your own nation.');
  if (!why) throw new HttpsError('invalid-argument', 'Choose what it is for.');
  if (x.length < 10) throw new HttpsError('invalid-argument', 'Write the line everyone will read.');
  const now = Date.now(), [them, me] = await Promise.all([db.doc('summaries/' + uid).get(), meOf(db, who.uid)]);
  if (!them.exists) throw new HttpsError('not-found', 'That nation is no longer there.');
  const nm = line(them.get('name'), 80), reg = line(them.get('reg'), 40);
  if (!regions.has(reg)) throw new HttpsError('failed-precondition', 'That nation has no region to be praised in.');
  const words = line(`A commendation for ${nm}: ${x}`, RC_TEXT);
  return db.runTransaction(async tx => {
    const credRef = db.doc('ambCred/' + who.uid), markRef = db.doc('commended/' + uid);
    const [cred, mark] = await tx.getAll(credRef, markRef);
    const w = weekOf(now), used = cred.exists && num(cred.get('w')) === w ? num(cred.get('n')) : 0;
    if (used >= AMB_CRED) throw new HttpsError('failed-precondition', `You have given all ${AMB_CRED} commendations this week. They come back on Monday.`);
    if (mark.exists && now - num(mark.get('t')) < AMB_CRED_KEEP) throw new HttpsError('failed-precondition', `${nm} was commended this season already.`);
    tx.set(credRef, { w, n: used + 1, t: now });
    tx.set(markRef, { t: now, until: now + AMB_CRED_KEEP, x, why, by: who.uid, nm: me.name, reg });
    tx.create(db.collection('rchat/' + reg + '/chat').doc(), { a: who.uid, nm: me.name, x: words, t: now,
      exp: Timestamp.fromMillis(now + RC_KEEP), sys: 'praise' });
    tx.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'amb_commend', outcome: 'completed', at: FieldValue.serverTimestamp(),
      target: uid, name: nm, reg, role: 'amb', reason: AMB_CRED_WHY[why] });
    return { ok: true, uid, name: nm, left: AMB_CRED - used - 1, until: now + AMB_CRED_KEEP };
  /* the cached rounds are thrown away once, after the transaction has actually gone through, never on a retry */
  }).then(r => { desks.clear(); return r; });
}

/* ── what players keep asking ── */

/* One tally for a question, however it was worded (askKey). An ambassador counts once a day towards the same
   question, so pressing it twice in an afternoon says nothing new. No player is ever named. */
async function ambAsk(db, who, d) {
  ambOnly(who);
  const x = line(d.x, AMB_ASK_TEXT), key = askKey(x), now = Date.now();
  if (x.length < 8 || !key) throw new HttpsError('invalid-argument', 'Write the question in a few words.');
  return db.runTransaction(async tx => {
    const ref = db.doc('ambAsks/' + key), s = await tx.get(ref);
    const heard = s.exists ? { ...(s.get('b') || {}) } : {};
    if (num(heard[who.uid]) > now - DAY) return { ok: true, key, n: num(s.get('n')), already: true };
    heard[who.uid] = now;
    /* only the newest forty are kept, so one question's record never grows without end */
    const keep = Object.entries(heard).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const n = (s.exists ? num(s.get('n')) : 0) + 1;
    tx.set(ref, { x: s.exists ? line(s.get('x'), AMB_ASK_TEXT) : x, n, t: s.exists ? num(s.get('t')) : now, la: now, b: Object.fromEntries(keep) });
    return { ok: true, key, n };
  });
}

/* ── the ledger ── */

/* Every silence this ambassador has set, running or served, and every note they have passed up. rcMute keeps one
   record per nation, so a silence a moderator lifted is gone from here: the ledger says what is still true. */
async function ambLedger(db, who) {
  ambOnly(who);
  const now = Date.now();
  const [mine, notes] = await Promise.all([
    safe(db.collection('rcMute').where('by', '==', who.uid).orderBy('t', 'desc').limit(40).get(), { docs: [] }),
    safe(db.collection('ambNotes').where('by', '==', who.uid).orderBy('t', 'desc').limit(30).get(), { docs: [] })]);
  return { at: now,
    silences: mine.docs.map(s => ({ uid: s.id, nm: line(s.get('nm'), 80), why: line(s.get('why'), 200), reg: line(s.get('reg'), 40),
      t: num(s.get('t')), until: num(s.get('until')), perm: s.get('perm') === true, running: num(s.get('until')) > now })),
    notes: notes.docs.map(s => ({ id: s.id, kind: line(s.get('kind'), 20), x: line(s.get('x'), AMB_PASS_TEXT), name: line(s.get('name'), 80),
      t: num(s.get('t')), state: line(s.get('state'), 20) || 'waiting', said: line(s.get('said'), 300) })) };
}

const OPS = { ambDesk, ambGreet, ambPass, ambCommend, ambAsk, ambLedger };
export function ambassador(db, who, d, regions) {
  return OPS[d.op](db, who, d, regions);
}
