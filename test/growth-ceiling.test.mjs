// Growth without a ceiling (game/edictum.html, section of that name; 2026-11-15, after a player found output stopped
// growing once the figures were near the top): Productivity (n.pd, a log) grows each day from Education, Science and
// Economic Freedom and from what a good figure cannot take at the top; Prosperity carries on past 100 (n.wb); capacity
// creeps up with Science and Health (n.dn); economy levels on a Market Hall, Stock Exchange or Central Bank have no top;
// a nation's engineers reclaim land from the sea when free land runs out; and the currency job reads all of it the same
// way (jobs/fx/engine.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import * as E from '../jobs/fx/engine.mjs';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const functions = new Map();
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && !functions.has(node.id.name)) functions.set(node.id.name, code.slice(node.start, node.end));
  for (const [k, v] of Object.entries(node)) if (k !== 'start' && k !== 'end') { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
})(parse(code, {ecmaVersion: 'latest'}));
const slice = (from, to) => { const a = code.indexOf(from); assert.ok(a >= 0, 'the game has ' + from); return code.slice(a, code.indexOf(to, a) + to.length); };
const DAY = 864e5;

function sandbox(extra = {}) {
  const ctx = vm.createContext({clamp: (v, a, b) => Math.min(b, Math.max(a, v)), DAY, Date, Math, ...extra});
  vm.runInContext([slice('const PD_DAY=', ';'), slice('const STATS = {', '};'),
    ...['gcRate', 'pdRateOf', 'dnRateOf', 'gcStep', 'gcFrom', 'gcDays', 'pdNow', 'dnNow', 'prodOf', 'densOf', 'wbOf', 'wealthW', 'gcAdvance', 'pdAdd', 'pdBoost',
      'applyEffects', 'income', 'incomeW'].map(f => functions.get(f))].join('\n') +
    '\nthis.G={PD_DAY,PD_FROM,PD_DAMP,PD_OVER,DN_DAY,DN_DAMP,GC_EPOCH,gcStep,pdRateOf,dnRateOf,pdNow,dnNow,prodOf,densOf,wbOf,wealthW,gcAdvance,applyEffects,income,incomeW};', ctx);
  return ctx.G;
}
const G = sandbox();
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const nation = (s = {}, more = {}) => ({s: Object.assign({wealth: 50, edu: 50, sci: 50, econ: 50, health: 50, crime: 50, corrupt: 50, tax: 30, happy: 50}, s), policies: {}, budget: {}, gcAt: Date.now(), ...more});

test('Prosperity carries on past 100, and a fall takes from what lies beyond first', () => {
  const n = nation({wealth: 100});
  G.applyEffects(n, {wealth: 3});
  near(n.s.wealth, 100, 'the bar stays full');
  near(n.wb, 1.2, 'a +3 at the top goes 1.2 beyond (the 0.4 floor)', 1e-6);
  G.applyEffects(n, {wealth: -2});
  assert.equal(n.wb, undefined, 'a −2 empties the 1.2 beyond');
  near(n.s.wealth, 99.2, 'and the remaining 0.8 lowers the figure', 1e-6);
  const m = nation({wealth: 100}, {wb: 5});G.applyEffects(m, {wealth: -2});near(m.wb, 3, 'beyond 5 − 2', 1e-6);near(m.s.wealth, 100, 'bar kept');
  const k = nation({wealth: 100}, {wb: 1});G.applyEffects(k, {wealth: -3});assert.equal(k.wb, undefined);near(k.s.wealth, 98, 'the rest of the fall lowers the figure');
  const j = nation({wealth: 99.5});G.applyEffects(j, {wealth: 2});near(j.s.wealth, 100, 'reaches 100');near(j.wb, 0.3, 'and carries 0.3 beyond', 1e-6);
});

test('income follows the same curve past 100', () => {
  near(G.incomeW(100), G.income({wealth: 100}), 'same at 100');
  assert.ok(G.incomeW(110) > G.incomeW(100) * 1.15, 'ten points beyond is worth more than 15%');
  near(G.incomeW(G.wealthW(nation({wealth: 100}, {wb: 10}))), G.incomeW(110), 'wealthW adds what lies beyond');
  near(G.wealthW({npc: true, s: {wealth: 100}, wb: 10}), 100, 'computer nations have nothing beyond');
});

test('what a good figure cannot take near the top goes into Productivity', () => {
  const n = nation({health: 100});
  G.applyEffects(n, {health: 4});
  near(n.s.health, 100, 'health stays at 100');
  near(n.pd, 4 * G.PD_OVER, 'all 4 points become Productivity', 1e-6);
  const low = nation({health: 30});G.applyEffects(low, {health: 4});assert.ok(!(low.pd > 0), 'a figure with room to spare adds nothing');
  const crime = nation({crime: 0});G.applyEffects(crime, {crime: -3});near(crime.pd, 3 * G.PD_OVER, 'a fall in Crime at 0 counts too', 1e-6);
  const bad = nation({health: 100});G.applyEffects(bad, {health: -3});assert.ok(!(bad.pd > 0), 'a fall in a good figure adds nothing');
  const neutral = nation({tax: 100});G.applyEffects(neutral, {tax: 3});assert.ok(!(neutral.pd > 0), 'Income Tax is no good figure');
  const pros = nation({wealth: 100});G.applyEffects(pros, {wealth: 5});near(pros.pd, 3 * G.PD_OVER, 'Prosperity at 100: 2 beyond, 3 into Productivity', 1e-6);
  const npc = {npc: true, s: {health: 100}, policies: {}, budget: {}};G.applyEffects(npc, {health: 4});assert.equal(npc.pd, undefined, 'computer nations are left alone');
});

test('a pd effect raises Productivity by that percentage outright', () => {
  const n = nation({}, {pd: 0.5});G.applyEffects(n, {pd: 2});near(n.pd, 0.5 + Math.log(1.02), '+2%', 1e-6);
});

test('the growth clock: closed form, split anywhere, slowing as it grows', () => {
  for (const [x, a, b] of [[0, 0.01, 1], [0.7, 0.006, 1], [0.2, 0.005, 2]]) {
    near(G.gcStep(G.gcStep(x, a, b, 13.5), a, b, 40), G.gcStep(x, a, b, 53.5), 'two steps equal one', 1e-9);
    let y = x;for (let i = 0; i < 100000; i++) y += a / (1 + b * y) * (50 / 100000);
    near(G.gcStep(x, a, b, 50), y, 'matches the differential equation', 1e-5);
  }
  near(G.pdRateOf({edu: 100, sci: 100, econ: 100}), G.PD_DAY, 'fastest at 100');
  near(G.pdRateOf({edu: G.PD_FROM, sci: G.PD_FROM, econ: G.PD_FROM}), 0, 'nothing at PD_FROM');
  assert.ok(Math.exp(G.gcStep(0, G.PD_DAY, G.PD_DAMP, 90)) < 2.1, 'about ×2 after 90 days at the fastest');
});

test('gcAdvance brings Productivity and density up to now, and does it only once', () => {
  const t0 = G.GC_EPOCH + 5 * DAY, n = nation({edu: 100, sci: 100, econ: 100, health: 100}, {gcAt: t0});
  const t1 = t0 + 10 * DAY, p = G.pdNow(n, t1), d = G.dnNow(n, t1);
  assert.ok(p > 0.09 && p < 0.1, 'ten days at 1% a day, slowing: ' + p);
  G.gcAdvance(n, t1);near(n.pd, p, 'pd stored', 1e-6);near(n.dn, d, 'dn stored', 1e-6);assert.equal(n.gcAt, t1);
  G.gcAdvance(n, t1);near(n.pd, p, 'again changes nothing', 1e-6);
  const old = nation({edu: 100, sci: 100, econ: 100}, {gcAt: undefined, founded: G.GC_EPOCH - 30 * DAY});
  near(G.pdNow(old, G.GC_EPOCH + DAY), G.gcStep(0, G.PD_DAY, G.PD_DAMP, 1), 'a record from before starts at GC_EPOCH', 1e-9);
  near(G.prodOf({npc: true, s: {edu: 100, sci: 100, econ: 100}}, G.GC_EPOCH + 20 * DAY), Math.exp(G.gcStep(0, G.PD_DAY, G.PD_DAMP, 20)), 'computer nations from GC_EPOCH', 1e-9);
  assert.equal(G.densOf({npc: true, s: {}}, Date.now()), 1, 'no density for computer nations');
});

test('the currency engine reads Productivity and Prosperity beyond 100 as the game does', () => {
  for (const [x, a, b, dt] of [[0, 0.01, 1, 12], [1.3, 0.004, 1, 3.5], [0.4, 0.008, 1, 200]]) near(E.gcStep(x, a, b, dt), G.gcStep(x, a, b, dt), 'gcStep');
  for (const s of [{edu: 80, sci: 90, econ: 60}, {edu: 20, sci: 10, econ: 30}, {edu: 100, sci: 100, econ: 100}]) near(E.pdRateOf(s), G.pdRateOf(s), 'pdRateOf');
  for (const w of [0, 55, 100, 137.5]) near(E.incomeW(w), G.incomeW(w), 'incomeW');
  assert.equal(E.PD_DAY, G.PD_DAY);assert.equal(E.PD_FROM, G.PD_FROM);assert.equal(E.PD_DAMP, G.PD_DAMP);assert.equal(E.GC_EPOCH, G.GC_EPOCH);
  const now = G.GC_EPOCH + 30 * DAY, rec = {s: {edu: 90, sci: 85, econ: 70}, pd: 0.3, gcAt: G.GC_EPOCH + 10 * DAY};
  near(E.prodAt(rec, rec.s, now, false), G.prodOf(nation(rec.s, {pd: 0.3, gcAt: rec.gcAt}), now), 'prodAt', 1e-12);
  const base = E.indicators('p', {s: Object.fromEntries(E.STAT_KEYS.map(k => [k, 50])), pop: 20, popAt: now, pk: 60, pr: 0.03, hist: [], gcAt: now}, now, {});
  const rich = E.indicators('p', {s: Object.fromEntries(E.STAT_KEYS.map(k => [k, 50])), pop: 20, popAt: now, pk: 60, pr: 0.03, hist: [], pd: Math.log(2), gcAt: now}, now, {});
  near(rich.gpc / base.gpc, 2, 'Productivity ×2 doubles output per person', 1e-9);
});

test('economy levels: kept on save, priced higher each level, counted past the building limit', () => {
  const ctx = vm.createContext({DAY, RES: ['food', 'timber', 'iron', 'oil', 'goods'], BUILDINGS: {market: {n: 'Market Hall', cost: {timber: 12, goods: 12}, h: 3}, exchange: {n: 'Stock Exchange', lead: 'free', cost: {timber: 20, iron: 15, goods: 45}, h: 8}, cbank: {n: 'Central Bank', cost: {timber: 25, iron: 20, goods: 40}, h: 10}},
    cabFx: () => ({cost: 1, build: 1}), ldrOf: n => (n && n.lead) || [], ldrWork: n => (n && n.lead) || [], Object, Math, Number});
  vm.runInContext([slice('const EL_FX=', ';'), slice('const EL_BLD=', ';'), ...['bMaterialCost', 'paidClean', 'bCost', 'bHours', 'elExtras', 'elOn', 'elList', 'elLv', 'elMap', 'elCityAdd'].map(f => functions.get(f))].join('\n') +
    '\nthis.L={EL_FX,elExtras,elList,elLv,elMap,elCityAdd};', ctx);
  const L = ctx.L, now = Date.now();
  assert.deepEqual({...L.elExtras({k: 'market', el: 3})}, {el: 3});
  assert.deepEqual({...L.elExtras({k: 'barracks', el: 3})}, {}, 'only the three economy buildings');
  const eu = L.elExtras({k: 'market', el: 2, eu: {l: 3, s: now, d: now + 3600e3, p: {timber: 9999, goods: 1}}}).eu;
  assert.equal(eu.l, 3);assert.equal(eu.p.timber, L.elList('market', 3).timber, 'a paid price is capped at the list price');
  assert.equal(L.elExtras({k: 'market', el: 2, eu: {l: 5, s: now, d: now + 3600e3}}).eu, undefined, 'only the next level can be under way');
  assert.ok(L.elList('market', 10).timber > L.elList('market', 9).timber && L.elList('market', 9).timber > L.elList('market', 1).timber, 'dearer each level');
  assert.equal(L.elLv({k: 'cbank', el: 1, eu: {l: 2, s: now - 7200e3, d: now - 1}}, now), 2, 'a finished level counts before the save');
  const c = {b: [{k: 'market', d: now - 1, el: 4}, {k: 'exchange', d: now - 1, el: 3}, {k: 'cbank', d: now + DAY, el: 2}]};
  const ct = {done: ['market', 'exchange'], el: L.elMap(c, now)};
  near(L.elCityAdd(ct, {n: {lead: ['free']}}), 7 * L.EL_FX, 'Market Hall 4 + Stock Exchange 3');
  near(L.elCityAdd(ct, {n: {lead: []}}), 4 * L.EL_FX, 'a dormant Stock Exchange adds nothing');
  assert.match(slice('for(const a of agg){a.army=', '}'), /a\.prosper=Math\.min\(a\.prosper,0\.2\)\+\(a\.xp\|\|0\)\+\(a\.el\|\|0\)/, 'levels sit on top of the +20% limit');
});

test('land from the sea: the record keeps the engineers’ hexes apart, and the edicts keep their own limit', () => {
  assert.match(code, /const REC_MAX=24,RECW_MAX=\d+,REC_KEEP=REC_MAX\+RECW_MAX;/);
  assert.match(code, /\.slice\(0,REC_KEEP\)\.map\(e=>e\.w===1\?\{c:e\.c,t:e\.t,w:1\}:\{c:e\.c,t:e\.t\}\)/, 'normalizeGeo keeps w:1');
  assert.match(code, /REC_MAX-n\.rec\.filter\(x=>!x\.w\)\.length/, 'an edict counts only the edicts’ hexes');
  const ctx = vm.createContext({cabFx: () => ({cost: 1}), Math, Object});
  vm.runInContext([slice('const RECW_COST=', ';'), functions.get('recwCount'), functions.get('recwCost')].join('\n') + '\nthis.R={recwCost};', ctx);
  const first = ctx.R.recwCost({rec: [{c: 1, t: 1}]}), tenth = ctx.R.recwCost({rec: Array.from({length: 10}, (_, i) => ({c: i, t: i, w: 1}))});
  assert.deepEqual({...first}, {timber: 30, iron: 20, goods: 20}, 'an edict’s hex does not raise the price');
  assert.deepEqual({...tenth}, {timber: 60, iron: 40, goods: 40}, 'ten engineered hexes double it');
});

test('the result page, the Statistics page and the Nation page show it', () => {
  assert.match(code, /function gcResultRows\(r\)/);assert.match(code, /const gcRows=gcResultRows\(r\);/);
  assert.match(code, /\['Productivity',gcProdText\(n,A\.now\)\]/);
  assert.match(code, /\$\{gcLimitsCard\(n\)\}/);
  assert.match(code, /\$\{recwBlock\(n\)\}/);
  assert.match(code, /capacityOf[\s\S]{0,900}densOf\(n,Date\.now\(\)\)/, 'capacity creeps up with density');
});

test('twenty productivity edicts: numbered after every older one, drawn at random, each with a lasting pd option', () => {
  const a = code.indexOf('const PRD_ISSUES=['), b = code.indexOf('/* ───────── the browser tab');
  assert.ok(a > code.indexOf('for(const is of PT_ISSUES)') && a < b, 'after the court painter, before the browser tab');
  assert.equal(code.indexOf('ISSUES.push(', code.indexOf('for(const is of PRD_ISSUES){') + 30), code.indexOf('for(const is of NBR_ISSUES){ISSUES.push(') + 28, 'only the neighbour edicts (their own test, edicts-neighbours) are added after them');
  const end = code.indexOf('\n', code.indexOf('for(const is of PRD_ISSUES)'));
  const ctx = vm.createContext({ISSUES: Array.from({length: 7}), ISSUE_BY_ID: {}, ISSUES_RANDOM: []});
  vm.runInContext(code.slice(a, end) + '\nthis.J=JSON.stringify(PRD_ISSUES.map(i=>({id:i.id,no:i.no,c:i.c,o:i.o.map(o=>o.e)})));this.R=ISSUES_RANDOM.length;', ctx);
  const L = JSON.parse(ctx.J), STAT_KEYS = JSON.parse(code.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.equal(L.length, 20);assert.equal(ctx.R, 20, 'all drawn at random');
  assert.deepEqual(L.map(x => x.no), Array.from({length: 20}, (_, i) => 8 + i), 'numbered in order after the older ones');
  assert.equal(new Set(L.map(x => x.id)).size, 20);
  let pd = 0;
  for (const is of L) {
    assert.match(is.id, /^prd-/);assert.ok(is.o.length >= 3, is.id);
    assert.ok(is.o.some(e => e.pd) && is.o.some(e => !e.pd), is.id + ': some options with pd, some without');
    for (const e of is.o) for (const [k, v] of Object.entries(e)) {
      if (k === 'pd') { assert.ok([1, 2, 3].includes(v), is.id + ' pd ' + v);pd++;continue; }
      if (k === 'b') { for (const bv of Object.values(v)) assert.ok(Number.isInteger(bv) && bv >= 1 && bv <= 2);continue; }
      assert.ok(STAT_KEYS.includes(k), is.id + ' ' + k);assert.ok(Number.isInteger(v) && Math.abs(v) >= 1 && Math.abs(v) <= 4, is.id + ' ' + k + ' ' + v);
    }
  }
  assert.ok(pd >= 20 && pd <= 30, 'about a third of the options: ' + pd);
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'PRD_ISSUES'/, 'the content split carries them');
});
