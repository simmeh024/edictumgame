// Supply Caches between players: on another player's nation page, Send Supply Cache packs up to 300 materials in any
// mix with a message; the materials leave the sender's stockpile, the server files the cache, and the other nation opens
// it on the Diplomacy page's Gifts tab: a crate whose contents go into its stockpile once, with the message. Only a Registered
// Nation (a linked sign-in) sends, and any nation, guests too, receives; three a day; a nation sends from a day after its founding; a cache the server
// refuses comes back.
import { BASE, player, open, found, until, check, finish, text, nav, restListAdmin, clearEmulators, sleep, register, OUT } from './lib.mjs';
import path from 'node:path';
await clearEmulators();
const RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const stock = p => p.evaluate(() => { const n = G.S.nation, st = G.WH.stockNow(n, Date.now()); return Object.fromEntries(['food', 'timber', 'iron', 'oil', 'goods'].map(r => [r, Math.floor((st[r] || 0) + 1e-6)])); });
const visit = (p, id) => p.evaluate(id => { G.S.visit = id; G.S.view = 'visit'; G.render(); }, id);
const sees = (p, id) => until(() => p.evaluate(id => G.allNations().some(x => x.id === id), id), 30000);
const docs = async () => (await restListAdmin('supply')).map(d => ({ id: d.id, f: d.fields.f?.stringValue, to: d.fields.to?.stringValue, m: d.fields.m?.stringValue, q: Number(d.fields.q?.integerValue || 0), o: Number(d.fields.o?.integerValue || d.fields.o?.doubleValue || 0) }));
/* every notice shown, in order (they queue: a reward's can come first), as the notices suite records them */
const watch = p => p.ctx.addInitScript(() => { window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true })); });
const toastHas = (p, re) => until(() => p.evaluate(src => (window.__toasts || []).some(t => new RegExp(src).test(t)), re.source), 30000);

const A = await player('sender'), B = await player('recipient');
await watch(A); await watch(B);
const uidA = await open(A); await found(A, 'Cachemark');
const uidB = await open(B); await found(B, 'Receivia');
check('the sender sees the recipient in its region', await sees(A, uidB));

// the nation page
await visit(A, uidB);
await A.waitForSelector('[data-act="sc-send-open"]');
check('a player’s nation page has a Send Supply Cache button', /^Send Supply Cache/.test(await text(A, `[data-act="sc-send-open"][data-id="${uidB}"]`)));
await visit(B, uidB).catch(() => {});
check('not on one’s own page, nor on a computer nation’s', await B.evaluate(() => !document.querySelector('[data-act="sc-send-open"]'))
  && await A.evaluate(() => { const npc = G.allNations().find(x => x.npc); G.S.visit = npc.id; G.render(); return !document.querySelector('[data-act="sc-send-open"]'); }));
// a Guest Nation: the button is locked, and says why
await visit(A, uidB);
check('a Guest Nation sees the button locked', await A.evaluate(() => !!document.querySelector('[data-act="sc-send-open"] .sc-lock')));
await A.click('[data-act="sc-send-open"]');
check('and is told to link a sign-in account first', await toastHas(A, /sent by Registered Nations\. Link a sign-in account/) && await A.evaluate(() => !document.getElementById('sc-dlg')));
// linked, and two days old to the server (its founding, as accountIdentity keeps it)
await register(A, { old: true });
check('a Registered Nation’s game knows it', await until(() => A.evaluate(() => G.SC().linked()), 20000));
await visit(A, uidB);
check('and the lock is gone', (await text(A, `[data-act="sc-send-open"][data-id="${uidB}"]`)) === 'Send Supply Cache');
await A.click('[data-act="sc-send-open"]');
await A.waitForSelector('#sc-dlg [role="dialog"]');
check('the dialog names the nation and the limits', /Send a Supply Cache to Receivia/.test(await text(A, '#scd-h')) && /Up to 300 materials in any mix/.test(await text(A, '#sc-dlg')) && /3 of 3 caches left today/.test(await text(A, '#sc-dlg')));
check('one field for each of the five resources, and the send button waits', (await A.$$('#sc-dlg .sc-in')).length === 5 && await A.$eval('#sc-send', b => b.disabled));
await A.fill('#sc-q-goods', '301');
check('over 300 the dialog says so and will not send', await until(async () => /over the limit of 300/.test(await text(A, '#sc-why'))) && await A.$eval('#sc-send', b => b.disabled));
await A.fill('#sc-q-goods', '');
const a0 = await stock(A), give = { goods: Math.min(40, a0.goods), iron: Math.min(15, a0.iron), food: Math.min(25, a0.food) };
for (const [k, v] of Object.entries(give)) await A.fill('#sc-q-' + k, String(v));
await A.fill('#sc-m', 'Welcome to the region, neighbour!');
const total = give.goods + give.iron + give.food;
check('the total adds up as it is typed', (await text(A, '#sc-tot')) === String(total) && (await text(A, '#sc-mc')).startsWith('33 /'));
await A.screenshot({ path: path.join(OUT, 'supply-dialog.png') });
/* the materials leave in the click itself (the commit comes before any wait): read the stockpile on either side of it, as a
   reward from elsewhere (a tutorial task, the desk) can land a few seconds later */
const aPre = await stock(A);
await A.click('#sc-send');
const a1 = await stock(A);
check('sending closes the dialog and says it is on its way', await until(() => A.evaluate(() => !document.getElementById('sc-dlg')), 30000) && await toastHas(A, /on its way to Receivia|is packed/));
check('the server files it, with the message', await until(async () => (await docs()).some(d => d.f === uidA && d.to === uidB && d.q === total && d.m === 'Welcome to the region, neighbour!'), 30000), JSON.stringify(await docs()));
check('the sender’s record marks it filed, without the message', await until(() => A.evaluate(() => (G.S.nation.scx || []).length === 1 && G.S.nation.scx[0].k === 1 && !JSON.stringify(G.S.nation.scx).includes('neighbour')), 20000));
check('the materials left the sender’s stockpile', Object.entries(give).every(([k, v]) => aPre[k] - a1[k] >= v - 1 && aPre[k] - a1[k] <= v + 1), JSON.stringify([aPre, a1, give]));
check('Special Delivery is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-sc1'])), 20000));

// the recipient
check('the cache reaches the recipient', await until(() => B.evaluate(() => G.SC().scWaiting(Date.now()).length === 1), 30000));
check('a notice says who sent it', await toastHas(B, /Cachemark sent you a Supply Cache of \d+ materials/));
check('the bell tells of it', await B.evaluate(() => G.NEWS.bell().ev.some(x => x.k === 'supply' && /Cachemark sent you a Supply Cache/.test(x.txt))));
await nav(B, 'diplomacy'); await B.click('#dp-tab-gifts');
await B.waitForSelector('#sc-sec');
check('the Gifts tab counts it and lists it first', /1 to open/.test(await text(B, '#dp-tab-gifts') + ' ' + await text(B, '#sc-h2')) && /Waiting to be opened/.test(await text(B, '#sc-sec')) && /and a message/.test(await text(B, '#sc-sec')));
check('the message stays sealed until it is opened', !/neighbour/.test(await text(B, '#sc-sec')));
check('a Guest Nation is told who sends caches, that anyone receives them, and how to link', /Registered Nations send Supply Caches/.test(await text(B, '#sc-sec')) && /Anyone can receive and open them/.test(await text(B, '#sc-sec')) && !!(await B.$('#sc-sec [data-act="acct-open"]')));
const b0 = await stock(B);
await B.click('[data-act="sc-crate"]');
await B.waitForSelector('#sc-crate #scc-box');
check('a crate to open', /From Cachemark/.test(await text(B, '#scc-h')));
await B.click('#scc-box');
check('it opens', await until(() => B.evaluate(() => document.getElementById('sc-crate')?.classList.contains('open')), 20000));
check('with the contents and the message', /\+40|\+\d+/.test(await text(B, '#scc-items')) && /Welcome to the region, neighbour!/.test(await text(B, '#scc-note')) && /Cachemark/.test(await text(B, '#scc-note')));
await sleep(700);
await B.screenshot({ path: path.join(OUT, 'supply-crate.png') });
const b1 = await stock(B);
check('the contents go into the recipient’s stockpile', Object.entries(give).every(([k, v]) => b1[k] - b0[k] >= v - 1), JSON.stringify([b0, b1, give]));
check('the server marks it opened', await until(async () => (await docs()).some(d => d.to === uidB && d.o > 0), 15000));
check('Care Package is earned', await until(() => B.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-scin1'])), 20000));
await B.click('#scc-ok');
check('it moves to Opened, with the message', await until(async () => /Opened/.test(await text(B, '#sc-sec')) && /neighbour/.test(await text(B, '#sc-sec')) && !/Waiting to be opened/.test(await text(B, '#sc-sec'))));

// opened twice pays once, also after a reload
const id = (await docs())[0].id;
await B.reload(); await B.waitForSelector('.layout'); await until(() => B.evaluate(() => !!(window.G && G.S.nation && G.SC().SC.inReady)), 20000);
const b2 = await stock(B);
const again = await B.evaluate(id => window.claude.use('civic').then(c => c.request({ op: 'scOpen', id })), id);
await B.evaluate(id => { G.SC().SC.crate = id; }, id);
check('a second opening is not the first, and pays nothing', again.first === false && await B.evaluate(() => G.SC().scWaiting(Date.now()).length === 0) && (await stock(B)).goods - b2.goods <= 1);

// the sender sees it opened
await nav(A, 'diplomacy'); await A.click('#dp-tab-gifts');
check('the sender’s Gifts tab shows it opened', await until(async () => /Sent/.test(await text(A, '#sc-sec')) && /opened/.test(await text(A, '#sc-sec')), 20000), await text(A, '#sc-sec'));

// three a day
const sendOne = async (r) => { await visit(A, uidB); await A.click('[data-act="sc-send-open"]'); await A.waitForSelector('#sc-dlg'); await A.fill('#sc-q-food', String(r)); await A.click('#sc-send'); await until(() => A.evaluate(() => !document.getElementById('sc-dlg')), 30000); };
await sendOne(1); await sendOne(2);
check('three caches filed today', await until(async () => (await docs()).filter(d => d.f === uidA).length === 3, 30000));
await visit(A, uidB); await A.click('[data-act="sc-send-open"]');
check('a fourth is refused until the day ends', await toastHas(A, /You have sent 3 Supply Caches today/) && await A.evaluate(() => !document.getElementById('sc-dlg')));
check('Full Manifest is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach && G.S.nation.ach['dip-scday'])), 20000));

// a cache the server refuses comes back (one packed for a nation not in the region)
const before = await stock(A);
await A.evaluate(() => { const n = G.clone(G.S.nation); n._sc = { id: 'zzzz0001', to: 'no-such-nation', r: { food: 5 } }; G.commit(n); });
const r = await A.evaluate(() => G.SC().scFile('zzzz0001', true));
check('the server refuses it, and its materials come back', r.startsWith('back:') && await A.evaluate(() => !(G.S.nation.scx || []).some(e => e.id === 'zzzz0001')) && (await stock(A)).food >= before.food - 1, r);

// a nation founded today waits a day
const C = await player('young');
await watch(C);
await open(C); await found(C, 'Youngland'); await register(C);
await until(() => C.evaluate(() => G.SC().linked()), 20000);
check('the young nation sees the recipient', await sees(C, uidB));
await visit(C, uidB); await C.click('[data-act="sc-send-open"]');
check('a Registered Nation founded today is told to wait a day', await toastHas(C, /a day after its founding/) && await C.evaluate(() => !document.getElementById('sc-dlg')));

await finish();
