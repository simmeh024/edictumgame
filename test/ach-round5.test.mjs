// Achievements, round five (game/edictum.html, 14 November 2026): 54 achievements for treaties, alliance pacts and
// projects, diplomatic gifts, letters and goodwill, city titles and walls, war, portraits, Mars and the belt, field digs
// and moving region, and the tally hook that counts gifts and broken treaties.
// The section runs here as written, with the game's own rules (TY_RULES, AL_RULES, GF_KINDS, BLK_TI, CX_WALL, PT_LOCK,
// SP_BLDS, the portfolios) and helpers it reads (tyLive, alRelLiveG, blkTi, spMileHit), against made-up records.
//   node --test test/ach-round5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const START = '/* ───────── achievements, round five', END = 'const hot=window.claude&&window.claude.hot;';
const at = html.indexOf(START), end = html.indexOf(END, at);
assert.ok(at > 0 && end > at, 'the section, at the end of the script');
const BLOCK = html.slice(at, end);
const grab = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const DAY = 86400000, NOW = Date.UTC(2026, 10, 14, 12);

const REAL = [
  /const TY_RULES=\{[\s\S]*?fx:\{[^}]*\}\};/, /function tyLive\(T,now\)\{.*\}/, /function alRelLiveG\(r,now\)\{.*\}/,
  /const AL_RULES=\{[\s\S]*?pactBreak:\d+\}\};/, /const AL_PJ=\{[\s\S]*?chronicle:\[[^\]]*\]\};/,
  /const GF_KINDS=\{.*\};/, /const GW_MAX=\d+;/, /const TALLY_MAX=\d+/, /function gbBump\(n,k,by,now\)\{.*\}/, /const PORTFOLIOS=\[.*\];/, /const PF_KEYS=PORTFOLIOS\.map\(p=>p\[0\]\)/,
  /const BLK_TI=\[.*\];/, /const blkTi=rec=>.*;/, /const CX_WALL=\[.*\];/, /const PT_LOCK=\{[\s\S]*?\]\};/,
  /const SP_BLDS=\{[\s\S]*?\n\};/, /const spMileHit=.*;/, /const DIG_SETS=\[.*\];/
].map(grab).join('\n');

/* a world of made-up treaties, alliances, colonies and digs; each test sets what it needs */
function world() {
  const A = {}, HOOKS = [], W = { docs: [], al: {}, mars: {}, belt: {}, digs: {}, pt: [] };
  const ctx = vm.createContext({
    Math, Object, Set, Array, Number, isFinite, Date, JSON, DAY, W,
    COMMIT_HOOKS: HOOKS,
    achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
    achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), achYes: v => v ? 1 : 0, num0: v => Number.isFinite(+v) ? +v : 0,
    aT: (x, k) => (x.n.tly && x.n.tly[k]) || 0,
    aKeys: (x, pre) => Object.keys(x.n.tly || {}).filter(k => k.startsWith(pre) && x.n.tly[k] > 0).length,
    aAns: (x, f) => (x.n.answered || []).filter(a => { try { return f(a); } catch (e) { return false; } }).length,
    aFronts: x => x.n.fronts || 0,
    myId: () => 'me', tyList: id => W.docs.filter(T => T.p.includes(id)),
    allianceOf: id => W.al[id] || null,
    gfSent: n => Array.isArray(n && n.gft) ? n.gft : [], gfReplies: n => Array.isArray(n && n.gfr) ? n.gfr : [],
    cxWallLv: (c, now) => c.wu && c.wu.d <= now ? c.wu.l : c.wl || 0,
    cabOf: n => n.cab, ptCodeOf: n => n.cdc ? ['court'] : null, ptNick: n => n.rpt && n.rpt.k ? 'the Bold' : '',
    PT_ISSUES: [{ id: 'pt-court-painter' }], ptGolds: () => 0, ptDays: () => 0, cityCount: () => 0, gamesMedals: () => 0,
    SPB: { moon: { id: 'moon' }, mars: { id: 'mars' } }, spColony: (B, o) => o && o.col, spWorld: () => ({ byId: W.mars }),
    spNbrs: (B, C) => C.nb || [], BT_RS: Array.from({ length: 36 }, (_, i) => ({ i })),
    btCount: m => { let k = 0; for (let i = 0; i < 36; i++)if (Math.floor((m || 0) / 2 ** i) % 2) k++; return k; },
    btWho: x => W.belt[x.id] || null,
    digHeld: (n, sid) => (W.digs[sid] || 0), digSet: sid => ({ items: Array(sid === 'dg-fords' ? 12 : 10).fill(0) })
  });
  vm.runInContext(REAL + '\n' + BLOCK + '\nthis.R={TY_RULES,AL_RULES,GF_KINDS,GW_MAX,PT_LOCK,SP_BLDS,BLK_TI,CX_WALL,DIG_SETS,TALLY_MAX};', ctx);
  return { A, HOOKS, W, R: ctx.R };
}
const X = world();
const val = (id, n, o = {}) => +X.A[id].f({ n, id: 'me', me: true, npc: false, now: NOW, m: {}, ...o }) || 0;
const earned = (id, n, o) => val(id, n, o) >= X.A[id].g;
const hook = X.HOOKS[0];

test('54 achievements, with ids and names of their own, in the right categories and tiers', () => {
  const all = Object.values(X.A);
  assert.equal(all.length, 54);
  const per = {}; for (const a of all) per[a.t] = (per[a.t] || 0) + 1;
  assert.deepEqual(per, { b: 14, s: 23, g: 16, p: 1 });
  assert.equal(all.reduce((s, a) => s + TIER[a.t], 0), 1615);
  const cats = new Set([...grab(/const ACH_CATS=\[.*\];/).matchAll(/\['([a-z]+)','/g)].map(m => m[1]));
  for (const a of all) {
    assert.ok(cats.has(a.c), a.id + ' in a known category');
    assert.ok(a.d.length > 10 && /[.!]$/.test(a.d), a.id + ' has a sentence');
    assert.ok(typeof a.g === 'number' && a.g >= 1, a.id + ' has a goal');
  }
  /* nowhere else in the game: not the ids, not the names (literal achDef calls and the P() helpers of the passport) */
  const lit = [...html.matchAll(/achDef\('[a-z]+','([a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const pp = [...html.matchAll(/\bP\('([a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const tbl = [...html.matchAll(/\['([a-z]+-[a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)].map(m => [m[1], m[2]]);
  const every = lit.concat(pp, tbl);
  for (const a of all) {
    assert.equal(every.filter(([i]) => i === a.id).length, 1, 'id once: ' + a.id);
    assert.equal(every.filter(([, n]) => n === a.n).length, 1, 'name once: ' + a.n);
  }
  /* the one secret that is a joke at the player's expense, and the other with a hint */
  assert.deepEqual(all.filter(a => a.o.sec).map(a => a.id).sort(), ['dip-tybrk', 'war-lost10']);
  /* only the alliance and thank-you honours need another player */
  assert.deepEqual(all.filter(a => a.o.mp).map(a => a.id).sort(), ['dip-alnew', 'dip-alpact', 'dip-alpjall', 'dip-alrival', 'dip-gfthx', 'dip-gfthx25']);
});

test('the goals follow the game’s own rules', () => {
  const { R } = X;
  assert.equal(X.A['dip-tyfull'].g, R.TY_RULES.max.nap + R.TY_RULES.max.trade + R.TY_RULES.max.research);
  assert.equal(X.A['dip-tytr3'].g, R.TY_RULES.max.trade); assert.equal(X.A['dip-tyrs3'].g, R.TY_RULES.max.research);
  assert.match(X.A['dip-tyfull'].d, /8 non-aggression pacts, 3 trade agreements and 3 research pacts/);
  assert.equal(X.A['dip-alpjall'].g, Object.values(R.AL_RULES.projects).reduce((s, p) => s + p.max, 0));
  assert.match(X.A['dip-alnew'].d, /Beacon Towers, an Alliance Academy and a Hall of Chronicles/);
  assert.equal(X.A['dip-gfkinds'].g, Object.keys(R.GF_KINDS).length);
  assert.equal(X.A['dip-gw40'].g, R.GW_MAX);
  assert.match(X.A['land-ti3'].d, new RegExp(R.BLK_TI[2].n + ': .*at least ' + R.BLK_TI[2].at + ' blocks'));
  assert.match(X.A['war-wall3'].d, new RegExp('level ' + (R.CX_WALL.length - 1)));
  assert.equal(X.A['cab-ptlock'].g, Object.keys(R.PT_LOCK).length);
  assert.equal(X.A['cab-ptcab'].g, 7);
  assert.equal(X.A['sp-mars-all'].g, Object.keys(R.SP_BLDS.mars).length);
  assert.equal(X.A['sp-mars-cm8'].g, R.SP_BLDS.mars.cm.max);
  assert.deepEqual([...R.DIG_SETS], ['dg-fords', 'dg-tide'], 'two dig collections, as “both” says');
  assert.equal(X.A['mus-digall'].g, 2);
});

test('the tally counts diplomatic gifts sent and answered, the first time from what the record still holds', () => {
  const g = (id, to, k, t) => ({ id, to, k, m: 0, t });
  /* a record never counted: every gift it still holds counts once */
  const n = { name: 'A', tly: { iss: 3 }, tlf: {}, gft: [g('a', 'x', 'card', 1), g('b', 'y', 'note', 2)], gfr: [{ id: 'q', f: 'x', k: 'dish', m: 0, t: 3 }] };
  assert.equal(hook(n, { ...n }, NOW).length, 0, 'it toasts nothing');
  assert.equal(n.tly.gft, 2); assert.equal(n.tly.gfr, 1); assert.equal(n.tly.gfv, 1);
  assert.equal(n.tly['gft:k:card'], 1); assert.equal(n.tly['gft:to:y'], 1); assert.equal(n.tlf.gft, 1);
  /* after that, only what is new since the save before */
  const old = JSON.parse(JSON.stringify(n));
  n.gft = n.gft.concat(g('c', 'x', 'dish', 4)); hook(n, old, NOW);
  assert.equal(n.tly.gft, 3); assert.equal(n.tly['gft:to:x'], 2); assert.equal(n.tly['gft:k:dish'], 1);
  const old2 = JSON.parse(JSON.stringify(n)); hook(n, old2, NOW);
  assert.equal(n.tly.gft, 3, 'nothing new, nothing counted');
  /* a gift dropped from the list (60 days, 40 at most) is not taken off */
  const old3 = JSON.parse(JSON.stringify(n)); n.gft = n.gft.slice(1); hook(n, old3, NOW); assert.equal(n.tly.gft, 3);
  /* a treaty broken at once (tyPenalty's mark) */
  const old4 = JSON.parse(JSON.stringify(n)); n._trb = 'x'; hook(n, old4, NOW); assert.equal(n.tly.tybrk, 1);
  /* computer nations, unnamed and untallied records are left alone */
  for (const r of [{ npc: true, name: 'B', tly: {}, gft: [g('a', 'x', 'card', 1)] }, { tly: {}, gft: [g('a', 'x', 'card', 1)] }, { name: 'C', gft: [g('a', 'x', 'card', 1)] }]) { hook(r, null, NOW); assert.ok(!r.tly || !r.tly.gft); }
  /* a full tally never sets gfv, so it never counts the same gifts again and again */
  const full = { name: 'D', tly: Object.fromEntries(Array.from({ length: X.R.TALLY_MAX }, (_, i) => ['k' + i, 1])), gft: [g('a', 'x', 'card', 1)] };
  hook(full, null, NOW); hook(full, null, NOW); assert.equal(full.tly.gft, undefined); assert.equal(full.tly.gfv, undefined);
});

test('gifts, letters and goodwill read the tally and the record', () => {
  const t = tly => ({ tly });
  assert.ok(earned('dip-gf1', t({ gft: 1 }))); assert.ok(!earned('dip-gf1', t({})));
  assert.ok(earned('dip-gfkinds', t({ 'gft:k:card': 1, 'gft:k:note': 2, 'gft:k:dish': 1 }))); assert.ok(!earned('dip-gfkinds', t({ 'gft:k:card': 5, 'gft:k:note': 2 })));
  assert.ok(earned('dip-gf25', t({ gft: 25 }))); assert.ok(!earned('dip-gf100', t({ gft: 99 }))); assert.ok(earned('dip-gf100', t({ gft: 100 })));
  const to = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['gft:to:n' + i, 1]));
  assert.ok(earned('dip-gfto10', t(to))); delete to['gft:to:n0']; assert.ok(!earned('dip-gfto10', t(to)));
  assert.ok(earned('dip-gfthx', t({ gfr: 1 }))); assert.ok(earned('dip-gfthx25', t({ gfr: 25 }))); assert.ok(!earned('dip-gfthx25', t({ gfr: 24 })));
  const dm = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ['dm:n' + i, 2]));
  assert.ok(earned('dip-dm15', t(dm))); assert.ok(earned('dip-dm100', t({ dm: 100 }))); assert.ok(!earned('dip-dm100', t({ dm: 99 })));
  assert.ok(earned('dip-gw40', { gw: { a: 12, b: 40 } })); assert.ok(!earned('dip-gw40', { gw: { a: 39, b: -40 } })); assert.equal(val('dip-gw40', {}), 0);
  assert.ok(earned('dip-tybrk', t({ tybrk: 1 })));
});

test('treaties count only while in force, and an ending one until its notice runs out', () => {
  const T = (k, st, o = {}) => ({ k, p: ['me', 'n' + Math.random()], st, at: NOW - 5 * DAY, end: 0, ...o });
  X.W.docs = [];
  assert.equal(val('dip-ty1', {}), 0);
  X.W.docs = [T('nap', 'offered'), T('trade', 'broken'), T('research', 'ending', { end: NOW - 1 })];
  assert.equal(val('dip-ty1', {}), 0, 'an offer, a broken treaty and one whose notice ran out are not in force');
  X.W.docs = [T('nap', 'active'), T('trade', 'ending', { end: NOW + DAY }), T('research', 'active'), { k: 'nap', p: ['a', 'b'], st: 'active', at: 0 }];
  assert.ok(earned('dip-ty1', {})); assert.ok(earned('dip-tyall', {})); assert.equal(val('dip-tynap4', {}), 1, 'not a treaty between two others');
  X.W.docs = [...Array(8)].map(() => T('nap', 'active')).concat([...Array(3)].map(() => T('trade', 'active')), [...Array(2)].map(() => T('research', 'active')));
  assert.ok(earned('dip-tynap4', {})); assert.ok(earned('dip-tytr3', {})); assert.ok(!earned('dip-tyrs3', {})); assert.equal(val('dip-tyfull', {}), 13);
  X.W.docs.push(T('research', 'active'), T('nap', 'active')); assert.ok(earned('dip-tyfull', {})); assert.equal(val('dip-tyfull', {}), 14, 'capped at each kind’s places');
  X.W.docs = [T('nap', 'active', { at: NOW - 29.5 * DAY })]; assert.ok(!earned('dip-tyold', {}));
  X.W.docs = [T('nap', 'active', { at: NOW - 30 * DAY }), T('trade', 'broken', { at: NOW - 90 * DAY })]; assert.ok(earned('dip-tyold', {}));
  X.W.docs = [];
});

test('alliances: pacts in force, rivals, the three new projects and every project at its last level', () => {
  const al = (rel, pj) => ({ srv: true, doc: { rel, pj } });
  X.W.al = { me: al({ b: { k: 'pact', st: 'asked' }, c: { k: 'pact', st: 'ending', end: NOW - 1 } }, {}) };
  assert.ok(!earned('dip-alpact', {})); assert.ok(!earned('dip-alrival', {}));
  X.W.al.me = al({ b: { k: 'pact', st: 'ending', end: NOW + DAY }, c: { k: 'rival', me: false, them: true } }, { beacon: 1, academy: 2 });
  assert.ok(earned('dip-alpact', {})); assert.ok(earned('dip-alrival', {})); assert.equal(val('dip-alnew', {}), 2);
  X.W.al.me.doc.pj.chronicle = 1; assert.ok(earned('dip-alnew', {}));
  X.W.al.me.doc.pj = Object.fromEntries(Object.entries(X.R.AL_RULES.projects).map(([k, p]) => [k, p.max]));
  assert.ok(earned('dip-alpjall', {})); X.W.al.me.doc.pj.hall = 9; assert.equal(val('dip-alpjall', {}), X.A['dip-alpjall'].g, 'capped');
  X.W.al.me.doc.pj.market = 1; assert.ok(!earned('dip-alpjall', {}));
  X.W.al.me = { srv: false, doc: { rel: { b: { k: 'rival' } }, pj: { beacon: 3 } } }; assert.ok(!earned('dip-alrival', {})); assert.equal(val('dip-alnew', {}), 0);
  X.W.al = {};
});

test('city titles and walls', () => {
  const C = (...ti) => ({ cities: ti.map(t => ({ ti: t })) });
  assert.ok(!earned('land-ti1', C(0, 0))); assert.ok(earned('land-ti1', C(0, 1))); assert.ok(!earned('land-ti2', C(1, 1)));
  assert.ok(earned('land-ti2', C(2))); assert.ok(earned('land-ti3', C(3))); assert.ok(earned('land-ti3', C(7)), 'blkTi caps at 3');
  assert.ok(!earned('land-ti3x3', C(3, 3, 2))); assert.ok(earned('land-ti3x3', C(3, 3, 3)));
  assert.ok(!earned('land-tiall', C(1, 1, 1, 1))); assert.ok(!earned('land-tiall', C(1, 1, 1, 1, 0))); assert.ok(earned('land-tiall', C(1, 2, 1, 3, 1)));
  const W = (...w) => ({ cities: w.map(v => typeof v === 'number' ? { wl: v } : v) });
  assert.ok(!earned('war-wall1', W(0))); assert.ok(earned('war-wall1', W(1))); assert.ok(!earned('war-wall1', W({ wu: { l: 1, d: NOW + 1 } })), 'still being built');
  assert.ok(earned('war-wall1', W({ wu: { l: 1, d: NOW - 1 } }))); assert.ok(!earned('war-wall3', W(2))); assert.ok(earned('war-wall3', W(3)));
  assert.ok(!earned('war-wall5', W(3, 3, 3, 3, 2))); assert.ok(earned('war-wall5', W(3, 3, 3, 3, 3)));
});

test('war: wars declared, three fronts, eight foes, hexes lost', () => {
  assert.ok(earned('war-declare5', { tly: { 'log:war': 5 } })); assert.ok(!earned('war-declare5', { tly: { 'log:war': 4 } }));
  assert.ok(earned('war-fronts3', { fronts: 3 })); assert.ok(!earned('war-fronts3', { fronts: 2 }));
  const foes = { 'war:a': 1, 'war:b': 1, 'npcwar:c': 1, 'npcwar:a': 1, 'war:d': 1, 'war:e': 1, 'conq:f': 1 };
  assert.equal(val('war-foes8', { tly: foes, wars: { f: {}, g: {} } }), 7, 'a nation fought twice counts once; a conquest is not a war');
  assert.ok(earned('war-foes8', { tly: foes, wars: { f: {}, g: {}, h: {} } }));
  assert.ok(earned('war-lost10', { tly: { lostc: 10 } })); assert.ok(!earned('war-lost10', { tly: { lostc: 9, conq: 50 } }));
});

test('portraits of state', () => {
  assert.ok(!earned('cab-pt1', {})); assert.ok(!earned('cab-pt1', { rpt: { s: 'leader:abc' } }), 'a seed pinned by a rename is not a portrait');
  for (const r of [{ l: { h: 2 } }, { i: 'navy' }, { r: 3 }, { k: 'bold' }]) assert.ok(earned('cab-pt1', { rpt: r }), JSON.stringify(r));
  assert.ok(!earned('cab-pt1', { rpt: { l: {} } }));
  const cab = Object.fromEntries(['fin', 'def', 'for', 'int', 'wrk', 'hea', 'cul'].map(k => [k, { nm: 'M ' + k }]));
  const cpt = Object.fromEntries(Object.entries(cab).map(([k, m]) => [k, { n: m.nm, l: { h: 1 } }]));
  assert.ok(earned('cab-ptcab', { cab, cpt })); assert.equal(val('cab-ptcab', { cab, cpt: { ...cpt, fin: { n: 'Somebody else', l: {} } } }), 6, 'a look for a minister who has left does not count');
  assert.ok(earned('cab-ptcode', { cdc: 'court' })); assert.ok(!earned('cab-ptcode', {}));
  assert.ok(earned('cab-ptnick', { rpt: { k: 'bold' } })); assert.ok(!earned('cab-ptnick', { rpt: {} }));
  assert.ok(earned('cab-ptsit', { answered: [{ id: 'pt-court-painter', o: 2, t: 1 }] }));
  assert.ok(!earned('cab-ptsit', { answered: [{ id: 'pt-court-painter', o: -1, t: 1 }, { id: 'other', o: 0, t: 1 }] }), 'a veto is no sitting');
  const locks = Object.keys(X.R.PT_LOCK);
  assert.ok(earned('cab-ptlock5', { ptu: locks.slice(0, 5) })); assert.equal(val('cab-ptlock5', { ptu: [locks[0], locks[0], 'h22', 'x99'] }), 1, 'only pieces deeds unlock, each once');
  assert.ok(earned('cab-ptlock', { ptu: locks })); assert.ok(!earned('cab-ptlock', { ptu: locks.slice(1) }));
  assert.ok(!earned('cab-pt1', { rpt: { r: 3 } }, { npc: true }));
});

test('Mars, the belt, the field digs and a move to another region', () => {
  const mars = (blds, ml) => ({ sp: { mars: { col: { blds: blds.map(([k, d]) => ({ k, d: d ?? NOW - 1 })) }, ml: ml || [0, 0, 0] } } });
  assert.ok(!earned('sp-mars1', {})); assert.ok(earned('sp-mars1', mars([], [NOW, 0, 0]))); assert.ok(!earned('sp-mars10', mars([], [NOW, 0, 0]))); assert.ok(earned('sp-mars10', mars([], [NOW, NOW, 0])));
  assert.ok(earned('sp-mars-os', mars([['os']]))); assert.ok(!earned('sp-mars-os', mars([['os', NOW + 1]])), 'not finished yet');
  assert.ok(earned('sp-mars-cm8', mars([...Array(8)].map(() => ['cm'])))); assert.ok(!earned('sp-mars-cm8', mars([...Array(7)].map(() => ['cm']).concat([['cm', NOW + 1]]))));
  const kinds = Object.keys(X.R.SP_BLDS.mars);
  assert.ok(earned('sp-mars-all', mars(kinds.map(k => [k])))); assert.equal(val('sp-mars-all', mars(kinds.slice(1).map(k => [k]).concat([[kinds[1]], [kinds[1]]]))), kinds.length - 1);
  X.W.mars = { me: { ok: true, held: Array(50).fill(0), nb: [1, 2] } };
  assert.ok(earned('sp-mars-t50', mars([]))); assert.ok(earned('sp-mars-nb', mars([])));
  X.W.mars = { me: { ok: false, held: Array(80).fill(0), nb: [1, 2, 3] } }; assert.equal(val('sp-mars-t50', mars([])), 0, 'a colony that failed holds nothing');
  assert.equal(val('sp-mars-t50', {}), 0); X.W.mars = {};
  assert.ok(earned('bt-rs-all', { belt: { rd: 2 ** 36 - 1 } })); assert.ok(!earned('bt-rs-all', { belt: { rd: 2 ** 36 - 2 } })); assert.equal(val('bt-rs-all', {}), 0);
  X.W.belt = { me: { strikes: [1, 2, 3] } }; assert.ok(earned('bt-plat3', { belt: {} })); assert.ok(!earned('bt-plat3', {}), 'no belt, no strikes'); X.W.belt = {};
  X.W.digs = {}; assert.ok(!earned('mus-dig1', {}));
  X.W.digs = { 'dg-tide': 1 }; assert.ok(earned('mus-dig1', {})); assert.ok(!earned('mus-dighalf', {}));
  X.W.digs = { 'dg-tide': 5 }; assert.ok(earned('mus-dighalf', {})); assert.ok(!earned('mus-digall', {}));
  X.W.digs = { 'dg-tide': 10, 'dg-fords': 11 }; assert.equal(val('mus-digall', {}), 1); X.W.digs = { 'dg-tide': 10, 'dg-fords': 12 }; assert.ok(earned('mus-digall', {})); X.W.digs = {};
  assert.ok(earned('odd-move', { mvN: 1 })); assert.ok(earned('odd-move', { tly: { 'log:move': 1 } })); assert.ok(!earned('odd-move', {}));
});
