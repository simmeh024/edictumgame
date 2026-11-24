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
function nation(uid, rec = {}, army = 5, reg = 'meridian') {
  const j = JSON.stringify({ name: 'Testland', reg, pop: 12, ...rec });
  return doc('nations/' + uid, { method: 'PATCH', body: JSON.stringify({ fields: {
    v: { integerValue: '1' }, j: { stringValue: j }, reg: { stringValue: reg }, name: { stringValue: 'Testland' },
    updatedAt: { integerValue: String(Date.now()) }, ts: { timestampValue: new Date().toISOString() },
    pop: { doubleValue: 12 }, army: { doubleValue: army }, cl: { integerValue: '0' } } }) });
}
// the game's check of a seal (refVerify() in game/edictum.html), against the referee's public key
async function checker() {
  const k = (await read('referee/pub')).fields.k.stringValue;
  const key = await crypto.subtle.importKey('spki', Buffer.from(k, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return (uid, c, t, w, s, d) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(s, 'base64url'),
    new TextEncoder().encode((d === undefined ? ['edictum-battle-1', uid, c, t, w || ''] : ['edictum-battle-2', uid, c, t, w || '', d]).join('|')));
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
    assert.equal(typeof r.s2 === 'string', r.win, 'and the second seal, naming the defender');
    assert.equal(r.d, NPC);
    if (r.win) won.push({ c: 100 + i, t: r.t, w: i === 3 ? 'ally-1' : '', s: r.s, s2: r.s2 });
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
    assert.equal(await ok(g.uid, e.c, e.t, e.w, e.s2, NPC), true, 'the second seal names the defender');
    assert.equal(await ok(g.uid, e.c, e.t, e.w, e.s2, 'npc-tarrow'), false, 'another defender');
    assert.equal(await ok(g.uid, e.c, e.t, e.w, e.s2, 'someone-else'), false, 'a player for a computer nation');
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

/* military buildings (functions/war-rules.js milReady): read from the attacker's own record */
test('an Arsenal holds one more point, and a Drill Ground brings a point back 20% sooner', async () => {
  const g = await guest(), now = Date.now(), b = (k, x = {}) => ({ k, s: now - 2 * 86400000, d: now - 86400000, ...x });
  await nation(g.uid, { policies: {}, cities: [{ id: 'cap', c: 10, b: [b('barracks'), b('armoury')] }] });
  for (let i = 0; i < 8; i++) assert.equal((await battle(g, { c: 300 + i })).ok, true, 'point ' + (i + 1));   // 6, the Arsenal's, the slack
  assert.equal((await battle(g)).why, 'ready');
  const v = x => Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  const spent = () => doc('armies/' + g.uid, { method: 'PATCH', body: JSON.stringify({ fields: { r: v(0), at: v(Date.now() - 12.5 * 60000), n: v(1), w: v(0) } }) });
  await spent();
  assert.equal((await battle(g)).why, 'ready', '12.5 minutes on: not back without a Drill Ground');
  await nation(g.uid, { policies: {}, cities: [{ id: 'cap', c: 10, b: [b('barracks'), b('armoury'), b('drillyard')] }] });
  await spent();
  assert.equal((await battle(g)).ok, true, 'a Drill Ground readies it in 12');
  /* a Drill Ground still being built does nothing */
  await nation(g.uid, { policies: {}, cities: [{ id: 'cap', c: 10, b: [b('drillyard', { d: Date.now() + 86400000 })] }] });
  await spent();
  assert.equal((await battle(g)).why, 'ready');
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
  /* an alliance the server keeps (allyOf/, functions/alliances.js) counts too: here the stranger has joined g's */
  const index = (uid, a) => doc('allyOf/' + uid, { method: 'PATCH', body: JSON.stringify({ fields: { a: { stringValue: a }, reg: { stringValue: 'meridian' } } }) });
  await index(g.uid, 'srv-pact'); await index(stranger.uid, 'srv-pact');
  const big = await battle(g, { d: foe.uid, p: 0.9, h: [stranger.uid] });
  assert.equal(big.p, 0.9, 'a fellow member of a server alliance adds half its army: ' + big.p);
  const old = await battle(g, { d: foe.uid, p: 0.9, h: [friend.uid] });
  assert.ok(Math.abs(old.p - 20 / 1020) < 1e-3, "once its alliance is the server’s, the old founder’s record no longer counts: " + old.p);
  await del('allyOf/' + g.uid); await del('allyOf/' + stranger.uid);
  const log = (await list(`armies/${g.uid}/log`)).map(d => d.fields);
  assert.ok(log.some(f => f.d.stringValue === foe.uid && Math.abs((f.cap.doubleValue ?? Number(f.cap.integerValue)) - 20 / 1020) < 1e-3), 'the log keeps the bound');
});

test('the defender must be a nation of the attacker’s region, and an attacker without an army gets no odds', async () => {
  const g = await guest(), away = await guest(), foe = await guest(), none = await guest();
  await nation(g.uid);
  await nation(away.uid, { wars: { [g.uid]: { t: Date.now() } } }, 10, 'frostmarch');
  assert.deepEqual(await battle(g, { d: 'no-such-nation' }), { ok: false, why: 'gone' }, 'an id with no nation');
  assert.deepEqual(await battle(g, { d: 'npc-frostmarch-brimvik' }), { ok: false, why: 'gone' }, 'another region’s computer nation');
  assert.deepEqual(await battle(g, { d: away.uid }), { ok: false, why: 'gone' }, 'a player in another region');
  await nation(none.uid, {}, 0);
  await nation(foe.uid, { wars: { [none.uid]: { t: Date.now() } } }, 10);
  assert.equal((await battle(none, { d: foe.uid, p: 0.95 })).p, 0, 'no army against an army');
  assert.equal((await list(`armies/${g.uid}/log`)).length, 0, 'refused battles are not fought');
});

test('a banned account cannot fight', async () => {
  const g = await guest();
  await nation(g.uid);
  await doc('bans/' + g.uid, { method: 'PATCH', body: JSON.stringify({ fields: { t: { integerValue: '1' }, by: { stringValue: 'admin' } } }) });
  assert.deepEqual(await battle(g), { ok: false, why: 'banned' });
});

test('a nation a moderator has hidden fights nobody, and nobody fights it, until it is shown again', async () => {
  const g = await guest(), foe = await guest();
  await nation(g.uid);
  await nation(foe.uid, { wars: { [g.uid]: { t: Date.now() } } }, 5);
  const hide = uid => doc('mod/' + uid, { method: 'PATCH', body: JSON.stringify({ fields: { hidden: { booleanValue: true }, t: { integerValue: '1' }, by: { stringValue: 'admin' } } }) });
  await hide(foe.uid);
  assert.deepEqual(await battle(g, { d: foe.uid }), { ok: false, why: 'hidden' }, 'its land cannot be attacked');
  assert.equal((await battle(g)).ok, true, 'the attacker may still fight a computer nation');
  await del('mod/' + foe.uid);
  assert.equal((await battle(g, { d: foe.uid })).ok, true, 'shown again, it can be fought');
  await hide(g.uid);
  assert.deepEqual(await battle(g), { ok: false, why: 'hidden' }, 'a hidden attacker stays at home');
  await del('mod/' + g.uid);
  assert.equal((await battle(g)).ok, true, 'and goes to war again once shown');
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

test('only the members of a nation’s defence pact fight beside it; a pact between any alliance of each side stops the battle', async () => {
  const g = await guest(), foe = await guest(), mate = await guest();
  await nation(g.uid, {}, 1);
  await nation(foe.uid, { wars: { [g.uid]: { t: Date.now() } } }, 1000);
  await nation(mate.uid, {}, 1000);
  const put = (path, fields) => doc(path, { method: 'PATCH', body: JSON.stringify({ fields }) });
  const v = x => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : Number.isInteger(x) ? { integerValue: String(x) } : Array.isArray(x) ? { arrayValue: { values: x.map(v) } } : { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
  const fields = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, v(x)]));
  /* the same trade bloc: no help in war */
  await put('allyOf/' + g.uid, fields({ v: 2, reg: 'meridian', t: 1, s: { def: 'srv-d1', trade: 'srv-t1' }, a: 'srv-d1' }));
  await put('allyOf/' + mate.uid, fields({ v: 2, reg: 'meridian', t: 1, s: { trade: 'srv-t1' }, a: 'srv-t1' }));
  const trade = await battle(g, { d: foe.uid, p: 0.9, h: [mate.uid] });
  assert.ok(Math.abs(trade.p - 20 / 1020) < 1e-3, 'a fellow member of a trade bloc adds nothing: ' + trade.p);
  /* the same defence pact: half its army */
  await put('allyOf/' + mate.uid, fields({ v: 2, reg: 'meridian', t: 1, s: { trade: 'srv-t1', def: 'srv-d1' }, a: 'srv-t1' }));
  assert.equal((await battle(g, { d: foe.uid, p: 0.9, h: [mate.uid] })).p, 0.9, 'a fellow member of a defence pact adds half its army');
  /* a pact between the attacker's trade bloc and the defender's cultural union */
  await put('allyOf/' + foe.uid, fields({ v: 2, reg: 'meridian', t: 1, s: { culture: 'srv-c2' }, a: 'srv-c2' }));
  await put('alliances/srv-t1', fields({ reg: 'meridian', name: 'Bloc', mem: { [g.uid]: { t: 1 } }, rel: { 'srv-c2': { k: 'pact', st: 'active', t: 1, at: 1 } } }));
  const r = await battle(g, { d: foe.uid, p: 0.5 });
  assert.equal(r.ok, false); assert.equal(r.why, 'pact');
  for (const p of ['allyOf/' + g.uid, 'allyOf/' + mate.uid, 'allyOf/' + foe.uid, 'alliances/srv-t1', 'armies/' + g.uid]) await del(p);
});

test('a non-aggression pact, or a pact between the two alliances, stops the battle until it is ended or broken', async () => {
  const a = await guest(), b = await guest();
  /* a guest may fight a player only in a war that player declared: b declared one on a */
  await nation(a.uid); await nation(b.uid, { wars: { [a.uid]: { t: 1 } } });
  const tid = 'nap_' + [a.uid, b.uid].sort().join('_'), put = (path, fields) => doc(path, { method: 'PATCH', body: JSON.stringify({ fields }) });
  const v = x => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : Number.isInteger(x) ? { integerValue: String(x) } : Array.isArray(x) ? { arrayValue: { values: x.map(v) } } : { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
  const fields = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, v(x)]));
  await put('treaties/' + tid, fields({ k: 'nap', reg: 'meridian', p: [a.uid, b.uid].sort(), a: a.uid, b: b.uid, st: 'active', t: 1, at: 1 }));
  const r1 = await battle(a, { d: b.uid, p: 0.5 });
  assert.equal(r1.ok, false); assert.equal(r1.why, 'pact');
  await put('treaties/' + tid, fields({ k: 'nap', reg: 'meridian', p: [a.uid, b.uid].sort(), a: a.uid, b: b.uid, st: 'broken', t: 1, at: 1, bt: Date.now(), by: a.uid }));
  assert.equal((await battle(a, { d: b.uid, p: 0.5 })).ok, true, 'a broken pact binds no longer');
  /* a pact between their alliances */
  await put('allyOf/' + a.uid, fields({ a: 'al-n', reg: 'meridian', t: 1 }));
  await put('allyOf/' + b.uid, fields({ a: 'al-s', reg: 'meridian', t: 1 }));
  await put('alliances/al-n', fields({ reg: 'meridian', name: 'North', mem: { [a.uid]: { t: 1 } }, rel: { 'al-s': { k: 'pact', st: 'active', t: 1, at: 1 } } }));
  const r2 = await battle(a, { d: b.uid, p: 0.5 });
  assert.equal(r2.ok, false); assert.equal(r2.why, 'pact');
  await put('alliances/al-n', fields({ reg: 'meridian', name: 'North', mem: { [a.uid]: { t: 1 } }, rel: { 'al-s': { k: 'rival', me: true, them: false, t: 1 } } }));
  assert.equal((await battle(a, { d: b.uid, p: 0.5 })).ok, true, 'rivals fight');
  for (const p of ['treaties/' + tid, 'allyOf/' + a.uid, 'allyOf/' + b.uid, 'alliances/al-n']) await del(p);
});

test('joint military training stops the battle like a pact; whoever broke it fights 10% the weaker; it readies an army sooner', async () => {
  const a = await guest(), b = await guest(), c = await guest();
  await nation(a.uid, {}, 1); await nation(b.uid, { wars: { [a.uid]: { t: 1 } } }, 1000); await nation(c.uid);
  const tid = 'drill_' + [a.uid, b.uid].sort().join('_'), put = (path, fields) => doc(path, { method: 'PATCH', body: JSON.stringify({ fields }) });
  const v = x => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : Number.isInteger(x) ? { integerValue: String(x) } : Array.isArray(x) ? { arrayValue: { values: x.map(v) } } : { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
  const fields = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, v(x)]));
  const base = { k: 'drill', reg: 'meridian', p: [a.uid, b.uid].sort(), a: a.uid, b: b.uid, t: 1, at: 1 };
  await put('treaties/' + tid, fields({ ...base, st: 'active' }));
  const r1 = await battle(a, { d: b.uid, p: 0.5 });
  assert.equal(r1.ok, false); assert.equal(r1.why, 'pact');
  /* the defender broke it: the attacker's army counts 10% more in the bound */
  await put('treaties/' + tid, fields({ ...base, st: 'broken', bt: Date.now(), by: b.uid }));
  const r2 = await battle(a, { d: b.uid, p: 0.9 });
  assert.ok(r2.ok && Math.abs(r2.p - 22 / 1022) < 1e-3, 'the breaker defends 10% the weaker: ' + r2.p);
  /* the attacker broke it: the defender's army counts 10% more */
  await put('treaties/' + tid, fields({ ...base, st: 'broken', bt: Date.now(), by: a.uid }));
  const r3 = await battle(a, { d: b.uid, p: 0.9 });
  assert.ok(r3.ok && Math.abs(r3.p - 20 / 1120) < 1e-3, 'the breaker attacks 10% the weaker: ' + r3.p);
  /* off the record after 30 days */
  await put('treaties/' + tid, fields({ ...base, st: 'broken', bt: Date.now() - 31 * 86400000, by: a.uid }));
  const r4 = await battle(a, { d: b.uid, p: 0.9 });
  assert.ok(r4.ok && Math.abs(r4.p - 20 / 1020) < 1e-3, 'a month on, no edge: ' + r4.p);
  /* readiness: a point 14.4 minutes after the last is not back yet, unless a training pact readies it 5% sooner */
  const tc = 'drill_' + [a.uid, c.uid].sort().join('_'), spent = () => put('armies/' + a.uid, fields({ r: 0, at: Date.now() - 14.4 * 60000, n: 1, w: 0 }));
  await spent();
  assert.equal((await battle(a)).why, 'ready');
  await put('treaties/' + tc, fields({ k: 'drill', reg: 'meridian', p: [a.uid, c.uid].sort(), a: a.uid, b: c.uid, st: 'active', t: 1, at: 1 }));
  await spent();
  assert.equal((await battle(a)).ok, true, 'a training pact readies the army sooner');
  for (const p of ['treaties/' + tid, 'treaties/' + tc]) await del(p);
});

/* war, round two: a siege of a player's capital, and its fall (functions/index.js, functions/war-rules.js) */
const siege = (who, d) => call(who, { op: 'siege', ...d });
test('a siege needs a war of conquest; the final assault waits a day, and a victory marks the fall', async () => {
  const g = await guest(), foe = await guest(), now = Date.now(), founded = now - 30 * 86400000;
  await nation(g.uid, {}, 1000);
  /* the other side declared a war of conquest on g: g may besiege its capital in turn (a guest fights back freely) */
  await nation(foe.uid, { founded, name: 'Vesad', capital: 'Adler', pretitle: 'Grand Duchy', leader: 'Duchess', motto: 'Salt and patience', pop: 12.345, cities: [{ c: 50 }, { c: 52 }], ach: { a: 1, b: 2, c: 3 }, flag: { p: 'chief', c: ['#E5722A', '#FFFFFF', '#152450'], e: 'none', ec: '#152450' }, wars: { [g.uid]: { t: now - 30 * 3600000, g: 'c' } } }, 1);
  await assert.rejects(siege(g, { d: NPC, c: 5 }), e => e.status === 'INVALID_ARGUMENT', 'never a computer nation');
  const s = await siege(g, { d: foe.uid, c: 50 });
  assert.equal(s.ok, true);assert.equal(s.doc.st, 'on');assert.equal(s.doc.c, 50);assert.equal(s.doc.df, founded);assert.equal(s.doc.cn, 'Adler');
  const again = await siege(g, { d: foe.uid, c: 50 });
  assert.equal(again.id, s.id, 'asked again: the same siege');assert.equal(again.again, true);
  assert.deepEqual(await battle(g, { d: foe.uid, c: 50, cap: 1 }), { ok: false, why: 'siege' }, 'the final assault waits a day');
  /* a day and an hour later */
  await doc('sieges/' + s.id + '?updateMask.fieldPaths=t', { method: 'PATCH', body: JSON.stringify({ fields: { t: { integerValue: String(now - 25 * 3600000) } } }) });
  assert.deepEqual(await battle(g, { d: foe.uid, c: 51, cap: 1 }), { ok: false, why: 'siege' }, 'only on the capital besieged');
  let r;for (let i = 0; i < 6 && !(r && r.win); i++) r = await battle(g, { d: foe.uid, c: 50, cap: 1 });
  assert.equal(r.win, true, 'won at 95%: ' + JSON.stringify(r));assert.equal(r.fell, true);assert.equal(r.id, s.id);assert.equal(r.doc.st, 'fell');
  assert.ok(typeof r.s2 === 'string', 'sealed like any conquest');
  const f = (await read('sieges/' + s.id)).fields;
  assert.equal(f.st.stringValue, 'fell');assert.ok(Number(f.ft.integerValue) > 0);
  assert.ok(f.foes.arrayValue.values.some(v => v.stringValue === g.uid), 'the besieger is among the fallen nation\'s enemies');
  /* what the nation was, for its monument on every map (game/edictum.html, monuments to fallen nations) */
  assert.deepEqual({ ...r.doc.m, fl: r.doc.m.fl.p }, { pre: 'Grand Duchy', ld: 'Duchess', ru: '', mo: 'Salt and patience', dem: '', cur: '', ani: '', fl: 'chief', mc: '', pop: 12.35, ct: 2, ach: 3, dec: 0 });
  assert.equal(f.m.mapValue.fields.mo.stringValue, 'Salt and patience', 'kept with the fall');
  assert.deepEqual(await siege(g, { d: foe.uid, c: 50 }), { ok: false, why: 'gone' }, 'a fallen nation cannot be besieged again');
});
/* the capital moves (24 Nov 2026): a nation with another city does not fall with its capital */
test('a capital that falls while its nation has another city: the government moves to the biggest, and the war goes on', async () => {
  const g = await guest(), foe = await guest(), now = Date.now(), founded = now - 30 * 86400000;
  await nation(g.uid, {}, 1000);
  await nation(foe.uid, { founded, name: 'Vesad', capital: 'Adler', wars: { [g.uid]: { t: now - 30 * 3600000, g: 'c' } },
    cities: [{ id: 'cap', c: 60, b: [{ k: 'farm', d: 1 }] }, { id: 'b', c: 64, nm: 'Brill', t: 5, b: [{ k: 'farm', d: 1 }, { k: 'market', d: 1 }] }, { id: 'c', c: 66, nm: 'Corve', t: 4, b: [{ k: 'farm', d: 1 }] }] }, 1);
  const day = id => doc('sieges/' + id + '?updateMask.fieldPaths=t', { method: 'PATCH', body: JSON.stringify({ fields: { t: { integerValue: String(Date.now() - 25 * 3600000) } } }) });
  const take = async (c, occ) => { let r;for (let i = 0; i < 6 && !(r && r.win); i++) r = await battle(g, { d: foe.uid, c, cap: 1, ...(occ ? { occ } : {}) });return r; };
  const s = await siege(g, { d: foe.uid, c: 60 });await day(s.id);
  const r = await take(60);
  assert.equal(r.fell, true, JSON.stringify(r));assert.equal(r.doc.ni, 'b', 'Brill: two buildings to Corve’s one');assert.equal(r.doc.nn, 'Brill');
  assert.equal(r.doc.ci, 'cap');assert.deepEqual(r.doc.cb, ['farm'], 'what stood in the capital taken');
  assert.equal(r.doc.m, undefined, 'no monument: the nation stands');assert.equal(r.doc.foes, undefined);
  /* a new siege of the new capital, named for it; the capital lost is no bar */
  const s2 = await siege(g, { d: foe.uid, c: 64 });
  assert.equal(s2.ok, true);assert.notEqual(s2.id, s.id);assert.equal(s2.again, undefined);assert.equal(s2.doc.cn, 'Brill');
  await day(s2.id);
  /* the attacker's game sees Corve held by another nation: the last capital falls, and the nation with it */
  const r2 = await take(64, ['c']);
  assert.equal(r2.fell, true);assert.equal(r2.doc.ni, undefined);assert.ok(r2.doc.m && r2.doc.foes, 'its monument and its enemies');
  assert.deepEqual(await siege(g, { d: foe.uid, c: 66 }), { ok: false, why: 'gone' }, 'fallen with its last capital');
});
test('no siege in a border war or a raid, against a nation risen again or in its grace, or after a surrender', async () => {
  const g = await guest(), now = Date.now(), mk = async rec => { const f = await guest(); await nation(f.uid, rec, 1); return f; };
  await nation(g.uid, {}, 1000);
  const border = await mk({ wars: { [g.uid]: { t: now - 3600000, g: 'b' } } });
  assert.deepEqual(await siege(g, { d: border.uid, c: 1 }), { ok: false, why: 'war' }, 'a border war');
  const raid = await mk({ wars: { [g.uid]: { t: now - 3600000, g: 'r' } } });
  assert.deepEqual(await siege(g, { d: raid.uid, c: 1 }), { ok: false, why: 'war' }, 'a raid');
  const none = await mk({});
  await assert.rejects(siege(g, { d: none.uid, c: 1 }), e => /Registered Nation/.test(e.message), 'no war: a guest may not start one');
  const risen = await mk({ founded: now - 86400000, shd: now + 6 * 86400000, wars: { [g.uid]: { t: now - 3600000, g: 'c' } } });
  assert.deepEqual(await siege(g, { d: risen.uid, c: 1 }), { ok: false, why: 'grace' }, 'risen again');
  const grace = await mk({ grc: { t: now - 3600000, u: now + 86400000 }, wars: { [g.uid]: { t: now - 7200000, g: 'c' } } });
  assert.deepEqual(await siege(g, { d: grace.uid, c: 1 }), { ok: false, why: 'grace' }, 'in its grace');
  const gave = await mk({ wars: { [g.uid]: { t: now - 7200000, g: 'c' } }, surr: { [g.uid]: now - 3600000 } });
  assert.deepEqual(await siege(g, { d: gave.uid, c: 1 }), { ok: false, why: 'war' }, 'surrendered');
  assert.deepEqual(await battle(g, { d: gave.uid, c: 1, cap: 1 }), { ok: false, why: 'surr' }, 'and no final assault on it');
});
