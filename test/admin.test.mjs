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

test('a ban marks the sign-ins it used: the same Google account comes back banned, and an unban clears the marks', async () => {
  const a = await user(true), p = await user(), sub = 'g' + p.uid;
  const jwt = o => [{ alg: 'none', typ: 'JWT' }, o].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.') + '.';
  const google = async () => {   // a new sign-in with p's Google account, as after closing the account: a new player ID
    const r = await (await fetch(auth + '/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true, postBody: 'providerId=google.com&id_token=' + jwt({ sub, email: sub.toLowerCase() + '@example.test', email_verified: true }) }) })).json();
    return { uid: r.localId, token: r.idToken };
  };
  const found = u => call(u, { op: 'authorizeSave', record: { reg: 'meridian', name: 'Comeback ' + u.uid.slice(0, 6), pop: 5, army: 1, cl: 0, updatedAt: Date.now(), j: JSON.stringify({ reg: 'meridian', name: 'Comeback ' + u.uid.slice(0, 6), pop: 5 }) }, rev: 0 }, 'civic');
  const marks = async uid => ((await (await fetch(docs + ':runQuery', { method: 'POST', headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'banIds' }], where: { fieldFilter: { field: { fieldPath: 'u' }, op: 'EQUAL', value: { stringValue: uid } } } } }) })).json()).filter(r => r.document));
  await link(p, { google: true });
  await call(a, { op: 'moderate', action: 'ban', target: p.uid, reason: 'Cheating' });
  assert.ok((await marks(p.uid)).length >= 1, 'the Google account (and its address, when verified)');
  // the banned player closes the account (allowed: their data is theirs to delete) and signs in again
  await call(p, { op: 'close' }, 'accounts');
  const q = await google(); assert.notEqual(q.uid, p.uid);
  await assert.rejects(found(q), e => e.status === 'FAILED_PRECONDITION');
  assert.ok(await get('bans/' + q.uid), 'the new account is banned too');
  // an unban takes the marks away
  await call(a, { op: 'moderate', action: 'unban', target: p.uid, reason: 'Appeal accepted' });
  assert.equal((await marks(p.uid)).length, 0);
  // a ban from before the marks: closing the account marks its sign-ins then
  const r = await user(); await link(r, { email: true });
  await put('bans/' + r.uid, { note: 'Old ban', name: '', t: 1, by: a.uid });
  await call(r, { op: 'close' }, 'accounts');
  assert.equal((await marks(r.uid)).length, 1);
});

test('staff endpoints reject visitors and ordinary players', async () => {
  const g = await user();
  await assert.rejects(call(null, { op: 'search' }), e => e.status === 'UNAUTHENTICATED');
  for (const op of ['search', 'player', 'health', 'stats', 'audit', 'region', 'moderate', 'note']) await assert.rejects(call(g, { op }), e => e.status === 'PERMISSION_DENIED');
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
test('an admin turns a free Chancery Club membership on and off, audited, and the player’s shop follows', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Clubland');
  assert.equal((await call(a, { op: 'player', uid: p.uid })).club.until, 0);
  await assert.rejects(call(p, { op: 'club', uid: p.uid, days: 30, reason: 'Me' }), e => e.status === 'PERMISSION_DENIED');
  await assert.rejects(call(a, { op: 'club', uid: p.uid, days: 30 }), e => e.status === 'INVALID_ARGUMENT');
  await assert.rejects(call(a, { op: 'club', uid: p.uid, days: 12, reason: 'Odd' }), e => e.status === 'INVALID_ARGUMENT');
  const on = (await call(a, { op: 'club', uid: p.uid, days: 30, reason: 'Contest prize' })).club;
  assert.ok(on.until > Date.now() + 29 * 864e5); assert.equal(on.plan, 'comp'); assert.equal(on.comp.by, a.uid); assert.equal(on.comp.why, 'Contest prize');
  assert.equal((await get('shop/' + p.uid)).fields.vip.mapValue.fields.plan.stringValue, 'comp');
  const off = (await call(a, { op: 'club', uid: p.uid, days: 0, reason: 'Prize withdrawn' })).club;
  assert.equal(off.comp, null); assert.equal(off.until, 0);
  assert.equal(await get('shopComp/' + p.uid), null);
  const log = (await call(a, { op: 'audit', target: p.uid })).events;
  assert.ok(log.some(e => e.action === 'club_granted' && e.name === 'Clubland' && e.outcome === 'completed'));
  assert.ok(log.some(e => e.action === 'club_revoked' && e.reason === 'Prize withdrawn'));
});
test('the player page brings the nation, purchases, same-address accounts, reports and admin actions', async () => {
  const a = await user(true), p = await user(), q = await user(); await seed(p.uid, 'Overviewland'); await seed(q.uid, 'Neighbourland');
  await put('accountSeen/' + p.uid, { ip: '203.0.113.9', at: Date.now() }); await put('accountSeen/' + q.uid, { ip: '203.0.113.9', at: Date.now() });
  await put('reports/ovr' + p.uid.slice(0, 10), { by: q.uid, kind: 'nation', target: p.uid, reg: 'meridian', reason: 'spam', t: Date.now() });
  await put('shopTx/txn_ovr' + p.uid.slice(0, 8).toLowerCase(), { uid: p.uid, product: 'founder', status: 'completed', ok: true, paid: Date.now() });
  await call(a, { op: 'note', uid: p.uid, text: 'Watching' });
  const r = await call(a, { op: 'player', uid: p.uid });
  assert.ok(r.nation && typeof r.nation.dec === 'number');
  assert.deepEqual(r.alts.map(x => x.uid), [q.uid]); assert.equal(r.alts[0].name, 'Neighbourland');
  assert.equal(r.reports.against.length, 1); assert.equal(r.reports.against[0].reason, 'spam');
  assert.equal(r.purchases.tx.length, 1); assert.equal(r.purchases.tx[0].product, 'founder');
  assert.ok(r.actions.some(e => e.action === 'note_saved'));
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
  /* Terra too (the admin list now comes from civic-data.json, which the save permit uses) */
  await call(a, { op: 'region', reg: 'terra', enabled: true, reason: 'Opening Terra' });
  assert.equal((await get('regionStatus/terra')).fields.enabled.booleanValue, true);
  await call(a, { op: 'region', reg: 'terra', enabled: false, mode: 'coming_soon', reason: 'Not yet' });
  assert.equal((await get('regionStatus/terra')).fields.mode.stringValue, 'coming_soon');
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
test('a support ticket is a conversation: a reply keeps it open, the player writes back, closes it and opens it again', async () => {
  const a = await user(true), p = await user(), q = await user(), sup = (u, d) => call(u, { op: 'support', ...d }, 'accounts');
  const say = (reply, action = 'support_reply') => call(a, { op: 'moderate', action, target: 'talk-test', reply, reason: 'Replied to support ticket' });
  const doc = async () => (await get('support/talk-test')).fields, thread = f => (f.m?.arrayValue?.values || []).map(v => v.mapValue.fields);
  await put('support/talk-test', { by: p.uid, topic: 'play', st: 'open', x: 'How do I claim land?', t: new Date(), name: 'Talkland' });
  await assert.rejects(say(''), e => e.status === 'INVALID_ARGUMENT');                            // a reply needs words
  await say('Open the Map and pick a hex next to your border.');
  let f = await doc();
  assert.equal(f.st.stringValue, 'open'); assert.equal(f.w.stringValue, 'p'); assert.equal(Number(f.pc.integerValue), 0); assert.ok(f.lt.timestampValue);
  assert.equal(thread(f).length, 1); assert.equal(thread(f)[0].a.stringValue, 's'); assert.equal(thread(f)[0].by.stringValue, a.uid);
  assert.ok(!f.ct && !f.exp && !f.rby, 'a reply does not close it');
  // the player writes back, and only on their own ticket
  await assert.rejects(sup(q, { step: 'reply', id: 'talk-test', x: 'Me too' }), e => e.status === 'FAILED_PRECONDITION');
  await assert.rejects(sup(p, { step: 'reply', id: 'talk-test', x: '   ' }), e => e.status === 'INVALID_ARGUMENT');
  await assert.rejects(sup(p, { step: 'reply', id: '../nations/x', x: 'Hi' }), e => e.status === 'INVALID_ARGUMENT');
  await sup(p, { step: 'reply', id: 'talk-test', x: 'Which hexes\r\ncount as next to it?' });
  f = await doc();
  assert.ok(!f.w, 'the team’s turn again'); assert.equal(Number(f.pc.integerValue), 1);
  assert.equal(thread(f)[1].a.stringValue, 'p'); assert.equal(thread(f)[1].x.stringValue, 'Which hexes\ncount as next to it?');
  // three in a row at most, until the team answers
  await sup(p, { step: 'reply', id: 'talk-test', x: 'Hello?' }); await sup(p, { step: 'reply', id: 'talk-test', x: 'Anyone?' });
  await assert.rejects(sup(p, { step: 'reply', id: 'talk-test', x: 'Fourth' }), e => e.status === 'FAILED_PRECONDITION');
  // the Live feed shows the player writing back
  const fe = await call(a, { op: 'feed', span: 'h1', refresh: true });
  assert.ok(fe.events.some(e => e.k === 'ticketr' && e.uid === p.uid && /Anyone/.test(e.x)), 'a reply in the feed');
  // the team answers and closes; the player opens it again by writing in it
  await say('Any hex that touches one you hold.', 'support_answer');
  f = await doc();
  assert.equal(f.st.stringValue, 'closed'); assert.equal(f.rby.stringValue, a.uid); assert.ok(f.exp.timestampValue); assert.ok(!f.w); assert.equal(thread(f).length, 5);
  await assert.rejects(say('More'), e => e.status === 'FAILED_PRECONDITION');                     // closed stays closed for the team
  const r = await sup(p, { step: 'reply', id: 'talk-test', x: 'One more thing' });
  assert.equal(r.reopened, true);
  f = await doc();
  assert.equal(f.st.stringValue, 'open'); assert.ok(!f.ct && !f.exp && !f.rby); assert.equal(Number(f.pc.integerValue), 1);
  // the player closes it themself, and nobody else can
  await assert.rejects(sup(q, { step: 'close', id: 'talk-test' }), e => e.status === 'FAILED_PRECONDITION');
  await sup(p, { step: 'close', id: 'talk-test' });
  f = await doc();
  assert.equal(f.st.stringValue, 'closed'); assert.equal(f.rby.stringValue, p.uid); assert.ok(f.exp.timestampValue);
  // an admin reopens it; a ticket closed too long ago stays closed for the player
  await call(a, { op: 'moderate', action: 'support_reopen', target: 'talk-test', reason: 'Reopened support ticket' });
  assert.equal((await doc()).st.stringValue, 'open');
  await assert.rejects(call(a, { op: 'moderate', action: 'support_reopen', target: 'talk-test', reason: 'x' }), e => e.status === 'FAILED_PRECONDITION');
  await put('support/talk-old', { by: p.uid, topic: 'play', st: 'closed', x: 'Old question', t: new Date(Date.now() - 40 * 86400000), ct: new Date(Date.now() - 20 * 86400000), rby: a.uid });
  await assert.rejects(sup(p, { step: 'reply', id: 'talk-old', x: 'Still there?' }), e => e.status === 'FAILED_PRECONDITION' && /Create a new ticket/.test(e.message));
  assert.ok((await call(a, { op: 'audit', target: 'talk-test' })).events.some(e => e.action === 'support_reply' && e.outcome === 'completed'));
});
test('statistics count every nation and account, for the world or one region, and the nightly job records them', async () => {
  const a = await user(true), p = await user(), q = await user(); await user();
  const now = Date.now(), rec = (name, reg, extra) => JSON.stringify({ name, reg, pop: 5, founded: now - 3 * 86400000, updatedAt: now, ...extra });
  await put('nations/' + p.uid, { name: 'Statland', reg: 'meridian', pop: 6, updatedAt: now, j: rec('Statland', 'meridian', { answered: [{ id: 'tax', o: 1, t: now - 60000 }] }) });
  await put('nationx/' + p.uid, { j: JSON.stringify({ freq: 60, tut: { lc: ['settle'] } }) });
  await put('nations/' + q.uid, { name: 'Frostland', reg: 'frostmarch', pop: 5, updatedAt: now - 2 * 86400000, j: rec('Frostland', 'frostmarch') });
  await assert.rejects(call(a, { op: 'stats', reg: 'atlantis' }), e => e.status === 'INVALID_ARGUMENT');
  const w = await call(a, { op: 'stats', refresh: true });
  assert.ok(w.nations >= 2 && w.a1 >= 1 && w.dec1 >= 1, JSON.stringify({ nations: w.nations, a1: w.a1, dec1: w.dec1 }));
  assert.equal(w.list, null, 'no nation list for the whole world');
  assert.ok(w.accounts.total >= 4 && w.accounts.withNation >= 2 && w.tut.settle >= 1 && w.pace[60] >= 1);
  assert.ok(w.regions.some(r => r.reg === 'frostmarch' && r.nations >= 1) && w.regions.some(r => r.reg === 'saffron'), 'every region, with or without nations');
  const f = await call(a, { op: 'stats', reg: 'frostmarch' });
  assert.ok(f.list.some(x => x.id === q.uid && x.name === 'Frostland') && !f.list.some(x => x.id === p.uid));
  // the nightly record: once a day, and the page draws it
  const job = () => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../jobs/stats/run.mjs', import.meta.url)), '--project', project, '--now', String(Date.parse('2030-01-02T00:07:00Z'))], { env: process.env }).then(r => JSON.parse(r.stdout));
  const first = await job(), again = await job();
  assert.equal(first.day, '2030-01-01'); assert.equal(first.recorded, true); assert.equal(again.recorded, false);
  assert.ok(first.nations >= 2 && first.accounts >= 4);
  assert.ok((await get('statsDays/2030-01-01')).fields.all.mapValue.fields.nations);
  const h = await call(a, { op: 'stats', refresh: true });
  assert.equal(h.history.at(-1).d, '2030-01-01'); assert.ok(h.history.at(-1).nations >= 2);
});
test('player search shows each player’s engagement score from the last count, and sorts and filters by it', async () => {
  const a = await user(true), p = await user(), now = Date.now();
  const rulings = Array.from({ length: 30 }, (_, i) => ({ id: 'e' + i, o: 0, t: now - i * 3600000 }));
  const hist = Array.from({ length: 14 }, (_, i) => ({ t: now - i * 86400000, p: 5 }));
  await put('nations/' + p.uid, { name: 'Keenland', reg: 'meridian', pop: 5, updatedAt: now, j: JSON.stringify({ name: 'Keenland', reg: 'meridian', pop: 5, founded: now - 20 * 86400000, updatedAt: now, answered: rulings, hist, deals: [{}], alli: { a: 1 }, wars: { x: {} }, claims: [{}], cities: [{ b: [{}] }, {}] }) });
  await put('summaries/' + p.uid, { name: 'Keenland', reg: 'meridian', pop: 5, t: now });
  await call(a, { op: 'stats', refresh: true });
  assert.ok(await get('statsEngage/0'), 'counting the statistics writes the scores');
  const found = (await call(a, { op: 'search', q: 'keenland', refresh: true })).players.find(x => x.uid === p.uid);
  assert.ok(Array.isArray(found.eng) && found.eng[0] >= 90, JSON.stringify(found.eng));
  const top = await call(a, { op: 'search', sort: 'eng', eng: 'hi' });
  assert.ok(top.players.length && top.players[0].eng[0] >= top.players.at(-1).eng[0]); assert.ok(top.players.every(x => x.eng && x.eng[0] >= 60));
  assert.ok(top.engAt > 0);
  assert.ok((await call(a, { op: 'search', eng: 'lo' })).players.every(x => x.uid !== p.uid));
  assert.ok((await call(a, { op: 'player', uid: p.uid })).nation.eng[0] >= 90, 'the player page counts it afresh');
});
test('the watchlist: added with a reason, compared with now, audited, and gone with the account', async () => {
  const a = await user(true), p = await user(); await seed(p.uid, 'Watchedland');
  await assert.rejects(call(p, { op: 'watch', action: 'list' }), e => e.status === 'PERMISSION_DENIED');
  await assert.rejects(call(a, { op: 'watch', action: 'add', uid: p.uid }), e => e.status === 'INVALID_ARGUMENT');
  const added = (await call(a, { op: 'watch', action: 'add', uid: p.uid, why: 'Second account of a banned player?' })).watch;
  assert.equal(added.why, 'Second account of a banned player?'); assert.equal(added.by, a.uid);
  assert.deepEqual((await call(a, { op: 'player', uid: p.uid })).watch, added);
  const row = (await call(a, { op: 'watch', action: 'list' })).rows.find(r => r.uid === p.uid);
  assert.equal(row.base.name, 'Watchedland'); assert.equal(row.now.name, 'Watchedland'); assert.equal(row.reports, 0);
  const log = (await call(a, { op: 'audit', target: p.uid })).events;
  assert.ok(log.some(e => e.action === 'watch_added' && e.actor === a.uid && e.name === 'Watchedland'));
  await call(a, { op: 'watch', action: 'remove', uid: p.uid });
  assert.equal(await get('watch/' + p.uid), null); assert.equal((await call(a, { op: 'player', uid: p.uid })).watch, null);
  assert.ok((await call(a, { op: 'audit', target: p.uid })).events.some(e => e.action === 'watch_removed'));
  await call(a, { op: 'watch', action: 'add', uid: p.uid, why: 'Kept until the account goes' });
  for (const path of ['nations/', 'nationx/', 'summaries/']) await del(path + p.uid);
  await call(p, { op: 'close' }, 'accounts');
  assert.equal(await get('watch/' + p.uid), null);
});
test('the Live feed: foundings, what nations did to each other, reports and board posts, but never letters', async () => {
  const a = await user(true), p = await user(), q = await user(), now = Date.now();
  await put('summaries/' + p.uid, { name: 'Feedland', reg: 'meridian', pop: 5, t: now, f: now - 60000 });
  await put('summaries/' + q.uid, { name: 'Targetia', reg: 'meridian', pop: 5, t: now - 86400000 });
  await put(`mailQ/${p.uid}~${q.uid}~war`, { by: p.uid, to: q.uid, k: 'war', nm: 'Feedland', t: new Date(now - 30000) });
  await put(`mailQ/${p.uid}~${q.uid}~msg`, { by: p.uid, to: q.uid, k: 'msg', nm: 'Feedland', t: new Date(now - 20000) });
  await put('reports/feedrep', { by: q.uid, target: p.uid, kind: 'nation', reason: 'spam', name: 'Feedland', reg: 'meridian', t: new Date(now - 10000) });
  await put('cb/meridian/posts/FeedTopic00000000000', { a: p.uid, nm: 'Feedland', ti: 'Grain prices', x: 'Too high', t: now - 5000 });
  await assert.rejects(call(p, { op: 'feed' }), e => e.status === 'PERMISSION_DENIED');
  const f = await call(a, { op: 'feed', span: 'h1', refresh: true }), mine = f.events.filter(e => e.uid === p.uid || e.to === p.uid);
  const kinds = mine.map(e => e.k);
  for (const k of ['found', 'war', 'report', 'topic']) assert.ok(kinds.includes(k), k + ' in ' + kinds.join());
  assert.ok(!f.events.some(e => e.k === 'msg'), 'letters are never shown');
  const war = mine.find(e => e.k === 'war'); assert.equal(war.toName, 'Targetia'); assert.equal(war.reg, 'meridian');
  assert.equal(mine.find(e => e.k === 'report').byName, 'Targetia');
  assert.ok(f.online >= 0 && f.counts.war >= 1);
  const wars = await call(a, { op: 'feed', span: 'h1', groups: ['war'] });
  assert.ok(wars.events.length && wars.events.every(e => ['war', 'conq', 'peace'].includes(e.k)));
  assert.ok(!(await call(a, { op: 'feed', span: 'h1', reg: 'frostmarch' })).events.some(e => e.uid === p.uid));
  await assert.rejects(call(a, { op: 'feed', reg: 'atlantis' }), e => e.status === 'INVALID_ARGUMENT');
});
test('the alerts job files each finding once, posts the new ones to Discord, and the page lists and settles them', async () => {
  const a = await user(true), p = await user(), q = await user(), r = await user(), now = Date.now(), H = 3600000;
  for (const i of [1, 2, 3]) await put('reports/alertrep' + i, { by: p.uid, target: q.uid, kind: 'nation', reason: 'name', name: 'Reportia', reg: 'meridian', t: new Date(now - i * H) });
  await put('nations/' + r.uid, { name: 'Boomland', reg: 'meridian', pop: 9, j: JSON.stringify({ name: 'Boomland', reg: 'meridian', pop: 9, hist: [{ t: now - 24 * H, p: 2 }] }) });
  await put('summaries/' + r.uid, { name: 'Boomland', reg: 'meridian', pop: 9, t: now });
  await put('summaries/' + p.uid, { name: 'Watchland', reg: 'meridian', pop: 5, t: now - 3 * H });
  await put('shopTx/alerttx', { uid: p.uid, ok: true, product: 'vip', paid: now - 60000 });
  await call(a, { op: 'watch', action: 'add', uid: p.uid, why: 'Alerts test' });
  /* a stand-in for Discord's webhook */
  const { createServer } = await import('node:http'), posts = [];
  const hook = createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { posts.push(JSON.parse(b)); res.writeHead(204).end(); }); });
  await new Promise(ok => hook.listen(0, '127.0.0.1', ok));
  const run = t => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../jobs/stats/alerts.mjs', import.meta.url)), '--project', project, '--now', String(t)],
    { env: { ...process.env, STAFF_ALERT_WEBHOOK: `http://127.0.0.1:${hook.address().port}/hook` } }).then(x => JSON.parse(x.stdout));
  try {
    const first = await run(now), day = new Date(now).toISOString().slice(0, 10);
    for (const id of [`rep~${q.uid}~${day}`, `pop~${r.uid}~${day}`, 'buy~alerttx']) assert.ok(await get('adminAlerts/' + id), id);
    assert.equal(first.discord, 'sent'); assert.equal(posts.length, 1); assert.match(posts[0].content, /Reportia was reported 3 times/); assert.match(posts[0].content, /#admin-watch>$/);
    const again = await run(now + 60000);
    assert.equal(again.filed, 0, 'nothing is filed twice'); assert.equal(posts.length, 1, 'and nothing is posted twice');
    await put('summaries/' + p.uid, { name: 'Watchland', reg: 'meridian', pop: 5, t: now + 90000 });
    await run(now + 120000);
    assert.ok(await get(`adminAlerts/won~${p.uid}~${new Date(now + 120000).toISOString().slice(0, 13)}`), 'a watched player back after hours away');
  } finally { hook.close(); }
  await assert.rejects(call(p, { op: 'alerts' }), e => e.status === 'PERMISSION_DENIED');
  const list = await call(a, { op: 'alerts' });
  assert.ok(list.alerts.some(x => x.k === 'reports' && x.uid === q.uid && !x.seen)); assert.ok(list.unseen >= 4); assert.equal(list.run.discord, 'sent');
  assert.equal(list.cfg.reports, 3);
  const one = list.alerts.find(x => x.k === 'buy');
  assert.equal((await call(a, { op: 'alerts', action: 'seen', ids: [one.id, 'no-such-alert'] })).marked, 1);
  assert.equal((await call(a, { op: 'alerts', action: 'seen' })).unseen, 0);
  assert.equal((await call(a, { op: 'alerts', action: 'count' })).unseen, 0);
  const cfg = (await call(a, { op: 'alerts', action: 'cfg', cfg: { reports: 5, errPct: 900, buys: false } })).cfg;
  assert.equal(cfg.reports, 5); assert.equal(cfg.errPct, 100); assert.equal(cfg.buys, false);
  assert.equal((await call(a, { op: 'alerts' })).cfg.reports, 5);
  assert.ok((await call(a, { op: 'audit', target: 'alerts' })).events.some(e => e.action === 'alerts_config' && e.actor === a.uid));
  await call(a, { op: 'alerts', action: 'cfg', cfg: { reports: 3, buys: true } });
});

test('a reported classified advertisement is struck out for the whole region, and the paper\'s name can be reset', async () => {
  const a = await user(true), p = await user();
  await put('press/meridian', { nm: 'The Rude Gazette', mo: 'Rude since today', by: p.uid, bn: 'Rudeland', t: Date.now() });
  await call(a, { op: 'moderate', action: 'delete_post', target: `ad:meridian:${p.uid}:abc123`, reg: 'meridian', reason: 'Spam or advertising' });
  let d = await get('press/meridian');
  assert.ok(d.fields.x.mapValue.fields[p.uid + '_abc123'], 'the advertisement is struck out');
  assert.equal(d.fields.nm.stringValue, 'The Rude Gazette', 'the name is untouched by a removal');
  await assert.rejects(call(a, { op: 'moderate', action: 'delete_post', target: `ad:nowhere:${p.uid}:abc123`, reason: 'x' }), e => e.status === 'INVALID_ARGUMENT');
  await call(a, { op: 'moderate', action: 'press_reset', target: 'meridian', reason: 'Offensive name' });
  d = await get('press/meridian');
  assert.equal(d.fields.nm.stringValue, '');assert.equal(d.fields.mo.stringValue, '');assert.equal(d.fields.by, undefined);
  assert.ok(d.fields.x.mapValue.fields[p.uid + '_abc123'], 'and the removals stay');
  await assert.rejects(call(p, { op: 'moderate', action: 'press_reset', target: 'meridian', reason: 'x' }));
});
test('admins list who a player writes to and read one conversation only with a reason, every look audited', async () => {
  const a = await user(true), p = await user(), q = await user(), r = await user();
  await seed(p.uid, 'Penland'); await seed(q.uid, 'Quillia'); await seed(r.uid, 'Rookmere');
  const t0 = Date.now() - 3600000, exp = new Date(Date.now() + 365 * 86400000);
  const letter = (by, to, t, x) => put(`letters/${by}~${to}~${t}`, { by, to, x, t, ts: new Date(t), exp });
  await letter(p.uid, q.uid, t0, 'Hello Quillia, shall we trade timber?');
  await letter(q.uid, p.uid, t0 + 60000, 'Gladly.\nTen for ten.');
  await letter(p.uid, r.uid, t0 + 120000, 'A word about the border.');
  await assert.rejects(call(p, { op: 'letters', uid: q.uid }), e => e.status === 'PERMISSION_DENIED');
  const list = await call(a, { op: 'letters', uid: p.uid });
  assert.deepEqual(list.people.map(c => [c.name, c.sent, c.got]), [['Rookmere', 1, 0], ['Quillia', 1, 1]]);
  await assert.rejects(call(a, { op: 'letters', uid: p.uid, with: q.uid }), e => e.status === 'INVALID_ARGUMENT');
  await assert.rejects(call(a, { op: 'letters', uid: p.uid, with: q.uid, reason: 'hm' }), e => e.status === 'INVALID_ARGUMENT');
  const th = await call(a, { op: 'letters', uid: p.uid, with: q.uid, reason: 'Report 42: harassment' });
  assert.deepEqual(th.letters.map(l => [l.by === p.uid ? 'p' : 'q', l.x]), [['p', 'Hello Quillia, shall we trade timber?'], ['q', 'Gladly.\nTen for ten.']]);
  assert.equal(th.otherName, 'Quillia');
  const log = (await call(a, { op: 'audit', target: p.uid })).events;
  assert.ok(log.some(e => e.action === 'letters_listed' && e.actor === a.uid));
  const read = log.find(e => e.action === 'letters_read');
  assert.ok(read && read.actor === a.uid && read.with === q.uid && read.reason === 'Report 42: harassment' && !JSON.stringify(read).includes('timber'));
});
