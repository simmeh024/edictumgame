// The space balance of 11 November 2026 (game/edictum.html): the Lunar Colony at five billion, a Starport every landing
// site can reach, exporters limited per colony, a crew that Mission Control prepared lands with more settlers, a 90-day
// voyage to the belt, research priced by what it does, Research Computers that add points, platinum that grows with
// the rock, and terraforming engines that pay their builder. Run with: node --test test/space-balance.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
/* a top-level function, by brace matching */
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
/* source from one marker up to (not including) another */
function cut(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j); }
const line = start => { const l = html.split('\n').find(x => x.startsWith(start)); assert.ok(l, start); return l; };
const DAY = 864e5;

test('the Lunar Colony unlocks at five billion people, with the Hyperloop; Planetary Power keeps only its medallion', () => {
  assert.match(html, /\{p:5000,t:'Continental Power',c:4,b:\['hyperloop','lunar'\]/);
  assert.match(html, /\{p:50000,t:'Planetary Power',c:4,x:'the Planetary Power Medallion'\}/);
  /* letter XI's estimate says five billion in every family; "fifty billion" is left only on the medallion */
  assert.equal((html.match(/five billion people/g) || []).length >= 8, true);
  assert.deepEqual((html.match(/[^\n]*fifty billion[^\n]*/gi) || []).map(l => /gi-planet/.test(l)), [true]);
});

const SP = vm.createContext({});
vm.runInContext(cut('const SP_BLDS=', '\nconst SP_CAP=') + '\nthis.SP_BLDS=SP_BLDS;', SP);

test('the Starport needs 75 million lunar people, which even a polar or highlands colony can reach', () => {
  const sp = SP.SP_BLDS.moon.sp;
  assert.equal(sp.req, 75);assert.match(sp.d, /75 million/);
  /* the most a colony can hold on its worst ground: 300 polar-upland tiles (0.14 each) and 31 domes beside 8 arrays */
  assert.ok(0.05 + 300 * 0.14 + 31 * 1.2 > sp.req, 'room for it');
});

test('smelters, extractors and mines: at most eight of each per colony, and only eight count at home', () => {
  const B = SP.SP_BLDS;
  for (const [body, k] of [['moon', 'rs'], ['moon', 'he'], ['mars', 'cm']]) { assert.equal(B[body][k].max, 8, k);assert.match(B[body][k].d, /Up to eight per colony/); }
  const ctx = vm.createContext({ SP_BLDS: B, SPB: { moon: { id: 'moon' }, mars: { id: 'mars' } }, DAY, Date,
    spColony: (b, o) => o ? { blds: o.blds } : null, spPop: () => 0 });
  vm.runInContext(fn('spIncome') + '\nthis.spIncome=spIncome;', ctx);
  const now = Date.now(), done = k => ({ k, d: now - DAY });
  const n = { sp: { moon: { blds: [...Array(12)].map(() => done('he')).concat([done('rs'), done('md'), done('md')]) }, mars: { blds: [...Array(10)].map(() => done('cm')) } } };
  const o = ctx.spIncome(n, now);
  assert.equal(o.oil, 40, 'eight Helium-3 Extractors count');assert.equal(o.iron, 4 + 48, 'one smelter and eight Canyon Mines');assert.equal(o.goods, 3, 'one Mass Driver');
});

test('terraforming engines make room in their own colony, and four earn an achievement', () => {
  assert.equal(SP.SP_BLDS.mars.te.cap, 0.5);assert.equal(SP.SP_BLDS.mars.te.max, 4);
  assert.match(html, /achDef\('exp','sp-te4','g','Weather Makers'/);
});

test('a crew Mission Control prepared lands with 20,000 settlers and two more expansion points', () => {
  assert.match(line('const SP_E0='), /SP_POP_PREP=0\.02/);
  const run = bonus => {
    let saved = null;const toasts = [];
    const ctx = vm.createContext({ S: { nation: { name: 'Testoria', capital: 'Port Test', stock: { iron: 999, oil: 999, goods: 999 } } }, RES: ['food', 'timber', 'iron', 'oil', 'goods'],
      SP_LANDC: { moon: { iron: 150, oil: 120, goods: 150 } }, SP_POP0: 0.005, SP_E0: 3, SP_MILES: [1, 10, 100], spLandBonus: () => bonus, spLandProblem: () => '',
      clone: v => JSON.parse(JSON.stringify(v)), stockNow: n => ({ ...n.stock }), roundStock: s => s, commit: n => { saved = n; }, render: () => {},
      toast: m => toasts.push(m), spWhere: () => 'on Mare Concordiae', fmt0: v => String(v), spRefreshPanel: () => {}, Date });
    vm.runInContext(fn('spLand') + '\nthis.spLand=spLand;', ctx);
    assert.equal(ctx.spLand({ id: 'moon', nm: 'the Moon' }, 5), true);return [saved.sp.moon, toasts[0]];
  };
  const [plain] = run(null);assert.equal(plain.p, 0.005);assert.equal(plain.e, 3);
  const [prep, msg] = run({ p: 0.02, e: 2 });assert.equal(prep.p, 0.02);assert.equal(prep.e, 5);assert.match(msg, /^20000 settlers/);assert.match(msg, /prepared crew/);
  /* the save hook no longer adds the points a second time */
  assert.doesNotMatch(cut('const sp=n.sp&&n.sp.moon;', 'else if(!sp&&m.ld)'), /e:\(\+sp\.e\|\|0\)\+2/);
});

/* the belt */
const BT = vm.createContext({ Math });
vm.runInContext(cut('const BT_BR=', '\nconst BT_RI=') + '\n' + line('const btHas=') + '\n' + fn('btFx') + '\nthis.BT_RS=BT_RS;this.btFx=btFx;this.BT_TIER=BT_TIER;', BT);
const node = id => BT.BT_RS.find(r => r.id === id);

test('the voyage to the belt takes 90 days, and its events and notices fit inside it', () => {
  assert.match(line('const BT_N='), /BT_VOY_D=90,/);
  const ctx = vm.createContext({ Math, DAY, Date });
  vm.runInContext([fn('hash'), fn('spH'), line('const BT_N='), 'const BT={};', line('const btArr='), line('const BT_EVK='), fn('btEvents'), 'this.btEvents=btEvents;this.BT_VOY_D=BT_VOY_D;'].join('\n'), ctx);
  for (const id of ['a', 'b', 'uid-42', 'zz-top']) {
    const v = Date.UTC(2027, 2, 1), L = ctx.btEvents({ v }, id);
    assert.ok(L.length >= 4 && L.length <= 6, id + ': ' + L.length + ' events');
    assert.ok(L.every(e => e.t < v + (ctx.BT_VOY_D - 5) * DAY), 'every event before the last five days');
  }
  assert.match(html, /for\(const d of \[1\/3,2\/3,14\/15\]\.map\(f=>Math\.round\(BT_VOY_D\*f\)\)\)/);
  assert.doesNotMatch(html, /150 days to go|After 150 days|of 150 for the/);
});

test('research is priced by what it does: Second Crew costs double, the two information nodes less', () => {
  assert.equal(node('a1').rp, 100);assert.equal(node('p1').rp, 30);assert.equal(node('p4').rp, 180);
  assert.equal(node('a3').rp, BT.BT_TIER[2].rp, 'the others keep their tier price');
  assert.equal(BT.BT_RS.reduce((s, r) => s + r.rp, 0), 10080 - 90);
});

test('Research Computers add a quarter to research points, and no longer add a slot nobody could fill', () => {
  const a6 = node('a6');assert.deepEqual({ ...a6.fx }, { rpx: 1.25 });
  const all = BT.BT_RS.reduce((m, r) => m + Math.pow(2, r.i), 0), fx = BT.btFx(all);
  assert.equal(fx.rpx, 1.25);assert.equal(fx.slots, 1);assert.equal(BT.btFx(0).rpx, 1);
  /* the rate shows it as its own line, and the save settles the old rate up to the moment it finished */
  assert.match(fn('btRateParts'), /\['Research Computers',out\.reduce\(\(s,p\)=>s\+p\[1\],0\)\*\(rx-1\)\]/);
  const hookLine = line('  const done=(b.rq||[]).filter(q=>q[2]<=now);'), calls = [];
  const ctx = vm.createContext({ BT_RS: BT.BT_RS, btRP: (n, t) => { calls.push(t);return 500; }, out: [] });
  vm.runInContext(line('const btHas=') + '\n' + line('const btSet=') + `\nfunction save(n,now){const out=[],b=n.belt;${hookLine}return b;}this.save=save;`, ctx);
  const now = Date.now(), fin = now - 3600e3, b = ctx.save({ belt: { v: now - 50 * DAY, rd: 0, rp: 100, ra: now - 5 * 3600e3, rq: [[a6.i, now - 99 * 3600e3, fin]] } }, now);
  assert.deepEqual(calls, [fin]);assert.equal(b.ra, fin);assert.equal(b.rp, 500);assert.ok(Math.floor(b.rd / Math.pow(2, a6.i)) % 2 === 1);
});

test('platinum grows with the rock and the ship, and never falls below the strike’s base', () => {
  const ctx = vm.createContext({ Math, A: null });
  vm.runInContext(fn('btHaul') + '\nthis.btHaul=btHaul;', ctx);
  const set = (km, rich) => { ctx.btAst = () => ({ ty: [2], rich: [rich] });ctx.btSz = () => [0, '', 0, km]; };
  const fx = { yield: 1, hold: 1, all: 1, ptg: 0, ptp: 0, iron: 1, ice: 1, veinx: 1, water: 1, samples: 1, rpx: 1 };
  set(0.5, 0.1);let h = ctx.btHaul(0, 'p', fx);assert.equal(h.h.goods, 80);assert.equal(h.h.iron, 30, 'a tiny, poor rock: the base');
  set(1.7, 1);h = ctx.btHaul(0, 'p', fx);assert.equal(h.h.goods, Math.round(80 * 1.7 * 1.5));assert.equal(h.h.iron, Math.round(30 * 1.7 * 1.5));
  h = ctx.btHaul(0, 'p', { ...fx, yield: 1.2, hold: 1.95, all: 1.25, ptg: 60, rpx: 1.25 });
  assert.equal(h.h.goods, Math.round(140 * 1.7 * 1.5 * 1.2 * 1.95 * 1.25));assert.equal(h.rp, 20 * 1.25, 'samples count with Research Computers');
});

test('Mission Control: even letter gates, two missions that wait for their letter, prep that must be flown', () => {
  assert.match(html, /const MC_GATE=\[50,100,200,300,450,600,800,1000,1200,1400,1600\];/);
  assert.match(html, /need:\['b:mctrl','m:cam','l:2'\]/);assert.match(html, /need:\['m:orb','l:3'\]/);
  assert.match(html, /if\(cr>=\(k==='prep'\?3:1\)\)return 0;/);
  assert.match(html, /spLandBonus=\(n,B,now\)=>B\.id==='moon'&&mcPrepFlown\(n,now\)\?\{p:SP_POP_PREP,e:2\}:null;/);
});

test('a colony on the Moon counts as a Lunar Base for Ad Astra and the museum’s lunar rock', () => {
  assert.match(html, /aPol\(x,'moonBase'\)\|\|!!\(x\.n\.sp&&x\.n\.sp\.moon\)/);
  assert.match(html, /'Reach further than the map\.',\{f:n=>colPol\('moonBase'\)\.f\(n\)\|\|!!\(n&&n\.sp&&n\.sp\.moon\)\}/);
});
