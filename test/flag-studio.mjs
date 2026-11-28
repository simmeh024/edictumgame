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
check('twenty-four layers at most', await page.locator('#fg-st [data-fst="add"][disabled]').count() === 13 && await page.locator('#fs-dup[disabled]').count() === 1);
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
await page.click('#fg-st .fs-bar [data-fst="tab"][data-v="hist"]'); await page.click('#fs-vsave');
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
{ const ph = await page.evaluate(() => { const q = s => document.querySelector('#fg-st ' + s), pr = q('.cst-proof'), sv = q('.fs-save'), fl = q('.fs-flag'), mo = q('.fs-more'), sw = q('.cst-stsw').getBoundingClientRect(), un = q('[data-fst="undo"]').getBoundingClientRect();
    return { proof: pr ? getComputedStyle(pr).position : 'none', save: getComputedStyle(sv).position, saveBottom: Math.round(innerHeight - sv.getBoundingClientRect().bottom), flagTop: Math.round(fl.getBoundingClientRect().top), more: getComputedStyle(mo).display, apart: sw.right <= un.left + 1 || sw.left >= un.right - 1 || sw.bottom <= un.top + 1 || sw.top >= un.bottom - 1 }; });
  check('on a phone the flag comes first, the check sits below it, and Undo and Save wait at the foot', ph.proof === 'static' && ph.save === 'fixed' && ph.saveBottom <= 1 && ph.flagTop < 200 && ph.more === 'none' && ph.apart, JSON.stringify(ph)); }
await page.click('#fg-st [data-fst="more"]');
check('More opens the rest of the tools', await page.evaluate(() => getComputedStyle(document.querySelector('#fg-st .fs-more')).display !== 'none' && !!document.querySelector('#fg-st .fs-more [data-fst="surprise"]')));
await page.click('#fg-st [data-fst="more"]');
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
// ── round four (2026-11-27): the bugs, and ideas 4-7, 9-14, 18-20 of the owner's list ──
const setDraft = f => page.evaluate(f => { const g = window.__game; g.S.czFlag = JSON.parse(JSON.stringify(f)); g.FLY().FS.multi.clear(); g.FLY().FS.sel = 'emb'; g.FLY().fsPaint(); }, f);
const FSs = () => page.evaluate(() => { const F = window.__game.FLY().FS; return { sel: F.sel, multi: [...F.multi], zoom: F.zoom, drop: F.drop, keys: F.keys, guide: F.guide, pickC: F.pickC, cmpN: F.cmpN && F.cmpN.nm, clip: F.clip ? F.clip.length : 0 }; });
const chips = () => page.evaluate(() => [...document.querySelectorAll('#fg-st .cst-proof li')].map(l => l.textContent).join(' | '));
const flagBox = () => page.locator('#fg-st .fs-flag > svg').first().boundingBox();
const setColour = (sel, v) => page.locator(sel).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
{ const ov = await page.evaluate(() => { const a = document.querySelector('#fg-st .cst-stsw').getBoundingClientRect(), b = document.querySelector('#fg-st [data-fst="undo"]').getBoundingClientRect(); return { w: Math.round(a.width), apart: a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1 }; });
  check('the Other Studios switcher no longer lies over Undo', ov.w > 60 && ov.apart, JSON.stringify(ov)); }
check('the layers count says it counts the extra layers', /\d+ \/ 24 extra/.test(await page.textContent('#fg-st #fs-left .cst-ph')));
// 4: the patterns in named groups
await setDraft({ p: 'tri-v', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'none', ec: '#F2C230' });
await F('[data-fst="tab"][data-v="style"]');
{ const pg = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#fg-st .fs-pg')].map(x => x.textContent), named: document.querySelectorAll('#fg-st .fs-ptiles .fs-tn').length }));
  check('the patterns stand in five named groups, each tile with its name', pg.groups.length === 5 && pg.named >= 40, JSON.stringify(pg)); }
// the five patterns of 27 November: Bendy, Dancetty fess and Orle for everyone; Hoist sun and Bordure compony earned
check('Bendy, Dancetty fess and Orle are there for everyone', await page.locator('#c-p-bendy').count() === 1 && await page.locator('#c-p-dancetty').count() === 1 && await page.locator('#c-p-orle').count() === 1);
{ const lk = await page.evaluate(() => ['fp-hsun', 'fp-compony'].map(u => document.querySelector(`#fg-st [data-ux-unlock="${u}"]`)?.getAttribute('aria-label') || ''));
  check('Hoist sun and Bordure compony are locked, naming the achievements that earn them', /Seasoned Judge/.test(lk[0]) && /Agenda Setter/.test(lk[1]), JSON.stringify(lk)); }
await F('#c-p-bendy'); check('Bendy draws diagonal bands', (await fdraft()).p === 'bendy' && /stroke-width="52"/.test(await flagNow()));
for (const [p, n, k] of [['bendy', 4, 'stripe'], ['orle', 1, 'border']]) {
  await setDraft({ p, c: ['#152450', '#FFFFFF', '#C8102E'], e: 'none', ec: '#F2C230' }); const before = await flagNow(); await page.click('#fs-split');
  const d = await fdraft(), diff = await same(before, await flagNow());
  check(`${p}: Separate into layers keeps its look`, d.p === 'plain' && (d.layers || []).length === n && d.layers.every(l => l.k === k) && diff < 0.02, JSON.stringify({ n: (d.layers || []).length, k: (d.layers || []).map(l => l.k), diff })); }
await page.evaluate(() => { const g = window.__game, n = JSON.parse(JSON.stringify(g.S.nation)); n.ach = Object.assign({}, n.ach, { 'fc-judge50': Date.now(), 'dip-cbt10': Date.now() }); g.commit(n); g.FLY().fsPaint(); });
await F('[data-fst="tab"][data-v="style"]');
check('Seasoned Judge and Agenda Setter open them', await until(async () => await page.locator('#c-p-hsun').count() === 1 && await page.locator('#c-p-compony').count() === 1));
await F('#c-p-compony'); check('the Bordure compony can be chosen and is drawn', (await fdraft()).p === 'compony' && /M0,0h20v20h-20Z|M20,0h20v20h-20Z/.test(await flagNow()));
await setDraft({ p: 'tri-v', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'none', ec: '#F2C230' }); await F('[data-fst="tab"][data-v="style"]');
// 7: the canton's shape, and an inspector of its own
await F('[data-fst="set"][data-f="cnon"][data-v="1"]'); await F('#fs-right [data-fst="set"][data-f="cs"][data-v="sq"]');
check('the canton can be square', (await fdraft()).cs === 'sq' && /<rect width="100" height="100" fill=/.test(await flagNow()));
await F('[data-fst="pick"][data-k="cn"]');
check('the canton has an inspector: its colour, shape and corner', await page.locator('#fs-i-cn').count() === 1 && await page.locator('#fg-st #fs-left [data-f="cs"][data-v="h"]').count() === 1);
await F('#fs-left [data-f="cs"][data-v="h"]');
check('a full-height canton runs the height of the hoist', (await fdraft()).cs === 'h' && /<rect width="100" height="200" fill=/.test(await flagNow()));
await F('#fs-left [data-f="cp"][data-v="fly"]');
check('at the fly it moves to the far edge', /translate\(200 0\)/.test(await flagNow()));
await F('[data-fst="set"][data-f="cnon"][data-v="0"]'); check('taking the canton off drops its shape', !(await fdraft()).cs && !(await fdraft()).cn);
// 9: the emblem's box holds what it draws
await setDraft({ p: 'tri-v', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'star', ec: '#F2C230', ea: 'row', ek: 5 });
await F('[data-fst="pick"][data-k="emb"]');
{ const ew = await page.evaluate(() => +document.querySelector('#fg-st .cst-ov [data-fpart="emb"]').getAttribute('width'));
  check('the emblem box holds a whole row of charges', ew > 200, String(ew)); }
// 5: fixes on the check
await setDraft({ p: 'tri-v', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'star', ec: '#C8102E', tx: 'Hello', layers: [{ k: 'disc', x: 20, y: 20, w: 10, h: 10, r: 0, c: '#1B7F3B' }, { k: 'disc', x: 80, y: 80, w: 10, h: 10, r: 0, c: '#1D8240' }, { k: 'disc', x: 50, y: 80, w: 10, h: 10, r: 0, c: '#E86A10' }] });
{ const ch = await chips();
  check('the check offers fixes', /6 colours/.test(ch) && await page.locator('#fg-st [data-fst="fix"][data-v="merge"]').count() === 1 && await page.locator('#fg-st [data-fst="fix"][data-v="emb"]').count() === 1 && await page.locator('#fg-st [data-fst="fix"][data-v="words"]').count() === 1, ch); }
await F('[data-fst="fix"][data-v="merge"]');
check('Merge the two closest makes the two greens one', await until(async () => /5 colours/.test(await chips()) && (await fdraft()).layers[0].c === (await fdraft()).layers[1].c), await chips());
await F('[data-fst="fix"][data-v="emb"]');
check('A colour that shows changes the emblem colour', await until(async () => !/barely shows/.test(await chips()) && (await fdraft()).ec !== '#C8102E'), await chips());
await F('[data-fst="fix"][data-v="words"]');
check('Remove them takes the words off', !(await fdraft()).tx);
await F('[data-fst="undo"]'); check('a fix is one Undo step', (await fdraft()).tx === 'Hello');
// 6: one colour everywhere, and a colour picked off the flag
await setDraft({ p: 'tri-v', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'none', ec: '#F2C230', layers: [{ k: 'disc', x: 20, y: 20, w: 10, h: 10, r: 0, c: '#C8102E' }] });
await F('[data-fst="tab"][data-v="colour"]');
check('the Colour tab lists every colour with where it is used', await page.locator('#fg-st .fs-ev').count() === 3 && /field, layers/.test(await page.textContent('#fg-st .fs-every')));
await setColour('#fs-ev-C8102E', '#7a2e2e');
check('a colour changes everywhere it is used', (await fdraft()).c[0] === '#7A2E2E' && (await fdraft()).layers[0].c === '#7A2E2E', JSON.stringify(await fdraft()));
await F('#fs-drop');
{ const b = await flagBox(); await page.mouse.click(b.x + b.width * .85, b.y + b.height * .5); }
check('Pick a colour reads the colour off the flag', await until(async () => (await FSs()).pickC === '#152450' && await page.evaluate(() => document.activeElement?.id === 'fs-ev-152450')), JSON.stringify(await FSs()));
// 10: several layers: Shift-click, line up, space, group, drag and nudge together, ungroup
await setDraft({ p: 'plain', c: ['#152450', '#FFFFFF', '#C8102E'], e: 'none', ec: '#F2C230', layers: [[20, 30], [30, 40], [80, 50]].map(([x, y]) => ({ k: 'disc', x, y, w: 10, h: 10, r: 0, c: '#F2C230' })) });
await F('[data-fst="pick"][data-k="l0"]'); await page.click('#fg-st [data-fst="pick"][data-k="l1"]', { modifiers: ['Shift'] }); await page.click('#fg-st [data-fst="pick"][data-k="l2"]', { modifiers: ['Shift'] });
check('Shift-click picks several layers', (await FSs()).multi.length === 3 && /3 layers/.test(await page.textContent('#fg-st #fs-left .fs-mh')), JSON.stringify(await FSs()));
await F('#fs-mal-t'); check('Tops lines them up', (await fdraft()).layers.every(l => l.y === 30), JSON.stringify((await fdraft()).layers));
await F('#fs-dist-x'); check('Space evenly across', JSON.stringify((await fdraft()).layers.map(l => l.x)) === '[20,50,80]', JSON.stringify((await fdraft()).layers.map(l => l.x)));
await F('#fs-grp'); check('Group gives them one group', new Set((await fdraft()).layers.map(l => l.g)).size === 1 && (await fdraft()).layers[0].g >= 1);
await F('[data-fst="pick"][data-k="l2"]'); check('picking one of a group picks the group', (await FSs()).multi.length === 3);
{ const b = await flagBox(), L0 = (await fdraft()).layers;
  await page.mouse.move(b.x + b.width * L0[0].x / 100, b.y + b.height * L0[0].y / 100); await page.mouse.down(); await page.mouse.move(b.x + b.width * (L0[0].x + 10) / 100, b.y + b.height * (L0[0].y + 20) / 100, { steps: 6 }); await page.mouse.up();
  const L1 = (await fdraft()).layers, dx = L1[0].x - L0[0].x, dy = L1[0].y - L0[0].y;
  check('dragging one of a group moves them all alike', dx > 5 && dy > 5 && L1.every((l, i) => Math.abs(l.x - L0[i].x - dx) < .2 && Math.abs(l.y - L0[i].y - dy) < .2), JSON.stringify(L1.map(l => [l.x, l.y])));
  await page.locator('#fs-cv').focus(); await page.keyboard.press('ArrowLeft');
  check('arrow keys move the group', (await fdraft()).layers.every((l, i) => Math.abs(l.x - (L1[i].x - 1)) < .01), JSON.stringify((await fdraft()).layers.map(l => l.x))); }
await F('#fs-ungrp'); check('Ungroup', (await fdraft()).layers.every(l => !l.g));
// 11: copy and paste, style, Delete, Ctrl+A, the shortcuts
await F('[data-fst="pick"][data-k="l0"]'); await page.locator('#fs-cv').focus();
await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
check('Ctrl+C and Ctrl+V paste a copy beside it', (await fdraft()).layers.length === 4 && Math.abs((await fdraft()).layers[3].x - (await fdraft()).layers[0].x - 3) < .01 && (await FSs()).sel === 'l3', JSON.stringify(await FSs()));
await setColour('#fs-l-c', '#1c4d9e'); await F('#fs-cstyle'); await F('[data-fst="pick"][data-k="l1"]'); await F('#fs-pstyle');
check('Copy style and Paste style carry a colour across', (await fdraft()).layers[1].c === '#1C4D9E');
await page.locator('#fs-cv').focus(); await page.keyboard.press('Delete'); check('Delete removes the picked layer', (await fdraft()).layers.length === 3);
await page.locator('#fs-cv').focus(); await page.keyboard.press('Control+a'); check('Ctrl+A picks every layer', (await FSs()).multi.length === 3);
await page.locator('#fs-cv').focus(); await page.keyboard.press('?'); check('? shows the shortcuts', await page.locator('#fg-st .fs-keys kbd').count() >= 10);
await page.keyboard.press('Escape'); check('Escape closes the shortcuts first, not the Studio', await page.locator('#fg-st .fs-keys').count() === 0 && await page.evaluate(() => !document.getElementById('fg-st').hidden));
// 12: zoom
{ const w0 = (await page.locator('#fg-st .fs-flagrow').boundingBox()).width; await F('#fs-zin'); const w1 = (await page.locator('#fg-st .fs-flagrow').boundingBox()).width;
  check('Zoom in makes the flag bigger and the canvas scrolls', w1 > w0 * 1.4 && await page.locator('#fs-cv.fs-zoomed').count() === 1, `${w0} → ${w1}`); }
await page.locator('#fs-cv').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
check('Ctrl and the wheel zoom too', await until(async () => (await FSs()).zoom > 1.5), JSON.stringify(await FSs()));
await page.locator('#fs-cv').focus(); await page.keyboard.press('0');
check('0 goes back to 100%', (await FSs()).zoom === 1 && await page.locator('#fs-cv.fs-zoomed').count() === 0);
// 13: the new shapes
await setDraft({ p: 'plain', c: ['#152450', '#FFFFFF', '#C8102E'], e: 'none', ec: '#F2C230' });
for (const k of ['cross', 'saltire', 'ring', 'chevron', 'crescent', 'star', 'rays']) await F(`[data-fst="add"][data-v="${k}"]`);
check('seven new shapes join the layers and are drawn', JSON.stringify((await fdraft()).layers.map(l => l.k)) === JSON.stringify(['cross', 'saltire', 'ring', 'chevron', 'crescent', 'star', 'rays']) && (await flagNow()).split('data-fgl-layer=').length === 8);
await fval('ln', 24); check('rays take a count', (await fdraft()).layers[6].n === 24);
await F('[data-fst="pick"][data-k="l5"]'); await fval('ln', 7);
{ const pts = await page.evaluate(() => { const g = document.querySelector('#fg-st .fs-flag > svg [data-fgl-layer="5"] polygon'); return g ? g.getAttribute('points').trim().split(/\s+/).length : 0; });
  check('a star takes its number of points', (await fdraft()).layers[5].n === 7 && pts === 14, String(pts)); }
await F('[data-fst="pick"][data-k="l0"]'); await fval('lb', 44); check('a cross takes its line', (await fdraft()).layers[0].b === 44 && /stroke-width="44"/.test(await flagNow()));
// 14: a flag like a neighbour's is named, and can be compared
{ const nb = await page.evaluate(() => { const T = window.__game.WR2().territory(), x = (T.list || []).find(x => x && x.n && !x.me && x.n.flag && x.n !== window.__game.S.nation); return x ? { nm: x.n.name, f: x.n.flag } : null; });
  if (!nb) check('a neighbour to compare with', false, 'no other nation in the region');
  else { await setDraft(nb.f);
    check('a flag like a neighbour’s is flagged, by name', await until(async () => (await chips()).includes('Looks a lot like the flag of ' + nb.nm), 10000), await chips());
    await F('[data-fst="fix"][data-v="alike"]');
    check('Compare shows their flag beside yours', await until(async () => (await page.textContent('#fg-st .fs-cmp figcaption').catch(() => '')).includes(nb.nm))); } }
// 19: versions as pictures
await F('[data-fst="tab"][data-v="hist"]');
check('Versions shows the saved designs as flags', await page.locator('#fg-st .fs-vf svg').count() >= 1 && await page.locator('#fg-st [data-fst="vcmp"]').count() >= 1);
await F('[data-fst="vcmp"][data-v="0"]'); check('a version compares beside the flag', await page.locator('#fg-st .fs-cmp').count() === 1 && (await FSs()).cmpN === null);
await F('[data-fst="vcmp"][data-v="0"]');
// 20: a first flag in five steps
await page.evaluate(() => { const g = window.__game; g.S.czFlag = JSON.parse(JSON.stringify(g.S.nation.flag)); g.FLY().fsPaint(); });
await F('.fs-bar [data-fst="guide"]');
check('Guide me opens step 1 of 5', /Step 1 of 5/.test(await page.textContent('#fg-st .fs-guide')) && await page.locator('#fg-st .cst-tab').count() === 0);
await F('.fs-guide [data-fst="trad"][data-v="nordic"]'); check('step 1 sets a tradition', (await fdraft()).p === 'cross');
await F('#fs-gnext'); await F('.fs-guide [data-fst="gpal"][data-v="1"]'); check('step 2 sets the colours', (await fdraft()).c[0] === '#0F6E67');
await F('#fs-gnext'); await F('.fs-guide [data-fst="set"][data-f="e"][data-v="sun"]'); check('step 3 picks an emblem', (await fdraft()).e === 'sun');
await F('#fs-gnext'); check('step 4 shows the check', await page.locator('#fg-st .fs-gchk li').count() >= 3);
await F('#fs-gnext');
{ const h1 = await page.evaluate(() => (window.__game.S.nation.fgH || []).length); await F('.fs-guide [data-fst="save"]');
  check('step 5 flies it and the guide closes', await until(() => page.evaluate(h => (window.__game.S.nation.fgH || []).length === Math.min(12, h + 1) && window.__game.S.nation.flag.e === 'sun' && window.__game.S.nation.flag.p === 'cross', h1)) && await page.locator('#fg-st .cst-tab').count() === 8); }
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('fg-st').hidden)));
// 18: Happenings shows a new flag beside the one it replaced (the page drawn directly: this new nation's tutorial holds the menu)
check('Happenings shows a new flag beside the old one', await until(async () => { if (await page.evaluate(() => window.__game.S.view !== 'region')) { await page.evaluate(() => { const g = window.__game; g.S.view = 'region'; g.render(); }); return false; } if (!(await page.$('.haps'))) await page.click('#rgn-tab-happenings', { timeout: 1500 }).catch(() => {}); return page.evaluate(() => document.querySelectorAll('.hap-fl .mflag svg').length >= 2); }, 12000), await page.evaluate(() => JSON.stringify({ view: window.__game.S.view, hash: location.hash, tabs: !!document.querySelector('.rgn-tabs'), haps: (document.querySelector('.haps') || {}).textContent?.slice(0, 300) || null, main: (document.querySelector('#main') || document.body).innerText.slice(0, 200) })));
// five shields (27 November): Horse-head, Octagon and Forked for everyone; Pelta and Engrailed earned with silver achievements
{ const r = await page.evaluate(() => { const F = window.__game.FLY(), n = window.__game.S.nation, all = ['horse', 'octagon', 'forked', 'pelta', 'engrailed'];
    return { names: all.map(s => F.CZ_SHIELDS[s]), free: ['horse', 'octagon', 'forked'].map(s => F.czShOk(n, s)), locked: ['pelta', 'engrailed'].map(s => F.czShOk(n, s)), how: ['pelta', 'engrailed'].map(s => F.czShHow(s)),
      fallback: F.czCleanArms({ s: 'pelta', t: ['azure', 'or'] }, []).s, drawn: all.map(s => (F.czArmsSVG({ s, d: 'pale', t: ['gules', 'argent'], c: '', ct: 'or' }).match(/d="(M[^"]+)"/) || [])[1] || '') }; });
  check('Horse-head, Octagon and Forked shields are there for everyone, each with its own outline', r.names.every(Boolean) && r.free.every(Boolean) && new Set(r.drawn).size === 5 && r.drawn.every(Boolean), JSON.stringify(r));
  check('Pelta and Engrailed are locked, naming Shield Wall and Town Hall Heraldry', r.locked.every(x => !x) && /Shield Wall/.test(r.how[0]) && /Town Hall Heraldry/.test(r.how[1]), JSON.stringify(r));
  check('arms showing a locked shield the nation does not hold fall back to the Heater', r.fallback === 'heater', r.fallback); }
const armsStudio = () => page.evaluate(() => { const x = document.createElement('button'); x.dataset.ars = 'open'; document.body.appendChild(x); x.click(); x.remove(); });
const asTiles = () => page.evaluate(() => Object.fromEntries(['horse', 'octagon', 'forked', 'pelta', 'engrailed'].map(s => { const b = document.querySelector('#as-s-' + s); return [s, b ? (b.classList.contains('lk') ? 'locked: ' + b.getAttribute('aria-label') : 'open') : 'missing']; })));
await armsStudio();
check('the Arms Studio offers the new shields, the earned two shown locked', await until(async () => { const T = await asTiles(); return T.horse === 'open' && T.octagon === 'open' && T.forked === 'open' && /Shield Wall/.test(T.pelta) && /Town Hall Heraldry/.test(T.engrailed); }), JSON.stringify(await asTiles()));
await page.keyboard.press('Escape');
await page.evaluate(() => { const g = window.__game, n = JSON.parse(JSON.stringify(g.S.nation)); n.ach = Object.assign({}, n.ach, { 'dip-shield': Date.now(), 'odd-crest5': Date.now() }); g.commit(n); });
check('Shield Wall and Town Hall Heraldry open them', await until(() => page.evaluate(() => { const F = window.__game.FLY(), n = window.__game.S.nation; return F.czShOk(n, 'pelta') && F.czShOk(n, 'engrailed'); })));
await armsStudio();
check('and the Arms Studio shows them open', await until(async () => { const T = await asTiles(); return T.pelta === 'open' && T.engrailed === 'open'; }), JSON.stringify(await asTiles()));
await page.click('#as-s-pelta');
check('the Pelta can be chosen', await until(() => page.evaluate(() => document.querySelector('#as-s-pelta')?.getAttribute('aria-pressed') === 'true')));
await page.click('#as-save');
check('saved, the arms carry the Pelta and the record vouches for it (others see it, not the Heater)', await until(() => page.evaluate(() => { const F = window.__game.FLY(), n = window.__game.S.nation, c = n.cz || {}; return c.a && c.a.s === 'pelta' && (c.u || []).includes('sh-pelta') && F.czCleanArms(c.a, c.u).s === 'pelta'; })), await page.evaluate(() => JSON.stringify({ s: window.__game.S.nation.cz?.a?.s, u: (window.__game.S.nation.cz?.u || []).filter(x => /^sh-/.test(x)) })));
await page.keyboard.press('Escape');
// a new flag colour while Customise holds a currency draft (23 Nov 2026): what the player left as it was follows the
// nation (the banknote's colours are the flag's until chosen), what they changed stays theirs
{ const r = await page.evaluate(() => {
    const g = window.__game, U = g.CU, out = {};
    const recolour = () => { const n = JSON.parse(JSON.stringify(g.S.nation)); n.flag.c[0] = n.flag.c[0] === '#1D4E89' ? '#8E2A2A' : '#1D4E89'; g.commit(n); return n.flag.c[0]; };
    U.setDraft(U.cuDraft(g.S.nation));                                   // Customise drew the currency
    const was = U.draft().note.c1, c = recolour();
    out.a = { was, now: U.draft().note.c1, flag: c, nationNote: U.cuDraft(g.S.nation).note.c1, dirty: U.dirty() };
    U.setDraft(U.cuDraft(g.S.nation)); U.draft().mo = 'Our own words';   // a change of the player's own
    const c2 = recolour();
    out.b = { mo: U.draft().mo, note: U.draft().note.c1, flagNote: U.cuDraft(g.S.nation).note.c1, flag: c2, dirty: U.dirty() };
    U.setDraft(U.cuDraft(g.S.nation)); U.draft().note.c1 = '#ABCDEF';    // a note colour chosen in the draft
    recolour();
    out.c = { note: U.draft().note.c1 };
    U.setDraft(null);
    return out; });
  check('a new flag colour moves an untouched currency draft with it: nothing unsaved, the notes follow the flag', r.a.now === r.a.nationNote && r.a.now !== r.a.was && !r.a.dirty, JSON.stringify(r.a));
  check('a draft with the player’s own change keeps it, and the rest still follows the flag', r.b.mo === 'Our own words' && r.b.note === r.b.flagNote && r.b.dirty, JSON.stringify(r.b));
  check('a note colour chosen in the draft stays chosen', r.c.note === '#ABCDEF', JSON.stringify(r.c)); }
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
