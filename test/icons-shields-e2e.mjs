// Ten new icons, free: charges for the coat of arms and the same ten as flag emblems; five new shields, the Mural
// shield opening with five cities (emulators).
import { OUT, check, finish, until, player, open, found, czSection } from './lib.mjs';
const KS = ['acorn', 'torch', 'scales', 'hourglass', 'quill', 'helm', 'grapes', 'lighthouse', 'dove', 'pine'];
const SH = ['kite', 'round', 'polish', 'tudor', 'mural'];
const A = await player('icons', { recovery: true });
await open(A); await found(A, 'Iconia');
const openCz = async () => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await czSection(A, 'a'); await A.waitForSelector('#cz-a-s-heater'); };
await openCz();
check('the ten new charges can be chosen at once', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#cz-a-c-c-' + k); return b && b.querySelector('svg path'); }), KS));
// only the open section is on the page, so the flag's emblems need the Flag section
await czSection(A, 'e');
check('and the ten new flag emblems', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#c-e-e-' + k); return b && b.querySelector('svg path'); }), KS));
const emblemSvgs = await A.evaluate(ks => ks.map(k => (document.querySelector('#c-e-e-' + k + ' svg') || {}).outerHTML || ''), KS);
await openCz();
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
const html = await A.evaluate(([ks, sh, em]) => {
  const svg = sel => (document.querySelector(sel + ' svg') || {}).outerHTML || '';
  const row = (sels, w, h) => `<div style="display:flex;gap:10px;margin:0 0 10px">${sels.map(s => `<div style="width:${w}px;height:${h}px">${svg(s)}</div>`).join('')}</div>`;
  return `<div id="ic-all" style="display:inline-block;padding:10px;background:#eee">${row(ks.map(k => '#cz-a-c-c-' + k), 90, 100)}<div style="display:flex;gap:10px;margin:0 0 10px">${em.map(x => `<div style="width:90px;height:60px">${x}</div>`).join('')}</div>${row(sh.map(s => '#cz-a-s-' + s), 90, 100)}</div>`; }, [KS, SH, emblemSvgs]);
const P = await A.context().newPage(); await P.setContent(html);
await P.locator('#ic-all').screenshot({ path: OUT + '/icons-shields.png' }); await P.close();
await finish();
