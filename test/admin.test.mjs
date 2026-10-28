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
async function call(u, data, name = 'adminConsole') {
  const r = await fetch(functions + name, { method: 'POST', headers: { 'content-type': 'application/json', ...(u ? { authorization: 'Bearer ' + u.token } : {}) }, body: JSON.stringify({ data }) });
  const b = await r.json(); if (b.error) throw Object.assign(new Error(b.error.message), { status: b.error.status }); return b.result;
}
const value = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { integerValue: String(v) };
async function put(path, data) { const r = await fetch(docs + '/' + path, { method: 'PATCH', headers, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k,v]) => [k,value(v)])) }) }); assert.equal(r.status, 200); }
async function get(path) { const r = await fetch(docs + '/' + path, { headers }); return r.status === 200 ? r.json() : null; }
async function seed(uid, name = 'Old Émber Republic') {
  await put('nations/' + uid, { name, reg: 'meridian', pop: 5, army: 2, rev: 7, ts: new Date(), j: JSON.stringify({ name, reg: 'meridian', pop: 5 }) });
  await put('summaries/' + uid, { name, reg: 'meridian', pop: 5, t: Date.now() });
  await put('nationx/' + uid, { j: '{"private":"kept"}' });
}

test('staff endpoints reject visitors and ordinary players', async () => {
  const g = await user();
  await assert.rejects(call(null, { op: 'search' }), e => e.status === 'UNAUTHENTICATED');
  for (const op of ['search', 'player', 'health', 'audit', 'region', 'moderate']) await assert.rejects(call(g, { op }), e => e.status === 'PERMISSION_DENIED');
});
test('search includes legacy summaries, case-insensitive names and exact player IDs', async () => {
  const a = await user(true), p = await user(); await seed(p.uid);
  const found = await call(a, { op: 'search', q: 'EMBER', refresh: true }); assert.ok(found.players.some(n => n.uid === p.uid));
  assert.equal((await call(a, { op: 'search', q: p.uid })).players[0].uid, p.uid);
  assert.equal((await call(a, { op: 'search', q: p.uid, reg: 'frostmarch' })).players.length, 0);
  const detail = await call(a, { op: 'player', uid: p.uid }); assert.equal(detail.revision, 7); assert.ok(detail.savedAt > 0); assert.equal(detail.name, 'Old Émber Republic');
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
  await call(a, { op: 'region', reg: 'meridian', enabled: true, reason: 'Maintenance completed' });
  assert.equal((await get('regionStatus/meridian')).fields.enabled.booleanValue, true);
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
