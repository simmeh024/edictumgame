// Island towns, land bridges and more land (game/edictum.html, section "island towns, land bridges and more land"):
// three edicts that build on the artificial islands, after a nation's 550th, 750th and 900th decision. The first founds
// a town on one of the nation's islands (free, and one more city than it may otherwise found), the second a land bridge
// of free sea from an island to its other land, the third adds three hexes to one island. The bridge and the new land
// are land from the sea, kept in n.isx. The plans are checked on every region's real map, made by the game's own
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

const SEC = cut('/* ───────── island towns, land bridges and more land', '/* ───────── achievements, round five');
const HEAD = cut('const ISD_AT=', '\nconst ISD_ISSUES=');
const ISSUES_SRC = cut('const ISD_ISSUES=', '\nfor(const is of ISD_ISSUES)');
const PLANS = cut('function isdHexOf(', '/* the next of the three');
const ISL_HEAD = cut('const ISL_AT=', '\nconst ISL_ISSUES=');
const SITE = cut('function islClean(', '/* the player\'s own record');
const LAKES = cut('/* ── lakes ──', '\nconst BIOME=');
const WRAP = cut('MAP.nbrFlat=MAP.nbr.slice();', '/* the shortest way across x');
const STAT_KEYS = vm.runInNewContext(cut('const STAT_KEYS = ', ';').replace('const STAT_KEYS = ', ''));
const L = vm.runInNewContext('(' + ISSUES_SRC.replace('const ISD_ISSUES=', '').replace(/;\s*$/, '') + ')', {});
const hashLine = source.match(/^function hash\(str\)\{[^\n]+/m)[0];

test('three edicts, after the 550th, 750th and 900th decision: a town, a land bridge, more land; never drawn at random, the last edicts added', () => {
  assert.equal(L.length, 3);
  assert.deepEqual(J(L.map(x => x.isa)), [550, 750, 900]);
  assert.deepEqual(J(L.map(x => x.isd)), ['town', 'bridge', 'grow']);
  assert.match(SEC, /for\(const is of ISD_ISSUES\)\{is\.fo=1;ISSUES\.push\(is\);is\.no=ISSUES\.length;ISSUE_BY_ID\[is\.id\]=is;is\.nbx=false;\}/, 'kept out of the random draw (fo)');
  const at = code.indexOf('for(const is of ISD_ISSUES){');
  assert.ok(at > code.indexOf('for(const is of ISL_ISSUES){'), 'after the islands');
  /* every older edict keeps its number: nothing is added after them but the eight early Moon edicts (moon-edicts.test.mjs) */
  const mn = code.indexOf('ISSUES.push(', at + 40);
  assert.equal(mn, code.indexOf('for(const is of MN_ISSUES){') + 'for(const is of MN_ISSUES){is.req=mnReq;'.length, 'only the Moon edicts after them');
  /* then the war edicts (war-round-two.test.mjs), and nothing after those */
  const war = code.indexOf('ISSUES.push(', mn + 20);
  assert.ok(war > 0 && code.lastIndexOf('for(const is of ', war) === code.indexOf('for(const is of WAR2_ISSUES){'), 'then only the war edicts');
  /* then the veterans' edicts (war-round-three.test.mjs), and nothing after those */
  const vet = code.indexOf('ISSUES.push(', war + 20);
  assert.ok(vet > 0 && code.lastIndexOf('for(const is of ', vet) === code.indexOf('for(const is of WAR3_ISSUES){'), 'then the veterans’ edicts');
  /* then the National Research Programme's (research.test.mjs), and nothing after those */
  const rsAt = code.indexOf('/* ───────── the National Research Programme (22 November 2026)'), rsP = code.indexOf('ISSUES.push(', vet + 20);
  assert.ok(rsAt > vet && rsP > rsAt, 'then the research edicts');
  {const rse=code.indexOf('/* ───────── research edicts (23 November 2026)'),nx=code.indexOf('ISSUES.push(', code.indexOf('/* ───────── military buildings (22 November 2026)'));assert.ok(rse>0&&nx>rse,'and nothing after those but the research edicts (research-edicts.test.mjs)');}
  assert.match(fs.readFileSync(new URL('../scripts/split-content.mjs', import.meta.url), 'utf8'), /'ISL_ISSUES','ISD_ISSUES'/);
  for (const is of L) {
    assert.match(is.id, /^isl-[a-z-]+$/);
    assert.equal(source.split(`id:'${is.id}'`).length, 2, is.id + ' once');
    assert.ok(!is.req, is.id + ' has no condition of its own: the desk decides when it comes');
    assert.equal(is.o.length, 3);
    assert.doesNotMatch(is.t, /\{/, is.id + ': the title names no island (it is shown where the edict is not)');
    assert.doesNotMatch(is.t + is.q, /['"]/, is.id + ' typographic quotes');
    for (const o of is.o) {
      assert.ok(o.t && o.fx, is.id);
      if (is.isd === 'town') assert.ok(o.tn, is.id + ': every answer names its town');
      if (is.isd === 'bridge') assert.ok(o.bn, is.id + ': every answer names its bridge');
      assert.doesNotMatch(o.t + o.fx + (o.tn || '') + (o.bn || ''), /['"]/, is.id + ' typographic quotes');
      for (const [k, v] of Object.entries(o.e)) {
        assert.ok(STAT_KEYS.includes(k), is.id + ' ' + k);
        assert.ok(Number.isInteger(v) && v !== 0 && Math.abs(v) <= 5, is.id + ' ' + k);
      }
    }
  }
  assert.match(L[0].q, /\{ISLE\}/); assert.match(L[1].q, /\{ISLE\}.*\{ISHORE\}.*\{BRN\}/); assert.match(L[2].q, /\{ISLE\}/);
  assert.equal(new Set(L[0].o.map(o => o.tn)).size, 3, 'three town names');
  assert.equal(new Set(L[1].o.map(o => o.bn)).size, 3, 'three bridge names');
});

/* ── the plans, on every region's real map ── */
function region(id) {
  const K = mapKit(source, id), MAP = K.generate();
  const ctx = vm.createContext({ MAP, console, landName: c => 'land' + MAP.comp[c], RECL: { sig: 's', owner: new Map(), isl: new Map(), isb: new Map() } });
  vm.runInContext(WRAP, ctx);
  ctx.MAP_T0 = MAP.T.slice();
  vm.runInContext([vars(LAKES), hashLine, functions.get('hexDist'), vars(ISL_HEAD), vars(SITE), vars(HEAD),
    'var CITY_MIN_DIST=4,MAX_CITIES=33,myId=()=>"me",cityList=n=>n.cities,cityLabel=(n,c)=>c.nm,cityNameIdea=c=>"Idea"+c,fill=(t,n)=>String(t).replace(/\\{CAP\\}/g,"Ondo").replace(/\\{D\\}/g,"Ondan");',
    vars(PLANS)].join('\n'), ctx);
  return ctx;
}
function dist(MAP, from, max) {
  const D = new Int16Array(MAP.N).fill(-1), q = [...from]; for (const c of from) D[c] = 0;
  for (let h = 0; h < q.length; h++) { const a = q[h]; if (D[a] >= max) continue; for (let d = 0; d < 6; d++) { const j = MAP.nbr[a * 6 + d]; if (j >= 0 && D[j] < 0) { D[j] = D[a] + 1; q.push(j); } } }
  return D;
}
function landAround(MAP, c0, r) {
  const D = new Int16Array(MAP.N).fill(-1), q = [c0], out = []; D[c0] = 0;
  for (let h = 0; h < q.length; h++) { const a = q[h]; out.push(a); if (D[a] >= r) continue; for (let d = 0; d < 6; d++) { const j = MAP.nbr[a * 6 + d]; if (j >= 0 && D[j] < 0 && MAP.T[j] >= 2) { D[j] = D[a] + 1; q.push(j); } } }
  return out;
}
const nbrs = (MAP, c) => [0, 1, 2, 3, 4, 5].map(d => MAP.nbr[c * 6 + d]).filter(j => j >= 0);

/* a coastal nation round c0 with its capital there, a neighbour along the coast, and the first island raised (as the
   game would: its hexes land held by the nation), ready for the three plans */
function islandNation(R, c0, s) {
  const MAP = R.MAP, owner = new Int16Array(MAP.N).fill(-1), mine = landAround(MAP, c0, 4);
  for (const c of mine) owner[c] = 0;
  const Dc = dist(MAP, [c0], 14), far = mine.length ? [...Array(MAP.N).keys()].find(c => owner[c] === -1 && MAP.T[c] >= 2 && Dc[c] >= 9 && Dc[c] <= 14) : undefined;
  const theirs = far != null ? landAround(MAP, far, 3).filter(c => owner[c] === -1) : [];
  for (const c of theirs) owner[c] = 1;
  const T0 = { owner, byId: { me: 0 }, isCap: new Uint8Array(MAP.N) };
  R.RECL = { sig: 'none' + s, owner: new Map(), isl: new Map(), isb: new Map() };
  const cells = R.islSite(T0, 0, 5, 'seed:' + s);
  if (!cells) return null;
  const isl = [...cells], T = { owner: owner.slice(), byId: { me: 0 }, isCap: new Uint8Array(MAP.N) }; T.isCap[c0] = 1;
  const keep = isl.map(c => [c, MAP.T[c]]);
  for (const c of isl) { MAP.T[c] = 2; T.owner[c] = 0; R.RECL.owner.set(c, 'me'); R.RECL.isl.set(c, 1); }
  R.RECL.sig = 'isl' + s;
  const n = { name: 'Isla', seed: 'sd' + s, isl: isl.map((c, k) => ({ c, t: k, i: 1 })), isn: { 1: 'Test Isle' }, cities: [{ id: 'cap', c: c0, nm: 'Ondo' }] };
  const CS = { all: [{ c: c0, fid: 'me', active: true }].concat(far != null ? [{ c: far, fid: 'b', active: true }] : []) };
  R.territory = () => T; R.cityState = () => CS;
  return { T, n, isl, mine, theirs, far, CS, undo: () => { for (const [c, t] of keep) MAP.T[c] = t; } };
}

test('on every region: a town on the island clear of cities, the shortest free way to the mainland, three new hexes beside it', () => {
  const ids = mapKit(source, 'meridian').ids;
  let tried = 0, towns = 0, shallowTowns = 0, bridges = 0, grows = 0, bridgeLen = 0;
  for (const id of ids) {
    const R = region(id), MAP = R.MAP, lake = R.lakeMap();
    const coastal = [];
    for (let c = 0; c < MAP.N; c++) if (MAP.T[c] >= 2) for (let d = 0; d < 6; d++) { const j = MAP.nbr[c * 6 + d]; if (j >= 0 && MAP.T[j] === 1 && !lake[j]) { coastal.push(c); break; } }
    for (let s = 0; s < coastal.length; s += Math.max(1, Math.floor(coastal.length / 8))) {
      const N = islandNation(R, coastal[s], s);
      if (!N) continue;
      tried++;
      const { T, n, isl, CS } = N, onIsl = new Set(isl);
      /* the town */
      const town = J(R.isdPick(n, 'town'));
      if (town) {
        towns++;
        assert.equal(town.k, 1, `${id}: on the island`);
        assert.ok(onIsl.has(town.c), `${id}: on a hex of the island as raised`);
        for (const ct of CS.all) assert.ok(R.hexDist(ct.c, town.c) >= (ct.fid === 'me' ? 3 : 4), `${id}: clear of ${ct.fid}'s city`);
        const shallowOk = isl.some(c => R.MAP_T0[c] === 1 && CS.all.every(ct => R.hexDist(ct.c, c) >= (ct.fid === 'me' ? 3 : 4)));
        if (shallowOk) assert.equal(R.MAP_T0[town.c], 1, `${id}: a shallow hex where one will do (an older page keeps its city)`);
        if (R.MAP_T0[town.c] === 1) shallowTowns++;
      }
      /* the bridge */
      const br = J(R.isdPick(n, 'bridge'));
      if (br) {
        bridges++; bridgeLen += br.cells.length;
        assert.equal(br.k, 1);
        assert.ok(br.cells.length >= 1 && br.cells.length <= 8, `${id}: ${br.cells.length} hexes`);
        assert.equal(new Set(br.cells).size, br.cells.length);
        const F = R.islField(T, 0);
        for (const c of br.cells) {
          assert.ok(MAP.T[c] < 2 && R.MAP_T0[c] < 2 && !lake[c] && T.owner[c] === -1, `${id}: ${c} is free sea`);
          assert.ok(!(F.O[c] >= 0 && F.O[c] < F.D[c]), `${id}: ${c} is no nearer the neighbour`);
        }
        assert.ok(nbrs(MAP, br.cells[0]).some(j => onIsl.has(j)), `${id}: it starts at the island`);
        br.cells.slice(1).forEach((c, k) => assert.ok(nbrs(MAP, br.cells[k]).includes(c), `${id}: one hex after another`));
        const main = j => T.owner[j] === 0 && MAP.T[j] >= 2 && !onIsl.has(j);
        assert.ok(nbrs(MAP, br.cells.at(-1)).some(main), `${id}: it ends at the mainland`);
        assert.ok(!br.cells.slice(0, -1).some(c => nbrs(MAP, c).some(main)), `${id}: and no sooner`);
        /* no shorter way of free sea */
        const free = c => MAP.T[c] < 2 && R.MAP_T0[c] < 2 && !lake[c] && T.owner[c] === -1 && !(F.O[c] >= 0 && F.O[c] < F.D[c]);
        const D = new Map(), q = []; for (const c of isl) for (const j of nbrs(MAP, c)) if (free(j) && !D.has(j)) { D.set(j, 1); q.push(j); }
        let best = Infinity; for (let h = 0; h < q.length; h++) { const a = q[h]; if (nbrs(MAP, a).some(main)) { best = Math.min(best, D.get(a)); continue; } for (const j of nbrs(MAP, a)) if (free(j) && !D.has(j)) { D.set(j, D.get(a) + 1); q.push(j); } }
        assert.equal(br.cells.length, best, `${id}: the shortest way`);
      }
      /* more land */
      const g = J(R.isdPick(n, 'grow'));
      if (g) {
        grows++;
        assert.equal(g.k, 1); assert.equal(g.cells.length, 3);
        const grown = new Set(isl);
        for (const c of g.cells) {
          assert.ok(MAP.T[c] < 2 && R.MAP_T0[c] < 2 && !lake[c] && T.owner[c] === -1, `${id}: ${c} is free sea`);
          assert.ok(nbrs(MAP, c).some(j => grown.has(j)), `${id}: ${c} touches the island`);
          assert.ok(!nbrs(MAP, c).some(j => T.owner[j] === 1 && MAP.T[j] >= 2), `${id}: ${c} is not beside the neighbour`);
          grown.add(c);
        }
      }
      N.undo();
    }
  }
  console.log(`island development: ${tried} nations with an island; a town for ${towns} (${shallowTowns} on the shallows), a bridge for ${bridges} (${(bridgeLen / Math.max(1, bridges)).toFixed(1)} hexes on average), new land for ${grows}`);
  assert.ok(tried >= 150, `enough nations tried (${tried})`);
  assert.ok(towns >= tried * 0.6, `a town site for most (${towns} of ${tried})`);
  assert.ok(bridges >= tried * 0.9, `a way across for nearly all (${bridges} of ${tried})`);
  assert.ok(grows >= tried * 0.95, `room to grow for nearly all (${grows} of ${tried})`);
});

test('the town keeps clear of every city, the island grows round the town first, and a joined island needs no bridge', () => {
  const R = region('meridian'), MAP = R.MAP, lake = R.lakeMap();
  const coastal = [...Array(MAP.N).keys()].filter(c => MAP.T[c] >= 2 && nbrs(MAP, c).some(j => MAP.T[j] === 1 && !lake[j]));
  let N = null; for (let s = 0; s < coastal.length && !(N && J(R.isdPick(N.n, 'town'))); s += 7) { if (N) N.undo(); N = islandNation(R, coastal[s], s); }
  assert.ok(N, 'a nation with an island and a town site');
  const { n, isl, CS } = N, town = J(R.isdPick(n, 'town'));
  assert.ok(town && isl.includes(town.c), 'a town site on the island');
  /* a city of the nation's own three hexes from every island hex leaves no site */
  const n2 = { ...n, cities: n.cities.concat(isl.map((c, k) => ({ id: 'x' + k, c: -1 }))) };
  const crowd = { all: CS.all.concat(isl.map(c => ({ c, fid: 'me', active: true }))) };
  R.cityState = () => crowd; assert.equal(R.isdPick(n2, 'town'), null, 'no hex clear of the cities: no town (the charter instead)');
  R.cityState = () => CS;
  assert.equal(R.isdPick({ ...n, cities: Array.from({ length: 33 }, (_, k) => ({ id: 'c' + k, c: -1 })) }, 'town'), null, 'a nation with every city it may found gets no town');
  assert.deepEqual(J(R.isdPick({ ...n }, 'town')), town, 'the same nation, the same hex');
  N.undo();
});

/* ── when they come ── */
function desk({ dec, seen = [], inbox = [], own = 1, obs = false, mine = true }) {
  const n = { founded: 1000, name: 'Isla', seed: 'sd', inbox, answered: [{ id: 'x', o: 0, t: 5000 }], dec };
  const ctx = vm.createContext({ OBS: obs, S: { nation: mine ? n : { founded: 2, name: 'Other' } }, decisions: x => x.dec, issLast: () => new Map(seen.map(id => [id, { d: 1 }])), console,
    isdCtx: () => ({ own: new Map(own ? [[1, [5, 6, 7, 8]]] : []) }) });
  vm.runInContext(vars(HEAD) + '\nvar ISD_ISSUES=' + ISSUES_SRC.replace('const ISD_ISSUES=', '') + ';\n' + ['islMine', 'isdNext', 'isdDue'].map(f => functions.get(f)).join('\n'), ctx);
  return J(ctx.isdDue(n, 9000));
}
test('the next one lands at 550, 750 and 900 decisions, one at a time, to a nation holding an island', () => {
  assert.deepEqual(desk({ dec: 549 }), []);
  assert.deepEqual(desk({ dec: 550 }), [{ id: 'isl-town', at: 5000 }]);
  assert.deepEqual(desk({ dec: 749, seen: ['isl-town'] }), []);
  assert.deepEqual(desk({ dec: 750, seen: ['isl-town'] }).map(x => x.id), ['isl-causeway']);
  assert.deepEqual(desk({ dec: 899, seen: ['isl-town', 'isl-causeway'] }), []);
  assert.deepEqual(desk({ dec: 900, seen: ['isl-town', 'isl-causeway'] }).map(x => x.id), ['isl-more-land']);
  assert.deepEqual(desk({ dec: 2000, seen: ['isl-town', 'isl-causeway', 'isl-more-land'] }), [], 'each comes once');
  assert.deepEqual(desk({ dec: 1000 }).map(x => x.id), ['isl-town'], 'a nation past 900 meets them in order');
  assert.deepEqual(desk({ dec: 1000, inbox: [{ id: 'isl-town', at: 1 }] }), [], 'not while the town is still on the desk');
  assert.deepEqual(desk({ dec: 600, own: 0 }), [], 'not without an island');
  assert.deepEqual(desk({ dec: 600, obs: true }), [], 'not for an observer');
  assert.deepEqual(desk({ dec: 600, mine: false }), [], 'only to the player’s own nation');
  assert.match(SEC, /syncInbox=\(f=>function\(n,now\)\{\n  const m=f\.apply\(this,arguments\);let due=\[\];try\{due=isdDue\(m,now\);\}/);
  assert.match(SEC, /due=isdDue\(m,now\);[^\n]*\n  const out=m===n\?clone\(m\):m;for\(const x of due\)if\(deskN\(out\.inbox\)<EDICT_KEEP\)out\.inbox\.push\(x\);/, 'only when the desk has room');
});

/* ── the answers ── */
function answer(kind, plan, n0 = {}, o = 0) {
  const ctx = vm.createContext({ console, ISSUE_BY_ID: {}, MAX_CITIES: 33, CITY_MIN_DIST: 4, geoAfter: () => [],
    fill: (t, n) => String(t).replace(/\{CAP\}/g, n.capital).replace(/\{D\}/g, n.demonym).replace(/\{N\}/g, n.name),
    addBonusCredits: (n, k) => { n.lcb = (n.lcb || 0) + k; return k; }, landName: c => 'Isle hex ' + c, cityList: n => n.cities || [], cityLabel: (n, c) => c.nm,
    cityNameIdea: c => 'Idea ' + c, ensureCities: n => { n.cities = (n.cities || []).map(c => ({ ...c })); return n; }, isdPick: () => plan });
  vm.runInContext([vars(HEAD), 'var ISD_ISSUES=' + ISSUES_SRC.replace('const ISD_ISSUES=', '') + ';for(const is of ISD_ISSUES)ISSUE_BY_ID[is.id]=is;',
    'var ISL_FALLBACK="an artificial island";', functions.get('islClean'), functions.get('isdIsle'), 'var isdCap1=' + cut('const isdCap1=', ';\n').replace('const isdCap1=', ''),
    functions.get('isdTownName'), functions.get('isdCityId'),
    cut('geoAfter=(f=>function(n,opt,ent,now,prior){\n  const notes=f.apply(this,arguments)||[],is=ent&&ISSUE_BY_ID[ent.id];\n  if(!opt||!is||!is.isd', '/* the town\'s charter')].join('\n'), ctx);
  const n = { name: 'Isla', capital: 'Port Ondo', demonym: 'Islan', cities: [{ id: 'cap', c: 1, nm: 'Port Ondo' }], isn: { 1: 'Tern Island', 2: 'Runway Isle' }, log: [], ...n0 };
  const id = { town: 'isl-town', bridge: 'isl-causeway', grow: 'isl-more-land' }[kind], is = ctx.ISSUE_BY_ID[id];
  const notes = ctx.geoAfter(n, is.o[o], { id }, 5000);
  return { n: J(n), notes: J(notes) };
}
test('the town is founded free on its island, with the charter for one more city', () => {
  const { n, notes } = answer('town', { k: 2, c: 77 });
  assert.equal(n.cities.length, 2);
  assert.deepEqual(n.cities[1], { id: 'c' + (5000).toString(36), c: 77, nm: 'Port Ondo Haven', t: 5000, b: [] });
  assert.deepEqual(n.isw, { ti: 2, tc: 'c' + (5000).toString(36) });
  assert.deepEqual(n.log[0], { t: 5000, k: 'city', a: 'Port Ondo Haven', fx: 'Isle hex 77' }, 'founded like any city: the news and the history say so');
  assert.deepEqual(notes[0], ['Town', 'Port Ondo Haven is founded on Runway Isle, free: a city on top of those Isla may found.']);
  assert.equal(n.lcb, undefined);
  assert.equal(answer('town', { k: 1, c: 78 }, {}, 1).n.cities[1].nm, 'Islan Garden Town');
  /* n.isd is the days each edict was seen (issPack): the islands' own record is n.isw, and never touches it */
  const days = answer('town', { k: 1, c: 78 }, { isd: [20778, 2] }).n;
  assert.deepEqual(days.isd, [20778, 2]); assert.deepEqual(days.isw, { ti: 1, tc: days.cities[1].id });
  assert.doesNotMatch(SEC, /\b[nd]\.isd\b/, 'the section never reads or writes n.isd');
  /* a name the nation has already: the map's idea instead */
  assert.equal(answer('town', { k: 1, c: 78 }, { cities: [{ id: 'cap', c: 1, nm: 'Port Ondo Haven' }] }).n.cities[1].nm, 'Idea 78');
  const none = answer('town', null);
  assert.deepEqual(none.n.isw, { ti: 0 }, 'no hex free: the charter alone');
  assert.equal(none.n.cities.length, 1);
  assert.equal(none.notes[0][0], 'Town charter');
  assert.match(none.notes[0][1], /you may found one more city, anywhere you hold land\.$/);
  const full = answer('town', { k: 1, c: 78 }, { cities: Array.from({ length: 33 }, (_, k) => ({ id: 'c' + k, c: k, nm: 'C' + k })) });
  assert.equal(full.n.cities.length, 33); assert.equal(full.n.isw, undefined); assert.equal(full.n.lcb, 3, 'every city founded: the land office pays');
  assert.equal(full.notes[0][0], 'Land office');
});
test('the land bridge and the new land rise as land from the sea (n.isx), named, logged, or paid for', () => {
  const { n, notes } = answer('bridge', { k: 1, cells: [40, 41, 42], shore: 'Westmark' });
  assert.deepEqual(n.isx, [{ c: 40, t: 5000, i: 1, k: 'b' }, { c: 41, t: 5001, i: 1, k: 'b' }, { c: 42, t: 5002, i: 1, k: 'b' }]);
  assert.deepEqual(n.isw, { bn: 'Port Ondo Causeway' });
  assert.deepEqual(n.log[0], { t: 5000, k: 'isb', a: '3', b: 'Port Ondo Causeway', fx: 'Tern Island' });
  assert.deepEqual(notes[0], ['Land bridge', 'Port Ondo Causeway, three hexes of land from the sea, joins Tern Island to Westmark. It is yours already, without a land credit.']);
  assert.equal(answer('bridge', { k: 1, cells: [40], shore: 'Westmark' }, {}, 1).n.isw.bn, 'Islan Sea Dyke');
  const both = answer('grow', { k: 1, cells: [50, 51, 52] }, { isx: n.isx, isw: n.isw });
  assert.deepEqual(both.n.isx.slice(3), [{ c: 50, t: 5000, i: 1, k: 'g' }, { c: 51, t: 5001, i: 1, k: 'g' }, { c: 52, t: 5002, i: 1, k: 'g' }]);
  assert.deepEqual(both.n.isx.slice(0, 3), n.isx, 'the bridge stays');
  assert.deepEqual(both.n.isw, { bn: 'Port Ondo Causeway' });
  assert.deepEqual(both.n.log[0], { t: 5000, k: 'isg', a: '3', b: 'Tern Island' });
  assert.deepEqual(both.notes[0], ['Island', 'Tern Island has grown by three hexes of land from the sea. They are yours already, without a land credit.']);
  for (const kind of ['bridge', 'grow']) {
    const none = answer(kind, null);
    assert.equal(none.n.isx, undefined); assert.equal(none.n.lcb, 3, kind + ': the land office pays three credits'); assert.equal(none.notes[0][0], 'Land office');
  }
});

test('the record keeps them, here and on another region’s page; a move clears them; a city on its own island survives a load', () => {
  assert.match(code, /const MAP_KEEP=\[[^\]]*'isl','isx','isw'[^\]]*\];/);
  assert.equal(code.split('n.bx=[];n.rec=[];n.isl=[];n.isx=[];delete n.isw;n.cv=MAP_VER;').length, 4, 'moving, settling again and waking clear them');
  assert.ok(cut('function remapFront(d){', '\nfunction remapLate(').includes("['claims','conq','bx','rec','isl','isx']"), 'the frontier moves them');
  assert.ok(functions.get('normCities').includes('(MAP.T[c.c]<2&&MAP_T0[c.c]!==1&&!isdHexOf(d,c.c))'), 'a city on the record’s own island is kept before the island is replayed');
  const H = vm.runInNewContext(functions.get('isdHexOf') + ';isdHexOf');
  assert.ok(H({ isl: [{ c: 5 }] }, 5)); assert.ok(H({ isx: [{ c: 6, k: 'g' }] }, 6)); assert.ok(!H({ isl: [{ c: 5 }] }, 6)); assert.ok(!H({}, 5)); assert.ok(!H(null, 5));
  const hooks = [], ctx = vm.createContext({ NORM_HOOKS: hooks, MAP: { N: 100 }, MAP_T0: Uint8Array.from({ length: 100 }, (_, i) => i < 60 ? (i % 2) : 2), MAP_VER: 5, ISL_REACH: 8 });
  const tail = '\n  if(o.length)n.isx=o;});';
  vm.runInContext([vars(HEAD), functions.get('islClean'), cut('NORM_HOOKS.push((n,d)=>{const a=d&&d.isx;', tail) + tail, cut('NORM_HOOKS.push((n,d)=>{const s=d&&d.isw;', '\n  if(Object.keys(o).length)n.isw=o;});') + '\n  if(Object.keys(o).length)n.isw=o;});'].join('\n'), ctx);
  const isx = [{ c: 1, t: 1, i: 1, k: 'b' }, { c: 1, t: 2, i: 1, k: 'g' }, { c: 70, t: 3, i: 1, k: 'g' }, { c: 2, t: 4, i: 4, k: 'g' }, { c: 3, t: 5, i: 2, k: 'x' }, { c: 4, t: 'x', i: 2, k: 'g' },
    ...[10, 11, 12, 13].map((c, k) => ({ c, t: 10 + k, i: 2, k: 'g' })), ...[20, 21, 22, 23, 24, 25, 26, 27, 28].map((c, k) => ({ c, t: 20 + k, i: 3, k: 'b' }))];
  const r = {}; hooks[0](r, { cv: 5, isx });
  assert.deepEqual(J(r.isx), [{ c: 1, t: 1, i: 1, k: 'b' }, ...[10, 11, 12].map((c, k) => ({ c, t: 10 + k, i: 2, k: 'g' })), ...[20, 21, 22, 23, 24, 25, 26].map((c, k) => ({ c, t: 20 + k, i: 3, k: 'b' }))],
    'sea hexes of this map, each once, islands 1 to 3, a bridge of eight at most (one already) and three new hexes');
  const old = {}; hooks[0](old, { cv: 4, isx }); assert.equal(old.isx, undefined, 'another map’s numbers are not read as this one’s');
  const d = {}; hooks[1](d, { isw: { ti: 2, tc: 'c1abc', bn: 'Port <b>Causeway</b>', x: 1 } });
  assert.deepEqual(J(d.isw), { ti: 2, tc: 'c1abc', bn: 'Port bCausewayb' });
  const d0 = {}; hooks[1](d0, { isw: { ti: 0 } }); assert.deepEqual(J(d0.isw), { ti: 0 }, 'the charter with no town');
  const d1 = {}; hooks[1](d1, { isw: { ti: 7, tc: 5 } }); assert.equal(d1.isw, undefined);
  /* the charter: one more city */
  const mc = vm.runInNewContext('var S={nation:{}},MAX_CITIES=33,maxCities=()=>' + 5 + ';' + cut('const isdCharter=', '\n/* the bridge') + ';[maxCities,S]');
  assert.equal(mc[0](), 5); mc[1].nation.isw = { ti: 0 }; assert.equal(mc[0](), 6);
});

test('every viewer replays the bridge and the new land as land held by the nation, under the bridge’s and the island’s names', () => {
  const T0 = new Uint8Array(60).fill(1); T0[20] = 0; T0[22] = 2;
  const lake = new Uint8Array(60); lake[30] = 1;
  const made = [], ctx = vm.createContext({ MAP: { N: 60, comp: new Int16Array(60).fill(-1) }, MAP_T0: T0, LAKE: lake, lakeMap: () => lake,
    S: { nation: { isl: [{ c: 4, t: 11, i: 1 }], isx: [{ c: 5, t: 12, i: 1, k: 'b' }, { c: 20, t: 13, i: 1, k: 'b' }, { c: 6, t: 14, i: 1, k: 'g' }, { c: 30, t: 15, i: 1, k: 'g' }, { c: 22, t: 16, i: 1, k: 'g' }, { c: 7, t: 17, i: 1, k: 'q' }],
      isn: { 1: 'Tern Island' }, isw: { bn: 'Ondo Causeway' } }, world: { b: { isx: [{ c: 6, t: 1, i: 2, k: 'g' }] } }, mode: 'world', uid: 'me' },
    myId: () => 'me', reclaimCell: c => made.push(c), unreclaimCell: () => {}, terrCache: new Map(), atlasCache: null });
  vm.runInContext([cut('let RECL={sig:', '\n'), functions.get('readReclaims'), functions.get('islClean'), functions.get('islAt'), functions.get('isdBridgeAt'),
    'var ISL_FALLBACK="an artificial island",ISD_BRIDGE="the land bridge",findNation=id=>({n:S.world[id]});this.R=readReclaims();'].join('\n'), ctx);
  const R = ctx.R;
  assert.deepEqual(J([...R.owner]), [[6, 'b'], [4, 'me'], [5, 'me'], [20, 'me']], 'the first to raise a hex holds it; deep sea may be bridged; never a lake or land');
  assert.deepEqual(J([...R.isb]), [[5, 1], [20, 1]], 'the bridge');
  assert.deepEqual(J([...R.isl]), [[6, 2], [4, 1]], 'new land is the island’s');
  assert.deepEqual(made, [6, 4, 5, 20]);
  assert.match(R.sig, /^b:6i2g,me:4i1,me:5i1b,me:20i1b,me:6i1g,me:30i1g,me:22i1g$/);
  assert.equal(ctx.isdBridgeAt(5), 'Ondo Causeway');
  assert.equal(ctx.isdBridgeAt(4), '', 'not the bridge');
  delete ctx.S.nation.isw; assert.equal(ctx.isdBridgeAt(20), 'the land bridge');
  assert.equal(ctx.islAt(4), 'Tern Island');
});
