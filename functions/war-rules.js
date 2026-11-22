import { rsWar } from './research-rules.js';
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

/* Military buildings (22 November 2026; game/edictum.html, "military buildings"): what readiness the attacker's own
   record allows. A finished Drill Ground (drillyard) brings each point back MIL_DRILL sooner, MIL_DRILL_UG more for each upgrade
   block; a finished Arsenal (armoury) holds one point more, two with all five blocks; veterans in the reserve (war, round three:
   vet {k: 'res', t, u}) one more. Read from the record, whoever holds the city now, so never less than the game
   allows (the game counts only the ones in cities it holds). */
export const MIL_DRILL = 0.2, MIL_DRILL_UG = 0.02;
/* the upgrade blocks of the best finished building k in a record's cities (0 to 5), or -1 with none */
export function milBlocks(rec, k, now) {
  let best = -1;
  for (const c of Array.isArray(rec && rec.cities) ? rec.cities.slice(0, 200) : []) {
    for (const b of Array.isArray(c && c.b) ? c.b.slice(0, 40) : []) {
      if (!b || b.k !== k || !(num(b.d) <= now)) continue;
      let u = Number.isInteger(b.ug) && b.ug >= 1 && b.ug <= 5 ? b.ug : 0;
      if (b.uu && b.uu.u === u + 1 && u < 5 && num(b.uu.d) > 0 && num(b.uu.d) <= now) u++;
      if (u > best) best = u;
    }
  }
  return best;
}
/* {cut, extra, rcut}: the share by which a point returns sooner, the points held beyond the rest, and the share
   research takes off a point's time before the Drill Ground's cut (the game's readyMs wrappers run in that order:
   functions/research-rules.js rsWar) */
export function milReady(rec, now) {
  const d = milBlocks(rec, 'drillyard', now), a = milBlocks(rec, 'armoury', now), v = rec && rec.vet;
  const vet = !!v && v.k === 'res' && num(v.t) <= now && num(v.u) > now, rs = rsWar(rec);
  return { cut: d >= 0 ? MIL_DRILL + MIL_DRILL_UG * d : 0, extra: (a >= 5 ? 2 : a >= 0 ? 1 : 0) + (vet ? 1 : 0) + rs.extra, rcut: rs.rcut };
}
/* a point's time with the cut, rounded as the game rounds it (after a training pact's) */
export const milMs = (ms, cut) => cut > 0 ? Math.round(ms * (1 - cut)) : ms;
