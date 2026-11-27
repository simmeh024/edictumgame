// Land deals (emulators): two Registered Nations of one region, the second settled beside the first so they share a
// border. A hex is sold for food: offered from the hex's panel on the map (Trade this land), with the land valuer and
// the stamp duty shown; accepted on the Diplomacy page's Land tab, the price set aside from the buyer's stock; the seller's
// game hands the hex over by itself, the deal is done, and the seller is paid less the duty. Then a hex is listed on the
// land market and bought there, one goes up for auction and is bid on (and the bid raised), a hex is swapped for one of
// the other's with no border agreement, one is given as a gift, and one is bought on instalments whose buyer stops
// paying, so the land goes back. The Statistics page's Land prices tab counts the deals.
import { OUT, check, finish, until, player, open, found, nav, text, register, establish, clearEmulators, errors, FS_HOST, PROJECT } from './lib.mjs';
await clearEmulators();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = await player('ld-a', { vp: { width: 1280, height: 900 } }), B = await player('ld-b', { vp: { width: 1280, height: 900 } });
B.on('dialog', d => d.accept());
const ua = await open(A); await found(A, 'Westmark'); await establish(A);
const ub = await open(B); await found(B, 'Eastmark', { newPlayer: true });

/* the second nation settles on the free land nearest the first one's capital */
await nav(B, 'map');
check('the first nation is on the second one’s map', await until(() => B.evaluate(ua => !!(G.S.world[ua] && G.S.world[ua].loc), ua), 20000));
const spot = await B.evaluate(ua => G.LDX().near(ua), ua);
await B.evaluate(c => G.LDX().settleAt(c), spot);
check('the second nation settles beside the first', await until(() => B.evaluate(() => !!G.S.nation.loc), 15000), JSON.stringify({ spot, msg: await B.evaluate(() => G.S.mapMsg) }));
await establish(B);
await register(A, { old: true }); await register(B, { old: true });

const val = v => v == null ? undefined : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : undefined;
const deals = async () => {
  const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/land?pageSize=300`, { headers: { authorization: 'Bearer owner' } });
  return ((await r.json()).documents || []).map(d => ({ id: d.name.split('/').pop(), ...val({ mapValue: { fields: d.fields } }) }));
};
const newest = async () => (await deals()).sort((a, b) => b.t - a.t)[0] || null;
const deal = async id => (await deals()).find(d => d.id === id) || null;
const step = () => Promise.all([A.evaluate(() => G.LDX().ldStep()), B.evaluate(() => G.LDX().ldStep())]);
const stOf = async id => { await step(); return (await deal(id))?.st; };
const owner = (p, c) => p.evaluate(c => G.LDX().owner(c), c);
/* border hexes of A touching B, giving which cuts nothing off, and in no deal yet */
const used = new Set();
const borderA = async () => (await A.evaluate(({ ua, ub }) => G.LDX().border(ua, ub, 12), { ua, ub })).filter(c => !used.has(c));
const freshA = async () => { const c = (await borderA())[0]; if (c != null) used.add(c); return c; };
/* where the first nation settled decides how far apart the two capitals are: the second claims land toward the first until
   they share a border */
const touching = () => B.evaluate(({ ua, ub }) => G.LDX().border(ub, ua, 1).length > 0, { ua, ub });
await until(() => B.evaluate(ua => G.territory().byId[ua] !== undefined, ua), 20000);
for (let i = 0; i < 16 && !(await touching()); i++) { const c = await B.evaluate(ua => G.LDX().reach(ua), ua); if (c < 0) break; await sleep(400); }
check('both nations are in one region and share a border', await until(async () => (await borderA()).length >= 1, 30000), JSON.stringify({ border: await borderA(), spot }));
await A.screenshot({ path: OUT + '/land-neighbours.png' });

const openLand = async p => { await nav(p, 'diplomacy'); await p.click('#dp-tab-land'); await sleep(250); await p.waitForSelector('#dp-p-land', { state: 'visible', timeout: 8000 }); };
const editorOn = async c => {
  await nav(A, 'map');
  await A.evaluate(c => { G.S.mapCell = c; G.LDX().ui(); }, c);
  await until(async () => !!await A.$('[data-act="ld-start"]'), 8000);
  await tap(A, '[data-act="ld-start"]');
  return until(async () => /Land deal/.test(await text(A, '.ld-ed')), 8000);
};
/* a click by the element (the panel can lay itself out again under the pointer); false when it is not there */
const tap = (p, sel) => p.evaluate(sel => { const b = document.querySelector(sel); if (!b) return false; b.click(); return true; }, sel);
const setField = async (p, sel, v) => { await p.fill(sel, String(v)); await p.dispatchEvent(sel, 'change'); await sleep(120); };
const send = async () => { await until(async () => !!await A.$('.ld-ed [data-act="ld-send"]:not([disabled])'), 8000); await tap(A, '.ld-ed [data-act="ld-send"]'); };

// 1. a sale, offered from the map
const c1 = await freshA();
check('Trade this land opens the deal editor on the map', await editorOn(c1));
await A.selectOption('#ld-with', ub); await sleep(150);
check('the deal is with the neighbour', await until(async () => /With Eastmark/.test(await text(A, '.ld-ed')), 5000));
await setField(A, '.ld-ed [data-ld-pay="pb"][data-res="food"]', 10);
const ed = await text(A, '.ld-ed');
check('the land valuer prices the hex', /Land valuer\. The hex you give is worth about \d+/.test(ed), ed.slice(0, 300));
check('stamp duty: the seller receives 9 food of 10', /receive 9 food of 10 food/.test(ed), ed.slice(0, 600));
await A.screenshot({ path: OUT + '/land-editor.png' });
await send();
check('offered: on the server, to the neighbour', await until(async () => { const D = await newest(); return D && D.st === 'offered' && D.b === ub && D.ga.join() === String(c1) && D.pb.food === 10; }, 10000), JSON.stringify(await newest()));
const id1 = (await newest()).id;

await openLand(B);
check('the offer waits on the buyer’s Land tab', await until(async () => /Offered to you/.test(await text(B, '#dp-p-land')) && /Westmark gives a hex/.test(await text(B, '#dp-p-land')), 10000), (await text(B, '#dp-p-land')).slice(0, 300));
await B.screenshot({ path: OUT + '/land-offer.png' });
await tap(B, '#dp-p-land [data-act="ld-yes"]');
check('accepted: agreed, the price set aside from the buyer’s stock', await until(async () => (await deal(id1))?.st !== 'offered', 15000) && await B.evaluate(id => G.LDX().ldEscOf(G.S.nation).some(e => e.id === id && e.r.food === 10), id1), JSON.stringify(await deal(id1)));
check('the seller’s game hands the hex over by itself: done', await until(async () => await stOf(id1) === 'done', 40000), JSON.stringify(await deal(id1)));
check('the hex is the buyer’s on both maps', await until(async () => await owner(A, c1) === ub && await owner(B, c1) === ub, 15000));
check('the seller is paid, less the stamp duty, once', await until(async () => { await step(); return A.evaluate(id => G.LDX().ldGot(G.S.nation).includes(id), id1); }, 15000));
check('the buyer’s payment set aside is let go', await until(async () => { await step(); return B.evaluate(id => !G.LDX().ldEscOf(G.S.nation).some(e => e.id === id), id1); }, 15000));
check('both histories tell of it', await until(async () => await A.evaluate(() => G.S.nation.log.some(l => l.k === 'land' && /sold a hex/.test(l.fx))) && await B.evaluate(() => G.S.nation.log.some(l => l.k === 'land' && /bought a hex/.test(l.fx))), 10000));
check('and the honours count it', await A.evaluate(() => (G.S.nation.tly || {}).ldsell === 1) && await B.evaluate(() => (G.S.nation.tly || {}).ldbuy === 1 && (G.S.nation.tly || {}).ldhex === 1));

// 2. a listing on the land market, bought there
const c2 = await freshA();
if (c2 != null) {
  await editorOn(c2);
  await A.selectOption('#ld-with', '@list'); await sleep(150);
  await setField(A, '.ld-ed [data-ld-pay="pb"][data-res="food"]', 5);
  await send();
  check('listed on the land market', await until(async () => { const D = await newest(); return D && D.st === 'listed' && D.k === 'list' && D.b === ''; }, 10000));
  const id2 = (await newest()).id;
  check('a for-sale sign on the buyer’s map', await until(() => B.evaluate(c => G.LDX().ldIndex().has(c), c2), 10000));
  await openLand(B);
  check('the Land tab’s market lists it', await until(async () => /Land market/.test(await text(B, '#dp-p-land')) && /Westmark sells a hex/.test(await text(B, '#dp-p-land')), 10000));
  await until(async () => !!await B.$('#dp-p-land [data-act="ld-buy"]:not([disabled])'), 8000);
  await tap(B, '#dp-p-land [data-act="ld-buy"]');
  check('bought: the buyer is written in, and the land handed over', await until(async () => await stOf(id2) === 'done', 40000) && (await deal(id2)).b === ub, JSON.stringify(await deal(id2)));
  check('the listed hex is the buyer’s', await until(async () => await owner(A, c2) === ub, 15000));
} else check('a second border hex to list', false);

// 3. an auction, bid on and the bid raised
const c3 = await freshA();
let id3 = '';
if (c3 != null) {
  await editorOn(c3);
  await A.selectOption('#ld-with', '@auction'); await sleep(150);
  await A.selectOption('#ld-cur', 'food'); await sleep(120);
  await setField(A, '#ld-res', 3);
  await send();
  check('the auction is open', await until(async () => { const D = await newest(); return D && D.st === 'open' && D.cur === 'food' && D.res === 3 && D.end > Date.now(); }, 10000));
  id3 = (await newest()).id;
  await nav(A, 'map');
  check('the map key offers the for-sale layer', await until(async () => !!await A.$('input[data-mp-opt="landsale"]'), 8000));
  await A.screenshot({ path: OUT + '/land-auction-map.png' });
  await openLand(B);
  await until(async () => !!await B.$(`#ld-bid-${id3}`), 10000);
  /* this auction's Bid button, once it can be pressed: it stays disabled a moment while the land bought above is still
     being handed over (a bid needs the hex to touch the bidder's land), and a click on it then did nothing */
  const bidBtn = `#dp-p-land [data-act="ld-bid"][data-id="${id3}"]`;
  const bidReady = async () => { const ok = await until(() => B.evaluate(sel => { const b = document.querySelector(sel); return !!b && !b.disabled; }, bidBtn), 20000); if (!ok) console.log('the Bid button stayed disabled:', (await text(B, '#dp-p-land').catch(() => '')).slice(0, 400)); return ok; };
  await bidReady();
  await tap(B, bidBtn);
  check('a bid at the reserve, set aside', await until(async () => ((await deal(id3)).bids || []).length === 1, 10000) && await B.evaluate(id => G.LDX().ldEscOf(G.S.nation).some(e => e.id === id && e.r.food === 3), id3));
  await sleep(400);
  await bidReady();
  await setField(B, `#ld-bid-${id3}`, 6);
  await tap(B, bidBtn);
  check('the bid raised: the top bid, and the difference set aside', await until(async () => { const b = (await deal(id3)).bids || []; return b.length === 2 && b[1].v === 6; }, 10000) && await until(() => B.evaluate(id => G.LDX().ldEscOf(G.S.nation).some(e => e.id === id && e.r.food === 6), id3), 5000));
  check('an auction with a bid cannot be withdrawn', !(await A.evaluate(id => { const D = G.LDX().LD.docs.get(id); return !!D && D.bids.length === 0; }, id3)));
} else check('a third border hex to auction', false);

// 4. a swap with no border agreement: a hex of the buyer's for one of the seller's
const e4 = await freshA(), d4 = (await B.evaluate(({ ua, ub }) => G.LDX().border(ub, ua, 6), { ua, ub }))[0];
if (e4 != null && d4 != null) {
  await nav(B, 'map');
  await B.evaluate(c => { G.S.mapCell = c; G.LDX().ui(); }, e4);
  await until(async () => !!await B.$('[data-act="ld-ask"]'), 8000);
  await tap(B, '[data-act="ld-ask"]');
  check('Ask to buy or swap opens the editor with the neighbour’s hex', await until(async () => /With Westmark/.test(await text(B, '.ld-ed')), 8000));
  await B.evaluate(c => { G.LDX().LD.ed.ga.add(c); G.LDX().ui(); }, d4);
  check('a swap, no payment', await until(async () => /Swap/.test(await text(B, '.ld-ed')), 4000), (await text(B, '.ld-ed')).slice(0, 200));
  await until(async () => !!await B.$('.ld-ed [data-act="ld-send"]:not([disabled])'), 8000);
  await tap(B, '.ld-ed [data-act="ld-send"]');
  check('the swap is offered', await until(async () => { const D = await newest(); return D && D.a === ub && D.st === 'offered' && D.ga.join() === String(d4) && D.gb.join() === String(e4); }, 10000));
  const id4 = (await newest()).id;
  await openLand(A);
  await until(async () => !!await A.$('#dp-p-land [data-act="ld-yes"]'), 10000);
  await tap(A, '#dp-p-land [data-act="ld-yes"]');
  check('accepted: each side hands its hex over, and it is done', await until(async () => await stOf(id4) === 'done', 40000), JSON.stringify(await deal(id4)));
  check('the hexes have changed hands', await until(async () => await owner(A, e4) === ub && await owner(A, d4) === ua, 15000));
} else check('a hex each to swap', false, JSON.stringify({ e4, d4 }));

// 5. a gift
const g5 = await freshA();
if (g5 != null) {
  await editorOn(g5);
  await A.selectOption('#ld-with', ub); await sleep(150);
  check('nothing paid: a gift', /Gift/.test(await text(A, '.ld-ed')));
  await send();
  await until(async () => { const D = await newest(); return D && D.st === 'offered' && D.ga.join() === String(g5); }, 10000);
  const id5 = (await newest()).id;
  await openLand(B);
  await until(async () => !!await B.$('#dp-p-land [data-act="ld-yes"]'), 10000);
  await tap(B, '#dp-p-land [data-act="ld-yes"]');
  check('the gift is handed over', await until(async () => await stOf(id5) === 'done', 40000) && await until(async () => await owner(A, g5) === ub, 15000));
  check('the giver’s honours count it', await until(() => A.evaluate(() => (G.S.nation.tly || {}).ldgift === 1), 10000));
}

// 6. instalments, and the buyer stops paying: the land goes back
const f6 = await freshA();
if (f6 != null) {
  await editorOn(f6);
  await A.selectOption('#ld-with', ub); await sleep(150);
  await A.check('#ld-ins'); await A.dispatchEvent('#ld-ins', 'change'); await sleep(150);
  await setField(A, '.ld-ed [data-ld-pay="ins"][data-res="food"]', 1);
  check('paid over time: a day at a time', /Each day/.test(await text(A, '.ld-ed')));
  await send();
  check('offered with instalments', await until(async () => { const D = await newest(); return D && D.st === 'offered' && D.ins && D.ins.by === 'b' && D.ins.n === 7 && D.ins.r.food === 1; }, 10000), JSON.stringify(await newest()));
  const id6 = (await newest()).id;
  await openLand(B);
  await until(async () => !!await B.$('#dp-p-land [data-act="ld-yes"]'), 10000);
  await tap(B, '#dp-p-land [data-act="ld-yes"]');
  check('agreed and handed over: done, instalments to come', await until(async () => await stOf(id6) === 'done', 40000) && (await deal(id6)).pd === 0);
  check('the hex is the buyer’s meanwhile', await until(async () => await owner(B, f6) === ub, 15000));
  await openLand(B);
  check('the buyer can stop paying', await until(async () => !!await B.$('#dp-p-land [data-act="ld-stop"]'), 10000));
  await tap(B, '#dp-p-land [data-act="ld-stop"]');
  check('stopped: called in', await until(async () => (await deal(id6))?.st === 'default', 10000));
  check('and the buyer’s game hands the land back', await until(async () => { await step(); return await owner(A, f6) === ua; }, 30000));
}

// the region's land prices
await openLand(B);
await tap(B, '#dp-p-land [data-act="ld-prices"]');
check('the Statistics page shows the region’s land prices', await until(async () => /Land prices in/.test(await text(B, 'main')) && /deals done/.test(await text(B, 'main')), 10000), (await text(B, 'main')).slice(0, 200));
await B.waitForSelector('.ld-figs', { state: 'visible', timeout: 8000 }).catch(() => null); await sleep(600);
await B.screenshot({ path: OUT + '/land-prices.png' });
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
