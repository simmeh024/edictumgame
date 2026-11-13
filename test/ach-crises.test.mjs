// Achievements for crises and gambles (game/edictum.html, 13 November 2026): 13 for crises, 13 for gambles, and what
// the lifetime tally keeps of them (crsTally, called from tallyScan for each new ruling).
// The section runs here as written, with the game's own odds, topics and aAns, against made-up crises and gambles.
//   node --test test/ach-crises.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const START = '/* ───────── achievements for crises and gambles', END = '/* ── the sound of a decision ── */';
const at = html.indexOf(START), end = html.indexOf(END, at);
assert.ok(at > 0 && end > at, 'the section');
const BLOCK = html.slice(at, end);
const line = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const HOUR = 3600e3;

/* the real crises and gambles, read from the page: each crisis's topic, and the odds of every gamble motion */
const CRS_SRC = html.slice(html.indexOf('const CRS_ISSUES=['), html.indexOf('const GMB_ISSUES=['));
const GMB_SRC = html.slice(html.indexOf('const GMB_ISSUES=['), html.indexOf('for(const is of CRS_ISSUES)'));
const realTopics = [...CRS_SRC.matchAll(/\{id:'(crs-[a-z0-9-]+)',c:'([a-z]+)'/g)].map(m => m[2]);
const realOdds = new Set([...(CRS_SRC + GMB_SRC).matchAll(/g:\{p:([0-9.]+)/g)].map(m => Math.round(+m[1] * 100)));

/* made-up stand-ins: 30 crises, three to a topic, each with a gamble at one of the six odds; and plain gambles */
const ODDS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8];
function world() {
  const ctx = vm.createContext({ Math, Object, Set, Array, Number });
  vm.runInContext(line(/const ISSUE_TOPICS = \[.*\];/) + '\n' + line(/const GMB_ODDS=\{[^}]+\};/) + '\n' + line(/const aAns=\(x,f\)=>.*;/) + '\nthis.T={ISSUE_TOPICS,GMB_ODDS,aAns};', ctx);
  const { ISSUE_TOPICS } = ctx.T, ISSUE_BY_ID = {}, CRS_ISSUES = [], A = {};
  ISSUE_TOPICS.forEach(([c], t) => { for (let k = 0; k < 3; k++) { const id = `crs-${c}-${k}`, is = { id, c, crs: 1, o: [{}, { g: { p: ODDS[(t * 3 + k) % 6] } }, {}] }; CRS_ISSUES.push(is); ISSUE_BY_ID[id] = is; } });
  for (const p of ODDS) ISSUE_BY_ID['risk-' + p] = { id: 'risk-' + p, c: 'econ', o: [{}, { g: { p } }] };
  Object.assign(ctx, {
    ISSUE_BY_ID, CRS_ISSUES, aT: (x, k) => (x.n.tly && x.n.tly[k]) || 0,
    crsDeadline: (n, x) => x.at + 12 * HOUR,
    achDef: (c, id, t, n, d, g, f, o) => { assert.ok(!A[id], 'defined twice: ' + id); A[id] = { c, id, t, n, d, g, f, o: o || {} }; }
  });
  vm.runInContext(BLOCK + '\nthis.X={crsTally,gmbPct,GMB_PCT};', ctx);
  return { A, ISSUE_BY_ID, CRS_ISSUES, ISSUE_TOPICS, ...ctx.X };
}
const W = world();
/* the tally as tallyScan keeps it: bump adds, put sets */
function scan(rulings, old) {
  const T = {}, bump = (k, t, by) => { T[k] = (T[k] || 0) + (by || 1); }, put = (k, v) => { T[k] = v; };
  for (const a of rulings) W.crsTally(a, W.ISSUE_BY_ID[a.id], old, T, bump, put);
  return T;
}
const val = (id, n) => +W.A[id].f({ n, me: true }) || 0;
const earned = (id, n) => val(id, n) >= W.A[id].g;
const crs = (k = 0, c = 'econ') => `crs-${c}-${k}`;

test('26 achievements: 13 for crises, 13 for gambles, all under Lawmaking, with names and ids of their own', () => {
  const ids = Object.keys(W.A);
  assert.equal(ids.length, 26);
  assert.equal(ids.filter(i => i.startsWith('cri-')).length, 13); assert.equal(ids.filter(i => i.startsWith('gam-')).length, 13);
  assert.ok(Object.values(W.A).every(a => a.c === 'law' && a.d.length > 10 && a.d.endsWith('.')));
  const per = {}; for (const a of Object.values(W.A)) per[a.t] = (per[a.t] || 0) + 1;
  assert.deepEqual(per, { b: 7, s: 10, g: 5, p: 3, x: 1 });
  assert.equal(Object.values(W.A).reduce((s, a) => s + TIER[a.t], 0), 1070);
  /* nowhere else in the game: not the ids, not the names */
  const all = [...html.matchAll(/achDef\('[a-z]+','([a-z0-9-]+)','[bsgpxo]','((?:[^'\\]|\\.)+)'/g)];
  for (const a of Object.values(W.A)) {
    assert.equal(all.filter(m => m[1] === a.id).length, 1, a.id);
    assert.equal(all.filter(m => m[2] === a.n).length, 1, a.n);
  }
  assert.equal(new Set(all.map(m => m[1])).size, all.length, 'every achievement id in the game is unique');
  /* the four that are a joke stay secret until earned, with a hint */
  assert.deepEqual(Object.values(W.A).filter(a => a.o.sec).map(a => a.id).sort(), ['cri-cab10', 'cri-late', 'gam-cold', 'gam-sure']);
});

test('the goals can be reached with the crises and gambles there are', () => {
  assert.equal(realTopics.length, 30, 'thirty crises');
  assert.equal(W.A['cri-all'].g, W.CRS_ISSUES.length);
  assert.match(html, /achDef\('law','cri-all','p','Seen It All Before','Decide every one of the '\+CRS_ISSUES\.length\+' crises yourself/);
  for (const [k] of W.ISSUE_TOPICS) assert.ok(realTopics.includes(k), 'a crisis about ' + k);
  assert.equal(W.A['cri-topics'].g, 10);
  assert.deepEqual([...W.GMB_PCT].sort((a, b) => a - b), [25, 33, 50, 67, 75, 80]);
  for (const k of W.GMB_PCT) assert.ok(realOdds.has(k), 'a gamble at ' + k + ' in a hundred');
  assert.equal(W.A['gam-odds'].g, 6);
  /* each ladder climbs */
  const step = ids => ids.map(i => W.A[i].g).every((g, i, a) => !i || g > a[i - 1]);
  assert.ok(step(['cri-1', 'cri-10', 'cri-30', 'cri-75', 'cri-150']) && step(['gam-1', 'gam-10', 'gam-30', 'gam-75']) && step(['gam-hot', 'gam-hot5']));
});

test('a crisis decided by the player: counted, by topic and by crisis, fast or late, and the run goes on', () => {
  const now = 1.8e12, x = id => ({ id, at: now - 5 * 60000, cr: 1 }), old = { inbox: [x(crs(0)), { id: crs(1), at: now - 11.5 * HOUR, cr: 1 }] };
  const T = scan([{ id: crs(0), o: 0, t: now }, { id: crs(1), o: 2, t: now + 1000 }], old);
  assert.equal(T.crs, 2); assert.equal(T['crs:c:econ'], 2); assert.equal(T['crs:i:' + crs(0)], 1);
  assert.equal(T['crs:fast'], 1, 'five minutes after it arrived'); assert.equal(T['crs:late'], 1, 'half an hour before the clock ran out');
  assert.equal(T['crs:run'], 2); assert.equal(T['crs:best'], 2);
  const n = { tly: T, answered: [] };
  for (const id of ['cri-1', 'cri-fast', 'cri-late']) assert.ok(earned(id, n), id);
  assert.ok(!earned('cri-10', n) && !earned('cri-cab', n));
  /* with no record of when it arrived (a fresh tally), neither fast nor late */
  const T2 = scan([{ id: crs(0), o: 0, t: now }], null);
  assert.equal(T2.crs, 1); assert.equal(T2['crs:fast'], undefined); assert.equal(T2['crs:late'], undefined);
  /* an hour and a minute before the deadline is not late; nine minutes after arriving is still fast */
  const T3 = scan([{ id: crs(0), o: 0, t: now }], { inbox: [{ id: crs(0), at: now - 9 * 60000, cr: 1 }] });
  const T4 = scan([{ id: crs(0), o: 0, t: now }], { inbox: [{ id: crs(0), at: now - 12 * HOUR + HOUR + 60000, cr: 1 }] });
  assert.equal(T3['crs:fast'], 1); assert.equal(T4['crs:late'], undefined); assert.equal(T4['crs:fast'], undefined);
});

test('a crisis the cabinet signed: counted apart, and it ends the run', () => {
  const r = (k, c) => ({ id: crs(k), o: 1, t: 1e12 + k, ...(c ? { c: 1 } : {}) });
  const T = scan([r(0), r(1), r(2), r(0, 1), r(1)]);
  assert.equal(T.crs, 4); assert.equal(T['crs:cab'], 1); assert.equal(T['crs:run'], 1); assert.equal(T['crs:best'], 3);
  assert.ok(earned('cri-cab', { tly: T })); assert.ok(!earned('cri-run20', { tly: T }));
  assert.ok(earned('cri-run20', { tly: { 'crs:best': 20 } }));
});

test('every crisis, and every topic: from the tally or from the rulings still on record', () => {
  const all = { tly: Object.fromEntries(W.CRS_ISSUES.map(i => ['crs:i:' + i.id, 1])) };
  assert.ok(earned('cri-all', all)); assert.equal(val('cri-all', { tly: {} }), 0);
  const most = { tly: Object.fromEntries(W.CRS_ISSUES.slice(1).map(i => ['crs:i:' + i.id, 1])) };
  assert.equal(val('cri-all', most), 29);
  /* the last one is on record but not yet in the tally; one the cabinet signed does not count */
  assert.ok(earned('cri-all', { ...most, answered: [{ id: W.CRS_ISSUES[0].id, o: 1, t: 1 }] }));
  assert.ok(!earned('cri-all', { ...most, answered: [{ id: W.CRS_ISSUES[0].id, o: 1, t: 1, c: 1 }] }));
  assert.equal(val('cri-topics', { tly: { 'crs:c:econ': 2, 'crs:c:weird': 1 } }), 2);
  assert.equal(val('cri-topics', { tly: {}, answered: W.ISSUE_TOPICS.map(([c]) => ({ id: crs(0, c), o: 0, t: 1 })) }), 10);
  /* the decided count takes the largest of n.crd, the tally and the record */
  assert.equal(val('cri-10', { crd: 12, tly: { crs: 3 } }), 12);
  assert.equal(val('cri-10', { crd: 0, tly: {}, answered: [{ id: crs(0), o: 0, t: 1 }, { id: crs(1), o: -1, t: 2 }, { id: 'risk-0.5', o: 1, t: 3, g: 1 }] }), 1);
});

test('gambles: won and lost by their odds, in a crisis, and the runs of each', () => {
  const g = (p, won, t) => ({ id: 'risk-' + p, o: 1, t, g: won ? 1 : 0 });
  const seq = [g(0.5, 1, 1), g(0.25, 1, 2), g(0.67, 1, 3), g(0.8, 0, 4), g(0.33, 0, 5), g(0.75, 0, 6), g(0.5, 1, 7)];
  const T = scan(seq);
  assert.equal(T['gmb:w:25'], 1); assert.equal(T['gmb:l:80'], 1); assert.equal(T['gmb:w:50'], 2);
  assert.equal(T['gmb:wb'], 3); assert.equal(T['gmb:lb'], 3); assert.equal(T['gmb:ws'], 1); assert.equal(T['gmb:ls'], 0);
  const n = { tly: T, gmb: { w: 4, l: 3 }, answered: [] };
  for (const id of ['gam-1', 'gam-lose', 'gam-long', 'gam-sure', 'gam-hot', 'gam-cold']) assert.ok(earned(id, n), id);
  for (const id of ['gam-hot5', 'gam-10', 'gam-odds', 'gam-crs']) assert.ok(!earned(id, n), id);
  assert.equal(val('gam-odds', n), 3, 'won at 25, 50 and 67');
  /* a crisis's gamble, won */
  const C = W.CRS_ISSUES[0], T2 = scan([{ id: C.id, o: 1, t: 9, g: 1 }]);
  assert.equal(T2['gmb:crs'], 1); assert.equal(T2.crs, 1); assert.equal(T2['gmb:w:' + Math.round(C.o[1].g.p * 100)], 1);
  assert.ok(earned('gam-crs', { tly: T2 }));
  /* a motion without odds counts no gamble */
  assert.deepEqual(scan([{ id: 'risk-0.5', o: 0, t: 1 }]), {});
});

test('the last 80 rulings count too, for gambles played before the tally knew them', () => {
  const ans = [1, 1, 1, 1, 1, 0, 0, 0].map((w, i) => ({ id: 'risk-' + ODDS[i % 6], o: 1, t: i, g: w }));
  const n = { tly: {}, answered: ans };
  assert.equal(val('gam-hot5', n), 5); assert.ok(earned('gam-hot5', n)); assert.equal(val('gam-cold', n), 3);
  assert.equal(val('gam-1', n), 5); assert.equal(val('gam-lose', n), 3);
  assert.equal(val('gam-odds', n), 5, 'won at five of the six odds');
  assert.equal(val('gam-1', { gmb: { w: 9, l: 0 }, answered: [] }), 9, 'and n.gmb when it says more');
});

test('wired in: the tally calls crsTally for each new ruling, and the section comes after what it reads', () => {
  const ts = html.slice(html.indexOf('function tallyScan(n,old,now){'), html.indexOf('\n}\n', html.indexOf('function tallyScan(n,old,now){')));
  assert.match(ts, /const put=\(k,v\)=>\{if\(Object\.keys\(T\)\.length>=TALLY_MAX&&!\(k in T\)\)return;T\[k\]=v;\};/);
  assert.match(ts, /if\(is\)\{bump\('iss:'\+is\.c,a\.t\);[^\n]*crsTally\(a,is,old,T,bump,put\);\}\}/);
  for (const before of ['const CRS_ISSUES=[', 'const GMB_ODDS=', 'const aAns=', 'const ISSUE_TOPICS ='])
    assert.ok(html.indexOf(before) < at, before + ' comes first');
  /* the game's own decision: a gamble keeps g, a crisis given to the cabinet c, and n.gmb and n.crd count */
  assert.match(html, /const rec=\{id,o,t:now,fx\};if\(gm\)rec\.g=gm\.ok\?1:0;if\(cab\)rec\.c=1;/);
  assert.match(html, /n\.answered\.push\(\{id:x\.id,o,t,fx,c:1\}\)/, 'the clock running out signs with c:1');
});
