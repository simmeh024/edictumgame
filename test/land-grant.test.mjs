// Land credits from the staff (24 Nov 2026; game/edictum.html, "land credits from the staff"; functions/admin.js,
// landCredits): an admin grants a player land credits on the console's player page, with a reason for the audit log;
// the player's game adds each grant once to its bonus credits, up to their cap, with a line in its record.
// Checked with the game's own code, cut from its source. Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../functions/admin.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const J = v => JSON.parse(JSON.stringify(v));
const SEC = cut('/* ───────── land credits from the staff (24 November 2026)', '/* ───────── works done (WD)');

function game(nation, grants, extra = {}) {
  const S = { mode: 'world', uid: 'u1', nation, db: null };
  const ctx = vm.createContext({ S, OBS: '', PV: null, Math, JSON, Number, String, Array, Set, Object, window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: () => null },
    hmQuiet: () => false, connect: async () => {}, NORM_HOOKS: [], ST_LOG: {}, NOTIF_K: {}, logLine: () => 'other', clamp: (v, a, b) => Math.max(a, Math.min(b, v)), num0: v => +v || 0,
    clone: o => JSON.parse(JSON.stringify(o)), commit: n => { S.nation = n; ctx.saved = (ctx.saved || 0) + 1; }, toast: m => { ctx.said = m; }, ADMX: {}, esc: s => String(s), adminTime: t => 'T' + t, ...extra });
  vm.runInContext([fn('whCreditCap'), fn('addBonusCredits'), vars(SEC)].join('\n'), ctx);
  ctx.LCG.uid = 'u1';ctx.LCG.ready = true;ctx.LCG.g = ctx.lcgNorm(grants);
  return ctx;
}
const N = (o = {}) => ({ name: 'Tela tyhate', lcb: 2, log: [], ...o });

test('a grant is added once to the bonus land credits, with a line in the record giving the reason', () => {
  const G = game(N(), [{ id: 'a1', k: 3, t: 10, why: 'Refund for land a bug freed' }]);
  G.lcgApply();
  assert.equal(G.saved, 1);assert.equal(G.S.nation.lcb, 5);assert.deepEqual(J(G.S.nation.lcgd), ['a1']);
  assert.deepEqual(J(G.S.nation.log[0]), { t: G.S.nation.log[0].t, k: 'lcgift', a: '3', fx: 'Refund for land a bug freed' });
  assert.match(G.said, /granted Tela tyhate 3 land credits/);
  G.lcgApply();assert.equal(G.saved, 1, 'once');assert.equal(G.S.nation.lcb, 5);
  /* a second grant later: only that one */
  G.LCG.g = G.lcgNorm([{ id: 'a1', k: 3, t: 10, why: 'x' }, { id: 'a2', k: 1, t: 20, why: 'y' }]);G.lcgApply();
  assert.equal(G.S.nation.lcb, 6);assert.deepEqual(J(G.S.nation.lcgd), ['a1', 'a2']);
});
test('up to the cap on bonus credits; a full nation is told so', () => {
  const G = game(N({ lcb: 29 }), [{ id: 'a1', k: 5, t: 1, why: 'r' }]);G.lcgApply();
  assert.equal(G.S.nation.lcb, 30, 'the cap is 30 without warehouse credits');assert.equal(G.S.nation.log[0].a, '1');
  const F = game(N({ lcb: 30 }), [{ id: 'a1', k: 2, t: 1, why: 'r' }]);F.lcgApply();
  assert.equal(F.S.nation.lcb, 30);assert.match(F.said, /already holds the most bonus credits/);assert.deepEqual(J(F.S.nation.lcgd), ['a1'], 'and it is not offered again');
});
test('only the player’s own game, in the shared world, once the grants are read; nothing malformed', () => {
  for (const [why, o] of [['observing', { OBS: 'meridian' }], ['a preview', { PV: { uid: 'u1' } }]]) { const G = game(N(), [{ id: 'a1', k: 3 }], o);G.lcgApply();assert.equal(G.saved, undefined, why); }
  const G = game(N(), [{ id: 'a1', k: 3 }]);G.LCG.uid = 'someone else';G.lcgApply();assert.equal(G.saved, undefined, 'another account’s grants');
  G.LCG.uid = 'u1';G.LCG.ready = false;G.lcgApply();assert.equal(G.saved, undefined, 'not yet read');
  assert.deepEqual(J(G.lcgNorm([{ id: 'ok', k: 2, t: 5, why: 'w' }, { id: 'big', k: 21 }, { id: 'zero', k: 0 }, { id: 'frac', k: 1.5 }, { k: 2 }, null, { id: 'x'.repeat(41), k: 1 }])), [{ id: 'ok', k: 2, t: 5, why: 'w' }]);
});
test('the record keeps what was taken, and the log tells of it', () => {
  const G = game(N(), []), n = {};
  G.NORM_HOOKS[0](n, { lcgd: ['a1', 5, '', 'x'.repeat(41), 'a2'] });assert.deepEqual(J(n), { lcgd: ['a1', 'a2'] });
  assert.equal(G.logLine({ k: 'lcgift', a: '3', fx: 'Refund' }), 'The Edictum Team granted 3 land credits: Refund.');
  assert.equal(G.logLine({ k: 'lcgift', a: '1', fx: '' }), 'The Edictum Team granted 1 land credit.');
  assert.equal(G.logLine({ k: 'other' }), 'other');
  assert.deepEqual(J(G.ST_LOG.lcgift), ['land', 'Was granted {a} land credits by the Edictum Team']);assert.equal(G.NOTIF_K.lcgift, 'Edictum Team');
});
test('the console: what was granted, and a grant with a reason', async () => {
  const sent = [], G = game(N(), [], { render() {}, adminRequest: async d => { sent.push(d); return { lcg: [{ id: 'e1', k: d.k, t: 5, why: d.reason }] }; } });
  const p = { uid: 'u1', lcg: [] };G.ADMX.player = p;
  assert.match(G.adminLand(p), /None granted yet/);assert.match(G.adminLand(p), /data-act="admin-lc" data-id="u1"/);
  G.ADMX.lcK = '3';await G.adminLandSet('u1');assert.equal(sent.length, 0, 'not without a reason');assert.match(G.ADMX.lcMsg, /reason/);
  G.ADMX.lcWhy = 'Refund';G.ADMX.lcK = '25';await G.adminLandSet('u1');assert.equal(sent.length, 0);assert.match(G.ADMX.lcMsg, /between 1 and 20/);
  G.ADMX.lcK = '3';await G.adminLandSet('u1');
  assert.deepEqual(J(sent), [{ op: 'landCredits', uid: 'u1', k: 3, reason: 'Refund' }]);assert.match(G.ADMX.lcMsg, /3 land credits granted/);
  assert.match(G.adminLand(p), /<b>3<\/b> on T5: Refund/);
  assert.match(src, /<h3 class="help-h3">Shop packs<\/h3>\$\{adminPacks\(p\)\}\n    <h3 class="help-h3">Land credits<\/h3>\$\{adminLand\(p\)\}/, 'on the player page, after the packs');
});
test('the server: admins only, 1 to 20 credits with a reason, written by the console alone and read by the player alone', () => {
  assert.ok(admin.indexOf("if (d.op === 'landCredits') return landCredits(db, actor, d);") > admin.indexOf("if (req.auth.token.admin !== true) {"), 'after the admin check');
  assert.match(admin, /if \(!Number\.isInteger\(k\) \|\| k < 1 \|\| k > LCG_MAX\) throw new HttpsError\('invalid-argument'/);
  assert.match(admin, /if \(!reason\) throw new HttpsError\('invalid-argument', 'A reason is required\.'\);/);
  assert.match(admin, /action: 'land_credits_given', target,/, 'in the audit log');
  assert.match(admin, /const g = was\.concat\(\{ id: event\.id, k, t: Date\.now\(\), why: reason \}\)\.slice\(-LCG_KEEP\);/);
  assert.match(admin, /if \(d\.op === 'player'\) \{ const uid = id\(d\.uid\), \[p, lcg\] = await Promise\.all\(\[player\(db, uid\), grantsOf\(db, uid\)\]\); return \{ \.\.\.p, lcg \}; \}/);
  assert.match(rules, /match \/lcGrant\/\{uid\} \{ allow read: if request\.auth != null && request\.auth\.uid == uid; allow write: if false; \}/);
  assert.match(SEC, /S\.db\.doc\('lcGrant\/'\+me\)\.onSnapshot\(/, 'the game reads only its own');
});
