// An ally that left and asked to join again (game/edictum.html, inviteAllyBase): membership counts only an invitation
// made after the nation last left (politics: e.t > alLeft), and approving it once kept the old invitation, so the nation
// stayed pending for good while the founder was told it had joined.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
/* the membership rule, as politics() has it */
assert.match(html, /if\(A\.inv\.some\(e=>e\.id===id&&e\.t>\(d\.alLeft\|\|0\)\)\)A\.members\.push\(id\)/, 'the membership rule is the one tested here');
const member = (inv, id, d) => inv.some(e => e.id === id && e.t > (d.alLeft || 0));

function founder(nation, others) {
  const ctx = vm.createContext({ S: { nation }, DAY: 864e5, ALLY_MIN: 40, Date,
    civicRegistered: () => true, findNation: id => others[id] ? { id, npc: !!others[id].npc, n: others[id] } : null,
    pairWar: () => ({}), warWith: () => ({ war: false }), affinity: () => 90, myId: () => 'founder',
    clone: v => JSON.parse(JSON.stringify(v)), render: () => {}, toast: () => {}, fmtDate: () => '', fmtWait: () => '' });
  vm.runInContext(`function commit(n){S.nation=n;}\n${fn('inviteAllyBase')}\nthis.invite=inviteAllyBase;`, ctx);
  return ctx;
}
const H = 3600e3;

test('approving an ally that left and asked again lets it in', () => {
  const now = Date.now();
  /* b joined a week ago, left yesterday, and has asked again (allyOf set, no new invitation yet) */
  const b = { name: 'Bramble', allyOf: 'founder', alLeft: now - 24 * H, alJoin: now - 7 * 24 * H };
  const nation = { name: 'Founderland', alli: { name: 'The Pact', t: now - 30 * 24 * H, inv: [{ id: 'b', t: now - 8 * 24 * H }] }, log: [] };
  const F = founder(nation, { b });
  assert.equal(member(nation.alli.inv, 'b', b), false, 'pending before the approval');
  F.invite('b');
  const inv = F.S.nation.alli.inv;
  assert.equal(member(inv, 'b', b), true, 'a member once approved');
  assert.equal(inv.filter(e => e.id === 'b').length, 1, 'with one invitation');
  assert.match(F.S.alMsg, /has joined/);
});

test('a current member’s invitation, and a computer nation’s, keep their time', () => {
  const now = Date.now(), t0 = now - 5 * 24 * H;
  const c = { name: 'Cobble', allyOf: 'founder' }, npc = { name: 'Vellmark', npc: true };
  const nation = { name: 'Founderland', alli: { name: 'The Pact', t: now - 30 * 24 * H, inv: [{ id: 'c', t: t0 }, { id: 'npc-x', t: t0 }] }, log: [] };
  const F = founder(nation, { c, 'npc-x': npc });
  F.invite('c'); F.invite('npc-x');
  const inv = F.S.nation.alli.inv;
  assert.equal(inv.find(e => e.id === 'c').t, t0);
  assert.equal(inv.find(e => e.id === 'npc-x').t, t0, 'a computer nation keeps its place in the order of claims');
});
