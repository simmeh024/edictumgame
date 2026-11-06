// Letters by post: every hour, turns what happened into letters for the players who asked for them
// (functions/mail-core.js has the letters and the sender; functions/mail.js the addresses).
//
//  1. pings (mailQ/<id>, written by players' games when they write to, fight or deal with another nation):
//     one digest per player, at most every DIGEST_GAP, and never about something they have already seen, i.e.
//     anything from before their nation's last save (summaries/<uid>.t). Pings are deleted once handled; all but
//     letters ('msg') are first kept in feedLog/<hour> {t, items} for the admin portal's Live feed (functions/feed.js),
//     which keeps them FEED_KEEP and then deletes them.
//  2. development news published since the last run (mailState/news {at}); the very first run only notes the time.
//     Each account also keeps the time it was last sent news (mailAccounts/<uid>.nw), so a run that fails part of the
//     way leaves the rest for the next run without sending anyone the same news twice.
//  3. one reminder when a nation has not been visited for AWAY_DAYS (mailAccounts/<uid>.away remembers it).
//
//   cd jobs/mail && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node run.mjs --project <project id>
//   node run.mjs --project demo-edictum --now <ms>   # the emulators (FIRESTORE_EMULATOR_HOST): letters go to mailOutbox
//
// .github/workflows/mail.yml runs it every hour. It prints a JSON report.
//
// Letters go out a chunk at a time (Resend's batch endpoint takes 100), and what each chunk settles (a digest's time and
// its pings, an away reminder, news sent) is saved as soon as that chunk is accepted. If the mail service refuses a chunk,
// the run stops there and fails: what was sent stays recorded, so nothing is sent twice, and what was not is sent next time.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { mailConfig, send, digestLetter, newsLetter, awayLetter, PING_KIND, AWAY_DAYS } from '../../functions/mail-core.js';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('run.mjs: name the project with --project <id>'); process.exit(2); }
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore(), now = Number(opt('--now')) || Date.now();
const DAY = 86400000, DIGEST_GAP = 6 * 3600000, PING_KEEP = 7 * DAY;
const ms = v => typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
/* the tests, on the emulators only: smaller chunks, and a chunk the "mail service" refuses */
const CHUNK = emulated && Number(process.env.MAIL_TEST_CHUNK) || 100, FAIL_CHUNK = emulated ? Number(process.env.MAIL_TEST_FAIL_CHUNK) : NaN;

const cfg = await mailConfig(db);
if (!cfg.key && !emulated) { console.log(JSON.stringify({ skipped: 'no Resend key in authConfig/mail (tools/admin/set-mail.mjs)' })); process.exit(0); }

const acc = new Map((await db.collection('mailAccounts').where('ok', '==', true).get()).docs.map(d => [d.id, d.data()]));
const sums = new Map();
async function summary(uid) {
  if (!sums.has(uid)) { const s = await db.doc('summaries/' + uid).get(); sums.set(uid, s.exists ? s.data() : null); }
  return sums.get(uid);
}
const report = { confirmed: acc.size, digests: 0, news: 0, away: 0, pingsDeleted: 0, pingsKept: 0 };
/* every letter with what it settles once sent: fields for its account, and pings it handled */
const items = [], drop = [];
const add = (letter, uid, fields, pings) => items.push({ letter, uid, fields, pings: pings || [] });

// 1. pings
const q = await db.collection('mailQ').limit(5000).get(), byTo = new Map();
for (const d of q.docs) { const x = d.data(); (byTo.get(x.to) || byTo.set(x.to, []).get(x.to)).push({ ref: d.ref, k: x.k, nm: x.nm, t: ms(x.t) }); }
for (const [to, list] of byTo) {
  const a = acc.get(to), s = a ? await summary(to) : null, seen = s ? s.t || 0 : 0;
  const want = a ? list.filter(x => a.p && a.p[PING_KIND[x.k]] && !(x.k === 'msg' && a.p.now) && x.t > seen && now - x.t < PING_KEEP) : [];   // letters right away went already (functions/letters.js)
  if (want.length && now - (a.last || 0) < DIGEST_GAP) {         // wait for the next window; drop only the rest
    for (const x of list) if (!want.includes(x)) drop.push(x.ref);
    report.pingsKept += want.length; continue;
  }
  if (want.length) {
    add(digestLetter(cfg, { to: a.e, nation: s && s.name, pings: want.sort((x, y) => x.t - y.t), tok: a.tok }), to, { last: now }, list.map(x => x.ref));
    report.digests++;
  } else for (const x of list) drop.push(x.ref);
}

// 2. development news
/* mailState/news.at moves on only once a run has sent every letter; each account's own nw keeps what it was sent */
const st = db.doc('mailState/news'), stS = await st.get();
if (!stS.exists) await st.set({ at: now });
else {
  const since = stS.get('at') || now;
  const posts = (await db.collection('devnews').where('pub', '==', true).get()).docs.map(d => ({ ...d.data(), t: ms(d.get('t')) }))
    .filter(x => x.t > since && x.t <= now).sort((x, y) => x.t - y.t);
  if (posts.length) for (const [uid, a] of acc) {
    if (!a.p || !a.p.news) continue;
    const mine = posts.filter(x => x.t > (a.nw || 0)).map(x => ({ ti: x.ti, ex: x.ex || '' }));
    if (mine.length) { add(newsLetter(cfg, { to: a.e, posts: mine, tok: a.tok }), uid, { nw: now }); report.news++; }
  }
}

// 3. away reminders
for (const [uid, a] of acc) {
  if (!a.p || !a.p.away) continue;
  const s = await summary(uid), t = s ? s.t || 0 : 0;
  if (!t || now - t < AWAY_DAYS * DAY || (a.away || 0) > t) continue;
  add(awayLetter(cfg, { to: a.e, nation: s.name, days: Math.floor((now - t) / DAY), tok: a.tok }), uid, { away: now });
  report.away++;
}

// every ping read this run, but letters, for the Live feed (kept before any is deleted below): one document per hour, and none older than FEED_KEEP
const FEED_KEEP = 7 * DAY, HOUR = 3600000, hour = Math.floor(now / HOUR) * HOUR;
const kept = q.docs.map(d => d.data()).filter(x => x.k !== 'msg' && x.by && x.to).map(x => ({ by: x.by, to: x.to, k: x.k, nm: String(x.nm || '').slice(0, 80), t: ms(x.t) }));
for (let i = 0; i < kept.length; i += 400) await db.doc('feedLog/' + new Date(hour).toISOString().slice(0, 13) + (i ? '-' + i / 400 : '')).set({ t: hour, items: FieldValue.arrayUnion(...kept.slice(i, i + 400)) }, { merge: true });
const stale = await db.collection('feedLog').where('t', '<', now - FEED_KEEP).limit(400).get();
if (stale.size) { const b = db.batch(); stale.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
report.feedKept = kept.length; report.feedRemoved = stale.size;
/* pings nobody gets a letter about go now; the rest with the chunk that carries their digest */
async function writeAll(ops) {
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); for (const [ref, u] of ops.slice(i, i + 400)) { if (u) b.update(ref, u); else b.delete(ref); } await b.commit(); }
}
await writeAll(drop.map(r => [r, null]));
report.pingsDeleted = drop.length; report.sent = 0;
let failed = null;
for (let i = 0; i < items.length; i += CHUNK) {
  const chunk = items.slice(i, i + CHUNK);
  try {
    if (i / CHUNK === FAIL_CHUNK) throw Object.assign(new Error('the mail service refused the letters (a test)'), { code: 'mail_failed' });
    report.sent += await send(db, chunk.map(x => x.letter), cfg);
  } catch (e) { failed = e; break; }
  /* what this chunk settled, saved before the next is sent */
  const fields = new Map();
  for (const x of chunk) fields.set(x.uid, Object.assign(fields.get(x.uid) || {}, x.fields));
  const pings = chunk.flatMap(x => x.pings);
  await writeAll([...[...fields].map(([uid, u]) => [db.doc('mailAccounts/' + uid), u]), ...pings.map(r => [r, null])]);
  report.pingsDeleted += pings.length;
}
if (!failed && stS.exists) await st.set({ at: now });
if (failed) report.failed = String(failed.message || failed).slice(0, 300);
console.log(JSON.stringify(report, null, 1));
if (failed) process.exit(1);
