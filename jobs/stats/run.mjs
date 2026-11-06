// Records the day's player statistics with the Admin SDK: statsDays/<date>, the headline figures for the world and
// each region and what their players use (functions/stats.js, snapshot), which the admin portal's Statistics page
// draws as its daily history, and every nation's engagement score for Player search (statsEngage/<n>).
// How many played on a day cannot be worked out later (a nation keeps only the time of its last save), so this is
// taken every day; a day already recorded is left as it is.
//
//   cd jobs/stats && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node run.mjs --project <project id>
//   node run.mjs --project demo-edictum             # the emulators, with FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST set
//   node run.mjs --project demo-edictum --now <ms>  # as if at that moment
//
// .github/workflows/stats.yml runs it every day just after midnight UTC, recording the day that ended. It prints a
// JSON report.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { gather, snapshot, saveEngage } from '../../functions/stats.js';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('run.mjs: name the project with --project <id>'); process.exit(2); }
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore(), auth = getAuth(), now = Number(opt('--now')) || Date.now();
const g = await gather(db, (max, token) => auth.listUsers(max, token), { now });
const day = snapshot(g, now), ref = db.doc('statsDays/' + day.d);
const fresh = await db.runTransaction(async tx => { if ((await tx.get(ref)).exists) return false; tx.create(ref, day); return true; });
// every nation's engagement score for the admin portal's Player search (statsEngage/<n>), fresh every night
await saveEngage(db, g);
const { feat, ...all } = day.all;
console.log(JSON.stringify({ day: day.d, recorded: fresh, ...all, regions: Object.keys(day.regs).length, scored: g.rows.length }, null, 1));
