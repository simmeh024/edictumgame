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
  return { v: 1, j: JSON.stringify(rec), reg: rec.reg, name, updatedAt: rec.updatedAt, ts: NOW(), ...extra };
};
const summaryOf = (n, extra = {}) => ({ reg: n.reg, name: n.name, pop: 1200, t: n.updatedAt, ...extra });
const spaceOf = (n, extra = {}) => ({ reg: n.reg, name: n.name, t: n.updatedAt, j: JSON.stringify({ sp: { moon: {} } }), ts: NOW(), ...extra });
function save(db, uid, n, { summary = summaryOf(n), space = null } = {}) {
  const b = db.batch();
  if (n) b.set(db.doc('nations/' + uid), n);
  if (summary) b.set(db.doc('summaries/' + uid), summary);
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
  await assertFails(as('mod', { admin: true }).doc('nations/bob').delete());
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
