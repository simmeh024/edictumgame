// Artificial islands (game/edictum.html, section "artificial islands"): three edicts, after a nation's 50th, 150th and
// 500th decision, each raising an island of 4 or 5 hexes from free sea, a hex of water clear of every coast and no more
// than 8 hexes out from the nation's land, held at once without a land credit (its hexes are land from the sea, kept in
// n.isl beside n.rec, with the island's number in i). The sites are checked on every region's real map, made by the game's own
// generators as scripts/bake-maps.mjs makes them.
// Run with: npm run test:fx
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { mapKit } from '../scripts/bake-maps.mjs';

const source = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'));
const functions = new Map();
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && !functions.has(node.id.name)) functions.set(node.id.name, code.slice(node.start, node.end));
  for (const [k, v] of Object.entries(node)) if (k !== 'start' && k !== 'end') { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
})(parse(code, { ecmaVersion: 'latest' }));
const cut = (a, b) => { const i = code.indexOf(a), j = code.indexOf(b, i); assert.ok(i >= 0 && j > i, `the game has ${a} … ${b}`); return code.slice(i, j); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const J = v => JSON.parse(JSON.stringify(v));

const START = '/* ───────── artificial islands', END = '/* ───────── achievements, round five';
const SEC = cut(START, END);
const HEAD = cut('const ISL_AT=', '\nconst ISL_ISSUES=');
const ISSUES_SRC = cut('const ISL_ISSUES=', '\nfor(const is of ISL_ISSUES)');
const SITE = cut('function islClean(', '/* the player\'s own record');
const LAKES = cut('/* ── lakes ──', '\nconst BIOME=');
const WRAP = cut('MAP.nbrFlat=MAP.nbr.slice();', '/* the shortest way across x');
const STAT_KEYS = vm.runInNewContext(cut('const STAT_KEYS = ', ';').replace('const STAT_KEYS = ', ''));
const L = vm.runInNewContext('(' + ISSUES_SRC.replace('const ISL_ISSUES=', '').replace(/;\s*$/, '') + ')', {});

test('three edicts, after the 50th, 150th and 500th decision, never drawn at random, the last edicts added', () => {
  assert.equal(L.length, 3);
  assert.deepEqual(J(L.map(x => x.isa)), [50, 150, 500]);
  assert.deepEqual(J(L.map(x => x.isle)), [1, 2, 3]);
  assert.match(SEC, /for\(const is of ISL_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\);is\.no=ISSUES\.length;ISSUE_BY_ID\[is\.id\]=is;is\.nbx=false;\}/, 'kept out of the random draw (fo)');
  /* every older edict keeps its number (n.iseen keeps numbers): nothing is pushed after these */
  const at = code.indexOf('for(const is of ISL_ISSUES){');
  assert.ok(at > code.indexOf('for(const is of DRL_ISSUES){ISSUES.push('), 'after the training edicts');
  /* but the three that build on the islands (island-dev.test.mjs), which keep the same rule */
  const next = code.indexOf('ISSUES.push(', at + 40);
  assert.ok(next > 0 && code.lastIndexOf('for(const is of ', next) === code.indexOf('for(const is of ISD_ISSUES){'), 'only the island towns, bridges and new land after them');
  /* and after those only the eight early Moon edicts (moon-edicts.test.mjs), which keep the same rule */
  const mn = code.indexOf('ISSUES.push(', next + 20);
  assert.ok(mn > 0 && code.lastIndexOf('for(const is of ', mn) === code.indexOf('for(const is of MN_ISSUES){'), 'only the Moon edicts after those');
  /* then the war edicts (war-round-two.test.mjs), and nothing after those */
  const war = code.indexOf('ISSUES.push(', mn + 20);
  assert.ok(war > 0 && code.lastIndexOf('for(const is of ', war) === code.indexOf('for(const is of WAR2_ISSUES){'), 'then only the war edicts');
  /* then the veterans' edicts (war-round-three.test.mjs), and nothing after those */
  const vet = code.indexOf('ISSUES.push(', war + 20);
  assert.ok(vet > 0 && code.lastIndexOf('for(const is of ', vet) === code.indexOf('for(const is of WAR3_ISSUES){'), 'then the veterans’ edicts');
  /* then the National Research Programme's (research.test.mjs), and nothing after those */
  const rsAt = code.indexOf('/* ───────── the National Research Programme (22 November 2026)'), rsP = code.indexOf('ISSUES.push(', vet + 20);
  assert.ok(rsAt > vet && rsP > rsAt, 'then the research edicts');
  assert.equal(code.indexOf('ISSUES.push(', code.indexOf('/* ───────── military buildings (22 November 2026)')), -1, 'and nothing after those');
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'ISL_ISSUES'/);
  for (const is of L) {
    assert.match(is.id, /^isl-[a-z-]+$/);
    assert.equal(source.split(`id:'${is.id}'`).length, 2, is.id + ' once');
    assert.ok(!is.req, is.id + ' has no condition of its own: the desk decides when it comes');
    assert.equal(is.o.length, 3);
    assert.doesNotMatch(is.t + is.q, /['"]/, is.id + ' typographic quotes');
    const sizes = is.o.map(o => o.e.isl);
    assert.ok(sizes.every(k => k === 4 || k === 5), is.id + ' raises 4 or 5 hexes with every answer');
    assert.ok(sizes.includes(4) && sizes.includes(5), is.id + ' offers a smaller and a larger island');
    for (const o of is.o) {
      assert.ok(o.t && o.fx && o.isn, is.id);
      assert.doesNotMatch(o.t + o.fx + o.isn, /['"]/, is.id + ' typographic quotes');
      for (const [k, v] of Object.entries(o.e)) {
        if (k === 'isl') continue;
        assert.ok(STAT_KEYS.includes(k), is.id + ' ' + k);
        assert.ok(Number.isInteger(v) && v !== 0 && Math.abs(v) <= 5, is.id + ' ' + k);
      }
    }
  }
  assert.equal(new Set(L.flatMap(x => x.o.map(o => o.isn))).size, 9, 'nine names');
});

/* ── the sites, on every region's real map ── */
function region(id) {
  const K = mapKit(source, id), MAP = K.generate();
  const hashLine = source.match(/^function hash\(str\)\{[^\n]+/m)[0];
  const ctx = vm.createContext({ MAP, landName: c => MAP.comp[c] >= 0 ? 'land' + MAP.comp[c] : 'a remote islet', RECL: { sig: 's', owner: new Map(), isl: new Map() } });
  vm.runInContext(WRAP, ctx);
  ctx.MAP_T0 = MAP.T.slice();
  vm.runInContext(vars(LAKES) + '\n' + hashLine + '\n' + vars(HEAD) + '\n' + vars(SITE), ctx);
  return ctx;
}
/* distances out from a set of hexes, over land and sea alike, as far as `max` */
function dist(MAP, from, max) {
  const D = new Int16Array(MAP.N).fill(-1), q = [...from]; for (const c of from) D[c] = 0;
  for (let h = 0; h < q.length; h++) { const a = q[h]; if (D[a] >= max) continue; for (let d = 0; d < 6; d++) { const j = MAP.nbr[a * 6 + d]; if (j >= 0 && D[j] < 0) { D[j] = D[a] + 1; q.push(j); } } }
  return D;
}
/* a small coastal nation round land hex c0: the land within r hexes of it, over land */
function landAround(MAP, c0, r) {
  const D = new Int16Array(MAP.N).fill(-1), q = [c0], out = []; D[c0] = 0;
  for (let h = 0; h < q.length; h++) { const a = q[h]; out.push(a); if (D[a] >= r) continue; for (let d = 0; d < 6; d++) { const j = MAP.nbr[a * 6 + d]; if (j >= 0 && D[j] < 0 && MAP.T[j] >= 2) { D[j] = D[a] + 1; q.push(j); } } }
  return out;
}

test('on every region: a round island of 4 or 5 sea hexes, apart from every coast, within 8 hexes, never nearer a neighbour', () => {
  const ids = mapKit(source, 'meridian').ids;
  let tried = 0, found = 0, near = 0, round = 0;
  for (const id of ids) {
    const R = region(id), MAP = R.MAP, lake = R.lakeMap();
    const coastal = [];
    for (let c = 0; c < MAP.N; c++) if (MAP.T[c] >= 2) for (let d = 0; d < 6; d++) { const j = MAP.nbr[c * 6 + d]; if (j >= 0 && MAP.T[j] === 1 && !lake[j]) { coastal.push(c); break; } }
    for (let s = 0; s < coastal.length; s += Math.max(1, Math.floor(coastal.length / 12))) {
      const mine = landAround(MAP, coastal[s], 4), owner = new Int16Array(MAP.N).fill(-1);
      for (const c of mine) owner[c] = 0;
      /* a neighbour 9 to 14 hexes along the coast, where there is one */
      const Dc = dist(MAP, [coastal[s]], 14), far = coastal.find(c => owner[c] === -1 && Dc[c] >= 9);
      const theirs = far != null ? landAround(MAP, far, 3).filter(c => owner[c] === -1) : [];
      for (const c of theirs) owner[c] = 1;
      const T = { owner, byId: { me: 0 } };
      for (const size of [5, 4]) {
        tried++;
        const site = R.islSite(T, 0, size, 'seed:' + s);
        if (!site) continue;
        found++;
        const cells = J(site), on = new Set(cells), Dm = dist(MAP, mine, 20), Do = dist(MAP, theirs, 20);
        assert.equal(cells.length, size, `${id}: ${size} hexes`);
        assert.equal(on.size, size, `${id}: no hex twice`);
        for (const c of cells) {
          assert.ok(MAP.T[c] < 2, `${id}: ${c} is sea`);
          assert.ok(!lake[c], `${id}: ${c} is not a lake`);
          assert.equal(owner[c], -1, `${id}: ${c} is nobody's`);
          for (let d = 0; d < 6; d++) { const j = MAP.nbr[c * 6 + d]; assert.ok(j < 0 || MAP.T[j] < 2, `${id}: ${c} touches no land`); }
          assert.ok(Dm[c] >= 2 && Dm[c] <= 8, `${id}: ${c} is ${Dm[c]} hexes out`);
          assert.ok(!theirs.length || Do[c] < 0 || Do[c] >= Dm[c], `${id}: ${c} is no nearer the neighbour`);
          if (Dm[c] <= 3) near++;
        }
        /* one island: every hex reached from the first through the others */
        const seen = new Set([cells[0]]), q = [cells[0]];
        for (let h = 0; h < q.length; h++) for (let d = 0; d < 6; d++) { const j = MAP.nbr[q[h] * 6 + d]; if (on.has(j) && !seen.has(j)) { seen.add(j); q.push(j); } }
        assert.equal(seen.size, size, `${id}: the island is in one piece`);
        /* as round as a group of its size can be: 7 touching pairs for five hexes, 5 for four */
        let e = 0; for (const c of cells) for (let d = 0; d < 6; d++) if (on.has(MAP.nbr[c * 6 + d])) e++;
        if (e / 2 === (size === 5 ? 7 : 5)) round++;
      }
    }
  }
  console.log(`islands: ${found} of ${tried} tries found a site, ${round} of them as round as can be; ${near} hexes within 3 of the coast`);
  assert.ok(found >= tried * 0.95, `a site for nearly every coastal nation (${found} of ${tried})`);
  assert.ok(round >= found * 0.9, `nearly every island a blob, not a line of sand (${round} of ${found})`);
});

test('a nation far from the sea gets no site; the same answer always picks the same hexes', () => {
  const R = region('ironsteppe'), MAP = R.MAP;
  const D = dist(MAP, [...Array(MAP.N).keys()].filter(c => MAP.T[c] < 2), 40);
  const inland = [...Array(MAP.N).keys()].find(c => MAP.T[c] >= 2 && D[c] >= 16);
  assert.ok(inland != null, 'the steppe has land 16 hexes from any water');
  const owner = new Int16Array(MAP.N).fill(-1); for (const c of landAround(MAP, inland, 3)) owner[c] = 0;
  assert.equal(R.islSite({ owner }, 0, 4, 'x'), null);
  const R2 = region('meridian'), M2 = R2.MAP, lake = R2.lakeMap();
  const c0 = [...Array(M2.N).keys()].find(c => M2.T[c] >= 2 && [0, 1, 2, 3, 4, 5].some(d => { const j = M2.nbr[c * 6 + d]; return j >= 0 && M2.T[j] === 1 && !lake[j]; }));
  const o2 = new Int16Array(M2.N).fill(-1); for (const c of landAround(M2, c0, 4)) o2[c] = 0;
  const a = J(R2.islSite({ owner: o2 }, 0, 5, 'n:isl:1')), b = J(region('meridian').islSite({ owner: o2 }, 0, 5, 'n:isl:1'));
  assert.deepEqual(a, b);
  /* land from the sea already raised there is passed over */
  const R3 = region('meridian'); for (const c of a) R3.RECL.owner.set(c, 'x');
  const c3 = J(R3.islSite({ owner: o2 }, 0, 5, 'n:isl:1'));
  assert.ok(c3 && c3.every(c => !a.includes(c)), 'a second island stands apart from the first');
});

/* ── when the edicts come ── */
function desk({ dec, seen = [], inbox = [], site = true, obs = false, mine = true }) {
  const n = { founded: 1000, name: 'Isla', seed: 'sd', inbox, answered: [{ id: 'x', o: 0, t: 5000 }], dec };
  const ctx = vm.createContext({ OBS: obs, S: { nation: mine ? n : { founded: 2, name: 'Other' } }, decisions: x => x.dec, issLast: () => new Map(seen.map(id => [id, { d: 1 }])),
    territory: () => ({ byId: { me: 0 } }), myId: () => 'me', console });
  vm.runInContext(vars(HEAD) + '\n' + 'var ISL_ISSUES=' + ISSUES_SRC.replace('const ISL_ISSUES=', '') + ';\nvar islSalt=(n,k)=>String((n&&(n.seed||n.name))||"")+":isl:"+k;\n' +
    ['islMine', 'islNext', 'islDue'].map(f => functions.get(f)).join('\n') + `\nvar islSite=()=>${site ? '[1,2,3,4]' : 'null'};`, ctx);
  return J(ctx.islDue(n, 9000));
}
test('the next island edict lands at 50, 150 and 500 decisions, one at a time, dated at the latest decision', () => {
  assert.deepEqual(desk({ dec: 49 }), []);
  assert.deepEqual(desk({ dec: 50 }), [{ id: 'isl-dredger', at: 5000 }]);
  assert.deepEqual(desk({ dec: 149, seen: ['isl-dredger'] }), []);
  assert.deepEqual(desk({ dec: 150, seen: ['isl-dredger'] }).map(x => x.id), ['isl-runway']);
  assert.deepEqual(desk({ dec: 499, seen: ['isl-dredger', 'isl-runway'] }), []);
  assert.deepEqual(desk({ dec: 500, seen: ['isl-dredger', 'isl-runway'] }).map(x => x.id), ['isl-last-barge']);
  assert.deepEqual(desk({ dec: 900, seen: ['isl-dredger', 'isl-runway', 'isl-last-barge'] }), [], 'each comes once');
  assert.deepEqual(desk({ dec: 600 }).map(x => x.id), ['isl-dredger'], 'a nation past 500 meets them in order');
  assert.deepEqual(desk({ dec: 600, inbox: [{ id: 'isl-dredger', at: 1 }] }), [], 'not while the first is still on the desk');
  assert.deepEqual(desk({ dec: 60, site: false }), [], 'no free shallows near the land: it waits');
  assert.deepEqual(desk({ dec: 60, obs: true }), [], 'not for an observer');
  assert.deepEqual(desk({ dec: 60, mine: false }), [], 'only to the player’s own nation');
  assert.match(SEC, /syncInbox=\(f=>function\(n,now\)\{\n  const m=f\.apply\(this,arguments\);let due=\[\];try\{due=islDue\(m,now\);\}/);
  assert.match(SEC, /for\(const x of due\)if\(deskN\(out\.inbox\)<EDICT_KEEP\)out\.inbox\.push\(x\);/, 'only when the desk has room');
});

/* ── the answer ── */
function answer(site, n0 = {}) {
  const ctx = vm.createContext({ console, territory: () => ({ byId: { me: 0 } }), myId: () => 'me', ISSUE_BY_ID: {},
    fill: (t, n) => String(t).replace(/\{CAP\}/g, n.capital).replace(/\{D\}/g, n.demonym).replace(/\{N\}/g, n.name),
    addBonusCredits: (n, k) => { n.lcb = (n.lcb || 0) + k; return k; }, landName: () => 'Westmark', MAP: { nbr: [], T: [], comp: [] }, geoAfter: () => [] });
  vm.runInContext(vars(HEAD) + '\nvar ISL_ISSUES=' + ISSUES_SRC.replace('const ISL_ISSUES=', '') + ';for(const is of ISL_ISSUES)ISSUE_BY_ID[is.id]=is;\n' +
    'var islSalt=(n,k)=>String((n&&(n.seed||n.name))||"")+":isl:"+k;\n' + functions.get('islClean') + '\nvar islShore=()=>"Westmark";\n' + `var islSite=(T,i,size)=>${JSON.stringify(site)}===null?null:${JSON.stringify(site)}.slice(0,size);\n` + cut('geoAfter=(f=>function(n,opt,ent,now,prior){\n  const notes=f.apply(this,arguments)||[],want=', '/* the island\'s hexes have no landmass'), ctx);
  const n = { name: 'Isla', capital: 'Port Ondo', demonym: 'Islan', seed: 'sd', rec: [{ c: 7, t: 1 }], log: [], ...n0 };
  const is = ctx.ISSUE_BY_ID['isl-dredger'];
  const notes = ctx.geoAfter(n, is.o[0], { id: 'isl-dredger' }, 5000);
  return { n: J(n), notes: J(notes) };
}
test('an answer raises the island at once: its hexes in the record with i, its name kept, a log line and a note', () => {
  const { n, notes } = answer([101, 102, 103, 104, 105, 106]);
  assert.deepEqual(n.isl, [{ c: 101, t: 5000, i: 1 }, { c: 102, t: 5001, i: 1 }, { c: 103, t: 5002, i: 1 }, { c: 104, t: 5003, i: 1 }, { c: 105, t: 5004, i: 1 }]);
  assert.deepEqual(n.rec, [{ c: 7, t: 1 }], 'the reclaimed land is left alone');
  assert.deepEqual(n.isn, { 1: 'Port Ondo Port Island' });
  assert.deepEqual(n.log[0], { t: 5000, k: 'isl', a: '5', b: 'Port Ondo Port Island', fx: 'Westmark' });
  assert.equal(notes[0][0], 'Island');
  assert.match(notes[0][1], /^Port Ondo Port Island, an island of 5 hexes, has risen from the sea off Westmark\. It is yours already, without a land credit\.$/);
  assert.equal(n.lcb, undefined, 'no land credit spent or given');
  const none = answer(null);
  assert.equal(none.n.isl, undefined, 'no site: no hexes');
  assert.equal(none.n.lcb, 5, 'the land office pays a credit a hex instead');
  assert.equal(none.notes[0][0], 'Land office');
  const odd = answer([1, 2, 3, 4, 5], { capital: '<img src=x>' });
  assert.deepEqual(odd.n.isn, { 1: 'img srcx Port Island' }, 'a name keeps to letters, digits and a few marks');
});

test('the record keeps the islands apart from the reclaimed land, and the names, here and on another region’s page', () => {
  assert.match(code, /const REC_MAX=24,RECW_MAX=\d+,REC_KEEP=REC_MAX\+RECW_MAX;/, 'the edicts’ and engineers’ limits are untouched');
  assert.match(code, /const MAP_KEEP=\[[^\]]*'rec','isl'[^\]]*\];/, 'a record read on another region’s page keeps its islands as they were');
  assert.ok(cut('function remapFront(d){', '\nfunction remapLate(').includes("for(const k of ['claims','conq','bx','rec','isl','isx'])if(Array.isArray(d[k]))o[k]=d[k].map(e=>e&&typeof e==='object'?{...e,c:m(e.c)}:e);"),
    'the frontier moves them with the rest of the land');
  assert.equal(code.split('n.bx=[];n.rec=[];n.isl=[];n.isx=[];delete n.isw;n.cv=MAP_VER;').length, 4, 'moving, settling again and waking clear them with the reclaimed land');
  const hooks = [], ctx = vm.createContext({ NORM_HOOKS: hooks, MAP: { N: 100 }, MAP_T0: Uint8Array.from({ length: 100 }, (_, i) => i < 60 ? (i % 2) : 2), MAP_VER: 5 });
  const tail = '\n  if(o.length)n.isl=o;});';
  vm.runInContext(functions.get('islClean') + '\n' + cut('NORM_HOOKS.push((n,d)=>{const s=d&&d.isn;', '\n') + '\n' + cut('NORM_HOOKS.push((n,d)=>{const a=d&&d.isl;', tail) + tail, ctx);
  const n = {}; hooks[0](n, { isn: { 1: 'Port Island', 2: 42, 4: 'Nope', 3: 'A'.repeat(60) } });
  assert.deepEqual(J(n), { isn: { 1: 'Port Island', 3: 'A'.repeat(40) } });
  const m = {}; hooks[0](m, {}); assert.deepEqual(J(m), {});
  const isl = [{ c: 1, t: 1, i: 1 }, { c: 0, t: 2, i: 1 }, { c: 1, t: 3, i: 1 }, { c: 70, t: 4, i: 1 }, { c: 2, t: 5, i: 4 }, { c: 3, t: 'x', i: 2 }, { c: 4, t: 6, i: 2 },
    ...[10, 11, 12, 13, 14, 15].map((c, k) => ({ c, t: 10 + k, i: 3 }))];
  const r = { cv: 5 }; hooks[1](r, { cv: 5, isl }); 
  assert.deepEqual(J(r.isl), [{ c: 1, t: 1, i: 1 }, { c: 0, t: 2, i: 1 }, { c: 4, t: 6, i: 2 }, ...[10, 11, 12, 13, 14].map((c, k) => ({ c, t: 10 + k, i: 3 }))],
    'sea hexes (deep or shallow) of this map, each once, islands 1 to 3, five at most an island');
  const old = {}; hooks[1](old, { cv: 4, isl }); assert.equal(old.isl, undefined, 'another map’s numbers are not read as this one’s');
});

test('every viewer replays the island as land held by its nation, under its own name', () => {
  const T0 = new Uint8Array(50).fill(1); T0[20] = T0[21] = 0; T0[22] = 2;
  const lake = new Uint8Array(50); lake[30] = 1;
  const made = [], ctx = vm.createContext({ MAP: { N: 50, comp: new Int16Array(50).fill(-1) }, MAP_T0: T0, LAKE: lake, lakeMap: () => lake,
    S: { nation: { rec: [{ c: 3, t: 10 }], isl: [{ c: 4, t: 11, i: 2 }, { c: 5, t: 12, i: 2 }, { c: 20, t: 13, i: 2 }] },
      world: { b: { rec: [{ c: 21, t: 14 }], isl: [{ c: 5, t: 5, i: 1 }, { c: 9, t: 6, i: 9 }, { c: 30, t: 15, i: 1 }, { c: 22, t: 16, i: 1 }], isn: { 1: 'Bee Isle' } } }, mode: 'world', uid: 'me' },
    myId: () => 'me', reclaimCell: c => made.push(c), unreclaimCell: () => {}, terrCache: new Map(), atlasCache: null });
  vm.runInContext([cut('let RECL={sig:', '\n'), functions.get('readReclaims'), functions.get('islClean'), functions.get('islAt'),
    'var ISL_FALLBACK="an artificial island",findNation=id=>({n:S.world[id]});this.R=readReclaims();'].join('\n'), ctx);
  const R = ctx.R;
  assert.deepEqual(J([...R.owner]), [[5, 'b'], [3, 'me'], [4, 'me'], [20, 'me']], 'the first to raise a hex holds it; an island may stand in deep sea, a reclaim may not; never on a lake or on land');
  assert.deepEqual(J([...R.isl]), [[5, 1], [4, 2], [20, 2]], 'an island hex keeps its island');
  assert.deepEqual(made, [5, 3, 4, 20], 'each becomes land');
  assert.match(R.sig, /^b:5i1,me:3,me:4i2,me:5i2,me:20i2,b:21,b:30i1,b:22i1$/);
  ctx.S.nation.isn = { 2: 'Runway Isle' };
  assert.equal(ctx.islAt(4), 'Runway Isle');
  assert.equal(ctx.islAt(5), 'Bee Isle');
  assert.equal(ctx.islAt(3), '', 'not an island');
  delete ctx.S.world.b.isn; assert.equal(ctx.islAt(5), 'an artificial island');
});
