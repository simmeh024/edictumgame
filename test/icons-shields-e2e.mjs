// Ten new icons, free: charges for the coat of arms and the same ten as flag emblems; five new shields, the Mural
// shield opening with five cities (emulators).
import { OUT, check, finish, until, player, open, found } from './lib.mjs';
const KS = ['acorn', 'torch', 'scales', 'hourglass', 'quill', 'helm', 'grapes', 'lighthouse', 'dove', 'pine'];
const SH = ['kite', 'round', 'polish', 'tudor', 'mural'];
const A = await player('icons', { recovery: true });
await open(A); await found(A, 'Iconia');
const openCz = async () => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await A.waitForSelector('#cz-a-s-heater'); };
await openCz();
check('the ten new charges can be chosen at once', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#cz-a-c-c-' + k); return b && b.querySelector('svg path'); }), KS));
check('and the ten new flag emblems', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#c-e-e-' + k); return b && b.querySelector('svg path'); }), KS));
check('four new shields can be chosen at once', await A.evaluate(sh => sh.slice(0, 4).every(s => document.querySelector('button#cz-a-s-' + s)), SH));
check('the Mural shield is locked, saying five cities open it', await A.evaluate(() => { const t = document.querySelector('#cz-a-s-mural'); return t && t.tagName === 'SPAN' && /five cities/.test(t.getAttribute('aria-label')); }));
await A.evaluate(() => document.querySelector('button#cz-a-c-c-lighthouse').click());
check('choosing a new charge puts it on the arms, with its blazon', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.a && G.S.nation.cz.a.c === 'c-lighthouse' && /a lighthouse/.test(document.querySelector('.cz-blazon').textContent))));
await A.evaluate(() => document.querySelector('button#cz-a-s-tudor').click());
check('choosing a new shield uses it', await until(() => A.evaluate(() => G.S.nation.cz.a.s === 'tudor')));
// five cities open the Mural shield
await A.evaluate(() => { const n = G.clone(G.S.nation), c = n.cities[0]; while (n.cities.length < 5) n.cities.push({ ...G.clone(c), id: 'x' + n.cities.length, name: 'Town ' + n.cities.length }); G.commit(n); });
await openCz();
check('with five cities the Mural shield can be chosen', !!await A.$('button#cz-a-s-mural'));
await A.evaluate(() => document.querySelector('button#cz-a-s-mural').click());
check('and it is used', await until(() => A.evaluate(() => G.S.nation.cz.a.s === 'mural')));
// a sheet of everything new, for the pull request, drawn on a page of its own
const html = await A.evaluate(([ks, sh]) => {
  const svg = sel => (document.querySelector(sel + ' svg') || {}).outerHTML || '';
  const row = (sels, w, h) => `<div style="display:flex;gap:10px;margin:0 0 10px">${sels.map(s => `<div style="width:${w}px;height:${h}px">${svg(s)}</div>`).join('')}</div>`;
  return `<div id="ic-all" style="display:inline-block;padding:10px;background:#eee">${row(ks.map(k => '#cz-a-c-c-' + k), 90, 100)}${row(ks.map(k => '#c-e-e-' + k), 90, 60)}${row(sh.map(s => '#cz-a-s-' + s), 90, 100)}</div>`; }, [KS, SH]);
const P = await A.context().newPage(); await P.setContent(html);
await P.locator('#ic-all').screenshot({ path: OUT + '/icons-shields.png' }); await P.close();
await finish();
