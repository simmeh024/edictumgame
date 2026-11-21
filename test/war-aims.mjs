// A war's aim (game/edictum.html, "war, round two"): chosen when war is declared; a raid takes no land but materials, and
// leaves the hex idle; a border war stops at BORDER_CAP hexes; every attack wears the nation down.
//   python3 build.py
//   node test/war-aims.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators): the battle is rolled in the page, and
// Math.random is set for it. Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch();

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.waitForSelector('#d-name');
  await page.fill('#d-name', 'Raidmark');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const go = async v => { await ev(v => { location.hash = '#' + v; }, v); await until(() => ev(v => window.__game.S.view === v, v)); await sleep(350); };
  const act = a => ev(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
  await go('map'); await act('map-suggest'); await act('settle'); await until(() => ev(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await ev(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });
  /* big enough for war (this browser alone keeps no rules on growth) */
  await ev(() => { const G = window.__game, n = G.clone(G.S.nation); n.pop = 20; n.popAt = Date.now(); G.commit(n); });

  /* the computer nation nearest to us, and a hex of its own next to ours: our capital moved beside it (this page only) */
  const plan = await ev(() => {
    const G = window.__game, M = G.MAP, T = G.territory(), D = T.list.filter(x => x.npc)[0], di = T.byId[D.id];
    const nb = c => { const o = []; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0) o.push(j); } return o; };
    for (let c = 0; c < M.N; c++) { if (T.owner[c] !== di || T.isCap[c] || M.T[c] < 2) continue; const free = nb(c).find(j => T.owner[j] === -1 && M.T[j] >= 2 && nb(j).every(k => T.owner[k] === -1 || T.owner[k] === di)); if (free != null) return { D: D.id, Dn: D.n.name, c, free }; }
    return null;
  });
  check('a computer nation with a hex beside free land', !!plan, plan);
  await ev(p => { const G = window.__game, n = G.clone(G.S.nation); n.loc = G.locOf(p.free); n.capAt = Date.now() - 60000; G.commit(n); }, plan);

  /* 1. declaring war asks what it is for */
  await ev(id => { const G = window.__game; G.S.mapSel = id; G.S.mapTarget = null; G.updateMapPanel(); }, plan.D);
  await page.click('#map-panel [data-act="war-ask"]');
  await page.waitForSelector('#map-panel .wr-goals');
  const goals = await ev(() => [...document.querySelectorAll('#map-panel .wr-goal b')].map(b => b.textContent));
  check('the three aims are offered, a border war first', JSON.stringify(goals) === '["Border war","Conquest","Raid"]', goals);
  check('a border war is chosen until another is', await ev(() => document.querySelector('#map-panel .wr-goal input[data-g="b"]').checked));
  await page.click('#map-panel .wr-goal input[data-g="r"]');
  await until(() => ev(() => document.querySelector('#map-panel .wr-goal input[data-g="r"]')?.checked));
  await page.screenshot({ path: path.join(OUT, 'war-aims-declare.png') });
  check('choosing Raid keeps the box open, Raid ticked', await ev(() => !!document.querySelector('#map-panel .wr-goal.on input[data-g="r"]')));
  await page.click('#map-panel [data-act="war-declare"]');
  check('the war is declared as a raid', await until(() => ev(id => window.__game.S.nation.wars?.[id]?.g === 'r', plan.D)), await ev(id => window.__game.S.nation.wars?.[id], plan.D));
  check('the log names the aim', await ev(id => { const l = window.__game.S.nation.log.find(x => x.k === 'war' && x.a === id); return l && l.fx === 'Raid'; }, plan.D));

  /* 2. a raid: the hex stays theirs; the raiders bring materials home */
  const st0 = await ev(() => { const G = window.__game; return { ...G.S.nation.stock, ww: G.S.nation.wwy || 0 }; });
  const dbg = await ev(p => { const G = window.__game, T = G.territory(), fr = G.frontier(T), mi = T.byId[G.myId()]; return { front: fr.has(p.c), size: fr.size, mine: T.owner[p.free] === mi, capMine: T.list[mi] && T.list[mi].cap, free: p.free, w: G.WR2().warWith(p.D) }; }, plan);
  /* the hex to raid: one of theirs on the front, now that our land has grown round the new capital */
  plan.c = await ev(p => { const G = window.__game, T = G.territory(), di = T.byId[p.D]; for (const c of G.frontier(T).keys()) if (T.owner[c] === di) return c; return -1; }, plan);
  check('one of their hexes is on the front', plan.c >= 0, dbg);
  await ev(c => { const G = window.__game; G.S.mapTarget = c; G.S.mapSel = null; G.updateMapPanel(); }, plan.c);
  check('the attack panel says it is a raid', /A raid\. Victory takes no land/.test(await ev(() => document.querySelector('#map-panel .wr-tp')?.textContent || '')));
  await ev(() => { const r = Math.random; let k = 0; Math.random = () => (k++ === 0 ? 0 : 0.999); window.__restoreRandom = () => { Math.random = r; }; });
  await page.click('#map-panel [data-act="attack"]');
  await until(() => ev(() => !window.__game.S.mapTarget));
  await ev(() => window.__restoreRandom());
  const st1 = await ev(p => { const G = window.__game, T = G.territory(), n = G.S.nation; return { owner: T.list[T.owner[p.c]]?.id, raid: (n.raid || []).length, conq: (n.conq || []).filter(e => e.c === p.c).length, stock: n.stock, ww: n.wwy, msg: G.S.warMsg, log: n.log[0].k, idle: G.economy && [...(function () { try { return window.__game.WR2 ? [] : []; } catch (e) { return []; } })()] }; }, plan);
  check('the hex is still theirs, raided, not taken', st1.owner === plan.D && st1.raid === 1 && st1.conq === 0, st1);
  check('the raiders brought materials home', st1.stock.iron > st0.iron && st1.stock.goods >= st0.goods, { before: st0, after: st1.stock });
  check('the log and the message say so', st1.log === 'raid' && /Your raiders struck/.test(st1.msg), st1.msg);
  check('every attack wears the nation down a little', st1.ww >= st0.ww + 0.25, st1.ww);

  /* 3. a border war stops at 12 hexes */
  await ev(p => { const G = window.__game, n = G.clone(G.S.nation), now = Date.now(); n.wars = { ...n.wars, [p.D]: { t: now - 60000, g: 'b' } }; n.conq = (n.conq || []).concat(Array.from({ length: 12 }, (_, i) => ({ c: 100000 + i, t: now - 1000 + i, d: p.D }))); G.commit(n); }, plan);
  await ev(c => { const G = window.__game; G.S.mapTarget = c; G.updateMapPanel(); }, plan.c);
  check('the panel counts the border war\'s hexes', /A border war: 12 of the 12 hexes it may take/.test(await ev(() => document.querySelector('#map-panel .wr-tp')?.textContent || '')));
  await page.click('#map-panel [data-act="attack"]');
  check('and the army goes no further', await until(() => ev(() => /border war, and your army has taken the 12 hexes it may/.test(window.__game.S.warMsg || ''))), await ev(() => window.__game.S.warMsg));
  check('no page errors', !errors.length, errors.slice(0, 5));
} catch (e) { console.log('FAIL', e && e.stack || e); failed++; }
finally { await browser.close(); server.close(); }
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
