// How far an edict moves a census figure (game/edictum.html, applyEffects): v times the room left in that direction
// (room/45, at most 1.3). Prosperity (wealth) is gentler at the top, since output follows its square (income): a rich
// nation lost about 5% of its output to a 2-point cut and gained under 1% from a 2-point rise. Its cuts are never
// scaled past 1 and its rises keep at least 0.4; every other figure moves as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const functions = new Map();
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration') functions.set(node.id.name, code.slice(node.start, node.end));
  for (const [k, v] of Object.entries(node)) if (k !== 'start' && k !== 'end') { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
})(parse(code, {ecmaVersion: 'latest'}));
const ctx = vm.createContext({clamp: (v, a, b) => Math.min(b, Math.max(a, v))});
vm.runInContext(functions.get('applyEffects') + '\n' + functions.get('income') + '\nthis.apply=applyEffects;this.income=income;', ctx);

const after = (k, cur, v) => { const n = {s: {[k]: cur}, policies: {}, budget: {}}; ctx.apply(n, {[k]: v}); return n.s[k]; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const outPct = (cur, v) => (ctx.income({wealth: after('wealth', cur, v)}) / ctx.income({wealth: cur}) - 1) * 100;

test('a Prosperity cut near the top is not scaled up', () => {
  near(after('wealth', 90, -2), 88, 'cut at 90');
  near(after('wealth', 60, -3), 57, 'cut at 60');
});
test('a Prosperity rise near the top keeps at least 0.4 of its size', () => {
  near(after('wealth', 90, 2), 90.8, 'rise at 90');
  near(after('wealth', 99, 5), 100, 'rise at 99 stops at 100');
});
test('Prosperity lower down moves as before', () => {
  near(after('wealth', 30, -2), 30 - 2 * 30 / 45, 'cut at 30');
  near(after('wealth', 30, 2), 32.6, 'rise at 30');
  near(after('wealth', 70, 2), 70 + 2 * 30 / 45, 'rise at 70');
});
test('every other figure moves as before', () => {
  near(after('econ', 90, -2), 87.4, 'econ cut at 90');
  near(after('econ', 90, 2), 90 + 2 * 10 / 45, 'econ rise at 90');
  near(after('happy', 20, -3), 20 - 3 * 20 / 45, 'happy cut at 20');
  near(after('tax', 50, 2), 50 + 2 * 0.6 * 50 / 45, 'tax rises are 0.6');
});
test('at Prosperity 90 output falls less and rises more than it did', () => {
  const cut = outPct(90, -2), rise = outPct(90, 2);
  assert.ok(cut > -4 && cut < -3.5, `a 2-point cut costs ${cut.toFixed(2)}% (was 5.0%)`);
  assert.ok(rise > 1.5 && rise < 1.7, `a 2-point rise gains ${rise.toFixed(2)}% (was 0.9%)`);
});
