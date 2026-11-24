// Research edicts in the game (game/edictum.html, "research edicts (23 November 2026)"): an option says what it does to
// research; ruled, the credits a day, a study under way, the studies begun next and the prices change as it said, the
// result says so and the Research page lists the edicts at work; a law does it for as long as it stands; a gamble does
// its own or its loss's; every one of the sixty edicts' 180 options can be ruled without a page error. On a desktop
// (light) and a phone (dark). Screenshots go to test/out/.
//   python3 build.py
//   node test/research-edicts.mjs
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

/* a nation with its laboratory open on one of its hexes, 500 credits, Trade to Tier IV and a study of Tier V under
   way (its two hours, begun half an hour ago) */
async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Quillon');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { window.__game.rs = window.EDICTUM_PROBE.rs; window.__game.rse = window.EDICTUM_PROBE.rse; });
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  await edit((n, now, G) => {
    const r = G.rs, sites = r.rsLabSites(n), o = [0, 1, 2].find(k => sites[k] >= 0), b = r.rsBits(r.RS_EMPTY || '');
    for (let t = 1; t <= 4; t++) for (let s = 0; s < 5; s++) r.rsPut(b, (t - 1) * 5 + s);
    n.ws.e = 70; n.inbox = [];
    n.nrp = { v: 1, a: now - 5 * 864e5, o, c: sites[o], rg: n.reg, nm: 'Quillon Laboratory', dn: 'Dr. Ada Penhallow-Strand', st: 5, i: now - 864e5, ra: now - 1000, re: 500, rs: 0, l: 0, xs: 0, k: r.rsEnc(b), q: [[21, now - 1800e3, now + 5400e3, 18, 0, 1]], ap: [], gr: 'f' };
  });
  const go = async v => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; location.hash = '#' + v; window.__game.render(); }, v); await until(() => page.evaluate(v => window.__game.S.view === v.split('/')[0], v)); await sleep(250); };
  /* put an edict on the desk, open it, and give back what its options say about research */
  const open = async id => { await edit((n, now, G, id) => { n.inbox = [{ id, at: now }]; }, id); await go('issues'); await page.evaluate(id => { const S = window.__game.S; S.openIssue = id; window.__game.render(); }, id); await until(() => page.$(`[data-act="answer"][data-id="${id}"]`)); return page.evaluate(() => [...document.querySelectorAll('.opt')].map(o => (o.querySelector('.opt-rse') || {}).textContent || '')); };
  /* rule it as the desk does, and give back the research notes of its result */
  const rule = (id, o) => page.evaluate(([id, o]) => { const G = window.__game; if (!G.S.nation.inbox.some(x => x.id === id)) { const n = G.clone(G.S.nation); n.inbox.push({ id, at: Date.now() }); G.commit(n); } const at = Date.now(); G.answer(id, o); const r = G.S.result; return { at, notes: r && r.id === id ? (r.geo || []).filter(x => x[0] === 'Research').map(x => x[1]) : null, gm: r && r.gm ? r.gm.ok : null }; }, [id, o]);
  const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.S.nation.nrp)));
  return { ctx, page, errors, edit, go, open, rule, P };
}

try {
  for (const [theme, vp, tag] of [['light', { width: 1280, height: 900 }, 'desktop'], ['dark', { width: 390, height: 844 }, 'phone']]) {
    const t = await start(theme, vp), { page } = t, phone = vp.width < 600;
    check(`${tag}: the laboratory is open and at work`, await page.evaluate(() => window.__game.rs.rsActive(window.__game.S.nation)));

    /* 1. an option says what it does; ruled, the credits a day rise by its share for its days */
    const lines = await t.open('rsv-night-shift');
    check(`${tag}: each option says what it does to research`, /Research Credits \+20% for 3 days/.test(lines[0]) && /Research Credits \+10% for 3 days/.test(lines[1]) && /Research Credits −10% for 2 days/.test(lines[2]), lines);
    if (!phone) await page.screenshot({ path: OUT + '/research-edicts-options.png' });
    else { const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); check('phone: the edict with its research lines fits', w.sw <= w.cw + 1, w); await page.screenshot({ path: OUT + '/research-edicts-options-phone.png' }); }
    const rate0 = await page.evaluate(() => { const G = window.__game; return G.rse.rsRateParts(G.S.nation, Date.now()); });
    const r1 = await t.rule('rsv-night-shift', 0), p1 = await t.P();
    const rate1 = await page.evaluate(() => { const G = window.__game; return G.rse.rsRateParts(G.S.nation, Date.now()); });
    check(`${tag}: the boost is recorded from the ruling for three days`, p1.ed && p1.ed.length === 1 && p1.ed[0].k === 'c' && p1.ed[0].v === 0.2 && Math.abs(p1.ed[0].u - p1.ed[0].a - 3 * 864e5) < 1, p1.ed);
    check(`${tag}: the credits a day are 20% of the base higher`, Math.abs(rate1.v - rate0.v - rate0.base * 0.2) < 0.02, { before: rate0.v, after: rate1.v, base: rate0.base });
    check(`${tag}: the result says so`, (r1.notes || []).some(x => /^Research Credits \+20% until .+: [\d.]+ → [\d.]+ a day\.$/.test(x)), r1.notes);
    /* the Research page: the edicts at work, and their share of the credits */
    await t.go('research');
    const box = await page.evaluate(() => { const b = document.querySelector('.rse-box'); return b ? b.textContent : ''; });
    check(`${tag}: the Research page lists the edict at work`, /Edicts at work/.test(box) && /The Lights Stay On/.test(box) && /Research Credits \+20%/.test(box) && /left/.test(box), box);
    check(`${tag}: the credits a day show the edicts’ share`, await page.evaluate(() => /Research edicts and laws\s*\+20%/.test((document.querySelector('.rs-rate') || {}).textContent || '')));

    /* 2. a study under way, hurried: a quarter of its time left taken off */
    await t.open('rsv-borrowed-time');
    const q0 = (await t.P()).q[0], r2 = await t.rule('rsv-borrowed-time', 0), q1 = (await t.P()).q[0], left = q0[2] - r2.at;
    check(`${tag}: a study under way finishes a quarter of its time left sooner`, Math.abs((q0[2] - q1[2]) - left * 0.25) < 5000, { was: q0[2], is: q1[2], left });
    check(`${tag}: the result names the study`, (r2.notes || []).some(x => /^Hurried: .+ from now \(was .+\)\.$/.test(x)), r2.notes);
    /* held up: the strike's harshest answer slows it, and the credits */
    const q2 = (await t.P()).q[0];await t.rule('rsv-down-pipettes', 2);const q3 = (await t.P()).q[0];
    check(`${tag}: a study held up ends later`, q3[2] > q2[2], { was: q2[2], is: q3[2] });

    /* 3. studies begun next: quicker, and the tree's detail shows the time crossed out */
    await t.rule('rsv-catalogue', 0);
    const ms = await page.evaluate(() => { const G = window.__game; return { got: G.rse.rsStudyMs(G.S.nation, 22, Date.now()), full: G.rs.RS[22].h * 3600e3 }; });
    check(`${tag}: a study begun now takes 25% less time`, Math.abs(ms.got - ms.full * 0.75) < 2, ms);

    /* 4. a law: the Peer Review Act makes studies longer and research cheaper while it stands */
    await t.rule('rsv-checked-twice', 0);
    const law = await page.evaluate(() => { const G = window.__game, n = G.S.nation; return { on: !!n.policies.peerReview, ms: G.rse.rsStudyMs(n, 22, Date.now()), full: G.rs.RS[22].h * 3600e3, disc: G.rse.rsDisc(n, 22, Date.now()).v }; });
    check(`${tag}: the Peer Review Act is law: studies 25% − 15% shorter, research 5% cheaper`, law.on && Math.abs(law.ms - law.full * 0.9) < 2 && law.disc >= 0.05, law);
    /* and the Fast-Track Science Act repeals it */
    await t.rule('rsv-fast-track', 0);
    check(`${tag}: the Fast-Track Science Act ends the Peer Review Act`, await page.evaluate(() => { const p = window.__game.S.nation.policies; return !!p.fastTrackScience && !p.peerReview; }));

    /* 5. a track first: War research cheaper, Trade's not */
    await t.rule('rsv-whose-first', 2);
    const tr = await page.evaluate(() => { const G = window.__game, n = G.S.nation; return { w: G.rse.rsDisc(n, 265, Date.now()).v, wo: G.rse.rsDisc(n, 265, Date.now()).parts, t: G.rse.rsDisc(n, 30, Date.now()).v }; });
    check(`${tag}: the army first: War research 15% cheaper, Trade’s not`, tr.w >= 0.15 && tr.wo.some(x => x[1] === 0.15) && tr.t < 0.15, tr);

    /* 6. credits spent: half a day's worth */
    const b0 = await page.evaluate(() => { const G = window.__game; return { bal: G.rse.rsBal(G.S.nation, Date.now()), rate: G.rse.rsRate(G.S.nation, Date.now()) }; });
    await t.rule('rsv-magnet', 1);
    const b1 = await page.evaluate(() => { const G = window.__game; return G.rse.rsBal(G.S.nation, Date.now()); });
    check(`${tag}: half a day’s Research Credits spent`, Math.abs((b0.bal - b1) - b0.rate * 0.5) < 0.5, { before: b0.bal, after: b1, rate: b0.rate });

    /* 7. a gamble: its own effects if the roll came off, its loss's if not */
    await t.edit(n => { n.nrp.ed = []; });
    const g = await t.rule('rsv-full-power', 0), pg = await t.P();
    check(`${tag}: the gamble did what its roll said`, g.gm === true ? pg.ed.some(e => e.k === 'c' && e.v === 0.15) : pg.ed.some(e => e.k === 'c' && e.v === -0.2), { won: g.gm, ed: pg.ed });
    await t.go('research');
    if (!phone) await page.screenshot({ path: OUT + '/research-edicts-overview.png' });
    else { const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); check('phone: the Research page with its edicts at work fits', w.sw <= w.cw + 1, w); await page.screenshot({ path: OUT + '/research-edicts-overview-phone.png', fullPage: true }); }
    check(`${tag}: the scientific record keeps the rulings`, await page.evaluate(() => (window.__game.S.nation.nrx.h || []).filter(e => e[1] === 'ed').length >= 6));

    /* 8. every option of every edict, on a fresh laboratory each time: no error, and each does what it says */
    if (!phone) {
      const res = await page.evaluate(() => {
        const G = window.__game, out = { n: 0, bad: [] };
        for (const is of G.rse.RSV_ISSUES) for (let o = 0; o < is.o.length; o++) {
          const n = G.clone(G.S.nation), now = Date.now();n.nrp.ed = [];n.nrp.re = n.nrp.rs + 500;n.nrp.ra = now - 1000;n.nrp.q = [[21, now - 1800e3, now + 5400e3, 18, 0, 1]];n.policies = {};n.inbox = [{ id: is.id, at: now }];G.commit(n);
          const before = JSON.stringify(G.S.nation.nrp);
          try { G.answer(is.id, o); } catch (e) { out.bad.push(is.id + ' ' + o + ' threw ' + e.message); continue; }
          out.n++;const r = G.S.result, opt = is.o[o], e = r && r.gm && !r.gm.ok && opt.g ? opt.g.e : opt.e, p = G.S.nation.nrp;
          const want = G.rse.rseWords(e);if (!want.length) continue;
          const changed = JSON.stringify(p) !== before || Object.keys(e.p || {}).some(k => G.S.nation.policies[k]);
          if (!changed) out.bad.push(is.id + ' ' + o + ' changed nothing');
          if (!(r && (r.geo || []).some(x => x[0] === 'Research') || (e.p && Object.keys(e).filter(k => ['rcb', 'rcp', 'rqn', 'rqs', 'rcx'].includes(k)).length === 0))) out.bad.push(is.id + ' ' + o + ' no note');
        }
        G.S.result = null;G.render();return out;
      });
      check('all 180 options ruled, each doing what it says', res.n === 180 && !res.bad.length, res);
    }
    check(`${tag}: no page errors`, !t.errors.length, t.errors.slice(0, 5));
    await t.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all research-edict checks passed');
process.exit(failed ? 1 : 0);
