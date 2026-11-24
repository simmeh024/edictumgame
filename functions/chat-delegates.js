// Chat marks describe the current office, even on old lines or in another region's chat.
// Read each author's current region and ask the protected Assembly engine once per region.
import { HttpsError } from 'firebase-functions/v2/https';

export async function chatDelegates(db, ids, regions, chairOf) {
  if (!Array.isArray(ids) || ids.length > 80 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id))) {
    throw new HttpsError('invalid-argument', 'Choose up to 80 chat authors.');
  }
  const authors = [...new Set(ids)], badges = Object.fromEntries(authors.map(id => [id, '']));
  if (!authors.length) return { badges };
  const nations = await db.getAll(...authors.map(id => db.doc('nations/' + id)));
  const home = new Map(nations.filter(s => s.exists && regions.has(s.get('reg'))).map(s => [s.id, s.get('reg')]));
  const chairs = new Map(await Promise.all([...new Set(home.values())].map(async reg => [reg, await chairOf(reg)])));
  for (const [id, reg] of home) if (chairs.get(reg) === id) badges[id] = reg;
  return { badges };
}
