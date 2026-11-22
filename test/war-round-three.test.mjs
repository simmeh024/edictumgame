// War, round three (21 Nov 2026; game/edictum.html, "war, round three"): the war layer on the map, the battle report,
// the war report and the Wars section, war industry, and veterans and memorials. Checked with the game's own code, cut
// from its source.
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
const DAY = 864e5, H = 3600000, J = v => JSON.parse(JSON.stringify(v)), RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const SEC = cut('/* ───────── war, round three (21 November 2026) ─────────', '\nif(hot&&typeof hot.snapshot');
const CONSTS = cut('const WR3_KEEP=', '\n');

test('war industry: at war and retooled, each Factory makes 3 fewer goods and adds 4% to the army, 20% at most', () => {
  const now = Date.now(), ctx = vm.createContext({ DAY, RES, Math, Date, Object, DEMAND: { food: 1, timber: 1, iron: 1, oil: 1, goods: 1 }, econSize: () => 100 });
  vm.runInContext(vars(CONSTS) + '\n' + ['wr3MunOn', 'wr3Reserve', 'wr3Econ'].map(fn).join('\n'), ctx);
  ctx.wrWarsOf = id => id === 'peace' ? [] : [{ id: 'x' }];
  const T = { list: [{ id: 'a', n: { wind: true, windAt: now - 7 * H } }, { id: 'b', n: { wind: true, windAt: now - H } }, { id: 'peace', n: { wind: true, windAt: 0 } }, { id: 'big', n: { wind: true, windAt: 0 } }] };
  const city = (hi, k) => ({ active: true, hi, done: k, npc: false });
  const all = [city(0, ['factory']), city(0, ['factory', 'farm']), city(1, ['factory']), city(2, ['factory']), ...Array.from({ length: 7 }, () => city(3, ['factory']))];
  const prod = { goods: Float64Array.from([20, 20, 20, 30]) }, dem = Object.fromEntries(RES.map(r => [r, new Float64Array(4)]));
  const E = ctx.wr3Econ(T, { all }, prod, dem, 4);
  assert.deepEqual(J([...E.fac]), [2, 1, 1, 7]);
  assert.ok(Math.abs(E.army[0] - 0.08) < 1e-9, 'two factories: +8%');assert.equal(prod.goods[0], 14, '6 fewer goods');
  assert.equal(E.army[1], 0, 'still retooling (6 hours)');assert.equal(prod.goods[1], 20);
  assert.equal(E.army[2], 0, 'at peace: factories make goods');
  assert.ok(Math.abs(E.army[3] - 0.2) < 1e-9, 'seven factories: capped at +20%');
  /* pensions: food and goods a day, for a month; a reserve: +3% */
  T.list[0].n.vet = { k: 'pen', t: now - DAY, u: now + DAY };T.list[1].n.vet = { k: 'res', t: now - DAY, u: now + DAY };
  const d2 = Object.fromEntries(RES.map(r => [r, new Float64Array(4)])), E2 = ctx.wr3Econ(T, { all }, { goods: Float64Array.from([20, 20, 20, 30]) }, d2, 4);
  assert.ok(Math.abs(d2.food[0] - 4) < 1e-9 && Math.abs(d2.goods[0] - 5) < 1e-9, 'pensions: 4% of food and 5% of goods');
  assert.ok(Math.abs(E2.army[1] - 0.03) < 1e-9, 'the reserve: +3%');
  assert.match(src, /\*\(1\+\(\(wr3&&wr3\.army\[i\]\)\|\|0\)\),/, 'the economy\'s army counts it');
  assert.match(SEC, /maxReady=\(f=>function\(n\)\{return f\.apply\(this,arguments\)\+\(wr3Reserve\(n\)\?1:0\);\}\)\(maxReady\);/, 'and a reserve readies one more point');
});

test('the war report: hexes either way in the war\'s time, and who came out ahead', () => {
  const ctx = vm.createContext({ DAY, Math, myId: () => 'me', NPC_SET: new Set(['npc-1']), nameOf: id => ({ them: 'Vesad', 'npc-1': 'Ilsund' })[id] || id });
  vm.runInContext(vars(CONSTS) + '\n' + vars(cut('const WR3_RES=', '\n')) + '\n' + vars(cut('const WR3_HOW=', '\n')) + '\n' + ['wr3Hexes', 'wr3Close'].map(fn).join('\n'), ctx);
  const K = 1e6, them = { conq: [{ c: 1, t: 150 * K, d: 'me' }, { c: 2, t: 50 * K, d: 'me' }], wars: { me: { t: 100 * K, g: 'b' } } };
  ctx.docOf = id => id === 'them' ? them : null;
  const n = { log: [], conq: [{ c: 5, t: 120 * K, d: 'them' }, { c: 6, t: 130 * K, d: 'them' }, { c: 7, t: 500 * K, d: 'them' }, { c: 8, t: 140 * K, n: 'npc-1' }], wars: {} };
  const s = { t: 100 * K, a: 7, w: 4, r: 1, m: { iron: 30 }, p: 0.2 };
  const r = ctx.wr3Close(n, 'them', s, 'peace', 200 * K);
  assert.deepEqual(J({ tk: r.tk, ls: r.ls, res: r.res, g: r.g, nm: r.nm }), { tk: 2, ls: 1, res: 'gain', g: 'b', nm: 'Vesad' }, 'two taken, one lost, in the war\'s time; the aim theirs');
  assert.equal(n.wrp.length, 1);assert.equal(n.log[0].k, 'wrep');assert.equal(n.log[0].fx, 'gain');
  assert.equal(ctx.wr3Close(n, 'them', s, 'surr-them', 200 * K).res, 'won', 'they surrendered: a victory');
  assert.equal(ctx.wr3Close(n, 'them', s, 'fell-them', 200 * K).res, 'won');
  assert.equal(ctx.wr3Close(n, 'them', s, 'surr-me', 200 * K).res, 'lost');
  them.conq.push({ c: 3, t: 160 * K, d: 'me' }, { c: 4, t: 170 * K, d: 'me' });
  assert.equal(ctx.wr3Close(n, 'them', s, 'peace', 200 * K).res, 'loss', 'more lost than taken');
  assert.equal(ctx.wr3Hexes(n, 'me', 'npc-1', 100 * K, 200 * K).ls, 1, 'a computer nation\'s conquests are in our own record');
  for (let i = 0; i < 30; i++) ctx.wr3Close(n, 'them', s, 'peace', 200 * K);
  assert.equal(n.wrp.length, 20, 'the last 20 reports are kept');
});

test('the war\'s count while it lasts, and its end found at the next save', () => {
  const hook = cut('COMMIT_HOOKS.push((n,old,now)=>{\n  const out=[];if(!n||n.npc||OBS||S.mode===\'readonly\'||cellOf(n.loc)<0)return out;\n  if(S.mode===\'world\'&&!worldHeardAt)', '\n/* ── the battle report ── */');
  const now = 1e12, H2 = [];
  const ctx = vm.createContext({ DAY, Math, RES, OBS: false, S: { mode: 'world' }, worldHeardAt: 1, COMMIT_HOOKS: H2, cellOf: () => 5, myId: () => 'me', NPC_SET: new Set(), nameOf: () => 'Vesad',
    economy: () => ({ T: { byId: { me: 0 } }, wup: { war: Object.fromEntries(RES.map(r => [r, [r === 'iron' ? 10 : 0]])) } }), popNow: () => 100, wrFallsAt: () => [], fmtPopShort: p => p + 'M' });
  vm.runInContext(vars(CONSTS) + '\n' + vars(cut('const WR3_RES=', '\n')) + '\n' + vars(cut('const WR3_HOW=', '\n')) + '\n' + ['wr3Stat', 'wr3Hexes', 'wr3Close'].map(fn).join('\n') + '\n' + hook, ctx);
  let at = true;ctx.wrWarsOf = () => at ? [{ id: 'them', g: 'c' }] : [];ctx.docOf = id => id === 'them' ? { conq: [] } : null;
  ctx.pairWar = () => at ? { war: true, since: now - 5 * DAY } : { war: false, peaceAt: now - H, surr: 'them' };
  const n = { loc: 1, pwl: 0.01, log: [], conq: [] };
  ctx.COMMIT_HOOKS[0](n, { popAt: now - DAY }, now);
  assert.equal(n.wst.them.t, now - 5 * DAY, 'the war counted from its start');
  assert.equal(n.wst.them.m.iron, 10, 'a day of its iron');assert.equal(n.wst.them.p, 1, 'and 1% of 100 million people');
  at = false;const out = ctx.COMMIT_HOOKS[0](n, { popAt: now }, now);
  assert.equal(n.wst, undefined, 'the count is closed');assert.equal(n.wrp[0].how, 'surr-them');assert.equal(n.wrp[0].res, 'won');
  assert.match(out[0].m, /The war with Vesad is over: victory\./);
  /* a war whose other side's record has not loaded stays open */
  at = true;ctx.COMMIT_HOOKS[0](n, { popAt: now }, now);at = false;ctx.docOf = () => null;ctx.COMMIT_HOOKS[0](n, { popAt: now }, now);
  assert.ok(n.wst && n.wst.them, 'not closed while the other record is missing');
});

test('veterans and memorials: two edicts after a war with battles fought, the second after a costly one', () => {
  const L = (() => { const c = vm.createContext({}); vm.runInContext(vars(cut('const WAR3_ISSUES=[', '\nfor(const is of WAR3_ISSUES)')), c); return c.WAR3_ISSUES; })();
  assert.deepEqual(J(L.slice(0, 2).map(x => x.id)), ['wr-home', 'wr-memorial'], 'the veterans first, then the fifteen capital-taken edicts (war-capital.test.mjs)');
  assert.equal(L.length, 17);
  for (const is of L.slice(0, 2)) { assert.equal(src.split(`{id:'${is.id}',c:`).length, 2);assert.equal(src.split(`t:'${is.t}'`).length, 2);assert.ok(is.o.every(o => o.t && o.e && o.fx));assert.match(is.q, /\{WARFOE\}/); }
  assert.deepEqual(J(L[0].o.map(o => o.e.wvet || '')), ['pen', 'res', '']);assert.deepEqual(J(L[1].o.map(o => o.e.wmem || 0)), [1, 1, 0]);
  const code = src.slice(0, src.lastIndexOf('</script>')), at = code.indexOf('for(const is of WAR3_ISSUES){');
  assert.ok(at > code.indexOf('for(const is of WAR2_ISSUES){'));{const rsAt=code.indexOf('/* ───────── the National Research Programme (22 November 2026)'),next=code.indexOf('ISSUES.push(', at + 40);assert.ok(rsAt>at&&next>rsAt,'the last edicts added before the research edicts');assert.equal(code.indexOf('ISSUES.push(', code.indexOf('/* ───────── military buildings (22 November 2026)')), -1, 'and nothing after those');}
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'WAR2_ISSUES','WAR3_ISSUES'/);
  const ctx = vm.createContext({ OBS: false, S: { mode: 'world' }, Date });
  vm.runInContext(vars(cut('const WAR3_ISSUES=[', '\nfor(const is of WAR3_ISSUES)')) + '\n' + fn('wr3VetDue'), ctx);
  const now = 1e12, war = { t1: now - 14 * H, a: 4, p: 0, ls: 0 }, base = { inbox: [], answered: [], wrp: [war] };
  assert.equal(ctx.wr3VetDue(base, now).id, 'wr-home', 'after a war with battles fought');
  assert.equal(ctx.wr3VetDue({ ...base, wrp: [{ ...war, a: 2 }] }, now), null, 'not after a skirmish');
  assert.equal(ctx.wr3VetDue({ ...base, vck: now - 1 }, now), null, 'once for each war');
  const home = { id: 'wr-home', t: now - 13 * H };
  assert.equal(ctx.wr3VetDue({ ...base, answered: [home] }, now), null, 'no memorial after a cheap war');
  assert.equal(ctx.wr3VetDue({ ...base, wrp: [{ ...war, ls: 2 }], answered: [home] }, now).id, 'wr-memorial', 'one after land was lost');
  assert.equal(ctx.wr3VetDue({ ...base, wrp: [{ ...war, ls: 2 }], answered: [{ ...home, t: now - H }] }, now), null, 'half a day after the first');
});

test('the map layer: sieges, ruins, fortified hexes, today\'s battles, raids and memorials', () => {
  const now = Date.now(), ctx = vm.createContext({ DAY, Date, Math, MAP: { N: 6 }, SIEGE_MS: 24 * H, SIEGE_MAX: 72 * H, S: { mode: 'world' }, polMemo: { k: 'x' },
    WR: { rev: 1, docs: new Map([['s1', { a: 'me', d: 'v', st: 'on', t: now - H, an: 'Axe' }]]) }, wrSiege: (a, d) => [...ctx.WR.docs.values()][0], wrFallsAt: () => [{ c: 4, cn: 'Adler', dn: 'Vesad' }],
    wrForts: n => n.fort || {}, wrRaided: () => new Set([2]) });
  vm.runInContext(vars(cut('let wr3MapMemo=', '\n')) + '\n' + fn('wr3MapData'), ctx);
  const T = { list: [{ id: 'me', cap: 0, n: { fort: { 3: now + H }, mem: [{ t: 1, nm: 'X' }] } }, { id: 'v', cap: 5, n: {} }], byId: { me: 0, v: 1 }, occ: [0, 1, 0, 0, 0, 0], tk: [0, now - H, 0, 0, 0, 0] };
  const D = ctx.wr3MapData(T);
  assert.deepEqual(J({ sieges: D.sieges.map(s => s.c), forts: D.forts, fought: D.fought, raided: D.raided, ruins: D.ruins.map(r => r.c), mems: D.mems.map(m => m.c) }), { sieges: [5], forts: [3], fought: [1], raided: [2], ruins: [4], mems: [0] });
  assert.match(SEC, /MAP_CONTROLS\.push\(\(\)=>`<label class="mig-tog mfx-tog wr3-tog"/, 'its own toggle in the map legend');
  assert.match(SEC, /function wr3On\(\)\{return mapOpt\('war',true\)!==false;\}/, 'on unless switched off');
});

test('the battle report, the Wars section, the referee\'s dice, the record', () => {
  const a = cut('async function attack(){', '\nfunction declareWar(');
  assert.match(a, /roll=typeof res\.roll==='number'\?res\.roll:null;/);assert.match(a, /\}else\{roll=Math\.random\(\);win=roll<od\.p;\}/);
  assert.match(a, /wr3Count\(n,en,win,raid\);/);assert.match(a, /S\.wrBattle=\{t:now,cell,where:placePhrase\(cell\),fn:en\.n\.name,win,fell,raid:raid&&win,roll,p:pe,pc:od\.p,/);
  assert.match(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'), /roll: Math\.round\(roll \* 1e4\) \/ 1e4 \};/, 'the referee says its dice');
  assert.match(src, /\{k:'war',t:'Wars',d:'Wars fought, their reports, and war memorials'\},\r?\n {2}\{k:'dorm',/, 'a section of the page others see, before the long sleeps');
  assert.match(SEC, /vsAdd\('war',/);assert.match(SEC, /NATION_SECTIONS\.push\(\(x,now\)=>\{try\{return wr3WarsSection\(x,true\);/);
  const hook = cut('NORM_HOOKS.push((n,d)=>{\n  const ok=v=>typeof v===\'number\'&&isFinite(v)&&v>=0,s=(v,k)', '\n/* ── war industry');
  const ctx = vm.createContext({ NORM_HOOKS: [], RES, Math, DAY, VET_MS: 30 * DAY, WR3_KEEP: 20 });vm.runInContext(hook, ctx);
  const n = {}, now = Date.now();
  ctx.NORM_HOOKS[0](n, { wst: { x: { t: 5, a: 3, w: 1, m: { iron: 2.25, bad: 4 }, p: 0.1 } }, wrp: [{ id: 'x', nm: 'Vesad', t0: 1, t1: 2, how: 'peace', res: 'won', m: { food: 3 } }], vet: { k: 'pen', t: now, u: now + 30 * DAY }, mem: [{ t: 3, nm: 'Vesad' }], wind: true, windAt: now, vck: 9 });
  assert.deepEqual(J(n.wst.x.m), { iron: 2.3 });assert.equal(n.wrp[0].res, 'won');assert.equal(n.vet.k, 'pen');assert.equal(n.mem.length, 1);assert.equal(n.wind, true);assert.equal(n.vck, 9);
  const m = {};ctx.NORM_HOOKS[0](m, { vet: { k: 'pen', t: now, u: now + 90 * DAY }, wind: 'yes' });assert.equal(m.vet, undefined, 'pensions longer than a month are dropped');assert.equal(m.wind, undefined);
});

test('a war ends when either side\'s capital falls: no more upkeep or weariness for a war with a nation off the map', () => {
  const t = 1e12, F = { d: 'v', a: 'me', ft: t + 5 * H, df: 100 }, GOALS = cut('const WAR_GOALS={', '};') + '};';
  const ctx = vm.createContext({ TRUCE_MS: 72 * H, PEACE_AUTO_MS: 30 * H, SURR_TRUCE: 14 * DAY, NPC_SET: new Set(), DAY, BORDER_CAP: 12, wakeFence: () => 0, npcPeaceWait: () => DAY, Date: { now: () => t + 6 * H } });
  vm.runInContext(vars(GOALS.replace('${BORDER_CAP}', '12')) + '\n' + fn('pairWar') + '\n' + fn('wrFellOf'), ctx);
  const recs = { me: { wars: { v: { t, g: 'c' } } }, v: { founded: 100 } };ctx.docOf = id => recs[id];ctx.wrFallsAt = () => [F];
  const w = ctx.pairWar('me', 'v');
  assert.equal(w.war, false);assert.equal(w.fell, 'v');assert.equal(w.peaceAt, F.ft);
  recs.v = { founded: t + 9 * H };ctx.Date = { now: () => t + 10 * H };
  assert.equal(ctx.pairWar('me', 'v').war, true, 'founded again, the old war no longer counts as ended by the fall (its declaration predates it, wakeFence aside)');
});
