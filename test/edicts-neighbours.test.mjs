// Two hundred edicts about the neighbours (game/edictum.html, section of that name; 16 November 2026, after the owner
// asked for edicts that reach the nation next door or need its cooperation, and a few fun ones). nbr- edicts move
// goodwill and sometimes put a reply on a player neighbour's desk (nr); coo- edicts are joint projects whose answer co
// puts the proposal to the neighbour: a player answers it on its own desk (coo-x-r, whose answers send coo-x-y or
// coo-x-n back), a computer nation answers by goodwill through the chain; fun- edicts are just fun.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const fnSrc = name => { const i = code.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); let d = 0, j = code.indexOf('{', i); for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}' && !--d) break; } return code.slice(i + 1, j + 1); };
const STAT_KEYS = JSON.parse(code.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const BUDGET_KEYS = ['admin', 'defence', 'edu', 'env', 'health', 'commerce', 'aid', 'law', 'transport', 'equality', 'spirit', 'welfare'];
const LOOP = 'for(const is of NBR_ISSUES){';

function load() {
  const a = code.indexOf('const NBR_ISSUES=['), last = '  if(!is.fo)ISSUES_RANDOM.push(is);}', end = code.indexOf(last, code.indexOf(LOOP)) + last.length;
  const ctx = vm.createContext({ ISSUES: Array.from({ length: 9 }), ISSUE_BY_ID: {}, ISSUES_RANDOM: [], NB_RE: /\{NB(D|L|CAP)?\}/, reqText: is => is.reqSrc || (is.req ? String(is.req) : '') });
  vm.runInContext(code.slice(a, end) + '\nthis.L=NBR_ISSUES;this.R=ISSUES_RANDOM;', ctx);
  return { L: JSON.parse(JSON.stringify(ctx.L.map(i => ({ ...i, req: i.req ? String(i.req) : undefined, nbx: i.nbx })))), R: ctx.R.map(i => i.id) };
}
const kind = id => /^nbr-.+-r$/.test(id) ? 'nbr-r' : /^nbr-/.test(id) ? 'nbr' : /^coo-.+-[ryn]$/.test(id) ? 'coo-' + id.slice(-1) : /^coo-/.test(id) ? 'coo' : /^fun-/.test(id) ? 'fun' : '?';

test('two hundred, numbered after every older edict, placed after the productivity edicts with nothing after them', () => {
  const a = code.indexOf('const NBR_ISSUES=['), b = code.indexOf('/* ───────── the browser tab');
  assert.ok(a > code.indexOf('for(const is of PRD_ISSUES)') && a < b, 'after the productivity edicts, before the browser tab');
  assert.equal(code.indexOf('ISSUES.push(', code.indexOf(LOOP) + LOOP.length + 1), -1, 'nothing is added after them');
  const { L, R } = load();
  assert.equal(L.length, 200);
  assert.deepEqual(L.map(x => x.no), Array.from({ length: 200 }, (_, i) => 10 + i), 'numbered in order');
  assert.equal(new Set(L.map(x => x.id)).size, 200, 'ids unique');
  assert.equal(new Set(L.map(x => x.t)).size, 200, 'titles unique');
  for (const is of L) assert.equal(source.split(`id:'${is.id}'`).length, 2, is.id + ' appears once in the game');
  assert.deepEqual(R, L.filter(x => !x.fo).map(x => x.id), 'everything but the follow-ups is drawn at random');
  const n = {}; for (const is of L) n[kind(is.id)] = (n[kind(is.id)] || 0) + 1;
  assert.ok(!n['?'], 'every id is nbr-, coo- or fun-');
  assert.equal(n.coo, n['coo-r']);assert.equal(n.coo, n['coo-y']);assert.equal(n.coo, n['coo-n']);
  assert.ok(n.coo >= 12 && n.nbr >= 90 && n.fun >= 15 && n['nbr-r'] >= 10, JSON.stringify(n));
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'NBR_ISSUES'/, 'the content split carries them');
});

test('each one is well formed: conditions, weights, links between them, effects and typography', () => {
  const { L } = load(), by = Object.fromEntries(L.map(i => [i.id, i]));
  for (const is of L) {
    const k = kind(is.id), nbText = /\{NB/.test(JSON.stringify(is));
    assert.ok(['econ', 'world', 'culture', 'nature', 'society', 'gov', 'rights', 'weird', 'welfare', 'tech'].includes(is.c), is.id);
    assert.ok(is.o.length >= 3 && is.o.length <= 4, is.id + ' options');
    if (k === 'nbr' || k === 'coo' || (k === 'fun' && nbText)) {
      assert.match(is.req, /hasNb\(n\)/, is.id + ' needs a neighbour');assert.equal(is.w, k === 'coo' ? 2.5 : 2, is.id + ' weight');
      assert.ok(is.nbx, is.id + ' arrives with a neighbour');
    } else if (k === 'fun') assert.ok(!is.req && is.w == null, is.id);
    else assert.ok(is.fo === 1 && !is.req && is.w == null, is.id + ' is a follow-up only');
    if (k === 'coo') { assert.ok(is.o.some(o => o.co === is.id), is.id + ' puts it to the neighbour');for (const s of ['-r', '-y', '-n']) assert.ok(by[is.id + s], is.id + s); }
    if (k === 'coo-r') { const base = is.id.slice(0, -2);assert.ok(is.o.every(o => o.nr === base + '-y' || o.nr === base + '-n'), is.id + ': every answer goes back');assert.ok(is.o.some(o => o.nr === base + '-y') && is.o.some(o => o.nr === base + '-n'), is.id + ': yes and no'); }
    if (k === 'nbr-r') assert.ok(by[is.id.slice(0, -2)].o.some(o => o.nr === is.id), is.id + ' is sent by its edict');
    for (const o of is.o) {
      if (o.nr) assert.ok(k === 'coo-r' || (k === 'nbr' && o.nr === is.id + '-r' && by[o.nr]), is.id + ' nr');
      if (o.co) assert.equal(k, 'coo', is.id + ' co');
      assert.ok(!o.nx, is.id + ' no chain follow-ups');
      for (const [ek, v] of Object.entries(o.e)) {
        if (ek === 'b') { for (const [bk, bv] of Object.entries(v)) assert.ok(BUDGET_KEYS.includes(bk) && [1, 2, -1, -2].includes(bv), is.id + ' b.' + bk);continue; }
        if (ek === 'nb') { assert.ok(Number.isInteger(v) && v && Math.abs(v) <= 12 && nbText, is.id + ' nb ' + v);continue; }
        if (ek === 'take' || ek === 'cede') { assert.ok(v === 1 && (k === 'nbr' || k === 'fun' || k === 'coo'), is.id + ' ' + ek);continue; }
        if (ek === 'pd') { assert.ok([1, 2].includes(v), is.id + ' pd');continue; }
        assert.ok(STAT_KEYS.includes(ek), is.id + ' ' + ek);assert.ok(Number.isInteger(v) && Math.abs(v) >= 1 && Math.abs(v) <= 4, is.id + ' ' + ek + ' ' + v);
      }
    }
    for (const t of [is.t, is.q, ...is.o.flatMap(o => [o.t, o.fx])]) {
      assert.doesNotMatch(t, /["'`]/, is.id + ' typographic quotes only');assert.doesNotMatch(t, /postcode/i, is.id);
      for (const m of t.matchAll(/\{([A-Za-z:]+)\}/g)) assert.ok(/^(N|D|C|Cs|L|CAP|A|As|LAND|NB|NBD|NBL|NBCAP|FIN|INT|FOR|DEF|CUL|WRK|HEA)$/.test(m[1]), is.id + ' {' + m[1] + '}');
    }
  }
  const opts = L.flatMap(i => i.o), cab = opts.filter(o => /\{(FIN|INT|FOR|DEF|CUL|WRK|HEA)\}/.test(o.t)).length;
  assert.ok(cab / opts.length < 0.22, 'cabinet voices stay a minority: ' + cab + ' of ' + opts.length);
});

function wrapper(world) {
  const a = code.indexOf('function coChance('), b = code.indexOf('const NBR_ISSUES=[');
  const ctx = vm.createContext({
    ISSUE_BY_ID: { 'coo-x-r': {}, 'coo-x-y': {}, 'coo-x-n': {} }, GW_MAX: 40, findNation: id => world[id] || null,
    edictPriorNorm: p => p && p.id ? { id: p.id, t: p.t, title: '', fx: p.fx } : null, geoAfter: () => [['Base', '']]
  });
  vm.runInContext(['const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));', fnSrc('hash'), fnSrc('rng'), fnSrc('gwOf'), code.slice(a, b), 'this.coChance=coChance;this.geoAfter=geoAfter;'].join('\n'), ctx);
  return ctx;
}
const nation = gw => ({ seed: 's1', gw: { nb1: gw }, log: [], chain: [], sent: [] });

test('a computer neighbour answers a joint proposal by goodwill, through the chain, 3 to 6 hours later', () => {
  const W = wrapper({ nb1: { id: 'nb1', npc: true, n: { name: 'Ostrava Minor' } } });
  assert.equal(W.coChance(0), 0.55);assert.equal(W.coChance(40), 0.95);assert.equal(W.coChance(-40), 0.1);assert.equal(W.coChance(undefined), 0.55);
  let yes = 0;
  for (let i = 0; i < 400; i++) {
    const n = nation(0), now = 1e12 + i * 7919, notes = W.geoAfter(n, { co: 'coo-x', e: {} }, { id: 'coo-x', nb: 'nb1' }, now, { id: 'coo-x', t: now, fx: 'asked' });
    assert.equal(n.chain.length, 1);const c = n.chain[0];
    assert.ok(c.id === 'coo-x-y' || c.id === 'coo-x-n');yes += c.id === 'coo-x-y';
    const h = (c.at - now) / 3600e3;assert.ok(Number.isInteger(h) && h >= 3 && h <= 6, 'hours ' + h);
    assert.equal(c.nb, 'nb1');assert.equal(c.nbn, 'Ostrava Minor');assert.equal(c.prior.id, 'coo-x');
    assert.equal(notes[0][0], 'Base');assert.equal(notes[1][0], 'Proposal');assert.equal(n.sent.length, 0);
  }
  assert.ok(yes > 180 && yes < 260, 'about 55% at neutral goodwill: ' + yes);
  let friends = 0, foes = 0;
  for (let i = 0; i < 200; i++) {
    const a = nation(30), b = nation(-30), now = 2e12 + i * 104729;
    W.geoAfter(a, { co: 'coo-x', e: {} }, { nb: 'nb1' }, now);W.geoAfter(b, { co: 'coo-x', e: {} }, { nb: 'nb1' }, now);
    friends += a.chain[0].id === 'coo-x-y';foes += b.chain[0].id === 'coo-x-y';
  }
  assert.ok(friends > 170 && foes < 40, `friends agree (${friends}/200), foes refuse (${foes}/200)`);
  const n = nation(0);n.chain = [{ id: 'coo-x-n', at: 1 }, { id: 'other', at: 2 }];
  W.geoAfter(n, { co: 'coo-x', e: {} }, { nb: 'nb1' }, 3e12);
  assert.deepEqual(n.chain.map(c => c.id).filter(id => id !== 'coo-x-y' && id !== 'coo-x-n'), ['other'], 'an earlier answer still waiting is replaced');
  assert.equal(n.chain.length, 2);
});

test('a player neighbour finds the proposal on its own desk, and nothing happens without co or a neighbour', () => {
  const W = wrapper({ p2: { id: 'p2', npc: false, n: { name: 'Vell' } } });
  const n = nation(0), now = 5e12, notes = W.geoAfter(n, { co: 'coo-x', e: {} }, { nb: 'p2' }, now);
  assert.deepEqual(JSON.parse(JSON.stringify(n.sent)), [{ to: 'p2', id: 'coo-x-r', t: now }]);
  assert.equal(n.chain.length, 0, 'the answer comes from the player, not the chain');
  assert.equal(n.log[0].k, 'shared');assert.equal(notes[1][0], 'Proposal');
  for (const [opt, ent] of [[{ e: {} }, { nb: 'p2' }], [{ co: 'coo-x', e: {} }, {}], [{ co: 'coo-x', e: {} }, { nb: 'gone' }], [{ co: 'coo-zzz', e: {} }, { nb: 'p2' }]]) {
    const m = nation(0), r = W.geoAfter(m, opt, ent, now);
    assert.equal(r.length, 1);assert.equal(m.sent.length + m.chain.length + m.log.length, 0);
  }
});

test('the admin catalogue links a proposal to its three follow-ups', () => {
  assert.match(code, /if\(o\.co\)for\(const k of \['-r','-y','-n'\]\)add\(o\.co\+k,is\.id\);/);
  assert.match(code, /o\.co\?` · Put to the neighbour: \$\{admeLink\(o\.co\+'-r'\)\}/);
  assert.match(code, /is\.o\.some\(o=>o\.nx\|\|o\.co\)&&'Leads on'/);
});
