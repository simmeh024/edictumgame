// The shop's Firestore rules: what a player owns is the server's to write and theirs alone to read; the public list
// of shop cosmetics is read by everyone and written by nobody; presets and the Chronicle are written only while a
// member and stay readable after; billing records are closed to every player; a desk of ten edicts cannot be cut back
// by an older build.   npm run test:rules
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('error');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const NOW = () => firebase.firestore.FieldValue.serverTimestamp();
const AGO = ms => firebase.firestore.Timestamp.fromMillis(Date.now() - ms);
let env;
const as = uid => env.authenticatedContext(uid).firestore(), anon = () => env.unauthenticatedContext().firestore();
const seed = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const preset = (n = 'State occasions') => ({ n, cz: { p: 'p-firsted', f: 'f-engraver' }, fj: '{"p":"plain"}', t: Date.now() });

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-edictum-shop-rules', firestore: { rules } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async db => {
    await db.doc('shop/member').set({ owns: { founder: 1 }, vip: { until: Date.now() + 30 * 864e5, runs: [{ s: 1, e: Date.now() + 30 * 864e5 }] }, picks: {} });
    await db.doc('shop/lapsed').set({ owns: {}, vip: { until: Date.now() - 1000 }, picks: { 1: 'p-moire' } });
    await db.doc('presets/lapsed').set({ p: { 1: preset('Old look'), 2: preset('Second') } });
    await db.doc('chron/lapsed/m/2026-10').set({ d: { '1_x': { i: 'x', t: 1 } }, s: {} });
    await db.doc('finery/member').set({ c: ['bg-founder'], reg: 'meridian' });
    for (const c of ['shopTx/txn_1', 'shopSubs/sub_1', 'shopAdj/adj_1', 'shopCheckouts/txn_1', 'shopAcct/member', 'shopCustomers/ctm_1', 'shopEvents/evt_1', 'shopLimits/member', 'authConfig/paddle'])
      await db.doc(c).set({ uid: 'member', secret: 'x' });
  });
});

test('ownership: written by the server alone, read by its player alone; the public list is read by all, written by none', async () => {
  await assertSucceeds(as('member').doc('shop/member').get());
  await assertFails(as('lapsed').doc('shop/member').get());
  await assertFails(anon().doc('shop/member').get());
  for (const db of [as('member'), as('lapsed')]) {
    await assertFails(db.doc('shop/member').set({ owns: { founder: 1, idpack: 1 }, vip: { until: 9e15 } }));
    await assertFails(db.doc('shop/member').update({ 'vip.until': 9e15 }));
    await assertFails(db.doc('shop/newcomer').set({ owns: { founder: 1 } }));
    await assertFails(db.doc('finery/member').set({ c: ['bg-founder', 'te-gilt'], reg: 'meridian' }));
  }
  await assertFails(as('forger').doc('finery/forger').set({ c: ['te-gilt'], reg: 'meridian' }));
  await assertFails(as('member').doc('shop/member').delete());
  await assertSucceeds(anon().doc('finery/member').get());
  await assertSucceeds(as('lapsed').collection('finery').where('reg', '==', 'meridian').get());
});

test('billing records, checkouts, customers, notifications and the Paddle settings are closed to every player', async () => {
  for (const c of ['shopTx/txn_1', 'shopSubs/sub_1', 'shopAdj/adj_1', 'shopCheckouts/txn_1', 'shopAcct/member', 'shopCustomers/ctm_1', 'shopEvents/evt_1', 'shopLimits/member', 'authConfig/paddle']) {
    await assertFails(as('member').doc(c).get());
    await assertFails(as('member').doc(c).set({ uid: 'member' }));
  }
  await assertFails(as('member').collection('shopTx').where('uid', '==', 'member').get());
});

test('presets: made and overwritten only by a member; after the membership they still load and can be removed, never added', async () => {
  await assertSucceeds(as('member').doc('presets/member').set({ p: { 1: preset() } }));
  await assertSucceeds(as('member').doc('presets/member').set({ p: { 1: preset('Changed'), 5: preset() } }));
  await assertFails(as('member').doc('presets/member').set({ p: { 6: preset() } }));
  await assertFails(as('member').doc('presets/member').set({ p: { 1: { ...preset(), n: 'x'.repeat(41) } } }));
  await assertFails(as('member').doc('presets/member').set({ p: { 1: { ...preset(), extra: 1 } } }));
  await assertFails(as('member').doc('presets/member').set({ p: { 1: preset() }, other: 1 }));
  await assertFails(as('nonmember').doc('presets/nonmember').set({ p: { 1: preset() } }));
  await assertFails(as('member').doc('presets/lapsed').get());
  const lapsed = as('lapsed');
  await assertSucceeds(lapsed.doc('presets/lapsed').get());
  await assertFails(lapsed.doc('presets/lapsed').set({ p: { 1: preset('Old look'), 2: preset('Second'), 3: preset() } }), 'no new preset after');
  await assertFails(lapsed.doc('presets/lapsed').set({ p: { 1: preset('Overwritten'), 2: preset('Second') } }), 'no overwrite after');
  const kept = (await lapsed.doc('presets/lapsed').get()).data().p;
  await assertSucceeds(lapsed.doc('presets/lapsed').set({ p: { 1: kept[1] } }), 'removing one is allowed');
  await assertSucceeds(lapsed.doc('presets/lapsed').delete());
});

test('the Chronicle: private, written only while a member, read-only after; months only', async () => {
  await assertSucceeds(as('member').doc('chron/member/m/2026-11').set({ d: { '5_a': { i: 'a', t: 5 } } }, { merge: true }));
  await assertSucceeds(as('member').doc('chron/member/m/2026-11').set({ s: { '2026-11-02': { p: 1, c: 'x', s: {} } } }, { merge: true }));
  await assertFails(as('member').doc('chron/member/m/notamonth').set({ d: {} }));
  await assertFails(as('member').doc('chron/member/m/2026-11').set({ d: {}, x: 1 }, { merge: true }));
  await assertFails(as('member').doc('chron/lapsed/m/2026-10').get());
  await assertFails(anon().doc('chron/member/m/2026-11').get());
  await assertSucceeds(as('lapsed').doc('chron/lapsed/m/2026-10').get());
  await assertFails(as('lapsed').doc('chron/lapsed/m/2026-10').set({ d: { '9_b': { i: 'b', t: 9 } } }, { merge: true }));
  await assertFails(as('nonmember').doc('chron/nonmember/m/2026-11').set({ d: {} }));
  await assertSucceeds(as('lapsed').doc('chron/lapsed/m/2026-10').delete());
});

/* the documents src/shim.js writes for one save, approved as civic() approves them */
const nation = (name, extra = {}) => { const rec = { name, reg: 'meridian', updatedAt: Date.now(), pop: 1200 }; return { v: 1, j: JSON.stringify(rec), reg: 'meridian', name, updatedAt: rec.updatedAt, ts: NOW(), pop: 1200, army: 40, cl: 3, ...extra }; };
async function save(uid, n) {
  await seed(async db => {
    const cur = await db.doc('nations/' + uid).get();n.rev = (cur.exists && cur.data().rev || 0) + 1;n.permit = crypto.randomUUID();
    const f = Object.fromEntries(['j', 'reg', 'name', 'pop', 'army', 'cl', 'updatedAt', 'rev'].map(k => [k, n[k]]));
    await db.doc('nationPermits/' + uid + '/requests/' + n.permit).set({ ...f, exp: firebase.firestore.Timestamp.fromMillis(Date.now() + 120000) });
  });
  const db = as(uid), b = db.batch();
  b.set(db.doc('nations/' + uid), n);b.set(db.doc('summaries/' + uid), { reg: 'meridian', name: n.name, pop: n.pop, t: n.updatedAt });
  b.set(db.doc('nationx/' + uid), { j: JSON.stringify({ inbox: [] }), t: n.updatedAt, ts: NOW() });
  return b.commit();
}
test('a desk that has held more than five edicts (iq) can no longer be saved by a build that would cut it back', async () => {
  await seed(async db => { const n = nation('Deskland', { ts: AGO(60000), rev: 1 }); await db.doc('nations/desk').set(n); await db.doc('summaries/desk').set({ reg: 'meridian', name: 'Deskland', pop: 1200, t: n.updatedAt }); });
  await assertSucceeds(save('desk', nation('Deskland')), 'an ordinary save, before any long queue');
  await new Promise(r => setTimeout(r, 1100));
  await assertSucceeds(save('desk', nation('Deskland', { iq: 1 })), 'the first save with ten waiting');
  await new Promise(r => setTimeout(r, 1100));
  await assertFails(save('desk', nation('Deskland')), 'an older build, without the marker');
  for (const iq of [0, 2, '1']) await assertFails(save('desk', nation('Deskland', { iq })));
  await assertSucceeds(save('desk', nation('Deskland', { iq: 1 })));
});
