// Deploy (.github/workflows/deploy.yml) puts only main's newest commit live.
//
// Runs queue one at a time (concurrency deploy-live), but nothing stopped an older commit's run from going last: a
// re-run of an earlier failed deploy, or a run that waited behind a newer merge. On 6 Nov 2026 a re-run of #148's
// failed deploy finished a minute after #149's and put the older build, rules and functions back live; the owner saw
// no update. Deploy now asks GitHub for main's newest commit first. Its own commit: it deploys. An older one: nothing
// is deployed, with a yellow warning that names the newer commit, whose own run deploys it (re-run that one instead).
// If main's newest commit cannot be read, the run fails red rather than deploy blind.
//
//   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo GITHUB_SHA=<sha> node scripts/deploy-newest.mjs
//
// Writes go=true|false to $GITHUB_OUTPUT and, when skipped, says why in $GITHUB_STEP_SUMMARY.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

/* main's newest commit, asked up to `tries` times (a passing GitHub hiccup should not fail a deploy) */
export async function tipOf({ repo, token, branch = 'main', fetchImpl = fetch, tries = 3, wait = 2000 }) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise(r => setTimeout(r, wait * i));
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'edictum-deploy', ...(token ? { authorization: 'Bearer ' + token } : {}) }
      });
      if (!r.ok) { last = new Error(`GitHub answered ${r.status} when asked for ${branch}'s newest commit`); if (r.status === 404) break; continue; }
      const sha = (await r.json())?.object?.sha;
      if (typeof sha === 'string' && SHA.test(sha)) return sha;
      last = new Error(`GitHub's answer for ${branch} named no commit`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`${branch}'s newest commit could not be read`);
}

/* → {go, tip, msg}: go when this run's commit is main's newest */
export async function verdict({ sha, ...ask }) {
  if (!SHA.test(String(sha || ''))) throw new Error('This run names no commit (GITHUB_SHA).');
  const tip = await tipOf(ask);
  if (tip === sha) return { go: true, tip, msg: '' };
  return { go: false, tip, msg: `Nothing was deployed: this run is for ${sha.slice(0, 7)}, but main is now at ${tip.slice(0, 7)}, whose own Deploy run puts it live. Deploying this older commit would put an older build, rules and functions live over the newer ones. To deploy again, re-run the Deploy run of ${tip.slice(0, 7)} (or Run workflow on main).` };
}

async function main() {
  const out = process.env.GITHUB_OUTPUT, summary = process.env.GITHUB_STEP_SUMMARY;
  const put = (file, text) => { if (file) appendFileSync(file, text); };
  try {
    const v = await verdict({ sha: process.env.GITHUB_SHA, repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    put(out, `go=${v.go}\n`);
    if (v.go) console.log(`Deploying ${process.env.GITHUB_SHA.slice(0, 7)}, main's newest commit.`);
    else { console.log(`::warning title=Deploy skipped::${v.msg}`); put(summary, `### Deploy skipped\n\n${v.msg}\n`); }
  } catch (e) {
    const msg = `Nothing was deployed: main's newest commit could not be read (${e && e.message || e}), so this run cannot tell whether a newer one has gone live. Re-run it in a moment.`;
    console.log(`::error title=Deploy stopped::${msg}`); put(summary, `### Deploy stopped\n\n${msg}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
