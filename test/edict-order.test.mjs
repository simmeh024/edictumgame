// Edicts keep their numbers (23 November 2026). A record remembers the edicts it has seen by number (n.iseen), and an
// edict's number is its place in ISSUES, so a new edict may only ever be added after every other. The Great Dam (PR #425,
// 17 November) put four edicts before the museum's and moved 780 numbers by four: answered edicts came back early.
// This runs the game's top-level code, statement by statement, in a stubbed context to read ISSUES as the page builds it,
// and checks that the order pinned in test/edict-order.txt still starts it. Edicts added at the end pass; to pin them too:
//   EDICT_ORDER_WRITE=1 node --test test/edict-order.test.mjs
// It also checks issRenumber, which puts right the records numbered before the Great Dam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parse } from 'acorn';

const FIX = new URL('./edict-order.txt', import.meta.url);
const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

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
  /* the game is one function called at once: run its body */
  let body = ast.body;
  for (const st of ast.body) {
    const e = st.type === 'ExpressionStatement' && st.expression, c = e && (e.type === 'CallExpression' ? e : e.type === 'UnaryExpression' && e.argument), f = c && c.callee;
    if (f && /Function/.test(f.type) && f.body.body && f.body.body.length > 1000) { body = f.body.body; break; }
  }
  const failed = [];
  for (const st of body) {
    const s = code.slice(st.start, st.end);
    try { vm.runInContext(s, ctx, { timeout: 1000 }); }
    catch (e) { if (/ISSUES\s*=|ISSUES\.push|ISSUES_RANDOM\.push|function issRenumber|const ISS_MOVE|function iss[A-Z]/.test(s)) failed.push(String(e && e.message).slice(0, 100) + ' :: ' + s.slice(0, 80)); }
  }
  return { ctx, failed };
}
const G = load(), run = s => vm.runInContext(s, G.ctx);
const ids = JSON.parse(run('JSON.stringify(ISSUES.map(x=>x.id))')), pinned = fs.readFileSync(FIX, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);

test('the page builds every edict: no statement that adds one fails here', () => {
  assert.deepEqual(G.failed, []);
  assert.ok(ids.length >= 3000, 'ISSUES has ' + ids.length);
  assert.equal(new Set(ids).size, ids.length, 'every id once');
  assert.equal(run('ISSUES.filter((x,i)=>x.no!==i+1).length'), 0, 'every number is the place in ISSUES');
});

test('the pinned order still starts ISSUES: new edicts go after every other', () => {
  let k = 0; while (k < pinned.length && pinned[k] === ids[k]) k++;
  assert.ok(k === pinned.length, k < pinned.length
    ? `edict number ${k + 1} was ${pinned[k]} and is now ${ids[k]}. Records keep the numbers of the edicts they have seen, so every edict after it would come back early or be held back. Add new edicts after the last ISSUES.push in game/edictum.html, never before an existing one.`
    : '');
  if (process.env.EDICT_ORDER_WRITE && ids.length > pinned.length) fs.writeFileSync(FIX, ids.join('\n') + '\n');
});

test('the Great Dam moved 2052–2831 by four, which ISS_MOVE describes', () => {
  assert.deepEqual(ids.slice(2051, 2056), ['dam-valley', 'dam-cracks', 'dam-water', 'dam-floodgates', 'mus-naming']);
  assert.equal(ids[2830 + 4], 'fun-ouch-letter', 'the last number moved: 2831 then, 2835 now');
  assert.deepEqual(JSON.parse(run('JSON.stringify([ISS_MOVE.a,ISS_MOVE.b,ISS_MOVE.by,ISS_MOVE.day,ISS_MOVE.live])')),
    [2052, 2831, 4, Math.floor(Date.UTC(2026, 10, 17) / 864e5), Date.UTC(2026, 10, 17, 15, 26)]);
});

/* a record as normalize leaves it before the hooks: seen numbers with their days */
const DAY = 864e5, CUT = Math.floor(Date.UTC(2026, 10, 17) / DAY), FOUNDED = Date.UTC(2026, 10, 1, 9);
function rec(seen, extra = {}) {
  const n = { founded: FOUNDED, answered: [], iseen: seen.map(x => x[0]), ...extra };
  run('(n,days)=>{n.isd=issPack(days);}')(n, seen.map(x => x[1]));
  return n;
}
const renumber = (n, d) => run('issRenumber')(n, d || { iseen: n.iseen });
const seen = n => { const days = run('issDays')(n); return n.iseen.map((no, k) => [no, days[k]]); };

test('issRenumber: entries before the day move four on; earlier numbers and later days stay', () => {
  const n = rec([[100, CUT - 9], [2051, CUT - 8], [2052, CUT - 6], [2060, CUT - 5], [2831, CUT - 3], [2100, CUT + 1], [2900, CUT + 2]]);
  assert.equal(renumber(n), true);
  assert.deepEqual(seen(n), [[100, CUT - 9], [2051, CUT - 8], [2056, CUT - 6], [2064, CUT - 5], [2835, CUT - 3], [2100, CUT + 1], [2900, CUT + 2]]);
  assert.equal(n.isv, 1);
  /* the edict the player saw is the one the number names now */
  assert.equal(run('ISSUES')[2056 - 1].id, 'mus-naming');
});

test('issRenumber: on the day itself an entry moves unless the answers show it under the new number', () => {
  const nowNo = 2100, newId = ids[nowNo - 1], t = Date.UTC(2026, 10, 17, 18);
  const a = rec([[2090, CUT], [nowNo, CUT]], { answered: [{ id: newId, o: 0, t }] });
  renumber(a);
  assert.deepEqual(seen(a), [[2094, CUT], [nowNo, CUT]]);
});

test('issRenumber: a number listed twice keeps its later place', () => {
  const n = rec([[2100, CUT - 4], [500, CUT - 1], [2104, CUT + 3]]);
  renumber(n);
  assert.deepEqual(seen(n), [[500, CUT - 1], [2104, CUT + 3]]);
});

test('issRenumber: once only, and never for a nation founded after the build', () => {
  const done = rec([[2100, CUT - 4]]);
  assert.equal(renumber(done, { iseen: done.iseen, isv: 1 }), false);
  assert.deepEqual(seen(done), [[2100, CUT - 4]]);
  assert.equal(done.isv, 1);
  const late = rec([[2100, CUT]], { founded: Date.UTC(2026, 10, 17, 16) });
  assert.equal(renumber(late), false);
  assert.deepEqual(late.iseen, [2100]);
  assert.equal(late.isv, 1);
  const none = rec([]);
  assert.equal(renumber(none, {}), false);
  assert.equal(none.isv, 1);
});

test('issRenumber runs at load, after the hook that dates the seen numbers', () => {
  const at = s => { const i = code.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('NORM_HOOKS.push((n,d)=>{issRenumber(n,d);});') > at('n.isd=issPack(days);\n});'));
  assert.ok(/NX_KEYS\.isv = 1;/.test(fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8')), 'the mark is saved with the private half, beside iseen');
});
