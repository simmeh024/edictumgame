// Staff alerts (functions/alerts.js): looks for what the team should know about — a player reported again and again,
// a nation growing too fast, save errors, a rush of foundings, purchases, what watched players do — files each finding
// once in adminAlerts/<id> for the admin portal's Watchlist & alerts page, and posts the new ones to a staff Discord
// channel when STAFF_ALERT_WEBHOOK is set. It shares the statistics job's packages.
//
//   cd jobs/stats && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/key.json STAFF_ALERT_WEBHOOK=<url> node alerts.mjs --project <project id>
//   node alerts.mjs --project demo-edictum             # the emulators, with FIRESTORE_EMULATOR_HOST set
//   node alerts.mjs --project demo-edictum --now <ms>  # as if at that moment
//
// .github/workflows/alerts.yml runs it every fifteen minutes. It prints a JSON report.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { runAlerts } from '../../functions/alerts.js';

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const projectId = opt('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('alerts.mjs: name the project with --project <id>'); process.exit(2); }
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
if (emulated) process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() });
const report = await runAlerts(getFirestore(), { now: Number(opt('--now')) || Date.now(), webhook: process.env.STAFF_ALERT_WEBHOOK || '',
  site: process.env.SITE_URL || 'https://edictumgame.com', Timestamp });
console.log(JSON.stringify(report, null, 1));
