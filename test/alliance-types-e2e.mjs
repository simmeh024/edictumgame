// Alliance types (emulators): a nation in one alliance of each type, as many as its people allow; the Alliance tab's
// four type tabs, each type's mark and look; a defence pact's war room and standing guard; a cultural union's festival;
// a seat refused when the people allow no more; a type put to the vote, passed, and the clash it makes, settled both
// ways (the member leaving the one that changed, the leader leaving the other); the code worn in chat; the map layers.
import { check, finish, until, player, open, found, nav, text, errors, clearEmulators, register, nationDoc, FS_HOST, PROJECT, OUT } from './lib.mjs';
const shot = (p, name) => p.screenshot({ path: OUT + '/altypes-' + name + '.png', fullPage: true }).catch(() => {});
await clearEmulators();
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
async function adminGet(path) { const r = await fetch(docUrl(path), { headers: owner }); return r.status === 200 ? r.json() : null; }
const alDoc = async aid => { const d = await adminGet('alliances/' + aid); return d ? d.fields : null; };
const ix = async uid => { const d = await adminGet('allyOf/' + uid); return d ? d.fields : null; };
const seatOf = (f, ty) => f?.s?.mapValue?.fields?.[ty]?.stringValue || '';
const shown = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
/* a nation of pop million people: the record and the saved figure the server checks */
async function grow(p, uid, pop) {
  for (let i = 0; i < 5; i++) {
    await fetch(docUrl('nations/' + uid) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: pop } } }) });
    await p.evaluate(pop => { const n = G.clone(G.S.nation); n.pop = pop; n.popAt = Date.now(); G.commit(n); }, pop);
    if (await until(async () => { const d = await nationDoc(uid); return d && d.rec && d.rec.pop >= pop - 0.1; }, 8000)) return true;
  }
  return false;
}
const tabTo = async (p, ty) => { await p.click(`.al-tyt [data-act="dp-alty"][data-v="${ty}"]`); await until(async () => (await p.evaluate(() => G.ALX().AL.ty)) === ty, 4000); };
const subTo = (p, v) => p.click(`.al-subs [data-act="dp-sub"][data-v="${v}"]`);
async function foundAl(p, ty, name, acc) {
  await tabTo(p, ty);
  await p.fill('#al-f-name', name);
  if (acc) await p.click(`[data-act="dp-acc"][data-pre="f"][data-v="${acc}"]`);
  await p.click('#al-form button[type="submit"]');
  return until(async () => /Your /.test(await text(p, '.al-head')) && (await text(p, '.al-head')).includes(name), 15000);
}
const mine = (p, ty) => p.evaluate(ty => { const A = G.ALX().seatsOf(G.myId())[ty]; return A ? A.id : ''; }, ty);

const A = await player('alty-a', { vp: { width: 1366, height: 900 } }), B = await player('alty-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Quorvale');
const ub = await open(B); await found(B, 'Thessily');
await register(A, { old: true }); await register(B, { old: true });
check('the first nation reaches 30 million (three seats)', await grow(A, ua, 30));
check('the second reaches 12 million (two seats)', await grow(B, ub, 12));

// the Alliance tab: four type tabs, each with its mark
await nav(A, 'diplomacy'); await A.click('#dp-tab-alliance');
await A.waitForSelector('.al-tyt');
check('four type tabs', JSON.stringify(await A.$$eval('.al-tyb .al-tyb-t b', b => b.map(x => x.textContent))) === JSON.stringify(['Defence pact', 'Trade bloc', 'Cultural union', 'Research accord']));
check('each tab carries its type’s mark', (await A.$$eval('.al-tyb svg.al-tym', s => s.map(x => [...x.classList].find(c => /^al-tym-/.test(c))))).join() === 'al-tym-def,al-tym-trade,al-tym-culture,al-tym-research');
check('an empty type explains itself and offers founding one of its kind', /Only a defence pact’s members fight beside each other/.test(await text(A, '.al-intro')) && /Found a defence pact/.test(await text(A, '.al-found')));
await shot(A, 'tabs');

// a defence pact, founded and joined
check('a defence pact is founded from its tab', await foundAl(A, 'def', 'The Iron Shield', 'open'));
const D = await mine(A, 'def');
check('its leader is its Marshal, and it wears the steel look', /Your defence pact · Marshal/.test(await text(A, '.al-head')) && await shown(A, '.al-th-def > .al-head'));
check('the index holds the seat of its type', seatOf(await ix(ua), 'def') === D);
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); await B.waitForSelector('.al-tyt');
check('the other player finds it under Defence pact', await until(async () => /The Iron Shield/.test(await text(B, '.al-cards2'))));
await B.click(`.al-cards2 [data-act="dp-join"][data-id="${D}"]`);
check('and joins it', await until(async () => seatOf(await ix(ub), 'def') === D, 12000));

// the war room: every member's army, and standing guard for an ally
await subTo(A, 'war');
check('the war room lists the members with their readiness', await until(async () => /readiness/.test(await text(A, '#al-pane-war')) && (await text(A, '#al-pane-war')).includes('Thessily'), 8000));
await A.click(`#al-pane-war [data-act="dp-guard"][data-id="${ub}"]`);
check('standing guard for an ally adds to its defence', await until(() => A.evaluate(ub => G.ALX().alGuardsOf(ub).includes(G.myId()), ub), 6000));
check('and is kept in the guard’s record', await until(async () => (await nationDoc(ua))?.rec?.alg?.to === ub, 20000));
await shot(A, 'war-room');

// a trade bloc and a cultural union: three seats for 30 million
check('a trade bloc is founded beside it', await foundAl(A, 'trade', 'The Amber Road', 'open'));
const T = await mine(A, 'trade');
check('the trade bloc wears the ledger look and has a Market', await shown(A, '.al-th-trade > .al-head') && await shown(A, '.al-subs [data-v="market"]'));
await tabTo(B, 'trade');
await B.click(`.al-cards2 [data-act="dp-join"][data-id="${T}"]`);
check('the other player joins it: a defence pact and a trade bloc', await until(async () => { const f = await ix(ub); return seatOf(f, 'def') === D && seatOf(f, 'trade') === T; }, 12000));
check('a cultural union is founded as the third', await foundAl(A, 'culture', 'The Lyre Union'));
const C = await mine(A, 'culture');
await subTo(A, 'festival');
check('its festival names the host in turn', await until(async () => /hosts it/.test(await text(A, '#al-pane-festival')) && /Hosts in turn/.test(await text(A, '#al-pane-festival')), 6000));
await shot(A, 'festival');
await tabTo(B, 'culture');
check('12 million people allow no third seat', /alliances its people allow/.test(await text(B, '#dp-p-alliance')) && !await B.$(`.al-cards2 [data-act="dp-join"][data-id="${C}"]`));

// the chat: a tab for each alliance's channel, each with its type's mark and its own count
const tabWords = p => p.$$eval('#rgc-tabs .rgc-tab-al', l => l.map(b => [b.id, b.querySelector('.rgc-tl')?.textContent, [...(b.querySelector('svg.al-tym')?.classList || [])].find(c => /^al-tym-/.test(c)) || '']));
await B.click('.rgc-btn'); await B.waitForSelector('#rgc-dock:not([hidden])');
check('a member of two alliances has a tab for each, in type order, the Diplomacy page showing neither type', await until(async () => JSON.stringify(await tabWords(B)) === JSON.stringify([['rgc-tab-ally', 'IS', 'al-tym-def'], ['rgc-tab-ally-trade', 'The Amber Road', 'al-tym-trade']]), 10000), JSON.stringify(await tabWords(B)));
check('and no switch buttons inside the channel', !(await B.$('.rgc-alsw')));
await A.click('.rgc-btn'); await A.waitForSelector('#rgc-dock:not([hidden])');
check('three alliances, three tabs', await until(async () => (await tabWords(A)).map(t => t[0]).join() === 'rgc-tab-ally-def,rgc-tab-ally-trade,rgc-tab-ally', 10000), JSON.stringify(await tabWords(A)));
await A.click('#rgc-tab-ally-trade');
check('choosing another alliance’s tab reads its channel there', await until(async () => /Only the members of The Amber Road read this channel/.test(await text(A, '#rgc-list')) && (await tabWords(A)).map(t => t[0]).join() === 'rgc-tab-ally-def,rgc-tab-ally,rgc-tab-ally-culture', 10000));
await A.fill('#rgc-ax', 'Caravans leave at dawn.'); await A.press('#rgc-ax', 'Enter');
check('a line in the channel not being read is counted on its own tab', await until(async () => (await text(B, '#rgc-tab-ally-trade .rgc-tn')).trim() === '1', 20000) && !(await B.$('#rgc-tab-ally .rgc-tn')));
await B.click('#rgc-tab-ally'); await B.fill('#rgc-ax', 'A draft for the shield');
await B.click('#rgc-tab-ally-trade');
check('one click reads it, and its count is gone', await until(async () => /Caravans leave at dawn/.test(await text(B, '#rgc-list')) && (await text(B, '#rgc-tab-ally .rgc-tl')) === 'The Amber Road' && !(await B.$('#rgc-tabs .rgc-tab-al .rgc-tn')), 10000));
check('each channel keeps its own draft', (await B.inputValue('#rgc-ax')) === '');
await B.keyboard.press('ArrowLeft');
check('the arrow keys move between the alliances’ tabs too', await until(async () => (await text(B, '#rgc-tab-ally .rgc-tl')) === 'IS' && await B.evaluate(() => document.activeElement?.id === 'rgc-tab-ally'), 6000));
check('and the draft is back in its own channel', await until(async () => (await B.inputValue('#rgc-ax')) === 'A draft for the shield', 4000));
await shot(B, 'chat-tabs');
await B.fill('#rgc-ax', ''); await B.click('#rgc-dock [data-rgc="close"]'); await A.click('#rgc-dock [data-rgc="close"]');
check('the drawers close again', await until(async () => !!(await A.$('#rgc-dock[hidden]')) && !!(await B.$('#rgc-dock[hidden]')), 4000));

// the code worn in chat: one of the player's alliances
await A.waitForSelector('.al-wear');
await A.click(`.al-wear [data-act="dp-wear"][data-aid="${C}"]`);
check('the player chooses the code it wears, and the server keeps it', await until(async () => (await ix(ua))?.a?.stringValue === C, 10000));

// a new type, put to the vote: the trade bloc becomes a defence pact, and both members already hold one
await tabTo(A, 'trade'); await subTo(A, 'charter');
await A.click('[data-act="dp-ty"][data-pre="ed"][data-v="def"]');
check('the charter warns who would have to choose', /2 members are already in another defence pact/.test(await text(A, '.al-types')));
await A.click('#al-charter button[type="submit"]');
check('with two members, the type goes to the vote', await until(async () => (await alDoc(T))?.tv?.mapValue?.fields?.ty?.stringValue === 'def', 10000));
check('the other member is asked to vote', await until(async () => /votes on becoming a defence pact/.test(await text(B, '.dp-wait')), 10000));
await shot(B, 'vote');
await B.click(`.dp-wait [data-act="dp-vote"][data-aid="${T}"][data-v="yes"]`);
check('more than half say yes: it is a defence pact', await until(async () => (await alDoc(T))?.ty?.stringValue === 'def', 10000));
check('both members are in a clash, the seat staying with the first', await until(async () => { const f = await ix(ub); return seatOf(f, 'def') === D && (f?.w?.mapValue?.fields?.def?.arrayValue?.values || []).some(v => v.stringValue === T); }, 10000));
check('the other member is told to choose which to leave', await until(async () => /You are in two|became a defence pact/.test(await text(B, '.dp-wait')), 10000));
await shot(B, 'clash');
// the member leaves the one that changed
await B.click(`.dp-wait [data-act="dp-clash-leave"][data-aid="${T}"]`);
check('leaving the one that changed settles it', await until(async () => { const f = await ix(ub); return seatOf(f, 'def') === D && !f?.w?.mapValue?.fields?.def; }, 10000));
// the leader leaves the other: the second takes the seat
await tabTo(A, 'def');
check('the leader sees its clash on the Defence pact tab', await until(async () => /You are in two defence pacts/.test(await text(A, '.al-clash')), 8000));
await A.click(`.al-clash [data-act="dp-clash-leave"][data-aid="${D}"]`);
check('leaving the first, the second takes the seat', await until(async () => seatOf(await ix(ua), 'def') === T, 10000));
check('and the old pact passes to the remaining member', await until(async () => (await alDoc(D))?.ld?.stringValue === ub, 10000));

// the nation card's four slots, and the map's layers
check('the nation card shows a slot for each type', await A.evaluate(id => { const h = G.ALX().alStripHTML(id); return /Lyre Union/.test(h) && /Amber Road/.test(h) && /No research accord/.test(h); }, ua));
await nav(A, 'map');
check('Map layers offer each type that has an alliance', await until(async () => /Defence pacts/.test(await text(A, 'main')) && /Cultural unions/.test(await text(A, 'main')), 8000));
/* each box redraws the map as it is ticked: click it, then read it afresh */
for (const t of ['def', 'culture']) { const box = () => A.locator(`input[data-mp-opt="al-${t}"]`).first(); if (!(await box().isChecked().catch(() => false))) await box().click(); await until(() => box().isChecked().catch(() => false), 4000); }
check('the layers draw, and the legend says how', await until(async () => /thick outlines/.test(await text(A, 'main')) && /soft wash/.test(await text(A, 'main')), 6000));
await shot(A, 'map');
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
