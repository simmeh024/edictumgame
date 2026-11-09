// Claim reach (game/edictum.html): claims count within CAP_REACH of the capital, or within a city's reach
// (10 hexes + 1 per building, at most 20, raised by half). Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const i = src.indexOf('const CAP_REACH='), j = src.indexOf('function claimOk(', i);
const ctx = vm.createContext({ TERR_AT: null, hexDist: (a, b) => Math.abs(a - b) });
vm.runInContext(src.slice(i, j).replace('const CAP_REACH', 'var CAP_REACH').replace(',cityReach=', ';var cityReach='), ctx);

test('the capital reaches half again as far as the old 45 hexes', () => {
  assert.equal(ctx.CAP_REACH, 68);
  const x = { cap: 0, n: { cities: [] } };
  assert.ok(ctx.inReach(x, 68)); assert.ok(!ctx.inReach(x, 69));
});

test('each city lends 15 hexes, more with buildings, up to 30', () => {
  assert.equal(ctx.cityReach({ b: [] }), 15);
  assert.equal(ctx.cityReach({ b: Array(4).fill({}) }), 21);
  assert.equal(ctx.cityReach({ b: Array(25).fill({}) }), 30);
  const x = { cap: 0, n: { cities: [{ c: 60, b: [] }] } };
  assert.ok(ctx.inReach(x, 75)); assert.ok(!ctx.inReach(x, 76));
});

test('a city founded after the shown moment lends no reach', () => {
  const x = { cap: 0, n: { cities: [{ c: 60, t: 500, b: [] }] } };
  ctx.TERR_AT = 100; assert.ok(!ctx.inReach(x, 75));
  ctx.TERR_AT = 1000; assert.ok(ctx.inReach(x, 75)); ctx.TERR_AT = null;
});
