// The flag competition's one prize the server gives itself: the winner's month of the Chancery Club. The goods are
// the player's own game's to add, from the public results (game/edictum.html). The shop is loaded only when a
// competition closes, so the civic function starts no heavier for it.
export async function fcAward(db, id, uid, now) {
  if (!uid) return { ok: false };
  const { grantPrizeMonth } = await import('./shop.js');
  return grantPrizeMonth(uid, 'fc-' + id, now);
}
