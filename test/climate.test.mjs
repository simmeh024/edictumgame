// The climate of a cell (game/edictum.html, climateOf): colder away from the equator, north or south. South of the
// equator it once grew hotter the further south (49 °C at 33° S), which also made Terra's southern polar land steppe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
/* one cell per row, each row at the latitude given: plain inland land */
function climate(lats) {
  const ctx = vm.createContext({ MAP: { COLS: 1, coast: lats.map(() => 4), T: lats.map(() => 2) }, regLat: r => lats[r], hash: () => 0, cellKey: c => String(c) });
  vm.runInContext(fn('climateOf') + '\nthis.at=climateOf;', ctx);
  return lats.map((_, i) => ctx.at(i));
}

test('as warm at 33° S as at 33° N, and never hotter towards the pole', () => {
  const [n, s] = climate([33, -33]);
  assert.equal(s.temp, n.temp);
  assert.ok(s.temp < 26, 'a temperate figure, not ' + s.temp + ' °C');
});

test('colder all the way from the equator to the south pole', () => {
  const lats = [0, -10, -20, -33, -45, -56, -70, -80], C = climate(lats);
  for (let i = 1; i < C.length; i++) assert.ok(C[i].temp < C[i - 1].temp, `${lats[i]}° is colder than ${lats[i - 1]}°`);
  assert.ok(C[5].temp < 18, 'Terra’s southern edge (56° S) is too cool for dry steppe: ' + C[5].temp);
  assert.equal(C.at(-1).kind, 'Subarctic', 'the far south is subarctic');
});

test('every copy of the latitude rule uses its size', () => {
  assert.doesNotMatch(html, /\(lat-22\)\*0\.42/, 'no signed copy is left (water, weather, sea ice)');
});
