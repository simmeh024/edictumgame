// What nations do (functions/stats-acts.js), for the Statistics page's Activity and Nations tabs, on hand-made records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actions, styleOf, rowActs, actSummary, actDay, nationDetail, STYLES, ACT, DAY } from '../functions/stats-acts.js';
import { nationRow, summarize, snapshot } from '../functions/stats.js';

const NOW = Date.parse('2026-11-18T15:00:00Z'), H = 3600000;
const save = rec => ({ j: JSON.stringify(rec), reg: rec.reg, name: rec.name, pop: rec.pop, updatedAt: rec.updatedAt });
/* a builder: two buildings started this week (one still going up), an upgrade, a city, three hexes, an edict */
const builder = { name: 'Bricktown', reg: 'meridian', pop: 9, updatedAt: NOW - H, founded: NOW - 20 * DAY,
  answered: [{ id: 'tax', o: 1, t: NOW - 2 * H }, { id: 'zoo', o: -1, t: NOW - 3 * H }],
  cities: [{ id: 'c1', c: 5, nm: 'Capital', t: NOW - 20 * DAY, b: [{ k: 'farm', s: NOW - 2 * DAY, d: NOW - DAY, ug: 5 }, { k: 'factory', s: NOW - 3 * H, d: NOW + 5 * H },
    { k: 'sawmill', s: NOW - 10 * DAY, d: NOW - 9 * DAY, ug: 2, tr: 2, uu: { u: 3, s: NOW - 5 * H, d: NOW + H } }] },
    { id: 'c2', c: 9, nm: 'Second', t: NOW - 4 * DAY, b: [] }],
  claims: [{ c: 1, t: NOW - DAY }, { c: 2, t: NOW - 2 * DAY }, { c: 3, t: NOW - 40 * DAY }],
  log: [{ t: NOW - 30 * 60000, k: 'lost', a: 'w', b: 'Warhaven', fx: 'grassland' }, { t: NOW - 4 * DAY, k: 'city', a: 'Second', fx: 'hills' }],
  tly: { build: 12, claim: 30, iss: 140, dm: 4, 'build:farm': 3, 'dm:w': 4, 'war:w': 1, 'deal:x': 2, 'log:war': 1 }, tlf: { build: NOW - 19 * DAY, 'build:farm': NOW - 19 * DAY } };
/* a warlord: a war, two hexes taken, a spy mission, a peace long ago; an offer to an NPC is no trade action of theirs */
const warlord = { name: 'Warhaven', reg: 'meridian', pop: 14, updatedAt: NOW - 10 * 60000, founded: NOW - 30 * DAY,
  log: [{ t: NOW - 20 * H, k: 'conq', a: 'b', b: 'Bricktown', fx: 'grassland' }, { t: NOW - 30 * 60000, k: 'conq', a: 'b', b: 'Bricktown', fx: 'grassland' },
    { t: NOW - 2 * DAY, k: 'war', a: 'b', b: 'Bricktown' }, { t: NOW - 20 * DAY, k: 'peace', a: 'z', b: 'Zed' }, { t: NOW - DAY, k: 'trade', a: 'npc-tarrow', b: 'Tarrow' }],
  deals: [{ id: 'd1', w: 'npc-tarrow', t: NOW - DAY }, { id: 'd2', w: 'b', t: NOW - 12 * H }, { id: 'd3', w: 'q', t: NOW - 6 * H, a: 1 }],
  intel: [{ t: NOW - 5 * H, tg: 'b', k: 'ok' }], disc: [{ t: NOW - 3 * DAY, s: 4, o: 'found' }], asm: { h: [{ r: 1, c: 'x', f: NOW - DAY, mv: 1 }, { r: 2, c: 'y', f: NOW - DAY }] } };
/* a nation that has done nothing for a fortnight */
const quiet = { name: 'Sleepy', reg: 'frostmarch', pop: 5, updatedAt: NOW - 14 * DAY, founded: NOW - 15 * DAY, answered: [{ id: 'tax', o: 0, t: NOW - 14 * DAY }] };
const rows = () => [nationRow('b', save(builder), null, NOW), nationRow('w', save(warlord), null, NOW), nationRow('q', save(quiet), null, NOW)];
const world = () => ({ at: NOW, rows: rows(), accts: [], limited: false, devices: [], posts: {}, finery: [], days: [] });

test('every timed action a record keeps, by kind, oldest first, from the given time', () => {
  const b = actions(builder, NOW - 7 * DAY, NOW), k = b.map(a => a[1]);
  assert.deepEqual(k.filter(x => x === 'build').length, 2, 'the farm and the factory started this week; the sawmill ten days ago is older');
  assert.ok(k.includes('upgrade') && k.includes('city') && k.includes('edict'));
  assert.equal(k.filter(x => x === 'claim').length, 2); assert.equal(k.filter(x => x === 'edict').length, 1, 'an edict set aside is no action');
  assert.ok(b.every((a, i) => !i || b[i - 1][0] <= a[0]), 'oldest first');
  const w = actions(warlord, NOW - 7 * DAY, NOW).map(a => a[1]);
  assert.equal(w.filter(x => x === 'conq').length, 2); assert.equal(w.filter(x => x === 'war').length, 1);
  assert.equal(w.filter(x => x === 'trade').length, 2, 'the NPC deal once (its log line) and the offer to a player; an accepted offer is logged, not counted twice');
  assert.deepEqual([w.includes('spy'), w.includes('exp'), w.filter(x => x === 'vote').length, w.includes('peace')], [true, true, 1, false]);
  assert.deepEqual(actions({ cities: 'odd', log: [null, 4], claims: [{ t: 'x' }] }, 0, NOW), [], 'an odd record has none');
});

test('a play style is the kind of action taken most, weighed; edicts only, or quiet', () => {
  assert.equal(styleOf({ build: 2, claim: 3 }), 'builder');
  assert.equal(styleOf({ claim: 3, city: 1 }), 'expander', 'a city counts as four hexes');
  assert.equal(styleOf({ war: 1, build: 1 }), 'warlord');
  assert.equal(styleOf({ edict: 9 }), 'edicts'); assert.equal(styleOf({}), 'quiet');
  for (const s of ['builder', 'warlord', 'trader', 'diplomat', 'politician', 'explorer', 'expander', 'edicts', 'quiet']) assert.ok(STYLES.includes(s), s);
});

test('a nation row: its week, its latest action, its buildings and its lifetime tally', () => {
  const [b, w, q] = rows();
  assert.equal(b.style, 'builder'); assert.equal(w.style, 'warlord'); assert.equal(q.style, 'quiet');
  assert.deepEqual(b.a7, { city: 1, claim: 2, build: 2, upgrade: 1, edict: 1 }); assert.equal(b.wk, 7);
  assert.deepEqual(b.last, [NOW - 2 * H, 'edict'], 'being raided is no action of its own: the latest is the edict');
  assert.deepEqual(w.last, [NOW - 30 * 60000, 'conq']);
  assert.deepEqual(b.bld, [['farm', 5, 1], ['sawmill', 2, 2]], 'the factory is still going up'); assert.equal(b.bq, 1);
  assert.deepEqual(b.bwk, { farm: 1, factory: 1 });
  assert.deepEqual(b.life, { iss: 140, build: 12, claim: 30, 'log:war': 1, dm: 4 }, 'only the summed keys');
  assert.equal(b.evs.length, 2); assert.deepEqual(b.evs[0], [NOW - 30 * 60000, 'lost', 'w', 'Warhaven', 'grassland']);
  assert.equal(q.last[1], 'edict'); assert.equal(q.wk, 0);
});

test('the Activity tab: today and this week, day by day, the event mix, the latest events, buildings and styles', () => {
  const g = world(), A = actSummary(g.rows, NOW, [], true);
  assert.equal(A.d1.conq, 2); assert.equal(A.d7.build, 2); assert.equal(A.nat7.edict, 1); assert.equal(A.active7, 2);
  assert.equal(A.days.length, 60); assert.equal(A.days.at(-1).d, '2026-11-18'); assert.equal(A.days.at(-1).conq, 1, 'one hex taken today (UTC), one yesterday');
  assert.deepEqual(A.events.kinds.conq, [2, 2, 1], 'two in the last day, two this week, one nation');
  assert.deepEqual(A.events.kinds.lost, [1, 1, 1]);
  assert.deepEqual(A.events.latest.slice(0, 2).map(e => [e.k, e.name]).sort(), [['conq', 'Warhaven'], ['lost', 'Bricktown']]);
  assert.deepEqual(A.builds.farm, { n: 1, nations: 1, ug: 5, gold: 1, t2: 0, wk: 1 }); assert.equal(A.builds.factory.wk, 1); assert.equal(A.builds.factory.n, 0);
  assert.equal(A.builds.sawmill.t2, 1); assert.equal(A.withBuildings, 1); assert.equal(A.wip, 1); assert.equal(A.upgrades7, 1);
  assert.deepEqual(A.styles, { builder: 1, warlord: 1 }, 'of the nations active this week'); assert.deepEqual(A.lead.warlord, [{ id: 'w', name: 'Warhaven', reg: 'meridian', wk: 8 }]);
  assert.deepEqual(A.styleRegs, { meridian: { builder: 1, warlord: 1 } });
  assert.equal(A.life.build, 12); assert.equal(A.life.dm, 4);
  const rec = actSummary(g.rows, NOW, [{ d: '2026-11-17', act: { build: 40 } }]);
  assert.deepEqual([rec.days.at(-2).build, rec.days.at(-2).rec, rec.days.at(-1).rec], [40, true, false], 'a night\'s record stands in for the live count of its day');
  assert.equal(rec.styleRegs, null);
});

test('summarize carries the activity and lists every nation with what it did; the nightly record keeps the day\'s actions', () => {
  const d = summarize(world());
  assert.ok(d.act && d.act.days.length === 60);
  const w = d.list.find(x => x.id === 'w');
  assert.deepEqual([w.style, w.wk, w.last, w.reg], ['warlord', 8, [NOW - 30 * 60000, 'conq'], 'meridian']);
  assert.equal(summarize(world(), 'frostmarch').act.active7, 0);
  const s = snapshot(world(), Date.parse('2026-11-19T00:07:00Z'));
  assert.equal(s.d, '2026-11-18'); assert.equal(s.all.act.conq, 1); assert.equal(s.regs.meridian.act.conq, 1); assert.deepEqual(s.regs.frostmarch.act, {});
  assert.deepEqual(actDay(world().rows, Date.parse('2026-11-17T00:00:00Z')).all.conq, 1);
  for (const k of Object.keys(s.all.act)) assert.ok(ACT.includes(k), k);
});

test('a nation in full: no tally key names another nation', () => {
  const D = nationDetail('b', builder, NOW);
  assert.equal(D.name, 'Bricktown'); assert.equal(D.days.length, 30); assert.equal(D.days.at(-1).edict, 1);
  assert.deepEqual(D.tally, { build: 12, claim: 30, iss: 140, dm: 4, 'build:farm': 3, 'log:war': 1 }, 'no dm:, war: or deal: with another nation\'s id');
  assert.deepEqual(D.firsts, { build: NOW - 19 * DAY });
  assert.equal(D.cities.length, 2); assert.deepEqual(D.cities[0].b.map(b => b.k), ['farm', 'factory', 'sawmill']); assert.equal(D.cities[0].b[2].up, NOW + H);
  assert.deepEqual(D.rulings.map(r => r.id), ['tax', 'zoo']); assert.equal(D.log.length, 2);
  assert.equal(nationDetail('x', {}, NOW).name, '');
  assert.deepEqual(nationDetail('z', { capital: 'Roma', cities: [{ c: 1, t: 5, b: [] }, { c: 2, nm: 'Ostia', t: 6, b: [] }] }, NOW).cities.map(c => [c.nm, c.cap]), [['Roma', true], ['Ostia', false]], 'the capital is named by the nation');
});
