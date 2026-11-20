// The Core game's founding-edict click, over and over (a hunt for the CI flake where "Assent to motion I" cannot be
// hit: <main> intercepts pointer events). Each run founds a kingdom, opens its first edict and answers it.
// RUNS=n THROTTLE=rate MODE=rand node test/founding-click-repro.mjs  (inside emulators:exec)
import { player, open, nav, until, sleep, browser } from './lib.mjs';
import { traceInit, hitDiag } from './hit-diag.mjs';

const RUNS = +process.env.RUNS || 10, THROTTLE = +process.env.THROTTLE || 1;
let fails = 0;
for (let i = 0; i < RUNS; i++) {
  const KG = await player('KG' + i);
  await KG.ctx.addInitScript(traceInit);
  if (THROTTLE > 1) { const c = await KG.ctx.newCDPSession(KG); await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  await open(KG);
  await KG.waitForSelector('#d-name');
  await KG.fill('#d-name', 'Kingsmoor ' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26) % 26) + Math.floor(Math.random() * 900 + 100));
  await KG.selectOption('#d-pretitle', 'Kingdom'); await KG.click('#found-btn'); await KG.waitForSelector('.layout', { timeout: 10000 });
  if (process.env.MODE === 'rand') await sleep(Math.round(Math.random() * 3000));
  await nav(KG, 'nation');
  await nav(KG, 'issues');
  await until(() => KG.$('.issue-card')); await KG.click('.issue-card'); await KG.waitForSelector('.edict .opt');
  const t0 = Date.now();
  try { await KG.click('.edict [data-act="answer"]', { timeout: 10000 }); await KG.waitForSelector('.result', { timeout: 8000 }); console.log(`run ${i}: ok in ${Date.now() - t0} ms`); }
  catch (e) {
    fails++;
    console.log(`run ${i}: FAILED after ${Date.now() - t0} ms`, String(e.message).split('\n').filter(l => /intercepts|stable|detached|handler/.test(l)).slice(0, 8).join(' | '));
    console.log(JSON.stringify(await hitDiag(KG, '.edict [data-act="answer"]').catch(err => String(err)), null, 1));
    await KG.screenshot({ path: `test/out/repro-${i}.png` }).catch(() => {});
  }
  await KG.ctx.close();
}
console.log(`${fails} of ${RUNS} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
