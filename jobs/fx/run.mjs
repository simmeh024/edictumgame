// Runs the daily currency job against a Firebase project with the Admin SDK.
//
//   cd jobs/fx && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json node run.mjs --project <project id>
//   node run.mjs --project demo-edictum            # the emulator, with FIRESTORE_EMULATOR_HOST set
//   node run.mjs --project <id> --region meridian  # one region only (repeatable)
//   node run.mjs --project demo-edictum --now <ms>  # as if at that moment (the tests publish past days)
//
// .github/workflows/currency.yml runs it every day. It prints a JSON report and exits 1 if a region failed.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runCurrencyDay } from './daily.mjs';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('run.mjs: name the project with --project <id>'); process.exit(2); }
const regions = args.flatMap((a, i) => (a === '--region' ? [args[i + 1]] : []));
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none'; // no Google Cloud metadata server to ask on a test machine
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const now = Number(opt('--now')) || undefined;
const report = await runCurrencyDay(getFirestore(), Object.assign(regions.length ? { regions } : {}, now ? { now } : {}));
console.log(JSON.stringify(report, null, 1));
process.exit(report.reports.some(r => r.error) ? 1 : 0);
