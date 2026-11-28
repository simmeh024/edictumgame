// The first read of one's own nation (src/shim.js, getNation): its three documents, the shared half and both private
// halves, are asked at once in one transaction, not one after another (three trips to Europe; Firebase Performance,
// 28 Nov 2026: 4.2 s in Mexico at the 75th percentile). Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';

const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const fns = new Map();
(function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === 'FunctionDeclaration') fns.set(n.id.name, shim.slice(n.start, n.end)); for (const [k, v] of Object.entries(n)) if (k !== 'start' && k !== 'end' && v && typeof v === 'object') walk(v); })(parse(shim, { ecmaVersion: 'latest' }));

function page(docs) {
  let flying = 0, most = 0, commits = 0;
  const asked = [], A = { uid: 'player', raceAt: {} };
  A.fs = { doc: path => ({ path }), runTransaction: async f => {
    const r = await f({ get: ref => { asked.push(ref.path); flying++; most = Math.max(most, flying);
      return new Promise(res => setTimeout(() => { flying--; res({ id: ref.path.split('/')[1], exists: docs.has(ref.path), data: () => docs.get(ref.path) }); }, 5)); } });
    commits++; return r;
  } };
  const c = vm.createContext({ A, PF: {}, performance, perfTrace() {}, isObj: v => !!v && typeof v === 'object' && !Array.isArray(v), num: v => typeof v === 'number' ? v : 0,
    snapOf: s => ({ id: s.id, exists: s.exists, data: s.data }), decode: (col, d) => JSON.parse(d.j), joinNation: (n, x, o) => ({ ...n, ...(x || {}), ...(o || {}) }),
    pviewing: () => false, SS: { get: () => '' }, SS_PVIEW: 'pv', Promise, setTimeout });
  vm.runInContext(fns.get('getNation'), c);
  return { read: uid => c.getNation(uid), asked, most: () => most, commits: () => commits };
}

test('one\'s own nation: its three documents asked at once, in one transaction', async () => {
  const docs = new Map([['nations/player', { name: 'Peakland', updatedAt: 7 }], ['nationx/player', { j: '{"inbox":[1]}' }], ['nationp/player', { j: '{"notes":"mine"}' }]]);
  const P = page(docs), s = await P.read('player');
  assert.deepEqual([...P.asked].sort(), ['nationp/player', 'nations/player', 'nationx/player']);
  assert.equal(P.most(), 3, 'all three were in flight together');
  assert.equal(P.commits(), 1);
  assert.deepEqual(s.data(), { name: 'Peakland', updatedAt: 7, inbox: [1], notes: 'mine' });
});

test('a nation with no private halves yet, or none at all, reads as before', async () => {
  const P = page(new Map([['nations/player', { name: 'Newland', updatedAt: 3 }]])), s = await P.read('player');
  assert.equal(s.exists, true); assert.deepEqual(s.data(), { name: 'Newland', updatedAt: 3 });
  assert.equal((await page(new Map()).read('player')).exists, false);
});
