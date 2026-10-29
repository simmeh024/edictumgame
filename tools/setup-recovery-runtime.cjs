// Run once as a project owner. Default is read-only; --apply enables token signing on the runtime itself.
// Uses Firebase CLI authentication without printing or exporting credentials.
const path = require('node:path');
const base = path.join(__dirname, '../node_modules/firebase-tools/lib');
(async () => {
  const index = process.argv.indexOf('--project'), project = index >= 0 ? process.argv[index + 1] : '';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Use --project <Firebase project ID> [--apply].');
  const account = require(base + '/auth').getGlobalDefaultAccount();
  await require(base + '/requireAuth').requireAuth({ ...(account || {}), project });
  const { Client } = require(base + '/apiv2');
  const functions = new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2', auth: true });
  const runtime = (await functions.get(`/projects/${project}/locations/europe-west1/functions/referee`)).body.serviceConfig.serviceAccountEmail;
  if (!runtime || !runtime.endsWith('.gserviceaccount.com')) throw new Error('Cannot identify the existing game runtime.');
  const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1', auth: true });
  const resource = `/projects/-/serviceAccounts/${runtime}`;
  const policy = (await iam.post(resource + ':getIamPolicy', {})).body;
  const member = 'serviceAccount:' + runtime, role = 'roles/iam.serviceAccountTokenCreator';
  const existing = (policy.bindings || []).find(b => b.role === role && !b.condition && b.members?.includes(member));
  const apis = require(base + '/ensureApiEnabled');
  const api = await apis.check(project, 'iamcredentials.googleapis.com', 'recovery', true);
  if (process.argv.includes('--apply')) {
    if (!api) await apis.ensure(project, 'iamcredentials.googleapis.com', 'recovery');
    if (!existing) {
      policy.bindings ||= [];
      const binding = policy.bindings.find(b => b.role === role && !b.condition);
      if (binding) binding.members.push(member); else policy.bindings.push({ role, members: [member] });
      // Preserve the policy etag and every existing binding. Grant is on this one service account only.
      await iam.post(resource + ':setIamPolicy', { policy });
    }
  }
  console.log(JSON.stringify({ project, runtime, signingApi: api || process.argv.includes('--apply'), selfTokenCreator: !!existing || process.argv.includes('--apply') }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
