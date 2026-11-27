/* The recruits' pact (27 November 2026): for RC_PACT after a recruit is filed (recruits/<uid> {r, t},
   functions/recruit.js), the recruit and the player who recruited them may not go to war with each other, either way.
   The save permit refuses the declaration (functions/civic.js, permit) and the referee any battle between the two
   (functions/index.js, battle: why 'rcpact'); the game says so in the war box (game/edictum.html, rcPactUntil). Only a
   record filed since the pact began binds (p 1: a game always knows its own, so it never commits a declaration the
   permit would refuse), and not one held for a staff check or refused (h). */
export const RC_PACT = 30 * 86400000;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
/* until when the record `rec` (a recruits/ snapshot of one side) binds it to `other`, or 0 */
export function rcPactUntil(rec, other, now = Date.now()) {
  if (!rec || !rec.exists || rec.get('r') !== other || rec.get('p') !== 1 || rec.get('h')) return 0;
  const until = ms(rec.get('t')) + RC_PACT;
  return until > now ? until : 0;
}
