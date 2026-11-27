// Sacking edicts for the admin portal's Statistics page (functions/admin.js, op 'stats', the Content tab): which fates
// players choose for the officials they sack, how often they keep them instead, and which sacking edicts come up most.
// One nation's sackings (rowSack) ride on functions/stats.js nationRow as `sack`; sackSummary counts a world or a region.
// Pure: it reads the record as the game keeps it (game/edictum.html, "sacking edicts": n.skc counts by fate and 'keep',
// n.skd the last 30 sacked officials, n.skr rehired, n.skh hired from other nations, n.ska asylum seekers taken in).
export const DAY = 86400000;
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const arr = v => Array.isArray(v) ? v : [];
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
/* the fates, in the game's order (SK_SHELF); the last ten only for some governments */
export const SK_FATES = ['handshake', 'backbench', 'lighthouse', 'ambassador', 'mayor', 'trial', 'jail', 'museum', 'tv', 'memoir', 'opposition', 'goatfarm', 'asylum', 'disguise', 'sinecure',
  'vanish', 'erase', 'reeducate', 'recall', 'collective', 'auction', 'pilgrimage', 'duke', 'ignored', 'committee'];
const OK = new Set(SK_FATES.concat('keep'));

export function rowSack(r, now = Date.now()) {
  const c = {}, src = obj(r.skc) || {};
  for (const [k, v] of Object.entries(src)) if (OK.has(k) && num(v) > 0) c[k] = Math.min(1e5, Math.round(num(v)));
  const L = arr(r.skd).filter(e => e && OK.has(e.f) && num(e.t) > 0);
  const recent = L.filter(e => e.t > now - 30 * DAY).map(e => [e.f, String(e.id || '').slice(0, 40), e.k === 'g' || e.k === 'y' ? e.k : 'm']);
  if (!Object.keys(c).length && !recent.length) return {};
  return { sack: { c, recent, back: Math.round(num(r.skr)), hired: arr(r.skh).length, asylum: arr(r.ska).length } };
}

export function sackSummary(R) {
  const fates = {}, f30 = {}, kind = { m: 0, g: 0, y: 0 }, ids = {};
  let nations = 0, keep = 0, sacked = 0, back = 0, hired = 0, asylum = 0;
  for (const x of R) {
    const s = x.sack; if (!s) continue;
    nations++;
    for (const [k, v] of Object.entries(s.c || {})) { if (k === 'keep') keep += v; else { add(fates, k, v); sacked += v; } }
    for (const [f, id, k] of s.recent || []) { add(f30, f); kind[k] = (kind[k] || 0) + 1; if (id) add(ids, id); }
    back += s.back || 0; hired += s.hired || 0; asylum += s.asylum || 0;
  }
  const top = Object.entries(ids).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12);
  return { nations, sacked, keep, fates, f30, kind, top, back, hired, asylum };
}
