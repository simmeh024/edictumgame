// Trading from the Community Board (game/edictum.html, "trading from the Community Board"): a priced offer posted on
// the author's own region's board is open to the region; the earliest signature takes it. The parser, the taker, the
// deals as collectDeals reads them, and the tally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const fn = head => { const i = html.indexOf(head); assert.ok(i >= 0, head); return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const line = head => { const i = html.indexOf(head); assert.ok(i >= 0, head); return html.slice(i, html.indexOf('\n', i) + 1); };
const RES = ['food', 'timber', 'iron', 'oil', 'goods'];
const DAY = 864e5;

const parser = vm.runInNewContext([line('let CB_EMB_RE=null;'), line('const CB_DAY='), line('const cbEmbRe='), fn('function cbEmbedOf(l){'), fn('function cbOfferTerms(E){'),
  '({cbEmbedOf,cbOfferTerms});'].join('\n'), { RES, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });

test('the parser: a closing bracket may be left off, "a day" may follow, and amounts over 100 scale down together', () => {
  const P = l => JSON.parse(JSON.stringify(parser.cbEmbedOf(l)));
  assert.deepEqual(P('[offer: 10 iron for 8 food]'), { k: 'offer', a: 10, r: 'iron', fa: 8, fr: 'food' });
  assert.deepEqual(P('[offer: 10 iron for 8 food'), P('[offer: 10 iron for 8 food]'), 'no closing bracket');
  assert.deepEqual(P('[want: 5 oil a day for 12 goods per day]'), { k: 'want', a: 5, r: 'oil', fa: 12, fr: 'goods' });
  assert.deepEqual(P('[offer: 6 timber/day for 3 iron / day]'), { k: 'offer', a: 6, r: 'timber', fa: 3, fr: 'iron' });
  assert.deepEqual(P('[offer: 300 food for 30 oil'), { k: 'offer', a: 100, r: 'food', fa: 10, fr: 'oil', big: [300, 30] }, 'the player’s post of 28 Nov: the ratio kept');
  assert.deepEqual(P('[offer: 250 food]'), { k: 'offer', a: 100, r: 'food', fa: 0, fr: '', big: [250, 0] });
  assert.equal(parser.cbEmbedOf('an offer: 10 iron for 8 food'), null, 'only a line that is the embed');
  assert.equal(parser.cbEmbedOf('[offer: 10 gold for 8 food]'), null, 'only the game’s resources');
});

test('the author’s terms: what they send and what they receive', () => {
  const T = l => JSON.parse(JSON.stringify(parser.cbOfferTerms(parser.cbEmbedOf(l))));
  assert.deepEqual(T('[offer: 10 iron for 8 food]'), { g: ['iron', 10], r: ['food', 8] });
  assert.deepEqual(T('[want: 5 oil for 12 goods]'), { g: ['goods', 12], r: ['oil', 5] });
  assert.equal(parser.cbOfferTerms(parser.cbEmbedOf('[offer: 10 iron]')), null, 'no price: nothing to sign');
  assert.equal(parser.cbOfferTerms(parser.cbEmbedOf('[offer: 10 iron for 8 iron]')), null, 'the same resource both ways');
  assert.equal(parser.cbOfferTerms(parser.cbEmbedOf('[my flag]')), null);
});

/* collectDeals and the taker, over a region of records */
function region(docs) {
  const ctx = { TR_OPEN: '*', TR_OFFER_MS: 7 * DAY, NPC_SET: new Set(['npc-1']), docs: Object.entries(docs) };
  ctx.tradeDocs = () => ctx.docs;
  vm.runInNewContext([line('const mirrored='), fn('function collectDeals(){'), fn('function trOpenTaker(author,x,docs){'), 'this.collectDeals=collectDeals;this.trOpenTaker=trOpenTaker;'].join('\n'), ctx);
  return ctx;
}
const now = Date.now(), open = (id, t = now - 3600e3) => ({ id, w: '*', o: 1, g: ['iron', 10], r: ['food', 8], t });
const sign = (id, author, t) => ({ id, w: author, a: 1, g: ['food', 8], r: ['iron', 10], t, s: now - 3600e3 });

test('an open offer waits for anyone; the earliest signature takes it', () => {
  let R = region({ A: { deals: [open('o1')] }, B: { deals: [] } });
  let d = R.collectDeals();
  assert.equal(d.active.length, 0); assert.equal(d.pending.length, 1);
  assert.deepEqual({ to: d.pending[0].to, open: d.pending[0].open, from: d.pending[0].from }, { to: '*', open: 1, from: 'A' });
  R = region({ A: { deals: [open('o1')] }, B: { deals: [sign('o1', 'A', now - 60e3)] }, C: { deals: [sign('o1', 'A', now - 120e3)] } });
  d = R.collectDeals();
  assert.equal(d.pending.length, 0); assert.equal(d.active.length, 1);
  assert.deepEqual({ a: d.active[0].a, b: d.active[0].b, open: d.active[0].open }, { a: 'A', b: 'C', open: 1 }, 'C signed first');
  // a signature on other terms, or to another author, takes nothing
  R = region({ A: { deals: [open('o1')] }, B: { deals: [{ ...sign('o1', 'A', now), r: ['iron', 20] }] }, C: { deals: [sign('o1', 'X', now)] } });
  assert.equal(R.collectDeals().active.length, 0);
});

test('a taker who ended it closes the offer; the author’s own record never does; old offers lapse', () => {
  let R = region({ A: { deals: [open('o1')] }, B: { deals: [], dealNo: ['o1'] }, C: { deals: [sign('o1', 'A', now)] } });
  let d = R.collectDeals(); assert.equal(d.active.length + d.pending.length, 0, 'closed for everyone');
  R = region({ A: { deals: [open('o1')], dealNo: ['o1'] } });
  assert.equal(R.collectDeals().pending.length, 1);
  R = region({ A: { deals: [open('o1', now - 8 * DAY)] } });
  assert.equal(R.collectDeals().pending.length, 0, 'unsigned after seven days, it lapses like any offer');
  R = region({ A: { deals: [open('o1', now - 8 * DAY)] }, B: { deals: [sign('o1', 'A', now - 7.5 * DAY)] } });
  assert.equal(R.collectDeals().active.length, 1, 'a signed one runs on');
});

test('written in by the author, it is an ordinary deal that keeps its mark', () => {
  const R = region({ A: { deals: [{ ...open('o1'), w: 'B' }] }, B: { deals: [sign('o1', 'A', now)] } });
  const d = R.collectDeals();
  assert.equal(d.active.length, 1); assert.equal(d.active[0].b, 'B'); assert.equal(d.active[0].open, 1);
});

test('the game: the lock runs before every commit, the tally counts the taker, records keep the mark', () => {
  assert.ok(html.includes("commit=(f=>function(n){try{trOpenLock(n);}catch(e){}return f.apply(this,arguments);})(commit);"));
  assert.ok(html.includes("if(oldW.get(x.id)===TR_OPEN&&x.w&&x.w!==TR_OPEN)bump('deal:'+x.w,x.t);"), 'the taker counts as a partner once written in');
  assert.ok(html.includes("if(x.w&&x.w!==TR_OPEN)bump('deal:'+x.w,x.t);"), 'and "*" never does');
  assert.ok(/function normalizeBase\(d\)\{[\s\S]*?if\(x\.o===1\)o\.o=1;return o;\}\):\[\];/.test(html), 'normalize keeps o');
  assert.ok(html.includes("cbPostAch=(f=>function(x,reg){const r=f.apply(this,arguments);try{cbOpenAfterPost(x,reg);}catch(e){}return r;})(cbPostAch);"), 'a post opens its offers');
  assert.ok(/function cbOpenAfterPost\(x,reg\)\{\n\s*if\(!REG\|\|reg!==REG\.id\)return;/.test(html), 'only on the nation’s own region’s board');
});
