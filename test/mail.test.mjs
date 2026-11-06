// Letters by post (functions/mail.js, jobs/mail/run.mjs) against the emulators: letters land in mailOutbox.
//   npm run test:mail
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const project = process.env.GCLOUD_PROJECT || 'demo-edictum';
const auth = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
const docs = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}/v1/projects/${project}/databases/(default)/documents`;
const functions = `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${project}/europe-west1/`;
const headers = { 'content-type': 'application/json', authorization: 'Bearer owner' };
async function user() {
  const r = await fetch(auth + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const u = await r.json(); return { uid: u.localId, token: u.idToken };
}
async function call(u, data) {
  const r = await fetch(functions + 'accounts', { method: 'POST', headers: { 'content-type': 'application/json', ...(u ? { authorization: 'Bearer ' + u.token } : {}) }, body: JSON.stringify({ data: { op: 'mail', ...data } }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { status: b.error.status }); return b.result;
}
const value = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { integerValue: String(v) };
async function put(path, data) { const r = await fetch(docs + '/' + path, { method: 'PATCH', headers, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, value(v)])) }) }); assert.equal(r.status, 200); }
async function get(path) { const r = await fetch(docs + '/' + path, { headers }); return r.status === 200 ? r.json() : null; }
async function outbox(to) {
  const r = await (await fetch(docs + '/mailOutbox?pageSize=300', { headers })).json();
  return (r.documents || []).map(d => Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, Object.values(v)[0]]))).filter(l => l.to === to).sort((a, b) => a.t - b.t);
}
const job = (now, env = {}) => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../jobs/mail/run.mjs', import.meta.url)), '--project', project, '--now', String(now)], { env: { ...process.env, ...env } });

test('an address is confirmed by its code, welcomed once, and every letter can be stopped', async () => {
  const u = await user(), to = u.uid.toLowerCase() + '@example.test';
  await put('summaries/' + u.uid, { name: 'Herald Test Republic', reg: 'meridian', pop: 5, t: Date.now() });
  await assert.rejects(call(null, { step: 'status' }), e => e.status === 'UNAUTHENTICATED');
  await assert.rejects(call(u, { step: 'set', email: 'not an address' }), e => e.status === 'INVALID_ARGUMENT');
  await call(u, { step: 'set', email: to.toUpperCase() });
  assert.deepEqual((await call(u, { step: 'status' })).wait, true);
  await assert.rejects(call(u, { step: 'set', email: to }), e => e.status === 'RESOURCE_EXHAUSTED');   // a minute between codes
  const [seal] = await outbox(to); assert.match(seal.subject, /^\d{6} is your Edictum confirmation seal$/);
  assert.match(seal.html, /Herald Test Republic/);
  const code = seal.subject.slice(0, 6), wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(call(u, { step: 'verify', code: wrong }), /not the code/);
  await assert.rejects(call(u, { step: 'prefs', p: { news: false } }), /Confirm your address/);
  await call(u, { step: 'verify', code });
  const st = await call(u, { step: 'status' });
  assert.equal(st.ok, true); assert.equal(st.email, to); assert.deepEqual(st.p, { msg: true, now: false, war: true, dip: true, news: true, away: true });   // each letter right away: only when chosen
  const letters = await outbox(to); assert.equal(letters.length, 2); assert.match(letters[1].subject, /Welcome to the rolls, Herald Test Republic/);
  assert.equal((await call(u, { step: 'prefs', p: { news: false, bogus: true } })).p.news, false);
  const tok = (await get('mailAccounts/' + u.uid)).fields.tok.stringValue;
  assert.match(letters[1].html, new RegExp('/mail\\?t=' + tok));
  await assert.rejects(call(null, { step: 'unsub', t: 'nonsense-key-123' }), /no longer valid/);
  await call(null, { step: 'unsub', t: tok });
  assert.deepEqual((await call(u, { step: 'status' })).p, { msg: false, now: false, war: false, dip: false, news: false, away: false });
  await call(u, { step: 'remove' });
  assert.equal((await call(u, { step: 'status' })).email, '');
  assert.equal(await get('mailTokens/' + tok), null);
});

test('the hourly job sends one digest of unseen pings, then waits; and one away reminder', async () => {
  const u = await user(), to = u.uid.toLowerCase() + '@example.test', now = Date.now(), seen = now - 5 * 86400000;
  await put('summaries/' + u.uid, { name: 'Courier Land', reg: 'meridian', pop: 5, t: seen });
  await call(u, { step: 'set', email: to });
  await call(u, { step: 'verify', code: (await outbox(to))[0].subject.slice(0, 6) });
  await call(u, { step: 'prefs', p: { dip: false } });
  const ping = (k, nm, t) => fetch(docs + '/mailQ', { method: 'POST', headers, body: JSON.stringify({ fields: { to: value(u.uid), by: value('someone'), k: value(k), nm: value(nm), t: value(new Date(t)) } }) });
  await ping('war', 'Ravenmark', now - 3600000); await ping('msg', 'Ravenmark', now - 1800000); await ping('msg', 'Ravenmark', now - 1700000);
  await ping('trade', 'Quietvale', now - 3600000);          // diplomacy is off
  await ping('msg', 'Oldnews', seen - 1000);               // before their last visit: already seen
  await job(now);
  const after = await outbox(to), digest = after.find(l => /dispatches/i.test(l.subject)), away = after.find(l => /awaits its/.test(l.subject));
  assert.ok(digest, 'a digest was sent'); assert.match(digest.subject, /^Urgent dispatches for Courier Land/);
  assert.match(digest.html, /Ravenmark<\/b> declared war/); assert.match(digest.html, /Ravenmark<\/b> has written to you\. <span[^>]*>\(2 times\)/);
  assert.doesNotMatch(digest.html, /Quietvale|Oldnews/);
  assert.ok(away, 'an away reminder was sent'); assert.match(away.html, /5 days/);
  await ping('msg', 'Ravenmark', now + 60000);
  await job(now + 120000);                                 // within six hours: the ping waits, no second reminder
  assert.equal((await outbox(to)).length, after.length);
  await job(now + 7 * 3600000);
  const last = (await outbox(to)).at(-1); assert.match(last.subject, /^Dispatches await Courier Land/);
});

test('a run the mail service stops part of the way sends nothing twice, and the next run sends the rest', async () => {
  const now = Date.now(), people = [];
  for (const name of ['Firstport', 'Secondmere']) {
    const u = await user(), to = u.uid.toLowerCase() + '@example.test';
    await put('summaries/' + u.uid, { name, reg: 'meridian', pop: 5, t: now - 3600000 });
    await call(u, { step: 'set', email: to });
    await call(u, { step: 'verify', code: (await outbox(to))[0].subject.slice(0, 6) });
    await fetch(docs + '/mailQ', { method: 'POST', headers, body: JSON.stringify({ fields: { to: value(u.uid), by: value('someone'), k: value('msg'), nm: value('Ravenmark'), t: value(new Date(now - 600000)) } }) });
    people.push({ u, to, before: (await outbox(to)).length });
  }
  /* news published since the last full run */
  await put('mailState/news', { at: now - 60000 });
  await put('devnews/mail-test-post', { pub: true, t: new Date(now - 30000), ti: 'A post worth a letter', ex: 'Short and sweet.' });
  const sent = async () => (await Promise.all(people.map(p => outbox(p.to)))).map((l, i) => l.slice(people[i].before));
  /* the service takes the first letter, then refuses: the run stops and fails */
  await assert.rejects(job(now, { MAIL_TEST_CHUNK: '1', MAIL_TEST_FAIL_CHUNK: '1' }));
  const first = (await sent()).flat();
  assert.equal(first.length, 1, 'one letter went: ' + first.map(l => l.subject).join(' | '));
  assert.equal(Number((await get('mailState/news')).fields.at.integerValue), now - 60000, 'the news is not marked sent');
  /* the next run sends the rest: each person one digest and one news letter in all */
  await job(now + 60000, { MAIL_TEST_CHUNK: '1' });
  for (const letters of await sent()) {
    assert.equal(letters.filter(l => /dispatches/i.test(l.subject)).length, 1, 'one digest: ' + letters.map(l => l.subject).join(' | '));
    assert.equal(letters.filter(l => /A post worth a letter/.test(l.html)).length, 1, 'and the news once');
  }
  assert.equal(Number((await get('mailState/news')).fields.at.integerValue), now + 60000, 'now the news is marked sent');
  /* and a third run sends nothing more */
  const total = (await sent()).flat().length;
  await job(now + 120000);
  assert.equal((await sent()).flat().length, total);
});
