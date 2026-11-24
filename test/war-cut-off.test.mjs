// Land cut off by war stays its holder's (bug report 20 Nov 2026, The Wandering Isles): a hex taken in war that cut a
// nation's land in two made the hexes behind it, the ones closest to its capital, fall back to unclaimed, while a claim
// further out stayed. territory() grew every nation again from its capital after the war, and land no longer joined to
// the capital could not be reached. Checked here with the game's own territory() and grow(), cut from its source, on a
// small map: a strip of land one hex wide, so that taking one hex cuts it.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const CODE = [line('const STEP='), line('const hlt='), line('function hpush('), line('function hpop('), line('function hexDist('),
  line('const CORE_HEXES='), cut('function grow(list,over){', '\n/* armies and military policies */')].join('\n');

/* An odd-r map COLS×ROWS of deep water with land where land(r,c) says. */
function makeMap(COLS, ROWS, land) {
  const N = COLS * ROWS, T = new Uint8Array(N), nbr = new Int32Array(N * 6).fill(-1), cx = new Float64Array(N), cy = new Float64Array(N);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c; T[i] = land(r, c) ? 3 : 0; cx[i] = c + (r & 1) / 2; cy[i] = r * 0.866;
    const odd = r & 1, ds = odd ? [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1]] : [[0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];
    ds.forEach(([dr, dc], d) => { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) nbr[i * 6 + d] = rr * COLS + cc; });
  }
  return { N, T, nbr, nbrFlat: nbr, cx, cy, COLS, ROWS };
}

/* territory() over the given nations and land events (claims, conquests, hand-overs), in time order */
function run(MAP, nations, events) {
  const ctx = vm.createContext({
    MAP, TERR_AT: null, atlasCache: new Map(), S: { db: null, mode: 'local', uid: 'me' }, RECL: { owner: new Map(), time: new Map() },
    FIX_EPOCH: 1000, SEAL2_AT: 1000, DAY: 86400000, CAP_REACH: 68, NPC_SET: new Set(nations.filter(x => x.npc).map(x => x.id)),
    syncReclaims() {}, allNations: () => nations, cellOf: v => (Number.isInteger(v) ? v : -1), popNow: n => n.pop,
    budgetOf: p => Math.floor(p), weightOf: () => 1, npcLand: p => Math.floor(p), npcWeight: () => 1, nationColor: n => n.col || '#888',
    collectConquests: () => ({ list: events, sig: events.length + ':' + JSON.stringify(events) }), capWrong: () => new Map(),
    claimLand: c => MAP.T[c] >= 2, inReach: () => true, warCovers: () => true, wrFallsAt: () => [], wrEndsAt: () => [], wrFellOf: () => null, wrSpoilOf: () => null, wrShielded: () => false,
  });
  vm.runInContext(vars(CODE), ctx);
  return ctx.territory();
}

const COLS = 30, ROW = 2, at = c => ROW * COLS + c;
const strip = () => makeMap(COLS, 5, (r, c) => r === ROW || (r === 4 && c < 5));
/* the defender's capital on the strip, the attacker's on an island of its own, out of the way */
const D = (extra = {}) => ({ id: 'tocantins', me: false, npc: false, n: { name: 'Tocantins', loc: at(10), pop: 0, founded: 1, claims: [], ...extra } });
const A = () => ({ id: 'me', me: true, npc: false, n: { name: 'The Wandering Isles', loc: 4 * COLS + 2, pop: 0, founded: 1, claims: [] } });
const held = (T, id) => { const i = T.byId[id], out = []; for (let c = 0; c < T.owner.length; c++) if (T.owner[c] === i) out.push(c); return out; };
const cols = cells => cells.filter(c => Math.floor(c / COLS) === ROW).map(c => c % COLS).sort((a, b) => a - b);

test('before the war: a core of CORE_HEXES round the capital, and a claim further out', () => {
  const T = run(strip(), [D(), A()], [{ c: at(22), t: 500, o: 'tocantins', src: 'tocantins', claim: true }]);
  assert.deepEqual(cols(held(T, 'tocantins')), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 22]);
});

test('a hex taken in war that cuts the land in two: the hexes behind it stay the defender\'s', () => {
  const MAP = strip();
  const before = run(MAP, [D(), A()], [{ c: at(22), t: 500, o: 'tocantins', src: 'tocantins', claim: true }]);
  const T = run(MAP, [D(), A()], [
    { c: at(22), t: 500, o: 'tocantins', src: 'tocantins', claim: true },
    { c: at(13), t: 2000, o: 'me', src: 'me', d: 'tocantins' },
  ]);
  const got = cols(held(T, 'tocantins'));
  assert.deepEqual(got, cols(held(before, 'tocantins')).filter(c => c !== 13), 'only the hex taken changes hands');
  for (const c of [14, 15, 16, 17]) assert.equal(T.owner[at(c)], T.byId.tocantins, `hex ${c}, behind the one taken, is still Tocantins'`);
  assert.equal(T.owner[at(1)], -1, 'and the core does not grow somewhere else instead');
  assert.equal(T.owner[at(13)], T.byId.me, 'the hex taken is the attacker\'s');
  assert.equal(T.occ[at(13)], 1, 'as land taken in war');
  assert.equal(T.orig[at(13)], T.byId.tocantins);
  assert.equal(T.lost[T.byId.tocantins], 1, 'Tocantins has lost one hex, not five');
  assert.equal(T.count[T.byId.tocantins], got.length);
});

test('a computer nation cut in two keeps the far side too, and grows nowhere else', () => {
  const MAP = strip(), npc = { id: 'npc-x', me: false, npc: true, n: { name: 'Npcland', loc: at(10), pop: 12, npc: true } };
  const before = run(MAP, [npc, A()], []);
  assert.deepEqual(cols(held(before, 'npc-x')), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const T = run(MAP, [npc, A()], [{ c: at(12), t: 2000, o: 'me', src: 'me', d: 'npc-x' }]);
  assert.deepEqual(cols(held(T, 'npc-x')), [4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15]);
  assert.equal(T.owner[at(12)], T.byId.me);
});

test('land handed over that cuts the giver in two leaves the rest of the giver\'s land where it was', () => {
  const MAP = strip(), ev = [
    { c: at(22), t: 500, o: 'tocantins', src: 'tocantins', claim: true },
    { c: at(13), t: 2000, o: 'me', src: 'me', d: 'tocantins' },
    { c: at(13), t: 3000, o: 'tocantins', src: 'me', bx: true, fr: 'me', wr: true },
  ];
  const T = run(MAP, [D(), A()], ev);
  assert.equal(T.owner[at(13)], T.byId.tocantins, 'given back');
  assert.deepEqual(cols(held(T, 'tocantins')), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 22]);
});

test('a conquest that cuts nothing off still moves only that hex', () => {
  const MAP = strip();
  const T = run(MAP, [D(), A()], [{ c: at(17), t: 2000, o: 'me', src: 'me', d: 'tocantins' }]);
  assert.deepEqual(cols(held(T, 'tocantins')), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(T.owner[at(17)], T.byId.me);
});
