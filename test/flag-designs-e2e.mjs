// Five more flag patterns: three to choose at once, two earned on the Community Board (a visit, then visits on five
// different days); the visit is counted once a day (emulators).
import { OUT, check, finish, until, player, open, found, nav, czSection, localNation, clearEmulators } from './lib.mjs';
await clearEmulators();
const A = await player('flag designs', { recovery: true });
await open(A); await found(A, 'Bannerland');
const tile = (p, cls = 'button') => A.$(`${cls === 'button' ? 'button' : '[data-ux-unlock]'}#c-p-${p}`);
const openFlag = async () => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await czSection(A, 'e'); await A.waitForSelector('#c-p-tri-v'); };

await openFlag();
check('Pile, Twin waves and Triple chevron can be chosen at once', !!await A.$('#c-p-pile') && !!await A.$('#c-p-wave2') && !!await A.$('#c-p-chev3'));
check('Gyronny and Lozenge are shown locked, naming the achievements that earn them', await A.evaluate(() => [['fp-gyronny', /Town Crier/], ['fp-lozenge', /Regular at the Board/]].every(([id, re]) => { const t = document.querySelector(`[data-ux-unlock="${id}"]`); return t && re.test(t.getAttribute('aria-label')); })) && !await A.$('#c-p-gyronny'));
await A.click('#c-p-chev3');
check('choosing a new pattern draws it', await until(() => A.evaluate(() => G.S.czFlag.p === 'chev3')));

// the board: one visit unlocks Gyronny; the same day again counts nothing more
await A.evaluate(() => { G.S.view = 'community'; G.render(); });
check('a visit to the Community Board earns Town Crier', await until(async () => { const n = await localNation(A); return n && n.tly && n.tly.cbvisit === 1; }, 10000));
await A.evaluate(() => { G.S.view = 'nation'; G.render(); G.S.view = 'community'; G.render(); });
await new Promise(r => setTimeout(r, 600));
check('a second visit the same day counts nothing more', (await localNation(A)).tly.cbvisit === 1);
await openFlag();
check('and Gyronny can now be chosen, Lozenge still locked', !!await A.$('#c-p-gyronny') && !!await A.$('[data-ux-unlock="fp-lozenge"]'));

// five different days unlock Lozenge
await A.evaluate(() => { const n = G.clone(G.S.nation); n.tly.cbvisit = 4; n.tly.cbday = 1; G.commit(n); G.S.view = 'community'; G.render(); });
check('visits on five days earn Regular at the Board', await until(async () => (await localNation(A)).tly.cbvisit === 5, 10000));
/* the achievement, and so the pattern, can arrive with the save after the visit's own: save again and look until it shows */
check('and Lozenge can be chosen', await until(async () => { await A.evaluate(() => { G.commit(G.clone(G.S.nation)); }); await openFlag(); return !!await A.$('#c-p-lozenge'); }, 10000));
// a sheet of the five, for the pull request (the page is replaced: this is the end of the suite)
await A.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); const svgs = ['gyronny', 'lozenge', 'pile', 'wave2', 'chev3'].map(p => document.querySelector('#c-p-' + p + ' svg').outerHTML);
  document.body.innerHTML = '<div id="fd-all" style="display:inline-grid;grid-template-columns:repeat(5,150px);gap:10px;padding:10px;background:#eee">' + svgs.map(v => `<div style="width:150px;height:100px">${v}</div>`).join('') + '</div>'; });
await A.locator('#fd-all').screenshot({ path: OUT + '/flag-designs-all.png' });
await finish();
