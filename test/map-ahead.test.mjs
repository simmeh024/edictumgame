// A nation saved on a newer map (game/edictum.html, mapAhead and mapStaleStop; src/shim.js, newerMap, encode's mv and
// saveNation). 19 Nov 2026, Lévice: a tab still on map version 4, left in front for hours (so never reloaded for the new
// build), met its own nation's first save on the frontier's map 5 from another device. It read every hex number as its
// own map's: the capital, cities, conquests and roads went, the player was asked to settle again, land credits were laid
// out elsewhere, and its next save put that over the record. A page now never reads, adopts or saves over a record from a
// newer map than its own. Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x)); // objects made in a vm context have its prototypes
const MAP_VER = Number(src.match(/\bMAP_VER=(\d+)/)[1]);

// one function of the game, by name (as frontier.test.mjs takes them)
function fn(name) {
  let at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = src.indexOf('\nasync function ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const ahead = () => { const c = vm.createContext({ MAP_VER }); vm.runInContext(fn('mapAhead'), c); return c.mapAhead; };

test('a record from a newer map is told by its cv or its capital\'s map', () => {
  const m = ahead();
  assert.equal(MAP_VER >= 5, true);
  assert.equal(m({ cv: MAP_VER + 1 }), true);
  assert.equal(m({ cv: MAP_VER + 1, loc: { c: 3, r: 4, m: MAP_VER + 1 } }), true);
  assert.equal(m({ loc: { c: 3, r: 4, m: MAP_VER + 1 } }), true, 'a capital on the newer map, cv missing');
  assert.equal(m({ cv: MAP_VER, loc: { c: 3, r: 4, m: MAP_VER + 2 } }), true);
  for (const d of [{ cv: MAP_VER }, { cv: MAP_VER, loc: { c: 1, r: 1, m: MAP_VER } }, { cv: 4, loc: { m: 4 } }, { cv: 2 }, {}, { loc: null }, { cv: String(MAP_VER + 1) }, null, undefined, 'x', 7])
    assert.equal(m(d), false, JSON.stringify(d) + ' is this map\'s or older');
});

/* normalize: the real one with the real MAP_KEEP and mapAhead; the remaps throw if asked about a newer map's record, and
   normalizeR2 stands in for the map checks this page makes (a city, claim or capital off this page's map goes) */
function norm(REG = { id: 'meridian' }) {
  const i = src.indexOf('const FWD_MAX='), j = src.indexOf('\n', src.indexOf('const MAP_KEEP=')) + 1;
  const N = 1000, on = c => Number.isInteger(c) && c >= 0 && c < N, calls = [];
  const remap = name => d => { if (d && (d.cv > MAP_VER || d.loc && d.loc.m > MAP_VER)) throw new Error(name + ' was asked about a newer map'); calls.push(name); return d; };
  const ctx = vm.createContext({ MAP_VER, window: {}, JSON, Proxy, Reflect, Set, REG, REG_BY_ID: { meridian: {}, greywater: {} },
    remapLegacy: remap('remapLegacy'), remapFront: remap('remapFront'),
    normalizeR2: d => ({ name: d.name, reg: d.reg, cv: MAP_VER, loc: d.loc && d.loc.m === MAP_VER && on(d.loc.r * 10 + d.loc.c) ? { ...d.loc } : null,
      cities: d.cv === MAP_VER ? (d.cities || []).filter(c => on(c.c)) : [], claims: d.cv === MAP_VER ? (d.claims || []).filter(e => on(e.c)) : [],
      conq: d.cv === MAP_VER ? d.conq || [] : [], infra: (d.infra || []).filter(r => r.path.every(on)), pop: d.pop }) });
  vm.runInContext(src.slice(i, j).replace(/\bconst (FWD_MAX|MAP_KEEP)/g, 'var $1'), ctx);
  return { normalize: ctx.normalize, calls, window: ctx.window };
}
const newer = () => ({ name: 'Lévice', reg: 'meridian', cv: MAP_VER + 1, pop: 31.5, loc: { c: 412, r: 377, m: MAP_VER + 1 },
  cities: [{ id: 'cap', c: 377 * 620 + 412, b: [{ k: 'farm' }] }, { id: 'c2', c: 377 * 620 + 415, b: [] }],
  claims: [{ c: 376 * 620 + 412, t: 5 }, { c: 378 * 620 + 413, t: 6 }], conq: [{ c: 380 * 620 + 410, t: 7 }],
  infra: [{ id: 'r1', a: 377 * 620 + 412, b: 377 * 620 + 415, path: [377 * 620 + 412, 377 * 620 + 413, 377 * 620 + 415] }] });

test('normalize leaves a newer map\'s record of this very region as it was: capital, cities, claims, conquests, roads', () => {
  const k = norm(), d = newer(), n = k.normalize(d);
  assert.deepEqual(plain(n.loc), d.loc, 'the capital stays where the newer map has it');
  assert.equal(n.cv, d.cv, 'and the record still says which map it is on');
  assert.deepEqual(plain(n.cities), d.cities);
  assert.deepEqual(plain(n.claims), d.claims);
  assert.deepEqual(plain(n.conq), d.conq);
  assert.deepEqual(plain(n.infra), d.infra);
  assert.notEqual(n.cities, d.cities, 'a copy, not the record\'s own');
  assert.deepEqual(k.calls, [], 'neither remap is asked: they know only older maps\' numbers');
  assert.equal(k.window.__edictum, undefined, 'without the adapter, nothing is published');
  /* the same record on this page's map is still checked against it, as before */
  const here = k.normalize({ ...newer(), cv: MAP_VER, loc: { c: 2, r: 3, m: MAP_VER } });
  assert.deepEqual(plain(here.cities), [], 'this map\'s record: cities off the map still go');
  assert.deepEqual(plain(here.loc), { c: 2, r: 3, m: MAP_VER });
  assert.deepEqual(k.calls, ['remapLegacy', 'remapFront']);
});

test('the real remaps leave a newer map\'s record alone too', () => {
  /* frontCell, remapLegacy and remapFront as they are; recReg, REG and remapLate stand for what the frontier's follow-up
     adds (none of them may touch a newer map's record either) */
  const ctx = vm.createContext({ MAP_VER, MAP_COLS: 620, CHART_COLS: 500, CHART_ROWS: 400, LEG: { oc: 300, or: 200, ox: 10, oy: 10 },
    REG: { id: 'meridian' }, REG_BY_ID: { meridian: {} }, recReg: d => d.reg || 'meridian', remapLate: () => { throw new Error('remapLate on a newer map'); } });
  vm.runInContext([fn('frontCell'), 'var FRONT_AT=0;', fn('remapLegacy'), fn('remapFront')].join('\n'), ctx);
  for (const d of [newer(), { ...newer(), loc: { c: 1, r: 1, m: MAP_VER + 1 }, cv: undefined }]) {
    const before = JSON.stringify(d);
    assert.equal(ctx.remapLegacy(d), d, 'remapLegacy hands it back untouched');
    assert.equal(ctx.remapFront(d), d, 'remapFront hands it back untouched');
    assert.equal(JSON.stringify(d), before);
  }
});

test('this browser\'s copy from a newer map is never read: the page stops instead', () => {
  const run = stored => {
    const seen = { stop: 0, norm: 0 };
    const ctx = vm.createContext({ MAP_VER, OBS: false, PV: false, LS_KEY: 'k', JSON, localStorage: { getItem: () => stored },
      normalize: d => { seen.norm++; return { ...d, ok: 1 }; }, mapStaleStop: () => { seen.stop++; } });
    vm.runInContext(fn('mapAhead') + '\n' + fn('loadLocal'), ctx);
    return { n: ctx.loadLocal(), seen };
  };
  const a = run(JSON.stringify(newer()));
  assert.equal(a.n, null); assert.deepEqual(a.seen, { stop: 1, norm: 0 });
  const b = run(JSON.stringify({ ...newer(), cv: MAP_VER, loc: { c: 1, r: 1, m: MAP_VER } }));
  assert.equal(b.n.ok, 1); assert.deepEqual(b.seen, { stop: 0, norm: 1 }, 'this map\'s copy loads as ever');
  assert.equal(run(null).n, null);
});

/* every path that reads the player's own record from the server checks it before normalising it */
const body = fn;
test('every read of the own record checks for a newer map before normalising', () => {
  const sync = body('syncOwnNation');
  assert.ok(sync.indexOf('mapAhead(raw)') >= 0 && sync.indexOf('mapAhead(raw)') < sync.indexOf('normalize('), 'syncOwnNation (a save from another device, a refused save\'s rebase)');
  const conn = src.slice(src.indexOf('\nasync function connect('), src.indexOf('\n}\n', src.indexOf('\nasync function connect(')));
  const first = conn.indexOf('const rawMe=');
  assert.ok(first > 0 && conn.indexOf('mapAhead(rawMe)', first) > first && conn.indexOf('mapAhead(rawMe)', first) < conn.indexOf('normalize(rawMe)'), 'the first read after sign-in');
  assert.ok(conn.indexOf('if(mapStale)return;') > 0 && conn.indexOf('if(mapStale)return;') < first, 'a page already stopped reads nothing more');
  /* the region's listener: both branches skip a newer map's record before normalize */
  const loop = conn.slice(conn.indexOf('for(const d of regQS.docs)'), conn.indexOf('dormSift(w,all)'));
  const norms = [...loop.matchAll(/normalize\(x&&x\.d\?nxJoin\(raw,x\.d\):raw\)/g)].map(m => m.index);
  assert.equal(norms.length, 2, 'two places normalise a region record');
  norms.forEach((at, i) => assert.match(loop.slice(i ? norms[i - 1] : 0, at), /if\(mapAhead\(raw\)\)\{[^}]*continue;\}/, 'a newer map\'s record is skipped before it is normalised'));
  assert.match(loop, /if\(mapAhead\(raw\)\)\{if\(d\.id===S\.uid&&!OBS&&!PV\)mapStaleStop\(\);else ahead=true;continue;\}/, 'its own record stops the page; another\'s is left out');
  const unsaved = src.slice(src.indexOf('window.__edictum.useUnsaved=async()=>{'), src.indexOf('\n};', src.indexOf('window.__edictum.useUnsaved=async()=>{')));
  assert.ok(unsaved.indexOf('mapAhead(raw)||mapAhead(c.nation)') > 0 && unsaved.indexOf('mapAhead(raw)') < unsaved.indexOf('normalize('), '"Keep this copy instead"');
  const rr = body('regionReload');
  assert.ok(rr.indexOf('mapAhead(raw)') > 0 && rr.indexOf('mapAhead(raw)') < rr.indexOf('localStorage.setItem'), 'regionReload keeps no newer map\'s record as this browser\'s copy');
});

test('stopping: no more commits or saves, nothing waiting is sent, the adapter takes over once', () => {
  const run = (E, OBS = false, tabPassive = false) => {
    const cleared = [], toasts = [];
    const ctx = vm.createContext({ OBS, PV: false, tabPassive, remoteTimer: 42, remoteDirty: true, window: { __edictum: E },
      clearTimeout: t => cleared.push(t), setTimeout: f => f(), publishSync: () => {}, toast: t => toasts.push(t) });
    vm.runInContext('var mapStale=false;\n' + fn('mapStaleStop'), ctx);
    ctx.mapStaleStop(); ctx.mapStaleStop();
    return { ctx, cleared, toasts };
  };
  let calls = 0;
  const E = { newerMap: () => calls++ }, a = run(E);
  assert.equal(a.ctx.tabPassive, true, 'the page plays no more (no clock, commits or saves, nor this browser\'s copy)');
  assert.equal(a.ctx.remoteDirty, false, 'what waited to be saved is not sent');
  assert.deepEqual(a.cleared, [42], 'nor is the save that was due');
  assert.equal(a.ctx.mapStale, true); assert.equal(E.mapStale, true); assert.equal(calls, 1, 'the adapter is called once');
  const early = {}, b = run(early);
  assert.equal(early.mapStale, true, 'before the adapter is there, it finds out when it starts');
  const c = run(undefined);
  assert.equal(c.ctx.tabPassive, true); assert.equal(c.toasts.length, 1, 'with no adapter at all, the player is told');
  const d = run({ newerMap: () => calls++ }, true);
  assert.equal(d.ctx.tabPassive, false, 'an admin observing a region keeps observing'); assert.equal(calls, 1);
  const y = run({ newerMap: () => calls++ }, false, true);
  assert.equal(calls, 1, 'a tab that let another play is not reloaded: it would take the nation back from the tab in use');
  assert.deepEqual(y.cleared, []);
  assert.ok(src.includes('window.__edictum.drafts=pageDrafts'), 'the adapter can see the drafts it waits for');
});

/* the adapter: mv beside every save, and no save over a newer map's */
const fns = new Map();
(function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === 'FunctionDeclaration') fns.set(n.id.name, shim.slice(n.start, n.end)); for (const [k, v] of Object.entries(n)) if (k !== 'start' && k !== 'end') { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } })(parse(shim, { ecmaVersion: 'latest' }));
function adapter(saved, mapVer) {
  const writes = [], A = { admin: false, raceAt: {}, saveV1: true }; /* the game's own transaction (serverSave: test/server-save.test.mjs) */
  A.fs = { doc: path => ({ path }), runTransaction: async f => f({ get: async ref => ref.path === 'nations/player' ? { exists: !!saved, data: () => saved } : { exists: false, data: () => null }, set: (ref, data) => writes.push({ path: ref.path, data: plain(data) }), delete() {} }) };
  const c = vm.createContext({ A, E: { mapVer }, performance, MAX_JSON: 700000, BOOT_AT: 1, serverTime: () => 1, num: v => typeof v === 'number' && Number.isFinite(v) ? v : 0, str: (v, max) => typeof v === 'string' ? v.slice(0, max) : '',
    isObj: v => !!v && typeof v === 'object' && !Array.isArray(v), parse: s => JSON.parse(s), millis: () => 1, mapError: e => e, call: async (name, d) => ({ ...d.record, permit: 'p' }), setTimeout: () => {},
    window: { dispatchEvent() {} }, Event: class {}, recoveryCheck: () => {}, spaceText: () => null, splitNation: d => [d, {}], activeUntil: (d, t) => t, raceKeys: () => [], isGuest: () => false });
  vm.runInContext(['mapVer', 'encode', 'revision', 'saveNation'].map(n => fns.get(n)).join('\n'), c);
  return { c, writes };
}
const rec = more => ({ name: 'Lévice', reg: 'meridian', updatedAt: 1000, pop: 5, claims: [], cv: MAP_VER, ...more });
test('every save names its map (mv), and none goes over a newer map\'s', async () => {
  assert.equal(adapter(null, MAP_VER).c.encode('nations', rec()).mv, MAP_VER);
  assert.equal(adapter(null, undefined).c.encode('nations', rec()).mv, undefined, 'a page that does not say: none');
  for (const bad of [0, -1, 1.5, '5', 1000]) assert.equal(adapter(null, bad).c.encode('nations', rec()).mv, undefined);
  /* over this map's save, an older map's, or one from before mv: saved */
  for (const mv of [MAP_VER, MAP_VER - 1, undefined]) {
    const { c, writes } = adapter({ reg: 'meridian', rev: 5, ...(mv ? { mv } : {}) }, MAP_VER);
    assert.deepEqual(plain(await c.saveNation('player', rec({ _rev: 5 }))), { rev: 6 });
    assert.equal(writes.find(w => w.path === 'nations/player').data.mv, MAP_VER);
  }
  /* over a newer map's: refused before anything is written, whatever the revision */
  for (const rev of [5, 6]) {
    const { c, writes } = adapter({ reg: 'meridian', rev, mv: MAP_VER + 1 }, MAP_VER);
    await assert.rejects(c.saveNation('player', rec({ _rev: 5 })), e => e.code === 'newer_map');
    assert.deepEqual(writes, [], 'nothing is written');
  }
  /* and the newer map's own page saves over it as ever */
  const { c } = adapter({ reg: 'meridian', rev: 5, mv: MAP_VER + 1 }, MAP_VER + 1);
  assert.deepEqual(plain(await c.saveNation('player', rec({ _rev: 5, cv: MAP_VER + 1 }))), { rev: 6 });
});

test('the adapter reloads for a newer map\'s record without sending a thing, and never in a loop', () => {
  const at = shim.indexOf('function newerMap()'), end = shim.indexOf('\n  E.newerMap = newerMap;', at);
  assert.ok(at > 0 && end > at);
  const body = shim.slice(at, end);
  assert.ok(!/flushSaves/.test(body), 'nothing waiting is flushed: it is the older map\'s');
  assert.match(body, /A\.frozen = true/, 'every write through the adapter waits for good');
  const run = ({ tries = [], typing = false, drafts = false } = {}) => {
    const ss = { 'edictum.mapReloads': JSON.stringify(tries), 'edictum.flash': 'Edictum was updated: the page has loaded the new version. Your nation is as you left it.' }, left = [], els = [], timers = [];
    const toasts = [{ textContent: ss['edictum.flash'], remove() { this.gone = true; } }, { textContent: 'Another toast', remove() { this.gone = true; } }];
    const doc = { createElement: () => { const el = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => ({ addEventListener(t, f) { el.click = f; } }) }; return el; }, body: { appendChild: el => els.push(el) },
      querySelectorAll: q => q === '.ed-toast' ? toasts : [] };
    const ctx = vm.createContext({ A: { leaving: false, frozen: false }, E: { drafts: () => drafts }, ui: { busy: '', dlg: null }, document: doc, JSON, Date, Array, SS_FLASH: 'edictum.flash',
      SS: { get: k => ss[k] || null, set: (k, v) => { ss[k] = v; } }, parse: s => { try { return JSON.parse(s); } catch (e) { return null; } },
      typing: () => typing, leave: (f, m) => left.push([f, m]), esc: s => s, paintSync: () => {}, paintStuck: () => {},
      setInterval: f => { timers.push(f); return timers.length; }, clearInterval: () => {} });
    vm.runInContext(shim.slice(shim.indexOf("  var MAP_MSG = "), at) + body, ctx);
    ctx.newerMap(); ctx.newerMap();
    return { ctx, left, els, timers, ss, toasts };
  };
  const a = run();
  assert.equal(a.left.length, 1, 'reloads at once');
  assert.deepEqual(plain(a.left[0][0]), {}, 'leaving this browser\'s copy and sign-in as they are');
  assert.match(a.left[0][1], /^Edictum was updated: the page has loaded the new version\. Your nation is as you left it\.$/);
  assert.equal(JSON.parse(a.ss['edictum.mapReloads']).length, 1);
  assert.equal(a.ctx.A.frozen, true);
  /* typing: read-only, says so, and reloads when done */
  const b = run({ typing: true });
  assert.equal(b.left.length, 0, 'not while the player is typing'); assert.equal(b.els.length, 1, 'who is told instead');
  assert.equal(b.els[0].attrs.role, 'alert'); assert.match(b.els[0].innerHTML, /Nothing more is saved from this page/);
  assert.equal(b.ctx.A.frozen, true, 'and nothing is saved meanwhile');
  b.ctx.typing = () => false; b.timers[0]();
  assert.equal(b.left.length, 1, 'reloads once they are done');
  const c = run({ drafts: true });
  assert.equal(c.left.length, 0, 'a draft (a message, a resolution) holds it too'); c.els[0].click(); assert.equal(c.left.length, 1, 'or the button');
  /* a page that keeps coming back on the old build */
  const now = Date.now(), d = run({ tries: [now - 30000, now - 5000] });
  assert.equal(d.left.length, 0, 'no third reload within two minutes'); assert.equal(d.timers.length, 0);
  assert.match(d.els[0].innerHTML, /keeps loading the old one/);
  assert.equal(d.ctx.A.frozen, true, 'still read-only');
  assert.equal(d.toasts[0].gone, true, "the last reload's word that the new version has loaded goes: it is not true"); assert.equal(d.toasts[1].gone, undefined);
  assert.equal(d.ss['edictum.flash'], null);
  assert.equal(b.toasts[0].gone, undefined, 'while it can still reload, nothing is taken back');
  const e = run({ tries: [now - 300000, now - 200000] });
  assert.equal(e.left.length, 1, 'older reloads do not count');
});
