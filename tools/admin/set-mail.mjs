// Set up Letters by post for a Firebase project (functions/mail-core.js; docs/mail.md).
//
//   cd tools/admin && npm ci
//   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-mail.mjs
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-mail.mjs --from "The Herald of Edictum <herald@edictumgame.com>"
//   GOOGLE_APPLICATION_CREDENTIALS=... node set-mail.mjs --off
//
// Asks for the Resend API key (not shown as you type it; or RESEND_API_KEY) and keeps it in Firestore at
// authConfig/mail, which only the Cloud Functions and the mail job read (firestore.rules). --off removes it, and
// the game then says letters are not set up. With FIRESTORE_EMULATOR_HOST set this talks to the emulator.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const args = process.argv.slice(2), off = args.includes('--off');
const fi = args.indexOf('--from'), from = fi >= 0 ? String(args[fi + 1] || '').trim() : '';
if (fi >= 0 && !/^[^<>]*<[^\s@<>]+@[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+$/.test(from)) { console.error('--from is "Name <address>" or an address.'); process.exit(2); }
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON file.'); process.exit(2); }
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-edictum' } : { credential: applicationDefault() });
const ref = getFirestore().doc('authConfig/mail');
try {
  if (off) { await ref.delete(); console.log('Letters by post are switched off. Confirmed addresses are kept for when they are back.'); process.exit(0); }
  let key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    let muted = false;
    const out = new Writable({ write(c, e, done) { if (!muted) process.stdout.write(c); done(); } });
    const rl = createInterface({ input: process.stdin, output: out, terminal: !!process.stdin.isTTY });
    process.stdout.write('Resend API key (not shown): '); muted = true;
    key = String((await rl[Symbol.asyncIterator]().next()).value || '').trim();
    muted = false; process.stdout.write('\n'); rl.close();
  }
  if (!/^re_[\w-]{10,}$/.test(key)) { console.error('That does not look like a Resend API key (it starts with re_).'); process.exit(2); }
  await ref.set({ key, ...(from ? { from } : {}), at: Date.now() }, { merge: true });
  console.log('Letters by post are set up. Players can confirm an address in Settings at once.');
} catch (e) { console.error('Could not save the set-up: ' + e.message); process.exit(1); }
