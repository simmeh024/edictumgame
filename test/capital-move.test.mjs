// The capital moves, and captured cities (24 Nov 2026; game/edictum.html, "the capital moves, and captured cities";
// functions/war-rules.js, successor; functions/index.js, the referee). A capital that falls while its nation has another
// city sends the government to the biggest of them, and the war goes on; only a nation with no city left falls. A city
// taken in war brings an edict: keep it, raze it, sack it and hold it, or give it back.
// Checked with the game's own code, cut from its source. Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { successor, builtKeys } from '../functions/war-rules.js';
import { warLetter } from '../functions/mail-core.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const ref = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const DAY = 864e5, H = 3600000, J = v => JSON.parse(JSON.stringify(v));
const SEC = cut('/* ───────── the capital moves, and captured cities (24 November 2026)', '/* ───────── land credits from the staff');
const CCL = (() => { const c = vm.createContext({}); vm.runInContext(vars(cut('const CC_ISSUES=[', '\n/* numbered after every other edict')), c); return c.CC_ISSUES; })();

/* ── the referee ── */
const city = (id, k, t, extra = {}) => ({ id, c: 0, nm: id.toUpperCase(), t, b: Array.from({ length: k }, (_, i) => ({ k: 'b' + i, d: 10 })), ...extra });
test('the referee moves the government to the biggest city left: most buildings, then the oldest, then by id', () => {
  const n = { cities: [city('cap', 6, 1), city('a', 2, 50), city('b', 4, 80), city('c', 4, 60), city('d', 1, 5)] };
  assert.equal(successor(n, { now: 100 }).id, 'c', 'four buildings each: the older of the two');
  assert.equal(successor(n, { occ: ['c'], now: 100 }).id, 'b', 'not one the attacker sees held by another nation');
  assert.equal(successor(n, { prior: [{ ci: 'cap', ni: 'c' }], now: 100 }).id, 'b', 'nor a capital lost before, nor the one it became');
  assert.equal(successor(n, { occ: ['a', 'b', 'c', 'd'], now: 100 }), null, 'no city left: the nation falls');
  assert.equal(successor({ cities: [city('cap', 3, 1)] }, { now: 100 }), null, 'a nation of one city falls with it');
  assert.equal(successor({ cities: [city('cap', 0, 1), city('x', 2, 9, { b: [{ k: 'farm', d: 10 }, { k: 'mill', d: 500 }] })] }, { now: 100 }).id, 'x');
  assert.deepEqual(builtKeys({ b: [{ k: 'farm', d: 10 }, { k: 'mill', d: 500 }, { d: 1 }] }, 100), ['farm'], 'finished buildings only');
  assert.equal(successor({}, {}), null);assert.equal(successor({ cities: [{ c: 1 }] }, {}), null, 'a city without an id cannot be named');
});
test('the final assault: a move marks the siege fallen with the new capital, a last capital with foes and the monument', () => {
  assert.match(ref, /const besieged = data\.cap === 1 && !npc \? await tx\.get\(db\.collection\('sieges'\)\.where\('d', '==', d\)\) : null;/, 'every siege of d, read before any write');
  assert.ok(ref.indexOf('const besieged') < ref.indexOf('tx.set(sg.ref, doc)'), 'reads come first in the transaction');
  assert.match(ref, /doc = \{ \.\.\.sg\.data\(\), st: 'fell', ft: now, ni: next\.id\.slice\(0, 16\), nn: str\(next\.nm\), ci: String\(ci\)\.slice\(0, 16\), cb: builtKeys\(/);
  assert.match(ref, /_word: \{ kind: 'moved', to: d,/);assert.match(ref, /warWord\(db, w\.to, w\.kind \|\| 'fell', w\)/);
  assert.match(ref, /const occ = Array\.isArray\(data\.occ\) \? data\.occ\.filter\(x => typeof x === 'string' && x\.length <= 16\)\.slice\(0, 40\) : \[\];/);
  /* a siege: a capital it lost before is no bar to another, and only the same capital's siege stands for it */
  assert.match(ref, /if \(x\.st === 'fell'\) \{ if \(typeof x\.ni !== 'string'\) return \{ ok: false, why: 'gone' \};/);
  assert.match(ref, /if \(x\.a === uid && x\.st === 'on' && x\.c === c && now - num\(x\.t\) <= SIEGE_MAX\)/);
  assert.match(ref, /const cn = str\(\(moved && moved\.nn\) \|\| them\.capital\);/, 'named after the city it moved to');
});
test('the letter: the capital has fallen, the government moved, the war goes on', () => {
  const L = warLetter({ site: 'https://x', from: 'a@x' }, { to: 'p@x', kind: 'moved', by: 'Axe', nation: 'Vesad', capital: 'Adler', nn: 'Brill', tok: 't' });
  assert.equal(L.subject, 'Adler has fallen');assert.match(L.html, /Brill/);assert.match(L.html, /war goes on/);assert.doesNotMatch(L.html, /rise again/i);
  assert.match(L.text, /moved to Brill/);
  const S = warLetter({ site: 'https://x', from: 'a@x' }, { to: 'p@x', kind: 'siege', by: 'Axe', nation: 'Vesad', capital: 'Adler', at: 1e12, tok: 't' });
  assert.match(S.html, /your government moves to your biggest city/);
});

/* ── the records as read ── */
function world(falls, recs, extra = {}) {
  const S = { mode: 'world', uid: 'me', nation: recs.me || null, world: Object.fromEntries(Object.entries(recs).filter(([k]) => k !== 'me')) };
  const ctx = vm.createContext({ S, OBS: '', PV: null, DAY, Map, Set, WeakMap, Math, Object, Array, JSON, String, Number, console, window: {},
    WR: { ready: true }, wrFallsAt: () => falls, myId: () => S.uid, sealed: () => true, cellOf: l => (l && Number.isInteger(l.c) ? l.r * 10 + l.c : -1),
    locOf: i => ({ c: i % 10, r: Math.floor(i / 10), m: 5 }), passForget() {}, setTimeout() {}, dormSift: () => 0, NORM_HOOKS: [], ST_LOG: {}, NOTIF_K: {},
    logLine: () => '', syncInbox: n => n, fill: s => s, answer() {}, dismiss() {}, applyEffects: (n, e) => n, MAP_PANEL: [], COMMIT_HOOKS: [], nameOf: id => 'N:' + id,
    clone: o => JSON.parse(JSON.stringify(o)), toast() {}, commit: n => { S.nation = n; ctx.saved = (ctx.saved || 0) + 1; }, myFall: () => null, ...extra });
  vm.runInContext([line('const capSince='), fn('cityList'), fn('cityLabel'), vars(SEC)].join('\n'), ctx);
  return ctx;
}
const loc = c => ({ c: c % 10, r: Math.floor(c / 10), m: 5 });
const vesad = (o = {}) => ({ name: 'Vesad', capital: 'Adler', founded: 100, loc: loc(11), cities: [{ id: 'cap', c: 11, nm: '', t: 100, b: [] }, { id: 'c1', c: 45, nm: 'Brill', t: 200, b: [] }, { id: 'c2', c: 77, nm: 'Corve', t: 300, b: [] }], log: [], ...o });
const MOVE = { id: 's1', a: 'me', d: 'v', c: 11, ft: 5000, df: 100, ni: 'c1', nn: 'Brill', ci: 'cap', cb: ['farm'], an: 'Axe', cn: 'Adler', st: 'fell' };
test('a capital moved: every page reads the nation with its capital in its next city, the city it lost gone', () => {
  const G = world([MOVE], { v: vesad(), me: { name: 'Axe' } });
  const v = G.wrRewrite(G.S.world.v, 'v');
  assert.deepEqual(J(v.loc), J(loc(45)));assert.equal(v.capital, 'Brill');
  assert.deepEqual(J(v.cities.map(c => c.id)), ['c1', 'c2'], 'the new capital first, the old one gone');
  assert.equal(G.wrRewrite(v, 'v'), v, 'the same record once it is moved: nothing to do again');
  /* a second fall moves it on, from the record as saved before either */
  const G2 = world([MOVE, { ...MOVE, id: 's2', c: 45, ft: 9000, ni: 'c2', nn: 'Corve', ci: 'c1' }], { v: vesad() });
  const v2 = G2.wrRewrite(G2.S.world.v, 'v');assert.equal(v2.capital, 'Corve');assert.deepEqual(J(v2.cities.map(c => c.id)), ['c2']);
  /* another nation's, or one founded again since: untouched */
  assert.equal(G.wrRewrite(vesad({ founded: 6000 }), 'v').capital, 'Adler', 'a nation founded again is not the one that fell');
  assert.equal(G.wrRewrite(vesad({ capAt: 7000 }), 'v').capital, 'Adler', 'nor a capital settled again since');
  /* the region as read, once a snapshot of the sieges comes in */
  G.wrWorldSync();assert.equal(G.S.world.v.capital, 'Brill');
});
test('its own page saves the move, with a line for the capital lost, once', () => {
  const G = world([MOVE], { me: vesad(), x: { name: 'Axe' } });G.S.uid = 'v';
  G.wrMoveSync();
  assert.equal(G.saved, 1);assert.equal(G.S.nation.capital, 'Brill');assert.deepEqual(J(G.S.nation.loc), J(loc(45)));
  assert.equal(G.S.nation.log[0].k, 'cfled');assert.equal(G.S.nation.log[0].a, 'Adler');assert.equal(G.S.nation.log[0].fx, 'Brill');
  G.wrMoveSync();assert.equal(G.saved, 1, 'nothing more to save');
});
test('a city kept or razed by the nation that took it in war leaves its old nation; a claim without the conquest does not', () => {
  const taker = (cities, czr, conq) => ({ name: 'Axe', cities, czr, conq });
  const kept = [{ id: 'q1', c: 45, nm: 'Brill', t: 4000, cq: 'Vesad', cf: 'v', cfi: 'c1', b: [] }];
  const G = world([], { v: vesad(), a: taker(kept, [{ c: 77, d: 'v', id: 'c2', t: 4500 }], [{ c: 45, d: 'v', t: 3000 }, { c: 77, d: 'v', t: 3100 }]) });
  const v = G.wrRewrite(G.S.world.v, 'v');assert.deepEqual(J(v.cities.map(c => c.id)), ['cap'], 'kept by one, razed by the other');
  const L = G.WR_RW.get(v).lost;assert.deepEqual(J(L.map(e => [e.nm, e.r])), [['Brill', 0], ['Corve', 1]]);
  /* a record that claims the city with no conquest of its hex from that nation takes nothing */
  const F = world([], { v: vesad(), a: taker(kept, [{ c: 77, d: 'v', t: 4500 }], []) });
  assert.equal(F.wrRewrite(F.S.world.v, 'v'), F.S.world.v);
  /* a hex handed over in war counts as taken */
  const B = world([], { v: vesad(), a: taker(kept, [], []), b: { name: 'Bear', bx: [{ c: 45, to: 'a', fr: 'b', wr: 1, t: 2000 }] } });
  assert.deepEqual(J(B.wrRewrite(B.S.world.v, 'v').cities.map(c => c.id)), ['cap', 'c2']);
  /* never the capital, nor a city founded after it was taken */
  const late = world([], { v: vesad({ cities: [{ id: 'cap', c: 11, t: 100, b: [] }, { id: 'n', c: 45, nm: 'New', t: 9000, b: [] }] }), a: taker(kept, [], [{ c: 45, d: 'v', t: 3000 }]) });
  assert.equal(late.wrRewrite(late.S.world.v, 'v'), late.S.world.v);
});
test('the attacker sends the cities held by others, and sees where the government would go', () => {
  const G = world([], { v: vesad({ cities: [{ id: 'cap', c: 11, t: 100, b: [] }, { id: 'c1', c: 45, nm: 'Brill', t: 200, b: [{ k: 'farm', d: 1 }] }, { id: 'c2', c: 77, nm: 'Corve', t: 150, b: [{ k: 'farm', d: 1 }, { k: 'mill', d: 1 }] }] }) });
  const owner = new Int16Array(100).fill(-1);owner[11] = 0;owner[45] = 0;owner[77] = 1;
  const T = { byId: { v: 0, me: 1 }, list: [{ id: 'v', n: G.S.world.v, cap: 11 }, { id: 'me', n: {}, cap: 99 }], owner };
  assert.deepEqual(J(G.wrOccIds(T, 'v')), ['c2'], 'Corve is held by the attacker');
  assert.equal(G.wrNextCap(T, T.list[0]).id, 'c1', 'the biggest city still its own');
  assert.match(G.wrFallWords(T, T.list[0]), /moves to Brill, its biggest city, and the war goes on/);
  owner[45] = 1;assert.equal(G.wrNextCap(T, T.list[0]), null);assert.equal(G.wrFallWords(T, T.list[0]), 'Vesad falls with it');
});
test('only a nation’s last capital ends it: the map, its wars, its fallen screen, the monuments', () => {
  const c = vm.createContext({ S: { mode: 'world' }, WR: { docs: new Map([['s1', MOVE], ['s2', { ...MOVE, id: 's2', ni: undefined, ft: 9000 }]]), rev: 1 } });
  vm.runInContext([line('let wrFallMemo='), fn('wrFallsAt'), fn('wrEndsAt'), fn('wrFellOf')].join('\n'), c);
  assert.equal(c.wrFallsAt(null).length, 2);assert.deepEqual(J(c.wrEndsAt(null).map(F => F.id)), ['s2']);assert.equal(c.wrEndsAt(null), c.wrEndsAt(null), 'kept');
  assert.equal(c.wrFellOf('v', { founded: 100 }, [MOVE]), null, 'a capital moved is no fall');
  assert.equal(c.wrFellOf('v', { founded: 100 }).id, 's2');
  for (const k of ['const FL=wrEndsAt(TERR_AT),MV=new Map();', 'const FL=wrEndsAt(null).slice().reverse().slice(0,8);', "const f=wrEndsAt(null).find(x=>x.d===MON_FIRST.id)", 'const FL=wrEndsAt(null);if(monMemo.FL===FL'])
    assert.ok(src.includes(k), k);
  /* a siege stands for the capital its nation has now */
  assert.match(fn('wrSiege'), /const cap=cellOf\(D\.loc\);/);assert.match(fn('wrSiege'), /if\(cap>=0&&x\.c!==cap\)continue;/);
});

/* ── captured cities: their edicts ── */
test('eight edicts for a captured city, each offering to keep it, raze it and give it back', () => {
  assert.equal(CCL.length, 8);assert.equal(new Set(CCL.map(x => x.id)).size, 8);
  for (const is of CCL) {
    assert.match(is.id, /^cc-[a-z]+$/);assert.equal(src.split(`{id:'${is.id}',c:`).length, 2, is.id + ' once');
    assert.ok(/\{CCITY\}/.test(is.t + is.q) && /\{CFROM\}/.test(is.q + is.o.map(o => o.t + o.fx).join('')), is.id + ' names the city and its nation');
    assert.ok(is.o.length === 4 && is.o.every(o => o.t && o.e && o.fx && /^“/.test(o.t) && / says /.test(o.t)), is.id + ' four options in the house style');
    assert.ok(is.o.some(o => o.e.ccc), is.id + ' keep');assert.ok(is.o.some(o => o.e.ccr), is.id + ' raze');assert.ok(is.o.some(o => o.e.ccf), is.id + ' give back');
    for (const o of is.o) assert.equal(['ccc', 'ccr', 'ccs', 'ccf'].filter(k => o.e[k]).length, 1, is.id + ': one fate an answer');
  }
  assert.ok(CCL.filter(is => is.o.some(o => o.e.ccs)).length >= 6, 'sacked and held in most');
  assert.ok(CCL.some(is => is.o.some(o => o.e.ccc === 'new')), 'renamed after our capital in some');
  /* numbered after every other edict, never drawn at random */
  const reg = src.indexOf("if(typeof CC_ISSUES!=='undefined'&&typeof ISSUES!=='undefined')for(const is of CC_ISSUES){if(ISSUE_BY_ID[is.id])continue;is.fo=1;ISSUES[ISSUES.length]=is;");
  assert.ok(reg > src.indexOf("\nif(typeof wsPush==='function')wsPush(WS_ACT1,WS_N);") && reg > src.indexOf('} /* end Dhaluun event */'), 'the last edicts added');
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'CQ_ISSUES','CC_ISSUES'/);
});
function desk(cities, n, extra = {}) {
  const S = { mode: 'world', uid: 'me', nation: n, world: {} };
  const T = { byId: { me: 0, v: 1 }, list: [{ id: 'me' }, { id: 'v' }], occ: new Uint8Array(100), tk: new Float64Array(100), owner: new Int16Array(100).fill(-1) };
  for (const c of cities) { T.owner[c.c] = c.hi;if (c.occ) { T.occ[c.c] = 1;T.tk[c.c] = c.tk; } }
  const ctx = vm.createContext({ S, OBS: '', PV: null, DAY, Map, Set, WeakMap, Math, Object, Array, JSON, String, Number, console, window: {}, myId: () => 'me', territory: () => T,
    cityState: () => ({ all: cities.map(c => ({ id: c.id, c: c.c, nm: c.nm, fid: c.fid, fn: { name: c.fid === 'v' ? 'Vesad' : 'Axe' }, hi: c.hi, cap: !!c.cap, npc: !!c.npc })) }),
    hash: s => [...s].reduce((a, ch) => a + ch.charCodeAt(0), 0), deskN: l => l.length, EDICT_KEEP: 10, nameOf: id => id, clone: o => JSON.parse(JSON.stringify(o)),
    dormSift: () => 0, NORM_HOOKS: [], ST_LOG: {}, NOTIF_K: {}, logLine: () => '', syncInbox: n => n, fill: s => s, answer() {}, dismiss() {}, applyEffects: (n, e) => { n.fx = e; return n; },
    MAP_PANEL: [], COMMIT_HOOKS: [], wrFallsAt: () => [], cityList: n => n.cities || [], cityLabel: (n, c) => c.nm, CQ_MAX: 10, CITY_SLOTS: 4, BUILDINGS: { farm: {}, mill: {}, colossus: { w: 1 } },
    docOf: id => (id === 'v' ? { cities: [{ id: 'c1', c: 45, b: [{ k: 'farm', d: 1 }, { k: 'colossus', d: 1 }, { k: 'mill', d: 9e15 }] }] } : null), landName: () => 'the plain',
    wrLoot: () => ({ food: 10, goods: 10 }), stockNow: n => ({ ...(n.stock || {}) }), stockLimit: (n, r, v) => v, num0: v => +v || 0, roundStock: s => s, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), GW_MAX: 40,
    cqGoodwill: (n, k) => { n.gwall = (n.gwall || 0) + k; }, toast() {}, Date, ...extra });
  vm.runInContext(vars(SEC), ctx);return ctx;
}
const CITIES = [{ id: 'c1', c: 45, nm: 'Brill', fid: 'v', hi: 0, occ: 1, tk: 4000 }, { id: 'c2', c: 77, nm: 'Corve', fid: 'v', hi: 0, occ: 1, tk: 3000 },
  { id: 'cap', c: 11, nm: 'Adler', fid: 'v', hi: 1, cap: 1 }, { id: 'h', c: 12, nm: 'Home', fid: 'me', hi: 0 }, { id: 'n', c: 13, nm: 'Npc', fid: 'npc-x', hi: 0, occ: 1, tk: 1, npc: 1 }];
test('one edict for each city taken in war, arriving when its hex was taken, until its fate is decided', () => {
  const n = { name: 'Axe', capital: 'Axeburg', inbox: [], answered: [], cities: [], log: [] }, G = desk(CITIES, n);
  assert.deepEqual(J(G.ccOpen(n).map(C => [C.key, C.nm, C.fn, C.at])), [['v:c2', 'Corve', 'Vesad', 3000], ['v:c1', 'Brill', 'Vesad', 4000]], 'cities of other players on land taken in war, oldest first');
  const due = G.ccDue(n, 10000);assert.equal(due.length, 2);assert.deepEqual(J(due.map(x => x.at)), [3000, 4000], 'each at the moment its hex was taken');
  assert.notEqual(due[0].id, due[1].id, 'a different edict for each');
  n.inbox = due;assert.deepEqual(J(G.ccDue(n, 10000)), [], 'on the desk: nothing more due');
  assert.equal(G.ccCityOf(n, due[1]).nm, 'Brill', 'each edict knows its city by its arrival');
  n.ccd = ['v:c2'];assert.deepEqual(J(G.ccOpen(n).map(C => C.key)), ['v:c1'], 'decided: no edict again');
});
test('keep, raze, sack or give back: what each answer does', () => {
  const n = () => ({ name: 'Axe', capital: 'Axeburg', inbox: [], answered: [], cities: [{ id: 'h', c: 12, nm: 'Home', t: 1, b: [] }], log: [], stock: { food: 5, goods: 5 }, gw: {} });
  const G = desk(CITIES, null), C = G.ccOpen({ ccd: [] }).find(C => C.id === 'c1');
  const ans = e => { const x = n();vm.runInContext('CC_NOW=__C;', Object.assign(G, { __C: { id: 'cc-gates', C } }));try { G.applyEffects(x, e); } finally { vm.runInContext('CC_NOW=null;', G); }return x; };
  let x = ans({ mil: 1, ccc: 'keep', ccb: 1 });
  const k = x.cities.find(c => c.c === 45);assert.ok(k, 'kept as a city');assert.equal(k.nm, 'Brill');assert.equal(k.cq, 'Vesad');assert.equal(k.cf, 'v');assert.equal(k.cfi, 'c1');
  assert.deepEqual(J(k.b.map(b => b.k)), ['farm'], 'its finished buildings, no wonder');assert.deepEqual(J(x.ccd), ['v:c1']);assert.deepEqual(J(x.fx), { mil: 1 }, 'the rest goes on as usual');
  x = ans({ ccc: 'new' });assert.equal(x.cities.find(c => c.c === 45).nm, 'New Axeburg');assert.deepEqual(J(x.cities.find(c => c.c === 45).b), []);
  x = ans({ mil: 2, gwall: -2, ccr: 1 });assert.deepEqual(J(x.czr.map(z => [z.c, z.d, z.id])), [[45, 'v', 'c1']]);assert.equal(x.gwall, -2);assert.equal(x.log[0].k, 'czraze');
  x = ans({ ccs: 1 });assert.deepEqual(J(x.stock), { food: 35, goods: 35 }, 'three raids’ worth of loot');assert.equal(x.gw.v, -3);assert.ok(!x.cities.some(c => c.c === 45), 'held, not kept');
  x = ans({ gwall: 3, ccf: 1 });assert.deepEqual(J(x.bx), [{ c: 45, t: x.bx[0].t, to: 'v', fr: 'me' }], 'handed back');assert.equal(x.gw.v, 8);assert.equal(x.gwall, 3);
});
test('the records keep where a captured city came from, and what was razed', () => {
  assert.match(fn('normCities'), /cq\?\{cq,\.\.\.ccFrom\(c\)\}:\{\}/);
  const G = desk([], null), hook = G.NORM_HOOKS[0], n = {};
  hook(n, { ccd: ['v:c1', 5], czr: [{ c: 45, d: 'v', id: 'c1', t: 9, nm: 'Brill' }, { c: -1, d: 'v' }, { c: 3, d: 'bad id!' }] });
  assert.deepEqual(J(n), { ccd: ['v:c1'], czr: [{ c: 45, d: 'v', id: 'c1', t: 9, nm: 'Brill' }] });
  assert.deepEqual(J(G.ccFrom({ cf: 'v', cfi: 'c1' })), { cf: 'v', cfi: 'c1' });assert.deepEqual(J(G.ccFrom({ cf: 'bad id!' })), {});
});
test('every function of the section is the only one of its name in the game (a second would replace the first)', () => {
  const names = [...SEC.matchAll(/\nfunction (\w+)\(/g)].map(m => m[1]);
  assert.ok(names.length >= 15, names.join());
  for (const k of names) assert.equal(src.split('\nfunction ' + k + '(').length, 2, k + ' is defined once');
  for (const k of ['WR_RW', 'CC_ISSUES', 'CC_SET', 'CC_LOOT', 'CC_NOW', 'wrLostMemo']) assert.equal((src.match(new RegExp('(?:(?:const|let|var) |,)' + k + '=', 'g')) || []).length, 1, k + ' declared once');
});
