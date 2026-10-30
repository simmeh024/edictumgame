// Set up Discord sign-in for a Firebase project (functions/discord.js; README.md, Owner setup, step 3b).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-discord.mjs <client id>
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-discord.mjs --off
//
// It asks for the application's client secret (from the Discord Developer Portal, OAuth2 page) and keeps
// both in Firestore at authConfig/discord, which only the Cloud Functions read (firestore.rules). With
// --origins https://a.example,https://b.example it also sets the web addresses allowed to sign in with
// Discord; by default those are https://edictumgame.com, <project>.web.app and <project>.firebaseapp.com.
// Each needs <address>/discord as a redirect in the Discord application. --off removes the set-up, and
// the game then says Discord sign-in is not set up. With FIRESTORE_EMULATOR_HOST set, this talks to the
// Firestore emulator instead and needs no key.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const off = args.includes('--off');
const oi = args.indexOf('--origins'), origins = oi >= 0 ? String(args[oi + 1] || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean) : null;
const clientId = args.find((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
if (!off && !/^\d{5,25}$/.test(clientId || '')) {
  console.error('Usage: node set-discord.mjs <client id> [--origins https://a.example,https://b.example] | --off');
  process.exit(2);
}
if (origins && !origins.every(o => /^https:\/\/[a-z0-9.-]+$/i.test(o))) {
  console.error('Origins are https:// addresses without a path, separated by commas.');
  process.exit(2);
}
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON file.');
  process.exit(2);
}
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-edictum' } : { credential: applicationDefault() });
const ref = getFirestore().doc('authConfig/discord');
try {
  if (off) {
    await ref.delete();
    console.log('Discord sign-in is switched off. Accounts already linked keep their link for when it is back.');
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const secret = (process.env.DISCORD_CLIENT_SECRET || await rl.question('Client secret: ')).trim();
    rl.close();
    if (!/^[\w-]{16,128}$/.test(secret)) { console.error('That does not look like a Discord client secret.'); process.exit(2); }
    await ref.set({ clientId, secret, ...(origins ? { origins } : {}), at: Date.now() });
    console.log(`Discord sign-in is set up with application ${clientId}. Reload the game; "Continue with Discord" works at once.`);
  }
} catch (e) {
  console.error('Could not save the set-up: ' + e.message);
  process.exit(1);
}
