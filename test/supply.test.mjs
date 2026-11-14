// Supply Caches (game/edictum.html, "Supply Caches"; functions/supply.js and functions/supply-rules.js): a player sends a
// player of the region up to 300 materials in any mix, three caches a day. The game keeps a copy of the server's rules
// (SC_RULES) and of its check on a cache's contents (scContents); these keep the copies in step. The section is cut from
// the game's source and run here with its commit hook, which packs, files, gives back and pays a cache.
// Run with: npm run test:fx
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../functions/supply-rules.js';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const shim = readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const civic = readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
const accounts = readFileSync(new URL('../functions/accounts.js', import.meta.url), 'utf8');
const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `source has ${a} … ${b}`); return src.slice(i, j); };
const line = k => { const i = src.indexOf('\n' + k) + 1; assert.ok(i > 0, `source has ${k}`); return src.slice(i, src.indexOf('\n', i)); };
const vars = s => s.replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const plain = v => JSON.parse(JSON.stringify(v));
const DAY = 86400000, CAP = 1000;

/* the section, with what it reaches for from the rest of the game */
function game() {
  const ctx = vm.createContext({
    DAY, TALLY_MAX: 900, COMMIT_HOOKS: [], NORM_HOOKS: [], NOTIF_SOURCES: [], HELP_EXT: [], ACHS: [],
    S: { uid: 'alice' }, OBS: false, PV: false, tabPassive: false, Math, JSON, Object, Array, Number, String, Set, Map, Date,
    setInterval: () => 0, document: { addEventListener() {} }, window: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} },
    connect() {}, dpGifts() { return ''; }, nvxCompute() { return {}; },
    num0: v => typeof v === 'number' && isFinite(v) ? v : 0, stockCap: () => CAP,
    stockNow: n => ({ food: 0, timber: 0, iron: 0, oil: 0, goods: 0, ...(n.stock || {}) }),
    roundStock: st => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  });
  vm.runInContext(line('function gbBump(') + '\n' + line('function stockLimit(') + '\nfunction achDef(c,id,t,n,d,g,f){ACHS.push({c,id,t,n,d,g,f});}\nconst aT=(x,k)=>(x.n.tly||{})[k]||0;\nconst aKeys=(x,p)=>Object.keys(x.n.tly||{}).filter(k=>k.startsWith(p)&&x.n.tly[k]>0).length;', ctx);
  vm.runInContext(vars(cut('/* ───────── Supply Caches', '/* ───────── fifty edicts about the museum')), ctx);
  return ctx;
}
const run = (G, n, now) => { for (const h of G.COMMIT_HOOKS) h(n, null, now); return n; };
const nation = () => ({ name: 'Alicia', stock: { food: 500, timber: 500, iron: 500, oil: 500, goods: 500 }, tly: {} });

test('the game and the server share the rules: 3 caches a day, 300 materials each', () => {
  const G = game();
  assert.deepEqual(plain(G.SC_RULES.res), R.SC_RES);
  assert.equal(G.SC_RULES.day, R.SC_DAY); assert.equal(G.SC_RULES.max, R.SC_MAX); assert.equal(G.SC_RULES.msg, R.SC_MSG);
  assert.equal(G.SC_RULES.age, R.SC_AGE); assert.equal(G.SC_RULES.old, R.SC_OLD); assert.equal(G.SC_RULES.keep, R.SC_KEEP);
  assert.equal(G.SC_ID.source, R.SC_ID.source); assert.equal(G.SC_DOC.source, R.SC_DOC.source);
  assert.equal(R.SC_DAY, 3); assert.equal(R.SC_MAX, 300);
  assert.deepEqual(R.SC_RES, plain(vm.runInNewContext(line('const RES=').replace(/^const RES=/, '').replace(/;$/, ''))));
});

test('a cache holds 1 to 300 materials of the five resources, in any mix, as the game and the server both read it', () => {
  const G = game();
  const cases = [
    [{ goods: 300 }, { goods: 300 }], [{ timber: 100, iron: 120, oil: 80 }, { timber: 100, iron: 120, oil: 80 }],
    [{ food: 0, iron: 7 }, { iron: 7 }], [{ food: 60, timber: 60, iron: 60, oil: 60, goods: 60 }, { food: 60, timber: 60, iron: 60, oil: 60, goods: 60 }],
    [{ goods: 301 }, null], [{ goods: 200, food: 101 }, null], [{}, null], [{ goods: 0 }, null], [{ gold: 5 }, null],
    [{ goods: 1.5 }, null], [{ goods: -1, food: 10 }, null], [{ goods: '5' }, null], [[], null], [null, null], ['300 goods', null],
  ];
  for (const [c, want] of cases) {
    assert.deepEqual(R.scContents(c), want, JSON.stringify(c));
    assert.deepEqual(plain(G.scContents(c)), want, 'game: ' + JSON.stringify(c));
  }
  assert.equal(R.scTotal({ food: 10, oil: 5 }), 15);
});

test('packing takes the materials from the stockpile, and only what the nation has', () => {
  const G = game(), now = Date.UTC(2026, 10, 14, 12), n = nation();
  n._sc = { id: 'mhz3k2ab', to: 'bob', r: { goods: 250, iron: 50 } };
  run(G, n, now);
  assert.equal(n._sc, undefined);
  assert.equal(n.stock.goods, 250); assert.equal(n.stock.iron, 450);
  assert.deepEqual(plain(n.scx), [{ id: 'mhz3k2ab', to: 'bob', r: { goods: 250, iron: 50 }, t: now }]);
  // not enough oil: nothing is packed, nothing is taken
  n._sc = { id: 'mhz3k2ac', to: 'bob', r: { oil: 200 } }; n.stock.oil = 150;
  run(G, n, now);
  assert.equal(n.scx.length, 1); assert.equal(n.stock.oil, 150);
  // over the limit, or the same id again: nothing
  n._sc = { id: 'mhz3k2ad', to: 'bob', r: { food: 301 } }; run(G, n, now);
  n._sc = { id: 'mhz3k2ab', to: 'bob', r: { food: 10 } }; run(G, n, now);
  assert.equal(n.scx.length, 1); assert.equal(n.stock.food, 500);
  // a day's count reads the record
  assert.equal(G.scToday(n, now), 1); assert.equal(G.scLeft(n, now), 2); assert.equal(G.scLeft(n, now + DAY), 3);
});

test('filed by the server: marked, and counted for the achievements', () => {
  const G = game(), now = Date.UTC(2026, 10, 14, 12), n = nation();
  n.tly['scf:bob'] = 1; // bob once sent one here
  n._sc = { id: 'aaaaaa01', to: 'bob', r: { goods: 300 } }; run(G, n, now);
  n._sck = [{ id: 'aaaaaa01', m: true }]; run(G, n, now + 1000);
  assert.equal(n.scx[0].k, 1);
  assert.deepEqual([n.tly.scs, n.tly.scq, n.tly.scfull, n.tly.scmsg, n.tly['sct:bob'], n.tly.scmut, n.tly.scmix, n.tly.scday], [1, 300, 1, 1, 1, 1, undefined, undefined]);
  // filed twice: counted once
  n._sck = [{ id: 'aaaaaa01', m: true }]; run(G, n, now + 2000);
  assert.equal(n.tly.scs, 1);
  // a mixed cache, then the day's third: A Bit of Everything, and Full Manifest
  n._sc = { id: 'aaaaaa02', to: 'carol', r: { food: 1, timber: 1, iron: 1, oil: 1, goods: 1 } }; run(G, n, now + 3000);
  n._sc = { id: 'aaaaaa03', to: 'dave', r: { food: 5 } }; run(G, n, now + 4000);
  n._sck = [{ id: 'aaaaaa02', m: false }, { id: 'aaaaaa03', m: false }]; run(G, n, now + 5000);
  assert.deepEqual([n.tly.scs, n.tly.scmix, n.tly.scday, n.tly.scmsg], [3, 1, 1, 1]);
  assert.equal(Object.keys(n.tly).filter(k => k.startsWith('sct:')).length, 3);
});

test('refused for good: the materials come back; a filed cache never does', () => {
  const G = game(), now = Date.UTC(2026, 10, 14, 12), n = nation();
  n._sc = { id: 'bbbbbb01', to: 'bob', r: { timber: 120 } }; run(G, n, now);
  assert.equal(n.stock.timber, 380);
  n._scb = 'bbbbbb01'; run(G, n, now + 1000);
  assert.equal(n.stock.timber, 500); assert.equal(n.scx, undefined);
  n._sc = { id: 'bbbbbb02', to: 'bob', r: { timber: 120 } }; run(G, n, now);
  n._sck = [{ id: 'bbbbbb02' }]; run(G, n, now);
  n._scb = 'bbbbbb02'; run(G, n, now);
  assert.equal(n.stock.timber, 380); assert.equal(n.scx.length, 1);
});

test('opening pays once, up to what the stores hold', () => {
  const G = game(), now = Date.UTC(2026, 10, 14, 12), n = nation();
  n.stock.oil = 950; n.tly['sct:carol'] = 2;
  n._scp = { id: 'carol_cccccc01', r: { oil: 100, food: 40 }, f: 'carol' }; run(G, n, now);
  assert.equal(n.stock.oil, CAP); assert.equal(n.stock.food, 540);
  assert.deepEqual(plain(G.SC.got), { oil: 50, food: 40 });
  assert.deepEqual(plain(n.sco), ['carol_cccccc01']);
  assert.deepEqual([n.tly.sco, n.tly['scf:carol'], n.tly.scmut], [1, 1, 1]);
  n._scp = { id: 'carol_cccccc01', r: { oil: 100, food: 40 }, f: 'carol' }; run(G, n, now + 1000);
  assert.equal(n.stock.food, 540); assert.equal(n.tly.sco, 1);
  // a malformed id pays nothing
  n._scp = { id: 'nope', r: { food: 40 }, f: 'carol' }; run(G, n, now);
  assert.equal(n.stock.food, 540);
});

test('filed caches go once their day is over; one not filed stays until it is', () => {
  const G = game(), now = Date.UTC(2026, 10, 14, 23, 50), n = nation();
  n._sc = { id: 'dddddd01', to: 'bob', r: { goods: 10 } }; run(G, n, now);
  n._sc = { id: 'dddddd02', to: 'bob', r: { goods: 10 } }; run(G, n, now);
  n._sck = [{ id: 'dddddd01' }]; run(G, n, now);
  run(G, n, now + 20 * 60000);
  assert.deepEqual(plain(n.scx.map(e => e.id)), ['dddddd02']);
  assert.equal(G.scLeft(n, now + 20 * 60000), 3);
});

test('a loaded record keeps well-formed caches only, and the paid ids', () => {
  const G = game(), n = {}, good = { id: 'eeeeee01', to: 'bob', r: { iron: 3 }, t: 5, k: 1 };
  G.NORM_HOOKS.forEach(h => h(n, { scx: [good, { id: 'BAD', to: 'bob', r: { iron: 3 }, t: 5 }, { id: 'eeeeee02', to: 'bob', r: { iron: 999 }, t: 5 }, { id: 'eeeeee03', to: 'bob', r: { iron: 3 }, t: 5, k: true, x: 1 }],
    sco: ['bob_eeeeee01', 'bob_eeeeee01', 7, 'nope'] }));
  assert.deepEqual(plain(n.scx), [good, { id: 'eeeeee03', to: 'bob', r: { iron: 3 }, t: 5 }]);
  assert.deepEqual(plain(n.sco), ['bob_eeeeee01']);
  const m = { scx: [1], sco: [2] }; G.NORM_HOOKS.forEach(h => h(m, {}));
  assert.equal(m.scx, undefined); assert.equal(m.sco, undefined);
});

test('seventeen achievements under Diplomacy, with names of their own', () => {
  const G = game(), A = G.ACHS.filter(a => a.id.startsWith('dip-sc'));
  assert.equal(A.length, 17);
  assert.ok(A.every(a => a.c === 'dip'));
  assert.equal(new Set(A.map(a => a.id)).size, 17);
  for (const a of A) assert.equal(src.split(`'${a.n}'`).length - 1, 1, `${a.n} is used once`);
  const x = { n: { tly: { scs: 10, scq: 1000, sco: 1, 'sct:a': 1, 'sct:b': 1, 'sct:c': 1, 'sct:d': 1, 'sct:e': 1 } } };
  const val = id => A.find(a => a.id === id).f(x);
  assert.ok(val('dip-sc10') >= A.find(a => a.id === 'dip-sc10').g);
  assert.ok(val('dip-scq1k') >= 1000); assert.equal(val('dip-scnat'), 5); assert.equal(val('dip-scin1'), 1);
});

test('only a Registered Nation sends caches (a linked sign-in, never a guest); any nation receives them', () => {
  const now = Date.UTC(2026, 10, 14, 12), G = game(), bob = { id: 'bob', n: { name: 'Bobland' } };
  let reg = false;
  Object.assign(G, { civicRegistered: () => reg, findNation: id => id === 'bob' ? bob : null, fmtTime: () => '12:00', S: { uid: 'alice', mode: 'world', nation: { name: 'Alicia', founded: now - 3 * DAY }, civic: { account: { readyAt: now - 2 * DAY } } } });
  assert.equal(G.scWhyNot('bob', now), G.SC_LINK, 'a guest is told to link an account');
  assert.match(G.SC_LINK, /Registered Nations/); assert.match(G.SC_LINK, /Link a sign-in account/); assert.match(G.SC_LINK, /guests can still receive them/);
  reg = true; assert.equal(G.scWhyNot('bob', now), '');
  reg = false; G.S.google = true; assert.equal(G.scWhyNot('bob', now), '', 'a Google link counts before the server has answered');
  G.S.civic.account.readyAt = now + 3600e3;
  assert.match(G.scWhyNot('bob', now), /a day after its founding/);
  assert.ok(G.SC_BACK.has('registration_required'), 'a cache the server refuses for a guest comes back');
  assert.doesNotMatch(src, /Supply Caches for other players/, 'not a Club perk');
});

test('the wiring: a button on the nation page, the Gifts tab, the probe, the private half, the rules and the server', () => {
  assert.ok(src.includes("${!x.npc&&!x.me&&!x.prev&&x.id!==S.uid&&S.mode==='world'?`<button class=\"btn ghost\" data-act=\"sc-send-open\" data-id=\"${esc(x.id)}\">Send Supply Cache${scLinked()?'':'<span class=\"sc-lock\" title=\"For Registered Nations\"> 🔒</span>'}</button>`:''}"), 'the nation page button, for another player only, locked for guests');
  assert.match(src, /gifts:gfIncoming\(\)\.filter\(g=>!g\.reply\)\.length\+scWaiting\(now\)\.length/);
  assert.match(src, /EDICTUM_PROBE\(\{RPATCH,SC:\(\)=>scProbe\(\),/);
  assert.match(shim, /NX_KEYS\.sco = 1;/);
  assert.match(rules, /match \/supply\/\{id\} \{\s*\n\s*allow read: if isAdmin\(\) \|\| signedIn\(\) && \(resource\.data\.to == request\.auth\.uid \|\| resource\.data\.f == request\.auth\.uid\);\s*\n\s*\}/);
  assert.match(civic, /isSupplyOp\(d\.op\)\) return supply\(db, who, d\)/);
  assert.match(accounts, /await scForget\(db, uid\);/);
  for (const k of ['to', 'f']) assert.ok(indexes.indexes.some(i => i.collectionGroup === 'supply' && i.fields.map(f => f.fieldPath).join() === k + ',x'), 'index ' + k + ',x');
});
