// Survey caches (game/edictum.html, "survey caches"): every day two caches of what a nation's stores are shortest of
// turn up on its own land, to dig up from the map. The pure part (which resources, which hexes, how much) is cut from
// the game's source and run here; the rest checks the wiring the page depends on.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const ctx = vm.createContext({});
vm.runInContext(vars([line('function hash('), line('function rng('), line('const GB_VAL='), line('const SVC_N='), cut('/* ── survey caches: pure ──', '/* ── survey caches: game ──')].join('\n')), ctx);
const { svcShort, svcAmt, svcRoll, SVC_N, SVC_V, SVC_NEED, GB_VAL } = ctx;
const plain = v => JSON.parse(JSON.stringify(v));

test('the shortest resource comes first: stock plus two days of gain, against a useful amount', () => {
  const st = { food: 400, timber: 400, iron: 10, oil: 0, goods: 300 }, rt = { food: 50, timber: 20, iron: 3, oil: 0.5, goods: 10 };
  assert.deepEqual(plain(svcShort(st, rt, SVC_NEED)), ['oil', 'iron', 'timber', 'food', 'goods'].sort((a, b) => (st[a] + 2 * rt[a]) / SVC_NEED[a] - (st[b] + 2 * rt[b]) / SVC_NEED[b]));
  assert.equal(svcShort(st, rt, SVC_NEED)[0], 'oil');
  // equal shortage: alphabetical, so every device agrees
  assert.deepEqual(plain(svcShort({}, {}, SVC_NEED)), Object.keys(SVC_NEED).sort());
  // nonsense in the stores counts as nothing
  assert.equal(svcShort({ food: NaN, timber: -5, iron: 999, oil: 999, goods: 999 }, {}, SVC_NEED)[0], 'food');
});

test('a cache is worth the same in the Bureau’s values whatever it holds', () => {
  const at = (r, u) => svcAmt(r, u, GB_VAL, SVC_V);
  assert.deepEqual([at('iron', 0), at('iron', 1)], [15, 25]);
  assert.deepEqual([at('oil', 0), at('oil', 1)], [15, 25]);
  assert.deepEqual([at('goods', 0), at('goods', 1)], [15, 25]);
  assert.deepEqual([at('food', 0), at('food', 1)], [45, 75]);
  assert.deepEqual([at('timber', 0), at('timber', 1)], [38, 63]);
  for (const r of Object.keys(SVC_NEED)) for (let u = 0; u <= 1; u += 0.1) {
    const v = at(r, u) * GB_VAL[r]; assert.ok(v >= SVC_V[0] - GB_VAL[r] && v <= SVC_V[1] + GB_VAL[r], `${r} at ${u}: worth ${v}`);
  }
});

/* a small piece of land: cells 0-9 hills (iron), 10-19 farmland (food), 20-21 an oil field, 30-31 by a city */
const yields = (r, c) => ({ iron: c < 10 ? 2 : 0, food: c >= 10 && c < 20 ? 2.4 : 0, oil: c === 20 || c === 21 ? 5 : 0, timber: 0.5 }[r] || 0);
const cells = [...Array(32).keys()];
const roll = (o = {}) => plain(svcRoll({ seed: 'abc', day: 20400, cells, yields, near: c => c >= 30, order: ['iron', 'food'], val: GB_VAL, V: SVC_V, n: SVC_N, ...o }));

test('two caches a day, on different hexes, each on land that yields its resource', () => {
  const R = roll();
  assert.equal(R.length, SVC_N);
  assert.notEqual(R[0][0], R[1][0]);
  assert.equal(R[0][1], 'iron'); assert.ok(R[0][0] < 10, 'iron in the hills');
  assert.equal(R[1][1], 'food'); assert.ok(R[1][0] >= 10 && R[1][0] < 20, 'food on the farmland');
  assert.ok(R.every(x => x[3] === 0), 'nothing dug yet');
  const oil = roll({ order: ['oil', 'goods'] });
  assert.ok(oil[0][0] === 20 || oil[0][0] === 21, 'oil on the oil field');
  assert.ok(oil[1][0] >= 30, 'goods beside a city');
});

test('the same day gives the same caches; another day or nation, others', () => {
  assert.deepEqual(roll(), roll());
  const days = new Set(), seeds = new Set();
  for (let d = 0; d < 20; d++) days.add(JSON.stringify(roll({ day: 20400 + d })));
  for (let s = 0; s < 20; s++) seeds.add(JSON.stringify(roll({ seed: 'n' + s })));
  assert.ok(days.size > 10 && seeds.size > 10, `${days.size} different days, ${seeds.size} different nations`);
});

test('without land that yields it, a cache lies anywhere on the nation’s land; without land, there is none', () => {
  const R = roll({ yields: () => 0, near: () => false, order: ['oil', 'goods'] });
  assert.equal(R.length, 2); assert.ok(R.every(x => cells.includes(x[0])));
  assert.deepEqual(roll({ cells: [] }), []);
  assert.equal(roll({ cells: [7] }).length, 1, 'one hex holds one cache');
});

test('the page is wired up: saved privately, kept by normalize, fixed at the first save, drawn and shown', () => {
  const nx = shim.slice(shim.indexOf('var NX_KEYS = {}'), shim.indexOf('.forEach(function (k) { NX_KEYS[k] = 1; })'));
  assert.ok(nx.length > 0 && nx.includes("'svc'"), 'n.svc is in the private half');
  assert.match(src, /NORM_HOOKS\.push\(\(n,d\)=>\{const v=d&&d\.svc;/, 'normalize keeps n.svc');
  assert.match(src, /COMMIT_HOOKS\.push\(\(n,old,now\)=>\{try\{if\(n&&!n\.npc&&n\.name&&!\(n\.svc&&n\.svc\.d===svcDayOf\(now\)\)\)/, 'the first save of the day fixes the caches');
  assert.ok(src.includes("if(kind==='main'&&!P)svcDraw(g,scr,off,col,s);"), 'drawn on the main map, not on posters');
  assert.ok(src.includes('return headEl+svcHexHTML(cell)+c3Strip('), 'the hex panel offers the dig');
  assert.ok(src.includes('${svcBoxHTML(n)}'), 'the territory panel lists the day’s caches');
  assert.ok(src.includes("SVC:()=>({SVC,SVC_N,"), 'the test probe has SVC');
});

test('Help states the amounts the rules give', () => {
  const help = cut("HELP_EXT.push({k:'svc'", '`});');
  const at = (r, u) => svcAmt(r, u, GB_VAL, SVC_V);
  assert.ok(help.includes(`${at('iron', 0)} to ${at('iron', 1)} iron, oil or goods`));
  assert.ok(help.includes(`${at('food', 0)} to ${at('food', 1)} food`));
  assert.ok(help.includes(`${at('timber', 0)} to ${at('timber', 1)} timber`));
  assert.ok(help.includes('${SVC_N} caches'));
});
