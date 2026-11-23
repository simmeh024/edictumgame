// Growth balance pass (game/edictum.html, sizeRate/rateOf): a young nation grows up to twice as fast until 15 million,
// growth slows above 100 million, a boosted rate never outgrows what firestore.rules accepts in a save, and Vertical
// Farms unlock at 500 million. A new nation grows 5% faster for its first 3 days. jobs/fx/engine.mjs keeps its own copy
// of the rate, which must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const engine = fs.readFileSync(new URL('../jobs/fx/engine.mjs', import.meta.url), 'utf8');
const lineOf = (src, start) => { const at = src.indexOf(start); assert.ok(at >= 0, start); return src.slice(at, src.indexOf('\n', at)); };
const game = vm.createContext({});
vm.runInContext([lineOf(html, 'const GROW_BOOM='), lineOf(html, 'function sizeRate('), lineOf(html, 'function newRate('), lineOf(html, 'function rateOf('),
  lineOf(html, 'const AC_EPOCH=').replace('AUDIT=new Map()', 'AUDIT=null'), lineOf(html, 'function logistic('),
  'this.sizeRate=sizeRate;this.newRate=newRate;this.rateOf=rateOf;this.logistic=logistic;this.RATE_TOP=RATE_TOP;this.RATE_MAX=RATE_MAX;'].join('\n'), game);
const fx = vm.createContext({});
vm.runInContext([lineOf(engine, 'function sizeRate('), lineOf(engine, 'function newRate('), lineOf(engine, 'function rateOf('), 'this.sizeRate=sizeRate;this.rateOf=rateOf;'].join('\n'), fx);

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const stats = v => ({ health: v, safety: v, happy: v, wealth: v, tax: 30 });

test('a young nation grows up to twice as fast, back to normal by 15 million', () => {
  near(game.sizeRate(5), 2, '5 million');
  near(game.sizeRate(10), 1.5, '10 million');
  near(game.sizeRate(15), 1, '15 million');
  near(game.sizeRate(60), 1, 'mid-sized');
  near(game.sizeRate(100), 1, '100 million');
  near(game.sizeRate(0.5), 2, 'a shrunken nation still booms, no more than double');
});

test('growth slows above 100 million', () => {
  near(game.sizeRate(1000), 1 / 1.8, '1 billion');
  near(game.sizeRate(1e6), 1 / 4.2, '1 trillion');
  assert.ok(Math.abs(game.sizeRate(1778) - 0.5) < 0.001, 'half pace near 1.8 billion');
  let last = Infinity;
  for (let p = 15; p <= 1e6; p *= 1.5) { const f = game.sizeRate(p); assert.ok(f <= last + 1e-12, `never faster when bigger (${p})`); last = f; }
});

test('the rate follows the population at the save', () => {
  const n = p => ({ s: stats(50), gm: 1, pop: p });
  near(game.rateOf(n(5)) / game.rateOf(n(50)), 2, 'young against mid-sized');
  near(game.rateOf(n(1000)) / game.rateOf(n(50)), 1 / 1.8, 'giant against mid-sized');
});

test('a new nation grows 5% faster for its first 3 days, on top of the young-nation boom', () => {
  const now = Date.UTC(2026, 10, 23, 12), DAY = 864e5, n = (founded, p) => ({ s: stats(50), gm: 1, pop: p, founded });
  near(game.rateOf(n(now - DAY, 5), now) / game.rateOf(n(0, 5), now), 1.05, 'a day old, at the full boom');
  near(game.rateOf(n(now - DAY, 5), now) / game.rateOf(n(now - DAY, 50), now), 2, 'the boom is unchanged by the bonus');
  near(game.rateOf(n(now - 2.99 * DAY, 50), now) / game.rateOf(n(0, 50), now), 1.05, 'still there just before 3 days');
  near(game.rateOf(n(now - 3 * DAY, 50), now), game.rateOf(n(0, 50), now), 'gone at 3 days');
  near(game.rateOf(n(now - 30 * DAY, 50), now), game.rateOf(n(0, 50), now), 'an older nation has none');
  near(game.rateOf({ s: Object.assign(stats(100), { tax: 0 }), gm: 1.6, pop: 5, founded: now }, now), game.RATE_TOP, 'the cap still holds');
  assert.equal(game.newRate({ founded: 0 }, now), 1, 'computer nations (founded 0) never get it');
});

test('a boosted rate stays inside what a save may claim, however long the nation goes unsaved', () => {
  const top = game.rateOf({ s: Object.assign(stats(100), { tax: 0 }), gm: 1.6, pop: 5 });
  near(top, game.RATE_TOP, 'the best nation at 5 million is held at the cap');
  assert.ok(game.RATE_TOP < Math.log(1.35), 'under the rules bound of x1.35 a day');
  assert.ok(game.RATE_TOP <= game.RATE_MAX, 'under the audit limit');
  assert.ok(game.rateOf({ s: Object.assign(stats(100), { tax: 0 }), gm: 1.6, pop: 50 }) < game.RATE_TOP, 'unboosted rates never reach the cap');
  // firestore.rules grows(): pop <= previous pop * 1.35^days + 3 * days, with a capacity as large as any nation's
  for (const P0 of [0.5, 5, 8, 12, 14.9]) for (const K of [50, 500, 1e4, 1e7]) for (let d = 0.05; d <= 120; d *= 1.3) {
    const r = game.rateOf({ s: Object.assign(stats(100), { tax: 0 }), gm: 1.6, pop: P0, founded: Date.now() }), P = game.logistic(P0, K, r, d);
    assert.ok(P <= P0 * Math.pow(1.35, d) + 3 * d + 1e-4, `from ${P0}M toward ${K}M after ${d.toFixed(2)} days`);
  }
});

test('Vertical Farms unlock at 500 million, Hegemon', () => {
  assert.match(html, /add\(500,'vfarm'\)/);
  assert.doesNotMatch(html, /add\(1000,'vfarm'\)/);
});

test('the FX job reckons growth the same way as the game', () => {
  for (const p of [0.3, 5, 7.5, 12, 15, 40, 100, 450, 1000, 25000, 1e6]) near(fx.sizeRate(p), game.sizeRate(p), `sizeRate(${p})`);
  const now = Date.UTC(2026, 10, 23, 12);
  for (const [v, gm, p] of [[50, 1, 5], [100, 1.6, 5], [70, 1.2, 300], [30, 0.8, 5000]]) for (const age of [0, 1, 2.99, 3, 40]) {
    const n = { s: stats(v), gm, pop: p, founded: age ? now - age * 864e5 : 0 };
    near(fx.rateOf(n, now), game.rateOf(n, now), `rateOf at ${v}/${gm}/${p}, ${age} days old`);
  }
});
