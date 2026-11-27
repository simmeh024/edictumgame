// A master spy's gift (27 November 2026): the readiness point a master spy result gives. The game adds it to its own count
// (game/edictum.html spyGiftRule, sendSpy) and the referee credits it from the saved report at the next battle
// (functions/war-rules.js spyGifts). Before, the referee never heard of it: only its one point of slack covered the first
// gift of a war, and later ones were refused at the last attack ("the referee counts no readiness left", Balbosa of
// Cloudspine). Checked here with the game's own section cut from its source, against the referee's half.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spyGifts, spyGave, SPY_GIFT_GAP, SPY_GIFT_AGE, SPY_GIFT_SKEW } from '../functions/war-rules.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const SEC = cut('/* A master spy\'s gift (27 November 2026)', 'function sendSpy(id){');
const MIN = 60000, H = 60 * MIN, NOW = Date.UTC(2026, 10, 27, 18);

/* the section in a context of its own: readiness and its most are the game's, stubbed from the record */
function load() {
  const ctx = { Number, Math, readiness: n => ({ r: n.ready, max: 6 }), maxReady: () => 6 };
  vm.createContext(ctx);
  vm.runInContext(SEC.replace(/^const /gm, 'var ') + ';this.SPY_GIFT_GAP=SPY_GIFT_GAP;this.SPY_GIFT_AGE=SPY_GIFT_AGE;', ctx);
  return ctx;
}
const G = load();
const master = (t, rp) => ({ t, k: 'master', tg: 'npc-vellmark', r: 20, m: 0, ...(rp === undefined ? {} : { rp }) });

test('the game and the referee keep the same gap and age', () => {
  assert.equal(G.SPY_GIFT_GAP, SPY_GIFT_GAP);
  assert.equal(G.SPY_GIFT_AGE, SPY_GIFT_AGE);
  assert.equal(SPY_GIFT_GAP, 30 * MIN);
  for (const r of [master(1), master(1, 1), master(1, 0), master(1, -1), { k: 'theft', t: 1 }, null])
    assert.equal(G.spyGave(r), spyGave(r), JSON.stringify(r));
});

test('the game gives the point below full readiness, never at full, and one per gap', () => {
  assert.equal(G.spyGiftRule({ ready: 3, intel: [] }, NOW), 1);
  assert.equal(G.spyGiftRule({ ready: 6, intel: [] }, NOW), 0, 'already fully ready');
  assert.equal(G.spyGiftRule({ ready: 3, intel: [master(NOW - 20 * MIN, 1)] }, NOW), -1, 'a gift 20 minutes ago');
  assert.equal(G.spyGiftRule({ ready: 3, intel: [master(NOW - 20 * MIN)] }, NOW), -1, 'an older build’s gift counts as given');
  assert.equal(G.spyGiftRule({ ready: 3, intel: [master(NOW - 20 * MIN, 0), master(NOW - 10 * MIN, -1)] }, NOW), 1, 'reports that gave nothing do not count');
  assert.equal(G.spyGiftRule({ ready: 3, intel: [master(NOW - 30 * MIN, 1)] }, NOW), 1, '30 minutes on');
  assert.equal(G.spyGiftRule({ ready: 3, intel: [{ k: 'sabotage', t: NOW - MIN }] }, NOW), 1);
});

test('the referee credits each gift once, the gap apart, and none it never gave', () => {
  const intel = [master(NOW - 10 * MIN, 1), master(NOW - 20 * MIN, -1), master(NOW - 50 * MIN, 1), master(NOW - 55 * MIN, 0), { k: 'theft', t: NOW - 2 * H }];
  assert.deepEqual(spyGifts(intel, 0, NOW), { k: 2, gt: NOW - 10 * MIN });
  assert.deepEqual(spyGifts(intel, NOW - 10 * MIN, NOW), { k: 0, gt: NOW - 10 * MIN }, 'credited before');
  assert.deepEqual(spyGifts(intel, NOW - 50 * MIN, NOW), { k: 1, gt: NOW - 10 * MIN }, 'the later one only');
  assert.deepEqual(spyGifts([master(NOW - 5 * MIN, 1)], NOW - 20 * MIN, NOW), { k: 0, gt: NOW - 20 * MIN }, 'inside the gap after the last');
  assert.deepEqual(spyGifts([master(NOW - 5 * MIN)], 0, NOW), { k: 1, gt: NOW - 5 * MIN }, 'an older build’s report, with no rp');
  assert.deepEqual(spyGifts([master(NOW - SPY_GIFT_AGE - MIN, 1)], 0, NOW), { k: 0, gt: 0 }, 'too old');
  assert.deepEqual(spyGifts([master(NOW + SPY_GIFT_SKEW + MIN, 1)], 0, NOW), { k: 0, gt: 0 }, 'too far ahead of the server');
  assert.deepEqual(spyGifts([master(NOW + 2 * MIN, 1)], 0, NOW), { k: 1, gt: NOW + 2 * MIN }, 'a game clock a little ahead');
  for (const bad of [null, 'x', {}, [null, 7, 'm', { k: 'master', t: 'soon' }]]) assert.deepEqual(spyGifts(bad, 0, NOW), { k: 0, gt: 0 });
});

test('reports made up in a typed record gain one point per gap at most', () => {
  const typed = Array.from({ length: 40 }, (_, i) => master(NOW - i * MIN, 1));
  const { k } = spyGifts(typed, 0, NOW);
  assert.ok(k <= Math.ceil(SPY_GIFT_AGE / SPY_GIFT_GAP), k);
  assert.equal(k, 2, 'forty a minute apart: the oldest and the one 30 minutes later');
});

test('over a war, the referee credits exactly the points the game gave', () => {
  /* masters at random times over six hours, the army sometimes full, a battle (the referee's look) now and then */
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 200; run++) {
    const n = { ready: 3, intel: [] };
    let t = NOW, gave = 0, credited = 0, gt = 0;
    for (let i = 0; i < 12; i++) {
      t += Math.floor(rnd() * 25) * MIN;
      n.ready = rnd() < 0.2 ? 6 : 3;
      const rp = G.spyGiftRule(n, t);
      if (rp === 1) gave++;
      n.intel = [master(t, rp)].concat(n.intel).slice(0, 12);
      if (rnd() < 0.5) { const g = spyGifts(n.intel, gt, t + MIN); credited += g.k; gt = g.gt; }
    }
    const g = spyGifts(n.intel, gt, t + MIN);
    credited += g.k;
    assert.equal(credited, gave, `run ${run}`);
  }
});

test('the game marks each master report, saves it at once, and asks the referee again for a gift it has not seen', () => {
  assert.ok(src.includes("if(kind==='master'){rep.u=now+3*3600000;rep.rp=spyGiftRule(n,now);if(rep.rp===1)addReady(n,now);}"));
  assert.ok(src.includes('if(rep.rp===1)saveSoon();'));
  assert.ok(src.includes('you gain a readiness point (one every 30 minutes at most, and none when your army is already fully ready)'), 'the help’s table says so');
  assert.ok(/res\.why==='ready'&&S\.nation&&spyGiftUnseen\(S\.nation,res\.gt,Date\.now\(\)\)\)\{await flushNow\(\);if\(S\.nation\)res=await ask\(\);\}/.test(src));
  assert.equal(G.spyGiftUnseen({ intel: [master(NOW - 5 * MIN, 1)] }, 0, NOW), true);
  assert.equal(G.spyGiftUnseen({ intel: [master(NOW - 5 * MIN, 1)] }, NOW - 5 * MIN, NOW), false, 'credited');
  assert.equal(G.spyGiftUnseen({ intel: [master(NOW - 5 * MIN, 0), master(NOW - 9 * MIN, -1)] }, 0, NOW), false, 'gave nothing');
  assert.equal(G.spyGiftUnseen({ intel: [master(NOW - 7 * H, 1)] }, 0, NOW), false, 'too old to count');
});
