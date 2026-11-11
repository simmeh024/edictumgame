// Development news, round three (game/edictum.html): balance-table numbers, a post's totals, the contents of a long
// post, the order of comments and the team's answers, a nation's poll picks, and the admin list's reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const line = start => { const at = html.indexOf(start); if (at < 0) throw new Error('no line ' + start); return html.slice(at, html.indexOf('\n', at)); };

test('a balance table reads the numbers people write', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${fn('nwNum')}; this.f = nwNum;`, ctx);
  const n = ctx.f;
  assert.equal(n('1,200'), 1200);
  assert.equal(n('−5%'), -5);
  assert.equal(n('<strong>3.5</strong> days'), 3.5);
  assert.equal(n('&nbsp;12 &amp; more'), 12);
  assert.equal(n('none'), null);
  assert.equal(n(''), null);
});

test('a post’s totals read every field, and a missing voter count is the votes of a one-answer poll', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`const NW_RX=[['up'],['heart'],['party'],['think']],NW_GO_RX=/^[a-z][a-z0-9-]{1,30}$/;${fn('nwStat')}; this.f = nwStat;`, ctx);
  const s = ctx.f({ r: { up: 2 }, v: [1, 3], n: 7, g: { trade: 2, 'Bad Key': 5 }, vr: { meridian: [1, 2], x: 'no' }, m: 4, ps: 9, pn: 3, pt: 123 });
  assert.equal(s.vn, 4, 'old polls: voters are the votes');
  assert.deepEqual(JSON.parse(JSON.stringify(s.g)), { trade: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(s.vr)), { meridian: [1, 2] });
  assert.equal(s.n + s.m + s.ps + s.pn + s.pt, 7 + 4 + 9 + 3 + 123);
  assert.equal(ctx.f({ v: [2, 2], vn: 3 }).vn, 3, 'a poll of several answers keeps its own voter count');
  assert.equal(ctx.f(null).n, 0);
});

test('a nation’s picks are a list, whether it voted once, several times or not at all', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${line('const nwPicks=')}; this.f = nwPicks;`, ctx);
  assert.deepEqual([...ctx.f(2)], [2]);
  assert.deepEqual([...ctx.f([0, 3])], [0, 3]);
  assert.deepEqual([...ctx.f(-1)], []);
  assert.deepEqual([...ctx.f(undefined)], []);
});

test('a long post lists its headings and patch notes blocks in order, a short one lists none', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`const NW_PN={add:'Added',chg:'Changed',fix:'Fixed',rem:'Removed'};let H='';const nwBody=p=>nwAnchors(p.id,H);
    ${fn('nwAnchors')}${fn('nwToc')}; this.set = h => { H = h; }; this.toc = id => nwToc({ id }); this.anchors = nwAnchors;`, ctx);
  ctx.set('<h2>What is new</h2><p>x</p><p><strong>Added</strong></p><ul data-pn="add"><li>a</li><li>b</li></ul><h3>Small &amp; useful</h3><ul data-pn="fix"><li>c</li></ul>');
  const t = ctx.toc('P1');
  assert.match(t, /aria-label="In this post"/);
  const items = [...t.matchAll(/data-t="(nwh-P1-\d)">([^<]*)</g)].map(m => [m[1], m[2]]);
  assert.deepEqual(items, [['nwh-P1-0', 'What is new'], ['nwh-P1-1', 'Added (2)'], ['nwh-P1-2', 'Small &amp; useful'], ['nwh-P1-3', 'Fixed (1)']]);
  assert.match(t, /<li class="l2"><button[^>]*data-t="nwh-P1-2"/, 'a subheading is indented');
  assert.match(ctx.anchors('P1', '<h2>A</h2><ul data-pn="chg"><li>x</li></ul>'), /^<h2 id="nwh-P1-0">A<\/h2><ul data-pn="chg" id="nwh-P1-1">/);
  ctx.set('<h2>One</h2><h2>Two</h2>');
  assert.equal(ctx.toc('P2'), '', 'two entries are not worth a contents');
});

test('comments: most upvoted first when asked, and the team’s answer first among the replies', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`const NW={sort:'top'};const nwCommentRow=(p,x,k)=>x.id+(k?'['+k.map(y=>y.id).join(',')+']':'')+';';${fn('nwThreads')};
    this.run = (sort, list) => { NW.sort = sort; return nwThreads({}, list).replace(/<[^>]+>|Oldest first|Newest first|Most upvoted/g, ''); };`, ctx);
  const list = [{ id: 'a', t: 1, u: 0 }, { id: 'b', t: 2, u: 3 }, { id: 'c', t: 3, u: 1 }, { id: 'r1', t: 4, re: 'a' }, { id: 'r2', t: 5, re: 'a', st: 'admin' }];
  assert.equal(ctx.run('top', list), 'b;c;a[r2,r1];');
  assert.equal(ctx.run('old', list), 'a[r2,r1];b;c;');
  assert.equal(ctx.run('new', list), 'c;b;a[r2,r1];');
});

test('reach is reads over the nations that played in the week after the post, today’s count for a new post', () => {
  const DAY = 86400000, now = Date.now();
  const ctx = vm.createContext({ DAY });
  vm.runInContext(`const ADMST={d:{}};${fn('nwReach')}; this.A = ADMST; this.f = nwReach;`, ctx);
  const t = Date.UTC(2026, 9, 1, 12), day = k => new Date(t + k * DAY).toISOString().slice(0, 10);
  ctx.A.d[''] = { a7: 50, history: [{ d: day(6), a7: 10 }, { d: day(7), a7: 20 }, { d: day(8), a7: 30 }] };
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.f({ pub: true, t }, { n: 5 }))), { pc: 25, a7: 20, now: false });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.f({ pub: true, t: now - DAY }, { n: 5 }))), { pc: 10, a7: 50, now: true });
  assert.equal(ctx.f({ pub: false, t }, { n: 5 }), null);
  ctx.A.d[''] = null;
  assert.equal(ctx.f({ pub: true, t }, { n: 5 }), null);
});

test('the vote and read tallies, and the six achievements that read them', () => {
  for (const id of ['news-read5', 'news-read20', 'news-read50', 'news-fresh', 'news-vote5', 'news-vote15']) assert.match(html, new RegExp(`achDef\\('press','${id}'`));
  assert.doesNotMatch(html, /achDef\('[a-z]+','news-[a-z0-9]+','[bsg]','[^']*comment/i, 'nothing for commenting');
  assert.match(fn('nwCountVote'), /m\.nwvn=Math\.max\(Number\(n\.nwvn\)\|\|0,n\.nwv===1\?1:0\)\+1/);
  assert.match(fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8'), /NX_KEYS\.nwr = NX_KEYS\.nwvn = NX_KEYS\.nwd = NX_KEYS\.nwp = 1/, 'the tallies live in the private half');
});
