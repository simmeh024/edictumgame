/* The rules of treaties between two nations that the server (functions/treaties.js), the referee (functions/index.js)
   and the game must agree on. game/edictum.html keeps the same tables (TR_RULES, beside AL), and test/treaties.test.mjs
   checks that the two copies match.

   A treaty is treaties/{k}_{lo}_{hi}: one of each kind between the same two nations, whoever offered it.
     {k, reg, p: [lo, hi], a (who offered), b, st, t (offered), at (signed), end (notice runs out), bt (broken), by, f, npc}
     st 'offered' until b accepts; 'active' once signed; 'ending' while the notice runs (in force until end); 'broken'
     when a side broke it at once (by), kept TR_RECORD_MS on that side's record. f {uid: founded} holds each player's
     nation as it signed: a nation founded again (dissolved, restarted) is not bound by its old treaties. */
const DAY = 86400000;
export const TR_KINDS = ['nap', 'trade', 'research', 'drill'];
/* the most of each kind a nation holds at once (in force, or offered by it) */
export const TR_MAX = { nap: 8, trade: 3, research: 3, drill: 3 };
/* ending a treaty takes notice; a broken one stays on the breaker's record, and the two wait before signing again */
export const TR_NOTICE = 3 * DAY, TR_RECORD = 30 * DAY, TR_REOFFER = 7 * DAY;
/* the affinity a computer nation needs to sign each kind */
export const TR_NPC_MIN = { nap: 35, trade: 50, research: 60, drill: 55 };
/* breaking: goodwill the breaker loses with the other side, and with every computer nation and every nation it already
   has a record with */
export const TR_BREAK_GW = { other: 15, all: 5 };
/* what each does: a trade agreement's deals flow 10% more and pay no import tariffs; each research pact adds 1%
   prosperity, counted for at most three. Joint military training (drill, 20 November 2026) works while one side has a
   Barracks: army strength +2% for each side (base), up to 4% more for the side whose partner's army is the stronger
   (more, all of it once the partner's is twice as strong), +1% for a side with a Barracks (host), the best three
   counted (max); each side's training uses food and iron a day (up), and the boost shrinks with a shortage of either.
   Attacks get half the boost. Each pact readies an army 5% sooner (ready), and binds like a non-aggression pact
   (TR_PEACE). Whoever breaks one gives the other side 10% in battles between the two (edge) while it is on the
   breaker's record (TR_RECORD). */
export const TR_FX = { flow: 0.1, research: 0.01, researchMax: 3,
  drill: { base: 0.02, more: 0.04, host: 0.01, max: 3, up: { food: 1, iron: 0.5 }, ready: 0.05, edge: 0.1 } };
/* the kinds under which neither side may fight the other */
export const TR_PEACE = ['nap', 'drill'];
/* the minutes between readiness points, for an army under k pacts of joint training */
export const trReadyMs = (ms, k) => k > 0 ? Math.round(ms * (1 - TR_FX.drill.ready * Math.min(k, TR_FX.drill.max))) : ms;
export const trId = (k, a, b) => k + '_' + (a < b ? a + '_' + b : b + '_' + a);
/* in force: signed and not ended (a notice runs until end) */
export const trLive = (T, now) => !!T && (T.st === 'active' || (T.st === 'ending' && now < (Number(T.end) || 0)));
/* a nation founded again since it signed is not bound: recs {id: its record as saved} for the parties at hand */
export function trVoid(T, recs) {
  for (const [id, f] of Object.entries((T && T.f) || {})) {
    const r = recs[id];
    if (f && r && Number(r.founded) > 0 && Number(r.founded) !== f) return true;
  }
  return false;
}
