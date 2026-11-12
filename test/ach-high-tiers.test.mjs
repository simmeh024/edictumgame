// Achievements, the high tiers (game/edictum.html, 12 November 2026): 20 Platinum, 10 Prismatic and 2 Obsidian, long
// hauls on counts the game already keeps, each a step above the highest achievement that counted the same thing.
// Each goal runs here against stand-ins that hand back the count it should read.
//   node --test test/ach-high-tiers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const START = '/* ───────── achievements, the high tiers:';
const at = html.indexOf(START), end = html.indexOf('\n\n', at);
assert.ok(at > 0 && end > at, 'the section');
const BLOCK = html.slice(at, end);
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const LC = Function('return ' + html.match(/const ACH_TIER_LC=(\{[^}]+\});/)[1])();

/* every stand-in reads the count from the nation it is handed, under the key the real helper keeps it by */
const A = {};
const ctx = vm.createContext({
  achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
  aT: (x, k) => (x.n.tly && x.n.tly[k]) || 0, aTP: (x, k) => ((x.n.tly && x.n.tly[k]) || 0) + ((x.pend && x.pend[k]) || 0),
  aCbPosts: x => x.n.cbPosts || 0, alDays: x => x.n.alDays || 0, aMw: x => x.n.mw || null, aFirst: x => x.n.first || 0,
  aGolds: x => x.n.golds || 0, ppStats: n => ({ dd: n.stampDays || 0 }), flcPlaces: x => x.n.podiums || [], aClaims: x => x.n.claims || 0,
  ddrOf: n => n.rare || 0, Math, OBS_HINT: 'the hint'
});
vm.runInContext(BLOCK, ctx);
const val = (id, n, o) => +A[id].f(Object.assign({ n, me: true, now: 0 }, o || {})) || 0;

/* each new goal: the nation that has reached it, and the highest achievement that counted the same thing before */
const CASES = {
  'dip-ch5000': [g => ({ tly: { rch: g } }), 'dip-ch1000', 1000],
  'dip-ch20000': [g => ({ tly: { rch: g } }), 'dip-ch1000', 1000],
  'dip-cbp500': [g => ({ cbPosts: g }), 'dip-cbp100', 100],
  'dip-cbp1500': [g => ({ cbPosts: g }), 'dip-cbp100', 100],
  'dip-old365': [g => ({ alDays: g }), 'dip-old', 100],
  'asm-vote120': [g => ({ tly: { 'asm:vote': g } }), 'asm-vote50', 50],
  'asm-vote200': [g => ({ tly: { 'asm:vote': g } }), 'asm-vote50', 50],
  'asm-mine15': [g => ({ tly: { 'asm:mine': g } }), 'asm-mine5', 5],
  'mus-tk250': [g => ({ tly: { 'mw:takings': g } }), 'mus-tk100', 100],
  'mus-yr100': [g => ({ mw: { yr: g } }), 'mus-yr30', 30],
  'mus-yr365': [g => ({ mw: { yr: g } }), 'mus-yr30', 30],
  'obs-mus': [g => ({ mw: { yr: g } }), 'mus-yr30', 30],
  'exp-100': [g => ({ tly: { exp: g } }), 'exp-25', 25],
  'exp-first25': [g => ({ first: g }), 'exp-first10', 10],
  'eco-trade100': [g => ({ tly: { 'log:trade': g } }), 'eco-trade25', 25],
  'eco-trade300': [g => ({ tly: { 'log:trade': g } }), 'eco-trade25', 25],
  'spy-300': [g => ({ tly: { spy: g } }), 'spy-75', 75],
  'cov-200': [g => ({ tly: { cov: g } }), 'cov-40', 40],
  'cov-600': [g => ({ tly: { cov: g } }), 'cov-40', 40],
  'obs-cov': [g => ({ tly: { cov: g } }), 'cov-40', 40],
  'games-g40': [g => ({ golds: g }), 'games-g10', 10],
  'games-g100': [g => ({ golds: g }), 'games-g10', 10],
  'flk-1000': [g => ({ tly: { flk: g } }), 'flk-100', 100],
  'flk-5000': [g => ({ tly: { flk: g } }), 'flk-100', 100],
  'pass-days100': [g => ({ stampDays: g }), 'pass-days30', 30],
  'fc-judge300': [g => ({ tly: { fcj: g } }), 'fc-judge100', 100],
  'fc-podium10': [g => ({ podiums: Array.from({ length: g }, (_, i) => '2027-' + i + '/2') }), 'fc-podium3', 3],
  'brf-250': [g => ({ tly: { brf: g } }), 'brf-60', 60],
  'brf-500': [g => ({ tly: { brf: g } }), 'brf-60', 60],
  'land-claim150': [g => ({ claims: g }), 'land-claim40', 40],
  'desk-rare200': [g => ({ rare: g }), 'desk-rare50', 50],
  'eco-svc600': [g => ({ tly: { svc: g } }), 'eco-svc200', 200]
};

test('twenty Platinum, ten Prismatic and two Obsidian: 5,000 prestige and 390 land credits', () => {
  assert.deepEqual(Object.keys(A).sort(), Object.keys(CASES).sort());
  const k = t => Object.values(A).filter(a => a.t === t).length;
  assert.deepEqual([k('p'), k('x'), k('o')], [20, 10, 2]);
  assert.equal(Object.values(A).reduce((s, a) => s + TIER[a.t], 0), 5000);
  assert.equal(Object.values(A).reduce((s, a) => s + LC[a.t], 0), 20 * 10 + 10 * 15 + 2 * 20);
  for (const a of Object.values(A)) assert.ok(a.d.length > 15 && /\.$/.test(a.d) && a.n.length > 3, a.id);
  /* every Obsidian is a secret until it is earned (OBS_HINT), these too; the rest are not */
  for (const a of Object.values(A)) assert.equal(a.o.sec, a.t === 'o' ? 'the hint' : undefined, a.id);
  /* the categories the Achievements page already has */
  assert.deepEqual([...new Set(Object.values(A).map(a => a.c))].sort(), ['dip', 'eco', 'exp', 'flag', 'found', 'games', 'gov', 'land', 'mus', 'pass', 'soc', 'spy']);
});

test('each id is new: defined once in the whole game', () => {
  for (const id of Object.keys(A)) {
    const n = html.split(`'${id}','`).length - 1;
    assert.equal(n, 1, id + ' appears ' + n + ' times as an achievement id');
  }
});

test('each goal counts what its lower achievement counts, and asks for more', () => {
  for (const [id, [nation, lower, lowerGoal]] of Object.entries(CASES)) {
    const a = A[id];
    /* the lower one is in the game with that goal */
    assert.ok(html.includes(`'${lower}','`), lower);
    /* in a table row ['id','g','Name',goal,…] or a call (…,'id','g','Name','Description',goal,…) */
    const str = `'(?:[^'\\\\]|\\\\.)*'`;
    assert.match(html, new RegExp(`'${lower}','[bsgp]',${str},(?:${str},)?${lowerGoal}[,)\\]]`), lower + ' asks for ' + lowerGoal);
    assert.ok(a.g > lowerGoal, `${id}: ${a.g} above ${lower}'s ${lowerGoal}`);
    assert.equal(val(id, nation(a.g)), a.g, id + ' reads its count');
    assert.ok(val(id, nation(a.g - 1)) < a.g, id + ' is not met one short');
    assert.equal(val(id, {}), 0, id + ' is nothing for a new nation');
  }
  /* within a measure the tiers climb with the goal: Platinum, then Prismatic, then Obsidian */
  const by = {};
  for (const [id, [, lower]] of Object.entries(CASES)) (by[lower] = by[lower] || []).push(A[id]);
  for (const list of Object.values(by)) {
    list.sort((a, b) => a.g - b.g);
    for (let i = 1; i < list.length; i++) assert.ok(TIER[list[i].t] > TIER[list[i - 1].t], list.map(a => a.id + ':' + a.t).join(' '));
  }
});

test('chat lines count what is still waiting to be saved, as the round-four ones do', () => {
  assert.equal(val('dip-ch5000', { tly: { rch: 4990 } }, { pend: { rch: 10 } }), 5000);
  assert.equal(A['dip-old365'].o.mp, 1, 'an alliance needs other players');
});

test('the section stands after every helper it reads, so none is read before it exists', () => {
  for (const def of ['const aTP=', 'const aCbPosts=', 'const aMw=', 'const aFirst=', 'function aGolds(', 'function ppStats(', 'const flcPlaces=', 'const aClaims=', 'const ddrOf=', 'const alDays=']) {
    const i = html.indexOf(def);
    assert.ok(i > 0 && i < at, def);
  }
});

test('the paces: Obsidian is more than a year of the most a nation can do', () => {
  /* a covert operation at most every CV_GAP */
  const gapH = +html.match(/CV_GAP=(\d+)\*3600e3/)[1];
  assert.ok(A['obs-cov'].g * gapH / 24 > 365, 'covert operations');
  /* the museums' lead is a day at a time, and the Obsidian is two years of it, as Two Years at the Desk is */
  assert.equal(A['obs-mus'].g, 730);
  /* survey caches: SVC_N a day */
  const svcN = +html.match(/const SVC_N=(\d+)/)[1];
  assert.ok(A['eco-svc600'].g / svcN >= 300, 'survey caches');
  /* expeditions: more than a region's sites (SITE_MAX), yet a failed one may be sent again and lost places add more */
  assert.ok(A['exp-100'].g > +html.match(/SITE_MAX=(\d+)/)[1]);
  assert.match(html, /if\(discoveries\(\)\.has\(si\)&&discoveries\(\)\.get\(si\)\.id===myId\(\)\)why='You discovered this yourself\.';/);
});
