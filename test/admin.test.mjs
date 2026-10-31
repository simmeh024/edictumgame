import { test } from 'node:test';
import assert from 'node:assert/strict';
const project = process.env.GCLOUD_PROJECT || 'demo-edictum';
const auth = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
const docs = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}/v1/projects/${project}/databases/(default)/documents`;
const functions = `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${project}/europe-west1/`;
const headers = { 'content-type': 'application/json', authorization: 'Bearer owner' };
async function user(admin = false) {
  const r = await fetch(auth + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const u = await r.json();
  if (admin) {
    const claim = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, { method: 'POST', headers, body: JSON.stringify({ localId: u.localId, customAttributes: '{"admin":true}' }) });
    assert.equal(claim.status, 200);
    const token = await fetch(auth + '/securetoken.googleapis.com/v1/token?key=fake', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: u.refreshToken }) });
    u.idToken = (await token.json()).id_token;
    assert.equal(JSON.parse(Buffer.from(u.idToken.split('.')[1], 'base64url')).admin, true);
  }
  return { uid: u.localId, token: u.idToken };
}
async function call(u, data, name = 'adminConsole', extra = {}) {
  const r = await fetch(functions + name, { method: 'POST', headers: { 'content-type': 'application/json', ...(u ? { authorization: 'Bearer ' + u.token } : {}), ...extra }, body: JSON.stringify({ data }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { status: b.error.status }); return b.result;
}
const value = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { integerValue: String(v) };
async function put(path, data) { const r = await fetch(docs + '/' + path, { method: 'PATCH', headers, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k,v]) => [k,value(v)])) }) }); assert.equal(r.status, 200); }
async function get(path) { const r = await fetch(docs + '/' + path, { headers }); return r.status === 200 ? r.json() : null; }
async function del(path) { assert.equal((await fetch(docs + '/' + path, { method: 'DELETE', headers })).status, 200); }
// Links a sign-in the way the game does: Google through the emulator's stand-in identity provider, an email
// address as Firebase's password provider (email link sign-in is the same provider), Discord as custom claims.
async function link(u, { google = false, email = false, verified = true, discord = false } = {}) {
  const jwt = o => [{ alg: 'none', typ: 'JWT' }, o].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.') + '.';
  const post = (path, body, h = { 'content-type': 'application/json' }) => fetch(auth + '/identitytoolkit.googleapis.com/v1/' + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (google) assert.equal((await post('accounts:signInWithIdp?key=fake', { idToken: u.token, requestUri: 'http://localhost', returnSecureToken: true, postBody: 'providerId=google.com&id_token=' + jwt({ sub: 'g' + u.uid, email: 'g' + u.uid.toLowerCase() + '@example.test', email_verified: true }) })).status, 200);
  if (email) {
    assert.equal((await post('accounts:update?key=fake', { idToken: u.token, email: u.uid.toLowerCase() + '@example.test', password: 'test-only-password', returnSecureToken: true })).status, 200);
    assert.equal((await post(`projects/${project}/accounts:update`, { localId: u.uid, emailVerified: verified }, headers)).status, 200);
  }
  if (discord) assert.equal((await post(`projects/${project}/accounts:update`, { localId: u.uid, customAttributes: '{"dc":"4242","dcn":"Ruler"}' }, headers)).status, 200);
}
async function seed(uid, name = 'Old Émber Republic') {
  await put('nations/' + uid, { name, reg: 'meridian', pop: 5, army: 2, rev: 7, ts: new Date(), j: JSON.stringify({ name, reg: 'meridian', pop: 5 }) });
  await put('summaries/' + uid, { name, reg: 'meridian', pop: 5, t: Date.now() });
  await put('nationx/' + uid, { j: '{"private":"kept"}' });
}

test('staff endpoints reject visitors and ordinary players', async () => {
  const g = await user();
  await assert.rejects(call(null, { op: 'search' }), e => e.status === 'UNAUTHENTICATED');
  for (const op of ['search', 'player', 'health', 'audit', 'region', 'moderate', 'note']) await assert.rejects(call(g, { op }), e => e.status === 'PERMISSION_DENIED');
});
test('search includes legacy summaries, case-insensitive names and exact player IDs', async () => {
  const a = await user(true), p = await user(); await seed(p.uid);
  const found = await call(a, { op: 'search', q: 'EMBER', refresh: true }); assert.ok(found.players.some(n => n.uid === p.uid));
  assert.equal((await call(a, { op: 'search', q: p.uid })).players[0].uid, p.uid);
  assert.equal((await call(a, { op: 'search', q: p.uid, reg: 'frostmarch' })).players.length, 0);
  const detail = await call(a, { op: 'player', uid: p.uid }); assert.equal(detail.revision, 7); assert.ok(detail.savedAt > 0); assert.equal(detail.name, 'Old Émber Republic');
});
test('inspecting a player shows the account behind the nation, as Firebase Authentication knows it', async () => {
  const a = await user(true), g = await user(), r = await user(), e = await user(), u = await user();
  // The shared record is the player's own to write; it must not decide what the console shows.
  await put('nations/' + g.uid, { name: 'Guestland', reg: 'meridian', rev: 1, ts: new Date(), j: JSON.stringify({ name: 'Guestland', kind: 'registered', linked: ['google'] }) });
  await link(r, { google: true, discord: true }); await link(e, { email: true }); await link(u, { email: true, verified: false });
  const guest = (await call(a, { op: 'player', uid: g.uid })).account;
  assert.equal(guest.kind, 'guest'); assert.deepEqual(guest.linked, []); assert.equal(guest.admin, false); assert.equal(guest.disabled, false);
  assert.ok(guest.created > 0 && guest.lastSignIn >= guest.created);
  const linked = (await call(a, { op: 'player', uid: r.uid })).account;
  assert.equal(linked.kind, 'registered'); assert.deepEqual(linked.linked.sort(), ['discord', 'google']);
  const mail = (await call(a, { op: 'player', uid: e.uid })).account;
  assert.equal(mail.kind, 'registered'); assert.deepEqual(mail.linked, ['email']);
  const unverified = (await call(a, { op: 'player', uid: u.uid })).account;
  assert.equal(unverified.kind, 'guest'); assert.deepEqual(unverified.linked, ['email_unverified']);
  const self = (await call(a, { op: 'player', uid: a.uid })).account;
  assert.equal(self.admin, true); assert.ok(self.lastRefresh > 0);
  assert.equal((await call(a, { op: 'player', uid: 'no-such-account' })).account, null);
});
test('the last address a player played from is kept for the admins alone, for 90 days, and goes with the account', async () => {
  const a = await user(true), p = await user(), seen = xff => call(p, { op: 'seen' }, 'accounts', xff ? { 'x-forwarded-for': xff } : {});
  assert.equal((await call(a, { op: 'player', uid: p.uid })).account.ip, '');
  // Google's front end adds the address it saw after anything the browser sent itself: the last entry counts.
  await seen('198.51.100.7, 203.0.113.9');
  const first = await get('accountSeen/' + p.uid), acct = (await call(a, { op: 'player', uid: p.uid })).account;
  assert.equal(acct.ip, '203.0.113.9'); assert.equal(acct.ipAt, Number(first.fields.at.integerValue));
  assert.equal(Date.parse(first.fields.exp.timestampValue) - acct.ipAt, 90 * 86400000);
  await seen('203.0.113.9');
  assert.equal((await get('accountSeen/' + p.uid)).updateTime, first.updateTime, 'the same address within the hour writes nothing');
  await seen('2001:db8::5');
  assert.equal((await call(a, { op: 'player', uid: p.uid })).account.ip, '2001:db8::5', 'a new address replaces the old one');
  await seen('<script>');
  assert.equal((await call(a, { op: 'player', uid: p.uid })).account.ip, '2001:db8::5', 'what is not an address is not kept');
  await assert.rejects(call(p, { op: 'player', uid: p.uid }), e => e.status === 'PERMISSION_DENIED');
  await call(p, { op: 'close' }, 'accounts');
  assert.equal(await get('accountSeen/' + p.uid), null);
});
test('any nation can be hidden, deleted or banned without a report, and every step is audited', async () => {
  const a = await user(true), p = await user(), q = await user(); await seed(p.uid, 'Quietland'); await seed(q.uid, 'Otherland');
  for (const action of ['hide', 'remove', 'ban']) await assert.rejects(call(a, { op: 'moderate', action, target: a.uid, reason: 'Self' }), e => e.status === 'FAILED_PRECONDITION');
  await call(a, { op: 'moderate', action: 'hide', target: p.uid, reason: 'Offensive flag' });
  let d = await call(a, { op: 'player', uid: p.uid }); assert.equal(d.hidden, true); assert.equal(d.note, 'Offensive flag');
  await put('boards/meridian/posts/quiet-post', { a: p.uid, x: 'Hello' });
  await call(a, { op: 'moderate', action: 'remove', target: p.uid, reason: 'Offensive flag, again', name: 'Forged name' });
  for (const path of ['nations/', 'nationx/', 'summaries/']) assert.equal(await get(path + p.uid), null);
  assert.equal(await get('boards/meridian/posts/quiet-post'), null);
  assert.equal(await get('bans/' + p.uid), null);
  d = await call(a, { op: 'player', uid: p.uid });
  assert.equal(d.exists, false); assert.ok(d.removed > 0); assert.equal(d.hidden, false); assert.equal(d.banned, false); assert.equal(d.name, 'Quietland'); assert.equal(d.account.kind, 'guest');
  await call(a, { op: 'moderate', action: 'ban', target: q.uid, reason: 'Ban evasion' });
  d = await call(a, { op: 'player', uid: q.uid }); assert.equal(d.banned, true); assert.equal(d.exists, false); assert.equal(d.note, 'Ban evasion');
  await call(a, { op: 'moderate', action: 'unban', target: q.uid, reason: 'Appeal accepted' });
  assert.equal(await get('bans/' + q.uid), null);
  const log = (await call(a, { op: 'audit', target: p.uid })).events;
  for (const action of ['hide', 'remove']) assert.ok(log.some(e => e.action === action && e.outcome === 'started' && e.actor === a.uid) && log.some(e => e.action === action && e.outcome === 'completed' && e.actor === a.uid));
  assert.ok(log.some(e => e.action === 'remove' && e.outcome === 'completed' && e.reason === 'Offensive flag, again' && e.name === 'Quietland'));
  const banLog = (await call(a, { op: 'audit', target: q.uid })).events;
  assert.ok(banLog.some(e => e.action === 'ban' && e.reason === 'Ban evasion' && e.outcome === 'completed'));
  assert.ok(banLog.some(e => e.action === 'unban' && e.outcome === 'completed'));
});
test('a forced rename hides the nation until its player saves it under another name', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Rudeland');
  await assert.rejects(call(a, { op: 'moderate', action: 'rename', target: a.uid, reason: 'Self' }), e => e.status === 'FAILED_PRECONDITION');
  await assert.rejects(call(a, { op: 'moderate', action: 'rename', target: 'no-such-nation', reason: 'Gone' }), e => e.status === 'FAILED_PRECONDITION');
  assert.deepEqual(await call(p, { op: 'renamed' }, 'civic'), { ok: true }, 'nothing to confirm without a forced rename');
  await call(a, { op: 'moderate', action: 'rename', target: p.uid, reason: 'Offensive name', name: 'Forged name' });
  const m = (await get('mod/' + p.uid)).fields;
  assert.equal(m.hidden.booleanValue, true); assert.equal(m.rename.booleanValue, true); assert.equal(m.name.stringValue, 'Rudeland'); assert.equal(m.note.stringValue, 'Offensive name');
  let d = await call(a, { op: 'player', uid: p.uid }); assert.equal(d.rename, true); assert.equal(d.hidden, true);
  // The same name in other capitals, accents or spacing is not a new name.
  assert.deepEqual(await call(p, { op: 'renamed' }, 'civic'), { ok: false, why: 'unchanged' });
  await seed(p.uid, '  RUDÉLAND ');
  assert.deepEqual(await call(p, { op: 'renamed' }, 'civic'), { ok: false, why: 'unchanged' });
  assert.equal((await get('mod/' + p.uid)).fields.rename.booleanValue, true);
  await seed(p.uid, 'Kindland');
  assert.deepEqual(await call(p, { op: 'renamed' }, 'civic'), { ok: true });
  assert.equal(await get('mod/' + p.uid), null);
  d = await call(a, { op: 'player', uid: p.uid }); assert.equal(d.rename, false); assert.equal(d.hidden, false); assert.equal(d.name, 'Kindland');
  const log = (await call(a, { op: 'audit', target: p.uid })).events;
  assert.ok(log.some(e => e.action === 'rename' && e.outcome === 'completed' && e.actor === a.uid && e.reason === 'Offensive name' && e.name === 'Rudeland'));
  assert.ok(log.some(e => e.action === 'renamed' && e.outcome === 'completed' && e.actor === p.uid && e.name === 'Kindland' && e.reason.endsWith('it was Rudeland')));
  // A plain hide is not lifted by a new name.
  await call(a, { op: 'moderate', action: 'hide', target: p.uid, reason: 'Offensive flag' });
  await seed(p.uid, 'Kinderland');
  assert.deepEqual(await call(p, { op: 'renamed' }, 'civic'), { ok: true });
  assert.equal((await get('mod/' + p.uid)).fields.hidden.booleanValue, true);
});
test('staff notes are the admins’ alone, audited without their text, and go with the account', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Notedland');
  assert.deepEqual((await call(a, { op: 'player', uid: p.uid })).staffNote, { text: '', at: 0, by: '' });
  await assert.rejects(call(p, { op: 'note', uid: p.uid, text: 'Mine now' }), e => e.status === 'PERMISSION_DENIED');
  await assert.rejects(call(a, { op: 'note', uid: p.uid }), e => e.status === 'INVALID_ARGUMENT');
  const saved = (await call(a, { op: 'note', uid: p.uid, text: '  Warned about spam on 1 November.\r\nBan next time.  ' })).staffNote;
  assert.equal(saved.text, 'Warned about spam on 1 November.\nBan next time.'); assert.equal(saved.by, a.uid); assert.ok(saved.at > 0);
  assert.deepEqual((await call(a, { op: 'player', uid: p.uid })).staffNote, saved);
  assert.equal((await call(a, { op: 'note', uid: p.uid, text: 'x'.repeat(5000) })).staffNote.text.length, 4000);
  const log = (await call(a, { op: 'audit', target: p.uid })).events.filter(e => e.action === 'note_saved');
  assert.equal(log.length, 2);
  assert.ok(log.every(e => e.actor === a.uid && e.name === 'Notedland' && e.outcome === 'completed' && !JSON.stringify(e).includes('spam')));
  await call(a, { op: 'note', uid: p.uid, text: '   ' });
  assert.equal(await get('staffNotes/' + p.uid), null);
  assert.ok((await call(a, { op: 'audit', target: p.uid })).events.some(e => e.action === 'note_cleared'));
  await call(a, { op: 'note', uid: p.uid, text: 'Kept until the account goes' });
  for (const path of ['nations/', 'nationx/', 'summaries/']) await del(path + p.uid);
  await call(p, { op: 'close' }, 'accounts');
  assert.equal(await get('staffNotes/' + p.uid), null);
});
test('region switches preserve records, stop battles, and atomically log the authenticated actor', async () => {
  const a = await user(true), p = await user(); await seed(p.uid); const before = (await get('nationx/' + p.uid)).fields.j;
  await call(a, { op: 'region', reg: 'meridian', enabled: false, reason: 'Storage maintenance', actor: 'forged' });
  assert.equal((await get('regionStatus/meridian')).fields.enabled.booleanValue, false);
  assert.equal((await get('regionStatus/meridian')).fields.reason, undefined);
  assert.equal((await get('regionStatus/meridian')).fields.by, undefined);
  assert.deepEqual((await get('nationx/' + p.uid)).fields.j, before);
  assert.equal((await get('nations/' + p.uid)).fields.rev.integerValue, '7');
  assert.deepEqual(await call(p, { op: 'battle', d: 'npc-vellmark', c: 100, p: 0.5 }, 'referee'), { ok: false, why: 'maintenance' });
  assert.equal(await get('armies/' + p.uid), null);
  const log = await call(a, { op: 'audit', target: 'meridian' });
  assert.ok(log.events.some(e => e.action === 'region_disabled' && e.actor === a.uid && e.reason === 'Storage maintenance' && e.before === true && e.after === false && e.at > 0));
  assert.equal((await get('regionStatus/meridian')).fields.mode.stringValue, 'maintenance');
  await call(a, { op: 'region', reg: 'meridian', enabled: false, mode: 'coming_soon', reason: 'Preparing to launch' });
  const coming = await get('regionStatus/meridian');
  assert.equal(coming.fields.enabled.booleanValue, false);
  assert.equal(coming.fields.mode.stringValue, 'coming_soon');
  assert.deepEqual(await call(p, { op: 'battle', d: 'npc-vellmark', c: 100, p: 0.5 }, 'referee'), { ok: false, why: 'coming_soon' });
  assert.equal((await get('nations/' + p.uid)).fields.rev.integerValue, '7');
  assert.ok((await call(a, { op: 'audit', target: 'meridian' })).events.some(e => e.beforeMode === 'maintenance' && e.mode === 'coming_soon' && e.before === false && e.after === false));
  await assert.rejects(call(a, { op: 'region', reg: 'meridian', enabled: false, mode: 'invalid', reason: 'bad' }), e => e.status === 'INVALID_ARGUMENT');
  assert.equal((await get('regionStatus/meridian')).fields.mode.stringValue, 'coming_soon');
  await call(a, { op: 'region', reg: 'meridian', enabled: true, reason: 'Maintenance completed' });
  assert.equal((await get('regionStatus/meridian')).fields.enabled.booleanValue, true);
  assert.equal((await get('regionStatus/meridian')).fields.mode.stringValue, 'enabled');
  await assert.rejects(call(a, { op: 'region', reg: 'unknown', enabled: false, reason: 'bad' }), e => e.status === 'INVALID_ARGUMENT');
});
test('save health reports client diagnostics alongside independently confirmed server saves', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Healthland');
  await put('saveHealth/' + p.uid + '_test', { uid: p.uid, reg: 'meridian', device: 'Desktop', status: 'offline', pending: true, error: 'unavailable', conflicts: 2, revision: 6, t: new Date() });
  const s = (await call(a, { op: 'health' })).sessions.find(s => s.uid === p.uid);
  assert.equal(s.error, 'unavailable'); assert.equal(s.conflicts, 2); assert.equal(s.serverRevision, 7); assert.equal(s.revision, 6); assert.ok(s.savedAt > 0);
});
test('moderation and support actions have immutable server outcomes, including failures', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Moderationland');
  await call(a, { op: 'moderate', action: 'hide', target: p.uid, reason: 'Verified report' }); assert.equal((await get('mod/' + p.uid)).fields.by.stringValue, a.uid);
  await call(a, { op: 'moderate', action: 'unhide', target: p.uid, reason: 'Appeal accepted' }); assert.equal(await get('mod/' + p.uid), null);
  await put('support/admin-test', { by: p.uid, st: 'open', x: 'Help', t: new Date() });
  await call(a, { op: 'moderate', action: 'support_answer', target: 'admin-test', reply: 'Fixed', reason: 'Answered support ticket' });
  assert.equal((await get('support/admin-test')).fields.rby.stringValue, a.uid);
  await assert.rejects(call(a, { op: 'moderate', action: 'support_answer', target: 'admin-test', reply: 'Again' }), e => e.status === 'FAILED_PRECONDITION');
  assert.ok((await call(a, { op: 'audit', target: 'admin-test' })).events.some(e => e.outcome === 'failed'));
  await put('boards/meridian/posts/admin-test', { a: p.uid, x: 'Spam' });
  await call(a, { op: 'moderate', action: 'ban', target: p.uid, reason: 'Repeated spam' });
  for (const path of ['nations/', 'nationx/', 'summaries/', 'space/']) assert.equal(await get(path + p.uid), null);
  assert.equal(await get('boards/meridian/posts/admin-test'), null);
  assert.equal((await get('bans/' + p.uid)).fields.by.stringValue, a.uid);
  assert.ok((await call(a, { op: 'audit', target: p.uid })).events.some(e => e.action === 'ban' && e.outcome === 'completed' && e.actor === a.uid));
});
