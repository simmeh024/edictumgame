// Firestore security rules tests. Run with the emulator:
//   npm run test:rules
// (that is: firebase emulators:exec --only firestore "node --test test/rules.test.mjs")
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('error'); // denied writes are expected here; keep the SDK's warnings out of the report

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
let env;

const nation = (name, extra = {}) => {
  const rec = { name, reg: 'meridian', updatedAt: Date.now(), dsp: { a: [[1, 2], [3, 4]] } };
  return { v: 1, j: JSON.stringify(rec), reg: 'meridian', name, updatedAt: rec.updatedAt, ...extra };
};
const posts = n => ({ posts: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, t: i, x: 'Hello ' + i, r: 'meridian' })) });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-edictum-rules', firestore: { rules } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('nations/bob').set(nation('Bobland'));
    await db.doc('rmb/bob').set(posts(3));
    await db.doc('other/x').set({ a: 1 });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();

test('anyone, signed in or not, reads nations and boards', async () => {
  await assertSucceeds(anon().doc('nations/bob').get());
  await assertSucceeds(anon().collection('nations').get());
  await assertSucceeds(anon().doc('rmb/bob').get());
  await assertSucceeds(anon().collection('rmb').get());
  await assertSucceeds(as('alice').collection('nations').get());
});

test('a visitor who is not signed in writes nothing', async () => {
  await assertFails(anon().doc('nations/alice').set(nation('Aliceland')));
  await assertFails(anon().doc('rmb/alice').set(posts(1)));
  await assertFails(anon().doc('rmb/bob').delete());
});

test('a player writes and deletes their own nation', async () => {
  const db = as('alice');
  await assertSucceeds(db.doc('nations/alice').set(nation('Aliceland')));
  await assertSucceeds(db.doc('nations/alice').set(nation('Aliceland', { updatedAt: Date.now() + 5 })));
  await assertSucceeds(db.doc('nations/alice').delete());
});

test("a player cannot write or delete another player's nation", async () => {
  const db = as('alice');
  await assertFails(db.doc('nations/bob').set(nation('Stolen')));
  await assertFails(db.doc('nations/bob').update({ name: 'Stolen' }));
  await assertFails(db.doc('nations/bob').delete());
  await assertFails(db.doc('nations/carol').set(nation('Carolland')));
});

test('a nation must have the stored shape', async () => {
  const db = as('alice'), ref = db.doc('nations/alice');
  await assertFails(ref.set({ name: 'Aliceland', s: {} }));                              // a raw record, not the envelope
  await assertFails(ref.set(nation('Aliceland', { extra: 1 })));                          // unknown key
  await assertFails(ref.set({ v: 1, j: '{}x', reg: 'meridian', name: 'A' }));            // updatedAt missing
  await assertFails(ref.set(nation('Aliceland', { v: 2 })));
  await assertFails(ref.set(nation('Aliceland', { j: { name: 'x' } })));                 // j must be text
  await assertFails(ref.set(nation('Aliceland', { j: 'x'.repeat(900001) })));            // too large
  await assertFails(ref.set(nation('x'.repeat(81))));                                    // name too long
  await assertFails(ref.set(nation('Aliceland', { reg: 'r'.repeat(41) })));
  await assertFails(ref.set(nation('Aliceland', { updatedAt: 'today' })));
  await assertSucceeds(ref.set(nation('Aliceland', { j: 'x'.repeat(899000) })));
});

test('a player posts on their own board, up to 40 posts', async () => {
  const db = as('alice');
  await assertSucceeds(db.doc('rmb/alice').set(posts(1)));
  await assertSucceeds(db.doc('rmb/alice').set(posts(40)));
  await assertFails(db.doc('rmb/alice').set(posts(41)));
  await assertFails(db.doc('rmb/alice').set({ posts: 'hello' }));
  await assertFails(db.doc('rmb/alice').set({ ...posts(1), extra: true }));
  await assertSucceeds(db.doc('rmb/alice').delete());
});

test("a player cannot change another player's board", async () => {
  const db = as('alice');
  await assertFails(db.doc('rmb/bob').set(posts(1)));
  await assertFails(db.doc('rmb/bob').set({ posts: [] }));
  await assertFails(db.doc('rmb/bob').delete());
  await assertFails(as('alice', { admin: false }).doc('rmb/bob').set(posts(1)));
  await assertFails(as('alice', { admin: 'true' }).doc('rmb/bob').set(posts(1)));
});

test("an admin moderates anyone's board, but not their nation", async () => {
  const db = as('mod', { admin: true });
  await assertSucceeds(db.doc('rmb/bob').set(posts(2)));
  await assertFails(db.doc('rmb/bob').set(posts(41)));
  await assertSucceeds(db.doc('rmb/bob').delete());
  await assertFails(db.doc('nations/bob').set(nation('Modland')));
  await assertFails(db.doc('nations/bob').delete());
});

test('everything else is closed', async () => {
  await assertFails(anon().doc('other/x').get());
  await assertFails(as('alice').doc('other/x').get());
  await assertFails(as('alice').doc('other/y').set({ a: 1 }));
  await assertFails(as('mod', { admin: true }).doc('other/y').set({ a: 1 }));
  await assertFails(as('alice').doc('nations/alice/sub/x').set({ a: 1 }));
  await assertFails(anon().doc('nations/bob/sub/x').get());
});
