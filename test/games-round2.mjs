// The Games, round two, in the page: the host's opening ceremony heads the Games page, training is paid for in materials
// and adds to the score (and to "Why this score"), tactics for the day, a boycott and its way back (goodwill docked once),
// the host's swap and mascot on a bid, the week after (the host's ceremony, its swapped event, the day revealed in the
// medal ceremony), the region chat's Games lines (results kept back until the ceremony is watched) and the Dispatch.
//   python3 build.py
//   node test/games-round2.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators), and drives the nation through the
// test probe, with the clock set to a week from GAMES_V2 on.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))), PUB = path.join(ROOT, 'public');
if (!fs.existsSync(path.join(PUB, 'index.html'))) throw new Error('build the site first: python3 build.py');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  let f = path.join(PUB, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(PUB)) { r.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404).end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const html = fs.readFileSync(path.join(ROOT, 'game', 'edictum.html'), 'utf8');
const V2 = +html.match(/const GAMES_V2=(\d+)/)[1], WEEK = 7 * 864e5, EPOCH = Date.UTC(2026, 0, 5);
const E0 = V2 + 1, T0 = EPOCH + E0 * WEEK + 2 * 864e5 + 3 * 3600e3;

let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const errs = [];
const setup = async (label, vp) => {
  const page = await (await browser.newContext(vp)).newPage();
  page.on('pageerror', e => errs.push(label + ': ' + e.message));
  await page.clock.setFixedTime(T0);
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Podiumland'); await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation);
  await page.evaluate(() => {
    const G = window.__game, M = G.GM2(), n = M.clone(G.S.nation), now = Date.now();
    for (const k of Object.keys(n.s)) n.s[k] = Math.min(100, Math.max(n.s[k], 70)); n.s.corrupt = 10;
    n.pop = 30; n.popAt = now;
    const cap = M.stockCap(n); n.stock = { food: cap, timber: cap, iron: cap, oil: 0, goods: cap }; n.stockAt = now; n._stockSet = true;
    M.commit(n); G.S.view = 'games'; G.render();
  });
  return page;
};
const game = (page, f, a) => page.evaluate(f, a);

/* ── desktop: the whole round ── */
{
  const page = await setup('desktop', { viewport: { width: 1280, height: 900 } });
  const open = await game(page, () => { const o = document.querySelector('.gm-open'); return o ? { h: o.querySelector('h2').textContent, flag: !!o.querySelector('.gm-fl svg'), masc: !!o.querySelector('.gm-masc svg[role="img"]'), cap: o.querySelector('figcaption b').textContent, first: !!document.querySelector('#main .gm-open + .games-now') } : null; });
  ok(open && /open in/.test(open.h) && open.flag && open.masc && open.first, `the opening ceremony heads the page: "${open && open.h}", flag and mascot (${open && open.cap})`);

  /* training: pay, score, Why this score, three sessions at most */
  const ev0 = await game(page, () => document.querySelector('#main [data-act="g-train"]').dataset.ev);
  const before = await game(page, ev => { const G = window.__game, M = G.GM2(), e = M.edOf(Date.now()), en = M.entryOf(G.S.nation, e); return { sc: en ? en.sc[ev] : null, st: M.stockNow(G.S.nation, Date.now()), cost: M.gmTrCost(ev, 0) }; }, ev0);
  await page.click(`#main [data-act="g-train"][data-ev="${ev0}"]`);
  const after1 = await game(page, ev => { const G = window.__game, M = G.GM2(), e = M.edOf(Date.now()), en = M.entryOf(G.S.nation, e); return { sc: en.sc[ev], tr: en.tr && en.tr[ev], st: M.stockNow(G.S.nation, Date.now()), chip: [...document.querySelectorAll('#main .gev .chip')].map(c => c.textContent) }; }, ev0);
  const paid = Object.keys(before.cost).every(r => Math.abs((before.st[r] - after1.st[r]) - before.cost[r]) < 1.5);
  ok(after1.tr === 1 && paid, `a session on ${ev0} is booked and paid for (${JSON.stringify(before.cost)})`);
  ok(before.sc == null || Math.abs(after1.sc - before.sc - 3 * (1.0 + 0)) < 0.35 || Math.abs(after1.sc - before.sc - 3.3) < 0.35, `it adds ${(after1.sc - (before.sc || 0)).toFixed(1)} points to the entry`);
  ok(after1.chip.includes('Trained ×1'), 'the event shows "Trained ×1"');
  await page.click(`#main [data-act="g-train"][data-ev="${ev0}"]`);
  const ev1 = await game(page, ev => [...document.querySelectorAll('#main [data-act="g-train"]')].map(b => b.dataset.ev).find(k => k !== ev), ev0);
  await page.click(`#main [data-act="g-train"][data-ev="${ev1}"]`);
  const full = await game(page, () => { const G = window.__game, M = G.GM2(), e = M.edOf(Date.now()), en = M.entryOf(G.S.nation, e); return { tr: en.tr, btns: document.querySelectorAll('#main [data-act="g-train"]').length }; });
  ok(full.btns === 0 && Object.values(full.tr).reduce((a, b) => a + b, 0) === 3, `after three sessions (${JSON.stringify(full.tr)}) no more can be booked this week`);
  const gap = await game(page, () => { const G = window.__game, M = G.GM2(), n = G.S.nation, id = M.myId(), e = M.edOf(Date.now()), en = M.entryOf(n, e), host = M.gamesHost(e).id;
    return Math.max(...M.edEvents(e).map(ev => { const W = M.gevWhy(n, id, e, ev, en.f || null, host, en.tr); return Math.abs(W.total - Math.max(0, en.sc[ev] + (host === id ? 8 : 0) + M.formOf(id, e, ev))); })); });
  ok(gap < 0.06, `"Why this score" still adds up with training (largest gap ${gap.toFixed(3)})`);

  /* tactics */
  await page.click(`#main [data-act="g-tac"][data-ev="${ev0}"][data-t="b"]`);
  const tac = await game(page, ev => { const G = window.__game, M = G.GM2(), en = M.entryOf(G.S.nation, M.edOf(Date.now())); return { m: en.m && en.m[ev], pressed: document.querySelector(`#main [data-act="g-tac"][data-ev="${ev}"][data-t="b"]`).getAttribute('aria-pressed'), focus: document.activeElement && document.activeElement.dataset.t }; }, ev0);
  ok(tac.m === 'b' && tac.pressed === 'true' && tac.focus === 'b', 'going for broke is kept, shown pressed and keeps the focus');
  await page.click(`#main [data-act="g-tac"][data-ev="${ev1}"][data-t="s"]`);
  await page.click(`#main [data-act="g-tac"][data-ev="${ev1}"][data-t=""]`);
  ok(await game(page, ev => { const G = window.__game, M = G.GM2(), en = M.entryOf(G.S.nation, M.edOf(Date.now())); return !(en.m && en.m[ev]); }, ev1), 'steady again leaves no tactic stored');
  ok(await game(page, () => [...document.querySelectorAll('#main .gw-note')].some(li => /Still to come/.test(li.textContent))), '"Why this score" says the day itself is still to come');

  /* a boycott, and back */
  const hostId = await game(page, () => { const M = window.__game.GM2(); return M.gamesHost(M.edOf(Date.now())).id; });
  const gw0 = await game(page, h => (window.__game.S.nation.gw || {})[h] || 0, hostId);
  await page.click('#main [data-act="g-boy-ask"]');
  ok(await game(page, () => !!document.querySelector('#main .gm-boy [data-act="g-boy"]') && document.activeElement && document.activeElement.dataset.act === 'g-boy'), 'boycotting asks first, with the focus on the button');
  await page.click('#main [data-act="g-boy"]');
  const boy = await game(page, h => { const G = window.__game, M = G.GM2(), now = Date.now(), e = M.edOf(now), en = M.entryOf(G.S.nation, e), R = M.gamesResults(e);
    const L = M.gmChatLines(now).filter(m => m.gk === 'boy'), li = L.length ? M.gmChatLine(L[0]) : '';
    return { bo: en.bo, gw: (G.S.nation.gw || {})[h] || 0, home: /Staying home/.test(document.querySelector('#main .games-now').textContent), inEv: R.evs.some(ev => R.res[ev].some(r => r.p.id === M.myId())), listed: (R.boy || []).some(b => b.id === M.myId()), line: li.replace(/<[^>]+>/g, '') }; }, hostId);
  ok(boy.bo === 1 && boy.home && !boy.inEv && boy.listed, 'the team stays home: in no event, listed as staying away');
  ok(boy.gw === gw0 - 5 || boy.gw === -40, `the computer host thinks less of us (${gw0} → ${boy.gw})`);
  ok(/is boycotting/.test(boy.line), `the region chat says so: "${boy.line.trim().slice(0, 90)}"`);
  await page.click('#main [data-act="g-unboy"]');
  await page.click('#main [data-act="g-boy-ask"]'); await page.click('#main [data-act="g-boy"]'); await page.click('#main [data-act="g-unboy"]');
  const back = await game(page, h => { const G = window.__game, M = G.GM2(), en = M.entryOf(G.S.nation, M.edOf(Date.now())); return { bo: en.bo, gw: (G.S.nation.gw || {})[h] || 0, tr: en.tr, m: en.m }; }, hostId);
  ok(!back.bo && back.gw === boy.gw, 'back in, and a second boycott docks no more goodwill');
  ok(back.tr && back.m && back.m[ev0] === 'b', 'training and tactics survive the boycott and the way back');

  /* a bid, with a swap and a mascot */
  await page.click('#main [data-act="g-bid"]');
  const draw = await game(page, () => { const M = window.__game.GM2(), e = M.edOf(Date.now()) + 1, d = M.edDrawn(e); return { d, sel: [...document.querySelectorAll('#gm-sw-o option')].map(o => o.value).filter(Boolean), ins: [...document.querySelectorAll('#gm-sw-i option')].map(o => o.value).filter(Boolean) }; });
  ok(draw.sel.length === 4 && draw.sel.every(k => draw.d.includes(k)) && draw.ins.every(k => !draw.d.includes(k)), 'the swap offers the four drawn events out, and only undrawn ones in');
  await page.selectOption('#gm-sw-o', draw.sel[1]); await page.selectOption('#gm-sw-i', draw.ins[0]);
  await page.click('#main [data-act="g-swap"]');
  await page.selectOption('#main [data-gm="ms"]', 'sun'); await page.selectOption('#main [data-gm="mn"]', 'Medley');
  const bid = await game(page, () => { const G = window.__game, M = G.GM2(), b = M.c3MyBid(G.S.nation, M.edOf(Date.now()) + 1); return { sw: b.sw, ms: b.ms, mn: b.mn, note: (document.querySelector('#main .gm-bsw') || {}).textContent || '', focus: document.activeElement && document.activeElement.dataset.gm }; });
  ok(bid.sw === draw.sel[1] + '>' + draw.ins[0] && /would swap/.test(bid.note), `the bid asks for the swap (${bid.sw}) and the bids list shows it`);
  ok(bid.ms === 'sun' && bid.mn === 'Medley' && bid.focus === 'mn', 'the mascot is chosen from the lists and the list keeps the focus');

  /* the week after: hosting, the swap, the opening, the day revealed */
  await page.clock.setFixedTime(EPOCH + (E0 + 1) * WEEK + 3600e3);
  await game(page, () => { const G = window.__game, M = G.GM2(); M.commit(M.clone(G.S.nation)); G.S.view = 'games'; G.render(); });
  const wk = await game(page, sw => { const G = window.__game, M = G.GM2(), e = M.edOf(Date.now()), h = M.gamesHost(e), o = document.querySelector('.gm-open');
    return { host: h.id === M.myId(), evs: M.edEvents(e), out: sw.split('>')[0], inn: sw.split('>')[1], open: o && o.querySelector('figcaption b').textContent, pick: !!document.querySelector('.gm-open .gm-host [data-gm="ms"]'),
      swapNote: /swapped the/.test(document.querySelector('#main .games-now').textContent), chat: M.gmChatLines(Date.now()).map(m => m.gk) }; }, bid.sw);
  ok(wk.host, 'the only bid wins: we host');
  ok(wk.evs.includes(wk.inn) && !wk.evs.includes(wk.out) && wk.swapNote, `the swap holds the ${wk.inn} in place of the ${wk.out}, and the page says so`);
  ok(wk.open === 'Medley the Sun' && wk.pick, `our ceremony shows ${wk.open}, and the host can still change it there`);
  ok(wk.chat.includes('open') && wk.chat.includes('res'), `the region chat has this week's opening and last week's results (${wk.chat.join(', ')})`);
  const res0 = await game(page, () => { const M = window.__game.GM2(), L = M.gmChatLines(Date.now()).find(m => m.gk === 'res'); return M.gmChatLine(L).replace(/<[^>]+>/g, ''); });
  ok(/are in/.test(res0) && !/Gold medals/.test(res0), 'before the ceremony the results line gives nothing away');
  await page.click('#main [data-act="g-cer"]');
  const cer = await game(page, ev => { const M = window.__game.GM2(), e = M.edOf(Date.now()) - 1, R = M.gamesResults(e), me = M.myId(), rows = [...document.querySelectorAll('#g-cer .gc-day li')];
    const mine = R.evs.map(k => (R.res[k].find(r => r.p.id === me) || {}).d);
    return { n: rows.length, broke: rows.some(li => /Go for broke/.test(li.textContent)), ds: mine, shown: rows.map(li => li.querySelector('.num').textContent) }; }, ev0);
  ok(cer.n === 5 && cer.broke, `the medal ceremony reveals the day for each event (${cer.shown.join(' ')})`);
  ok(cer.ds.every(d => typeof d === 'number') && cer.ds.some(d => d !== 0), 'and the results hold those rolls');
  await page.click('[data-act="g-cer-close"]');
  const res1 = await game(page, () => { const M = window.__game.GM2(), L = M.gmChatLines(Date.now()).find(m => m.gk === 'res'); return M.gmChatLine(L).replace(/<[^>]+>/g, ''); });
  ok(/Gold medals/.test(res1), 'once watched, the results line names the gold medallists');
  const dsp = await game(page, () => { const M = window.__game.GM2(), now = Date.now(), e = M.edOf(now), P = M.dspBuild(M.dspNoOf(M.edStart(e)), now), ks = [];
    for (const v of Object.values(P)) if (Array.isArray(v)) for (const s of v) if (s && typeof s.k === 'string') ks.push(s.k);
    const P2 = M.dspBuild(M.dspNoOf(M.edStart(e - 1) + 2 * 864e5), now), ks2 = []; for (const v of Object.values(P2)) if (Array.isArray(v)) for (const s of v) if (s && typeof s.k === 'string') ks2.push(s.k);
    return { open: ks.some(k => k === 'go:' + e), boy: ks2.some(k => /^gb:/.test(k)), json: JSON.stringify(P).length }; });
  ok(dsp.open, "the Dispatch reports this week's opening ceremony");
  ok(!dsp.boy, 'a boycott called off leaves no Dispatch story');
}

/* ── phone: the page fits ── */
{
  const page = await setup('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.click('#main [data-act="g-bid"]').catch(() => {});
  const fit = await game(page, () => ({ w: document.documentElement.scrollWidth, v: window.innerWidth, open: !!document.querySelector('.gm-open'), tools: document.querySelectorAll('#main .gev-x').length, wide: [...document.querySelectorAll('#main .gm-open, #main .gev-x, #main .gm-swap, #main .gm-pick')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length }));
  ok(fit.open && fit.tools === 5 && fit.w <= fit.v && !fit.wide, `on a phone the banner, the five events' tools, the swap and the mascot fit (${fit.w}px of ${fit.v})`);
}
ok(!errs.length, 'no errors in the page' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
