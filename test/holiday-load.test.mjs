// Holiday mode on load (game/edictum.html, the n.away normalising hook): a holiday lasts at most a calendar month, counted
// in the loading device's time zone. A device elsewhere, or across a clock change, counts it differently, and the hook
// once dropped any holiday more than a minute past its own count; it now allows three days.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const line = start => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf('\n', at)); };
const hook = (() => { const at = html.indexOf("NORM_HOOKS.push((n,d)=>{const w=d&&d.away;"); assert.ok(at > 0); return html.slice(at, html.indexOf('\n', at)); })();
const ctx = vm.createContext({ NORM_HOOKS: [], DAY: 864e5 });
vm.runInContext([line('function awayMax('), hook, 'this.norm=d=>{const n={};NORM_HOOKS[0](n,d);return n.away?{...n.away}:null;};this.awayMax=awayMax;'].join('\n'), ctx);
const a = Date.UTC(2026, 9, 20, 9, 0), H = 3600e3;
const norm = d => { const r = ctx.norm(d); return r && { a: r.a, b: r.b }; };

test('a holiday set where the month ends an hour later is kept', () => {
  const b = ctx.awayMax(a) + H;
  assert.deepEqual(norm({ away: { a, b } }), { a, b });
});
test('so is one set across a month end counted a day later', () => {
  const b = ctx.awayMax(a) + 26 * H;
  assert.deepEqual(norm({ away: { a, b } }), { a, b });
});
test('a holiday far past a month is still dropped', () => {
  assert.equal(norm({ away: { a, b: ctx.awayMax(a) + 5 * 864e5 } }), null);
  assert.equal(norm({ away: { a, b: a - 1 } }), null);
});
