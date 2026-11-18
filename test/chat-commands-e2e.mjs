// Quick commands in the chat (functions/regionchat.js, rcCardIn; the game's rgcCmd), on the emulators: /stock, /rank and
// /nation <name> post a card instead of words, in the region chat and the world chat; the server keeps only the card's
// fields and refuses a nation of another region in the region chat; /help and an unknown command say what there is and
// send nothing; a card reads the same for another nation of the region.
//   npm run test:chat-commands
import { player, open, found, register, until, check, finish, text, restListAdmin, clearEmulators, sleep } from './lib.mjs';
await clearEmulators();
const A = await player('writer'), B = await player('reader');
const uidA = await open(A); await found(A, 'Cardonia');
const uidB = await open(B); await found(B, 'Readmoor');
await register(A); await register(B);

const lines = async reg => (await restListAdmin(`rchat/${reg}/chat`)).map(d => ({ id: d.id, a: d.fields.a?.stringValue, x: d.fields.x?.stringValue, cd: d.fields.cd?.mapValue?.fields || null }));
const openChat = async p => { if (!(await p.$('#rgc-dock:not([hidden])'))) await p.click('.rgc-btn'); await p.waitForSelector('#rgc-dock:not([hidden])'); };
const say = async (p, x) => { await p.fill('#rgc-x', x); await p.press('#rgc-x', 'Enter'); };
const reg = await A.evaluate(() => G.S.nation.reg);
await openChat(A); await openChat(B);
/* wait for the welcome lines to settle */
await sleep(1500);

/* ── 1. /help and unknown commands ── */
const before = (await lines(reg)).length;
await say(A, '/help');
check('/help lists the commands and sends nothing', await until(async () => /Quick commands: \/stock.*\/rank.*\/nation <name>/.test(await text(A, '#rgc-dock'))), await text(A, '#rgc-foot'));
await say(A, '/dance');
check('an unknown command says so', await until(async () => /There is no command \/dance\./.test(await text(A, '#rgc-dock'))));
await sleep(1500);
check('neither went to the server', (await lines(reg)).length === before);
await A.fill('#rgc-x', '');

/* ── 2. /stock ── */
await say(A, '/stock');
const st = await until(async () => (await lines(reg)).find(l => l.x === '/stock' && l.cd), 15000);
const v = st?.cd?.v?.arrayValue?.values?.map(x => Number(x.doubleValue ?? x.integerValue)) || [];
check('/stock keeps a stock card with five amounts and five rates', st?.a === uidA && st.cd.k.stringValue === 'stock' && v.length === 5 && st.cd.r.arrayValue.values.length === 5, JSON.stringify(st));
const card = (p, id) => text(p, `#rgc-list .rgc-l[data-id="${id}"] .rgc-cd`);
check('the writer sees the card, food first', await until(async () => /Stockpile of Cardonia/.test(await card(A, st?.id)) && /Food/.test(await card(A, st?.id)) && /a day/.test(await card(A, st?.id))), await card(A, st?.id));
check('another nation of the region sees the same card', await until(async () => /Stockpile of Cardonia/.test(await card(B, st?.id)) && /Goods/.test(await card(B, st?.id)), 15000), await card(B, st?.id));

/* ── 3. /rank ── */
await sleep(1600); await say(A, '/rank');
const rk = await until(async () => (await lines(reg)).find(l => l.x === '/rank' && l.cd), 15000);
check('/rank keeps a rank card', rk?.cd?.k?.stringValue === 'rank' && 'i' in rk.cd && 'p' in rk.cd && 'n' in rk.cd, JSON.stringify(rk));
check('it shows the rank name, points and achievements', await until(async () => /Rank of Cardonia/.test(await card(B, rk?.id)) && /Points/.test(await card(B, rk?.id)) && /Achievements/.test(await card(B, rk?.id)), 15000), await card(B, rk?.id));

/* ── 4. /nation ── */
await sleep(1600); await say(A, '/nation read');
const na = await until(async () => (await lines(reg)).find(l => /^\/nation/.test(l.x || '') && l.cd), 15000);
check('/nation finds a nation of the region by the start of its name; the server names it', na?.cd?.k?.stringValue === 'nation' && na.cd.id.stringValue === uidB && na.cd.nm.stringValue === 'Readmoor', JSON.stringify(na));
check('the card shows its flag, people, cities, land and rank', await until(async () => { const c = await card(A, na?.id); return /Readmoor/.test(c) && /People/.test(c) && /Cities/.test(c) && /hexes/.test(c) && /Rank/.test(c); }), await card(A, na?.id));
check('the card links to the nation for another reader', !!(await A.$(`#rgc-list .rgc-l[data-id="${na?.id}"] .rgc-cd [data-act="visit"][data-id="${uidB}"]`)));
await sleep(1600); await say(A, '/nation Nowhereland');
check('an unknown nation is refused in the game', await until(async () => /No nation called “Nowhereland” in your region/.test(await text(A, '#rgc-dock'))));
await A.fill('#rgc-x', '');

/* ── 5. the server checks the card ── */
const civic = d => A.evaluate(async d => { try { const api = await window.claude.use('civic'), r = await api.request(d); return r && r.data && !('ok' in r) ? r.data : r; } catch (e) { return { err: e.details?.code || e.code || String(e) }; } }, d);
check('a card of an unknown kind is refused', (await civic({ op: 'rcPost', reg, x: '/x', cd: { k: 'treasure' } })).err === 'rc_card');
check('a nation that is not there is refused', (await civic({ op: 'rcPost', reg, x: '/nation x', cd: { k: 'nation', id: 'nobody123', pop: 1, ci: 1, hx: 1, i: 0 } })).err === 'rc_card');
await sleep(1600);
const extra = await civic({ op: 'rcPost', reg, x: '/rank', cd: { k: 'rank', i: 2, p: 50, n: 3, evil: '<b>' } });
const ex = await until(async () => (await lines(reg)).find(l => l.id === extra.id), 10000);
check('only the card’s own fields are kept', !!ex && !('evil' in ex.cd) && Number(ex.cd.p.integerValue) === 50, JSON.stringify(ex));

/* ── 6. the world chat ── */
await A.click('#rgc-tab-world'); await sleep(1800);
await say(A, '/stock');
const ws = await until(async () => (await lines('world')).find(l => l.x === '/stock' && l.cd), 15000);
check('a card works in the world chat too', ws?.cd?.k?.stringValue === 'stock', JSON.stringify(ws) + ' ' + await text(A, '#rgc-dock'));

await finish();
