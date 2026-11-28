// A save whose commit landed but whose answer was lost on the way back (src/shim.js, saveNation). Firestore then runs the
// transaction again, which found the record one revision on and refused the save as another device's (save_conflict).
// The page took the record that save had left, from before what it did meanwhile: on CI (flag-designs2, 19 and 21 Nov
// 2026) a nation founded before the page's first read, and settled while its first save was on the way, went back to
// unsettled, its founding edict back on the desk. The permit is the save's own (functions/civic.js, one per
// authorizeSave): finding it on the record, the save has landed. Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';

const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const fns = new Map();
(function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === 'FunctionDeclaration') fns.set(n.id.name, shim.slice(n.start, n.end)); for (const [k, v] of Object.entries(n)) if (k !== 'start' && k !== 'end') { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } })(parse(shim, { ecmaVersion: 'latest' }));

/* Firestore as the transaction sees it: each attempt reads the documents, and its writes land together. lose: how many
   attempts land but lose their answer, so that the function runs again (as the SDK retries a commit that failed) */
function adapter(docs, lose = 0) {
  let permits = 0;
  /* saveV1: the game's own transaction, which these tests are about (the server's save in one trip is tested below) */
  const attempts = [], A = { admin: false, raceAt: {}, saveV1: true };
  A.fs = { doc: path => ({ path }), runTransaction: async f => {
    for (;;) {
      const writes = [];
      const r = await f({ get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }), set: (ref, d) => writes.push([ref.path, plain(d)]), delete: ref => writes.push([ref.path, null]) });
      for (const [p, d] of writes) if (d === null) docs.delete(p); else docs.set(p, d);
      attempts.push(writes.length);
      if (attempts.length > lose) return r;
    }
  } };
  const c = vm.createContext({ A, E: {}, performance, MAX_JSON: 700000, BOOT_AT: 1, serverTime: () => 1, num: v => typeof v === 'number' && Number.isFinite(v) ? v : 0, str: (v, max) => typeof v === 'string' ? v.slice(0, max) : '',
    isObj: v => !!v && typeof v === 'object' && !Array.isArray(v), parse: s => { try { return JSON.parse(s); } catch (e) { return null; } }, millis: () => 1, mapError: e => e,
    call: async (name, d) => ({ ...d.record, permit: 'permit-' + (++permits) }), setTimeout: () => {}, L: { get: () => null, set() {} }, LS_CARRY: 'edictum.carry',
    window: { dispatchEvent() {} }, Event: class {}, recoveryCheck: () => {}, spaceText: () => null, splitNation: d => [d, {}], activeUntil: (d, t) => t, raceKeys: () => [], isGuest: () => false });
  vm.runInContext(['mapVer', 'encode', 'revision', 'saveNation'].map(n => fns.get(n)).join('\n'), c);
  return { save: d => c.saveNation('player', d), attempts };
}
const rec = more => ({ name: 'Peakland', reg: 'meridian', updatedAt: 1000, pop: 5, claims: [], loc: null, ...more });

test('a first save whose answer was lost has landed: it is not refused as a conflict with itself', async () => {
  const docs = new Map(), a = adapter(docs, 1);
  assert.deepEqual(plain(await a.save(rec())), { rev: 1 });
  assert.equal(a.attempts.length, 2, 'the transaction ran again after the lost answer');
  assert.ok(a.attempts[0] > 0, 'the first attempt wrote the save');
  assert.equal(a.attempts[1], 0, 'the second finds it there and writes nothing more');
  const n = docs.get('nations/player');
  assert.equal(n.rev, 1); assert.equal(n.permit, 'permit-1');
});

test('so is a later save, and one whose answer was lost more than once', async () => {
  const docs = new Map([['nations/player', { reg: 'meridian', rev: 5, permit: 'permit-old' }]]), a = adapter(docs, 3);
  assert.deepEqual(plain(await a.save(rec({ _rev: 5, loc: { c: 3, r: 4, m: 5 } }))), { rev: 6 });
  assert.deepEqual(a.attempts.slice(1), [0, 0, 0]);
  assert.equal(docs.get('nations/player').rev, 6);
});

test('another device\'s save is still a conflict, at the same revision too', async () => {
  for (const other of [{ rev: 1, permit: 'theirs' }, { rev: 1 }, { rev: 2, permit: 'permit-1' }]) {
    const docs = new Map([['nations/player', { reg: 'meridian', ...other }]]), a = adapter(docs);
    await assert.rejects(a.save(rec()), e => e.code === 'save_conflict', JSON.stringify(other));
    assert.deepEqual(docs.get('nations/player'), { reg: 'meridian', ...other }, 'and nothing is written over it');
  }
});

test('the check comes before anything else the save reads: a save that landed is not then refused for maintenance', () => {
  const body = fns.get('saveNation'), at = body.indexOf('saved.permit === enc.permit'), region = body.indexOf("b.get(A.fs.doc('regionStatus/'");
  assert.ok(at > 0 && region > at);
});

/* The server's save in one trip (serverSave): a save's name stays until it is known to have landed, a lost answer is
   asked again at once under it, and a server from before this sends the page back to its own transaction. */
function serverPage(answers) {
  const A = { raceAt: {} }, sent = [];
  const c = vm.createContext({ A, crypto, BOOT_AT: 1, isObj: v => !!v && typeof v === 'object' && !Array.isArray(v), activeUntil: (d, t) => t, raceKeys: () => [],
    isGuest: () => false, carryKey: () => '', setTimeout: f => f(), Promise,
    call: async (name, d) => { sent.push({ name, ...d }); const a = answers.shift(); if (a instanceof Error) throw a; return a; } });
  vm.runInContext(fns.get('serverSave') + '\nvar SAVE_AGAIN_MS = 0;', c);
  const enc = { j: '{}', reg: 'meridian', name: 'Peakland', pop: 5, army: 1, cl: 0, updatedAt: 1000, mv: 6 };
  return { A, sent, save: (rev = 0) => c.serverSave('player', {}, false, { ...enc }, rev, '{}', '{}', null, {}, true) };
}
const err = (code, firebaseCode = code, message = '') => Object.assign(new Error(message || code), { code, firebaseCode });

test('a lost answer is asked again at once, under the same name; the name changes once a save has landed', async () => {
  const P = serverPage([err('unavailable'), { rev: 2 }, { rev: 3 }]);
  assert.deepEqual(plain(await P.save(0)), { rev: 2 });
  assert.equal(P.sent.length, 2); assert.equal(P.sent[0].op, 'save'); assert.equal(P.sent[1].sid, P.sent[0].sid);
  assert.equal(P.A.savePath, 'server');
  await P.save(2);
  assert.notEqual(P.sent[2].sid, P.sent[0].sid);
  assert.equal(P.sent[0].record.mv, 6); assert.equal(P.sent[0].zip, 1); assert.equal(P.sent[0].cap, 1);
});

test('a save refused or failing keeps its name for the next try from the same revision', async () => {
  const P = serverPage([err('internal'), err('unavailable'), err('unavailable'), { rev: 1 }]);
  await assert.rejects(P.save(0), e => e.code === 'internal');
  await assert.rejects(P.save(0), e => e.code === 'unavailable');
  assert.equal(P.sent.length, 3, 'asked again once only');
  await P.save(0);
  assert.ok(P.sent.every(s => s.sid === P.sent[0].sid));
});

test('one save a second: refused as the rules refused it, so retried tries once more', async () => {
  const P = serverPage([err('not_granted', 'permission-denied')]);
  await assert.rejects(P.save(0), e => e.code === 'permission-denied');
});

test('a server from before the save in one trip, or one that sends the page back, leaves it to its own transaction', async () => {
  for (const e of [err('invalid_argument', 'invalid-argument', 'Unknown request.'), err('save_v1')]) {
    const P = serverPage([e]);
    assert.equal(await P.save(0), null);
    assert.equal(P.A.saveV1, true);
  }
  const P = serverPage([err('invalid_argument', 'invalid-argument', 'Invalid nation save.')]);
  await assert.rejects(P.save(0), e => e.firebaseCode === 'invalid-argument');
  assert.notEqual(P.A.saveV1, true, 'a save the server refuses is not sent back to the rules');
});
