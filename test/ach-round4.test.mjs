// Achievements, round four (game/edictum.html, 12 November 2026): the chat and the Community Board, the museum's floors,
// exhibitions and loans, arms and city crests, the poster, lakes, the Granary and the Market Hall, more deal slots.
// What a player writes in the chat or on the board is counted on the player's side (ACH_PEND) and written to the tally with
// the next save. Each goal runs here against small stand-ins for the game.
//   node --test test/ach-round4.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function cut(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j); }
const BLOCK = cut('/* ───────── achievements, round four (2026-11-12)', '/* ───────── achievements for Flock, provinces');
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const DAY = 864e5, NOW = Date.UTC(2027, 2, 1);

/* a small map: 12 cells in a row, each the neighbour of the next; cells 2-7 are one lake of six hexes, 9 a lake of one */
const N = 12, nbr = new Int32Array(N * 6).fill(-1);
for (let c = 0; c < N; c++) { if (c > 0) nbr[c * 6] = c - 1; if (c < N - 1) nbr[c * 6 + 1] = c + 1; }
const LAKE = new Set([2, 3, 4, 5, 6, 7, 9]);

const A = {}, HOOKS = [];
const ctx = vm.createContext({
  A, Math, Set, Map, Array, Object, Number, Uint8Array, DAY,
  S: { nation: null, mode: 'world' }, OBS: false, COMMIT_HOOKS: HOOKS,
  gbBump: (n, k, by, now) => { n.tly = n.tly || {}; n.tlf = n.tlf || {}; n.tly[k] = (n.tly[k] || 0) + by; if (!n.tlf[k]) n.tlf[k] = now; },
  aT: (x, k) => (x.n.tly && x.n.tly[k]) || 0,
  achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
  achYes: v => v ? 1 : 0, achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), num0: v => Number.isFinite(+v) ? +v : 0,
  cbUser: u => ctx.USERS[u] || null, USERS: {},
  mwOf: n => Object.assign({ fl: 1, cu: null, ex: [], yr: 0 }, n.mw || {}), MW_EXHIBITS: Array(6).fill({}), mwOnShow: n => (n.mw && n.mw.dc) || [],
  czArmsOn: n => !!(n.cz && n.cz.a && n.cz.a.on), ccHas: c => !!(c && c.cr), clsOf: n => (n.vl && n.vl.c) || [],
  territory: () => ({ byId: { me: 0, you: 1 }, owner: ctx.OWN }), OWN: new Int32Array(N).fill(-1), MAP: { N, nbr }, isLake: c => LAKE.has(c),
  aBuilt: (x, k) => (x.n.built && x.n.built[k]) || 0, cxUps: b => b.ug || 0, CX_UG_MAX: 5, aDeals: x => x.n.deals || 0
});
vm.runInContext(BLOCK + '\nthis.achPend=achPend;this.ACH_PEND=ACH_PEND;this.aTP=aTP;', ctx);
const X = (n, o) => Object.assign({ n, id: 'me', me: true, npc: !!n.npc, now: NOW, m: {} }, o || {});
const val = (id, n, o) => +A[id].f(X(n, o)) || 0;
const met = (id, n, o) => val(id, n, o) >= A[id].g;

const NEW = ['dip-ch1', 'dip-ch100', 'dip-ch1000', 'dip-chre', 'dip-mn1', 'dip-rx25', 'dip-cbt1', 'dip-cbt10', 'dip-cbp25', 'dip-cbp100', 'dip-cbf', 'dip-cbs',
  'mus-fl2', 'mus-fl3', 'mus-cur', 'mus-tk10', 'mus-tk100', 'mus-rs1', 'mus-rs10', 'mus-lo1', 'mus-lo10', 'mus-ex1', 'mus-ex6', 'mus-yr1', 'mus-yr30', 'mus-cases',
  'odd-arms', 'odd-crest1', 'odd-crest5', 'odd-crestall', 'odd-poster', 'odd-classified', 'land-lake1', 'land-lakeall',
  'bld-granary', 'bld-granary5', 'bld-market', 'eco-active12', 'eco-berth'];

test('thirty-nine new achievements, bronze to gold, worth 945 prestige', () => {
  assert.deepEqual(Object.keys(A).sort(), [...NEW].sort());
  assert.equal(NEW.reduce((s, id) => s + TIER[A[id].t], 0), 945);
  assert.ok(NEW.every(id => 'bsg'.includes(A[id].t)), 'no platinum: platinum pays land credits');
  for (const id of NEW) assert.ok(A[id].d.length > 15 && /\.$/.test(A[id].d), id);
  /* the categories the Achievements page already has */
  assert.deepEqual([...new Set(NEW.map(id => A[id].c))].sort(), ['bld', 'dip', 'eco', 'land', 'mus', 'odd']);
});

test('no two achievements share a name, counting those defined in tables ([id, tier, name, …])', () => {
  /* the names of achDef/achParts calls, and of the tables that feed them (“Best in Show” and “Grand Tour” were taken) */
  const lit = [...html.matchAll(/ach(?:Def|Parts)\('[a-z]+','[^']+','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => m[1]);
  const tab = [...html.matchAll(/[[(]'[a-z][a-z0-9]*-[a-z0-9-]+','[bsgpxo]','([A-Z0-9](?:[^'\\]|\\.){2,})',/g)].map(m => m[1]);
  const all = lit.concat(tab);
  assert.ok(all.length > 500, String(all.length));
  assert.deepEqual(all.filter((n, i) => all.indexOf(n) !== i), []);
  for (const id of NEW) assert.equal(all.filter(n => n === A[id].n).length, 1, A[id].n);
});

test('lines, posts and reactions are counted at once, and written to the tally with the next save', () => {
  ctx.S.nation = null; ctx.achPend('rch'); assert.equal(ctx.ACH_PEND.size, 0, 'no nation, nothing counted');
  ctx.S.nation = { name: 'Tallyfield' }; ctx.OBS = true; ctx.achPend('rch'); assert.equal(ctx.ACH_PEND.size, 0, 'staff looking on count nothing');
  ctx.OBS = false; ctx.S.mode = 'readonly'; ctx.achPend('rch'); assert.equal(ctx.ACH_PEND.size, 0); ctx.S.mode = 'world';
  ctx.S.nation = { name: 'Cpu', npc: true }; ctx.achPend('rch'); assert.equal(ctx.ACH_PEND.size, 0);
  const n = { name: 'Tallyfield', tly: { rch: 4 } }; ctx.S.nation = n;
  ctx.achPend('rch'); ctx.achPend('rch'); ctx.achPend('cbp', 3);
  assert.equal(val('dip-ch1', n), 6, 'my own count includes what is waiting');
  assert.equal(val('dip-ch1', n, { me: false }), 4, 'another player sees the saved count only');
  /* the hook is first in line, so the achievements' own hook sees the count in the record */
  assert.equal(HOOKS.length, 1); const m = { name: 'Tallyfield', tly: { rch: 4 } };
  HOOKS[0](m, n, NOW); assert.equal(m.tly.rch, 6); assert.equal(m.tly.cbp, 3); assert.equal(m.tlf.cbp, NOW); assert.equal(ctx.ACH_PEND.size, 0);
  assert.equal(val('dip-ch1', m), 6, 'nothing is counted twice');
  assert.ok(/COMMIT_HOOKS\.unshift\(\(n,old,now\)=>\{if\(!ACH_PEND\.size/.test(BLOCK));
});

test('every place a player speaks counts: chat, alliance chat, topics, replies, reactions, follows, signature, poster', () => {
  const has = (re, what) => assert.match(html, re, what);
  has(/op:'rcPost',reg,x:p\.x[^\n]*\n\s*p\.id=typeof r\.id==='string'\?r\.id:'';achPend\('rch'\);if\(re\)achPend\('rchr'\);if\(mn\.length\)achPend\('mnt'\);/, 'region chat line, reply, mention');
  assert.equal([...html.matchAll(/op:'alPost'|'alPost',\{aid/g)].length, 2); assert.equal([...html.matchAll(/alPost[^\n]{0,60}achPend\('rch'\)/g)].length, 2, 'both alliance chat boxes');
  has(/op:'cbTopic'[^\n]*\),reg=f\.reg;achPend\('cbt'\);achPend\('cbp'\);if\(mn0\.length\)achPend\('mnt'\);/, 'a new topic');
  has(/op:'cbReply'[^\n]*\}\);achPend\('cbp'\);if\(cbMnIds\(x\)\.length\)achPend\('mnt'\);/, 'a reply');
  has(/op:'cbFollow',reg,topic:t,on\}\);if\(on\)achPend\('cbf'\);/, 'following, not unfollowing');
  has(/op:'cbReact'[^\n]*\}\);if\(cur!==k\)achPend\('rx'\);/, 'a board reaction added, not taken back');
  has(/op:'rcReact'[^\n]*\}\);if\(had!==k\)achPend\('rx'\);/, 'a chat reaction added, not taken back');
  has(/if\(r&&r\.sg\)\{d\.sg=r\.sg;achPend\('cbs'\);\}/, 'a signature written');
  has(/pstStat\('poster_saved'\);achPend\('pst'\);/); has(/pstStat\('poster_shared'\);achPend\('pst'\);/);
});

test('the board: topics, posts counted by the server too, follows and the signature', () => {
  const n = { name: 'Quill', tly: { cbt: 10, cbp: 12, cbf: 1 } }; ctx.S.nation = n;
  assert.ok(met('dip-cbt10', n)); assert.ok(!met('dip-cbp25', n));
  ctx.USERS.me = { n: 40 }; assert.ok(met('dip-cbp25', n), 'the board’s own count, backfilled from before'); assert.ok(!met('dip-cbp100', n));
  assert.ok(met('dip-cbf', n)); assert.ok(!met('dip-cbs', n)); ctx.USERS.me.sg = 'Yours, Quill'; assert.ok(met('dip-cbs', n));
  assert.ok(!met('dip-cbp25', { name: 'Cpu', npc: true, tly: { cbp: 99 } }, { npc: true }), 'never for a nation the game runs');
  delete ctx.USERS.me;
});

test('the museum: floors, curator, takings, restorations, loans, exhibitions, the ranking, every case', () => {
  const n = { name: 'Vitrine', mw: { fl: 2, cu: { k: 'scholar' }, ex: ['24318', '24319', '24324'], yr: 3, dc: Array(11).fill('a') }, tly: { 'mw:takings': 10, 'mw:restore': 1, 'mw:lend': 10 } };
  assert.ok(met('mus-fl2', n)); assert.ok(!met('mus-fl3', n)); assert.ok(met('mus-fl3', { mw: { fl: 3 } }));
  assert.ok(met('mus-cur', n)); assert.ok(!met('mus-cur', {}));
  assert.ok(met('mus-tk10', n) && !met('mus-tk100', n)); assert.ok(met('mus-rs1', n) && !met('mus-rs10', n)); assert.ok(met('mus-lo10', n));
  assert.ok(met('mus-ex1', n), 'an exhibition opened before the tally counted them');
  assert.equal(val('mus-ex6', n), 2, 'two months six apart are the same exhibition');
  assert.ok(met('mus-ex6', { mw: { ex: ['24318', '24319', '24320', '24321', '24322', '24323'] } }));
  assert.ok(met('mus-yr1', n) && !met('mus-yr30', n));
  assert.ok(!met('mus-cases', n)); n.mw.dc.push('b'); assert.ok(met('mus-cases', n));
  assert.ok(!met('mus-fl2', { npc: true, mw: { fl: 3 } }, { npc: true }));
});

test('arms, crests, the poster and the classified page', () => {
  assert.ok(!met('odd-arms', { cz: { a: { on: 0 } } })); assert.ok(met('odd-arms', { cz: { a: { on: 1 } } }));
  const city = cr => ({ cr: cr ? { s: 'heater' } : undefined });
  const seven = { cities: Array.from({ length: 7 }, () => city(true)) };
  assert.ok(met('odd-crest5', seven)); assert.ok(!met('odd-crestall', seven), 'fewer than eight cities');
  const eight = { cities: [...seven.cities, city(false)] }; assert.ok(!met('odd-crestall', eight)); eight.cities[7] = city(true); assert.ok(met('odd-crestall', eight));
  assert.ok(met('odd-poster', { tly: { pst: 1 } })); assert.ok(met('odd-classified', { vl: { c: ['econ'] } })); assert.ok(!met('odd-classified', {}));
});

test('lakes: a hex of one, and every hex of a lake of five or more', () => {
  const own = (...cells) => { ctx.OWN.fill(-1); for (const c of cells) ctx.OWN[c] = 0; };
  own(0, 1); assert.ok(!met('land-lake1', {}));
  own(1, 2); assert.ok(met('land-lake1', {})); assert.ok(!met('land-lakeall', {}));
  own(1, 2, 3, 4, 5, 6, 7); assert.ok(met('land-lakeall', {}), 'all six hexes');
  own(9); assert.ok(met('land-lake1', {})); assert.ok(!met('land-lakeall', {}), 'a lake of one hex is not a lake district');
  ctx.OWN.fill(-1);
});

test('the Granary, the Market Hall and deal slots', () => {
  assert.ok(met('bld-granary', { built: { granary: 1 } })); assert.ok(met('bld-market', { built: { market: 1 } }));
  const gr = ug => ({ cities: [{ b: [{ k: 'granary', d: NOW - DAY, ug }] }] });
  assert.ok(!met('bld-granary5', gr(4))); assert.ok(met('bld-granary5', gr(5)));
  assert.ok(!met('bld-granary5', { cities: [{ b: [{ k: 'granary', d: NOW + DAY, ug: 5 }] }] }), 'still being built');
  assert.ok(met('eco-active12', { deals: 12 })); assert.ok(!met('eco-active12', { deals: 11 }));
  assert.ok(met('eco-berth', { trX: [NOW + DAY] })); assert.ok(!met('eco-berth', { trX: [] }));
  assert.match(html, /const MAX_DEALS=12;/, 'twelve slots before any Market Hall, so twelve deals can be reached');
  assert.match(html, /achDef\('eco','eco-active8','g','Full Order Book','Have 8 trade deals running at once\.',8,aDeals\);/, 'no longer “the most the Board of Trade allows”');
});
