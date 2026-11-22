// Computer nations' trade letters in the page: every deal they would propose passes their own Board of Trade
// (npcVerdict) on the live economy; an old trade idea they can no longer keep says so, or shows terms that work; good
// terms are signed from the letter in one click; and a letter asking for materials gets an answer about those materials.
//   python3 build.py
//   node test/npc-letters.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the test
// probe.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public'), OUT = path.join(ROOT, 'test', 'out');
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
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', e => errs.push(e.message));
const T0 = Date.UTC(2026, 10, 22, 12);
await page.clock.setFixedTime(T0);
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE);
await page.fill('#d-name', 'Fernwick'); await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
const game = (f, a) => page.evaluate(f, a);
/* settle on the map, as a new player does, so the nation has land to trade from */
await game(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.onb; G.commit(n); location.hash = '#nation'; });
await page.waitForFunction(() => window.__game.S.view === 'nation');
await page.click('text=Settle by the sea');
await page.waitForFunction(() => (window.__game.S.nation.cities || []).length > 0, null, { timeout: 8000 });
{ const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {}); }
await page.waitForTimeout(500);

/* the live economy: whatever each computer nation would propose, its Board of Trade signs */
const deals = await game(() => {
  const G = window.__game, L = G.LTR(), out = [];
  for (const x of G.allNations().filter(y => y.npc)) {
    for (const o of [{}, { get: 'food' }, { get: 'timber' }, { get: 'iron' }, { get: 'oil' }, { get: 'goods' }]) {
      const d = L.npcDealFor(x.id, o); if (!d) continue;
      out.push({ id: x.id, o, g: d.g, r: d.r, v: L.npcVerdict(x.id, d.g, d.r) });
    }
  }
  return out;
});
ok(deals.every(d => d.v.ok), `every deal they would propose on the live economy passes their Board of Trade (${deals.length} checked)${deals.filter(d => !d.v.ok).map(d => ' ' + JSON.stringify(d)).join('')}`);
const idea = await game(() => { const G = window.__game, L = G.LTR(), m = L.npcIdea(G.S.nation, Date.now()); return m && { w: m.w, x: m.x, a: m.a, v: L.npcVerdict(m.w, m.a.r, m.a.g) }; });
ok(!idea || (idea.a.k === 'idea' && idea.v.ok && /a day/.test(idea.x)), `the weekly trade idea is terms they would sign today: ${idea ? idea.x.slice(0, 160) + '…' : 'none to propose, so none sent'}`);
ok(!!idea === (deals.some(d => !d.o.get)), 'and there is an idea exactly when some computer nation has a deal to offer');

/* the clock stands still in this test, and the economy is worked out again when a save's time changes: move it on a
   second before each save, as time would */
let tick = 0; const later = () => page.clock.setFixedTime(T0 + (++tick) * 1000);
/* an old idea, from before: 40 iron a day, more than anyone spares */
await later();
const npc = (deals[0] && deals[0].id) || await game(() => window.__game.allNations().find(y => y.npc).id);
await game(id => {
  const G = window.__game, n = G.clone(G.S.nation), now = Date.now();
  n.dm = (n.dm || []).concat({ w: id, t: now - 60000, i: 1, x: 'A proposal, unasked. Shall we trade 40 iron for 35 of your food?', a: { k: 'idea', id, g: ['iron', 40], r: ['food', 35] } });
  G.commit(n); G.S.view = 'messages'; G.S.msgPeer = id; G.render();
}, npc);
await page.waitForSelector('.dm-att-c');
const oldCard = await page.$eval('.bub:last-child .dm-att-c', e => ({ t: e.innerText, sign: !!e.querySelector('[data-act="dm-idea-sign"]') }));
ok(/No longer possible\.|The terms in the letter no longer work\./.test(oldCard.t), `an old idea it cannot keep says so: “${oldCard.t.replace(/\s+/g, ' ').slice(0, 200)}”`);
ok(!/No longer possible/.test(oldCard.t) || !oldCard.sign, 'and offers no Sign button for terms that would fail');

/* good terms, signed from the letter */
const good = deals.find(d => d.id === npc && !d.o.get) || deals[0];
if (good) {
  await later();
  await game(d => {
    const G = window.__game, n = G.clone(G.S.nation), now = Date.now();
    n.dm = (n.dm || []).concat({ w: d.id, t: now - 1000, i: 1, x: 'A proposal, unasked.', a: { k: 'idea', id: d.id, g: d.r, r: d.g } });
    G.commit(n); G.S.view = 'messages'; G.S.msgPeer = d.id; G.render();
  }, good);
  await page.waitForSelector('.bub:last-child [data-act="dm-idea-sign"]');
  const t = await page.$eval('.bub:last-child .dm-att-c', e => e.innerText);
  ok(/would sign this today/.test(t) && /a day/.test(t), `terms they would sign show a Sign button: “${t.replace(/\s+/g, ' ').slice(0, 160)}”`);
  await page.locator('.bub:last-child .dm-att-c').screenshot({ path: path.join(OUT, 'npc-idea-card.png') }).catch(() => {});
  await later();
  await page.click('.bub:last-child [data-act="dm-idea-sign"]');
  const signed = await page.waitForFunction(d => (window.__game.S.nation.deals || []).some(x => x.w === d.id && x.g[0] === d.g[0] && x.r[0] === d.r[0]), good, { timeout: 5000 }).then(() => true, () => false);
  ok(signed, `Sign the deal signs it: ${good.r[1]} ${good.r[0]} a day for ${good.g[1]} ${good.g[0]} with ${good.id}`);
  await game(() => window.__game.render());
  const after = await page.$$eval('.dm-att-c', l => l.map(e => e.innerText.replace(/\s+/g, ' ')).join(' | '));
  ok(/Agreed/.test(after), 'and the card then says the deal is agreed: ' + after);
} else ok(true, 'no computer nation has a deal to offer this economy, so nothing to sign (the unit test covers signing terms)');

/* a letter asking for materials gets an answer about those materials */
const peer = npc;
await game(id => { const G = window.__game; G.S.view = 'messages'; G.S.msgPeer = id; G.render(); }, peer);
await page.waitForSelector('#dm-text');
await page.fill('#dm-text', 'Can you spare some iron? We have food to sell.');
await page.click('#dm-form button[type="submit"]');
await page.clock.setFixedTime(T0 + 3 * 60000);
await game(() => window.__game.render());
const reply = await page.waitForFunction(id => { const m = (window.__game.S.nation.dm || []).filter(x => x.i && x.w === id).pop(); return m && m.t <= Date.now() && m; }, peer, { timeout: 5000 }).then(h => h.jsonValue(), () => null);
ok(!!reply && /iron/.test(reply.x) && /(to spare|a day|need)/.test(reply.x), `the answer is about iron and food: “${reply && reply.x}”`);
ok(!reply || !reply.a || await game(a => window.__game.LTR().npcVerdict(a.id, a.r, a.g).ok, reply.a), 'and any terms it attaches are ones it would sign');
await page.locator('.thread').screenshot({ path: path.join(OUT, 'npc-reply.png') }).catch(() => {});

ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
