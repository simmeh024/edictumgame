// The Moon in midgame (16 November 2026, game/edictum.html): the Lunar Colony opens with Mission Control's habitat test
// at 100 million people, the letters come between 40 and 800 enacted edicts, the cargo beacon can become an outpost on
// the shared Moon with one smelter or extractor, a colony's buildings send home a share that grows with its people, and
// the first colony on the Moon (of all, and of each region) is news. Run with: node --test test/moon-midgame.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
function cut(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j); }
const line = start => { const l = html.split('\n').find(x => x.startsWith(start)); assert.ok(l, start); return l; };
const DAY = 864e5, MIN = 60000;

test('the road is shorter: the crew centre at 100 million, the Lunar Colony in the same milestone, letters from 40 edicts', () => {
  assert.match(html, /add\(15,'dsts'\);add\(75,'robo'\);add\(100,'crewc'\);/);
  assert.match(html, /\{p:100,t:'Superpower',c:10,city:1,b:\['lunar'\]\}/);
  assert.match(html, /MC_AT=40\/\* MC_GATE\[0\] \*\//);
  assert.match(line('const LUNAR_MS='), /'hab'/);
});

test('the Lunar Colony opens with the habitat test and 100 million people, and a wonder already begun stays open', () => {
  const ctx = vm.createContext({ Date, cityList: n => n.cities || [], popNow: n => n.pop, bldUnlockAt: () => 100, mcDone: (n, k) => k === 'hab' && !!n.hab });
  vm.runInContext(line('const LUNAR_MS=') + '\n' + fn('lunarOpen') + '\nthis.lunarOpen=lunarOpen;', ctx);
  const L = ctx.lunarOpen;
  assert.equal(L({ pop: 99, hab: true }), false, 'too few people');
  assert.equal(L({ pop: 100, hab: false }), false, 'the habitat test first');
  assert.equal(L({ pop: 100, hab: true }), true);
  assert.equal(L({ pop: 50, cities: [{ b: [{ k: 'lunar', s: 1, d: 2 }] }] }), true, 'begun before the rules changed');
  assert.equal(L(null), false);
  /* the build lock says what it waits for */
  assert.match(html, /Unlocks once Mission Control has flown its first habitat test, on the Space page\./);
});

/* the outpost record: kept when sound, dropped when not */
const NORM = (() => {
  const ctx = vm.createContext({ Date, Math, DAY, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), SP_POP0: 0.005, SP_MILES: [1, 10, 100], SP_MIN: MIN, SP_BLD: 40,
    SPB: { moon: { id: 'moon', N: 1000 }, mars: { id: 'mars', N: 1000 } }, spDecK: () => ({ cells: [], mins: [] }) });
  vm.runInContext(cut('const SP_BLDS=', '\nconst SP_CAP=') + '\n' + line('const SP_DB=') + '\n' + fn('spDecB') + '\n' + line('const SP_OP_K=') + '\n' + fn('spNorm') + '\nthis.spNorm=spNorm;', ctx);
  return ctx.spNorm;
})();
test('an outpost is saved as {t, c, b}: one smelter or extractor at most, never beside a colony on the Moon', () => {
  const t = Date.now() - DAY;
  assert.deepEqual({ ...NORM({ op: { t, c: 12, b: '' } }).op }, { t, c: 12, b: '' });
  assert.deepEqual({ ...NORM({ op: { t, c: 12, b: 'rsc.0.c' } }).op }, { t, c: 12, b: 'rsc.0.c' }, 'a smelter');
  assert.equal(NORM({ op: { t, c: 12, b: 'hdc.0.c' } }).op.b, '', 'a dome is not for an outpost');
  assert.equal(NORM({ op: { t, c: 12, b: 'rsc.0.c,hec.1.c' } }).op.b, '', 'one building only');
  assert.equal(NORM({ op: { t, c: 1000, b: '' } }), null, 'off the map');
  assert.equal(NORM({ op: { t: 5, c: 12 } }), null, 'a time from before the game');
  assert.equal(NORM({ op: [1, 2] }), null);
  const both = NORM({ moon: { t, c: 12, k: '', b: '', p: 1, pa: t, e: 0, ld: t + 5, lp: 140 }, op: { t, c: 12, b: '' } });
  assert.equal(both.op, undefined, 'a colony replaces its outpost');assert.equal(both.moon.ld, t + 5);assert.equal(both.moon.lp, 140);
  assert.equal(NORM({ moon: { t, c: 12, k: '', b: '', p: 1, pa: t, e: 0, ld: t - 5 } }).moon.ld, undefined, 'a crew never lands before its claim');
});

test('the outpost goes to the preferred site, or the nearest free tile to it, never on a rim or within four tiles of another', () => {
  const own = new Int32Array(1000).fill(-1);own[50] = 0;
  const ctx = vm.createContext({ Date, SP_GAP: 4, SPB: { moon: { id: 'moon', N: 1000 } }, spT: (B, c) => c === 3 ? 3 : c === 20 || c === 21 ? 6 : 0, spNoLand: (B, t) => t === 3 || t === 4,
    SP_OP_K: ['rs', 'he'], SP_BLDS: { moon: { rs: { no: [6] }, he: { on: [1, 5] } } },
    spWorld: () => ({ own, cols: [{ name: 'Rivalia', op: false }] }), spRing: (B, c, R) => { const o = [];for (let x = c - R; x <= c + R; x++)if (x >= 0 && x < 1000)o.push(x);return o; },
    mcDone: (n, k) => k === 'cargo' && !!n.cargo, mcPrefTile: n => n.pf });
  vm.runInContext(fn('spOpProblem') + '\n' + fn('spOpSpot') + '\n' + fn('spOpWhy') + '\nthis.P=spOpProblem;this.S=spOpSpot;this.W=spOpWhy;', ctx);
  assert.match(ctx.P({ cargo: false }, 10), /beacon of Mission Control’s cargo landing/);
  assert.match(ctx.P({ cargo: true, sp: { moon: {} } }, 10), /already have a colony/);
  assert.match(ctx.P({ cargo: true, sp: { op: {} } }, 10), /already have an outpost/);
  assert.match(ctx.P({ cargo: true }, 3), /crater rim/);
  assert.match(ctx.P({ cargo: true }, 53), /too close to the colony of Rivalia/);
  assert.equal(ctx.P({ cargo: true }, 10), '');
  assert.equal(ctx.S({ cargo: true, pf: 10 }), 10, 'the preferred site when it is free');
  assert.equal(ctx.S({ cargo: true, pf: 3 }), 2, 'beside a rim');
  assert.equal(ctx.S({ cargo: true, pf: 52 }), 55, 'past the other colony’s ring');
  assert.equal(ctx.S({ cargo: true, pf: -1 }), -1);
  /* the ice is for an Ice Mine: the beacon's outpost goes beside it, where a smelter can work */
  assert.match(ctx.P({ cargo: true }, 20), /Ice Mine/);assert.equal(ctx.S({ cargo: true, pf: 20 }), 19);assert.equal(ctx.S({ cargo: true, pf: 21 }), 22);
  assert.match(ctx.W({ cargo: true, pf: 52 }), /Every tile near the preferred site is taken/);
});

test('the colony opens at its outpost: the outpost’s time, tile and building, the crew’s landing and the people at home', () => {
  const now = Date.now(), T = now - 5 * DAY;let saved = null;const toasts = [];
  const ctx = vm.createContext({ S: { nation: { name: 'Testoria', capital: 'Port Test', stock: { iron: 999, oil: 999, goods: 999 }, sp: { op: { t: T, c: 77, b: 'rs25.0.c' } } } },
    RES: ['food', 'timber', 'iron', 'oil', 'goods'], SP_LANDC: { moon: { iron: 150, oil: 120, goods: 150 } }, SP_POP0: 0.005, SP_E0: 3, SP_MILES: [1, 10, 100],
    spLandBonus: () => null, spLandProblem: () => '', clone: v => JSON.parse(JSON.stringify(v)), stockNow: n => ({ ...n.stock }), roundStock: s => s, commit: n => { saved = n; },
    render: () => {}, toast: m => toasts.push(m), spWhere: () => 'in Mare Serenitatis', fmt0: v => String(v), spRefreshPanel: () => {}, popNow: () => 140.25, Date, Math });
  vm.runInContext(fn('spLand') + '\nthis.spLand=spLand;', ctx);
  assert.equal(ctx.spLand({ id: 'moon', nm: 'the Moon' }, 77), true);
  const m = saved.sp.moon;
  assert.equal(m.t, T, 'the claim keeps the outpost’s time');assert.equal(m.c, 77);assert.equal(m.b, 'rs25.0.c', 'and its smelter');
  assert.ok(Math.abs(m.ld - now) < 5000 && m.pa === m.ld, 'people start when the crew lands');assert.equal(m.lp, 140.25);
  assert.equal(saved.sp.op, undefined, 'the outpost is gone');assert.match(toasts[0], /at your outpost/);
  assert.equal(saved.stock.iron, 999 - 150, 'the landing is paid as usual');
});

test('the first colony on the Moon and the first of each region: landing minute, then the lower id; outposts never count', () => {
  const C = (id, reg, m, o = {}) => ({ id, reg, land: m * MIN, ok: true, op: false, ...o });
  const cols = [C('n1', 'r1', 10), C('n9', 'r2', 5, { op: true }), C('n5', 'r2', 12), C('n0', 'r1', 10), C('n3', 'r3', 2, { ok: false })];
  const W = { ver: 7, cols }, ctx = vm.createContext({ SPB: { moon: {} }, SP_EP: 0, SP_MIN: MIN, spWorld: () => W, Math, Object });
  vm.runInContext(line('const SPF=') + '\n' + fn('spFirsts') + '\nthis.F=spFirsts;', ctx);
  const F = ctx.F();
  assert.equal(F.world.id, 'n0', 'a tie in the minute goes to the lower id');assert.equal(F.reg.r1.id, 'n0');assert.equal(F.reg.r2.id, 'n5', 'not the earlier outpost');
  assert.equal(F.reg.r3, undefined, 'a landing that lost its race is no first');
  assert.equal(ctx.F(), F, 'remembered while the world is unchanged');
  /* the same rule as the platinum achievement First on the Moon */
  assert.match(html, /achDef\('exp','sp-moon-first'/);
});

test('news and honours: the bell, the Dispatch, the Happenings, the race on the Space page and four achievements', () => {
  const sec = cut('/* ───────── the Moon in midgame ─────────', '/* ───────── thirty edicts that find iron');
  assert.match(sec, /NOTIF_SOURCES\.push\(/);assert.match(sec, /DISPATCH_SOURCES\.push\(/);assert.match(sec, /HAP_SOURCES\.push\(/);
  assert.match(sec, /spView=\(f=>function\(now\)/);
  for (const [id, name] of [['sp-op', 'Beacon Keeper'], ['sp-op-run', 'Moonlighting'], ['sp-moon-early', 'Before a Billion'], ['sp-moon-reg', 'First of the Region']]) {
    assert.match(sec, new RegExp(`achDef\\('exp','${id}','[bsg]','${name}'`), id);
    assert.equal((html.match(new RegExp(`'${name}'`, 'g')) || []).length, 1, name + ' is a name of its own');
  }
  /* the colonies' income is added after the economy's floor, so the floor never swallows it */
  const wrap = 'stockRates=(f=>function(n){const o=f.apply(this,arguments);try{const a=spIncome(n);';
  assert.equal(html.split(wrap).length, 2, 'added once');assert.ok(html.indexOf(wrap) > html.indexOf('for(const r of RES){const fl=GB.SHARE*'), 'after the floor');
  /* "Before a Billion" reads the people at home saved at the landing */
  assert.match(sec, /o\.lp>0&&o\.lp<1000/);
});
