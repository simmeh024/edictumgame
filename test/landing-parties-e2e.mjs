// Landing parties and colonies (2026-11-27, game/edictum.html "landing parties and colonies"), between three players
// on the emulators. A settles on a small island and gets a Harbour. C settles on a coast A's boats reach, then goes
// unplayed for fifteen days (its record's save times moved back): A lands on C's abandoned coast without a war, the
// referee sealing each hex ('abandon'), and B's page takes those hexes as A's. A founds a city in that colony, which
// opens a second, and goes to war with B for conquest: A sends a hostile landing at B's coast, the referee tells B
// ('landing'), B sees it coming and digs in on the beaches, A's boats come ashore, the battle counts B's defences, A
// takes a hex and its beachhead becomes a Garrison colony; B's page shows the hex as A's.
// Run with: npm run test:landing
import { deflateRawSync } from 'node:zlib';
import { check, finish, until, player, register, nationDoc, clearEmulators, sleep, nav, establish, open, restGet, fieldsText, FS_HOST, PROJECT, OUT } from './lib.mjs';
await clearEmulators();
const vp = { width: 1366, height: 900 }, DAY = 864e5, H = 3600e3;
const A = await player('lnd-a', { vp }), B = await player('lnd-b', { vp }), C = await player('lnd-c', { vp });
const P = 'window.EDICTUM_PROBE.lnd';

/* found, then settle on a chosen hex (the game's own placement check decides) */
async function foundAt(p, name, spot) {
  await p.waitForSelector('#d-name'); await p.fill('#d-name', name); await p.click('#found-btn');
  await p.waitForSelector('.layout', { timeout: 15000 }); await sleep(500);
  if (typeof spot === 'function') spot = await p.evaluate(spot);
  if (!(spot >= 0)) throw new Error('no spot for ' + name);
  await nav(p, 'map');
  const settled = () => p.evaluate(() => !!G.S.nation.loc && G.territory().byId[G.myId()] !== undefined && !G.S.nation.inbox.some(x => x.id === 'fd-settle'));
  for (let k = 0; k < 5 && !(await settled()); k++) {
    await p.evaluate(c => { G.S.mapPick = c; G.render(); }, spot);
    await p.click('[data-act="settle"]').catch(() => {});
    await until(settled, 6000);
  }
  if (!(await settled())) throw new Error(name + ' could not settle at ' + spot);
  await establish(p);
  return spot;
}
/* a nation's last save moved back by ms: the record's own time, the document's and the server's (ts) */
async function backdate(uid, ms) {
  const r = await restGet('nations/' + uid), f = r.body.fields, rec = JSON.parse(fieldsText(f)), t = Date.now() - ms;
  rec.updatedAt = t;
  const fields = { ts: { timestampValue: new Date(t).toISOString() }, updatedAt: f.updatedAt && 'doubleValue' in f.updatedAt ? { doubleValue: t } : { integerValue: String(t) } };
  if (f.z) fields.z = { bytesValue: deflateRawSync(Buffer.from(JSON.stringify(rec))).toString('base64') }; else fields.j = { stringValue: JSON.stringify(rec) };
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const res = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/nations/${uid}?${mask}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
  return res.status;
}

/* A: on a coast of a small island, with a finished Harbour, stores and land credits */
const ua = await open(A);
await foundAt(A, 'Saltholm', () => {
  /* a coast of a small island from which at least two free coasts of other land, apart, lie 4 to 22 hexes by sea */
  const M = G.MAP, T = G.territory(), LK = G.LK.lakeMap();
  const bfs = (a, R) => { const d = new Int16Array(M.N).fill(-1), q = []; for (let k = 0; k < 6; k++) { const j = M.nbr[a * 6 + k]; if (j >= 0 && M.T[j] < 2 && !LK[j] && d[j] < 0) { d[j] = 1; q.push(j); } }
    for (let h = 0; h < q.length; h++) { const x = q[h]; if (d[x] >= R) continue; for (let k = 0; k < 6; k++) { const j = M.nbr[x * 6 + k]; if (j >= 0 && d[j] < 0 && M.T[j] < 2 && !LK[j]) { d[j] = d[x] + 1; q.push(j); } } } d.q = q; return d; };
  let tried = 0;
  for (let c = 0; c < M.N && tried < 60; c += 3) {
    if (M.T[c] < 2 || M.T[c] > 3 || T.owner[c] !== -1) continue; const k = M.comp[c], S = k >= 0 ? M.comps[k] : null; if (!S || S.size > 2500 || S.size < 200) continue;
    let sea = 0; for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j >= 0 && M.T[j] < 2 && !LK[j]) sea++; }
    if (sea < 2 || G.MD.pickProblem(c, T)) continue; tried++;
    const D = bfs(c, 22), seen = new Set(), cand = [];
    for (const s of D.q) { if (D[s] < 4) continue; for (let e = 0; e < 6; e++) { const x = M.nbr[s * 6 + e]; if (x < 0 || seen.has(x) || M.T[x] < 2 || M.T[x] > 3 || T.owner[x] !== -1 || M.comp[x] === k) continue; seen.add(x); cand.push(x); } }
    const ok = cand.filter(x => !G.MD.pickProblem(x, T)); if (ok.length < 2) continue;
    const near = new Set(G.MD.ringCells(ok[0], 7).map(y => y[0])); if (ok.some(x => !near.has(x))) return c;
  }
  return -1;
});
await A.evaluate(() => { const now = Date.now(), n = G.clone(G.S.nation); const cap = n.cities.find(c => c.id === 'cap') || n.cities[0]; cap.b = [{ k: 'harbour', s: now - 2e6, d: now - 1e6 }];
  n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = now; n._stockSet = true; n.lcb = 6; G.commit(n); });
const who = await A.evaluate(P0 => { const L = eval(P0), T = G.territory(), w = L.who(T, T.byId[G.myId()]); return { ok: w.ok, isle: w.isle, H: L.harbours(G.S.nation) }; }, P);
check('A, on a small island with a Harbour, may send landing parties', who.ok && who.isle && who.H.length === 1 && who.H[0].reach === 24, who);

/* two coasts A's boats reach, on other land, apart from each other: for B and for C */
const spots = await A.evaluate(P0 => {
  const L = eval(P0), M = G.MAP, T = G.territory(), Hs = L.harbours(G.S.nation), home = M.comp[T.list[T.byId[G.myId()]].cap], out = [];
  for (let c = 0; c < M.N; c++) {
    if (M.T[c] < 2 || M.T[c] > 3 || T.owner[c] !== -1 || M.comp[c] === home) continue;
    const s = L.seaTo(Hs, c); if (!s || s.d < 4 || s.d > 22) continue; if (G.MD.pickProblem(c, T)) continue; out.push(c);
  }
  const b = out[0], near = new Set(G.MD.ringCells(b, 7).map(x => x[0])), c = out.find(x => !near.has(x));
  return [b === undefined ? -1 : b, c === undefined ? -1 : c];
}, P);
check('two coasts within reach of A\'s Harbour, apart', spots[0] >= 0 && spots[1] >= 0, spots);
const ub = await open(B); await foundAt(B, 'Bevmark', spots[0]);
const uc = await open(C); await foundAt(C, 'Corrowind', spots[1]);
check('B and C are on A\'s map', await until(() => A.evaluate(([b, c]) => { const T = G.territory(); return T.byId[b] !== undefined && T.byId[c] !== undefined; }, [ub, uc]), 20000));

/* C goes unplayed: its page closed, its last save fifteen days ago */
await C.close().catch(() => {});
check('C\'s save times moved back fifteen days', (await backdate(uc, 15 * DAY)) === 200);
const abCells = () => A.evaluate(([P0, c]) => { const L = eval(P0), T = G.territory(); return [...L.targets(T)].filter(([, t]) => t.kind === 'ab' && T.list[t.j].id === c).map(([x]) => x); }, [P, uc]);
check('A\'s page offers C\'s abandoned coast for a peaceful landing', await until(async () => (await abCells()).length > 0, 30000), await A.evaluate(id => { const x = G.allNations().find(y => y.id === id); return x && { u: x.n.updatedAt, ts: x.n._ts }; }, uc));
const abAt = (await abCells())[0];
await A.evaluate(([P0, c]) => { G.S.lndTy = 't'; G.S.lndNm = 'Corrow Landing'; return eval(P0).send(c); }, [P, abAt]);
const v1 = await A.evaluate(() => (G.S.nation.lnd || []).find(v => v.ab));
check('the landing party sails for C\'s coast', !!v1 && v1.st === 'sea' && v1.cl.length >= 1, [v1, await A.evaluate(() => G.S.lndMsg)]);
await A.evaluate(id => { const n = G.clone(G.S.nation), v = n.lnd.find(x => x.id === id); v.s = Date.now() - 3 * 3600000; v.a = Date.now() - 60000; G.commit(n); }, v1.id);
await A.evaluate(P0 => eval(P0).tick(Date.now()), P);
const col1 = await until(() => A.evaluate(id => (G.S.nation.cln || []).find(c => c.id === id), v1.id), 20000) && await A.evaluate(id => (G.S.nation.cln || []).find(c => c.id === id), v1.id);
check('it comes ashore: a colony on C\'s old coast', !!col1 && col1.ty === 't', col1);
const sealedAb = await A.evaluate(() => (G.S.nation.conq || []).filter(e => e.w === '~abandoned'));
check('each hex sealed by the referee as a landing on an abandoned coast', sealedAb.length >= 1 && sealedAb.every(e => typeof e.s2 === 'string' && e.d), sealedAb);
check('the hexes are A\'s on A\'s map', await until(() => A.evaluate(cs => { const T = G.territory(), i = T.byId[G.myId()]; return cs.length > 0 && cs.every(c => T.owner[c] === i); }, sealedAb.map(e => e.c)), 15000));
check('and on B\'s map: the seal holds, no war needed', await until(() => B.evaluate(([a, cs]) => { const T = G.territory(), i = T.byId[a]; return i !== undefined && cs.length > 0 && cs.every(c => T.owner[c] === i); }, [ua, sealedAb.map(e => e.c)]), 30000));

/* a city in the colony opens a second */
await A.evaluate(c => { const n = G.clone(G.S.nation); n.cities.push({ id: 'cx' + Date.now().toString(36), c, nm: 'Corrowport', t: Date.now(), b: [] }); G.commit(n); }, col1.c);
check('a city in the colony opens the second', await until(() => A.evaluate(P0 => eval(P0).blocked(G.territory()) === '', P), 10000), await A.evaluate(P0 => eval(P0).blocked(G.territory()), P));

/* war with B, for conquest; a hostile landing at its coast */
await register(A, { old: true });
await A.evaluate(b => { const n = G.clone(G.S.nation); n.wars = { ...(n.wars || {}), [b]: { t: Date.now(), g: 'c' } }; G.commit(n); }, ub);
check('the war is saved', await until(async () => (await nationDoc(ua))?.rec?.wars?.[ub]?.g === 'c', 15000));
const hCells = () => A.evaluate(([P0, b]) => { const L = eval(P0), T = G.territory(); return [...L.targets(T)].filter(([, t]) => t.kind === 'h' && T.list[t.j].id === b).map(([x]) => x); }, [P, ub]);
check('A\'s page offers B\'s coast for a hostile landing', await until(async () => (await hCells()).length > 0, 20000));
const hAt = (await hCells())[0];
await A.evaluate(([P0, c]) => eval(P0).send(c), [P, hAt]);
const v2 = await A.evaluate(() => (G.S.nation.lnd || []).find(v => v.k === 'h'));
check('the referee takes the landing; A\'s boats sail, 12 to 24 hours away', !!v2 && v2.w === ub && v2.a - v2.s >= 12 * H && v2.a - v2.s <= 24 * H, [v2, await A.evaluate(() => G.S.lndMsg)]);
check('B sees it coming', await until(() => B.evaluate(P0 => eval(P0).threats(Date.now()).length === 1, P), 30000));
await nav(B, 'map');
check('on B\'s map panel, with beach defences to buy', await until(() => B.evaluate(() => /A landing is coming/.test((document.querySelector('.lnd-threat') || {}).textContent || '') && !!document.querySelector('[data-act="lnd-dig"][data-lv="1"]')), 10000));
await B.screenshot({ path: OUT + '/landing-threat.png' }).catch(() => {});
await B.evaluate(id => { const n = G.clone(G.S.nation); n.stock = { food: 900, timber: 900, iron: 900, oil: 900, goods: 900 }; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); }, v2.id);
await B.evaluate(id => document.querySelector(`[data-act="lnd-dig"][data-id="${id}"][data-lv="1"]`).click(), v2.id);
check('B digs in: stakes and trenches, saved', await until(async () => (await nationDoc(ub))?.rec?.bdf?.[v2.id]?.lv === 1, 15000));

/* the boats come ashore: the hexes join A's frontier, and the battle counts B's beaches */
await A.evaluate(id => { const n = G.clone(G.S.nation), v = n.lnd.find(x => x.id === id); v.s = Date.now() - 13 * 3600000; v.a = Date.now() - 60000; G.commit(n); }, v2.id);
const odds = () => A.evaluate(([P0, c]) => { const L = eval(P0), T = G.territory(), fr = L.frontier(T); if (!fr.has(c)) return null; const od = L.battle(T, c, T.byId[G.myId()], T.owner[c], fr.get(c)); return { p: od.p, intel: od.intel.join(' ') }; }, [P, hAt]);
check('ashore: B\'s beach joins A\'s frontier, held behind stakes and trenches', await until(async () => /stakes and trenches/.test((await odds() || {}).intel || ''), 20000), await odds());
let won = null;
for (let i = 0; i < 6 && !(won && won.win); i++) won = await A.evaluate(async ([d, c]) => (await (await window.claude.use('referee')).battle({ d, c, p: 0.95 })), [ub, hAt]);
check('A takes the beach in battle (the referee rolls)', won && won.win && typeof won.s2 === 'string', won);
await A.evaluate(([d, c, s, s2, t]) => { const n = G.clone(G.S.nation); n.conq = (n.conq || []).concat({ c, t, d, s, s2 }); n.log.unshift({ t: Date.now(), k: 'conq', a: d, b: 'Bevmark', fx: '', c }); G.commit(n); }, [ub, hAt, won.s, won.s2, won.t]);
await until(() => A.evaluate(c => { const T = G.territory(); return T.owner[c] === T.byId[G.myId()]; }, hAt), 15000);
await A.evaluate(P0 => eval(P0).tick(Date.now()), P);
const beach = await until(() => A.evaluate(id => (G.S.nation.cln || []).find(c => c.id === id && c.hs === 1), v2.id), 15000) && await A.evaluate(id => (G.S.nation.cln || []).find(c => c.id === id), v2.id);
check('the beachhead becomes a Garrison colony', !!beach && beach.ty === 'g' && beach.c === hAt, beach);
check('B\'s map shows the beach as A\'s', await until(() => B.evaluate(([a, c]) => { const T = G.territory(); return T.owner[c] === T.byId[a]; }, [ua, hAt]), 30000));
check('the landing counts twice towards the sixteen hexes a day', await A.evaluate(P0 => { const L = eval(P0), n = G.clone(G.S.nation), now = Date.now(), k0 = n.conq.filter(e => e && !e.n && e.t >= now - 864e5).length; for (let k = k0; k < 15; k++) n.conq.push({ c: 900000 + k, t: now - k * 1000, d: 'x' }); return /counts twice/.test(L.conqCap(n, now)); }, P));
await A.screenshot({ path: OUT + '/landing-a.png' }).catch(() => {});
await finish();
