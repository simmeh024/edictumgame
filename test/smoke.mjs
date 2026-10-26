// The game's own smoke test, on the built site with Firebase (emulators): found a nation, open
// every page in the navigation and a computer-run nation's page, at 1280 and 390 px wide, in two
// regions, with a second player in the region. Fails on any page error or sideways scroll.
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/smoke.mjs"
import { check, finish, sleep, player, open, found, errors } from './lib.mjs';

for (const region of ['meridian', 'frostmarch']) {
  const neighbour = await player('neighbour-' + region);
  await neighbour.addInitScript(r => { if (!localStorage.getItem('statehood.nation.v1')) localStorage.setItem('statehood.region', r); }, region);
  await open(neighbour);
  await found(neighbour, region === 'meridian' ? 'Nearholm' : 'Fjellby');
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = region + '-' + vp.width;
    const p = await player(tag, { vp });
    await p.addInitScript(r => { if (!localStorage.getItem('statehood.nation.v1')) localStorage.setItem('statehood.region', r); }, region);
    await open(p);
    await found(p, 'Smokeland');
    const views = await p.evaluate(() => [...document.querySelectorAll('.nav [data-v]')].map(b => b.dataset.v));
    const wide = [];
    for (const v of views) {
      await p.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v);
      await sleep(250);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (ov > 0) wide.push(v + ' ' + ov);
    }
    await p.evaluate(() => document.querySelector('.nav [data-v="region"]').click()); await sleep(250);
    const npc = await p.evaluate(() => { const b = document.querySelector('.tbl button.linkish[data-id^="npc-"]'); if (b) b.click(); return b ? b.dataset.id : null; });
    await sleep(300);
    const visit = await p.evaluate(() => !!document.querySelector('#main .hero, #main .vh'));
    const listed = await p.evaluate(n => document.querySelector('#app').textContent.includes(n), region === 'meridian' ? 'Nearholm' : 'Fjellby');
    await p.evaluate(() => document.querySelector('.nav [data-v="region"]').click()); await sleep(400);
    const neighbourShown = await p.evaluate(n => document.querySelector('.tbl') && document.querySelector('.tbl').textContent.includes(n), region === 'meridian' ? 'Nearholm' : 'Fjellby');
    check(`${tag}: ${views.length} pages open with no sideways scroll`, views.length > 15 && !wide.length, wide.join(', '));
    check(`${tag}: a computer-run nation's page opens (${npc})`, !!npc && visit);
    check(`${tag}: the other player is in the region`, neighbourShown || listed);
    await p.ctx.close();
  }
  await neighbour.ctx.close();
}
check('no page errors', !errors.length, errors.join(' | '));
await finish();
