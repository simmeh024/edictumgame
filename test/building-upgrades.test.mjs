// Building upgrades: five coloured blocks per building (grey, green, blue, purple, gold), each a little stronger and
// dearer than the last, the old levels 2 and 3 carried over as four and five blocks, and the achievements about them.
// The game's own code, evaluated piece by piece. Run with: node --test test/building-upgrades.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,NOW=1_800_000_000_000;
/* values from the game's own context, compared as plain data */
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),deq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);

function load(){
  const ctx={DAY,BUILDINGS:{farm:{n:'Farm Estates',res:{food:[0.6,2]}},mine:{n:'Iron Mine',res:{iron:[1,1.5]}},market:{n:'Market Hall',prosper:0.02},
      barracks:{n:'Barracks',army:0.02},clinic:{n:'Clinic',growth:0.05},warehouse:{n:'Warehouse',res:{}},palace:{n:'Palace',lead:1,prosper:0.01},colossus:{n:'Colossus',w:1,prosper:0.03}},
    bCost:()=>({timber:10,goods:8}),bHours:()=>4,cxBuildK:()=>1,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),c3CleanName:s=>s,CX_TRAITS:{},
    achM:(x,k,f)=>k in x.m?x.m[k]:(x.m[k]=f()),achYes:v=>v?1:0,achP:(l,ok)=>[l,!!ok],defs:{}};
  ctx.achDef=(c,id,t,n,d,g,f,o)=>{ctx.defs[id]={c,id,t,n,d,g,f,...(o||{})};};
  ctx.achParts=(c,id,t,n,d,p,o)=>{ctx.defs[id]={c,id,t,n,d,p,...(o||{})};};
  vm.createContext(ctx);
  vm.runInContext([
    cut('/* the five upgrade blocks','const CX_WALL='),
    cut('/* ug: upgrade blocks filled','function cxWallLv('),
    line('function cxUpgradable('),line('function cxUpQuote('),
    cut('/* building upgrades: per city','const aGifts='),
    cut("achDef('land','land-cxlv2'","achDef('law','law-1500'")
  ].join('\n')+'\nthis.CX_UG=CX_UG;this.CX_UG_MAX=CX_UG_MAX;this.CX_LV=CX_LV;',ctx);
  return ctx;
}
const G=load();
const x=cities=>({n:{cities},now:NOW,m:{}});
const bld=(k,ug,o={})=>Object.assign({k,s:NOW-2*DAY,d:NOW-DAY},ug?{ug}:{},o);

test('five blocks, grey to gold, each a little stronger and dearer than the last',()=>{
  deq(G.CX_UG.map(u=>u.c),['grey','green','blue','purple','gold']);
  assert.equal(G.CX_UG[0].r,'common');
  assert.equal(G.CX_UG_MAX,5);
  for(let i=1;i<5;i++){
    const a=G.CX_UG[i-1],b=G.CX_UG[i];
    assert(b.fx>a.fx&&b.cost>a.cost&&b.h>a.h,`${b.c} gives, costs and takes more than ${a.c}`);
  }
  deq([...G.CX_LV],[1,1.1,1.25,1.45,1.7,2],'the multiplier after each block, double at gold');
  assert(G.CX_UG[0].fx<=0.1,'the first block is a small boost');
});

test('a quote scales the building’s cost and time, and rises block by block',()=>{
  const q=[1,2,3,4,5].map(to=>G.cxUpQuote({},{},'farm',to));
  deq(q[0],{cost:{timber:4,goods:4},hours:2});
  deq(q[4],{cost:{timber:18,goods:15},hours:9.6});
  for(let i=1;i<5;i++)assert(q[i].cost.timber>q[i-1].cost.timber&&q[i].hours>q[i-1].hours);
});

test('the old levels 2 and 3 read as four and five blocks, so nobody loses output',()=>{
  deq(G.cxBldExtras({k:'farm',lv:2}),{ug:4});
  deq(G.cxBldExtras({k:'farm',lv:3}),{ug:5});
  assert(G.CX_LV[4]>=1.5&&G.CX_LV[5]>=2,'level 2 was ×1.5, level 3 ×2');
  // a raise still under way when the blocks arrived finishes as the matching block
  const lu2={k:'farm',lu:{l:2,s:NOW-3600e3,d:NOW+3600e3}},lu3={k:'farm',lv:2,lu:{l:3,s:NOW-3600e3,d:NOW+3600e3}};
  deq(G.cxBldExtras(lu2),{uu:{u:4,s:NOW-3600e3,d:NOW+3600e3}});
  deq(G.cxBldExtras(lu3),{ug:4,uu:{u:5,s:NOW-3600e3,d:NOW+3600e3}});
  assert.equal(G.cxUps(lu2,NOW),0);assert.equal(G.cxUps(lu2,NOW+2*3600e3),4);
  // and the record is written back in the new fields
  const b={k:'farm',lv:3,s:1,d:2};G.cxUgPut(b,G.cxBldExtras(b));
  deq(b,{k:'farm',s:1,d:2,ug:5});
});

test('only sound fields survive: one block at a time, five at most, a week at most',()=>{
  const s=NOW-1000,d=NOW+3600e3;
  deq(G.cxBldExtras({ug:2,uu:{u:3,s,d}}),{ug:2,uu:{u:3,s,d}});
  deq(G.cxBldExtras({ug:2,uu:{u:4,s,d}}),{ug:2},'a block may not be skipped');
  deq(G.cxBldExtras({ug:5,uu:{u:6,s,d}}),{ug:5},'no sixth block');
  deq(G.cxBldExtras({ug:6}),{},'six is not a count of blocks');
  deq(G.cxBldExtras({ug:1.5}),{});
  deq(G.cxBldExtras({uu:{u:1,s,d:s+8*DAY}}),{},'a fitting may not take more than a week');
  deq(G.cxBldExtras({ug:3,lv:2}),{ug:3},'the new field wins over an old one');
  deq(G.cxBldExtras(null),{});
});

test('which buildings take blocks: not wonders, leadership buildings or the Warehouse',()=>{
  for(const k of ['farm','mine','market','barracks','clinic'])assert(G.cxUpgradable(k),k);
  for(const k of ['warehouse','palace','colossus','nope'])assert(!G.cxUpgradable(k),k);
});

test('a city’s blocks, finished ones only',()=>{
  const c={b:[bld('farm',3),bld('mine',0),bld('market',1,{uu:{u:2,s:NOW-2000,d:NOW-1000}}),{k:'clinic',s:NOW,d:NOW+DAY,ug:2}]};
  deq(G.cxUpMap(c,NOW),{farm:3,market:2});
});

test('the achievements: one per colour, blocks in total, a rainbow and a gilded city',()=>{
  const D=G.defs;
  for(const id of ['land-cxlv2','land-cxlv3','land-cxlv10','bld-ug2','bld-ug3','bld-ug4','bld-ugb10','bld-ugb50','bld-ugb150','bld-ug-rainbow','bld-ug-city','bld-ug-gold25'])assert(D[id],id);
  assert.equal(new Set(Object.values(D).map(a=>a.n)).size,Object.keys(D).length,'every name is its own');
  const one=x([{b:[bld('farm',1)]}]),val=(id,X)=>D[id].f(X)>=(D[id].g||1);
  assert(val('land-cxlv2',one));assert(!val('bld-ug2',one));
  const four=x([{b:[bld('farm',4)]}]);
  assert(val('bld-ug2',four)&&val('bld-ug3',four)&&val('bld-ug4',four)&&!val('land-cxlv3',four));
  const gold=x([{b:[bld('farm',5)]}]);assert(val('land-cxlv3',gold));
  const rainbow=x([{b:[bld('farm',1),bld('mine',2)]},{b:[bld('market',3),bld('barracks',4),bld('clinic',5)]}]);
  assert.equal(D['bld-ugb10'].f(rainbow),15);
  assert(D['bld-ug-rainbow'].p(rainbow).every(q=>q[1]));
  deq(D['bld-ug-rainbow'].p(x([{b:[bld('farm',1),bld('mine',5)]}])).map(q=>q[1]),[true,false,false,false,true]);
  const city=k=>({b:['farm','mine','market','barracks','clinic'].slice(0,k).map(b=>bld(b,5)).concat([bld('warehouse',0),bld('palace',0)])});
  assert(val('bld-ug-city',x([city(5)])),'five gold buildings, with a warehouse and a palace beside them');
  assert(!val('bld-ug-city',x([city(4)])),'four are not enough');
  assert(!val('bld-ug-city',x([{b:city(5).b.map((b,i)=>i?b:bld('farm',4))}])),'every one must be gold');
  assert.equal(D['bld-ug-gold25'].t,'p');assert.equal(D['bld-ug-gold25'].f(x([city(5),city(5)])),10);
});
