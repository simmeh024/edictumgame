// The stockpile strip: how much of each resource the player has, on every page that spends it, with what the page's
// action needs marked when the player is short. The game's own code, evaluated piece by piece.
// Run with: node --test test/goods-bar.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const fnBody=name=>cut(`function ${name}(`,'\n}\n');

const RES=['food','timber','iron','oil','goods'];
function load({stock={food:120,timber:30,iron:4,oil:400,goods:9.7},rates={food:3.25,timber:0,iron:1,oil:2,goods:0.5},cap=400}={}){
  const ctx={RES,RES_INFO:{food:['Food'],timber:['Timber'],iron:['Iron'],oil:['Oil'],goods:['Goods']},
    cellOf:l=>l==null?-1:l,STK_ICON:Object.fromEntries(RES.map(r=>[r,'<svg/>'])),stockNow:()=>({...stock}),stockRates:()=>({...rates}),stockCap:()=>cap,
    fmtStock:v=>String(Math.floor(v+1e-6)),fmtAmt:x=>{const v=Math.round(x*10)/10;return Number.isInteger(v)?String(v):v.toFixed(1);},
    esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};
  vm.createContext(ctx);
  vm.runInContext(fnBody('c3Strip')+'\n}',ctx);
  return ctx;
}
const items=h=>[...h.matchAll(/<button type="button" class="stk-i stk-\w+( stk-short)?(?: stk-full)?" data-act="res-bd" data-r="\w+"[^>]*><span class="stk-ic" aria-hidden="true"><svg\/><\/span><span class="stk-tx"><span class="stk-l">(\w+)<\/span><b data-live="stk3" data-r="(\w+)">(\d+)<\/b><span class="stk-rt(?: up)?">(.*?)<\/span><\/span><span class="stk-fill"[^>]*><i [^>]*><\/i><\/span><\/button>(?=<button|<\/div>)/g)]
  .map(m=>({short:!!m[1],label:m[2],r:m[3],v:m[4],rt:m[5].replace(/<[^>]+>/g,'')}));
const N={loc:12};

test('the strip shows all five resources: what is held, and how it grows or that it is full',()=>{
  const h=load().c3Strip(N,1);
  assert.match(h,/^<div class="stk-strip" role="group" aria-label="Stockpile"><div class="stk-top"><span class="stk-strip-h">Stockpile<\/span>/);
  assert.deepEqual(items(h).map(x=>[x.label,x.v,x.rt,x.short]),[
    ['Food','120','+3.3/day',false],['Timber','30','Not growing+0',false],['Iron','4','+1/day',false],['Oil','400','Full',false],['Goods','9','+0.5/day',false]]);
  assert.match(h,/data-act="go" data-v="cities">Open Cities<\/button><\/div><div class="stk-row">/,'the full strip links to Cities');
});

test('a page’s cost marks only the resources the player is short of, with what it needs',()=>{
  const h=load().c3Strip(N,1,{need:{food:30,timber:30,goods:20}});
  const it=items(h);
  assert.deepEqual(it.filter(x=>x.short).map(x=>[x.r,x.rt]),[['goods','Need 20']],'9.7 goods is short of 20; 30 timber is exactly enough');
  assert.equal(it.find(x=>x.r==='timber').rt,'Not growing+0');
  assert.equal(it.find(x=>x.r==='food').rt,'+3.3/day');
  assert.equal(items(load().c3Strip(N,1,{need:null})).filter(x=>x.short).length,0,'no cost, nothing marked');
});

test('the compact strip for side panels has five columns and no Cities link; a heading can be given',()=>{
  const h=load().c3Strip(N,1,{compact:true,h:'Your stockpile'});
  assert.match(h,/^<div class="stk-strip stk-c" role="group" aria-label="Your stockpile"><div class="stk-top"><span class="stk-strip-h">Your stockpile<\/span><\/div>/);
  assert.match(h,/<span class="stk-nl">Not growing<\/span><span class="stk-ns">\+0<\/span>/,'"Not growing", or "+0" where columns are narrow (CSS picks)');
  assert(!h.includes('Open Cities'));
});

test('no strip for a nation without land',()=>{
  const G=load();
  assert.equal(G.c3Strip(null,1),'');
  assert.equal(G.c3Strip({loc:null},1),'');
});

test('every page that spends the stockpile draws the strip',()=>{
  for(const f of ['tradeView','gamesView','exploreView','hexPanel','mpTransportHTML','cvView','dspView','muDigs','wndView','alTreasuryHTML'])
    assert(fnBody(f).includes('c3Strip('),`${f} draws the stockpile strip`);
  assert(/c3Strip\(n,now,\{need:!myBid&&canFeature\(n,'host'\)\?BID_COST:null\}\)/.test(fnBody('gamesView')),'Games marks a bid’s cost');
  assert(/c3Strip\(n,Date\.now\(\),\{compact:true,need:prob\?null:CITY_COST\}\)/.test(fnBody('hexPanel')),'the map marks a new city’s cost');
  assert(!/function stockCard\(/.test(source),'the old stock card, drawn nowhere, is gone');
});

test('Space shows the strip under its header on every body, marking what the agency’s next step costs',()=>{
  const wrap=cut('VIEWS_EXT.space=(f=>now=>{const h=f(now),n=S.nation;','\nfunction btTabBtn(');
  const next={t:'Next: The first orbital pass.',cost:{oil:6,goods:8}};
  const run=(html,{body='moon',agency=true,obs=false,nx=next}={})=>{const got=[];
    const ctx={S:{nation:{id:'me',mc:{}},spBody:body},OBS:obs,VIEWS_EXT:{space:()=>html},mcOf:n=>n.mc?{a:agency?{nm:'Agency'}:null}:null,mcNextStep:()=>nx,
      c3Strip:(n,now,o)=>{got.push(o&&o.need);return '<STRIP>';},Date};
    vm.createContext(ctx);vm.runInContext(wrap,ctx);return {h:ctx.VIEWS_EXT.space(1),need:got[0]};};
  const page='<header class="vh"><h1>Space</h1></header><div class="stabs sp-tabs">tabs</div>';
  const r=run(page);
  assert.equal(r.h,'<header class="vh"><h1>Space</h1></header><STRIP><div class="stabs sp-tabs">tabs</div>','the strip, before the Moon opens too: the agency spends from it');
  assert.deepEqual(r.need,{oil:6,goods:8},'the next mission’s cost is marked');
  assert.equal(run(page,{body:'mars'}).need,null,'Mars has no agency card to pay for');
  assert.equal(run(page,{agency:false}).need,null,'no agency yet, nothing marked');
  assert.equal(run(page,{obs:true}).need,null,'not while observing');
  assert.equal(run(page,{nx:{t:'The first image is on its way.',h:''}}).need,null,'a step without a cost marks nothing');
  assert.equal(run('<p>no header</p>').h,'<p>no header</p>');
});

test('the Space page’s next step shows what it costs, and waits for the stockpile when it is short',()=>{
  const step=fnBody('mcNextStep');
  assert(/mcNextCost\(cost,st\)\+mcNextShort\(miss\)/.test(step),'a mission’s cost and shortfall sit beside its Start button');
  assert(/data-act="mc-start" data-k="\$\{k\}"\$\{miss\.length\?' disabled':''\}/.test(step),'Start waits until the stockpile can pay');
  assert(/data-act="mc-fund" data-t="\$\{M\.tm\}"\$\{miss\.length\?' disabled':''\}>Fund/.test(step),'so does funding a team');
  const ctx={RES,resName:r=>r,list:a=>a.join(' and '),esc:s=>String(s)};vm.createContext(ctx);
  vm.runInContext(cut('const mcCostHTML=','\n')+'\n'+cut('const mcNextCost=','\nfunction mcNextStep(').replace(/const /g,'var '),ctx);
  assert.equal(ctx.mcNextCost({oil:6,goods:8},{oil:10,goods:6}),'<span class="mc-next-c"><span class="hint">Costs</span><span class="cost">6 oil</span><span class="cost short">8 goods</span></span>');
  assert.match(ctx.mcNextShort(['2 goods']),/^<p class="hint mc-next-w">You need 2 goods more\. /);
  assert.equal(ctx.mcNextShort([]),'');
});
