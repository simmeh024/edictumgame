// The daily currency job against the Firestore emulator: what it reads and writes, that a day is never done
// twice, that two runs at once do it once, that history accumulates, and that it touches nothing else.
//   firebase emulators:exec --project demo-edictum --only firestore "node --test test/fx-job.test.mjs"
// The job runs here with the client SDK, with the rules switched off, as the Admin SDK runs it in production.
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';
import { runCurrencyDay, isoDay, dayNum } from '../jobs/fx/daily.mjs';
import { loadWorld } from '../jobs/fx/world.mjs';
import { STAT_KEYS, DAY, counterfeitsOf, indicators, prestigeFactors } from '../jobs/fx/engine.mjs';

setLogLevel('error');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const WORLD = loadWorld(), T0 = Date.UTC(2026, 10, 2, 0, 20);
let env;

const stats = v => Object.fromEntries(STAT_KEYS.map((k, i) => [k, typeof v === 'function' ? v(i) : v]));
/* a nation as src/shim.js stores it: the shared half as JSON text, with its copies for queries */
function nationDoc(name, reg, over = {}, now = T0) {
  const rec = Object.assign({ name, reg, founded: now - 200 * DAY, updatedAt: now - 3600e3, pop: 12, popAt: now - DAY, s: stats(i => 30 + (i * 7) % 50),
    policies: { centralBankIndependence: true }, budget: {}, deals: [], wars: {}, peace: {}, log: [], stock: { food: 12, iron: 3 },
    hist: [{ t: now - 3 * DAY, p: 11.9, s: STAT_KEYS.map(() => 45), e: 1 }, { t: now - DAY, p: 12, s: STAT_KEYS.map(() => 47), e: 1.05 }] }, over);
  return { v: 1, j: JSON.stringify(rec), reg, name, updatedAt: rec.updatedAt, ts: new Date(now) };
}
const asAdmin = async fn => { let r; await env.withSecurityRulesDisabled(async ctx => { r = await fn(ctx.firestore()); }); return r; };
const read = path => asAdmin(async db => { const s = await db.doc(path).get(); return s.exists ? s.data() : null; });
const run = opts => asAdmin(db => runCurrencyDay(db, Object.assign({ world: WORLD }, opts)));
const pubOf = async reg => { const d = await read('fx/' + reg); return d ? JSON.parse(d.j) : null; };

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-fx-job', firestore: { rules } }); });
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await asAdmin(async db => {
    const b = db.batch();
    b.set(db.doc('nations/uid-eternia'), nationDoc('Eternia', 'meridian', { deals: [{ id: 'd1', w: 'uid-vale', g: ['food', 4], r: ['iron', 2], t: T0 - 5 * DAY }, { id: 'd2', w: 'npc-vellmark', g: ['timber', 2], r: ['oil', 1], t: T0 - 5 * DAY }] }));
    b.set(db.doc('nations/uid-vale'), nationDoc('Vale', 'meridian', { deals: [{ id: 'd1', w: 'uid-eternia', g: ['iron', 2], r: ['food', 4], t: T0 - 5 * DAY, a: 1 }] }));
    b.set(db.doc('nations/uid-frost'), nationDoc('Frostia', 'frostmarch'));
    b.set(db.doc('nations/uid-gone'), nationDoc('Longgone', 'meridian', { updatedAt: T0 - 300 * DAY }));
    b.set(db.doc('nations/uid-hidden'), nationDoc('Hidden', 'meridian'));
    b.set(db.doc('nations/uid-removed'), nationDoc('Removed', 'meridian'));
    b.set(db.doc('nations/uid-broken'), { v: 1, j: '{not json', reg: 'meridian', name: 'Broken', updatedAt: T0, ts: new Date(T0) });
    b.set(db.doc('mod/uid-hidden'), { hidden: true, t: T0, by: 'admin' });
    b.set(db.doc('mod/uid-removed'), { hidden: false, removed: T0, t: T0, by: 'admin' });
    await b.commit();
  });
});

test('counterfeiting reaches an absent nation’s daily rating, respects defence and expires without changing its save', async () => {
  const attacker=JSON.parse((await read('nations/uid-eternia')).j),target=JSON.parse((await read('nations/uid-vale')).j);
  target.policies.counterIntel=true;
  const op={id:'forged',k:'c',tg:'uid-vale',t:T0-60000,rg:'meridian',p:0.9,x:0.3};
  while(!counterfeitsOf(new Map([['uid-eternia',{...attacker,cov:[op]}],['uid-vale',target]]),T0,'meridian').has('uid-vale'))op.id+='a';
  await asAdmin(async db=>{
    await db.doc('nations/uid-eternia').update({j:JSON.stringify({...attacker,cov:[op,{...op,id:op.id+'b'}]})});
    await db.doc('nations/uid-vale').update({j:JSON.stringify(target)});
  });
  const saved=(await read('nations/uid-vale')).j;
  await run({now:T0,regions:['meridian']});
  const pub=await pubOf('meridian');
  const I=indicators('uid-vale',target,T0,{}),normal=prestigeFactors(I,null).mon;
  assert.equal(pub.n['uid-vale'].g[5],Math.round(Math.max(0,normal-4)*10)/10);
  assert.equal((await read('nations/uid-vale')).j,saved);
  await run({now:T0+DAY,regions:['meridian']});
  const next=await pubOf('meridian');
  assert.equal(next.n['uid-vale'].g[5],Math.round(normal*10)/10);
  assert.equal((await read('nations/uid-vale')).j,saved);
});

test('a day values every currency of the region, players’ and computer-run, and ranks them by prestige', async () => {
  const out = await run({ now: T0, regions: ['meridian'] });
  assert.equal(out.day, isoDay(dayNum(T0)));
  assert.equal(out.reports[0].reg, 'meridian');
  const doc = await read('fx/meridian'), pub = JSON.parse(doc.j);
  assert.equal(doc.day, out.day);
  assert.equal(pub.u, 'Meridian Reach');
  const ids = Object.keys(pub.n);
  for (const n of WORLD.regions[0].npcs) assert.ok(ids.includes(n.id), 'computer-run ' + n.id);
  assert.ok(ids.includes('uid-eternia') && ids.includes('uid-vale'));
  assert.ok(!ids.includes('uid-frost'), 'regions stay independent');
  assert.ok(!ids.includes('uid-gone'), 'long-dormant nations are left out');
  assert.ok(!ids.includes('uid-removed'), 'removed nations are left out');
  assert.ok(!ids.includes('uid-broken'), 'an unreadable record is skipped, not fatal');
  assert.equal(pub.n['uid-hidden'].hd, 1, 'a hidden nation is marked, so only its owner sees it');
  assert.equal(pub.n['npc-vellmark'].npc, 1);
  const ranks = ids.map(id => pub.n[id].r).sort((a, b) => a - b);
  assert.deepEqual(ranks, ids.map((_, i) => i + 1));
  for (const a of ids) for (const b of ids) if (pub.n[a].r < pub.n[b].r) assert.ok(pub.n[a].p >= pub.n[b].p);
  assert.ok(pub.n['uid-eternia'].f[3] > pub.n['uid-hidden'].f[3], 'Eternia’s live deals count for its trade');
  /* the job's state is its own; the history has one entry per currency */
  const st = await read('fxs/meridian');
  assert.equal(st.day, out.day); assert.ok(!st.lock || st.lock.until <= Date.now() + 11 * 60000);
  const h = await read('fxh/uid-eternia');
  assert.deepEqual(Object.keys(h.d), [out.day]);
  assert.equal(h.d[out.day][0], pub.n['uid-eternia'].v);
  assert.equal(h.d[out.day][1], pub.n['uid-eternia'].p);
});

test('a day already done is skipped; two runs at once do it once', async () => {
  const [a, b] = await Promise.all([run({ now: T0, regions: ['meridian'], runId: 'run-a' }), run({ now: T0, regions: ['meridian'], runId: 'run-b' })]);
  const reps = [a.reports[0], b.reports[0]];
  assert.equal(reps.filter(r => r.currencies > 0).length, 1, 'exactly one run valued the region');
  assert.ok(reps.some(r => r.skipped === 'busy' || r.skipped === 'done'));
  const before = await read('fx/meridian');
  const again = await run({ now: T0 + 3600e3, regions: ['meridian'] });
  assert.equal(again.reports[0].skipped, 'done');
  assert.deepEqual(await read('fx/meridian'), before, 'nothing rewritten');
});

test('a record is held to the population its save declared', async () => {
  await run({ now: T0, regions: ['meridian'] });
  const honest = (await pubOf('meridian')).n['uid-hidden'];
  await env.clearFirestore();
  await asAdmin(db => db.doc('nations/uid-hidden').set(Object.assign(nationDoc('Hidden', 'meridian', { pop: 50000 }), { pop: 12, army: 1, cl: 0 })));
  await run({ now: T0, regions: ['meridian'] });
  const inflated = (await pubOf('meridian')).n['uid-hidden'];
  assert.deepEqual(inflated.g, honest.g, 'fifty billion people in the record count as the twelve million the save declared');
  assert.equal(inflated.v, honest.v);
});

test('a lapsed lease from a run that died does not block the next day', async () => {
  await asAdmin(db => db.doc('fxs/meridian').set({ v: 1, day: '', t: 0, j: '{}', lock: { by: 'dead-run', until: T0 - 1000 } }));
  const out = await run({ now: T0, regions: ['meridian'] });
  assert.ok(out.reports[0].currencies > 8);
});

test('day after day: history accumulates, values move with the economy, changes are reported', async () => {
  for (let d = 0; d < 9; d++) {
    if (d === 4) await asAdmin(db => db.doc('nations/uid-vale').set(nationDoc('Vale', 'meridian', { s: stats(90), updatedAt: T0 + 4 * DAY })));
    await run({ now: T0 + d * DAY, regions: ['meridian'] });
  }
  const h = await read('fxh/uid-vale'), days = Object.keys(h.d).sort();
  assert.equal(days.length, 9);
  assert.ok(h.d[days[8]][0] > h.d[days[3]][0], 'Vale’s currency appreciated after its economy improved');
  const pub = await pubOf('meridian'), v = pub.n['uid-vale'];
  assert.ok(v.d1 != null && v.d7 > 0, 'a 7-day appreciation is reported');
  assert.ok(Array.isArray(v.why));
  assert.ok(v.sd != null, 'stability after a week');
});

test('the job never writes a nation, its summary or its trade; only fx, fxs and fxh', async () => {
  const snap = () => asAdmin(async db => { const qs = await db.collection('nations').get(); return Object.fromEntries(qs.docs.map(d => [d.id, d.data().j])); });
  const before = await snap();
  await run({ now: T0 });
  assert.deepEqual(await snap(), before);
  const cols = await asAdmin(async db => Promise.all(['fx', 'fxs', 'fxh', 'summaries'].map(async c => [c, (await db.collection(c).get()).size])));
  const m = Object.fromEntries(cols);
  assert.equal(m.fx, 26); assert.equal(m.fxs, 26); assert.equal(m.summaries, 0);
});

test('a full run deletes the history of a nation that no longer exists', async () => {
  await run({ now: T0 });
  assert.ok(await read('fxh/uid-vale'));
  await asAdmin(db => db.doc('nations/uid-vale').delete());
  const out = await run({ now: T0 + DAY });
  assert.equal(out.reports.at(-1).deletedHistories, 1);
  assert.equal(await read('fxh/uid-vale'), null);
  assert.ok(await read('fxh/uid-eternia'));
  assert.ok(await read('fxh/uid-frost'), 'a nation in another region keeps its history');
});

test('a nation that moves region keeps one history', async () => {
  await run({ now: T0 });
  const before = (await pubOf('meridian')).n['uid-vale'];
  await asAdmin(db => db.doc('nations/uid-vale').set(nationDoc('Vale', 'frostmarch', { updatedAt: T0 + DAY })));
  await run({ now: T0 + DAY });
  const h = await read('fxh/uid-vale');
  assert.equal(Object.keys(h.d).length, 2);
  assert.equal(h.reg, 'frostmarch');
  const after = (await pubOf('frostmarch')).n['uid-vale'];
  assert.ok(after);
  assert.ok(Math.abs(after.p - before.p) <= 2, 'prestige carries on from where it was, smoothed');
  assert.ok(after.d1 != null, 'and so does the value’s record');
  assert.ok(!(await pubOf('meridian')).n['uid-vale'], 'and it has left its old region');
});
