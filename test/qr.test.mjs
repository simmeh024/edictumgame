// The QR code on the invitation card (game/edictum.html, section "recruiting": qrMatrix, qrRS): its Reed-Solomon
// code against the textbook "HELLO WORLD" 1-M example, and every symbol read back by an independent decoder written
// here (format words, the standard's alignment table, unmasking, de-interleaving, syndromes, byte mode).
// Run with: node --test test/qr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const a = html.indexOf('/* ── a QR code for the recruiting link'), b = html.indexOf('function rcCardSoon(', a);
assert.ok(a > 0 && b > a, 'the QR code section');
const ctx = { TextEncoder, Math, Array, String }; vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + ';this.Q={qrMatrix,qrRS};', ctx);
const { qrMatrix, qrRS } = ctx.Q;
const ok = (n, c, i) => test(n, () => assert.ok(c, i));

ok('Reed-Solomon: "HELLO WORLD" 1-M gives the textbook error correction words',
  JSON.stringify(qrRS([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)) === JSON.stringify([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]));
/* an independent decoder: GF arithmetic by log tables, syndromes by evaluating at powers of alpha */
const EXP = new Array(512), LOG = new Array(256); { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
const synd = (cw, n) => { const s = []; for (let i = 0; i < n; i++) { let v = 0; for (const c of cw) v = gmul(v, EXP[i]) ^ c; s.push(v); } return s; };
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }; // from the standard's table
function decode(M) {
  const N = M.length, v = (N - 17) / 4; if (!Number.isInteger(v)) return { err: 'size' };
  /* format: around the top-left finder, read, then checked against all 32 valid words */
  let f = 0; const fb = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  fb.forEach(([x, y], i) => { if (M[y][x]) f |= 1 << i; });
  let best = null; for (let d = 0; d < 32; d++) { let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const w = ((d << 10) | r) ^ 0x5412; let h = 0, z = w ^ f; while (z) { h += z & 1; z >>>= 1; } if (!best || h < best.h) best = { d, h }; }
  if (best.h) return { err: 'format bits ' + best.h + ' off' };
  const ecl = best.d >> 3, mask = best.d & 7; if (ecl !== 0) return { err: 'not level M' };
  /* which modules are data: everything but finders+separators, timing, alignment, format, version, dark module */
  const fn = (x, y) => {
    if ((x < 9 && y < 9) || (x >= N - 8 && y < 9) || (x < 9 && y >= N - 8)) return true;
    if (x === 6 || y === 6) return true;
    const A = ALIGN[v] || []; for (const ay of A) for (const ax of A) { if ((ax === 6 && ay === 6) || (ax === 6 && ay === A[A.length - 1]) || (ay === 6 && ax === A[A.length - 1])) continue; if (Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true; }
    if (v >= 7 && ((x >= N - 11 && x <= N - 9 && y < 6) || (y >= N - 11 && y <= N - 9 && x < 6))) return true;
    return false;
  };
  const MK = [(x, y) => (y + x) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (y + x) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((y * x) % 2) + ((y * x) % 3) === 0, (x, y) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0, (x, y) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0][mask];
  const bits = [];
  for (let col = N - 1, up = true; col > 0; col -= 2, up = !up) { if (col === 6) col--; for (let i = 0; i < N; i++) { const y = up ? N - 1 - i : i; for (const x of [col, col - 1]) if (!fn(x, y)) bits.push(M[y][x] !== MK(x, y) ? 1 : 0); } }
  const raw = []; for (let i = 0; i + 8 <= bits.length; i += 8) raw.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  /* de-interleave into blocks and check each one's syndromes */
  const nb = BLK[v], ec = ECC[v], total = Math.floor(raw.length), sLen = Math.floor(total / nb), nShort = nb - total % nb;
  const blocks = Array.from({ length: nb }, (_, i) => ({ d: [], e: [], dl: sLen - ec + (i < nShort ? 0 : 1) }));
  let k = 0; for (let i = 0; i < sLen - ec + 1; i++) for (const b of blocks) if (i < b.dl) b.d.push(raw[k++]);
  for (let i = 0; i < ec; i++) for (const b of blocks) b.e.push(raw[k++]);
  for (const b of blocks) if (synd(b.d.concat(b.e), ec).some(s => s)) return { err: 'syndromes' };
  const data = blocks.flatMap(b => b.d), db = data.flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (b >> i) & 1));
  const rd = (s, n) => db.slice(s, s + n).reduce((a, b) => a * 2 + b, 0);
  if (rd(0, 4) !== 4) return { err: 'mode ' + rd(0, 4) };
  const cl = v < 10 ? 8 : 16, len = rd(4, cl), out = []; for (let i = 0; i < len; i++) out.push(rd(4 + cl + 8 * i, 8));
  return { v, mask, text: new TextDecoder().decode(new Uint8Array(out)) };
}
const samples = ['HELLO WORLD', 'https://edictumgame.com/?recruit=Abc123', 'https://edictumgame.com/?recruit=KyP0yP3s9jQXk2rA7HnV1mZt8wB2&rg=sunkenkingdoms',
  'https://edictumgame.com/?recruit=' + 'x'.repeat(120) + '&rg=meridian', 'Ünïcödé — ✓ 中文', 'a'];
for (const t of samples) { const M = qrMatrix(t), r = M ? decode(M) : { err: 'null' }; ok(`decodes back: ${t.slice(0, 50)}${t.length > 50 ? '…' : ''} (v${r.v}, mask ${r.mask})`, r.text === t, JSON.stringify(r)); }
ok('too long for version 10 gives null', qrMatrix('x'.repeat(400)) === null);
/* every mask is used by some input, so each mask's placement is checked */
const masks = new Set(); for (const v of [1, 5, 8]) for (let m = 0; m < 8; m++) { const t = 'https://edictumgame.com/?recruit=' + 'k'.repeat([1, 40, 100][[1, 5, 8].indexOf(v)] - 1), r = decode(qrMatrix(t, m)); if (r.text === t && r.mask === m) masks.add(m + '@' + r.v); else ok('mask ' + m, false, JSON.stringify(r)); }
ok('all eight masks decode, at three versions', masks.size === 24, [...masks].join(','));
const vs = new Set(); for (let L = 1; L <= 210; L += 7) { const t = 'q'.repeat(L), r = decode(qrMatrix(t)); if (r.text !== t) { ok('length ' + L, false, JSON.stringify(r)); } else vs.add(r.v); }
ok('versions 1 to 10 all decode', vs.size === 10, [...vs].sort((a, b) => a - b).join(','));
