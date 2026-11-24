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

const CQ_FNS = ['cqFalls', 'cqFall', 'cqPairs', 'cqFallOf', 'cqDue'];
function cqCtx(falls) {
  const ctx = vm.createContext({ DAY, OBS: false, S: { mode: 'world' }, myId: () => 'me', wrFallsAt: () => falls, hash: s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; } });
  vm.runInContext(vars(LIST) + '\n' + vars(cut('const CQ_SET=', '\n')) + '\n' + CQ_FNS.map(fn).join('\n'), ctx);
  return ctx;
}

test('one edict for each capital taken, all on the desk together, each its own and not repeated within a month', () => {
  const now = 1e12, falls = [{ id: 'a_w_2', a: 'me', d: 'w', ft: now - 2 * DAY, cn: 'Bevton', dn: 'Wessex' }, { id: 'a_v_1', a: 'me', d: 'v', ft: now - DAY, cn: 'Adler', dn: 'Vesad' }, { id: 'x_y', a: 'x', d: 'y', ft: now }];
  const ctx = cqCtx(falls);
  const n = { founded: 1, inbox: [], answered: [] };
  assert.equal(ctx.cqFall(n).id, 'a_w_2', 'the first capital taken not yet decided');
  const d = J(ctx.cqDue(n, now));
  assert.equal(d.length, 2, 'both capitals at once, none for a capital another nation took');
  assert.notEqual(d[0].id, d[1].id, 'a different edict for each');
  assert.ok(d.every(x => ctx.CQ_ISSUES.some(i => i.id === x.id)));
  assert.deepEqual(d.map(x => x.at), [now - 2 * DAY, now - DAY], 'each arrives when its capital fell: the same on every draw');
  assert.deepEqual(J(ctx.cqDue(n, now + 3600e3)), d, 'drawn again an hour later, the very same edicts');
  assert.deepEqual(J(ctx.cqDue({ ...n, inbox: [d[0]] }, now)), [d[1]], 'one on the desk: only the other is due');
  assert.deepEqual(J(ctx.cqDue({ ...n, inbox: d }, now)), [], 'both on the desk: nothing more');
  const both = { ...n, inbox: d };
  assert.equal(ctx.cqFallOf(both, d[0]).cn, 'Bevton', 'each edict knows its own capital');assert.equal(ctx.cqFallOf(both, d[1]).cn, 'Adler');
  assert.equal(ctx.cqFallOf(n, d[1]).cn, 'Adler', 'also before the desk is saved');
  /* an edict drawn by the old code, at some other moment: it stands for the oldest capital, and the other is due beside it */
  const old = { ...n, inbox: [{ id: 'cq-keys', at: now - 5000 }] };
  assert.equal(ctx.cqFallOf(old, old.inbox[0]).cn, 'Bevton');
  const od = J(ctx.cqDue(old, now));assert.equal(od.length, 1);assert.equal(od[0].at, now - DAY);assert.notEqual(od[0].id, 'cq-keys', 'not the edict already there');
  assert.deepEqual(J(ctx.cqDue({ ...n, cqd: ['a_w_2'] }, now)).map(x => x.at), [now - DAY], 'once decided, only the next');
  assert.deepEqual(J(ctx.cqDue({ ...n, cqd: ['a_v_1', 'a_w_2'] }, now)), [], 'none once all are decided');
  assert.equal(ctx.cqFall({ ...n, founded: now }), null, 'none from before the nation was founded again');
  const ids = ctx.CQ_ISSUES.map(i => i.id), recent = ids.filter(id => id !== 'cq-salt' && id !== 'cq-fire').map(id => ({ id, t: now - DAY }));
  assert.deepEqual(J(ctx.cqDue({ ...n, answered: recent }, now)).map(x => x.id).sort(), ['cq-fire', 'cq-salt'], 'not one decided in the last month');
});

test('the desk keeps the capital edict, and its card opens (it arrived at Date.now(), a new time on each draw)', () => {
  assert.match(src, /\{id:'wr-home',at:Math\.min\(now,r\.t1\|\|now\),war:r\}/, 'Coming Home arrives when the war ended');
  assert.match(src, /return \{id:'wr-memorial',at:home\.t\+12\*3600000,war:r\}/, 'and the memorial when it became due');
  assert.doesNotMatch(cut('function cqDue(n,now){', '\nsyncInbox=(f=>'), /at:now/);
  const E = fn('edictChange');
  assert.match(E, /\|\|\(held\?null:n\.inbox\.find\(x=>x\.id===id\)\);/, 'an edict this draw added, asked for by another arrival time, is still the one of that id');
  let saved = null;
  const ctx = vm.createContext({ S: { nation: { inbox: [] } }, clone: J, commit: n => { saved = n; }, saveSoon: () => {}, Date,
    syncInbox: (n, now) => ({ ...n, inbox: [{ id: 'cq-keys', at: now }] }) });
  vm.runInContext(E, ctx);
  assert.equal(ctx.edictChange('cq-keys', '12345', 'read'), true, 'opened');
  assert.equal(saved.inbox[0].read, 1, 'and kept on the desk, read');
  saved = null;ctx.S.nation = { inbox: [{ id: 'cq-keys', at: 1 }] };
  assert.equal(ctx.edictChange('cq-keys', '12345', 'read'), false, 'one the record holds answers only to its own time (a stale card)');assert.equal(saved, null);
});

test('answered or vetoed, the edict decides its own capital, whatever the motion', () => {
  const W = cut('let CQ_NOW=null;', '\n/* the ruins on the map');
  const falls = [{ id: 'f1', a: 'me', d: 'w', ft: 100, cn: 'Bevton' }, { id: 'f2', a: 'me', d: 'v', ft: 200, cn: 'Adler' }];
  const ctx = cqCtx(falls), hooks = [];
  Object.assign(ctx, { COMMIT_HOOKS: hooks, S: { mode: 'world', nation: { founded: 1, answered: [], inbox: [{ id: 'cq-keys', at: 100 }, { id: 'cq-fire', at: 200 }] } } });
  ctx.syncInbox = n => n;
  let seen = null;
  ctx.answer = (id) => { seen = J(ctx.CQ_NOW); const n = J(ctx.S.nation);n.inbox = n.inbox.filter(x => x.id !== id);for (const h of hooks) h(n);ctx.S.nation = n; };
  ctx.dismiss = ctx.answer;
  vm.runInContext(vars(W), ctx);
  ctx.answer('cq-fire', 2);
  assert.equal(seen.F.id, 'f2', 'the edict about Adler, answered first, is about Adler');
  assert.deepEqual(J(ctx.S.nation.cqd), ['f2'], 'a motion that names no fate decides it too');
  assert.equal(ctx.CQ_NOW, null);
  ctx.dismiss('cq-keys');
  assert.deepEqual(J(ctx.S.nation.cqd), ['f2', 'f1'], 'and so does a veto');
  ctx.answer('fs-other');assert.equal(seen, null, 'other edicts are left alone');
});

test('the Dispatch: a capital taken is a csack, never a minister sacked ("X sacks its <id>")', () => {
  assert.match(src, /n\.log\.unshift\(\{t:now\+1,k:'csack',a:en\.id,b:en\.n\.name,fx:en\.n\.capital\|\|''\}\)/);
  assert.match(src, /'Take an enemy capital after a siege\.',1,x=>aT\(x,'log:csack'\)/, 'The Fall of a Capital, not for sacking a minister');
  assert.match(src, /ST_LOG,\{siege:\['war','Laid siege to \{b\}’s capital, \{fx\}'\],csack:/);
  assert.doesNotMatch(cut('/* ── the record: log lines, the bell, the region', '/* a capital taken was logged as'), /k==='sack'|[{,]sack:/, 'the war section no longer takes the minister\'s kind');
  const ctx = vm.createContext({ PORTFOLIOS: [['fin', 'Finance', 'Finance Minister'], ['def', 'Defence', 'Defence Minister']], NORM_HOOKS: [], dspThawSt: s => s });
  vm.runInContext(vars(cut('const WR_PF_TITLES=', '\nHAP_SOURCES.push(')), ctx);
  const n = { log: [{ k: 'sack', a: 'Hu6o1S740hbEi4ZSiwLBYtuTgyk1', b: 'Vesad', fx: 'Adler' }, { k: 'sack', a: 'Hu6o1S740hbEi4ZSiwLBYtuTgyk1', b: 'Vesad', fx: '' }, { k: 'sack', a: 'Finance Minister', b: 'Ada Lin', fx: '' }, { k: 'sack', a: 'Minister of Moods', b: 'Bo', fx: '' }, { k: 'war', a: 'x', fx: 'y' }] };
  for (const h of ctx.NORM_HOOKS) h(n);
  assert.deepEqual(n.log.map(l => l.k), ['csack', 'csack', 'sack', 'sack', 'war'], 'old capital lines move over, ministers stay');
  /* an edition already filed with the story: read, it tells of the fall */
  const filed = { k: 'l:abc:1700000000000:sack', sec: 'politics', kick: 'Cabinet', go: 'government', h: 'The Wandering Isles sacks its Hu6o1S740hbEi4ZSiwLBYtuTgyk1', b: 'The Wandering Isles’s Hu6o1S740hbEi4ZSiwLBYtuTgyk1, Vesad, has been dismissed. Colleagues say they had seen it coming since the incident with the stapler.' };
  const t = ctx.dspThawSt(filed);
  assert.equal(t.h, 'The Wandering Isles takes the capital of Vesad');assert.equal(t.kick, 'War');assert.equal(t.sec, 'world');assert.equal(t.go, 'map');
  assert.match(t.b, /^The Wandering Isles has taken the capital of Vesad after a siege, and Vesad has fallen\.$/);
  const real = { ...filed, h: 'Axetere sacks its Finance Minister', b: 'Axetere’s Finance Minister, Ada Lin, has been dismissed. Colleagues say.' };
  assert.equal(ctx.dspThawSt(real), real, 'a minister sacked stays a minister sacked');
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
  let taken = null;const ctx = vm.createContext({ CQ_NOW: null, Date, setTimeout: f => f(), toast: () => {}, applyEffects: (n, e) => ({ n, e }), cqFall: () => ({ id: 'f1' }), cqTake: (n, F, how, b) => { taken = [how, b]; return ''; } });
  vm.runInContext(fn('cqGoodwill').replace('function cqGoodwill', 'function _g') + '\nvar cqGoodwill=(n,k)=>{n.gw={x:k};};\n' + W, ctx);
  const n = {}, r = ctx.applyEffects(n, { culture: 2, cqc: 'new', cqb: 1, gwall: 4 });
  assert.deepEqual(J(taken), ['new', true]);assert.deepEqual(J(n.cqd), ['f1']);assert.deepEqual(J(n.gw), { x: 4 });
  assert.deepEqual(J(r.e), { culture: 2 }, 'the rest goes on as usual');
  ctx.CQ_NOW = { id: 'cq-keys', F: { id: 'f2' } };ctx.applyEffects(n, { cqc: 'keep' });
  assert.deepEqual(J(n.cqd), ['f1', 'f2'], 'the capital of the edict being answered, not the oldest');
  ctx.applyEffects(n, { cqc: 'keep' });assert.deepEqual(J(n.cqd), ['f1', 'f2'], 'once');
});

test('the city cap includes the population schedule, land and building bonuses, with captured cities counted separately', () => {
  assert.match(src, /function maxCities\(T,i\)\{return Math\.min\(MAX_CITIES,mileOf\(S\.nation\)\.cities\+areaCities\(myArea\(T,i\)\)\+\(cityBonusOpen\(S\.nation\)\?1:0\)\+\(cityGoldOpen\(S\.nation\)\?1:0\)\);\}/);
  assert.match(src, /MILE_CITIES=1\+CITY_POP_AT\.length,MAX_CITIES=MILE_CITIES\+21,CQ_MAX=10,/);assert.doesNotMatch(src, /CITY_MULT/);
  assert.match(src, /const lcCities=n=>\{const cap=cellOf\(n&&n\.loc\);return n&&Array\.isArray\(n\.cities\)\?n\.cities\.filter\(c=>c&&c\.c!==cap&&!c\.cq\)\.length:0;\};/, 'a captured city earns no founding land credits');
});
