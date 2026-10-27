// The currency system without a database: the job's engine (jobs/fx/engine.mjs), its reading of the game's
// regions (jobs/fx/world.mjs), and the game's own currency helpers (the pure block in game/edictum.html,
// evaluated on its own). Run with: node --test test/fx.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../jobs/fx/engine.mjs';
import { loadWorld } from '../jobs/fx/world.mjs';

const GAME = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const DAY = E.DAY, T0 = Date.UTC(2026, 10, 1, 0, 20), D0 = Math.floor(T0 / DAY);

/* a function of the game, by name, from `function name(` to its closing brace */
function gameFn(name) {
  const a = GAME.indexOf('function ' + name + '(');
  assert.ok(a >= 0, 'the game has function ' + name);
  let i = GAME.indexOf('{', a), depth = 0;
  for (; i < GAME.length; i++) { const c = GAME[i]; if (c === '{') depth++; else if (c === '}' && --depth === 0) break; }
  return GAME.slice(a, i + 1);
}
function gameSandbox() {
  const budget = GAME.slice(GAME.indexOf('const BUDGET = ['), GAME.indexOf('];', GAME.indexOf('const BUDGET = [')) + 2);
  const code = ['const clamp = (v,a,b) => Math.max(a,Math.min(b,v));', budget,
    ...['income', 'govApproval', 'inflOf', 'debtOf', 'creditOf', 'unempOf', 'lawOf', 'bpOf', 'industries', 'npcBudget', 'plural'].map(gameFn),
    'this.G={income,govApproval,inflOf,debtOf,creditOf,unempOf,lawOf,bpOf,industries,npcBudget,plural,clamp};'].join('\n');
  const ctx = vm.createContext({}); vm.runInContext(code, ctx); return ctx.G;
}
/* the game's pure currency helpers, evaluated on their own with clamp and plural */
function currencyHelpers() {
  const a = GAME.indexOf('/* ── currency: pure helpers'), b = GAME.indexOf('/* ── currency: end of pure helpers ── */');
  assert.ok(a > 0 && b > a, 'the game marks its pure currency helpers');
  const G = gameSandbox(), ctx = vm.createContext({ clamp: G.clamp, plural: G.plural });
  vm.runInContext(GAME.slice(a, b) + '\nthis.C={CU_TIERS,cuTier,cuClean,cuDefault,cuOf,cuNum,cuFig,cuAmt,cuParseAmt,cuRate,cuCodeOf,cuDec,CU_DENOMS};', ctx);
  return ctx.C;
}
const rnd = seed => { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const stats = (r, over = {}) => Object.assign(Object.fromEntries(E.STAT_KEYS.map(k => [k, Math.round(r() * 1000) / 10])), over);
/* a player's record as the game saves its shared half */
function player(over = {}, now = T0) {
  const s = Object.assign(Object.fromEntries(E.STAT_KEYS.map(k => [k, 50])), over.s || {});
  return Object.assign({ name: 'Testland', founded: now - 400 * DAY, pop: 20, popAt: now - DAY, pk: 60, pr: 0.03, s, policies: {}, budget: E.npcBudget(s), deals: [], wars: {}, peace: {},
    hist: Array.from({ length: 30 }, (_, i) => ({ t: now - (30 - i) * 8 * 3600e3, p: 19 + i * 0.03, s: E.STAT_KEYS.map(k => s[k]), e: 1 })) }, over, { s });
}
const ind = (id, rec, now = T0, ctx = {}) => E.indicators(id, rec, now, ctx);
/* run a nation through n days with the same record */
function days(id, rec, n, prev = null, start = D0) {
  let st = prev;
  for (let d = 0; d < n; d++) st = E.stepNation(id, st, ind(id, rec, (start + d) * DAY + 1200e3), start + d);
  return st;
}

test('the engine uses the game’s own formulas (income, approval, inflation, debt, credit, jobs, law, industries)', () => {
  const G = gameSandbox(), r = rnd(7);
  for (let i = 0; i < 400; i++) {
    const s = stats(r), p = { priceCaps: r() < 0.3, cashless: r() < 0.3, oilFund: r() < 0.3, minimumWage: r() < 0.5, gambling: r() < 0.3 }, budget = E.npcBudget(stats(r));
    const n = { s, policies: p, budget };
    assert.equal(E.income(s), G.income(s));
    assert.equal(E.govApproval(s), G.govApproval(s));
    assert.equal(E.inflOf(s, p), G.inflOf(s, p));
    assert.equal(E.debtOf(n, s, p), G.debtOf(n, s, p));
    assert.equal(E.creditOf(E.debtOf(n, s, p), s), G.creditOf(G.debtOf(n, s, p), s));
    assert.equal(E.unempOf(s, p), G.unempOf(s, p));
    assert.equal(E.lawOf(s), G.lawOf(s));
    assert.deepEqual(E.industries(n), JSON.parse(JSON.stringify(G.industries(n))));
    assert.deepEqual(E.npcBudget(s), JSON.parse(JSON.stringify(G.npcBudget(s))));
  }
  assert.deepEqual(E.STAT_KEYS, JSON.parse(GAME.match(/const STAT_KEYS = (\[[^\]]*\])/)[1].replace(/'/g, '"')));
});

test('every region of the game and its computer-run nations are read from the game itself', () => {
  const W = loadWorld();
  assert.equal(W.regions.length, 26);
  assert.equal(W.regions[0].id, 'meridian');
  assert.ok(W.regions.every(r => r.npcs.length >= 5 && r.npcs.every(n => n.id.startsWith('npc-') && Array.isArray(n.s) && n.s.length === 20 && n.pop > 0 && n.room > 1)));
  assert.equal(W.npcPop, 0.5);
  assert.equal(W.npcEpoch, Date.UTC(2026, 9, 25));
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  for (const r of W.regions) assert.ok(rules.includes(`'${r.id}'`), 'firestore.rules lists the region ' + r.id);
});

test('exchange rates are derived from values: inverse and cross rates agree', () => {
  const r = rnd(11), ids = Array.from({ length: 40 }, (_, i) => 'n' + i), V = Object.fromEntries(ids.map(id => [id, E.valueOf(id, r() * 100)]));
  for (let i = 0; i < 300; i++) {
    const [a, b, c] = [0, 1, 2].map(() => ids[Math.floor(r() * ids.length)]);
    const ab = E.rate(V[a], V[b]), ba = E.rate(V[b], V[a]), bc = E.rate(V[b], V[c]), ac = E.rate(V[a], V[c]);
    assert.ok(ab > 0 && isFinite(ab));
    assert.ok(Math.abs(ab * ba - 1) < 1e-12, 'A→B × B→A = 1');
    assert.ok(Math.abs(ab * bc / ac - 1) < 1e-12, 'A→B × B→C = A→C');
  }
});

test('denominations are fixed by the nation id, spread from 0.05 to 20, and a name cannot touch them', () => {
  const ds = Array.from({ length: 2000 }, (_, i) => E.denomination('uid-' + i));
  assert.ok(ds.every(d => d >= E.DENOM_LO && d <= E.DENOM_HI));
  assert.ok(ds.some(d => d < 0.2) && ds.some(d => d > 5), 'realistic-looking rates are possible either way');
  assert.equal(E.denomination('uid-1'), E.denomination('uid-1'));
  /* a currency's record (names, design) is not an input of the engine at all */
  const a = player(), b = player({ cur: { nm: 'Golden Mega Dollar', cd: 'GMD', sy: '$$$', note: { den: 1000 } } });
  assert.deepEqual(ind('x', a), ind('x', b));
  assert.deepEqual(days('x', a, 5), days('x', b, 5));
});

test('a stronger economy appreciates and a weaker one depreciates, step by step', () => {
  const base = player(), id = 'nation-a', st = days(id, base, 10);
  const rich = player({ s: { wealth: 85, sci: 80, edu: 80, corrupt: 10, happy: 80 } }), poor = player({ s: { wealth: 15, corrupt: 85, happy: 20, safety: 20 } });
  const up = days(id, rich, 15, st, D0 + 10), down = days(id, poor, 15, st, D0 + 10);
  const v0 = E.valueOf(id, st.S), vu = E.valueOf(id, up.S), vd = E.valueOf(id, down.S);
  assert.ok(vu > v0 * 1.05, 'appreciates');
  assert.ok(vd < v0 * 0.95, 'depreciates');
  /* never more than 3% in a day */
  let prev = st;
  for (let d = 0; d < 6; d++) { const nx = E.stepNation(id, prev, ind(id, rich, (D0 + 10 + d) * DAY), D0 + 10 + d); assert.ok(Math.abs(E.valueOf(id, nx.S) / E.valueOf(id, prev.S) - 1) <= 0.0301); prev = nx; }
});

test('growth, trade and stability each move strength in the right direction', () => {
  const id = 'g', f = rec => E.valuationFactors(ind(id, rec));
  const flat = player(), growing = player({ s: { wealth: 60 }, hist: player().hist.map(h => ({ ...h, s: E.STAT_KEYS.map(k => k === 'wealth' ? 50 : 50) })) });
  assert.ok(f(growing).gro > f(flat).gro, 'productivity growth counts');
  const T = E.tradeOf(new Map([['a', { deals: [{ id: 'd1', w: 'npc-x', g: ['food', 5], r: ['iron', 4], t: T0 - DAY }] }]]), new Set(['npc-x']));
  assert.ok(E.valuationFactors(ind('a', player(), T0, { trade: T.get('a') })).trade > f(flat).trade, 'live deals count');
  assert.ok(E.valuationFactors(ind('a', player(), T0, { wars: 1 })).stab < f(flat).stab, 'a war weighs on stability');
});

test('deals count only when both sides hold them (or the partner is computer-run); wars until both make peace', () => {
  const recs = new Map([
    ['a', { founded: 0, deals: [{ id: 'd1', w: 'b', g: ['food', 5], r: ['iron', 3], t: 5 }, { id: 'd2', w: 'c', g: ['oil', 2], r: ['food', 2], t: 5 }, { id: 'd3', w: 'npc-1', g: ['timber', 1], r: ['goods', 1], t: 5 }],
      wars: { c: { t: 100 } }, peace: {} }],
    ['b', { founded: 0, deals: [{ id: 'd1', w: 'a', g: ['iron', 3], r: ['food', 5], t: 6, a: 1 }], wars: {}, peace: {} }],
    ['c', { founded: 0, deals: [], wars: {}, peace: { a: 200 } }]
  ]);
  const T = E.tradeOf(recs, new Set(['npc-1']));
  assert.deepEqual([...T.get('a').partners].sort(), ['b', 'npc-1']);
  assert.equal(T.get('b').volume, 8);
  assert.equal(T.get('c'), undefined, 'an offer not accepted is no deal');
  const W = E.warsOf(recs, new Set(['npc-1']));
  assert.equal(W.get('a'), 1, 'only one side has made peace');
  recs.get('a').peace = { c: 300 };
  assert.equal(E.warsOf(recs, new Set()).get('a'), undefined, 'both made peace');
});

test('prestige does not depend on the nominal denomination, nor on the value', () => {
  const rec = player(), ids = ['aaa', 'zzz', 'uid-7', 'uid-9001'];
  const vs = ids.map(id => E.denomination(id));
  assert.ok(Math.max(...vs) / Math.min(...vs) > 3, 'the ids have very different denominations');
  const ps = ids.map(id => days(id, rec, 20).P);
  assert.ok(ps.every(p => Math.abs(p - ps[0]) < 1e-9), 'same economy, same prestige');
  /* and a high value does not mean high prestige */
  const W = loadWorld(), npcs = W.regions[0].npcs, now = T0, ctx = { npc: true, npcPop: W.npcPop, npcEpoch: W.npcEpoch };
  const rows = npcs.map(n => { const I = E.indicators(n.id, n, now, ctx); return { id: n.id, v: E.valueOf(n.id, E.strengthOf(E.valuationFactors(I))), p: E.prestigeRaw(E.prestigeFactors(I, null)) }; });
  const byV = rows.slice().sort((a, b) => b.v - a.v).map(r => r.id), byP = rows.slice().sort((a, b) => b.p - a.p).map(r => r.id);
  assert.notDeepEqual(byV, byP, 'ranking by value is not ranking by prestige');
});

test('prestige tiers, with a point of hysteresis on the way down', () => {
  assert.deepEqual([0, 19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 100].map(E.tierOf), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(E.TIERS, ['Fragile', 'Vulnerable', 'Established', 'Trusted', 'Highly Trusted']);
  assert.equal(E.tierStep(60.2, 2), 3, 'up at once');
  assert.equal(E.tierStep(59.5, 3), 3, 'a dip under the line keeps the tier');
  assert.equal(E.tierStep(58.9, 3), 2, 'a real fall changes it');
  const C = currencyHelpers();
  for (const p of [0, 19.9, 20, 45, 60, 79.9, 80, 100]) assert.equal(C.cuTier(p), E.tierOf(p), 'the game and the job agree on tiers');
  assert.deepEqual([...C.CU_TIERS], E.TIERS);
});

test('prestige is smoothed: at most 1.5 up or 2 down a day, 5 down in a crisis, never past its target', () => {
  const id = 'p', good = player({ s: { corrupt: 5, happy: 90, safety: 90, wealth: 80, econ: 70, sci: 80, edu: 80 }, founded: T0 - 400 * DAY });
  const bad = player({ s: { corrupt: 95, happy: 5, safety: 5, wealth: 5, econ: 5 }, founded: T0 - 400 * DAY });
  let st = days(id, bad, 3);
  for (let d = 0; d < 30; d++) {
    const nx = E.stepNation(id, st, ind(id, good, (D0 + 3 + d) * DAY), D0 + 3 + d);
    assert.ok(nx.P - st.P <= 1.5 + 1e-9 && nx.P >= st.P - 1e-9, 'rises gradually');
    st = nx;
  }
  const calm = st;
  const fall = E.stepNation(id, calm, ind(id, bad, (D0 + 40) * DAY), D0 + 40);
  assert.ok(calm.P - fall.P <= 5 + 1e-9 && calm.P - fall.P > 2, 'a collapse in government stability is a crisis: up to 5 a day');
  const mild = E.stepNation(id, calm, ind(id, player({ s: { corrupt: 12, happy: 85, safety: 85, wealth: 78, econ: 70, sci: 80, edu: 80 } }), (D0 + 40) * DAY), D0 + 40);
  assert.ok(calm.P - mild.P <= 2 + 1e-9, 'an ordinary dip: at most 2 a day');
  const war = E.stepNation(id, calm, ind(id, good, (D0 + 40) * DAY, { wars: 1 }), D0 + 40);
  assert.ok(war.crisis, 'a new war is a crisis');
});

test('high prestige takes a track record: a new nation’s currency is capped, an old one is not', () => {
  const s = { corrupt: 0, happy: 100, safety: 100, wealth: 100, econ: 60, sci: 100, edu: 100, pol: 100, civil: 100, tax: 30 };
  const young = player({ s, founded: T0 - 3 * DAY }), old = player({ s, founded: T0 - 365 * DAY });
  const deals = { partners: new Set(['a', 'b', 'c', 'd', 'e']), volume: 40 };
  const yi = E.stepNation('y', null, ind('y', young, T0, { trade: deals }), D0), oi = E.stepNation('o', null, ind('o', old, T0, { trade: deals }), D0);
  assert.ok(yi.T <= E.prestigeCap(3) + 1e-9 && yi.T < 52, 'a three-day-old currency is trusted only so far');
  assert.ok(oi.T > 80, 'a year-old, excellent currency can be Highly Trusted');
  assert.ok(oi.T < 100, 'and still not trivially 100 without a steady exchange-rate record');
});

test('a region: ranks by prestige, values for everyone, milestones without flooding', () => {
  const r = rnd(3), N = 40, ids = Array.from({ length: N }, (_, i) => 'p' + i), recs = ids.map(() => player({ s: stats(r) }));
  let state = {}, all = [];
  for (let d = 0; d < 60; d++) {
    const nations = ids.map((id, i) => ({ id, I: ind(id, d === 30 && i === 0 ? player({ s: { corrupt: 100, happy: 0, safety: 0, wealth: 0 } }) : recs[i], (D0 + d) * DAY) }));
    const out = E.stepRegion(nations, state, D0 + d);
    state = out.state; all = all.concat(out.events.map(e => [d].concat(e)));
    const ranked = ids.slice().sort((a, b) => out.pub[a].r - out.pub[b].r);
    for (let k = 1; k < ranked.length; k++) assert.ok(out.pub[ranked[k - 1]].p >= out.pub[ranked[k]].p, 'ranked by prestige');
    assert.deepEqual(new Set(ranked.map(id => out.pub[id].r)).size, N);
  }
  assert.ok(all.length < N * 3, `milestones stay rare (${all.length} in 60 days for ${N} currencies)`);
  for (const id of ids) {
    const hi = all.filter(e => e[1] === id && e[2] === 'hi').map(e => e[0]);
    for (let k = 1; k < hi.length; k++) assert.ok(hi[k] - hi[k - 1] >= 30, 'a ninety-day high is recorded at most once a month');
  }
  const pub = E.stepRegion(ids.map((id, i) => ({ id, I: ind(id, recs[i]) })), state, D0 + 60).pub[ids[1]];
  assert.ok(pub.d1 != null && pub.d7 != null && pub.d30 != null && pub.p7 != null && pub.sd != null);
});

test('missing, broken and extreme figures never break a value or a rating', () => {
  const weird = [
    {}, { s: null, hist: 'x', deals: 5, wars: [], policies: 'y', budget: [] },
    { s: { wealth: 1e9, corrupt: -50, happy: NaN }, pop: -4, popAt: 'soon', pk: Infinity, pr: -1, founded: 'long ago' },
    { s: Object.fromEntries(E.STAT_KEYS.map(k => [k, 100])), pop: 1e9, hist: [{ t: T0 - DAY, p: 1e-9, s: [], e: 50 }, { t: NaN, p: 1, s: null }] },
    { s: Object.fromEntries(E.STAT_KEYS.map(k => [k, 0])), pop: 0.0001, hist: [{ t: T0 - 2 * DAY, p: 1e12, s: E.STAT_KEYS.map(() => 100), e: 0 }] }
  ];
  for (const rec of weird) {
    let st = null;
    for (let d = 0; d < 12; d++) {
      st = E.stepNation('w', st, ind('w', rec, (D0 + d) * DAY), D0 + d);
      const v = E.valueOf('w', st.S);
      assert.ok(isFinite(v) && v > 0 && v >= E.DENOM_LO / 4 - 1e-12 && v <= E.DENOM_HI * 4 + 1e-9, 'value is positive and bounded');
      assert.ok(st.P >= 0 && st.P <= 100 && isFinite(st.P), 'prestige is 0 to 100');
    }
  }
});

test('computer-run nations of every region are valued', () => {
  const W = loadWorld(), now = T0;
  for (const reg of W.regions) {
    const out = E.stepRegion(reg.npcs.map(n => ({ id: n.id, I: E.indicators(n.id, n, now, { npc: true, npcPop: W.npcPop, npcEpoch: W.npcEpoch }) })), {}, D0);
    for (const n of reg.npcs) { const e = out.pub[n.id]; assert.ok(e.v > 0 && e.p >= 0 && e.p <= 100 && e.r >= 1, reg.id + ' ' + n.id); }
  }
});

test('250 nations: one day of a full region is quick, and its documents stay well under 1 MiB', () => {
  const r = rnd(5), ids = Array.from({ length: 250 }, (_, i) => 'player-uid-' + String(i).padStart(4, '0') + 'abcdefghijklmnop');
  const recs = ids.map(() => player({ s: stats(r) }));
  let state = {}, pub;
  const t = Date.now();
  for (let d = 0; d < 95; d++) { const o = E.stepRegion(ids.map((id, i) => ({ id, I: ind(id, recs[i], (D0 + d) * DAY) })), state, D0 + d); state = o.state; pub = o.pub; }
  const ms = (Date.now() - t) / 95;
  const pubBytes = JSON.stringify({ u: 'Meridian Reach', n: pub, ev: [] }).length, stateBytes = JSON.stringify({ n: state, ev: [] }).length;
  assert.ok(ms < 500, `a day of 250 nations takes ${ms.toFixed(1)} ms`);
  assert.ok(pubBytes < 200000, `the public document is ${pubBytes} bytes`);
  assert.ok(stateBytes < 700000, `the job's state is ${stateBytes} bytes`);
  /* pairs are never stored: 250 entries, not 62,250 */
  assert.equal(Object.keys(pub).length, 250);
});

test('the engine never changes the records it reads', () => {
  const deep = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deep(v); return o; };
  const rec = deep(player({ deals: [{ id: 'd', w: 'npc-1', g: ['food', 2], r: ['iron', 1], t: 1 }], stock: { food: 5 } }));
  const recs = deep(new Map([['a', rec]]));
  const before = JSON.stringify(rec);
  const T = E.tradeOf(recs, new Set(['npc-1'])), W = E.warsOf(recs, new Set());
  days('a', rec, 3);
  E.stepRegion([{ id: 'a', I: ind('a', rec, T0, { trade: T.get('a'), wars: W.get('a') }) }], {}, D0);
  assert.equal(JSON.stringify(rec), before);
});

test('the game’s currency helpers: defaults for every nation, sanitising, formats', () => {
  const C = currencyHelpers();
  const eternia = { name: 'Eternia', demonym: 'Eternian', currency: 'mark', flag: { c: ['#123456', '#ABCDEF', '#FFFFFF'] }, founded: Date.UTC(2026, 9, 26) };
  const d = C.cuOf(eternia);
  assert.equal(d.nm, 'Eternian Mark'); assert.equal(d.pl, 'Eternian Marks'); assert.equal(d.cd, 'ETM'); assert.equal(d.sy, '₥');
  assert.equal(d.su, 'pfennig'); assert.equal(d.sn, 100); assert.equal(d.note.c1, '#123456'); assert.equal(d.year, 2026);
  assert.equal(C.cuCodeOf('Vellmark', 'dollar'), 'VLD'); assert.equal(C.cuCodeOf('Lucanto', 'lira'), 'LCL');
  /* an old record, or a computer-run nation, has a currency without any migration */
  assert.equal(C.cuOf({ name: 'Karvesk', demonym: 'Karveskan', currency: 'ruble' }).nm, 'Karveskan Ruble');
  assert.equal(C.cuOf({}).nm, 'National Crown');
  /* sanitising what a player saves */
  const c = C.cuClean({ nm: '  <b>Golden</b>\u0000 Mark  ', pl: 'x'.repeat(80), cd: 'e-t-m!', sy: '1 $ <', sn: 7, sp: 'z', nf: 'xx', mo: 'In <script>Gold</script> We Trust',
    note: { c1: 'red', c2: '#00ff00', pat: 'evil', den: 3, strip: 1, emb: 'arms' }, coin: { met: 'gold', shape: 'triangle', den: 50, dk: 's', ins: 'A'.repeat(40), yr: 0 }, extra: 'nope' });
  assert.equal(c.nm, 'bGoldenb Mark'); assert.equal(c.pl.length, 34); assert.equal(c.cd, 'ETM'); assert.equal(c.sy, '$');
  assert.ok(!('sn' in c) && !('sp' in c) && !('nf' in c) && !('extra' in c));
  assert.ok(!/[<>]/.test(c.mo));
  assert.deepEqual({ ...c.note }, { c2: '#00FF00', strip: 1, emb: 'arms' });
  assert.deepEqual({ ...c.coin }, { met: 'gold', den: 50, dk: 's', ins: 'A'.repeat(28), yr: 0 });
  assert.equal(C.cuClean({ cd: 'AB' }), null, 'a code is three to five letters');
  assert.equal(C.cuClean({ cd: 'ABCDEF' }), null);
  assert.equal(C.cuClean('nonsense'), null);
  assert.equal(C.cuClean({ nm: '123' }), null, 'a name starts with a letter');
});

test('amounts and rates: very large and very small, every number format, both symbol places', () => {
  const C = currencyHelpers();
  const cur = (o = {}) => Object.assign({ sy: '₥', sp: 'b', nf: 'en' }, o);
  assert.equal(C.cuAmt(1234567.891, cur()), '₥1,234,567.89');
  assert.equal(C.cuAmt(1234567.891, cur({ nf: 'eu', sp: 'a', sy: 'kr' })), '1.234.567,89 kr');
  assert.equal(C.cuAmt(1234.5, cur({ nf: 'ch' })), '₥1’234.50');
  assert.equal(C.cuAmt(1234.5, cur({ nf: 'sp', sy: 'Cr' })), 'Cr 1 234,50');
  assert.equal(C.cuAmt(-5, cur()), '−₥5.00');
  assert.equal(C.cuAmt(0, cur()), '₥0.00');
  assert.equal(C.cuAmt(3.2e18, cur()), '₥3.20 × 10¹⁸');
  assert.equal(C.cuAmt(0.000012346, cur()), '₥0.00001235');
  assert.equal(C.cuFig(32.8812), '32.88');
  assert.equal(C.cuFig(0.030412), '0.03041');
  assert.equal(C.cuFig(0.82), '0.82');
  assert.equal(C.cuFig(0.000000123456), '0.0000001235');
  assert.equal(C.cuFig(1e20), '1.00 × 10²⁰');
  assert.equal(C.cuParseAmt('1,234.56'), 1234.56); assert.equal(C.cuParseAmt('1.234,56'), 1234.56); assert.equal(C.cuParseAmt('1 234,5'), 1234.5);
  assert.equal(C.cuParseAmt('1,5'), 1.5); assert.equal(C.cuParseAmt('1,000,000'), 1e6); assert.equal(C.cuParseAmt('100'), 100);
  assert.ok(Number.isNaN(C.cuParseAmt('abc'))); assert.ok(Number.isNaN(C.cuParseAmt('')));
  assert.equal(C.cuRate(3, 0), null); assert.equal(C.cuRate(-1, 2), null); assert.equal(C.cuRate(3, 1.5), 2);
});
