// River names chosen by players: every nation holding a stretch of a river names it there, from the map's side panel,
// and the nation holding most of a river names it across the region. Checked here: the panel says what the nation
// holds and what its name will do, the name goes on the nation's stretch (on the map, in the record, the history and
// the hover text) while the rest of the river keeps its name and lists the new one, it must be new to the region, a
// field being typed in survives the panel being drawn again, holding most of the river spreads the name, losing land
// takes it away and winning it back returns it, the old name can be brought back, short streams get a level label,
// and a river the map named can be renamed and given its name back.
//   python3 build.py
//   node test/river-names.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the
// test probe. Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });

/* public/ as Hosting would serve it, without the Firebase config, so the game starts in its local mode */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
/* toasts come and go on their own timers and can sit over what a click wants; the texts are kept for the checks */
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });
/* the river names are drawn a letter at a time in italic: the letters filled are kept, to read the names back */
await page.addInitScript(() => {
  window.__rvText = ''; window.__rvLevel = []; const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (/italic 600/.test(this.font)) { window.__rvText += String(t); if (String(t).length > 1) window.__rvLevel.push(String(t)); } return f.call(this, t, ...a); };
});

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* change the nation as a save would, and draw the page again */
const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
const txt = sel => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
/* the panel for one hex of the main map */
const select = async c => { await page.evaluate(c => { const G = window.__game; G.S.mapCell = c; G.S.mapSel = null; G.S.mapClaim = null; G.S.mapInspect = null; G.render(); }, c); await sleep(250); };
const river = id => page.evaluate(id => { const r = window.__game.RVN().RV.list[id]; return { name: r.name, name0: r.name0, by: r.by }; }, id);

try {
  await page.goto(BASE);
  await page.fill('#d-name', 'Riverholm');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await edit(n => { delete n.onb; });
  await go('nation');
  await page.click('text=Settle by the sea'); await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0), 8000);
  const recov = await page.$('[data-ed="recovery-saved"]'); if (recov) await recov.click().catch(() => {});
  await page.evaluate(() => window.__game.RVN().rvData());
  check('the river network is made', await until(() => page.evaluate(() => !!window.__game.RVN().RV), 20000));
  check('every river has a key of its own', await page.evaluate(() => { const RV = window.__game.RVN().RV; return RV.byKey.size === RV.list.length && RV.list.every(r => RV.byKey.get(window.__game.RVN().rvKey(r)) === r.id); }));

  /* a river in reach that nobody holds, away from other capitals, with a few edges: the nation will hold its upper
     stretch first (less than half of it), then all of it */
  const pick = await page.evaluate(() => {
    const G = window.__game, K = G.RVN(), RV = K.RV, T = G.territory(), mi = T.list.findIndex(x => x.me), cap = T.list[mi].cap;
    const free = c => T.owner[c] < 0 && G.MAP.T[c] >= 2 && T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 3) && K.hexDist(c, cap) <= 60;
    const ok = RV.list.filter(r => r.len >= 4 && r.cells.length <= 30 && r.cells.every(free));
    ok.sort((a, b) => K.hexDist(a.cells[0], cap) - K.hexDist(b.cells[0], cap));
    for (const r of ok) {
      const other = RV.list.find(o => o.name0 && o.id !== r.id);
      /* the upper stretch: the banks of its first edges, fewer than half its bank hexes */
      const m = Math.max(1, Math.floor(r.len / 4)), up = [...new Set(r.bk.slice(0, 2 * m))], low = r.cells.filter(c => !up.includes(c));
      /* the hexes to select: ones whose panel speaks of this river (a hex between two rivers speaks of the larger) */
      const sel = up.find(c => RV.at.get(c) === r.id), far = low.slice().reverse().find(c => RV.at.get(c) === r.id);
      if (sel === undefined || far === undefined) continue;
      return { id: r.id, key: K.rvKey(r), cells: [...r.cells], up, low, sel, far, m, len: r.len, name0: r.name0, cls: r.cls, other: other ? other.name0 : null, reg: K.REG.id };
    }
    return null;
  });
  check('a free river is found near the test nation', !!pick, 'no river with every bank hex free within reach');
  if (!pick) throw new Error('no river to name');
  const what = pick.cls >= 2 ? 'river' : 'stream', N = pick.cells.length, U = pick.up.length;
  const label0 = await page.evaluate(id => window.__game.RVN().rvLabel(window.__game.RVN().RV.list[id]), pick.id);
  console.log(`     the ${what} ${pick.name0 || '(unnamed)'}: ${pick.len} edges, ${N} hexes on its banks; the nation holds the first ${pick.m} edges (${U} hexes)`);

  /* the upper stretch */
  await edit((n, now, G, cells) => { n.claims = (n.claims || []).concat(cells.map((c, i) => ({ c, t: now - 60e3 + i }))); }, pick.up);
  await go('map');
  await select(pick.sel);
  check('the panel names the river on a hex of its bank', await page.locator('#map-panel .rv-pn').count() === 1, await txt('#map-panel'));
  const own = await txt('#map-panel .rvn-own');
  check('holding a stretch of it, the nation may name it there', !!own && own.includes(`Your name for this ${what} goes on the stretches in your land (${U} of ${N} hexes on its banks are yours)`), own);
  const btn = await txt('#map-panel [data-act="rvn-edit"]');
  check('with a button to name or rename it', btn === `${pick.name0 ? 'Rename' : 'Name'} the ${what}`, btn);
  await page.click('#map-panel [data-act="rvn-edit"]');
  check('the button opens a name field, focused, holding the present name', await until(() => page.evaluate(n0 => { const i = document.getElementById('rvn-name'); return !!i && document.activeElement === i && i.value === n0; }, pick.name0 || '')));
  check('the field says the name goes on the stretches in the nation\'s land', ((await txt('#rvn-form .hint')) || '').includes('The name goes on the stretches in your land'));
  await page.screenshot({ path: path.join(OUT, 'river-names-form.png') });

  /* a name already in the region is refused */
  if (pick.other) {
    await page.fill('#rvn-name', pick.other);
    await page.click('#rvn-form button[type="submit"]'); await sleep(250);
    const err = await txt('#rvn-form .err');
    check('a name another river has is refused', !!err && err.includes('There is already a river called'), err);
    check('and nothing is saved', await page.evaluate(() => !window.__game.S.nation.rvn));
  }

  /* typing survives the panel being drawn again (a save from another player redraws it) */
  await page.fill('#rvn-name', ''); await page.type('#rvn-name', 'the Silverfl');
  await page.evaluate(() => window.__game.RVN().updateMapPanel());
  check('a half-typed name keeps its focus and its text when the panel is drawn again', await page.evaluate(() => { const i = document.getElementById('rvn-name'); return !!i && document.activeElement === i && i.value === 'the Silverfl' && i.selectionStart === 12; }));
  await page.type('#rvn-name', 'ow');
  await page.click('#rvn-form button[type="submit"]'); await sleep(300);

  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation.rvn || null)));
  check('the name is saved in the nation\'s record', Array.isArray(saved) && saved.length === 1 && saved[0].r === pick.reg && saved[0].v === pick.key && saved[0].n === 'the Silverflow', JSON.stringify(saved));
  const at = c => page.evaluate(([id, c]) => window.__game.RVN().rvNameAt(window.__game.RVN().RV.list[id], c), [pick.id, c]);
  check('the stretch in the nation\'s land is called by it', await at(pick.sel) === 'the Silverflow');
  check('the rest of the river keeps its own name', await at(pick.far) === pick.name0, await at(pick.far));
  let rv = await river(pick.id);
  check('and so does the river as a whole, since most of it is elsewhere', rv.name === pick.name0 && rv.by === null, JSON.stringify(rv));
  check('the panel shows the new name', (await txt('#map-panel .rv-l b')) === 'The Silverflow', await txt('#map-panel .rv-l'));
  const mine = await txt('#map-panel .rvn-own');
  check('and says what the nation calls it', !!mine && mine.startsWith('You call it the Silverflow'), mine);
  check('a rename button stays for another go', (await txt('#map-panel [data-act="rvn-edit"]')) === `Rename the ${what}`);
  const line = await page.evaluate(() => { const G = window.__game, n = G.S.nation; return G.RVN().logLine(n.log[0], n, G.S.uid); });
  check('the history has a line for it', line === (pick.name0 ? `${pick.name0[0].toUpperCase() + pick.name0.slice(1)} was renamed the Silverflow.` : 'A river was named the Silverflow.'), line);
  check('a hover over the stretch speaks of the new name', await page.evaluate(([id, c]) => window.__game.RVN().rvLabelAt(window.__game.RVN().RV.list[id], c), [pick.id, pick.sel]) === 'the Silverflow');

  /* downstream, outside the nation's land: the river's own name, and the new one among its other names */
  await select(pick.far);
  const far = await txt('#map-panel .rv-l b');
  check('downstream the panel has the river\'s own name', far === label0[0].toUpperCase() + label0.slice(1), far);
  const aka = await txt('#map-panel .rvn-aka');
  check('and lists the name the nation gave upstream', aka === 'Also called the Silverflow in Riverholm.', aka);
  check('no naming offered on land that is not the nation\'s', await page.locator('#map-panel [data-act="rvn-edit"]').count() === 0);

  /* on the map: close in on the stretch and read the names drawn */
  const drawn = await page.evaluate(async ([id, m]) => {
    const G = window.__game, K = G.RVN(), M = G.MAP, cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    const r = K.RV.list[id], P = r.pts, mid = P[Math.min(P.length - 1, Math.ceil(m / 2))], base = Math.min(cv.clientWidth / M.W, cv.clientHeight / M.H), len = Math.max(10, m * 10);
    G.S.mapViews.main = { z: Math.min(20, Math.max(34 / K.HEX_W, 200 / len) / base), cx: mid[0], cy: mid[1] };
    G.S.mapCell = null; window.__rvText = ''; scrollTo(0, 0); G.render();
    for (let k = 0; k < 40 && !/Silverflow/.test(window.__rvText); k++) await new Promise(r => setTimeout(r, 100));
    return window.__rvText.includes('the Silverflow');
  }, [pick.id, pick.m]);
  check('the new name is drawn along the nation\'s stretch on the map', drawn);
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'river-names-map.png') });

  /* the rest of the river too: now most of it is the nation's, and its name is the river's across the region */
  await edit((n, now, G, cells) => { n.claims = n.claims.concat(cells.map((c, i) => ({ c, t: now + i }))); }, pick.low);
  await go('map'); await select(pick.sel);
  rv = await river(pick.id);
  check('holding most of it, the nation\'s name is the river\'s', rv.name === 'the Silverflow' && rv.by === await page.evaluate(() => window.__game.S.uid || 'me'), JSON.stringify(rv));
  check('downstream too', await at(pick.far) === 'the Silverflow');
  const most = await txt('#map-panel .rvn-own');
  check('the panel says so', !!most && most.includes(`Most of this ${what} runs through your land (${N} of ${N} hexes on its banks)`), most);

  /* the lower stretch lost again: the name is back on the upper stretch only */
  await edit((n, now, G, cells) => { n.claims = n.claims.filter(e => !cells.includes(e.c)); }, pick.low);
  await select(pick.sel);
  rv = await river(pick.id);
  check('most of it lost: the river\'s own name is back across the region', rv.name === pick.name0 && rv.by === null, JSON.stringify(rv));
  check('while the nation\'s stretch keeps its name', await at(pick.sel) === 'the Silverflow');

  /* the whole stretch lost: no name shows, and it comes back with the land */
  await edit((n, now, G, cells) => { n.claims = n.claims.filter(e => !cells.includes(e.c)); }, pick.up);
  rv = await river(pick.id);
  check('the stretch lost: the old name is back', await at(pick.sel) === pick.name0 && rv.name === pick.name0, await at(pick.sel));
  check('the name stays in the record', await page.evaluate(() => (window.__game.S.nation.rvn || []).length === 1));
  await edit((n, now, G, cells) => { n.claims = n.claims.concat(cells.map((c, i) => ({ c, t: now + i }))); }, pick.up);
  await select(pick.sel);
  check('the stretch won back: the new name is back with it', await at(pick.sel) === 'the Silverflow');

  /* Cancel closes the field */
  await page.click('#map-panel [data-act="rvn-edit"]'); await sleep(200);
  await page.click('#map-panel [data-act="rvn-cancel"]'); await sleep(200);
  check('Cancel closes the field', await page.locator('#rvn-form').count() === 0);

  /* bring back the old name */
  await page.click('#map-panel [data-act="rvn-edit"]'); await sleep(200);
  const reset = await txt('#map-panel [data-act="rvn-reset"]');
  check('the field offers the old name back', reset === (pick.name0 ? 'Bring back ' + pick.name0 : 'Take the name away'), reset);
  await page.click('#map-panel [data-act="rvn-reset"]'); await sleep(300);
  check('the old name is back', await at(pick.sel) === pick.name0);
  check('and the record holds no name', await page.evaluate(() => !window.__game.S.nation.rvn));
  check('a rename and its undoing leave no line in the history', await page.evaluate(() => !window.__game.S.nation.log.some(l => l.k === 'rvren' && [l.a, l.b].includes('the Silverflow'))));

  /* on a phone the panel's field fits */
  await page.setViewportSize({ width: 390, height: 844 });
  await go('map'); await select(pick.sel);
  /* the panel is a sheet at the foot of the screen there: opened by its handle */
  if (await page.locator('#map-panel .mp-grab[aria-expanded="false"]').count()) { await page.click('#map-panel .mp-grab'); await sleep(400); }
  await page.click('#map-panel [data-act="rvn-edit"]'); await sleep(300);
  const fits = await page.evaluate(() => { const f = document.getElementById('rvn-form'); if (!f) return 'no form'; const b = f.getBoundingClientRect(); return b.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1 ? true : `${b.right} > ${innerWidth}`; });
  check('on a phone the name field fits the screen', fits === true, fits);
  await page.evaluate(() => document.getElementById('rvn-form') && document.getElementById('rvn-form').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(OUT, 'river-names-phone.png') });
  await page.click('#map-panel [data-act="rvn-cancel"]').catch(() => {});

  /* a stream too short for its name to follow it has the name written level above its middle */
  await page.setViewportSize({ width: 1280, height: 900 });
  const tiny = await page.evaluate(([taken]) => {
    const G = window.__game, K = G.RVN(), RV = K.RV, T = G.territory(), mi = T.list.findIndex(x => x.me), cap = T.list[mi].cap;
    const free = c => (T.owner[c] < 0 || T.owner[c] === mi) && !taken.includes(c) && G.MAP.T[c] >= 2 && T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 3) && K.hexDist(c, cap) <= 60;
    const r = RV.list.filter(r => !r.name0 && r.len <= 2 && r.cells.every(free)).sort((a, b) => K.hexDist(a.cells[0], cap) - K.hexDist(b.cells[0], cap))[0];
    return r ? { id: r.id, key: K.rvKey(r), cells: [...r.cells] } : null;
  }, [pick.cells]);
  if (!tiny) console.log('     (no free stream of one or two edges near the nation: the level label is not checked this run)');
  else {
    await edit((n, now, G, cells) => { const have = new Set(n.claims.map(e => e.c)); n.claims = n.claims.concat(cells.filter(c => !have.has(c)).map((c, i) => ({ c, t: now + i }))); }, tiny.cells);
    const named = await page.evaluate(k => window.__game.RVN().rvRename(k, 'the Tiny Run'), tiny.key);
    check('a short stream held whole is named', named === true && (await river(tiny.id)).name === 'the Tiny Run');
    await go('map');
    const level = await page.evaluate(async id => {
      const G = window.__game, K = G.RVN(), M = G.MAP, r = K.RV.list[id], P = r.pts, mid = P[P.length >> 1], cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0], base = Math.min(cv.clientWidth / M.W, cv.clientHeight / M.H);
      G.S.mapViews.main = { z: Math.min(20, 30 / K.HEX_W / base), cx: mid[0], cy: mid[1] }; G.S.mapCell = null; window.__rvLevel = []; scrollTo(0, 0); G.render();
      for (let k = 0; k < 40 && !window.__rvLevel.includes('the Tiny Run'); k++) await new Promise(r => setTimeout(r, 100));
      return window.__rvLevel.includes('the Tiny Run');
    }, tiny.id);
    check('its name is written level beside it on the map', level);
    await sleep(300); await page.screenshot({ path: path.join(OUT, 'river-names-level.png') });
  }

  /* a river the map named: the nation moves its capital beside one nobody holds, and claims the whole of it */
  const big = await page.evaluate(() => {
    const G = window.__game, K = G.RVN(), RV = K.RV, M = G.MAP, T = G.territory(), mi = T.list.findIndex(x => x.me);
    const far = c => T.list.every((y, j) => j === mi || K.hexDist(c, y.cap) > 6);
    for (const r of RV.list.filter(r => r.name0 && r.cells.length <= 40).sort((a, b) => a.cells.length - b.cells.length)) {
      if (!r.cells.every(c => T.owner[c] < 0 && far(c))) continue;
      const mid = r.cells[r.cells.length >> 1], on = new Set(r.cells);
      /* a capital 4 to 6 hexes from the river, so its core does not reach the banks and the claims alone decide */
      const near = c => { let d = 99; for (const x of r.cells) d = Math.min(d, K.hexDist(c, x)); return d; };
      for (let c = 0; c < M.N; c++) if (M.T[c] >= 2 && M.T[c] < 4 && !on.has(c) && T.owner[c] < 0 && far(c) && K.hexDist(c, mid) <= 9) { const d = near(c); if (d >= 4 && d <= 6) return { id: r.id, key: K.rvKey(r), cells: [...r.cells], name0: r.name0, cap: c, cls: r.cls }; }
    }
    return null;
  });
  if (!big) console.log('     (no named river free of other nations on this map: renaming a named river is not checked this run)');
  else {
    console.log(`     ${big.name0}: ${big.cells.length} hexes on its banks`);
    await edit((n, now, G, b) => { const M = G.MAP, cap = n.cities.find(c => c.c === M.COLS * n.loc.r + n.loc.c) || n.cities[0];
      n.loc = { ...n.loc, c: b.cap % M.COLS, r: Math.floor(b.cap / M.COLS) }; cap.c = b.cap; n.cities = [cap]; n.claims = b.cells.map((c, i) => ({ c, t: now + i })); delete n.rvn; }, big);
    await go('map'); await select(big.cells[1]);
    const wb = big.cls >= 2 ? 'river' : 'stream';
    check('a named river held whole can be renamed', (await txt('#map-panel [data-act="rvn-edit"]')) === `Rename the ${wb}`, await txt('#map-panel .rv-pn'));
    await page.click('#map-panel [data-act="rvn-edit"]');
    await until(() => page.evaluate(() => !!document.getElementById('rvn-name')));
    check('the field holds its present name', await page.evaluate(n0 => document.getElementById('rvn-name').value === n0, big.name0));
    await page.fill('#rvn-name', 'The Goldrun'); await page.click('#rvn-form button[type="submit"]'); await sleep(300);
    check('a leading The is written as the map writes it', (await river(big.id)).name === 'the Goldrun');
    const hl = await page.evaluate(() => { const G = window.__game, n = G.S.nation; return G.RVN().logLine(n.log[0], n, G.S.uid); });
    check('the history says what it was called', hl === `${big.name0[0].toUpperCase() + big.name0.slice(1)} was renamed the Goldrun.`, hl);
    check('the panel keeps the map’s name beside the new one', ((await txt('#map-panel .rvn-own')) || '').includes(big.name0));
    await page.click('#map-panel [data-act="rvn-edit"]'); await sleep(200);
    check('the field offers the map’s name back', (await txt('#map-panel [data-act="rvn-reset"]')) === 'Bring back ' + big.name0);
    await page.click('#map-panel [data-act="rvn-reset"]'); await sleep(300);
    check('and brings it back', (await river(big.id)).name === big.name0 && await page.evaluate(() => !window.__game.S.nation.rvn));
    check('a rename undone within hours leaves no line', await page.evaluate(() => !window.__game.S.nation.log.some(l => l.k === 'rvren' && [l.a, l.b].includes('the Goldrun'))), JSON.stringify(await page.evaluate(() => window.__game.S.nation.log.slice(0, 5))));
    /* typing the map's own name back is the same as bringing it back */
    await page.evaluate(k => window.__game.RVN().rvRename(k, 'the Goldrun'), big.key);
    await page.evaluate(([k, n0]) => window.__game.RVN().rvRename(k, n0), [big.key, big.name0]);
    check('typing the old name back brings it back', (await river(big.id)).name === big.name0 && await page.evaluate(() => !window.__game.S.nation.rvn));
    /* a river shared: the nation keeps its upper part only, so its name is on its stretch and the map's on the rest */
    await page.evaluate(k => window.__game.RVN().rvRename(k, 'the Goldrun'), big.key);
    const half = await page.evaluate(id => { const r = window.__game.RVN().RV.list[id], m = Math.ceil(r.len / 3); return [...new Set(r.bk.slice(0, 2 * m))]; }, big.id);
    await edit((n, now, G, keep) => { n.claims = n.claims.filter(e => keep.includes(e.c)); }, half);
    const both = await page.evaluate(async id => {
      const G = window.__game, K = G.RVN(), M = G.MAP, r = K.RV.list[id], P = r.pts, cv = [...document.querySelectorAll('canvas.map-cv')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const base = Math.min(cv.clientWidth / M.W, cv.clientHeight / M.H), fit = Math.min(cv.clientWidth / (x1 - x0 + 60), cv.clientHeight / (y1 - y0 + 60));
      G.S.mapViews.main = { z: Math.min(20, Math.max(22 / K.HEX_W, Math.min(fit, 60 / K.HEX_W)) / base), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; G.S.mapCell = null; window.__rvText = ''; scrollTo(0, 0); G.render();
      for (let k = 0; k < 40 && !(window.__rvText.includes('the Goldrun') && window.__rvText.includes(r.name0)); k++) await new Promise(res => setTimeout(res, 100));
      return { most: K.RV.list[id].name, parts: K.rvParts(r, r._g.P.length).map(p => p.nm), g: window.__rvText.includes('the Goldrun'), o: window.__rvText.includes(r.name0) };
    }, big.id);
    check('a river shared: the nation’s name on its stretch, the map’s on the rest', both.most === big.name0 && both.parts.join('|') === 'the Goldrun|' + big.name0, JSON.stringify(both));
    check('and both names are drawn along their own stretches on the map', both.g && both.o, JSON.stringify(both));
    await sleep(300); await page.screenshot({ path: path.join(OUT, 'river-names-shared.png') });
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('FAIL', e.stack || e.message); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
