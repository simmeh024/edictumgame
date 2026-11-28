/* Reputation (28 November 2026): one public label for a player's nation, judged from what every player and the server
   can see: the region's treaties (treaties/, read by everyone) and the shared half of the nation's record (its log,
   gifts, gift replies, treasury pledges, calls to arms answered and embassies). Computer nations weigh it when they
   are asked to sign a treaty (functions/treaties.js): a nation in good standing needs a little less affinity, a
   warmonger more. The game keeps the same rules (repFacts/repKey in game/edictum.html, the section
   "reputation"); test/reputation.test.mjs checks that the two agree. */
export const DAY = 86400000;
/* what counts: the last 30 days, gifts the last 14; a treaty is kept once in force 14 days; a nation is new for 7 */
export const REP_WIN = 30 * DAY, REP_GIFT_WIN = 14 * DAY, REP_KEEP_AGE = 14 * DAY, REP_NEW = 7 * DAY;
/* the labels, first that fits wins */
export const REP_KEYS = ['oath', 'war', 'peace', 'ally', 'keeper', 'generous', 'connected', 'new', 'iso', 'steady'];
export const REP_NAME = { oath: 'Oathbreaker', war: 'Warmonger', peace: 'Peacemaker', ally: 'Steadfast Ally', keeper: 'Treaty Keeper',
  generous: 'Generous', connected: 'Well Connected', new: 'Untested', iso: 'Isolationist', steady: 'Steady' };
/* how much more (or less) affinity a computer nation asks of each before it signs a treaty (an Oathbreaker signs
   nothing at all for 30 days, as before; an Isolationist pays nothing for keeping to itself, so a first treaty is
   never dearer than it was) */
export const REP_NEED = { oath: 0, war: 10, peace: -5, ally: -5, keeper: -5, generous: -5, connected: -5, new: 0, iso: 0, steady: 0 };

const num = v => Number(v) || 0;
const list = v => (Array.isArray(v) ? v : []);
/* the facts: treaties is every treaty doc the nation is party to (a previous founding's are left out) */
export function repFacts(rec, treaties, id, now) {
  rec = rec && typeof rec === 'object' ? rec : {};
  const fd = num(rec.founded), inWin = (t, w) => { t = num(t); return t > 0 && t <= now && now - t < w; };
  const T = list(treaties).filter(t => t && Array.isArray(t.p) && t.p.includes(id) && !(t.f && t.f[id] && fd && num(t.f[id]) !== fd));
  const live = T.filter(t => t.st === 'active' || (t.st === 'ending' && now < num(t.end)));
  const broke = T.filter(t => t.st === 'broken' && t.by === id && inWin(t.bt, REP_WIN)).length;
  const kept = live.filter(t => now - num(t.at || t.t) >= REP_KEEP_AGE).length;
  const log = list(rec.log).filter(l => l && typeof l === 'object');
  const wars = log.filter(l => l.k === 'war' && inWin(l.t, REP_WIN)).length;
  const peace = log.filter(l => l.k === 'peace' && inWin(l.t, REP_WIN)).length;
  const gifts = list(rec.gft).filter(g => g && inWin(g.t, REP_GIFT_WIN)).length + list(rec.gfr).filter(g => g && inWin(g.t, REP_GIFT_WIN)).length;
  const given = list(rec.gft).filter(g => g && inWin(g.t, REP_WIN)).length + list(rec.gfr).filter(g => g && inWin(g.t, REP_WIN)).length;
  const pledges = list(rec.alp).filter(p => p && inWin(p.t, REP_WIN)).length;
  const calls = list(rec.cta).filter(c => c && inWin(c.t, REP_WIN)).length;
  const ems = rec.ems && typeof rec.ems === 'object' && !Array.isArray(rec.ems) ? rec.ems : {};
  const missions = Object.values(ems).filter(m => m && typeof m === 'object' && num(m.l) >= 1).length;
  return { broke, kept, live: live.length, wars, peace, gifts, given, pledges, calls, missions, age: fd ? Math.max(0, now - fd) : 0 };
}
export function repKey(f) {
  if (f.broke) return 'oath';
  if (f.wars >= 3 || (f.wars >= 2 && !f.peace)) return 'war';
  if (f.peace >= 2 && !f.wars) return 'peace';
  if (f.calls >= 2) return 'ally';
  if (f.kept >= 2) return 'keeper';
  if (f.gifts + f.pledges >= 6) return 'generous';
  if (f.missions >= 2) return 'connected';
  if (f.age < REP_NEW) return 'new';
  if (!f.live && !f.given && !f.pledges && !f.missions && !f.wars && !f.calls && !f.peace) return 'iso';
  return 'steady';
}
export const repOf = (rec, treaties, id, now) => repKey(repFacts(rec, treaties, id, now));
