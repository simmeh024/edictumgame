// Border agreements (emulators): two Registered Nations of one region. One draws a border on the map (the Treaties tab's
// "Draw the border on the map", the painter, a fair split, a buffer, a sea hex) and sends it; the other draws it again
// and sends it back (a counter-proposal); the first accepts, so it is in force: on both Treaties tabs, the map's key, the
// Assembly's register and as a card in the region chat. A hex swap is offered and accepted, and each side cedes its own
// hex. Last, a claim on the other's side asks first and, claimed anyway, breaks the agreement, costing goodwill.
import { OUT, check, finish, until, player, open, found, nav, text, register, establish, clearEmulators, restListAdmin, errors } from './lib.mjs';
await clearEmulators();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = await player('bd-a', { vp: { width: 1280, height: 900 } }), B = await player('bd-b', { vp: { width: 1280, height: 900 } });
const ua = await open(A); await found(A, 'Westerlund'); await establish(A);
const ub = await open(B); await found(B, 'Easterlund'); await establish(B);
await register(A, { old: true }); await register(B, { old: true });
check('both nations are in one region', await until(async () => await A.evaluate(ub => !!G.S.world[ub], ub) && await B.evaluate(ua => !!G.S.world[ua], ua), 20000));
const field = (doc, k) => doc?.fields?.[k];
const borders = async () => {
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}/v1/projects/demo-edictum/databases/(default)/documents/borders`, { headers: { authorization: 'Bearer owner' } });
  return ((await r.json()).documents || []);
};
const one = async () => (await borders())[0] || null;
const stOf = async () => field(await one(), 'st')?.stringValue || '';

// drawing: the Treaties tab opens the painter on the map
const openTreaties = async p => { await nav(p, 'diplomacy'); await p.click('#dp-tab-treaties'); await sleep(200); };
await openTreaties(A);
check('the Treaties tab has a Border agreements section', await until(async () => /Border agreements/.test(await text(A, '.bd-sec')), 10000));
await A.click(`input[name="bd-pick"][value="${ub}"]`);
await until(async () => !!await A.$('[data-act="bd-draw"]:not([disabled])'), 5000);
await A.click('[data-act="bd-draw"]');
check('the map opens with the painter', await until(async () => /Draw the border with Easterlund/.test(await text(A, '.bd-ed')), 10000));
/* whether there is free land both can reach depends on where the two were placed: the button gives what the split finds.
   The split can also find land on one side only, each free hex going to the nation nearer it (on CI, 21 Nov 2026, it did
   and the test, expecting "no free land", failed): that land is shared out to that side, with no message. */
const canShare = await until(async () => await A.evaluate(ub => { const F = G.BDX().bdFair([G.S.uid, ub]); return !!F && Object.values(F.s).every(x => x.length > 0); }, ub), 15000);
const split = await A.evaluate(() => { const D = G.BDX().draft(), F = G.BDX().bdFair(D.p); return F ? D.p.map(id => F.s[id].length).concat(F.buf.length) : null; });
await A.evaluate(() => document.querySelector('[data-act="bd-fair"]').click()); await sleep(300);
const fair = await A.evaluate(() => { const D = G.BDX().draft(); return D.p.map(id => D.s[id].size).concat(D.buf.size); });
const said = await text(A, '.bd-ed');
if (canShare) check('a fair split shares out the land between the two', fair[0] > 0 && fair[1] > 0, JSON.stringify(fair));
else if (split && split.some(x => x > 0)) check('with free land near one of them only, the fair split shares out what it finds', fair.some(x => x > 0) && split.every((x, k) => x > 0 || fair[k] === 0), JSON.stringify({ split, fair }));
else check('with no free land between them, the fair split says so', /No free land lies between you/.test(said), JSON.stringify({ split, fair, said: said.slice(0, 200) }));
await A.screenshot({ path: OUT + '/borders-fair.png' });
await A.evaluate(() => document.querySelector('[data-act="bd-clear"]').click());
const frontA = await A.evaluate(() => G.BDX().frontier().slice(0, 1));
const mine = await A.evaluate(ua => G.BDX().free(ua, 6), ua), theirs = await A.evaluate(ub => G.BDX().free(ub, 6), ub), sea = await A.evaluate(ua => G.BDX().water(ua), ua);
const theirsAll = [...new Set([...theirs, ...frontA])].filter(c => !mine.includes(c) || frontA.includes(c));
const mineOnly = mine.filter(c => !theirsAll.includes(c));
await A.evaluate(({ mineOnly, theirsAll, sea, ua, ub }) => {
  const X = G.BDX(); for (const c of mineOnly) X.paint(c, ua); for (const c of theirsAll) X.paint(c, ub); if (sea >= 0) X.paint(sea, ua);
  X.paint(mineOnly[mineOnly.length - 1], 'buf');
}, { mineOnly, theirsAll, sea, ua, ub });
check('the painter counts each side and the buffer', await until(async () => /hexes painted/.test(await text(A, '.bd-ed')), 4000) && await A.evaluate(() => { const D = G.BDX().draft(); return D.buf.size === 1 && D.p.every(id => D.s[id].size > 0); }));
await A.screenshot({ path: OUT + '/borders-painter.png' });
await A.click('[data-act="bd-send"]');
check('sent: the proposal is on the server, accepted by its sender only', await until(async () => await stOf() === 'offered', 10000)
  && (field(await one(), 'acc')?.arrayValue?.values || []).length === 1);

// a counter-proposal
await openTreaties(B);
check('the other side sees it waiting, with a drawing', await until(async () => /With Westerlund/.test(await text(B, '.bd-sec')) && !!await B.$('.bd-sec .bd-mini svg'), 10000));
await B.click('.bd-sec [data-act="bd-redraw"]');
check('drawing it again opens the painter on its version', await until(async () => /counter-proposal/.test(await text(B, '.bd-ed')), 10000));
const extra = await B.evaluate(ub => G.BDX().free(ub, 12).filter(c => { const D = G.BDX().draft(); return !D.p.some(id => D.s[id].has(c)) && !D.buf.has(c); })[0], ub);
await B.evaluate(({ extra, ub }) => G.BDX().paint(extra, ub), { extra, ub });
await B.click('[data-act="bd-send"]');
check('sent back: version 2, accepted by its sender only', await until(async () => field(await one(), 'v')?.integerValue === '2' && (field(await one(), 'acc')?.arrayValue?.values || []).map(x => x.stringValue).join() === ub, 10000));
await openTreaties(A);
check('the first side sees the new version', await until(async () => /Version 2, drawn by Easterlund/.test(await text(A, '.bd-sec')), 10000));
await A.click('.bd-sec [data-act="bd-yes"]');
check('accepted by all: in force', await until(async () => await stOf() === 'active', 10000));
await openTreaties(B);
check('both Treaties tabs say so', await until(async () => /In force since/.test(await text(A, '.bd-sec')), 10000) && await until(async () => /In force since/.test(await text(B, '.bd-sec')), 10000));

// on the map, in the register, in the chat
await nav(A, 'map');
check('the map key can show agreed borders', await until(async () => !!await A.$('input[data-mp-opt="borders"]'), 8000));
check('its hexes are indexed for the map and the claim check', await A.evaluate(({ ub, c }) => G.BDX().bdBars(c, G.S.uid).some(x => x.side === ub), { ub, c: theirsAll[0] }));
await A.screenshot({ path: OUT + '/borders-map.png' });
await nav(A, 'assembly');
check('the Assembly keeps a register of borders', await until(async () => /Register of borders/.test(await text(A, '.bd-reg')), 15000));
await openTreaties(A);
await A.click('.bd-sec [data-act="bd-chat"]');
const reg = await A.evaluate(() => G.S.nation.reg);
const cards = async () => (await restListAdmin('rchat/' + reg + '/chat')).filter(d => d.fields?.cd?.mapValue?.fields?.k?.stringValue === 'border').length;
check('posted in the region chat as a card', await until(async () => await cards() > 0, 15000));

// a swap: a hex of each. A gives one that does not border the hex it claims across the line below (frontA[0]): the
// lowest of its hexes often does, and given away it could take that hex out of A's reach, so the claim was refused and
// never broke the agreement (CI, 21 Nov 2026, when no other hex of A's bordered it)
const giveA = await A.evaluate(([ua, c]) => { const M = G.MAP, h = G.BDX().held(ua), nb = x => { const o = []; for (let d = 0; d < 6; d++) { const j = M.nbr[x * 6 + d]; if (j >= 0) o.push(j); } return o; }; return h.find(x => !nb(x).includes(c)) ?? h[0]; }, [ua, frontA[0]]);
const takeB = (await A.evaluate(ub => G.BDX().held(ub), ub))[0];
if (giveA != null && takeB != null) {
  await nav(A, 'map');
  await A.evaluate(({ giveA, takeB, ub }) => { const X = G.BDX(); X.BD.sw = { give: giveA, take: takeB, to: ub }; X.ui(); }, { giveA, takeB, ub });
  check('the swap waits to be offered', await until(async () => /Swap hexes/.test(await text(A, '.bd-ed')), 8000));
  await A.click('[data-act="bd-sw-send"]');
  check('offered: on the agreement', await until(async () => (field(await one(), 'sw')?.arrayValue?.values || []).length === 1, 10000));
  await openTreaties(B);
  await until(async () => !!await B.$('[data-act="bd-sw-yes"]'), 10000);
  await B.click('[data-act="bd-sw-yes"]');
  check('accepted: each side cedes its own hex', await until(async () => await A.evaluate(({ giveA, ub }) => (G.S.nation.bx || []).some(e => e.c === giveA && e.to === ub), { giveA, ub })
    && await B.evaluate(({ takeB, ua }) => (G.S.nation.bx || []).some(e => e.c === takeB && e.to === ua), { takeB, ua }), 20000));
} else check('both nations hold a hex to swap', false, JSON.stringify({ giveA, takeB }));

// a claim past the line: asked first, then breaking it
const cross = theirsAll.find(c => frontA.includes(c)), onFront = cross != null && (await A.evaluate(() => G.BDX().frontier())).includes(cross);
if (cross != null && onFront && await A.evaluate(() => G.BDX().credits()) > 0) {
  await nav(A, 'map');
  await A.evaluate(c => G.BDX().claim([c]), cross);
  check('a claim on their side asks first', await until(async () => /crosses an agreed border/.test(await text(A, '.bd-ask')), 8000));
  await A.screenshot({ path: OUT + '/borders-ask.png' });
  const gw0 = await A.evaluate(ub => (G.S.nation.gw || {})[ub] || 0, ub);
  /* by the element: the panel can lay itself out again under the pointer, onto the button beside it */
  await A.evaluate(() => document.querySelector('[data-act="bd-claim-anyway"]').click());
  check('claimed anyway, the agreement is broken by it', await until(async () => await stOf() === 'broken' && field(await one(), 'by')?.stringValue === ua, 15000), await A.evaluate(() => G.S.mapMsg || ''));
  check('and goodwill with the other side is lost', await until(async () => await A.evaluate(ub => (G.S.nation.gw || {})[ub] || 0, ub) <= gw0 - 10, 8000));
} else check('a frontier hex on their side, and a credit to claim it', false, JSON.stringify({ cross, onFront, credits: await A.evaluate(() => G.BDX().credits()) }));
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
