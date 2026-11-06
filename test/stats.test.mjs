// The Statistics page's counting (functions/stats.js), on hand-made records: no emulator needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nationRow, accountRow, summarize, snapshot, dayKey, DAY, engagement, engageParts, ENG_PARTS, FUNNEL, funnelMask } from '../functions/stats.js';

const NOW = Date.parse('2026-11-02T15:00:00Z');
const save = (rec, extra = {}) => ({ j: JSON.stringify(rec), reg: rec.reg, name: rec.name, pop: rec.pop, updatedAt: rec.updatedAt, ...extra });
const priv = rec => ({ j: JSON.stringify(rec) });
const user = (uid, o = {}) => ({ uid, emailVerified: !!o.verified, customClaims: o.claims || {}, providerData: (o.providers || []).map(providerId => ({ providerId })), metadata: { creationTime: new Date(o.created || NOW - 40 * DAY).toUTCString() } });
function world() {
  const rows = [
    // a busy nation of a month, in Meridian: rulings today and last week, a city with a building, at war, on holiday
    nationRow('a', save({ name: 'Aldoria', reg: 'meridian', pop: 12, updatedAt: NOW - 60000, founded: NOW - 30 * DAY,
      answered: [{ id: 'tax', o: 1, t: NOW - 3600000 }, { id: 'tax', o: 0, t: NOW - 2 * 3600000 }, { id: 'zoo', o: -1, t: NOW - 3 * 3600000 }, { id: 'tax', o: 1, t: NOW - 3 * DAY }, { id: 'old', o: 0, t: NOW - 40 * DAY }],
      loc: { c: 3, r: 4 }, claims: [{ c: 1 }], cities: [{ c: 3, b: [{ k: 'farm' }] }, { c: 9 }], wars: { b: { t: NOW - DAY } }, away: { a: NOW - DAY, b: NOW + DAY } }),
      priv({ dec: 140, freq: 60, inbox: [{}, {}, {}, {}, {}], tut: { lc: ['settle', 'issue', 'land'], ch: 'c' }, answered: [{ id: 'stale', o: 0, t: NOW - 3600000 }] }), NOW),
    // founded today in Meridian, one ruling, nothing else
    nationRow('b', save({ name: 'Borvia', reg: 'meridian', pop: 5, updatedAt: NOW - 3600000, founded: NOW - 5 * 3600000, answered: [{ id: 'zoo', o: 2, t: NOW - 4 * 3600000 }] }), null, NOW),
    // founded ten days ago in Frostmarch, gone after the first hour: a guest who did not come back
    nationRow('c', save({ name: 'Cirrus', reg: 'frostmarch', pop: 5.1, updatedAt: NOW - 10 * DAY + 3600000, founded: NOW - 10 * DAY }), priv({ freq: 30, tut: { lc: ['settle'] } }), NOW),
  ];
  const accts = [user('a', { providers: ['google.com'] }), user('b', { created: NOW - 5 * 3600000 }), user('c', { created: NOW - 10 * DAY, providers: ['password'], verified: false }), user('v1', { created: NOW - 2 * DAY }), user('v2', { created: NOW - 3 * DAY, claims: { dc: '42' } })].map(accountRow);
  return { at: NOW, rows, accts, limited: false, devices: [{ id: 'a', reg: 'meridian', device: 'Desktop' }, { id: 'a', reg: 'meridian', device: 'Desktop' }, { id: 'b', reg: 'meridian', device: 'Mobile' }],
    posts: { meridian: { all: 9, week: 4 }, frostmarch: { all: 1, week: 0 }, saffron: { all: 0, week: 0 } }, finery: ['meridian'], days: [{ d: '2026-11-01', all: { a1: 2 }, regs: { meridian: { a1: 2 } } }] };
}

test('a nation row joins both halves (the shared one wins) and keeps only the last 30 days of rulings', () => {
  const g = world(), a = g.rows[0];
  assert.equal(a.reg, 'meridian'); assert.equal(a.dec, 140); assert.equal(a.freq, 60); assert.equal(a.inbox, 5);
  assert.deepEqual(a.ans.map(x => x[1]), ['tax', 'tax', 'zoo', 'tax'], 'the shared rulings, without the one older than 30 days');
  assert.deepEqual(a.tut, ['settle', 'issue', 'land']); assert.equal(a.lists, 'c');
  for (const k of ['settled', 'land', 'build', 'cities', 'war', 'holiday']) assert.ok(a.f.includes(k), k);
  for (const k of ['trade', 'alliance', 'space', 'moved']) assert.ok(!a.f.includes(k), k);
  assert.equal(g.rows[1].freq, 30, 'the default pace without a private half');
  assert.equal(nationRow('x', { name: 'Old', reg: 'meridian', founded: 5, updatedAt: 9 }, null, NOW).name, 'Old', 'a record saved before the JSON text');
  assert.equal(nationRow('y', { j: '{not json' }, null, NOW), null);
});

test('an account is registered with a provider other than an unverified email, or with Discord', () => {
  const g = world(), by = Object.fromEntries(g.accts.map(a => [a.id, a]));
  assert.equal(by.a.registered, true); assert.equal(by.a.google, true);
  assert.equal(by.b.registered, false); assert.equal(by.c.registered, false); assert.equal(by.c.email, false);
  assert.equal(by.v2.registered, true); assert.equal(by.v2.discord, true);
});

test('the whole world: activity, rulings, retention, the tutorial and accounts', () => {
  const d = summarize(world());
  assert.equal(d.nations, 3); assert.equal(d.a1, 2); assert.equal(d.a7, 2); assert.equal(d.a30, 3); assert.equal(d.now15, 1);
  assert.equal(d.new1, 1); assert.equal(d.new30, 2, 'Aldoria is exactly 30 days old');
  assert.equal(d.dec1, 3, 'two of Aldoria and one of Borvia; a set-aside edict is no decision'); assert.equal(d.deciders1, 2); assert.equal(d.medRuled1, 1.5);
  assert.equal(d.dec7, 4); assert.equal(d.skip7, 1);
  const today = d.days.at(-1); assert.equal(today.d, '2026-11-02'); assert.equal(today.founded, 1); assert.equal(today.rulings, 3); assert.equal(today.rulers, 2);
  assert.equal(d.days.length, 60); assert.equal(d.days.reduce((s, x) => s + x.visitors, 0), 5, 'accounts opened in the last 60 days');
  assert.equal(d.hours.reduce((a, b) => a + b, 0), 4); assert.equal(d.hours[1 * 24 + 14], 1, 'Monday 14:00 UTC');
  const lasting = Object.fromEntries(d.lasting.map(x => [x.d, x]));
  assert.deepEqual(lasting[1], { d: 1, of: 2, kept: 1 }, 'Aldoria kept playing, Cirrus did not; Borvia is too young to tell');
  assert.deepEqual(lasting[30], { d: 30, of: 1, kept: 0 });
  assert.equal(d.weeks.length, 8); assert.equal(d.weeks.at(-1).n, 1, 'Borvia, this week'); assert.equal(d.weeks.at(-1).d1.of, 0);
  assert.equal(d.edicts.top[0].id, 'tax'); assert.deepEqual(d.edicts.top[0].o, { 0: 1, 1: 2 }); assert.equal(d.edicts.top.find(e => e.id === 'zoo').skip, 1);
  assert.equal(d.tut.settle, 2); assert.equal(d.tut.google, undefined); assert.equal(d.lists.c, 1);
  assert.equal(d.features.war, 1); assert.equal(d.active30, 3);
  assert.deepEqual(d.pace, { 30: 2, 60: 1 }); assert.deepEqual(d.waiting, { full: 1, none: 1 }); assert.equal(d.active7, 2);
  assert.deepEqual({ ...d.accounts, limited: undefined }, { total: 5, withNation: 3, registered: 1, google: 1, email: 0, discord: 0, new1: 1, new7: 3, new30: 4, new30Founded: 2, limited: undefined });
  assert.deepEqual(d.devices, { Desktop: 1, Mobile: 1 }); assert.equal(d.finery, 1); assert.deepEqual(d.posts, { all: 10, week: 4 });
  assert.equal(d.regions.length, 3, 'every region with nations or a board');
  assert.deepEqual(d.regions.find(r => r.reg === 'meridian'), { reg: 'meridian', nations: 2, a1: 2, a7: 2, a30: 2, new1: 1, new7: 1, new30: 1, dec1: 3, deciders1: 2, posts: { all: 9, week: 4 } });
  assert.equal(d.list, null); assert.equal(d.history[0].a1, 2);
  const { funnel, eng, recruits, ...rest } = d;
  assert.ok(!JSON.stringify(rest).includes('Aldoria'), 'no nation names for the whole world but in the funnel, the most engaged and the recruiters');
});

test('one region: its own figures, its accounts and its nations, the most recently active first', () => {
  const d = summarize(world(), 'meridian');
  assert.equal(d.nations, 2); assert.equal(d.nationCount, 2); assert.equal(d.a1, 2); assert.equal(d.regions, null);
  assert.deepEqual(d.list.map(x => x.name), ['Aldoria', 'Borvia']);
  assert.equal(d.accounts.withNation, 2); assert.equal(d.accounts.total, 2); assert.equal(d.accounts.new30, null);
  assert.deepEqual(d.devices, { Desktop: 1, Mobile: 1 }); assert.deepEqual(d.posts, { all: 9, week: 4 });
  assert.equal(d.days.reduce((s, x) => s + x.visitors, 0), 0, 'visitors are counted for the whole world only');
  assert.equal(summarize(world(), 'frostmarch').list[0].ruled1, 0);
});

test('the nightly record names the day that just ended and keeps each region\'s headline', () => {
  const s = snapshot(world(), Date.parse('2026-11-03T00:07:00Z'));
  assert.equal(s.d, '2026-11-02'); assert.equal(dayKey(Date.parse('2026-11-02T23:59:00Z')), '2026-11-02');
  assert.deepEqual(Object.keys(s.regs).sort(), ['frostmarch', 'meridian']);
  assert.equal(s.all.accounts, 5); assert.equal(s.all.registered, 2); assert.equal(s.all.nations, 3);
});

test('engagement: days played in the fortnight, edicts decided, parts of the game used and those with other nations', () => {
  const g = world(), [a, b, c] = g.rows;
  assert.equal(a.d14, 2, 'today and three days ago'); assert.equal(a.r14, 3, 'a set-aside edict is no decision');
  assert.deepEqual(a.eng, [22, 2, 3, 4, 1], 'land, build, cities and war; war is with another nation');
  assert.deepEqual(b.eng, [4, 1, 1, 0, 0], '40 / 14 for the day and 25 / 30 for the edict'); assert.deepEqual(c.eng, [0, 0, 0, 0, 0], 'Cirrus played more than a fortnight ago');
  const busy = nationRow('d', save({ name: 'Dorn', reg: 'meridian', pop: 1, updatedAt: NOW, founded: NOW - 40 * DAY,
    hist: Array.from({ length: 20 }, (_, i) => ({ t: NOW - i * DAY, p: 1 })), answered: Array.from({ length: 40 }, (_, i) => ({ id: 'e' + i, o: 0, t: NOW - i * 3600000 })),
    deals: [{}], alli: { a: 1 }, wars: { x: {} }, claims: [{}], cities: [{ b: [{}] }, {}], disc: [1], cov: [1], ddc: 2, mvN: 1 }), null, NOW);
  assert.equal(busy.d14, 14, 'the history counts the days, at most 14'); assert.equal(busy.eng[0], 100);
  assert.equal(engagement({ d14: 30, r14: 0, f: [] })[1], 14);
  const parts = engageParts(g.rows);
  assert.equal(parts.length, ENG_PARTS); assert.deepEqual(Object.assign({}, ...parts), { a: a.eng, b: b.eng, c: c.eng });
});

test('the onboarding funnel: each nation founded in the last eight weeks with the steps it has taken', () => {
  const d = summarize(world()), F = d.funnel;
  assert.deepEqual(F.steps, FUNNEL); assert.equal(F.total, 3); assert.equal(F.from, Date.parse('2026-09-14T00:00:00Z'), 'eight Mondays back');
  const by = Object.fromEntries(F.nations.map(x => [x[0], x]));
  assert.deepEqual(F.nations.map(x => x[0]), ['b', 'c', 'a'], 'the newest first');
  assert.equal(by.a[5], 127, 'Aldoria has done every step, Google sign-in included');
  assert.equal(by.b[5], 1 << FUNNEL.indexOf('ruled'), 'Borvia decided an edict and nothing else');
  assert.equal(by.c[5], 0); assert.equal(by.a[1], 'Aldoria'); assert.equal(by.a[2], 'meridian');
  assert.equal(funnelMask({ f: ['settled', 'land'], dec: 0, lists: '' }, true), 0b1000011);
  assert.deepEqual(summarize(world(), 'frostmarch').funnel.nations.map(x => x[0]), ['c']);
});

test('recruiting: who came through a link and stayed a week, beside everyone else', () => {
  const g = world(); g.recruits = [{ id: 'b', r: 'a', t: NOW - 5 * 3600000 }, { id: 'c', r: 'a', t: NOW - 10 * DAY }, { id: 'gone', r: 'a', t: NOW }];
  const R = summarize(g).recruits;
  assert.equal(R.n, 2, 'a recruit with no nation now is left out'); assert.equal(R.recruiters, 1);
  assert.equal(R.of, 1); assert.equal(R.kept, 0, 'Cirrus left in its first hour; Borvia is too young to tell');
  assert.deepEqual(R.others, { of: 1, kept: 1 }, 'Aldoria');
  assert.deepEqual(R.list, [{ r: 'a', n: 2, of: 1, kept: 0, a7: 1, last: NOW - 5 * 3600000, name: 'Aldoria', reg: 'meridian' }]);
  assert.equal(summarize(g, 'meridian').recruits.n, 1, 'only recruits living in the region');
  assert.equal(summarize(world()).recruits.n, 0);
});

test('releases, engagement bands and the most engaged for the page; feature use in the nightly record', () => {
  const g = world(); g.news = [{ id: 'n1', t: NOW - 2 * DAY, ti: 'Cities expanded', tg: 'update' }, { id: 'n0', t: NOW - 90 * DAY, ti: 'Old', tg: '' }];
  const d = summarize(g);
  assert.deepEqual(d.releases, [{ t: NOW - 2 * DAY, ti: 'Cities expanded', tg: 'update' }], 'only those in the charts\' 60 days');
  assert.deepEqual(d.eng.bands, [3, 0, 0, 0]); assert.equal(d.eng.median, 4); assert.deepEqual(d.eng.top.map(x => x.id), ['a', 'b', 'c']);
  const { funnel, eng, recruits, ...rest } = d;
  assert.ok(!JSON.stringify(rest).includes('Aldoria'), 'for the whole world, nations are named only in the funnel, the most engaged and the recruiters');
  const s = snapshot(g, Date.parse('2026-11-03T00:07:00Z'));
  assert.equal(s.all.act30, 3); assert.deepEqual(s.all.feat, { settled: 1, land: 1, build: 1, cities: 1, war: 1, holiday: 1 });
  assert.equal(s.regs.frostmarch.act30, 1); assert.deepEqual(s.regs.frostmarch.feat, {});
  g.days = [{ d: '2026-11-01', all: { a1: 2, act30: 3, feat: { war: 1 } }, regs: {} }];
  assert.deepEqual(summarize(g).history[0].feat, { war: 1 }, 'the page reads the feature history from the daily records');
});
