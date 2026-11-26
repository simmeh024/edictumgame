// Opt in per Firebase project so existing deployments do not need a Discord secret.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { dispatchMessages, isPublication, nonceFor, sendPart } from './discord-dispatch-core.js';

const token = defineSecret('DISCORD_BOT_TOKEN');
const LEASE_MS = 60000;

export async function deliverDispatch(event, { db, key, channelId, send = sendPart }) {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!isPublication(before, after)) return;
  const id = event.params.postId;
  const postRef = db.doc(`devnews/${id}`);
  const receipt = db.doc(`discordDispatch/${id}`);
  const owner = randomUUID();
  const publicationTime = after.t;
  if (!Number.isFinite(publicationTime)) throw new Error('Dispatch has no publication time');
  if (!key || !/^\d{15,22}$/.test(channelId)) throw new Error('Discord token or channel ID is not configured');

  const claimed = await db.runTransaction(async tx => {
    const [current, previous] = await Promise.all([tx.get(postRef), tx.get(receipt)]);
    // Ignore a delayed event for a post since withdrawn or republished.
    if (!current.exists || current.get('pub') !== true || current.get('t') !== publicationTime) return false;
    const saved = previous.data();
    // A post is announced once, including if later withdrawn and republished.
    if (saved?.done) return false;
    // Do not resume an older, partially delivered publication as if it were the new version.
    if (saved && saved.publicationTime !== publicationTime) {
      console.error('A previous publication was only partly delivered; manual review is required', { id });
      return false;
    }
    if (saved?.leaseUntil > Date.now()) throw new Error('Dispatch is already being delivered');
    const messages = saved?.messages || dispatchMessages(id, after);
    tx.set(receipt, { messages, next: saved?.next || 0, publicationTime: saved?.publicationTime ?? publicationTime,
      leaseOwner: owner, leaseUntil: Date.now() + LEASE_MS, done: false }, { merge: true });
    return true;
  });
  if (!claimed) return;

  try {
    while (true) {
      const saved = (await receipt.get()).data();
      if (!saved || saved.leaseOwner !== owner) throw new Error('Dispatch delivery lease lost');
      if (saved.next >= saved.messages.length) {
        await receipt.update({ done: true, completedAt: Date.now(), leaseUntil: 0 });
        return;
      }
      // Renew before each network call, then persist each successful part independently.
      await receipt.update({ leaseUntil: Date.now() + LEASE_MS });
      await send({ token: key, channelId, content: saved.messages[saved.next],
        nonce: nonceFor(id, saved.publicationTime, saved.next) });
      await receipt.update({ next: saved.next + 1, leaseUntil: Date.now() + LEASE_MS });
    }
  } catch (error) {
    await db.runTransaction(async tx => {
      const snap = await tx.get(receipt);
      if (snap.exists && snap.get('leaseOwner') === owner) tx.update(receipt, { leaseUntil: 0 });
    });
    throw error;
  }
}

export const discordDispatch = process.env.EDICTUM_DISCORD_ENABLED !== 'true' ? undefined : onDocumentWritten({
  document: 'devnews/{postId}',
  region: 'europe-west1',
  secrets: [token],
  retry: true,
  timeoutSeconds: 540,
  maxInstances: 1,
  concurrency: 1,
}, event => deliverDispatch(event, { db: getFirestore(), key: token.value(),
  channelId: process.env.EDICTUM_DISCORD_CHANNEL_ID || '' }));
