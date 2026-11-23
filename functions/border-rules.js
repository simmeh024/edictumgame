/* The rules of border agreements that the server (functions/borders.js) and the game must agree on. game/edictum.html
   keeps the same table (BD_RULES, beside TY_RULES), and test/borders.test.mjs checks that the two copies match.

   A border agreement is borders/{bid}: two to four nations of one region agree which of them may claim which hexes.
     {reg, p: [ids], a (who sent this version), acc: [ids that accepted it], v (version), st, t (sent), at (signed),
      dur (days, 0 = no end), exp (runs out, 0 = never), rn: [ids that asked to renew], end (notice runs out),
      bt, by, bc (broken: when, by whom, the hex claimed), s: {id: [hexes on its side]}, buf: [hexes nobody claims],
      sw: [{id, by, to, g (by gives), k (by gets), t, st 'offered'|'done', at}], f: {id: founded},
      cv (the map version its hexes are numbered on, the sending game's MAP_VER; none before 23 Nov 2026),
      why, vt (void: 'declined' or 'withdrawn', when; by says who)}
   st 'offered' until every nation has accepted the latest version (a counter-proposal is a new version, accepted by
   its sender only); 'active' once all have; 'ending' while a notice runs; 'broken' when a nation claimed past it;
   'void' when a nation declined it or its sender withdrew it, kept for a while so the others hear of it (until 23 Nov
   2026 it was deleted at once, and a proposal turned down vanished from every side with no word).
   A side may hold land, lake or sea hexes. */
const DAY = 86400000;
export const BD_RULES = {
  /* nations in one agreement, hexes in one, agreements a nation holds (in force or waiting) */
  maxP: 4, maxCells: 1500, max: 6,
  /* how long one lasts, in days (0: until ended) */
  durs: [30, 90, 0],
  /* reminder before it runs out; notice to end one; a broken one stays on the record */
  warn: 3 * DAY, notice: 3 * DAY, record: 30 * DAY,
  /* goodwill a breaker loses with each other side */
  breakGw: 10,
  /* hex swaps waiting at once in one agreement */
  swaps: 3,
  /* how long a declined or withdrawn proposal is kept, so the other sides are told */
  told: 7 * DAY
};
/* in force: signed, not run out, not ended */
export function bdLive(B, now) {
  if (!B) return false;
  if (B.st === 'active') return !(Number(B.exp) > 0) || now < Number(B.exp);
  return B.st === 'ending' && now < (Number(B.end) || 0) && (!(Number(B.exp) > 0) || now < Number(B.exp));
}
/* finished: run out, notice over, a break off the record, or a proposal turned down long enough ago (removed when next
   written) */
export function bdDone(B, now) {
  if (!B) return true;
  if (B.st === 'broken') return now - (Number(B.bt) || 0) >= BD_RULES.record;
  if (B.st === 'active' || B.st === 'ending') return !bdLive(B, now);
  if (B.st === 'void') return now - (Number(B.vt) || 0) >= BD_RULES.told;
  return false;
}
/* a nation founded again since it signed is not bound */
export function bdVoid(B, recs) {
  for (const [id, f] of Object.entries((B && B.f) || {})) {
    const r = recs[id];
    if (f && r && Number(r.founded) > 0 && Number(r.founded) !== f) return true;
  }
  return false;
}
/* the shape of a drawn border: each nation's side and the buffer, every hex at most once; null if it will not do */
export function bdShape(p, s, buf) {
  if (!Array.isArray(p) || p.length < 2 || p.length > BD_RULES.maxP) return null;
  const hex = c => Number.isInteger(c) && c >= 0 && c < 1e6, seen = new Set(), out = {};
  let n = 0;
  for (const id of p) {
    const L = s && Array.isArray(s[id]) ? s[id] : [];
    out[id] = [];
    for (const c of L) { if (!hex(c) || seen.has(c)) return null; seen.add(c); out[id].push(c); n++; }
  }
  const B = [];
  for (const c of Array.isArray(buf) ? buf : []) { if (!hex(c) || seen.has(c)) return null; seen.add(c); B.push(c); n++; }
  if (!n || n > BD_RULES.maxCells) return null;
  /* every nation has some side, or the agreement says nothing about it */
  if (p.some(id => !out[id].length)) return null;
  return { s: out, buf: B };
}
/* whose side a hex is on: an id, 'buf' for the buffer, or '' */
export function bdSideOf(B, c) {
  for (const id of B.p || []) if ((B.s && B.s[id] || []).includes(c)) return id;
  return (B.buf || []).includes(c) ? 'buf' : '';
}
