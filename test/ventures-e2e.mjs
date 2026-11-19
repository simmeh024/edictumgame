// Joint ventures (game/edictum.html, "joint ventures"; functions/ventures.js): a border road, a border railway or a toll
// bridge that two neighbours build together, each paying its half. On the Diplomacy page's Ventures tab a Registered
// Nation picks a nation it shares a border with and what to build; the game finds the route, takes its half from the
// stockpile, and the server files it: a computer nation answers at once by its affinity. Built, it gives both sides
// more output in the cities at its ends and draws on the map; ending it takes notice and costs goodwill. A half the
// server refuses for good comes back; an offer from another player is accepted with this nation's own half.
//   npm run test:ventures
import { player, open, found, until, check, finish, text, nav, restListAdmin, clearEmulators, sleep, register, establish, errors, OUT, FS_HOST, PROJECT } from './lib.mjs';
import path from 'node:path';
await clearEmulators();

const RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const stock = p => p.evaluate(() => { const st = G.WH.stockNow(G.S.nation, Date.now()); return Object.fromEntries(['food', 'timber', 'iron', 'oil', 'goods'].map(r => [r, Math.floor((st[r] || 0) + 1e-6)])); });
const setStock = (p, st) => p.evaluate(st => { const n = G.clone(G.S.nation); n.stock = st; n.stockAt = Date.now(); n._stockSet = true; G.commit(n); G.render(); }, st);
const ventures = async () => (await restListAdmin('ventures')).map(d => ({ id: d.id, st: d.fields.st?.stringValue, k: d.fields.k?.stringValue, a: d.fields.a?.stringValue, b: d.fields.b?.stringValue, npc: !!d.fields.npc?.booleanValue }));
/* written past the rules, as the server would (the Firestore emulator takes "Bearer owner" as an admin) */
const val = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : typeof v === 'number' ? { doubleValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
async function adminWrite(doc, data, mask) {
  const q = mask ? '?' + Object.keys(data).map(k => 'updateMask.fieldPaths=' + k).join('&') : '';
  const r = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${doc}${q}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, val(v)])) }) });
  if (!r.ok) throw new Error('admin write ' + doc + ': ' + r.status + ' ' + await r.text());
}
const watch = p => p.ctx.addInitScript(() => { window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const t = document.getElementById('toast'); if (t && !t.hidden) window.__toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })); });
const toastHas = (p, re) => until(() => p.evaluate(src => (window.__toasts || []).some(t => new RegExp(src).test(t)), re.source), 60000);
const tab = async p => { await nav(p, 'diplomacy'); await p.click('#dp-tab-ventures'); await sleep(200); };

const A = await player('venturer');
await watch(A);
const uidA = await open(A);
await found(A, 'Venturia', { newPlayer: true });

/* the ground: settle beside a computer nation (the nearest place the settling rules allow, its capital close by), then
   claim the hexes between, so the two share a border */
const ground = await A.evaluate(() => {
  const T = G.territory(), M = G.MAP;
  const land = new Map(); for (const x of T.list) if (x.npc) land.set(x.id, []);
  for (let e = 0; e < M.N; e++) { const o = T.owner[e]; if (o >= 0 && T.list[o].npc && M.T[e] >= 2) land.get(T.list[o].id).push(e); }
  let best = null;
  for (let c = 0; c < M.N; c++) {
    if (M.T[c] < 2 || T.owner[c] !== -1 || G.MD.pickProblem(c, T)) continue;
    for (const x of T.list) { if (!x.npc) continue; const d = G.JV().hexDist(c, x.cap); if (d > 10) continue;
      let near = 99; for (const e of land.get(x.id)) near = Math.min(near, G.JV().hexDist(c, e));
      const score = near * 10 + d; if (!best || score < best.score) best = { c, id: x.id, score, near, d }; }
  }
  return best;
});
check('the map has a spot to settle near a computer nation', !!ground, JSON.stringify(ground));
await nav(A, 'map');
await A.evaluate(c => { G.S.mapPick = c; G.render(); }, ground.c); await sleep(300);
await A.click('[data-act="settle"]');
check('the capital stands near the computer nation', await until(() => A.evaluate(c => { const T = G.territory(); return T.list[T.byId[G.myId()]].cap === c && !G.S.nation.inbox.some(x => x.id === 'fd-settle'); }, ground.c), 10000), JSON.stringify(await A.evaluate(() => G.S.mapMsg)));
await establish(A);
const claimed = await A.evaluate(npc => {
  const M = G.MAP, T = G.territory(), me = T.byId[G.myId()], ni = T.byId[npc];
  const mine = new Set(); for (let c = 0; c < M.N; c++) if (T.owner[c] === me) mine.add(c);
  const prev = new Map(), q = [...mine]; for (const c of q) prev.set(c, -1);
  let hit = -1;
  for (let h = 0; h < q.length && hit < 0; h++) { const c = q[h];
    for (let d = 0; d < 6; d++) { const j = M.nbr[c * 6 + d]; if (j < 0) continue; if (T.owner[j] === ni) { hit = c; break; } if (prev.has(j) || M.T[j] < 2 || T.owner[j] !== -1) continue; prev.set(j, c); q.push(j); } }
  if (hit < 0) return { ok: false, why: 'no way to their land' };
  const path = []; for (let c = hit; c !== -1 && !mine.has(c); c = prev.get(c)) path.unshift(c);
  const n = G.clone(G.S.nation); delete n.lcp; G.commit(n);
  const ok = path.length ? G.LK.writeClaims(path, '') : true;
  const T2 = G.territory();
  return { ok, n: path.length, borders: [...G.JV().bordersOf(T2, T2.byId[G.myId()])].map(i => T2.list[i].id) };
}, ground.id);
check('the land between is claimed, and the two share a border', claimed.ok && claimed.borders.includes(ground.id), JSON.stringify(claimed));

/* only a Registered Nation proposes */
await tab(A);
check('the Diplomacy page has a Ventures tab', /Propose a joint venture/.test(await text(A, '#dp-p-ventures')));
await A.selectOption('#jv-to', ground.id); await sleep(300);
check('the computer neighbour is offered as a partner', await A.evaluate(id => G.JV().jvNeighbours(G.territory()).some(x => x.id === id), ground.id));
check('a guest is told to link a sign-in first', /Registered Nation/.test(await text(A, '#dp-p-ventures .dpt-note')) && await A.$eval('[data-act="jv-offer"]', b => b.disabled));
await register(A, { old: true });
/* close to the computer nation's values, and enough in store for a half */
await A.evaluate(id => { const x = G.JV().findNation(id), n = G.clone(G.S.nation); n.s = { ...n.s, civil: x.n.s.civil, econ: x.n.s.econ, pol: x.n.s.pol }; n.gw = { ...(n.gw || {}), [id]: 10 }; G.commit(n); }, ground.id);
await setStock(A, { food: 380, timber: 380, iron: 380, oil: 50, goods: 380 });
await tab(A); await A.selectOption('#jv-to', ground.id); await sleep(300);
const site = await text(A, '.jv-site');
check('the route is found: from a city of yours to one of theirs', /^From .+ to .+ in .+: \d+ hex/.test(site), JSON.stringify({ site, note: await text(A, '#dp-p-ventures .dpt-note') }));
check('each side’s half is shown with the kind', /Each side pays 250 food120 iron20 goods|250\s*food.*120\s*iron.*20\s*goods/.test((await text(A, '#dp-p-ventures .dpt-kind.on')).replace(/\s+/g, ' ')), await text(A, '#dp-p-ventures .dpt-kind.on'));
await A.screenshot({ path: path.join(OUT, 'ventures-propose.png'), fullPage: false });
const s0 = await stock(A);
await A.click('[data-act="jv-offer"]');
const filed = await until(async () => (await ventures()).find(v => v.a === uidA && v.b === ground.id), 30000);
check('the computer nation agrees at once: the venture is filed and being built', filed && filed.st === 'active' && filed.npc && filed.k === 'road', JSON.stringify(filed));
check('the player is told', await toastHas(A, /agreed\. Work on the border road has begun/));
const s1 = await stock(A);
/* registering can bring a rank gift (RANK_GIFT: 15 iron and 15 goods) in the same save, so iron and goods allow for it */
check('the half left the stockpile', s0.iron - s1.iron >= 103 && s0.food - s1.food >= 240 && s0.goods - s1.goods >= 3, JSON.stringify({ s0, s1 }));
check('and is spent, counted for the achievements', await until(() => A.evaluate(() => !G.JV().jvEntries(G.S.nation).length && (G.S.nation.tly || {}).jvj === 1), 15000));
check('Common Ground is earned', await until(() => A.evaluate(() => !!(G.S.nation.ach || {})['dip-jv1']), 15000));
await tab(A);
check('it is listed as being built', /Being built/.test(await text(A, '#dp-p-ventures')));

/* built: the cities at both ends work more, and deals between the two flow more */
await adminWrite('ventures/' + filed.id, { d: Date.now() - 1000 }, true);
check('once built it is open', await until(() => A.evaluate(id => { const V = G.JV().JV.docs.get(id); return !!V && G.JV().jvState(V, G.territory(), Date.now()) === 'open'; }, filed.id), 20000));
const fx = await A.evaluate(id => { const V = G.JV().JV.docs.get(id), T = G.territory(), cs = G.JV().cityState(T).all.find(c => c.c === V.ca); return { jv: cs && cs.jv, flow: G.JV().jvFlow(V.a, V.b, T) }; }, filed.id);
check('the city at this end works 4% more', fx.jv === 0.04, JSON.stringify(fx));
check('deals between the two flow 5% more', Math.abs(fx.flow - 1.05) < 1e-9, JSON.stringify(fx));
await tab(A);
check('the tab says it is open and what it gives', /Open: \+4% output in the city at each end/.test(await text(A, '#dp-p-ventures')));
await nav(A, 'map');
await A.evaluate(id => { const V = G.JV().JV.docs.get(id); G.MD.centerMain(V.path[Math.floor(V.path.length / 2)], 14); G.render(); }, filed.id); await sleep(800);
await A.locator('canvas[data-map="main"]').screenshot({ path: path.join(OUT, 'ventures-map.png') });
check('the map draws it without an error', !errors.length, JSON.stringify(errors));

/* a venture filed before the frontier (19 Nov 2026) keeps its route by the charted map's numbers on the server: read as
   it stood, every step north or south leapt across most of a row, and it was drawn cut, in red dashes from edge to edge.
   The same road filed that way is read on its own hexes, and open. */
const was = await A.evaluate(id => { const V = G.JV().JV.docs.get(id), ch = G.MAP.chart; if (!ch) return null;
  return { k: V.k, p: V.p, a: V.a, b: V.b, f: V.f, ca: ch[V.ca], cb: ch[V.cb], path: V.path.map(c => ch[c]), here: V.path }; }, filed.id);
check('the region has grown past its charted map', !!was && was.path.every(c => c >= 0) && was.path.some((c, i) => c !== was.here[i]), JSON.stringify(was));
const vOld = uidA + '_oldmap01', before = Date.UTC(2026, 10, 18), reg0 = await A.evaluate(() => G.S.nation.reg);
await adminWrite('ventures/' + vOld, { k: was.k, reg: reg0, p: was.p, a: was.a, b: was.b, ca: was.ca, cb: was.cb, path: was.path, st: 'active', t: before, at: before, d: before + 1000, f: was.f, npc: true });
check('a venture filed on the charted map lies on its own hexes, open, not cut', await until(() => A.evaluate(([id, here]) => { const V = G.JV().JV.docs.get(id);
  return !!V && JSON.stringify(V.path) === JSON.stringify(here) && G.JV().jvState(V, G.territory(), Date.now()) === 'open'; }, [vOld, was.here]), 20000),
  JSON.stringify(await A.evaluate(id => { const V = G.JV().JV.docs.get(id); return V ? { path: V.path, st: G.JV().jvState(V, G.territory(), Date.now()) } : null; }, vOld)));
const del = await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/ventures/${vOld}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
check('and it is taken away again', del.ok && await until(() => A.evaluate(id => !G.JV().JV.docs.has(id), vOld), 20000));

/* ended with notice: open for three more days, and goodwill with the other side is lost */
const gw0 = await A.evaluate(id => (G.S.nation.gw || {})[id] || 0, ground.id);
await tab(A);
await A.click('[data-act="jv-end-ask"]'); await sleep(200);
check('ending asks first, and says what it costs', /lose 10 goodwill/.test(await text(A, '#dp-p-ventures .dpt-brk')));
await A.click('[data-act="jv-end"]');
check('the venture is ending', await until(async () => (await ventures()).find(v => v.id === filed.id)?.st === 'ending', 15000));
check('goodwill with the computer nation fell by 10', await until(() => A.evaluate(([id, g]) => ((G.S.nation.gw || {})[id] || 0) === g - 10, [ground.id, gw0]), 10000));

/* a half the server refuses for good comes back: a proposal to a nation of another region */
const other = await A.evaluate(() => { const T = G.territory(); return T.list.find(x => x.npc).id; });
const s2 = await stock(A);
await A.evaluate(([to, c]) => { const n = G.clone(G.S.nation); n._jv = { id: 'zzzz0001', w: 'a', k: 'bridge', to: 'npc-nowhere', ca: c, cb: c + 1, path: [c, c + 1] }; G.commit(n); G.PG.saveSoon(); }, [other, ground.c]);
const sP = await stock(A);
check('the half is taken when it is packed', await A.evaluate(() => G.JV().jvEntries(G.S.nation).some(e => e.id === 'zzzz0001')) && s2.timber - sP.timber >= 118, JSON.stringify({ s2, sP }));
await until(() => A.evaluate(() => { G.JV().jvTick(); return !G.JV().jvEntries(G.S.nation).some(e => e.id === 'zzzz0001'); }), 60000, 2000);
const s3 = await stock(A);
check('refused for good, it comes back to the stockpile', !(await A.evaluate(() => G.JV().jvEntries(G.S.nation).length)) && s3.timber >= s2.timber - 2 && s3.iron >= s2.iron - 2, JSON.stringify({ s2, s3 }));

/* an offer from another player: shown waiting, and accepted with this nation's own half */
const B = await player('proposer');
const uidB = await open(B); await found(B, 'Offerland');
await until(() => A.evaluate(id => G.allNations().some(x => x.id === id), uidB), 30000);
const reg = await A.evaluate(() => G.S.nation.reg), now = Date.now(), vid = uidB + '_bbbb0001';
await adminWrite('ventures/' + vid, { k: 'bridge', reg, p: [uidA, uidB].sort(), a: uidB, b: uidA, ca: ground.c + 1, cb: ground.c, path: [ground.c + 1, ground.c], st: 'offered', t: now, x: now + 2 * 86400000, f: {} });
await setStock(A, { food: 380, timber: 380, iron: 380, oil: 50, goods: 380 });
check('the offer waits for an answer, on the tab’s badge', await until(() => A.evaluate(() => G.JV().jvIncoming().length === 1), 20000));
await tab(A);
check('with its cost and an Accept button', /Offerland/.test(await text(A, '#dp-p-ventures')) && /Accept and pay my half/.test(await text(A, '#dp-p-ventures')));
await A.screenshot({ path: path.join(OUT, 'ventures-offer.png') });
const s4 = await stock(A);
await A.click(`[data-act="jv-yes"][data-id="${vid}"]`);
check('accepted, it is being built', await until(async () => (await ventures()).find(v => v.id === vid)?.st === 'active', 30000));
const s5 = await stock(A);
/* a rank reached in the same save brings 15 iron and 15 goods (RANK_GIFT), so iron may come back by that much */
check('this side paid the bridge’s half', s4.timber - s5.timber >= 118 && s4.iron - s5.iron >= 58 - 15, JSON.stringify({ s4, s5 }));
check('and the half is spent, with a venture with a player counted', await until(() => A.evaluate(() => !G.JV().jvEntries(G.S.nation).length && (G.S.nation.tly || {}).jvpl === 1), 15000));

await finish();
