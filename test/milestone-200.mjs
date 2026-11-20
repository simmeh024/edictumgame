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

// The 200-nation gift: once Edictum has 200 nations, each of the first two hundred sees a pop-up with two boxes. The
// first gives 200 of every material, the second the Platinum regalia (Ducenti pattern, Moonstone map colour, Twin
// arches shield, Platinum tincture, Milestone charge and flag emblem, Platinum frame, Platinum seal, the epithet "of
// the Two Hundred"); the first box opened earns the platinum achievement I Was Here at 200. The counts are set by hand
// here (no Firestore in this test): M200.tot all nations, M200.after those founded after this one.
//   python3 build.py && node test/milestone-200.mjs
const RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const MC = '#8EA4BC';
for (const [theme, viewport, tag] of [['light', { width: 1280, height: 860 }, 'desk'], ['dark', { width: 390, height: 844 }, 'phone']]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; window.EDICTUM_M200 = 1; try { localStorage.setItem('statehood.mlkopen.v1', '1'); } catch (e) {} });
  await page.goto(BASE);
  await page.fill('#d-name', 'Ducentia'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0));
  /* founded after the 50-player cut, so only this gift is due (the 100-nation gift is never counted here) */
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.onb; n.founded = Date.UTC(2026, 10, 18, 9, 30); n.stock = { food: 10, timber: 10, iron: 10, oil: 10, goods: 10 }; n.stockAt = Date.now(); G.commit(n); G.render(); });
  const set = (tot, after) => page.evaluate(([tot, after]) => { const P = window.__game.M200P(), n = window.__game.S.nation; Object.assign(P.M200, { tot, after, f: Math.floor(n.founded), later: false }); }, [tot, after]);
  const shown = () => page.evaluate(() => !!document.getElementById('m200'));
  const held = () => page.evaluate(() => { const P = window.__game.M200P(), n = window.__game.S.nation, u = P.unlocksOf(n);
    return { sh: P.czShOk(n, 'twin'), mc: P.ctgMcOk(n, P.M200_MC), u: P.M200_U.filter(id => u.has(id)) }; });

  await sleep(2600);
  check(`${tag}: no pop-up before any count`, !(await shown()));
  await set(199, null); await sleep(2600);
  check(`${tag}: no pop-up at 199 nations`, !(await shown()));
  await set(230, 20); await sleep(2600);
  check(`${tag}: no pop-up for the 210th nation of 230`, !(await shown()));
  const locked = await held();
  check(`${tag}: regalia locked before`, !locked.sh && !locked.mc && locked.u.length === 0, locked);

  await set(200, 0);
  check(`${tag}: pop-up shows for the 200th nation`, await until(shown, 6000));
  const ui = await page.evaluate(() => ({ boxes: document.querySelectorAll('#m200 .m100-gift .m50-box').length, h: document.getElementById('m200-h').textContent,
    focus: document.activeElement && document.activeElement.id, ok: document.getElementById('m200-ok').hidden, say: document.getElementById('m200-say').textContent,
    items: document.querySelectorAll('#m200-g2 .m200-reg li').length, ach: (document.getElementById('m200-ach') || {}).textContent || '',
    over: (() => { const d = document.querySelector('#m200 .m50').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 0.5; })() }));
  check(`${tag}: two boxes, a heading and the first box focused`, ui.boxes === 2 && /200 nations milestone reached/.test(ui.h) && ui.focus === 'm200-box1', ui);
  check(`${tag}: eight pieces of regalia waiting in the second box`, ui.items === 8, ui);
  check(`${tag}: the platinum achievement is named`, /I Was Here at 200/.test(ui.ach) && /first box/.test(ui.ach), ui);
  check(`${tag}: Collect waits until both are open`, ui.ok === true && /Click a box/.test(ui.say), ui);
  check(`${tag}: the dialog fits the screen`, ui.over, ui);
  await sleep(300); await page.screenshot({ path: path.join(OUT, `m200-${tag}-closed.png`) });

  /* the first box: supplies, and the achievement */
  await page.click('#m200-box1'); await sleep(900);
  const a = await page.evaluate(() => { const n = window.__game.S.nation, P = window.__game.M200P(); return { m: n.m200, st: n.stock, xs: P.xsMax(n), sh: P.czShOk(n, 'twin'), ach: !!(n.ach && n.ach['odd-here200']), tier: P.ACH_BY_ID['odd-here200'].t,
    say: document.getElementById('m200-say').textContent, achRow: document.getElementById('m200-ach').classList.contains('got'), ok: document.getElementById('m200-ok').hidden, focus: document.activeElement && document.activeElement.id }; });
  check(`${tag}: box 1 sets bit 1`, a.m === 1, a);
  check(`${tag}: box 1 gives +200 of each material`, RES.every(r => Math.floor(a.st[r]) >= 210), a.st);
  check(`${tag}: the stock may stay over the limit by 200`, a.xs >= 200, a.xs);
  check(`${tag}: the first box earns the platinum I Was Here at 200`, a.ach && a.tier === 'p' && a.achRow, a);
  check(`${tag}: box 1 alone leaves the regalia locked`, !a.sh && /One more box/.test(a.say) && a.ok === true, a);
  check(`${tag}: focus moves to the second box`, a.focus === 'm200-box2', a);
  /* closing with a box still shut brings it back, with the first one shown open */
  await page.click('#m200-later'); await sleep(300);
  check(`${tag}: Later closes it`, !(await shown()));
  await page.evaluate(() => { window.__game.M200P().M200.later = false; });
  check(`${tag}: it comes back with the second box still to open`, await until(shown, 6000));
  const back = await page.evaluate(() => ({ g1: document.getElementById('m200-g1').classList.contains('open'), g2: document.getElementById('m200-g2').classList.contains('open') }));
  check(`${tag}: box 1 shown open, box 2 shut`, back.g1 && !back.g2, back);
  /* the second: the regalia (income keeps adding meanwhile, so the stock is compared just before and after) */
  const before = await page.evaluate(() => window.__game.S.nation.stock);
  await page.click('#m200-box2'); await sleep(900);
  await page.screenshot({ path: path.join(OUT, `m200-${tag}-open.png`) });
  if (tag === 'desk') await page.locator('#m200 .m50').screenshot({ path: path.join(OUT, 'm200-dialog.png') }).catch(() => {});
  const b = await page.evaluate(() => { const n = window.__game.S.nation; return { m: n.m200, st: n.stock,
    ok: document.getElementById('m200-ok').hidden, later: document.getElementById('m200-later').hidden, go: document.getElementById('m200-go').hidden, say: document.getElementById('m200-say').textContent, focus: document.activeElement && document.activeElement.id }; });
  const h = await held();
  check(`${tag}: box 2 sets bit 2`, b.m === 3, b);
  check(`${tag}: box 2 adds no materials`, RES.every(r => b.st[r] - before[r] < 50), { before, after: b.st });
  check(`${tag}: shield, map colour and all seven unlocks held`, h.sh && h.mc && h.u.length === 7, h);
  check(`${tag}: Collect and the Customise link show, Later goes`, !b.ok && !b.go && b.later && /Both gifts/.test(b.say) && b.focus === 'm200-ok', b);
  const c0 = await page.evaluate(() => window.__game.S.nation.stock);
  await page.evaluate(() => { const P = window.__game.M200P(); P.m200Open(1); P.m200Open(2); });
  const c = await page.evaluate(() => window.__game.S.nation.stock);
  check(`${tag}: opening again gives nothing more`, RES.every(r => c[r] - c0[r] < 50), { c0, c });
  await page.click('#m200-ok'); await sleep(300);
  check(`${tag}: Collect closes it`, !(await shown()));
  await sleep(2600);
  check(`${tag}: not again`, !(await shown()));
  check(`${tag}: m200 kept when the record is normalised`, await page.evaluate(() => window.__game.S.nation.m200 === 3));

  /* where the regalia are worn: the arms (shield, tincture, charge) */
  await page.evaluate(() => { location.hash = '#customise'; }); await sleep(900);
  await page.evaluate(() => { const b = document.querySelector('[data-act="cz-sec"][data-v="a"]'); if (b) b.click(); }); await sleep(700);
  const arms = await page.evaluate(() => { const s = document.getElementById('cz-a-s-twin'), t = document.getElementById('cz-a-t0-plat'), c = document.getElementById('cz-a-c-c-milestone');
    return { s: s ? !s.classList.contains('locked') : null, t: t ? !t.classList.contains('locked') : null, c: c ? !c.classList.contains('locked') : null }; });
  check(`${tag}: Twin arches, Platinum and the Milestone usable in Customise › Coat of arms`, arms.s && arms.t && arms.c, arms);
  if (arms.s) { await page.click('#cz-a-s-twin'); await sleep(400); }
  if (arms.t) { await page.click('#cz-a-t0-plat'); await sleep(400); }
  if (arms.c) { await page.click('#cz-a-c-c-milestone'); await sleep(400); }
  const worn = await page.evaluate(() => { const a = window.__game.S.nation.cz && window.__game.S.nation.cz.a; return a ? { s: a.s, t: a.t, c: a.c } : null; });
  check(`${tag}: the shield, tincture and charge can be chosen`, !!worn && worn.s === 'twin' && worn.t[0] === 'plat' && worn.c === 'c-milestone', worn);
  if (tag === 'desk') await page.locator('.cz-arms-big').first().screenshot({ path: path.join(OUT, 'm200-arms.png') }).catch(() => {});

  /* the banner: pattern, frame, title; the stamp */
  await page.evaluate(() => { const b = document.querySelector('[data-act="cz-sec"][data-v="b"]'); if (b) b.click(); }); await sleep(700);
  const ban = await page.evaluate(() => { const p = document.getElementById('cz-p-p-ducenti'), f = document.getElementById('cz-f-f-platinum'), t = document.getElementById('cz-t-t-ducenti');
    return { p: p ? !p.classList.contains('locked') && !!p.querySelector('svg.czp circle') : null, f: f ? !f.classList.contains('locked') : null, t: t ? !t.classList.contains('locked') : null }; });
  check(`${tag}: Ducenti pattern usable in Customise › Banner`, !!ban.p, ban);
  if (ban.p) { await page.click('#cz-p-p-ducenti'); await sleep(400); }
  if (ban.f) { await page.click('#cz-f-f-platinum'); await sleep(400); }
  const pick = (sec, id) => page.evaluate(([sec, id]) => { const b = document.querySelector(`[data-act="cz-sec"][data-v="${sec}"]`); if (b) b.click(); return new Promise(r => setTimeout(() => { const e = document.getElementById(id); if (e && !e.classList.contains('locked')) { e.click(); r(true); } else r(false); }, 600)); }, [sec, id]);
  ban.t = await pick('t', 'cz-t-t-ducenti');
  ban.st = await pick('s', 'cz-st-s-platinum'); await sleep(400);
  const cz = await page.evaluate(() => { const c = window.__game.S.nation.cz || {}; return { p: c.p, f: c.f, t: c.t, st: c.st, u: c.u || [] }; });
  check(`${tag}: the pattern can be chosen and is vouched for in cz.u`, cz.p === 'p-ducenti' && cz.u.includes('p-ducenti'), cz);
  check(`${tag}: the frame, the epithet and the seal can be chosen`, ban.f && ban.t && ban.st && cz.f === 'f-platinum' && cz.t === 't-ducenti' && cz.st === 's-platinum', { ban, cz });
  if (tag === 'desk') await page.locator('#cz-p-p-ducenti').screenshot({ path: path.join(OUT, 'm200-pattern.png') }).catch(() => {});
  const art = await page.evaluate(() => { const P = window.__game.M200P(), n = window.__game.S.nation;
    return { st: /CC/.test(P.czStampArt('s-platinum', n)) && /ONE OF THE TWO HUNDRED/.test(P.czStampArt('s-platinum', n)), fr: P.czFrameArt('f-platinum', 228, 'x')[0].length > 200, ch: P.czCharge('milestone', '#ccc', '#111').length > 200 }; });
  check(`${tag}: the seal, frame and charge are drawn`, art.st && art.fr && art.ch, art);

  /* the map colour */
  await page.evaluate(() => { location.hash = '#customise/map'; }); await sleep(900);
  const sw = await page.evaluate(mc => !!document.querySelector(`#cz-sec-g [data-act="mlk-mc"][data-val="${mc}"]`), MC);
  check(`${tag}: Moonstone offered in Customise › Map`, sw);
  if (sw) { await page.click(`#cz-sec-g [data-act="mlk-mc"][data-val="${MC}"]`); await sleep(800); }
  const mc = await page.evaluate(() => { const G = window.__game, n = G.S.nation, P = G.M200P(); return { mapc: n.mapc, col: P.nationColor(n), other: P.nationColor({ ...n, m200: 1 }), prev: (document.querySelector('.mapc-prev .hint') || {}).textContent }; });
  check(`${tag}: saved and worn on the map`, mc.mapc === MC && mc.col === MC && /moonstone/.test(mc.prev || ''), mc);
  check(`${tag}: a nation without the regalia box cannot wear it`, mc.other !== MC, mc);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(1500);
  if (tag === 'desk') await page.screenshot({ path: path.join(OUT, 'm200-map.png') });

  /* another nation, founded later: the 201st of 201 never sees it */
  await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); delete n.m200; n.founded = Date.UTC(2026, 11, 30); G.commit(n); G.render(); });
  await set(201, 0); await sleep(2600);
  check(`${tag}: the 201st nation gets no pop-up`, !(await shown()));
  check(`${tag}: and loses the unlocks with the record`, await page.evaluate(() => { const P = window.__game.M200P(), n = window.__game.S.nation, u = P.unlocksOf(n); return P.M200_U.every(id => !u.has(id)) && !P.ctgMcOk(n, P.M200_MC); }));
  check(`${tag}: no page errors`, errors.length === 0, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all ok'); process.exit(failed ? 1 : 0);
