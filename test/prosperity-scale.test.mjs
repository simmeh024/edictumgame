// How far an edict moves a census figure (game/edictum.html, applyEffects): v times the room left in that direction
// (room/45). A rise is scaled by up to 1.3 when the figure has a long way to go; a fall is never scaled past 1, so a
// high figure no longer loses more than the edict says (Ertastan, 13 Nov 2026: near the top a 2-point rise moved 0.2
// and a 2-point fall moved 2.6, so edicts did nothing or did harm). Prosperity (wealth) is gentler still at the top,
// since output follows its square (income): its rises keep at least 0.4.
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
const FIGURES = ['civil', 'econ', 'pol', 'wealth', 'equal', 'health', 'edu', 'safety', 'crime', 'env', 'relig', 'cons', 'happy', 'mil', 'corrupt', 'tax', 'culture', 'tour', 'sci', 'weird'];

test('a Prosperity cut near the top is not scaled up', () => {
  near(after('wealth', 90, -2), 88, 'cut at 90');
  near(after('wealth', 60, -3), 57, 'cut at 60');
  near(after('wealth', 100, -2), 98, 'cut at 100');
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
test('no figure falls further than the edict says', () => {
  for (const k of FIGURES) for (const cur of [46, 60, 80, 95, 100]) for (const v of [-1, -2, -3, -5]) {
    const moved = after(k, cur, v) - cur;
    assert.ok(moved >= v - 1e-9, `${k} at ${cur}, ${v}: moved ${moved}`);
  }
  near(after('econ', 90, -2), 88, 'econ cut at 90 (was 87.4)');
  near(after('sci', 96, -3), 93, 'science cut at 96 (was 92.1)');
  near(after('corrupt', 80, -4), 76, 'corruption cut at 80 (was 74.8)');
});
test('a fall still eases off near the bottom', () => {
  near(after('happy', 20, -3), 20 - 3 * 20 / 45, 'happy cut at 20');
  near(after('econ', 45, -2), 43, 'econ cut at 45 is exactly its size');
  near(after('crime', 9, -2), 9 - 2 * 9 / 45, 'crime cut at 9');
});
test('rises move as before', () => {
  near(after('econ', 90, 2), 90 + 2 * 10 / 45, 'econ rise at 90');
  near(after('happy', 20, 2), 22.6, 'happy rise at 20 (1.3)');
  near(after('tax', 50, 2), 50 + 2 * 0.6 * 50 / 45, 'tax rises are 0.6');
  near(after('weird', 10, 2), 10 + 2 * 0.6 * 1.3, 'weirdness rises are 0.6, up to 1.3');
});
test('at Prosperity 90 output falls less and rises more than it did', () => {
  const cut = outPct(90, -2), rise = outPct(90, 2);
  assert.ok(cut > -4 && cut < -3.5, `a 2-point cut costs ${cut.toFixed(2)}% (was 5.0%)`);
  assert.ok(rise > 1.5 && rise < 1.7, `a 2-point rise gains ${rise.toFixed(2)}% (was 0.9%)`);
});
