// The front page's live figures (functions/home.js): the counters, the regions' counts and the latest public events,
// written to home/live for every visitor to read once. It shares the statistics job's packages.
//
//   cd jobs/stats && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node home.mjs --project <project id>
//   node home.mjs --project demo-edictum             # the emulators, with FIRESTORE_EMULATOR_HOST set
//   node home.mjs --project <id> --dry               # works it all out and prints it, writes nothing
//
// .github/workflows/home.yml runs it every five minutes. It prints a JSON report.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { runHome } from '../../functions/home.js';
import { loadWorld } from '../fx/world.mjs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('home.mjs: name the project with --project <id>'); process.exit(2); }
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const { regions } = loadWorld();
const report = await runHome(getFirestore(), { now: Number(opt('--now')) || Date.now(), regions, dry: args.includes('--dry'), Timestamp });
console.log(JSON.stringify(report, null, 1));
