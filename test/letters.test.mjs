// Letters between nations: how the player's own copy is kept (dmNorm, dmTrim) and their letter settings cleaned
// (dmxClean), evaluated from the game's own source. Run with: node --test test/letters.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8'), src = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const fn = name => { const i = src.indexOf('function ' + name + '('), j = src.indexOf('\n}\n', i); assert.ok(i >= 0 && j > i, name); return src.slice(i, j + 2); };
const line = start => { const i = src.indexOf(start), j = src.indexOf('\n', i); assert.ok(i >= 0, start); return src.slice(i, j); };
const ctx = vm.createContext({});
vm.runInContext(`${line('const DM_PEER_KEEP=')}
${line('const dmUid=')}
function num0(v){return typeof v==='number'&&isFinite(v)?v:0;}
${fn('dmNorm')}${fn('dmxClean')}${fn('dmTrim')}
this.api={dmNorm,dmxClean,dmTrim,DM_PEER_KEEP,DM_ALL_KEEP,DM_MAX,DM_CHARS};`, ctx);
const { dmNorm, dmxClean, dmTrim, DM_PEER_KEEP, DM_ALL_KEEP, DM_MAX, DM_CHARS } = ctx.api;
const plain = o => JSON.parse(JSON.stringify(o));

test('the own copy keeps a letter’s note, answer, attachment and group, and nothing else', () => {
  const m = dmNorm({ w: 'bob', t: 5, x: 'Hello', q: 1, k: 'protest', r: { t: 2, x: 'Your letter', m: 1, junk: 1 }, a: { k: 'deal', id: 'd1', html: '<b>' }, evil: 1 });
  assert.deepEqual(plain(m), { w: 'bob', t: 5, x: 'Hello', q: 1, k: 'protest', r: { t: 2, x: 'Your letter', m: 1 }, a: { k: 'deal', id: 'd1' } });
  assert.equal(dmNorm({ w: 'bob', t: 1, x: 'x', k: 'insult' }).k, undefined);
  assert.equal(dmNorm({ w: 'bob', t: 1, x: 'x', a: { k: 'bomb' } }).a, undefined);
  const g = dmNorm({ w: 'gr:abc-3', t: 9, x: 'To all', q: 1, to: ['bob', 'dan', 'bad id!'], qd: ['bob'], g: { id: 'gr:abc-3', m: ['me', 'bob', 'dan'], nm: 'The Three' } });
  assert.deepEqual(plain(g.to), ['bob', 'dan']); assert.deepEqual(plain(g.qd), ['bob']); assert.equal(g.g.nm, 'The Three');
  assert.deepEqual(plain(dmNorm({ w: 'npc-x', t: 1, x: 'Hi', i: 1, q: 1, b: 1 })), { w: 'npc-x', t: 1, x: 'Hi', i: 1 });   // written to us: never queued
  assert.deepEqual(plain(dmNorm({ w: 'bob', t: 1, x: 'x', q: 1, h: 'day', hd: 20400 })), { w: 'bob', t: 1, x: 'x', q: 1, h: 'day', hd: 20400 });
  assert.equal(dmNorm({ w: 'bob', t: 1, x: 'x', h: 'whenever' }).h, undefined);
  assert.equal(DM_MAX, 2500);
  assert.equal(dmNorm({ w: 'bob', t: 1, x: 'z'.repeat(DM_MAX) }).x.length, DM_MAX);                     // a long letter is kept whole
});

test('letter settings keep only what they should', () => {
  assert.equal(dmxClean(null), null);
  assert.equal(dmxClean({}), null);
  assert.equal(dmxClean({ rr: 1, nt: 1 }), null);                          // on is the default, so not kept
  assert.deepEqual(plain(dmxClean({ npc: 0 })), { npc: 0 });
  const x = dmxClean({ rr: 0, nt: 0, bl: ['bob', 'bob', 'bad id!'], mu: { 'gr:a-2': 1, bob: 2 }, arc: { bob: 5, dan: 'x' }, off: { 'office-gazette': 1 }, nl: 3, junk: 1 });
  assert.deepEqual(plain(x), { rr: 0, nt: 0, bl: ['bob'], mu: { 'gr:a-2': 1 }, off: { 'office-gazette': 1 }, arc: { bob: 5 }, nl: 3 });
});

test('the own copy keeps every letter not yet sent, the last of each conversation, and notes where it cut', () => {
  const dm = [];
  for (let i = 0; i < DM_PEER_KEEP + 5; i++) dm.push({ w: 'bob', t: 100 + i, x: 'b' + i });
  dm.push({ w: 'bob', t: 50, x: 'queued long ago', q: 1 });
  for (let i = 0; i < 4; i++) dm.push({ w: 'dan', t: 300 + i, x: 'd' + i });
  const n = { dm: dm.slice() };
  dmTrim(n);
  const bob = n.dm.filter(m => m.w === 'bob' && !m.q);
  assert.equal(bob.length, DM_PEER_KEEP);
  assert.equal(bob[0].t, 105);                                              // the oldest five went
  assert.ok(n.dm.some(m => m.q && m.x === 'queued long ago'));              // a letter not yet sent always stays
  assert.equal(n.dm.filter(m => m.w === 'dan').length, 4);
  assert.equal(n.dmx.cut.bob, 105);                                         // the other side's older letters hide too
  assert.equal(n.dmx.cut.dan, undefined);
  // and no more than DM_ALL_KEEP in all
  const many = { dm: [] };
  for (let p = 0; p < 12; p++) for (let i = 0; i < DM_PEER_KEEP; i++) many.dm.push({ w: 'p' + p, t: p * 1000 + i, x: 'x' });
  dmTrim(many);
  assert.equal(many.dm.length, DM_ALL_KEEP);
  assert.ok(Object.keys(many.dmx.cut).length >= 1);
  // and no more than DM_CHARS of text: long letters go oldest first, a letter not yet sent stays
  const long = { dm: [] };
  for (let p = 0; p < 10; p++) for (let i = 0; i < 20; i++) long.dm.push({ w: 'p' + p, t: i * 100 + p, x: 'w'.repeat(DM_MAX) });
  long.dm.push({ w: 'p0', t: 1, x: 'w'.repeat(DM_MAX), q: 1 });
  dmTrim(long);
  const chars = long.dm.reduce((s, m) => s + m.x.length, 0);
  assert.ok(chars <= DM_CHARS + DM_MAX, chars);
  assert.ok(long.dm.length < 201 && long.dm.some(m => m.q));
  assert.equal(Math.max(...long.dm.filter(m => !m.q).map(m => m.t)), 19 * 100 + 9);                       // the newest stay
  // nothing trimmed, nothing changed
  const few = { dm: [{ w: 'bob', t: 1, x: 'a' }] };
  dmTrim(few);
  assert.equal(few.dmx, undefined);
});
