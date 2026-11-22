// The admin portal's Statistics › Research tab (game/edictum.html stResearch, functions/stats-research.js): a world of
// about eighty hand-made nations at every stage of the National Research Programme is counted here by the server's own
// code (functions/stats.js summarize) and handed to the page, which draws it: where nations stand, the journey, the
// petition's approach, the waiting, the laboratories, the research, credits, challenges, choices, war, the nations
// and the regions. One nation's research on its Nations-tab panel too. Desktop (light), wide (dark) and phone.
// Screenshots go to test/out/.
//   python3 build.py
//   node test/research-stats.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nationRow, summarize } from '../functions/stats.js';
import { researchBrief, DAY } from '../functions/stats-research.js';
import { rsEnc, rsPut, rsIdx } from '../functions/research-rules.js';

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

/* ── a world: eighty nations, the same every run ── */
const NOW = Date.now(), H = 3600000;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
const bits = tiers => { const b = new Uint8Array(45); tiers.forEach((t, k) => { for (let x = 1; x <= t; x++) for (let s = 0; s < 5; s++) rsPut(b, rsIdx(k, x, s)); }); if (tiers[0] < 24) rsPut(b, rsIdx(0, tiers[0] + 1, 1)); return rsEnc(b); };
const NAMES = ['Selenia', 'Vesad', 'Orlov', 'Kestrel', 'Marrow', 'Tessaly', 'Brindle', 'Calder', 'Ostrava', 'Pellam', 'Quill', 'Rennet', 'Sorrel', 'Tamsin', 'Umber', 'Valen', 'Wexford', 'Yarrow', 'Zephyr', 'Ashgrove'];
const world = [];
for (let j = 0; j < 80; j++) {
  const name = NAMES[j % NAMES.length] + (j >= NAMES.length ? ' ' + 'IVXL'[Math.floor(j / NAMES.length) - 1] : ''), reg = j % 5 === 4 ? 'frostmarch' : 'meridian';
  const r = { name, reg, pop: 2 + rnd() * 30, updatedAt: NOW - (j % 9 === 8 ? 45 * DAY : rnd() * 3 * DAY), founded: NOW - (30 + rnd() * 60) * DAY };
  const stage = j < 22 ? 'early' : j < 25 ? 'vetoed' : j < 29 ? 'due' : j < 31 ? 'site' : j < 37 ? 'building' : j < 74 ? 'open' : j < 76 ? 'lost' : j < 78 ? 'ruined' : 'rebuild';
  r.ws = { e: stage === 'early' ? Math.floor(rnd() * 75) : 75 + Math.floor(rnd() * 120) };
  if (stage === 'vetoed') r.nrx = { dv: r.ws.e = 77, dvt: NOW - DAY };
  if (stage === 'due' && j % 2) r.inbox = [{ id: 'rs-discovery', t: NOW - H }];
  if (!['early', 'vetoed', 'due'].includes(stage)) {
    const a = NOW - (2 + rnd() * 25) * DAY, o = j % 3, opened = ['open', 'lost', 'ruined', 'rebuild'].includes(stage);
    const t = stage === 'open' ? [Math.floor(1 + rnd() * 14), Math.floor(1 + rnd() * 10), Math.floor(rnd() * 8)] : opened ? [2, 1, 1] : [0, 0, 0];
    if (j === 40) t.splice(0, 3, 20, 18, 16);
    const p = { v: 1, a, o, st: stage === 'building' ? j % 5 : stage === 'site' ? 0 : stage === 'ruined' ? 1 : stage === 'rebuild' ? 3 : 5, l: stage === 'open' ? Math.min(8, Math.floor(rnd() * 4) + (j === 40 ? 5 : 0)) : 0,
      k: bits(t), re: 0, rs: 0, q: [] };
    if (stage !== 'site' && stage !== 'ruined') { p.c = 100 + j; p.ft = a + H; }
    if (opened) { p.i = a + (12 + rnd() * 60) * H; const n = t.reduce((s, x) => s + 5 * x, 0); p.rs = n * 12; p.re = p.rs + Math.round(rnd() * 300); }
    if (stage === 'lost') p.lo = NOW - (1 + j) * H;
    if (stage === 'ruined' || stage === 'rebuild') p.rz = NOW - DAY;
    if (stage === 'open' && j % 4 === 0) p.q = [[rsIdx(j % 3, 5, 1), NOW - H, NOW + H, 50, 0, 0]];
    if (stage === 'open' && j % 7 === 0) p.ch = { accel: { s: 2 } };
    if (j === 40) p.ch = { accel: { s: 6, d: NOW - DAY }, medctr: { s: 3 } };
    r.nrp = p;
    const h = [];
    if (opened) for (let d = 0; d < 30; d++) if (rnd() < (stage === 'open' ? 0.35 : 0.1)) h.push([NOW - d * DAY - rnd() * 6 * H, 'd', rsIdx(0, 1, 1), 0]);
    if (stage === 'ruined') h.unshift([NOW - DAY, 'rz', j === 76 ? 'Vesad' : '', '']);
    r.nrx = { h, lt: rnd() < 0.5 ? { 'rsl-doors': Math.floor(rnd() * 3) } : {} };
    if (stage === 'open' && rnd() < 0.4) r.policies = { [pick(['openScience', 'researchEthics', 'sciExchange'])]: 1 };
    if (stage === 'open' && rnd() < 0.5) r.answered = [{ id: pick(['rse-ai', 'rse-gm', 'rse-cash']), o: Math.floor(rnd() * 3), t: NOW - DAY }];
  }
  world.push(r);
}
const rows = world.map((r, j) => nationRow('n' + j, { j: JSON.stringify(r), reg: r.reg, name: r.name, pop: r.pop, updatedAt: r.updatedAt }, null, NOW));
const G0 = { at: NOW, rows, accts: [], limited: false, devices: [], posts: {}, finery: [], days: [] };
const D = summarize(G0), DF = summarize(G0, 'frostmarch');
const panelOf = id => { const x = rows.find(r => r.id === id); return { id, name: x.name, reg: x.reg, founded: x.founded, t: x.t, pop: x.pop, research: researchBrief(x.rs) }; };

async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Adminland');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  /* the owner's portal, with the figures the server would send for the world and one region */
  await page.evaluate(([d, df, panel]) => { const G = window.__game, A = window.EDICTUM_PROBE.rs.admst(); G.S.isOwner = true; A.d[''] = d; A.d.frostmarch = df; A.natD[panel.id] = panel; A.tab = 'research'; location.hash = '#admin-stats'; G.render(); },
    [D, DF, panelOf('n40')]);
  await until(() => page.evaluate(() => window.__game.S.view === 'admin-stats' && !!document.getElementById('adst-p-research')));
  return { ctx, page, errors };
}
const txt = (page, sel) => page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', sel);
const wide = async page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

{ /* desktop, light: every part of the tab */
  const { ctx, page, errors } = await start('light', { width: 1360, height: 900 });
  const t = await txt(page, '#adst-p-research');
  check('the Research tab sits between Content and Regions, chosen', await page.evaluate(() => [...document.querySelectorAll('.adst-tab')].map(b => b.dataset.v).join(',') === 'overview,activity,nations,players,content,research,regions,ops' && document.getElementById('adst-t-research').getAttribute('aria-selected') === 'true'));
  check('headline figures: past 75 edicts, petitions, laboratories at work, discoveries this week', /nations past 75 enacted edicts/.test(t) && /petitions granted/.test(t) && /laboratories at work/.test(t) && /discoveries this week/.test(t) && /technologies, the most by one nation/.test(t));
  check('the figures are the server’s: 58 past the 75th edict, 51 petitions granted', await page.evaluate(() => { const k = [...document.querySelectorAll('#adst-p-research .adm-kpi b')].map(b => b.textContent); return k[0] === '58' && k[1] === '51'; }), D.rs.steps.e75 + ' ' + D.rs.programmes);
  for (const s of ['Where nations stand', 'The journey', 'On the way to the petition', 'Waiting', 'The laboratories', 'The research', 'Research Credits', 'Grand Challenges', 'Laws, dilemmas and letters', 'Together and at war', 'Nations with a programme', 'By region'])
    check('a section: ' + s, t.includes(s));
  check('where nations stand names every phase', ['Not yet at 75 enacted edicts', 'Set the petition aside', 'Petition due', 'Petition granted', 'Building the laboratory', 'Laboratory at work', 'Laboratory held by an enemy', 'Laboratory destroyed or left behind', 'Rebuilding the laboratory'].every(p => t.includes(p)));
  check('the journey names the stages by the game’s own words', /Finished stage II: foundations and infrastructure/.test(t) && /Reached Tier V/.test(t) && /Researched all 360/.test(t));
  check('the laboratories: sites, stages and institutions', /The university quarter/.test(t) && /The coast/.test(t) && /The hills/.test(t) && /Stage III: research facilities/.test(t) && /Research Institute/.test(t));
  check('the most researched technologies by name, track and tier', /Most researched/.test(t) && /Trade, Tier I/.test(t));
  check('the discoveries chart covers 30 days', await page.evaluate(() => [...document.querySelectorAll('#adst-p-research .adst-fig h3')].some(h => h.textContent === 'Discoveries each day') && document.querySelectorAll('#adst-p-research .adst-cols')[0].querySelectorAll('.adst-c').length === 30));
  check('Grand Challenges under way and completed', /The Great Accelerator/.test(t));
  check('the nations, the furthest on first, with their tiers per track', await page.evaluate(() => { const s = [...document.querySelectorAll('.adst-sec')].find(x => /Nations with a programme/.test(x.querySelector('h2').textContent)), r = s && s.querySelector('tbody tr td button[data-act="st-nat"]'); return !!r && /Selenia V/.test(r.textContent); }) && /XX · XVIII · XVI/.test(t));
  await page.screenshot({ path: OUT + '/research-stats-1360.png', fullPage: true });
  await page.selectOption('#st-rsph', 'lost');
  check('choosing where they stand narrows the list to it', await until(async () => { const L = await page.evaluate(() => { const s = [...document.querySelectorAll('.adst-sec')].find(x => /Nations with a programme/.test(x.querySelector('h2').textContent)); return [...s.querySelectorAll('tbody tr')].map(r => r.innerText); }); return L.length === 2 && L.every(l => /held by an enemy/i.test(l) && /since/.test(l)); }));
  await page.selectOption('#st-rsph', '');
  /* a region: its own figures, no region table */
  await page.evaluate(() => { const A = window.EDICTUM_PROBE.rs.admst(); A.reg = 'frostmarch'; window.__game.render(); });
  check('a region shows its own figures and no region table', await until(async () => { const r = await txt(page, '#adst-p-research'); return !/By region/.test(r) && /Where nations stand/.test(r); }));
  await page.evaluate(() => { const A = window.EDICTUM_PROBE.rs.admst(); A.reg = ''; window.__game.render(); });
  /* a nation's panel in the Nations tab says where it stands in research */
  await page.evaluate(() => { const A = window.EDICTUM_PROBE.rs.admst(); A.nat = 'n40'; A.tab = 'nations'; window.__game.render(); });
  check('a nation’s panel says where it stands in research', await until(async () => /Research: Laboratory at work · \d+ of 360 technologies \(Trade XX, Growth XVIII, War XVI\)/.test(await txt(page, '#adst-nat'))), await txt(page, '#adst-nat .adst-rs'));
  check('no sideways scroll, no page errors (desktop)', (await wide(page)) <= 0 && !errors.length, errors);
  await ctx.close();
}
{ /* wide, dark */
  const { ctx, page, errors } = await start('dark', { width: 1600, height: 1000 });
  check('dark theme: the page background is dark', await page.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 200; }));
  await page.screenshot({ path: OUT + '/research-stats-1600-dark.png', fullPage: true });
  check('no sideways scroll, no page errors (wide, dark)', (await wide(page)) <= 0 && !errors.length, errors);
  await ctx.close();
}
{ /* phone */
  const { ctx, page, errors } = await start('light', { width: 390, height: 844 });
  check('on a phone the tab fits without sideways scroll', (await wide(page)) <= 0, await wide(page));
  await page.screenshot({ path: OUT + '/research-stats-phone.png', fullPage: true });
  check('no page errors (phone)', !errors.length, errors);
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
