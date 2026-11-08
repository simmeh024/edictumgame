/* nations/{uid} keeps a nation's shared half as JSON text: v 1 in j (a string), v 2 deflated in z (bytes), which is a
   fifth of the size or less, so every player in the region downloads less at every save (docs/cost-test.md). Readers
   take either; the save permit (civic.js) writes z. Only node:zlib here, so the stats job can import it. */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const field = (d, k) => (d && typeof d.get === 'function' ? d.get(k) : d ? d[k] : undefined);

/* the JSON text of a nations/ document (snapshot or its data), or null */
export function nationText(d) {
  const j = field(d, 'j');
  if (typeof j === 'string') return j; // j first, as src/shim.js reads it: the rules never let a save hold both
  const z = field(d, 'z');
  if (z && z.length) {
    try { return inflateRawSync(Buffer.from(z.buffer ? new Uint8Array(z.buffer, z.byteOffset || 0, z.byteLength) : z)).toString('utf8'); } catch { return null; }
  }
  return null;
}

export const deflateNation = j => deflateRawSync(Buffer.from(j, 'utf8'), { level: 9 });
