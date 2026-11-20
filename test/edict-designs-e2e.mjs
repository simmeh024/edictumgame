// Five designs that come with one answer to an edict (20 Nov 2026, emulators): Past Green (arms tincture and accent
// colour), Camouflage (flag pattern), the cat on the banknotes, the carved lintel round the motto and the robot vacuum over
// the capital. Before the answer each is locked and names its edict; another answer gives nothing; the right answer opens
// it where its kind is chosen, and it shows.
import { OUT, check, finish, until, player, open, found, czSection, flagStudio, closeFlagStudio, sleep } from './lib.mjs';
const A = await player('edesigns', { recovery: true });
await open(A); await found(A, 'Designia');
/* the recovery dialog opens a few seconds after founding and takes the keys: wait for it and put it away */
await A.waitForSelector('#ed-recovery-code', { timeout: 30000 }); await A.click('[data-ed="recovery-saved"]'); await sleep(300);
await A.evaluate(() => { if (!G.S.nation.motto) { const n = G.clone(G.S.nation); n.motto = 'Mind the step'; G.commit(n); } });
const ED = { 'odd-new-colour': 1, 'flag-camo': 0, counterfeit: 2, 'motto-step': 0, 'rob-vacuum': 0 };
const IDS = ['tn-pgreen', 'a-pgreen', 'fp-camo', 'cv-cat', 'm-lintel', 'pn-vacuum'];
/* answer an edict as the desk would, and give back the notes on its result page */
const answer = (id, o) => A.evaluate(([id, o]) => { const n = G.clone(G.S.nation); n.inbox.push({ id, at: Date.now() }); G.commit(n); G.answer(id, o);
  const r = G.S.result, g = r && r.id === id ? (r.geo || []).map(([k, t]) => k + ' · ' + t) : null; G.S.result = null; G.render(); return g; }, [id, o]);
const held = () => A.evaluate(ids => ids.filter(u => (G.S.nation.ppx || []).includes(u)), IDS);
const settings = () => A.evaluate(() => { G.S.view = 'settings'; G.render(); });
const noteStudio = async () => { await czSection(A, 'c'); await A.click('#cz-sec-c [data-cst="open"]:not([data-v])'); await A.waitForSelector('#cu-st:not([hidden]) .cst-bar'); await A.click('[data-cst="tab"][data-v="style"]'); await sleep(200); };
const closeNote = async () => { await A.keyboard.press('Escape'); await A.waitForSelector('#cu-st[hidden]', { state: 'attached' }); await sleep(200); };

// before: each is locked, and says which edict brings it
await czSection(A, 'a');
check('Past Green is a locked tincture, naming its edict', await A.evaluate(() => { const b = document.querySelector('#cz-a-t0-pgreen'); return !!b && b.classList.contains('locked') && /Somewhere Past Green/.test(b.title); }));
await czSection(A, 'b');
check('the carved lintel is locked under Banner, naming its edict', await A.evaluate(() => { const m = document.querySelector('#cz-sec-b [data-id="m-lintel"].locked'); return !!m && /Mind the Step/.test(m.textContent) && !document.querySelector('#cz-m-m-lintel'); }));
await czSection(A, 'g');
check('the robot vacuum is locked under Map, naming its edict', await A.evaluate(() => { const p = document.querySelector('#cz-sec-g [data-id="pn-vacuum"].locked'); return !!p && /Clean Getaway/.test(p.textContent) && !document.querySelector('#cz-pn-pn-vacuum'); }));
await flagStudio(A, 'style');
check('Camouflage is a locked flag pattern, naming its edict', await A.evaluate(() => { const t = document.querySelector('#fg-st [data-ux-unlock="fp-camo"]'); return !!t && /Patriotic Pattern/.test(t.title) && !document.querySelector('#c-p-camo'); }));
await closeFlagStudio(A);
await noteStudio();
check('the cat is a locked vignette in the Note Studio', await A.evaluate(() => !!document.querySelector('#cu-st [data-cst="locked"][data-f="note.por"][data-v="cat"]')));
await closeNote();
await settings();
check('the Past Green accent is locked in Settings', await until(() => A.evaluate(() => { const a = document.querySelector('#cz-acc-pgreen'); return !!a && a.classList.contains('locked') && /Somewhere Past Green/.test(a.textContent); })));

// another answer gives nothing
for (const [id, o] of Object.entries(ED)) await answer(id, o === 0 ? 1 : 0);
check('the other answers give none of them', (await held()).length === 0, JSON.stringify(await held()));

// the right answer gives each, with its note
const notes = {};
for (const [id, o] of Object.entries(ED)) notes[id] = await answer(id, o);
check('the right answers give all six', (await held()).length === 6, JSON.stringify(await held()));
check('each result names what it gave and where to choose it', [
  ['odd-new-colour', /^College of Arms · New for your nation: Past Green, a tincture for the arms and the Past Green accent colour\. Choose them in the Arms Studio and Settings › Appearance\.$/],
  ['flag-camo', /^Flag makers · New for your nation: the Camouflage flag pattern\. Choose it in the Flag Studio\.$/],
  ['counterfeit', /^Central Bank · New for your nation: the Cat vignette for your banknotes\. Choose it in the Note Studio\.$/],
  ['motto-step', /^Stonemasons · New for your nation: the carved lintel frame for your motto\. Choose it in Customise › Banner\.$/],
  ['rob-vacuum', /^Mapmakers · New for your nation: the robot vacuum over your capital on the map\. Choose it in Customise › Map\.$/],
].every(([id, re]) => (notes[id] || []).some(t => re.test(t))), JSON.stringify(notes));

// Past Green on the arms, with its shimmer, and as the accent colour
await czSection(A, 'a');
await A.evaluate(() => document.querySelector('button#cz-a-t0-pgreen').click());
check('Past Green can be chosen for the field, and is painted with its own gradient', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.a && G.S.nation.cz.a.t[0] === 'pgreen'
  && !!document.querySelector('#cz-sec-a svg.cz-arms linearGradient[id$="pg"]'))));
const armsSel = await A.evaluate(() => { const s = [...document.querySelectorAll('#cz-sec-a svg.cz-arms')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]; if (s) s.id = 'ed-arms'; return !!s; });
if (armsSel) await A.locator('#ed-arms').screenshot({ path: OUT + '/edict-designs-arms.png' });
await settings();
await A.evaluate(() => document.querySelector('button#cz-acc-pgreen').click());
check('and as the accent colour', await until(() => A.evaluate(() => document.documentElement.dataset.accent === 'pgreen' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase() === '#16795c')));

// Camouflage on the flag
await flagStudio(A, 'style');
await A.evaluate(() => document.querySelector('#c-p-camo').click()); await sleep(200);
await A.click('#fg-st [data-fst="save"]'); await sleep(400);
check('Camouflage can be chosen and saved, in the flag’s own colours', await until(() => A.evaluate(() => G.S.nation.flag && G.S.nation.flag.p === 'camo'
  && [...document.querySelectorAll('.side-flag svg path')].some(p => (p.getAttribute('d') || '').length > 1500))));
await closeFlagStudio(A);
await A.locator('.side-flag').first().screenshot({ path: OUT + '/edict-designs-flag.png' });

// the cat on the banknotes
await noteStudio();
await A.click('#cu-st [data-cst="set"][data-f="note.por"][data-v="cat"]'); await sleep(200);
await A.locator('#cu-st .cst-front svg.cu-note').first().screenshot({ path: OUT + '/edict-designs-note.png' });
await A.click('#cu-st [data-cst="save"]'); await sleep(400); await closeNote();
check('the cat can be put on the banknotes, and the record lists it for other players', await until(() => A.evaluate(() => { const n = G.S.nation; return n.cur && n.cur.note && n.cur.note.por === 'cat' && n.cz && (n.cz.u || []).includes('cv-cat'); })));

// the carved lintel and the robot vacuum
await czSection(A, 'b');
await A.evaluate(() => document.querySelector('button#cz-m-m-lintel').click());
check('the carved lintel can be chosen for the motto', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.m === 'm-lintel')));
await czSection(A, 'g');
await A.evaluate(() => document.querySelector('button#cz-pn-pn-vacuum').click());
check('the robot vacuum can be chosen for the capital', await until(() => A.evaluate(() => G.S.nation.cz && G.S.nation.cz.pn === 'pn-vacuum')));
await czSection(A, 'g');
await A.locator('#cz-pn-pn-vacuum .cz-tv').screenshot({ path: OUT + '/edict-designs-pin.png' });
await A.evaluate(() => { G.S.view = 'nation'; G.render(); });
check('the motto shows on the nation page in its lintel', await until(() => A.evaluate(() => { const m = document.querySelector('.hero-motto.mf-lintel'); return !!m && getComputedStyle(m, '::after').content !== 'none'; })));
await A.locator('.hero-motto.mf-lintel').first().screenshot({ path: OUT + '/edict-designs-motto.png' });
// the map draws the vacuum beside the capital without an error
await A.evaluate(() => { G.S.view = 'map'; G.render(); }); await sleep(1500);
check('the map draws with the vacuum over the capital', await A.evaluate(() => !!document.querySelector('canvas')));
await finish();
