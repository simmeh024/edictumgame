// One-time sign-in links (functions/once.js): an admin makes one for a player who cannot get back in, emailed to the
// verified address on the account or copied; it works once, within a day, and a new one cancels the last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-edictum', AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', FN = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001', FS = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

async function sign(method, data) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, returnSecureToken: true }) });
  const b = await r.json(); assert.ok(r.ok, JSON.stringify(b));
  return { uid: b.localId || JSON.parse(Buffer.from(b.idToken.split('.')[1], 'base64url')).user_id, token: b.idToken, refresh: b.refreshToken };
}
const guest = () => sign('signUp', {});
async function owner(name, { email = true } = {}) {
  let p;
  if (email) { const e = `once-${crypto.randomUUID()}@example.test`, password = 'test-only-password'; await auth.createUser({ email: e, password, emailVerified: true }); p = await sign('signInWithPassword', { email: e, password }); p.email = e; }
  else p = await guest();
  await db.doc('nations/' + p.uid).set({ v: 1, j: JSON.stringify({ reg: 'meridian', name, pop: 10 }), reg: 'meridian', name, pop: 10, army: 1, cl: 0, updatedAt: Date.now(), rev: 1, ts: new Date() });
  return p;
}
/* an admin: the claim set, then a fresh token that carries it */
async function admin() {
  const p = await guest();
  await auth.setCustomUserClaims(p.uid, { admin: true });
  const r = await fetch(`http://${AUTH}/securetoken.googleapis.com/v1/token?key=fake-api-key`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: p.refresh }) });
  p.token = (await r.json()).id_token;
  assert.equal(JSON.parse(Buffer.from(p.token.split('.')[1], 'base64url')).admin, true);
  return p;
}
async function call(p, service, data) {
  const r = await fetch(`http://${FN}/${PROJECT}/europe-west1/${service}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.token }, body: JSON.stringify({ data }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.details?.code, status: b.error.status }); return b.result;
}
const console_ = (p, d) => call(p, 'adminConsole', d), account = (p, d) => call(p, 'accounts', d);
const codeOf = link => new URL(link).searchParams.get('once');
const refused = (promise, code) => assert.rejects(promise, e => e.code === code || e.status === code);
const outbox = async to => (await db.collection('mailOutbox').where('to', '==', to).get()).docs.map(d => d.data());
const read = async (p, path) => (await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer ' + p.token } })).status;

test('An admin copies a link: it shows whose nation it opens, signs a stranger browser in once, and is gone after', async () => {
  const A = await admin(), T = await owner('Farhold'), visitor = await guest();
  const made = await console_(A, { op: 'once', step: 'copy', uid: T.uid });
  assert.match(made.link, /^https:\/\/edictumgame\.com\/\?once=EDO[A-F0-9]{40}$/);
  assert.equal(made.once.live, true); assert.equal(made.once.via, 'copy'); assert.ok(made.once.exp - made.once.at === 24 * 3600000);
  const code = codeOf(made.link);
  /* never the code itself on the server, only its hash */
  assert.equal((await db.collection('onceLinks').where('uid', '==', T.uid).get()).docs.some(d => JSON.stringify(d.data()).includes(code)), false);
  assert.deepEqual(await account(visitor, { op: 'once', step: 'peek', code }), { uid: T.uid, name: 'Farhold' });
  /* peeking does not use it up; lower case and dashes are forgiven, as with recovery codes */
  const used = await account(visitor, { op: 'once', step: 'use', code: code.toLowerCase().replace(/(.{8})/g, '$1-') });
  assert.equal(used.uid, T.uid); assert.equal(used.name, 'Farhold');
  const session = await sign('signInWithCustomToken', { token: used.token });
  assert.equal(session.uid, T.uid);
  assert.equal(JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url')).once, true);
  await refused(account(await guest(), { op: 'once', step: 'use', code }), 'once_invalid');
  await refused(account(await guest(), { op: 'once', step: 'peek', code }), 'once_invalid');
  const after = await console_(A, { op: 'player', uid: T.uid });
  assert.equal(after.once.live, false); assert.ok(after.once.usedAt > 0);
  /* the player's record of it, which only they may read (the Edictum Team's letter) */
  assert.equal((await db.doc('onceLog/' + T.uid).get()).get('t').length, 1);
  assert.equal(await read(T, 'onceLog/' + T.uid), 200);
  assert.equal(await read(visitor, 'onceLog/' + T.uid), 403);
  assert.equal(await read(T, 'onceFor/' + T.uid), 403);
  const audit = (await db.collection('adminAudit').where('target', '==', T.uid).get()).docs.map(d => d.data());
  assert.ok(audit.some(a => a.action === 'once_link' && a.actor === A.uid && a.name === 'Farhold'));
});

test('Emailed to the verified address, and a new link or Cancel stops the last one working', async () => {
  const A = await admin(), T = await owner('Mailmere'), visitor = await guest();
  const mailed = await console_(A, { op: 'once', step: 'mail', uid: T.uid });
  assert.equal(mailed.link, undefined, 'an emailed link is not shown to the admin');
  assert.match(mailed.sent, /^o•••.@example\.test$/);
  const [letter] = await outbox(T.email);
  assert.ok(letter, 'the Herald wrote to the account’s address');
  assert.match(letter.subject, /one-time sign-in link/);
  assert.match(letter.text, /Mailmere/);
  const code = /once=(EDO[A-F0-9]{40})/.exec(letter.text)[1];
  assert.equal((await account(visitor, { op: 'once', step: 'peek', code })).uid, T.uid);
  /* a copied link replaces it */
  const copied = await console_(A, { op: 'once', step: 'copy', uid: T.uid });
  await refused(account(visitor, { op: 'once', step: 'peek', code }), 'once_invalid');
  /* and Cancel stops that one too */
  const cancelled = await console_(A, { op: 'once', step: 'revoke', uid: T.uid });
  assert.equal(cancelled.once.live, false);
  await refused(account(visitor, { op: 'once', step: 'peek', code: codeOf(copied.link) }), 'once_invalid');
  await refused(console_(A, { op: 'once', step: 'revoke', uid: T.uid }), 'FAILED_PRECONDITION');
});

test('No link for an account without a verified address by email, a banned player, or a stranger; an old link expires', async () => {
  const A = await admin(), plain = await owner('Quietvale', { email: false }), stranger = await guest();
  await refused(console_(A, { op: 'once', step: 'mail', uid: plain.uid }), 'no_email');
  const copied = await console_(A, { op: 'once', step: 'copy', uid: plain.uid });
  assert.equal(copied.once.mail, '');
  await refused(console_(stranger, { op: 'once', step: 'copy', uid: plain.uid }), 'PERMISSION_DENIED');
  /* a day later */
  const [link] = (await db.collection('onceLinks').where('uid', '==', plain.uid).get()).docs;
  await link.ref.update({ exp: Timestamp.fromMillis(Date.now() - 1000) });
  await refused(account(stranger, { op: 'once', step: 'use', code: codeOf(copied.link) }), 'once_invalid');
  /* banned meanwhile: a link made before does not open the account */
  const B = await owner('Shutgate'), fresh = await console_(A, { op: 'once', step: 'copy', uid: B.uid });
  await db.doc('bans/' + B.uid).set({ name: 'Shutgate', at: Date.now() });
  await refused(account(stranger, { op: 'once', step: 'peek', code: codeOf(fresh.link) }), 'once_invalid');
  await refused(console_(A, { op: 'once', step: 'copy', uid: B.uid }), 'banned');
  /* a guessed code is no better */
  await refused(account(stranger, { op: 'once', step: 'peek', code: 'EDO' + 'A'.repeat(40) }), 'once_invalid');
});
