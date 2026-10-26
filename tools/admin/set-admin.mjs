// Make a player an admin of Edictum (or stop them being one).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-admin.mjs you@gmail.com
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-admin.mjs <player id> --remove
//
// The player is found by the email of their linked Google account, or by the Player ID shown in
// the game's account menu. Admins see "Remove" on everyone's region message board posts.
// The claim reaches the game when the player's sign-in token renews: sign out and back in with
// Google from the account menu (or wait up to an hour).
//
// The service account key is the same JSON that goes in the FIREBASE_SERVICE_ACCOUNT secret.
// Keep it out of the repository. With FIREBASE_AUTH_EMULATOR_HOST set, this talks to the Auth
// emulator instead and needs no key.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const who = args.find(a => !a.startsWith('--'));
const remove = args.includes('--remove');
if (!who) {
  console.error('Usage: node set-admin.mjs <email or player id> [--remove]');
  process.exit(2);
}
const emulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON file.');
  process.exit(2);
}
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-edictum' } : { credential: applicationDefault() });
const auth = getAuth();
try {
  const user = who.includes('@') ? await auth.getUserByEmail(who) : await auth.getUser(who);
  const claims = { ...(user.customClaims || {}) };
  if (remove) delete claims.admin; else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${user.email || user.uid} (player id ${user.uid}) is ${remove ? 'no longer an admin' : 'now an admin'}.`);
  console.log('In the game: open the account menu, sign out, and sign back in with Google.');
} catch (e) {
  console.error('Could not set the claim: ' + (e.errorInfo ? e.errorInfo.message : e.message));
  process.exit(1);
}
