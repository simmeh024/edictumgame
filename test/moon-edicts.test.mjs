// Eight early edicts about the Moon (game/edictum.html, "the Moon, seen from here"; 21 November 2026, after the owner
// asked for new edicts at the front of the game so that a player finds out more about the Moon, early). Before the
// Space page opens they arrive in order at MN_AT enacted edicts, one at a time and never straight after another; once
// it is open they are ordinary edicts. They are the last edicts appended, so no older edict's number moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const STAT_KEYS = JSON.parse(code.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const SPX_AT = +code.match(/const SPX_AT=(\d+)/)[1];
const A = code.indexOf('const MN_AT='), B = code.indexOf("/* the browser tests' window into them (EDICTUM_PROBE.mn)");
const J = v => JSON.parse(JSON.stringify(v));

function load(over = {}) {
  const st = { open: false, ws: false, chain: false, pre: false, ...over };
  const ctx = vm.createContext({
    ISSUES: Array.from({ length: 2900 }), ISSUE_BY_ID: {}, ISSUES_RANDOM: [], HELP_EXT: [{ k: 'space-page', body: () => '<p>It opens. Until then Space is not in the menu.</p><ol></ol>' }],
    TUT_PATH: {}, window: {}, st,
    spOpen: () => st.open, mcEdicts: n => n.ws.e,
    issLast: n => new Map((n.seen || []).map(id => [id, { d: 0, r: 0 }])),
    wsChainDue: () => st.chain, wsDue: () => st.ws, spPreDue: () => st.pre,
    nextEntry: m => ({ id: 'random', at: m.issueClock }),
    edictTopicBadge: is => '<span class="edict-topic">' + (is ? is.c : '') + '</span>'
  });
  vm.runInContext(code.slice(A, B) + '\nthis.L=MN_ISSUES;this.AT=MN_AT;this.R=ISSUES_RANDOM;this.next=nextEntry;this.badge=edictTopicBadge;this.coming=mnComing;', ctx);
  return ctx;
}
const nation = (e, x = {}) => ({ name: 'Testland', issueClock: 1000, ws: { e }, inbox: [], answered: [], seen: [], ...x });

test('eight Moon edicts, the last appended, before the Space page opens', () => {
  assert.ok(A > 0 && B > A);
  /* appended after every other edict but the war edicts (war-round-two.test.mjs), which keep the same rule */
  /* then the National Research Programme's edicts (research.test.mjs), the last of all */
  const rsAt = code.indexOf('/* ───────── the National Research Programme (22 November 2026)'), vet = code.lastIndexOf('ISSUES.push(', rsAt), war = code.lastIndexOf('ISSUES.push(', vet - 1), last = code.lastIndexOf('ISSUES.push(', war - 1);
  assert.ok(rsAt > vet && code.lastIndexOf('ISSUES.push(') > rsAt, 'the research edicts after them');
  assert.equal(code.lastIndexOf('for(const is of ', vet), code.indexOf('for(const is of WAR3_ISSUES){'), 'then the veterans’ edicts');
  assert.equal(code.lastIndexOf('for(const is of ', war), code.indexOf('for(const is of WAR2_ISSUES){'), 'only the war edicts after them');
  assert.equal(code.lastIndexOf('for(const is of ', last), code.indexOf('for(const is of MN_ISSUES){'), 'appended after every other edict');
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'MN_ISSUES'/);
  const ctx = load(), L = ctx.L;
  assert.equal(L.length, 8);
  assert.deepEqual(J(L.map(x => x.no)), Array.from({ length: 8 }, (_, i) => 2901 + i));
  assert.equal(ctx.R.length, 8, 'ordinary edicts once the page is open');
  assert.equal(new Set(L.map(x => x.id)).size, 8);
  assert.equal(new Set(L.map(x => x.t)).size, 8);
  assert.deepEqual(J(ctx.AT), [...ctx.AT].sort((a, b) => a - b));
  assert.ok(ctx.AT.length === 8 && ctx.AT[0] >= 1 && ctx.AT[7] < SPX_AT, 'all before the prelude');
  for (const is of L) {
    assert.match(is.id, /^mn-[a-z]+$/);
    assert.equal(source.split(`id:'${is.id}'`).length, 2, is.id + ' once in the game');
    assert.ok(['econ', 'culture', 'nature', 'world', 'society', 'gov', 'rights', 'weird', 'tech', 'welfare'].includes(is.c), is.id);
    assert.match(is.q, /Moon/, is.id + ' is about the Moon');
    assert.equal(is.o.length, 3, is.id);
    for (const o of is.o) {
      assert.match(o.t, /^“.+” says .+/, is.id + ' a speech');
      assert.ok(o.fx && /^[a-z{]/.test(o.fx), is.id + ' fx');
      for (const [k, v] of Object.entries(o.e)) { assert.ok(STAT_KEYS.includes(k), is.id + ' ' + k); assert.ok(Number.isInteger(v) && Math.abs(v) <= 3, is.id + ' ' + k); }
      const all = o.t + o.fx + is.q + is.t;
      assert.doesNotMatch(all, /['"]/, is.id + ' typographic quotes');
      for (const m of all.matchAll(/\{([A-Za-z]+)\}/g)) assert.ok(['N', 'D', 'CAP', 'HEA', 'WRK', 'CUL', 'FOR', 'FIN'].includes(m[1]), is.id + ' {' + m[1] + '}');
    }
    assert.equal(is.req({}), false, 'not drawn at random before the page opens');
  }
  ctx.st.open = true;
  assert.ok(ctx.L.every(is => is.req({})), 'drawn like any other once it is open');
});

test('they arrive in order at their counts, one at a time and never straight after another', () => {
  const ctx = load(), id = k => ctx.L[k].id;
  assert.equal(ctx.next(nation(0)).id, 'random', 'none before the first enacted edict');
  assert.equal(ctx.next(nation(1)).id, id(0));
  assert.equal(ctx.next(nation(1, { inbox: [{ id: id(0), at: 1 }] })).id, 'random', 'one at a time');
  assert.equal(ctx.next(nation(9, { seen: [id(0)], answered: [{ id: id(0), o: 1, t: 2 }] })).id, 'random', 'not straight after another');
  assert.equal(ctx.next(nation(9, { seen: [id(0)], answered: [{ id: id(0), o: 1, t: 2 }, { id: 'tax', o: 0, t: 3 }] })).id, id(1));
  assert.equal(ctx.next(nation(2, { seen: [id(0)], answered: [{ id: id(0), o: -1, t: 2 }, { id: 'tax', o: 0, t: 3 }] })).id, 'random', 'the second waits for its count (a veto counts as met)');
  /* in order: the first not yet met, even if a later one was somehow seen */
  assert.equal(ctx.next(nation(30, { seen: [id(0), id(3)] })).id, id(1));
  assert.equal(ctx.next(nation(30, { seen: ctx.L.map(x => x.id) })).id, 'random', 'all eight met');
  assert.deepEqual(J(ctx.next(nation(30))), { id: id(0), at: 1000 });
  assert.equal(ctx.next(nation(30, { npc: true })).id, 'random', 'not for computer nations');
  for (const k of ['open', 'ws', 'chain', 'pre']) {
    const c = load({ [k]: true });
    assert.equal(c.next(nation(30)).id, 'random', k + ' goes first');
  }
});

test('Coming up, the tag on the card and How to play', () => {
  const ctx = load(), id = k => ctx.L[k].id;
  assert.deepEqual(J(ctx.coming(nation(0))), { ic: 'moon', t: 'First edict about the Moon', d: 'after your first edict · 0 of 1', p: 0 });
  assert.deepEqual(J(ctx.coming(nation(4, { seen: [id(0), id(1)] }))), { ic: 'moon', t: 'Next edict about the Moon', d: 'after 6 edicts · 4 of 6', p: 4 / 6 });
  assert.equal(ctx.coming(nation(9, { seen: [id(0), id(1)] })), null, 'nothing to wait for once its count is reached');
  assert.equal(ctx.coming(nation(0, { inbox: [{ id: id(0) }] })), null, 'nor while one is on the desk');
  assert.equal(ctx.coming(nation(30, { seen: ctx.L.map(x => x.id) })), null);
  ctx.st.open = true;assert.equal(ctx.coming(nation(0)), null, 'nor once the Space page is open');
  assert.ok(ctx.TUT_PATH.moon.startsWith('<path'));
  assert.match(ctx.badge(ctx.L[6]), /^<span class="edict-topic">world<\/span><span class="edict-moon">The Moon · 7 of 8<\/span>$/);
  assert.equal(ctx.badge({ id: 'tax', c: 'econ' }), '<span class="edict-topic">econ</span>');
  const help = ctx.HELP_EXT[0].body({});
  assert.match(help, /Until then Space is not in the menu\.<\/p><p>Before it come 8 edicts about the Moon, one every few among your first 21,/);
  assert.match(help, /<ol><\/ol>$/);
});
