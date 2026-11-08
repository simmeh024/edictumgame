// The Games page (the Meridian Games in the Meridian Reach, named after each region elsewhere): "Why this score" adds up to the score shown, last week's results wait behind a medal
// ceremony (and stay out of the medal table and records until it is watched), the bell says the results are in
// without giving them away, records and the medal cabinet are drawn, and medals unlock the cabinet's keepsakes.
//   python3 build.py
//   node test/games-plus.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the
// test probe.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
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
for (const [label, vp] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await (await browser.newContext(vp)).newPage();
  page.on('pageerror', e => errs.push(label + ': ' + e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Medalland'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation);
  const r = await page.evaluate(() => {
    const G = window.__game, M = G.GM(), n = G.S.nation, cur = M.edOf(Date.now()), id = M.myId();
    for (const k of Object.keys(n.s)) n.s[k] = Math.min(100, Math.max(n.s[k], 85)); n.s.corrupt = 5;
    const sc = M.baseScores(n, id, null);
    n.games = { en: [{ e: cur - 1, t: Date.now() - 8 * 86400e3, f: '', sc, es: 0 }], bids: [], ref: [], cl: [], hc: [], med: { g: 0, s: 0, b: 0 } };
    M.commit(M.clone(n));
    const N = G.S.nation, en = M.entryOf(N, cur), R = M.gamesResults(cur), host = R.host.id;
    const sums = R.evs.map(ev => { const W = M.gevWhy(N, id, cur, ev, en.f || null, host); const shown = Math.max(0, en.sc[ev] + (host === id ? 8 : 0) + M.formOf(id, cur, ev)); return Math.abs(W.total - shown); });
    const med = N.games.med, tot = med.g + med.s + med.b, unl = [...M.unlocksOf(N)];
    return { worst: Math.max(...sums), tot, gold: med.g, bronze: unl.includes('a-bronze'), sporting: unl.includes('t-sporting') === (tot >= 5), log: N.log.find(l => l.k === 'games' || l.k === 'gres'), last: cur - 1 };
  });
  ok(r.worst < 0.06, `${label}: every "Why this score" adds up to the score shown (largest gap ${r.worst.toFixed(3)})`);
  ok(r.tot > 0 && r.bronze, `${label}: a nation with medals (${r.tot}) has the Bronze accent unlocked`);
  ok(r.sporting, `${label}: "the Sporting" is unlocked exactly at 5 medals`);
  ok(!!r.log, `${label}: finished Games leave a notice in the nation's log`);
  const bellTxt = await page.evaluate(() => document.body.innerText);
  ok(!/your team won \d+ gold/i.test(bellTxt), `${label}: no toast or notice gives the medals away before the ceremony`);
  await page.evaluate(() => { const G = window.__game; G.S.view = 'games'; G.render(); });
  const before = await page.evaluate(() => ({ call: !!document.getElementById('g-cer-call'), pods: document.querySelectorAll('.pods').length,
    eds: (document.querySelector('#g-records .hint') || {}).textContent || '', cab: document.querySelectorAll('.gcab').length, why: document.querySelectorAll('.gev .gw').length }));
  ok(before.call && before.pods === 0, `${label}: last week's results wait behind "See the results"`);
  ok(/begin once/.test(before.eds), `${label}: the records leave out last week until the ceremony is watched`);
  ok(before.cab === 5 && before.why === 5, `${label}: the medal cabinet (5 keepsakes) and a breakdown per event are drawn`);
  await page.click('[data-act="g-cer"]');
  ok(await page.evaluate(() => !!document.querySelector('dialog#g-cer[open]') && document.querySelectorAll('#g-cer .gc-ev').length === 5), `${label}: the ceremony opens with five podiums`);
  ok(await page.evaluate(() => document.getElementById('g-cer').scrollTop === 0), `${label}: the ceremony opens at its top`);
  await page.click('[data-act="g-cer-close"]');
  const after = await page.evaluate(() => ({ dlg: !!document.getElementById('g-cer'), call: !!document.getElementById('g-cer-call'), pods: document.querySelectorAll('.pods').length,
    again: !!document.querySelector('.linkish[data-act="g-cer"]'), eds: (document.querySelector('#g-records .hint') || {}).textContent || '' }));
  ok(!after.dlg && !after.call && after.pods === 1 && after.again, `${label}: once watched, the podiums show on the page with "Watch the medal ceremony"`);
  ok(/From 1 finished/.test(after.eds), `${label}: the records then include last week`);
}
{ // every region holds its own Games, named after it
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => errs.push('frostmarch: ' + e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; try { localStorage.setItem('statehood.region', 'frostmarch'); } catch (e) {} });
  await page.goto(BASE); await page.fill('#d-name', 'Frostland'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation);
  await page.evaluate(() => { const G = window.__game; G.S.view = 'games'; G.render(); });
  const t = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, mer: /Meridian Games/.test(document.body.innerText) }));
  ok(t.h1 === 'The Frostmarch Games' && !t.mer, `in Frostmarch the page is "${t.h1}" and never says Meridian Games`);
}
ok(!errs.length, 'no errors in the page' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
