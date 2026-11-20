// The Core game's founding-edict click, over and over (a hunt for the CI flake where "Assent to motion I" cannot be
// hit: <main> intercepts pointer events). Each run founds a kingdom, opens its first edict and answers it.
// RUNS=n THROTTLE=rate MODE=rand|wait FIX=0 node test/founding-click-repro.mjs  (inside emulators:exec)
// MODE=wait waits for the guest recovery dialog before opening the edict, so Playwright's handler (lib.mjs) closes it
// just before the edict card is clicked, the order the flake needs; FIX=0 turns off the game's modalEra.
import { player, open, nav, until, sleep, browser } from './lib.mjs';
import { traceInit, hitDiag } from './hit-diag.mjs';

const RUNS = +process.env.RUNS || 10, THROTTLE = +process.env.THROTTLE || 1;
let fails = 0;
for (let i = 0; i < RUNS; i++) {
  const KG = await player('KG' + i);
  await KG.ctx.addInitScript(traceInit);
  if (process.env.FIX === '0') await KG.ctx.addInitScript(() => { window.EDICTUM_NO_MODAL_ERA = true; });
  if (THROTTLE > 1) { const c = await KG.ctx.newCDPSession(KG); await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  await open(KG);
  await KG.waitForSelector('#d-name');
  await KG.fill('#d-name', 'Kingsmoor ' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26) % 26) + Math.floor(Math.random() * 900 + 100));
  await KG.selectOption('#d-pretitle', 'Kingdom'); await KG.click('#found-btn'); await KG.waitForSelector('.layout', { timeout: 10000 });
  if (process.env.MODE === 'rand') await sleep(Math.round(Math.random() * 3000));
  if (process.env.MODE === 'wait') { await KG.waitForFunction(() => !!document.querySelector('#ed-recovery-code'), undefined, { timeout: 15000 }).catch(() => console.log('no recovery dialog')); /* not waitForSelector: that runs lib.mjs's handler, which closes the dialog */ if (i === 0) console.log('while the dialog is open, html.ed-modal is', await KG.evaluate(() => document.documentElement.classList.contains('ed-modal'))); }
  await nav(KG, 'nation');
  await nav(KG, 'issues');
  await until(() => KG.$('.issue-card')); await KG.click('.issue-card'); await KG.waitForSelector('.edict .opt');
  const t0 = Date.now();
  /* the order of the dialog's closing and the card's click, from the page's timeline */
  const order = () => KG.evaluate(() => { const tl = window.__tl || [], at = f => tl.findIndex(f); const c = at(e => e.includes('dialog.close')), k = at(e => / click .*issue-card/.test(e)); return c < 0 ? 'no close' : k < 0 ? 'no card click' : c < k ? 'closed, then card' : 'card, then closed'; }).catch(() => '?');
  try { await KG.click('.edict [data-act="answer"]', { timeout: 10000 }); await KG.waitForSelector('.result', { timeout: 8000 }); console.log(`run ${i}: ok in ${Date.now() - t0} ms (${await order()})`); }
  catch (e) {
    fails++;
    console.log(`run ${i}: FAILED after ${Date.now() - t0} ms (${await order()})`, String(e.message).split('\n').filter(l => /intercepts|stable|detached|handler/.test(l)).slice(0, 8).join(' | '));
    console.log(JSON.stringify(await hitDiag(KG, '.edict [data-act="answer"]').catch(err => String(err)), null, 1));
    await KG.screenshot({ path: `test/out/repro-${i}.png` }).catch(() => {});
  }
  await KG.ctx.close();
}
console.log(`${fails} of ${RUNS} failed (FIX=${process.env.FIX ?? '1'} MODE=${process.env.MODE || ''})`);
await browser.close();
process.exit(fails ? 1 : 0);
