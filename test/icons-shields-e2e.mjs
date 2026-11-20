// Ten new icons, free: charges for the coat of arms and the same ten as flag emblems; five new shields, the Mural
// shield opening with five cities (emulators). Five more free icons came on 2026-11-14: portcullis, escallop,
// cornucopia, windmill and elephant. On 2026-11-20 a motorbike and a volcano, which come with the edict
// “Designed by a Nine-Year-Old”, whatever the answer.
import { OUT, check, finish, until, player, open, found, czSection, flagStudio, closeFlagStudio } from './lib.mjs';
const KS = ['acorn', 'torch', 'scales', 'hourglass', 'quill', 'helm', 'grapes', 'lighthouse', 'dove', 'pine', 'portcullis', 'escallop', 'cornucopia', 'windmill', 'elephant'];
const SH = ['kite', 'round', 'polish', 'tudor', 'mural'];
const A = await player('icons', { recovery: true });
await open(A); await found(A, 'Iconia');
const openCz = async () => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await czSection(A, 'a'); await A.waitForSelector('#cz-a-s-heater'); };
await openCz();
check('the fifteen free charges can be chosen at once', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#cz-a-c-c-' + k); return b && b.querySelector('svg path'); }), KS));
// the flag's emblems are chosen in the Flag Studio
await flagStudio(A, 'charges');
check('and the fifteen free flag emblems', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#c-e-e-' + k); return b && b.querySelector('svg path'); }), KS));
const emblemSvgs = await A.evaluate(ks => ks.map(k => (document.querySelector('#c-e-e-' + k + ' svg') || {}).outerHTML || ''), KS);
await closeFlagStudio(A);
await openCz();
check('four new shields can be chosen at once', await A.evaluate(sh => sh.slice(0, 4).every(s => document.querySelector('button#cz-a-s-' + s)), SH));
check('the Mural shield is locked, saying five cities open it', await A.evaluate(() => { const t = document.querySelector('#cz-a-s-mural'); return t && t.tagName === 'SPAN' && /five cities/.test(t.getAttribute('aria-label')); }));
await A.evaluate(() => document.querySelector('button#cz-a-c-c-lighthouse').click());
check('choosing a new charge puts it on the arms, with its blazon', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.a && G.S.nation.cz.a.c === 'c-lighthouse' && /a lighthouse/.test(document.querySelector('.cz-blazon').textContent))));
await A.evaluate(() => document.querySelector('button#cz-a-c-c-portcullis').click());
check('the portcullis is blazoned chained', await until(() => A.evaluate(() => G.S.nation.cz.a.c === 'c-portcullis' && /a portcullis chained/.test(document.querySelector('.cz-blazon').textContent))));
await A.evaluate(() => document.querySelector('button#cz-a-s-tudor').click());
check('choosing a new shield uses it', await until(() => A.evaluate(() => G.S.nation.cz.a.s === 'tudor')));
// five cities open the Mural shield
await A.evaluate(() => { const n = G.clone(G.S.nation), c = n.cities[0]; while (n.cities.length < 5) n.cities.push({ ...G.clone(c), id: 'x' + n.cities.length, name: 'Town ' + n.cities.length }); G.commit(n); });
await openCz();
check('with five cities the Mural shield can be chosen', !!await A.$('button#cz-a-s-mural'));
await A.evaluate(() => document.querySelector('button#cz-a-s-mural').click());
check('and it is used', await until(() => A.evaluate(() => G.S.nation.cz.a.s === 'mural')));
// the motorbike and the volcano (20 Nov 2026) come with the edict “Designed by a Nine-Year-Old”, whatever the answer
const ED = ['motorbike', 'volcano'];
await openCz();
check('before the edict, the motorbike and volcano charges are locked, naming the edict', await A.evaluate(ks => ks.every(k => { const t = document.querySelector('[data-id="c-' + k + '"].locked'); return t && !document.querySelector('button#cz-a-c-c-' + k) && /Designed by a Nine-Year-Old/.test(t.getAttribute('title')); }), ED));
await A.evaluate(() => { const n = G.clone(G.S.nation); n.inbox.push({ id: 'prv-flag-contest', at: Date.now() }); G.commit(n); G.answer('prv-flag-contest', 2); });
check('answering it (even lowering every province flag) gives both, as charges and emblems', await until(() => A.evaluate(() => ['c-motorbike', 'e-motorbike', 'c-volcano', 'e-volcano'].every(id => (G.S.nation.ppx || []).includes(id)))));
await A.evaluate(() => { G.S.view = 'issues'; G.render(); });
check('the result names them', await until(() => A.evaluate(() => [...document.querySelectorAll('.polchg span')].some(s => /^Flag makers · New for your flag and arms: the Motorbike and the Volcano, each a charge for the arms and an emblem for the flag\./.test(s.textContent)))));
await A.evaluate(() => { const b = document.querySelector('[data-ed="recovery-saved"]'); if (b) b.click(); });
await A.evaluate(() => { const p = document.querySelector('.polchg'); if (p) p.scrollIntoView({ block: 'center' }); });
await A.screenshot({ path: OUT + '/flag-contest-result.png' });
await A.evaluate(() => { G.S.result = null; G.render(); });
await openCz();
check('the two charges can now be chosen', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#cz-a-c-c-' + k); return b && b.querySelector('svg path'); }), ED));
await A.evaluate(() => document.querySelector('button#cz-a-c-c-volcano').click());
check('the volcano is blazoned in eruption', await until(() => A.evaluate(() => G.S.nation.cz.a.c === 'c-volcano' && /a volcano in eruption/.test(document.querySelector('.cz-blazon').textContent))));
await flagStudio(A, 'charges');
check('and the two flag emblems', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#c-e-e-' + k); return b && b.querySelector('svg path'); }), ED));
emblemSvgs.push(...await A.evaluate(ks => ks.map(k => (document.querySelector('#c-e-e-' + k + ' svg') || {}).outerHTML || ''), ED));
KS.push(...ED);
await closeFlagStudio(A);
await openCz();
// a sheet of everything new, for the pull request, drawn on a page of its own
const html = await A.evaluate(([ks, sh, em]) => {
  const svg = sel => (document.querySelector(sel + ' svg') || {}).outerHTML || '';
  const row = (sels, w, h) => `<div style="display:flex;gap:10px;margin:0 0 10px">${sels.map(s => `<div style="width:${w}px;height:${h}px">${svg(s)}</div>`).join('')}</div>`;
  return `<div id="ic-all" style="display:inline-block;padding:10px;background:#eee">${row(ks.map(k => '#cz-a-c-c-' + k), 90, 100)}<div style="display:flex;gap:10px;margin:0 0 10px">${em.map(x => `<div style="width:90px;height:60px">${x}</div>`).join('')}</div>${row(sh.map(s => '#cz-a-s-' + s), 90, 100)}</div>`; }, [KS, SH, emblemSvgs]);
const P = await A.context().newPage(); await P.setContent(html);
await P.locator('#ic-all').screenshot({ path: OUT + '/icons-shields.png' }); await P.close();
await finish();
