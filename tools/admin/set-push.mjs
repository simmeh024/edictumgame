// Set up push notifications for letters for a Firebase project (functions/letters.js).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-push.mjs
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-push.mjs --subject mailto:herald@edictumgame.com
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-push.mjs --off
//
// Makes a new pair of VAPID keys (the Web Push standard's own; no Firebase Cloud Messaging needed) and keeps them in
// Firestore at authConfig/push {pub, priv, subject}, which only the Cloud Functions read (firestore.rules). Players
// can then turn on notifications in Settings › Letters. Running it again makes new keys, and every device has to
// turn notifications on again, so do it once. --off removes the keys; the game then says notifications are not set
// up. With FIRESTORE_EMULATOR_HOST set this talks to the emulator.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';

const args = process.argv.slice(2), off = args.includes('--off'), force = args.includes('--new');
const si = args.indexOf('--subject'), subject = si >= 0 ? String(args[si + 1] || '').trim() : 'mailto:herald@edictumgame.com';
if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) { console.error('--subject is mailto:address or an https:// address.'); process.exit(2); }
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON file.'); process.exit(2); }
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-edictum' } : { credential: applicationDefault() });
const ref = getFirestore().doc('authConfig/push');
try {
  if (off) { await ref.delete(); console.log('Push notifications are switched off. Devices that had them stay listed until they are turned on again.'); process.exit(0); }
  const had = await ref.get();
  if (had.exists && !force) { console.log('Push notifications are already set up. Run with --new to replace the keys (every device then turns them on again).'); process.exit(0); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pj = publicKey.export({ format: 'jwk' }), sj = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, 'base64url'), Buffer.from(pj.y, 'base64url')]).toString('base64url');
  await ref.set({ pub, priv: sj.d, subject, at: Date.now() });
  console.log('Push notifications are set up. Players can turn them on in Settings › Letters.');
} catch (e) { console.error('Could not save the set-up: ' + e.message); process.exit(1); }
