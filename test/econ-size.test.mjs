// A nation's size in the economy (game/edictum.html, econSize): what its food and goods demand, and its goods output, are
// reckoned from. Every nation with claims was held at the same fixed size (CORE_HEXES), so a large one never ran short
// of food; it is now its population's land budget, as before claims, and never below that fixed size.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const line = start => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf('\n', at)); };
const ctx = vm.createContext({});
vm.runInContext([line('const budgetOf='), line('const CORE_HEXES='), line('function econSize('), 'this.size=econSize;this.budgetOf=budgetOf;'].join('\n'), ctx);

test('a nation with claims is sized by its population', () => {
  assert.equal(ctx.size({ cm: true, pop: 500, budget: 16 }), ctx.budgetOf(500));
  assert.ok(ctx.size({ cm: true, pop: 500, budget: 16 }) > 100, 'a large nation, a large size');
  assert.ok(ctx.size({ cm: true, pop: 2000, budget: 16 }) > ctx.size({ cm: true, pop: 500, budget: 16 }));
});
test('a new nation keeps the size it had', () => {
  assert.equal(ctx.size({ cm: true, pop: 5, budget: 16 }), 16);
  assert.equal(ctx.size({ cm: true, pop: 0.2, budget: 16 }), 16, 'never below the core');
});
test('a computer nation keeps its own size', () => {
  assert.equal(ctx.size({ cm: false, npc: true, pop: 500, budget: 42 }), 42);
});
