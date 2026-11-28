// Deploy puts only main's newest commit live (scripts/deploy-newest.mjs, .github/workflows/deploy.yml): an older
// commit's run, such as a re-run of an earlier failed deploy, is skipped instead of putting an older build back live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verdict, tipOf } from '../scripts/deploy-newest.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ask = (fetchImpl, more = {}) => ({ repo: 'o/r', token: 't', fetchImpl, wait: 1, ...more });

test('its own commit deploys; an older one is skipped, naming the newer one to re-run', async () => {
  assert.deepEqual(await verdict({ sha: A, ...ask(answer(200, { object: { sha: A } })) }), { go: true, tip: A, msg: '' });
  const v = await verdict({ sha: A, ...ask(answer(200, { object: { sha: B } })) });
  assert.equal(v.go, false); assert.equal(v.tip, B);
  assert.match(v.msg, /this run is for aaaaaaa, but main is now at bbbbbbb/);
  assert.match(v.msg, /re-run the Deploy run of bbbbbbb/);
});

test('it asks for main by the GitHub API with the run’s token', async () => {
  let url = '', headers = {};
  await tipOf(ask(async (u, o) => { url = u; headers = o.headers; return { ok: true, status: 200, json: async () => ({ object: { sha: A } }) }; }));
  assert.equal(url, 'https://api.github.com/repos/o/r/git/ref/heads/main');
  assert.equal(headers.authorization, 'Bearer t');
});

test('a passing hiccup is asked again; a tip that cannot be read stops the deploy', async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? { ok: false, status: 502, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ object: { sha: A } }) });
  assert.equal(await tipOf(ask(flaky)), A); assert.equal(n, 3);
  await assert.rejects(tipOf(ask(answer(500, {}))), /500/);
  let m = 0;
  await assert.rejects(tipOf(ask(async () => { m++; return { ok: false, status: 404, json: async () => ({}) }; })), /404/);
  assert.equal(m, 1, 'a missing branch is not asked again');
  await assert.rejects(tipOf(ask(answer(200, { object: { sha: 'not a sha' } }))), /named no commit/);
  await assert.rejects(tipOf(ask(async () => { throw new Error('offline'); })), /offline/);
  await assert.rejects(verdict({ sha: '', ...ask(answer(200, { object: { sha: A } })) }), /names no commit/);
});

test('the workflow checks right after checking out, and every deploying step waits for its go', () => {
  const wf = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  /* the job's steps, one block each (the workflow's own layout: six spaces, "- name:") */
  const steps = wf.split(/\n(?=      - name: )/).slice(1).map(b => ({ name: b.match(/- name: (.+)/)[1], b }));
  const i = steps.findIndex(s => /\n {8}id: newest\n/.test(s.b));
  assert.ok(i > 0, 'the check is there');
  assert.equal(steps[i - 1].name, 'Check out', 'right after the checkout, before anything is installed');
  assert.match(steps[i].b, /\n {8}run: node scripts\/deploy-newest\.mjs\n/);
  assert.match(steps[i].b, /\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  assert.match(wf, /\npermissions:\n {2}contents: read\n/, 'reading main needs no more than the workflow has');
  const after = steps.slice(i + 1);
  assert.ok(after.length >= 5);
  for (const s of after) assert.match(s.b, /\n {8}if: steps\.settings\.outputs\.ready == 'true' && steps\.newest\.outputs\.go == 'true'\n/, `${s.name} waits for the go`);
  assert.match(wf, /\nconcurrency:\n {2}group: deploy-live\n {2}cancel-in-progress: false\n/, 'a deploy under way is never cut off');
});
