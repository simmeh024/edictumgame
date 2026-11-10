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
function load({stock={food:120,timber:30,iron:4,oil:400,goods:9.7},rates={food:3.25,timber:0,iron:1,oil:2,goods:0.5},cap=400,rate}={}){
  const ctx={RES,RES_INFO:{food:['Food'],timber:['Timber'],iron:['Iron'],oil:['Oil'],goods:['Goods']},
    cellOf:l=>l==null?-1:l,STK_ICON:Object.fromEntries(RES.map(r=>[r,'<svg/>'])),stockNow:()=>({...stock}),stockRates:()=>({...rates}),stockCap:()=>cap,
    fmtStock:v=>String(Math.floor(v+1e-6)),fmtAmt:x=>{const v=Math.round(x*10)/10;return Number.isInteger(v)?String(v):v.toFixed(1);},
    esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};
  if(rate!==undefined)ctx.CZ={disp:{rate}};
  vm.createContext(ctx);
  vm.runInContext(cut('function stkRate(','\nfunction c3Strip(').replace(/const /g,'var ')+'\n'+fnBody('c3Strip')+'\n}',ctx);
  return ctx;
}
const items=h=>[...h.matchAll(/<button type="button" class="stk-i stk-\w+( stk-short)?(?: stk-full)?" data-act="res-bd" data-r="\w+"[^>]*><span class="stk-ic" aria-hidden="true"><svg\/><\/span><span class="stk-tx"><span class="stk-l">(\w+)<\/span><b data-live="stk3" data-r="(\w+)">(\d+)<\/b><span class="stk-rt(?: up)?">(.*?)<\/span><\/span><span class="stk-fill"[^>]*><i [^>]*><\/i><\/span><\/button>(?=<button|<\/div>)/g)]
  .map(m=>({short:!!m[1],label:m[2],r:m[3],v:m[4],rt:m[5].replace(/<[^>]+>/g,'')}));
const N={loc:12};

test('the strip shows all five resources: what is held, and how it grows or that it is full',()=>{
  const h=load().c3Strip(N,1);
  assert.match(h,/^<div class="stk-strip" role="group" aria-label="Stockpile"><div class="stk-top"><span class="stk-strip-h">Stockpile<\/span>/);
  assert.deepEqual(items(h).map(x=>[x.label,x.v,x.rt,x.short]),[
    ['Food','120','+3.3/day+0.14/h',false],['Timber','30','Not growing+0',false],['Iron','4','+1/day+0.042/h',false],['Oil','400','Full',false],['Goods','9','+0.5/day+0.021/h',false]]);
  assert.match(h,/data-act="go" data-v="cities">Open Cities<\/button><\/div><div class="stk-row">/,'the full strip links to Cities');
});

test('a page’s cost marks only the resources the player is short of, with what it needs',()=>{
  const h=load().c3Strip(N,1,{need:{food:30,timber:30,goods:20}});
  const it=items(h);
  assert.deepEqual(it.filter(x=>x.short).map(x=>[x.r,x.rt]),[['goods','Need 20']],'9.7 goods is short of 20; 30 timber is exactly enough');
  assert.equal(it.find(x=>x.r==='timber').rt,'Not growing+0');
  assert.equal(it.find(x=>x.r==='food').rt,'+3.3/day+0.14/h');
  assert.equal(items(load().c3Strip(N,1,{need:null})).filter(x=>x.short).length,0,'no cost, nothing marked');
});

test('the compact strip for side panels has five columns and no Cities link; a heading can be given',()=>{
  const h=load().c3Strip(N,1,{compact:true,h:'Your stockpile'});
  assert.match(h,/^<div class="stk-strip stk-c" role="group" aria-label="Your stockpile"><div class="stk-top"><span class="stk-strip-h">Your stockpile<\/span><\/div>/);
  assert.match(h,/<span class="stk-nl">Not growing<\/span><span class="stk-ns">\+0<\/span>/,'"Not growing", or "+0" where columns are narrow (CSS picks)');
  assert(!h.includes('Open Cities'));
});

test('each resource shows its gain an hour, a day or both, as Settings › Display asks',()=>{
  const rt=(rate,r='food')=>items(load({rate}).c3Strip(N,1)).find(x=>x.r===r).rt;
  assert.equal(rt('h'),'+0.14/h');assert.equal(rt('d'),'+3.3/day');assert.equal(rt('b'),'+3.3/day+0.14/h');
  assert.equal(rt(undefined),'+3.3/day+0.14/h','both, until the player chooses');assert.equal(rt('x'),'+3.3/day+0.14/h');
  assert.equal(rt('h','timber'),'Not growing+0');assert.equal(rt('h','oil'),'Full');
  assert.match(load({rate:'b'}).c3Strip(N,1),/>\+3\.3<span class="stk-ad">\/day<\/span><span class="stk-rh">\+0\.14<span class="stk-ah">\/h<\/span><\/span><\/span>/,
    'the hour on a line of its own; "/day" may go where columns are narrow, "/h" stays');
  const G=load({rate:'b'});
  assert.deepEqual([1588.5,24,23.9,2,0.5,0.06].map(G.stkHr),['66.2','1','1','0.083','0.021','0.0025'],'an hour is a day’s gain over 24, to two figures below one');
  const cx=h=>h.split('<span class="cx-g">').slice(1).map(x=>x.replace(/<span class="cx-us">[^<]*/,'').replace(/<[^>]+>/g,''));
  assert.deepEqual(cx(G.stkGain(1588.5)),['+1588.5 a day','+66.2 an hour'],'on Cities, each figure kept whole, wrapping onto two lines when narrow');
  assert.deepEqual(cx(load({rate:'h'}).stkGain(1588.5)),['+66.2 an hour']);
  assert.deepEqual(cx(load({rate:'d'}).stkGain(1588.5)),['+1588.5 a day']);
  assert.equal(G.stkGain(48),'<span class="cx-g">+48<span class="cx-ul"> a day</span><span class="cx-us">/day</span></span><span class="cx-g">+2<span class="cx-ul"> an hour</span><span class="cx-us">/h</span></span>','short units for phones, which CSS picks');
  assert(/rt\[r\]>0\.05\?stkGain\(rt\[r\]\):'Not growing'/.test(fnBody('cxStock')),'the Cities stockpile shows it the same way');
  assert(/stkRate\(\)==='h'\?`<b>\$\{stkHr\(P\.tot\)\}<\/b> an hour`/.test(fnBody('rbdHTML')),'so does the breakdown a resource opens');
});

test('the choice is kept on this device, in Settings › Display',()=>{
  const ctx={localStorage:{v:null,getItem(){return this.v;},setItem(k,v){this.v=v;}},czU:()=>null,UNLOCKS:{}};vm.createContext(ctx);
  vm.runInContext(fnBody('czLoadDisp')+'\n}\n'+fnBody('czDisp')+'\n}\nvar CZ={disp:czLoadDisp()};function czSaveDisp(){localStorage.setItem("k",JSON.stringify(CZ.disp));}function czApplyDisplay(){}function render(){}',ctx);
  assert.equal(ctx.CZ.disp.rate,'b','both by default');
  for(const [v,want] of [['h','h'],['d','d'],['b','b'],['nonsense','b']]){ctx.czDisp('rate',v);assert.equal(ctx.CZ.disp.rate,want);assert.equal(JSON.parse(ctx.localStorage.v).rate,want);}
  ctx.localStorage.v=JSON.stringify({rate:'h'});assert.equal(ctx.czLoadDisp().rate,'h');
  ctx.localStorage.v=JSON.stringify({rate:7});assert.equal(ctx.czLoadDisp().rate,'b');
  const sg=fnBody('settingsView');
  assert(sg.includes(`<section class="sg-card" id="set-rates"><h3 class="sg-ch">Stockpile</h3>`),'a Stockpile card in Settings');
  assert(sg.includes(`czSeg('Resource gains','set-l-rt',[['h','Per hour'],['d','Per day'],['b','Both']],stkRate(),'cz-disp','rate')`),'per hour, per day or both');
  const t={};vm.createContext(t);vm.runInContext(fnBody('sgTabOfId')+'\n}',t);
  assert.equal(t.sgTabOfId('#set-rates'),'display');assert.equal(t.sgTabOfId('set-l-rt-h'),'display');
  assert(/\{v:'focus:rates',l:'Resource gains per hour or per day',g:'Settings'[^}]*target:'#set-rates'\}/.test(source),'the settings search finds it');
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
