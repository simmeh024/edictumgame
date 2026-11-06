// The Government page's emergency budget (game/edictum.html, gvShiftPlan): five points by decree from one department to
// another. A department at its cap (the largest may hold at most 0.82 times the rest, about 45%) once took almost
// nothing while the giver lost the full five points, spread over every department, and the decree still cost its
// mandate. Now what moves is what arrives, and a department at its cap is refused, with nothing spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
function line(start) { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf(';\n', at) + 1); }
const budgetList = (() => { const at = html.indexOf('const BUDGET = ['); return html.slice(at, html.indexOf('];', at) + 2); })();
const ctx = vm.createContext({});
vm.runInContext([budgetList, 'const GV_SHIFT=5;', line('const GV_BUD_STAT='), line('const gvBudName='), line('const GV_SHIFT_MIN='),
  fn('normBudget'), fn('gvShiftRoom'), fn('gvShiftPlan'), 'this.plan=gvShiftPlan;this.keys=BUDGET.map(b=>b[0]);'].join('\n'), ctx);
const sum = b => Object.values(b).reduce((a, v) => a + v, 0);
const pct = (b, k) => b[k] / sum(b) * 100;
/* a budget of 100 with health and defence at the shares given, the rest spread evenly */
function budget(health, defence) {
  const others = ctx.keys.filter(k => k !== 'health' && k !== 'defence'), b = { health, defence };
  for (const k of others) b[k] = (100 - health - defence) / others.length;
  return b;
}

test('the report: Healthcare at its cap takes nothing, and Defence keeps its 20%', () => {
  /* health 45.06 is 0.82 times the other 54.94: at its cap */
  const n = { budget: budget(45.06, 20) };
  assert.ok(Math.abs(pct(n.budget, 'defence') - 20) < 0.01);
  const p = ctx.plan(n, 'defence', 'health');
  assert.ok(p && p.cap, 'refused as at its cap: ' + JSON.stringify(p));
  assert.equal(p.b, undefined, 'with no new budget to apply');
});

test('a department with room takes the full five points, and nothing else changes', () => {
  const n = { budget: budget(30, 20) }, p = ctx.plan(n, 'defence', 'health');
  assert.equal(p.pts, 5); assert.ok(!p.part && !p.cap);
  assert.ok(Math.abs(sum(p.b) - 100) < 0.01, 'the total stays');
  assert.ok(Math.abs(pct(p.b, 'defence') - 15) < 0.01 && Math.abs(pct(p.b, 'health') - 35) < 0.01, JSON.stringify([pct(p.b, 'defence'), pct(p.b, 'health')]));
  for (const k of ctx.keys) if (k !== 'health' && k !== 'defence') assert.ok(Math.abs(p.b[k] - n.budget[k]) < 0.01, k + ' is untouched');
});

test('one near its cap takes what it can, and the giver gives only that', () => {
  const n = { budget: budget(43, 20) }, p = ctx.plan(n, 'defence', 'health');
  assert.ok(p.part && p.pts > 0.5 && p.pts < 5, JSON.stringify(p && { pts: p.pts, part: p.part }));
  assert.ok(Math.abs(sum(p.b) - 100) < 0.01, 'the total stays');
  const lost = n.budget.defence - p.b.defence, got = p.b.health - n.budget.health;
  assert.ok(Math.abs(lost - got) < 0.002, 'what Defence loses, Healthcare gains: ' + lost + ' / ' + got);
  assert.ok(Math.abs(p.pts - got) < 0.06);
  assert.ok(p.b.health <= 0.82 * (sum(p.b) - p.b.health) + 0.05, 'and Healthcare stays within its cap');
});

test('the old arithmetic, for the record: the giver lost five points for almost nothing', () => {
  /* what the decree did before: take five, add them, and let normBudget cut the largest back */
  const b = budget(45.06, 20); b.defence -= 5; b.health += 5;
  const norm = vm.runInContext('(b=>{normBudget(b);return b;})', ctx)(b);
  assert.ok(Math.abs(pct(norm, 'defence') - 16.5) < 0.1 && Math.abs(pct(norm, 'health') - 45.1) < 0.1, JSON.stringify([pct(norm, 'defence'), pct(norm, 'health')]));
});
