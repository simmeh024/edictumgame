// The deploy's check for scheduled functions (scripts/schedule-ready.mjs): a project without the Cloud Scheduler API or
// the roles to create a schedule gets the functions without homeLive and a warning, instead of a failed deploy (on
// 20 Nov 2026 the staging preview failed three times: "Permissions denied enabling cloudscheduler.googleapis.com").
// Also what firebase-tools itself would find in functions/ with the switch on and off, through firebase-functions'
// own discovery (the manifest firebase-tools reads), and the two workflows that run the check before deploying.
// Run with: npm run test:fx
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, check, envLine, warning, NEEDED, API } from '../scripts/schedule-ready.mjs';

test('only a clear "API off" or "permissions missing" holds the schedule back', () => {
  assert.deepEqual(verdict('ENABLED', NEEDED), { ready: true, why: '' });
  assert.equal(verdict('DISABLED', NEEDED).ready, false);
  assert.match(verdict('DISABLED', null).why, /API is off/);
  const lacking = verdict('ENABLED', NEEDED.filter(p => !p.startsWith('run.')));
  assert.equal(lacking.ready, false);
  assert.match(lacking.why, /run\.services\.getIamPolicy, run\.services\.setIamPolicy/);
  assert.match(lacking.why, /Cloud Run Admin/);
  /* a check that could not be made leaves it to the deploy, so a hiccup never deletes a running schedule (--force) */
  assert.equal(verdict(null, NEEDED).ready, true);
  assert.equal(verdict('ENABLED', null).ready, true);
  assert.equal(verdict(null, null).ready, true);
  assert.equal(envLine(false), 'EDICTUM_SCHEDULES=off\n');
  assert.equal(envLine(true), 'EDICTUM_SCHEDULES=on\n');
  const w = warning('edictum-staging', 'the Cloud Scheduler API is off in this project');
  assert.ok(w.includes(`https://console.cloud.google.com/apis/library/${API}?project=edictum-staging`), 'links the API page of that project');
  assert.ok(w.includes('iam-admin/iam?project=edictum-staging'));
});

test('the check signs in as the service account and reads the API and its own permissions', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'deploy@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
  const real = globalThis.fetch, seen = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const run = async (state, perms) => {
    globalThis.fetch = async (url, init = {}) => {
      seen.push(url);
      if (url === key.token_uri) {
        const jwt = new URLSearchParams(init.body).get('assertion').split('.');
        const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
        assert.equal(claims.iss, key.client_email);
        assert.equal(jwt.length, 3);
        return reply(200, { access_token: 'tok' });
      }
      assert.equal(init.headers.authorization, 'Bearer tok');
      if (url.includes('serviceusage')) return state instanceof Error ? reply(403, { error: state.message }) : reply(200, { state });
      if (url.includes('testIamPermissions')) { assert.deepEqual(JSON.parse(init.body).permissions, NEEDED); return reply(200, perms ? { permissions: perms } : {}); }
      throw new Error('unexpected ' + url);
    };
    try { return await check('edictum-staging', key); } finally { globalThis.fetch = real; }
  };
  const staging = await run('DISABLED', NEEDED.slice(0, 3));
  assert.equal(staging.ready, false);
  assert.match(staging.why, /API is off/, 'the API first: firebase-tools stops there');
  assert.ok(seen.some(u => u.endsWith(`/projects/edictum-staging/services/${API}`)));
  assert.equal((await run('ENABLED', NEEDED)).ready, true);
  assert.equal((await run('ENABLED', undefined)).ready, false, 'no permissions held: missing all of them');
  assert.equal((await run(new Error('denied'), NEEDED)).ready, true, 'the API state unreadable: the deploy decides');
});

test('switched off, the functions firebase-tools finds have no schedule and need no Cloud Scheduler API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edictum-manifest-'));
  const bin = fileURLToPath(new URL('../functions/node_modules/firebase-functions/lib/bin/firebase-functions.js', import.meta.url));
  /* as firebase-tools runs it: in the functions folder (the binary reads a folder argument only beside a second one) */
  const manifest = sched => {
    const out = join(dir, `m-${sched}.json`);
    execFileSync(process.execPath, [bin], { cwd: fileURLToPath(new URL('../functions/', import.meta.url)), stdio: 'pipe',
      env: { PATH: process.env.PATH, HOME: process.env.HOME || '', FUNCTIONS_MANIFEST_OUTPUT_PATH: out, ...(sched ? { EDICTUM_SCHEDULES: sched } : {}) } });
    return JSON.parse(readFileSync(out, 'utf8'));
  };
  try {
    const on = manifest(''), off = manifest('off');
    const apis = m => (m.requiredAPIs || []).map(a => a.api);
    assert.ok(on.endpoints.homeLive && on.endpoints.homeLive.scheduleTrigger, 'on (no env file): the schedule is there');
    assert.ok(apis(on).includes(API));
    assert.equal(off.endpoints.homeLive, undefined, 'off: no homeLive');
    assert.ok(on.endpoints.haaleshExileClock?.scheduleTrigger,'on: the exile server clock is scheduled');
    assert.equal(off.endpoints.haaleshExileClock,undefined,'off: no exile server clock');
    assert.ok(!apis(off).includes(API), 'and firebase-tools has no Cloud Scheduler API to switch on');
    assert.deepEqual(Object.keys(off.endpoints).sort(), Object.keys(on.endpoints).filter(k => !['homeLive','haaleshExileClock'].includes(k)).sort(), 'every other function still goes out');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both workflows run the check right before they deploy the functions', () => {
  for (const f of ['deploy.yml', 'preview.yml']) {
    const wf = readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8');
    const i = wf.indexOf('node scripts/schedule-ready.mjs --project "$PROJECT_ID"'), j = wf.indexOf('npx firebase deploy --only functions');
    assert.ok(i > 0 && j > i && !wf.slice(i, j).includes('- name:'), `${f}: the check, then the functions deploy, in one step`);
    assert.ok(wf.slice(i - 200, i).includes('GOOGLE_APPLICATION_CREDENTIALS="$key"'), `${f}: with the deploy's key`);
  }
});
