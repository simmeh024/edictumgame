// Joint ventures between two neighbours (functions/ventures.js): the game keeps a copy of their rules (JV_RULES), and works
// out which ventures are in force just as the server does (jvLive, jvWaiting, jvVoid beside the server's). These checks
// keep the copies in step, and hold the costs to the owner's numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as J from '../functions/venture-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function constOf(name) {
  const at = html.indexOf('const ' + name + '=');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(html.indexOf('{', at), i + 1) + ')')));
}
const fnOf = name => { const m = html.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n')); assert.ok(m, name + ' is found'); return m[0]; };

test('the game and the server share the joint ventures’ rules', () => {
  const G = constOf('JV_RULES');
  assert.deepEqual(G.kinds, J.JV_KINDS);
  assert.deepEqual(G.cost, J.JV_COST);
  assert.deepEqual(G.hours, J.JV_HOURS);
  assert.equal(G.max, J.JV_MAX);
  assert.equal(G.answer, J.JV_ANSWER); assert.equal(G.notice, J.JV_NOTICE); assert.equal(G.keep, J.JV_KEEP); assert.equal(G.old, J.JV_OLD);
  assert.equal(G.npcMin, J.JV_NPC_MIN); assert.equal(G.leaveGw, J.JV_LEAVE_GW); assert.equal(G.path, J.JV_PATH);
  assert.deepEqual(G.fx, J.JV_FX);
  const K = vm.runInNewContext('(' + html.slice(html.indexOf('{', html.indexOf('const JV_K=')), html.indexOf('};', html.indexOf('const JV_K=')) + 1) + ')');
  assert.deepEqual(Object.keys(K), J.JV_KINDS);
  /* the ids the game makes are the ids the server takes */
  assert.match(html, /const JV_ID=\/\^\[a-z0-9\]\{6,16\}\$\/,JV_DOC=\/\^\[\\w-\]\{1,128\}_\[a-z0-9\]\{6,16\}\$\//);
  assert.equal(String(J.JV_ID), '/^[a-z0-9]{6,16}$/'); assert.equal(String(J.JV_DOC), '/^[\\w-]{1,128}_[a-z0-9]{6,16}$/');
});

test('each side pays the owner’s numbers, and a nation takes part in five at most', () => {
  assert.deepEqual(J.JV_COST, { road: { iron: 120, goods: 20, food: 250 }, rail: { goods: 50, iron: 80, timber: 400 }, bridge: { timber: 120, iron: 60 } });
  assert.equal(J.JV_MAX, 5);
});

test('a venture is in force once accepted and under notice; an offer waits until it lapses; a nation founded again is not bound', () => {
  const now = 1e12;
  assert.equal(J.jvLive({ st: 'offered', x: now + 1 }, now), false);
  assert.equal(J.jvLive({ st: 'active' }, now), true);
  assert.equal(J.jvLive({ st: 'ending', end: now + 1 }, now), true);
  assert.equal(J.jvLive({ st: 'ending', end: now }, now), false);
  assert.equal(J.jvLive({ st: 'declined' }, now), false);
  assert.equal(J.jvWaiting({ st: 'offered', x: now + 1 }, now), true);
  assert.equal(J.jvWaiting({ st: 'offered', x: now }, now), false);
  assert.equal(J.jvHolds({ st: 'offered', x: now + 1 }, now), true);
  assert.equal(J.jvHolds({ st: 'declined' }, now), false);
  const t = { f: { a: 5 } };
  assert.equal(J.jvVoid(t, { a: { founded: 5 } }), false);
  assert.equal(J.jvVoid(t, { a: { founded: 6 } }), true);
  assert.equal(J.jvVoid(t, { a: {} }), false);
});

test('a route is read as written: a bridge is two hexes, a road or railway two to seventeen, each hex once, end to end', () => {
  assert.deepEqual(J.jvRoute('bridge', 4, 5, [4, 5]), [4, 5]);
  assert.equal(J.jvRoute('bridge', 4, 5, [4, 6, 5]), null);
  assert.deepEqual(J.jvRoute('road', 1, 3, [1, 2, 3]), [1, 2, 3]);
  assert.equal(J.jvRoute('road', 1, 3, [1, 2, 2, 3]), null, 'a hex twice');
  assert.equal(J.jvRoute('road', 1, 3, [2, 3]), null, 'not from its start');
  assert.equal(J.jvRoute('road', 1, 3, [1, 2]), null, 'not to its end');
  assert.equal(J.jvRoute('rail', 0, 17, Array.from({ length: 18 }, (_, i) => i)), null, 'too long');
  assert.deepEqual(J.jvRoute('rail', 0, 16, Array.from({ length: 17 }, (_, i) => i)).length, 17);
  assert.equal(J.jvRoute('canal', 1, 2, [1, 2]), null);
  assert.equal(J.jvRoute('road', 1, 1.5, [1, 1.5]), null);
});

test('the game works out the same: in force, waiting, and void', () => {
  const ctx = vm.createContext({ recs: {} });
  ctx.docOf = id => ctx.recs[id] || null;
  vm.runInContext(fnOf('jvLive') + fnOf('jvWaiting') + fnOf('jvVoid'), ctx);
  const now = 1e12;
  for (const V of [{ st: 'active' }, { st: 'ending', end: now + 1 }, { st: 'ending', end: now }, { st: 'offered', x: now + 1 }, { st: 'offered', x: now - 1 }, { st: 'declined' }]) {
    assert.equal(ctx.jvLive(V, now), J.jvLive(V, now), JSON.stringify(V));
    assert.equal(ctx.jvWaiting(V, now), J.jvWaiting(V, now), JSON.stringify(V));
  }
  ctx.recs = { a: { founded: 6 } };
  assert.equal(ctx.jvVoid({ f: { a: 5 } }), true);
  ctx.recs = { a: { founded: 5 } };
  assert.equal(ctx.jvVoid({ f: { a: 5 } }), false);
});

test('the Diplomacy page has a Ventures tab with its own pane, shown by the tab rule', () => {
  assert.match(html, /\['treaties','Treaties'\],\['ventures','Ventures'\]/);
  assert.match(html, /\.dp\[data-tab="ventures"\]>#dp-p-ventures/);
  assert.match(html, /pane\('ventures',safe\(\(\)=>jvTab\(now\)\)\)/);
  /* the trade between two nations flows more with a road or railway between them */
  assert.match(html, /\*jvFlow\(d\.a,d\.b,T\),qa=/);
  /* the venture's payments live in the shared half, where the server reads them */
  const shim = fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shim, /'jvp'/);
});

test('the server keeps them: civic answers the four requests, deletes them with an account, and Firestore lets every nation read them', () => {
  const civic = fs.readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
  assert.match(civic, /isVentureOp\(d\.op\)\) return venture\(db, who, d\)/);
  for (const f of ['accounts.js', 'admin.js']) assert.match(fs.readFileSync(new URL('../functions/' + f, import.meta.url), 'utf8'), /await jvDrop\(db, /, f);
  assert.match(fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), /match \/ventures\/\{vid\} \{ allow read: if true; \}/);
  const idx = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  assert.ok(idx.fieldOverrides.some(o => o.collectionGroup === 'ventures' && o.fieldPath === 'exp' && o.ttl === true), 'a TTL on ventures.exp');
});
