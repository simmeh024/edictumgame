// Portraits of state: the faces of the head of government and the cabinet, edited in Customise › Portraits and
// opened from "Edit portrait" on every cabinet card. A face without a look is the one the name drew before; a look
// adds hair, facial hair, headwear, dress and a detail; the head of government also has an ink, a ring and an earned
// nickname. Also: the cabinet's dress code, pieces earned in play (tried on before, saved only once earned), a renamed
// leader keeping the face, a minister who takes over bringing theirs, the Museum's former leaders, banknotes, and the
// court painter's edict. On a desktop and a phone, in the light and dark themes.
//   python3 build.py
//   node test/portraits.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the test
// probe. Screenshots go to test/out/.
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

/* a founded nation with a named leader */
async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Velmora');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  const nation = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation)));
  const go = async h => { await page.evaluate(h => { location.hash = '#' + h; }, h); await sleep(700); };
  await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); });
  await edit(n => { delete n.onb; n.ruler = 'Aurelia Montague'; });
  return { ctx, page, errors, edit, nation, go };
}
const toasts = page => page.evaluate(() => (window.__toasts || []).join(' | '));
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

try {
  /* ── desktop, light: everything ── */
  {
    const t = await start('light', { width: 1280, height: 900 }), { page, edit, nation, go } = t;
    const P = () => page.evaluate(() => Object.keys(window.__game.PT()));
    check('the probe has the portraits', (await P()).includes('ptBust'));

    /* a face without a look is the face the name drew before */
    const same = await page.evaluate(() => {
      const X = window.__game.PT(), out = [];
      for (const seed of ['Rosalind Pemberton', 'ruler:Aurelia Montague', 'leader:abc', 'Hiroshi Lindqvist', 'Juniper Castellano'])
        for (const old of [false, true]) {
          const a = X.cvBust(seed), b = X.ptBust(seed, {}, old), joined = b.lay;
          out.push(b.d === a.d && joined.includes(a.x) && (!old || joined.includes(`d="${a.h}"`)));
        }
      return out;
    });
    check('an empty look draws the same bust, hair and details as before', same.every(Boolean), same);
    const medSame = await page.evaluate(() => { const X = window.__game.PT(), a = X.cvMed({ seed: 'Noor Delacroix', cls: 'cv-med-s' }), b = X.cvMed({ seed: 'Noor Delacroix', cls: 'cv-med-s', look: {} });
      const d = s => (s.match(/ d="[^"]+"/g) || []).join('');return d(a) === d(b); });
    check('the medallion without a look has the same paths', medSame);

    /* the charter's task: Customise your leader, with its reward, opening Portraits on the head of government */
    await go('nation');
    const row = await page.evaluate(() => { const li = document.querySelector('.tut-l-charter li[data-k="portrait"]'); return li ? { tag: (li.querySelector('.tut-lc') || {}).textContent || '', btn: !!li.querySelector('[data-act="tut-go"][data-to="cz-sec-r"]') } : null; });
    check('the charter asks to customise the leader, for 5 land credits, 25 goods, 25 food and 50 timber', !!row && /\+5 land · 25 goods · 25 food · 50 timber/.test(row.tag) && row.btn, row);
    await page.evaluate(() => { const l = document.querySelector('.tut-l-charter'); if (l) l.scrollIntoView(); });
    await page.screenshot({ path: OUT + '/portraits-charter-1280.png' });
    if (row && row.btn) {
      await page.click('.tut-l-charter li[data-k="portrait"] [data-act="tut-go"]');
      check('its button opens Customise › Portraits on the leader', await until(() => page.evaluate(() => location.hash === '#customise/portraits' && !!document.querySelector('#cz-sec-r #pt-p-lead.on'))));
    }

    /* the Cabinet tab: an Edit portrait for the leader and each minister */
    await go('government/cabinet');
    check('Edit portrait on the leader and every minister', await until(() => page.evaluate(() => document.querySelectorAll('[data-act="pt-edit"]').length === 8)));
    await page.click('#pt-edit-fin');
    check('it opens Customise › Portraits on that minister', await until(() => page.evaluate(() => location.hash === '#customise/portraits' && !!document.querySelector('#cz-sec-r .pt-p.on#pt-p-fin'))));
    /* a minister's own look: a top hat and a monocle */
    for (let i = 0; i < 4; i++) await page.click('#pt-w-n');
    await page.click('#pt-x-n');
    check('the steppers show the choice', await page.evaluate(() => [...document.querySelectorAll('#cz-sec-r .pt-step output')].map(o => o.textContent).join('|').includes('Top hat')));
    check('an unsaved draft is marked on the minister', await page.evaluate(() => /Unsaved/.test(document.getElementById('pt-p-fin').textContent)));
    await page.click('#pt-save');
    let n = await nation();
    const finName = await page.evaluate(() => window.__game.PT().cabOf(window.__game.S.nation).fin.nm);
    check('the minister’s look is saved with their name', n.cpt && n.cpt.fin && n.cpt.fin.l.w === 4 && n.cpt.fin.l.x === 1 && n.cpt.fin.n === finName, n.cpt);
    await page.screenshot({ path: OUT + '/portraits-minister-1280.png' });

    /* the dress code: Military dresses the cabinet; codes with pieces not yet earned are shut */
    await page.click('#pt-c-military');
    n = await nation();
    check('the dress code is saved', n.cdc === 'military');
    check('codes needing earned pieces are shut', await page.evaluate(() => ['classical', 'revolutionary', 'academic'].every(k => document.getElementById('pt-c-' + k).disabled) && !document.getElementById('pt-c-court').disabled));
    const looks = await page.evaluate(() => { const X = window.__game.PT(), n = window.__game.S.nation, cab = X.cabOf(n); return ['fin', 'def'].map(pf => cab[pf] ? X.ptMinLook(n, pf, cab[pf]) : null); });
    check('a minister wears the code under their own choices', looks[0] && looks[0].w === 4 && looks[0].d === 3 && looks[1] && looks[1].w === 5 && looks[1].d === 3, looks);
    check('a candidate for a post wears the code', await page.evaluate(() => { const X = window.__game.PT(); return X.ptCand(window.__game.S.nation, { nm: 'Quentin Blackwood' }, 40).look.w === 5; }));

    /* the head of government: a crown can be tried on, but only saved once earned */
    await page.click('#pt-p-lead');
    for (let i = 0; i < 2; i++) await page.click('#pt-w-n');
    check('the crown is marked as earned in play', await page.evaluate(() => /Crown.*Earned/.test(document.querySelector('#cz-sec-r .pt-rows').textContent)));
    check('a piece not yet earned cannot be saved', await page.evaluate(() => document.getElementById('pt-save').disabled && /Not yet earned/.test(document.querySelector('#cz-sec-r .pt-prev').textContent)));
    await edit(n => { n.lt = Date.now() - 31 * 86400000; });
    n = await nation();
    check('thirty days in office earn the crown, for good', (n.ptu || []).includes('w2'), n.ptu);
    const msg = await page.evaluate(() => { const G = window.__game, X = G.PT(), old = G.clone(G.S.nation), n = G.clone(old); n.ptu = (n.ptu || []).filter(k => k !== 'w2'); return X.ptCommit(n, old, Date.now()); });
    check('a toast says so, with a link to Portraits', msg.some(m => /the Crown/.test(m.m) && m.links.some(l => l.kind === 'portrait' && l.id === 'w2')), msg);
    await page.evaluate(() => window.__game.render());
    check('now it can be saved', await page.evaluate(() => !document.getElementById('pt-save').disabled));
    await page.click('#pt-e-n'); await page.click('#pt-i-navy'); await page.click('#pt-r-n');
    await page.click('#pt-save');
    n = await nation();
    check('the leader’s look, ink and ring are saved', n.rpt && n.rpt.l && n.rpt.l.w === 2 && n.rpt.l.e === 1 && n.rpt.i === 'navy' && n.rpt.r === 1 && !!n.rpt.b, n.rpt);
    check('saving it ticks the charter’s Customise your leader', (n.tut && n.tut.lc || []).includes('portrait'), n.tut);
    await page.screenshot({ path: OUT + '/portraits-leader-1280.png' });

    /* the Cabinet tab shows it: the ink, the ring, the caption */
    await go('government/cabinet');
    const head = await page.evaluate(() => { const m = document.querySelector('.cv-lead>.cv-med'); return { cls: m.className, color: getComputedStyle(m).color, cap: (document.querySelector('.cv-lead .pt-cap') || {}).textContent || '' }; });
    check('the leader’s medallion has the ink and the ring', /cv-rg1/.test(head.cls) && head.color !== 'rgb(124, 94, 32)', head);
    check('the caption reads from the records', /Born in .* · in office since/.test(head.cap), head.cap);
    await page.screenshot({ path: OUT + '/portraits-cabinet-1280.png' });

    /* a renamed leader keeps the face */
    const before = await page.evaluate(() => document.querySelector('.cv-lead>.cv-med').outerHTML), seed0 = await page.evaluate(() => window.__game.PT().ptLeadSeed(window.__game.S.nation));
    check('naming the leader kept the face drawn before the name', /^leader:/.test(seed0), seed0);
    await edit(n => { n.ruler = 'Aurelia Montague-Vell'; });
    n = await nation();
    check('a rename keeps the seed the face came from', n.rpt.s === seed0, n.rpt);
    await page.evaluate(() => window.__game.render());
    check('and the face stays the same', await page.evaluate(b => document.querySelector('.cv-lead>.cv-med').outerHTML === b, before));

    /* nicknames: earned in office, then worn */
    await edit(n => { n.tly = Object.assign({}, n.tly); n.tly.build = (n.ptz ? n.ptz.b : 0) + 25; });
    n = await nation();
    check('twenty-five buildings in office earn “the Builder”', n.ptz && n.ptz.k.includes('builder'), n.ptz);
    await go('customise/portraits');
    await page.click('#pt-p-lead');
    await page.click('#pt-k-builder');
    await page.click('#pt-save');
    n = await nation();
    check('the nickname is saved', n.rpt.k === 'builder');
    await go('government/cabinet');
    check('the nickname follows the name', await page.evaluate(() => /the Builder/.test(document.querySelector('.cv-lead .leader-n').textContent)));

    /* banknotes: the leader's look is engraved */
    const notes = await page.evaluate(() => { const X = window.__game.PT(), n = window.__game.S.nation, c = X.cuOf(n), a = X.cuNoteSVG(n, c), b = X.cuNoteSVG(Object.assign({}, n, { rpt: undefined }), c); return { ok: a.length > 1000, diff: a !== b }; });
    check('the banknote engraves the saved look', notes.ok && notes.diff, notes);

    /* a minister who takes over brings their face; the one who left hangs in the Museum as they looked */
    const was = await page.evaluate(() => { const X = window.__game.PT(), n = window.__game.S.nation, m = X.cabOf(n).fin; return { fin: m.nm, look: X.ptMinLook(n, 'fin', m) }; });
    await edit((n, now, G) => { G.PT().succeed(n, 'fin'); });
    n = await nation();
    check('the new leader keeps the face they had as a minister', n.ruler === was.fin && n.rpt.s === was.fin && n.rpt.f === 'fin' && n.rpt.l.w === was.look.w && n.rpt.l.d === was.look.d, { r: n.rpt, was });
    const past = (n.cuS || [])[n.cuS.length - 1] || {};
    check('the one who left keeps their portrait on file', past.p && past.p.s === seed0 && past.p.l.w === 2 && past.p.i === 'navy' && past.p.k === 'builder', past);
    check('a new leader starts without a nickname', !n.rpt.k);
    await go('government/cabinet');
    check('the caption says where they came from', await page.evaluate(() => /Formerly Finance Minister/.test((document.querySelector('.cv-lead .pt-cap') || {}).textContent || '')));
    await page.evaluate(() => { window.__game.S.muHall = 'leaders'; }); await go('museum');
    check('the Museum hangs the former leader', await until(() => page.evaluate(() => { const f = document.querySelector('.pt-former'); return !!f && /Aurelia Montague/.test(f.textContent) && /the Builder/.test(f.textContent) && !!f.querySelector('.cv-rg1'); })));
    await page.screenshot({ path: OUT + '/portraits-museum-1280.png', fullPage: false });

    /* the court painter's edict, in the manner of the old emperors */
    await edit((n, now) => { n.inbox = [{ id: 'pt-court-painter', t: now }]; });
    await page.evaluate(() => window.__game.answer('pt-court-painter', 1));
    n = await nation();
    check('the emperors’ answer paints a laurel wreath and an ermine robe in a laurel ring', n.rpt.l.w === 1 && n.rpt.l.d === 7 && n.rpt.r === 2, n.rpt);
    check('and earns all three', ['w1', 'd7', 'r2'].every(k => (n.ptu || []).includes(k)), n.ptu);
    check('the sitting is filed for the Dispatch', (n.log || []).some(l => l.k === 'portrait' && l.a === 'emperor'));

    /* a saved look survives a reload */
    await page.reload(); await page.waitForFunction(() => window.__game && window.__game.S.nation);
    const n2 = await nation();
    check('looks, code and earned pieces survive a reload', canon(n2.rpt) === canon(n.rpt) && n2.cdc === 'military' && canon(n2.cpt) === canon(n.cpt) && (n2.ptu || []).length === (n.ptu || []).length, { a: n2.rpt, b: n.rpt });
    check('desktop: no page errors', t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
  /* ── a phone, light and dark: the section fits and works ── */
  for (const theme of ['light', 'dark']) {
    const t = await start(theme, { width: 375, height: 812 }), { page, go } = t;
    await go('customise/portraits');
    check(`phone ${theme}: the section is open`, await until(() => page.evaluate(() => !!document.querySelector('#cz-sec-r .pt-rows'))));
    await page.click('#pt-e-n'); await page.click('#pt-w-n');
    check(`phone ${theme}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    await page.evaluate(() => document.querySelector('#cz-sec-r .pt-sheet').scrollIntoView());
    await page.screenshot({ path: OUT + `/portraits-375-${theme}.png` });
    check(`phone ${theme}: no page errors`, t.errors.length === 0, t.errors);
    await t.ctx.close();
  }
} catch (e) { console.log('FAIL exception ::', e && e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
