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

/* landQueued: the spot queued while the region loaded (13 Nov 2026: a founding-edict place drawn before the region
   was in turned out taken, and the capital never went up in the core suite) */
function queued({ taken = [], sites = [7, 8, 9], k = null, q = 5 } = {}) {
  const i = src.indexOf('function landQueued('), j = src.indexOf('\n}', i) + 2;
  const out = { settled: null, toast: '' };
  const S = { landQ: q, landQk: k, nation: { capital: 'Port Alder', loc: null }, mapMsg: '', mapPick: null };
  const ctx = vm.createContext({ S, landWait: () => '', cellOf: l => (l ? 1 : -1), territory: () => ({}),
    pickProblem: c => (taken.includes(c) ? 'Too close to Eastmere.' : ''), fdSites: () => sites,
    settle: () => { out.settled = S.mapPick; }, toast: m => { out.toast = m; }, render: () => {} });
  vm.runInContext(src.slice(i, j), ctx); ctx.landQueued();
  return { ...out, S };
}
test('a queued spot still free goes up where it was chosen', () => {
  assert.equal(queued({ k: 0 }).settled, 5);
});
test('a founding-edict place found taken: the advisors\' place of the same kind instead', () => {
  const r = queued({ taken: [5], k: 1 });
  assert.equal(r.settled, 8); assert.equal(r.toast, ''); assert.equal(r.S.landQk, null);
});
test('a spot picked by hand, or with no free place of its kind, is only told it is taken', () => {
  const a = queued({ taken: [5] }); assert.equal(a.settled, null); assert.match(a.toast, /could not go up where you chose/);
  const b = queued({ taken: [5, 8], k: 1 }); assert.equal(b.settled, null); assert.match(b.toast, /Too close to Eastmere/);
});
