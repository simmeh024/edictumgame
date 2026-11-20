// A hundred edicts that write the nation's history (game/edictum.html, section of that name; 18 November 2026, after
// the owner asked for edicts that let the player choose a bit of their nation's history, saved in their overview).
// Every hx- option carries hx, the line the choice writes; geoAfter keeps [id, option, time] in n.hx, a NORM_HOOK
// cleans it on load, and hxCard shows it, oldest era first, on the Statistics Overview.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const STAT_KEYS = JSON.parse(code.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const A = code.indexOf('const HX_ERAS='), B = code.indexOf('\n/* ───────── the browser tab');

const J = v => JSON.parse(JSON.stringify(v));
function load() {
  const hooks = [];
  const ctx = vm.createContext({ ISSUES: Array.from({ length: 9 }), ISSUE_BY_ID: {}, ISSUES_RANDOM: [], NORM_HOOKS: hooks,
    geoAfter: () => [], fpStats: (t, b) => b, esc: s => String(s), fill: (t, n) => String(t).replace(/\{N\}/g, n.name) });
  vm.runInContext(code.slice(A, B) + '\nthis.L=HX_ISSUES;this.R=ISSUES_RANDOM;this.geo=geoAfter;this.card=hxCard;this.list=hxList;', ctx);
  return { ctx, hooks };
}

test('a hundred history edicts, the last section before the browser tab, all drawn at random', () => {
  assert.ok(A > code.indexOf('for(const is of NBR_ISSUES){') && A < B);
  /* nothing is added after them but the joint military training edicts, beside the treaties after boot (joint-training.test) */
  assert.equal(code.indexOf('ISSUES.push(', code.indexOf('for(const is of HX_ISSUES){') + 30), code.indexOf('for(const is of DRL_ISSUES){ISSUES.push(') + 28, 'nothing is added after them but the training edicts');
  assert.ok(code.indexOf('const DRL_ISSUES=[') > B, 'which sit after the browser tab’s section');
  const { ctx } = load(), L = ctx.L;
  assert.equal(L.length, 100);
  assert.deepEqual(J(L.map(x => x.no)), Array.from({ length: 100 }, (_, i) => 10 + i));
  assert.equal(new Set(L.map(x => x.id)).size, 100);
  assert.equal(new Set(L.map(x => x.t)).size, 100);
  assert.equal(ctx.R.length, 100);
  for (const is of L) {
    assert.match(is.id, /^hx-[a-e]-[a-z0-9-]+$/);
    assert.equal(source.split(`id:'${is.id}'`).length, 2, is.id + ' once');
    assert.ok(is.era >= 1 && is.era <= 6, is.id + ' era');
    assert.ok(is.o.length >= 3 && is.o.length <= 4, is.id);
    for (const o of is.o) {
      assert.ok(o.hx && /\{(N|D|CAP)\}/.test(o.hx) && o.hx.length <= 260, is.id + ' hx');
      assert.ok(o.fx && o.t, is.id);
      for (const [k, v] of Object.entries(o.e)) { assert.ok(STAT_KEYS.includes(k), is.id + ' ' + k); assert.ok(Number.isInteger(v) && Math.abs(v) <= 3); }
      assert.doesNotMatch(o.t + o.fx + o.hx + is.q + is.t, /['"]/, is.id + ' typographic quotes');
    }
  }
  for (let e = 1; e <= 6; e++) assert.ok(L.some(x => x.era === e), 'era ' + e + ' has edicts');
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'HX_ISSUES'/);
});

test('the chosen line is kept, replaced on a re-answer, cleaned on load and shown by era', () => {
  const { ctx, hooks } = load(), L = ctx.L, late = L.find(x => x.era === 6), early = L.find(x => x.era === 1);
  const n = { name: 'Testland' };
  const notes = ctx.geo(n, late.o[1], { id: late.id }, 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(n.hx)), [[late.id, 1, 1000]]);
  assert.equal(notes[0][0], 'History');
  ctx.geo(n, early.o[2], { id: early.id }, 2000);ctx.geo(n, late.o[0], { id: late.id }, 3000);
  assert.deepEqual(J(n.hx).map(q => q[0] + ':' + q[1]), [early.id + ':2', late.id + ':0']);
  assert.deepEqual(J(ctx.list(n).map(r => r.is.id)), [early.id, late.id], 'oldest era first');
  ctx.geo({ name: 'Npc', npc: true }, late.o[0], {}, 1);
  const m = {};hooks.forEach(h => h(m, { hx: [...n.hx, ['nope', 0, 1], [late.id, 9, 1], [early.id, 0, 5], 'x'] }));
  assert.deepEqual(J(m.hx).map(q => q[0]), [early.id, late.id], 'unknown edicts, bad options and repeats dropped');
  const html = ctx.card({ me: true, n });
  assert.ok(html.includes('Our history') && html.includes(ctx.list(n)[0].o.hx.replace(/\{N\}/g, 'Testland').slice(0, 20)));
  assert.ok(ctx.card({ me: false, n: { name: 'Elsewhere' } }).includes('has not yet settled'));
});
