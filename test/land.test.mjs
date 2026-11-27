// Land deals (functions/land.js): the game keeps a copy of their rules (LD_RULES) and works out bids, instalments and
// stamp duty as the server does. These checks keep the copies in step, check the shape of a deal the server accepts,
// and the map's rules the game holds a deal to (the land must touch the side that receives it, and must not cut the
// giver's land off from its capital), on a small map of their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as R from '../functions/land-rules.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function constOf(name) {
  const at = html.indexOf('const ' + name + '=');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(html.indexOf('{', at), i + 1) + ')')));
}
const fnOf = name => { const m = html.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n')); assert.ok(m, name + ' is found'); return m[0]; };
const lineOf = from => { const a = html.indexOf(from); assert.ok(a >= 0, from + ' is found'); return html.slice(a, html.indexOf('\n', a)); };
const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a + from.length); assert.ok(a >= 0 && b > a, from + ' is found'); return html.slice(a, b); };

test('the game and the server share the land deals’ rules', () => {
  assert.deepEqual(constOf('LD_RULES'), JSON.parse(JSON.stringify(R.LD_RULES)));
  assert.ok(html.includes("LD_DOC=/^[\\w-]{1,128}_[a-z0-9]{8,16}$/"), 'the same deal ids');
  assert.equal(String(R.LD_DOC), '/^[\\w-]{1,128}_[a-z0-9]{8,16}$/');
});

test('bids, instalments and stamp duty count the same in the game and on the server', () => {
  const ctx = vm.createContext({ LD_RULES: R.LD_RULES, DAY: 86400000, Math, Number, Array });
  vm.runInContext(fnOf('ldMinBid') + fnOf('ldDue') + fnOf('ldBehind') + lineOf('const ldNet=') + ';this.ldNet=ldNet;', ctx);
  const now = 1e12, D = 86400000;
  for (const A of [{ res: 5, bids: [] }, { res: 5, bids: [{ v: 5 }] }, { res: 5, bids: [{ v: 100 }] }, { res: 1, bids: [{ v: 1 }, { v: 21 }] }, { bids: [] }])
    assert.equal(ctx.ldMinBid(A), R.ldMinBid(A), JSON.stringify(A));
  assert.equal(R.ldMinBid({ res: 5, bids: [{ v: 100 }] }), 105, 'a bid beats the last by 5%');
  assert.equal(R.ldMinBid({ res: 5, bids: [{ v: 5 }] }), 6, 'and by at least 1');
  for (const A of [{ ins: { n: 7 }, dt: now - 3.5 * D, pd: 1 }, { ins: { n: 7 }, dt: now - 30 * D, pd: 7 }, { ins: { n: 14 }, dt: now - 0.5 * D, pd: 0 }, { ins: null, dt: now }, { ins: { n: 7 }, dt: 0 }]) {
    assert.equal(ctx.ldDue(A, now), R.ldDue(A, now), JSON.stringify(A));
    assert.equal(ctx.ldBehind(A, now), R.ldBehind(A, now), JSON.stringify(A));
  }
  assert.equal(R.ldDue({ ins: { n: 7 }, dt: now - 3.5 * D }, now), 3, 'one a day, the first a day after the land moved');
  assert.equal(R.ldBehind({ ins: { n: 7 }, dt: now - 30 * D, pd: 4 }, now), 3, 'never more than the deal’s days');
  for (const v of [0, 1, 9, 10, 11, 99, 100, 5000]) assert.equal(ctx.ldNet(v), R.ldNet(v), String(v));
  assert.equal(R.ldNet(100), 90, 'a tenth is lost to stamp duty');
  assert.deepEqual(R.ldNetPay({ iron: 100, oil: 1 }), { iron: 90 }, 'nothing of a payment too small to survive the duty');
});

test('the shape of a deal: land moves, each hex once, instalments from the side that receives it', () => {
  assert.ok(R.ldShape('deal', { ga: [1, 2], pb: { iron: 50 } }), 'a sale');
  assert.ok(R.ldShape('deal', { gb: [3], pa: { oil: 5 } }), 'a purchase');
  assert.ok(R.ldShape('deal', { ga: [1], gb: [3], pa: { goods: 2 } }), 'an uneven swap');
  assert.ok(R.ldShape('deal', { ga: [1] }), 'a gift');
  assert.equal(R.ldShape('deal', { pa: { iron: 5 }, pb: { oil: 5 } }), null, 'no land: a trade deal, not a land deal');
  assert.equal(R.ldShape('deal', { ga: [1, 1] }), null, 'a hex twice');
  assert.equal(R.ldShape('deal', { ga: [1], gb: [1] }), null, 'a hex on both sides');
  assert.equal(R.ldShape('deal', { ga: [1.5] }), null, 'not a hex');
  assert.equal(R.ldShape('deal', { ga: Array.from({ length: R.LD_RULES.hexes + 1 }, (_, i) => i) }), null, 'too many hexes');
  assert.equal(R.ldShape('deal', { ga: [1], pb: { iron: R.LD_RULES.max + 1 } }), null, 'too dear');
  assert.equal(R.ldShape('deal', { ga: [1], pb: { gold: 5 } }), null, 'no such resource');
  const ins = R.ldShape('deal', { ga: [1], ins: { r: { food: 3 }, n: 7 } });
  assert.deepEqual(ins.ins, { by: 'b', r: { food: 3 }, n: 7 }, 'instalments come from the side that receives the land');
  assert.equal(R.ldShape('deal', { ga: [1], gb: [2], ins: { r: { food: 3 }, n: 7 } }), null, 'no instalments in a swap');
  assert.equal(R.ldShape('deal', { ga: [1], ins: { r: { food: 3 }, n: 5 } }), null, 'instalments run 7, 14 or 30 days');
  assert.equal(R.ldShape('deal', { ga: [1], ins: { r: { food: R.LD_RULES.perDay + 1 }, n: 7 } }), null, 'a day’s instalment has a limit');
  assert.ok(R.ldShape('list', { ga: [1], pb: { iron: 5 } }), 'a listing');
  assert.equal(R.ldShape('list', { ga: [1] }), null, 'a listing has a price');
  assert.equal(R.ldShape('list', { ga: [1], gb: [2], pb: { iron: 5 } }), null, 'a listing sells only its offerer’s land');
  assert.equal(R.ldShape('list', { ga: [1], pa: { iron: 1 }, pb: { iron: 5 } }), null, 'and its offerer pays nothing');
  const A = R.ldShape('auction', { ga: [1], cur: 'oil', res: 20, hours: 24 });
  assert.equal(A.cur, 'oil'); assert.equal(A.res, 20); assert.deepEqual(A.pb, {});
  assert.equal(R.ldShape('auction', { ga: [1], cur: 'oil', res: 20, hours: 12 }), null, 'an auction runs 24 or 48 hours');
  assert.equal(R.ldShape('auction', { ga: [1], cur: 'gold', res: 20, hours: 24 }), null, 'bids in a resource');
  assert.equal(R.ldShape('auction', { ga: [1], cur: 'oil', res: 0, hours: 24 }), null, 'a reserve of at least 1');
});

test('finished deals: what holds a slot, and when a deal is over', () => {
  assert.ok(R.ldHolds('offered') && R.ldHolds('agreed') && !R.ldHolds('done'));
  assert.equal(R.ldEnded({ st: 'agreed' }), 0);
  assert.ok(R.ldEnded({ st: 'void', vt: 5 }) === 5);
  assert.equal(R.ldEnded({ st: 'done', dt: 9, ins: { n: 7 }, pd: 3 }), 0, 'instalments still running');
  assert.equal(R.ldEnded({ st: 'done', dt: 9, ins: { n: 7 }, pd: 7, pt: 20 }), 20, 'paid off');
  assert.ok(R.ldCovers({ iron: 10, oil: 2 }, { iron: 10 }) && !R.ldCovers({ iron: 9 }, { iron: 10 }));
  assert.equal(R.ldKey('u_abcdefgh', 3), 'u_abcdefgh~3');
});

/* the map's rules, on a strip of hexes 0…9 in a row (each joined to the next) with a spur 10 off hex 2 */
function strip() {
  const N = 11, nbr = new Int32Array(N * 6).fill(-1), link = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { const k = [...nbr.slice(x * 6, x * 6 + 6)].indexOf(-1); nbr[x * 6 + k] = y; } };
  for (let i = 0; i < 9; i++) link(i, i + 1);
  link(2, 10);
  return { N, nbr };
}
test('the map’s rules: land touches the side that receives it, and leaves the giver whole', () => {
  const MAP = strip();
  const ctx = vm.createContext({ MAP, Uint8Array, Set });
  vm.runInContext(cut('function ldReach(', 'function ldRansom(') + cut('function ldRansom(', '\n/* what is wrong with'), ctx);
  /* nation 0 holds 0…4 and the spur (capital 0); nation 1 holds 5…9 (capital 9) */
  const owner = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0], T = { owner, list: [{ cap: 0 }, { cap: 9 }], isCap: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], occ: new Uint8Array(11), orig: new Int16Array(11).fill(-1) };
  assert.ok(ctx.ldTouches(T, 1, [4]), 'a border hex touches the neighbour');
  assert.ok(ctx.ldTouches(T, 1, [3, 4]), 'a hex joined to it through another hex of the deal');
  assert.ok(!ctx.ldTouches(T, 1, [3]), 'a hex with land of its own nation between it and the neighbour');
  assert.ok(!ctx.ldTouches(T, 1, [10]), 'the spur does not touch the neighbour');
  assert.equal(ctx.ldCuts(T, 0, [4]), 0, 'giving the end of the strip cuts nothing off');
  assert.equal(ctx.ldCuts(T, 0, [3]), 1, 'giving hex 3 would leave hex 4 cut off from the capital');
  assert.equal(ctx.ldCuts(T, 0, [2]), 3, 'giving hex 2 would cut off 3, 4 and the spur');
  assert.equal(ctx.ldCuts(T, 0, [2, 3, 4, 10]), 0, 'giving all of it leaves nothing cut off');
  T.occ[5] = 1; T.orig[5] = 0;
  assert.ok(ctx.ldRansom(T, 1, 0, [5]), 'land nation 1 took from nation 0 in war, going back: a ransom');
  assert.ok(!ctx.ldRansom(T, 1, 0, [5, 6]), 'not when a hex of it was never nation 0’s');
});

test('the game wires every part in', () => {
  for (const s of ["'ldOffer'", "'ldAnswer'", "'ldWithdraw'", "'ldBid'", "'ldClose'", "'ldCede'", "'ldFail'", "'ldPay'", "'ldCall'",
    "['land','Land']", '.dp[data-tab="land"]>#dp-p-land', "pane('land',safe(()=>ldTab(now)))", 'land:ldBadge(now)', 'LDX:()=>ldProbe()', "['landp','Land prices']", "collection('land').where('reg','==',reg)", "HELP_EXT.push({k:'landdeals'"])
    assert.ok(html.includes(s), s);
  for (const id of ['dip-ldsell', 'dip-ldbuy', 'dip-ldswap', 'dip-ldgift', 'dip-ldprov', 'dip-ldwin', 'dip-ldauc', 'dip-ldransom', 'dip-ldbig', 'dip-ldbaron', 'dip-ldpaid'])
    assert.ok(html.includes(`'${id}'`), id);
  const civic = fs.readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8'), rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.ok(civic.includes('if (isLandOp(d.op)) return land(db, who, d);') && civic.includes('!isLandOp(op)'), 'civic routes the land ops');
  assert.ok(rules.includes('match /land/{lid} { allow read: if true; }'), 'the region reads its land deals; only the server writes them');
  const acc = fs.readFileSync(new URL('../functions/accounts.js', import.meta.url), 'utf8');
  assert.ok(acc.includes('await ldDrop(db, uid);'), 'a deleted account’s land deals are called off');
});

/* a bid being typed outlives the page drawn again: the box came back at the lowest bid, and Bid then bid that (the land
   test's raised bid of 6 went in as 4 when a snapshot came between the typing and the click, CI 27 Nov 2026) */
test('a typed bid is kept through a redraw, and forgotten once it is placed', () => {
  assert.match(html, /const typed=Math\.round\(\+\(\(LD\.typed\|\|\{\}\)\[D\.id\]\)\|\|0\);act=`<label class="ld-bidf">[^`]*value="\$\{typed>=min\?typed:min\}"/, 'the box shows what was typed, while it is at least the lowest bid');
  assert.ok(html.includes("document.addEventListener('input',e=>{const f=e.target;if(f&&f.id&&f.id.startsWith('ld-bid-'))(LD.typed||(LD.typed={}))[f.id.slice(7)]=f.value;});"), 'each keystroke kept');
  assert.match(html, /if\(LD\.typed\)delete LD\.typed\[id\];\n {2}toast\(`You bid /, 'a placed bid clears it');
});
