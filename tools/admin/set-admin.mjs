// Make a player an admin of Edictum (or stop them being one).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-admin.mjs you@gmail.com
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-admin.mjs <player id> --remove
//
// The player is found by the email of their linked Google account, or by the Player ID shown in
// the game's account menu. Admins see "Remove" on everyone's region message board posts, and a
// purple Admin pill beside their nation's name that opens the admin portal. The game asks for a
// fresh sign-in token on every load, so the player only needs to reload the page.
//
// The service account key is the same JSON that goes in the FIREBASE_SERVICE_ACCOUNT secret.
// Keep it out of the repository. With FIREBASE_AUTH_EMULATOR_HOST set, this talks to the Auth
// emulator instead and needs no key.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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
  /* staff/<uid> shows other players this nation is staff; the admin's own page writes it, and clears it
     once the right is gone, but taking it away here does so at once */
  if (remove) await getFirestore().doc('staff/' + user.uid).delete().catch(e => console.warn('Could not clear the staff mark: ' + e.message));
  console.log(`${user.email || user.uid} (player id ${user.uid}) is ${remove ? 'no longer an admin' : 'now an admin'}.`);
  console.log(remove ? 'Other players no longer see the nation marked as Edictum staff.'
    : 'In the game: reload the page (no need to sign out). The Admin pill appears beside the nation’s name, and other players see it marked as Edictum staff.');
} catch (e) {
  console.error('Could not set the claim: ' + (e.errorInfo ? e.errorInfo.message : e.message));
  process.exit(1);
}
