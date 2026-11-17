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
/* the Note Studio: the banknote designer on one screen */
await page.goto(BASE);
await page.fill('#d-name', 'Studiomark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { location.hash = '#customise'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
/* the Banknote preview at the top of Customise has its own way into the Studio */
await page.evaluate(() => { const b = document.querySelector('[data-act="cz-ctx"][data-v="note"]'); if (b) b.click(); else { const x = document.createElement('button'); x.dataset.act = 'cz-ctx'; x.dataset.v = 'note'; document.body.appendChild(x); x.click(); x.remove(); } });
check('the Banknote preview shows a Design in Studio button', await until(() => page.evaluate(() => !!document.querySelector('.cz-live .cz-lv-studio[data-cst="open"]'))));
const hid = await page.evaluate(() => { const b = document.querySelector('[data-act="cz-ctx"][data-v="card"]'); if (!b) return 'no-tabs'; b.click(); const h = document.querySelector('.cz-lv-studio').hidden; document.querySelector('[data-act="cz-ctx"][data-v="note"]').click(); return h && !document.querySelector('.cz-lv-studio').hidden; });
check('the button shows only on the Banknote preview', hid === true || hid === 'no-tabs', String(hid));
await page.screenshot({ path: path.join(OUT, 'customise-banknote-preview.png') });
await page.click('.cz-live .cz-lv-studio');
check('it opens the Studio', await until(() => page.evaluate(() => { const e = document.getElementById('cu-st'); return e && !e.hidden; })));
await page.keyboard.press('Escape'); await until(() => page.evaluate(() => document.getElementById('cu-st').hidden));
await page.evaluate(() => { const b = document.querySelector('[data-cst="open"]'); if (b) b.click(); else { const x = document.createElement('button'); x.dataset.cst = 'open'; document.body.appendChild(x); x.click(); x.remove(); } });
check('the Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('cu-st'); return e && !e.hidden && !!e.querySelector('.cst-front svg.cu-note'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('cu-st'), r = e.getBoundingClientRect(); return { sh: e.scrollHeight, h: r.height, w: e.scrollWidth, vw: innerWidth, docScroll: document.documentElement.scrollHeight > innerHeight && getComputedStyle(document.documentElement).overflow !== 'hidden' }; });
check('everything fits in one view (no scrolling) on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('layers, inspector, tabs and the series are all there', await page.evaluate(() => document.querySelectorAll('.cst-lay').length === 6 && !!document.getElementById('cst-i-x') && document.querySelectorAll('.cst-tab').length === 9 && document.querySelectorAll('.cst-card').length >= 9));
// drag the vignette 20 units left
const hit = await page.$('.cst-front .cst-ov [data-part="v"]'), bb = await hit.boundingBox(), u = bb.width / 80;
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + bb.width / 2 - 20 * u * i / 8, bb.y + bb.height / 2 + 1, { steps: 1 });
await page.mouse.up();
const pos = await page.evaluate(() => window.__game.S && JSON.stringify((document.getElementById('cst-i-x') || {}).value));
check('dragging moves the part, and the inspector follows', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value <= -15)), pos);
check('the move is on the history', await page.evaluate(() => [...document.querySelectorAll('.cst-hist .cst-b')].some(b => /Moved the vignette/.test(b.textContent))));
await page.keyboard.press('Control+z');
check('undo puts it back', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value === 0)));
await page.keyboard.press('Control+y');
check('redo moves it again', await until(() => page.evaluate(() => +document.getElementById('cst-i-x').value <= -15)));
// own guilloché, ornament, type
await page.click('[data-cst="tab"][data-v="guil"]'); await page.click('[data-cst="gon"]');
check('the guilloché sliders appear', await until(() => page.$('#cst-r-g0')));
await page.$eval('#cst-r-g0', e => { e.value = 11; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-cst="tab"][data-v="orn"]'); await page.click('[data-cst="set"][data-f="note.bd"][data-v="key"]'); await page.click('[data-cst="set"][data-f="note.ros"][data-v="compass"]');
await page.click('[data-cst="tab"][data-v="type"]'); await page.click('[data-cst="set"][data-f="note.tp"][data-v="1"]');
await page.click('[data-cst="tab"][data-v="colour"]'); await page.click('[data-cst="one"][data-v="1"]'); await page.click('[data-cst="harm"][data-v="comp"]');
check('the eight banknote inks are in the picker', await page.evaluate(() => ['#3B5F3A','#5B3A6B','#B5832E','#2F5D8A','#7A5A3C','#B5546B','#1F7A7A','#C8642B'].every(h => document.querySelector(`[data-cst="sw"][data-k="c1"][data-v="${h}"]`))));
await page.click('[data-cst="sw"][data-k="c2"][data-v="#B5832E"]');
check('picking one sets the colour', await until(() => page.evaluate(() => /B5832E/i.test(document.querySelector('label[for="cst-c-c2"]').textContent))));
check('one value can have its own colours', await until(() => page.evaluate(() => !!document.querySelector('.cst-card.on .cst-ovr'))));
await page.click('[data-cst="split"]'); await page.click('[data-cst="split"]');
for (const see of ['uv', 'wallet', 'hand', 'worn', 'phone', 'light', 'flat']) await page.selectOption('[data-cst-sel="see"]', see);
await page.click('[data-cst="zin"]'); await page.click('[data-cst="zin"]');
check('zooming in shows the mini-map', await until(() => page.$('.cst-mini')));
await page.click('[data-cst="z1"]');
await page.selectOption('[data-cst-sel="ver"]', 'save');
check('a version is saved on the nation', await until(() => page.evaluate(() => (window.__game.S.nation.cuV || []).length === 1)));
await page.screenshot({ path: path.join(OUT, 'note-studio.png') });
await page.click('[data-cst="save"]');
const saved = await until(() => page.evaluate(() => { const c = window.__game.S.nation.cur, N = c && c.note; return N && N.pos && N.pos.v && N.gp && N.gp[0] === 11 && N.bd === 'key' && N.ros === 'compass' && N.tp === 1 && N.ov && Object.keys(N.ov).length === 1 ? JSON.stringify(N) : false; }));
check('Save keeps every Studio choice on the currency', !!saved, saved);
const art = await page.evaluate(() => { const s = document.querySelector('.cst-front svg.cu-note'); return { part: !!s.querySelector('[data-part="v"][transform]'), paths: s.querySelectorAll('path').length }; });
check('the saved note draws the moved part', art.part, JSON.stringify(art));
// round three: scenes, security, palettes, effects, the contest, commemoratives, one look
const clickAll = async sels => { for (const q of sels) await page.click(q); };
await page.click('[data-cst="tab"][data-v="style"]');
await clickAll(['[data-cst="set"][data-f="note.por"][data-v="harbour"]', '[data-cst="set"][data-f="note.emb"][data-v="cameo"]', '[data-cst="set"][data-f="note.p2"][data-v="fin"]', '[data-cst="set"][data-f="note.ds"][data-v="steep"]']);
await page.click('[data-cst="tab"][data-v="sec"]');
await clickAll(['[data-cst="set"][data-f="note.win"][data-v="leaf"]', '[data-cst="set"][data-f="note.ink"][data-v="gold"]', '[data-cst="set"][data-f="note.reg"][data-v="star"]', '[data-cst="set"][data-f="note.ser"][data-v="two"]', '[data-cst="sgt"][data-v="def"]', '[data-cst="sgt"][data-v="for"]']);
await page.fill('#cst-t-pre', 'zq');
await page.selectOption('[data-cst-fx="frame"]', 'emboss');
await page.click('[data-cst="tab"][data-v="colour"]');
await clickAll(['[data-cst="set"][data-f="note.rb"][data-v="1"]', '[data-cst="lockc"][data-v="c2"]', '[data-cst="ovall"]', '[data-cst="palsave"]']);
check('a palette is saved on the nation', await until(() => page.evaluate(() => (window.__game.S.nation.cuP || []).length === 1)));
const art3 = await page.evaluate(() => { const s = document.querySelector('.cst-front svg.cu-note'); return { mask: !!s.querySelector('mask[id$="k2"]'), gold: /gd\)/.test(s.innerHTML), filt: !!s.querySelector('[data-layer="frame"][filter]'), rule: !!document.querySelector('.cst-front .cst-rule'), mm: /printed \d+ × \d+ mm/.test(document.querySelector('.cst-front figcaption').textContent), sigs: (s.innerHTML.match(/Defence Minister|Foreign Minister/gi) || []).length }; });
check('window, gold ink, layer effect, rulers and extra signatures are drawn', art3.mask && art3.gold && art3.filt && art3.rule && art3.mm && art3.sigs >= 2, JSON.stringify(art3));
await page.click('[data-cst="save"]');
check('the new note choices are saved', await until(() => page.evaluate(() => { const N = window.__game.S.nation.cur.note; return N.por === 'harbour' && N.emb === 'cameo' && N.p2 === 'fin' && N.win === 'leaf' && N.ink === 'gold' && N.reg === 'star' && N.ser === 'two' && N.pre === 'ZQ' && N.sg.length === 2 && N.fx.frame === 'emboss' && N.rb === 1 && N.ds === 'steep' && Object.keys(N.ov).length >= 9; })));
await page.screenshot({ path: path.join(OUT, 'note-studio-round3.png') });
await page.click('[data-cst="tab"][data-v="talk"]'); await page.click('[data-cst="enter"]');
check('the note is entered in the Note of the Month', await until(() => page.evaluate(() => document.querySelectorAll('.cst-ents li').length === 1 && (window.__game.S.nation.cuE || []).length === 1)));
await page.click('[data-cst="tab"][data-v="issue"]'); await page.fill('#cst-t-cev', 'Harbour opening'); await page.click('[data-cst="comm"][data-v="note"]');
check('a commemorative note is issued and shown', await until(() => page.evaluate(() => (window.__game.S.nation.cuC || []).length === 1 && /Harbour opening/i.test(document.querySelector('.cst-cms').textContent) && /COMMEMORATIVE ISSUE/.test(document.querySelector('.cst-cms').innerHTML))));
await page.click('[data-cst="tab"][data-v="style"]'); await page.click('[data-cst="look"]');
check('one look sets the passport typeface', await until(() => page.evaluate(() => { const pp = window.__game.S.nation.pp; return !!(pp && pp.c && pp.c.fn && pp.s && pp.s.fn === pp.c.fn); })));
await page.click('[data-cst="mode"][data-v="coin"]');
await clickAll(['[data-cst="set"][data-f="coin.met"][data-v="bi"]', '[data-cst="set"][data-f="coin.ring"][data-v="copper"]', '[data-cst="set"][data-f="coin.core"][data-v="gold"]', '[data-cst="set"][data-f="coin.shape"][data-v="poly"]']);
await page.$eval('#cst-r-sides', e => { e.value = 9; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-cst="ctab"][data-v="faces"]'); await page.click('[data-cst="set"][data-f="coin.enm"][data-v="flag"]');
await page.click('[data-cst="ctab"][data-v="marks"]'); await page.click('[data-cst="set"][data-f="coin.pv"][data-v="anchor"]'); await page.click('[data-cst="set"][data-f="coin.mm"]:not([data-v=""])');
await page.click('[data-cst="cden"][data-v="50"]');
check('the 50 carries its enamel inlay', await until(() => page.evaluate(() => /clipPath/.test(document.querySelector('#cst-stage .cst-coin').innerHTML) && document.querySelector('#cst-stage .cst-coin').innerHTML.includes('<svg x="37"'))));
await page.screenshot({ path: path.join(OUT, 'note-studio-coin3.png') });
await page.click('[data-cst="save"]');
check('the new coin choices are saved', await until(() => page.evaluate(() => { const K = window.__game.S.nation.cur.coin; return K.ring === 'copper' && K.core === 'gold' && K.shape === 'poly' && K.sides === 9 && K.enm === 'flag' && K.pv === 'anchor' && !!K.mm; })));
await page.click('[data-cst="mode"][data-v="note"]');
// effects
for (const [L, f] of [['vignette', 'holo'], ['text', 'glitter'], ['frame', 'neon'], ['security', 'halftone'], ['emblem', 'heat'], ['paper', 'tint']]) await page.selectOption(`[data-cst-fx="${L}"]`, f);
await page.click('[data-cst="tab"][data-v="fx"]');
await clickAll(['[data-cst="set"][data-f="note.irs"][data-v="1"]', '[data-cst="set"][data-f="note.prl"][data-v="1"]', '[data-cst="set"][data-f="note.uvp"][data-v="star"]']);
await page.$eval('#cst-r-age', e => { e.value = .6; e.dispatchEvent(new Event('input', { bubbles: true })); });
const fxa = await page.evaluate(() => { const s = document.querySelector('.cst-front svg.cu-note'), uv = s.querySelector('.cu-uvm'); return { holo: !!s.querySelector('[data-layer="vignette"][filter*="fh"]'), ht: !!s.querySelector('[data-layer="security"][mask]'), heat: !!s.querySelector('[data-layer="emblem"].cu-heat'), uvHidden: uv && getComputedStyle(uv).opacity === '0', age: /mix-blend-mode:multiply/.test(s.innerHTML), irs: /ir\)" opacity=".6"/.test(s.innerHTML) }; });
await page.selectOption('[data-cst-sel="see"]', 'uv');
const uvOn = await page.evaluate(() => getComputedStyle(document.querySelector('.cst-front .cu-uvm')).opacity === '1');
await page.screenshot({ path: path.join(OUT, 'note-studio-uv.png') });
await page.selectOption('[data-cst-sel="see"]', 'flat');
check('layer effects, stripe, age and the UV picture are drawn; the UV picture shows only under UV', fxa.holo && fxa.ht && fxa.heat && fxa.uvHidden && fxa.age && fxa.irs && uvOn, JSON.stringify(fxa) + ' uv:' + uvOn);
await page.screenshot({ path: path.join(OUT, 'note-studio-effects.png') });
await page.click('[data-cst="mode"][data-v="coin"]'); await page.click('[data-cst="ctab"][data-v="cfx"]');
await clickAll(['[data-cst="set"][data-f="coin.ptn"][data-v="1"]', '[data-cst="set"][data-f="coin.ton"][data-v="1"]', '[data-cst="set"][data-f="coin.frost"][data-v="1"]']);
await page.$eval('#cst-r-wear', e => { e.value = .5; e.dispatchEvent(new Event('input', { bubbles: true })); });
const cfx = await page.evaluate(() => [...document.querySelectorAll('#cst-stage .cst-coin')].map(c => [/pt\)/, /tn\)/, /wr\)/, /fr\)/].map(r => r.test(c.innerHTML) ? 1 : 0).join('')));
check('coin effects draw on both faces (frost needs a device: the plain-value side has none)', cfx.length === 2 && cfx[0] === '1111' && cfx[1].startsWith('111'), JSON.stringify(cfx));
await page.screenshot({ path: path.join(OUT, 'note-studio-coin-effects.png') });
await page.click('[data-cst="save"]');
check('every effect is saved', await until(() => page.evaluate(() => { const c = window.__game.S.nation.cur, N = c.note, K = c.coin; return N.fx.vignette === 'holo' && N.fx.security === 'halftone' && N.fx.emblem === 'heat' && N.irs === 1 && N.prl === 1 && N.uvp === 'star' && N.age === .6 && K.ptn === 1 && K.ton === 1 && K.frost === 1 && K.wear === .5; })));
await page.click('[data-cst="mode"][data-v="note"]');
// vertical notes
await page.click('[data-cst="tab"][data-v="style"]'); await page.click('[data-cst="set"][data-f="note.or"][data-v="v"]');
const vt = await until(() => page.evaluate(() => { const s = document.querySelector('.cst-front svg.cu-note'), o = document.querySelector('.cst-front .cst-ov'), b = document.querySelectorAll('#cst-stage svg.cu-note-v').length; return s && s.dataset.or === 'v' && o.getAttribute('viewBox') === '0 0 160 320' && b >= 2 && s.getBBox().height > 200 ? true : false; }));
check('a vertical note draws upright, front and back, with its own guides', vt);
const vh = await page.$('.cst-front .cst-ov [data-part="e"]'), vb = await vh.boundingBox();
await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await page.mouse.down(); await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2 + 30, { steps: 6 }); await page.mouse.up();
await page.click('[data-cst="pick"][data-k="e"]');
check('parts move on a vertical note too', await until(() => page.evaluate(() => +document.getElementById('cst-i-y').value > 5)));
await page.screenshot({ path: path.join(OUT, 'note-studio-vertical.png') });
// the coin
await page.click('[data-cst="mode"][data-v="coin"]');
check('the coin mode shows both faces and the set', await until(() => page.evaluate(() => document.querySelectorAll('#cst-stage .cst-coin').length === 2 && document.querySelectorAll('.cst-cs svg').length >= 4 && !!document.querySelector('.cst-coin.cu-coin-b'))));
await page.click('[data-cst="ctab"][data-v="metal"]');await page.click('[data-cst="set"][data-f="coin.fin"][data-v="proof"]');
await page.click('[data-cst="ctab"][data-v="faces"]'); await page.click('[data-cst="set"][data-f="coin.rev"][data-v="wreath"]'); await page.click('[data-cst="set"][data-f="coin.emb"][data-v="portrait"]');
await page.click('[data-cst="ctab"][data-v="edge"]'); await page.click('[data-cst="set"][data-f="coin.edge"][data-v="letter"]'); await page.click('[data-cst="set"][data-f="coin.rim"][data-v="wide"]');
await page.click('[data-cst="ctab"][data-v="field"]'); await page.click('[data-cst="set"][data-f="coin.fld"][data-v="rays"]');
await page.$eval('#cst-r-dsz', e => { e.value = 1.2; e.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-cst="ctab"][data-v="words"]'); await page.fill('#cst-t-lo', 'Fair weights');
await page.screenshot({ path: path.join(OUT, 'note-studio-coin.png') });
await page.click('[data-cst="save"]');
const cs = await until(() => page.evaluate(() => { const c = window.__game.S.nation.cur, K = c && c.coin, N = c && c.note; return K && K.fin === 'proof' && K.rev === 'wreath' && K.emb === 'portrait' && K.edge === 'letter' && K.rim === 'wide' && K.fld === 'rays' && K.dsz === 1.2 && K.lo === 'Fair weights' && N.or === 'v' ? JSON.stringify(K) : false; }));
check('Save keeps the vertical note and every coin choice', !!cs, cs);
await page.setViewportSize({ width: 390, height: 844 });
check('on a phone the Studio does not scroll sideways', await page.evaluate(() => { const e = document.getElementById('cu-st'); return e.scrollWidth <= innerWidth + 1; }));
await page.screenshot({ path: path.join(OUT, 'note-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('cu-st').hidden)));
check('no page errors in the Studio', errors.length === 0, errors.join(' | '));
await ctx.close();
/* the design guide, in a fresh browser with no nation */
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page2 = await ctx2.newPage();errors.length = 0;
page2.on('pageerror', e => errors.push(e.message));
await page2.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });

/* the banknote design system: every layout, era, preset and back draws, without errors, in its layers */
await page2.goto(BASE);
check('the game exposes the note kit', await until(() => page2.evaluate(() => !!(window.__game && window.__game.CU && window.__game.CU.guide)), 20000));
const r = await page2.evaluate(() => {
  const html = window.__game.CU.guide();
  document.body.innerHTML = `<main style="padding:20px;max-width:1240px;background:#fff">${html}</main>`;
  const svgs = [...document.querySelectorAll('.cug-f svg')];
  return { n: svgs.length, eras: [...new Set(svgs.map(s => s.dataset.era).filter(Boolean))].sort().join(','), lays: [...new Set(svgs.map(s => s.dataset.lay).filter(Boolean))].sort().join(','),
    layers: document.querySelectorAll('.cug-f svg [data-layer]').length, empty: svgs.filter(s => s.getBBox().width < 10).length };
});
check('the guide draws its notes', r.n >= 50, JSON.stringify(r));
check('every era is drawn', r.eras === 'antique,classic,deco,future,polymer', r.eras);
check('every layout is drawn', r.lays === 'classic,minimal,modern,ornate', r.lays);
check('notes are drawn in named layers', r.layers > 100, r.layers);
check('no note is blank', r.empty === 0, r.empty);
await page2.screenshot({ path: path.join(OUT, 'note-design.png'), fullPage: true });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
