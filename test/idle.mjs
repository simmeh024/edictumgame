// An idle test: what the Nation page costs the main thread while nobody touches it, and while it is scrolled or a
// pointer crosses it.
//   python3 build.py
//   node test/idle.mjs                     (IDLE_PROFILE=phone: 390 × 844 at three pixels a point, a quarter of the CPU)
// It serves public/ itself, so the game runs in its local mode (no emulators), founds a nation, opens the Nation
// page and reads Chrome's own figures: the main thread's busy time, and from a trace the frames the page itself
// asked Chrome to draw (ProxyMain::BeginMainFrame) and what each cost. It never counts frames with
// requestAnimationFrame: a frame loop of the test's own keeps Chrome drawing, and every frame then pays for whatever
// the page animates, which is how an idle page once measured 37% busy (73% on a phone).
// Real figures need the GPU: IDLE_CHANNEL=chrome runs the installed Chrome with it switched on; Playwright's own
// Chromium draws in software, which is slower but still shows what changes.
// Options (environment): IDLE_PROFILE (laptop), IDLE_SECONDS (8), IDLE_CHANNEL, IDLE_PUBLIC (another build to
// compare, public/ by default), PLAYWRIGHT_MODULE.
// Writes test/out/idle-<profile>.json and prints a table.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.resolve(process.env.IDLE_PUBLIC || path.join(ROOT, 'public'));
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
const PROFILE = process.env.IDLE_PROFILE || 'laptop', SEC = +(process.env.IDLE_SECONDS || 8);
const PROFILES = {
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, cpu: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, cpu: 4, isMobile: true, hasTouch: true },
};
const P = PROFILES[PROFILE];
if (!P) throw new Error('IDLE_PROFILE is laptop or phone');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });

/* public/ as Hosting would serve it, without the Firebase config, so the game starts in its local mode */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
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
const browser = await pw.chromium.launch(process.env.IDLE_CHANNEL
  ? { channel: process.env.IDLE_CHANNEL, headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] } : {});
const ctx = await browser.newContext({ viewport: P.viewport, deviceScaleFactor: P.deviceScaleFactor, isMobile: !!P.isMobile, hasTouch: !!P.hasTouch });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
await page.goto(BASE);
await page.fill('#d-name', 'Idlehaven');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
await page.evaluate(() => { location.hash = '#nation'; });
await page.waitForFunction(() => window.__game.S.view === 'nation' && document.querySelector('.hero'));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
if (P.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
await page.waitForTimeout(6000); // the founding's toasts and the first tick settle
await page.mouse.move(2, 2);

const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
/* one scenario: busy time from the page's own counters, frames and their cost from a trace taken alongside */
async function measure(name, act) {
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,toplevel,cc', transferMode: 'ReturnAsStream' });
  const m0 = await metric(), t0 = Date.now();
  let stop = false; const run = act ? act(() => stop) : null;
  await page.waitForTimeout(SEC * 1000); stop = true; if (run) await run;
  const m1 = await metric(), sec = (Date.now() - t0) / 1000;
  const done = new Promise(res => cdp.once('Tracing.tracingComplete', res));
  await cdp.send('Tracing.end');
  const { stream } = await done; let data = '';
  for (;;) { const c = await cdp.send('IO.read', { handle: stream }); data += c.data; if (c.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  const ev = JSON.parse(data).traceEvents || [];
  const bmf = ev.filter(e => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X'), main = bmf[0];
  const on = n => main ? ev.filter(e => e.name === n && e.ph === 'X' && e.pid === main.pid && e.tid === main.tid) : [];
  const r = {
    scenario: name, busyPct: +((m1.TaskDuration - m0.TaskDuration) / sec * 100).toFixed(1),
    framesPerS: +(bmf.length / sec).toFixed(1), msPerFrame: +(bmf.reduce((a, e) => a + e.dur, 0) / 1000 / Math.max(1, bmf.length)).toFixed(2),
    paintsPerS: +(on('Paint').length / sec).toFixed(1), styleMsPerS: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 / sec).toFixed(1),
  };
  console.log(`${name.padEnd(34)} busy ${String(r.busyPct).padStart(5)}%  frames ${String(r.framesPerS).padStart(5)}/s  ${String(r.msPerFrame).padStart(5)} ms a frame  paints ${String(r.paintsPerS).padStart(5)}/s  style ${String(r.styleMsPerS).padStart(5)} ms/s`);
  return r;
}
const top = () => page.evaluate(() => window.scrollTo(0, 0));
const results = [];
console.log(`Nation page, ${PROFILE} (${P.viewport.width} × ${P.viewport.height}, CPU ${P.cpu}×), ${SEC} s each, ${process.env.IDLE_CHANNEL || 'Playwright Chromium'}`);
await top(); await page.waitForTimeout(500);
results.push(await measure('still, top of the page'));
await page.evaluate(() => document.querySelector('.pp-sec')?.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500);
results.push(await measure('still, passport cover on screen'));
await top(); await page.waitForTimeout(500);
results.push(await measure('scrolling', stop => (async () => {
  let dir = 1;
  while (!stop()) {
    await page.mouse.wheel(0, 60 * dir);
    const [y, max] = await page.evaluate(() => [scrollY, document.documentElement.scrollHeight - innerHeight]);
    if (y >= max - 5) dir = -1; else if (y <= 0) dir = 1;
    await page.waitForTimeout(16);
  }
})()));
await top(); await page.waitForTimeout(500);
const hero = await page.locator('.hero').boundingBox();
results.push(await measure('pointer crossing the banner', stop => (async () => {
  for (let i = 0; !stop(); i++) {
    const t = i / 60; await page.mouse.move(hero.x + hero.width * (.5 + .4 * Math.sin(t)), hero.y + Math.min(hero.height, 300) * (.5 + .3 * Math.cos(t * 1.3)));
    await page.waitForTimeout(16);
  }
})()));
fs.writeFileSync(path.join(OUT, `idle-${PROFILE}.json`), JSON.stringify({ profile: PROFILE, browser: process.env.IDLE_CHANNEL || 'chromium', seconds: SEC, results, errors }, null, 1));
if (errors.length) console.log('page errors:', errors.join(' | '));
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
