// Two more flag patterns, each earned with a silver achievement: Embattled (a mayor in every city, with four cities or
// more) and Three peaks (every survey cache of the day dug up on seven days) (emulators).
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/flag-designs2-e2e.mjs"
import { OUT, check, finish, until, player, open, found, nav, czSection } from './lib.mjs';
const A = await player('flag designs two');
await open(A); await found(A, 'Peakland');
const openFlag = async () => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await czSection(A, 'e'); await A.waitForSelector('#c-p-tri-v'); };
const label = id => A.evaluate(id => { const t = document.querySelector(`[data-ux-unlock="${id}"]`); return t ? t.getAttribute('aria-label') || t.getAttribute('title') || '' : ''; }, id);
const earned = id => until(() => A.evaluate(id => !!(G.S.nation.ach && G.S.nation.ach[id]), id), 10000);

// before: both locked, each naming its silver achievement
await openFlag();
const [lE, lP] = [await label('fp-embattled'), await label('fp-peaks')];
check('Embattled and Three peaks start locked', !!lE && !!lP && !await A.$('#c-p-embattled') && !await A.$('#c-p-peaks'), JSON.stringify([lE, lP]));
check('and each names the silver achievement that earns it', /silver/i.test(lE) && /A Mayor for Every Town/.test(lE) && /silver/i.test(lP) && /A Week in the Field/.test(lP), JSON.stringify([lE, lP]));

// Three peaks: every cache of the day dug up on seven days (six is not enough)
await A.evaluate(() => { const n = G.clone(G.S.nation); n.tly = Object.assign({}, n.tly, { svcall: 6 }); G.commit(n); });
await new Promise(r => setTimeout(r, 600));
check('six clean days in the field are not yet enough', !await A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['eco-svcall7'])));
await A.evaluate(() => { const n = G.clone(G.S.nation); n.tly = Object.assign({}, n.tly, { svcall: 7 }); G.commit(n); });
check('seven earn A Week in the Field', !!await earned('eco-svcall7'));
await openFlag();
check('and Three peaks can be chosen, Embattled still locked', !!await A.$('#c-p-peaks') && !!await A.$('[data-ux-unlock="fp-embattled"]') && !await A.$('#c-p-embattled'));

// Embattled: four cities, but one without a mayor, is not enough; a mayor there too earns it
const cities = mayors => A.evaluate(mayors => { const n = G.clone(G.S.nation), c = n.cities[0], tr = Object.keys(G.CX.traits)[0];
  while (n.cities.length < 4) n.cities.push({ ...G.clone(c), id: 'x' + n.cities.length, name: 'Town ' + n.cities.length });
  n.cities.forEach((x, i) => { if (i < mayors) x.my = { nm: 'Mayor ' + i, tr, t: Date.now() }; else delete x.my; }); G.commit(n); }, mayors);
await cities(3);
await new Promise(r => setTimeout(r, 600));
check('four cities with three mayors are not enough', !await A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['my-all'])), JSON.stringify(await A.evaluate(() => G.S.nation.cities.map(c => !!c.my))));
await cities(4);
check('a mayor in every one of four cities earns A Mayor for Every Town', !!await earned('my-all'));
await openFlag();
check('and Embattled can be chosen', !!await A.$('#c-p-embattled'));

// flying it: chosen in the draft, then saved; the flag records the pattern it holds, so others see it too
await A.evaluate(() => document.querySelector('button#c-p-embattled').click());
check('choosing Embattled draws it', await until(() => A.evaluate(() => G.S.czFlag && G.S.czFlag.p === 'embattled')));
await A.waitForSelector('#c-flag-save'); await A.evaluate(() => document.querySelector('#c-flag-save').click());
check('and Save flag flies it, with the unlock recorded for other players', await until(() => A.evaluate(() => G.S.nation.flag && G.S.nation.flag.p === 'embattled' && G.S.nation.cz && (G.S.nation.cz.u || []).includes('fp-embattled'))));

// the achievement cards name the reward
await nav(A, 'achievements'); await new Promise(r => setTimeout(r, 400));
const rw = await A.evaluate(() => ['my-all', 'eco-svcall7'].map(id => { const c = document.getElementById('ach-' + id), r = c && c.querySelector('.ach-rw'); return r ? r.textContent : ''; }));
check('the achievement cards name the flag patterns', /Embattled flag pattern/.test(rw[0]) && /Three peaks flag pattern/.test(rw[1]), JSON.stringify(rw));

// a sheet of the two, for the pull request, drawn on a page of its own
await openFlag();
const svgs = await A.evaluate(() => ['embattled', 'peaks'].map(p => document.querySelector('#c-p-' + p + ' svg').outerHTML));
const P = await A.context().newPage();
await P.setContent('<div id="fd-all" style="display:inline-grid;grid-template-columns:repeat(2,240px);gap:10px;padding:10px;background:#eee">' + svgs.map(v => `<div style="width:240px;height:160px">${v}</div>`).join('') + '</div>');
await P.locator('#fd-all').screenshot({ path: OUT + '/flag-designs2.png' }); await P.close();
await finish();
