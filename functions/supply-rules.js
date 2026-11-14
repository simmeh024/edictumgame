/* The rules of Supply Caches that the server (functions/supply.js) and the game must agree on. game/edictum.html keeps
   the same table (SC_RULES, with the section "supply caches"), and test/supply.test.mjs checks that the two copies match.

   A player sends a player of the same region a Supply Cache: up to SC_MAX materials in any mix of the five resources,
   taken from the sender's stockpile, with a message of up to SC_MSG characters. Up to SC_DAY caches a UTC day. Only a
   Registered Nation (a linked sign-in, not a guest) sends caches, and any nation receives them. The
   sender's nation must be SC_AGE old (a nation founded only to pass on its starting stock waits a day). A cache the
   server has not filed within SC_OLD is refused, and its materials go back. A cache waits SC_KEEP to be opened. */
const DAY = 86400000;
export const SC_RES = ['food', 'timber', 'iron', 'oil', 'goods'];
export const SC_DAY = 3, SC_MAX = 300, SC_MSG = 200;
export const SC_AGE = DAY, SC_OLD = 7 * DAY, SC_KEEP = 30 * DAY;
/* a cache's id in the sender's record (scx), and its document's id (supply/{uid}_{id}) */
export const SC_ID = /^[a-z0-9]{6,16}$/;
export const SC_DOC = /^[\w-]{1,128}_[a-z0-9]{6,16}$/;
/* the UTC day a moment falls on, as the game's survey caches count days */
export const scDay = t => Math.floor(t / DAY);
export const scTotal = r => Object.values(r || {}).reduce((s, v) => s + (Number(v) || 0), 0);
/* the contents as whole numbers of known resources (none at 0), or null when it is empty, over the limit or malformed */
export function scContents(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(r)) {
    if (!SC_RES.includes(k) || !Number.isInteger(v) || v < 0 || v > SC_MAX) return null;
    if (v) { out[k] = v; total += v; }
  }
  return total > 0 && total <= SC_MAX ? out : null;
}
