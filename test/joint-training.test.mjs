// Joint military training (20 November 2026): a fourth kind of treaty, after the owner's idea that agreements such as
// joint training should make an army stronger while they last. The game works out which pacts are at work (one side
// holds a Barracks), what they add to each side's army, the food and iron they use and how much sooner they ready an
// army; the referee keeps to the same readiness and to the edge a breaker gives away. These checks run the game's own
// functions in a sandbox and read the server's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../functions/treaty-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const referee = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const STAT_KEYS = JSON.parse(code.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const J = v => JSON.parse(JSON.stringify(v));

function rules() {
  const at = code.indexOf('const TY_RULES=');
  let i = code.indexOf('{', at), depth = 0;
  for (; i < code.length; i++) { const ch = code[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return vm.runInNewContext('(' + code.slice(code.indexOf('{', at), i + 1) + ')');
}
function sandbox(docs) {
  const A = code.indexOf('function drHosts('), B = code.indexOf('economy=(f=>function(){const v=f.apply(this,arguments);if(v&&!v._dr)');
  assert.ok(A > 0 && B > A, 'the training section is found');
  const ctx = vm.createContext({ TY: { docs: new Map(docs.map(d => [d.id, d])) }, TY_RULES: rules(),
    tyLive: D => D.st === 'active', tyVoid: () => false, armyRaw: n => n.base, clamp: (v, a, b) => Math.min(b, Math.max(a, v)) });
  vm.runInContext(code.slice(A, B) + '\nthis.f={drHosts,drPairs,drUpkeep,drReadyMs,drNudge,drApply,DRX_MAX,DRX_MS};', ctx);
  return ctx.f;
}
const pact = (a, b, st = 'active', k = 'drill') => ({ id: k + '_' + [a, b].sort().join('_'), k, p: [a, b].sort(), st });

test('joint military training is a fourth kind of treaty, the same in the game and on the server', () => {
  const G = rules();
  assert.deepEqual(T.TR_KINDS, ['nap', 'trade', 'research', 'drill']);
  assert.deepEqual(J(G.kinds), T.TR_KINDS);
  assert.equal(T.TR_MAX.drill, 3);
  assert.equal(T.TR_NPC_MIN.drill, 55);
  assert.deepEqual(J(G.fx.drill), T.TR_FX.drill);
  assert.deepEqual(T.TR_FX.drill, { base: 0.02, more: 0.04, host: 0.01, max: 3, up: { food: 1, iron: 0.5 }, ready: 0.05, edge: 0.1 });
  assert.deepEqual(T.TR_PEACE, ['nap', 'drill']);
});

test('a pact works while one side holds a Barracks; each side’s army gains by its partner’s strength, its own Barracks and its supply', () => {
  const now = Date.now();
  const L = [{ id: 'a', n: { base: 10 } }, { id: 'b', n: { base: 20 } }, { id: 'c', n: { base: 5 } }, { id: 'd', n: { base: 10, drx: { v: 0.02, u: now + 1e6 } } }];
  const Tr = { list: L, byId: { a: 0, b: 1, c: 2, d: 3 } };
  /* a holds a finished Barracks; c's stands in a city it does not hold; b's city has none */
  const CSt = { all: [{ active: true, done: ['barracks', 'farm'], hi: 0 }, { active: true, done: ['farm'], hi: 1 }, { active: false, done: ['barracks'], hi: 2 }] };
  const f = sandbox([pact('a', 'b'), pact('b', 'c'), pact('a', 'd'), pact('a', 'c', 'active', 'nap'), pact('c', 'd', 'offered')]);
  assert.deepEqual(J([...f.drHosts(CSt)]), [0]);
  const dr = f.drPairs(Tr, CSt);
  assert.deepEqual(J(dr.map(q => q.D.id).sort()), ['drill_a_b', 'drill_a_d'], 'b and c have no Barracks between them; a pact offered or of another kind is not training');
  /* the upkeep: 1 food and 0.5 iron a day for each side of each pact at work */
  const dem = { food: new Float64Array(4), iron: new Float64Array(4) }, up = f.drUpkeep(dr, dem, 4);
  assert.deepEqual([...dem.food], [2, 1, 0, 1]); assert.deepEqual([...dem.iron], [1, 0.5, 0, 0.5]);
  assert.deepEqual([...up.food], [...dem.food]);
  const v = { T: Tr, dr, eff: L.map(() => ({ army: 1 })), ratio: { food: [1, 1, 1, 0.5], iron: [1.2, 0.8, 1, 1] } };
  f.drApply(v);
  const [a, b, c, d] = v.eff;
  /* a: b's army is twice a's (+2% +4%) with a's Barracks (+1%); d's is a's equal (+2%, +1%) */
  assert.ok(Math.abs(a.drill - 0.10) < 1e-9, 'a ' + a.drill); assert.equal(a.drillN, 2); assert.equal(a.drillS, 1);
  assert.deepEqual(J(a.drillL.map(q => q.id)), ['b', 'd'], 'the best pact first');
  /* b: a's army is the weaker, b has no Barracks: +2%, cut to 80% by an iron shortage */
  assert.ok(Math.abs(b.drill - 0.016) < 1e-9, 'b ' + b.drill); assert.equal(b.drillS, 0.8);
  /* c trains at nothing */
  assert.equal(c.drill, undefined);
  /* d: +2%, an edict's +2% for the week, halved by a food shortage */
  assert.ok(Math.abs(d.drill - 0.02) < 1e-9, 'd ' + d.drill); assert.equal(d.drillX, 0.02);
  /* an edict's nudge holds for its week only, and within its bounds */
  assert.equal(f.drNudge({ drx: { v: 0.02, u: now - 1 } }, now), 0);
  assert.equal(f.drNudge({ drx: { v: 0.5, u: now + 1 } }, now), f.DRX_MAX);
  assert.equal(f.DRX_MS, 7 * 86400000);
});

test('only the best three pacts count, and a weaker partner never takes strength away', () => {
  const L = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, n: { base: [10, 40, 30, 20, 1][i] } }));
  const Tr = { list: L, byId: { a: 0, b: 1, c: 2, d: 3, e: 4 } };
  const CSt = { all: [{ active: true, done: ['barracks'], hi: 1 }, { active: true, done: ['barracks'], hi: 2 }, { active: true, done: ['barracks'], hi: 3 }, { active: true, done: ['barracks'], hi: 4 }] };
  const f = sandbox(['b', 'c', 'd', 'e'].map(x => pact('a', x)));
  const v = { T: Tr, dr: f.drPairs(Tr, CSt), eff: L.map(() => ({ army: 1 })), ratio: { food: [1, 1, 1, 1, 1], iron: [1, 1, 1, 1, 1] } };
  f.drApply(v);
  /* b, c, d: 4x, 3x, 2x a's army: all of more each; e: weaker, base only and dropped as the fourth */
  assert.deepEqual(J(v.eff[0].drillL.map(q => q.id)), ['b', 'c', 'd']);
  assert.ok(Math.abs(v.eff[0].drill - 3 * 0.06) < 1e-9, String(v.eff[0].drill));
  assert.equal(v.eff[0].drillN, 3);
  /* e hosts (+1%) and its partner is ten times as strong (all of more) */
  assert.ok(Math.abs(v.eff[4].drill - 0.07) < 1e-9, String(v.eff[4].drill));
});

test('readiness comes 5% sooner for each pact at work, three at most, in the game as at the referee', () => {
  const f = sandbox([]);
  for (const ms of [900000, 600000]) for (let k = 0; k <= 5; k++) assert.equal(f.drReadyMs(ms, k), T.trReadyMs(ms, k), ms + ' ' + k);
  assert.equal(T.trReadyMs(900000, 1), 855000); assert.equal(T.trReadyMs(900000, 9), 765000);
  assert.match(code, /function readyMs\(n\)\{const ms=\(pol\(n\)\.rapidMobilisation\?10:15\)\*60000,e=econMine\(n\),k=\(e&&e\.drillN\)\|\|0;return k\?drReadyMs\(ms,k\):ms;\}/);
  /* a copy of the player's record (an attack spends readiness on one) counts the player's own training */
  assert.match(code, /function econMine\(n\)\{return econOf\(n\)\|\|\(n&&!n\.npc&&S\.nation&&n!==S\.nation&&n\.founded===S\.nation\.founded&&n\.name===S\.nation\.name\?econOf\(S\.nation\):null\);\}/);
  /* a Drill Ground's cut comes after the pacts' (military buildings: milMs) */
  /* and Blitz Command's after the Drill Ground's (general-staff.test.mjs) */
  assert.match(referee, /ms = milMs\(milMs\(milMs\(trReadyMs\(\(pol\.rapidMobilisation \? 10 : 15\) \* 60000, drills \|\| 0\), m\.rcut \|\| 0\), m\.cut\), m\.bcut \|\| 0\)/, 'research cuts after the pacts and before the Drill Ground (research.test.mjs)');
  assert.match(referee, /T\.k === 'drill' && trLive\(T, now\) && !trVoid\(T, \{ \[uid\]: mine \}\)/);
});

test('the army counts it, an attack half of it, and the save declares it', () => {
  assert.match(code, /function armyPower\(n\)\{const e=econOf\(n\);return armyRaw\(n,e\)\*\(1\+\(\(e&&e\.drill\)\|\|0\)\);\}/);
  assert.match(code, /const d=drillOf\(n\);if\(d\)m\*=\(1\+d\/2\)\/\(1\+d\);return m;\}/);
  assert.match(code, /n\.apw=Math\.round\(armyPower\(n\)\*\(econOf\(n\)\?1:1\+\(\(e&&e\.drill\)\|\|0\)\)\*1000\)\/1000;/);
  /* the food and iron are part of the economy's demand, and shown where the player's resources go */
  assert.match(code, /try\{dr=drPairs\(T,CSt\);if\(dr\.length\)drUp=drUpkeep\(dr,dem,L\);\}catch\(e\)\{dr=null;\}/);
  assert.match(code, /used\.push\(\['Joint military training',-E\.drUp\[r\]\[i\]\]\)/);
});

test('it binds like a non-aggression pact, and whoever breaks it fights the other side 10% the weaker', () => {
  assert.match(code, /function tyPeace\(a,b\)\{return tyOf\(a,b,'nap'\)\|\|tyOf\(a,b,'drill'\);\}/);
  assert.match(code, /sameAlliance\(myId\(\),id\)\|\|tyPeace\(myId\(\),id\)\)continue;/);
  assert.match(referee, /for \(const t of \[nap, drill\]\) if \(t\.exists && trLive\(t\.data\(\), now\) && !trVoid\(t\.data\(\), recs\)\) return \{ ok: false, why: 'pact' \};/);
  assert.match(referee, /if \(DB\.by === d\) att \*= 1 \+ TR_FX\.drill\.edge; else if \(DB\.by === uid\) def \*= 1 \+ TR_FX\.drill\.edge;/);
  assert.match(code, /BATTLE_MODS\.push\(\(T,cell,ai,bi\)=>\{\n  const A=T\.list\[ai\],B=T\.list\[bi\],D=drBroken\(A\.id,B\.id,Date\.now\(\)\);/);
  /* the treaty achievements written for the first three kinds keep to them */
  assert.match(code, /const TY_ACH=\['nap','trade','research'\],TY_ALL=TY_ACH\.reduce/);
});

test('eight edicts for a nation that trains with another, its partner the neighbour, nudging the training for a week', () => {
  const a = code.indexOf('const DRL_ISSUES=['), b = code.indexOf('\n];\nfor(const is of DRL_ISSUES)', a);
  assert.ok(a > code.indexOf('/* ───────── boot ───────── */') && b > a, 'beside the rest of the training, after the last edicts');
  const L = vm.runInNewContext('(' + code.slice(a + 'const DRL_ISSUES='.length, b + 2) + ')', {});
  assert.equal(L.length, 8);
  assert.equal(new Set(L.map(x => x.id)).size, 8); assert.equal(new Set(L.map(x => x.t)).size, 8);
  let cab = 0, opts = 0;
  for (const is of L) {
    assert.match(is.id, /^drl-[a-z-]+$/);
    assert.equal(html.split(`id:'${is.id}'`).length, 2, is.id + ' once');
    assert.equal(is.dr, 1); assert.equal(typeof is.req, 'function'); assert.match(String(is.req), /drAtWork\(\)/);
    assert.match(is.q, /\{NB\}/, is.id + ' names the partner');
    assert.equal(is.o.length, 3);
    for (const o of is.o) {
      opts++; if (/\{(FOR|DEF|FIN|INT|WRK|HEA|CUL)\}/.test(o.t)) cab++;
      for (const [k, v] of Object.entries(o.e)) { assert.ok(STAT_KEYS.includes(k) || k === 'nb', is.id + ' ' + k); assert.ok(Number.isInteger(v) && v !== 0 && Math.abs(v) <= 5, is.id + ' ' + k); }
      if ('dx' in o) assert.ok([-0.02, -0.01, 0.01, 0.02].includes(o.dx), is.id + ' dx');
      assert.doesNotMatch(o.t + o.fx + is.q + is.t, /['"]/, is.id + ' typographic quotes');
    }
  }
  assert.ok(cab / opts <= 0.2, 'cabinet voices ' + cab + ' of ' + opts);
  assert.ok(L.some(is => is.o.some(o => o.dx > 0)) && L.some(is => is.o.some(o => o.dx < 0)));
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'DRL_ISSUES'/);
  /* the partner is the edict's neighbour, and an option's dx sets n.drx for the week */
  assert.match(code, /if\(is&&is\.dr&&!e\.ch\)\{const P=drPartners\(\);/);
  assert.match(code, /n\.drx=\{v:clamp\(opt\.dx,-DRX_MAX,DRX_MAX\),u:now\+DRX_MS\}/);
});
