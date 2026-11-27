// Sacking edicts (game/edictum.html, "sacking edicts", 27 November 2026): about 160 edicts that each name an official of
// the nation in trouble, whose options are what becomes of them. This runs the game's top-level code in a stubbed context
// (as edict-order.test.mjs does) and checks the catalogue: every edict's written fates, the shelf appended in its fixed
// order, the stories' links, the generic follow-ups every fate queues, the fate texts, the gate (one at a time, one a
// day, three a week), which governments get which fates, the Dispatch's own words; and the admin statistics and the
// server's affinity for an official posted abroad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parse } from 'acorn';
import { rowSack, sackSummary, SK_FATES as SRV_FATES } from '../functions/stats-sack.js';
import { cabinetAffinity } from '../functions/affinity.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const DAY = 864e5;

function load() {
  const H = {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'toString' || k === 'valueOf') return () => '';
      return stub;
    },
    apply() { return stub; }, construct() { return stub; }, has() { return true; }, set() { return true; },
  };
  const stub = new Proxy(function () {}, H), F = () => stub;
  const store = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  const sb = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: stub, history: stub, screen: stub, indexedDB: stub, caches: stub,
    navigator: { userAgent: 'node', language: 'en', languages: ['en'] },
    location: { href: 'https://x/', search: '', hash: '', pathname: '/', hostname: 'x', origin: 'https://x' },
    localStorage: store, sessionStorage: store, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    fetch: () => new Promise(() => {}), performance: { now: () => 0, mark() {}, measure() {} },
    addEventListener() {}, removeEventListener() {}, getComputedStyle: F, Image: F, HTMLElement: function () {}, Element: function () {},
    IntersectionObserver: F, ResizeObserver: F, MutationObserver: F, BroadcastChannel: F, Worker: F, Blob: F,
    URL: Object.assign(F, { createObjectURL: () => '' }), crypto: webcrypto, TextEncoder, TextDecoder, Intl, structuredClone,
  };
  sb.window = sb.self = sb.globalThis = sb.top = sb.parent = sb;
  const ctx = vm.createContext(sb), ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  let body = ast.body;
  for (const st of ast.body) {
    const e = st.type === 'ExpressionStatement' && st.expression, c = e && (e.type === 'CallExpression' ? e : e.type === 'UnaryExpression' && e.argument), f = c && c.callee;
    if (f && /Function/.test(f.type) && f.body.body && f.body.body.length > 1000) { body = f.body.body; break; }
  }
  const failed = [];
  for (const st of body) {
    const s = code.slice(st.start, st.end);
    try { vm.runInContext(s, ctx, { timeout: 1000 }); }
    catch (e) { if (/ISSUES\s*=|ISSUES\.push|SK_[A-Z]+\s*=|function sk[A-Z]|skBuild/.test(s)) failed.push(String(e && e.message).slice(0, 100) + ' :: ' + s.slice(0, 80)); }
  }
  return { ctx, failed };
}
const G = load(), run = s => vm.runInContext(s, G.ctx), J = s => JSON.parse(run('JSON.stringify(' + s + ')'));
const SHELF = ['handshake', 'backbench', 'lighthouse', 'ambassador', 'mayor', 'trial', 'jail', 'museum', 'tv', 'memoir', 'opposition', 'goatfarm', 'asylum', 'disguise', 'sinecure',
  'vanish', 'erase', 'reeducate', 'recall', 'collective', 'auction', 'pilgrimage', 'duke', 'ignored', 'committee'];
const SK = J('SK_ISSUES'), GEN = J('SK_GEN'), TX = J('SK_TX'), FATES = J('SK_FATES');
const base = SK.filter(i => !i.fo), byId = new Map(SK.concat(GEN).map(i => [i.id, i]));

test('the page builds them all, numbered after every older edict', () => {
  assert.deepEqual(G.failed, []);
  const ids = J('ISSUES.map(x=>x.id)'), k = ids.indexOf(SK[0].id);
  assert.ok(base.length >= 150, base.length + ' sacking edicts');
  /* after them only the colonial edicts of the landing parties (27 November, landing-parties.test.mjs) */
  const after = ids.slice(k + SK.length + GEN.length);
  assert.deepEqual(ids.slice(k, k + SK.length + GEN.length), SK.concat(GEN).map(i => i.id), 'the sacking edicts, then the generic follow-ups');
  assert.ok(after.every(id => /^lnd-/.test(id)), 'then only the colonial edicts: ' + after.filter(id => !/^lnd-/.test(id)).join(', '));
  assert.equal(run('ISSUES_RANDOM.filter(i=>i.skx).length'), base.length, 'only the base edicts are drawn at random');
});

test('the shelf keeps its order (option numbers are saved): it only ever grows at its end', () => {
  assert.deepEqual(J('SK_SHELF'), SHELF);
  assert.deepEqual(SRV_FATES, SHELF, 'functions/stats-sack.js knows the same fates');
  for (const f of SHELF) assert.ok(FATES[f], f);
});

test('every edict: three different written fates, then keep, then the whole shelf', () => {
  const TOP = new Set(['econ', 'society', 'rights', 'gov', 'welfare', 'nature', 'tech', 'culture', 'world', 'weird']);
  for (const is of base) {
    assert.match(is.id, /^sk-[a-z0-9-]+$/);
    assert.ok(TOP.has(is.c), is.id + ' topic');
    assert.equal(is.o.length, 4 + SHELF.length, is.id);
    const f3 = is.o.slice(0, 3).map(o => o.f);
    assert.equal(new Set(f3).size, 3, is.id + ' three different fates');
    for (const f of f3) assert.ok(FATES[f] && !FATES[f].gov && f !== 'asylum', is.id + ' ' + f);
    assert.ok(is.o[3].keep && !is.o[3].f, is.id + ' keep is fourth');
    SHELF.forEach((f, i) => assert.equal(is.o[4 + i].f, f, is.id + ' shelf ' + i));
    for (const o of is.o) if (o.f === 'trial' || o.f === 'recall') assert.ok(o.g && o.g.fx && o.g.e, is.id + ' ' + o.f + ' is a gamble');
    assert.ok(/^(fin|def|for|int|wrk|hea|cul|plot|gov|may|any)$|^T:/.test(is.sk), is.id + ' sk');
  }
  const kinds = s => base.filter(i => s.test(i.sk)).length;
  assert.ok(kinds(/^(fin|def|for|int|wrk|hea|cul)$/) >= 80 && kinds(/^T:/) >= 26 && kinds(/^gov$/) >= 15 && kinds(/^may$/) >= 15 && kinds(/^plot$/) >= 10, 'ministers, traits, governors, mayors, plotters');
});

test('stories: every nx leads to its own follow-up, and every follow-up is reached', () => {
  const reached = new Set();
  for (const is of SK) for (const o of is.o) if (o.nx) {
    const f = byId.get(o.nx);
    assert.ok(f && f.fo, is.id + ' → ' + o.nx);
    assert.equal(f.skp, is.fo ? is.skp : is.id, o.nx + ' belongs to its story');
    reached.add(o.nx);
  }
  for (const is of SK.filter(i => i.fo)) assert.ok(reached.has(is.id), is.id + ' is reached');
  assert.ok(reached.size >= 40, reached.size + ' story steps');
});

test('a generic follow-up for every fate that queues one, and comebacks', () => {
  const kinds = new Set(GEN.map(i => i.gen));
  for (const f of SHELF) { const g = FATES[f].gen; if (g) assert.ok(kinds.has(g[0]), f + ' queues ' + g[0]); }
  for (const k of ['back', 'asylum']) assert.ok(kinds.has(k), k);
  for (const is of GEN.filter(i => i.gen === 'back' || i.gen === 'pilgrimage' || i.gen === 'reeducate')) assert.ok(is.o.some(o => o.back) && is.o.some(o => o.post), is.id + ' offers the old job and a smaller one');
  for (const is of GEN.filter(i => i.gen === 'asylum')) assert.ok(is.o.some(o => o.hire) && is.o.some(o => o.home), is.id);
});

test('the fate texts: a name, a line for the shelf, a result, four stages, two postcards, the press', () => {
  for (const f of SHELF) {
    const t = TX[f];
    assert.ok(t && t.n && t.d && t.fx && t.db, f);
    assert.equal(t.now.length, 4, f + ' now'); assert.equal(t.pc.length, 2, f + ' pc'); assert.equal(t.dh.length, 2, f + ' dh'); assert.equal(t.fk.length, 4, f + ' fk');
    for (const s of t.fk) assert.match(s, /^[rswgbue*]+\|.*\{TAG\}$/, f + ' flock line');
  }
  assert.ok(TX.trial.fxl && TX.recall.fxl);
});

test('typographic quotes only, no he or she for an official, no unknown placeholders', () => {
  const PH = new Set('SK SKT SKP N D CAP C Cs L A As SPORT DISH LANG FIN DEF FOR INT WRK HEA CUL NB NBD NBCAP NBL NAME ROLE TAG'.split(' '));
  const walk = (v, where) => {
    if (typeof v === 'string') { assert.ok(!/['"]/.test(v), where + ': straight quote'); for (const m of v.matchAll(/\{([^}]*)\}/g)) assert.ok(PH.has(m[1]), where + ': {' + m[1] + '}'); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where + '.' + k);
  };
  for (const is of SK.concat(GEN)) {
    walk(is.t, is.id); walk(is.q, is.id);
    is.o.slice(0, 4).forEach((o, i) => { walk(o.t, is.id + ' o' + i); walk(o.fx, is.id + ' o' + i); });
    assert.ok(!/\b(he|she|his|her|him)\b/i.test(is.q), is.id);
  }
  walk(TX, 'SK_TX');
});

test('rare: from the third day and tenth decision, one at a time, one a day, three a week', () => {
  const gate = run('(n)=>{SK.gate.k="";return skGate(n);}'), now = Date.now(), id = base[0].id;
  const n = o => Object.assign({ name: 'Testland', seed: 'abc', founded: now - 5 * DAY, s: {}, dec: 30, issueSeq: 1, answered: [], inbox: [] }, o);
  assert.equal(gate(n({})), true);
  assert.equal(gate(n({ founded: now - DAY })), false, 'too young');
  assert.equal(gate(n({ dec: 4 })), false, 'too few decisions');
  assert.equal(gate(n({ npc: true })), false, 'not for computer nations');
  assert.equal(gate(n({ inbox: [{ id, at: now }] })), false, 'one on the desk');
  assert.equal(gate(n({ answered: [{ id, o: 1, t: now - 3 * 3600e3 }] })), false, 'one a day');
  assert.equal(gate(n({ answered: [{ id, o: 1, t: now - 21 * 3600e3 }] })), true, 'a day later');
  assert.equal(gate(n({ answered: [1, 2, 3].map(d => ({ id, o: 0, t: now - d * DAY - 3600e3 })) })), false, 'three a week');
  assert.equal(gate(n({ answered: [1, 2, 8].map(d => ({ id, o: 0, t: now - d * DAY - 3600e3 })) })), true, 'older ones drop out');
});

test('fates of their own: corrupt dictatorships, democracies, anarchy, monarchies', () => {
  const ok = run('(s,p)=>{const n={s,policies:p||{}};return Object.keys(SK_GOVOK).filter(k=>SK_GOVOK[k](n));}');
  const S = (civil, econ, pol, extra) => Object.assign({ civil, econ, pol, wealth: 50, equal: 50, health: 50, edu: 50, safety: 50, crime: 40, env: 50, relig: 40, cons: 45, happy: 50, mil: 35, corrupt: 35, tax: 30, culture: 45, tour: 35, sci: 40, weird: 25 }, extra || {});
  const cd = ok(S(10, 50, 10)); assert.ok(cd.includes('vanish') && cd.includes('erase') && cd.includes('reeducate'), 'Corrupt Dictatorship: ' + cd);
  assert.ok(!ok(S(10, 10, 10)).includes('vanish'), 'a Psychotic Dictatorship that is not corrupt cannot');
  assert.ok(ok(S(10, 10, 10, { corrupt: 75 })).includes('vanish'), 'but a corrupt one can');
  const dem = ok(S(80, 50, 80)); assert.ok(dem.includes('recall') && !dem.includes('vanish') && !dem.includes('erase'), 'democracy: ' + dem);
  assert.ok(ok(S(90, 90, 90)).includes('ignored'), 'Anarchy');
  assert.ok(ok(S(50, 50, 50)).includes('committee'), 'Inoffensive Centrist Democracy');
  assert.ok(ok(S(50, 50, 50), { monarchy: true }).includes('duke'));
  assert.ok(ok(S(50, 50, 50, { relig: 80 })).includes('pilgrimage'));
});

test('the Dispatch tells each fate its own way, with the name in its place', () => {
  const dsp = run('skDsp');
  const d = dsp({ k: 'sack', t: 1, a: 'Finance Minister', b: 'Ada Brightcourt', fx: 'sk:lighthouse' }, { demonym: 'Testish', leader: 'President', currency: 'crown' });
  assert.ok(d && d.h.length === 2 && d.b, 'a story');
  for (const s of d.h.concat(d.b)) assert.ok(!/\{SK|\{D\}|\{L\}/.test(s), s);
  assert.equal(dsp({ k: 'sack', t: 1, a: 'Finance Minister', b: 'Ada', fx: '' }), null, 'an ordinary sacking keeps the ordinary story');
  const g = dsp({ k: 'mysack', t: 1, a: 'Port Ellis', b: 'Bram Owlcott', fx: 'sk:tv' }, {});
  assert.ok(g && g.kick === 'Cities');
});

test('admin statistics: fates chosen, kept on, who, the commonest edicts', () => {
  const now = Date.UTC(2026, 10, 27);
  const r1 = rowSack({ skc: { lighthouse: 2, keep: 3, bogus: 4 }, skd: [{ f: 'lighthouse', t: now - DAY, id: 'sk-fin-abacus', k: 'm' }, { f: 'tv', t: now - 40 * DAY, id: 'sk-may-statue', k: 'y' }], skr: 1 }, now);
  assert.deepEqual(r1.sack.c, { lighthouse: 2, keep: 3 });
  assert.deepEqual(r1.sack.recent, [['lighthouse', 'sk-fin-abacus', 'm']]);
  assert.deepEqual(rowSack({}, now), {}, 'nothing for a nation that never sacked anyone');
  const s = sackSummary([{ ...r1 }, { ...rowSack({ skc: { vanish: 1 }, skd: [{ f: 'vanish', t: now - DAY, id: 'sk-fin-abacus', k: 'm' }], ska: [{}] }, now) }, {}]);
  assert.equal(s.nations, 2); assert.equal(s.sacked, 3); assert.equal(s.keep, 3); assert.equal(s.back, 1); assert.equal(s.asylum, 1);
  assert.deepEqual(s.top[0], ['sk-fin-abacus', 2]);
  assert.equal(s.kind.m, 2);
});

test('the server counts an ambassador abroad for 14 days, the other way round if gaffe-prone', () => {
  const now = Date.now(), cab = { for: { nm: 'X', tr: [], sk: 3, lo: 60 } };
  const a0 = cabinetAffinity({ cab });
  assert.equal(cabinetAffinity({ cab, skd: [{ f: 'ambassador', t: now - DAY }] }), a0 + 3);
  assert.equal(cabinetAffinity({ cab, skd: [{ f: 'ambassador', t: now - DAY, tr: ['gaffe'] }] }), a0 - 3);
  assert.equal(cabinetAffinity({ cab, skd: [{ f: 'ambassador', t: now - 20 * DAY }] }), a0, 'over after 14 days');
  assert.equal(cabinetAffinity({ cab, skd: [{ f: 'ambassador', t: now - DAY, x: 'home' }] }), a0, 'recalled');
  assert.equal(run('skAmbAff')({ skd: [{ f: 'ambassador', t: now - DAY, tr: [] }] }, now), 3, 'the game agrees');
});
