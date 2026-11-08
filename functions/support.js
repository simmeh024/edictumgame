/* Support tickets as a conversation (the Help page, src/shim.js supportApi; the admin portal's Help queries page).

   A player creates support/{id} {by, topic, x, t, st: 'open', name?, reg?, email?} straight from the browser
   (firestore.rules, validTicket). Everything after that is written here, with the server's time:
     m    [{a: 'p' | 's', x, t: ms, by?}]: the replies after the first message, the player's ('p') and the team's
          ('s', by the admin's uid), oldest first, at most MAX_MSGS
     w    'p' while the team waits for the player; absent while the player waits for the team (as on a new ticket)
     pc   the player's messages since the team last wrote, at most IN_A_ROW
     lt   the server time of the latest message
     st   'open' | 'closed'; a closed ticket has ct (when), rby (who: the player themself, or an admin) and exp
          (Firestore deletes it then, KEEP_DAYS after closing). A ticket closed before replies existed may carry
          the team's answer in `reply` instead of m.
   The player's half runs inside the accounts callable (functions/accounts.js), which needs no new public function:
     accounts({op: 'support', step: 'reply', id, x}) → {ok: true, reopened}: writes back; a ticket closed in the
                                                       last REOPEN_DAYS opens again
     accounts({op: 'support', step: 'close', id})    → {ok: true}: the player says they need nothing more
   The team's half is functions/admin.js (moderate: support_reply, support_answer, support_close, support_reopen,
   support_delete), each in the audit log. */
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { refuse } from './eligibility.js';

const DAY = 86400000;
export const SUPPORT = Object.freeze({ MAX_MSGS: 40, IN_A_ROW: 3, REOPEN_DAYS: 14, KEEP_DAYS: 90, LEN: 2000 });

/* what someone wrote: line breaks kept (as \n), other control characters dropped */
export const supportText = v => typeof v === 'string'
  ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, SUPPORT.LEN) : '';
const ticketId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '';
const msOf = v => v && typeof v.toMillis === 'function' ? v.toMillis() : Number(v) || 0;
const thread = s => Array.isArray(s.get('m')) ? s.get('m') : [];
const closing = (who, now) => ({ st: 'closed', ct: FieldValue.serverTimestamp(), rby: who, exp: Timestamp.fromMillis(now + SUPPORT.KEEP_DAYS * DAY), w: FieldValue.delete() });
const opening = () => ({ st: 'open', ct: FieldValue.delete(), rby: FieldValue.delete(), exp: FieldValue.delete() });

export async function supportStep(db, uid, d) {
  const id = ticketId(d.id);
  if (!id) throw new HttpsError('invalid-argument', 'Choose a ticket.');
  if (d.step !== 'reply' && d.step !== 'close') throw new HttpsError('invalid-argument', 'Unknown support step.');
  const ref = db.doc('support/' + id), now = Date.now(), x = d.step === 'reply' ? supportText(d.x) : '';
  if (d.step === 'reply' && !x) throw new HttpsError('invalid-argument', 'Write your reply first.');
  return db.runTransaction(async tx => {
    const s = await tx.get(ref);
    // someone else's ticket answers exactly as a missing one does
    if (!s.exists || s.get('by') !== uid) refuse('support_gone', 'This ticket is no longer there. Load the page again.');
    const open = s.get('st') === 'open';
    if (d.step === 'close') {
      if (!open) return { ok: true };
      tx.update(ref, closing(uid, now));
      return { ok: true };
    }
    const m = thread(s), pc = Number(s.get('pc')) || 0;
    if (!open && now - msOf(s.get('ct')) > SUPPORT.REOPEN_DAYS * DAY) refuse('support_old', `This ticket was closed more than ${SUPPORT.REOPEN_DAYS} days ago. Create a new ticket instead.`);
    if (m.length >= SUPPORT.MAX_MSGS) refuse('support_full', 'This ticket has as many replies as a ticket can hold. Create a new ticket to go on.');
    if (pc >= SUPPORT.IN_A_ROW) refuse('support_wait', 'You have written three times in a row. Wait for the team to answer before you write again.');
    tx.update(ref, { m: [...m, { a: 'p', x, t: now }], pc: pc + 1, lt: FieldValue.serverTimestamp(), w: FieldValue.delete(), ...(open ? {} : opening()) });
    return { ok: true, reopened: !open };
  });
}

/* the team's half, from functions/admin.js inside its audit record; `reply` is already trimmed text */
export async function supportAdmin(db, actor, action, target, reply) {
  const ref = db.doc('support/' + target), now = Date.now();
  if (action === 'support_delete') { await ref.delete(); return; }
  reply = supportText(reply);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('failed-precondition', 'This ticket was deleted.');
    const open = s.get('st') === 'open', m = thread(s);
    if (action === 'support_reopen') {
      if (open) throw new HttpsError('failed-precondition', 'This ticket is already open.');
      tx.update(ref, { ...opening(), w: FieldValue.delete() });
      return;
    }
    if (!open) throw new HttpsError('failed-precondition', 'This ticket is already closed or removed.');
    if ((action === 'support_reply' || action === 'support_answer') && !reply) throw new HttpsError('invalid-argument', 'Write an answer first.');
    if (reply && m.length >= SUPPORT.MAX_MSGS) throw new HttpsError('failed-precondition', 'This ticket has as many replies as it can hold. Close it; the player can create a new one.');
    const said = reply ? { m: [...m, { a: 's', x: reply, t: now, by: actor }], pc: 0, lt: FieldValue.serverTimestamp() } : {};
    if (action === 'support_reply') tx.update(ref, { ...said, w: 'p' });
    else tx.update(ref, { ...said, ...closing(actor, now) });
  });
}
