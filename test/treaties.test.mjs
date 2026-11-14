// Treaties between two nations (functions/treaties.js) and relations between alliances (functions/alliances.js): the
// game keeps a copy of their rules (TY_RULES, and AL_RULES.rel), and works out which treaties bind just as the server
// and the referee do (tyId, tyLive, tyVoid beside trId, trLive, trVoid). These checks keep the copies in step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../functions/treaty-rules.js';
import * as R from '../functions/alliance-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function constOf(name) {
  const at = html.indexOf('const ' + name + '=');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(html.indexOf('{', at), i + 1) + ')')));
}
const fnOf = name => { const m = html.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n')); assert.ok(m, name + ' is found'); return m[0]; };

test('the game and the server share the treaties’ rules', () => {
  const G = constOf('TY_RULES');
  assert.deepEqual(G.kinds, T.TR_KINDS);
  assert.deepEqual(G.max, T.TR_MAX);
  assert.equal(G.notice, T.TR_NOTICE); assert.equal(G.record, T.TR_RECORD); assert.equal(G.reoffer, T.TR_REOFFER);
  assert.deepEqual(G.npcMin, T.TR_NPC_MIN);
  assert.deepEqual(G.breakGw, T.TR_BREAK_GW);
  assert.deepEqual(G.fx, T.TR_FX);
  /* every kind has its words in the game */
  const K = vm.runInNewContext('(' + html.slice(html.indexOf('{', html.indexOf('const TY_K=')), html.indexOf('};', html.indexOf('const TY_K=')) + 1) + ')');
  assert.deepEqual(Object.keys(K), T.TR_KINDS);
  for (const k of T.TR_KINDS) assert.equal(K[k].length, 4, k);
});

test('and the rules of relations between alliances', () => {
  const G = constOf('AL_RULES');
  assert.deepEqual(G.rel, R.AL_REL_MAX);
  assert.equal(G.relNotice, R.AL_REL_NOTICE);
  assert.ok(R.AL_XP.rival > 0 && R.AL_XP.rivalCap > 0 && R.AL_XP.pactBreak > 0);
});

test('a treaty has one id whichever side offered it, binds while signed or under notice, and not a nation founded again', () => {
  assert.equal(T.trId('nap', 'b', 'a'), T.trId('nap', 'a', 'b'));
  assert.notEqual(T.trId('nap', 'a', 'b'), T.trId('trade', 'a', 'b'));
  const now = 1e12;
  assert.equal(T.trLive({ st: 'offered' }, now), false);
  assert.equal(T.trLive({ st: 'active' }, now), true);
  assert.equal(T.trLive({ st: 'ending', end: now + 1 }, now), true);
  assert.equal(T.trLive({ st: 'ending', end: now }, now), false);
  assert.equal(T.trLive({ st: 'broken' }, now), false);
  const t = { f: { a: 5 } };
  assert.equal(T.trVoid(t, { a: { founded: 5 } }), false);
  assert.equal(T.trVoid(t, { a: { founded: 6 } }), true, 'founded again');
  assert.equal(T.trVoid(t, { a: {} }), false, 'a record without a founding time is not judged');
  assert.equal(T.trVoid(t, {}), false, 'a party not at hand is not judged');
});

test('the game works out the same: the same ids, in force, and void', () => {
  const ctx = vm.createContext({ recs: {}, docOf(id) { return this.recs[id] || null; } });
  ctx.docOf = id => ctx.recs[id] || null;
  vm.runInContext(fnOf('tyId') + fnOf('tyLive') + fnOf('tyVoid'), ctx);
  for (const [k, a, b] of [['nap', 'x', 'y'], ['trade', 'npc-vellmark', 'Qz9'], ['research', 'b', 'a']]) assert.equal(ctx.tyId(k, a, b), T.trId(k, a, b));
  const now = 1e12;
  for (const d of [{ st: 'offered' }, { st: 'active' }, { st: 'ending', end: now + 1 }, { st: 'ending', end: now - 1 }, { st: 'broken' }])
    assert.equal(ctx.tyLive(d, now), T.trLive(d, now), JSON.stringify(d));
  ctx.recs = { a: { founded: 5 }, b: { founded: 9 } };
  for (const f of [{ a: 5 }, { a: 6 }, { a: 5, b: 9 }, { a: 5, b: 8 }, {}]) assert.equal(ctx.tyVoid({ f }), T.trVoid({ f }, ctx.recs), JSON.stringify(f));
});

test('a pact bars war, the referee refuses its battles, and computer nations under one never attack', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(src, /trLive\(nap\.data\(\), now\) && !trVoid\(nap\.data\(\)/);
  assert.match(src, /alRelLive\(rel\[aD\], now\)\) return \{ ok: false, why: 'pact' \}/);
  assert.match(html, /\{const tb=tyWarBlock\(id\);if\(tb\)\{toast\(tb\);return;\}\}/);
  assert.match(html, /sameAlliance\(myId\(\),id\)\|\|tyOf\(myId\(\),id,'nap'\)\)continue;/);
  /* the roll waits for the region's treaties, rather than miss a pact */
  assert.match(html, /if\(S\.mode==='world'&&!TY\.ready\)return out;/);
  /* a trade agreement's deals flow more and pay no tariffs; a research pact adds prosperity */
  assert.match(html, /\*\(ta\?1\+TY_RULES\.fx\.flow:1\)/);
  assert.match(html, /if\(\(am&&fx\.tariffFree\)\|\|ta\)/);
  assert.match(html, /e\.prosper\*=1\+TY_RULES\.fx\.research\*Math\.min\(k,TY_RULES\.fx\.researchMax\)/);
});
