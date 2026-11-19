// Who has gone quiet and could be written to: every player with an email address, joined to their nation's last
// visit (summaries.t), so a win-back letter can be aimed at the players who actually left.
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node inactive-mail.mjs --project edictum-b30de
//   ... node inactive-mail.mjs --days 30 --csv C:\path\inactive.csv
//
// Two sources of address, and they are not the same thing:
//   optIn  mailAccounts/<uid> with ok == true - the player typed an address into Settings > Letters by post and
//          confirmed it. This is the only address they agreed to hear from. jobs/mail/run.mjs already writes to
//          them by itself after AWAY_DAYS (3) if they kept the 'away' letter on.
//   auth   the email on their Firebase Auth account (the Google account they signed in with). They never asked
//          to be written to at this address; it is sign-in data.
// Reads only: Firebase Auth, mailAccounts and summaries. Writes nothing and sends nothing.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'edictum-b30de';
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulated && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('inactive-mail.mjs: set GOOGLE_APPLICATION_CREDENTIALS to a service account key for ' + projectId);
  process.exit(2);
}
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore(), auth = getAuth();

const DAY = 86400000, now = Number(opt('--now')) || Date.now();
const minDays = Number(opt('--days') ?? 7);
const ms = v => typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
const day = t => t ? new Date(t).toISOString().slice(0, 10) : '';

/* every account, for the email and how they signed in */
const users = new Map();
for (let page; ;) {
  const r = await auth.listUsers(1000, page);
  for (const u of r.users) users.set(u.uid, {
    email: u.email || '', providers: u.providerData.map(p => p.providerId.replace('.com', '')).join('+') || 'guest',
    lastSignIn: ms(Date.parse(u.metadata.lastSignInTime || '')) || 0, created: ms(Date.parse(u.metadata.creationTime || '')) || 0 });
  if (!(page = r.pageToken)) break;
}
/* every nation */
const sums = new Map((await db.collection('summaries').select('name', 'reg', 'pop', 't', 'f').get()).docs.map(d => [d.id, d.data()]));
/* who asked for letters */
const opted = new Map((await db.collection('mailAccounts').get()).docs.map(d => [d.id, d.data()]));

const rows = [...sums].map(([uid, s]) => {
  const u = users.get(uid) || {}, a = opted.get(uid), p = (a && a.p) || {};
  const last = ms(s.t), founded = ms(s.f);
  return {
    uid, nation: s.name || '', region: s.reg || '', pop: +s.pop || 0,
    email: (a && a.ok && a.e) || u.email || '', source: a && a.ok ? 'optIn' : u.email ? 'auth' : '',
    signedInWith: u.providers || 'guest',
    lastVisit: day(last), daysAway: last ? Math.floor((now - last) / DAY) : null,
    founded: day(founded), playedDays: last && founded ? Math.floor((last - founded) / DAY) : null,
    lastSignIn: day(u.lastSignIn),
    wantsAway: !!p.away, wantsNews: !!p.news, awayLetterSent: a ? day(ms(a.away)) : ''
  };
});

const withMail = rows.filter(r => r.email);
const quiet = withMail.filter(r => r.daysAway >= minDays).sort((x, y) => y.daysAway - x.daysAway);
const unreachable = rows.filter(r => !r.email && r.daysAway >= minDays);

console.log(`\nNations: ${rows.length}   with an email address: ${withMail.length}   of those quiet ${minDays}+ days: ${quiet.length}`);
console.log(`Opted into Letters by post (mailAccounts, ok): ${rows.filter(r => r.source === 'optIn').length}   address from Google sign-in only: ${rows.filter(r => r.source === 'auth').length}   no address at all: ${rows.filter(r => !r.email).length} (quiet: ${unreachable.length})\n`);

const buckets = [[minDays, 14], [14, 30], [30, 60], [60, Infinity]];
const label = ([lo, hi]) => hi === Infinity ? `${lo}+ days` : `${lo}-${hi - 1} days`;
for (const b of buckets) {
  const inB = quiet.filter(r => r.daysAway >= b[0] && r.daysAway < b[1]);
  if (inB.length) console.log(`${label(b).padEnd(12)} ${String(inB.length).padStart(4)} nations   (played ${Math.round(inB.reduce((s, r) => s + (r.playedDays || 0), 0) / inB.length)}d on average before leaving)`);
}
console.log('');
const show = Number(opt('--show') ?? 40);
console.log('days  nation                     region          pop  played  last visit  signed in with  email');
for (const r of quiet.slice(0, show)) console.log(
  String(r.daysAway).padStart(4) + '  ' + (r.nation || '(unnamed)').slice(0, 24).padEnd(26) +
  (r.region || '').slice(0, 14).padEnd(15) + String(r.pop).padStart(5) + '  ' +
  String(r.playedDays ?? '').padStart(6) + '  ' + r.lastVisit.padEnd(11) + '  ' +
  (r.signedInWith || '').padEnd(14) + '  ' + r.email);
if (quiet.length > show) console.log(`... and ${quiet.length - show} more (--show ${quiet.length} for all, or --csv)`);

const csv = opt('--csv');
if (csv && quiet.length) {
  const cols = Object.keys(quiet[0]);
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  writeFileSync(csv, [cols.join(','), ...quiet.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n') + '\r\n');
  console.log(`\n${quiet.length} rows written to ${csv}`);
}
