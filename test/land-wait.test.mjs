// Settling and claiming wait for the other nations' land (game/edictum.html, landWait), but never for good: online,
// after LAND_WAIT_MS they go ahead on what the page has (a feed that stalled kept a new capital waiting in the core suite,
// 13 Nov 2026). Offline on the live site they wait for a reload; a game with no server keeps its own map.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const i = src.indexOf("const LAND_LOCAL='there is no Firebase configuration'"), j = src.indexOf('function landWaitMsg(', i);
assert.ok(i > 0 && j > i, 'LAND_LOCAL … landWait sit together');
function kit({ host = 'edictumgame.com', mode = 'world', heard = 0, E } = {}) {
  let now = 1e12;
  const warned = [];
  const ctx = vm.createContext({ OBS: null, PV: null, S: { mode }, worldHeardAt: heard, location: { hostname: host },
    window: { __edictum: E, EDICTUM_LAND_STRICT: false }, console: { warn: m => warned.push(m) }, Date: { now: () => now }, Number, Math });
  vm.runInContext(src.slice(i, j).replace(/\bconst (LAND_LOCAL|LAND_KICK_MS)/g, 'var $1').replace('let landKick', 'var landKick'), ctx);
  return { ctx, wait: () => ctx.landWait(), later: ms => { now += ms; }, warned };
}

test('online: waits until the region is in, then nothing', () => {
  const k = kit(); assert.equal(k.wait(), 'wait');
  k.ctx.worldHeardAt = 1; assert.equal(k.wait(), '');
});
test('online: never for good — after LAND_WAIT_MS it goes ahead, once warned', () => {
  const k = kit(); assert.equal(k.wait(), 'wait');
  k.later(k.ctx.LAND_WAIT_MS - 1); assert.equal(k.wait(), 'wait');
  k.later(2); assert.equal(k.wait(), ''); assert.equal(k.wait(), '');
  assert.equal(k.warned.length, 1);
  assert.ok(k.ctx.LAND_KICK_MS < k.ctx.LAND_WAIT_MS, 'the region is read again before the wait ends');
});
test('offline on the live site: refused until a reload, however long', () => {
  const k = kit({ mode: 'local', E: { off: true, why: 'start-up took too long' } });
  assert.equal(k.wait(), 'off'); k.later(10 * k.ctx.LAND_WAIT_MS); assert.equal(k.wait(), 'off');
});
test('still starting up (or connecting after the sign-in): waits, but not for good', () => {
  for (const E of [{ state: 'wait', off: false }, { state: 'done', off: false }]) {
    const k = kit({ mode: 'local', E }); assert.equal(k.wait(), 'wait', JSON.stringify(E));
    k.later(k.ctx.LAND_WAIT_MS); assert.equal(k.wait(), '', JSON.stringify(E));
  }
});
test('no server at all, or this computer: its own map, as before', () => {
  assert.equal(kit({ mode: 'local', E: { off: true, why: 'there is no Firebase configuration' } }).wait(), '');
  assert.equal(kit({ mode: 'local', host: '127.0.0.1', E: { off: true, why: 'anonymous sign-in failed' } }).wait(), '');
  assert.equal(kit({ mode: 'local', E: undefined }).wait(), '');
  assert.equal(kit({ mode: 'readonly' }).wait(), '');
});
