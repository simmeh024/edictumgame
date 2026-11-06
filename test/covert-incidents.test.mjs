// Covert operations against a nation land on its record once (game/edictum.html, cvPending/cvApply/cvInTrim): n.cvIn
// remembers the ones applied. Only the last 60 were kept, so a nation hit more than 60 times in three days had the older
// incidents applied again, at every commit. These run the game's own code with 150 incidents.
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
/* the normalising hook that reads n.cvIn back from a saved record */
function normHook() {
  const at = html.indexOf('NORM_HOOKS.push((n,d)=>{', html.indexOf('/* saved fields: n.cov (own operations)'));
  assert.ok(at > 0, 'the covert normalising hook is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at, i + 1) + ');';
}
const consts = html.match(/const CV_GAP=[^\n]*;/)[0] + '\n' + (html.match(/const CV_IN_MIN=[^\n]*;/) || [''])[0];

function covert(all) {
  const ctx = vm.createContext({ DAY: 864e5, all, NORM_HOOKS: [], REG: { id: 'meridian' }, S: { mode: 'world' } });
  vm.runInContext(`${consts}
    const myId=()=>'me',cvIndex=()=>({all});
    ${['cvAgainst', 'cvPending', 'cvApply'].map(fn).join('\n')}
    ${html.includes('\nfunction cvInTrim(') ? fn('cvInTrim') : ''}
    ${normHook()}
    this.apply=cvApply;this.pending=cvPending;this.norm=NORM_HOOKS[0];`, ctx);
  return ctx;
}
/* counterfeits more than a day old: applied silently, so the test needs nothing else of the game */
const ops = (k, from = 0) => Array.from({ length: k }, (_, i) => ({ by: 'p' + (from + i), ok: true, key: 'k' + (from + i),
  op: { k: 'c', tg: 'me', t: Date.now() - 26 * 3600e3 - (from + i) * 60e3, id: 'o' + (from + i), rg: 'meridian' } }));

test('150 incidents in three days are each applied once', () => {
  const C = covert(ops(150)), n = { name: 'Target', reg: 'meridian', founded: 0 }, now = Date.now();
  C.apply(n, null, now);
  assert.equal(n.cvIn.length, 150);
  assert.equal(C.pending(n, now).length, 0, 'nothing is left to apply again');
  C.apply(n, null, now + 5000);
  assert.equal(C.pending(n, now + 5000).length, 0, 'and a later commit applies nothing again');
});

test('keys of operations past their time go, beyond the last 60', () => {
  const C = covert(ops(70)), n = { name: 'Target', reg: 'meridian', founded: 0, cvIn: Array.from({ length: 100 }, (_, i) => 'gone' + i) }, now = Date.now();
  C.apply(n, null, now);
  assert.equal(n.cvIn.filter(k => k.startsWith('gone')).length, 0, 'old keys are not kept past the last 60');
  assert.equal(n.cvIn.filter(k => k.startsWith('k')).length, 70);
});

test('a saved record keeps them all when it is read back', () => {
  const C = covert([]), n = {};
  C.norm(n, { cvIn: Array.from({ length: 150 }, (_, i) => 'k' + i) });
  assert.equal(n.cvIn.length, 150);
});
