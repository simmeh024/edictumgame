import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

// The 100-nation gift: once Edictum has 100 nations, each of the first hundred sees a pop-up with two boxes. The first
// gives 100 of every material, the second the Triumph regalia (Centum pattern, Triumph Purple map colour, Triumphal
// arch shield). The counts are set by hand here (no Firestore in this test): M100.tot all nations, M100.after those
// founded after this one.
//   python3 build.py && node test/milestone-100.mjs
const RES = ['food', 'timber', 'iron', 'oil', 'goods'];
for (const [theme, viewport, tag] of [['light', { width: 1280, height: 860 }, 'desk'], ['dark', { width: 390, height: 844 }, 'phone']]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; window.EDICTUM_M100 = 1; try { localStorage.setItem('statehood.mlkopen.v1', '1'); } catch (e) {} });
  await page.goto(BASE);
  await page.fill('#d-name', 'Centuria'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0));
  /* founded after the 50-player cut, so only this gift is due */
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.onb; n.founded = Date.UTC(2026, 10, 14, 9, 30); n.stock = { food: 10, timber: 10, iron: 10, oil: 10, goods: 10 }; n.stockAt = Date.now(); G.commit(n); G.render(); });
  const set = (tot, after) => page.evaluate(([tot, after]) => { const P = window.__game.M100P(), n = window.__game.S.nation; Object.assign(P.M100, { tot, after, f: Math.floor(n.founded), later: false }); }, [tot, after]);
  const shown = () => page.evaluate(() => !!document.getElementById('m100'));

  await sleep(2600);
  check(`${tag}: no pop-up before any count`, !(await shown()));
  await set(99, null); await sleep(2600);
  check(`${tag}: no pop-up at 99 nations`, !(await shown()));
  await set(130, 20); await sleep(2600);
  check(`${tag}: no pop-up for the 110th nation of 130`, !(await shown()));
  const locked = await page.evaluate(() => { const P = window.__game.M100P(), n = window.__game.S.nation; return { sh: P.czShOk(n, 'triumph'), mc: P.ctgMcOk(n, P.M100_MC), pt: P.unlocksOf(n).has('p-centum') }; });
  check(`${tag}: regalia locked before`, !locked.sh && !locked.mc && !locked.pt, locked);

  await set(100, 0);
  check(`${tag}: pop-up shows for the 100th nation`, await until(shown, 6000));
  const ui = await page.evaluate(() => ({ boxes: document.querySelectorAll('#m100 .m100-gift .m50-box').length, h: document.getElementById('m100-h').textContent,
    focus: document.activeElement && document.activeElement.id, ok: document.getElementById('m100-ok').hidden, say: document.getElementById('m100-say').textContent,
    over: (() => { const d = document.querySelector('#m100 .m50').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 0.5; })() }));
  check(`${tag}: two boxes, a heading and the first box focused`, ui.boxes === 2 && /100 nations milestone reached/.test(ui.h) && ui.focus === 'm100-box1', ui);
  check(`${tag}: Collect waits until both are open`, ui.ok === true && /Click a box/.test(ui.say), ui);
  check(`${tag}: the dialog fits the screen`, ui.over, ui);
  await sleep(300); await page.screenshot({ path: path.join(OUT, `m100-${tag}-closed.png`) });

  /* the first box: supplies */
  await page.click('#m100-box1'); await sleep(900);
  const a = await page.evaluate(() => { const n = window.__game.S.nation, P = window.__game.M100P(); return { m: n.m100, st: n.stock, xs: P.xsMax(n), sh: P.czShOk(n, 'triumph'), say: document.getElementById('m100-say').textContent, ok: document.getElementById('m100-ok').hidden, focus: document.activeElement && document.activeElement.id }; });
  check(`${tag}: box 1 sets bit 1`, a.m === 1, a);
  check(`${tag}: box 1 gives +100 of each material`, RES.every(r => Math.floor(a.st[r]) >= 110), a.st);
  check(`${tag}: the stock may stay over the limit by 100`, a.xs >= 100, a.xs);
  check(`${tag}: box 1 alone leaves the regalia locked`, !a.sh && /One more box/.test(a.say) && a.ok === true, a);
  check(`${tag}: focus moves to the second box`, a.focus === 'm100-box2', a);
  /* closing with a box still shut brings it back, with the first one shown open */
  await page.click('#m100-later'); await sleep(300);
  check(`${tag}: Later closes it`, !(await shown()));
  await page.evaluate(() => { window.__game.M100P().M100.later = false; });
  check(`${tag}: it comes back with the second box still to open`, await until(shown, 6000));
  const back = await page.evaluate(() => ({ g1: document.getElementById('m100-g1').classList.contains('open'), g2: document.getElementById('m100-g2').classList.contains('open') }));
  check(`${tag}: box 1 shown open, box 2 shut`, back.g1 && !back.g2, back);
  /* the second: the regalia (income keeps adding meanwhile, so the stock is compared just before and after) */
  const before = await page.evaluate(() => { const G = window.__game; return G.M100P && G.S.nation.stock; });
  await page.click('#m100-box2'); await sleep(900);
  await page.screenshot({ path: path.join(OUT, `m100-${tag}-open.png`) });
  const b = await page.evaluate(() => { const n = window.__game.S.nation, P = window.__game.M100P(); return { m: n.m100, st: n.stock, sh: P.czShOk(n, 'triumph'), mc: P.ctgMcOk(n, P.M100_MC), pt: P.unlocksOf(n).has('p-centum'),
    ok: document.getElementById('m100-ok').hidden, later: document.getElementById('m100-later').hidden, go: document.getElementById('m100-go').hidden, say: document.getElementById('m100-say').textContent, focus: document.activeElement && document.activeElement.id }; });
  check(`${tag}: box 2 sets bit 2`, b.m === 3, b);
  check(`${tag}: box 2 adds no materials`, RES.every(r => b.st[r] - before[r] < 50), { before, after: b.st });
  check(`${tag}: shield, map colour and pattern unlocked`, b.sh && b.mc && b.pt, b);
  check(`${tag}: Collect and the Customise link show, Later goes`, !b.ok && !b.go && b.later && /Both gifts/.test(b.say) && b.focus === 'm100-ok', b);
  /* both open twice is still +100 */
  const c0 = await page.evaluate(() => window.__game.S.nation.stock);
  await page.evaluate(() => { const P = window.__game.M100P(); P.m100Open(1); P.m100Open(2); });
  const c = await page.evaluate(() => window.__game.S.nation.stock);
  check(`${tag}: opening again gives nothing more`, RES.every(r => c[r] - c0[r] < 50), { c0, c });
  await page.click('#m100-ok'); await sleep(300);
  check(`${tag}: Collect closes it`, !(await shown()));
  await sleep(2600);
  check(`${tag}: not again`, !(await shown()));
  check(`${tag}: m100 kept when the record is normalised`, await page.evaluate(() => { const G = window.__game; return G.S.nation.m100 === 3; }));

  /* where the regalia are worn */
  await page.evaluate(() => { location.hash = '#customise'; }); await sleep(900);
  await page.evaluate(() => { const b = document.querySelector('[data-act="cz-sec"][data-v="a"]'); if (b) b.click(); }); await sleep(700);
  const shield = await page.evaluate(() => { const e = document.getElementById('cz-a-s-triumph'); return e ? { tag: e.tagName, locked: e.classList.contains('locked') } : null; });
  check(`${tag}: Triumphal arch tile usable in Customise › Coat of arms`, !!shield && shield.tag === 'BUTTON' && !shield.locked, shield);
  if (shield && !shield.locked) { await page.click('#cz-a-s-triumph'); await sleep(400); }
  check(`${tag}: the shield can be chosen`, await page.evaluate(() => { const a = window.__game.S.nation.cz && window.__game.S.nation.cz.a; return !!a && a.s === 'triumph'; }));
  await page.evaluate(() => { const b = document.querySelector('[data-act="cz-sec"][data-v="b"]'); if (b) b.click(); }); await sleep(700);
  const pat = await page.evaluate(() => { const e = document.getElementById('cz-p-p-centum'); return e ? { locked: e.classList.contains('locked'), svg: !!e.querySelector('svg.czp path') } : null; });
  check(`${tag}: Centum pattern usable in Customise › Banner`, !!pat && !pat.locked && pat.svg, pat);
  if (pat) { await page.click('#cz-p-p-centum'); await sleep(400); }
  check(`${tag}: the pattern can be chosen`, await page.evaluate(() => { const c = window.__game.S.nation.cz; return !!c && c.p === 'p-centum' && (c.u || []).includes('p-centum'); }));
  if (tag === 'desk') await page.locator('#cz-p-p-centum').screenshot({ path: path.join(OUT, 'm100-pattern.png') }).catch(() => {});

  await page.evaluate(() => { location.hash = '#settings'; }); await sleep(900);
  await page.evaluate(() => { const b = document.querySelector('[data-act="sg-tab"][data-v="nation"]'); if (b) b.click(); }); await sleep(500);
  const sw = await page.evaluate(() => !!document.querySelector('#set-mapc [data-act="mapc"][data-val="#7A1F5C"]'));
  check(`${tag}: Triumph Purple offered in Settings › Map colour`, sw);
  if (sw) { await page.click('#set-mapc [data-act="mapc"][data-val="#7A1F5C"]'); await sleep(300); await page.click('#settings-form button[type="submit"]'); await sleep(500); }
  const worn = await page.evaluate(() => { const G = window.__game, n = G.S.nation, P = G.M100P(); return { mapc: n.mapc, col: P.nationColor(n), other: P.nationColor({ ...n, m100: 1 }), prev: (document.querySelector('.mapc-prev .hint') || {}).textContent }; });
  check(`${tag}: saved and worn on the map`, worn.mapc === '#7A1F5C' && worn.col === '#7A1F5C' && /triumph purple/.test(worn.prev || ''), worn);
  check(`${tag}: a nation without the regalia box cannot wear it`, worn.other !== '#7A1F5C', worn);

  await page.evaluate(() => { location.hash = '#map'; }); await sleep(1200);
  /* the land office offers a block while the first credits wait: cancel it to see the panel's own cards */
  await page.evaluate(() => { const b = [...document.querySelectorAll('#map-panel button')].find(x => /^Cancel$/.test(x.textContent.trim())); if (b) b.click(); });
  check(`${tag}: and on the map look card`, await until(() => page.evaluate(() => !!document.querySelector('#map-panel .mlk [data-act="mlk-mc"][data-val="#7A1F5C"]')), 4000));

  /* another nation, founded later: the 101st of 101 never sees it */
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.m100; n.founded = Date.UTC(2026, 10, 30); G.commit(n); G.render(); });
  await set(101, 0); await sleep(2600);
  check(`${tag}: the 101st nation gets no pop-up`, !(await shown()));
  check(`${tag}: and loses the regalia with the record`, await page.evaluate(() => { const G = window.__game, P = G.M100P(), n = G.S.nation; return !P.czShOk(n, 'triumph') || (n.cz && n.cz.a && n.cz.a.s === 'triumph'); }));
  check(`${tag}: no page errors`, errors.length === 0, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all ok'); process.exit(failed ? 1 : 0);
