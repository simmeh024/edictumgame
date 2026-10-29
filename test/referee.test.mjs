// The referee (functions/index.js) on the emulators: battles rolled on the server, readiness kept there,
// the odds held to the armies saved, every victory sealed. Run with:
//   npm run test:referee
// (that is: firebase emulators:exec --only auth,firestore,functions "node --test test/referee.test.mjs")
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const DOCS = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { 'content-type': 'application/json', authorization: 'Bearer owner' }; // past the rules
const NPC = 'npc-vellmark';

// a guest account, as the game signs in
async function guest() {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const b = await r.json();
  return { uid: b.localId, token: b.idToken };
}
// the referee, called as src/shim.js calls it
async function call(who, data) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.authorization = 'Bearer ' + who.token;
  const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/referee`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  const b = await r.json();
  if (b.error) throw Object.assign(new Error(b.error.message), { status: b.error.status });
  return b.result;
}
const battle = (who, d = {}) => call(who, { op: 'battle', d: NPC, c: 100, p: 0.95, ...d });
const doc = (path, init = {}) => fetch(`${DOCS}/${path}`, { headers: OWNER, ...init });
async function read(path) { const r = await doc(path); return r.status === 200 ? r.json() : null; }
async function list(path) { const r = await doc(path + '?pageSize=300'); return r.status === 200 ? (await r.json()).documents || [] : []; }
const del = path => doc(path, { method: 'DELETE' });
// a nation as src/shim.js saves it: the record's JSON beside the headline numbers
function nation(uid, rec = {}, army = 5) {
  const j = JSON.stringify({ name: 'Testland', reg: 'meridian', pop: 12, ...rec });
  return doc('nations/' + uid, { method: 'PATCH', body: JSON.stringify({ fields: {
    v: { integerValue: '1' }, j: { stringValue: j }, reg: { stringValue: 'meridian' }, name: { stringValue: 'Testland' },
    updatedAt: { integerValue: String(Date.now()) }, ts: { timestampValue: new Date().toISOString() },
    pop: { doubleValue: 12 }, army: { doubleValue: army }, cl: { integerValue: '0' } } }) });
}
// the game's check of a seal (refVerify() in game/edictum.html), against the referee's public key
async function checker() {
  const k = (await read('referee/pub')).fields.k.stringValue;
  const key = await crypto.subtle.importKey('spki', Buffer.from(k, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return (uid, c, t, w, s) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(s, 'base64url'),
    new TextEncoder().encode(['edictum-battle-1', uid, c, t, w || ''].join('|')));
}

test('only a signed-in player with a saved nation can fight', async () => {
  await assert.rejects(battle(null), e => e.status === 'UNAUTHENTICATED');
  const g = await guest();
  assert.deepEqual(await battle(g), { ok: false, why: 'nation' });
  await nation(g.uid);
  await assert.rejects(call(g, { op: 'battle', d: NPC, c: -1, p: 0.5 }), e => e.status === 'INVALID_ARGUMENT');
  await assert.rejects(call(g, { op: 'battle', d: g.uid, c: 5, p: 0.5 }), e => e.status === 'INVALID_ARGUMENT');
  await assert.rejects(call(g, { op: 'rig' }), e => e.status === 'INVALID_ARGUMENT');
});

test('the referee rolls each battle, keeps the army’s readiness and seals every victory', async () => {
  const g = await guest();
  await nation(g.uid, { policies: {} });
  const won = [];
  for (let i = 0; i < 7; i++) {                                  // 6 points, and one for a master spy’s gift
    const t0 = Date.now(), r = await battle(g, { c: 100 + i, w: i === 3 ? 'ally-1' : '' });
    assert.equal(r.ok, true);
    assert.equal(r.r, 6 - i);
    assert.ok(r.t >= t0 - 1000 && r.t <= Date.now() + 1000, 'the server’s time');
    assert.equal(r.p, 0.95);
    assert.equal(typeof r.s === 'string', r.win, 'a seal comes with a victory only');
    if (r.win) won.push({ c: 100 + i, t: r.t, w: i === 3 ? 'ally-1' : '', s: r.s });
  }
  const no = await battle(g);
  assert.equal(no.ok, false);
  assert.equal(no.why, 'ready');
  assert.ok(no.next > 0 && no.next <= 15 * 60000, 'the next point within 15 minutes');
  assert.ok(won.length > 0, 'at 95%, seven battles win at least once');
  const ok = await checker();
  for (const e of won) {
    assert.equal(await ok(g.uid, e.c, e.t, e.w, e.s), true);
    assert.equal(await ok(g.uid, e.c + 1, e.t, e.w, e.s), false, 'another hex');
    assert.equal(await ok(g.uid, e.c, e.t - 86400000, e.w, e.s), false, 'another time');
    assert.equal(await ok(g.uid, e.c, e.t, e.w ? '' : 'ally-2', e.s), false, 'another war');
    assert.equal(await ok('someone-else', e.c, e.t, e.w, e.s), false, 'another nation');
  }
  const army = await read('armies/' + g.uid);
  assert.equal(Number(army.fields.n.integerValue), 7);
  assert.equal(Number(army.fields.w.integerValue), won.length);
  assert.equal((await list(`armies/${g.uid}/log`)).length, 7);
});

test('an Army Reserve holds two more points, and Rapid Mobilisation brings them back in 10 minutes', async () => {
  const g = await guest();
  await nation(g.uid, { policies: { reservists: true, rapidMobilisation: true } });
  for (let i = 0; i < 9; i++) assert.equal((await battle(g)).ok, true);
  const no = await battle(g);
  assert.equal(no.why, 'ready');
  assert.ok(no.next > 0 && no.next <= 10 * 60000);
});

test('the dice are fair: about half of the battles at 50% are won', async () => {
  const g = await guest();
  await nation(g.uid);
  let wins = 0;
  for (let i = 0; i < 42; i++) {
    if (i % 7 === 0) await del('armies/' + g.uid);              // a fresh army every seven battles
    const r = await battle(g, { p: 0.5 });
    assert.equal(r.ok, true);
    if (r.win) wins++;
  }
  assert.ok(wins >= 8 && wins <= 34, wins + ' of 42');
});

test('the odds stay within the game’s bounds, and no better than the two armies as saved allow', async () => {
  const g = await guest(), foe = await guest(), friend = await guest(), stranger = await guest();
  await nation(g.uid, { alli: { name: 'The Pact', t: 1 } }, 1);
  await nation(foe.uid, {wars:{[g.uid]:{t:Date.now()}}}, 1000); // Guest defensive battles stay available
  await nation(friend.uid, { allyOf: g.uid }, 100);
  await nation(stranger.uid, {}, 100000);
  assert.equal((await battle(g, { p: 3 })).p, 0.95, 'a computer nation: the game’s bounds only');
  assert.equal((await battle(g, { p: 0.001 })).p, 0.05);
  const alone = await battle(g, { d: foe.uid, p: 0.9 });
  assert.ok(Math.abs(alone.p - 20 / 1020) < 1e-3, 'an army a thousandth of the defender’s: ' + alone.p);
  const helped = await battle(g, { d: foe.uid, p: 0.9, h: [friend.uid, stranger.uid] });
  assert.ok(Math.abs(helped.p - 1020 / 2020) < 1e-3, 'an ally adds half its army, a stranger nothing: ' + helped.p);
  assert.equal((await battle(g, { d: foe.uid, p: 0.3, h: [friend.uid] })).p, 0.3, 'odds within the bound stand');
  const log = (await list(`armies/${g.uid}/log`)).map(d => d.fields);
  assert.ok(log.some(f => f.d.stringValue === foe.uid && Math.abs((f.cap.doubleValue ?? Number(f.cap.integerValue)) - 20 / 1020) < 1e-3), 'the log keeps the bound');
});

test('a banned account cannot fight', async () => {
  const g = await guest();
  await nation(g.uid);
  await doc('bans/' + g.uid, { method: 'PATCH', body: JSON.stringify({ fields: { t: { integerValue: '1' }, by: { stringValue: 'admin' } } }) });
  assert.deepEqual(await battle(g), { ok: false, why: 'banned' });
});

test('a player deleting their account clears their army, but only once the nation is gone', async () => {
  const g = await guest();
  await nation(g.uid);
  assert.equal((await battle(g)).ok, true);
  assert.deepEqual(await call(g, { op: 'forget' }), { ok: false, why: 'nation' });
  assert.ok(await read('armies/' + g.uid));
  await del('nations/' + g.uid);
  assert.deepEqual(await call(g, { op: 'forget' }), { ok: true });
  assert.equal(await read('armies/' + g.uid), null);
  assert.equal((await list(`armies/${g.uid}/log`)).length, 0);
});
