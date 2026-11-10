// The flag competition on the server (functions/flagcomp.js), against the emulators: a whole month from the first entry
// to the podium, with the competition's clock moved by flagcTest/clock (honoured in the emulators only).
//   npm run test:flagcomp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum', AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth(), DAY = 86400000, M = '2031-01';

async function sign(method, data) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, returnSecureToken: true }) });
  const b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return { uid: b.localId, token: b.idToken };
}
async function player(name, { linked = true, old = true, reg = 'meridian' } = {}) {
  let p;
  if (linked) { const email = `fc-${crypto.randomUUID()}@example.test`, password = 'test-only-password'; await auth.createUser({ email, password, emailVerified: true }); p = await sign('signInWithPassword', { email, password }); }
  else p = await sign('signUp', {});
  await db.doc('nations/' + p.uid).set({ v: 1, j: JSON.stringify({ reg, name, pop: 10, s: { civil: 50, econ: 50, pol: 50 } }), reg, name, pop: 10, army: 1, cl: 0, updatedAt: Date.now(), rev: 1, ts: new Date() });
  if (old) { const s = await db.doc('nations/' + p.uid).get(); await db.doc('accountIdentity/' + p.uid).set({ nationAt: Date.now() - 2 * DAY, nationGeneration: s.createTime.toMillis() }, { merge: true }); }
  return { ...p, name };
}
async function civic(p, data) {
  const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/civic`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.token }, body: JSON.stringify({ data }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.details?.code, status: b.error.status }); return b.result;
}
const rejects = (p, code) => assert.rejects(p, e => e.code === code || e.status === code, code);
const clockTo = t => db.doc('flagcTest/clock').set({ skew: t - Date.now() });
const flag = i => ({ p: 'tri-v', c: ['#0F6E67', '#FFFFFF', '#15245' + i], e: 'star', ec: '#C8102E' });

test('a month of the flag competition: enter, score blind, and the podium with its prizes', async () => {
  const [A, B, C, D, E, F] = await Promise.all(['Aland', 'Bland', 'Cland', 'Dland', 'Eland', 'Fland'].map((n, i) => player(n, { reg: i % 2 ? 'aurelia' : 'meridian' })));
  const guest = await player('Guestland', { linked: false }), young = await player('Youngland', { old: false });

  /* entries: the first week */
  await clockTo(Date.UTC(2031, 0, 14, 12));
  let st = await civic(A, { op: 'fcState' });
  assert.equal(st.id, M); assert.equal(st.phase, 'enter'); assert.equal(st.n, 0); assert.equal(st.mine, null); assert.equal(st.t.open, Date.UTC(2031, 0, 12)); assert.equal(st.t.judge, Date.UTC(2031, 0, 19)); assert.equal(st.t.end, Date.UTC(2031, 1, 12));
  await rejects(civic(guest, { op: 'fcEnter', fl: flag(0) }), 'registration_required');
  await rejects(civic(A, { op: 'fcEnter', fl: { x: '<svg onload=1>' } }), 'INVALID_ARGUMENT');
  await rejects(civic(A, { op: 'fcEnter' }), 'INVALID_ARGUMENT');
  await rejects(civic(A, { op: 'fcNext' }), 'fc_not_judging');
  const firsts = [];
  for (const [i, p] of [A, B, C, D, E, F].entries()) firsts.push((await civic(p, { op: 'fcEnter', fl: flag(i) })).first);
  assert.deepEqual(firsts, [true, false, false, false, false, false], 'the server says whose flag was the first one in');
  await civic(young, { op: 'fcEnter', fl: flag(7) });   // a new nation may enter; it may not judge
  assert.equal((await civic(A, { op: 'fcEnter', fl: flag(9) })).first, false);   // entering again replaces the design, and is nobody's first
  assert.deepEqual(await civic(F, { op: 'fcWithdraw' }), { ok: true });
  assert.deepEqual(await civic(F, { op: 'fcWithdraw' }), { ok: false });
  assert.deepEqual(await civic(young, { op: 'fcWithdraw' }), { ok: true });
  st = await civic(A, { op: 'fcState' });
  assert.equal(st.n, 5, 'five flags are in'); assert.equal(JSON.parse(st.mine.fl).c[2], '#152459', 'A sees its own, replaced, design'); assert.equal(st.duty, 4);
  assert.equal((await db.collection(`flagc/${M}/flags`).get()).size, 5);

  /* judging: five days */
  await clockTo(Date.UTC(2031, 0, 20));
  assert.equal((await civic(A, { op: 'fcState' })).phase, 'judge');
  await rejects(civic(F, { op: 'fcEnter', fl: flag(5) }), 'fc_closed');
  await rejects(civic(A, { op: 'fcWithdraw' }), 'fc_closed');
  await rejects(civic(guest, { op: 'fcNext' }), 'registration_required');
  await rejects(civic(young, { op: 'fcNext' }), 'nation_too_young');
  const owner = new Map((await db.collection(`flagc/${M}/flags`).get()).docs.map(f => [f.id, f.get('u')])), mine = p => [...owner].find(([e, u]) => u === p.uid)[0];
  const dealt = await civic(A, { op: 'fcNext' });
  assert.equal(dealt.flags.length, 4, 'every flag but its own'); assert.ok(!dealt.flags.some(f => f.id === mine(A)));
  for (const f of dealt.flags) { assert.deepEqual(Object.keys(f).sort(), ['fl', 'id'], 'a design and nothing about its owner'); assert.ok(JSON.parse(f.fl).p); }
  await rejects(civic(A, { op: 'fcRate', e: mine(A), s: [5, 5, 5, 5, 5] }), 'fc_own');
  await rejects(civic(A, { op: 'fcRate', e: mine(B), s: [5, 5, 5, 5] }), 'INVALID_ARGUMENT');
  await rejects(civic(A, { op: 'fcRate', e: mine(B), s: [5, 5, 5, 5, 6] }), 'INVALID_ARGUMENT');
  await rejects(civic(A, { op: 'fcRate', e: 'x'.repeat(20), s: [5, 5, 5, 5, 5] }), 'fc_gone');
  await rejects(civic(young, { op: 'fcRate', e: mine(B), s: [5, 5, 5, 5, 5] }), 'nation_too_young');
  /* B's flag is the best, then C's, D's, A's; E scores one flag only and so is out of the running */
  const worth = new Map([[B.uid, 5], [C.uid, 4], [D.uid, 3], [A.uid, 2], [E.uid, 1]]);
  for (const j of [A, B, C, D, F]) for (const [e, u] of owner) if (u !== j.uid) { const v = worth.get(u); await civic(j, { op: 'fcRate', e, s: [v, v, v, v, v] }); }
  await civic(E, { op: 'fcRate', e: mine(B), s: [5, 5, 5, 5, 5] });
  const again = await civic(A, { op: 'fcRate', e: mine(B), s: [5, 5, 5, 5, 4] });   // a change of mind is not a second rating
  assert.equal(again.judged, 4);
  assert.equal((await db.doc(`flagc/${M}/flags/${mine(B)}`).get()).get('n'), 5, 'A, C, D, F and E scored B’s flag, once each');
  assert.deepEqual((await civic(A, { op: 'fcNext' })).flags, [], 'nothing left to score');
  assert.equal((await civic(A, { op: 'fcState' })).judged, 4);
  assert.equal((await db.doc('flagc/' + M).get()).get('st'), 'open', 'nothing is published while judging runs');

  /* the results */
  await clockTo(Date.UTC(2031, 0, 25));
  st = await civic(guest, { op: 'fcState' });
  assert.equal(st.phase, 'done');
  const sum = await db.doc('flagc/' + M).get(), res = sum.get('res');
  assert.equal(sum.get('st'), 'done'); assert.equal(sum.get('hw'), 1); assert.equal(res.club, 1);
  assert.deepEqual(res.top.map(r => r.nm), ['Bland', 'Cland', 'Dland']);
  assert.deepEqual(res.top.map(r => r.u), [B.uid, C.uid, D.uid]);
  assert.equal(res.top[0].rg, 'aurelia'); assert.ok(JSON.parse(res.top[0].fl).p); assert.equal(res.top[0].n, 5); assert.equal(res.top[1].s, 4); assert.equal(res.all, 4);
  const hall = new Map((await db.collection(`flagc/${M}/hall`).get()).docs.map(h => [h.get('nm'), h.data()]));
  assert.equal(hall.size, 5); assert.equal(hall.get('Aland').pl, 4); assert.equal(hall.get('Eland').pl, 0); assert.equal(hall.get('Eland').why, 'duty'); assert.equal(hall.get('Bland').pl, 1);
  /* the winner's month of the Chancery Club, once */
  const prize = await db.doc('shopPrize/' + B.uid).get();
  assert.deepEqual(Object.keys(prize.get('m')), ['fc-' + M]);
  const vip = (await db.doc('shop/' + B.uid).get()).get('vip');
  assert.ok(vip && vip.plan === 'gift' && vip.until > vip.from, JSON.stringify(vip));
  assert.equal((await db.doc('shopPrize/' + C.uid).get()).exists, false, 'only the winner');
  await civic(A, { op: 'fcState' }); await civic(B, { op: 'fcState' });
  assert.deepEqual((await db.doc('shopPrize/' + B.uid).get()).get('m'), prize.get('m'), 'asking again grants nothing more');
  await rejects(civic(A, { op: 'fcRate', e: mine(B), s: [1, 1, 1, 1, 1] }), 'fc_not_judging');
  await rejects(civic(A, { op: 'fcEnter', fl: flag(1) }), 'fc_closed');

  /* the podium stands until the 12th of the next month */
  await clockTo(Date.UTC(2031, 1, 11, 23));
  st = await civic(A, { op: 'fcState' });
  assert.equal(st.id, M); assert.equal(st.phase, 'done');
  /* the next competition begins empty, and the old results stay */
  await clockTo(Date.UTC(2031, 1, 13));
  st = await civic(A, { op: 'fcState' });
  assert.equal(st.id, '2031-02'); assert.equal(st.phase, 'enter'); assert.equal(st.n, 0); assert.equal(st.mine, null); assert.equal(st.judged, 0);
  assert.equal((await db.doc('flagc/' + M).get()).get('res').top[0].nm, 'Bland');
});

test('a competition nobody closed in time is closed by the next visitor, and staff may take a flag out', async () => {
  const [P, Q, R] = await Promise.all(['Pland', 'Qland', 'Rland'].map(n => player(n))), staff = await player('Staffland');
  await auth.setCustomUserClaims(staff.uid, { admin: true });
  const admin = { ...staff, token: (await sign('signInWithCustomToken', { token: await auth.createCustomToken(staff.uid, { admin: true }) })).token };
  await clockTo(Date.UTC(2031, 4, 13));
  for (const [i, p] of [P, Q, R].entries()) await civic(p, { op: 'fcEnter', fl: flag(i) });
  const eid = async p => (await db.doc(`flagc/2031-05/mine/${p.uid}`).get()).get('e');
  await rejects(civic(P, { op: 'fcRemove', e: await eid(R) }), 'PERMISSION_DENIED');
  assert.deepEqual(await civic(admin, { op: 'fcRemove', e: await eid(R) }), { ok: true });
  assert.equal((await civic(P, { op: 'fcState' })).n, 2);
  await clockTo(Date.UTC(2031, 4, 21));
  await civic(P, { op: 'fcRate', e: await eid(Q), s: [4, 4, 4, 4, 4] }); await civic(Q, { op: 'fcRate', e: await eid(P), s: [3, 3, 3, 3, 3] });
  await civic(R, { op: 'fcRate', e: await eid(Q), s: [5, 5, 5, 5, 5] }); await civic(R, { op: 'fcRate', e: await eid(P), s: [3, 3, 3, 3, 3] });
  /* nobody opens the page until the next competition's entries are open */
  await clockTo(Date.UTC(2031, 5, 14));
  const st = await civic(P, { op: 'fcState' });
  assert.equal(st.id, '2031-06'); assert.equal(st.phase, 'enter');
  const res = (await db.doc('flagc/2031-05').get()).get('res');
  assert.deepEqual(res.top.map(r => r.nm), ['Qland', 'Pland'], 'two flags, two places');
  assert.ok((await db.doc('shopPrize/' + Q.uid).get()).get('m')['fc-2031-05']);
  await db.doc('flagcTest/clock').delete();
});
