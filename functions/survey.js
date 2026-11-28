/* The player survey (28 Nov 2026), on the accounts function (no new Cloud Function: new ones cannot be deployed by CI).

   Who is asked: a nation at least a week old (Firestore's creation time, never JSON.founded) whose engagement score is
   SV_MIN or more (functions/stats.js, engagement: the nightly statistics write it to statsEngage/<n>), not banned, not
   staff. Each day a share of them is drawn (svDrawn: the same answer all day, a new draw the next), so invitations
   trickle in. A player once drawn stays invited until they answer or say no thanks; "Ask me tomorrow" (later) holds it
   a day, at most SV_LATER times.

   Records: svy/<uid> {s: {<survey id>: {t invited, q drawn questions, e score then, l laters, lt last later, no said no,
   d answered, a answers, o "something else" words, w why, x the nation then: name, region, population, age, score
   parts, registered}}}, server-written only (firestore.rules lets no player read or write it). svCfg/live {on, share,
   draw, said: {x, link, t}} is the admin portal's switch and the "you said, we did" note. Closing an account deletes
   svy/<uid> (functions/accounts.js).

   The game asks at most once a day (step check, which says when to ask next); the admin portal reads and sets it all
   with the adminConsole op 'survey' (surveyAdmin). */
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { refuse, nationJSON } from './eligibility.js';
import { engPart } from './stats.js';
import { SV_ID, SV_TITLE, SV_MIN, SV_AGE, SV_SHARE, SV_DRAW, SV_LATER, SV_QS, svDrawn, svPick, svAsked, svClean, svForPlayer, svHash, svCore, svPool } from './survey-data.js';

const DAY = 86400000;
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const words = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* the configuration, with its defaults; a survey nobody has opened is off */
export function svConfig(snap) {
  const d = snap && snap.exists ? snap.data() || {} : {};
  const share = num(d.share) > 0 && num(d.share) <= 1 ? num(d.share) : SV_SHARE;
  const draw = Number.isInteger(d.draw) && d.draw >= 0 && d.draw <= svPool().length ? d.draw : SV_DRAW;
  const said = d.said && typeof d.said === 'object' && words(d.said.x, 600) ? { x: words(d.said.x, 600), link: words(d.said.link, 300), t: num(d.said.t) } : null;
  return { on: d.on === true, share, draw, said, t: num(d.t), by: typeof d.by === 'string' ? d.by : '' };
}
/* the next time a player's game should ask: the start of the next UTC day, spread over its first two hours */
export const svNextDay = (uid, now) => Math.floor(now / DAY) * DAY + DAY + Math.floor(svHash(uid + '|next') * 2 * 3600000);
const said = (cfg, rec) => cfg.said && rec && rec.d && cfg.said.t > rec.d ? cfg.said : null;

/* the player's side: {step: 'check' | 'later' | 'no' | 'answer', s, a?} */
export async function surveyStep(db, who, d, now = Date.now()) {
  const step = String(d.step || ''), uid = who.uid, ref = db.doc('svy/' + uid);
  if (!['check', 'later', 'no', 'answer'].includes(step)) throw new HttpsError('invalid-argument', 'Unknown survey step.');
  const [cfgSnap, mine] = await Promise.all([db.doc('svCfg/live').get(), ref.get()]);
  const cfg = svConfig(cfgSnap), rec = (mine.exists && mine.get('s') || {})[SV_ID] || null;
  if (step === 'check') {
    if (who.admin || who.mod) return { ok: true, due: false, next: now + 7 * DAY, staff: true };
    if (rec && rec.d) { const s = said(cfg, rec); return { ok: true, due: false, done: true, next: now + DAY, ...(s ? { said: s } : {}) }; }
    if (!cfg.on) return { ok: true, due: false, next: now + DAY };
    if (rec && rec.no) return { ok: true, due: false, next: now + 7 * DAY };
    if (rec && rec.t) {
      if (num(rec.lt) && now < num(rec.lt) + DAY) return { ok: true, due: false, next: num(rec.lt) + DAY };
      return invite(rec, cfg);
    }
    const [nation, ban, eng] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('bans/' + uid).get(), db.doc('statsEngage/' + engPart(uid)).get()]);
    const score = eng.exists ? (eng.get('m') || {})[uid] : null, next = svNextDay(uid, now);
    if (!nation.exists || ban.exists || nation.createTime.toMillis() > now - SV_AGE || !Array.isArray(score) || num(score[0]) < SV_MIN) return { ok: true, due: false, next };
    if (!svDrawn(uid, SV_ID, now, cfg.share)) return { ok: true, due: false, next };
    const fresh = { t: now, q: svPick(uid, SV_ID, cfg.draw), e: num(score[0]) };
    await db.runTransaction(async tx => {
      const s = await tx.get(ref), had = (s.exists && s.get('s') || {})[SV_ID];
      if (!had || !had.t) tx.set(ref, { s: { [SV_ID]: fresh } }, { merge: true });
    });
    return invite(fresh, cfg);
  }
  if (!rec || !rec.t) refuse('survey_none', 'There is no survey waiting for you.');
  if (step === 'later') {
    if (rec.d) return { ok: true, done: true };
    if (num(rec.l) >= SV_LATER) refuse('survey_later', 'The survey can be put off twice. Answer it or say no thanks.');
    await ref.set({ s: { [SV_ID]: { l: num(rec.l) + 1, lt: now } } }, { merge: true });
    return { ok: true, next: now + DAY };
  }
  if (step === 'no') {
    if (rec.d) return { ok: true, done: true };
    await ref.set({ s: { [SV_ID]: { no: now } } }, { merge: true });
    return { ok: true };
  }
  /* answer: once; a lost reply sent again finds it done */
  if (rec.d) return { ok: true, again: true };
  if (rec.no) refuse('survey_declined', 'You said no thanks to this survey.');
  const { a, o, w } = svClean(svAsked(rec.q), d);
  const [nation, eng] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('statsEngage/' + engPart(uid)).get()]);
  const J = nationJSON(nation), score = eng.exists ? (eng.get('m') || {})[uid] : null;
  const x = { name: words(J.name || nation.get('name'), 60), reg: words(J.reg || nation.get('reg'), 40), pop: Math.round(num(J.pop) || num(nation.get('pop'))),
    days: nation.exists ? Math.floor((now - nation.createTime.toMillis()) / DAY) : 0, eng: Array.isArray(score) ? score.slice(0, 5).map(num) : null, acct: who.registered ? 'registered' : 'guest' };
  await db.runTransaction(async tx => {
    const s = await tx.get(ref), had = (s.exists && s.get('s') || {})[SV_ID] || {};
    if (had.d) return;
    tx.set(ref, { s: { [SV_ID]: { d: now, a, o, w, x } } }, { merge: true });
  });
  return { ok: true, n: Object.keys(a).length };
}
function invite(rec, cfg) {
  return { ok: true, due: true, s: SV_ID, title: SV_TITLE, qs: svForPlayer(svAsked(rec.q)), later: num(rec.l), laterMax: SV_LATER, gift: 'c-ballot' };
}

/* the admin portal's Player survey: {action: 'get'} the setting, the questions and every invited player's record;
   {action: 'set', on, share, draw}; {action: 'said', x, link} the note those who answered see */
export async function surveyAdmin(db, actor, d, now = Date.now()) {
  const action = String(d.action || 'get'), cfgRef = db.doc('svCfg/live');
  if (action === 'set') {
    const before = svConfig(await cfgRef.get()), next = { on: typeof d.on === 'boolean' ? d.on : before.on, share: before.share, draw: before.draw };
    if (d.share !== undefined) { const v = +d.share; if (!(v > 0 && v <= 1)) throw new HttpsError('invalid-argument', 'The daily share is a number above 0 and up to 1.'); next.share = v; }
    if (d.draw !== undefined) { if (!Number.isInteger(d.draw) || d.draw < 0 || d.draw > svPool().length) throw new HttpsError('invalid-argument', `Draw 0 to ${svPool().length} extra questions.`); next.draw = d.draw; }
    await cfgRef.set({ ...next, t: now, by: actor }, { merge: true });
    await db.collection('adminAudit').doc().set({ actor, action: 'survey_set', target: SV_ID, on: next.on, share: next.share, draw: next.draw, outcome: 'completed', at: FieldValue.serverTimestamp() });
    return { ok: true, cfg: svConfig(await cfgRef.get()) };
  }
  if (action === 'said') {
    const x = words(d.x, 600), link = words(d.link, 300);
    if (link && !/^https:\/\/|^#/.test(link)) throw new HttpsError('invalid-argument', 'A link starts with https:// or # (a page of the game).');
    await cfgRef.set({ said: x ? { x, link, t: now, by: actor } : FieldValue.delete() }, { merge: true });
    await db.collection('adminAudit').doc().set({ actor, action: 'survey_said', target: SV_ID, x, outcome: 'completed', at: FieldValue.serverTimestamp() });
    return { ok: true, cfg: svConfig(await cfgRef.get()) };
  }
  if (action !== 'get') throw new HttpsError('invalid-argument', 'Unknown survey action.');
  const [cfgSnap, all] = await Promise.all([cfgRef.get(), db.collection('svy').get()]);
  const rows = [];
  for (const s of all.docs) {
    const r = (s.get('s') || {})[SV_ID];
    if (!r || !r.t) continue;
    rows.push({ uid: s.id, t: num(r.t), q: Array.isArray(r.q) ? r.q : [], e: num(r.e), l: num(r.l), no: num(r.no), d: num(r.d),
      ...(r.d ? { a: r.a || {}, o: r.o || {}, w: r.w || {}, x: r.x || {} } : {}) });
  }
  rows.sort((p, q) => (q.d || q.t) - (p.d || p.t));
  return { ok: true, at: now, id: SV_ID, title: SV_TITLE, min: SV_MIN, ageDays: SV_AGE / DAY, laterMax: SV_LATER, core: svCore(), pool: svPool(), qs: SV_QS, cfg: svConfig(cfgSnap), rows };
}
