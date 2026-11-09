// More admin statistics (functions/stats-more.js): per-nation extras, the summary and buyer timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowMore, moreSummary, buyerTiming } from '../functions/stats-more.js';

const DAY = 86400000, now = Date.parse('2026-11-09T12:00:00Z');
const day = t => new Date(t).toISOString().slice(0, 10);

test('rowMore reads edicts, achievements, reach and a recent desk', () => {
  const r = { policies: { conscription: 1, universalHealth: 1 }, ach: { 'found-year0': now }, coll: { a: 1 }, dsp: { n: 'Paper' },
    dd: { d: day(now), q: [['iss', 3, 'oil', 'iron'], ['visit', 1, 'oil', 'iron'], ['exp', 2, 'oil', 'iron']], c: [3, 0, 1], p: [0, 0, 0], r: { k: 'deal', g: 2, c: 2, p: 0 } } };
  const m = rowMore(r, now);
  assert.deepEqual(m.pol, ['conscription', 'universalHealth']);
  assert.deepEqual(m.ach, ['found-year0']);
  assert.deepEqual(m.dd, [['iss', 1], ['visit', 0], ['exp', 0], ['rare:deal', 1]]);
  assert.ok(m.f2.includes('museum') && m.f2.includes('press') && !m.f2.includes('mission'));
  assert.equal(rowMore({ dd: { ...r.dd, d: day(now - 5 * DAY) } }, now).dd, null);
});

test('moreSummary counts content, regions, social and operations', () => {
  const row = (id, reg, extra) => ({ id, reg, t: now - DAY / 2, founded: now - 3 * DAY, dec: 5, f: [], f2: [], pol: [], ach: [], dd: null, ...extra });
  const g = { at: now, rows: [
    row('a', 'meridian', { pol: ['conscription'], ach: ['x'], f: ['alliance', 'letters'], dd: [['iss', 1], ['visit', 1], ['exp', 1]] }),
    row('b', 'meridian', { pol: ['conscription'], dd: [['iss', 0]] }),
    row('c', 'terra', { t: now - 40 * DAY }),
  ] };
  const m = {
    health: [{ id: 'a', reg: 'meridian', t: now - 1000, error: 'permission-denied', conflicts: 1, status: 'synced', pg: 'issues' }, { id: 'b', reg: 'meridian', t: now - 2000, error: '', conflicts: 0, status: 'synced', pg: 'map' }],
    bugs: [{ t: now - DAY, st: 'new', reg: 'meridian' }],
    tickets: [{ t: now - 10 * 3600000, st: 'open', reg: 'meridian', msgs: 2, first: now - 6 * 3600000, closed: 0 }, { t: now - DAY, st: 'open', reg: 'terra', msgs: 1, first: 0, closed: 0 }],
    posts: [{ t: now - 1000, where: 'board:meridian' }, { t: now - 1000, where: 'news' }],
    alliances: [{ reg: 'meridian', mem: 3, npc: 0, t: now }],
  };
  const w = moreSummary(g, m, '', now);
  assert.equal(w.content.edicts.conscription, 2);
  assert.equal(w.content.deskClear, 1);
  assert.deepEqual(w.content.desk.iss, { shown: 2, done: 1 });
  assert.equal(w.regions.meridian.nations, 2);
  assert.equal(w.regions.meridian.weeks.reduce((a, b) => a + b, 0), 2);
  assert.equal(w.social.loners, 1);
  assert.equal(w.social.sizes['2-4'], 1);
  assert.equal(w.social.posts.at(-1).n, 2);
  assert.equal(w.ops.days.at(-1).players, 2);
  assert.equal(w.ops.days.at(-1).errors, 1);
  assert.equal(w.ops.tickets.firstAnswerH, 4);
  assert.equal(w.ops.tickets.unanswered, 1);
  const t = moreSummary(g, m, 'terra', now);
  assert.equal(t.ops.tickets.n, 1);
  assert.equal(t.social.posts.at(-1).n, 0);
  assert.equal(t.content.active30, 0);
});

test('buyerTiming finds each buyer\'s first purchase against their founding', () => {
  const rows = [{ id: 'a', founded: now - 10 * DAY, dec: 40 }, { id: 'b', founded: now - DAY / 4, dec: 2 }];
  const txs = [{ uid: 'a', paid: now - 2 * DAY, product: 'vip' }, { uid: 'a', paid: now - 8 * DAY, product: 'pack' }, { uid: 'b', paid: now, product: 'vip' }, { uid: 'z', paid: now, product: 'vip' }, { uid: 'b', paid: now - 1, status: 'failed' }];
  const r = buyerTiming(txs, rows);
  assert.equal(r.buyers, 3);
  assert.deepEqual(r.bands, { 'same day': 1, '1-6 days': 1, '7-29 days': 0, '30+ days': 0, 'no nation': 1 });
  assert.deepEqual(r.firstProduct, { pack: 1, vip: 2 });
});
