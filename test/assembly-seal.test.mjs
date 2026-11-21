// The Chancery seal in the Assembly and on treaties (game/edictum.html): beside a member's name wherever the Assembly
// names a player nation (the Delegate's chair, the vote and its reasons, the endorsements, the Book's "how the members
// voted", the Region page's box) and beside the other side of a treaty or border agreement. The badge is shopBadge's:
// the seal, with the founder's pill and the flag champion's rosette when a nation has them; none for a computer nation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const badge = n => n && !n.npc ? `<i class="seal" data-of="${n.name}"></i>` : '';

test('the Book’s “how the members voted” puts each member’s badge after its name, before its reason', () => {
  const asmVotersHTML = new Function('esc', 'asmW', 'list', 'NPC_BY_ID', 'shopBadge', fn('asmVotersHTML') + '\nreturn asmVotersHTML;')(
    esc, w => String(w), a => a.join(', '), { npc1: { name: 'Zollhorn' } }, (n, sm) => (assert.equal(sm, 1, 'the small badge'), badge(n)));
  const st = { recs: [{ id: 'a', n: { name: 'Aldmere' } }, { id: 'b', n: { name: 'Brackwater' } }] };
  const h = { vm: { a: 1, b: -1, gone: 0 }, vx: { a: 'Free the hens.' }, vu: ['a', 'b', 'gone', 'away'], nv: { npc1: 1 } };
  const out = asmVotersHTML(st, h);
  assert.match(out, /Aldmere<i class="seal" data-of="Aldmere"><\/i> <q class="asm-vx">Free the hens\.<\/q>/);
  assert.match(out, /Brackwater<i class="seal" data-of="Brackwater"><\/i>/);
  assert.match(out, /1 former member/, 'a member no longer in the region is counted, with no badge');
  assert.equal((out.match(/class="seal"/g) || []).length, 2, 'one badge per named member, none for computer nations');
});

test('idBadge: the small badge of a nation known by its id, none for a computer nation or an unknown id', () => {
  const W = { a: { id: 'a', n: { name: 'Aldmere' } }, npc: { id: 'npc', npc: true, n: { name: 'Zollhorn', npc: true } } };
  const calls = [];
  const idBadge = new Function('findNation', 'shopBadge', fn('idBadge') + '\nreturn idBadge;')(
    id => W[id] || null, (n, sm) => { calls.push(sm); return badge(n); });
  assert.equal(idBadge('a'), '<i class="seal" data-of="Aldmere"></i>');
  assert.equal(idBadge('npc'), '');
  assert.equal(idBadge('nobody'), '');
  assert.deepEqual(calls, [1], 'asks for the small badge, and only for a player nation');
  const broken = new Function('findNation', 'shopBadge', fn('idBadge') + '\nreturn idBadge;')(() => { throw new Error('no world'); }, badge);
  assert.equal(broken('a'), '', 'a failure leaves the name bare rather than breaking the page');
});

test('flIdOf: the Assembly’s copy of a nation is known by the id the server gave it, so its seal is found', () => {
  const me = { name: 'Aldmere' }, them = { name: 'Brackwater' };
  const flIdOf = new Function('S', 'myId', 'flIds', fn('flIdOf') + '\nreturn flIdOf;')({ nation: me, world: { uB: them } }, () => 'uA', new WeakMap());
  assert.equal(flIdOf(me), 'uA');
  assert.equal(flIdOf(them), 'uB', 'the original, from the world');
  assert.equal(flIdOf(Object.assign({}, them, { _civicId: 'uB' })), 'uB', 'a copy (asmRecs), by its _civicId');
  assert.equal(flIdOf(Object.assign({}, them)), null, 'a copy without one is not guessed at');
  assert.equal(flIdOf({ name: 'Zollhorn', npc: true, _civicId: 'x' }), null, 'never a computer nation');
  assert.match(html, /\nasmRecs=function\(\)\{[^\n]*\n[^\n]*\n[^\n]*_civicId:r\.id/, 'asmRecs still marks its copies');
});

test('every place the Assembly names a player nation carries its badge right after the name', () => {
  const at = [
    ['asmDelBanner', /\$\{mine\?esc\(n\.name\):nationLink\(D\.id,n\.name,false\)\}\$\{shopBadge\(n,1\)\}/, 'the Delegate’s chair'],
    ['asmVoteCard', /<span class="asm-vn">\$\{r\.me\?'<b>'\+esc\(r\.n\.name\)\+'<\/b>':nationLink\(r\.id,r\.n\.name,false\)\}\$\{shopBadge\(r\.n,1\)\}/, 'the players at the vote, beside their reasons'],
    ['asmEndSec', /<span class="mem-n">\$\{nationLink\(x\.id,x\.n\.name,x\.me\)\}\$\{shopBadge\(x\.n,1\)\}/, 'the endorsements'],
    ['asmRegionBox', /Delegate: \$\{nationLink\(D\.id,D\.r\.n\.name,D\.r\.me\)\}\$\{shopBadge\(D\.r\.n,1\)\}/, 'the Region page’s box'],
    ['asmWho', /nationLink\(x\.id,x\.n\.name,x\.me\)/, 'a proposer (its badge added where asmWho is wrapped)'],
  ];
  for (const [name, re, what] of at) assert.match(fn(name), re, what);
  assert.match(html, /\nasmWho=\(f=>function\(id\)\{const h=f\.apply\(this,arguments\);[^\n]*shopBadge\(x\.n,1\)/, 'asmWho adds the badge to a proposer, or a nation commended or condemned');
  /* the computer nations' list at the vote stays bare */
  assert.match(fn('asmVoteCard'), /np\.map\(r=>`<li>\$\{asmFlag\(r\.n\)\}<span class="asm-vn">\$\{nationLink\(r\.id,r\.n\.name,false\)\}<\/span>/);
});

test('a treaty’s and a border agreement’s other side carries its badge; a computer nation its Computer chip', () => {
  const ty = fn('dpTreaties');
  assert.match(ty, /const who=id=>\{const x=findNation\(id\);return x\?`\$\{alFlag\(x\)\}\$\{nationLink\(id,x\.n\.name,false\)\}\$\{x\.npc\?'<span class="chip">Computer<\/span>':shopBadge\(x\.n,1\)\}`/);
  assert.match(ty, /row=\(T,acts,extra\)=>`<li class="dpt-i"><span class="dpt-n">\$\{who\(oth\(T\)\)\}/, 'offers either way and treaties in force all name the other side through who()');
  assert.match(fn('bdTabHTML'), /<b>With \$\{list\(bdOthers\(B,me\)\.map\(id=>esc\(nameOf\(id\)\)\+idBadge\(id\)\)\)\}<\/b>/);
});

test('the Shop says where the seal shows', () => {
  assert.match(html, /Members may show a seal beside their nation’s name: on its page, in chat, on the region board, in the Assembly \(its proposals, votes, endorsements and the Delegate’s chair\) and on its treaties\./);
  assert.match(html, /<li><b>A Chancery seal beside your nation’s name<\/b> in chat, on the board, in the Assembly and on your treaties, unless you choose to hide it:/);
});
