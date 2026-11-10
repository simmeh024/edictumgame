// Land credits for the top achievement tiers (game/edictum.html, ACH_TIER_LC): every Platinum, Prismatic or Obsidian
// achievement pays 10, 15 or 20 land credits on top of the ranks' 10, counted from the achievements on record so those
// earned before are paid at once, and the nation is told once (n.atl). Cut from the game's source and run here.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');

/* a few achievements of each tier */
const ACH_BY_ID = { b1: { t: 'b' }, s1: { t: 's' }, g1: { t: 'g' }, p1: { t: 'p' }, p2: { t: 'p' }, x1: { t: 'x' }, o1: { t: 'o' } };
const ctx = vm.createContext({ ACH_BY_ID, NORM_HOOKS: [], COMMIT_HOOKS: [] });
vm.runInContext(vars([line('const ACH_TIER_LC='), line('function achTierCredits('), line('function achEarnedIds('), line('function list('),
  cut('NORM_HOOKS.push((n,d)=>{if(d&&d.atl===1)n.atl=1;});', "\n\n/* the caches' achievements")].join('\n')), ctx);
const { achTierCredits, ACH_TIER_LC, COMMIT_HOOKS, NORM_HOOKS } = ctx;
const nation = ids => ({ name: 'Testia', ach: Object.fromEntries(ids.map(id => [id, 1])) });

test('Platinum pays 10, Prismatic 15, Obsidian 20; the lower tiers nothing of their own', () => {
  assert.deepEqual({ ...ACH_TIER_LC }, { p: 10, x: 15, o: 20 });
  assert.equal(achTierCredits(nation(['b1', 's1', 'g1'])), 0);
  assert.equal(achTierCredits(nation(['p1'])), 10);
  assert.equal(achTierCredits(nation(['p1', 'p2', 'x1', 'o1', 'b1'])), 10 + 10 + 15 + 20);
  assert.equal(achTierCredits(nation(['p1', 'gone'])), 10, 'an id the game no longer has counts nothing');
});

test('computer nations, records without achievements and nothing at all earn nothing', () => {
  assert.equal(achTierCredits({ ...nation(['o1']), npc: true }), 0);
  assert.equal(achTierCredits({ name: 'Bare' }), 0);
  assert.equal(achTierCredits(null), 0);
});

test('the back pay: told once, for what was earned before, with the count of each tier', () => {
  const hook = COMMIT_HOOKS.at(-1);
  const old = nation(['p1', 'p2', 'x1', 'g1']), n = { ...nation(['p1', 'p2', 'x1', 'g1']) };
  const out = hook(n, old, 0);
  assert.equal(n.atl, 1);
  assert.equal(out.length, 1); assert.equal(out[0].k, 'land');
  assert.match(out[0].m, /now pay 10, 15 and 20 land credits each\. Yours \(2 Platinum and 1 Prismatic\) bring 35 land credits\./);
  assert.equal(hook(n, old, 0).length, 0, 'not twice');
  const quiet = nation(['b1', 'g1']);
  assert.equal(hook(quiet, nation(['b1', 'g1']), 0).length, 0); assert.equal(quiet.atl, 1, 'nothing to pay: marked without a word');
  const fresh = nation([]);
  assert.equal(hook(fresh, null, 0).length, 0); assert.equal(fresh.atl, 1, 'a new nation is marked at its first save');
  assert.equal(hook({ ...nation(['o1']), npc: true }, nation(['o1']), 0).length, 0);
  // normalize keeps the mark
  const kept = {}; NORM_HOOKS[0](kept, { atl: 1 }); assert.equal(kept.atl, 1);
  const none = {}; NORM_HOOKS[0](none, { atl: 'yes' }); assert.equal(none.atl, undefined);
});

test('the credits count wherever land is reckoned, and the page says what they pay', () => {
  assert.match(line('function landEarned('), /\+achRankCredits\(n\)\+achTierCredits\(n\)\+/, 'land credits now');
  assert.match(line('function earnedAt('), /\+achRankCredits\(n\)\+achTierCredits\(n\)-/, 'land credits at a population (the admin land check)');
  assert.ok(src.includes("if(lc)txt+=got.length===1?` It pays ${lc} land credits.`"), 'the toast for a new achievement');
  assert.ok(src.includes("${ACH_TIER_LC[a.t]?` · +${ACH_TIER_LC[a.t]} land`:''}"), 'the achievement card');
  assert.ok(src.includes('every Platinum, Prismatic or Obsidian achievement ${ACH_TIER_LC.p}, ${ACH_TIER_LC.x} or ${ACH_TIER_LC.o} more.'), 'the Achievements page');
  const nx = shim.slice(shim.indexOf('var NX_KEYS = {}'), shim.indexOf('.forEach(function (k) { NX_KEYS[k] = 1; })'));
  assert.ok(nx.includes("'atl'"), 'n.atl is in the private half');
});
