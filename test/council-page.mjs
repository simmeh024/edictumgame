// The World Assembly Council's page (game/edictum.html, "the World Assembly Council"), drawn from a Council the test hands
// it (EDICTUM_PROBE.wac): the chamber with the chair and its address, the election with a ballot and statements, the
// agenda, the motions (an open edict idea, a resolution and an idea the team accepted), the records; then the World page's
// address and Seat of the Council, the Region page's banner and the Dispatch's stories. On a desktop (light) and a phone
// (dark). Screenshots go to test/out/.
//   python3 build.py
//   node test/council-page.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators).
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

/* a Council of eight seats: this nation's region (whatever the page opened in) holds the chair */
function council(reg, now) {
  const regs = [reg, 'frostmarch', 'gilded', 'saffron', 'ironsteppe', 'wildwood', 'mistral', 'greywater'].filter((r, i, a) => a.indexOf(r) === i).slice(0, 8);
  const names = ['Selenia', 'The Very Long Republic of Aldmere and the Northern Islands', 'Brimvik', 'Ostrava', 'Kelmar', 'Pell', 'Tirra', 'Quorn'];
  const seats = regs.map((r, i) => ({ reg: r, id: i ? 'u' + i : 'me', nm: names[i], t: now - (i + 1) * 86400000, k: 3 + i, fl: null }));
  const DAY = 86400000;
  return {
    now, win: { m: '2026-12', open: now - DAY, close: now + 4 * DAY, on: true }, first: '2026-12', me: { reg, seat: true, chair: true, staff: true },
    seats, ch: { reg, id: 'me', nm: 'Selenia', t: now - 3 * DAY }, term: '2026-12', rank: [reg, 'gilded'],
    vote: { m: '2026-12', on: true, mine: null, cast: 3, st: { frostmarch: { x: 'Short sittings, clear minutes, every motion heard.', nm: names[1], t: now }, gilded: { x: 'A festival in every capital!', nm: 'Brimvik', t: now } } },
    msg: { x: 'Welcome, Delegates. Let us keep the rivers clean and the sittings short.', id: 'me', nm: 'Selenia', reg, t: now - 3600000 },
    hist: [{ m: '2026-11', t: now - 20 * DAY, rank: [reg, 'gilded', 'saffron'], n: { [reg]: 4, gilded: 2, saffron: 1 }, b: { frostmarch: reg, gilded: reg, saffron: reg, ironsteppe: reg, wildwood: 'gilded', mistral: 'gilded', greywater: 'saffron' }, c: 7 }],
    chairs: [{ m: '2026-12', reg, h: [{ id: 'me', nm: 'Selenia', reg, t: now - 3 * DAY }] }, { m: '2026-11', reg: 'gilded', h: [{ id: 'u2', nm: 'Brimvik', reg: 'gilded', t: now - 30 * DAY }, { id: 'u9', nm: 'Fennick', reg: 'gilded', t: now - 25 * DAY }] }],
    sh: [{ t: now - 2 * DAY, reg: 'mistral', id: 'u6', nm: 'Tirra', p: 'u8', pn: 'Halden' }, { t: now - 4 * DAY, reg: 'hollow', id: '', nm: '', p: 'u7', pn: 'Orrin' }],
    res: [{ id: 'R1', ti: 'On the Matter of Rivers', x: 'The Council asks every region to keep its rivers clean and to name them kindly.', by: 'u2', bn: 'Brimvik', reg: 'gilded', t: now - 5 * DAY, y: 5, n: 1 }],
    ideas: [{ id: 'I2', ti: 'The Lost Lighthouse Keeper', by: 'me', bn: 'Selenia', reg, t: now - 6 * DAY, y: 5, n: 0, st: 'accepted', tt: now - DAY }],
    motions: [
      { id: 'M1', k: 'edict', ti: 'A Tax on Umbrellas', cat: 'econ', x: 'It has rained for forty days, and umbrella makers are the richest people in the land. The Treasury sees an opportunity.', o: [{ t: 'Tax every umbrella sold, and spend it on drains.', fx: 'more money, less happiness' }, { t: 'Leave the umbrellas alone; it will stop raining.', fx: '' }, { t: 'Hand out free umbrellas, paid for by the state.', fx: 'happiness up, money down' }], by: 'u1', bn: names[1], reg: 'frostmarch', t: now - DAY, u: now + 2 * DAY, v: { frostmarch: { v: 1 }, gilded: { v: -1 } }, st: 'open' },
      { id: 'M2', k: 'res', ti: 'On the Matter of Rivers', x: 'The Council asks every region to keep its rivers clean and to name them kindly.', o: [], by: 'u2', bn: 'Brimvik', reg: 'gilded', t: now - 7 * DAY, u: now - 4 * DAY, v: { gilded: { v: 1 }, [reg]: { v: 1 }, saffron: { v: 1 }, frostmarch: { v: 1 }, wildwood: { v: 1 }, mistral: { v: -1 } }, st: 'passed', f: now - 5 * DAY },
      { id: 'I2', k: 'edict', ti: 'The Lost Lighthouse Keeper', cat: 'culture', x: 'A lighthouse keeper has not been seen for a week, and the lamp still turns every night.', o: [{ t: 'Send the coastguard to look for him.', fx: '' }, { t: 'Leave the lamp alone.', fx: '' }], by: 'me', bn: 'Selenia', reg, t: now - 8 * DAY, u: now - 5 * DAY, v: { [reg]: { v: 1 }, gilded: { v: 1 }, saffron: { v: 1 }, frostmarch: { v: 1 }, wildwood: { v: 1 } }, st: 'passed', f: now - 6 * DAY, ad: { st: 'accepted', note: 'A lovely one. We will write it for the January edicts.' } }],
    agenda: [
      { id: 'A1', ti: 'Shared fishing grounds in the northern seas', x: 'Should the northern seas be shared between our regions? Frostmarch proposes a common season.', a: 'u1', an: names[1], ar: 'frostmarch', t: now - 2 * DAY, la: now - 3600000, pin: 1, cl: 0,
        r: [1, 2, 3, 4, 5].map(i => ({ k: 'k' + i, a: 'u' + i, an: names[i], ar: regs[i], x: i === 3 ? 'Only on Tuesdays, and never during the herring festival, which is sacred.' : 'Agreed, with conditions.', t: now - i * 3600000 })), rx: { u2: 'up', u3: 'up', u4: 'think' } },
      { id: 'A2', ti: 'The colour of the chamber curtains', x: 'Beige is not a colour.', a: 'u4', an: 'Kelmar', ar: 'ironsteppe', t: now - 3 * DAY, la: now - 2 * DAY, pin: 0, cl: 1, r: [], rx: {} }]
  };
}

async function run(theme, viewport, tag) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Selenia');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view && window.EDICTUM_PROBE.wac);
  const R = await page.evaluate(() => window.EDICTUM_PROBE.wac.reg());
  const now = Date.now(), st = council(R, now);
  await page.evaluate(([st]) => { const W = window.EDICTUM_PROBE.wac; W.set(st); W.pubSet({ seats: Object.fromEntries(st.seats.map(x => [x.reg, { id: x.id, nm: x.nm, t: x.t, k: x.k }])), ch: st.ch, term: st.term, rank: st.rank, msg: st.msg, hist: st.hist, chairs: st.chairs, sh: st.sh, res: st.res, ideas: st.ideas }); }, [st]);
  const go = async (v, sel) => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; S.notifOpen = false; location.hash = '#' + v; window.__game.render(); }, v); return until(() => page.$(sel)); };
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  check(`${tag}: the Council page opens on the chamber`, !!await go('council', '.wac-chair'));
  check(`${tag}: the chair and its address`, await page.evaluate(() => /Selenia/.test(document.querySelector('.wac-chair-n').textContent) && /keep the rivers clean/.test(document.querySelector('.wac-chair .wac-msg').textContent)));
  check(`${tag}: the chair may change the address`, !!await page.$('#wac-addr'));
  check(`${tag}: a seat for every region in the chamber, eight filled, the chair ringed`, await page.evaluate(() => document.querySelectorAll('.wac-seat').length >= 16 && document.querySelectorAll('.wac-seat:not(.empty)').length === 8 && document.querySelectorAll('.wac-seat.chair').length === 1));
  check(`${tag}: the Delegates listed, the chair marked`, await page.evaluate(() => document.querySelectorAll('.wac-del').length === 8 && document.querySelectorAll('.wac-del.chair').length === 1));
  check(`${tag}: no sideways scrolling on the chamber`, !await wide(), { w: await page.evaluate(() => document.documentElement.scrollWidth) });
  await page.screenshot({ path: path.join(OUT, `council-chamber-${tag}.png`), fullPage: true });

  await page.click('#wac-tab-vote');
  check(`${tag}: the election: the vote is open, candidates with their lines, not our own region`, !!await until(() => page.evaluate(R => !!document.querySelector('.wac-status.on') && document.querySelectorAll('.wac-cand').length === 7 && !document.querySelector(`input[name="wac-v"][value="${R}"]`) && /festival in every capital/.test(document.querySelector('.wac-cands').textContent), R)));
  check(`${tag}: the cast button waits for a choice`, await page.evaluate(() => document.querySelector('[data-act="wac-vote"]:not([data-v])').disabled));
  await page.click('.wac-cand input[value="gilded"]');
  check(`${tag}: choosing a region enables the ballot`, await page.evaluate(() => !document.querySelector('[data-act="wac-vote"]:not([data-v])').disabled));
  check(`${tag}: last month's count is published with every ballot`, await page.evaluate(() => document.querySelectorAll('.wac-hist .wac-bal li').length === 7));
  check(`${tag}: no sideways scrolling on the election`, !await wide());
  await page.screenshot({ path: path.join(OUT, `council-election-${tag}.png`), fullPage: true });

  await page.click('#wac-tab-agenda');
  check(`${tag}: the agenda: the pinned matter first, replies folded, the closed one shut`, !!await until(() => page.evaluate(() => { const a = [...document.querySelectorAll('.wac-item')]; return a.length === 2 && a[0].classList.contains('pin') && a[1].classList.contains('shut') && !!a[0].querySelector('.wac-more') && !!a[0].querySelector('.wac-reply') && !a[1].querySelector('.wac-reply'); })));
  check(`${tag}: reactions counted`, await page.evaluate(() => /👍 2/.test(document.querySelector('.wac-item').textContent)));
  check(`${tag}: no sideways scrolling on the agenda`, !await wide());
  await page.screenshot({ path: path.join(OUT, `council-agenda-${tag}.png`), fullPage: true });

  await page.click('#wac-tab-motions');
  check(`${tag}: the motions: one open with vote buttons, two decided`, !!await until(() => page.evaluate(() => document.querySelectorAll('.wac-mo.open').length === 1 && document.querySelectorAll('.wac-mo.open [data-act="wac-mv"]').length === 3 && document.querySelectorAll('.wac-mo:not(.open)').length === 2)));
  check(`${tag}: the accepted idea says what the team will do`, await page.evaluate(() => /Accepted: the team will write it/.test(document.querySelector('.wac-ad.accepted').textContent)));
  await page.click('[data-act="wac-mk"][data-v="edict"]');
  check(`${tag}: the edict form: title, about, situation, two options`, !!await until(() => page.evaluate(() => !!document.querySelector('#wac-mo-cat') && document.querySelectorAll('.wac-opt').length === 2)));
  await page.fill('#wac-mo-ti', 'The Drowned Bell'); await page.fill('#wac-o0', 'Ring it again.');
  await page.click('[data-act="wac-opt"][data-v="1"]');
  check(`${tag}: another option keeps what was written`, !!await until(() => page.evaluate(() => document.querySelectorAll('.wac-opt').length === 3 && document.querySelector('#wac-mo-ti').value === 'The Drowned Bell' && document.querySelector('#wac-o0').value === 'Ring it again.')));
  check(`${tag}: no sideways scrolling on the motions`, !await wide());
  await page.screenshot({ path: path.join(OUT, `council-motions-${tag}.png`), fullPage: true });

  await page.click('#wac-tab-records');
  check(`${tag}: the records: the roll of chairs, the resolutions, the seats`, !!await until(() => page.evaluate(() => document.querySelectorAll('.wac-roll tbody tr').length === 2 && /On the Matter of Rivers/.test(document.querySelector('.wac-pane').textContent) && document.querySelectorAll('.wac-sh li').length === 2)));
  await page.screenshot({ path: path.join(OUT, `council-records-${tag}.png`), fullPage: true });

  check(`${tag}: the World page carries the chair's address`, !!await go('world', '.wac-world') && await page.evaluate(() => /keep the rivers clean/.test(document.querySelector('.wac-world').textContent)));
  check(`${tag}: the chair's region is the Seat of the Council`, !!await until(() => page.$('.wac-wr')));
  await page.screenshot({ path: path.join(OUT, `council-world-${tag}.png`) });
  check(`${tag}: the Region page of the chair's region has the banner`, !!await go('region', '.wac-banner'));
  const obs = await page.evaluate(() => { const n = Object.assign({}, window.__game.S.nation, { wac: { s: Date.UTC(2026, 11, 2), r: 'frostmarch', c: ['2026-12', '2027-01', '2027-02'] } }); return window.EDICTUM_PROBE.wac.obs(n); });
  check(`${tag}: the passport's Observations page records the seat and the terms in the chair`, /Delegate to the World Assembly Council for Frostmarch/.test(obs) && /Chair of the Council for 3 terms, the last February 2027/.test(obs), obs.slice(-600));
  check(`${tag}: no page errors`, errors.length === 0, errors);
  await ctx.close();
}

try {
  await run('light', { width: 1280, height: 900 }, 'desktop');
  await run('dark', { width: 390, height: 844 }, 'phone');
} finally { await browser.close(); server.close(); }
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
