// A cost test: what 50 players in one region cost in Firestore reads, writes and data sent.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/load.mjs"
// Six real game clients run in Chromium (three idle, three playing: deciding edicts, visiting
// nations, posting), with every Firestore read and write they make counted inside the page. The other
// players are Node clients that do what the game does to the database: they keep the game's four live
// listeners (the region's nations, space, the region board, moderation) and save a nation of the size
// the real clients save, split as src/shim.js splits it (the shared half to nations/, the private half to
// nationx/ as often as the real clients rewrite it), at the pace the real clients save over the first two
// minutes. After a minute of warming up, five minutes are measured, and test/out/cost.json and the report
// (docs/cost-test.md) are written; the report compares them with test/cost-baseline.json, the run before
// the split and the one-minute save gap.
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

const REAL = +(process.env.LOAD_REAL || 6), BOTS = +(process.env.LOAD_BOTS || 44), MIN = +(process.env.LOAD_MINUTES || 5), WARM = 60e3, CAL = 120e3;
const PRICE = { read: 0.06 / 1e5, write: 0.18 / 1e5, gib: 0.12 }; // eur3, USD, beyond the free quota (Firestore pricing page, October 2026)
const FREE = { reads: 50000, writes: 20000, gib: 10 / 30 };       // per day (data transfer: 10 GiB a month)
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const BEFORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'cost-baseline.json'), 'utf8'));
/* the private half of a record, as src/shim.js splits it (its key list is read from there) */
const NX = new Set(fs.readFileSync(path.join(ROOT, 'src', 'shim.js'), 'utf8').match(/\[('inbox'[\s\S]*?)\]\.forEach\(function \(k\) \{ NX_KEYS\[k\] = 1; \}\)/)[1].match(/'[^']+'/g).map(k => k.slice(1, -1)));
const NX_PP = new Set(['v', 'p', 'l']);
function split(d) {
  const pub = {}, ext = {};
  for (const k of Object.keys(d)) (NX.has(k) ? ext : pub)[k] = d[k];
  if (d.pp && typeof d.pp === 'object') { const a = {}, b = {}; for (const k of Object.keys(d.pp)) (NX_PP.has(k) ? b : a)[k] = d.pp[k]; pub.pp = a; ext.pp = b; }
  return [pub, ext];
}

/* ── counting inside a game page: the compat SDK's own classes, patched before the game uses them ── */
const INSTRUMENT = () => {
  const S = window.__fs = { reads: 0, writes: 0, bytes: 0, agg: 0, saves: 0, xw: 0 };
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
      wrap(F.WriteBatch.prototype, k, function (o, a) { this.__n = (this.__n || 0) + 1; const p = String(a[0] && a[0].path || '');
        if (k === 'set' && p.startsWith('nations/')) this.__sv = 1; if (k === 'set' && p.startsWith('nationx/')) this.__x = 1; return o.apply(this, a); });
      wrap(F.DocumentReference.prototype, k, function (o, a) { return o.apply(this, a).then(v => { S.writes++; return v; }); });
    }
    wrap(F.WriteBatch.prototype, 'commit', function (o, a) { const n = this.__n || 0, sv = this.__sv || 0, x = this.__x || 0; return o.apply(this, a).then(v => { S.writes += n; S.saves += sv; S.xw += x; return v; }); });
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

/* ── a bot: the game's listeners, and nation saves: the shared half every time, the private half as often as the real clients ── */
function bot(db, uid, rec, gapMs, xPerSave, stop) {
  const S = { reads: 0, writes: 0, bytes: 0 };
  const size = d => { try { return JSON.stringify(d.data()).length; } catch (e) { return 0; } };
  const onQ = qs => { if (qs.metadata.hasPendingWrites || qs.metadata.fromCache) return; for (const c of qs.docChanges()) if (c.type !== 'removed') { S.reads++; S.bytes += size(c.doc); } };
  const offs = [db.collection('nations').where('reg', '==', 'meridian').onSnapshot(onQ, () => {}), db.collection('space').onSnapshot(onQ, () => {}),
    db.collection('boards/meridian/posts').orderBy('t', 'desc').limit(60).onSnapshot(onQ, () => {}), db.collection('mod').onSnapshot(onQ, () => {})];
  let first = true;
  const save = async () => {
    const n = Object.assign({}, rec, { name: 'Bot ' + uid, updatedAt: Date.now() }), [pub, ext] = split(n), b = db.batch(), now = firebase.firestore.FieldValue.serverTimestamp();
    const x = first || Math.random() < xPerSave;
    b.set(db.doc('nations/' + uid), { v: 1, j: JSON.stringify(pub), reg: 'meridian', name: n.name, updatedAt: n.updatedAt, ts: now });
    b.set(db.doc('summaries/' + uid), { reg: 'meridian', name: n.name, pop: 1e6, t: n.updatedAt });
    if (x) b.set(db.doc('nationx/' + uid), { j: JSON.stringify(ext), t: n.updatedAt, ts: now });
    try { await b.commit(); S.writes += x ? 3 : 2; first = false; } catch (e) { /* paced: try at the next turn */ }
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
const rec = JSON.parse(sample), [pub0, ext0] = split(rec);
for (const k of ['loc', 'claims', 'cities']) delete rec[k]; // the bots keep a nation's size, not its place on the map
const sharedJson = JSON.stringify(pub0).length, privateJson = JSON.stringify(ext0).length;
log('a newly founded nation saves', sample.length, 'characters of JSON:', sharedJson, 'shared and', privateJson, 'private');

/* the save pace of the real clients, before the bots join: half idle and half playing, for two minutes */
const s0 = await Promise.all(reals.map(r => stat(r.p)));
const pl = reals.filter(r => r.active).map(r => play(r.p, stop));
await sleep(CAL);
const s1 = await Promise.all(reals.map(r => stat(r.p)));
const spc = reals.map((r, i) => s1[i].saves - s0[i].saves), xs = reals.reduce((a, r, i) => a + s1[i].xw - s0[i].xw, 0), sv = spc.reduce((a, b) => a + b, 0);
const savesPerMin = Math.max(0.1, sv / REAL / (CAL / 60e3)), xPerSave = sv ? Math.min(1, xs / sv) : 1;
const gapMs = Math.round(60000 / savesPerMin);
log('saves in the first two minutes per real client', JSON.stringify(spc), '(private half in', Math.round(xPerSave * 100) + '%) → a bot saves every', Math.round(gapMs / 1000), 's');

/* the bots */
const [host, port] = FS_HOST.split(':');
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: +port } });
const bots = [];
for (let i = 0; i < BOTS; i++) bots.push(bot(env.authenticatedContext('bot' + i).firestore(), 'bot' + i, rec, gapMs, xPerSave, stop));
log('bots running; warming up for', WARM / 1000, 's');
await sleep(WARM);

/* the measured window */
const a0 = await Promise.all(reals.map(r => stat(r.p))), b0 = bots.map(b => Object.assign({}, b.S)), t0 = Date.now();
log(`measuring for ${MIN} minutes`);
await sleep(MIN * 60e3);
const a1 = await Promise.all(reals.map(r => stat(r.p))), b1 = bots.map(b => Object.assign({}, b.S)), hrs = (Date.now() - t0) / 3600e3;
const realSaves = reals.map((r, i) => Math.round((a1[i].saves - a0[i].saves) / hrs));
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
const out = { when: new Date().toISOString(), players, real: REAL, bots: BOTS, minutes: MIN, nationJson: sample.length, sharedJson, privateJson, savesPerMinPerPlayer: +savesPerMin.toFixed(2), gapMs,
  xPerSave: +xPerSave.toFixed(2), writesPerSave: 2 + xPerSave, realSavesPerHour: realSaves,
  perPlayerHour: { idle, active, bot: botAvg }, regionHour: region, month24h: m24, month8hDay: m8, pageErrors: errors.slice(0, 10) };
fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify(out, null, 2));
log('result', JSON.stringify(out, null, 1));
report(Object.assign(out, { gapMs }));
log('wrote docs/cost-test.md');
await env.cleanup();
process.exit(0);

/* the report: what was measured, and what the same pattern costs with more players online in a region and
   with bigger nations, before (test/cost-baseline.json) and now. Every save goes to every other player in the
   region, so reads per player per hour are about (players - 1) x saves per hour, and the data is those reads
   times the size of the shared half of a nation. */
function report(out) {
  /* nation sizes for the projections: whole record and its shared half. Eternia, played for a day, was measured on
     the live site on 2026-10-27; the mature record is an estimate, with the same share as Eternia. */
  const SIZES = [['played a day (Eternia)', 12809, 9688], ['mature (40 KB, estimate)', 40000, 30250]];
  const f = (v, d = 0) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (a, b) => Math.round((1 - b / a) * 100) + '%';
  const { idle, active, bot } = out.perPlayerHour, region = out.regionHour, m8 = out.month8hDay, m24 = out.month24h, P = out.players, B = BEFORE;
  /* a run's pace and bytes per read, per character of what the region downloads (the shared half) */
  const model = o => ({ sph: o.savesPerMinPerPlayer * 60, wps: o.writesPerSave || 2, ratio: o.regionHour.mb * 1048576 / Math.max(1, o.regionHour.reads) / (o.sharedJson || o.nationJson) });
  const proj = (m, N, size) => { const reads = N * (N - 1) * m.sph * 720, writes = N * m.sph * m.wps * 720, gib = reads * size * m.ratio / 1073741824, d = 30;
    const cost = Math.max(0, reads - FREE.reads * d) * PRICE.read + Math.max(0, writes - FREE.writes * d) * PRICE.write + Math.max(0, gib - 10) * PRICE.gib;
    return { reads, gib, cost }; };
  const mb = model(B), ma = model(out), rows = [];
  for (const N of [50, 100, 250]) for (const [lab, whole, shared] of [['new (' + f(out.nationJson / 1000, 1) + ' KB)', out.nationJson, out.sharedJson], ...SIZES]) {
    const b = proj(mb, N, whole), a = proj(ma, N, shared);
    rows.push(`| ${N} | ${lab} | ${f(b.reads / 1e6, 1)} → ${f(a.reads / 1e6, 1)} million | ${f(b.gib)} → ${f(a.gib)} | $${f(b.cost)} | $${f(a.cost)} | ${pct(b.cost, a.cost)} |`); }
  const bp = B.perPlayerHour, bpr = B.regionHour;
  const md = `# Cost test

Run on ${out.when.slice(0, 10)} with \`node test/load.mjs\` on the Firebase emulators: ${P} players in one region for
${out.minutes} measured minutes, after a minute of warming up. ${out.real} were real game clients in Chromium (half idle,
half playing: deciding edicts, visiting nations, posting on the board), with every Firestore read and write counted
inside the page. The other ${out.bots} were Node clients doing what the game does to the database: the game's four live
listeners (the region's nations, space, the region board, moderation) and a nation save every
${Math.round(out.gapMs / 1000)} seconds, the average pace of the real clients over their first two minutes
(${f(out.savesPerMinPerPlayer, 2)} saves a minute: idle players save nothing, playing ones at most once a minute, or
within two seconds of something another player waits for).

A newly founded nation is ${f(out.nationJson)} characters of JSON, of which the region downloads the shared half,
${f(out.sharedJson)} characters (src/shim.js keeps the other ${f(out.privateJson)} in nationx/, read only when a page
of that nation is opened). The real clients rewrote the private half in ${Math.round(out.xPerSave * 100)}% of their
saves. Prices are Firestore's for eur3: reads $0.06 and writes $0.18 per 100,000, data sent to the internet $0.12 per
GiB, beyond the free quota (50,000 reads and 20,000 writes a day, 10 GiB of data a month).

## Before and after

Before (${B.when.slice(0, 10)}): every save sent the whole record to the region, at most every 15 seconds. Now: the
shared half only, at most once a minute (fixes 1 and 3 below).

| Per hour | Before | Now | Saved |
|---|---:|---:|---:|
| Saves per player (average) | ${f(B.savesPerMinPerPlayer * 60)} | ${f(out.savesPerMinPerPlayer * 60)} | ${pct(B.savesPerMinPerPlayer, out.savesPerMinPerPlayer)} |
| Reads per player | ${f(bp.bot.reads)} | ${f(bot.reads)} | ${pct(bp.bot.reads, bot.reads)} |
| Data per player (MB) | ${f(bp.bot.mb, 1)} | ${f(bot.mb, 1)} | ${pct(bp.bot.mb, bot.mb)} |
| Region reads | ${f(bpr.reads)} | ${f(region.reads)} | ${pct(bpr.reads, region.reads)} |
| Region writes | ${f(bpr.writes)} | ${f(region.writes)} | ${pct(bpr.writes, region.writes)} |
| Region data (GiB) | ${f(bpr.mb / 1024, 2)} | ${f(region.mb / 1024, 2)} | ${pct(bpr.mb, region.mb)} |
| **A month, 8 hours a day** | **$${f(B.month8hDay.cost, 2)}** | **$${f(m8.cost, 2)}** | **${pct(B.month8hDay.cost, m8.cost)}** |
| **A month, around the clock** | **$${f(B.month24h.cost, 2)}** | **$${f(m24.cost, 2)}** | **${pct(B.month24h.cost, m24.cost)}** |

## Measured, per player per hour

| | Reads | Writes | Data received (MB) |
|---|---:|---:|---:|
| Idle game client | ${f(idle.reads)} | ${f(idle.writes)} | ${f(idle.mb, 1)} |
| Playing game client | ${f(active.reads)} | ${f(active.writes)} | ${f(active.mb, 1)} |
| Node player | ${f(bot.reads)} | ${f(bot.writes)} | ${f(bot.mb, 1)} |

In the measured window the real clients saved ${out.realSavesPerHour.join(', ')} times an hour each (idle ones first).

## Measured, the whole region (${P} players)

| | Reads | Writes | Data (GiB) | Cost beyond the free quota |
|---|---:|---:|---:|---:|
| One hour | ${f(region.reads)} | ${f(region.writes)} | ${f(region.mb / 1024, 2)} | |
| A month, 8 hours a day | ${f(m8.reads)} | ${f(m8.writes)} | ${f(m8.gib, 1)} | $${f(m8.cost, 2)} |
| A month, around the clock | ${f(m24.reads)} | ${f(m24.writes)} | ${f(m24.gib, 1)} | $${f(m24.cost, 2)} |

## What drives the bill

Almost all of it is one listener: every player listens to the shared halves of every nation in the region, so each
save is read by every other player there. Reads per player per hour are about (players online in the region − 1) ×
saves per hour, so a region's reads grow with the square of the players online in it, and the data sent grows with the
size of a nation's shared half as well. Writes are small.

## Projected: one region, a month around the clock

Before at the earlier run's pace and whole records; now at this run's pace and shared halves. Eternia's shared half
(${f(SIZES[0][2])} of ${f(SIZES[0][1])} characters) was measured on the live site; the mature record is an estimate.

| Players online at once | Nation | Reads | Data (GiB) | Before | Now | Saved |
|---:|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

Spread the same players over more regions and the cost falls: 250 players in five regions of 50 cost five times the
first rows, not the square.

## What would bring it down

1. **Done: send other players the shared half, not the whole nation.** The edict engine, notices seen, tallies,
   intelligence, lore and the passport's stamps live in nationx/, read when someone opens that nation's pages. The
   shared half is still most of a played record: the edict history, provinces, cabinet, museum, achievements and
   messages are read across the region (the Dispatch, the Flock, the region page).
2. **Compress the shared half.** The JSON compresses to about a fifth of its size, which would cut the data by about
   80% (the reads stay the same).
3. **Done: publish less often.** At most once a minute instead of every 15 seconds, and within two seconds for what
   another player waits for (messages, offers, declarations, votes, bids, claims). A player making several changes a
   minute now costs the region a quarter of what they did.
4. **Keep regions smaller while they fill.** Steering newcomers to emptier regions sooner keeps the square small.
5. **Skip the shared write when only private or running figures changed.** Many saves change only the private half,
   or population and stock, which other players work out from the last save anyway. Writing the private half alone
   then (with a save of the shared half at least every 15 minutes, so the nation does not look dormant) would cut the
   reads further.
`;
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'cost-test.md'), md);
}
