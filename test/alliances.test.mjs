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
  assert.equal(G.places, R.AL_PLACES);
  assert.deepEqual(Object.keys(constOf('AL_TYPES')), R.AL_TYPES);
  assert.deepEqual(Object.keys(constOf('AL_ACCESS')), R.AL_ACCESS);
});

test('founding an alliance opens at 7.5 million people, in the game and on the server', () => {
  assert.equal(R.AL_FOUND_POP, 7.5);
  const fa = vm.runInNewContext('(' + html.match(/const FEATURE_AT=(\{[^}]*\})/)[1] + ')');
  assert.equal(fa.alli, R.AL_FOUND_POP);
  /* no milestone claims it any more: the 10 million one still opens war, and no milestone moved */
  assert.match(html, /\{p:10,c:3,b:\['oilwell','fortress'\],war:1\},/);
  assert.doesNotMatch(html, /alli:1\}/);
  assert.match(html, /function featureAt\(f\)\{if\(FEATURE_AT\[f\]\)return FEATURE_AT\[f\];/);
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
  /* fifteen nations from the start, players and computer nations alike */
  assert.equal(R.alPlaces(0, {}), 15);
  assert.equal(R.alPlaces(7500, { hall: 3 }), 39);
});

test('the three later buildings: Beacon Towers, the Alliance Academy and the Hall of Chronicles', () => {
  for (const k of ['beacon', 'academy', 'chronicle']) {
    assert.ok(R.AL_PROJECTS[k], k + ' is a project');
    assert.equal(R.AL_PROJECTS[k].max, 3, k);
    assert.ok(R.AL_PROJECTS[k].lv[0] >= 2, k + ' waits for a grown alliance');
  }
  /* every project has a name and a line in the game */
  const PJ = vm.runInNewContext('(' + html.slice(html.indexOf('{', html.indexOf('const AL_PJ=')), html.indexOf('};', html.indexOf('const AL_PJ=')) + 1) + ')');
  assert.deepEqual(Object.keys(PJ).sort(), Object.keys(R.AL_PROJECTS).sort());
  for (const [k, v] of Object.entries(PJ)) assert.ok(v[0] && v[1], k);
  /* what each does for a member, through the game's alFx */
  const at = html.indexOf('let alFxMemo='), end = html.indexOf('\n}\n', html.indexOf('function alFx(')) + 3;
  assert.ok(at > 0 && end > at, 'alFx is found');
  const fxOf = (ty, pj) => {
    const D = { ty, pj }, A = { srv: true, members: ['me'], doc: D };
    const ctx = vm.createContext({ AL_RULES: G, AL: { rev: 0 }, polMemo: { k: Math.random() }, allianceOf: () => A, num0: v => Number(v) || 0, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
    vm.runInContext(html.slice(at, end).replace(/^(const|let) /gm, 'var '), ctx);
    return ctx.alFx('me');
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const none = fxOf('culture', {}), b2 = fxOf('culture', { beacon: 2 }), a3 = fxOf('culture', { academy: 3 }), over = fxOf('culture', { beacon: 9, academy: 9 });
  assert.ok(near(b2.def - none.def, 0.08) && near(b2.defHelp - none.defHelp, 0.4), 'Beacon Towers: 4% and a fifth a level');
  assert.ok(near(a3.prosper - none.prosper, 0.045), 'the Academy: 1.5% prosperity a level');
  assert.ok(near(over.def - none.def, 0.12) && near(over.prosper - none.prosper, 0.045), 'never past the last level');
  assert.ok(near(fxOf('def', { beacon: 1 }).def, 0.14), 'on top of a defence pact');
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
