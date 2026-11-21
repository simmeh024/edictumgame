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

/* ── the tax decree ── */
// The Government page's tax decree (game/edictum.html, gvTaxPlan and gvTax): income tax cut or raised by three points,
// once a week, for mandate. Spending is output times the rate and every department keeps its share, so each one's money
// moves by the same part; a department with no share stays at nothing. A decree keeps the rate between 5% and 75%, and
// works from the rate as it stands now, with the drift toward 35% since the last save.
const DAY = 864e5;
const tctx = vm.createContext({});
vm.runInContext(['const DAY=' + DAY + ';', 'const fmt1=v=>(Math.round(v*10)/10).toFixed(1);', line('const pctS='),
  line('const DRIFT_TO='), line('const GV_SHIFT_MIN='), line('const GV_TAX='), line('const gvTaxPart='),
  fn('driftTick'), fn('gvTaxNow'), fn('gvTaxWait'), fn('gvTaxPlan'),
  'this.api={plan:gvTaxPlan,now:gvTaxNow,wait:gvTaxWait,part:gvTaxPart,drift:driftTick,GV_TAX,GV_TAX_LO,GV_TAX_HI,GV_TAX_GAP};'].join('\n'), tctx);
const { plan, wait, part, drift, GV_TAX, GV_TAX_LO, GV_TAX_HI, GV_TAX_GAP } = tctx.api;
const NOW = Date.UTC(2026, 10, 20, 12);
const nation = (tax, extra) => Object.assign({ s: { tax, weird: 30, corrupt: 35 }, drAt: NOW }, extra || {});

test('three points, a week apart, between 5% and 75%', () => {
  assert.equal(GV_TAX, 3); assert.equal(GV_TAX_LO, 5); assert.equal(GV_TAX_HI, 75); assert.equal(GV_TAX_GAP, 7 * DAY);
  assert.match(line('const MD_CAP='), /tax:3/, 'it costs 3 mandate, as a budget shift does');
  assert.match(line('const MD_WHAT='), /tax:\['Cut or raise income tax','budget'\]/, 'and the mandate card lists it, on the Budget tab');
});

test('a cut takes three points, and every department loses the same part', () => {
  const p = plan(nation(45), -1, NOW);
  assert.ok(!p.stop && !p.part);
  assert.equal(p.t0, 45); assert.equal(p.t1, 42); assert.equal(p.d, 3);
  assert.ok(Math.abs(p.f - 42 / 45) < 1e-9, 'each department keeps its share, so its money moves with the rate');
  assert.equal(part(p), '−6.7%');
  assert.deepEqual({ ...p.e }, { econ: 1, equal: -1 });
  /* a department with no share has no money before and none after, whatever the rate */
  const shares = { aid: 0, health: 30, defence: 70 }, spend = r => Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, 1e9 * r / 100 * v / 100]));
  const a = spend(p.t0), b = spend(p.t1);
  assert.equal(a.aid, 0); assert.equal(b.aid, 0);
  for (const k of ['health', 'defence']) assert.ok(Math.abs(b[k] / a[k] - p.f) < 1e-9, k);
});

test('a rise takes three points the other way, and is unpopular', () => {
  const p = plan(nation(30), 1, NOW);
  assert.equal(p.t1, 33); assert.equal(part(p), '+10.0%');
  assert.deepEqual({ ...p.e }, { equal: 1, econ: -1, happy: -1 });
});

test('near the floor a cut takes only what is left, and at it the decree is refused', () => {
  const near = plan(nation(6.5), -1, NOW);
  assert.ok(near.part && Math.abs(near.t1 - 5) < 1e-9 && near.d === 1.5, JSON.stringify(near));
  assert.ok(plan(nation(5.2), -1, NOW).stop, 'less than half a point of room: nothing to cut');
  assert.ok(plan(nation(2), -1, NOW).stop, 'an edict took it below the floor: a decree cannot cut further');
  assert.ok(!plan(nation(2), 1, NOW).stop, 'but it can still raise it');
});

test('near the ceiling a rise takes only what is left, and above it the decree is refused', () => {
  const near = plan(nation(73), 1, NOW);
  assert.ok(near.part && Math.abs(near.t1 - 75) < 1e-9, JSON.stringify(near));
  assert.ok(plan(nation(80), 1, NOW).stop);
  assert.equal(plan(nation(80), -1, NOW).t1, 77, 'a cut from above the ceiling is fine');
});

test('the plan starts from the rate as it stands now, drift included', () => {
  const n = nation(60, { drAt: NOW - 10 * DAY }), p = plan(n, -1, NOW);
  const m = JSON.parse(JSON.stringify(n)); drift(m, NOW);
  assert.ok(p.t0 < 60 && Math.abs(p.t0 - m.s.tax) < 1e-9, 'what the preview shows is what the decree starts from: ' + p.t0 + ' / ' + m.s.tax);
  assert.ok(Math.abs(p.t1 - (m.s.tax - 3)) < 1e-3, 'three points below it (to a thousandth of a point)');
});

test('one decree a week, either way', () => {
  assert.equal(wait(nation(40), NOW), 0, 'never decreed: now');
  assert.equal(wait(nation(40, { txd: [NOW - 2 * DAY, -1] }), NOW), 5 * DAY);
  assert.equal(wait(nation(40, { txd: [NOW - 8 * DAY, 1] }), NOW), 0);
});

test('the decree settles the drift before it sets the rate, and is saved privately', () => {
  const g = fn('gvTax');
  assert.ok(g.indexOf('driftTick(n,now)') >= 0 && g.indexOf('driftTick(n,now)') < g.indexOf('n.s.tax=plan.t1'), 'commit would otherwise drift the new rate over time that had passed');
  assert.match(g, /mdSpend\(n,'tax',now\)/); assert.match(g, /n\.txd=\[now,dir\]/); assert.match(g, /k:'tax'/);
  assert.match(fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8'), /'ldr', 'txd'/, 'txd is in the private half');
  assert.match(html, /d\.txd\[1\]===1\|\|d\.txd\[1\]===-1/, 'and read back on load');
});
