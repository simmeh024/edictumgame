// Belt research (game/edictum.html, btResStart and the save hook that records finished research): research that had
// finished but was not yet recorded by a save was dropped when another research started, and so was lost.
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
/* the save hook's research step: one line, run here on each commit */
const hookLine = html.split('\n').find(l => l.startsWith('  const done=(b.rq||[]).filter(q=>q[2]<=now);'));
assert.ok(hookLine, 'the save hook’s research step is found');
const helpers = ['const btHas=', 'const btSet='].map(h => html.split('\n').find(l => l.startsWith(h)));

function belt(nation) {
  const ctx = vm.createContext({ S: { nation }, RES: ['food', 'timber', 'iron', 'oil', 'goods'], DAY: 864e5, Date,
    BT_RS: [{ n: 'Propulsion', d: '', rp: 10, h: 6, cost: {} }, { n: 'Deep survey', d: '', rp: 10, h: 6, cost: {} }, { n: 'Station engines', d: '', rp: 10, h: 6, cost: {} }],
    clone: v => JSON.parse(JSON.stringify(v)), stockNow: n => ({ ...n.stock }), roundStock: s => ({ ...s }), btRP: () => 100,
    btResProblem: () => '', btRefresh: () => {}, toast: () => {}, fmtWait: () => '6 h', render: () => {} });
  vm.runInContext(`${helpers.join('\n')}
    function commit(n){const now=Date.now(),out=[],b=n.belt;${hookLine}S.nation=n;}
    ${fn('btResStart')}
    this.start=btResStart;`, ctx);
  return ctx;
}

test('starting research keeps one that finished meanwhile, and the save records it', () => {
  const now = Date.now();
  /* Propulsion finished an hour ago; no save has recorded it yet */
  const n = { stock: {}, belt: { v: now - 9 * 864e5, rd: 0, rq: [[0, now - 7 * 3600e3, now - 3600e3]], rp: 50, ra: now - 3600e3 } };
  const B = belt(n);
  assert.equal(B.start(1), true);
  const b = B.S.nation.belt;
  assert.equal(b.rd & 1, 1, 'Propulsion is recorded as researched');
  assert.deepEqual(b.rq.map(q => q[0]), [1], 'and only the new research is under way');
});

test('research still under way stays under way', () => {
  const now = Date.now();
  const n = { stock: {}, belt: { v: now - 9 * 864e5, rd: 0, rq: [[0, now - 3600e3, now + 5 * 3600e3]], rp: 50, ra: now - 3600e3 } };
  const B = belt(n);
  B.start(1);
  const b = B.S.nation.belt;
  assert.equal(b.rd, 0);
  assert.deepEqual(b.rq.map(q => q[0]), [0, 1]);
});
