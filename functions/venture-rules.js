/* The rules of joint ventures that the server (functions/ventures.js) and the game must agree on. game/edictum.html keeps
   the same table (JV_RULES, beside TY_RULES), and test/ventures.test.mjs checks that the two copies match.

   A joint venture is a border road, a border railway or a toll bridge that two neighbouring nations build together, each
   paying JV_COST[k] (its half). It is ventures/{uid}_{id}, filed by the nation that proposes it (uid):
     {k, reg, p: [lo, hi], a (proposed it), b, ca (a's end: a city, or for a bridge a's hex at the river), cb (b's end),
      path (the hexes from ca to cb; a bridge's is [ca, cb]), st, t (proposed), x (the offer lapses), at (accepted),
      d (built), end (notice runs out), by (who declined, withdrew or ended it), f {uid: founded}, npc, exp}
   st 'offered' until b accepts (by x); 'active' once accepted (built from d); 'ending' while the notice runs (in force
   until end); 'declined' when b declined or a withdrew it. A declined or ended venture stays JV_KEEP (Firestore's TTL on
   exp), so both games see how it ended and settle what they paid: a half paid for a venture never accepted comes back.
   f {uid: founded} holds each player's nation as it joined: a nation founded again is not bound by its old ventures.

   The payment is the Supply Caches' pattern (functions/supply.js): the game's save takes the half from the stockpile and
   lists it in the record (jvp, the shared half), and the server reads it there, so nothing is proposed or accepted that
   was not paid for. a's entry {id, w:'a', k, to, ca, cb, path, t} carries the whole proposal; b's {v (the venture's
   document id), w:'b', k, t}. Each side's game, not the server, works out what a venture gives: only while the route's
   hexes still belong to the two nations, neither is at war with the other, and it is built. */
const DAY = 86400000;
export const JV_KINDS = ['road', 'rail', 'bridge'];
/* what each side pays for its half (the owner's numbers, 16 Nov 2026) */
export const JV_COST = { road: { iron: 120, goods: 20, food: 250 }, rail: { goods: 50, iron: 80, timber: 400 }, bridge: { timber: 120, iron: 60 } };
/* hours to build, once accepted */
export const JV_HOURS = { road: 6, rail: 12, bridge: 4 };
/* the most a nation takes part in at once: offered by or to it, being built, open, or under notice */
export const JV_MAX = 5;
/* an offer waits two days for an answer; ending one takes notice; a finished one is kept two months */
export const JV_ANSWER = 2 * DAY, JV_NOTICE = 3 * DAY, JV_KEEP = 60 * DAY;
/* a half packed in the record must be filed within a day, or it comes back */
export const JV_OLD = DAY;
/* the affinity a computer nation needs to join one, and the goodwill a nation loses with the other by ending one */
export const JV_NPC_MIN = 45, JV_LEAVE_GW = 10;
/* a road or railway runs at most this many steps between its two cities */
export const JV_PATH = 16;
/* what each gives both sides while it is open: a share more output in the city at each end, deals between the two flowing
   a share more, and a bridge's tolls a day */
export const JV_FX = { road: { city: 0.04, flow: 0.05 }, rail: { city: 0.08, flow: 0.05 }, bridge: { toll: { goods: 8, timber: 4 } } };
/* a venture's id in the proposer's record (jvp), and its document's id (ventures/{uid}_{id}) */
export const JV_ID = /^[a-z0-9]{6,16}$/;
export const JV_DOC = /^[\w-]{1,128}_[a-z0-9]{6,16}$/;

const num = v => Number(v) || 0;
/* accepted and not ended (a notice runs until end) */
export const jvLive = (V, now) => !!V && (V.st === 'active' || (V.st === 'ending' && now < num(V.end)));
/* an offer still waiting for its answer */
export const jvWaiting = (V, now) => !!V && V.st === 'offered' && now < num(V.x);
/* what counts against a nation's limit */
export const jvHolds = (V, now) => jvLive(V, now) || jvWaiting(V, now);
/* a nation founded again since it joined is not bound: recs {id: its record as saved} for the parties at hand */
export function jvVoid(V, recs) {
  for (const [id, f] of Object.entries((V && V.f) || {})) {
    const r = recs[id];
    if (f && r && Number(r.founded) > 0 && Number(r.founded) !== f) return true;
  }
  return false;
}
/* a proposal's route as the record holds it: [ca, ..., cb] of whole hex numbers, two for a bridge, 2 to JV_PATH + 1 for a
   road or railway, no hex twice; null when malformed */
export function jvRoute(k, ca, cb, path) {
  const cell = v => Number.isInteger(v) && v >= 0 && v < 1e7;
  if (!JV_KINDS.includes(k) || !cell(ca) || !cell(cb) || ca === cb || !Array.isArray(path) || !path.every(cell)) return null;
  if (path[0] !== ca || path[path.length - 1] !== cb || new Set(path).size !== path.length) return null;
  if (k === 'bridge' ? path.length !== 2 : path.length < 2 || path.length > JV_PATH + 1) return null;
  return path.slice();
}
