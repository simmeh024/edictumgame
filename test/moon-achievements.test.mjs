// Moon achievements (game/edictum.html, the space honours): six on the road to the Moon with Mission Control and fifteen
// for the colony itself, from the first nation on the Moon to twelve lunar days there. Each goal runs here against
// small stand-ins for the space engine. Run with: node --test test/moon-achievements.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function cut(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j); }
const DAY = 864e5, SP_MIN = 60000, SP_EP = Date.UTC(2026, 0, 1) - 1048576 * SP_MIN;

/* the real building list, terrain names and tile cap */
const SP = vm.createContext({});
vm.runInContext(cut('const SP_BLDS=', '\nconst SP_CAP=') + '\nthis.SP_BLDS=SP_BLDS;', SP);
const SP_MOON_T = vm.runInNewContext(cut('const SP_MOON_T=', ';\n').slice('const SP_MOON_T='.length));
const SP_TILES = +/const SP_CH=32,SP_TILES=(\d+),/.exec(html)[1];

/* the honours block, run with stand-ins; every achDef is caught by id */
const A = {};
const ctx = vm.createContext({
  A, DAY, SP_MIN, SP_EP, SP_TILES, SP_MOON_T, SP_BLDS: SP.SP_BLDS, SPB: { moon: { id: 'moon' }, mars: { id: 'mars' } }, Math, Set, Object,
  achDef: (c, id, t, n, d, g, f, o) => { A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
  achYes: v => v ? 1 : 0, achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), myId: () => 'me',
  spColony: (B, o) => o ? { blds: o.blds || [] } : null, spWorld: () => ctx.W, spT: (B, c) => c % 8, spNbrs: (B, C) => C.nb || [],
  mcOf: n => n.mc || null, mcImg: n => !!n.mc.img, mcDone: (n, k) => !!(n.mc.done || {})[k], mcReveal: n => n.mc.L || new Uint8Array(160),
  mcPrepFlown: (n, t) => !!n.mc.prep && n.mc.prep <= t
});
vm.runInContext(cut('const spMileHit=', "achDef('exp','sp-mars'"), ctx);
const NEW = ['mc-agency', 'mc-photo', 'mc-rover', 'mc-chart', 'mc-letters', 'mc-prep', 'sp-moon-first', 'sp-moon1', 'sp-moon10', 'sp-moon-t50', 'sp-moon-t300',
  'sp-moon-ground', 'sp-moon-ice', 'sp-moon-sun', 'sp-moon-he8', 'sp-moon-obs', 'sp-moon-md', 'sp-moon-port', 'sp-moon-all', 'sp-moon-nb', 'sp-moon-year'];
const NOW = Date.UTC(2027, 5, 1);
const X = (n, o) => Object.assign({ n, id: 'me', me: true, npc: !!n.npc, now: NOW, m: {} }, o || {});
const val = (id, n, o) => +A[id].f(X(n, o)) || 0;
const met = (id, n, o) => val(id, n, o) >= A[id].g;

test('twenty-one new Moon achievements, all Exploration, with unique ids and names across the game', () => {
  for (const id of NEW) assert.ok(A[id], id);
  assert.equal(NEW.length, 21);
  for (const id of NEW) assert.equal(A[id].c, 'exp', id);
  /* every literal id once ('soc-hi-'+k and 'soc-lo-'+k are prefixes of ids made in a loop) */
  const ids = [...html.matchAll(/ach(?:Def|Parts)\('[a-z]+','([^']+)'/g)].map(m => m[1]).filter(id => !/-$/.test(id));
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'achievement ids are unique');
  const names = [...html.matchAll(/ach(?:Def|Parts)\('[a-z]+','[^']+','[a-z]','((?:[^'\\]|\\.)+)'/g)].map(m => m[1]);
  assert.equal(new Set(names).size, names.length, 'achievement names are unique: ' + names.filter((n, i) => names.indexOf(n) !== i));
  /* the tiers: mostly bronze to gold, one platinum for the first nation on the Moon (platinum pays land credits) */
  const tiers = NEW.map(id => A[id].t).join('');
  assert.equal(tiers.split('p').length - 1, 1);assert.equal(A['sp-moon-first'].t, 'p');
});

test('the goals match the game: fourteen letters, half the chart, every kind of ground and building, the tile cap', () => {
  assert.equal(A['mc-letters'].g, +/const MC_N=(\d+),/.exec(html)[1]);
  const [, sx, sy] = /const MC_SX=(\d+),MC_SY=(\d+),/.exec(html);assert.equal(A['mc-chart'].g * 2, sx * sy);
  assert.equal(A['sp-moon-ground'].g, 8);assert.equal(SP_MOON_T.length, 8);
  assert.equal(A['sp-moon-all'].g, Object.keys(SP.SP_BLDS.moon).length);assert.equal(A['sp-moon-he8'].g, SP.SP_BLDS.moon.he.max);
  assert.equal(A['sp-moon-t300'].g, SP_TILES);assert.match(A['sp-moon-t300'].d, /Hold 300 tiles/);
  /* the polar-uplands Solar Array: terrain 7 is the uplands */
  assert.equal(SP_MOON_T[7], 'Polar uplands');assert.equal(SP_MOON_T[6], 'Polar ice');
});

test('Mission Control: the agency, the first picture, the rover, the chart, the letters', () => {
  assert.equal(val('mc-agency', {}), 0);assert.equal(val('mc-agency', { mc: { a: null } }), 0);assert.ok(met('mc-agency', { mc: { a: { nm: 'Lamp' } } }));
  assert.ok(!met('mc-photo', { mc: {} }));assert.ok(met('mc-photo', { mc: { img: 1 } }));
  assert.ok(!met('mc-rover', { mc: { done: { polar: 1 } } }));assert.ok(met('mc-rover', { mc: { done: { rover: 1 } } }));
  const L = new Uint8Array(160);L.fill(1);L.fill(2, 0, 79);assert.equal(val('mc-chart', { mc: { L } }), 79);L[100] = 2;assert.ok(met('mc-chart', { mc: { L } }));
  assert.equal(val('mc-letters', { mc: { c: Array(13).fill({ o: 0 }) } }), 13);assert.ok(met('mc-letters', { mc: { c: Array(14).fill({ o: -1 }) } }));
  /* nobody earns the road for a nation the game runs */
  assert.equal(val('mc-agency', { npc: true, mc: { a: { nm: 'x' } } }), 0);
});

test('Well Prepared: only a crew that flew the launch preparation before it landed', () => {
  const t = NOW - 10 * DAY;
  assert.ok(!met('mc-prep', { mc: { prep: t - DAY } }), 'no landing yet');
  assert.ok(met('mc-prep', { mc: { prep: t - DAY }, sp: { moon: { t } } }));
  assert.ok(!met('mc-prep', { mc: { prep: t + DAY }, sp: { moon: { t } } }), 'flown after the landing');
  assert.ok(!met('mc-prep', { mc: {}, sp: { moon: { t } } }), 'never flown (credited is not flown)');
});

/* a world of colonies on the shared Moon */
const col = (id, land, o) => Object.assign({ id, land, ok: true, held: [1], nb: [] }, o || {});
test('First on the Moon: the earliest landing by the minute, ties to the lower nation id, failed landings ignored', () => {
  const me = col('me', NOW - 5 * DAY), n = { sp: { moon: { t: me.land } } };
  ctx.W = { cols: [me], byId: { me } };assert.ok(met('sp-moon-first', n), 'alone');
  ctx.W = { cols: [col('aa', me.land - 3 * 60000), me], byId: { me } };assert.ok(!met('sp-moon-first', n), 'someone landed three minutes earlier');
  ctx.W = { cols: [col('aa', me.land - 3 * 60000, { ok: false }), me], byId: { me } };assert.ok(met('sp-moon-first', n), 'their landing failed');
  ctx.W = { cols: [col('aa', me.land + 1000), me], byId: { me } };assert.ok(!met('sp-moon-first', n), 'same minute, lower id goes first');
  ctx.W = { cols: [me, col('zz', me.land)], byId: { me } };assert.ok(met('sp-moon-first', n), 'same minute, higher id goes second');
  ctx.W = { cols: [me], byId: { me: Object.assign({}, me, { ok: false }) } };assert.ok(!met('sp-moon-first', n), 'my own landing failed');
  /* another nation's record is looked up by its id */
  const them = col('them', NOW - 9 * DAY);ctx.W = { cols: [them, me], byId: { me, them } };
  assert.ok(met('sp-moon-first', { sp: { moon: { t: them.land } } }, { id: 'them', me: false }));
});

test('people and land: a million, ten million, 50 and 300 tiles, eight kinds of ground, three neighbours', () => {
  assert.ok(met('sp-moon1', { sp: { moon: { ml: [NOW, 0, 0] } } }));assert.ok(!met('sp-moon10', { sp: { moon: { ml: [NOW, 0, 0] } } }));
  assert.ok(met('sp-moon10', { sp: { moon: { ml: [NOW, NOW, 0] } } }));
  const n = { sp: { moon: { t: NOW - DAY } } }, me = col('me', NOW - DAY, { held: [...Array(49).keys()] });ctx.W = { cols: [me], byId: { me } };
  assert.equal(val('sp-moon-t50', n), 49);assert.equal(val('sp-moon-ground', n), 8, 'stand-in terrain: tile % 8');
  me.held = [...Array(300).keys()];assert.ok(met('sp-moon-t50', n));assert.ok(met('sp-moon-t300', n));
  me.held = [0, 8, 16, 3, 5];assert.equal(val('sp-moon-ground', n), 3);
  me.nb = [{}, {}];assert.ok(!met('sp-moon-nb', n));me.nb.push({});assert.ok(met('sp-moon-nb', n));
  assert.equal(val('sp-moon-t50', {}), 0, 'no colony, no tiles');
});

test('buildings count once they are finished, and the Solar Array only on the polar uplands', () => {
  const b = (k, c, d) => ({ k, c, d: d == null ? NOW - DAY : d }), n = blds => ({ sp: { moon: { t: NOW - 30 * DAY, blds } } });
  assert.ok(!met('sp-moon-ice', n([b('im', 6, NOW + DAY)])), 'still being built');assert.ok(met('sp-moon-ice', n([b('im', 6)])));
  assert.ok(!met('sp-moon-sun', n([b('sa', 1)])), 'a Solar Array on a mare');assert.ok(met('sp-moon-sun', n([b('sa', 7)])), 'on the polar uplands (terrain 7)');
  assert.equal(val('sp-moon-he8', n([...Array(7)].map((_, i) => b('he', 1 + i * 8)))), 7);assert.ok(met('sp-moon-he8', n([...Array(8)].map((_, i) => b('he', 1 + i * 8)))));
  assert.ok(met('sp-moon-obs', n([b('ob', 0)])));assert.ok(met('sp-moon-md', n([b('md', 0)])));assert.ok(met('sp-moon-port', n([b('sp', 0)])));
  const all = Object.keys(SP.SP_BLDS.moon);assert.equal(val('sp-moon-all', n(all.slice(1).map(k => b(k, 0)))), all.length - 1);assert.ok(met('sp-moon-all', n(all.map(k => b(k, 0)))));
});

test('twelve lunar days on the Moon, nearly a year at home', () => {
  const at = d => ({ sp: { moon: { t: NOW - d * DAY } } });
  assert.equal(val('sp-moon-year', at(29)), 0);assert.equal(val('sp-moon-year', at(30)), 1);
  assert.ok(!met('sp-moon-year', at(354)));assert.ok(met('sp-moon-year', at(355)));assert.equal(val('sp-moon-year', at(900)), 12);
});

test('the belt arrival achievement fits the 90-day voyage', () => {
  assert.match(html, /achDef\('exp','bt-arrive','g','Three Months Out'/);assert.match(html, /BT_VOY_D=90,/);
});
