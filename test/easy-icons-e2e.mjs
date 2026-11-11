// Five easy icons: a charge for the arms and the same icon as a flag emblem, both earned with one easy Bronze
// achievement of the first days (emulators).
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/easy-icons-e2e.mjs"
import { OUT, check, finish, sleep, until, player, open, found, settle, nav, czSection } from './lib.mjs';
const IC = [['spyglass', 'fs-map', 'Map Reader'], ['letter', 'dip-dm1', 'Dear Sir or Madam'], ['candle', 'fs-desk', 'On the Desk'],
  ['spade', 'eco-svc1', 'X Marks the Spot'], ['mace', 'fs-brief', 'First Briefing']];
const KS = IC.map(i => i[0]);
const A = await player('easy-icons', { recovery: true });
await open(A); await found(A, 'Easyland');
const openCz = async k => { await A.evaluate(() => { G.S.view = 'customise'; G.render(); }); await czSection(A, k); };
// before: locked, each saying which achievement opens it (Map Reader may already be earned, settling opens the map)
// (the charges sit in a popover, so they are looked up rather than waited for; a locked one is a try-on button)
await openCz('a'); await A.waitForSelector('#cz-a-s-heater');
const before = await A.evaluate(ic => ic.map(([k, , nm]) => { const b = document.querySelector('[data-ux-unlock="c-' + k + '"]'); return { k, locked: !!b && b.classList.contains('locked'), how: b ? b.getAttribute('title') || '' : '', nm }; }), IC);
const lockedNow = before.filter(x => x.k !== 'spyglass');
check('the new charges start locked', lockedNow.every(x => x.locked), JSON.stringify(before));
check('and each says which Bronze achievement opens it', lockedNow.every(x => x.how.includes('bronze achievement') && x.how.includes(x.nm)), JSON.stringify(lockedNow.map(x => x.how)));
await czSection(A, 'e');
const embBefore = await A.evaluate(ic => ic.filter(([k]) => k !== 'spyglass').map(([k, , nm]) => [...document.querySelectorAll('.cz-tl[role="img"]')].some(t => (t.getAttribute('aria-label') || '').includes(nm))), IC);
check('the flag emblems are locked too, with the same achievement', embBefore.every(Boolean), JSON.stringify(embBefore));
// earn the five: open the map, and the four first steps as they are counted (a letter, a cache, a briefing, a desk task)
await settle(A).catch(() => {}); await nav(A, 'map'); await sleep(400);
await A.evaluate(() => { const n = G.clone(G.S.nation); n.tly = Object.assign({}, n.tly); for (const k of ['dm', 'svc', 'brf', 'ddt']) n.tly[k] = (n.tly[k] || 0) + 1; G.commit(n); });
const got = await until(() => A.evaluate(ic => ic.every(([, a]) => G.S.nation.ach && G.S.nation.ach[a]), IC), 10000);
check('a letter, a cache, a briefing, a desk task and the map earn the five achievements', !!got, JSON.stringify(await A.evaluate(() => Object.keys(G.S.nation.ach || {}))));
await openCz('a'); await A.waitForSelector('#cz-a-s-heater');
check('then all five charges can be chosen', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#cz-a-c-c-' + k); return b && !b.classList.contains('locked') && b.querySelector('svg path'); }), KS));
await czSection(A, 'e');
check('and all five flag emblems, from the same achievements', await A.evaluate(ks => ks.every(k => { const b = document.querySelector('button#c-e-e-' + k); return b && b.querySelector('svg path'); }), KS));
const emblemSvgs = await A.evaluate(ks => ks.map(k => (document.querySelector('#c-e-e-' + k + ' svg') || {}).outerHTML || ''), KS);
// the flag is a draft in Customise until Save flag
await A.evaluate(() => document.querySelector('button#c-e-e-mace').click());
await A.waitForSelector('#c-flag-save'); await A.evaluate(() => document.querySelector('#c-flag-save').click());
check('choosing a new emblem and saving puts it on the flag', await until(() => A.evaluate(() => G.S.nation.flag && G.S.nation.flag.e === 'e-mace')));
await openCz('a'); await A.waitForSelector('#cz-a-s-heater');
await A.evaluate(() => document.querySelector('button#cz-a-c-c-spade').click());
check('choosing a new charge puts it on the arms, with its blazon', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.a && G.S.nation.cz.a.c === 'c-spade' && /a spade erect/.test(document.querySelector('.cz-blazon').textContent))));
// the achievement card names both rewards
await nav(A, 'achievements'); await sleep(400);
const rw = await A.evaluate(() => { const c = document.getElementById('ach-fs-desk'); const r = c && c.querySelector('.ach-rw'); return r ? r.textContent : ''; });
check('the achievement card names the charge and the flag emblem', /Candle charge for the arms and flag emblem/.test(rw), rw);
// a sheet of the five, for the pull request
await openCz('a'); await A.waitForSelector('#cz-a-s-heater');
const html = await A.evaluate(([ks, em]) => {
  const svg = sel => (document.querySelector(sel + ' svg') || {}).outerHTML || '';
  return `<div id="ic-all" style="display:inline-block;padding:10px;background:#eee"><div style="display:flex;gap:10px;margin:0 0 10px">${ks.map(k => `<div style="width:90px;height:100px">${svg('#cz-a-c-c-' + k)}</div>`).join('')}</div><div style="display:flex;gap:10px">${em.map(x => `<div style="width:90px;height:60px">${x}</div>`).join('')}</div></div>`; }, [KS, emblemSvgs]);
const P = await A.context().newPage(); await P.setContent(html);
await P.locator('#ic-all').screenshot({ path: OUT + '/easy-icons.png' }); await P.close();
await finish();
