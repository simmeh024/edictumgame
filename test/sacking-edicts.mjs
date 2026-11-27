// Sacking edicts in the game (game/edictum.html, "sacking edicts"): each names a real official (a minister, a governor,
// a mayor); every written fate and the keep option of every one can be ruled without a page error and does what it
// says to the cabinet, the province or the city and the ledger; the card shows the official, the written fates, the
// fates only some governments have and the shelf; a sacked minister's successor can be chosen on the result page;
// stories continue with the sacked official's name; the backbenches can be recalled; postcards arrive; asylum seekers
// taken in become candidates. On a desktop (light) and a phone (dark). Screenshots go to test/out/.
//   python3 build.py
//   node test/sacking-edicts.mjs
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
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' :: ' + JSON.stringify(info).slice(0, 1500)}`); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const t = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v || Date.now() - t > ms) return v; await sleep(150); } }

async function start(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.EDICTUM_PROBE = g => { window.__game = g; }; });
  await page.goto(BASE);
  await page.fill('#d-name', 'Marrowby');
  await page.click('#found-btn');
  await page.waitForFunction(() => window.__game && window.__game.S.nation && window.__game.S.view);
  await page.evaluate(() => { window.__game.sk = window.EDICTUM_PROBE.sk; });
  const edit = (fn, arg) => page.evaluate(([src, arg]) => { const G = window.__game, n = G.clone(G.S.nation); (0, eval)('(' + src + ')')(n, Date.now(), G, arg); G.commit(n); G.render(); }, [fn.toString(), arg]);
  await page.evaluate(() => { location.hash = '#map'; }); await sleep(600);
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'map-suggest'; document.body.appendChild(b); b.click(); b.dataset.act = 'settle'; b.click(); b.remove(); });
  await until(() => page.evaluate(() => (window.__game.S.nation.cities || []).length > 0 || !!window.__game.S.nation.loc));
  /* an older nation with a record of decisions, a mayor in its first city and a governor in a second province */
  await edit((n, now) => {
    n.founded = now - 6 * 864e5; n.dec = 40; n.inbox = [];
    if (Array.isArray(n.cities) && n.cities[0]) n.cities[0].my = { nm: 'Hester Quarrington', tr: 'builder', t: now };
    n.prov = { on: 1, term: 'p', l: [{ id: 1, nm: 'Crown Province', s: -1, g: { nm: 'Ottavia Brenchley-Moss', tr: ['farmer'], sk: 3, lo: 60, t: now } }, { id: 2, nm: 'Upper Wend', s: -2, g: { nm: 'Ivo Pellingrew', tr: ['builder'], sk: 3, lo: 60, t: now } }] };
  });
  const go = async v => { await page.evaluate(v => { const S = window.__game.S; S.result = null; S.openIssue = null; location.hash = '#' + v; window.__game.render(); }, v); await until(() => page.evaluate(v => window.__game.S.view === v.split('/')[0], v)); await sleep(250); };
  const open = async id => { await edit((n, now, G, id) => { n.inbox = [{ id, at: now }]; }, id); await go('issues'); await page.evaluate(id => { const S = window.__game.S; S.openIssue = id; window.__game.render(); }, id); return until(() => page.$(`.paper.edict [data-id="${id}"]`)); };
  return { ctx, page, errors, edit, go, open };
}

try {
  for (const [tag, theme, viewport] of [['desktop', 'light', { width: 1280, height: 900 }], ['phone', 'dark', { width: 390, height: 844 }]]) {
    const phone = tag === 'phone', t = await start(theme, viewport), { page, edit, go, open } = t;

    if (!phone) {
      const cat = await page.evaluate(() => { const K = window.__game.sk, base = K.ISSUES.filter(i => !i.fo), gens = new Set(K.GEN.map(i => i.gen));
        return { base: base.length, fo: K.ISSUES.length - base.length, gen: K.GEN.length, gens: [...gens].sort(), shelf: base.every(i => i.o.length === 4 + K.SHELF.length), tx: K.SHELF.every(f => K.TX[f] && K.TX[f].n) }; });
      check('at least 150 sacking edicts, each with its 4 written options and the whole shelf', cat.base >= 150 && cat.shelf && cat.tx, cat);
      check('generic follow-ups for every fate that queues one', ['ambassador', 'asylum', 'auction', 'back', 'disguise', 'duke', 'goatfarm', 'jail', 'memoir', 'opposition', 'pilgrimage', 'reeducate', 'tv', 'vanish'].every(k => cat.gens.includes(k)), cat.gens);

      /* the gate: not before day 3 and decision 10, one on the desk, one a day, three a week */
      const gate = await page.evaluate(() => { const G = window.__game, K = G.sk, n0 = G.S.nation, now = Date.now(), c = o => Object.assign(G.clone(n0), o), id = K.ISSUES.find(i => !i.fo).id;
        return { old: K.gate(c({})), young: K.gate(c({ founded: now - 864e5 })), few: K.gate(c({ dec: 3, answered: [] })), desk: K.gate(c({ inbox: [{ id, at: now }] })),
          day: K.gate(c({ answered: [{ id, o: 0, t: now - 3600e3, fx: '' }] })), week: K.gate(c({ answered: [1, 2, 3].map(d => ({ id, o: 0, t: now - d * 864e5 - 3600e3, fx: '' })) })),
          two: K.gate(c({ answered: [1, 2].map(d => ({ id, o: 0, t: now - d * 864e5 - 3600e3, fx: '' })) })) }; });
      check('rare: from day 3 and decision 10, one at a time, one a day, three a week', gate.old && !gate.young && !gate.few && !gate.desk && !gate.day && !gate.week && gate.two, gate);

      /* every written fate and keep option of every sacking edict */
      const res = await page.evaluate(() => {
        const G = window.__game, K = G.sk, out = { n: 0, skip: [], bad: [] }, base = G.clone(G.S.nation), TR = ['genius', 'workaholic', 'corrupt', 'honest', 'hawk', 'dove', 'beloved', 'gaffe', 'ambitious', 'loyal', 'eccentric', 'showman', 'penny'];
        for (const is of K.ISSUES) {
          if (is.fo) continue;
          for (let o = 0; o < 4; o++) {
            const n = G.clone(base), now = Date.now();
            n.skd = []; n.chain = []; n.inbox = [{ id: is.id, at: now }]; n.cabAt = 0; delete n.skp;
            const cab = n.cab = G.clone(n.cab || {});
            for (const pf of Object.keys(cab)) { cab[pf].tr = []; cab[pf].lo = 60; }
            if (is.sk.startsWith('T:')) cab.int.tr = [is.sk.slice(2)];
            if (is.sk === 'plot') cab.wrk.lo = 10;
            G.commit(n);
            const T = K.target(G.S.nation, is.id);
            if (!T) { if (o === 0) out.skip.push(is.id); continue; }
            const where = () => T.k === 'm' ? G.S.nation.cab[T.pf].nm : T.k === 'y' ? ((G.S.nation.cities || []).find(c => c.id === T.cid) || {}).my : ((G.S.nation.prov.l.find(q => q.id === T.pid) || {}).g || {}).ac ? 'acting' : 'gov';
            const before = where();
            try { G.answer(is.id, o); } catch (e) { out.bad.push(is.id + ' ' + o + ' threw ' + e.message); continue; }
            out.n++;
            const r = G.S.result, opt = is.o[o], n2 = G.S.nation, e = (n2.skd || [])[0];
            if (!r || r.id !== is.id) { out.bad.push(is.id + ' ' + o + ' no result'); continue; }
            if (/\{/.test(r.fx)) out.bad.push(is.id + ' ' + o + ' fx has a placeholder: ' + r.fx);
            const after = where();
            if (opt.keep) { if (e) out.bad.push(is.id + ' keep wrote a ledger entry'); if (T.k === 'm' && after !== before) out.bad.push(is.id + ' keep changed the minister'); }
            else {
              if (!e || e.id !== is.id || e.f !== opt.f || e.n !== T.nm) out.bad.push(is.id + ' ' + o + ' ledger ' + JSON.stringify(e));
              if (T.k === 'm' && after === before) out.bad.push(is.id + ' ' + o + ' minister still in office');
              if (T.k === 'y' && after) out.bad.push(is.id + ' ' + o + ' mayor still in office');
              if (T.k === 'g' && after !== 'acting') out.bad.push(is.id + ' ' + o + ' no acting governor');
              if (opt.nx && !(n2.chain || []).some(c => c.id === opt.nx)) out.bad.push(is.id + ' ' + o + ' story not queued');
            }
          }
        }
        G.S.result = null; G.commit(base); G.render(); return out;
      });
      check(`every written fate and keep option ruled (${res.n}), each doing what it says`, res.n >= 600 && !res.bad.length, { n: res.n, bad: res.bad.slice(0, 12), skip: res.skip });
      check('governor and mayor edicts reach their official', !res.skip.length, res.skip);

      /* every story follow-up names the sacked official, and its back option brings them back */
      const st = await page.evaluate(() => {
        const G = window.__game, K = G.sk, out = { n: 0, bad: [] }, base = G.clone(G.S.nation);
        for (const fo of K.ISSUES.filter(i => i.fo)) {
          const is = K.ISSUES.find(i => i.id === fo.skp);
          const n = G.clone(base), now = Date.now();
          n.skd = [{ n: 'Ottoline Vexbridge', r: 'Finance Minister', k: 'm', pf: 'fin', f: 'lighthouse', t: now - 5 * 864e5, id: is.id, tr: [], sk: 3, ag: 50 }]; n.inbox = [{ id: fo.id, at: now }];
          G.commit(n);
          for (let o = 0; o < fo.o.length; o++) {
            if (o) { const m = G.clone(G.S.nation); m.inbox = [{ id: fo.id, at: Date.now() }]; m.skd = [{ n: 'Ottoline Vexbridge', r: 'Finance Minister', k: 'm', pf: 'fin', f: 'lighthouse', t: now - 5 * 864e5, id: is.id, tr: [], sk: 3, ag: 50 }]; G.commit(m); }
            try { G.answer(fo.id, o); } catch (e) { out.bad.push(fo.id + ' ' + o + ' threw ' + e.message); continue; }
            out.n++; const r = G.S.result;
            if (!r || /\{/.test(r.fx)) out.bad.push(fo.id + ' ' + o + ' fx ' + (r && r.fx));
            if (fo.o[o].back && G.S.nation.cab.fin.nm !== 'Ottoline Vexbridge') out.bad.push(fo.id + ' ' + o + ' back did not rehire');
          }
        }
        G.S.result = null; G.commit(base); G.render(); return out;
      });
      check(`every story follow-up ruled (${st.n}), names filled in, back rehires`, st.n > 100 && !st.bad.length, st);

      /* the generic follow-ups, as their fate queued them */
      const gen = await page.evaluate(() => {
        const G = window.__game, K = G.sk, out = { n: 0, bad: [] }, base = G.clone(G.S.nation);
        for (const is of K.GEN) {
          if (is.gen === 'asylum') continue;
          for (let o = 0; o < is.o.length; o++) {
            const n = G.clone(base), now = Date.now();
            n.skd = [{ n: 'Peregrine Ashdowne', r: 'Defence Minister', k: 'm', pf: 'def', f: is.gen === 'back' ? 'lighthouse' : is.gen, t: now - 9 * 864e5, id: K.ISSUES[0].id, q: is.id, tr: ['hawk'], sk: 3, ag: 50 }];
            n.inbox = [{ id: is.id, at: now }]; G.commit(n);
            try { G.answer(is.id, o); } catch (e) { out.bad.push(is.id + ' ' + o + ' threw ' + e.message); continue; }
            out.n++; const r = G.S.result, e = G.S.nation.skd[0], op = is.o[o];
            if (!r || /\{/.test(r.fx)) out.bad.push(is.id + ' ' + o + ' fx ' + (r && r.fx));
            if (op.back && (G.S.nation.cab.def.nm !== 'Peregrine Ashdowne' || !G.S.nation.cab.def.tr.includes('comeback') || e.x !== 'back')) out.bad.push(is.id + ' back');
            if (op.post && e.x !== 'post') out.bad.push(is.id + ' post');
            if (op.recall && e.x !== 'home') out.bad.push(is.id + ' recall');
            if (op.pardon && e.x !== 'free') out.bad.push(is.id + ' pardon');
          }
        }
        G.S.result = null; G.commit(base); G.render(); return out;
      });
      check(`every generic follow-up ruled (${gen.n}): comebacks, smaller posts, recalls, pardons`, gen.n > 50 && !gen.bad.length, gen);
    }

    /* the card: who, the written fates, the government's own, the shelf */
    const fin = 'sk-fin-abacus';
    await edit((n, now) => { n.s.pol = 20; n.s.civil = 20; n.s.econ = 50; n.s.corrupt = 75; n.skd = []; n.chain = []; n.cabAt = 0; });
    await open(fin);
    const card = await page.evaluate(() => ({ who: (document.querySelector('.sk-who .sk-n') || {}).textContent || '', fin: window.__game.S.nation.cab.fin.nm, opts: document.querySelectorAll('.sk-opts > .sk-opt').length,
      gov: [...document.querySelectorAll('.sk-gov .sk-fate-n b')].map(b => b.textContent), shelf: document.querySelectorAll('.sk-shelf .sk-fate').length, code: (document.querySelector('.paper.edict .form-code') || {}).textContent || '',
      q: (document.querySelector('.issue-q') || {}).textContent || '' }));
    check(`${tag}: the card names the Finance Minister, four written options and the shelf`, card.who === card.fin && card.opts === 4 && card.shelf >= 10 && /Dismissal/.test(card.code) && card.q.includes(card.fin) && !/\{/.test(card.q), card);
    check(`${tag}: a corrupt dictatorship sees its own fates`, card.gov.length >= 3, card.gov);
    await page.screenshot({ path: path.join(OUT, `sacking-card-${tag}.png`), fullPage: false });
    await page.evaluate(() => { const d = document.querySelector('.sk-shelf'); if (d) d.open = true; const g = document.querySelector('.sk-gov') || d; if (g) g.scrollIntoView({ block: 'start' }); }); await sleep(400);
    await page.screenshot({ path: path.join(OUT, `sacking-fates-${tag}.png`), fullPage: false });
    if (!phone) {
      await edit(n => { n.s.pol = 80; n.s.civil = 80; n.s.corrupt = 20; });
      await open(fin);
      const dem = await page.evaluate(() => [...document.querySelectorAll('.sk-gov .sk-fate-n b')].map(b => b.textContent));
      const vanishName = await page.evaluate(() => window.__game.sk.TX.vanish.n), recallName = await page.evaluate(() => window.__game.sk.TX.recall.n);
      check('a democracy sees the recall vote, and never “get rid of them”', dem.includes(recallName) && !dem.includes(vanishName), dem);
      await edit(n => { n.s.pol = 20; n.s.civil = 20; n.s.corrupt = 75; });
      await open(fin);
    }
    /* choose a government-only fate from the card, then the successor */
    const old = await page.evaluate(() => window.__game.S.nation.cab.fin.nm);
    await page.click('.sk-gov [data-act="sk-pick"]');
    await until(() => page.$('.sk-fstamp'));
    const res1 = await page.evaluate(() => ({ stamp: (document.querySelector('.sk-fstamp') || {}).textContent || '', succ: document.querySelectorAll('.sk-succ [data-act="sk-succ"]').length, skd: window.__game.S.nation.skd[0], skp: window.__game.S.nation.skp }));
    check(`${tag}: the fate is stamped on the result, and three successors are offered`, res1.stamp && res1.succ >= 3 && res1.skd && res1.skd.n === old && res1.skp, res1);
    await page.screenshot({ path: path.join(OUT, `sacking-result-${tag}.png`), fullPage: false });
    const cand = await page.evaluate(() => (document.querySelectorAll('.sk-succ .cand .cv-cn')[1] || {}).textContent || '');
    await page.click('.sk-succ [data-act="sk-succ"][data-j="1"]');
    await until(() => page.evaluate(c => window.__game.S.nation.cab.fin.nm === c, cand));
    check(`${tag}: the chosen successor takes office at once`, await page.evaluate(c => window.__game.S.nation.cab.fin.nm === c && !window.__game.S.nation.skp, cand), cand);

    if (!phone) {
      /* a written story: the lighthouse of the abacus budget, then its follow-up with the name */
      await edit(n => { n.skd = []; n.chain = []; n.cabAt = 0; });
      await open(fin);
      const nm = await page.evaluate(() => window.__game.S.nation.cab.fin.nm);
      await page.evaluate(() => window.__game.answer('sk-fin-abacus', 0));
      const q = await page.evaluate(() => (window.__game.S.nation.chain || []).map(c => c.id));
      check('the lighthouse queues its story', q.includes('sk-fin-abacus-2'), q);
      await open('sk-fin-abacus-2');
      const fo = await page.evaluate(() => ({ who: (document.querySelector('.sk-fo-who') || {}).textContent || '', q: (document.querySelector('.issue-q') || {}).textContent || '' }));
      check('the follow-up names the sacked minister', fo.who.includes(nm) && fo.q.includes(nm), { nm, fo });

      /* the backbenches: recalled for free from the Cabinet tab */
      await edit(n => { n.skd = []; n.chain = []; n.cabAt = 0; });
      await open(fin);
      const bb = await page.evaluate(() => { const G = window.__game, is = G.sk.ISSUES.find(i => i.id === 'sk-fin-abacus'), o = is.o.findIndex((x, i) => i >= 4 && x.f === 'backbench'); const nm = G.S.nation.cab.fin.nm; G.answer(is.id, o); return nm; });
      await page.evaluate(() => { location.hash = '#government/cabinet'; window.__game.S.result = null; window.__game.render(); });
      await until(() => page.$('.sk-where [data-act="sk-recall"]'));
      const rows = await page.evaluate(() => document.querySelectorAll('.sk-where .sk-row').length);
      await page.evaluate(() => document.querySelector('.sk-where').scrollIntoView({ block: 'start' })); await sleep(900);
      await page.screenshot({ path: path.join(OUT, 'sacking-where-desktop.png'), fullPage: false });
      await page.click('.sk-where [data-act="sk-recall"]');
      await until(() => page.evaluate(nm => window.__game.S.nation.cab.fin.nm === nm, bb));
      check('Where are they now lists them, and the backbencher is recalled for free', rows >= 1 && await page.evaluate(nm => window.__game.S.nation.cab.fin.nm === nm && window.__game.S.nation.skd[0].x === 'back', bb), { rows, bb });

      /* a memoir always brings its tell-all; postcards arrive from the lighthouse, a week apart */
      const mem = await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); n.skd = []; n.chain = []; n.inbox = [{ id: 'sk-fin-abacus', at: Date.now() }]; G.commit(n);
        const is = G.sk.ISSUES.find(i => i.id === 'sk-fin-abacus'), o = is.o.findIndex((x, i) => i >= 4 && x.f === 'memoir'); G.answer(is.id, o);
        const e = G.S.nation.skd[0]; return { q: e.q, chain: (G.S.nation.chain || []).map(c => c.id) }; });
      check('a memoir queues a tell-all', /^sk-gen-memoir-/.test(mem.q || '') && mem.chain.includes(mem.q), mem);
      const pc = await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation), now = Date.now();
        n.skd = [{ n: 'Amity Glasspole', r: 'Interior Minister', k: 'm', pf: 'int', f: 'lighthouse', t: now - 30 * 864e5, id: 'sk-fin-abacus' }, { n: 'Rook Tantallon', r: 'Mayor', k: 'y', p: 'Sallowmere', f: 'goatfarm', t: now - 29 * 864e5, id: 'sk-fin-abacus' }];
        const L = G.sk.postcards(n, now); return { n: L.length, gaps: L.slice(1).map((x, i) => x.t - L[i].t), bad: L.filter(x => /\{/.test(x.x)).length, peer: L.length && L[0].peer }; });
      check('postcards arrive, at least a week apart, with every name filled in', pc.n >= 2 && pc.gaps.every(g => g >= 7 * 864e5) && !pc.bad && pc.peer === 'office-postcards', pc);

      /* an asylum seeker taken in is a candidate next time a minister is replaced, and hiring records it */
      const mk = await page.evaluate(() => { const G = window.__game, n = G.clone(G.S.nation); n.ska = [{ n: 'Casimir Oddfellow-Rand', r: 'Foreign Minister', tr: ['dove'], sk: 4, ag: 52, pf: 'for', f: 'nbx-1', t: Date.now() }]; n.cabAt = 0; G.commit(n); return G.sk.market(G.S.nation).map(c => c.nm); });
      check('an asylum seeker taken in is offered as a candidate', mk.includes('Casimir Oddfellow-Rand'), mk);
    }
    check(`${tag}: no page errors`, !t.errors.length, t.errors.slice(0, 5));
    await t.ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all sacking-edict checks passed');
process.exit(failed ? 1 : 0);
