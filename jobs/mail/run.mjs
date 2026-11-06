// Letters by post: every hour, turns what happened into letters for the players who asked for them
// (functions/mail-core.js has the letters and the sender; functions/mail.js the addresses).
//
//  1. pings (mailQ/<id>, written by players' games when they write to, fight or deal with another nation):
//     one digest per player, at most every DIGEST_GAP, and never about something they have already seen, i.e.
//     anything from before their nation's last save (summaries/<uid>.t). Pings are deleted once handled.
//  2. development news published since the last run (mailState/news {at}); the very first run only notes the time.
//  3. one reminder when a nation has not been visited for AWAY_DAYS (mailAccounts/<uid>.away remembers it).
//
//   cd jobs/mail && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node run.mjs --project <project id>
//   node run.mjs --project demo-edictum --now <ms>   # the emulators (FIRESTORE_EMULATOR_HOST): letters go to mailOutbox
//
// .github/workflows/mail.yml runs it every hour. It prints a JSON report.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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

const cfg = await mailConfig(db);
if (!cfg.key && !emulated) { console.log(JSON.stringify({ skipped: 'no Resend key in authConfig/mail (tools/admin/set-mail.mjs)' })); process.exit(0); }

const acc = new Map((await db.collection('mailAccounts').where('ok', '==', true).get()).docs.map(d => [d.id, d.data()]));
const sums = new Map();
async function summary(uid) {
  if (!sums.has(uid)) { const s = await db.doc('summaries/' + uid).get(); sums.set(uid, s.exists ? s.data() : null); }
  return sums.get(uid);
}
const report = { confirmed: acc.size, digests: 0, news: 0, away: 0, pingsDeleted: 0, pingsKept: 0 };
const letters = [], updates = [], drop = [];

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
    letters.push(digestLetter(cfg, { to: a.e, nation: s && s.name, pings: want.sort((x, y) => x.t - y.t), tok: a.tok }));
    updates.push([to, { last: now }]); report.digests++;
  }
  for (const x of list) drop.push(x.ref);
}

// 2. development news
const st = db.doc('mailState/news'), stS = await st.get();
if (!stS.exists) await st.set({ at: now });
else {
  const since = stS.get('at') || now;
  const posts = (await db.collection('devnews').where('pub', '==', true).get()).docs.map(d => ({ ...d.data(), t: ms(d.get('t')) }))
    .filter(x => x.t > since && x.t <= now).sort((x, y) => x.t - y.t).map(x => ({ ti: x.ti, ex: x.ex || '' }));
  if (posts.length) for (const [, a] of acc) if (a.p && a.p.news) { letters.push(newsLetter(cfg, { to: a.e, posts, tok: a.tok })); report.news++; }
  await st.set({ at: now });
}

// 3. away reminders
for (const [uid, a] of acc) {
  if (!a.p || !a.p.away) continue;
  const s = await summary(uid), t = s ? s.t || 0 : 0;
  if (!t || now - t < AWAY_DAYS * DAY || (a.away || 0) > t) continue;
  letters.push(awayLetter(cfg, { to: a.e, nation: s.name, days: Math.floor((now - t) / DAY), tok: a.tok }));
  updates.push([uid, { away: now }]); report.away++;
}

report.sent = await send(db, letters, cfg);
for (let i = 0; i < updates.length; i += 400) { const b = db.batch(); for (const [uid, u] of updates.slice(i, i + 400)) b.update(db.doc('mailAccounts/' + uid), u); await b.commit(); }
for (let i = 0; i < drop.length; i += 400) { const b = db.batch(); for (const r of drop.slice(i, i + 400)) b.delete(r); await b.commit(); }
report.pingsDeleted = drop.length;
console.log(JSON.stringify(report, null, 1));
