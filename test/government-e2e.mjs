// The Government page in five tabs (emulators): Overview with the leader's record, approval explained and the mandate;
// a parliament whose seats follow the population and the edicts; the budget beside the region with an emergency shift;
// the laws by topic with where each came from, repeal and restore paid for from the mandate; the daily cabinet briefing
// and a quiet word with a restless minister; the private half keeps the new fields; visitors see another cabinet.
import { check, finish, sleep, until, player, open, found, nav, text, localNation, errors, clearEmulators, ready, nationDoc } from './lib.mjs';
await clearEmulators();
const shown = (p, sel) => p.locator(sel).first().isVisible();
const tab = p => p.evaluate(() => document.getElementById('gv')?.dataset.tab || '');
const A = await player('government', { recovery: true, vp: { width: 1366, height: 900 } });
const uid = await open(A); await found(A, 'Curia Magna');
await A.waitForSelector('#ed-recovery-code', { timeout: 25000 }); await A.click('[data-ed="recovery-saved"]');

// five tabs, the Overview first, one pane at a time, no old section menu
await nav(A, 'government'); await A.waitForSelector('#gv');
check('the Government page has five tabs', JSON.stringify(await A.$$eval('.gv-tab', b => b.map(x => x.childNodes[0].textContent))) === JSON.stringify(['Overview', 'Cabinet', 'Parliament', 'Budget', 'Laws']));
check('it opens on the Overview, with the other panes hidden', await tab(A) === 'overview' && await shown(A, '#gv-md') && !await shown(A, '#gov-pols') && !await shown(A, '#gv-shift'));
check('no section menu or fold controls any more', !await A.$('#ux-section-select') && !await A.$('.ux-fold-toggle'));
check('four figures, the mandate full', (await A.$$('#gv-p-overview .gv-figs .fig')).length === 4 && /10 of 10/.test(await text(A, '#gv-p-overview .gv-figs .fig:nth-child(4)')));
const appr = await A.evaluate(() => Math.round(G.S.nation && (() => { const s = G.S.nation.s; return Math.max(3, Math.min(97, s.happy * 0.45 + (100 - s.corrupt) * 0.25 + s.pol * 0.1 + s.civil * 0.05 + (s.wealth - 50) * 0.15 + 10)); })()));
check('approval is explained in five parts that add up', await A.evaluate(a => { const v = [...document.querySelectorAll('.gv-apl b')].map(b => parseFloat(b.firstChild.textContent)); return v.length === 5 && Math.abs(Math.max(3, Math.min(97, v.reduce((x, y) => x + y, 0) + 2.5)) - a) <= 1; }, appr) && new RegExp(`Why approval is ${appr}%`).test(await text(A, '#gv-ap-h')));
check('the leader’s record starts with this leader', /In office since today/.test(await text(A, '.gv-rec .gv-who')) && /Portraits of past leaders/.test(await text(A, '.gv-rec')));
check('a briefing is waiting, on the Overview and on the Cabinet tab', /briefing waiting/.test(await text(A, '.gv-notes')) && !!await A.$('#gv-tab-cabinet .gv-dot'));

// the parliament: seats from the cube root of the population, every seat a dot
const seats0 = await A.evaluate(() => G.GV().seats(G.S.nation).seats);
const base0 = await A.evaluate(() => Math.round(Math.cbrt(G.S.nation.pop * 1e6)));
check('seats follow the cube root of the population, an odd number', seats0 % 2 === 1 && Math.abs(seats0 - base0) <= 1);
await A.click('#gv-tab-parliament');
check('the Parliament tab shows its pane, and the address says so', await tab(A) === 'parliament' && await A.evaluate(() => location.hash) === '#government/parliament' && await shown(A, '.gv-pl .gv-hemi'));
check('one dot per seat in the half circle, and the legend adds up', await A.$$eval('#gv-p-parliament .gv-pl .gv-hemi circle', c => c.length) === seats0 && await A.$$eval('#gv-p-parliament .gv-pl .gv-leg b', b => b.reduce((a, x) => a + Number(x.textContent.replace(/,/g, '')), 0)) === seats0);
check('the tab and the figure give the same count', (await text(A, '#gv-tab-parliament .gv-tab-n')) === String(seats0) && (await text(A, '.gv-pl .fig:first-child .fig-v')) === String(seats0));
check('a government with a majority, or a line that says it is short', /governs/.test(await text(A, '.gv-pl .gv-govl')));
// edicts change it: direct democracy shrinks it, a second chamber adds a senate, suspended elections leave one bloc
const setPol = (p, pols) => p.evaluate(pols => { const n = G.clone(G.S.nation); n.policies = Object.assign({}, n.policies, pols); for (const k of Object.keys(pols)) if (!pols[k]) delete n.policies[k]; G.commit(n); G.render(); }, pols);
await setPol(A, { directDemocracy: true, upperHouse: true });
const s1 = await A.evaluate(() => G.GV().seats(G.S.nation).seats);
check('Direct Democracy and a Second Chamber shrink the house', s1 < seats0 && Math.abs(s1 - Math.round(base0 * 0.6 * 0.9)) <= 2 && /Direct Democracy/.test(await text(A, '.gv-why')) && /Second Chamber/.test(await text(A, '.gv-why')));
check('and the Senate appears, a quarter of the size', await shown(A, '.gv-sen .gv-hemi') && /The Senate/.test(await text(A, '#gv-p-parliament .gv-th')));
await setPol(A, { directDemocracy: false, upperHouse: false, noElections: true });
check('with elections suspended one bloc holds every seat', /Loyal Friends of the/.test(await text(A, '.gv-pl .gv-leg')) && /No elections/.test(await text(A, '.gv-pl .gv-figs')) && (await A.$$('.gv-pl .gv-leg li')).length === 1);
await setPol(A, { noElections: false, proportionalRep: true });
check('proportional representation shares seats out by the vote', await A.evaluate(() => { const P = G.GV().parl(G.S.nation); return P.sys === 'pr' && P.parties.every(q => Math.abs(q.seats / P.seats * 100 - q.v) < 1.5); }));
const bigSeats = await A.evaluate(() => { const n = G.clone(G.S.nation); n.pop = 5000; return G.GV().seats(n).seats; });
check('a nation of five billion has a far larger parliament', bigSeats > 1500 && bigSeats <= 3001);
await setPol(A, { proportionalRep: false });

// the address opens a tab after a reload; Statistics count the same seats
await A.evaluate(() => { location.hash = '#government/laws'; }); await A.reload(); await ready(A); await A.waitForSelector('#gv');
check('#government/laws opens the Laws tab after a reload', await tab(A) === 'laws' && await shown(A, '#gov-pols'));
await A.evaluate(() => { G.S.statsTab = 'government'; }); await nav(A, 'stats');
await A.evaluate(() => document.querySelector('[data-act="st-tab"][data-k="government"]')?.click()); await sleep(300);
const seatsNow = await A.evaluate(() => G.GV().seats(G.S.nation).seats);
check('the Statistics page counts the same seats', new RegExp(`Parliament: ${seatsNow.toLocaleString('en-US')} seats`).test(await A.evaluate(() => document.body.innerText)));

// laws: an edict enacts a policy, which the Laws tab files under its topic with the edict's name
const pick = await A.evaluate(() => {
  const n = G.S.nation, I = G.NB.ISSUE_BY_ID;
  for (const id of Object.keys(I)) { const is = I[id]; if (!is || !Array.isArray(is.o) || is.req || id.startsWith('fd-') || id.startsWith('ws-')) continue; for (let o = 0; o < is.o.length; o++) { const p = is.o[o] && is.o[o].e && is.o[o].e.p; if (!p) continue; const ks = Object.keys(p).filter(k => p[k] && !n.policies[k]); if (ks.length && Object.keys(p).every(k => p[k])) return { id, o, k: ks[0], c: is.c }; } }
  return null;
});
check('an edict that enacts a policy exists', !!pick);
const e0 = await A.evaluate(() => G.GV().ldr(G.S.nation).e);
await A.evaluate(({ id, o }) => { const n = G.clone(G.S.nation); n.inbox.push({ id, at: Date.now() }); G.commit(n); G.answer(id, o); }, pick);
await nav(A, 'government'); await A.click('#gv-tab-laws');
const card = `#pol-${pick.k}`;
check('the new policy is in force, on the Laws tab', await shown(A, card));
check('and it says which edict enacted it', /Enacted by the edict “.+”/.test(await text(A, card + ' .gv-src')));
check('under the topic of the edicts that enact it', await A.evaluate(([sel, k]) => { const h = document.querySelector(sel).closest('.pols').previousElementSibling; return h && h.classList.contains('gv-th'); }, [card, pick.k]));
check('the count of policies in force', new RegExp(`^${await A.evaluate(() => Object.keys(G.S.nation.policies).length)} of \\d+ policies in force`).test(await text(A, '.gv-count')));
check('the leader’s record counts the edict', await A.evaluate(() => G.S.nation.ldr && G.S.nation.ldr.e) === e0 + 1);

// repeal it by decree: 3 mandate, then it waits under "Repealed this week" and can be restored for 4
await A.click(`[data-act="pol-repeal-ask"][data-k="${pick.k}"]`);
check('the confirmation names the cost', /costs 3 mandate/.test(await text(A, '.pol-conf')));
await A.click(`[data-act="pol-repeal"][data-k="${pick.k}"]`);
check('repealed: the mandate falls by 3', await until(async () => !(await localNation(A)).policies[pick.k]) && Math.abs((await A.evaluate(() => G.GV().md(G.S.nation))) - 7) < 0.05);
check('and it is listed as repealed this week, with a restore for 4', /Repealed by decree/.test(await text(A, '#gv-recent')) && /Restore… 4/.test(await text(A, `#gv-recent [data-act="gv-restore-ask"][data-k="${pick.k}"]`)));
check('the tutorial’s repeal mark is still set', await A.evaluate(() => G.S.nation.rpAt > 0));
await A.click(`[data-act="gv-restore-ask"][data-k="${pick.k}"]`); await A.click(`[data-act="gv-restore"][data-k="${pick.k}"]`);
check('restored by decree: back in force, the mandate down to 3', await until(async () => !!(await localNation(A)).policies[pick.k]) && Math.abs((await A.evaluate(() => G.GV().md(G.S.nation))) - 3) < 0.05);
check('the card now says it came back by decree', /Restored by decree/.test(await text(A, card + ' .gv-src')) && !await A.$(`#gv-recent [data-k="${pick.k}"]`));
check('policies that went another way are listed too (the toggles above)', /Second Chamber/.test(await text(A, '#gv-recent')) && /Repealed|Ended/.test(await text(A, '#gv-recent')));
check('two decrees on the leader’s record', await A.evaluate(() => G.S.nation.ldr.d) === 2);
check('the region hears of the restoration', await A.evaluate(() => G.S.nation.log.some(l => l.k === 'restore')));
check('with 3 left a repeal is still possible, but not twice', await A.evaluate(k => { const b = document.querySelector('[data-act="pol-repeal-ask"]'); return !!b && !b.disabled; }, pick.k));

// the budget: a region median on each bar, then an emergency shift for 3 mandate
await A.click('#gv-tab-budget');
check('the Budget tab shows each department beside the region median', await tab(A) === 'budget' && (await A.$$('#gv-bud .gv-med')).length === 12);
await A.selectOption('#gv-from', 'defence'); await A.selectOption('#gv-to', 'health');
check('the choice survives the redraw and previews the shift', await A.$eval('#gv-from', s => s.value) === 'defence' && /Defence .* → .*; Healthcare .* → /.test(await text(A, '.gv-shift-pv')) && /Public Health \+1, Militarism −1/.test(await text(A, '.gv-shift-pv')));
const b0 = await A.evaluate(() => { const n = G.S.nation, t = Object.values(n.budget).reduce((a, b) => a + b, 0); return { d: n.budget.defence / t * 100, h: n.budget.health / t * 100 }; });
await A.click('[data-act="gv-shift"]');
const b1 = await A.evaluate(() => { const n = G.S.nation, t = Object.values(n.budget).reduce((a, b) => a + b, 0); return { d: n.budget.defence / t * 100, h: n.budget.health / t * 100 }; });
check('five points move from defence to healthcare', b1.d < b0.d - 3 && b1.h > b0.h + 3 && /By decree, Defence gives 5 points/.test(await text(A, '#gv-shift .war-msg')));
check('the mandate is spent, and the button now waits', (await A.evaluate(() => G.GV().md(G.S.nation))) < 0.05 && await A.$eval('[data-act="gv-shift"]', b => b.disabled) && /Enough in/.test(await text(A, '#gv-shift')));
await A.click('#gv-tab-laws');
check('and a repeal must wait too', await A.$eval('[data-act="pol-repeal-ask"]', b => b.disabled) && /enough for a repeal in/.test(await text(A, '.pol-intro')));

// the cabinet: today's briefing, answered once; a quiet word for a restless minister
await A.click('#gv-tab-cabinet');
const st = await A.evaluate(() => G.GV().brief(G.S.nation, Date.now()));
check('today’s briefing comes from one minister with two answers', await shown(A, '#gv-brief') && (await A.$$('[data-act="gv-brief"]')).length === st.it.o.length && st.it.o.length >= 2);
await A.click('[data-act="gv-brief"][data-j="1"]');
check('answered: the briefing is settled for today and says what changed', await until(async () => !!(await localNation(A)).brf) && /settled/.test(await text(A, '#gv-brief')) && !await A.$('[data-act="gv-brief"]'));
check('and the dot on the tab is gone', !await A.$('#gv-tab-cabinet .gv-dot') || await A.evaluate(() => Object.values(G.S.nation.cab).some(m => m.lo < 20)));
const pf = await A.evaluate(() => { const n = G.clone(G.S.nation), k = Object.keys(n.cab).find(p => !n.cab[p].tr.includes('loyal') && !n.cab[p].tr.includes('honest')); n.cab[k].lo = 30; n.mdt = { v: 10, t: Date.now() }; G.commit(n); G.render(); return k; });
await A.evaluate(pf => { document.getElementById('cv-tog-' + pf)?.click(); }, pf);
check('a restless minister can be reassured, for 2 mandate', /Reassure\s*2/.test(await text(A, `.gv-calm[data-pf="${pf}"]`)));
await A.click(`.gv-calm[data-pf="${pf}"]`);
check('loyalty +15, the mandate −2', await A.evaluate(pf => G.S.nation.cab[pf].lo, pf) === 45 && Math.abs((await A.evaluate(() => G.GV().md(G.S.nation))) - 8) < 0.05 && /quiet word/.test(await text(A, '.cv-cab>.war-msg')));

// what is saved: the new fields stay in the private half
await A.evaluate(() => G.PG.saveSoon());
check('mandate, briefing, origins and the record are saved privately', await until(async () => { const d = await nationDoc(uid); return d && d.rec.mdt && d.rec.brf && d.rec.pso && d.rec.ldr && d.rec.aph && !('mdt' in d.shared) && !('brf' in d.shared) && !('pso' in d.shared); }, 15000));
await A.reload(); await ready(A); await A.waitForSelector('.layout');
check('and survive a reload', await A.evaluate(() => { const n = G.S.nation; return !!(n.mdt && n.brf && n.ldr && n.ldr.d === 3 && n.aph.length >= 1); }));

// visitors see another nation's cabinet: offices and names, never loyalty
await nav(A, 'region'); await A.click('.tbl [data-act="visit"]'); await A.waitForSelector('.gv-pub');
check('another nation’s page shows its cabinet', (await A.$$('.gv-pub-l li')).length === 8 && /Head of government/.test(await text(A, '.gv-pub')) && /Finance Minister/.test(await text(A, '.gv-pub')));
check('without loyalty or skill', !/Devoted|Steady|Restless|Plotting|Skill/.test(await text(A, '.gv-pub-l')));

// a phone: the tabs scroll sideways, the page does not
await A.setViewportSize({ width: 390, height: 844 }); await nav(A, 'government'); await A.click('#gv-tab-overview').catch(() => {});
check('on a phone the page never scrolls sideways', await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
check('and the tabs keep to one row', await A.$eval('.gv-tabs', e => getComputedStyle(e).flexWrap) === 'nowrap');
// arrow keys move between tabs
await A.focus('#gv-tab-overview'); await A.keyboard.press('ArrowRight');
check('arrow keys move along the tabs', await tab(A) === 'cabinet' && await A.evaluate(() => document.activeElement.id) === 'gv-tab-cabinet');
check('no page errors', !errors.length, errors.join('\n'));
await finish();
