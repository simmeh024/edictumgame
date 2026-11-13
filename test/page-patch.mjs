// A page drawn again in place ("drawing the same page again in place" in game/edictum.html): on every page the patched
// page must be exactly what a full draw would leave (the canvas marks scripts set aside), unchanged elements must stay
// the same elements, a form field changed by hand must still be put back as a full draw would, a map canvas kept
// across a redraw must not gain a second set of listeners, and another page must still be drawn whole.
//   python3 build.py
//   node test/page-patch.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
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
let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };

const PAGES = ['nation', 'issues', 'map', 'cities', 'customise', 'dispatch', 'messages', 'assembly', 'space', 'shop', 'region', 'community',
  'government', 'diplomacy', 'trade', 'stats', 'museum', 'passport', 'achievements', 'exchange', 'world', 'help', 'settings', 'chronicle',
  'explore', 'devnews', 'games', 'provinces', 'bugs'];

async function run(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  try {
    await page.goto(BASE);
    await page.fill('#d-name', 'Patchland');
    await page.click('#found-btn');
    await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
    await page.waitForTimeout(2500);
    /* an established nation, every page in the menu; every patch is compared with the full draw it stands for */
    await page.evaluate(() => {
      const G = window.__game, n = G.clone(G.S.nation); delete n.onb; G.commit(n);
      /* what the patch leaves as scripts set it: a map canvas's size, hover and drag marks, the page column's style,
         the tile ids czDom adds */
      const norm = h => h.replace(/<canvas\b[^>]*>/g, t => t.replace(/\s(width|height|data-hover|data-done)="[^"]*"/g, '')
        .replace(/class="([^"]*)"/, (m, c) => 'class="' + c.replace(/(^|\s)(dragging|fl-hot|nws-hot)(?=\s|$)/g, ' ').replace(/ +/g, ' ').trim() + '"'))
        .replace(/<main\b[^>]*>/g, t => t.replace(/\sstyle="[^"]*"/, '')).replace(/\sdata-czid="[^"]*"/g, '')
        /* and what scripts put in and keep: a card's sheen (lit or not: once the pointer has moved, idApply sets the
           light on its <i>), a map's effects overlay */
        .replace(/<span class="id-sh"[^>]*>(?:<i\b[^>]*><\/i>)*<\/span>/g, '').replace(/<canvas class="map-fx"[^>]*><\/canvas>/g, '');
      window.__bad = [];
      G.RPATCH.check = (want, got) => { const a = norm(want), b = norm(got); if (a !== b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; window.__bad.push({ view: G.S.view, want: a.slice(Math.max(0, i - 100), i + 100), got: b.slice(Math.max(0, i - 100), i + 100) }); } };
    });
    const res = [];
    for (const v of PAGES) {
      res.push(await page.evaluate(async v => {
        const G = window.__game, S = G.S, app = document.getElementById('app'), n0 = G.RPATCH.n, wait = ms => new Promise(r => setTimeout(r, ms));
        /* render leaves alone a page whose first node is the one it drew: a comment in front makes it draw again */
        const again = () => { app.prepend(document.createComment('again')); G.render(); };
        S.view = v; G.render(); await wait(300);
        again(); await wait(1100); again();
        for (const t of [...document.querySelectorAll('#main [role="tab"], #main .tabs button, #main [data-act$="-tab"]')].slice(0, 6)) {
          if (!t.isConnected) continue; try { t.click(); } catch (e) {} await wait(100); if (S.view !== v) break;
        }
        return { v, patches: G.RPATCH.n - n0 };
      }, v));
    }
    const bad = await page.evaluate(() => window.__bad);
    check(`${width}px: every page drawn again in place ends as a full draw would leave it`, bad.length === 0,
      bad.slice(0, 3).map(x => `${x.view}\n   want …${x.want}…\n    got …${x.got}…`).join('\n'));
    const none = res.filter(r => r.patches < 2).map(r => r.v);
    check(`${width}px: each page was drawn again in place`, none.length === 0, none.join(', '));

    /* the parts that did not change stay the same elements */
    const kept = await page.evaluate(async () => {
      const G = window.__game, S = G.S, app = document.getElementById('app');
      S.view = 'nation'; G.render(); await new Promise(r => setTimeout(r, 300));
      const side = document.querySelector('aside.side'), wrap = document.querySelector('#main .wrap');
      app.prepend(document.createComment('again')); G.render();
      return { side: side && side === document.querySelector('aside.side'), wrap: wrap && wrap === document.querySelector('#main .wrap') };
    });
    check(`${width}px: the menu and the page column stay the same elements`, kept.side && kept.wrap, JSON.stringify(kept));

    /* a field changed by hand (not through the game) is put back, as a full draw would */
    const field = await page.evaluate(async () => {
      const G = window.__game, S = G.S, app = document.getElementById('app');
      S.view = 'settings'; G.render(); await new Promise(r => setTimeout(r, 300));
      const f = [...document.querySelectorAll('#main input[type="text"], #main input:not([type]), #main textarea')].find(x => x.id);
      if (!f) return { none: true };
      const id = f.id, was = f.defaultValue; f.value = was + ' changed by hand';
      app.prepend(document.createComment('again')); G.render();
      const g = document.getElementById(id);
      return { id, back: !!g && g.value === was };
    });
    check(`${width}px: a field changed by hand is put back by a redraw`, !field.none && field.back, JSON.stringify(field));

    /* the map's canvas is kept across a redraw of its page, and a drag still moves the view once, not twice */
    const map = await page.evaluate(async () => {
      const G = window.__game, S = G.S, app = document.getElementById('app'), wait = ms => new Promise(r => setTimeout(r, ms));
      S.view = 'map'; G.render(); await wait(800);
      const cvOf = () => document.querySelector('canvas.map-cv[data-map="main"]'), cv = cvOf();
      app.prepend(document.createComment('again')); G.render(); await wait(200);
      app.prepend(document.createComment('again')); G.render(); await wait(200);
      const same = cvOf() === cv, v = G.MD.viewOf('main', cv), s = G.MD.mapScale(cv, v), x0 = v.cx, r = cv.getBoundingClientRect();
      const ev = (t, dx) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 61, pointerType: 'mouse', isPrimary: true, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2, bubbles: true }));
      ev('pointerdown', 0); for (let i = 1; i <= 10; i++) ev('pointermove', i * 4); ev('pointerup', 40);
      return { same, moved: Math.round((x0 - G.MD.viewOf('main', cv).cx) * s) };
    });
    check(`${width}px: the map canvas is kept when its page is drawn again`, map.same, JSON.stringify(map));
    check(`${width}px: and a 40 px drag moves the map 40 px (its listeners were not bound twice)`, Math.abs(map.moved - 40) <= 2, JSON.stringify(map));

    /* typing into a number field while the page is drawn again (in play, the region's saves redraw it every few seconds)
       keeps the caret after what was typed: 100 typed into the Bureau's market stays 100, it used to become 001 */
    const toTrade = () => page.evaluate(async () => { const G = window.__game; G.S.view = 'trade'; G.render(); await new Promise(r => setTimeout(r, 300)); return !!document.getElementById('gb-q'); });
    for (let i = 0; i < 4 && !(await toTrade()); i++) {
      await page.evaluate(async () => { const G = window.__game; G.S.view = 'map'; G.render(); await new Promise(r => setTimeout(r, 800)); });
      await page.click('[data-act="map-suggest"]', { timeout: 3000 }).catch(() => {}); await page.click('[data-act="settle"]', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700);
    }
    /* stores enough to hand over 100 food */
    await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); n.stock = Object.assign({}, n.stock, { food: 300 }); n.stockAt = Date.now(); n._stockSet = true; G.commit(n); });
    for (const whole of [false, true]) {
      await page.evaluate(async whole => { const G = window.__game; G.RPATCH.off = whole; G.S.view = 'trade'; G.render(); await new Promise(r => setTimeout(r, 300)); }, whole);
      if (!(await page.$('#gb-q'))) { check(`${width}px: the Bureau's market is on the Trade page to type into`, false, await page.evaluate(() => JSON.stringify({ loc: window.__game.S.nation.loc, cities: (window.__game.S.nation.cities || []).length }))); break; }
      await page.click('#gb-q');
      for (const k of '100') { await page.keyboard.type(k); await page.evaluate(() => { document.getElementById('app').prepend(document.createComment('again')); window.__game.render(); }); }
      const t = await page.evaluate(() => { const q = document.getElementById('gb-q'), b = document.querySelector('[data-act="gb-trade"]'); return { value: q && q.value, focused: document.activeElement === q, exchange: b && !b.disabled, hint: (document.getElementById('gb-mkt-q') || {}).textContent }; });
      check(`${width}px: a number typed while the page is drawn again ${whole ? 'whole' : 'in place'} reads as typed, and Exchange opens`, t.value === '100' && t.focused && t.exchange, JSON.stringify(t));
      await page.evaluate(() => { const q = document.getElementById('gb-q'); if (q) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); } window.__game.RPATCH.off = false; });
    }

    /* another page is drawn whole */
    const other = await page.evaluate(async () => {
      const G = window.__game, S = G.S, side = document.querySelector('aside.side'), n0 = G.RPATCH.n;
      S.view = 'help'; G.render(); await new Promise(r => setTimeout(r, 200));
      return { patched: G.RPATCH.n - n0, fresh: side !== document.querySelector('aside.side') };
    });
    check(`${width}px: going to another page draws it whole`, other.patched === 0 && other.fresh, JSON.stringify(other));

    check(`${width}px: no errors in the page`, errors.length === 0, errors.join(' | '));
  } catch (e) {
    console.log('FAIL the run stopped: ' + (e && e.stack || e)); failed++;
    try { await page.screenshot({ path: path.join(OUT, `page-patch-fail-${width}.png`) }); } catch (x) {}
  }
  await ctx.close();
}

await run(1280);
await run(390);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
