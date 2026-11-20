// The front page's live figures every five minutes (functions/home.js, runHome): Cloud Scheduler calls this function,
// which writes home/live and its memory homeState/main, the same run as `node jobs/stats/home.mjs`.
//
// GitHub Actions ran it at first (.github/workflows/home.yml, cron every five minutes), but GitHub starts this
// repository's scheduled workflows only every five to nine hours whatever the cron says (measured 20 Nov 2026: the
// figures were "late" within the hour). The workflow stays for a run by hand, on live or staging.
//
// Deploying it needs, once per project (README.md, Owner setup, step 5): the Cloud Scheduler API switched on, and the
// roles Cloud Scheduler Admin and Cloud Run Admin on the deploy's service account. Without them the functions deploy
// fails ("Failed to set the IAM Policy on the Service", "upsert schedule") and nothing after it is deployed.
// Cloud Scheduler calls it as the project's default compute service account, the one the other functions run as.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { runHome } from './home.js';
import DATA from './civic-data.json' with { type: 'json' };

export const HOME_SCHEDULE = '*/5 * * * *';

/* the regions as runHome wants them ({id, npcs: [{id, name}]}): the game's own list, which the save permit checks too */
export const homeRegions = (data = DATA) => (data.regions || []).map(R => ({ id: R.id, npcs: (R.npcs || []).map(x => ({ id: x.id, name: x.name })) }));

export const homeLive = onSchedule({
  schedule: HOME_SCHEDULE,
  timeZone: 'Etc/UTC',
  region: 'europe-west1',
  memory: '512MiB',
  timeoutSeconds: 240,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  /* a run that fails is not retried: the next one, five minutes on, starts from the memory the last good one wrote */
  const report = await runHome(getFirestore(), { regions: homeRegions(), Timestamp });
  logger.info('home/live written', report);
});
