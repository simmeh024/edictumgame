// The player survey in the page (28 Nov 2026; game/edictum.html "the player survey", functions/survey.js). With the
// server stood in by a small fake (the game's SV.api): it waits for a calm moment (not just after loading, not over
// another dialog, not on the War page, never for staff), then one question a screen: a single answer, up to three, a
// "Nothing" that stands alone, "Something else" with words, a skip, a follow-up after "Not yet", 0-10; closing keeps
// a draft that comes back as "Carry on"; the answers sent, the thanks, the secret achievement and its Ballot box charge.
// "Ask me tomorrow" (twice at most) and "No thanks"; the "you said, we did" note; a phone; and the admin portal's
// Player survey page: its counts, NPS, filters, the preview and the Excel download, read back as a workbook.
//   python3 build.py
//   node test/survey-page.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators). Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SV_ID, SV_QS, svAsked, svForPlayer, svCore, svPool } from '../functions/survey-data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
const OUT = process.env.TEST_OUT || path.join(ROOT, 'test', 'out');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
fs.mkdirSync(OUT, { recursive: true });
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
const browser = await pw.chromium.launch();

let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }
const DAY = 864e5;
/* the questions a player gets with the two extra ones "src" and "shop", as the server sends them */
const QS = svForPlayer(svAsked(['src', 'shop']));

async function open(viewport, opt = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...(opt.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { if (g && g.S) window.__game = g; }; });
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast{display:none!important}'; document.head.appendChild(st); }); });
  await page.goto(BASE);
  await page.fill('#d-name', 'Ballotia');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view && window.EDICTUM_PROBE.sv);
  await sleep(600);
  /* a nation founded ten days ago, every dialog the founding opened closed, and the fake server */
  await page.evaluate(qs => {
    const G = window.__game, n = G.clone(G.S.nation);n.founded = Date.now() - 10 * 864e5;delete n.onb;G.commit(n);
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    const P = window.EDICTUM_PROBE.sv, calls = window.__svCalls = [];
    window.__svLater = 0;
    P.SV.api = {
      check: async () => { calls.push(['check']); return window.__svCheck ? window.__svCheck() : { ok: true, due: true, s: 's1', title: 'Edictum player survey', qs, later: window.__svLater, laterMax: 2, gift: 'c-ballot' }; },
      later: async () => { calls.push(['later']); return { ok: true, next: Date.now() + 864e5 }; },
      no: async () => { calls.push(['no']); return { ok: true }; },
      answer: async x => { calls.push(['answer', JSON.parse(JSON.stringify(x))]); return { ok: true, n: Object.keys(x.a).length }; }
    };
    localStorage.removeItem('edictum.svNext');localStorage.removeItem('edictum.svDraft');localStorage.removeItem('edictum.svSaid');
  }, QS);
  const go = async v => { await page.evaluate(v => { location.hash = '#' + v; }, v); await until(() => page.evaluate(v => window.__game.S.view === v, v)); await sleep(300); };
  /* a tick as if the page had loaded long ago and the player had been quiet a while */
  const tick = async () => {
    const T = () => page.evaluate(() => { const P = window.EDICTUM_PROBE.sv;P.SV.born = 0;P.SV.quiet = 0;P.svTick();return !!P.SV.checking; });
    if (await T()) { await until(() => page.evaluate(() => !window.EDICTUM_PROBE.sv.SV.checking), 3000);await T(); }
  };
  const state = () => page.evaluate(() => { const S = window.EDICTUM_PROBE.sv.SV;return { open: S.open, step: S.step, i: S.i, a: S.a, o: S.o, inv: !!S.inv, dlg: !!document.querySelector('#sv-dlg[open]') }; });
  return { ctx, page, errors, go, tick, state };
}
const S = (page, f, a) => page.evaluate(f, a);
const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s);return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const opt = (page, label) => page.click(`#sv-dlg label.sv-opt:has-text("${label}")`);
const nextQ = page => page.click('#sv-dlg [data-act="sv-next"]');

/* ── a desktop: the calm moment, every kind of question, a draft, the answers sent, the gift ── */
{
  const { ctx, page, errors, go, tick, state } = await open({ width: 1280, height: 900 });
  await go('nation');
  await S(page, () => { const P = window.EDICTUM_PROBE.sv;P.SV.born = Date.now();P.SV.quiet = 0;P.svTick(); });await sleep(300);
  check('not in the first minute after the page loads', !(await state()).dlg);
  await until(() => S(page, () => !!window.EDICTUM_PROBE.sv.SV.inv), 3000);
  check('but the server was asked, and a survey is waiting', await S(page, () => !!window.EDICTUM_PROBE.sv.SV.inv && window.__svCalls.filter(c => c[0] === 'check').length === 1));
  await S(page, () => { const d = document.createElement('dialog');d.id = 'other-dlg';d.textContent = 'Something else';document.body.appendChild(d);d.showModal(); });
  await tick();await sleep(200);
  check('never over another dialog', !(await state()).dlg);
  await S(page, () => document.getElementById('other-dlg').close());
  await S(page, () => { window.EDICTUM_PROBE.sv.SV.born = 0;window.EDICTUM_PROBE.sv.SV.quiet = Date.now(); window.EDICTUM_PROBE.sv.svTick(); });await sleep(200);
  check('nor while the player is busy clicking', !(await state()).dlg);
  await go('war');await tick();await sleep(200);
  check('nor on the War page', !(await state()).dlg);
  await S(page, () => { const G = window.__game;G.S.isOwner = true; });
  check('never for staff', await S(page, () => !window.EDICTUM_PROBE.sv.svMayAsk()));
  await S(page, () => { window.__game.S.isOwner = false; });
  await go('nation');await tick();await until(async () => (await state()).dlg, 3000);
  check('a calm moment on the Nation page: the survey opens', (await state()).dlg);
  const intro = await txt(page, '#sv-dlg');
  check('it says how many questions, how long, the gift and who reads the answers', /Help shape Edictum/.test(intro) && /10 short questions, about 3 minutes/.test(intro) && /Ballot box/.test(intro) && /Only the Edictum team reads them/.test(intro), intro);
  check('Start, Ask me tomorrow and No thanks', await S(page, () => ['sv-start', 'sv-later', 'sv-no'].every(a => document.querySelector(`#sv-dlg [data-act="${a}"]`))));
  check('the heading has the focus', await S(page, () => document.activeElement && document.activeElement.id === 'sv-h'));
  await page.screenshot({ path: path.join(OUT, 'survey-intro.png') });
  await page.click('#sv-dlg [data-act="sv-start"]');await sleep(150);
  check('one question a screen, with its number and a progress bar', /Question 1 of 10/.test(await txt(page, '#sv-dlg .sv-top')) && /What kind of ruler are you\?/.test(await txt(page, '#sv-h')) && !!(await page.$('#sv-dlg .sv-bar')));
  await opt(page, 'A builder');await sleep(100);
  check('a single answer, chosen by its row', (await state()).a.ruler === 'builder' && await S(page, () => document.querySelector('#sv-dlg input[value="builder"]').checked));
  await nextQ(page);
  for (const l of ['War', 'The map, land and borders', 'Research']) await opt(page, l);
  const love = await S(page, () => ({ a: window.EDICTUM_PROBE.sv.SV.a.love, off: [...document.querySelectorAll('#sv-dlg .sv-opt.off input')].length, total: document.querySelectorAll('#sv-dlg .sv-opt input').length }));
  check('up to three: the rest are greyed once three are chosen', JSON.stringify(love.a) === '["war","map","research"]' && love.off === love.total - 3, love);
  await page.screenshot({ path: path.join(OUT, 'survey-many.png') });
  await nextQ(page);
  await opt(page, 'War');await opt(page, 'Nothing feels like a chore');await sleep(100);
  check('“Nothing feels like a chore” stands alone', JSON.stringify((await state()).a.chore) === '["none"]');
  await nextQ(page);
  await opt(page, 'Something else');await sleep(100);
  check('“Something else” opens a box for words', !!(await page.$('#sv-dlg input.sv-other')));
  await page.fill('#sv-dlg input.sv-other', 'The letters from my rivals');
  await nextQ(page);
  check('the pace question', /pace/.test(await txt(page, '#sv-h')));
  await page.click('#sv-dlg [data-act="sv-skip"]');
  check('a skipped question has no answer', (await state()).a.pace === undefined && /first hear about Edictum/.test(await txt(page, '#sv-h')));
  await opt(page, 'Discord');await nextQ(page);
  await opt(page, 'Not yet');await sleep(100);
  check('after “Not yet”, the follow-up on the same screen', /worth it for you/.test(await txt(page, '#sv-dlg .sv-sub') || ''));
  await opt(page, 'Lower prices');await nextQ(page);
  await opt(page, 'Very disappointed');await nextQ(page);
  check('0 to 10, its ends labelled', await S(page, () => document.querySelectorAll('#sv-dlg .sv-pt').length === 11 && /Not at all likely.*Extremely likely/.test(document.querySelector('#sv-dlg .sv-ends').textContent)));
  await page.click('#sv-dlg label.sv-pt:has-text("9")');await sleep(100);
  check('a number chosen', (await state()).a.nps === 9);
  await nextQ(page);
  check('the last question: open words, and Send answers', /one thing you would change/.test(await txt(page, '#sv-h')) && /Send answers/.test(await txt(page, '#sv-dlg [data-act="sv-next"]')));
  await page.fill('#sv-dlg textarea.sv-text', 'Fewer popups, ironically');
  await page.click('#sv-dlg [data-act="sv-close"]');await sleep(200);
  const draft = await S(page, () => ({ st: window.EDICTUM_PROBE.sv.SV, d: JSON.parse(localStorage.getItem('edictum.svDraft') || '{}'), next: JSON.parse(localStorage.getItem('edictum.svNext') || '{}') }));
  const mine = Object.values(draft.d)[0] || {}, next = Object.values(draft.next)[0] || 0;
  check('closing it keeps the answers so far on this device, and it waits till tomorrow', !(await state()).dlg && mine.s === 's1' && mine.i === 9 && mine.a.change === 'Fewer popups, ironically' && next > Date.now() + 19 * 3600e3, { mine, next });
  await S(page, () => localStorage.removeItem('edictum.svNext'));
  await tick();await until(async () => (await state()).dlg, 3000);
  check('the next day: “Carry on”', /Carry on/.test(await txt(page, '#sv-dlg [data-act="sv-start"]')), await S(page, () => ({ b: document.querySelector('#sv-dlg [data-act="sv-start"]').textContent, st: window.EDICTUM_PROBE.sv.SV.started, a: window.EDICTUM_PROBE.sv.SV.a })));
  await page.click('#sv-dlg [data-act="sv-start"]');await sleep(150);
  check('back where they left off, the words still there', /Question 10 of 10/.test(await txt(page, '#sv-dlg .sv-top')) && await S(page, () => document.querySelector('#sv-dlg textarea.sv-text').value === 'Fewer popups, ironically'));
  await page.click('#sv-dlg [data-act="sv-back"]');await sleep(100);
  check('Back goes to the question before, its answer kept', /recommend/.test(await txt(page, '#sv-h')) && await S(page, () => document.querySelector('#sv-dlg input[value="9"]').checked));
  await nextQ(page);await nextQ(page);
  await until(async () => (await state()).step === 'thanks', 3000);
  const sent = await S(page, () => window.__svCalls.find(c => c[0] === 'answer'));
  const A = sent && sent[1];
  check('the answers sent: every one given, none skipped', !!A && A.a.ruler === 'builder' && A.a.love.length === 3 && A.a.chore[0] === 'none' && A.a.back === 'other' && A.o.back === 'The letters from my rivals'
    && !('pace' in A.a) && A.a.src === 'discord' && A.a.shop === 'no' && A.a.shopwhy[0] === 'price' && A.a.pmf === 'very' && A.a.nps === 9 && A.a.change === 'Fewer popups, ironically', A);
  check('the thanks, with the Ballot box', /Thank you/.test(await txt(page, '#sv-h')) && /Ballot box.*is yours/.test(await txt(page, '#sv-dlg')));
  await page.screenshot({ path: path.join(OUT, 'survey-thanks.png') });
  const got = await S(page, () => { const G = window.__game, n = G.S.nation, P = window.EDICTUM_PROBE.sv;return { ach: !!(n.ach && n.ach['dip-survey']), tly: n.tly && n.tly.svy, unlocked: P.unlocked(), draft: localStorage.getItem('edictum.svDraft') }; });
  check('the secret achievement Speak Your Mind, and with it the Ballot box charge and flag emblem; the draft gone', got.ach && got.unlocked && got.tly === 1 && !Object.keys(JSON.parse(got.draft || '{}')).length, got);
  const art = await S(page, () => { const P = window.EDICTUM_PROBE.sv;return { a: P.charge().length, e: P.emblem().length }; });
  check('the Ballot box is drawn, as a charge and as an emblem', art.a > 200 && art.e > 200, art);
  await page.click('#sv-dlg [data-act="sv-done"]');await sleep(200);
  check('closed; nothing left waiting', !(await state()).dlg && !(await state()).inv);

  /* the staff's note, once, to those who answered */
  await S(page, () => { const P = window.EDICTUM_PROBE.sv;P.SV.said = { x: 'Most of you found the economy hard to follow: the Budget page now explains every line.', link: '#help', t: Date.now() }; });
  await tick();await until(() => S(page, () => !!document.querySelector('#sv-said[open]')), 3000);
  check('“You said, we did”: the note in a window', /You said, we did/.test(await txt(page, '#sv-said') || '') && /explains every line/.test(await txt(page, '#sv-said') || ''));
  await page.click('#sv-said button[data-act="sv-said-x"]');await sleep(200);
  await S(page, () => { window.EDICTUM_PROBE.sv.SV.said = { x: 'again', t: JSON.parse(localStorage.getItem('edictum.svSaid')) && Object.values(JSON.parse(localStorage.getItem('edictum.svSaid')))[0] }; });
  await tick();await sleep(300);
  check('and only once', !(await S(page, () => !!document.querySelector('#sv-said[open]'))));
  check('no script errors', errors.length === 0, errors);
  await ctx.close();
}

/* ── Ask me tomorrow, twice at most; No thanks ── */
{
  const { ctx, page, errors, go, tick, state } = await open({ width: 1100, height: 800 });
  await go('nation');await tick();await until(async () => (await state()).dlg, 4000);
  await page.click('#sv-dlg [data-act="sv-later"]');await sleep(300);
  const nx = await S(page, () => Object.values(JSON.parse(localStorage.getItem('edictum.svNext') || '{}'))[0] || 0);
  check('“Ask me tomorrow”: the server told, the dialog closed, asked again a day later', !(await state()).dlg && await S(page, () => window.__svCalls.some(c => c[0] === 'later')) && nx > Date.now() + 23 * 3600e3, nx);
  await S(page, () => { localStorage.removeItem('edictum.svNext');window.__svLater = 2; });
  await tick();await until(async () => (await state()).dlg, 4000);
  check('after twice, no more “Ask me tomorrow”', !(await page.$('#sv-dlg [data-act="sv-later"]')) && !!(await page.$('#sv-dlg [data-act="sv-no"]')), await S(page, () => ({ inv: window.EDICTUM_PROBE.sv.SV.inv && window.EDICTUM_PROBE.sv.SV.inv.later, html: document.querySelector('#sv-dlg .sv-acts').textContent })));
  await page.click('#sv-dlg [data-act="sv-no"]');await sleep(300);
  const nx2 = await S(page, () => Object.values(JSON.parse(localStorage.getItem('edictum.svNext') || '{}'))[0] || 0);
  check('“No thanks”: the server told, not asked again for a week', !(await state()).dlg && await S(page, () => window.__svCalls.some(c => c[0] === 'no')) && nx2 > Date.now() + 6 * DAY, nx2);
  await S(page, () => { window.__svCheck = () => ({ ok: true, due: false, next: Date.now() + 864e5 }); localStorage.removeItem('edictum.svNext'); });
  await tick();await sleep(400);
  check('nothing waiting: nothing opens, and the next time to ask is kept', !(await state()).dlg && await S(page, () => (Object.values(JSON.parse(localStorage.getItem('edictum.svNext') || '{}'))[0] || 0) > Date.now() + 23 * 3600e3));
  check('no script errors', errors.length === 0, errors);
  await ctx.close();
}

/* ── a phone ── */
{
  const { ctx, page, errors, go, tick, state } = await open({ width: 375, height: 740 }, { phone: true });
  await go('nation');await tick();await until(async () => (await state()).dlg, 4000);
  await page.click('#sv-dlg [data-act="sv-start"]');
  await S(page, () => { window.EDICTUM_PROBE.sv.SV.i = 7;document.querySelector('#sv-dlg [data-act="sv-next"]').click(); });await sleep(200);
  const fit = await S(page, () => { const d = document.querySelector('#sv-dlg'), r = d.getBoundingClientRect(), pts = [...d.querySelectorAll('.sv-pt')].map(p => p.getBoundingClientRect());
    return { w: r.width, inView: r.left >= 0 && r.right <= innerWidth + 1, overflow: document.documentElement.scrollWidth > innerWidth + 1 || d.scrollWidth > d.clientWidth + 1, pts: pts.length, tall: pts.every(p => p.height >= 40 && p.width >= 36), q: document.querySelector('#sv-h').textContent }; });
  check('on a phone the dialog fits, and 0-10 wraps into rows of big buttons', fit.inView && !fit.overflow && fit.pts === 11 && fit.tall, fit);
  await page.screenshot({ path: path.join(OUT, 'survey-phone.png') });
  check('no script errors', errors.length === 0, errors);
  await ctx.close();
}

/* ── Admin › Player survey: counts, results, filters, the preview, the Excel download ── */
{
  const { ctx, page, errors, go } = await open({ width: 1360, height: 950 });
  const NOW = Date.now(), x = (name, reg, s) => ({ name, reg, pop: 2e7, days: 40, eng: [s, 12, 25, 7, 2], acct: 'registered' });
  const rows = [
    { uid: 'u1', t: NOW - 3 * DAY, q: ['src', 'shop'], e: 72, l: 0, no: 0, d: NOW - DAY, a: { ruler: 'builder', love: ['war', 'map'], chore: ['none'], back: 'grow', pace: 'slow', src: 'discord', shop: 'no', shopwhy: ['price'], pmf: 'very', nps: 10, change: 'More rivers & <lakes>' }, o: {}, w: {}, x: x('Tela tyhate', 'saffron', 72) },
    { uid: 'u2', t: NOW - 3 * DAY, q: ['others', 'econ'], e: 81, l: 1, no: 0, d: NOW - 2 * DAY, a: { ruler: 'diplomat', love: ['diplomacy'], back: 'other', pace: 'right', others: 'worse', econ: 2, pmf: 'somewhat', nps: 4 }, o: { back: 'My alliance chat' }, w: { others: 'Griefers took my land' }, x: x('Bearland', 'greywater', 81) },
    { uid: 'u3', t: NOW - 2 * DAY, q: ['len', 'rp'], e: 66, l: 0, no: 0, d: NOW - 3600e3, a: { ruler: 'builder', pmf: 'very', nps: 9, len: 'm15' }, o: {}, w: {}, x: x('Elarion', 'saffron', 66) },
    { uid: 'u4', t: NOW - DAY, q: ['src', 'len'], e: 58, l: 2, no: 0, d: 0 },
    { uid: 'u5', t: NOW - DAY, q: ['rp', 'econ'], e: 77, l: 0, no: NOW - 3600e3, d: 0 }];
  const D = { ok: true, at: NOW, id: SV_ID, title: 'Edictum player survey', min: 50, ageDays: 7, laterMax: 2, core: svCore(), pool: svPool(), qs: SV_QS, cfg: { on: true, share: 0.25, draw: 2, said: null, t: NOW - 5 * DAY, by: 'a' }, rows };
  await S(page, () => { window.__game.S.isOwner = true; });
  await go('admin-survey');await sleep(500);
  await S(page, d => { const P = window.EDICTUM_PROBE.sv;Object.assign(P.ASV, { d, err: '', busy: false });window.__game.render(); }, D);
  await until(() => S(page, () => /Player survey/.test(document.querySelector('.adm-main h1') ? document.querySelector('.adm-main h1').textContent : '')), 4000);
  const k = await S(page, () => [...document.querySelectorAll('.adm-kpi')].map(e => e.querySelector('b').textContent + ' ' + e.querySelector('span').textContent));
  check('the counts: invited, answered, the response rate, waiting, put off, said no', ['5 players invited', '3 answered', '60% response rate', '1 invited, not answered yet', '1 put it off (Ask me tomorrow)', '1 said no thanks'].every(s => k.includes(s)), k);
  check('the sidebar has it, under World', await S(page, () => !!document.querySelector('.adm-nav a[data-v="admin-survey"][aria-current="page"]')));
  const body = await txt(page, '.adm-main');
  check('the switch, the share and the extra questions', /Open/.test(await txt(page, '.asv-st')) && /Pause the survey/.test(body) && await S(page, () => document.querySelector('select[data-asv="share"]').value === '0.25' && document.querySelector('select[data-asv="draw"]').value === '2'));
  check('the Net Promoter Score and “very disappointed”', /Net Promoter Score \+33/.test(body) && /67% would be very disappointed/.test(body), body.match(/Net Promoter Score [^ ]+/));
  check('open answers with the nation and an Inspect link', /More rivers & <lakes>/.test(body) && /Tela tyhate/.test(body) && await S(page, () => !!document.querySelector('.asv-words [data-act="admin-inspect"][data-id="u1"]')));
  check('a follow-up and the why answers', /A follow-up\./.test(body) && /Griefers took my land/.test(await S(page, () => [...document.querySelectorAll('.asv-more')].map(d => d.textContent).join(' '))));
  await page.click('[data-act="asv-f"][data-v="75–100"]');await sleep(200);
  check('narrowed to scores 75–100: one answer shown', /1 of 3 answers shown/.test(await txt(page, '.adm-main')));
  await page.selectOption('select[data-asv="reg"]', 'saffron');await sleep(200);
  check('and by region', /0 of 3 answers shown/.test(await txt(page, '.adm-main')));
  await page.click('[data-act="asv-f"][data-v=""]');await page.selectOption('select[data-asv="ruler"]', 'builder');await page.selectOption('select[data-asv="reg"]', '');await sleep(200);
  check('and by ruler type', /2 of 3 answers shown/.test(await txt(page, '.adm-main')));
  await page.screenshot({ path: path.join(OUT, 'survey-admin.png'), fullPage: false });
  await page.click('[data-act="asv-preview"]');await sleep(300);
  check('the preview: the whole survey as players see it, all sixteen', /Preview/.test(await txt(page, '#sv-dlg .eyebrow')) && /16 short questions/.test(await txt(page, '#sv-dlg')));
  await page.click('#sv-dlg [data-act="sv-start"]');await page.click('#sv-dlg [data-act="sv-close"]');await sleep(200);
  check('a preview sends nothing and keeps nothing', await S(page, () => !window.__svCalls.some(c => c[0] === 'answer') && !localStorage.getItem('edictum.svDraft')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="asv-xlsx"]')]);
  const file = path.join(OUT, 'survey-results.xlsx');await dl.saveAs(file);
  const buf = fs.readFileSync(file), parts = {};let i = 0, crcOk = true;
  while (buf.readUInt32LE(i) === 0x04034b50) { const crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28), name = buf.slice(i + 30, i + 30 + nl).toString(), data = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + size);
    if (zlib.crc32(data) !== crc) crcOk = false;parts[name] = data.toString();i += 30 + nl + xl + size; }
  check('the download is an .xlsx workbook: its parts, their checksums, six sheets', dl.suggestedFilename().endsWith('.xlsx') && crcOk && Object.keys(parts).length === 11 && (parts['xl/workbook.xml'] || '').match(/<sheet /g).length === 6, { name: dl.suggestedFilename(), parts: Object.keys(parts) });
  const s1 = parts['xl/worksheets/sheet1.xml'] || '';
  check('the answers sheet: a row for each of the three, the words escaped', (s1.match(/<row /g) || []).length === 4 && /More rivers &amp; &lt;lakes&gt;/.test(s1) && /Tela tyhate/.test(s1), (s1.match(/<row /g) || []).length);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="asv-csv"]')]);
  const cf = path.join(OUT, 'survey-answers.csv');await csv.saveAs(cf);const ct = fs.readFileSync(cf, 'utf8');
  check('and the answers as CSV', ct.split('\r\n').length === 4 && /Bearland/.test(ct), ct.slice(0, 120));
  check('no script errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();server.close();
console.log(failed ? `${failed} check(s) failed` : 'all survey checks passed');
process.exit(failed ? 1 : 0);
