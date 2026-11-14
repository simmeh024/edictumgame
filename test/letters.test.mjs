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
${line('const DM_LABELS=')}
${line('const dmUid=')}
${line('const esc = ')}
${line('const DM_B=')}
${line('const DM_BUL=')}
${line('function dmInline(')}
${line('function dmPlain(')}
function num0(v){return typeof v==='number'&&isFinite(v)?v:0;}
${fn('dmNorm')}${fn('dmxClean')}${fn('dmTrim')}${fn('dmRich')}
this.api={dmNorm,dmxClean,dmTrim,dmRich,dmPlain,DM_PEER_KEEP,DM_ALL_KEEP,DM_MAX,DM_CHARS};`, ctx);
const { dmNorm, dmxClean, dmTrim, dmRich, dmPlain, DM_PEER_KEEP, DM_ALL_KEEP, DM_MAX, DM_CHARS } = ctx.api;
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

/* formatting (Messages ideas, 2026-11-14): **bold**, *italic* or _italic_, "- " and "1. " lists, blank lines between
   paragraphs. The words are escaped first, so nothing else becomes markup */
test('a letter’s marks become bold, italic, paragraphs and lists, and nothing else becomes markup', () => {
  assert.equal(dmRich('Hello'), '<p>Hello</p>');
  assert.equal(dmRich('**Grain** for *iron*, _now_.'), '<p><b>Grain</b> for <i>iron</i>, <i>now</i>.</p>');
  assert.equal(dmRich('<b>hi</b> & "you"'), '<p>&lt;b&gt;hi&lt;/b&gt; &amp; &quot;you&quot;</p>');
  assert.equal(dmRich('- <img src=x onerror=alert(1)>'), '<ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>');
  assert.equal(dmRich('Dear friends,\nwe propose:\n\n- grain\n- **iron**\n\n1. first\n2. second\nYours'),
    '<p>Dear friends,\nwe propose:</p><ul><li>grain</li><li><b>iron</b></li></ul><ol><li>first</li><li>second</li></ol><p>Yours</p>');
  assert.equal(dmRich('3. third\n4) fourth'), '<ol start="3"><li>third</li><li>fourth</li></ol>');
  assert.equal(dmRich('* one\n• two'), '<ul><li>one</li><li>two</li></ul>');
  // not marks: sums, names with underscores, a lone star, spaces inside
  assert.equal(dmRich('2*3*4 = 24, snake_case_name, 5 * 3, ** not bold**, * not italic*'), '<p>2*3*4 = 24, snake_case_name, 5 * 3, ** not bold**, * not italic*</p>');
  assert.equal(dmRich('-5 degrees\n2024. A year'), '<p>-5 degrees\n2024. A year</p>');
  assert.equal(dmRich(''), '<p></p>');
});

test('the same letter without its marks, for the list of conversations, search and quotes', () => {
  assert.equal(dmPlain('**Grain** for *iron*, _now_.'), 'Grain for iron, now.');
  assert.equal(dmPlain('Terms:\n- grain\n* iron'), 'Terms:\n• grain\n• iron');
  assert.equal(dmPlain('2*3*4 and snake_case'), '2*3*4 and snake_case');
});

test('conversation labels are kept as known letters in a fixed order, for conversations of a sensible id', () => {
  const x = dmxClean({ lb: { bob: 'wtt', dan: 'zz', eve: '', 'gr:abc-3': 'ia', [ 'x'.repeat(91) ]: 't', fred: 7, gus: 'twafiTWAFI' } });
  assert.deepEqual(plain(x), { lb: { bob: 'tw', 'gr:abc-3': 'ai' } });
  assert.equal(dmxClean({ lb: { bob: 'q' } }), null);
  assert.equal(dmxClean({ lb: 'tw' }), null);
});
