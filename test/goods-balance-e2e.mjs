// Goods and iron, balanced: the state's share, the population's goods, the trickle, Ore Pits, the cheaper Factory, the
// Bureau's market and the goods bar's explanation, in the built game on the emulators.
//   python3 build.py
//   npx firebase emulators:exec --project demo-edictum --only auth,firestore,functions,hosting "node test/goods-balance-e2e.mjs"
import path from 'node:path';
import { OUT, check, finish, sleep, until, player, open, found, nav, text, settle } from './lib.mjs';

const A = await player('Goods-A', { vp: { width: 1280, height: 1000 } });
await open(A);
await found(A, 'Mercatoria');
await settle(A);

const r = await A.evaluate(() => { const g = G.GB(), n = G.S.nation, rt = g.stockRates(n), E = g.economy(), i = E.byDoc.get(n);
  return { rt, prod: Object.fromEntries(Object.keys(rt).map(k => [k, E.prod[k][i]])), dem: Object.fromEntries(Object.keys(rt).map(k => [k, E.dem[k][i]])),
    orepit: !!g.BUILDINGS.orepit, factoryIron: g.BUILDINGS.factory.cost.iron, ironDemand: g.DEMAND.iron, mine: g.MILESTONES.find(m => (m.b || []).includes('mine')), share: g.GB.SHARE }; });
check('every resource with any production grows: the state keeps a share', ['food', 'timber', 'iron', 'goods'].every(k => r.rt[k] >= r.share * r.prod[k] - 1e-9 && r.rt[k] > 0), JSON.stringify(r.rt));
check('goods gain the population’s share on top', r.rt.goods > r.share * r.prod.goods, JSON.stringify({ g: r.rt.goods, p: r.prod.goods }));
check('Ore Pits exist and open with the Iron Mine', r.orepit && r.mine && r.mine.b.includes('orepit'));
check('the Factory costs 6 iron, and a nation uses less iron', r.factoryIron === 6 && r.ironDemand === 0.45);
/* the trickle: a resource below the cheapest price it pays gains at least one a day */
const tr = await A.evaluate(() => { const g = G.GB(), n = G.S.nation, keep = n.stock; n.stock = Object.assign({}, keep, { iron: 0 }); try { return g.stockRates(n).iron; } finally { n.stock = keep; } });
check('a resource below its cheapest price gains at least one a day', tr >= 1, String(tr));

/* the Bureau's market */
await nav(A, 'trade');
check('the Bureau’s market is on the Trade page', /The Bureau’s market/.test(await text(A, '#gb-mkt')));
const before = await A.evaluate(() => G.GB().stockNow(G.S.nation));
await A.selectOption('#gb-give', 'food');await A.selectOption('#gb-get', 'goods');
await A.fill('#gb-q', '30');await sleep(300);
check('a quote before exchanging', /You hand over 30 food and receive/.test(await text(A, '#gb-mkt-q')));
await A.click('[data-act="gb-trade"]');await sleep(500);
const after = await A.evaluate(() => ({ st: G.GB().stockNow(G.S.nation), mkt: G.S.nation.mkt }));
check('exchanging takes the food and gives goods', after.st.food < before.food - 29 && after.st.goods > before.goods + 5 && after.mkt && after.mkt.q === 30, JSON.stringify({ before, after }));
const ach = await until(() => A.evaluate(() => { const n = G.S.nation; return n.ach && n.ach['eco-mkt1'] ? { t: n.tly, a: Object.keys(n.ach).filter(k => /^eco-mkt/.test(k)) } : null; }), 8000);
check('the first exchange earns “Open for Business” and counts toward the rest', !!ach && ach.t.mkt === 1 && ach.t.mktq === 30 && ach.t['mktg:goods'] === 1, JSON.stringify(ach));
check('the market’s five achievements are on the Achievements page', await A.evaluate(() => ['eco-mkt1', 'eco-mkt10', 'eco-mkt500', 'eco-mktall', 'eco-mktfull'].every(id => G.RK.ACH.some(a => a.id === id))));
check('the price falls as the day’s sales grow', await A.evaluate(() => { const g = G.GB(), n = G.S.nation, a = g.gbQuote(Object.assign({}, n, { mkt: null }), 'food', 'goods', 10, Date.now()), b = g.gbQuote(Object.assign({}, n, { mkt: { d: Math.floor(Date.now() / 864e5), q: 100 } }), 'food', 'goods', 10, Date.now()); return a.out > b.out; }));
check('and stops at the day’s limit', await A.evaluate(() => /all it will today|takes \d+ more today/.test(G.GB().gbQuote(Object.assign({}, G.S.nation, { mkt: { d: Math.floor(Date.now() / 864e5), q: 120 } }), 'food', 'goods', 10, Date.now()).err || '')));
await A.evaluate(() => scrollTo(0, 0));await A.screenshot({ path: path.join(OUT, 'goods-market.png'), fullPage: false });

/* the goods bar says why a resource is slow */
const why = await A.evaluate(() => { const g = G.GB(), n = G.S.nation; return ['food', 'timber', 'iron', 'oil', 'goods'].map(k => g.gbWhy(n, k)).join(' | '); });
check('each resource has an explanation', why.split(' | ').every(Boolean), why);
const slowShown = await A.evaluate(() => !!document.querySelector('.gb-why'));
const slowAny = await A.evaluate(() => { const g = G.GB(), n = G.S.nation, rt = g.stockRates(n); return Object.values(rt).some(v => v < 0.5); });
check('the goods bar explains a slow resource, with links', slowShown === slowAny && (!slowShown || !!(await A.$('.gb-why [data-act="gb-flows"]'))));

/* large iron deposits, and harbour towns */
const dep = await A.evaluate(() => { const g = G.GB(), D = g.IRON_DEP, by = [0, 0, 0, 0, 0]; let first = -1, n = 0, ok = true;
  for (let i = 0; i < D.length; i++) if (D[i]) { n++; by[g.MAP_T[i]]++; if (first < 0) first = i; if (g.CELL_RES.iron[i] < g.IRON_DEP_YIELD || g.CELL_RES.oil[i]) ok = false; }
  return { n, by, first, ok, harbour: g.BUILDINGS.harbour.res.goods[1] }; });
check('large iron deposits lie across the map, mostly in the hills and mountains, never on oil', dep.n > 60 && dep.n < 200 && dep.ok && dep.by[4] + dep.by[3] > dep.by[2], JSON.stringify(dep));
check('a Harbour now makes 3 goods a day', dep.harbour === 3);
await nav(A, 'map');await sleep(800);
await A.evaluate(c => { G.GB().mapAt(c); G.render(); }, dep.first);await sleep(1200);
await A.locator('canvas[data-map="main"]').screenshot({ path: path.join(OUT, 'goods-iron-deposit.png') }).catch(e => check('map screenshot', false, e.message));

/* achievements for iron deposits, harbours and the stockpile: each works its figure out for a real nation */
const oreAch = await A.evaluate(() => { const ids = ['land-ore1', 'land-ore5', 'land-ore12', 'bld-lode', 'bld-orepit', 'bld-harb3', 'eco-iron10', 'eco-goods25', 'eco-iron300'];
  const x = { n: G.S.nation, id: G.S.uid, me: true, m: {}, now: Date.now() };
  return ids.map(id => { const a = G.RK.ACH.find(q => q.id === id); return a ? [id, a.f(x), a.g] : [id, 'missing']; }); });
check('nine new achievements for iron deposits, harbours and the stockpile, each with a figure', oreAch.every(([, v, g]) => Number.isFinite(v) && v >= 0 && g > 0), JSON.stringify(oreAch));
check('a stockpile of iron counts towards Iron Reserve', (oreAch.find(r => r[0] === 'eco-iron300') || [])[1] >= 20, JSON.stringify(oreAch));

/* the Help page explains it */
await nav(A, 'help');await sleep(500);
const help = await text(A, '#help-trade');
check('Help explains the state’s share, the trickle, Ore Pits, the free first Factory and the market', /The state keeps a share/.test(help) && /20%/.test(help) && /Nobody is stuck/.test(help) && /Ore Pits/.test(help) && /first Factory runs without oil/.test(help) && /The Bureau’s market/.test(help), help.slice(0, 300));
await A.evaluate(() => document.getElementById('help-trade').scrollIntoView());await sleep(300);await A.screenshot({ path: path.join(OUT, 'goods-help.png') });

await finish();
