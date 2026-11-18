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

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
/* the Flag Studio: the flag designer on one screen */
await page.goto(BASE);
await page.fill('#d-name', 'Flagmark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { location.hash = '#customise'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
await page.evaluate(() => { const x = document.createElement('button'); x.dataset.fst = 'open'; document.body.appendChild(x); x.click(); x.remove(); });
check('the Flag Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('fg-st'); return e && !e.hidden && !!e.querySelector('.fs-flag svg'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('fg-st'); return { sh: e.scrollHeight, h: e.getBoundingClientRect().height, w: e.scrollWidth, vw: innerWidth }; });
check('everything fits in one view on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('layers, inspector, five tabs, the check and the in-use strip are there', await page.evaluate(() => document.querySelectorAll('#fg-st .cst-lay').length >= 4 && document.querySelectorAll('#fg-st .cst-tab').length === 8 && document.querySelectorAll('#fg-st .cst-proof li').length >= 3 && document.querySelectorAll('#fg-st .fs-use').length === 6 && document.querySelectorAll('#fg-st .fs-var').length === 4));
// the layer tools, as test/flag-layers-e2e.mjs drives them with the emulators
const fdraft = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.czFlag)));
const fval = async (k, v) => { const el = page.locator(`#fs-i-${k}`); await el.fill(String(v)); await el.press('Tab'); };
check('Customise has no flag designer of its own', await page.evaluate(() => !document.querySelector('#cz-sec-e #c-fgd') && !document.querySelector('[data-act="flag"][data-scope="c"]')));
await page.click('#fg-st [data-fst="add"][data-v="stripe"]'); await page.click('#fg-st [data-fst="add"][data-v="emblem"]');
check('a layer emblem picker without locked emblems', await page.locator('#fs-l-e').count() === 1 && await page.locator('#fs-l-e option[value="e-eye"]').count() === 0);
await fval('lx', 37.5); await fval('lr', 30);
check('precise values and rotation', (await fdraft()).layers[1].x === 37.5 && (await fdraft()).layers[1].r === 30);
check('Tab leaves a precise control', await page.evaluate(() => document.activeElement?.id !== 'fs-i-lr'));
await page.click('#fg-st [data-fst="undo"]'); check('a numeric gesture is one Undo step', (await fdraft()).layers[1].r === 0 && (await fdraft()).layers[1].x === 37.5);
let fb = await page.locator('#fg-st .fs-flag > svg').first().boundingBox(), fl = (await fdraft()).layers[1];
await page.mouse.move(fb.x + fb.width * fl.x / 100, fb.y + fb.height * fl.y / 100); await page.mouse.down(); await page.mouse.move(fb.x + fb.width * (fl.x + 20) / 100, fb.y + fb.height * (fl.y + 15) / 100, { steps: 6 }); await page.mouse.up();
check('dragging moves a layer', Math.abs((await fdraft()).layers[1].x - 57.5) <= .6 && (Math.abs((await fdraft()).layers[1].y - 65) <= .6 || Math.abs((await fdraft()).layers[1].y - 66.7) <= .6), JSON.stringify((await fdraft()).layers[1]));
await page.click('#fg-st [data-fst="undo"]'); check('the drag is one Undo step', (await fdraft()).layers[1].x === 37.5 && (await fdraft()).layers[1].y === 50);
await page.locator('#fs-cv').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowUp');
check('keyboard nudges keep the canvas focused', (await fdraft()).layers[1].x === 38.5 && (await fdraft()).layers[1].y === 45 && await page.evaluate(() => document.activeElement?.id === 'fs-cv'), JSON.stringify((await fdraft()).layers[1]) + await page.evaluate(() => document.activeElement?.id));
await page.click('#fs-alx'); await page.click('#fs-aly'); check('centring', (await fdraft()).layers[1].x === 50 && (await fdraft()).layers[1].y === 50);
check('a button keeps keyboard focus', await page.evaluate(() => document.activeElement?.id === 'fs-aly'));
await page.click('#fg-st [data-fst="up"][data-k="1"]'); check('stack order', (await fdraft()).layers[0].k === 'emblem');
await page.click('#fs-dup'); await page.click('#fg-st [data-fst="ldel"]'); await page.click('#fg-st [data-fst="undo"]'); check('duplicate and removal reversible', (await fdraft()).layers.length === 3);
await page.click('#fg-st [data-fst="undo"]'); await page.click('#fg-st [data-fst="undo"]'); check('undo restores the order', (await fdraft()).layers.length === 2 && (await fdraft()).layers[1].k === 'emblem');
await page.click('#fg-st [data-fst="add"][data-v="border"]'); await fval('lb', 5); await page.click('#fg-st [data-fst="add"][data-v="disc"]');
await page.locator('#fs-l-c').evaluate(el => { el.value = '#1c4d9e'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
check('layer colour and border line', (await fdraft()).layers[3].c === '#1C4D9E' && (await fdraft()).layers[2].c !== '#1C4D9E' && (await fdraft()).layers[2].b === 5);
while ((await fdraft()).layers.length < 24) await page.click('#fg-st [data-fst="add"][data-v="disc"]');
check('twenty-four layers at most', await page.locator('#fg-st [data-fst="add"][disabled]').count() === 6 && await page.locator('#fs-dup[disabled]').count() === 1);
await page.click('#fg-st [data-fst="discard"]'); check('discard returns to the flying flag', !(await fdraft()).layers);
await page.click('#fg-st [data-fst="tab"][data-v="charges"]'); await page.click('#fg-st [data-fst="set"][data-f="e"][data-v="star"]');
const hit = await page.$('#fg-st .cst-ov [data-fpart="emb"]'), bb = await hit.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 30, { steps: 8 }); await page.mouse.up();
check('dragging moves the emblem and the inspector follows', await until(() => page.evaluate(() => { const f = window.__game.S.czFlag; return typeof f.ex === 'number' && f.ex > 55 && +document.getElementById('fs-i-ex').value > 55; })));
await page.keyboard.press('Control+z');
check('undo puts it back', await until(() => page.evaluate(() => window.__game.S.czFlag.ex === undefined || window.__game.S.czFlag.ex < 55)));
await page.keyboard.press('Control+y');
await page.click('#fg-st [data-fst="tab"][data-v="style"]');
await page.click('#fg-st [data-fst="trad"][data-v="union"]');
check('a tradition sets stripes and a starred canton', await until(() => page.evaluate(() => { const f = window.__game.S.czFlag; return f.p === 'stripes' && !!f.cn && f.ck === 12; })));
await page.click('#fg-st [data-fst="set"][data-f="pr"][data-v="swt"]');
await page.click('#fg-st [data-fst="set"][data-f="bd"][data-v="frame"]');
await page.click('#fg-st [data-fst="set"][data-f="ca"][data-v="rows"]');
const art = await page.evaluate(() => { const s = document.querySelector('#fg-st .fs-flag svg'); return { clip: !!s.querySelector('clipPath'), pr: s.dataset.pr }; });
check('the swallowtail is cut from the flag', art.clip && art.pr === 'swt', JSON.stringify(art));
await page.click('#fg-st [data-fst="tab"][data-v="colour"]'); await page.click('#fg-st [data-fst="harm"][data-v="comp"]');
await page.click('#fg-st [data-fst="tab"][data-v="charges"]'); await page.click('#fg-st [data-fst="set"][data-f="e"][data-v="star"]'); await page.click('#fg-st [data-fst="set"][data-f="arr"][data-v="cons"]');
check('charges can stand in a constellation', await until(() => page.evaluate(() => window.__game.S.czFlag.ea === 'cons' && window.__game.S.czFlag.ek >= 2)));
for (const v of ['building', 'map', 'pin', 'ship', 'tiny', 'pole']) await page.selectOption('#fg-st [data-fst-sel="see"]', v);
check('the flag is back on its pole', await page.evaluate(() => !!document.querySelector('#fg-st .fs-pole')));
await page.click('#fg-st [data-fst="tab"][data-v="var"]');
check('the four variants are drawn', await page.evaluate(() => document.querySelectorAll('#fg-st .fs-vfig > svg').length === 4));
await page.screenshot({ path: path.join(OUT, 'flag-studio.png') });
await page.selectOption('#fg-st [data-fst-sel="ver"]', 'save');
check('a version is saved on the nation', await until(() => page.evaluate(() => (window.__game.S.nation.fgV || []).length === 1)));
await page.click('#fg-st [data-fst="save"]');
const saved = await until(() => page.evaluate(() => { const f = window.__game.S.nation.flag; return f.p === 'stripes' && f.pr === 'swt' && f.bd === 'frame' && f.ca === 'rows' && f.ea === 'cons' ? JSON.stringify(f) : false; }));
check('Save flies the flag with every Studio choice', !!saved, saved);
check('the flag draws the same everywhere', await page.evaluate(() => { const s = window.__game.FD.flagSVG(window.__game.S.nation.flag, ''); return /clip-path/.test(s) && /data-pr="swt"/.test(s); }));
// round two: the arms, stripes of its own, quarters, a turned emblem, words, two cantons, the cloth, the history
const F = sel => page.click('#fg-st ' + sel);
await F('[data-fst="tab"][data-v="stripes"]'); await F('[data-fst="set"][data-f="snon"][data-v="1"]');
await page.$eval('#fs-r-sn', e => { e.value = 5; e.dispatchEvent(new Event('input', { bubbles: true })); });
await F('[data-fst="set"][data-f="sv"][data-v="wave"]');
await page.locator('#fs-sc-2').evaluate(el => { el.value = '#7a2e2e'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.$eval('#fs-sw-0', e => { e.value = 3; e.dispatchEvent(new Event('input', { bubbles: true })); });
check('stripes of its own: five, wavy, one in its own colour, one wider', await until(() => page.evaluate(() => { const f = window.__game.S.czFlag; return f.sn === 5 && f.sv === 'wave' && f.scs && f.scs[2] === '#7A2E2E' && f.sw && f.sw[0] === 3; })));
await F('[data-fst="tab"][data-v="charges"]'); await F('[data-fst="set"][data-f="ar"][data-v="shield"]');
await page.$eval('#fs-r-er', e => { e.value = 20; e.dispatchEvent(new Event('input', { bubbles: true })); });
await F('[data-fst="set"][data-f="esh"][data-v="1"]');
check('the coat of arms stands on the flag, turned and shadowed', await until(() => page.evaluate(() => { const s = document.querySelector('#fg-st .fs-flag svg'); return /cz-arms|clip-path/.test(s.innerHTML) && /rotate\(20 /.test(s.innerHTML) && /feDropShadow/.test(s.innerHTML) && !!window.__game.S.czFlag.arm; })));
await F('[data-fst="tab"][data-v="words"]'); await page.fill('#fs-t-tx', 'Ever Onward'); await F('[data-fst="set"][data-f="tp"][data-v="band"]');
await F('[data-fst="tab"][data-v="style"]'); await F('[data-fst="set"][data-f="cnon"][data-v="1"]'); await F('[data-fst="set"][data-f="cp"][data-v="both"]'); await F('[data-fst="set"][data-f="fb"][data-v="seams"]');
check('words on a band, cantons at both corners and sewn seams are drawn', await until(() => page.evaluate(() => { const s = document.querySelector('#fg-st .fs-flag svg'); return /EVER ONWARD/.test(s.innerHTML) && /translate\(170 0\)/.test(s.innerHTML) && /stroke-dasharray="3 3"/.test(s.innerHTML); })));
await page.screenshot({ path: path.join(OUT, 'flag-studio-2.png') });
const h0 = await page.evaluate(() => (window.__game.S.nation.fgH || []).length);
await F('[data-fst="save"]');
check('Save flies it, and the flag it replaced goes into the history', await until(() => page.evaluate(h0 => { const n = window.__game.S.nation, f = n.flag; return f.sn === 5 && f.ar === 'shield' && f.er === 20 && f.tx === 'Ever Onward' && f.cp === 'both' && f.fb === 'seams' && (n.fgH || []).length === h0 + 1; }, h0)));
await F('[data-fst="tab"][data-v="hist"]');
check('the History tab shows the old flags, with a way back', await page.evaluate(() => document.querySelectorAll('#fg-st .fs-hfig').length >= 1 && !!document.querySelector('#fg-st [data-fst="hload"]')));
await F('[data-fst="tab"][data-v="stripes"]'); await F('[data-fst="set"][data-f="snon"][data-v="0"]'); await F('[data-fst="set"][data-f="q4on"][data-v="1"]');
check('four quarters of their own', await until(() => page.evaluate(() => Array.isArray(window.__game.S.czFlag.q4) && window.__game.S.czFlag.q4.length === 4)));
await F('[data-fst="discard"]');
await page.click('#fg-st [data-fst="surprise"]');
check('Surprise me makes a new flag', await until(() => page.evaluate(() => JSON.stringify(window.__game.S.czFlag) !== JSON.stringify(window.__game.S.nation.flag))));
await page.keyboard.press('Control+z');
await page.setViewportSize({ width: 390, height: 844 });
const wide = await page.evaluate(() => { const e = document.getElementById('fg-st'); return { ok: e.scrollWidth <= innerWidth + 1, sw: e.scrollWidth, who: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(x => x.tagName + '.' + (x.className.baseVal ?? x.className) + '#' + x.id + ':' + Math.round(x.getBoundingClientRect().right)) }; });
check('on a phone the Studio does not scroll sideways', wide.ok, JSON.stringify(wide));
await page.screenshot({ path: path.join(OUT, 'flag-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
// Separate into layers: the fused base becomes layers that look the same and move on their own
const px = (svg) => page.evaluate(async (s) => { const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"')); await img.decode(); const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return Array.from(g.getImageData(0, 0, 300, 200).data); }, svg);
const same = async (a, b) => { const A = await px(a), B = await px(b); let off = 0; for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) off++; return off / (A.length / 4); };
const flagNow = () => page.evaluate(() => window.__game.FLY().flagSVG(window.__game.S.czFlag, ''));
for (const [trad, want] of [['union', 'stripes and the canton'], ['nordic', 'cross'], ['arab', 'chevron'], ['sun', 'emblem']]) {
  await page.click(`#fg-st [data-fst="tab"][data-v="style"]`).catch(() => {});
  await page.evaluate(() => { window.__game.S.czFlag.layers = []; });
  await page.locator(`#fg-st [data-fst="trad"][data-v="${trad}"]`).first().click();
  const before = await flagNow();
  check(`${trad}: the Separate button shows`, await page.locator('#fs-split').count() === 1);
  await page.click('#fs-split');
  const d = await fdraft(), after = await flagNow(), diff = await same(before, after);
  check(`${trad}: ${want} become layers over a plain field that look the same`, d.p === 'plain' && d.layers.length >= 1 && !d.cn && d.e === 'none' && diff < 0.02, JSON.stringify({ p: d.p, n: d.layers.length, diff }));
  check(`${trad}: nothing left to separate`, await page.locator('#fs-split').count() === 0);
}
await page.click('#fg-st [data-fst="undo"]'); check('separating is one Undo step', (await fdraft()).e === 'disc');
await page.click('#fs-split');
const nl = (await fdraft()).layers.length;
await page.click(`#fg-st [data-fst="hide"][data-k="${nl - 1}"]`); check('a layer hides and stays in the list', (await fdraft()).layers[nl - 1].hd === 1 && !(await flagNow()).includes('data-fgl-layer="' + (nl - 1) + '"'));
await page.click(`#fg-st [data-fst="hide"][data-k="${nl - 1}"]`); check('and shows again', !(await fdraft()).layers[nl - 1].hd);
await page.click('#fg-st [data-fst="add"][data-v="stripe"]');
await page.click(`#fg-st [data-fst="pick"][data-k="l0"]`); await page.click('#fs-front'); check('To the front moves a layer to the top', (await fdraft()).layers[nl].k === 'emblem' && (await fdraft()).layers[0].k === 'stripe');
await page.click('#fs-fx'); check('Flip mirrors a layer', (await fdraft()).layers[nl].fx === 1);
{ const rb = await page.locator('#fg-st .fs-rot').boundingBox(), fb2 = await page.locator('#fg-st .fs-flag > svg').first().boundingBox(), L = (await fdraft()).layers[nl], cx = fb2.x + fb2.width * L.x / 100, cy = fb2.y + fb2.height * L.y / 100;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down(); await page.mouse.move(cx + 80, cy, { steps: 6 }); await page.mouse.up();
  check('the round handle turns a layer', Math.abs((await fdraft()).layers[nl].r - 90) <= 1, String((await fdraft()).layers[nl].r)); }
await page.click('#fs-back'); check('To the back', (await fdraft()).layers[0].fx === 1);
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('fg-st').hidden)));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
