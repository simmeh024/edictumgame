// Relations between alliances (emulators): two leaders, each with an alliance of their own (written straight to the
// emulator, as functions/alliances.js keeps them), on the Alliance tab's Relations: a pact offered by one and accepted
// by the other from the waiting strip, shown on both lists, in the Region's ranking and on the public page, and
// barring war between their members; the pact under notice, then broken at a cost in renown, in both histories; a
// rivalry named by one and seen by the other, who may name it back.
import { OUT, FS_HOST, PROJECT, check, finish, until, player, open, found, nav, text, register, regionTab, clearEmulators, errors } from './lib.mjs';
await clearEmulators();
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = path => `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
const v = x => typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : Number.isInteger(x) ? { integerValue: String(x) }
  : typeof x === 'number' ? { doubleValue: x } : Array.isArray(x) ? { arrayValue: { values: x.map(v) } } : { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
const put = (path, o) => fetch(docUrl(path), { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, v(x)])) }) });
const get = async path => { const r = await fetch(docUrl(path), { headers: owner }); return r.status === 200 ? (await r.json()).fields : null; };
const relOf = async (aid, to) => (await get('alliances/' + aid))?.rel?.mapValue?.fields?.[to]?.mapValue?.fields || null;
const st = async (aid, to) => (await relOf(aid, to))?.st?.stringValue || '';

const A = await player('arel-a', { vp: { width: 1280, height: 900 } }), B = await player('arel-b', { vp: { width: 1280, height: 900 } });
const ua = await open(A); await found(A, 'Northmark');
const ub = await open(B); await found(B, 'Southmark');
await register(A, { old: true }); await register(B, { old: true });
const reg = await A.evaluate(() => G.S.nation.reg), now = Date.now(), em = { p: 'bi-h', c: ['#1C4D9E', '#F2C230', '#FFFFFF'], e: 'star', ec: '#FFFFFF' };
const al = (uid, name, col) => ({ v: 1, reg, name, mo: '', em, col, ty: 'def', acc: 'apply', t: now, fd: uid, ld: uid, tyAt: 0, mem: { [uid]: { t: now } }, npc: {}, iv: {}, rq: {}, xp: 150, tt: now, tr: {}, dn: {}, pj: {}, rel: {}, log: [] });
await put('alliances/al-north', al(ua, 'The Northern League', '#2A9D8F'));
await put('alliances/al-south', al(ub, 'The Southern Accord', '#C8102E'));
await put('allyOf/' + ua, { a: 'al-north', reg, t: now }); await put('allyOf/' + ub, { a: 'al-south', reg, t: now });

// a pact: offered by one leader
await nav(A, 'diplomacy'); await A.click('#dp-tab-alliance');
check('the leader sees its alliance', await until(async () => /The Northern League/.test(await text(A, '.al-head')), 15000));
await A.click('[data-act="dp-sub"][data-v="relations"]');
check('Relations lists the other alliance, with a pact and a rivalry to offer', await until(async () => /The Southern Accord/.test(await text(A, '#al-pane-relations')), 10000)
  && !!await A.$('[data-act="dp-ar-pact"][data-id="al-south"]') && !!await A.$('[data-act="dp-ar-rival"][data-id="al-south"]'));
await A.click('[data-act="dp-ar-pact"][data-id="al-south"]');
check('the offer is on both records', await until(async () => await st('al-north', 'al-south') === 'offered' && await st('al-south', 'al-north') === 'asked', 10000));
check('and shown as offered', await until(async () => /Pact offered/.test(await text(A, '#al-pane-relations'))));
// accepted by the other, from the waiting strip
await nav(B, 'diplomacy');
check('the other leader sees it waiting', await until(async () => /The Northern League offers The Southern Accord a pact/.test(await text(B, '.dp-wait')), 10000));
check('and the menu counts it', await until(async () => Number(await text(B, '.nav [data-v="diplomacy"] .badge')) >= 1, 8000));
await B.click('.dp-wait [data-act="dp-ar-yes"][data-id="al-north"]');
check('accepted, the pact is in force on both records', await until(async () => await st('al-north', 'al-south') === 'active' && await st('al-south', 'al-north') === 'active', 10000));
check('Relations says so', await until(async () => /Pact\s*since/.test(await text(A, '#al-pane-relations')), 10000));
check('war on a member of the other is refused, naming the pact', /has a pact with The Southern Accord/.test(await A.evaluate(ub => G.TYX().tyWarBlock(ub), ub)));
await regionTab(B, 'alliances');
check('the Region’s ranking marks it', await until(async () => /The Northern League\s*Pact/.test(await text(B, '.al-rank')), 10000));
await B.click('.al-rank [data-act="al-page"][data-id="al-north"]');
check('and so does the public page', await until(async () => /Pacts\s*The Southern Accord/.test(await text(B, '.alp')), 10000));
// ended with notice, then broken at once
await A.click('[data-act="dp-ar-end"][data-id="al-south"]');
check('ended with notice: in force until it runs out', await until(async () => await st('al-north', 'al-south') === 'ending', 10000) && await until(async () => /Pact\s*ends/.test(await text(A, '#al-pane-relations'))));
await A.click('[data-act="dp-ar-brk-ask"][data-id="al-south"]');
check('breaking asks first, saying what it costs', /Break the pact with The Southern Accord at once\?/.test(await text(A, '#al-pane-relations')) && /loses 100 renown/.test(await text(A, '#al-pane-relations')));
await A.screenshot({ path: OUT + '/alliance-relations-break.png', fullPage: true });
await A.click('[data-act="dp-ar-brk"][data-id="al-south"]');
check('broken: gone from both, and the breaker lost renown', await until(async () => !(await relOf('al-north', 'al-south')) && !(await relOf('al-south', 'al-north')) && Number((await get('alliances/al-north'))?.xp?.integerValue) === 50, 10000));
await A.click('[data-act="dp-sub"][data-v="history"]');
check('its history says who broke it', await until(async () => /The pact with The Southern Accord was broken by Northmark/.test(await text(A, '.al-log')), 8000));
await nav(B, 'diplomacy'); await B.click('#dp-tab-alliance'); await B.click('[data-act="dp-sub"][data-v="history"]');
check('and so does the other’s', await until(async () => /The pact with The Northern League was broken by Northmark/.test(await text(B, '.al-log')), 8000));
// a rivalry: named by one, seen by the other
await A.click('[data-act="dp-sub"][data-v="relations"]');
await A.click('[data-act="dp-ar-rival"][data-id="al-south"][data-on="1"]');
check('a rival named, on both records', await until(async () => (await relOf('al-north', 'al-south'))?.me?.booleanValue === true && (await relOf('al-south', 'al-north'))?.them?.booleanValue === true, 10000)
  && await until(async () => /Your rival/.test(await text(A, '#al-pane-relations'))));
check('war on a rival’s member is open', await A.evaluate(ub => G.TYX().tyWarBlock(ub), ub) === '');
await B.click('[data-act="dp-sub"][data-v="relations"]');
check('the other alliance sees it, and may name them back', await until(async () => /Names you its rival/.test(await text(B, '#al-pane-relations')), 10000) && !!await B.$('[data-act="dp-ar-rival"][data-id="al-north"][data-on="1"]'));
await A.screenshot({ path: OUT + '/alliance-relations.png', fullPage: true });
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
