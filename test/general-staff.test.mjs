// The General Staff (28 Nov 2026; game/edictum.html, "the General Staff"): the owner's military building that raises
// the hexes an army may take in any 24 hours from 16 to 21, and to 26 as High Command (tier II), at 25 million people.
// The game's own section, cut from its source and run in a context of its own, checked against the referee's half
// (functions/war-rules.js conqCapOf, gsTier, milReady) and the referee's battle (functions/index.js).
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conqCapOf, gsTier, milReady, raidOf, CONQ_BASE, CONQ_STEP, CONQ_SLACK, GS_BLITZ } from '../functions/war-rules.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const referee = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const SEC = cut('/* ───────── the General Staff (28 November 2026) ─────────', "/* ───────── the General Staff's edicts");
const EDI = cut("/* ───────── the General Staff's edicts", '\nif(hot&&typeof hot.snapshot');
const CONQ = cut('function conqCap(n,now){', '\n/* clicks and tips go to what is drawn on top');
const DAY = 864e5, H = 36e5, NOW = 1_800_000_000_000;
const J = v => JSON.parse(JSON.stringify(v));

/* the section with the game around it stubbed; T is the territory the player's game sees */
function load(o = {}) {
  const ctx = {
    DAY, Math, Date, Object, Array, Number, JSON, String, isFinite, console, FIX_EPOCH: 0,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), esc: s => String(s), c3Until: t => 'T' + t, fmtDur: ms => Math.round(ms / 60000) + ' min',
    BUILDINGS: { barracks: { n: 'Barracks' }, armoury: { n: 'Arsenal' } }, BTIER: {}, MILESTONES: [20, 25, 30].map(p => ({ p })), DC_GLYPH: {}, BLD_ICO: {},
    COMMIT_HOOKS: [], NORM_HOOKS: [], BATTLE_MODS: [], NOTIF_SOURCES: [], VS: [], ACH: [], ISSUES: [], ISSUE_BY_ID: {}, window: {}, S: { nation: null }, OBS: false,
    dcFlag() {}, cellOf: l => (Number.isInteger(l) ? l : -1), myId: () => 'me', T: null, territory() { return ctx.T; },
    cityList: n => (n && n.cities) || [], cityLabel: (n, c) => c.nm || 'Capital', popNow: n => n.pop,
    cxTier: (b, now) => (b.tu && b.tu.d <= now ? { t: b.tu.l, ln: b.tu.ln } : { t: b.tr || 1, ln: b.ln || '' }), cxBldExtras: b => ({ tu: b.tu }),
    bTierLine: (k, t, ln) => ctx.BTIER[k] && ctx.BTIER[k][t] ? ctx.BTIER[k][t].lines[ln] || Object.values(ctx.BTIER[k][t].lines)[0] : null,
    tierProblem: () => null, readyMs: () => 15 * 60000, bldGain: () => ({ x: [] }),
    lndList: n => (n && n.lnd) || [], LND_RULES: { hWin: DAY }, wrWarsOf: () => ctx.FOES || [], findNation: id => (ctx.WORLD || {})[id] || null,
    vsAdd: (k, f) => { ctx.VS.push([k, f]); return f; }, achDef: (...a) => ctx.ACH.push(a), ...o
  };
  vm.createContext(ctx);
  vm.runInContext([SEC, EDI, CONQ].join('\n').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
  return ctx;
}
const city = (id, c, b) => ({ id, c, nm: id === 'cap' ? '' : 'Fort ' + id, b });
const gs = (extra = {}) => ({ k: 'staffhq', s: NOW - 2 * DAY, d: NOW - DAY, ...extra });
const nation = cities => ({ name: 'Ostra', founded: 1, seed: 's', loc: 0, pop: 30, cities, log: [], conq: [] });
/* a territory where the player (index 0) holds the cells given */
const terr = cells => ({ byId: { me: 0 }, owner: Object.assign([], ...cells.map(c => ({ [c]: 0 }))), list: [{ id: 'me', me: true }] });

test('the building: Defence, one per nation, a Barracks and an Arsenal first, materials, unlocked at 25 million', () => {
  const c = load(), B = c.BUILDINGS.staffhq;
  assert.equal(B.n, 'General Staff');assert.equal(B.c, 'def');assert.equal(B.one, 1);assert.deepEqual([...B.needB], ['barracks', 'armoury']);
  assert.ok(Object.keys(B.cost).every(r => ['food', 'timber', 'iron', 'oil', 'goods'].includes(r)) && B.cost.iron >= 50, 'it costs materials');
  assert.deepEqual(J(B.up), { iron: 2, oil: 1 });assert.equal(B.mood, -3);assert.equal(B.army, 0.025);assert.equal(B.ugx, 1, 'it takes upgrades');
  assert.deepEqual(J(c.MILESTONES.find(m => m.p === 25).b), ['staffhq'], 'it opens with the 25-million milestone');
  assert.match(c.BLD_ICO.staffhq, /^<path /);
  const calls = [];c.DC_GLYPH[B.icon].f(new Proxy({}, { get: (t, m) => (...a) => calls.push(m) }), 0);assert.ok(calls.length >= 6, 'it is drawn in the skyline');
  const T2 = c.BTIER.staffhq[2];assert.equal(T2.n, 'High Command');assert.deepEqual(Object.keys(T2.lines), ['blitz', 'occupy', 'combined']);
  for (const L of Object.values(T2.lines)) { assert.equal(L.army, 0.05, L.n + ': army +5%, what gold tier I gives');assert.deepEqual(J(L.up), { iron: 4, oil: 2 });assert.equal(L.mood, -3); }
  assert.ok(T2.cost.iron >= 100 && T2.h === 24 && T2.ug === 2, 'the retool is dear');
  assert.equal(c.tierProblem({ pop: 24 }, {}, 'staffhq', {}, NOW), 'High Command needs 25 million people.');
  assert.equal(c.tierProblem({ pop: 25 }, {}, 'staffhq', {}, NOW), null);assert.equal(c.tierProblem({ pop: 1 }, {}, 'factory', {}, NOW), null, 'other retools as before');
});

test('the cap: 16, 21 with a General Staff, 26 with High Command; the map reads the periods on the record', () => {
  const c = load();
  assert.deepEqual([0, 1, 2, 3].map(c.gsCapOf), [16, 21, 26, 26]);
  const n = { gsp: [{ a: 100, b: 200, l: 1 }, { a: 200, l: 2 }, { a: 5, b: 3, l: 1 }, { a: 'x', l: 1 }] };
  assert.equal(c.gsPeriods(n).length, 2, 'a period that ends before it begins, or without a start, is dropped');
  assert.deepEqual([50, 100, 199, 200, 1e9].map(t => c.gsCapAt(n, t)), [16, 21, 21, 26, 26]);
  assert.equal(c.gsCapAt(null, 1), 16);
  /* the map's replay and the record check use the cap of each conquest's day */
  assert.match(src, /if\(q\.length>=\(typeof gsCapAt==='function'\?gsCapAt\(sx&&sx\.n,e\.t\):16\)\)continue;/);
  assert.match(src, /const k=i-j\+1,c=typeof gsCapAt==='function'\?gsCapAt\(n,t\[i\]\):16;if\(k-c>most-cap\)\{most=k;cap=c;\}\}if\(most>cap\)why\.push\(`It has \$\{most\} conquests within a day; the game allows \$\{cap\}\.`\)/);
  /* and the cleaned periods survive a load */
  const m = {};c.NORM_HOOKS[0](m, n);assert.deepEqual(J(m.gsp), [{ a: 100, b: 200, l: 1 }, { a: 200, l: 2 }]);
});

test('a save writes the periods: from the day it was finished, a tier from its retool, an end when the city is lost', () => {
  const c = load(), hook = c.COMMIT_HOOKS[0];
  let n = nation([city('cap', 0, [gs()])]);c.S.nation = n;c.T = terr([0]);
  let out = hook(n, n, NOW);
  assert.deepEqual(J(n.gsp), [{ a: NOW - DAY, l: 1 }], 'the first period from when it was finished, never before');
  assert.equal(n.log[0].k, 'gsopen');assert.equal(n.log[0].t, NOW - DAY);assert.match(out[0], /21 hexes in any 24 hours instead of 16/);
  assert.equal(hook(n, n, NOW + H).length, 0, 'nothing more while nothing changes');assert.equal(n.gsp.length, 1);
  /* the retool done at NOW + 2h: the save after it reads the time from the record before it */
  const old = JSON.parse(JSON.stringify(n));old.cities[0].b[0].tu = { l: 2, ln: 'blitz', s: NOW, d: NOW + 2 * H };
  n = JSON.parse(JSON.stringify(n));n.cities[0].b[0].tr = 2;n.cities[0].b[0].ln = 'blitz';c.S.nation = n;
  out = hook(n, old, NOW + 5 * H);
  assert.deepEqual(J(n.gsp), [{ a: NOW - DAY, b: NOW + 2 * H, l: 1 }, { a: NOW + 2 * H, l: 2 }], 'High Command from when the retool was done');
  assert.equal(n.log[0].k, 'gs2');assert.equal(n.log[0].b, 'Blitz Command');assert.match(out[0], /High Command, Blitz Command: your army may take 26 hexes/);
  /* the city falls: the period ends at that save, and the past is left as it was */
  c.T = terr([]);hook(n, n, NOW + 9 * H);
  assert.deepEqual(J(n.gsp), [{ a: NOW - DAY, b: NOW + 2 * H, l: 1 }, { a: NOW + 2 * H, b: NOW + 9 * H, l: 2 }]);
  assert.equal(c.gsCapAt(n, NOW + 8 * H), 26);assert.equal(c.gsCapAt(n, NOW + 10 * H), 16);
  /* won back: from that save, not backdated, and no news again */
  c.T = terr([0]);const logs = n.log.length;hook(n, n, NOW + 30 * H);
  assert.deepEqual(J(n.gsp[2]), { a: NOW + 30 * H, l: 2 });assert.equal(n.log.length, logs, 'the Dispatch heard it the first time');
  assert.equal(c.gsCapAt(n, NOW + 20 * H), 16, 'the day it was lost stays at 16');
});

test('the attack gate: the nation’s own cap, a landing twice unless Combined Operations', () => {
  const c = load(), conq = k => Array.from({ length: k }, (_, i) => ({ c: 100 + i, t: NOW - i * 60000, d: 'foe' }));
  let n = nation([city('cap', 0, [])]);n.conq = conq(17);c.S.nation = n;c.T = terr([0]);
  assert.match(c.conqCap(n, NOW), /^Your army has taken 16 hexes in the last 24 hours/);
  n = nation([city('cap', 0, [gs()])]);n.conq = conq(17);c.S.nation = n;
  assert.equal(c.conqCap(n, NOW), '', 'a General Staff: room for 21');
  n.conq = conq(21);assert.match(c.conqCap(n, NOW), /^Your army has taken 21 hexes/);assert.match(c.conqCap(n, NOW), /possible in \d+ min/);
  c.T = terr([]);assert.match(c.conqCap(n, NOW), /taken 16 hexes/, 'not while the city is lost');c.T = terr([0]);
  /* the day's count with a landing: twice, or once with Combined Operations */
  n.conq = conq(10).concat([{ c: 5, t: NOW - 30 * 60000, d: 'foe' }, { c: 6, t: NOW - 20 * 60000, d: 'foe' }]);n.lnd = [{ k: 'h', cl: [5, 6], a: NOW - H }];
  assert.equal(c.gsDay(n, NOW).k, 14);
  n.cities[0].b[0] = gs({ tr: 2, ln: 'combined' });assert.equal(c.gsDay(n, NOW).k, 12);assert.equal(c.gsDay(n, NOW).cap, 26);
  assert.match(c.gsMeter(n, NOW), /Hexes taken in the last 24 hours: <b>12 of 26<\/b> \(your High Command\)/);
  /* the landing section's own gate reads the same cap */
  assert.match(src, /if\(typeof gsCombined==='function'&&gsCombined\(n,now\)\)return r;const cap=typeof gsCap==='function'\?gsCap\(n,now\):16;/);
});

test('each hex past the sixteenth in a day adds to war weariness', () => {
  const c = load(), n = { wwy: 10, conq: Array.from({ length: 16 }, (_, i) => ({ c: i, t: NOW - i * H })) };
  c.gsWeary(n, NOW);assert.equal(n.wwy, 10, 'sixteen: as before');
  n.conq.push({ c: 99, t: NOW });c.gsWeary(n, NOW);assert.equal(n.wwy, 11);
  n.conq.push({ c: 98, t: NOW, n: 'them' });c.gsWeary(n, NOW);assert.equal(n.wwy, 12, 'a hex struck back is not the army’s');
  assert.match(src, /n\.conq=dedupeConq\(n\.conq\);n\.log=n\.log\.slice\(0,60\);if\(win&&!raid\)gsWeary\(n,now\);/);
});

test('the lines: Blitz Command readies sooner, Occupation Command holds new land, as the referee reads them', () => {
  /* readyMs reads the real clock: a building finished yesterday */
  let n = nation([city('cap', 0, [gs({ tr: 2, ln: 'blitz', s: Date.now() - 2 * DAY, d: Date.now() - DAY })])]);const c = load();c.S.nation = n;c.T = terr([0]);
  assert.equal(c.readyMs(n), Math.round(15 * 60000 * 0.9));
  c.T = terr([]);assert.equal(c.readyMs(n), 15 * 60000, 'not from a lost city');
  /* Occupation Command: land its nation took in the last day */
  const foe = { id: 'foe', n: nation([city('cap', 7, [gs({ tr: 2, ln: 'occupy', s: Date.now() - 2 * DAY, d: Date.now() - DAY })])]) }, T = { list: [{ id: 'me', n: {} }, foe], owner: { 7: 1, 9: 1 }, occ: { 9: 1 }, tk: { 9: Date.now() - H } };
  const mod = c.BATTLE_MODS[0];assert.equal(mod(T, 9, 0, 1).def, 1.15);assert.match(mod(T, 9, 0, 1).note, /Occupation Command holds the land it took in the last day 15% the stronger/);
  T.tk[9] = Date.now() - 2 * DAY;assert.equal(mod(T, 9, 0, 1), null, 'older land as before');
  T.tk[9] = Date.now() - H;foe.n.cities[0].b[0].ln = 'blitz';assert.equal(mod(T, 9, 0, 1), null, 'only that line');
  /* the referee: the same tiers and cap from the record, whoever holds the city; Blitz Command's cut last */
  for (const [b, t, cap] of [[null, 0, 16], [gs(), 1, 21], [gs({ d: NOW + H }), 0, 16], [gs({ tr: 2, ln: 'occupy' }), 2, 26], [gs({ tu: { l: 2, ln: 'blitz', s: NOW - DAY, d: NOW - H } }), 2, 26], [gs({ tu: { l: 2, ln: 'blitz', s: NOW - H, d: NOW + H } }), 1, 21]]) {
    const rec = nation([city('cap', 0, b ? [b] : [])]);
    assert.equal(gsTier(rec, NOW).t, t);assert.equal(conqCapOf(rec, NOW), cap);
    const L = load();L.S.nation = null;assert.equal(L.gsBest(rec, NOW).l, t, 'the game reads the same tier');
  }
  assert.deepEqual([CONQ_BASE, CONQ_STEP, CONQ_SLACK, GS_BLITZ], [16, 5, 2, 0.1]);
  assert.equal(milReady(nation([city('cap', 0, [gs({ tr: 2, ln: 'blitz' })])]), NOW).bcut, 0.1);assert.equal(milReady(nation([city('cap', 0, [gs()])]), NOW).bcut, 0);
});

test('the referee refuses a battle past the cap, counting its own log of land taken, with room to spare', () => {
  assert.match(referee, /const lim = conqCapOf\(mine, now\), day = await tx\.get\(armyRef\.collection\('log'\)\.where\('t', '>=', now - 86400000\)\);/);
  assert.match(referee, /if \(day\.docs\.filter\(s => s\.get\('q'\) === 1\)\.length >= lim \+ CONQ_SLACK\) return \{ ok: false, why: 'cap', cap: lim \};/);
  assert.match(referee, /const took = win && \(npc \|\| !raidOf\(mine, uid, recs\[d\], d, now\)\);/);
  assert.match(referee, /\.\.\.\(took \? \{ q: 1 \} : \{\}\) \}\);/);
  assert.ok(referee.indexOf("why: 'cap'") < referee.indexOf('tx.set(armyRef'), 'read before anything is written');
  const t = 1e12, mine = { wars: { b: { t, g: 'r' } } };
  assert.equal(raidOf(mine, 'a', {}, 'b', t + H), true);assert.equal(raidOf({ wars: { b: { t, g: 'c' } } }, 'a', {}, 'b', t + H), false);assert.equal(raidOf(mine, 'a', null, 'npc-1', t + H), false);
  assert.match(src, /S\.warMsg=why==='cap'\?`The referee counts \$\{Number\(res\.cap\)\|\|16\} hexes taken in the last 24 hours\./);
});

test('rivals see it: the attack panel, the visit page, the Dispatch and a notice to its enemies', () => {
  const c = load(), foe = { id: 'foe', n: { ...nation([]), name: 'Vesad', gsp: [{ a: NOW - H, l: 1 }], log: [{ t: Date.now() - H, k: 'gsopen', a: 'Fort x', b: '' }] } };
  const visit = c.VS.find(v => v[0] === 'ter')[1]({ id: 'foe', n: foe.n }, NOW);
  assert.match(visit, /General Staff<\/h2><p>Vesad’s army may take up to <b>21 hexes<\/b> in any 24 hours, where most may take 16\./);
  c.FOES = [{ id: 'foe', g: 'c' }];c.WORLD = { foe };
  const notes = c.NOTIF_SOURCES[0](nation([]), Date.now());
  assert.equal(notes.length, 1);assert.match(notes[0].txt, /^Vesad, at war with you, has opened a General Staff: its army may now take up to 21 hexes in any 24 hours\.$/);
  c.FOES = [];assert.equal(c.NOTIF_SOURCES[0](nation([]), Date.now()).length, 0, 'only to its enemies');
  assert.match(src, /notes\.push\(`\$\{x\.n\.name\} has a \$\{gsName\(l\)\}: its army may take up to \$\{gsCapOf\(l\)\} hexes in any 24 hours\.`\)/);
  assert.match(src, /else if\(l\.k==='gsopen'\|\|l\.k==='gs2'\)\{/);
  assert.match(src, /\$\{gsMeter\(S\.nation\)\}`;/);assert.match(src, /\$\{gsMeter\(S\.nation\)\}<\/section>`;/);
});

test('honours, two edicts after every other, and the Help page', () => {
  const c = load();
  const a = c.ACH.find(x => x[1] === 'war-gs21'), b = c.ACH.find(x => x[1] === 'war-gs2');
  assert.equal(a[3], 'Twenty-One Guns');assert.equal(b[3], 'Supreme Command');
  const day = Array.from({ length: 22 }, (_, i) => ({ c: i, t: NOW - i * H }));
  assert.equal(a[6]({ n: { conq: day } }), 21);assert.equal(a[6]({ n: { conq: day.slice(0, 5) } }), 5);
  assert.equal(b[6]({ n: { gsp: [{ a: 1, l: 2 }] } }), 1);assert.equal(b[6]({ n: nation([]) }), 0);
  assert.deepEqual(c.ISSUES.map(i => i.id), ['gs-parade', 'gs-command']);
  for (const is of c.ISSUES) { assert.equal(is.o.length, 3);assert.ok(is.fo === 1 && is.nbx === false && typeof is.req === 'function'); }
  assert.equal(c.ISSUES[0].req({}), false);assert.equal(c.ISSUES[0].req({ gsp: [{ a: 1, l: 1 }] }), true);assert.equal(c.ISSUES[1].req({ gsp: [{ a: 1, l: 1 }] }), false);
  const pushes = [...src.matchAll(/ISSUES\.push\(/g)].map(m => m.index);
  assert.equal(pushes[pushes.length - 1], src.indexOf('for(const is of GS_ISSUES){is.fo=1;ISSUES.push(is)') + 'for(const is of GS_ISSUES){is.fo=1;'.length, 'the last edicts added');
  assert.match(readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'GS_ISSUES'/);
  assert.match(src, /a General Staff raises that to 21, and High Command to 26\.<\/p>/);
  assert.match(src, /At 25 million people a <b>General Staff<\/b>/);
});
