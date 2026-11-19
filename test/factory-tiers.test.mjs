// Building tiers (2026-11-16): a Factory with all five upgrades can be retooled to tier II, Industrial Works, in one of
// three lines (Assembly Plant, Steelworks, Clean Works), and then its five upgrade blocks start again, each twice the
// price. Tier II starts at what gold tier I makes, its upkeep is flat however many blocks it has, it counts as gold
// wherever gold counts, and three achievements follow it. The game's own code, evaluated piece by piece.
// Run with: node --test test/factory-tiers.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,NOW=1_800_000_000_000;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),deq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);

/* a small map: cells 0–9 with no land yield, so a Factory makes only its fixed goods */
const N=10,zero=()=>Float64Array.from({length:N},()=>0);
const CELL_RES={food:zero(),timber:zero(),iron:zero(),oil:zero(),goods:zero()};
function load(){
  const ctx={DAY,CELL_RES,RES:['food','timber','iron','oil','goods'],RES_INFO:{food:['Food'],timber:['Timber'],iron:['Iron'],oil:['Oil'],goods:['Goods']},
    BUILDINGS:{factory:{n:'Factory',c:'prod',d:'Goods +6 a day.',cost:{timber:15,iron:6},h:4,res:{goods:[0,6]},up:{oil:1}},farm:{n:'Farm Estates',cost:{timber:10,goods:8},h:2,res:{food:[0.6,2]}}},
    bCost:(n,k)=>({...ctx.BUILDINGS[k].cost}),bHours:(n,k)=>ctx.BUILDINGS[k].h,cxBuildK:()=>1,cabFx:()=>({cost:1,build:1}),
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),c3CleanName:s=>s,CX_TRAITS:{},ldrOf:()=>[],ldrWork:()=>[],esc:s=>String(s),
    list:a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1],
    achM:(x,k,f)=>k in x.m?x.m[k]:(x.m[k]=f()),achYes:v=>v?1:0,achP:(l,ok)=>[l,!!ok],defs:{},cxUpgradable:k=>k==='factory'||k==='farm'};
  ctx.achDef=(c,id,t,n,d,g,f,o)=>{ctx.defs[id]={c,id,t,n,d,g,f,...(o||{})};};
  ctx.achParts=(c,id,t,n,d,p,o)=>{ctx.defs[id]={c,id,t,n,d,p,...(o||{})};};
  vm.createContext(ctx);
  vm.runInContext([
    cut('/* ── building tiers (2026-11-16)','const NEED_TXT='),
    line('const resName='),line('const fmtAmt='),
    cut('/* the five upgrade blocks','const CX_WALL='),
    cut('/* ug: upgrade blocks filled','function cxWallLv('),
    line('function paidClean('),line('function costText('),line('function cxUpList('),line('function cxUpQuote('),
    cut('/* building upgrades: per city','const aGifts='),
    cut("achDef('land','land-cxlv2'","achDef('law','law-1500'"),
    cut('/* ── what a building gives in one city','function bldRow('),
    cut('const tierA=','function tierFocus('),
    cut('/* How to play › Cities and buildings */','\n}\n')+'\n}\n'
  ].join('\n')+'\nthis.BTIER=BTIER;this.CX_LV=CX_LV;this.bEffMemo=bEffMemo;this.aCxLv=aCxLv;',ctx);
  return ctx;
}
const G=load();
const bld=(k,ug,o={})=>Object.assign({k,s:NOW-2*DAY,d:NOW-DAY},ug?{ug}:{},o);
const nation=(o={})=>({id:'me',n:{policies:o.pol||{},gov:[]}});
const city=(o={})=>({id:o.id||'c1',nm:o.nm||'Ashford',active:true,hi:0,dist:[0,1,2],done:o.done||['factory'],prog:[],ug:o.ug||{},tr:o.tr||{},mk:1,mood:60});
const world=cities=>{const T={list:[nation()]};G.territory=()=>T;G.cityState=()=>({all:cities});return T;};

/* since 2026-11-17 30% of an upgrade's timber is asked in iron instead (ugIron): the prices below are the timber-only ones, moved */
const ug=c=>{c={...c};const t=c.timber||0;if(t>=2){const x=Math.round(t*0.3);c.timber=t-x;c.iron=(c.iron||0)+x;}return c;};
test('the Factory has tier II, Industrial Works, in three lines',()=>{
  const T=G.BTIER.factory[2];
  assert.equal(T.n,'Industrial Works');
  deq(Object.keys(T.lines),['asm','steel','clean']);
  deq(T.lines.asm,{n:'Assembly Plant',s:T.lines.asm.s,d:T.lines.asm.d,res:{goods:[0,12]},up:{oil:2}},'12 goods, what a gold Factory makes, for a flat 2 oil');
  deq([T.lines.steel.res.goods,T.lines.steel.up,T.lines.steel.army],[[0,9],{iron:2},0.02],'fewer goods, iron instead of oil, a stronger army');
  assert.equal(T.lines.clean.up,undefined,'a Clean Works burns nothing');
  assert.equal(T.lines.clean.mood,0,'and does not weigh on the city’s mood');
  deq(T.cost,{timber:180,iron:80,oil:40,goods:30});
  assert.equal(T.h,24);assert.equal(T.ug,2);assert.equal(T.uh,1.5);
  assert.equal(G.CX_LV[5]*6,12,'a gold Factory makes 12, where an Assembly Plant starts');
  assert.equal(G.bTierNext('factory',1),2);assert.equal(G.bTierNext('factory',0),2);
  assert.equal(G.bTierNext('factory',2),0,'no tier III yet');assert.equal(G.bTierNext('farm',1),0,'only the Factory so far');
  deq(G.bTierList('factory',2),{timber:180,iron:80,oil:40,goods:30});
});

test('what a building does at its tier: its line laid over it, kept',()=>{
  assert.equal(G.bEff('factory',1,''),G.BUILDINGS.factory,'tier I is the building itself');
  const a=G.bEff('factory',2,'asm');
  deq([a.n,a.res,a.up,a.upFlat,a.tier,a.line,a.base,a.cost],['Assembly Plant',{goods:[0,12]},{oil:2},1,2,'asm','Factory',{timber:15,iron:6}]);
  assert.equal(G.bEff('factory',2,'asm'),a,'kept, as cityState asks for it again and again');
  assert.equal(G.bEff('factory',2,'clean').up,null);
  assert.equal(G.bEff('factory',2,'nonsense').n,'Assembly Plant','an unknown line reads as the first');
  assert.equal(G.bEff('farm',2,'asm'),G.BUILDINGS.farm,'no tier, the building itself');
});

test('the record keeps the tier, the line and a retool under way, and nothing it should not',()=>{
  deq(G.cxBldExtras(bld('factory',2,{tr:2,ln:'steel'})),{ug:2,tr:2,ln:'steel'});
  deq(G.cxBldExtras(bld('factory',0,{tr:1})),{},'tier I is no tier');
  deq(G.cxBldExtras(bld('factory',0,{tr:1.5})),{});
  deq(G.cxBldExtras(bld('factory',0,{tr:2,ln:'Bad Line!'})),{tr:2},'a line that is not a key is dropped');
  const tu={l:2,ln:'clean',s:NOW,d:NOW+DAY,p:{timber:999,iron:80,goods:30}};
  deq(G.cxBldExtras(bld('factory',5,{tu})),{ug:5,tu:{l:2,ln:'clean',s:NOW,d:NOW+DAY,p:{timber:180,iron:80,goods:30}}},'kept, the price capped at the list price');
  deq(G.cxBldExtras(bld('factory',4,{tu})),{ug:4},'only from all five blocks');
  deq(G.cxBldExtras(bld('factory',5,{tr:2,tu})),{ug:5,tr:2},'only to the tier above');
  deq(G.cxBldExtras(bld('factory',5,{tu:{...tu,d:NOW+8*DAY}})),{ug:5},'never longer than a week');
  deq(G.cxBldExtras(bld('factory',5,{tu:{...tu,ln:7}})),{ug:5},'a line is needed');
  const uu={u:3,s:NOW,d:NOW+DAY,p:{timber:99,iron:99}};
  deq(G.cxBldExtras(bld('factory',2,{tr:2,uu})).uu.p,ug({timber:33,iron:13}),'a tier II block’s price is capped at twice a tier I one');
  deq(G.cxBldExtras(bld('factory',2,{uu})).uu.p,ug({timber:17,iron:7}),'tier I as before');
});

test('a finished retool: tier II at once, its blocks back to none, written in by the next save',()=>{
  const b=bld('factory',5,{tu:{l:2,ln:'asm',s:NOW-2*DAY,d:NOW-60e3}});
  assert.equal(G.cxUps(b,NOW),0,'the blocks start again');
  deq(G.cxTier(b,NOW),{t:2,ln:'asm'});
  deq(G.cxTier(b,NOW-2*60e3),{t:1,ln:''},'not before it is done');
  assert.equal(G.cxUps(b,NOW-2*60e3),5);
  deq(G.cxTrMap({b:[b,bld('farm',3)]},NOW),{factory:{t:2,ln:'asm'}});
  assert.equal(G.cxGoldNow(b,NOW),true,'tier II counts as gold');
  assert.equal(G.cxGoldNow(bld('factory',4),NOW),false);
  assert.equal(G.tierSettle(b,NOW),true);
  deq(b,{k:'factory',s:NOW-2*DAY,d:NOW-DAY,tr:2,ln:'asm'});
  assert.equal(G.tierSettle(b,NOW),false,'nothing more to write');
  const busy=bld('factory',5,{tu:{l:2,ln:'asm',s:NOW,d:NOW+DAY}});
  assert.equal(G.tierSettle(busy,NOW),false);assert.equal(busy.ug,5,'the building keeps working at gold meanwhile');
});

test('tier II blocks cost twice a tier I block and take half as long again',()=>{
  const one=[1,2,3,4,5].map(to=>G.cxUpQuote({},{},'factory',to)),two=[1,2,3,4,5].map(to=>G.cxUpQuote({},{},'factory',to,2));
  deq(one.map(q=>q.cost),[{timber:8,iron:3},{timber:11,iron:5},{timber:17,iron:7},{timber:24,iron:10},{timber:33,iron:13}].map(ug),'tier I as before');
  deq(two.map(q=>q.cost),[{timber:15,iron:6},{timber:22,iron:9},{timber:33,iron:13},{timber:47,iron:19},{timber:65,iron:26}].map(ug));
  deq(two.map(q=>q.hours),one.map(q=>Math.round(q.hours*1.5*10)/10));
  deq(G.cxUpList('factory',5,0,2),ug({timber:65,iron:26}));
  deq(G.cxUpQuote({},{},'farm',1,2),G.cxUpQuote({},{},'farm',1),'a building with no tier II prices as tier I');
});

test('what it makes and burns: the line, times its new blocks, upkeep flat',()=>{
  const first=city({id:'a'}),T=world([first]);
  const tier=(ln,ug)=>{const ct=city({id:'b',nm:'Brack',tr:{factory:{t:2,ln}},ug:ug?{factory:ug}:{}});world([first,ct]);return ct;};
  let ct=tier('asm',0);
  assert.equal(G.bldGain(ct,'factory').res[0].v,12,'an Assembly Plant starts at 12 goods');
  assert.match(G.bldGainHtml(ct,'factory',undefined,'Here'),/<b>\+12 goods<\/b> a day; uses 2 oil a day\./);
  ct=tier('asm',5);
  assert.equal(G.bldGain(ct,'factory').res[0].v,24,'and doubles to 24 at gold');
  assert.match(G.bldGainHtml(ct,'factory',undefined,'Here'),/<b>\+24 goods<\/b> a day<span class="bld-gw"> \(\+100% for its upgrades\)<\/span>; uses 2 oil a day\./,'the upkeep stays 2');
  ct=tier('steel',3);
  assert.equal(Math.round(G.bldGain(ct,'factory').res[0].v*100)/100,13.05,'9 × 1.45');
  assert.match(G.bldGainHtml(ct,'factory',undefined,'Here'),/uses 2 iron a day\./);
  ct=tier('clean',0);
  deq(G.bldGain(ct,'factory').up,[],'a Clean Works burns nothing');
  /* the first Factory runs without oil at any tier */
  const own=city({id:'a',tr:{factory:{t:2,ln:'asm'}}});world([own]);
  assert.match(G.bldGainHtml(own,'factory',T,'Here'),/<b>\+12 goods<\/b> a day; uses no oil \(your first Factory runs without it\)\./);
  world([first]);assert.match(G.bldGainHtml(first,'factory',T,'Here'),/<b>\+6 goods<\/b> a day/,'tier I as before');
});

test('the economy, the mood, the fuel laws and the city plots read the tier',()=>{
  const cs=cut('function cityState(T){','function cityDefMult(');
  assert.match(cs,/tr:cxTrMap\(c,now\)/,'each city knows its buildings’ tiers');
  assert.match(cs,/B=tq\?bEff\(key,tq\.t,tq\.ln\):BUILDINGS\[key\]/,'what each building does, at its tier');
  assert.match(cs,/a\.up\[r\]\+=B\.up\[r\]\*\(B\.upFlat\?1:lm\)/,'a tier’s upkeep is flat');
  assert.match(cs,/const free=key==='factory'&&!a\.facFree;if\(key==='factory'\)a\.facFree=1;/,'the first Factory runs free, whatever its line');
  assert.match(source,/let d=B\.mood\?\?CX_MOOD_B\[k\]\?\?/,'a Clean Works has no mood penalty');
  assert.match(source,/fo=f\*\(\(\(tq\?bEff\('factory',tq\.t,tq\.ln\):BUILDINGS\.factory\)\.up\|\|\{\}\)\.oil\|\|0\)/,'rapeseed boilers halve only the oil a Factory burns');
  assert.match(source,/U=tq\?bEff\(k,tq\.t,tq\.ln\)\.up:BUILDINGS\[k\]&&BUILDINGS\[k\]\.up;/,'a Recycling Works saves only the oil burnt');
  assert.match(source,/gold=done\.filter\(k=>ug\[k\]>=5\|\|!!\(ct\.tr&&ct\.tr\[k\]\)\)\.length/,'city block bonuses count tier II as gold');
});

test('achievements count every step, and three follow the tiers',()=>{
  const x=cities=>({n:{cities},now:NOW,m:{}});
  const two=bld('factory',2,{tr:2,ln:'asm'});
  deq(plain(G.aCxUps(x([{b:[two,bld('farm',3)]}]))),[[7,3]],'five for the tier passed, then two');
  assert.equal(G.aCxLv(x([{b:[bld('factory',0,{tr:2,ln:'asm'})]}]),5),1,'a tier II building is a gold one');
  const d=G.defs;
  deq(['bld-tier2','bld-tier5','bld-tier-gold'].map(id=>d[id]&&[d[id].c,d[id].t,d[id].n]),[['bld','s','Second Shift'],['bld','g','Smokestack Skyline'],['bld','p','Gold on Gold']]);
  const f=(id,cities)=>d[id].f(x(cities));
  assert.equal(f('bld-tier2',[{b:[bld('factory',5)]}]),0,'gold is not yet a retool');
  assert.equal(f('bld-tier2',[{b:[bld('factory',5,{tu:{l:2,ln:'asm',s:NOW-DAY,d:NOW-1}})]}]),1,'a finished retool counts before its save');
  assert.equal(f('bld-tier5',[1,2,3].map(()=>({b:[bld('factory',1,{tr:2,ln:'clean'})]}))),3);
  assert.equal(f('bld-tier-gold',[{b:[bld('factory',4,{tr:2,ln:'asm'})]}]),0);
  assert.equal(f('bld-tier-gold',[{b:[bld('factory',5,{tr:2,ln:'asm'})]}]),1);
});

test('the Cities page offers the retool at gold, and What’s next, Help and the income forecast know it',()=>{
  const rows=cut('function cxLvBits(','function cxCatBar(');
  assert.match(rows,/const tb=tierBits\(ct,k,b,e,now\);if\(tb\)return tb;/);
  const bits=cut('function tierBits(','/* What\'s next suggests the first retool');
  assert.match(bits,/Retool to tier \$\{TIER_ROMAN\[to\]\}/);
  assert.match(bits,/data-act="tier-go"/);assert.match(bits,/data-act="tier-stop"/);
  assert.match(cut('function tutComing(','if(!it.length)return'),/tierReady\(n\)/);
  assert.match(source,/<p>\$\{tierHelp\(\)\}<\/p>/);
  const h=G.tierHelp();
  assert.match(h,/A Factory with all five can then be retooled to tier II, Industrial Works, for 180 timber, 80 iron, 40 oil, 30 goods and 24 hours’ work/);
  assert.match(h,/an Assembly Plant \(12 goods a day for a flat 2 oil\)/);assert.match(h,/a Steelworks/);assert.match(h,/a Clean Works/);
  assert.match(h,/each costing twice as much and taking half as long again/);
  assert.match(source,/if\(e\.tu&&e\.tu\.d>now\)out\.push\(\{t:'tier'/,'the income forecast lists a retool under way');
  assert.match(source,/else if\(w\.t==='tier'\)\{o\.tr=w\.l;o\.ln=w\.ln;delete o\.tu;delete o\.ug;delete o\.uu;\}/);
});
