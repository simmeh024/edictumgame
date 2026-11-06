// The tally behind building and city achievements (game/edictum.html, tallyScan) counts what is new since the last
// save. A move or a wake from dormancy empties the cities and puts the capital back when the nation settles (n.mvCap),
// so the capital and its buildings were counted a second time.
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
function tally() {
  const ctx = vm.createContext({ TALLY_MAX: 500, TALLY_TARGET_KINDS: new Set(), ISSUE_BY_ID: {}, SITES: {}, BUILDINGS: { university: {}, library: { w: 1 } },
    milesReached: () => [], MILESTONES: [], STAT_KEYS: ['econ'], fmtPopShort: String, myId: () => 'me', gamesResults: () => null, medalsIn: () => ({ list: [] }), edStart: () => 0 });
  vm.runInContext(fn('tallyScan') + '\nthis.scan=tallyScan;', ctx);
  return ctx;
}
const H = 3600e3;
const capital = (t0, extra = []) => ({ id: 'c1', nm: 'Port Alder', t: t0, b: [{ k: 'university', s: 0, d: t0 + H }, { k: 'library', s: 1, d: t0 + 2 * H }, ...extra] });

test('settling with the carried capital counts neither it nor its buildings again', () => {
  const now = Date.now(), t0 = now - 30 * 24 * H, moved = now - H;
  const tly = { build: 2, 'build:university': 1, 'build:library': 1, wonder: 1, cities: 1 };
  /* the record after the move: no cities, the capital kept aside */
  const old = { name: 'Moverland', updatedAt: moved, cities: [], mvCap: capital(t0), log: [], tly: { ...tly }, tlf: {}, tlx: {}, s: {} };
  /* settling: the capital is back */
  const n = { name: 'Moverland', updatedAt: now, cities: [{ ...capital(t0), c: 42 }], log: [], tly: { ...tly }, tlf: {}, tlx: {}, s: {} };
  tally().scan(n, old, now);
  assert.equal(n.tly.build, 2, 'no building counted again');
  assert.equal(n.tly.wonder, 1);
  assert.equal(n.tly.cities, 1, 'nor the city');
});

test('a building finished since the move still counts', () => {
  const now = Date.now(), t0 = now - 30 * 24 * H, moved = now - 2 * H;
  const old = { name: 'Moverland', updatedAt: moved, cities: [], mvCap: capital(t0, [{ k: 'university', s: 2, d: now - H }]), log: [], tly: { build: 2, cities: 1 }, tlf: {}, tlx: {}, s: {} };
  const n = { name: 'Moverland', updatedAt: now, cities: [{ ...capital(t0, [{ k: 'university', s: 2, d: now - H }]), c: 42 }], log: [], tly: { build: 2, cities: 1 }, tlf: {}, tlx: {}, s: {} };
  tally().scan(n, old, now);
  assert.equal(n.tly.build, 3, 'the one finished after the move is new');
});
