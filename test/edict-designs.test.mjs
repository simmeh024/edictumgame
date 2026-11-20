// Five more designs that come with one answer to an edict (20 Nov 2026), after the flag contest's motorbike and volcano:
// Past Green (a tincture for the arms and an accent colour), Camouflage (a flag pattern), a cat on the banknotes, a carved
// lintel for the motto and a robot vacuum over the capital. Each is kept in n.ppx; the other answers give nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const fn = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let d = 0, k = html.indexOf('{', i);
  for (; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && !--d) break; } return html.slice(i, k + 1); };
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j + b.length); };
const line = re => { const m = re.exec(html); assert.ok(m, String(re)); return m[0]; };

/* each edict, the answer that gives the designs, what they are, and the note that says so */
const ED = [
  ['odd-new-colour', 'Somewhere Past Green', 1, ['tn-pgreen', 'a-pgreen'], ['tinct', 'accent'],
    ['College of Arms', 'New for your nation: Past Green, a tincture for the arms and the Past Green accent colour. Choose them in the Arms Studio and Settings › Appearance.']],
  ['flag-camo', 'Patriotic Pattern', 0, ['fp-camo'], ['fpat'],
    ['Flag makers', 'New for your nation: the Camouflage flag pattern. Choose it in the Flag Studio.']],
  ['counterfeit', 'Funny Money', 2, ['cv-cat'], ['cupor'],
    ['Central Bank', 'New for your nation: the Cat vignette for your banknotes. Choose it in the Note Studio.']],
  ['motto-step', 'Mind the Step', 0, ['m-lintel'], ['motto'],
    ['Stonemasons', 'New for your nation: the carved lintel frame for your motto. Choose it in Customise › Banner.']],
  ['rob-vacuum', 'Clean Getaway', 0, ['pn-vacuum'], ['pin'],
    ['Mapmakers', 'New for your nation: the robot vacuum over your capital on the map. Choose it in Customise › Map.']],
];
const IDS = ED.flatMap(e => e[3]);
const issueSrc = id => { const i = html.indexOf(`{id:'${id}'`), j = html.indexOf("\n{id:'", i + 5); assert.ok(i >= 0, id); return html.slice(i, j).replace(/,\s*$/, ''); };
const unlockSrc = IDS.map(id => { const m = new RegExp(`'${id}':(\\{[^}]*\\})`).exec(html); assert.ok(m, id + ' is in UNLOCKS'); return `'${id}':${m[1]}`; }).join(',');

function game() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const ISSUE_BY_ID={${ED.map(e => `'${e[0]}':(${issueSrc(e[0])})`).join(',')}};
    const UNLOCKS={${unlockSrc}};
    const NORM_HOOKS=[],UNLOCK_SOURCES=[],PP_INK={};let geoAfter=()=>[];
    ${fn('achTwin')}${fn('achUnlockWords')}
    ${line(/achUnlockWords=\(f=>u=>\{const U=UNLOCKS\[u\];if\(!U\)return '';const w=\{cunote:[^\n]*/)}
    ${line(/achUnlockWords=\(f=>u=>\{const U=UNLOCKS\[u\];if\(!U\)return '';return U\.k==='motto'[^\n]*/)}
    ${cut('/* designs that come with one answer to an edict', 'return notes;})(geoAfter);')}
    function unlocksOf(n){const o=new Set();for(const s of UNLOCK_SOURCES)for(const id of s.earned(n)||[])o.add(id);return o;}
    function normalize(d){const n=JSON.parse(JSON.stringify(d));for(const h of NORM_HOOKS)h(n,d);return n;}
    this.G={ISSUE_BY_ID,UNLOCKS,UNLOCK_SOURCES,geoAfter,unlocksOf,normalize};`, ctx);
  return ctx.G;
}
const J = x => JSON.parse(JSON.stringify(x));

test('each edict gives its designs with one answer only, and they belong to it', () => {
  const G = game();
  for (const [id, t, o, ids, kinds] of ED) {
    const is = G.ISSUE_BY_ID[id];
    assert.equal(is.t, t);
    assert.equal(is.req, undefined, id + ' reaches every nation');
    assert.deepEqual(J(is.o[o].e.ul), ids, id + ' answer ' + (o + 1));
    is.o.forEach((x, k) => { if (k !== o) assert.equal(x.e.ul, undefined, id + ' answer ' + (k + 1) + ' gives nothing'); });
    ids.forEach((u, k) => { assert.equal(G.UNLOCKS[u].src, 'edict'); assert.equal(G.UNLOCKS[u].ed, id); assert.equal(G.UNLOCKS[u].k, kinds[k]); });
  }
});

test('the answer gives them once, with a note from whoever looks after that kind of design', () => {
  const G = game();
  for (const [id, , o, ids, , note] of ED) {
    const n = { name: 'Testoria', answered: [] };
    assert.deepEqual(J(G.geoAfter(n, G.ISSUE_BY_ID[id].o[o], { id }, Date.now())), [note], id);
    assert.deepEqual(J(n.ppx), ids);
    for (const u of ids) assert.ok(G.unlocksOf(n).has(u), u + ' is held');
    assert.equal(G.geoAfter(n, G.ISSUE_BY_ID[id].o[o], { id }, Date.now()).length, 0, 'no second note');
    const other = { name: 'Other', answered: [] };
    G.ISSUE_BY_ID[id].o.forEach((x, k) => { if (k !== o) G.geoAfter(other, x, { id }, Date.now()); });
    assert.equal(other.ppx, undefined, id + ': the other answers give nothing');
  }
});

test('a nation that gave the answer before today gets them on load, and a locked one says which edict', () => {
  const G = game();
  const n = G.normalize({ name: 'Old', answered: ED.map(([id, , o]) => ({ id, o, t: 1 })) });
  assert.deepEqual([...n.ppx].sort(), [...IDS].sort());
  const m = G.normalize({ name: 'Other', answered: ED.map(([id, , o]) => ({ id, o: o === 0 ? 1 : 0, t: 1 })) });
  assert.equal(m.ppx, undefined);
  const how = u => G.UNLOCK_SOURCES.map(s => s.how(u)).find(Boolean);
  assert.equal(how('tn-pgreen'), 'Comes with one answer to the edict “Somewhere Past Green”.');
  assert.equal(how('pn-vacuum'), 'Comes with one answer to the edict “Clean Getaway”.');
});

test('Past Green: a tincture painted with its own shimmer, and an accent colour for light and dark', () => {
  assert.match(html, /pgreen:\['Past Green','#34B58E'\]\};/);
  assert.match(html, /CZ_TN_U=\{[^}]*pgreen:'tn-pgreen'\},CZ_TN_FB=\{[^}]*pgreen:'vert'\};/, 'locked, and shown as vert where not held');
  assert.match(html, /F=t=>t==='gilt'\?`url\(#\$\{id\}au\)`:t==='pgreen'\?`url\(#\$\{id\}pg\)`:CZ_TINCT\[t\]\[1\]/);
  assert.match(html, /\(uses\('pgreen'\)\?czPgDef\(id\+'pg',!o\.label\):''\)/);
  const def = new Function('const mfxRM=()=>false;' + fn('czPgDef') + 'return czPgDef;')();
  assert.match(def('x', false), /^<linearGradient id="x"[^>]*>(<stop [^>]*\/>){6}<animateTransform /);
  assert.ok(!def('x', true).includes('animate'), 'still in small places');
  for (const sel of [':root[data-accent="pgreen"]{', '@media (prefers-color-scheme: dark){:root[data-accent="pgreen"]:not([data-theme="light"]){', ':root[data-accent="pgreen"][data-theme="dark"]{', '.cz-asw[data-a="pgreen"]{', '.cz-tsw.pgreen,.sw.pgreen{'])
    assert.ok(html.includes(sel), sel);
  assert.equal((html.match(/\$\{t==='gilt'\?' gilt':t==='pgreen'\?' pgreen':''\}/g) || []).length, 2, 'province and city swatches');
});

test('Camouflage: the same patches on every flag, inside it, in the flag’s three colours', () => {
  const make = () => new Function('const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));let fgCamoP=null;' + ['hash', 'rng', 'fgCamo'].map(fn).join('\n') + 'return fgCamo();')();
  const a = make(), b = make();
  assert.deepEqual(a, b, 'from a fixed seed');
  for (const d of a) {
    const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    assert.ok(xs.length > 100);
    assert.ok(xs.every(([, x, y]) => +x >= 0 && +x <= 300 && +y >= 0 && +y <= 200), 'inside the flag');
  }
  assert.equal((a[0].match(/Z/g) || []).length, 15, 'fifteen big patches');
  assert.equal((a[1].match(/Z/g) || []).length, 24, 'twenty-four small ones');
  assert.match(html, /'camo':\(a,b,c,d,R\)=>\{const P=fgCamo\(\);/);
  assert.match(html, /'camo':\['Camouflage',3\]\}\);/);
  assert.match(html, /fcharter:'fp-fcharter',camo:'fp-camo'\},FG_PFB=\{[^}]*camo:'tri-h'\};/);
  assert.match(html, /fcharter:0,camo:0\};/);
});

test('the cat on the banknotes: a vignette that is locked until held, drawn in its box', () => {
  assert.match(html, /const CU_POR=\{[^}]*bird:'A bird in flight',cat:'A cat'\};/);
  assert.match(html, /por:\{cat:'cv-cat'\}\};/);
  assert.match(html, /\['note','strip','strip'\],\['note','por','por'\]\]\)\{const id=CU_LOCK\[k\]\[o\[g\]\[f\]\];if\(id&&!CU_HOLDS\(n,id\)\)/, 'a note with a cat it does not hold falls back');
  assert.ok(html.includes("const CU_TRY_F=[['note','bkp','pat'],['note','pat','pat'],['note','strip','strip'],['note','por','por'],"), 'it can be tried on');
  assert.ok(html.includes("${cstSeg('Vignette','note.por',cstLockOpts(CU_POR,'por'),N.por)}"), 'the Note Studio shows it locked');
  assert.match(html, /UNLOCK_CZ_SEC=\{[^}]*cupor:'c'\};/);
  const sc = new Function(fn('cuScene') + 'return cuScene;')()('cat');
  assert.ok(sc && sc.d && sc.w);
  /* absolute points only: relative arcs (a…) and arc radii are not positions */
  const nums = s => [...s.matchAll(/([A-Za-z])([^A-Za-z]*)/g)].filter(m => /[MLHVCQZ]/.test(m[1])).flatMap(m => (m[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
  assert.ok(nums(sc.d).every(v => v >= -1 && v <= 101) && nums(sc.w).every(v => v >= -1 && v <= 101), 'inside 100 × 80');
  assert.match(html, /\[c\.note\.por\]\|\|String\(CU_POR\[c\.note\.por\]\|\|'the national arms'\)/, 'the factbook names every vignette');
});

test('the carved lintel and the robot vacuum', () => {
  for (const sel of ['.hero-motto.mf-lintel,.cz-mf.mf-lintel{', '.hero-motto.mf-lintel::after,.cz-mf.mf-lintel::after{', ':root[data-theme="dark"] .hero-motto.mf-lintel,:root[data-theme="dark"] .cz-mf.mf-lintel{'])
    assert.ok(html.includes(sel), sel);
  const pin = new Function(line(/const VAC_PIN=col=>`[^`]*`;/) + 'return VAC_PIN;')()('#123456');
  assert.ok(pin.includes('fill="#123456"'), 'the hat band is the nation’s colour');
  assert.match(html, /pnSVG=\(f=>function\(id,n\)\{const h=f\.apply\(this,arguments\);return id==='pn-vacuum'\?/);
  assert.match(html, /if\(pin!=='pn-vacuum'\)return;/, 'drawn on the map');
});
