// Field digs, rotated (game/edictum.html, 17 November 2026): ten pasts of the region, two open at a time; a finished
// collection leaves for the Finished excavations shelf and the next one, in the nation's own order, takes its place.
// Also: the dig's length, the half-way choice, events, pity, the scholar, spares (give, take, sell), joint digs with
// another player (written into the world), the region's finds board, the crates opening, the ground of the region and
// the new achievements.
//   python3 build.py
//   node test/field-digs.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let failed = 0;
const ok = (c, m, extra) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c || extra === undefined ? '' : ' · ' + extra)); if (!c) failed++; };
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE);
await page.fill('#d-name', 'Trowelia'); await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation);
const G = (fn, a) => page.evaluate(fn, a);
const click = async sel => { await page.click(sel); await page.waitForTimeout(150); };
const main = () => page.evaluate(() => document.querySelector('.main').innerText);
const open = () => G(() => { const g = window.__game; g.S.view = 'museum'; g.S.muHall = 'digs'; g.render(); });
const D = () => 'window.__game.DIG()';

// the catalogue
const cat = await G(() => { const D = window.__game.DIG(); return { sets: D.DIG_SETS.length, sites: D.DIG_SITES.length,
  each: D.DIG_SETS.map(sid => [D.digSet(sid).items.length, D.DIG_SITES.filter(s => s.set === sid).map(s => s.tier).join(''), D.digSet(sid).items.filter(a => a.r === 'l').length]),
  ids: new Set(D.DIG_SETS.flatMap(sid => D.digSet(sid).items.map(a => a.id))).size, first: D.DIG_SITES.slice(0, 6).map(s => s.k).join(',') }; });
ok(cat.sets === 10 && cat.sites === 30 && cat.ids === 80, 'ten pasts, thirty sites, eighty artefacts with their own ids', JSON.stringify(cat));
ok(cat.each.every(([L, t, l]) => L === 8 && t === '123' && l === 1), 'every past has eight artefacts, three sites (short, middle, long) and one legendary piece');
ok(cat.first === 'barrows,island,caves,sandbar,pier,harbour', 'the first six sites keep their places, so digs already out still point at them');

// the start: the first two pasts open
await G(() => { const g = window.__game, n = g.S.nation, now = Date.now(); n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; g.render(); });
await open();
const start = await G(() => { const D = window.__game.DIG(), n = window.__game.S.nation; return { act: D.digActive(n), ord: D.digOrder(n) }; });
ok(start.act.join() === 'dg-fords,dg-tide', 'a new nation digs the Fords and the Drowned Harbours first');
ok(/Where to dig/.test(await main()) && !/Finished excavations/.test(await main()), 'the office shows the open pasts and no shelf yet');
ok(/In .* the diggers work in meadow soil/.test(await main()), 'the office says what ground the diggers work in, from the region');
const ground = await G(() => { const D = window.__game.DIG(), R = id => D.digGround(D.REGIONS.find(r => r.id === id))[0]; return [R('frostmarch'), R('saffron'), R('coralreach'), R('silentmoors'), R('wildwood')]; });
ok(ground.join('|') === 'frozen ground|sand and dust|reef and shallows|peat and bog|roots and leaf mould', 'each region digs through its own ground', ground.join('|'));
const orders = await G(() => { const D = window.__game.DIG(); return [D.digOrder({ name: 'Alpha', npc: 0 }).join(), D.digOrder({ name: 'Beta', npc: 0 }).join(), D.digOrder({ name: 'Gamma', npc: 0 }).join()]; });
ok(new Set(orders).size > 1 && orders.every(o => o.startsWith('dg-fords,dg-tide,')), 'after the first two, every nation finds the later pasts in its own order');

// a dig to a past not yet open is refused
const locked = await G(() => { const D = window.__game.DIG(), n = window.__game.S.nation, k = D.DIG_SITES.findIndex(s => !D.digActive(n).includes(s.set)); return D.digPlan(n, k, 1).why; });
ok(/not found the trail/.test(locked), 'a site of a past not yet open cannot be dug', locked);

// finishing the Fords: it retires, the next one opens, credits 2 + 7
const credits0 = await G(() => window.__game.DIG().digCredits(window.__game.S.nation));
await G(() => { const g = window.__game, D = g.DIG(), n = g.clone(g.S.nation), now = Date.now(), ids = D.digSet('dg-fords').items.map(a => a.id);
  n.digF = ids.slice(); n.dgT = Object.fromEntries(ids.map((id, i) => [id, now - 1000 + i])); g.commit(n); g.render(); });
await page.waitForTimeout(300);
const r1 = await G(() => { const D = window.__game.DIG(), n = window.__game.S.nation; return { act: D.digActive(n), ret: D.digRetired(n), cr: D.digCredits(n), ord: D.digOrder(n), opened: D.digOpenedAt(n, D.digActive(n)[1]) }; });
ok(r1.ret.join() === 'dg-fords' && r1.act[0] === 'dg-tide' && r1.act[1] === r1.ord[2], 'the finished Fords leave the office and the next past in the nation’s order takes their place', JSON.stringify(r1.act));
ok(r1.cr - credits0 === 9, 'the Fords bring 2 + 7 land credits', `${credits0} → ${r1.cr}`);
ok(r1.opened > 0, 'the new past knows when its trail was found');
await open();
const txt1 = await main();
ok(/Finished excavations/.test(await page.evaluate(() => (document.querySelector('.dig-shelf') || {}).textContent || '')) && /new trail/i.test(txt1), 'the shelf shows the finished past and the new one is marked as a new trail');
ok(/Three Pasts|more pasts? wait/.test(txt1), 'the office says more pasts wait beyond these');
await page.screenshot({ path: OUT + '/field-digs-rotated.png', fullPage: true });

// a later past brings 1 + 4
const later = r1.act[1];
const cr2 = await G(sid => { const g = window.__game, D = g.DIG(), n = g.clone(g.S.nation), now = Date.now(), ids = D.digSet(sid).items.map(a => a.id);
  n.digF = [...new Set((n.digF || []).concat(ids))]; n.dgT = { ...(n.dgT || {}), ...Object.fromEntries(ids.map(id => [id, now])) }; g.commit(n); return D.digCredits(g.S.nation); }, later);
ok(cr2 - r1.cr === 5, 'a later past brings 1 + 4 land credits', `${r1.cr} → ${cr2}`);
ok(await G(() => window.__game.DIG().digActive(window.__game.S.nation).length) === 2, 'two pasts stay open');

// the length of a dig, and sending it
const st0 = await G(() => ({ ...window.__game.S.nation.stock }));
const k0 = await G(() => { const D = window.__game.DIG(), n = window.__game.S.nation; return D.DIG_SITES.findIndex(s => s.set === D.digActive(n)[0] && s.tier === 1); });
await click('[data-act="dig-len"][data-v="2"]');
const plan = await G(k => { const D = window.__game.DIG(), n = window.__game.S.nation; return { long: D.digPlan(n, k, 2), std: D.digPlan(n, k, 1), quick: D.digPlan(n, k, 0) }; }, k0);
ok(plan.long.mod - plan.std.mod === 3 && plan.std.mod - plan.quick.mod === 3, 'a long expedition rolls 3 higher, a quick look 3 lower');
await click(`[data-act="dig-send"][data-k="${k0}"]`);
const sent = await G(() => { const g = window.__game, d = g.S.nation.dig[0], s = g.DIG().DIG_SITES[d.s]; return { d, h: (d.t1 - d.t0) / 3600e3, base: s.h, cost: s.cost, stock: { ...g.S.nation.stock } }; });
ok(sent.d.L === 2 && Math.abs(sent.h - sent.base * 1.75) < 0.01, 'the long expedition takes 1.75 times as long', JSON.stringify(sent.d));
const spentFood = Math.round(st0.food - sent.stock.food);
ok(Math.abs(spentFood - Math.ceil(sent.cost.food * 1.5)) <= 1, 'and costs half as much again', `${spentFood} food`);

// half way: dig deeper
await G(() => { const g = window.__game, n = g.clone(g.S.nation), d = n.dig[0], len = d.t1 - d.t0; d.t0 = Date.now() - len * 0.6; d.t1 = d.t0 + len; g.commit(n); g.render(); });
await open();
ok(!!await page.$('[data-act="dig-deep"]') && !!await page.$('[data-act="dig-home"]'), 'half way through, the office offers to dig deeper or come home');
const before = await G(() => window.__game.S.nation.dig[0]);
await click('[data-act="dig-deep"]');
const deeper = await G(() => window.__game.S.nation.dig[0]);
ok(deeper.c === 1 && Math.abs((deeper.t1 - before.t1) - (before.t1 - before.t0) * 0.5) < 5, 'digging deeper adds half as long again', JSON.stringify({ before, deeper }));
ok(await G(() => { const D = window.__game.DIG(), n = window.__game.S.nation, d = n.dig[0]; return D.digMod(n, D.DIG_SITES[d.s], d, Date.now()) - D.digMod(n, D.DIG_SITES[d.s], { ...d, c: 0 }, Date.now()); }) === 3, 'and rolls 3 higher');
ok(!await page.$('[data-act="dig-deep"]'), 'the choice is made once');

// events: one dig in three
const evs = await G(() => { const D = window.__game.DIG(); let k = 0; for (let i = 0; i < 3000; i++) if (D.digEvent({ s: i % 30, t0: 1e12 + i * 7919 })) k++; return k / 3000; });
ok(evs > 0.27 && evs < 0.4, 'about one dig in three meets something on the way', evs.toFixed(3));

// opening the crates: a roll of 20 brings two, and the crates open on screen
await G(() => { const g = window.__game, n = g.clone(g.S.nation); n.dig[0].t1 = Date.now() - 1; n.dig[0].r = 20; g.commit(n); g.render(); });
await open();
const had = await G(() => (window.__game.S.nation.digF || []).length);
await click('[data-act="dig-open"]');
const got = await G(() => ({ f: (window.__game.S.nation.digF || []).length, rv: window.__game.S.digReveal, dgT: Object.keys(window.__game.S.nation.dgT || {}).length }));
ok(got.f - had === 2 && got.rv && got.rv.got.length === 2, 'a natural 20 brings two finds', JSON.stringify(got.rv));
ok(!!await page.$('.dig-rv .dig-crate .dig-lid') && /The crates from/.test(await main()), 'the crates open on screen, lids first');
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '/field-digs-crates.png', fullPage: false });
await click('[data-act="dig-rv-x"]');
ok(!await page.$('.dig-rv'), 'and close');

// pity: an empty dig adds 2 to the next roll there
const pity = await G(() => { const g = window.__game, D = g.DIG(), n = g.clone(g.S.nation), act = D.digActive(n), k = D.DIG_SITES.findIndex(s => s.set === act[0] && s.tier === 3), now = Date.now();
  n.dig = [{ s: k, t0: now - 9e6, t1: now - 1, r: 1, L: 1 }]; g.commit(n); const m0 = D.digMod(g.S.nation, D.DIG_SITES[k]); D.digOpen(0);
  return { m0, m1: D.digMod(g.S.nation, D.DIG_SITES[k]), p: (g.S.nation.dgp || {})[act[0]] }; });
ok(pity.p === 1 && pity.m1 - pity.m0 === 2, 'an empty dig adds 2 to the next roll at that past', JSON.stringify(pity));

// the scholar
const sch = await G(() => { const g = window.__game, D = g.DIG(), n = g.S.nation, sid = D.digActive(n)[0], th = D.digSet(sid).th, k = D.DIG_SITES.findIndex(s => s.set === sid);
  const m0 = D.digMod(n, D.DIG_SITES[k]); D.digHire(th); return { th, m0, m1: D.digMod(g.S.nation, D.DIG_SITES[k]), dgs: g.S.nation.dgs }; });
ok(sch.dgs && sch.dgs.k === sch.th && sch.m1 - sch.m0 === 3, 'a scholar of the right field adds 3 for a week', JSON.stringify(sch));

// spares: a find the museum already has comes back as a spare; sell it
const spare = await G(() => { const g = window.__game, D = g.DIG(), n = g.clone(g.S.nation), now = Date.now(), k = D.DIG_SITES.findIndex(s => s.set === 'dg-fords' && s.tier === 3);
  n.dig = [{ s: k, t0: now - 9e6, t1: now - 1, r: 15, L: 1 }]; g.commit(n); D.digOpen(0); return { x: g.S.nation.dgx || [], goods: g.S.nation.stock.goods }; });
ok(spare.x.length === 1, 'a dig at a finished site brings a spare', JSON.stringify(spare.x));
await open();
ok(/Spares/.test(await main()), 'the office lists the spares');
await G(() => { const g = window.__game, n = g.clone(g.S.nation); n.stock = { ...g.S.nation.stock, goods: 100 }; n.stockAt = Date.now(); g.commit(n); g.render(); });
spare.goods = await G(() => window.__game.S.nation.stock.goods);
await click('[data-act="dig-sell"]');
const sold = await G(() => ({ x: (window.__game.S.nation.dgx || []).length, goods: window.__game.S.nation.stock.goods }));
ok(sold.x === 0 && sold.goods > spare.goods, 'a spare sells for goods', `${spare.goods} → ${sold.goods}`);

// another player in the world: a joint dig invitation, a spare sent to us, and the finds board
const other = await G(() => { const g = window.__game, D = g.DIG(), me = g.S.uid || 'me', now = Date.now(), act = D.digActive(g.S.nation), k = D.DIG_SITES.findIndex(s => s.set === act[0] && s.tier === 2);
  const want = D.digSet(act[0]).items.find(a => !(g.S.nation.digF || []).includes(a.id));
  g.S.mode = 'world'; g.S.world = g.S.world || {};
  g.S.world['digpal'] = { ...g.clone(g.S.nation), name: 'Spadeland', dig: [{ s: k, t0: now - 1000, t1: now + 8 * 3600e3, r: 10, L: 1, j: { to: me } }], dgg: [{ id: want.id, to: me, t: now - 500 }],
    digF: ['df-crown'], dgT: { 'df-crown': now - 86400e3 * 30 }, dgJ: [], dgx: [] };
  g.render(); return { k, want: want.id }; });
await open();
const txt2 = await main();
ok(/From other museums/.test(txt2) && /Spadeland/.test(txt2), 'invitations and gifts from another player show in the office');
ok(/Finds in /.test(txt2) && /first in the region/.test(txt2), 'the region’s finds board names who found what, and who was first to a legendary piece');
await G(() => { const g = window.__game, n = g.clone(g.S.nation); n.dig = []; g.commit(n); g.render(); });
await open();
const food0 = await G(() => window.__game.S.nation.stock.food);
await click('[data-act="dig-join"]');
const joined = await G(() => { const g = window.__game, D = g.DIG(), n = g.S.nation, d = (n.dig || [])[0]; return { d, J: n.dgJ, on: d && D.digJointOn(n, d), food: n.stock.food }; });
ok(joined.d && joined.d.s === other.k && joined.d.j && joined.d.j.of === 'digpal' && joined.on, 'joining the dig sends our diggers to the same site, marked joint', JSON.stringify(joined.d));
ok(joined.J && joined.J[0].startsWith('digpal:'), 'and notes it, so the inviter rolls 3 higher too');
await click('[data-act="dig-take"]');
ok(await G(w => (window.__game.S.nation.digF || []).includes(w), other.want), 'a spare sent by another player goes on display');
ok(!/a spare from Spadeland/.test(await main()), 'and is taken once');
await page.screenshot({ path: OUT + '/field-digs-world.png', fullPage: true });
await G(() => { const g = window.__game; delete g.S.world['digpal']; g.render(); });

// the save keeps it all
const kept = await G(() => { const g = window.__game, n = g.normalize(JSON.parse(JSON.stringify(g.S.nation))); return { dig: n.dig, dgJ: n.dgJ, dgs: n.dgs, dgT: Object.keys(n.dgT || {}).length, dgr: n.dgr, dgc: n.dgc }; });
ok(kept.dig[0].j && kept.dig[0].j.of === 'digpal' && kept.dgJ && kept.dgs && kept.dgT > 0 && kept.dgr && kept.dgc && kept.dgc.j >= 1, 'a save keeps joint digs, the scholar, find times, gifts taken and the counts', JSON.stringify(kept));

// the achievements are there
const ach = await G(() => window.__game.RK.ACH.filter(a => /^mus-dig-/.test(a.id)).map(a => a.id).join());
ok(/mus-dig-past3/.test(ach) && /mus-dig-pastall/.test(ach) && /mus-dig-joint/.test(ach) && /mus-dig-first/.test(ach), 'the new dig achievements exist', ach);

ok(!errs.length, 'no errors in the page' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
