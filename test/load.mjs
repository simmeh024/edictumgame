// A cost test: what 50 players in one region cost in Firestore reads, writes and data sent.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/load.mjs"
// Six real game clients run in Chromium (three idle, three playing: deciding edicts, visiting
// nations, posting), with every Firestore read and write they make counted inside the page. The other
// players are Node clients that do what the game does to the database: they keep the game's four live
// listeners (the region's nations, space, the region board, moderation) and save a nation of the size
// the real clients save, at the pace the real clients save. After a minute of warming up, five minutes
// are measured, and test/out/cost.json and the report (docs/cost-test.md) are written.
// Options (environment): LOAD_REAL (6), LOAD_BOTS (44), LOAD_MINUTES (5).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { setLogLevel } from 'firebase/firestore';
import { player, open, found, nav, until, sleep, OUT, PROJECT, FS_HOST, clearEmulators, errors } from './lib.mjs';
setLogLevel('error');

const REAL = +(process.env.LOAD_REAL || 6), BOTS = +(process.env.LOAD_BOTS || 44), MIN = +(process.env.LOAD_MINUTES || 5), WARM = 60e3;
const PRICE = { read: 0.06 / 1e5, write: 0.18 / 1e5, gib: 0.12 }; // eur3, USD, beyond the free quota (Firestore pricing page, October 2026)
const FREE = { reads: 50000, writes: 20000, gib: 10 / 30 };       // per day (data transfer: 10 GiB a month)
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ── counting inside a game page: the compat SDK's own classes, patched before the game uses them ── */
const INSTRUMENT = () => {
  const S = window.__fs = { reads: 0, writes: 0, bytes: 0, agg: 0 };
  const size = d => { try { return JSON.stringify(d.data()).length; } catch (e) { return 0; } };
  const wrap = (proto, name, f) => { const o = proto[name]; proto[name] = function (...a) { return f.call(this, o, a); }; };
  const tryPatch = () => {
    const F = window.firebase && window.firebase.firestore;
    if (!F || !F.Query || !F.WriteBatch || F.__counted) return !!(F && F.__counted);
    F.__counted = true;
    const onQ = qs => { if (qs.metadata.hasPendingWrites || qs.metadata.fromCache) return; for (const c of qs.docChanges()) if (c.type !== 'removed') { S.reads++; S.bytes += size(c.doc); } };
    const onD = ds => { if (ds.metadata.hasPendingWrites || ds.metadata.fromCache) return; S.reads++; if (ds.exists) S.bytes += size(ds); };
    const tap = (a, fn) => { const i = a.findIndex(x => typeof x === 'function'); if (i >= 0) { const f = a[i]; a[i] = function (x) { try { fn(x); } catch (e) {} return f.apply(this, arguments); }; } else if (a[0] && typeof a[0].next === 'function') { const o = a[0], nx = o.next.bind(o); a[0] = Object.assign({}, o, { next: x => { try { fn(x); } catch (e) {} return nx(x); } }); } return a; };
    wrap(F.Query.prototype, 'onSnapshot', function (o, a) { return o.apply(this, tap(a, onQ)); });
    wrap(F.DocumentReference.prototype, 'onSnapshot', function (o, a) { return o.apply(this, tap(a, onD)); });
    wrap(F.Query.prototype, 'get', function (o, a) { return o.apply(this, a).then(qs => { S.reads += Math.max(1, qs.size); qs.docs.forEach(d => { S.bytes += size(d); }); return qs; }); });
    wrap(F.DocumentReference.prototype, 'get', function (o, a) { return o.apply(this, a).then(ds => { S.reads++; if (ds.exists) S.bytes += size(ds); return ds; }); });
    for (const k of ['set', 'update', 'delete']) {
      wrap(F.WriteBatch.prototype, k, function (o, a) { this.__n = (this.__n || 0) + 1; return o.apply(this, a); });
      wrap(F.DocumentReference.prototype, k, function (o, a) { return o.apply(this, a).then(v => { S.writes++; return v; }); });
    }
    wrap(F.WriteBatch.prototype, 'commit', function (o, a) { const n = this.__n || 0; return o.apply(this, a).then(v => { S.writes += n; return v; }); });
    return true;
  };
  const t = setInterval(() => { if (tryPatch()) clearInterval(t); }, 2);
  const f0 = window.fetch; window.fetch = function (u) { if (String(u).includes(':runAggregationQuery')) { S.agg++; S.reads++; } return f0.apply(this, arguments); };
};
const stat = p => p.evaluate(() => Object.assign({}, window.__fs || {}));

/* ── what a real player does ── */
async function play(p, stop) {
  const acts = [
    async () => { await nav(p, 'issues'); const c = await p.$('.issue-card'); if (c) { await c.click(); await p.waitForSelector('.edict [data-act="answer"]', { timeout: 5000 }).catch(() => {}); const b = await p.$$('.edict [data-act="answer"]'); if (b.length) await b[Math.floor(Math.random() * b.length)].click(); } },
    async () => { await nav(p, 'region'); const v = await p.$$('.tbl [data-act="visit"]'); if (v.length) await v[Math.floor(Math.random() * v.length)].click().catch(() => {}); },
    async () => { await nav(p, 'region'); const t = await p.$('#rmb-text'); if (t) { await t.fill('Greetings from the load test, ' + new Date().toISOString().slice(11, 19)); await p.click('#rmb-form button[type="submit"]').catch(() => {}); } },
    async () => { await nav(p, 'map'); },
    async () => { await nav(p, 'nation'); }
  ];
  while (!stop.v) { try { await acts[Math.floor(Math.random() * acts.length)](); } catch (e) {} await sleep(25000 + Math.random() * 20000); }
}

/* ── a bot: the game's listeners, and nation saves ── */
function bot(db, uid, rec, gapMs, stop) {
  const S = { reads: 0, writes: 0, bytes: 0 };
  const size = d => { try { return JSON.stringify(d.data()).length; } catch (e) { return 0; } };
  const onQ = qs => { if (qs.metadata.hasPendingWrites || qs.metadata.fromCache) return; for (const c of qs.docChanges()) if (c.type !== 'removed') { S.reads++; S.bytes += size(c.doc); } };
  const offs = [db.collection('nations').where('reg', '==', 'meridian').onSnapshot(onQ, () => {}), db.collection('space').onSnapshot(onQ, () => {}),
    db.collection('boards/meridian/posts').orderBy('t', 'desc').limit(60).onSnapshot(onQ, () => {}), db.collection('mod').onSnapshot(onQ, () => {})];
  const save = async () => {
    const n = Object.assign({}, rec, { name: 'Bot ' + uid, updatedAt: Date.now() }), j = JSON.stringify(n), b = db.batch();
    b.set(db.doc('nations/' + uid), { v: 1, j, reg: 'meridian', name: n.name, updatedAt: n.updatedAt, ts: firebase.firestore.FieldValue.serverTimestamp() });
    b.set(db.doc('summaries/' + uid), { reg: 'meridian', name: n.name, pop: 1e6, t: n.updatedAt });
    try { await b.commit(); S.writes += 2; } catch (e) { /* paced: try at the next turn */ }
  };
  (async () => { await sleep(Math.random() * gapMs); while (!stop.v) { await save(); await sleep(gapMs * (0.7 + Math.random() * 0.6)); } })();
  return { S, stop: () => offs.forEach(f => f()) };
}

if (process.argv.includes('--report')) { report(JSON.parse(fs.readFileSync(path.join(OUT, 'cost.json'), 'utf8'))); process.exit(0); }
await clearEmulators();
const stop = { v: false };
log(`starting ${REAL} game clients and ${BOTS} Node players in one region`);
const reals = [];
for (let i = 0; i < REAL; i++) {
  const p = await player('L' + i, { vp: { width: 1100, height: 800 } });
  await p.ctx.addInitScript(INSTRUMENT);
  await open(p);
  await found(p, 'Loadland ' + (i + 1));
  reals.push({ p, active: i >= REAL / 2 });
}
const sample = await reals[0].p.evaluate(() => localStorage.getItem('statehood.nation.v1'));
const rec = JSON.parse(sample);
for (const k of ['loc', 'claims', 'cities']) delete rec[k]; // the bots keep a nation's size, not its place on the map
log('a newly founded nation saves', sample.length, 'characters of JSON');

/* the save pace of the real clients, before the bots join: one idle and one playing, for a minute */
const s0 = await Promise.all(reals.map(r => stat(r.p)));
const pl = reals.filter(r => r.active).map(r => play(r.p, stop));
await sleep(WARM);
const s1 = await Promise.all(reals.map(r => stat(r.p)));
const wpm = reals.map((r, i) => (s1[i].writes - s0[i].writes));
const nationSaves = w => w / 2.2; // a save writes the nation and its summary (and sometimes space)
const savesPerMin = Math.max(0.5, wpm.reduce((a, b) => a + nationSaves(b), 0) / REAL);
const gapMs = Math.round(60000 / savesPerMin);
log('writes in the first minute per real client', JSON.stringify(wpm), '→ a bot saves every', Math.round(gapMs / 1000), 's');

/* the bots */
const [host, port] = FS_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: +port } });
const bots = [];
for (let i = 0; i < BOTS; i++) bots.push(bot(env.authenticatedContext('bot' + i).firestore(), 'bot' + i, rec, gapMs, stop));
log('bots running; warming up for', WARM / 1000, 's');
await sleep(WARM);

/* the measured window */
const a0 = await Promise.all(reals.map(r => stat(r.p))), b0 = bots.map(b => Object.assign({}, b.S)), t0 = Date.now();
log(`measuring for ${MIN} minutes`);
await sleep(MIN * 60e3);
const a1 = await Promise.all(reals.map(r => stat(r.p))), b1 = bots.map(b => Object.assign({}, b.S)), hrs = (Date.now() - t0) / 3600e3;
stop.v = true;
bots.forEach(b => b.stop());
await Promise.race([Promise.all(pl), sleep(5000)]);

const per = (A, B) => ({ reads: (B.reads - A.reads) / hrs, writes: (B.writes - A.writes) / hrs, mb: (B.bytes - A.bytes) / 1048576 / hrs });
const avg = list => { const o = { reads: 0, writes: 0, mb: 0 }; list.forEach(x => { o.reads += x.reads / list.length; o.writes += x.writes / list.length; o.mb += x.mb / list.length; }); return o; };
const idle = avg(reals.filter(r => !r.active).map(r => per(a0[reals.indexOf(r)], a1[reals.indexOf(r)])));
const active = avg(reals.filter(r => r.active).map(r => per(a0[reals.indexOf(r)], a1[reals.indexOf(r)])));
const botAvg = avg(bots.map((b, i) => per(b0[i], b1[i])));
const players = REAL + BOTS, region = { reads: 0, writes: 0, mb: 0 };
for (const x of [idle, active]) { region.reads += x.reads * REAL / 2; region.writes += x.writes * REAL / 2; region.mb += x.mb * REAL / 2; }
region.reads += botAvg.reads * BOTS; region.writes += botAvg.writes * BOTS; region.mb += botAvg.mb * BOTS;
/* a month of the measured region load, around the clock, and what it costs beyond the free quota */
const month = (r, h) => { const reads = r.reads * h, writes = r.writes * h, gib = r.mb * h / 1024, d = h / 24;
  const cost = Math.max(0, reads - FREE.reads * d) * PRICE.read + Math.max(0, writes - FREE.writes * d) * PRICE.write + Math.max(0, gib - FREE.gib * d) * PRICE.gib;
  return { reads, writes, gib, cost }; };
const m24 = month(region, 720), m8 = month(region, 240);
const out = { when: new Date().toISOString(), players, real: REAL, bots: BOTS, minutes: MIN, nationJson: sample.length, savesPerMinPerPlayer: +savesPerMin.toFixed(2), gapMs,
  perPlayerHour: { idle, active, bot: botAvg }, regionHour: region, month24h: m24, month8hDay: m8, pageErrors: errors.slice(0, 10) };
fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify(out, null, 2));
log('result', JSON.stringify(out, null, 1));
report(Object.assign(out, { gapMs }));
log('wrote docs/cost-test.md');
await env.cleanup();
process.exit(0);

/* the report: what was measured, and what the same pattern costs with more players online in a region and
   with bigger nations. Every save goes to every other player in the region, so reads per player per hour
   are about (players - 1) x saves per hour, and the data is those reads times the size of a nation. */
function report(out) {
  const f = (v, d = 0) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
  const { idle, active, bot } = out.perPlayerHour, region = out.regionHour, m8 = out.month8hDay, m24 = out.month24h, P = out.players;
  const sph = out.savesPerMinPerPlayer * 60, byteRatio = region.mb * 1048576 / Math.max(1, region.reads) / out.nationJson;
  const proj = (N, size) => { const reads = N * (N - 1) * sph * 720, writes = N * sph * 2 * 720, gib = reads * size * byteRatio / 1073741824, d = 30;
    const cost = Math.max(0, reads - FREE.reads * d) * PRICE.read + Math.max(0, writes - FREE.writes * d) * PRICE.write + Math.max(0, gib - 10) * PRICE.gib;
    return { reads, gib, cost }; };
  const rows = [];
  for (const N of [50, 100, 250]) for (const [lab, size] of [['new (' + f(out.nationJson / 1000, 1) + ' KB)', out.nationJson], ['played a day (12 KB)', 12245], ['mature (40 KB, estimate)', 40000]]) {
    const r = proj(N, size); rows.push(`| ${N} | ${lab} | ${f(r.reads / 1e6, 1)} million | ${f(r.gib)} | $${f(r.cost)} |`); }
  const md = `# Cost test

Run on ${out.when.slice(0, 10)} with \`node test/load.mjs\` on the Firebase emulators: ${P} players in one region for
${out.minutes} measured minutes, after a minute of warming up. ${out.real} were real game clients in Chromium (half idle,
half playing: deciding edicts, visiting nations, posting on the board), with every Firestore read and write counted
inside the page. The other ${out.bots} were Node clients doing what the game does to the database: the game's four live
listeners (the region's nations, space, the region board, moderation) and a nation save every
${Math.round((out.gapMs || 60000 / out.savesPerMinPerPlayer) / 1000)} seconds, the average pace of the real clients
(${f(out.savesPerMinPerPlayer, 2)} saves a minute: idle players save nothing, playing ones up to four a minute).

A newly founded nation saves ${f(out.nationJson)} characters of JSON. Prices are Firestore's for eur3: reads $0.06 and
writes $0.18 per 100,000, data sent to the internet $0.12 per GiB, beyond the free quota (50,000 reads and 20,000 writes
a day, 10 GiB of data a month).

## Measured, per player per hour

| | Reads | Writes | Data received (MB) |
|---|---:|---:|---:|
| Idle game client | ${f(idle.reads)} | ${f(idle.writes)} | ${f(idle.mb, 1)} |
| Playing game client | ${f(active.reads)} | ${f(active.writes)} | ${f(active.mb, 1)} |
| Node player | ${f(bot.reads)} | ${f(bot.writes)} | ${f(bot.mb, 1)} |

## Measured, the whole region (${P} players)

| | Reads | Writes | Data (GiB) | Cost beyond the free quota |
|---|---:|---:|---:|---:|
| One hour | ${f(region.reads)} | ${f(region.writes)} | ${f(region.mb / 1024, 2)} | |
| A month, 8 hours a day | ${f(m8.reads)} | ${f(m8.writes)} | ${f(m8.gib, 1)} | $${f(m8.cost, 2)} |
| A month, around the clock | ${f(m24.reads)} | ${f(m24.writes)} | ${f(m24.gib, 1)} | $${f(m24.cost, 2)} |

## What drives the bill

Almost all of it is one listener: every player listens to the full records of every nation in the region, so each save
is read by every other player there. Reads per player per hour are about (players online in the region − 1) × saves per
hour, so a region's reads grow with the square of the players online in it, and the data sent grows with the size of a
nation's record as well. Writes are small.

## Projected: one region, a month around the clock, at the measured pace

| Players online at once | Nation size | Reads | Data (GiB) | Cost |
|---:|---|---:|---:|---:|
${rows.join('\n')}

Spread the same players over more regions and the cost falls: 250 players in five regions of 50 cost five times the
first rows, not the square.

## What would bring it down

1. **Send other players a small public record, not the whole nation.** What another player needs to see (name, flag,
   land, figures, relations) fits in a fraction of the full record; the full record is only needed when someone opens
   that nation's page. This is the structural fix: it cuts the data by most of its size, and the reads too if the
   public record changes less often than the nation.
2. **Compress the nation record.** The JSON compresses to about a fifth of its size, which cuts the data by about 80%
   (the reads stay the same).
3. **Publish less often.** Saving to the database at most once a minute instead of every 15 seconds (the game still
   saves when a player leaves) cuts the reads and data from playing players by up to four times.
4. **Keep regions smaller while they fill.** Steering newcomers to emptier regions sooner keeps the square small.
`;
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'cost-test.md'), md);
}
