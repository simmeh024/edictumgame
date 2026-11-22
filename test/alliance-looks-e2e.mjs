// Alliance looks (emulators): the seat over the Alliance tab, the livery and the arms in the head, the banner's frame and
// its medallion as renown grows, a moment for the new level and for a project built (not for the player who built it),
// the projects as a plaza, the members as a court or a list, the chronicle and its illumination, the week's renown, the
// second colour and the arms saved from the charter, the web of rivalries, an invitation as a sealed letter, the channel
// dressed with its events, the call to arms as a war horn, the war table, the bloc's flows, the festival's bunting, the
// study's blueprint ring, and the public page; at desktop and phone widths.
import { check, finish, until, player, open, found, nav, text, errors, clearEmulators, register, nationDoc, sleep, FS_HOST, PROJECT, OUT } from './lib.mjs';
const shot = (p, name) => p.screenshot({ path: OUT + '/allooks-' + name + '.png', fullPage: true }).catch(() => {});
await clearEmulators();
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
async function adminGet(path) { const r = await fetch(docUrl(path), { headers: owner }); return r.status === 200 ? r.json() : null; }
async function adminPatch(path, fields) { const q = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&'); const r = await fetch(docUrl(path) + '?' + q, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields }) }); return r.ok; }
const alDoc = async aid => { const d = await adminGet('alliances/' + aid); return d ? d.fields : null; };
const shown = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
const count = (p, sel) => p.$$eval(sel, l => l.length).catch(() => 0);
async function grow(p, uid, pop) {
  for (let i = 0; i < 5; i++) {
    await fetch(docUrl('nations/' + uid) + '?updateMask.fieldPaths=pop', { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { pop: { doubleValue: pop } } }) });
    await p.evaluate(pop => { const n = G.clone(G.S.nation); n.pop = pop; n.popAt = Date.now(); G.commit(n); }, pop);
    if (await until(async () => { const d = await nationDoc(uid); return d && d.rec && d.rec.pop >= pop - 0.1; }, 8000)) return true;
  }
  return false;
}
const tabTo = async (p, ty) => { await p.click(`.al-tyt [data-act="dp-alty"][data-v="${ty}"]`); await until(async () => (await p.evaluate(() => G.ALX().AL.ty)) === ty, 4000); };
const subTo = async (p, v) => { await p.click(`.al-subs [data-act="dp-sub"][data-v="${v}"]`); await sleep(200); };
async function foundAl(p, ty, name, acc) {
  await tabTo(p, ty);
  await p.fill('#al-f-name', name);
  if (acc) await p.click(`[data-act="dp-acc"][data-pre="f"][data-v="${acc}"]`);
  await p.click('#al-form button[type="submit"]');
  return until(async () => /Your /.test(await text(p, '.al-head')) && (await text(p, '.al-head')).includes(name), 15000);
}
const mine = (p, ty) => p.evaluate(ty => { const A = G.ALX().seatsOf(G.myId())[ty]; return A ? A.id : ''; }, ty);
const moText = p => text(p, '#al-mo');
const moClose = async p => { await p.click('#al-mo [data-act="al-mo-x"]').catch(() => {}); await until(async () => !(await p.$('#al-mo')), 3000); };

const A = await player('allk-a', { vp: { width: 1366, height: 900 } }), B = await player('allk-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Quorvale');
const ub = await open(B); await found(B, 'Thessily');
await register(A, { old: true }); await register(B, { old: true });
check('the first nation reaches 55 million (four seats)', await grow(A, ua, 55));
check('the second reaches 12 million (two seats)', await grow(B, ub, 12));

// a defence pact: its seat, its livery and arms, no frame yet
await nav(A, 'diplomacy'); await A.click('#dp-tab-alliance'); await A.waitForSelector('.al-tyt');
check('a defence pact is founded', await foundAl(A, 'def', 'The Iron Shield', 'open'));
const D = await mine(A, 'def');
check('its seat is drawn over the tab: a fortress', await shown(A, '.al-seat-w svg.al-seat') && /fortress/.test(await A.getAttribute('.al-seat', 'aria-label')));
check('the head wears the livery in its two colours', await shown(A, '.al-head .al-livery') && await A.$eval('.al-head', el => !!el.style.getPropertyValue('--alc2')));
check('and the arms, with the type’s lions beside the shield', await shown(A, '.al-head-ar svg.cz-arms') && await A.evaluate(() => { const D = G.ALX().politics().al.get(G.ALX().seatsOf(G.myId()).def.id).doc; return G.ALX().alArmsSVG(D, { label: 'x' }).length > 500; }));
check('at level 1 the banner has no frame', !(await A.$('.al-head .al-bf')));
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); await B.waitForSelector('.al-tyt');
await until(async () => !!(await B.$(`.al-cards2 [data-act="dp-join"][data-id="${D}"]`)), 10000);
await B.click(`.al-cards2 [data-act="dp-join"][data-id="${D}"]`);
check('the other nation joins it', await until(async () => (await mine(B, 'def')) === D, 12000));
await A.evaluate(() => { window.EDICTUM_ALMO = true; }); await B.evaluate(() => { window.EDICTUM_ALMO = true; });
await B.evaluate(() => G.ALX().alTick()); await A.evaluate(() => G.ALX().alTick());
await shot(A, 'seat');

// the court: the Marshal on high, then the members; the list alone on request
check('the members stand as a court, the Marshal on high', await until(async () => await count(A, '.al-court .al-ct-p') === 2 && /Marshal/.test(await text(A, '.al-ct-top')), 8000));
check('the roll stays below it', /Thessily/.test(await text(A, '.al-mems')));
await A.click('.al-mv [data-v="list"]');
check('a list on request', !(await A.$('.al-court')) && await shown(A, '.al-mems'));
await A.click('.al-mv [data-v="court"]');
check('and the court again', await shown(A, '.al-court'));

// renown to level 5: a bronze frame and its medallion, and a moment for every member
check('the alliance reaches level 5', await adminPatch('alliances/' + D, { xp: { integerValue: 950 } }));
check('the banner takes a bronze frame with its medallion', await until(async () => await shown(A, '.al-head .al-bf-b.al-bf-lg') && (await text(A, '.al-head .al-bf-lv')) === 'V', 10000));
check('a moment for the new level, listing what it opens', await until(async () => /Level 5/.test(await moText(B)) && /bronze frame/.test(await moText(B)) && /more member places/.test(await moText(B)), 20000));
await shot(B, 'moment-level');
await moClose(B); await moClose(A);
check('closed, it does not come back', !(await B.$('#al-mo')) && (await B.evaluate(() => JSON.parse(localStorage.getItem('edictum.almo.' + G.ALX().seatsOf(G.myId()).def.id)).l)) === 5);

// the plaza: a building for every project; one built is seen by the other member as a moment
await subTo(A, 'treasury');
check('the treasury shows the plaza, a building for each project', await until(async () => await count(A, '.al-pz-i') === await A.evaluate(() => G.ALX().alPzKeys(G.ALX().seatsOf(G.myId()).def.doc).length) && await count(A, '.al-pz-i.plan') > 0, 8000));
await adminPatch('alliances/' + D, { tr: { mapValue: { fields: { timber: { integerValue: 400 }, goods: { integerValue: 400 }, iron: { integerValue: 400 }, oil: { integerValue: 400 }, food: { integerValue: 400 } } } } });
await until(async () => !(await A.$eval('[data-act="dp-build"][data-v="hall"]', b => b.disabled).catch(() => true)), 10000);
await A.click('[data-act="dp-build"][data-v="hall"]');
check('the Alliance Hall rises on the plaza', await until(async () => await shown(A, '.al-pz-i.built [data-v="hall"]'), 12000));
check('the seat grows with it: a keep', await until(async () => /grown with 1 level of the Alliance Hall/.test(await A.getAttribute('.al-seat', 'aria-label')), 8000));
check('the other member sees the ribbon cut', await until(async () => /Alliance Hall/.test(await moText(B)) && await shown(B, '#al-mo .al-mo-pj'), 20000));
await shot(B, 'moment-project');
await moClose(B);
await sleep(2500);
check('the builder gets no moment for its own build', !(await A.$('#al-mo')));
await A.click('.al-pz-b[data-v="hall"]');
check('a building opens its project’s card', await until(() => A.evaluate(() => document.activeElement && document.activeElement.id === 'al-pj-hall'), 3000));
await shot(A, 'plaza');

// the chronicle, illuminated by the Hall of Chronicles; the week's renown from the tallies
await subTo(A, 'history');
check('the history is a chronicle: founding marked large', await until(async () => await shown(A, '.al-chr .al-chr-e.k-found.big') && /founded The Iron Shield/.test(await text(A, '.al-log')), 6000));
check('with the Hall of Chronicles’ invitation to illuminate it', /Build the Hall of Chronicles/.test(await text(A, '.al-chr-w')));
const log = (await alDoc(D)).log.arrayValue.values || [];
const tally = (d, x, b) => ({ mapValue: { fields: { t: { integerValue: Date.now() - d * 86400000 }, k: { stringValue: 'tally' }, a: { stringValue: '' }, x: { stringValue: String(x) }, b: { stringValue: JSON.stringify(b) } } } });
await adminPatch('alliances/' + D, { log: { arrayValue: { values: [tally(0.2, 24, { active: 2, deals: 1 }), tally(1.2, 18, { active: 2, gifts: 1 }), tally(8, 10, { active: 1 }), ...log] } }, pj: { mapValue: { fields: { hall: { integerValue: 1 }, chronicle: { integerValue: 3 } } } } });
check('three levels of the Hall of Chronicles: the parchment and its title', await until(async () => await shown(A, '.al-chr-ill3 .al-chr-title') && /The Chronicle of The Iron Shield/.test(await text(A, '.al-chr-title')), 10000));
check('the head counts this week’s renown, against the week before', await until(async () => /42 renown this week/.test(await text(A, '.al-wk')) && /up from 10/.test(await text(A, '.al-wk')) && /2 deals|1 deal/.test(await text(A, '.al-wk')), 8000));
await shot(A, 'chronicle');
await moClose(A); await moClose(B);

// the charter: a second colour and arms of the alliance's own
await subTo(A, 'charter');
await A.click('[data-act="dp-ac"][data-pre="al-ed"]:not([data-v=""])');
const ac = await A.$eval('[data-act="dp-ac"][data-pre="al-ed"].on', b => b.dataset.v);
await A.selectOption('#al-arm-c', 'lion'); await A.selectOption('#al-arm-t0', 'gules');
check('the arms’ preview follows the designer', await until(async () => await shown(A, '.al-arf-pv svg.cz-arms'), 3000));
await A.click('#al-charter button[type="submit"]');
check('the second colour and the arms are saved', await until(async () => { const f = await alDoc(D); return f?.ac?.stringValue === ac && f?.ar?.mapValue?.fields?.c?.stringValue === 'lion' && f.ar.mapValue.fields.t.arrayValue.values[0].stringValue === 'gules'; }, 10000));
check('and worn by the head', await until(async () => (await A.$eval('.al-head', el => el.style.getPropertyValue('--alc2')).catch(() => '')).toUpperCase() === ac.toUpperCase(), 8000));

// the channel: its band, titles in colour, and its events between the messages
await subTo(B, 'channel');
await B.fill('#al-chat-x', 'Shields up, friends.'); await B.click('#al-chat-form button[type="submit"]');
await subTo(A, 'channel');
await A.fill('#al-chat-x', 'Stand fast.'); await A.click('#al-chat-form button[type="submit"]');
check('the channel wears the alliance’s band', await until(async () => await shown(A, '.al-chh') && /The Iron Shield/.test(await text(A, '.al-chh')), 8000));
check('the Marshal’s line in its title’s colour', await until(async () => await shown(A, '.al-msg.al-r-ld .al-msg-r') && /Marshal/.test(await text(A, '.al-msg.al-r-ld')), 10000));
check('the events stand between the messages', await until(async () => await count(A, '#al-chat .al-ev') >= 2 && /joined/.test(await text(A, '#al-chat')) && /Shields up/.test(await text(A, '#al-chat')), 10000));
await shot(A, 'channel');

// the web: a second alliance named a rival
check('a trade bloc is founded as well', await foundAl(A, 'trade', 'The Amber Road', 'invite'));
const T = await mine(A, 'trade');
await tabTo(A, 'def'); await subTo(A, 'relations');
check('the web holds both alliances', await until(async () => await count(A, '.al-web .al-web-n') === 2, 8000));
await A.click(`[data-act="dp-ar-rival"][data-id="${T}"]`);
check('a rivalry is a jagged red line', await until(async () => await shown(A, '.al-web path.al-web-e.rival.mine'), 10000));
await shot(A, 'web');

// an invitation as a sealed letter
await tabTo(A, 'trade'); await subTo(A, 'invite');
await until(async () => !!(await A.$(`.al-cand [data-act="al-invite"][data-id="${ub}"]`)), 8000);
await A.click(`.al-cand [data-act="al-invite"][data-id="${ub}"]`);
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); await tabTo(B, 'trade');
check('the invitation waits in its envelope under the seal', await until(async () => await shown(B, '.al-ltr:not(.open) .al-ltr-wax') && /From The Amber Road/.test(await text(B, '.al-ltr')), 12000));
check('the strip carries the seal too', await shown(B, '.dp-wait .k-inv .al-seal'));
await shot(B, 'letter-sealed');
await B.click('.al-ltr [data-act="al-ltr-open"]');
check('broken, it opens on the invitation and its Join', await until(async () => await shown(B, '.al-ltr.open .al-ltr-sheet [data-act="dp-join"]'), 4000) && /invites Thessily to join The Amber Road/.test(await text(B, '.al-ltr-sheet')));
await sleep(1800); await shot(B, 'letter-open');
await B.click('.al-ltr-sheet [data-act="dp-join"]');
check('and the nation joins', await until(async () => (await mine(B, 'trade')) === T, 12000));
await tabTo(A, 'trade'); await subTo(A, 'market');
check('the bloc’s flows: both members in the ring', await until(async () => await count(A, '.al-flow .al-fl-n') === 2, 8000));

// the cultural union's bunting, the research accord's blueprint ring
check('a cultural union is founded', await foundAl(A, 'culture', 'The Lyre Union', 'open'));
await subTo(A, 'festival');
check('its festival card hangs bunting', await shown(A, '.al-fest .al-bunt'));
check('a research accord is founded', await foundAl(A, 'research', 'The Lantern Accord', 'open'));
check('its seat is an observatory', /observatory/.test(await A.getAttribute('.al-seat', 'aria-label')));
await subTo(A, 'studies');
check('its studies stand on a blueprint ring', await shown(A, '.al-study svg.al-sring'));
await shot(A, 'studies');

// the call to arms: the war horn, the land fought over, the flags filling in; the war table
const npc = await B.evaluate(() => G.allNations().find(x => x.npc && !G.ALX().politics().of.get(x.id))?.id);
await B.evaluate(id => { const n = G.clone(G.S.nation); n.wars = { ...(n.wars || {}), [id]: { t: Date.now(), by: 1 } }; G.commit(n); }, npc);
await nav(A, 'diplomacy');
check('the war horn sounds over the Diplomacy page', await until(async () => await shown(A, '.al-horn') && /attacked Thessily/.test(await text(A, '.al-horn')), 20000));
check('with the time under attack and an empty flag for each ally', /Under attack for/.test(await text(A, '.al-horn')) && await count(A, '.al-horn .al-hn-f:not(.on)') === 1);
check('and the land they fight over', await shown(A, '.al-horn svg.al-mm'));
await shot(A, 'horn');
await A.click('#dp-tab-alliance'); await tabTo(A, 'def'); await subTo(A, 'war');
check('the war table: a token for each member’s army', await until(async () => await count(A, '.al-wtable .al-wt-tk') === 2, 8000));
await shot(A, 'wartable');

// the public page
await B.evaluate(id => G.ALX().alOpenPage(id), D);
check('the public page: the seat, the court and the chronicle', await until(async () => await shown(B, '.alp .al-seat') && await shown(B, '.alp .al-court') && await shown(B, '.alp .al-chr'), 10000));
check('and the plaza of what it has built', await shown(B, '.alp .al-plaza .al-pz-i.built'));
await shot(B, 'public');

// the phone
await A.setViewportSize({ width: 390, height: 844 }); await nav(A, 'diplomacy'); await A.click('#dp-tab-alliance'); await tabTo(A, 'def'); await subTo(A, 'members');
check('on a phone nothing runs off the side', await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await shot(A, 'phone');

check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await finish();
