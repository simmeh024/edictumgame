// Firestore security rules tests. Run with the emulator:
//   npm run test:rules
// (that is: firebase emulators:exec --only firestore "node --test test/rules.test.mjs")
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('error'); // denied writes are expected here; keep the SDK's warnings out of the report

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const NOW = () => firebase.firestore.FieldValue.serverTimestamp();
const AGO = ms => firebase.firestore.Timestamp.fromMillis(Date.now() - ms);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let env;

// the documents src/shim.js writes for one save
const nation = (name, extra = {}) => {
  const rec = { name, reg: extra.reg || 'meridian', updatedAt: Date.now(), pop: 1200, dsp: { a: [[1, 2], [3, 4]] } };
  return { v: 1, j: JSON.stringify(rec), reg: rec.reg, name, updatedAt: rec.updatedAt, ts: NOW(), pop: 1200, army: 40, cl: 3, ...extra };
};
const summaryOf = (n, extra = {}) => ({ reg: n.reg, name: n.name, pop: n.pop ?? 1200, t: n.updatedAt, ...extra });
const privateOf = (n, extra = {}) => ({ j: JSON.stringify({ inbox: [], tly: { a: 1 } }), t: n.updatedAt, ts: NOW(), ...extra });
const spaceOf = (n, extra = {}) => ({ reg: n.reg, name: n.name, t: n.updatedAt, j: JSON.stringify({ sp: { moon: {} } }), ts: NOW(), ...extra });
function save(db, uid, n, { summary = summaryOf(n), space = null, priv = null } = {}) {
  const b = db.batch();
  if (n) b.set(db.doc('nations/' + uid), n);
  if (summary) b.set(db.doc('summaries/' + uid), summary);
  if (priv) b.set(db.doc('nationx/' + uid), priv);
  if (space) b.set(db.doc('space/' + uid), space);
  return b.commit();
}
function post(db, uid, reg, x, { limits = true, extra = {} } = {}) {
  const b = db.batch();
  b.set(db.collection('boards/' + reg + '/posts').doc(), { a: uid, t: NOW(), x, ...extra });
  if (limits) b.set(db.doc('limits/' + uid), { p: NOW() });
  return b.commit();
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-edictum-rules', firestore: { rules } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore(), n = nation('Bobland', { ts: AGO(60000) });
    await db.doc('nations/bob').set(n);
    await db.doc('summaries/bob').set(summaryOf(n));
    await db.doc('space/bob').set(spaceOf(n, { ts: AGO(60000) }));
    await db.doc('boards/meridian/posts/p1').set({ a: 'bob', t: AGO(60000), x: 'Hello from Bobland' });
    const c = nation('Carolia', { reg: 'frostmarch', ts: AGO(60000) });
    await db.doc('nations/carol').set(c);
    await db.doc('summaries/carol').set(summaryOf(c));
    await db.doc('other/x').set({ a: 1 });
    await db.doc('rmb/bob').set({ posts: [] });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();

test('anyone, signed in or not, reads the world', async () => {
  for (const db of [anon(), as('alice')]) {
    await assertSucceeds(db.doc('nations/bob').get());
    await assertSucceeds(db.collection('nations').where('reg', '==', 'meridian').get());
    await assertSucceeds(db.collection('summaries').where('reg', '==', 'frostmarch').get());
    await assertSucceeds(db.collection('space').get());
    await assertSucceeds(db.collection('boards/meridian/posts').orderBy('t', 'desc').limit(60).get());
  }
});

test('a visitor who is not signed in writes nothing', async () => {
  const db = anon(), n = nation('Aliceland');
  await assertFails(save(db, 'alice', n));
  await assertFails(post(db, 'alice', 'meridian', 'Hi'));
  await assertFails(db.doc('boards/meridian/posts/p1').delete());
});

test('a player saves their nation and its summary together, and deletes them', async () => {
  const db = as('alice'), n = nation('Aliceland');
  await assertSucceeds(save(db, 'alice', n));
  await sleep(1100);
  await assertSucceeds(save(db, 'alice', nation('Aliceland', { updatedAt: Date.now() + 5 })));
  const b = db.batch();
  for (const c of ['nations', 'summaries', 'space']) b.delete(db.doc(c + '/alice'));
  await assertSucceeds(b.commit());
});

test('the nation and its summary must arrive together and agree', async () => {
  const db = as('alice'), n = nation('Aliceland');
  await assertFails(save(db, 'alice', n, { summary: null }));                        // nation alone
  await assertFails(save(db, 'alice', null, { summary: summaryOf(n) }));             // summary alone
  await assertFails(save(db, 'alice', n, { summary: summaryOf(n, { name: 'Other' }) }));
  await assertFails(save(db, 'alice', n, { summary: summaryOf(n, { reg: 'frostmarch' }) }));
  await assertFails(save(db, 'alice', n, { summary: summaryOf(n, { t: n.updatedAt - 1 }) }));
  await assertFails(save(db, 'alice', n, { summary: summaryOf(n, { pop: -1 }) }));
  await assertFails(save(db, 'alice', n, { summary: summaryOf(n, { extra: 1 }) }));
  await assertSucceeds(save(db, 'alice', n));
});

test('a nation is saved at most once a second', async () => {
  const db = as('alice');
  await assertSucceeds(save(db, 'alice', nation('Aliceland')));
  await assertFails(save(db, 'alice', nation('Aliceland', { updatedAt: Date.now() + 1 })));
  await sleep(1100);
  await assertSucceeds(save(db, 'alice', nation('Aliceland', { updatedAt: Date.now() + 2 })));
});

test("a player cannot write another player's documents", async () => {
  const db = as('alice'), n = nation('Stolen');
  await assertFails(save(db, 'bob', n));
  await assertFails(db.doc('nations/bob').update({ name: 'Stolen' }));
  await assertFails(db.doc('nations/bob').delete());
  await assertFails(db.doc('summaries/bob').delete());
  await assertFails(db.doc('space/bob').delete());
  // (an admin may delete it: see the test on removing nations and banning)
});

test('a nation must have the stored shape', async () => {
  const db = as('alice');
  const bad = [
    { name: 'Aliceland', s: {}, ts: NOW() },                                              // a raw record, not the envelope
    nation('Aliceland', { extra: 1 }),                                                    // unknown key
    nation('Aliceland', { v: 2 }),
    nation('Aliceland', { j: { name: 'x' } }),                                            // j must be text
    nation('Aliceland', { j: 'x'.repeat(750001) }),                                       // too large
    nation('x'.repeat(81)),                                                               // name too long
    nation('Aliceland', { reg: 'atlantis' }),                                             // not a region
    nation('Aliceland', { updatedAt: 'today' }),
    nation('Aliceland', { ts: AGO(5000) })                                                // ts must be the server's time
  ];
  for (const n of bad) {
    const t = typeof n.updatedAt === 'number' ? n.updatedAt : 1;
    await assertFails(save(db, 'alice', n, { summary: summaryOf({ reg: 'meridian', name: 'Aliceland', updatedAt: t }) }));
  }
  await assertSucceeds(save(db, 'alice', nation('Aliceland', { j: 'x'.repeat(749000) })));
});

test('the private half travels with a save, agrees with it and has its shape', async () => {
  const db = as('alice'), n = nation('Aliceland');
  await assertFails(db.doc('nationx/alice').set(privateOf(n)));                          // alone
  for (const bad of [privateOf(n, { t: n.updatedAt - 1 }), privateOf(n, { extra: 1 }), privateOf(n, { j: 'x'.repeat(750001) }),
    privateOf(n, { j: { a: 1 } }), privateOf(n, { ts: AGO(5000) })])
    await assertFails(save(db, 'alice', n, { priv: bad }));
  await assertSucceeds(save(db, 'alice', n, { priv: privateOf(n) }));
  await assertSucceeds(anon().doc('nationx/alice').get());                                 // read on opening the nation's pages
  await assertFails(save(as('bob'), 'alice', nation('Aliceland'), { priv: privateOf(n) })); // nobody else's
  await sleep(1100);
  const n2 = nation('Aliceland', { updatedAt: Date.now() + 5 });
  await assertFails(as('bob').doc('nationx/alice').delete());
  await assertSucceeds(save(db, 'alice', n2, { priv: privateOf(n2) }));
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('bans/alice').set({ note: 'x', t: Date.now(), by: 'mod' }));
  await sleep(1100);
  const n3 = nation('Aliceland', { updatedAt: Date.now() + 9 });
  await assertFails(save(db, 'alice', n3, { priv: privateOf(n3) }));                     // banned: refused with the nation
  await assertSucceeds(as('mod', { admin: true }).doc('nationx/alice').delete());
  await assertSucceeds(db.doc('nations/alice').delete());
});

test('space records travel with a save, agree with it and change at most every 10 seconds', async () => {
  const db = as('alice');
  let n = nation('Aliceland');
  await assertFails(save(db, 'alice', n, { space: spaceOf(n, { reg: 'frostmarch' }) }));
  await assertFails(save(db, 'alice', n, { space: spaceOf(n, { j: 'x'.repeat(60001) }) }));
  await assertSucceeds(save(db, 'alice', n, { space: spaceOf(n) }));
  await assertFails(db.doc('space/alice').set(spaceOf(n)));                               // without a nation save
  await sleep(1100);
  n = nation('Aliceland', { updatedAt: Date.now() + 1 });
  await assertFails(save(db, 'alice', n, { space: spaceOf(n) }));                         // too soon for space
  await assertSucceeds(save(db, 'alice', n));                                             // the nation alone is fine
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('space/alice').update({ ts: AGO(11000) }));
  await sleep(1100);
  n = nation('Aliceland', { updatedAt: Date.now() + 2 });
  await assertSucceeds(save(db, 'alice', n, { space: spaceOf(n) }));
});

test('a player posts on their own region’s board, at most every 20 seconds', async () => {
  const db = as('bob');
  await assertFails(post(db, 'bob', 'meridian', 'Hi', { limits: false }));                // limits/ must come along
  await assertFails(post(db, 'bob', 'frostmarch', 'Hi'));                                 // not Bob's region
  await assertFails(post(db, 'bob', 'atlantis', 'Hi'));
  await assertFails(post(db, 'bob', 'meridian', ''));
  await assertFails(post(db, 'bob', 'meridian', 'x'.repeat(401)));
  await assertFails(post(db, 'bob', 'meridian', 'Hi', { extra: { a: 'carol' } }));       // posting as someone else
  await assertFails(post(db, 'bob', 'meridian', 'Hi', { extra: { pinned: true } }));
  await assertSucceeds(post(db, 'bob', 'meridian', 'x'.repeat(400)));
  await assertFails(post(db, 'bob', 'meridian', 'Again'));                                // too soon
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('limits/bob').set({ p: AGO(21000) }));
  await assertSucceeds(post(db, 'bob', 'meridian', 'Again'));
  await assertFails(as('alice').doc('limits/bob').get());                                 // pacing is private
  await assertFails(db.doc('limits/bob').delete());                                       // and cannot be reset
  await assertFails(post(as('nobody'), 'nobody', 'meridian', 'Hi'));                      // no nation, no post
});

test('authors delete their own posts; admins delete any', async () => {
  await assertFails(as('alice').doc('boards/meridian/posts/p1').delete());
  await assertFails(as('alice', { admin: 'true' }).doc('boards/meridian/posts/p1').delete());
  await assertFails(as('alice').doc('boards/meridian/posts/p1').update({ x: 'edited' }));
  await assertFails(as('bob').doc('boards/meridian/posts/p1').update({ x: 'edited' }));   // no editing, even your own
  await assertSucceeds(as('mod', { admin: true }).doc('boards/meridian/posts/p1').delete());
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('boards/meridian/posts/p2').set({ a: 'bob', t: AGO(1000), x: 'Mine' }));
  await assertSucceeds(as('bob').doc('boards/meridian/posts/p2').delete());
});

test('everything else is closed', async () => {
  await assertFails(anon().doc('other/x').get());
  await assertFails(as('alice').doc('other/x').get());
  await assertFails(as('alice').doc('other/y').set({ a: 1 }));
  await assertFails(as('mod', { admin: true }).doc('other/y').set({ a: 1 }));
  await assertFails(anon().doc('rmb/bob').get());                                         // the old board format is gone
  await assertFails(as('bob').doc('rmb/bob').set({ posts: [] }));
  await assertFails(as('alice').doc('nations/alice/sub/x').set({ a: 1 }));
  await assertFails(anon().doc('nations/bob/sub/x').get());
});

const report = (db, uid, extra = {}, { rlimits = true } = {}) => {
  const b = db.batch();
  b.set(db.collection('reports').doc(), { by: uid, kind: 'post', target: 'bob', post: 'p1', reg: 'meridian', reason: 'content', t: NOW(), x: 'Hello from Bobland', ...extra });
  if (rlimits) b.set(db.doc('rlimits/' + uid), { r: NOW() });
  return b.commit();
};

test('a player reports another player, at most every 30 seconds; only admins read reports', async () => {
  const db = as('carol');
  await assertFails(report(as('alice'), 'alice'));                                        // no nation, no reports
  await assertFails(report(db, 'carol', {}, { rlimits: false }));                         // rlimits/ must come along
  await assertFails(report(db, 'carol', { by: 'alice' }));                                // reporting as someone else
  await assertFails(report(db, 'carol', { target: 'carol' }));                            // reporting yourself
  await assertFails(report(db, 'carol', { reason: 'boredom' }));
  await assertFails(report(db, 'carol', { kind: 'flag' }));
  await assertFails(report(db, 'carol', { note: 'x'.repeat(301) }));
  await assertFails(report(db, 'carol', { extra: 1 }));
  await assertFails(report(anon(), 'carol'));
  await assertSucceeds(report(db, 'carol', { note: 'Rude' }));
  await assertFails(report(db, 'carol', { kind: 'nation', reason: 'name' }));            // too soon
  await assertFails(db.doc('rlimits/carol').delete());                                    // and the pace cannot be reset
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('rlimits/carol').set({ r: AGO(31000) }));
  await assertSucceeds(report(db, 'carol', { kind: 'nation', reason: 'name' }));
  await assertFails(db.collection('reports').get());                                     // players cannot read reports
  await assertFails(as('bob').collection('reports').get());
  const mod = as('mod', { admin: true }), list = await assertSucceeds(mod.collection('reports').get());
  await assertSucceeds(mod.doc('reports/' + list.docs[0].id).delete());
  await assertFails(db.doc('reports/' + list.docs[1].id).delete());
});

test('only admins hide nations; everyone reads who is hidden', async () => {
  const m = { hidden: true, note: 'Offensive name', name: 'Bobland', t: Date.now() };
  await assertFails(as('alice').doc('mod/bob').set({ ...m, by: 'alice' }));
  await assertFails(as('bob').doc('mod/bob').delete());
  const mod = as('mod', { admin: true });
  await assertFails(mod.doc('mod/bob').set({ ...m, by: 'someone-else' }));
  await assertFails(mod.doc('mod/bob').set({ ...m, by: 'mod', extra: 1 }));
  await assertSucceeds(mod.doc('mod/bob').set({ ...m, by: 'mod' }));
  await assertSucceeds(anon().collection('mod').get());
  await assertSucceeds(mod.doc('mod/bob').delete());
});

test('a player deleting their account finds and removes their own posts and limits', async () => {
  const db = as('bob');
  const mine = await assertSucceeds(db.collectionGroup('posts').where('a', '==', 'bob').get());
  if (mine.size !== 1) throw new Error('expected Bob’s one post, found ' + mine.size);
  await assertSucceeds(db.doc(mine.docs[0].ref.path).delete());
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('limits/bob').set({ p: AGO(1000) }));
  await assertFails(db.doc('limits/bob').delete());                                       // not while the nation exists
  await assertFails(as('alice').doc('limits/bob').delete());
  const b = db.batch();                                                                    // as the account deletion does it
  for (const c of ['nations', 'nationx', 'summaries', 'space', 'limits', 'rlimits']) b.delete(db.doc(c + '/bob'));
  await assertSucceeds(b.commit());
});

test('admins remove nations and ban accounts; a banned account saves, posts and reports nothing', async () => {
  const mod = as('mod', { admin: true }), ban = { note: 'Spam', name: 'Bobland', t: Date.now(), by: 'mod' };
  await assertFails(as('alice').doc('bans/bob').set({ ...ban, by: 'alice' }));
  await assertFails(mod.doc('bans/bob').set({ ...ban, by: 'someone-else' }));
  await assertFails(mod.doc('bans/bob').set({ ...ban, extra: 1 }));
  const b = mod.batch();                                                                   // remove Bob's nation, as the portal does
  for (const c of ['nations', 'nationx', 'summaries', 'space']) b.delete(mod.doc(c + '/bob'));
  await assertSucceeds(b.commit());
  await assertSucceeds(mod.doc('mod/bob').set({ hidden: false, removed: Date.now(), note: 'Spam', name: 'Bobland', t: Date.now(), by: 'mod' }));
  await assertSucceeds(mod.doc('bans/bob').set(ban));
  await assertSucceeds(as('bob').doc('bans/bob').get());                                   // Bob may read why
  await assertFails(as('alice').doc('bans/bob').get());                                    // nobody else
  await assertFails(anon().collection('bans').get());
  await assertFails(save(as('bob'), 'bob', nation('Bobland Again')));                      // no new nation
  await assertFails(as('alice').doc('nations/carol').delete());                            // players still cannot remove others
  await assertSucceeds(mod.doc('bans/bob').delete());                                      // unban
  await assertSucceeds(save(as('bob'), 'bob', nation('Bobland Again')));
});

test('a banned player cannot post or report', async () => {
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('bans/carol').set({ note: 'x', t: Date.now(), by: 'mod' }));
  const c = nation('Carolia', { reg: 'frostmarch' });
  await assertFails(post(as('carol'), 'carol', 'frostmarch', 'Still here'));
  await assertFails(report(as('carol'), 'carol'));
});

const ticket = (db, uid, extra = {}, { slimits = true } = {}) => {
  const b = db.batch();
  b.set(db.collection('support').doc(), { by: uid, topic: 'bug', x: 'The map will not load', t: NOW(), st: 'open', name: 'Davidia', reg: 'meridian', ...extra });
  if (slimits) b.set(db.doc('slimits/' + uid), { s: NOW() });
  return b.commit();
};

test('a player sends support tickets, at most one a minute, and reads only their own', async () => {
  const db = as('dave');                                                                   // no nation needed
  await assertFails(ticket(db, 'dave', {}, { slimits: false }));                          // slimits/ must come along
  await assertFails(ticket(db, 'dave', { by: 'alice' }));
  await assertFails(ticket(db, 'dave', { topic: 'boredom' }));
  await assertFails(ticket(db, 'dave', { x: '' }));
  await assertFails(ticket(db, 'dave', { x: 'x'.repeat(2001) }));
  await assertFails(ticket(db, 'dave', { st: 'closed' }));
  await assertFails(ticket(db, 'dave', { reply: 'Fixed it myself' }));
  await assertFails(ticket(db, 'dave', { email: 'x'.repeat(201) }));
  await assertFails(ticket(db, 'dave', { reg: 'atlantis' }));
  await assertFails(ticket(anon(), 'dave'));
  await assertSucceeds(ticket(db, 'dave', { email: 'dave@example.com' }));
  await assertFails(ticket(db, 'dave'));                                                   // too soon
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('slimits/dave').set({ s: AGO(61000) }));
  await assertSucceeds(ticket(db, 'dave', { topic: 'account' }));
  const mine = await assertSucceeds(db.collection('support').where('by', '==', 'dave').get());
  if (mine.size !== 2) throw new Error('expected Dave’s two tickets, found ' + mine.size);
  await assertFails(as('alice').collection('support').where('by', '==', 'dave').get());   // nobody else reads them
  await assertFails(as('alice').collection('support').get());
  await assertFails(anon().doc(mine.docs[0].ref.path).get());
  await assertFails(db.doc(mine.docs[0].ref.path).update({ st: 'closed' }));              // only admins close them
});

test('admins answer and close support tickets, with an expiry; players delete their own', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const id of ['s1', 's2']) await db.doc('support/' + id).set({ by: 'dave', topic: 'bug', x: 'The map will not load', t: AGO(60000), st: 'open' });
    await db.doc('slimits/dave').set({ s: AGO(60000) });
  });
  const mod = as('mod', { admin: true }), open = await assertSucceeds(mod.collection('support').where('st', '==', 'open').get());
  if (open.size !== 2) throw new Error('expected two open tickets, found ' + open.size);
  const ref = 'support/' + open.docs[0].id, exp = firebase.firestore.Timestamp.fromMillis(Date.now() + 90 * 86400000);
  const close = (extra = {}) => mod.doc(ref).update({ st: 'closed', ct: NOW(), rby: 'mod', exp, reply: 'Fixed now', ...extra });
  await assertFails(close({ rby: 'someone-else' }));
  await assertFails(close({ exp: firebase.firestore.Timestamp.fromMillis(Date.now() - 1000) }));
  await assertFails(close({ x: 'Rewritten' }));
  await assertFails(close({ reply: 'x'.repeat(2001) }));
  await assertFails(as('dave').doc(ref).update({ st: 'closed', ct: NOW(), rby: 'dave', exp }));
  await assertSucceeds(close());
  await assertFails(close({ reply: 'Again' }));                                            // closed stays closed
  const answered = await assertSucceeds(as('dave').doc(ref).get());
  if (answered.data().reply !== 'Fixed now') throw new Error('Dave does not see the answer');
  await assertSucceeds(mod.collection('support').orderBy('ct', 'desc').limit(30).get());
  await assertSucceeds(mod.doc('support/' + open.docs[1].id).delete());                   // spam
  const db = as('dave'), left = await assertSucceeds(db.collection('support').where('by', '==', 'dave').get());
  for (const d of left.docs) await assertSucceeds(db.doc(d.ref.path).delete());           // as the account deletion does it
  await assertSucceeds(db.doc('slimits/dave').delete());                                   // Dave has no nation
});

test('a banned player can still send a support ticket, to appeal', async () => {
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('bans/carol').set({ note: 'x', t: Date.now(), by: 'mod' }));
  await assertSucceeds(ticket(as('carol'), 'carol', { topic: 'account', x: 'Why was I banned?' }));
  await assertFails(as('carol').doc('slimits/carol').delete());                           // not while the nation exists
});

test('only an admin marks themself as staff; everyone reads it, and anyone clears their own', async () => {
  await assertFails(as('alice').doc('staff/alice').set({ t: Date.now() }));               // a player cannot claim it
  await assertFails(as('alice', { admin: 'true' }).doc('staff/alice').set({ t: Date.now() }));
  await assertFails(as('mod', { admin: true }).doc('staff/alice').set({ t: Date.now() })); // nor mark someone else
  await assertFails(as('mod', { admin: true }).doc('staff/mod').set({ t: Date.now(), name: 'x' }));
  await assertSucceeds(as('mod', { admin: true }).doc('staff/mod').set({ t: Date.now() }));
  await assertSucceeds(anon().doc('staff/mod').get());
  await assertSucceeds(as('bob').collection('staff').get());
  await assertFails(as('bob').doc('staff/mod').delete());
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('staff/bob').set({ t: 1 }));
  await assertSucceeds(as('bob').doc('staff/bob').delete());                               // rights taken away: the page clears it
});

test('a summary may count a holiday after the save (e), up to 32 days past it and never before', async () => {
  const day = 864e5, tryE = (uid, e) => { const n = nation('Holiday ' + uid); return save(as(uid), uid, n, { summary: summaryOf(n, { e: typeof e === 'function' ? e(n.updatedAt) : e }) }); };
  await assertSucceeds(tryE('h1', t => t + 20 * day));
  await assertSucceeds(tryE('h2', t => t + 32 * day));
  await assertFails(tryE('h3', t => t + 33 * day));                                         // longer than any holiday
  await assertFails(tryE('h4', t => t - 1));                                                // before the save
  await assertFails(tryE('h5', 'soon'));
});

test('the headline numbers beside a nation are bounded, and grow no faster than the game allows', async () => {
  const fresh = (uid, extra) => { const n = nation('Head ' + uid, extra); return save(as(uid), uid, n); };
  await assertSucceeds(fresh('k1', {}));
  await assertFails(fresh('k2', { army: 60 * Math.sqrt(1200) + 50 }));                        // an army no population raises
  await assertFails(fresh('k3', { cl: 2000 }));                                                // more land than 1,200 million claim
  await assertFails(fresh('k4', { pop: 2e7 }));
  await assertFails(fresh('k5', { cl: 2.5 }));
  const bare = nation('Head k6'); delete bare.pop; delete bare.army; delete bare.cl;
  await assertFails(save(as('k6'), 'k6', bare, { summary: summaryOf(bare, { pop: 1200 }) }));  // a new record carries them
  // Bob saved a minute ago at 1,200 million
  await assertSucceeds(save(as('bob'), 'bob', nation('Bobland', { pop: 1200.2 })));
});

test('a minute is not enough to grow a nation tenfold, nor to drop the numbers once they are there', async () => {
  await assertFails(save(as('bob'), 'bob', nation('Bobland', { pop: 12000 })));
  const bare = nation('Bobland'); delete bare.pop; delete bare.army; delete bare.cl;
  await assertFails(save(as('bob'), 'bob', bare, { summary: summaryOf(bare, { pop: 1200 }) }));
  await assertFails(save(as('bob'), 'bob', nation('Bobland'), { summary: summaryOf(nation('Bobland'), { pop: 999 }) })); // the summary agrees
});

test('a record from before the headline numbers may still save without them, or gain them', async () => {
  await env.withSecurityRulesDisabled(async ctx => { const old = nation('Oldland', { ts: AGO(60000) }); delete old.pop; delete old.army; delete old.cl; await ctx.firestore().doc('nations/olga').set(old); });
  const bare = nation('Oldland'); delete bare.pop; delete bare.army; delete bare.cl;
  await assertSucceeds(save(as('olga'), 'olga', bare, { summary: summaryOf(bare, { pop: 1200 }) }));
});

test('a race is stamped with the server’s time, by the claimer, and anyone reads it', async () => {
  const db = as('alice');
  await assertSucceeds(db.doc('stamps/meridian/c1234/alice').set({ t: NOW() }));
  await assertSucceeds(db.doc('stamps/meridian/s17/alice').set({ t: NOW() }));
  await assertFails(db.doc('stamps/meridian/c1235/alice').set({ t: Date.now() - 864e5 }));   // a backdated claim
  await assertFails(db.doc('stamps/meridian/c1236/bob').set({ t: NOW() }));                   // someone else's
  await assertFails(db.doc('stamps/meridian/x9/alice').set({ t: NOW() }));
  await assertFails(db.doc('stamps/atlantis/c1/alice').set({ t: NOW() }));
  await assertSucceeds(anon().doc('stamps/meridian/c1234/alice').get());
});

test('the referee’s records: anyone reads its public key, a player their own army, and nobody writes them', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('referee/pub').set({ k: 'MFkw', at: 1 });
    await db.doc('referee/key').set({ priv: 'secret', pub: 'MFkw', at: 1 });
    await db.doc('armies/bob').set({ r: 3, at: 1, n: 4, w: 2, last: 1 });
    await db.doc('armies/bob/log/b1').set({ d: 'npc-vellmark', c: 12, p: 0.6, pe: 0.6, cap: 0.95, roll: 0.3, win: true, t: 1 });
  });
  await assertSucceeds(anon().doc('referee/pub').get());
  await assertFails(anon().doc('referee/key').get());
  await assertFails(as('bob').doc('referee/key').get());
  await assertFails(as('bob', { admin: true }).doc('referee/key').get());
  await assertSucceeds(as('bob').doc('armies/bob').get());
  await assertSucceeds(as('bob').doc('armies/bob/log/b1').get());
  await assertFails(as('alice').doc('armies/bob').get());
  await assertFails(as('alice').doc('armies/bob/log/b1').get());
  await assertSucceeds(as('alice', { admin: true }).doc('armies/bob/log/b1').get());
  await assertFails(as('bob').doc('armies/bob').set({ r: 8, at: Date.now() }));             // a refilled army
  await assertFails(as('bob').doc('armies/bob').delete());
  await assertFails(as('bob').doc('armies/bob/log/b2').set({ win: true }));
  await assertFails(as('bob', { admin: true }).doc('referee/pub').set({ k: 'forged' }));
});

test('currencies: everyone reads values, prestige and history; nobody sets them from the game, admins included', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('fx/meridian').set({ v: 1, day: '2026-10-27', t: 1, j: JSON.stringify({ u: 'Meridian Reach', n: { bob: { v: 2, p: 50, r: 1 } }, ev: [] }) });
    await db.doc('fxh/bob').set({ reg: 'meridian', t: 1, d: { '2026-10-27': [2, 50] } });
    await db.doc('fxs/meridian').set({ v: 1, day: '2026-10-27', t: 1, j: '{}' });
  });
  for (const db of [anon(), as('alice'), as('bob')]) {
    await assertSucceeds(db.doc('fx/meridian').get());
    await assertSucceeds(db.doc('fxh/bob').get());
    await assertFails(db.doc('fxs/meridian').get());
  }
  await assertSucceeds(as('mod', { admin: true }).doc('fxs/meridian').get());
  const pumped = { v: 1, day: '2026-10-28', t: 2, j: JSON.stringify({ u: 'Meridian Reach', n: { bob: { v: 9999, p: 100, r: 1 } }, ev: [] }) };
  for (const db of [anon(), as('bob'), as('mod', { admin: true })]) {
    await assertFails(db.doc('fx/meridian').set(pumped));
    await assertFails(db.doc('fx/meridian').update({ day: 'x' }));
    await assertFails(db.doc('fx/frostmarch').set(pumped));
    await assertFails(db.doc('fx/meridian').delete());
    await assertFails(db.doc('fxh/bob').set({ reg: 'meridian', t: 2, d: { '2026-10-28': [9999, 100] } }, { merge: true }));
    await assertFails(db.doc('fxh/bob').delete());
    await assertFails(db.doc('fxs/meridian').set({ v: 1, day: '', t: 0, j: '{}' }));
  }
});
