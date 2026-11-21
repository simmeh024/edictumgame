// Whether a project can take the scheduled functions (functions/home-live.js, homeLive): the Cloud Scheduler API switched
// on, and the deploy's service account allowed to create a schedule and let it call the function (Cloud Scheduler Admin
// and Cloud Run Admin: README.md, Owner setup, step 5.2).
//
// firebase-tools checks the APIs of every function in functions/ before it looks at --only, and switches a missing one
// on itself, which the service account is not allowed to do: the whole functions deploy then fails ("Permissions denied
// enabling cloudscheduler.googleapis.com"), and on live the site is not deployed after it. So Deploy and Preview run this
// first. When the project is not ready it writes functions/.env.<project> with EDICTUM_SCHEDULES=off, which firebase-tools
// hands to the functions while it reads them: home-live.js then exports no schedule, and the deploy goes on without it,
// with a warning that says what is missing. Once the owner has set it up, the next deploy adds homeLive.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/schedule-ready.mjs --project <id> [--env-dir functions]
//
// When a check cannot be made (the network, an API of Google's own), it does not hold the schedule back: the deploy
// decides, as it did before this check. Only a clear "the API is off" or "these permissions are missing" leaves it out,
// so a passing hiccup never removes a schedule that is already running (Deploy runs with --force).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export const API = 'cloudscheduler.googleapis.com';
/* what firebase-tools does for a new scheduled function beyond the referee's roles: the schedule's job
   (createOrReplaceJob: get, then create or update) and the call permission on its Cloud Run service (setInvokerCreate) */
export const NEEDED = ['cloudscheduler.jobs.get', 'cloudscheduler.jobs.create', 'cloudscheduler.jobs.update',
  'run.services.getIamPolicy', 'run.services.setIamPolicy'];

/* api: the API's state ('ENABLED', 'DISABLED') or null when it could not be read; granted: the NEEDED permissions the
   service account holds, or null when that could not be read. → {ready, why} */
export function verdict(api, granted) {
  if (api === 'DISABLED') return { ready: false, why: 'the Cloud Scheduler API is off in this project' };
  const missing = Array.isArray(granted) ? NEEDED.filter(p => !granted.includes(p)) : [];
  if (missing.length) return { ready: false, why: `the deploy's service account lacks ${missing.join(', ')} (the roles Cloud Scheduler Admin and Cloud Run Admin)` };
  if (api !== 'ENABLED' || !Array.isArray(granted)) return { ready: true, why: 'not everything could be checked, so the deploy decides' };
  return { ready: true, why: '' };
}

/* the env file firebase-tools reads for this project (functions/.env.<project id>) */
export const envLine = ready => `EDICTUM_SCHEDULES=${ready ? 'on' : 'off'}\n`;

export function warning(project, why) {
  return `homeLive (the front page's five-minute figures) was left out of this deploy to ${project}: ${why}. `
    + `Switch the API on at https://console.cloud.google.com/apis/library/${API}?project=${project} and give the `
    + `firebase-adminsdk service account the roles Cloud Scheduler Admin and Cloud Run Admin `
    + `(https://console.cloud.google.com/iam-admin/iam?project=${project}; README.md, Owner setup, step 5.2). The next deploy adds it.`;
}

async function retry(what, fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || e.final) throw e;
      console.error(`${what}: ${e.message}; trying again`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}
async function call(url, init) {
  const r = await fetch(url, init);
  if (r.ok) return r.json();
  const e = new Error(`HTTP ${r.status} from ${new URL(url).host}: ${(await r.text()).slice(0, 300).replace(/\s+/g, ' ')}`);
  e.final = r.status >= 400 && r.status < 500 && r.status !== 429;
  throw e;
}
/* an access token for the service account key: a signed JWT exchanged at Google's token endpoint */
async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
  const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud, iat: now, exp: now + 600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(body), key.private_key).toString('base64url');
  const j = await call(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }) });
  return j.access_token;
}

export async function check(project, key) {
  let api = null, granted = null;
  try {
    const token = await retry('token', () => accessToken(key)), auth = { authorization: `Bearer ${token}` };
    try {
      api = (await retry('API state', () => call(`https://serviceusage.googleapis.com/v1/projects/${project}/services/${API}`, { headers: auth }))).state || null;
    } catch (e) { console.error(`Could not read whether ${API} is on: ${e.message}`); }
    try {
      granted = (await retry('permissions', () => call(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`,
        { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ permissions: NEEDED }) }))).permissions || [];
    } catch (e) { console.error(`Could not test the service account's permissions: ${e.message}`); }
  } catch (e) { console.error(`Could not sign in as the service account: ${e.message}`); }
  return { api, granted, ...verdict(api, granted) };
}

async function main() {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const project = opt('--project'), envDir = opt('--env-dir') || 'functions', keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!project || !keyPath) { console.error('schedule-ready.mjs: --project <id> and GOOGLE_APPLICATION_CREDENTIALS are needed'); process.exit(2); }
  const r = await check(project, JSON.parse(readFileSync(keyPath, 'utf8')));
  writeFileSync(join(envDir, `.env.${project}`), envLine(r.ready));
  const line = r.ready
    ? `Scheduled functions go out with this deploy to ${project}${r.why ? ` (${r.why})` : ''}.`
    : warning(project, r.why);
  if (!r.ready) console.log(`::warning title=Front page figures not scheduled::${line}`);
  else console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Scheduled functions\n\n${line}\n\n`, { flag: 'a' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
