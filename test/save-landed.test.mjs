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
  const attempts = [], A = { admin: false, raceAt: {} };
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
