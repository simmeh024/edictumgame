// Four earned tinctures for the coat of arms (game/edictum.html, 16 November 2026): Lime, Turquoise, Night blue and
// Shining gold, each unlocked by an achievement (UNLOCKS tn-*, CZ_TN_U). A nation that does not hold one shows its free
// neighbour instead (czTnKeep), and Shining gold paints with a sweeping glint (czGiltDef) where the arms are shown as
// themselves. The code runs here as written, against made-up records.
//   node --test test/arms-tinctures.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = re => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };

const TN = ['lime', 'turq', 'nuit', 'gilt'];
const unlockLine = grab(/^ *'tn-lime':\{k:'tinct'.*$/m);
const ACH_LINES = html.split('\n').filter(l => /^achDef\(.*\bu:'tn-[a-z]+'\}\);$/.test(l));
const plain = v => JSON.parse(JSON.stringify(v));

function game({ mine = [], rm = false } = {}) {
  const ctx = vm.createContext({
    Object, Array, Set, Math, JSON, String,
    UNLOCKS: { 'c-lion': { k: 'charge', n: 'Lion', src: 'free' }, ...vm.runInNewContext(`({${unlockLine}})`) },
    czMine: () => new Set(mine), mfxRM: () => rm, esc: s => String(s), czSeq: 0,
    czShieldPath: () => 'M0,0H100V120H0Z', czDivBody: (d, b) => `<rect class="div" fill="${b}"/>`,
    czCharge: (k, c) => `<path class="ch" fill="${c}"/>`, czChargePos: () => ({ x: 50, y: 56, s: .56 }),
    czText: (v, max) => String(v || '').slice(0, max), czScroll: () => ''
  });
  vm.runInContext([
    grab(/const czHas=.*;/), grab(/const czU=.*;/), grab(/const CZ_SHIELDS=\{.*\};/), grab(/const CZ_SH_SHOP=\{.*\};/),
    slice('const CZ_TINCT={', 'const CZ_DIVS='), grab(/const CZ_DIVS=\{.*\};/), grab(/const CZ_ORD=\{.*\};/), grab(/const CZ_CREST=\{.*\};/), grab(/const CZ_SUP=\{.*\};/), grab(/const CZ_COMP=\{.*\};/),
    grab(/function czChargeSpots\(a\)\{[\s\S]*?\n\}/), grab(/function czArmsExt\(a,id,F,c1,c2\)\{[\s\S]*?\n\}/),
    grab(/function czCleanArms\(a,u\)\{[\s\S]*?\n\}/), grab(/function czArmsSVG\(a,o\)\{[\s\S]*?\n\}/), grab(/function czGiltDef\(gid,still\)\{[\s\S]*?\n\}/),
    'this.X={CZ_TINCT,CZ_METAL,CZ_TN_U,CZ_TN_FB,czTnOk,czTnKey,czTnKeep,czTnSw,czCleanArms,czArmsSVG};'
  ].join('\n'), ctx);
  return ctx.X;
}

test('four new tinctures, each with an unlock of its own and a free neighbour', () => {
  const X = game();
  for (const t of TN) {
    assert.ok(X.CZ_TINCT[t], t);
    assert.match(X.CZ_TINCT[t][1], /^#[0-9A-F]{6}$/, t);
    const u = X.CZ_TN_U[t];
    assert.equal(u, 'tn-' + t);
    assert.equal(X.czTnKey(u), t);
    assert.ok(X.CZ_TINCT[X.CZ_TN_FB[t]] && !X.CZ_TN_U[X.CZ_TN_FB[t]], 'falls back to a free tincture: ' + t);
  }
  /* after them Platinum, the 200-nation gift's (test/milestone-200.test.mjs), held the same way and falling back to Argent,
     then Past Green, which comes with an edict (test/edict-designs.test.mjs) and falls back to Vert */
  assert.deepEqual(Object.keys(X.CZ_TINCT).slice(-6), [...TN, 'plat', 'pgreen'], 'the earned ones sit at the end of the row');
  assert.equal(Object.keys(X.CZ_TINCT).length, 20);
  assert.equal(X.CZ_TN_U.pgreen, 'tn-pgreen'); assert.equal(X.CZ_TN_FB.pgreen, 'vert');
  assert.equal(X.CZ_TN_U.plat, 'tn-plat');
  assert.equal(X.CZ_TN_FB.plat, 'argent');
  assert.equal(X.CZ_METAL.gilt, 1, 'Shining gold is a metal');
  assert.equal(X.CZ_METAL.plat, 1, 'Platinum is a metal');
  assert.ok(!X.CZ_METAL.lime && !X.CZ_METAL.turq && !X.CZ_METAL.nuit);
  /* every colour stays distinct from the others */
  const hex = Object.values(X.CZ_TINCT).map(v => v[1].toUpperCase());
  assert.equal(new Set(hex).size, hex.length);
});

test('every earned tincture comes from exactly one achievement', () => {
  for (const t of TN) {
    const lines = ACH_LINES.filter(l => l.includes(`u:'tn-${t}'}`));
    assert.equal(lines.length, 1, t);
    assert.match(lines[0], /^achDef\('[a-z]+','[a-z0-9-]+','[bsg]'/, t);
  }
});

test('locked until held: czTnOk follows the nation’s unlocks', () => {
  assert.equal(game().czTnOk('lime'), false);
  assert.equal(game().czTnOk('azure'), true, 'the old tinctures stay free');
  assert.equal(game({ mine: ['tn-lime'] }).czTnOk('lime'), true);
  assert.equal(game({ mine: ['tn-lime'] }).czTnOk('gilt'), false);
});

test('a stored record shows only what the nation holds (u), the rest as its free neighbour', () => {
  const X = game(), arms = { s: 'heater', d: 'pale', t: ['gilt', 'nuit'], c: 'c-lion', ct: 'lime' };
  const none = X.czCleanArms(arms, []);
  assert.deepEqual([...none.t, none.ct], ['or', 'azure', 'vert']);
  const some = X.czCleanArms(arms, ['tn-gilt', 'tn-lime']);
  assert.deepEqual([...some.t, some.ct], ['gilt', 'azure', 'lime']);
  /* without u (the owner's own view is checked by cz() through czHolds) nothing is dropped here */
  const raw = X.czCleanArms(arms, null);
  assert.deepEqual([...raw.t, raw.ct], ['gilt', 'nuit', 'lime']);
  assert.deepEqual(plain(X.czTnKeep({ t: ['turq', 'gules'], ct: 'turq' }, () => false)), { t: ['celeste', 'gules'], ct: 'celeste' });
  assert.equal(X.czTnKeep(null, () => false), null);
});

test('Shining gold paints with a glint that moves only on the arms shown as themselves', () => {
  const X = game(), a = { s: 'heater', d: 'plain', t: ['gilt', 'or'], c: '', ct: 'or' };
  const big = X.czArmsSVG(a, { label: 'Coat of arms of Testland' });
  const id = /<clipPath id="(cza\d+)"/.exec(big)[1];
  assert.ok(big.includes(`<linearGradient id="${id}au"`), 'the gradient is defined');
  assert.ok(big.includes(`fill="url(#${id}au)"`), 'the field is painted with it');
  assert.ok(big.includes('<animateTransform'), 'and it glints');
  /* a tile (no label) and reduced motion stay still */
  assert.ok(!X.czArmsSVG(a, {}).includes('<animateTransform'));
  assert.ok(X.czArmsSVG(a, {}).includes('spreadMethod="repeat"'));
  assert.ok(!game({ rm: true }).czArmsSVG(a, { label: 'x' }).includes('<animateTransform'));
  /* the glint loops without a seam: it travels exactly one period of the gradient */
  const g = /x2="(\d+)" y2="(\d+)"[\s\S]*?from="(-?\d+) (-?\d+)" to="(-?\d+) (-?\d+)"/.exec(big).slice(1).map(Number);
  assert.deepEqual([g[4] - g[2], g[5] - g[3]], [g[0], g[1]]);
  /* no gradient when no gold is shown: a second tincture under a plain field, or a charge's tincture with no charge */
  assert.ok(!X.czArmsSVG({ ...a, t: ['azure', 'gilt'] }, {}).includes('linearGradient'));
  assert.ok(!X.czArmsSVG({ ...a, t: ['azure', 'or'], ct: 'gilt' }, {}).includes('linearGradient'));
  /* a gold charge and a gold division are painted with it too */
  const ch = X.czArmsSVG({ ...a, t: ['azure', 'or'], c: 'c-lion', ct: 'gilt' }, {});
  assert.match(ch, /class="ch" fill="url\(#cza\d+au\)"/);
  const dv = X.czArmsSVG({ ...a, d: 'pale', t: ['azure', 'gilt'] }, {});
  assert.match(dv, /class="div" fill="url\(#cza\d+au\)"/);
  /* the other new tinctures are plain colours */
  assert.ok(X.czArmsSVG({ ...a, t: ['nuit', 'or'] }, {}).includes(`fill="${X.CZ_TINCT.nuit[1]}"`));
});

test('swatches: Shining gold takes its paint from the stylesheet', () => {
  const X = game();
  assert.match(X.czTnSw('gilt'), /class="cz-tsw met gilt"/);
  assert.ok(!X.czTnSw('gilt').includes('style='));
  assert.ok(X.czTnSw('lime').includes(`background:${X.CZ_TINCT.lime[1]}`));
  assert.ok(/\.cz-tsw\.gilt::after,\.sw\.gilt::after\{/.test(html), 'the glint is drawn');
  assert.ok(/:root\[data-motion="reduce"\] \.cz-tsw\.gilt::after/.test(html), 'and stops for the game’s own reduced motion');
});

test('the four achievements measure what they say', () => {
  const A = {};
  const W = { cities: [], coast: new Set(), owner: [], ups: [], agents: [] };
  const ctx = vm.createContext({
    Math, Set, Array, Object,
    achDef: (c, id, t, n, d, g, f, o) => { A[id] = { c, id, t, n, d, g, f, o: o || {} }; },
    achM: (x, k, f) => k in x.m ? x.m[k] : (x.m[k] = f()), achYes: v => v ? 1 : 0,
    aStanding: x => x.n.st || {}, aCxLv: (x, min) => (x.n.ups || []).filter(v => v >= min).length,
    agRoster: n => n.ag || [],
    territory: () => ({ byId: { me: 0 }, owner: W.owner }),
    MAP: { get N() { return W.owner.length; }, T: new Proxy({}, { get: (o, c) => W.water.has(+c) ? 0 : 3 }) },
    isCoastal: c => W.coast.has(c), W
  });
  vm.runInContext(ACH_LINES.concat(grab(/^function aCoast\(x\)\{.*$/m)).join('\n'), ctx);
  const val = (id, n) => +A[id].f({ n, id: 'me', m: {} }) || 0, ok = (id, n) => val(id, n) >= A[id].g;
  assert.deepEqual(plain(Object.keys(A).map(id => A[id].o.u).sort()), ['tn-gilt', 'tn-lime', 'tn-nuit', 'tn-turq']);
  const by = u => Object.values(A).find(a => a.o.u === u).id;

  /* Lime: Farm Estates in three cities */
  assert.equal(ok(by('tn-lime'), { st: { farm: 2 } }), false);
  assert.equal(ok(by('tn-lime'), { st: { farm: 3, harbour: 9 } }), true);

  /* Turquoise: 25 held land hexes on the water's edge (water itself and others' hexes don't count) */
  W.water = new Set([0, 1, 2]);
  W.owner = Array.from({ length: 60 }, (_, c) => c < 40 ? 0 : 1);
  W.coast = new Set(Array.from({ length: 60 }, (_, c) => c));
  assert.equal(val(by('tn-turq'), {}), 37);
  W.coast = new Set(Array.from({ length: 27 }, (_, c) => c));
  assert.equal(val(by('tn-turq'), {}), 24, 'three of them are water');
  assert.equal(ok(by('tn-turq'), {}), false);

  /* Night blue: an agent at level 3 */
  assert.equal(ok(by('tn-nuit'), { ag: [{ lv: 2 }, { lv: 1 }] }), false);
  assert.equal(ok(by('tn-nuit'), { ag: [{ lv: 2 }, { lv: 3 }] }), true);

  /* Shining gold: 15 buildings with the gold block (all five upgrades) */
  assert.equal(ok(by('tn-gilt'), { ups: Array(14).fill(5).concat([4, 4]) }), false);
  assert.equal(ok(by('tn-gilt'), { ups: Array(15).fill(5) }), true);
  assert.equal(A[by('tn-gilt')].t, 'g', 'the gold one is a gold achievement');
});

test('the Customise page knows the new kind of unlock', () => {
  assert.match(html, /const CZ_SEC_OF=\{[^}]*tinct:'a'/, 'its links land in Customise › Arms');
  assert.match(html, /const CZ_KW=\{[^}]*tinct:'Tincture'/);
  assert.match(html, /tinct:`\$\{nm\}, a tincture for the arms`/, 'achievement and toast wording');
  assert.match(html, /case 'tinct':\{const t=czTnKey\(id\)/, 'a picture of it');
  assert.ok(html.includes('data-czid="${u}"'), 'the field row carries the unlock id the links look for');
});
