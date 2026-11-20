import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* How to play, rebuilt (2026-11-20): chapters and folding sections, the guide's own search, links to a section (also
   before founding), "for you now", Still stuck?, the "?" beside a page's title, game words explained, /help <topic>
   cards, the admin's count of tickets per section, and every section saying something. Local mode, no emulators. */
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
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + info}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 6000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
async function open(vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  return { ctx, page, errors };
}
const shut = el => el.getAttribute('aria-expanded') !== 'true';
const openSec = (page, k) => page.evaluate(k => { const b = document.querySelector(`[data-act="help-tg"][data-k="${k}"]`); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }, k);

try {
  /* ── before founding: the founding page's How to play ── */
  {
    const { ctx, page, errors } = await open();
    await page.goto(BASE);
    await page.click('[data-act="found-help"]');
    await page.waitForSelector('.help .help-sec');
    const shape = await page.evaluate(() => ({
      ch: [...document.querySelectorAll('.help-ch-h')].map(h => h.textContent),
      first: [...document.querySelectorAll('.help-sec')].slice(0, 3).map(s => s.dataset.k),
      secs: document.querySelectorAll('.help-sec').length,
      open: document.querySelectorAll('.help-b:not([hidden])').length,
      sums: [...document.querySelectorAll('.help-sec')].every(s => (s.querySelector('.help-sum')?.textContent || '').trim().length > 10),
      toc: document.querySelectorAll('.help-toc-ch').length
    }));
    check('the guide is in chapters, each listed in the contents', shape.ch.length >= 10 && shape.toc === shape.ch.length && shape.ch[0] === 'Starting out', JSON.stringify(shape.ch));
    check('Getting started and Your first days come first, the tutorial after them', shape.first.join() === 'start,early-game,tut', shape.first.join());
    check('every section is folded to its title and one line', shape.open === 0 && shape.sums && shape.secs >= 70, JSON.stringify(shape));
    const empty = await page.evaluate(() => [...document.querySelectorAll('.help-sec')].filter(s => (s.querySelector('.help-b')?.textContent || '').replace(/Still stuck\?.*$/s, '').trim().length < 60).map(s => s.dataset.k));
    check('every section has something to say, the Bureau of Intelligence included', !empty.length, empty.join());
    const fresh = ['glossary', 'studios', 'borders', 'market', 'chat', 'board', 'events', 'achievements', 'museum', 'settings', 'stats', 'shop', 'invites'];
    const have = await page.evaluate(ks => ks.filter(k => document.getElementById('help-' + k)), fresh);
    check('the new sections are there', have.length === fresh.length, fresh.filter(k => !have.includes(k)).join());
    // a section opens and closes
    await page.click('[data-act="help-tg"][data-k="land"]');
    check('a section opens on its title', await page.evaluate(() => !document.getElementById('hb-land').hidden && document.querySelector('[data-act="help-tg"][data-k="land"]').getAttribute('aria-expanded') === 'true'));
    await page.click('[data-act="help-tg"][data-k="land"]');
    check('and folds again', await page.evaluate(() => document.getElementById('hb-land').hidden));
    // the contents open what they jump to
    await page.click('.help-toc a[href="#help-war"]');
    check('a contents link opens its section', await until(() => page.evaluate(() => !document.getElementById('hb-war').hidden)));
    // search
    await page.fill('#help-q', 'firewood');
    check('the guide’s search finds words inside sections', await until(() => page.evaluate(() => document.querySelectorAll('.help-hit').length > 0 && /firewood/i.test(document.querySelector('.help-hit').textContent))));
    await page.click('.help-hit');
    check('a hit opens its section with the word marked', await until(() => page.evaluate(() => { const m = document.querySelector('mark.hq-cur'); return !!m && /firewood/i.test(m.textContent) && !m.closest('.help-b').hidden; })));
    await page.fill('#help-q', 'zqxwv');
    check('a search with no hits says so', await until(() => page.evaluate(() => /Nothing in the guide matches/.test(document.querySelector('.help-res-n')?.textContent || ''))));
    await page.fill('#help-q', '');
    await page.screenshot({ path: path.join(OUT, 'help-founding.png') });
    check('no page errors before founding', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  /* ── a link to a section, opened before founding ── */
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844 });
    await page.goto(BASE + '#help/rivers');
    check('a link to a section opens How to play there, before founding', await until(() => page.evaluate(() => { const b = document.getElementById('hb-rivers'), h = document.getElementById('hh-rivers'); if (!b || b.hidden) return false; const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 8000));
    await page.screenshot({ path: path.join(OUT, 'help-link-phone.png') });
    check('no page errors on the link', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  /* ── with a nation ── */
  {
    const { ctx, page, errors } = await open();
    await page.goto(BASE);
    await page.fill('#d-name', 'Helpmark');
    await page.click('#found-btn');
    await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
    await page.evaluate(() => { location.hash = '#help'; });
    await until(() => page.evaluate(() => window.__game.S.view === 'help' && !!document.querySelector('.help-sec')));
    await openSec(page, 'pop');
    const you = await until(() => page.evaluate(() => document.querySelector('#hb-pop .help-you')?.textContent || ''));
    check('Population shows the reader’s own figures', /For Helpmark now/.test(you) && /People/.test(you) && /Growth/.test(you), you);
    await openSec(page, 'trade');
    const tr = await page.evaluate(() => document.querySelector('#hb-trade .help-you')?.textContent || '');
    check('Resources and trade shows the stockpile, each resource of its cap', /Food/.test(tr) && /of \d/.test(tr) && /a day/.test(tr), tr);
    await page.reload();
    await until(() => page.evaluate(() => window.__game && window.__game.S.view === 'help' && !!document.querySelector('.help-sec')));
    check('open sections stay open on this device', await until(() => page.evaluate(() => !document.getElementById('hb-pop').hidden && !document.getElementById('hb-trade').hidden && document.getElementById('hb-war').hidden)));
    // the page drawn again (a save) keeps it as it was
    await page.evaluate(() => { window.__game.render(); window.__game.render(); });
    check('a redraw keeps open sections open and nothing doubled', await page.evaluate(() => !document.getElementById('hb-pop').hidden && document.querySelectorAll('#hb-pop .help-you').length === 1 && window.__game.RPATCH.err === 0), JSON.stringify(await page.evaluate(() => ({ err: window.__game.RPATCH.err }))));
    // game words
    await openSec(page, 'issues');
    const gl = await until(() => page.evaluate(() => document.querySelectorAll('#hb-issues .gl').length));
    check('game words are marked in an open section', gl > 0, String(gl));
    await page.evaluate(() => document.querySelector('#hb-issues .gl').focus());
    const pop = await until(() => page.evaluate(() => { const p = document.getElementById('gl-pop'); return p && !p.hidden ? p.textContent : ''; }));
    check('focusing a game word explains it, with a link into the guide', /How to play|Read:/.test(pop) && pop.length > 40, pop);
    await page.keyboard.press('Escape');
    check('Escape puts the explanation away', await page.evaluate(() => document.getElementById('gl-pop').hidden));
    await page.evaluate(() => window.__game.render());
    check('a redraw marks each word once, not twice', await page.evaluate(() => { const s = [...document.querySelectorAll('#hb-issues .gl')].map(x => x.dataset.g); return s.length === new Set(s).size && !document.querySelector('.gl .gl'); }));
    // Still stuck?
    await page.click('#hb-issues [data-act="help-stuck"]');
    check('Still stuck? offers someone to ask (by email in local mode)', await page.evaluate(() => { const b = document.getElementById('hst-issues'); return !b.hidden && /@/.test(b.textContent); }));
    // copy link
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('#hb-issues [data-act="help-link"]');
    const clip = await until(() => page.evaluate(() => navigator.clipboard.readText().catch(() => '')));
    check('Copy link copies a link to the section', /#help\/issues$/.test(clip || '') || await page.evaluate(() => /#help\/issues/.test(document.getElementById('toast')?.textContent || '')), clip);
    // open all, close all
    await page.click('[data-act="help-all"][data-v="1"]');
    check('Open all opens every section', await until(() => page.evaluate(() => !document.querySelector('.help-b[hidden]'))));
    await page.click('[data-act="help-all"][data-v="0"]');
    check('Close all folds them all', await until(() => page.evaluate(() => !document.querySelector('.help-b:not([hidden])'))));
    await page.screenshot({ path: path.join(OUT, 'help-nation.png') });
    // the "?" beside a page's title
    await page.evaluate(() => { location.hash = '#trade'; });
    await until(() => page.evaluate(() => window.__game.S.view === 'trade'));
    check('a page has a ? beside its title', await until(() => page.evaluate(() => !!document.querySelector('#main .vh h1 .hlp-q[data-k="trade"]'))));
    await page.evaluate(() => window.__game.render());
    check('only one, after the page is drawn again', await page.evaluate(() => document.querySelectorAll('.hlp-q').length === 1 && window.__game.RPATCH.err === 0));
    await page.click('.hlp-q');
    check('the ? opens How to play at that page’s section', await until(() => page.evaluate(() => window.__game.S.view === 'help' && !document.getElementById('hb-trade').hidden && document.activeElement && document.activeElement.id === 'hh-trade')));
    // game words on another page, and Settings turning them off
    await page.evaluate(() => { location.hash = '#settings/display'; });
    await until(() => page.evaluate(() => window.__game.S.view === 'settings' && !!document.querySelector('[data-act="sg-gloss"]')));
    check('Settings › Display has the game-words switch, on', await page.evaluate(() => document.querySelector('[data-act="sg-gloss"]').checked));
    await page.click('[data-act="sg-gloss"]');
    await page.evaluate(() => { location.hash = '#help'; });
    await until(() => page.evaluate(() => window.__game.S.view === 'help'));
    await openSec(page, 'issues');
    await sleep(200);
    check('turned off, no word is marked', await page.evaluate(() => !document.querySelector('.gl')));
    // the game's search finds the guide's words
    const qj = await page.evaluate(() => window.__game.UXP2().qjItems('firewood').filter(x => x.g === 'How to play').map(x => x.v));
    check('the game’s search finds a word inside the guide', qj.some(v => /^helpq:/.test(v)), JSON.stringify(qj));
    // /help <topic> and its card
    const cmd = await page.evaluate(() => { const H = window.__game.HELPX(); return { war: H.rgcCmd('/help war'), mandate: H.rgcCmd('/help mandate'), none: H.rgcCmd('/help zqxwv'), bare: H.rgcCmd('/help'), card: H.rgcCardHTML(H.rgcCardOf({ k: 'help', s: 'war' }), {}, 'X'), bad: H.rgcCardOf({ k: 'help', s: 'War!' }) }; });
    check('/help war posts a card for the War section', cmd.war?.cd?.k === 'help' && cmd.war.cd.s === 'war', JSON.stringify(cmd.war));
    check('/help with a game word finds the section that explains it', cmd.mandate?.cd?.s === 'cab', JSON.stringify(cmd.mandate));
    check('/help with nothing to find says so, and /help alone still lists the commands', /No part of How to play/.test(cmd.none?.err || '') && /\/help <topic>/.test(cmd.bare?.err || ''), JSON.stringify([cmd.none, cmd.bare]));
    check('the card links to the section, and a bad card is dropped', /data-act="help-open" data-k="war"/.test(cmd.card) && cmd.bad === null, cmd.card);
    // the admin's Help queries page names the section
    const adm = await page.evaluate(() => { const H = window.__game.HELPX(); return { chip: H.admhHs({ hs: 'war' }), none: H.admhHs({}), count: H.admhHsCount({ open: [{ hs: 'war' }, { hs: 'war' }, { hs: 'land' }, {}], closed: [{ hs: 'land' }] }) }; });
    check('the admin page labels a ticket with its section and counts them', /How to play: War/.test(adm.chip) && adm.none === '' && /War 2 · Land 2|Land 2 · War 2/.test(adm.count), JSON.stringify(adm));
    check('no page errors with a nation', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  /* ── a phone ── */
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844 });
    await page.goto(BASE);
    await page.fill('#d-name', 'Pocketmark');
    await page.click('#found-btn');
    await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view, null, { timeout: 30000 });
    await page.evaluate(() => { location.hash = '#help/pop'; });
    await until(() => page.evaluate(() => window.__game.S.view === 'help' && !!document.getElementById('hb-pop') && !document.getElementById('hb-pop').hidden));
    const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
    check('nothing runs off a phone screen', wide.sw <= wide.vw + 1, JSON.stringify(wide));
    await page.screenshot({ path: path.join(OUT, 'help-phone.png') });
    check('no page errors on a phone', !errors.length, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
