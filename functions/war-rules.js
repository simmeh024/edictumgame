/* War, round two (game/edictum.html, "war, round two"): what the referee (functions/index.js) reads in two nations'
   records, kept apart so the tests can run it (test/war-round-two.test.mjs). SIEGE_MS, SIEGE_MAX and PEACE_AUTO_MS
   match the game's. */
export const SIEGE_MS = 24 * 3600000, SIEGE_MAX = 72 * 3600000, PEACE_AUTO_MS = 30 * 3600000;
const GRACE_MS = 3 * 86400000, SHIELD_MS = 7 * 86400000;
export const num = v => typeof v === 'number' && isFinite(v) ? v : 0;
/* the war between two records as the game reads it (pairWar): declared by either side and not ended since, by both
   offering peace, by an offer left unanswered PEACE_AUTO_MS, or by a surrender ({surr: true}); g the declarer's aim
   ('c' when none: a war from before the aims), offA whether the first record has offered peace */
export function warOf(mine, uid, foe, d, now) {
  const dA = num(mine.wars?.[d]?.t), dB = num(foe.wars?.[uid]?.t), decl = Math.max(dA, dB);
  if (!decl) return null;
  const pA = num(mine.peace?.[d]), pB = num(foe.peace?.[uid]);
  if (pA > decl && pB > decl) return null;
  const off = pA > decl ? pA : pB > decl ? pB : 0;
  if (off && now >= off + PEACE_AUTO_MS) return null;
  if (Math.max(num(mine.surr?.[d]), num(foe.surr?.[uid])) > decl) return { surr: true };
  const w = dA && (!dB || dA <= dB) ? mine.wars[d] : foe.wars[uid];
  return { since: decl, g: w && ['b', 'c', 'r'].includes(w.g) ? w.g : 'c', offA: pA > decl };
}
/* a nation nobody may attack now: in its grace after coming back (grc, GRACE_MS at most), or in the days after it rose
   again (shd, SHIELD_MS after its founding at most); the game's wrShielded */
export function shielded(n, now) {
  const g = n && n.grc;
  if (g && now >= num(g.t) && now <= num(g.u) && num(g.u) - num(g.t) <= GRACE_MS + 60000) return true;
  return !!n && num(n.shd) > now && num(n.shd) <= num(n.founded) + SHIELD_MS + 60000;
}
