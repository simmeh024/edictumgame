// War, round two (21 Nov 2026; game/edictum.html, "war, round two"; functions/war-rules.js; functions/index.js): a war's
// aim, the siege and fall of a capital, the spoils of a fallen nation, surrender, a grace for a player attacked while
// away, the shield of a nation risen again, what wars cost (each more than the last), cities on strike, the five war
// edicts and the population a nation at war loses. Checked with the game's own code, cut from its source.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warOf, shielded, SIEGE_MS, SIEGE_MAX, PEACE_AUTO_MS } from '../functions/war-rules.js';
import { warLetter } from '../functions/mail-core.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
/* a function's source, by its name, braces matched */
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const H = 3600000, DAY = 864e5, J = v => JSON.parse(JSON.stringify(v));
const CONSTS = cut('const SIEGE_MS=', '\n/* the region\'s sieges and falls');
const GOALS = cut('const WAR_GOALS={', '};') + '};';
const SEC = cut('/* ───────── war, round two (21 November 2026) ─────────', '\nif(hot&&typeof hot.snapshot');

test('the constants: a day\'s siege, an assault for two more, the server keeps the same', () => {
  const c = vm.createContext({});vm.runInContext(vars(CONSTS), c);
  assert.equal(c.SIEGE_MS, 24 * H);assert.equal(c.SIEGE_MAX, 72 * H);assert.equal(c.SURR_TRUCE, 14 * DAY);assert.equal(c.TRIB_MS, 14 * DAY);
  assert.equal(c.SHIELD_MS, 7 * DAY);assert.equal(c.GRACE_MS, 3 * DAY);assert.equal(c.BORDER_CAP, 12);assert.equal(c.STRIKE_AT, 15);
  assert.equal(SIEGE_MS, c.SIEGE_MS, 'functions/war-rules.js agrees');assert.equal(SIEGE_MAX, c.SIEGE_MAX);
  assert.equal(PEACE_AUTO_MS, 30 * H);assert.match(src, /PEACE_AUTO_MS=30\*3600000/);
  const g = vm.createContext({ BORDER_CAP: 12 });vm.runInContext(vars(GOALS), g);
  assert.deepEqual(Object.keys(g.WAR_GOALS), ['b', 'c', 'r']);
  assert.deepEqual(['b', 'c', 'r'].map(k => g.WAR_GOALS[k].w), [1, 1.5, 0.5], 'conquest wears a nation down faster, a raid slower');
});

/* the game's pairWar and warCovers over a few records */
function wars(recs, now) {
  const ctx = vm.createContext({ TRUCE_MS: 72 * H, PEACE_AUTO_MS: 30 * H, SURR_TRUCE: 14 * DAY, NPC_SET: new Set(['npc-1']), DAY,
    docOf: id => recs[id], hidDoc: () => null, wrFellOf: () => null, wakeFence: () => 0, npcPeaceWait: () => 24 * H, Date: { now: () => now } });
  vm.runInContext(vars(GOALS.replace('${BORDER_CAP}', '12')) + '\n' + fn('pairWar') + '\n' + fn('warCovers'), ctx);
  return ctx;
}
test('a war carries its aim; one from before the aims, or declared by a computer nation, counts as conquest', () => {
  const t = 1000 * H;
  let W = wars({ a: { wars: { b: { t, g: 'b' } } }, b: {} }, t + H);
  assert.equal(W.pairWar('a', 'b').g, 'b');assert.equal(W.pairWar('b', 'a').g, 'b', 'either side reads the declarer\'s aim');
  W = wars({ a: { wars: { b: { t } } }, b: {} }, t + H);assert.equal(W.pairWar('a', 'b').g, 'c');
  W = wars({ a: { wars: { 'npc-1': { t, by: 1, g: 'r' } } }, 'npc-1': {} }, t + H);assert.equal(W.pairWar('a', 'npc-1').g, 'c');
  W = wars({ a: { wars: { b: { t, g: 'zz' } } }, b: {} }, t + H);assert.equal(W.pairWar('a', 'b').g, 'c', 'an unknown aim counts as conquest');
});
test('a surrender ends the war at once, on current lines, with a 14-day truce; conquests after it do not count', () => {
  const t = 1000 * H, s = t + 30 * H;
  const recs = { a: { wars: { b: { t, g: 'c' } } }, b: { surr: { a: s } } }, W = wars(recs, s + H);
  const w = W.pairWar('a', 'b');
  assert.equal(w.war, false);assert.equal(w.peaceAt, s);assert.equal(w.truceUntil, s + 14 * DAY);assert.equal(w.surr, 'b');
  assert.equal(W.warCovers('a', 'b', s - H), true, 'a conquest before the surrender counts');
  assert.equal(W.warCovers('a', 'b', s + 2 * H), false, 'one after it does not');
  /* an old surrender does not end a newer war */
  const W2 = wars({ a: { wars: { b: { t: s + DAY * 20, g: 'c' } } }, b: { surr: { a: s } } }, s + DAY * 21);
  assert.equal(W2.pairWar('a', 'b').war, true);
});

test('the server reads the war as the game does (functions/war-rules.js)', () => {
  const t = 1000 * H;
  assert.equal(warOf({}, 'a', {}, 'b', t), null, 'no war');
  assert.deepEqual(warOf({ wars: { b: { t, g: 'b' } } }, 'a', {}, 'b', t + H), { since: t, g: 'b', offA: false });
  assert.deepEqual(warOf({}, 'a', { wars: { a: { t, g: 'c' } } }, 'b', t + H), { since: t, g: 'c', offA: false }, 'declared by the other side');
  assert.equal(warOf({ wars: { b: { t } } }, 'a', {}, 'b', t + H).g, 'c', 'a war from before the aims');
  assert.equal(warOf({ wars: { b: { t } }, peace: { b: t + 1 } }, 'a', { peace: { a: t + 2 } }, 'b', t + H), null, 'both offered peace');
  assert.equal(warOf({ wars: { b: { t } }, peace: { b: t + 1 } }, 'a', {}, 'b', t + H).offA, true, 'an offer of its own');
  assert.equal(warOf({ wars: { b: { t } }, peace: { b: t + 1 } }, 'a', {}, 'b', t + 1 + PEACE_AUTO_MS), null, 'an offer left unanswered takes effect');
  assert.deepEqual(warOf({ wars: { b: { t } } }, 'a', { surr: { a: t + 5 } }, 'b', t + H), { surr: true });
  const f = 2000 * H;
  assert.equal(shielded({ founded: f, shd: f + 7 * DAY }, f + DAY), true, 'risen again');
  assert.equal(shielded({ founded: f, shd: f + 7 * DAY }, f + 8 * DAY), false);
  assert.equal(shielded({ founded: f, shd: f + 30 * DAY }, f + DAY), false, 'a shield longer than the game gives is ignored');
  assert.equal(shielded({ grc: { t: f, u: f + 3 * DAY } }, f + DAY), true, 'in its grace');
  assert.equal(shielded({ grc: { t: f, u: f + 9 * DAY } }, f + DAY), false, 'a grace longer than the game gives is ignored');
  assert.equal(shielded({}, f), false);
});

/* the game's helpers for falls, spoils and shields */
const helpers = (recs = {}) => { const c = vm.createContext({ S: { mode: 'world' }, WR: { docs: new Map(), rev: 0 }, NPC_SET: new Set(), docOf: id => recs[id] || null, hidDoc: () => null });
  vm.runInContext(['wrFellOf', 'wrSpoilOf', 'wrSpoilWar', 'wrShielded', 'warCovers'].map(fn).join('\n'), c); return c; };
test('a fall belongs to the nation as it was founded; its spoils are what its enemies took before it fell', () => {
  const G = helpers({ me: {}, v: {}, ally: {}, helper: {}, stranger: {} }), F = { id: 'x', a: 'me', d: 'v', ft: 5000, df: 100, foes: ['me', 'ally'], c: 7 };
  assert.equal(G.wrFellOf('v', { founded: 100 }, [F]), F);
  assert.equal(G.wrFellOf('v', { founded: 6000 }, [F]), null, 'founded again since: a new nation, not fallen');
  assert.equal(G.wrFellOf('w', { founded: 100 }, [F]), null);
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'me' }, [F]), F, 'the besieger\'s conquest');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'ally' }, [F]), F, 'an enemy of the fallen nation');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'helper', w: 'me' }, [F]), F, 'taken in an ally\'s war');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'stranger' }, [F]), null, 'not a party to the war');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 7000, src: 'me' }, [F]), null, 'after the fall');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 50, src: 'me' }, [F]), null, 'from before that nation was founded');
  assert.equal(G.wrSpoilOf({ t: 4000, src: 'me' }, [F]), null, 'a conquest that names no defender');
  assert.equal(G.wrShielded({ grc: { t: 10, u: 20 } }, 15), true);assert.equal(G.wrShielded({ grc: { t: 10, u: 20 } }, 25), false);
  assert.equal(G.wrShielded({ founded: 10, shd: 20 }, 15), true);assert.equal(G.wrShielded({ founded: 10, shd: 20 }, 5), false);
});
/* 24 Nov 2026 (Tela tyhate, Bearland and Thalarara): the referee's foes are the besieger and the wars the fallen nation
   declared itself; a nation that declared war on it is in neither, and its conquests went blank at the fall */
test('a nation that declared war on the fallen one keeps what it took, by its own record alone if need be', () => {
  const F = { id: 'x', a: 'me', d: 'v', ft: 5000, df: 100, foes: ['me'], c: 7 };
  const recs = { me: {}, v: {}, bear: { wars: { v: { t: 1500 } } }, late: { wars: { v: { t: 4500 } } }, old: { wh: [{ w: 'v', a: 1000, b: 2000 }] }, stranger: {},
    helper: {} };
  const G = helpers(recs);
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'bear' }, [F]), F, 'its war, declared in its own record');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 3000, src: 'late' }, [F]), null, 'a conquest from before its war began');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 1500, src: 'old' }, [F]), F, 'a war that ended in peace still covers what it took');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 3500, src: 'old' }, [F]), null, 'but nothing after the peace');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'helper', w: 'bear' }, [F]), F, 'taken for an ally at war with it');
  assert.equal(G.wrSpoilOf({ d: 'v', t: 4000, src: 'stranger' }, [F]), null, 'still not a party to the war');
  /* the fallen record dissolved after the fall: the taker's own record answers */
  const gone = helpers({ ...recs, v: undefined });
  assert.equal(gone.wrSpoilOf({ d: 'v', t: 4000, src: 'bear' }, [F]), F);
  assert.equal(gone.wrSpoilOf({ d: 'v', t: 1500, src: 'old' }, [F]), F);
  assert.equal(gone.wrSpoilOf({ d: 'v', t: 3000, src: 'late' }, [F]), null);
  assert.equal(gone.wrSpoilOf({ d: 'v', t: 4000, src: 'stranger' }, [F]), null);
  /* a fallen record still there answers for itself: a war it does not share is no war (its peace with the taker) */
  const peace = helpers({ ...recs, bear: { wars: { v: { t: 1500 } }, peace: { v: 2000 } }, v: { peace: { bear: 2100 } } });
  assert.equal(peace.wrSpoilOf({ d: 'v', t: 1800, src: 'bear' }, [F]), F);
  assert.equal(peace.wrSpoilOf({ d: 'v', t: 4000, src: 'bear' }, [F]), null, 'after both made peace');
});

/* territory() on a small map, as war-cut-off.test.mjs runs it, with the falls given */
const TERR = [line('const STEP='), line('const hlt='), line('function hpush('), line('function hpop('), line('function hexDist('),
  line('const CORE_HEXES='), cut('function grow(list,over){', '\n/* armies and military policies */')].join('\n');
function makeMap(COLS, ROWS, land) {
  const N = COLS * ROWS, T = new Uint8Array(N), nbr = new Int32Array(N * 6).fill(-1), cx = new Float64Array(N), cy = new Float64Array(N);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c; T[i] = land(r, c) ? 3 : 0; cx[i] = c + (r & 1) / 2; cy[i] = r * 0.866;
    const odd = r & 1, ds = odd ? [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1]] : [[0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];
    ds.forEach(([dr, dc], d) => { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) nbr[i * 6 + d] = rr * COLS + cc; });
  }
  return { N, T, nbr, nbrFlat: nbr, cx, cy, COLS, ROWS };
}
/* wars: the records' own wars, read by the game's warCovers; without them every conquest is covered */
function run(MAP, nations, events, falls, wars) {
  const ctx = vm.createContext({
    MAP, TERR_AT: null, atlasCache: new Map(), S: { db: null, mode: 'world', uid: 'me' }, RECL: { owner: new Map(), time: new Map() },
    FIX_EPOCH: 1000, SEAL2_AT: 1000, DAY, CAP_REACH: 68, NPC_SET: new Set(nations.filter(x => x.npc).map(x => x.id)),
    syncReclaims() {}, allNations: () => nations, cellOf: v => (Number.isInteger(v) ? v : -1), popNow: n => n.pop,
    budgetOf: p => Math.floor(p), weightOf: () => 1, npcLand: p => Math.floor(p), npcWeight: () => 1, nationColor: n => n.col || '#888',
    collectConquests: () => ({ list: events, sig: events.length + ':' + JSON.stringify(events) }), capWrong: () => new Map(),
    claimLand: c => MAP.T[c] >= 2, inReach: () => true, warCovers: () => true, wrFallsAt: () => falls || [], wrEndsAt: () => (falls || []).filter(F => !F.ni),
    docOf: id => { const x = nations.find(y => y.id === id); return x ? x.n : null; }, hidDoc: () => null,
  });
  vm.runInContext(vars(TERR) + '\n' + ['wrFellOf', 'wrSpoilOf', 'wrSpoilWar', 'wrShielded'].concat(wars ? ['warCovers'] : []).map(fn).join('\n'), ctx);
  return ctx.territory();
}
const COLS = 30, ROW = 2, at = c => ROW * COLS + c;
const strip = () => makeMap(COLS, 5, (r, c) => r === ROW || (r === 4 && c < 5));
const V = (extra = {}) => ({ id: 'v', me: false, npc: false, n: { name: 'Vesad', loc: at(10), pop: 0, founded: 100, claims: [], ...extra } });
const A = () => ({ id: 'me', me: true, npc: false, n: { name: 'Axetère', loc: 4 * COLS + 2, pop: 0, founded: 1, claims: [] } });
const held = (T, id) => { const i = T.byId[id], out = []; if (i === undefined) return out; for (let c = 0; c < T.owner.length; c++) if (T.owner[c] === i) out.push(c); return out; };
const cols = cells => cells.filter(c => Math.floor(c / COLS) === ROW).map(c => c % COLS).sort((a, b) => a - b);

test('a fallen nation leaves the map: what its enemies took stays theirs, as their own land; the rest lies open', () => {
  const MAP = strip(), ev = [{ c: at(12), t: 2000, o: 'me', src: 'me', d: 'v' }, { c: at(13), t: 2100, o: 'me', src: 'me', d: 'v' }, { c: at(10), t: 9000, o: 'me', src: 'me', d: 'v' }];
  const before = run(MAP, [V(), A()], ev.slice(0, 2));
  assert.equal(before.owner[at(12)], before.byId.me);assert.equal(before.occ[at(12)], 1, 'before the fall: land taken in war');
  assert.ok(before.tk[at(12)] === 2000, 'the time each hex was taken');
  const F = { id: 's1', a: 'me', d: 'v', c: at(10), t: 7000, ft: 9000, df: 100, foes: ['me'], st: 'fell' };
  const T = run(MAP, [V(), A()], ev, [F]);
  assert.equal(T.byId.v, undefined, 'the fallen nation is off the map');
  assert.deepEqual(cols(held(T, 'me')), [10, 12, 13], 'the capital and the hexes taken from it stay with the conqueror');
  for (const c of [12, 13, 10]) { assert.equal(T.occ[at(c)], 0, `hex ${c} is plain land now`); assert.equal(T.spoil.get(at(c)), 'v', 'a spoil of the fallen nation'); }
  assert.equal(T.owner[at(11)], -1, 'the land nobody took lies open');assert.equal(T.owner[at(5)], -1);
  /* founded again elsewhere: the old nation's spoils stay where they are */
  const again = run(MAP, [V({ founded: 20000, loc: at(25) }), A()], ev, [F]);
  assert.deepEqual(cols(held(again, 'me')), [10, 12, 13]);
  assert.ok(held(again, 'v').length > 0, 'the risen nation has land of its own');
  assert.ok(!held(again, 'v').includes(at(12)), 'and none of what it lost');
});
test('what an ally took from the fallen nation in a war of its own stays with it, and what it handed on with the taker', () => {
  /* Tela tyhate, Bearland and Thalarara (24 Nov 2026): the ally declared its own war, so the referee's foes leave it out */
  const MAP = makeMap(COLS, 5, (r, c) => r === ROW || (r === 4 && c < 5) || (r === 0 && c >= 20));
  const nat = (id, name, loc, wars) => ({ id, me: id === 'me', npc: false, n: { name, loc, pop: 0, founded: 1, claims: [], wars } });
  const nations = () => [V(), { ...A(), n: { ...A().n, wars: { v: { t: 1000 } } } }, nat('bear', 'Bearland', 22, { v: { t: 1500 } }), nat('str', 'Stranger', 28, {})];
  const ev = [{ c: at(12), t: 2000, o: 'me', src: 'me', d: 'v' }, { c: at(14), t: 2500, o: 'bear', src: 'bear', d: 'v' }, { c: at(15), t: 2600, o: 'bear', src: 'bear', d: 'v' },
    { c: at(15), t: 2700, o: 'me', src: 'bear', bx: true, fr: 'bear', wr: true }, { c: at(16), t: 2800, o: 'str', src: 'str', d: 'v' }];
  const before = run(MAP, nations(), ev, [], true);
  assert.equal(before.owner[at(14)], before.byId.bear, 'the ally holds what it took');
  assert.equal(before.owner[at(15)], before.byId.me, 'and the hex it handed on is the taker\'s');
  assert.equal(before.owner[at(16)], before.byId.v, 'a nation at peace with it took nothing');
  const F = { id: 's1', a: 'me', d: 'v', c: at(10), t: 7000, ft: 9000, df: 100, foes: ['me'], st: 'fell' };
  const T = run(MAP, nations(), ev.concat({ c: at(10), t: 9000, o: 'me', src: 'me', d: 'v' }), [F], true);
  assert.equal(T.byId.v, undefined);
  assert.deepEqual(cols(held(T, 'me')), [10, 12, 15], 'the capital, its own conquest and the hex its ally handed it');
  assert.deepEqual(cols(held(T, 'bear')), [14], 'the ally keeps what it took, though the referee did not list it');
  assert.equal(T.spoil.get(at(14)), 'v');assert.equal(T.occ[at(14)], 0, 'as its own land');assert.equal(T.occ[at(15)], 0);
  assert.equal(T.owner[at(16)], -1, 'a conquest without a war is no spoil: that hex lies open with the rest');
  assert.equal(T.owner[at(11)], -1);
});
test('a capital lost while the government moved on stays the attacker’s, even with no land of its nation around it', () => {
  /* the capital moves (24 Nov 2026): Vesad's government moved from hex 10 to its city on hex 25, far off */
  const MAP = strip(), F = { id: 's1', a: 'me', d: 'v', c: at(10), t: 7000, ft: 9000, df: 100, foes: [], st: 'fell', ni: 'c1', nn: 'Brill' };
  const ev = [{ c: at(10), t: 9000, o: 'me', src: 'me', d: 'v' }];
  const T = run(MAP, [V({ loc: at(25) }), A()], ev, [F]);
  assert.notEqual(T.byId.v, undefined, 'Vesad is still on the map');assert.equal(T.list[T.byId.v].cap, at(25));
  assert.equal(T.owner[at(10)], T.byId.me, 'its old capital is the attacker’s');assert.equal(T.occ[at(10)], 1, 'as land taken in war');
  assert.equal(T.orig[at(10)], T.byId.v, 'from Vesad');
  assert.equal(T.owner[at(11)], -1, 'the land around it is nobody’s');
  /* only the conquest the referee's fall names: not another nation's, nor one at another time */
  const X = run(MAP, [V({ loc: at(25) }), A()], [{ ...ev[0], t: 50000 }], [F]);assert.equal(X.owner[at(10)], -1);
});
test('nothing is taken from a nation in its grace', () => {
  const MAP = strip(), ev = [{ c: at(12), t: 2000, o: 'me', src: 'me', d: 'v' }, { c: at(13), t: 5000, o: 'me', src: 'me', d: 'v' }];
  const T = run(MAP, [V({ grc: { t: 4000, u: 6000 } }), A()], ev);
  assert.equal(T.owner[at(12)], T.byId.me, 'taken before the grace');
  assert.equal(T.owner[at(13)], T.byId.v, 'the conquest in its grace does not count');
  const S = run(MAP, [V({ founded: 100, shd: 3000 }), A()], ev);
  assert.equal(S.owner[at(12)], S.byId.v, 'nor in the days after it rose again');
  assert.equal(S.owner[at(13)], S.byId.me);
});

test('a capital can be besieged when it is all the land left, or ringed by the besieger and its allies', () => {
  const MAP = makeMap(7, 7, () => true), cap = 3 * 7 + 3, nb = d => MAP.nbr[cap * 6 + d];
  const mk = owner => ({ list: [{ id: 'me', cap: 0 }, { id: 'v', cap }, { id: 'ally', cap: 48 }], owner, byId: { me: 0, v: 1, ally: 2 } });
  const ctx = vm.createContext({ MAP, myId: () => 'me', alliesOf: () => ['ally'] });
  vm.runInContext(['wrMine', 'wrCapExposed', 'wrCapReach'].map(fn).join('\n'), ctx);
  const owner = new Int16Array(MAP.N).fill(-1);owner[cap] = 1;
  assert.equal(ctx.wrCapExposed(mk(owner), 1), true, 'its last hex');
  const o2 = owner.slice();o2[nb(0)] = 1;
  assert.equal(ctx.wrCapExposed(mk(o2), 1), false, 'another hex of its own beside it');
  const o3 = owner.slice();o3[30] = 1;for (let d = 0; d < 6; d++) o3[nb(d)] = d < 3 ? 0 : 2;
  assert.equal(ctx.wrCapExposed(mk(o3), 1), true, 'ringed by the besieger and its ally, though land is left elsewhere');
  const o4 = o3.slice();o4[nb(5)] = -1;
  assert.equal(ctx.wrCapExposed(mk(o4), 1), false, 'a gap in the ring');
  const o5 = owner.slice();o5[3 * 7] = 0;
  assert.equal(ctx.wrCapReach(mk(o5), 1), true, 'three hexes of open land away');
  const o6 = owner.slice();o6[nb(0)] = 0;
  assert.equal(ctx.wrCapReach(mk(o6), 1), true, 'next to it');
  const far = makeMap(12, 1, () => true), fo = new Int16Array(12).fill(-1);fo[0] = 0;fo[11] = 1;
  const fctx = vm.createContext({ MAP: far, myId: () => 'me', alliesOf: () => [] });vm.runInContext(['wrMine', 'wrCapReach'].map(fn).join('\n'), fctx);
  assert.equal(fctx.wrCapReach({ list: [{ id: 'me', cap: 0 }, { id: 'v', cap: 11 }], owner: fo, byId: { me: 0, v: 1 } }, 1), false, 'too far');
});

test('what wars cost: each war more than the last (k^1.5), and a garrison for each occupied city', () => {
  const ctx = vm.createContext({ RES: ['food', 'timber', 'iron', 'oil', 'goods'], DEMAND: { food: 1, timber: 1, iron: 1, oil: 1, goods: 1 }, econSize: () => 100, Math, Object });
  vm.runInContext(vars(cut('const WAR_UP=', '\n/* the worst shortage')), ctx);
  const k = { a: 1, b: 2, c: 3, d: 0 };ctx.wrWarsOf = id => Array(k[id] || 0).fill({ g: 'c' });
  const T = { list: ['a', 'b', 'c', 'd'].map(id => ({ id, n: {} })) }, L = 4, dem = Object.fromEntries(ctx.RES.map(r => [r, new Float64Array(L)]));
  const U = ctx.wrUpkeep(T, { all: [{ active: true, hi: 3, fi: 0 }, { active: true, hi: 3, fi: 3 }] }, dem, L);
  assert.ok(Math.abs(U.war.iron[0] - 18) < 1e-9, 'one war: 18% more iron');
  assert.ok(Math.abs(U.war.iron[1] / U.war.iron[0] - Math.pow(2, 1.5)) < 1e-9, 'two wars: 2.8 times one');
  assert.ok(Math.abs(U.war.iron[2] / U.war.iron[0] - Math.pow(3, 1.5)) < 1e-9, 'three: 5.2 times');
  assert.equal(U.war.food[3], 6, 'at peace, only the garrison of one occupied city');assert.equal(U.gar[3], 1);
  assert.equal(dem.iron[1], U.war.iron[1], 'added to what the nation needs');
});

test('wartime losses: growth slows with each war, and the people fall a share a day', () => {
  const ctx = vm.createContext({ Math, DAY, WW_OR_TOP: 120, myId: () => 'me', clamp: (v, a, b) => Math.max(a, Math.min(b, v)), economy: () => ({ T: { byId: { me: 0 } }, ratio: { food: [0.5] } }) });
  vm.runInContext(['wrWeary', 'wrPopFx'].map(fn).join('\n'), ctx);
  ctx.wrWarsOf = () => [];assert.deepEqual(J(ctx.wrPopFx({})), { m: 1, l: 0 }, 'at peace: nothing');
  ctx.wrWarsOf = () => [{}, {}];const x = ctx.wrPopFx({ wwy: 50 });
  assert.ok(Math.abs(x.m - 0.1) < 1e-9, 'two wars: growth at a tenth');
  assert.ok(Math.abs(x.l - (0.008 + 0.015 + 0.005)) < 1e-9, '0.4% a war, 3% for want of all food, 1% at full weariness');
  const P = vm.createContext({ Math, DAY, npcPop: () => 0, rateOf: () => 0, migNet: () => 0 });
  vm.runInContext([fn('logistic'), fn('popNow'), fn('warLoss')].join('\n'), P);
  const n = { pop: 100, popAt: 0, pk: 100, pr: 0.001 }, d10 = 10 * DAY;
  assert.ok(P.popNow({ ...n, pwl: 0.01 }, d10) < 91, 'a tenth gone in ten days at 1% a day');
  assert.ok(Math.abs(P.popNow({ ...n, pwl: 0.01 }, 100 * DAY) - P.popNow({ ...n, pwl: 0.01 }, 30 * DAY)) < 0.5, 'counted for 30 days at most');
  assert.equal(P.popNow(n, d10), P.popNow({ ...n, pwl: 0 }, d10));
});

test('cities at war: shortages and weariness sour them, occupation too, and an edict can win them back', () => {
  const now = 1e12;
  const ctx = vm.createContext({ Math, DAY, WW_OR_TOP: 120, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), wrShort: () => ({ q: 0.5, r: 'iron' }) });
  vm.runInContext(['wrWeary', 'wrCityMood'].map(fn).join('\n'), ctx);
  const T = { owner: [0, 1], list: [{ id: 'me', n: { wwy: 50, wmb: { v: 8, u: now + 1 } } }, { id: 'them', n: {} }], byId: { me: 0, them: 1 }, tk: [0, now - DAY] };
  ctx.wrWarsOf = id => id === 'me' ? [{ id: 'them', g: 'c' }] : [];
  const parts = ctx.wrCityMood({ c: 0, fid: 'me', tT: T }, now);
  assert.deepEqual(J(parts.map(p => p[0])), [-20, -10, 8], 'shortages −20 (half supplied), weariness −10, the edict +8');
  const occ = ctx.wrCityMood({ c: 1, fid: 'me', tT: T }, now);
  assert.deepEqual(J(occ.map(p => p[1])), ['Under occupation'], 'held by a nation at peace: only the occupation');
  assert.equal(occ[0][0], -20, 'in its first week');
  T.tk[1] = now - 9 * DAY;assert.equal(ctx.wrCityMood({ c: 1, fid: 'me', tT: T }, now)[0][0], -10, 'less after');
  assert.match(SEC, /cxMoodOn=\(f=>function\(ct,now\)\{f\.apply\(this,arguments\);try\{ct\.strike=ct\.mood<STRIKE_AT&&wrAtWarCity\(ct\);if\(ct\.strike\)ct\.mk=0;/, 'a city at war under STRIKE_AT stops work');
});

test('the five war edicts: never drawn at random, the last edicts added, each with a way to sue for peace or soothe the cities', () => {
  const L = (() => { const c = vm.createContext({}); vm.runInContext(vars(cut('const WAR2_ISSUES=[', '\nfor(const is of WAR2_ISSUES)')), c); return c.WAR2_ISSUES; })();
  assert.deepEqual(J(L.map(x => x.id)), ['wr-bread', 'wr-foundry', 'wr-mothers', 'wr-general', 'wr-profit']);
  for (const is of L) {
    assert.equal(src.split(`id:'${is.id}'`).length, 2, is.id + ' once');assert.equal(src.split(`t:'${is.t}'`).length, 2, is.t + ' once');
    assert.ok(is.o.length >= 3 && is.o.every(o => o.t && o.fx && o.e), is.id + ' options');
    assert.ok(is.o.some(o => o.e.wpeace || o.e.wmb || o.e.wwy), is.id + ' does something about the war');
  }
  assert.match(SEC, /for\(const is of WAR2_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\);is\.no=ISSUES\.length;ISSUE_BY_ID\[is\.id\]=is;is\.nbx=false;\}/);
  const code = src.slice(0, src.lastIndexOf('</script>')), at = code.indexOf('for(const is of WAR2_ISSUES){');
  /* nothing after them but the veterans' edicts (war-round-three.test.mjs), which keep the same rule */
  const vet = code.indexOf('ISSUES.push(', at + 40);
  assert.ok(vet > 0 && code.lastIndexOf('for(const is of ', vet) === code.indexOf('for(const is of WAR3_ISSUES){'), 'only the veterans’ edicts after them');
  /* then the National Research Programme's (research.test.mjs), and nothing after those */
  const rsAt = code.indexOf('/* ───────── the National Research Programme (22 November 2026)'), rsP = code.indexOf('ISSUES.push(', vet + 20);
  assert.ok(rsAt > vet && rsP > rsAt, 'then the research edicts');
  {const rse=code.indexOf('/* ───────── research edicts (23 November 2026)'),nx=code.indexOf('ISSUES.push(', code.indexOf('/* ───────── military buildings (22 November 2026)'));assert.ok(rse>0&&nx>rse,'and nothing after those but the research edicts (research-edicts.test.mjs)');}
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'WAR2_ISSUES'/);
});
test('which war edict comes: the one that fits the trouble, one at a time and a day apart', () => {
  const ctx = vm.createContext({ OBS: false, S: { mode: 'world' }, DAY });
  vm.runInContext(vars(cut('const WAR2_ISSUES=[', '\nfor(const is of WAR2_ISSUES)')) + '\n' + vars(line('const WAR2_GAP=')) + '\n' + fn('wrEdictDue'), ctx);
  const now = 1e12, base = { inbox: [], answered: [] };ctx.S.nation = base;
  const U = (o) => { ctx.wrUnrest = () => ({ at: true, complain: [], strike: [], short: {}, ww: 0, ...o }); };
  U({ complain: [{}] });assert.equal(ctx.wrEdictDue(base, now).id, 'wr-bread', 'complaints, nothing short: the first not seen');
  U({ strike: [{}, {}] });assert.equal(ctx.wrEdictDue(base, now).id, 'wr-general', 'two cities on strike');
  U({ strike: [{}], short: { iron: 0.6 } });assert.equal(ctx.wrEdictDue(base, now).id, 'wr-foundry');
  U({ complain: [{}], short: { goods: 0.8 } });assert.equal(ctx.wrEdictDue(base, now).id, 'wr-profit');
  U({ complain: [{}], ww: 60 });assert.equal(ctx.wrEdictDue(base, now).id, 'wr-mothers');
  U({});assert.equal(ctx.wrEdictDue(base, now), null, 'no complaints, no edict');
  U({ at: false, complain: [{}] });assert.equal(ctx.wrEdictDue(base, now), null, 'at peace, none');
  U({ complain: [{}] });
  assert.equal(ctx.wrEdictDue({ ...base, wed: now - 3600000 }, now), null, 'a day apart');
  assert.equal(ctx.wrEdictDue({ ...base, inbox: [{ id: 'wr-mothers' }] }, now), null, 'one at a time');
  assert.equal(ctx.wrEdictDue({ ...base, answered: [{ id: 'wr-bread', t: now - DAY }] }, now).id, 'wr-foundry', 'one decided lately waits its turn');
});

test('an attack: a little weariness, and on land never its own it ends the attacker’s grace', () => {
  const a = cut('async function attack(){', '\nfunction declareWar(');
  assert.match(a, /n\.wwy=clamp\(\(\+n\.wwy\|\|0\)\+0\.25,0,100\);/);
  assert.match(a, /if\(n\.grc&&n\.grc\.u>now&&n\.grc\.t<=now&&T\.orig\[cell\]!==mi\)n\.grc=\{\.\.\.n\.grc,u:now\};/);
  assert.match(a, /const why=wrAttackWhy\(en\);if\(why\)/, 'a border war’s limit is checked first');
  assert.match(a, /\.\.\.\(capHit\?\{cap:1,occ:wrOccIds\(T,en\.id\)\}:\{\}\)/, 'the final assault tells the referee');
});

test('the record keeps what the war adds, within bounds', () => {
  const hook = cut('NORM_HOOKS.push((n,d)=>{\n  const now=Date.now(),ok=', '\n/* ── edict effects');
  const ctx = vm.createContext({ NORM_HOOKS: [], Date, Math, MAP: { N: 100 }, MAP_VER: 5, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), DAY,
    TRIB_MS: 14 * DAY, GRACE_MS: 3 * DAY, SHIELD_MS: 7 * DAY, FORT_MAX: 4, WW_OR_TOP: 120 });
  vm.runInContext(hook, ctx);const now = Date.now(), n = {};
  ctx.NORM_HOOKS[0](n, { founded: now, shd: now + 7 * DAY, surr: { a: now }, trib: [{ to: 'a', t: now, u: now + 14 * DAY }, { to: 'b', t: now, u: now + 40 * DAY }],
    grc: { t: now, u: now + 3 * DAY, k: 2 }, fort: { 5: now + 3600000, 500: now + 3600000, 6: now - 1 }, wwy: 140, wwyAt: now, pwl: 0.9,
    raid: [{ c: 3, t: now, d: 'v', s2: 'x' }], cv: 5, fel: { ft: now, by: 'a', bn: 'Axe', nm: 'Vesad', cap: 'Adler', reg: 'meridian', df: 1 }, wmb: { v: 99, u: now + DAY } });
  assert.equal(n.shd, now + 7 * DAY);assert.deepEqual(J(n.surr), { a: now });assert.equal(n.trib.length, 1, 'a tribute longer than 14 days is dropped');
  assert.deepEqual(J(Object.keys(n.fort)), ['5'], 'live forts on the map only');assert.equal(n.wwy, 120, 'weariness is kept up to the ceiling an overrule can buy');assert.equal(n.pwl, 0.2);
  assert.equal(n.raid.length, 1);assert.equal(n.fel.nm, 'Vesad');assert.equal(n.wmb.v, 20);assert.equal(n.grc.k, 2);
  const m = {};ctx.NORM_HOOKS[0](m, { founded: now, shd: now + 30 * DAY, grc: { t: now, u: now + 10 * DAY } });
  assert.equal(m.shd, undefined, 'a shield longer than the game gives');assert.equal(m.grc, undefined);
  assert.match(src, /wars\[k\]=d\.wars\[k\]\.by===1&&NPC_SET\.has\(k\)\?\{t,by:1\}:WAR_GOALS\[d\.wars\[k\]\.g\]\?\{t,g:d\.wars\[k\]\.g\}:\{t\};/, 'a war keeps its aim');
});

test('the referee: sieges and the final assault ride on the existing callable, and the letters say what happened', () => {
  const ref = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(ref, /if \(data\.op === 'siege'\) \{ pace\(\[\['rs:' \+ uid, 10, 1 \/ 60\]\]\); return siege\(uid, data\); \}/);
  assert.match(ref, /if \(win && sg\) \{/, 'a won final assault marks the fall');
  assert.match(ref, /now - num\(x\.t\) >= SIEGE_MS && now - num\(x\.t\) <= SIEGE_MAX/, 'between a day and three days into the siege');
  assert.match(readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), /match \/sieges\/\{sid\} \{ allow read: if true; \}/, 'read by every game, written by nobody but the server');
  assert.match(readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8'), /siege: function \(d\) \{ return A\.frozen \? hang\(\) : call\('referee', Object\.assign\(\{\}, isObj\(d\) \? d : \{\}, \{ op: 'siege' \}\)\); \}/);
  const cfg = { site: 'https://edictumgame.com' };
  const s = warLetter(cfg, { to: 'p@x.org', kind: 'siege', by: 'Axetère', nation: 'Vesad', capital: 'Adler', at: Date.UTC(2026, 10, 22, 12), tok: 't' });
  assert.equal(s.subject, 'Axetère has laid siege to Adler');assert.match(s.text, /22 Nov 2026 12:00 UTC/);assert.match(s.html, /surrender/i);
  const f = warLetter(cfg, { to: 'p@x.org', kind: 'fell', by: 'Axetère', nation: 'Vesad', capital: 'Adler', tok: 't' });
  assert.equal(f.subject, 'Adler has fallen');assert.match(f.html, /rise again/i);
});
