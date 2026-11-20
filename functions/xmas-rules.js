/* Christmas on Willow Street (xmas-2026): what the server holds a nation's Christmas answers to. game/edictum.html keeps
   the same calendar and the same pieces (XM_EV and the letters' cz, section "Christmas on Willow Street"), and
   test/xmas.test.mjs checks that the two copies agree.

   The answers live in the shared record as n.xm {id, c: [{id, o, t, f}]}: letter (0 the note of 30 November, 1 to 25
   the letters), answer (0 to 2), when, and the government it was written to. functions/civic.js (permit) calls xmSettle
   on every save before it approves it, by the server's clock:
     - an answer already saved stays exactly as saved: a save cannot change it, take it back or drop it;
     - a new one is kept only if its letter has arrived (XM_EV, xmAt), the calendar has not closed (an answer made
       before the close may still be on its way in a save for XM_GRACE), it follows the last letter answered (the note
       of 30 November stands apart), and its answer is 0, 1 or 2;
     - the pieces for Customise the record lists as held (n.cz.u) keep only the Christmas ones its answers earn, so
       another player's game never shows a piece that was not earned.
   It says how many it kept ({n: letters 1 to 25, p: 1 if the note}), and the game takes back an answer the region did
   not keep. The materials an answer gives are the game's to add, like every other income: they are bounded by the
   letters (a letter is answered once) and by the game's own audit of what a record may hold (xsMax). */
const DAY = 86400000;
export const XM_EV = { id: 'xmas-2026', pre: Date.UTC(2026, 10, 30), start: Date.UTC(2026, 11, 1), days: 25, close: Date.UTC(2027, 0, 7) };
export const XM_GRACE = 3600000;
/* the pieces everyone who answers a letter receives, and letter 20's star by its answer */
export const XM_CZ = { 5: ['e-gingerstar'], 10: ['ps-bauble'], 15: ['p-frost'], 20: ['c-willowstar'],
  24: ['tb-fairy', 'pn-xtree', 'p-wrapping', 'ls-x-holly', 't-lamplighter'], 25: ['te-lights', 'sh-snowcap', 'a-holly', 'cd-willow', 'rp-papercrown'] };
export const XM_STARS = ['e-xstar-ada', 'e-xstar-craft', 'e-xstar-street'];
export const XM_IDS = new Set([...Object.values(XM_CZ).flat(), ...XM_STARS]);
export const XM_FAMS = ['rep', 'crn', 'imp', 'sul', 'the', 'peo', 'col', 'bor'];
export const xmAt = d => d === 0 ? XM_EV.pre : XM_EV.start + (d - 1) * DAY;
/* the server's clock; under the emulator a test may move it (EDICTUM_XMAS_SHIFT, milliseconds) to any day of the calendar */
export const xmNowMs = () => Date.now() + (process.env.FUNCTIONS_EMULATOR === 'true' ? Number(process.env.EDICTUM_XMAS_SHIFT) || 0 : 0);

/* a record's answers as the game reads them (xmNorm): well formed, one per letter, in order, none after a gap */
export function xmClean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== XM_EV.id || !Array.isArray(raw.c)) return [];
  const seen = new Set(), c = [];
  for (const e of raw.c.slice(0, 40)) {
    if (!e || typeof e !== 'object') continue;
    const { id, o } = e;
    if (!Number.isInteger(id) || id < 0 || id > XM_EV.days || seen.has(id) || !Number.isInteger(o) || o < 0 || o > 2 || !Number.isFinite(e.t) || e.t <= 0) continue;
    seen.add(id);
    const x = { id, o, t: Math.round(e.t) };
    if (typeof e.f === 'string' && XM_FAMS.includes(e.f)) x.f = e.f;
    c.push(x);
  }
  c.sort((a, b) => a.id - b.id);
  const out = []; let next = 1;
  for (const x of c) { if (x.id === 0) { out.push(x); continue; } if (x.id !== next) break; out.push(x); next++; }
  return out;
}
/* the Christmas pieces a list of answers earns */
export function xmEarned(c) {
  const out = new Set();
  for (const x of c) { for (const id of XM_CZ[x.id] || []) out.add(id); if (x.id === 20 && XM_STARS[x.o]) out.add(XM_STARS[x.o]); }
  return out;
}
/* n: the record to be saved (changed in place); before: the saved one; now: the server's time */
export function xmSettle(n, before, now) {
  if (!n || typeof n !== 'object') return { n: 0, p: 0 };
  const kept = xmClean(before && before.xm), has = new Set(kept.map(x => x.id));
  const asked = xmClean(n.xm);
  for (const x of asked) {
    if (has.has(x.id)) continue;
    const done = kept.filter(y => y.id > 0).length;
    const inTime = now >= xmAt(x.id) && now < XM_EV.close + XM_GRACE && x.t < XM_EV.close && x.t <= now + DAY;
    const inOrder = x.id === 0 || x.id === done + 1;
    if (inTime && inOrder) { kept.push(x); has.add(x.id); }
  }
  kept.sort((a, b) => a.id - b.id);
  if (kept.length) n.xm = { id: XM_EV.id, c: kept }; else delete n.xm;
  if (n.cz && typeof n.cz === 'object' && Array.isArray(n.cz.u)) {
    const earned = xmEarned(kept);
    n.cz.u = n.cz.u.filter(id => !XM_IDS.has(id) || earned.has(id));
  }
  return { n: kept.filter(x => x.id > 0).length, p: kept.some(x => x.id === 0) ? 1 : 0 };
}
