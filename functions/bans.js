// Timed bans. An admin's ban runs until they lift it, or for a set number of days (functions/admin.js, BAN_DAYS):
// a timed one keeps `until` beside its note in bans/{uid}.
//
// The account is banned while the document exists, exactly as it always was — firestore.rules checks existence alone,
// so no nation save pays for an extra read — and a ban that has run out is lifted rather than evaluated: by the
// player's own game on its next load (functions/accounts.js, 'banExpired'), or by the sweep the alerts job runs every
// fifteen minutes for the players who never come back (functions/alerts.js).
//
// This module imports nothing. The alerts job (jobs/stats) installs its own packages and never functions/, so anything
// it reaches has to live on the Firestore handle it is given.
/* a ban whose term has passed: still a document, no longer a ban */
export const banOver = (until, now = Date.now()) => !!until && until <= now;

/* Lifting a ban: the ban itself and the marks on the sign-ins it used, so the account may play again and a new one on
   those sign-ins is not banned on sight (functions/eligibility.js, refuseBannedIdentity). An admin's Unban does the
   same work under their own name; this is the term running out, recorded as `ban_expired` with `system` as the actor.
   `at` is what the audit event is stamped with — a server timestamp where one is to hand, else the time of the run.
   Whether the ban is there, and whether it has run out, is for the caller to check. */
export async function liftBan(db, uid, { reason = 'The ban ran out', at = new Date() } = {}) {
  const ban = await db.doc('bans/' + uid).get();
  const name = String(ban.get('name') || '').slice(0, 80);
  await db.doc('bans/' + uid).delete();
  const marks = await db.collection('banIds').where('u', '==', uid).get();
  if (!marks.empty) { const b = db.batch(); marks.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  await db.collection('adminAudit').doc().set({ actor: 'system', action: 'ban_expired', target: uid, ...(name ? { name } : {}),
    reason, outcome: 'completed', at });
  return { uid, name };
}

/* Every timed ban whose term has passed. A handful at a time: there are never many, and a long run must not hold up
   whatever called it. One that fails is left for the next run. */
export async function sweepBans(db, now = Date.now(), limit = 50) {
  const due = await db.collection('bans').where('until', '>', 0).where('until', '<=', now).limit(limit).get().catch(() => ({ docs: [] }));
  const lifted = [];
  for (const d of due.docs) { try { lifted.push(await liftBan(db, d.id, { at: new Date(now) })); } catch { /* the next run tries again */ } }
  return lifted;
}
