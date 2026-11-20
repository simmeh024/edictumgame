// The front page's live figures (functions/home.js): which log entries become public events, the edicts decided in the
// past day, what is kept between runs, and the public document: no hidden, banned or unknown nation, today's names, no
// uids. Also the game's side: what it reads back (hmLiveNorm), the region maps' runs (hmRle) and the facts a new nation
// draws (fxDraw), cut from game/edictum.html.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logEvents, decisionsSince, absorb, mergeEvents, liveDoc, treatyEvents, decided, recordOf, DAY, EV_KEEP } from '../functions/home.js';
import { deflateNation } from '../functions/nationtext.js';

const now = Date.UTC(2026, 10, 20, 12), min = 60000;
const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };

test('only the public kinds of log entry become events, each from after the last run and within a week', () => {
  const rec = { log: [
    { t: now - 5 * min, k: 'city', a: 'Port Sable', fx: 'the Greymouth' },
    { t: now - 6 * min, k: 'war', a: 'uid-b', b: 'Brackwater' },
    { t: now - 7 * min, k: 'spy', a: 'uid-b' }, { t: now - 8 * min, k: 'shared', a: 'uid-b' }, { t: now - 9 * min, k: 'caught' },
    { t: now - 10 * min, k: 'alfound', a: 'me', b: 'The Northern Accord' },
    { t: now - 30 * min, k: 'mile', a: '10 million' },
    { t: now - 8 * DAY, k: 'city', a: 'Too Old' },
  ] };
  const ev = logEvents('me', rec, now - 20 * min, now);
  assert.deepEqual(ev.map(e => e.k), ['city', 'war', 'alfound'], 'spying, matters raised and anything before the last run stay out');
  assert.equal(ev.find(e => e.k === 'war').other, 'uid-b');
  assert.equal(ev.find(e => e.k === 'city').x, 'Port Sable');
  assert.deepEqual(logEvents('me', rec, 0, now).map(e => e.k), ['city', 'war', 'alfound', 'mile'], 'a first sighting goes back a week, no further');
});

test('the edicts decided in the past day: rulings, not vetoes or older ones', () => {
  const rec = { answered: [{ id: 'a', o: 1, t: now - min }, { id: 'b', o: -1, t: now - 2 * min }, { id: 'c', o: 0, t: now - 3 * min }, { id: 'd', o: 2, t: now - DAY - 1 }] };
  assert.deepEqual(decisionsSince(rec, now - DAY), [now - min, now - 3 * min]);
});

test('the memory: decisions replaced per nation, yesterday’s dropped, events kept a week and once', () => {
  const s1 = absorb({}, [{ uid: 'u1', rec: { answered: [{ o: 1, t: now - min }], log: [{ t: now - min, k: 'city', a: 'Elm' }] } }], now);
  assert.equal(decided(s1.dec, now), 1);
  assert.equal(s1.ev.length, 1);
  const s2 = absorb(s1, [{ uid: 'u1', rec: { answered: [{ o: 1, t: now - min }, { o: 0, t: now }], log: [{ t: now - min, k: 'city', a: 'Elm' }] } }], now + 1000);
  assert.equal(decided(s2.dec, now + 1000), 2, 'a nation’s rulings are counted again from its latest record, not added twice');
  assert.equal(s2.ev.length, 1, 'an event already seen is not added again');
  assert.equal(decided(absorb(s2, [], now + DAY + 1000).dec, now + DAY + 1000), 0, 'a day later they no longer count');
  assert.equal(mergeEvents([{ k: 'city', uid: 'a', t: now }, { k: 'city', uid: 'a', t: now }, { k: 'war', uid: 'a', t: now - EV_KEEP - 1 }], now).length, 1);
});

test('the public document: today’s names, no hidden, banned or unknown nation, no uids', () => {
  const state = { dec: { u1: [now - min, now - 2 * min] }, ev: [
    { k: 'city', t: now - min, uid: 'u1', x: 'Elm' },
    { k: 'war', t: now - 2 * min, uid: 'u1', other: 'u2', x: 'Old Name' },
    { k: 'war', t: now - 3 * min, uid: 'u1', other: 'hid', x: 'Hidden Land' },
    { k: 'peace', t: now - 4 * min, uid: 'u1', other: 'npc-x', x: '' },
    { k: 'city', t: now - 5 * min, uid: 'ban', x: 'Nope' },
    { k: 'city', t: now - 6 * min, uid: 'gone', x: 'Nope' },
  ] };
  const names = new Map([['u1', { name: 'Veloria', reg: 'greywater' }], ['u2', { name: 'New Name', reg: 'greywater' }], ['hid', { name: 'Hidden Land', reg: 'greywater' }], ['ban', { name: 'Banned', reg: 'greywater' }]]);
  const doc = liveDoc({ now, counts: { n: 5, a: 2 }, regions: { greywater: { n: 5, a: 2, w: 1 } }, foundings: [{ uid: 'u2', t: now - 7 * min, reg: 'greywater' }, { uid: 'hid', t: now - 8 * min, reg: 'greywater' }],
    state, names, hide: new Set(['hid', 'ban']), npcName: id => id === 'npc-x' ? 'Harrowgate' : '', def: 'greywater' });
  assert.deepEqual(doc.c, { n: 5, a: 2, e: 2 });
  assert.deepEqual(doc.ev.map(e => [e.k, e.nm, e.x || '']), [['city', 'Veloria', 'Elm'], ['war', 'Veloria', 'New Name'], ['peace', 'Veloria', 'Harrowgate'], ['found', 'New Name', '']]);
  assert.equal(doc.def, 'greywater');
  assert.ok(!JSON.stringify(doc).includes('u1') && !JSON.stringify(doc).includes('u2'), 'no uid is published');
});

test('treaties signed this week are events of the nation that offered them', () => {
  const ev = treatyEvents([{ k: 'nap', st: 'active', at: now - min, a: 'u1', b: 'u2' }, { k: 'trade', st: 'offered', at: now, a: 'u1', b: 'u2' }, { k: 'nap', st: 'active', at: now - 8 * DAY, a: 'u1', b: 'u2' }], now);
  assert.deepEqual(ev, [{ k: 'treaty', t: now - min, uid: 'u1', other: 'u2', y: 'non-aggression pact' }]);
});

test('a record is read from either form the region keeps (j text or z deflated)', () => {
  const r = { name: 'Zed', log: [] };
  assert.deepEqual(recordOf({ j: JSON.stringify(r) }), r);
  assert.deepEqual(recordOf({ z: deflateNation(JSON.stringify(r)) }), r);
  assert.equal(recordOf({}), null);
});

test('the game reads the region maps’ runs back hex for hex, and refuses a run that overflows the map', () => {
  const hmRle = new Function(line('function hmRle(') + '\nreturn hmRle;')();
  assert.deepEqual([...hmRle('0*3,2*2,0,1', 7)], [0, 0, 0, 2, 2, 0, 1]);
  assert.deepEqual([...hmRle('a*2', 3)], [10, 10, 0]);
  assert.equal(hmRle('1*9', 4), null);
});

test('the facts a new nation draws: varied, from its own seed, the same seed the same nation, and a title to suit its state', () => {
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
  const code = [line('function hash(str)'), line('function rng(seed)'), line('const CITY_ROOTS='), line('const CITY_ENDS='),
    cut('const FX_VIRTUE=', 'function hmAutoFacts(){')].join('\n');
  const fxDraw = new Function('allNations', code + '\nreturn fxDraw;')(() => []);
  const a = fxDraw(12345, 'Republic'), b = fxDraw(12345, 'Republic');
  assert.deepEqual(a, b, 'a seed draws the same nation every time, so the preview and the founding agree');
  const many = Array.from({ length: 300 }, (_, i) => fxDraw(1000 + i * 7919, i % 2 ? 'Kingdom' : 'Republic'));
  for (const k of ['capital', 'motto', 'currency', 'animal']) assert.ok(new Set(many.map(x => x[k])).size > 30, k + ' varies');
  assert.ok(new Set(many.map(x => x.capital)).size > 220, 'few capitals repeat');
  assert.ok(many.filter((x, i) => i % 2).every(x => /Minister|Chancellor|Vizier|Steward|Regent|Treasurer/.test(x.leader)), 'a kingdom has a minister, not a president');
  assert.ok(fxDraw(5, 'Theocracy').leader.match(/Priest|Archbishop|Abbot|Patriarch/));
});

test('the capital the game drew is a placeholder until the player names one, as Port Alder was', () => {
  const capHolder = new Function('TUT_CAP0', line('function capHolder(') + '\nreturn capHolder;')('Port Alder');
  assert.ok(capHolder({ capital: 'Port Alder' }));
  assert.ok(capHolder({ capital: 'Holtwell', capA: 'Holtwell' }));
  assert.ok(!capHolder({ capital: 'Myown Haven', capA: 'Holtwell' }), 'renamed: the tutorial’s task is done');
  assert.ok(!capHolder({ capital: 'Hand Written' }), 'typed in the charter: the player’s own from the start');
});
