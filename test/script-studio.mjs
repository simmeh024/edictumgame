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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

/* the nation's script: an alphabet of its own, on the nation page, in the Script Studio, on its papers and letters */
await page.goto(BASE);
await page.fill('#d-name', 'Scriptmark');
await page.click('#found-btn');
await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
await page.evaluate(() => { const g = window.__game, m = g.clone(g.S.nation); m.motto = 'Ever Onward Together'; m.ruler = 'Ada Brook'; g.commit(m); g.render(); });

// the core, as the game runs it
const core = await page.evaluate(() => {
  const X = window.__game.SCR(), n = window.__game.S.nation, out = {};
  out.fams = Object.keys(X.SCR_FAM).length;
  out.distinct = Object.keys(X.SCR_FAM).every(f => [1, 99, 123456].every(s => new Set(X.scrGlyphs(s, f).map(g => JSON.stringify([g.S, g.F, g.D]))).size === 36));
  out.same = X.scrSVG({ s: 5, f: 'ang', w: 2 }, 'Abc') === X.scrSVG({ s: 5, f: 'ang', w: 2 }, 'Abc');
  out.differ = X.scrSVG({ s: 5, f: 'ang', w: 2 }, 'Abc') !== X.scrSVG({ s: 6, f: 'ang', w: 2 }, 'Abc');
  out.chars = X.scrChars('Ça va, Œuvre ß! 3 日本').join('');
  out.esc = X.scrSVG({ s: 5, f: 'loop', w: 2 }, 'a<b>"c"').includes('aria-label="a&lt;b&gt;&quot;c&quot;"');
  out.clean = JSON.stringify(X.scrClean({ s: 12, f: 'knot', w: 3, sl: -6, tm: 'serif', ink: 'royal', on: ['arms', 'arms', 'nope'], x: 1 }));
  out.junk = X.scrClean({ s: -1, f: 'nope', w: 9, sl: 40, tm: 'x', ink: '#fff', on: 'title' });
  out.def = JSON.stringify(X.scrOf(n)) === JSON.stringify(X.scrDef(n)) && !n.scr;
  return out;
});
check('six families, each with 36 different signs for every seed', core.fams === 6 && core.distinct);
check('the same seed draws the same letters, another seed others', core.same && core.differ);
check('accents fall off, ß and Œ are spelled out, signs it has no letter for are left out', core.chars === 'CA VA, OEUVRE SS! 3', core.chars);
check('the plain words are escaped into the label', core.esc);
check('a stored choice is cleaned: only what is understood is kept', core.clean === '{"s":12,"f":"knot","w":3,"sl":-6,"tm":"serif","ink":"royal","on":["arms"]}' && core.junk === null, core.clean + ' ' + core.junk);
check('a new nation writes in the script its seed gives it, nothing stored', core.def);

// the nation page: the script under the Overview
await page.evaluate(() => { location.hash = '#nation'; });
await until(() => page.evaluate(() => window.__game.S.view === 'nation'));
const card = await until(() => page.evaluate(() => { const c = document.querySelector('.overview #scr-card'); return c && { h: c.querySelector('.scr-h').textContent, lines: c.querySelectorAll('.scr-row .scr-l').length, keys: c.querySelectorAll('.scr-k').length, studio: !!c.querySelector('[data-scs="open"]'), label: c.querySelector('.scr-l').getAttribute('aria-label') }; }));
check('the nation page shows “Our script” under the Overview: the name and the motto, and the key', card && card.h === 'Our script' && card.lines === 2 && card.keys === 36 && card.studio && card.label === 'Scriptmark', JSON.stringify(card));
check('the name is not under the title until the nation turns it on', await page.evaluate(() => !document.querySelector('.hero .hero-scr')));
await page.evaluate(() => { document.querySelector('#scr-card .scr-keyd').open = true; document.getElementById('scr-card').scrollIntoView(); });
await page.screenshot({ path: path.join(OUT, 'script-nation-card.png') });

// another nation's page: their script, no Studio
const other = await page.evaluate(() => { const x = window.__game.allNations().find(y => !y.me); return x && x.id; });
await page.evaluate(id => { location.hash = '#visit/' + encodeURIComponent(id); }, other);
const vis = await until(() => page.evaluate(() => { const c = document.querySelector('.vs-page .overview #scr-card'); return c && { h: c.querySelector('.scr-h').textContent, studio: !!c.querySelector('[data-scs]') }; }));
check('another nation’s page shows its own script, without the Studio', vis && /^The script of /.test(vis.h) && !vis.studio, JSON.stringify(vis));

// the Script Studio
await page.evaluate(() => { location.hash = '#nation'; });
await until(() => page.evaluate(() => window.__game.S.view === 'nation' && !!document.querySelector('#scr-card [data-scs="open"]')));
await page.click('#scr-card [data-scs="open"]');
check('the Script Studio opens', await until(() => page.evaluate(() => { const e = document.getElementById('sc-st'); return e && !e.hidden && !!e.querySelector('.scs-sheet .scr-big'); })));
const fit = await page.evaluate(() => { const e = document.getElementById('sc-st'); return { sh: e.scrollHeight, h: e.getBoundingClientRect().height, w: e.scrollWidth, vw: innerWidth }; });
check('everything fits in one view on a desktop screen', fit.sh <= fit.h + 1 && fit.w <= fit.vw + 1, JSON.stringify(fit));
check('six families, four places to show it, six views', await page.evaluate(() => document.querySelectorAll('#sc-st .scs-fam').length === 6 && document.querySelectorAll('#sc-st [data-scs-on]').length === 4 && document.querySelectorAll('#sc-st .scs-use').length === 6));
const S1 = () => page.evaluate(() => document.querySelector('#sc-st .scs-key').innerHTML);
const k0 = await S1();
// a new nation's family comes from its seed: choose one it does not have yet
const fam = await page.evaluate(() => window.__game.SCR().SCS.d.f === 'wedge' ? 'knot' : 'wedge');
await page.click(`#sc-st .scs-fam[data-v="${fam}"]`);
check('choosing a family redraws the letters', await until(async () => (await S1()) !== k0 && await page.evaluate(f => window.__game.SCR().SCS.d.f === f, fam)));
await page.click('#sc-st [data-scs="tab"][data-v="pen"]');
await page.click('#sc-st [data-scs="set"][data-f="w"][data-v="3"]');
await page.click('#sc-st [data-scs="set"][data-f="tm"][data-v="serif"]');
await page.click('#sc-st [data-scs="set"][data-f="ink"][data-v="oxblood"]');
await page.evaluate(() => { const r = document.getElementById('scs-sl'); r.value = '8'; r.dispatchEvent(new Event('input', { bubbles: true })); });
const pen = await page.evaluate(() => { const d = window.__game.SCR().SCS.d; return `${d.w} ${d.tm} ${d.ink} ${d.sl}`; });
check('the pen: bold, serifs, oxblood ink, leaning forward', pen === '3 serif oxblood 8', pen);
check('the slant leans the letters', await page.evaluate(() => /skewX\(-8\)/.test(document.querySelector('#sc-st .scs-key').innerHTML)));
for (const k of ['title', 'arms', 'note', 'sign']) await page.check(`#sc-st [data-scs-on="${k}"]`);
check('turning places on shows each one on the stage', await page.evaluate(() => window.__game.SCR().SCS.d.on.join() === 'title,arms,note,sign' && window.__game.SCR().SCS.see === 'letter' && !!document.querySelector('#sc-st .scs-letter .dm-scr-sig .scr-l')));
await page.keyboard.press('Control+z');
check('Undo takes the last change back', await until(() => page.evaluate(() => window.__game.SCR().SCS.d.on.join() === 'title,arms,note')));
await page.keyboard.press('Control+y');
check('Redo puts it back', await until(() => page.evaluate(() => window.__game.SCR().SCS.d.on.length === 4)));
await page.fill('#scs-try', 'Hello neighbours');
check('a line typed in Try a line is written in the script', await until(() => page.evaluate(() => [...document.querySelectorAll('#sc-st .scs-sheet .scr-l')].some(e => e.getAttribute('aria-label') === 'Hello neighbours'))));
const seed0 = await page.evaluate(() => window.__game.SCR().SCS.d.s);
await page.click('#sc-st [data-scs="new"]');
check('New letters draws another alphabet in the same family', await page.evaluate(([s, f]) => { const d = window.__game.SCR().SCS.d; return d.s !== s && d.f === f; }, [seed0, fam]));
// a second family blended in, for a share of the letters
await page.click('#sc-st [data-scs="tab"][data-v="style"]');
const kBlend = await S1();
const mx = await page.evaluate(() => document.querySelector('#sc-st [data-scs="set"][data-f="mx"]:not([data-v=""])').dataset.v);
await page.click(`#sc-st [data-scs="set"][data-f="mx"][data-v="${mx}"]`);
await page.evaluate(() => { const r = document.getElementById('scs-mp'); r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true })); });
check('a second family blends into half the letters', await until(async () => (await S1()) !== kBlend && await page.evaluate(m => { const d = window.__game.SCR().SCS.d; return d.mx === m && d.mp === 50; }, mx)));
// the direction
await page.click('#sc-st [data-scs="set"][data-f="dr"][data-v="rtl"]');
check('right to left: the words run from the right', await until(() => page.evaluate(() => window.__game.SCR().SCS.d.dr === 'rtl' && !!document.querySelector('#sc-st .scs-sheet .scr-l.scr-rtl'))));
const ox = await page.evaluate(() => { const X = window.__game.SCR(), d = { ...X.SCS.d, dr: 'bou' }, L = X.scrLay(d, 'AB CD'), at = c => L.items.find(i => i.c === c); return at('C').x > at('D').x && at('A').x < at('B').x; });
check('ox-turning: every other word runs back', ox);
await page.click('#sc-st [data-scs="set"][data-f="dr"][data-v="ttb"]');
check('in columns: each word stands in a column on the stage', await until(() => page.evaluate(() => { const l = document.querySelector('#sc-st .scs-sheet .scr-l.scr-v'), sv = l && l.querySelector('svg.scr'); return !!sv && /--k:/.test(sv.getAttribute('style') || '') && sv.getBoundingClientRect().height > sv.getBoundingClientRect().width; })));
// one letter: its own sign, drawn on the grid
await page.click('#sc-st .scs-key [data-scs="ed"][data-v="A"]');
check('a letter in the key opens the drawing grid and the One letter tab', await until(() => page.evaluate(() => !!document.getElementById('scs-grid') && document.querySelector('#sc-st .cst-tab.on').dataset.v === 'one' && document.querySelectorAll('#scs-grid [data-scs="node"]').length === 40)));
const N = i => page.click(`#scs-grid [data-scs="node"][data-i="${i}"]`), CG = () => page.evaluate(() => (window.__game.SCR().SCS.d.cg || {}).A || '');
for (const i of [0, 35, 35]) await N(i);
await page.click('#sc-st [data-scs="tool"][data-v="curve"]');
for (const i of [4, 22, 39, 39]) await N(i);
await page.click('#sc-st [data-scs="tool"][data-v="line"]');
for (const i of [2, 17, 15, 2]) await N(i);
await page.click('#sc-st [data-scs="tool"][data-v="dot"]');
await N(12);
check('lines, a curve, a closed shape and a dot are drawn into the sign', (await CG()) === '0z,~4mD,2hf2,.c', await CG());
await page.click('#sc-st [data-scs="tool"][data-v="line"]');
await page.focus('#scs-grid');
for (const k of ['Space', 'ArrowRight', 'Space', 'ArrowDown', 'Space', 'Enter']) await page.keyboard.press(k);
check('the keyboard draws too: arrows move, Space adds a point, Enter finishes', await until(async () => (await CG()) === '0z,~4mD,2hf2,.c,cdi'), await CG());
await page.keyboard.press('Backspace');
check('Backspace takes the last stroke back', await until(async () => (await CG()) === '0z,~4mD,2hf2,.c'), await CG());
await page.keyboard.press('Space');
await page.keyboard.press('Escape');
check('Escape drops a stroke being drawn and leaves the Studio open', await page.evaluate(() => !document.getElementById('sc-st').hidden && window.__game.SCR().SCS.ed.cur.length === 0));
check('the key shows the sign drawn by hand', await page.evaluate(() => { const X = window.__game.SCR(), d = X.SCS.d; return /M0 0L0 14/.test(X.scrSVG(d, 'A', { label: '' })); }));
await page.screenshot({ path: path.join(OUT, 'script-studio-draw.png') });
// another letter from another family
await page.click('#sc-st [data-scs="step"][data-d="1"]');
const famB = await page.evaluate(() => { const X = window.__game.SCR(), d = X.SCS.d; return Object.keys(X.SCR_FAM).find(k => k !== d.f && k !== d.mx); });
await page.click(`#sc-st [data-scs="lfam"][data-v="${famB}"]`);
check('the next letter, B, takes its sign from another family', await until(() => page.evaluate(f => window.__game.SCR().SCS.ed.c === 'B' && (window.__game.SCR().SCS.d.lf || {}).B === f, famB)));
await page.click('#sc-st [data-scs="done"]');
const views = {};
for (const v of ['title', 'arms', 'note', 'letter', 'charter', 'key']) {
  await page.click(`#sc-st .scs-use[data-v="${v}"]`);
  views[v] = await page.evaluate(v => { const c = document.getElementById('scs-cv'); return v === 'arms' ? !!c.querySelector('svg .scr-cv path') : v === 'note' ? !!c.querySelector('svg.cu-note .scr-in path') : v === 'letter' ? !!c.querySelector('.dm-scr-sig svg.scr') : v === 'charter' ? c.querySelectorAll('svg.scr-charter .scr-in').length >= 37 : v === 'title' ? !!c.querySelector('.hero-scr .scr-l') : c.querySelectorAll('.scr-k').length === 36; }, v);
  if (v !== 'key') await page.screenshot({ path: path.join(OUT, `script-studio-${v}.png`) });
}
check('every view draws the script: page title, arms scroll, banknote motto, letter, charter card, key', Object.values(views).every(Boolean), JSON.stringify(views));
await page.screenshot({ path: path.join(OUT, 'script-studio.png') });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('#sc-st .cst-bar [data-scs="png"]')]);
let dlOk = false, dlInfo = 'no download';
if (dl) { const f = path.join(OUT, 'script-charter.png'); await dl.saveAs(f); const b = fs.readFileSync(f); dlInfo = dl.suggestedFilename() + ' ' + b.length; dlOk = /^scriptmark-script-charter\.png$/.test(dl.suggestedFilename()) && b.length > 20000 && b.slice(1, 4).toString() === 'PNG'; }
check('the charter card is saved as a picture', dlOk, dlInfo);
await page.click('#scs-save');
const saved = await until(() => page.evaluate(f => { const v = window.__game.S.nation.scr; return v && v.f === f && v.dr === 'ttb' && v.mp === 50 && !!v.mx && v.cg && v.cg.A === '0z,~4mD,2hf2,.c' && v.lf && !!v.lf.B && v.w === 3 && v.tm === 'serif' && v.ink === 'oxblood' && v.sl === 8 && v.on.length === 4 && Number.isInteger(v.s) ? JSON.stringify(v) : false; }, fam));
check('Save keeps the script on the nation', !!saved, saved);
await page.setViewportSize({ width: 390, height: 844 });
check('on a phone the Studio does not scroll sideways', await page.evaluate(() => document.getElementById('sc-st').scrollWidth <= innerWidth + 1));
await page.screenshot({ path: path.join(OUT, 'script-studio-phone.png') });
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('Escape');
check('Escape closes it', await until(() => page.evaluate(() => document.getElementById('sc-st').hidden)));

// where it is seen, once saved
await until(() => page.evaluate(() => !!document.querySelector('.hero .hero-scr')));
const seen = await page.evaluate(() => ({ title: document.querySelector('.hero .hero-scr .scr-l')?.getAttribute('aria-label'), ink: getComputedStyle(document.querySelector('#scr-card .scr-l')).color, note: !!document.querySelector('svg.cu-note .scr-in') }));
check('the name is written under the title, in oxblood', seen.title === 'Scriptmark, in its own script' && seen.ink === 'rgb(122, 31, 31)', JSON.stringify(seen));
check('the banknote on the nation page has its motto in the script', seen.note);
check('the nation page sets the name and motto in columns, the title under the name keeps a line', await page.evaluate(() => document.querySelectorAll('#scr-card .scr-row .scr-l.scr-v').length === 2 && !document.querySelector('.hero .hero-scr .scr-v')));
check('the key on the nation page has the sign drawn by hand', await page.evaluate(() => /M0 0L0 14/.test(document.querySelector('#scr-card .scr-k').innerHTML)));
await page.evaluate(() => scrollTo(0, 0));
await page.screenshot({ path: path.join(OUT, 'script-nation-page.png') });
await page.evaluate(() => { location.hash = '#customise/arms'; });
await until(() => page.evaluate(() => window.__game.S.view === 'customise'));
await page.evaluate(() => { const b = document.querySelector('#cz-l-m [data-v="1"], [data-act="cz-arm"][data-f="m"][data-v="1"]'); if (b) b.click(); });
check('the arms’ motto scroll is written in the script', await until(() => page.evaluate(() => !!document.querySelector('.cz-arms-big .scr-cv path'))));

// letters: [[words]] in the sender's script, with Translate
const lt = await page.evaluate(() => {
  const X = window.__game.SCR(), me = window.__game.myId(), h = X.scrDmWith(me, () => X.dmRich('Greetings **friend**, [[Long live *the* <Union>]] and *more*'));
  const box = document.createElement('div'); box.className = 'dm-x'; box.id = 'scr-test-box'; box.innerHTML = h; document.body.appendChild(box);
  const seal = box.querySelector('.scr-seal'), x = seal && seal.querySelector('.scr-tr-x');
  return { seal: !!seal, svg: seal && seal.querySelector('.scr-l').getAttribute('aria-label'), bold: box.querySelector('b')?.textContent, it: box.querySelectorAll('i').length, hidden: x && x.hidden, plain: x && x.textContent,
    noSender: X.dmRich('[[x y]]'), plainList: X.dmPlain('Hi [[long live us]] **now**'),
    wrap: X.scrFmt('one two\nthree', 2, 2), unwrap: X.scrFmt('[[one two]]', 0, 11), inside: X.scrFmt('a [[b c]] d', 4, 7), multi: X.scrFmt('one\n\ntwo', 0, 8), blank: X.scrFmt('  ', 1, 1) };
});
check('a [[line]] in a letter is drawn in the sender’s script, the marks around it still work', lt.seal && lt.svg === 'Long live *the* <Union>' && lt.bold === 'friend' && lt.it === 1 && lt.hidden === true && lt.plain === 'Long live *the* <Union>', JSON.stringify(lt));
check('without a sender the words show plainly; the list of letters loses the marks', lt.noSender === '<p>x y</p>' && lt.plainList === 'Hi long live us now', lt.noSender + ' | ' + lt.plainList);
check('the script button wraps the line, takes the marks off again, and wraps each line of a choice', JSON.stringify(lt.wrap) === '["[[one two]]\\nthree",0,11]' && JSON.stringify(lt.unwrap) === '["one two",0,7]' && JSON.stringify(lt.inside) === '["a b c d",2,5]' && JSON.stringify(lt.multi) === '["[[one]]\\n\\n[[two]]",0,16]' && lt.blank === null, JSON.stringify([lt.wrap, lt.unwrap, lt.inside, lt.multi, lt.blank]));
await page.click('#scr-test-box .scr-tr');
check('Translate shows the plain words, Hide puts them away', await page.evaluate(() => { const b = document.querySelector('#scr-test-box .scr-tr'), x = b.nextElementSibling; const one = !x.hidden && b.textContent === 'Hide' && b.getAttribute('aria-expanded') === 'true'; b.click(); return one && x.hidden && b.textContent === 'Translate'; }));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
