// Alliances are kept by the server (functions/alliances.js), and the game draws and sums them from the same rules
// (functions/alliance-rules.js and AL_RULES in game/edictum.html): these checks keep the two copies in step, and the
// rules for alliances from before (kept in founders' records until they move over) in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as R from '../functions/alliance-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function constOf(name) {
  const at = html.indexOf('const ' + name + '=');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  /* through JSON, so its arrays and objects belong to this realm (deepEqual compares prototypes) */
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(html.indexOf('{', at), i + 1) + ')')));
}
const G = constOf('AL_RULES');

test('the game and the server share the levels, officers, projects and renown rules', () => {
  assert.deepEqual(G.levels, R.AL_LEVELS);
  assert.equal(G.officers, R.AL_OFFICERS);
  assert.deepEqual(G.projects, R.AL_PROJECTS);
  assert.deepEqual(G.xp, R.AL_XP);
  assert.deepEqual(Object.keys(constOf('AL_TYPES')), R.AL_TYPES);
  assert.deepEqual(Object.keys(constOf('AL_ACCESS')), R.AL_ACCESS);
});

test('levels and member places agree at every renown and Hall level', () => {
  const src = html.match(/const alLevel=xp=>\{[^\n]*?\};\nconst alPlaces=D=>[^\n]*?;\n/);
  assert.ok(src, 'alLevel and alPlaces are found');
  const ctx = vm.createContext({ AL_RULES: G, num0: v => Number(v) || 0 });
  vm.runInContext(src[0].replace(/const /g, 'var '), ctx);
  for (const xp of [0, 1, 99, 100, 249, 250, 899, 900, 5199, 7500, 99999])
    for (const hall of [0, 1, 2, 3, 7]) {
      assert.equal(ctx.alLevel(xp), R.alLevel(xp), 'level at ' + xp);
      assert.equal(ctx.alPlaces({ xp, pj: { hall } }), R.alPlaces(xp, { hall }), `places at ${xp} with a Hall of ${hall}`);
    }
  assert.equal(R.alLevel(7500), 10);
  assert.equal(R.alPlaces(0, {}), 6);
  assert.equal(R.alPlaces(7500, { hall: 3 }), 30);
});

test('each project can be built level by level, and asks for no more than the levels allow', () => {
  for (const [k, P] of Object.entries(R.AL_PROJECTS)) {
    assert.equal(P.lv.length, P.max, k);
    assert.equal(P.cost.length, P.max, k);
    assert.ok(P.lv.every((l, i) => l >= 1 && l <= R.AL_LEVELS.length && (!i || l >= P.lv[i - 1])), k + ' needs rising levels');
    for (const c of P.cost) assert.ok(Object.keys(c).every(r => R.AL_RES.includes(r)) && Object.values(c).every(v => v > 0), k);
  }
});

test('alliances from before still count until they move to the server', () => {
  /* politics(): a member of a founder's alliance is one whose invitation came after it last left */
  assert.match(html, /if\(A\.inv\.some\(e=>e\.id===id&&e\.t>\(d\.alLeft\|\|0\)\)\)A\.members\.push\(id\)/);
  /* and one the server has moved (same id as its founder) is never counted twice */
  assert.match(html, /const moved=id=>al\.has\(id\)&&al\.get\(id\)\.srv;/);
  assert.match(html, /if\(!A\|\|A\.npc\|\|A\.srv\)continue;/);
});
