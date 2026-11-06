// The admin portal's Live feed events (functions/feed.js) and the staff alerts' checks (functions/alerts.js), on
// hand-made records: no emulator needed. The alerts job itself runs against the emulator in test/admin.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pingEvent, postEvent, buyEvent, mergeEvents, countGroups, GROUP } from '../functions/feed.js';
import { alertConfig, ALERT_DEFAULTS, reportAlerts, dayAgo, popAlerts, errorAlerts, spikeAlerts, buyAlerts, watchAlerts, discordText, HOUR, DAY } from '../functions/alerts.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const stamp = t => ({ toMillis: () => t });

test('a ping becomes an event, but a letter never does', () => {
  assert.deepEqual(pingEvent({ by: 'a', to: 'b', k: 'war', nm: '  Aldoria  ', t: stamp(NOW) }), { k: 'war', t: NOW, uid: 'a', name: 'Aldoria', to: 'b' });
  assert.equal(pingEvent({ by: 'a', to: 'b', k: 'msg', nm: 'Aldoria', t: NOW }), null, 'who wrote to whom stays private');
  assert.equal(pingEvent({ by: 'a', to: 'b', k: 'unknown', t: NOW }), null);
  assert.equal(pingEvent(null), null);
  for (const k of ['war', 'conq', 'peace', 'trade', 'shared', 'aladmit', 'alremove', 'cede']) assert.ok(GROUP[k], k);
});

test('a post says which board it is on from its path', () => {
  assert.deepEqual(postEvent('cb/meridian/posts/T1', { a: 'u', nm: 'Aldoria', ti: 'Grain prices', x: 'long text', t: NOW }), { k: 'topic', t: NOW, uid: 'u', name: 'Aldoria', reg: 'meridian', x: 'Grain prices' });
  assert.equal(postEvent('cb/meridian/posts/T1/posts/R1', { a: 'u', x: 'Agreed', t: NOW }).k, 'reply');
  assert.deepEqual(postEvent('boards/frostmarch/posts/P1', { a: 'u', x: 'Hello\n  there', t: stamp(NOW) }), { k: 'post', t: NOW, uid: 'u', name: '', reg: 'frostmarch', x: 'Hello there' });
  assert.equal(postEvent('devnews/N1/posts/C1', { a: 'u', x: 'Nice', t: stamp(NOW) }).k, 'comment');
  assert.equal(postEvent('elsewhere/x/posts/y', { t: NOW }), null);
});

test('a purchase counts when it went through, in the shop\'s own environment', () => {
  assert.deepEqual(buyEvent('t1', { ok: true, uid: 'u', payer: 'p', product: 'vip', gift: true, paid: NOW }, 'live'), { k: 'buy', t: NOW, uid: 'u', to: 'p', x: 'vip', gift: true, ref: 't1' });
  assert.equal(buyEvent('t2', { ok: false, uid: 'u', paid: NOW }, 'live'), null);
  assert.equal(buyEvent('t3', { ok: true, uid: 'u', paid: NOW, env: 'sandbox' }, 'live'), null, 'a test purchase on a live shop');
  assert.equal(buyEvent('t4', { ok: true, uid: 'u', payer: 'u', created: NOW }, '').to, '', 'buying for oneself names no payer');
});

test('events are merged newest first, each once, and only those since the start', () => {
  const ev = (k, t, uid, to = '') => ({ k, t, uid, to });
  const out = mergeEvents([[ev('war', NOW - 5, 'a', 'b'), ev('found', NOW - 1, 'c')], [ev('war', NOW - 5, 'a', 'b'), ev('trade', NOW - 9999, 'a', 'b'), null]], NOW - 100);
  assert.deepEqual(out.map(e => e.k), ['found', 'war'], 'the archived copy of a queued ping counts once; the old trade is before the start');
  assert.equal(mergeEvents([Array.from({ length: 10 }, (_, i) => ev('found', NOW - i, 'u' + i))], 0, 4).length, 4);
  assert.deepEqual(countGroups([ev('war', 1), ev('conq', 1), ev('trade', 1), ev('found', 1), ev('bug', 1)]), { war: 2, dip: 1, found: 1, mod: 1 });
});

test('alert thresholds stay within their limits; anything odd is the default', () => {
  assert.deepEqual(alertConfig(null), ALERT_DEFAULTS);
  const c = alertConfig({ reports: 0, popPct: 'lots', errPct: 500, spike: 4, buys: false, discord: 'yes', extra: 1 });
  assert.equal(c.reports, 1); assert.equal(c.popPct, ALERT_DEFAULTS.popPct); assert.equal(c.errPct, 100); assert.equal(c.spike, 4);
  assert.equal(c.buys, false); assert.equal(c.discord, true); assert.equal(c.extra, undefined);
});

test('a player reported three times in a day is one alert that day', () => {
  const r = (target, h, reason = 'name') => ({ id: target + h, target, name: 'Borvia', reason, t: stamp(NOW - h * HOUR) });
  const out = reportAlerts([r('b', 1), r('b', 2, 'spam'), r('b', 20), r('b', 30), r('c', 1), r('c', 2)], ALERT_DEFAULTS, NOW);
  assert.equal(out.length, 1); assert.equal(out[0].id, 'rep~b~2026-11-06'); assert.equal(out[0].uid, 'b');
  assert.match(out[0].ti, /Borvia was reported 3 times/); assert.equal(out[0].x, 'name 2, spam 1', 'the report from 30 hours ago is too old');
  assert.equal(reportAlerts([r('c', 1), r('c', 2)], alertConfig({ reports: 2 }), NOW).length, 1);
});

test('a nation that grew too fast in a day, from the history its record keeps', () => {
  const hist = [{ t: NOW - 40 * HOUR, p: 1 }, { t: NOW - 25 * HOUR, p: 2 }, { t: NOW - 21 * HOUR, p: 2.5 }, { t: NOW - 3 * HOUR, p: 4 }];
  assert.deepEqual(dayAgo(hist, NOW), { t: NOW - 25 * HOUR, p: 2 }, 'the point nearest a day ago, between 18 and 30 hours old');
  assert.equal(dayAgo([{ t: NOW - 3 * HOUR, p: 1 }], NOW), null, 'a nation younger than a day has no point to compare with');
  const out = popAlerts([{ id: 'a', name: 'Aldoria', reg: 'meridian', pop: 4.2, hist }, { id: 'b', name: 'Borvia', pop: 2.6, hist }, { id: 'c', pop: 9, hist: [] }], ALERT_DEFAULTS, NOW);
  assert.deepEqual(out.map(a => a.uid), ['a'], 'Borvia grew 30%, under the 50% threshold'); assert.match(out[0].ti, /Aldoria grew 110% in a day/);
  assert.equal(popAlerts([{ id: 'a', pop: 4.2, hist }], alertConfig({ popMin: 5 }), NOW).length, 0, 'not enough people');
});

test('save errors, a rush of foundings and purchases', () => {
  const s = (uid, error = '', status = 'synced') => ({ uid, error, status });
  const many = [...Array(6)].map((_, i) => s('e' + i, 'permission-denied')).concat([...Array(10)].map((_, i) => s('ok' + i)));
  const err = errorAlerts(many, ALERT_DEFAULTS, NOW);
  assert.equal(err.length, 1); assert.equal(err[0].id, 'err~2026-11-06T12'); assert.match(err[0].ti, /6 of 16 players/); assert.equal(err[0].x, 'permission-denied 6');
  assert.equal(errorAlerts(many.concat([...Array(40)].map((_, i) => s('more' + i))), ALERT_DEFAULTS, NOW).length, 0, '6 of 56 is under 20%');
  assert.equal(errorAlerts([s('x', '', 'offline'), s('x', '', 'offline')], alertConfig({ errors: 1 }), NOW).length, 1, 'one player, twice');
  assert.equal(spikeAlerts({ hour: 12, week: 168 }, ALERT_DEFAULTS, NOW).length, 1, 'twelve times the hourly average');
  assert.equal(spikeAlerts({ hour: 2, week: 0 }, ALERT_DEFAULTS, NOW).length, 0, 'fewer than five');
  assert.equal(spikeAlerts({ hour: 5, week: 336 }, ALERT_DEFAULTS, NOW).length, 0, 'two and a half times an average of two an hour is no rush');
  const buys = buyAlerts([{ id: 't1', uid: 'u', product: 'vip', name: 'Aldoria' }, { id: 't2', uid: 'v', payer: 'u', gift: true, product: 'giftvip', payerName: 'Aldoria' }], ALERT_DEFAULTS);
  assert.deepEqual(buys.map(b => b.id), ['buy~t1', 'buy~t2']); assert.match(buys[1].ti, /was given giftvip/); assert.match(buys[1].x, /from Aldoria/);
  assert.equal(buyAlerts([{ id: 't1' }], alertConfig({ buys: false })).length, 0);
});

test('watched players: back after an hour away, renamed, moved, reported or gone', () => {
  const watched = [{ uid: 'a', why: 'alt?' }, { uid: 'b', why: '' }, { uid: 'c', why: '' }, { uid: 'd', why: '' }];
  const before = { a: { t: NOW - 3 * HOUR, name: 'Aldoria', reg: 'meridian' }, b: { t: NOW - 10 * 60000, name: 'Borvia', reg: 'meridian' }, c: { t: NOW - DAY, name: 'Cirrus', reg: 'x' } };
  const cur = { a: { t: NOW - 60000, name: 'Aldoria Nova', reg: 'frostmarch' }, b: { t: NOW - 60000, name: 'Borvia', reg: 'meridian' }, c: null, d: { t: NOW, name: 'Dorn', reg: 'x' } };
  const { alerts, seen } = watchAlerts(watched, cur, before, [{ id: 'r1', target: 'b', reason: 'spam', note: 'ads' }, { id: 'r2', target: 'z' }], ALERT_DEFAULTS, NOW);
  assert.deepEqual(alerts.map(a => a.id.split('~')[0] + ':' + a.uid).sort(), ['wgone:c', 'wnm:a', 'won:a', 'wrep:b', 'wrg:a'],
    'Borvia was away only ten minutes; Dorn was not seen before, so nothing to compare');
  assert.match(alerts.find(a => a.id.startsWith('wnm')).ti, /Aldoria renamed itself Aldoria Nova/);
  assert.equal(alerts.find(a => a.id.startsWith('won')).x, 'Watched: alt?');
  assert.deepEqual(seen.a, { t: NOW - 60000, name: 'Aldoria Nova', reg: 'frostmarch' }); assert.equal(seen.c, null);
  assert.equal(watchAlerts(watched, cur, before, [], alertConfig({ watch: false }), NOW).alerts.length, 0);
});

test('the Discord message: one line per alert, no formatting from player names, a link to the page, under 2000 characters', () => {
  const t = discordText([{ lvl: 'warn', ti: '**Bold** _name_', x: 'From 1 to 2.' }], 'https://edictumgame.com/');
  assert.equal(t, '⚠️ **Bold name** — From 1 to 2.\n<https://edictumgame.com/#admin-watch>');
  const long = discordText([...Array(100)].map((_, i) => ({ lvl: 'info', ti: 'Alert number ' + i + ' '.repeat(20), x: 'x'.repeat(30) })), 'https://e.com');
  assert.ok(long.length < 2000); assert.match(long, /…and \d+ more\./);
});
