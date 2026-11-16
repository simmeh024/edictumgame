// Handing over land taken in war (game/edictum.html, "handing over land taken in war"): a hex the army takes can go to
// another nation whose land touches it, as it falls (the attack panel's "If it falls") or later (the panel of your own
// hex). It is a border change in the giver's record (n.bx, marked wr), and stays land taken in war: the nation it was
// taken from counts it lost, and the new holder may hand it on. A border hex ceded the old way (no wr) stays plain land.
//   python3 build.py
//   node test/war-hand-over.mjs
// It serves public/ itself, so the game runs in its local mode (no emulators): the battle is rolled in the page, and
// Math.random is set for it. Screenshots go to test/out/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.waitForSelector('#d-name');
  await page.fill('#d-name', 'Handover');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const go = async v => { await ev(v => { location.hash = '#' + v; }, v); await until(() => ev(v => window.__game.S.view === v, v)); await sleep(350); };
  const act = a => ev(a => { const b = document.createElement('button'); b.dataset.act = a; document.body.appendChild(b); b.click(); b.remove(); }, a);
  await go('map'); await act('map-suggest'); await act('settle'); await until(() => ev(() => (window.__game.S.nation.cities || []).length > 0)); await sleep(300);
  await ev(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Later$/.test(x.textContent.trim())); if (b) b.click(); });

  /* the ground: a computer nation D with two neighbouring hexes c1, c2 (neither a capital), where c2 also touches a
     third nation B. The computer nations of the local game lie far apart, so B's capital is moved (in this page only)
     onto free land beside D's border. War with D, and c1 taken a moment ago, so c2 lies on the front */
  const plan = await ev(() => {
    const G = window.__game, M = G.MAP, IB = G.IB(), hexDist = G.RVN().hexDist;
    const nb = c => { const o = []; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0) o.push(j); } return o; };
    let T = G.territory();
    const npcs = T.list.filter(x => x.npc), D = npcs[0], B = npcs[1], di = T.byId[D.id];
    /* free land beside D, away from D's capital and from your own land */
    let f = -1;
    for (let c = 0; c < M.N && f < 0; c++) {
      if (T.owner[c] !== -1 || M.T[c] < 2) continue;
      const ds = nb(c).filter(j => T.owner[j] === di && !T.isCap[j]);
      if (ds.length && hexDist(c, D.cap) >= 3 && nb(c).every(j => T.owner[j] === -1 || T.owner[j] === di)) f = c;
    }
    if (f < 0) return null;
    IB.findNation(B.id).n.loc = G.locOf(f);
    T = G.territory();
    const bi = T.byId[B.id], d2 = T.byId[D.id];
    if (T.owner[f] !== bi) return { why: 'B did not settle', f };
    for (let c2 = 0; c2 < M.N; c2++) {
      if (T.owner[c2] !== d2 || T.isCap[c2] || !nb(c2).some(j => T.owner[j] === bi)) continue;
      for (const c1 of nb(c2)) if (T.owner[c1] === d2 && !T.isCap[c1] && M.T[c1] >= 2 && !nb(c1).some(j => T.owner[j] === bi))
        return { c1, c2, D: D.id, Dn: D.n.name, B: B.id, Bn: B.n.name, f };
    }
    return { why: 'no pair of hexes', f };
  });
  check('the map has a computer nation with a neighbour', !!plan && plan.c1 != null, plan);
  if (!plan || plan.c1 == null) throw new Error('no ground for the test');
  await ev(p => {
    const G = window.__game, n = G.clone(G.S.nation), now = Date.now();
    n.wars = { ...(n.wars || {}), [p.D]: { t: now - 2000 } };
    n.conq = (n.conq || []).concat({ c: p.c1, t: now - 1000, d: p.D });
    G.commit(n);
  }, plan);
  let st = await ev(p => { const G = window.__game, T = G.territory(), mi = T.byId[G.myId()]; return { own: T.owner[p.c1] === mi, occ: T.occ[p.c1], front: G.frontier(T).has(p.c2) }; }, plan);
  check('the hex taken in war is held, as land taken in war', st.own && st.occ === 1, st);
  check('the next hex is on the front', st.front, st);

  /* 1. the attack panel offers "If it falls", listing the nations whose land touches the hex, not the defender */
  await ev(p => { const G = window.__game; G.S.mapTarget = p.c2; G.S.mapSel = null; G.S.mapCell = null; G.updateMapPanel(); }, plan);
  const opts = await ev(() => [...document.querySelectorAll('#wg-for option')].map(o => ({ v: o.value, t: o.textContent })));
  check('the attack panel asks who gets the hex if it falls', opts.length >= 2 && opts[0].v === '' && /keeps it/.test(opts[0].t), opts);
  check('the nation next to it is offered, the defender is not', opts.some(o => o.v === plan.B) && !opts.some(o => o.v === plan.D), opts);
  await page.selectOption('#wg-for', plan.B);
  check('the choice is kept', await ev(p => { const s = window.__game.S.wgFor; return !!s && s.c === p.c2 && s.to === p.B; }, plan));
  await ev(() => window.__game.updateMapPanel());
  check('the choice survives the panel being drawn again', await ev(() => document.getElementById('wg-for').value) === plan.B);
  await page.screenshot({ path: path.join(OUT, 'war-hand-over-attack.png') });

  /* the battle won (the first roll), no counterattack (the rolls after it) */
  await ev(() => { const r = Math.random; let k = 0; Math.random = () => (k++ === 0 ? 0 : 0.999); window.__restoreRandom = () => { Math.random = r; }; });
  await page.click('#map-panel [data-act="attack"]');
  await until(() => ev(() => !window.__game.S.mapTarget));
  await ev(() => window.__restoreRandom());
  st = await ev(p => {
    const G = window.__game, T = G.territory(), n = G.S.nation, last = n.bx[n.bx.length - 1], conq = n.conq.find(e => e.c === p.c2);
    return { owner: T.list[T.owner[p.c2]]?.id, occ: T.occ[p.c2], orig: T.list[T.orig[p.c2]]?.id, bx: last, conqT: conq && conq.t, log: n.log.slice(0, 2).map(l => l.k + ':' + l.a), msg: G.S.warMsg, wgFor: G.S.wgFor };
  }, plan);
  check('the hex fell and went straight to the nation chosen', st.owner === plan.B, st);
  check('it stays land taken in war, taken from the defender', st.occ === 1 && st.orig === plan.D, st);
  check('the record keeps the conquest and, after it, the hand-over (wr)', st.bx && st.bx.c === plan.c2 && st.bx.to === plan.B && st.bx.wr === 1 && st.bx.t > st.conqT, st);
  check('the log tells of the conquest and the hand-over', st.log[0] === 'hand:' + plan.B && st.log[1] === 'conq:' + plan.D, st.log);
  check('the war message names the new holder', st.msg.includes('handed it to ' + plan.Bn), st.msg);
  check('the choice is cleared after the battle', st.wgFor === null, st);
  const occFrom = await ev(p => { const G = window.__game, W = G.WG(), T = G.territory(); return { b: W.occupiedFrom(T, T.byId[p.B], T.byId[p.D]).includes(p.c2), me: W.occupiedFrom(T, T.byId[G.myId()], T.byId[p.D]).includes(p.c2) }; }, plan);
  check('a peace between the new holder and the defender could hand it back; yours no longer can', occFrom.b && !occFrom.me, occFrom);

  /* 2. later, from the panel of your own hex taken in war */
  await ev(p => { const G = window.__game; /* as a click on the hex does */ G.S.mapTarget = null; G.S.mapSel = null; G.S.mapClaim = null; G.S.warMsg = ''; G.S.mapCell = p.c1; G.updateMapPanel(); }, plan);
  const give = await ev(() => ({ sel: !!document.getElementById('wg-to'), opts: [...document.querySelectorAll('#wg-to option')].map(o => ({ v: o.value, t: o.textContent })), hint: document.querySelector('#map-panel').textContent.includes('taken from') }));
  check('your hex taken in war offers to hand it over', give.sel && give.opts.length >= 1 && give.hint, give);
  check('its old holder is offered too, marked as such', give.opts.some(o => o.v === plan.D && /it was theirs/.test(o.t)), give.opts);
  const to = give.opts.find(o => o.v !== plan.D)?.v || plan.D;
  await page.selectOption('#wg-to', to);
  await page.click('#map-panel [data-act="wg-ask"]');
  const ask = await ev(() => ({ q: document.querySelector('.wg-ask')?.textContent || '', focus: document.activeElement?.dataset?.act }));
  check('handing over asks first, with the focus on the confirm button', /Hand this hex to/.test(ask.q) && ask.focus === 'wg-give', ask);
  await page.screenshot({ path: path.join(OUT, 'war-hand-over-ask.png') });
  await page.click('#map-panel [data-act="wg-cancel"]');
  check('cancel leaves the hex yours', await ev(p => { const G = window.__game, T = G.territory(); return T.owner[p.c1] === T.byId[G.myId()] && !document.querySelector('.wg-ask'); }, plan));
  await page.click('#map-panel [data-act="wg-ask"]');
  await page.click('#map-panel [data-act="wg-give"]');
  st = await ev(([p, to]) => { const G = window.__game, T = G.territory(); return { owner: T.list[T.owner[p.c1]]?.id, occ: T.occ[p.c1], log: G.S.nation.log[0] }; }, [plan, to]);
  check('the hex now belongs to the nation chosen', st.owner === to, st);
  check(to === plan.D ? 'given back to its old holder, it is plain land again' : 'it stays land taken in war', to === plan.D ? st.occ === 0 : st.occ === 1, st);
  check('the log tells of it', st.log && st.log.k === 'hand' && st.log.a === to, st.log);
  check('the panel no longer offers a hex that is not yours', !(await ev(() => !!document.getElementById('wg-to'))));

  /* 3. a border hex ceded the old way (no wr) is plain land of its new holder, as before */
  const old = await ev(p => {
    const G = window.__game, T = G.territory(), mi = T.byId[G.myId()], M = G.MAP;
    let c = -1; for (let i = 0; i < M.N && c < 0; i++) if (T.owner[i] === mi && !T.isCap[i] && !T.occ[i]) for (let d = 0; d < 6; d++) { const j = M.nbr[i * 6 + d]; if (j >= 0 && T.owner[j] === T.byId[p.D]) { c = i; break; } }
    if (c < 0) return { skip: true };
    const n = G.clone(G.S.nation); n.bx = n.bx.concat({ c, t: Date.now(), to: p.D, fr: G.myId() }); G.commit(n);
    const T2 = G.territory(); return { c, owner: T2.list[T2.owner[c]]?.id, occ: T2.occ[c] };
  }, plan);
  check('a border hex ceded without the mark is plain land of its new holder', old.skip || (old.owner === plan.D && old.occ === 0), old);

  /* 4. all of it is still there after a reload (normalize keeps the mark) */
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.nation.cities && window.__game.S.nation.cities.length);
  st = await ev(p => { const G = window.__game, T = G.territory(); return { owner: T.list[T.owner[p.c2]]?.id, occ: T.occ[p.c2], orig: T.list[T.orig[p.c2]]?.id, wr: G.S.nation.bx.filter(e => e.wr === 1).length }; }, plan);
  check('after a reload the hex handed over is still the new holder’s, taken in war', st.owner === plan.B && st.occ === 1 && st.orig === plan.D && st.wr === 2, st);

  /* 5. the nation's history says what happened */
  const lines = await ev(() => { const G = window.__game; return G.S.nation.log.filter(l => l.k === 'hand').length; });
  check('both hand-overs are in the log', lines === 2, lines);
  check('no page errors', !errors.length, errors);
  await ctx.close();
} catch (e) { console.log('FAIL', e.stack || e); failed++; }
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
