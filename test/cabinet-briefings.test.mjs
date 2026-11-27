// The daily cabinet briefing (game/edictum.html, GV_BRIEF and the section "what a briefing's materials come to"). On
// 27 Nov 2026 the owner asked for briefings with "more of a pro and a con, also some real consequences for material
// income", and 100 new ones. Every answer now has at least one reward and one price, most reach the stockpile (paid or
// gained at once: m, or a change to a resource's income for a few days: i, kept in n.bfx), and the day's briefing comes
// from a seeded order that shows every briefing once before any comes round again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const slice = (start, end) => { const a = html.indexOf(start); assert.ok(a >= 0, start); const b = html.indexOf(end, a); assert.ok(b > a, end); return html.slice(a, b + end.length); };
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const line = start => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf('\n', at)); };

const ctx = vm.createContext({});
vm.runInContext([slice('const STATS = {', '\n};'), slice('const GV_BRIEF=[', '\n];'), 'this.STATS=STATS;this.B=GV_BRIEF;'].join('\n'), ctx);
const { STATS, B } = ctx;
const PF = ['fin', 'def', 'for', 'int', 'wrk', 'hea', 'cul'], RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const HOLDERS = /\{(N|D|C|Cs|L|CAP|A|As|SPORT|DISH|LANG|FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/g;

/* an answer's pros and cons, as gvBfPC counts them: neutral scores are neither */
function pc(o) {
  let pro = 0, con = 0;
  for (const [k, v] of Object.entries(o.e || {})) {
    if (k === 'md') { v > 0 ? pro++ : con++; continue; }
    if (k === 'cab') { for (const lv of Object.values(v)) lv > 0 ? pro++ : con++; continue; }
    const g = STATS[k].g; if (g && v) (Math.sign(v) === g ? pro++ : con++);
  }
  for (const d of Object.values(o.m || {})) d > 0 ? pro++ : con++;
  if (o.i) o.i[1] > 0 ? pro++ : con++;
  return { pro, con };
}

test('121 briefings or more: the 21 from before and 100 new, every minister with at least 15', () => {
  assert.ok(B.length >= 121, 'briefings: ' + B.length);
  for (const pf of PF) assert.ok(B.filter(b => b.pf === pf).length >= 15, pf + ': ' + B.filter(b => b.pf === pf).length);
  for (const id of ['fin-sofa', 'def-goat', 'wrk-pothole', 'cul-gallery']) assert.ok(B.some(b => b.id === id), id + ' is kept');
});

test('every briefing is well formed: ids, ministers, lengths, placeholders and punctuation', () => {
  const ids = new Set();
  for (const b of B) {
    assert.match(b.id, /^[a-z]{3}-[a-z-]{2,20}$/, b.id); assert.ok(b.id.length <= 24, b.id + ' fits n.brf.i');
    assert.ok(!ids.has(b.id), 'id used twice: ' + b.id); ids.add(b.id);
    assert.ok(PF.includes(b.pf) && b.id.startsWith(b.pf + '-'), b.id + ' belongs to its minister');
    assert.ok(b.q.includes('{' + b.pf.toUpperCase() + '}'), b.id + ' names its minister');
    assert.ok(b.q.length <= 300, b.id + ' situation is short: ' + b.q.length);
    assert.ok(Array.isArray(b.o) && b.o.length >= 2 && b.o.length <= 3, b.id + ' has two or three answers');
    const texts = [b.q, ...b.o.flatMap(o => [o.t, o.r])];
    for (const t of texts) {
      assert.equal(typeof t, 'string', b.id);
      assert.ok(!/['"]/.test(t), b.id + ' uses typographic quotes only: ' + t);
      assert.equal(t.replace(HOLDERS, '').match(/[{}]/), null, b.id + ' uses known placeholders only: ' + t);
    }
    for (const o of b.o) {
      assert.ok(o.t.length <= 34, b.id + ' button text is short: ' + o.t);
      assert.ok(o.r.length <= 190, b.id + ' result is short: ' + o.r.length);
    }
  }
});

test('every answer has a reward and a price; every briefing can be answered with an empty stockpile', () => {
  for (const b of B) {
    let mat = 0;
    for (const o of b.o) {
      const c = pc(o), who = b.id + ' “' + o.t + '”';
      assert.ok(c.pro >= 1, who + ' has a pro'); assert.ok(c.con >= 1, who + ' has a con');
      const sc = Object.keys(o.e || {}).filter(k => k !== 'cab' && k !== 'md');
      assert.ok(sc.length <= 3, who + ' moves at most three scores');
      for (const k of sc) assert.ok(STATS[k] && k !== 'pop' && Number.isInteger(o.e[k]) && Math.abs(o.e[k]) <= 3 && o.e[k], who + ' score ' + k);
      if (o.e.md !== undefined) assert.equal(o.e.md, 1, who + ' mandate');
      for (const [pk, lv] of Object.entries(o.e.cab || {})) {
        assert.ok(pk === 'all' || PF.includes(pk), who + ' cab ' + pk);
        assert.ok(Number.isInteger(lv) && lv && (pk === 'all' ? lv >= -3 && lv <= 2 : lv >= -6 && lv <= 7), who + ' loyalty ' + pk + ' ' + lv);
      }
      if (o.m) {
        const ks = Object.keys(o.m); assert.ok(ks.length >= 1 && ks.length <= 2, who + ' pays or gains one or two resources');
        for (const r of ks) assert.ok(RES.includes(r) && o.m[r] && Math.abs(o.m[r]) <= 1.5, who + ' m ' + r + ' ' + o.m[r]);
      }
      if (o.i) {
        assert.ok(Array.isArray(o.i) && o.i.length === 3 && RES.includes(o.i[0]), who + ' income change');
        assert.ok(Math.abs(o.i[1]) >= 0.1 - 1e-9 && Math.abs(o.i[1]) <= 0.3 + 1e-9, who + ' income share ' + o.i[1]);
        assert.ok(Number.isInteger(o.i[2]) && o.i[2] >= 1 && o.i[2] <= 4, who + ' income days ' + o.i[2]);
      }
      if (o.m || o.i) mat++;
    }
    assert.ok(b.o.some(o => !Object.values(o.m || {}).some(d => d < 0)), b.id + ' keeps an answer without a cost in the stockpile');
    assert.ok(mat >= 1, b.id + ' reaches the stockpile');
  }
  const all = B.flatMap(b => b.o);
  assert.ok(all.filter(o => o.m || o.i).length / all.length >= 0.6, 'most answers reach the stockpile');
  for (const r of RES) assert.ok(all.some(o => (o.m && o.m[r]) || (o.i && o.i[0] === r)), r + ' is used');
});

test('the day’s briefing: every briefing once in a round of days, in an order of the nation’s own', () => {
  const c = vm.createContext({ GV_BRIEF: B, DAY: 864e5 });
  vm.runInContext([fn('hash'), fn('rng'), fn('ddDay'), line('const bfDayNo='), 'let bfOrderMemo={k:\'\',v:null};', fn('bfOrder'), fn('gvBriefToday'),
    'this.today=gvBriefToday;this.order=bfOrder;'].join('\n'), c);
  const L = B.length, day = new Date(2026, 10, 27, 12).getTime(), seen = new Set();
  for (let k = 0; k < L; k++) seen.add(c.today({ seed: 'abc' }, day + k * 864e5).it.id);
  const first = c.today({ seed: 'abc' }, day).it.id;
  const round = Math.floor(Math.round(Date.UTC(2026, 10, 27) / 864e5) / L), start = round * L - Math.round(Date.UTC(2026, 10, 27) / 864e5);
  /* the days of one whole round: a round starts at a day number that is a multiple of L */
  const ids = new Set(); for (let k = 0; k < L; k++) ids.add(c.today({ seed: 'abc' }, day + (start + L + k) * 864e5).it.id);
  assert.equal(ids.size, L, 'every briefing comes once in a round');
  assert.ok(seen.size > L * 0.55, 'L days in a row bring few repeats: ' + seen.size);
  assert.notDeepEqual(Array.from(c.order('abc', 3)).slice(0, 12), Array.from(c.order('xyz', 3)).slice(0, 12), 'each nation has its own order');
  assert.equal(c.today({ seed: 'abc' }, day).it.id, first, 'the same day gives the same briefing');
  const late = new Date(2026, 10, 27, 23, 59).getTime(), early = new Date(2026, 10, 27, 0, 1).getTime();
  assert.equal(c.today({ seed: 'q' }, late).it.id, c.today({ seed: 'q' }, early).it.id, 'one briefing for the whole local day');
});

/* the stockpile with income changes: the base stockNow accrues the rates without them; the wrapper counts each change for
   the part of it between the last save and now */
function stock(rates, cap = 400) {
  const c = vm.createContext({ RES, DAY: 864e5, Date, Math, Number, Array, Object });
  vm.runInContext(['const num0=v=>typeof v==="number"&&isFinite(v)?v:0;const COMMIT_HOOKS=[],NORM_HOOKS=[];let NOW=0;',
    `const stockCap=()=>${cap};function stockLimit(n,r,value,previous){return Math.max(num0(previous===undefined?n.stock?.[r]:previous),Math.min(stockCap(n),value));}`,
    `let stockRates=function(n){return Object.assign({},${JSON.stringify(rates)});};`,
    'let stockNow=function(n,now){const o={},dt=(now-n.stockAt)/DAY,rt=stockRates(n);for(const r of RES)o[r]=Math.min(stockCap(n),Math.max(num0(n.stock[r]),num0(n.stock[r])+rt[r]*dt));return o;};',
    line('const BF_FLOOR='), 'let bfOff=0,bfIn=0;', slice('function bfList(n)', '  }catch(e){}return o;};'), 'stockRates=bfWrapRates(stockRates);stockNow=bfWrapNow(stockNow);', slice('COMMIT_HOOKS.push(n=>{if(Array.isArray(n.bfx))', '\n});'),
    'this.now=(n,t)=>stockNow(n,t);this.rates=n=>stockRates(n);this.commit=n=>COMMIT_HOOKS[0](n);this.norm=(n,d)=>NORM_HOOKS[0](n,d);'].join('\n'), c);
  return c;
}
const D = 864e5, T0 = Date.UTC(2026, 10, 27);
const nation = (bfx, st = {}) => ({ stock: { food: 100, timber: 100, iron: 100, oil: 100, goods: 100, ...st }, stockAt: T0, bfx });

test('a rise in income counts for its days only, however long the player stays away', () => {
  const c = stock({ food: 20, timber: 10, iron: 5, oil: 2, goods: 8 });
  const n = nation([['timber', 4, T0, T0 + 2 * D]]);
  assert.equal(Math.round(c.now(n, T0 + D).timber * 10) / 10, 100 + 10 + 4, 'a day in: one day of the rise');
  assert.equal(Math.round(c.now(n, T0 + 5 * D).timber * 10) / 10, 100 + 50 + 8, 'five days later: only its two days');
  assert.equal(Math.round(c.now(n, T0 + 5 * D).food), 100 + 100, 'other resources are untouched');
});

test('a cut takes no more than the income it cuts, and nothing from a full stockpile', () => {
  const c = stock({ food: 20, timber: 10, iron: 5, oil: 2, goods: 8 });
  assert.equal(Math.round(c.now(nation([['iron', -3, T0, T0 + 2 * D]]), T0 + 3 * D).iron), 100 + 15 - 6, 'iron −3 a day for two days');
  assert.equal(Math.round(c.now(nation([['oil', -5, T0, T0 + 2 * D]]), T0 + 2 * D).oil), 100, 'oil −5 a day on an income of 2 takes the 2 only');
  assert.equal(Math.round(c.now(nation([['food', -4, T0, T0 + D]], { food: 400 }), T0 + D).food), 400, 'a full stockpile stays full');
});

test('the “+x a day” shown carries the change while it is in force, and the change goes once it has been counted', () => {
  const real = Date.now;
  try {
    const c = stock({ food: 20, timber: 10, iron: 5, oil: 2, goods: 8 });
    const n = nation([['goods', 3, T0, T0 + D], ['oil', -9, T0, T0 + D]]);
    Date.now = () => T0 + D / 2;
    assert.equal(c.rates(n).goods, 11); assert.equal(c.rates(n).oil, 0, 'a rate never falls below nothing');
    Date.now = () => T0 + 2 * D;
    assert.equal(c.rates(n).goods, 8, 'after its day, the rate is back');
    const saved = { ...n, stockAt: T0 + 2 * D }; c.commit(saved); assert.equal(saved.bfx, undefined, 'counted and gone');
    const kept = { ...n, stockAt: T0 + D / 2 }; c.commit(kept); assert.equal(kept.bfx.length, 2, 'still running: kept');
  } finally { Date.now = real; }
});

test('the briefing changes are laid over every other rule for the stockpile’s day, last of all', () => {
  const at = html.indexOf('stockRates=bfWrapRates(stockRates);stockNow=bfWrapNow(stockNow);');
  assert.ok(at > 0, 'the wrappers are laid on');
  const later = [...html.matchAll(/\n(stockRates|stockNow)=/g)].filter(m => m.index > at);
  assert.equal(later.length, 0, 'nothing wraps the stockpile after them: ' + later.map(m => m[1]).join(','));
  assert.ok(/add\('Cabinet briefings'/.test(html), 'the day line by line names them');
});

test('a saved list is checked on load: resources, amounts, at most four days', () => {
  const c = stock({ food: 1, timber: 1, iron: 1, oil: 1, goods: 1 }), n = {};
  c.norm(n, { bfx: [['timber', 4.04, T0, T0 + D], ['gold', 1, T0, T0 + D], ['iron', 2, T0, T0 + 9 * D], ['oil', 'x', T0, T0 + D], ['food', -2, T0 + D, T0]] });
  assert.deepEqual(JSON.parse(JSON.stringify(n.bfx)), [['timber', 4, T0, T0 + D]]);
  const m = {}; c.norm(m, { bfx: 'nonsense' }); assert.equal(m.bfx, undefined);
});
