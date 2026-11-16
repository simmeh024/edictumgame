// A Shop sale (2026-11-16, the owner: "Lets give 50% of everything from now until 23rd of Nov", the Shop's packs): the
// catalogue's sale takes pct off every product of its kinds between its from and its until. The server adds it to each
// checkout as a Paddle discount on the lines on sale, and the page shows the lower price beside the full one, struck through.
// Run with: node --test test/shop-sale.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CATALOGUE, SALE, saleOff, saleKey, saleDiscount} from '../functions/shop-core.js';

const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../functions/shop.js',import.meta.url),'utf8');
const line=start=>{const a=game.indexOf(start);assert(a>0,`the game still has ${start}`);return game.slice(a,game.indexOf('\n',a));};
const DURING=Date.parse('2026-11-20T12:00:00Z'),BEFORE=Date.parse('2026-11-15T23:59:59Z'),END=Date.parse('2026-11-24T00:00:00Z');
const PACKS=Object.keys(CATALOGUE.products).filter(p=>CATALOGUE.products[p].kind==='once');

test('the sale: half price from 16 November until the end of 23 November (UTC)',()=>{
  assert.equal(CATALOGUE.sale.pct,50);
  assert.equal(SALE.from,Date.parse('2026-11-16T00:00:00Z'));
  assert.equal(SALE.until,END,'up to 23 November, 23:59:59 UTC');
  assert.deepEqual(SALE.kinds,['once']);
});

test('every pack and the Founder’s Package are on sale; the Chancery Club is not',()=>{
  assert.ok(PACKS.length>=10&&PACKS.includes('founder')&&PACKS.includes('mayapack'));
  for(const p of PACKS)assert.equal(saleOff(p,DURING),50,p);
  for(const p of ['vip','vipyear','giftvip'])assert.equal(saleOff(p,DURING),0,p);
  assert.equal(saleOff('orpack',BEFORE),0,'not before it starts');
  assert.equal(saleOff('orpack',END-1),50,'the last millisecond of 23 November');
  assert.equal(saleOff('orpack',END),0,'over at midnight');
  assert.equal(saleOff('nosuch',DURING),0);
});

test('a checkout under the sale carries its key, so an older full-price one is not reused (nor a sale one after it)',()=>{
  assert.equal(saleKey(['orpack'],DURING),'50@'+END);
  assert.equal(saleKey(['orpack','sailpack'],DURING),'50@'+END);
  assert.equal(saleKey(['vip'],DURING),'');
  assert.equal(saleKey(['orpack'],END),'');
  assert.equal(saleKey(['orpack'],BEFORE),'');
});

test('the Paddle discount: 50% off the lines on sale only',()=>{
  const d=saleDiscount(['orpack','sailpack'],['pri_a','pri_b'],DURING);
  assert.equal(d.type,'percentage');assert.equal(d.amount,'50');
  assert.deepEqual(d.restrict_to,['pri_a','pri_b']);
  assert.match(d.description,/50% off every pack until 2026-11-23/);
  assert.deepEqual(saleDiscount(['orpack','vip'],['pri_a','pri_v'],DURING).restrict_to,['pri_a'],'a line not on sale keeps its price');
  assert.equal(saleDiscount(['vip'],['pri_v'],DURING),null);
  assert.equal(saleDiscount(['orpack'],['pri_a'],END),null,'none after the sale');
});

test('the server adds it to every checkout and basket, and keeps which sale a checkout was opened under',()=>{
  assert.equal((server.match(/const disc = saleDiscount\(\[product\], \[price\], now\);if \(disc\) body\.discount = disc;/g)||[]).length,1);
  assert.equal((server.match(/const disc = saleDiscount\(products, prices, now\);if \(disc\) body\.discount = disc;/g)||[]).length,1);
  assert.equal((server.match(/\(s\.get\('sale'\) \|\| ''\) === sk/g)||[]).length,2,'reused only under the same sale');
  assert.equal((server.match(/\.\.\.\(disc \? \{ sale: sk \} : \{\}\)/g)||[]).length,2,'recorded with the checkout');
});

/* the page's price helpers, on the real catalogue, at a given moment */
function page(now,local){
  const ctx={Date,Math,Number,Object,Intl,SHOP:{local:local||null},shopCat:()=>CATALOGUE,shopNow:()=>now,esc:s=>String(s)};
  vm.createContext(ctx);
  const fns=['function shopSaleOff(','function shopSaleOn(','const shopCut=','function shopAmt(','function shopPrice(','function shopWas(','function shopPay(','function shopMoney('].map(line);
  vm.runInContext(fns.join('\n').replace(/^const /gm,'var '),ctx);
  return ctx;
}

test('the page shows half price, the full price struck through beside it',()=>{
  const G=page(DURING);
  assert.equal(G.shopSaleOn(),true);
  assert.equal(G.shopPrice('orpack'),'€1.50');assert.equal(G.shopPrice('orpack',true),'€2.99');
  assert.equal(G.shopPrice('founder'),'€5.00');assert.equal(G.shopPrice('bfpack'),'€1.00');assert.equal(G.shopPrice('cbpack'),'€1.25');
  assert.equal(G.shopPrice('vip'),'€4.99','the Club is its usual price');
  assert.equal(G.shopAmt('mayapack'),200);
  assert.equal(G.shopWas('orpack'),'<s class="shop-was">€2.99</s> ');
  assert.equal(G.shopWas('vip'),'');
});

test('in the player’s own currency too',()=>{
  const G=page(DURING,{cur:'MXN',p:{orpack:'MX$62.71',vip:'MX$104.66'},a:{orpack:6271,vip:10466}});
  assert.equal(G.shopPay('orpack'),'MX$31.36');
  assert.equal(G.shopPay('vip'),'MX$104.66');
  assert.equal(G.shopWas('orpack',true),'<s class="shop-was">MX$62.71</s> ');
});

test('before and after the sale, the usual prices and nothing struck',()=>{
  for(const t of [BEFORE,END]){
    const G=page(t);
    assert.equal(G.shopSaleOn(),false);assert.equal(G.shopPrice('orpack'),'€2.99');assert.equal(G.shopWas('orpack'),'');
  }
});

test('what a pack is worth stays its full price: the founders’ free pack, the Card Pack in the Founder’s Package',()=>{
  const ctx={Date,Math,Number,Object,Intl,SHOP:{local:null},shopCat:()=>CATALOGUE,shopNow:()=>DURING,esc:s=>String(s)};
  vm.createContext(ctx);
  vm.runInContext(['function shopSaleOff(','const shopCut=','function shopPrice(','function shopPayFull('].map(line).join('\n').replace(/^const /gm,'var '),ctx);
  assert.equal(ctx.shopPayFull('cbpack'),'€2.49');
  ctx.SHOP.local={cur:'MXN',p:{cbpack:'MX$52.25'},a:{cbpack:5225}};assert.equal(ctx.shopPayFull('cbpack'),'MX$52.25');
  assert.match(game,/pieces · worth \$\{esc\(shopPayFull\(p\)\)\}/);
  assert.match(game,/Worth '\+shopPrice\('idpack',true\)\+' on its own\./);
});

test('the basket, the banner and the headline prices use it',()=>{
  assert.match(game,/eur=shopMoney\(cur,ps\.reduce\(\(a,p\)=>a\+shopAmt\(p\),0\)\)/);
  assert.match(game,/ps\.reduce\(\(a,p\)=>a\+shopCut\(p,L\.a\[p\]\),0\)/);
  assert.match(game,/if\(shopSaleOn\(\)\)\{const sl=shopCat\(\)\.sale/);
  assert.equal((game.match(/\$\{shopWas\('\w+'\)\}\$\{esc\(shopPrice\('\w+'\)\)\}/g)||[]).length,12,'every pack’s headline price');
});
