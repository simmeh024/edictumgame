// Click a resource on the stockpile bars and see where its day comes from, in a modal whose lines add up.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/res-breakdown-e2e.mjs"
import path from 'node:path';
import { OUT, check, finish, sleep, player, open, found, nav, settle } from './lib.mjs';

const A = await player('Breakdown-A', { vp: { width: 1280, height: 1000 } });
await open(A);
await found(A, 'Ledgeria');
await settle(A);
for (const [v, sel] of [['cities', '.cx-stk[data-r="food"]'], ['trade', '.stk-i[data-r="goods"]']]) {
  await nav(A, v);await sleep(400);
  const has = await A.$(sel);check(`the ${v} page's ${sel} is a button`, !!has);if (!has) continue;
  await A.screenshot({ path: path.join(OUT, `res-bar-${v}.png`), clip: await (await A.$(sel)).evaluate(e => { const r = e.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  await A.click(sel);await sleep(300);
  const m = await A.evaluate(() => { const d = document.querySelector('#rbd-root .rbd-modal');if (!d) return null;
    const tot = [...d.querySelectorAll('.rbd-tot td:last-child')].map(x => x.textContent);
    const st = [...d.querySelectorAll('.rbd-t')].pop(),rows = [...st.querySelectorAll('tr:not(.rbd-tot) td:last-child')].map(x => +x.textContent.replace('−', '-'));
    return { h: d.querySelector('#rbd-h').textContent, tot, sum: rows.reduce((a, b) => a + b, 0), focus: document.activeElement && document.activeElement.id, rows: d.querySelectorAll('tr').length }; });
  check(`a modal opens on ${v}`, !!m && m.rows > 3, JSON.stringify(m));
  if (m) check(`its stockpile lines add up to the total on ${v}`, Math.abs(m.sum - +m.tot[m.tot.length - 1].replace('−', '-')) < 0.3, JSON.stringify(m));
  await A.screenshot({ path: path.join(OUT, `res-breakdown-${v}.png`) });
  await A.keyboard.press('Escape');await sleep(200);
  check(`Escape closes it on ${v}`, !(await A.$('#rbd-root .rbd-modal')));
}
await finish();
