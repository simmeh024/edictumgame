// The capital taken (22 Nov 2026; game/edictum.html, "the capital taken"): fifteen edicts for the nation that takes a
// capital, one for each capital it takes, offering among other things to take it over as a city; a captured city counts
// for nothing against the cities a nation may found. Checked with the game's own code, cut from its source.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const DAY = 864e5, J = v => JSON.parse(JSON.stringify(v));
const LIST = cut('const CQ_ISSUES=[', '\nWAR3_ISSUES.splice(');
const L = (() => { const c = vm.createContext({}); vm.runInContext(vars(LIST), c); return c.CQ_ISSUES; })();

test('fifteen edicts, each its own story and choices, most of them offering to take the capital over as a city', () => {
  assert.equal(L.length, 15);
  assert.equal(new Set(L.map(x => x.id)).size, 15);assert.equal(new Set(L.map(x => x.t)).size, 15);
  for (const is of L) {
    assert.match(is.id, /^cq-[a-z]+$/);assert.equal(src.split(`{id:'${is.id}',c:`).length, 2, is.id + ' once');assert.equal(src.split(`t:'${is.t}'`).length, 2, is.t + ' once');
    assert.ok(/\{FALLCAP\}/.test(is.t + is.q), is.id + ' names the capital');
    assert.ok(is.o.length >= 3 && is.o.every(o => o.t && o.e && o.fx && /^“/.test(o.t)), is.id + ' options in the house style');
    assert.ok(new Set(is.o.map(o => o.e.cqc || (o.e.cqr ? 'raze' : 'none'))).size >= 2, is.id + ' offers different fates');
  }
  const city = L.filter(is => is.o.some(o => o.e.cqc)).length;assert.ok(city >= 13, 'a city on offer in ' + city);
  assert.ok(L.some(is => is.o.some(o => o.e.cqc === 'new')), 'renamed after our own capital in some');
  assert.ok(L.some(is => is.o.some(o => o.e.cqc && !o.e.cqb)), 'and rebuilt without its old buildings in some');
  assert.ok(L.some(is => is.o.some(o => o.e.cqr)), 'razed in some');
  assert.match(src, /WAR3_ISSUES\.splice\(WAR3_ISSUES\.length,0,\.\.\.CQ_ISSUES\);\nfor\(const is of WAR3_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\)/, 'never drawn at random, the last edicts added');
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'WAR3_ISSUES','CQ_ISSUES'/);
});

test('one edict for each capital taken, chosen by the capital and not repeated within a month', () => {
  const now = 1e12, falls = [{ id: 'a_v_1', a: 'me', d: 'v', ft: now - DAY, cn: 'Adler', dn: 'Vesad' }, { id: 'a_w_2', a: 'me', d: 'w', ft: now - 2 * DAY }, { id: 'x_y', a: 'x', d: 'y', ft: now }];
  const ctx = vm.createContext({ DAY, OBS: false, S: { mode: 'world' }, myId: () => 'me', wrFallsAt: () => falls, hash: s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; } });
  vm.runInContext(vars(LIST) + '\n' + ['cqFall', 'cqDue'].map(fn).join('\n'), ctx);
  const n = { founded: 1, inbox: [], answered: [] };
  assert.equal(ctx.cqFall(n).id, 'a_v_1', 'the first capital taken not yet decided');
  const d = ctx.cqDue(n, now);assert.ok(ctx.CQ_ISSUES.some(i => i.id === d.id));
  assert.equal(ctx.cqDue({ ...n, inbox: [{ id: d.id }] }, now), null, 'one at a time');
  assert.equal(ctx.cqFall({ ...n, cqd: ['a_v_1'] }).id, 'a_w_2', 'once decided, the next');
  assert.equal(ctx.cqDue({ ...n, cqd: ['a_v_1', 'a_w_2'] }, now), null, 'none for a capital another nation took');
  assert.equal(ctx.cqFall({ ...n, founded: now }), null, 'none from before the nation was founded again');
  const ids = ctx.CQ_ISSUES.map(i => i.id), recent = ids.filter(id => id !== 'cq-salt').map(id => ({ id, t: now - DAY }));
  assert.equal(ctx.cqDue({ ...n, answered: recent }, now).id, 'cq-salt', 'not one decided in the last month');
});

test('taken over as a city: on the capital\'s hex, its name or New {CAP}, its finished buildings but no wonder', () => {
  const now = Date.now(), F = { id: 'f', a: 'me', d: 'v', c: 7, cn: 'Adler', dn: 'Vesad', df: 100 };
  const old = { founded: 100, cities: [{ c: 7, b: [{ k: 'farm', d: now - DAY }, { k: 'cathedral', d: now - DAY }, { k: 'market', d: now + DAY }, { k: 'theatre', d: now - DAY }, { k: 'hospital', d: 1 }, { k: 'housing', d: 2 }, { k: 'school', d: 3 }] }] };
  let owner = 0;
  const ctx = vm.createContext({ CITY_SLOTS: 4, CQ_MAX: 10, Date, BUILDINGS: { farm: {}, cathedral: { w: 1 }, market: {}, theatre: {}, hospital: {}, housing: {} },
    myId: () => 'me', docOf: id => id === 'v' ? old : null, territory: () => ({ byId: { me: 0 }, owner: { 7: owner } }), cityList: n => n.cities || [], cityLabel: (n, c) => c.nm, landName: () => 'the plains' });
  vm.runInContext(['cqBuildings', 'cqTake'].map(fn).join('\n'), ctx);
  const n = { name: 'Axetere', capital: 'Port Alder', cities: [{ id: 'cap', c: 1, nm: '' }], log: [] };
  assert.equal(ctx.cqTake(n, F, 'keep', true, now), '');
  const c = n.cities[1];
  assert.deepEqual(J({ c: c.c, nm: c.nm, cq: c.cq, b: c.b.map(b => b.k) }), { c: 7, nm: 'Adler', cq: 'Vesad', b: ['farm', 'theatre', 'hospital', 'housing'] }, 'finished, no wonder, as many as a city has room for');
  assert.equal(n.log[0].k, 'city');
  assert.equal(ctx.cqTake(n, F, 'keep', true, now), '', 'once only');assert.equal(n.cities.length, 2);
  const m = { name: 'Axetere', capital: 'Port Alder', cities: [], log: [] };ctx.cqTake(m, F, 'new', false, now);
  assert.deepEqual(J({ nm: m.cities[0].nm, b: m.cities[0].b }), { nm: 'New Port Alder', b: [] }, 'renamed after our capital, rebuilt from nothing');
  owner = 1;const k = { name: 'Axetere', cities: [], log: [] };
  assert.match(ctx.cqTake(k, F, 'keep', true, now), /no longer yours/, 'not if the hex has been lost since');
  old.founded = 999;assert.deepEqual(J(ctx.cqBuildings(F, now)), [], 'nothing from a nation founded again since');
});

test('a captured city counts for nothing against the cities a nation may found', () => {
  assert.match(src, /function cityFounded\(n\)\{return cityList\(n\)\.filter\(c=>!c\.cq\)\.length;\}/);
  assert.match(fn('cityProblem'), /have=cityList\(S\.nation\)\.filter\(c=>!c\.cq\)\.length;/, 'founding a city');
  assert.match(src, /have=cityList\(n\)\.filter\(c=>!c\.cq\)\.length,room=have<lim&&have<MAX_CITIES/, 'the Cities page');
  assert.match(src, /if\(Math\.min\(maxCities\(T,mi\),MAX_CITIES\)<=cityList\(n\)\.filter\(c=>!c\.cq\)\.length\)return 'Every city your nation may found stands already\.';/);
  assert.match(src, /function cityCount\(n\)\{return n&&Array\.isArray\(n\.cities\)\?n\.cities\.length:0;\}/, 'edicts about many cities still count them all');
  /* the record: captured cities kept beyond MAX_CITIES, up to CQ_MAX */
  const N = fn('normCities');assert.match(N, /if\(cq\?out\.filter\(x=>x\.cq\)\.length>=CQ_MAX:out\.filter\(x=>!x\.cq\)\.length>=MAX_CITIES\)continue;/);
  assert.match(N, /return out\.slice\(0,MAX_CITIES\+CQ_MAX\);/);
  assert.match(fn('ensureCities'), /cxCityExtras\(c\),c\.cq\?\{cq:c\.cq\}:\{\}\)\);/, 'and ensureCities keeps the mark');
  const ctx = vm.createContext({ MAP_VER: 5, MAX_CITIES: 3, CQ_MAX: 2, MAP: { N: 100, T: new Uint8Array(100).fill(2) }, MAP_T0: [], Date, Math, BUILDINGS: {}, cellOf: () => 0, isdHexOf: () => false,
    paidClean: () => null, bCost: () => ({}), whExtras: () => ({}), cxBldExtras: () => ({}), elExtras: () => ({}), cxCityExtras: () => ({}) });
  vm.runInContext(N, ctx);
  const cities = [{ c: 0 }, { c: 1 }, { c: 2 }, { c: 3, cq: 'Vesad' }, { c: 4 }, { c: 5, cq: 'Bevton' }, { c: 6, cq: 'Tirrasol' }];
  const out = ctx.normCities({ cv: 5, loc: 0, cities: cities.map((c, i) => ({ id: 'c' + i, ...c })) });
  assert.deepEqual(J(out.map(c => c.c + (c.cq ? ':' + c.cq : ''))), ['0', '1', '2', '3:Vesad', '5:Bevton'], 'three founded, and two captured beside them');
});

test('the decision: goodwill with the region, and the capital marked decided', () => {
  const W = cut('applyEffects=(f=>function(n,e){\n  if(e&&n&&!n.npc&&(\'cqc\' in e', '})(applyEffects);') + '})(applyEffects);';
  let taken = null;const ctx = vm.createContext({ Date, setTimeout: f => f(), toast: () => {}, applyEffects: (n, e) => ({ n, e }), cqFall: () => ({ id: 'f1' }), cqTake: (n, F, how, b) => { taken = [how, b]; return ''; } });
  vm.runInContext(fn('cqGoodwill').replace('function cqGoodwill', 'function _g') + '\nvar cqGoodwill=(n,k)=>{n.gw={x:k};};\n' + W, ctx);
  const n = {}, r = ctx.applyEffects(n, { culture: 2, cqc: 'new', cqb: 1, gwall: 4 });
  assert.deepEqual(J(taken), ['new', true]);assert.deepEqual(J(n.cqd), ['f1']);assert.deepEqual(J(n.gw), { x: 4 });
  assert.deepEqual(J(r.e), { culture: 2 }, 'the rest goes on as usual');
});

test('the city cap as it always was: one city for each that people, land and buildings bring, 33 at most (tripled for a few minutes on 22 Nov 2026, then set back)', () => {
  assert.match(src, /function maxCities\(T,i\)\{return Math\.min\(MAX_CITIES,mileOf\(S\.nation\)\.cities\+areaCities\(myArea\(T,i\)\)\+\(cityBonusOpen\(S\.nation\)\?1:0\)\+\(cityGoldOpen\(S\.nation\)\?1:0\)\);\}/);
  assert.match(src, /MAX_CITIES=33,CQ_MAX=10,/);assert.doesNotMatch(src, /CITY_MULT/);
  assert.match(src, /const lcCities=n=>\{const cap=cellOf\(n&&n\.loc\);return n&&Array\.isArray\(n\.cities\)\?n\.cities\.filter\(c=>c&&c\.c!==cap&&!c\.cq\)\.length:0;\};/, 'a captured city earns no founding land credits');
});
