// The save in one trip (functions/civic.js, serverSave): the server checks a nation save as it checks a permit and
// writes it itself, with the checks firestore.rules made of the game's own transaction. Run against the emulators:
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions "node --test test/server-save.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { nationText } from '../functions/nationtext.js';
import { spaceStep, spaceLayout, headlineOk } from '../functions/civic.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum', AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function guest() {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return { uid: b.localId, token: b.idToken };
}
async function civic(p, data) {
  const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/civic`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.token }, body: JSON.stringify({ data }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.details?.code || b.error.status, status: b.error.status }); return b.result;
}
const rejects = (p, code) => assert.rejects(p, e => e.code === code || (code === 'permission-denied' && e.status === 'PERMISSION_DENIED'), 'expected ' + code);
const sid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), v => v.toString(16).padStart(2, '0')).join('');
/* a save as the game sends it (src/shim.js, serverSave) */
function saveOf(p, n, { rev = 0, x = { inbox: [] }, o = {}, s = '', ...more } = {}) {
  const nation = { reg: 'meridian', name: 'Land ' + p.uid.slice(0, 6), pop: 5, claims: [], ...n };
  return { op: 'save', sid: more.sid || sid(), rev, zip: 1, cap: 1, x: JSON.stringify(x), o: JSON.stringify(o), s, sum: {}, rk: [],
    record: { j: JSON.stringify(nation), reg: nation.reg, name: nation.name, pop: nation.pop, army: 1, cl: nation.claims.length, updatedAt: Date.now(), ...(more.record || {}) },
    ...Object.fromEntries(Object.entries(more).filter(([k]) => k !== 'record' && k !== 'sid')) };
}
const get = path => db.doc(path).get();

test('a save in one trip writes the shared half deflated, both private halves and the summary, with no permit', async () => {
  const p = await guest(), d = saveOf(p, { motto: 'First' }, { x: { inbox: [{ id: 'a' }] }, o: { notes: 'mine' }, sum: { f: Date.now() - 1000 } });
  const r = await civic(p, d);
  assert.equal(r.rev, 1); assert.equal(r.sv, 1);
  const n = await get('nations/' + p.uid), x = await get('nationx/' + p.uid), o = await get('nationp/' + p.uid), s = await get('summaries/' + p.uid);
  assert.equal(n.get('v'), 2); assert.equal(n.get('j'), undefined); assert.equal(JSON.parse(nationText(n)).motto, 'First');
  assert.equal(n.get('rev'), 1); assert.equal(n.get('permit'), 'sv-' + d.sid); assert.ok(n.get('ts'));
  assert.ok(JSON.parse(nationText(n)).asm, 'the Assembly record is the server\'s');
  assert.equal(x.get('j'), d.x); assert.equal(o.get('j'), d.o); assert.equal(x.get('t'), d.record.updatedAt);
  assert.deepEqual({ reg: s.get('reg'), name: s.get('name'), t: s.get('t') }, { reg: 'meridian', name: d.record.name, t: d.record.updatedAt });
  assert.ok(s.get('f') > 0);
  assert.equal((await db.collection('nationPermits/' + p.uid + '/requests').get()).size, 0);
});

test('a save from an older revision is another device\'s: save_conflict', async () => {
  const p = await guest();
  await civic(p, saveOf(p, {}));
  await sleep(1100);
  await rejects(civic(p, saveOf(p, { motto: 'stale' }, { rev: 0 })), 'save_conflict');
});

test('a save whose answer was lost is followed under the same name, never under another', async () => {
  const p = await guest(), first = saveOf(p, { motto: 'Landed' });
  await civic(p, first);
  await sleep(1100);
  /* the page never heard: it asks again from revision 0, under the same name */
  const again = await civic(p, saveOf(p, { motto: 'Asked again' }, { sid: first.sid }));
  assert.equal(again.rev, 2);
  assert.equal(JSON.parse(nationText(await get('nations/' + p.uid))).motto, 'Asked again');
  await sleep(1100);
  await rejects(civic(p, saveOf(p, { motto: 'Another device' }, { rev: 1 })), 'save_conflict');
});

test('a newer map\'s record refuses an older map\'s page: newer_map', async () => {
  const p = await guest();
  await civic(p, saveOf(p, {}, { record: { mv: 9 } }));
  await sleep(1100);
  await rejects(civic(p, saveOf(p, {}, { rev: 1, record: { mv: 8 } })), 'newer_map');
  assert.equal((await civic(p, saveOf(p, {}, { rev: 1, record: { mv: 9 } }))).rev, 2);
});

test('one save a second, as the rules held it', async () => {
  const p = await guest();
  await civic(p, saveOf(p, {}));
  await rejects(civic(p, saveOf(p, {}, { rev: 1 })), 'permission-denied');
  await sleep(1100);
  assert.equal((await civic(p, saveOf(p, {}, { rev: 1 }))).rev, 2);
});

test('the population grows no faster than the rules allow; army and land stay within its bounds', async () => {
  const p = await guest();
  await civic(p, saveOf(p, {}));
  await sleep(1100);
  await rejects(civic(p, saveOf(p, { pop: 900 }, { rev: 1 })), 'permission-denied');
  await rejects(civic(p, saveOf(p, {}, { rev: 1, record: { army: 1e6 } })), 'permission-denied');
  assert.ok(headlineOk(5, 1, 0) && !headlineOk(5, 1e6, 0) && !headlineOk(-1, 0, 0) && !headlineOk(5, 1, 1.5));
});

test('race stamps: only the claims and finds this save carries first', async () => {
  const p = await guest();
  await civic(p, saveOf(p, { claims: [{ c: 11, t: 1 }] }, { rk: ['c11', 'c99', 'x1'] }));
  assert.ok((await get('stamps/meridian/c11/' + p.uid)).exists);
  assert.equal((await get('stamps/meridian/c99/' + p.uid)).exists, false, 'a claim the record does not carry');
  await sleep(1100);
  const before = (await get('stamps/meridian/c11/' + p.uid)).get('t').toMillis();
  await civic(p, saveOf(p, { claims: [{ c: 11, t: 1 }, { c: 12, t: 2 }] }, { rev: 1, rk: ['c11', 'c12'] }));
  assert.equal((await get('stamps/meridian/c11/' + p.uid)).get('t').toMillis(), before, 'a claim carried before keeps its time');
  assert.ok((await get('stamps/meridian/c12/' + p.uid)).exists);
});

test('the space record: written when it changes (at most every 12 seconds), deleted when the nation has none', async () => {
  const p = await guest(), sj = n => JSON.stringify({ sp: { moon: { cols: n, p: Math.random() } }, belt: null, mapc: '', flag: { c: [] }, pretitle: '' });
  await civic(p, saveOf(p, {}, { s: sj(1) }));
  const t1 = (await get('space/' + p.uid)).get('ts').toMillis();
  await sleep(1100);
  await civic(p, saveOf(p, {}, { rev: 1, s: sj(2) }));
  assert.equal((await get('space/' + p.uid)).get('ts').toMillis(), t1, 'changed too soon: it waits for a later save');
  await sleep(1100);
  await civic(p, saveOf(p, {}, { rev: 2, s: '' }));
  assert.equal((await get('space/' + p.uid)).exists, false);
  /* the decision itself */
  const now = Date.now(), old = { reg: 'meridian', name: 'A', j: sj(1), ts: now - 60000 };
  assert.equal(spaceStep(sj(1), old, 'meridian', 'A', now), '', 'only the running figures differ');
  assert.equal(spaceStep(sj(2), old, 'meridian', 'A', now), 'set');
  assert.equal(spaceStep(sj(2), { ...old, ts: now - 5000 }, 'meridian', 'A', now), '');
  assert.equal(spaceStep(sj(1), { ...old, ts: now - 13 * 3600000 }, 'meridian', 'A', now), 'set', 'rewritten every 12 hours while playing');
  assert.equal(spaceStep('', old, 'meridian', 'A', now), 'delete');
  assert.equal(spaceStep('x'.repeat(60001), null, 'meridian', 'A', now), '');
  assert.equal(spaceLayout('not json'), '');
});

test('the private halves are written only when they change; storage and desk marks stay once there', async () => {
  const p = await guest(), x = { inbox: [{ id: 'kept' }] };
  await civic(p, saveOf(p, {}, { x, record: { storageV: 1, iq: 1 } }));
  const t1 = (await get('nationx/' + p.uid)).get('ts').toMillis();
  await sleep(1100);
  await civic(p, saveOf(p, {}, { rev: 1, x }));
  assert.equal((await get('nationx/' + p.uid)).get('ts').toMillis(), t1);
  const n = await get('nations/' + p.uid);
  assert.equal(n.get('storageV'), 1); assert.equal(n.get('iq'), 1);
  assert.equal((await get('nationp/' + p.uid)).exists, false, 'an empty own half is never written');
});

test('closed regions, bans and malformed saves are refused', async () => {
  const p = await guest();
  await db.doc('regionStatus/meridian').set({ enabled: false, mode: 'maintenance' });
  try { await rejects(civic(p, saveOf(p, {})), 'region_disabled'); }
  finally { await db.doc('regionStatus/meridian').delete(); }
  await rejects(civic(p, { ...saveOf(p, {}), x: 5 }), 'INVALID_ARGUMENT');
  await rejects(civic(p, { ...saveOf(p, {}), o: 'x'.repeat(750001) }), 'INVALID_ARGUMENT');
  const b = await guest();
  await db.doc('bans/' + b.uid).set({ t: Date.now(), by: 'test' });
  await rejects(civic(b, saveOf(b, {})), 'banned');
  assert.equal((await get('nations/' + b.uid)).exists, false);
});
