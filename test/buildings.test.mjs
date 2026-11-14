// The seven later buildings (Central Bank, Courthouse, Public Baths, Recycling Works, Nature Reserve,
// Observatory, Hanging Gardens) and their twenty edicts: the game's section evaluated on its own, and the
// currency job's half of the Central Bank. Run with: node --test test/buildings.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../jobs/fx/engine.mjs';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── seven more buildings',END='/* ───────── Development news';
const KEYS=['cbank','court','baths','recycle','reserve','observ','gardens'];
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']);

/* the section in a context of its own; agg is what bldAggOf returns for any nation */
function load(){
  const ctx={agg:null,MILESTONES:[6,7,8.5,10,12.5,15,25].map(p=>({p})),POLICIES:{},DC_GLYPH:{},DC_GEO:{},ISSUES:new Array(1892).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],
    BUILDINGS:{factory:{n:'Factory',up:{oil:1}},power:{n:'Power Station',up:{oil:1,iron:1}},lunar:{n:'Lunar Colony',h:96},spaceport:{n:'Space Port',h:24},market:{n:'Market Hall',h:3},diplo:{n:'Diplomata',one:1,mig:0.03}},
    bldEffectsX:()=>[],bHours:(n,k)=>ctx.BUILDINGS[k].h,bldTop:()=>'<p>top</p>',cuCounterfeit:(id,n)=>n.hit?{until:1,risk:n.policies.counterIntel?0.02:0.04,penalty:n.policies.counterIntel?4:8}:null,
    fmtAmt:v=>String(Math.round(v*10)/10),esc:s=>String(s),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),dcRoof(){},dcTree(){},dcArc:()=>[]};
  ctx.bldAggOf=()=>ctx.agg;
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a);
  assert(a>0&&b>a,'the section is where the tests expect it');
  /* the city upgrades' table (CX_UG, CX_UG_MAX, CX_LV), which the upgrades of the Bank and the Observatory read */
  const u=source.indexOf('/* the five upgrade blocks'),v=source.indexOf('const CX_WALL=',u);
  assert(u>0&&v>u,'the upgrade blocks are where the tests expect them');
  vm.runInContext(source.slice(u,v)+source.slice(a,b)+'\nthis.NB_BOOST=NB_BOOST;this.NB_ISSUES=NB_ISSUES;this.NB_SPACE=NB_SPACE;this.CX_LV=CX_LV;this.nbBankLeft=nbBankLeft;',ctx);
  return ctx;
}
const works=(c,...keys)=>{c.agg={has:new Set(keys)};};
const agg=()=>({add:{food:0,timber:0,iron:0,oil:0,goods:0},up:{food:0,timber:0,iron:0,oil:0,goods:0},prosper:0});
const holder=(policies={})=>({id:'me',n:{policies}});

test('the seven buildings are defined, drawn and unlocked at a population milestone',()=>{
  const c=load();
  for(const k of KEYS){
    const B=c.BUILDINGS[k];assert(B,k);
    assert(B.n&&B.d&&B.q&&B.h>0,k+' has a name, a description, a line of colour and a build time');
    assert(Object.keys(B.cost).every(r=>['food','timber','iron','oil','goods'].includes(r)),k+' costs only resources');
    assert(c.DC_GLYPH[B.icon]&&typeof c.DC_GLYPH[B.icon].f==='function',k+' has a drawing');
    assert(c.MILESTONES.some(m=>(m.b||[]).includes(k)),k+' unlocks at a milestone');
    for(const s of Object.keys(B.once||{}))assert(STAT_KEYS.includes(s),k+' changes only census scales');
  }
  assert.equal(c.BUILDINGS.gardens.w,1,'the Hanging Gardens are a wonder');
  assert.equal(c.BUILDINGS.cbank.one,1,'a nation has one Central Bank');
  assert.equal(c.BUILDINGS.observ.need,'hills','the Observatory needs hills');
  assert.equal(c.DC_GEO.observ,'hill');
});

test('the Recycling Works halves the oil of the Factory and Power Station in its city, 60% with Kerbside Sorting',()=>{
  const c=load(),ct={done:['factory','power','recycle']};
  let a=agg();a.up.oil=2;c.nbCity(a,ct,holder(),()=>0);
  assert.equal(a.up.oil,1);assert.equal(a.nbOil,1);
  a=agg();a.up.oil=2;c.nbCity(a,ct,holder({recycleSort:true}),()=>0);
  assert(Math.abs(a.up.oil-0.8)<1e-9);
  a=agg();a.up.oil=1;c.nbCity(a,{done:['factory']},holder({recycleSort:true}),()=>0);
  assert.equal(a.up.oil,1,'without the Works nothing changes');
});

test('the Nature Reserve leaves a quarter of its city’s timber standing, 15% with Selective Logging Permits',()=>{
  const c=load(),ct={done:['reserve']},yieldOf=r=>r==='timber'?8:0;
  let a=agg();c.nbCity(a,ct,holder(),yieldOf);assert.equal(a.add.timber,-2);assert.equal(a.nbWood,2);
  a=agg();c.nbCity(a,ct,holder({reserveLogging:true}),yieldOf);assert(Math.abs(a.add.timber+1.2)<1e-9);
});

test('edict boosts work only with their building, and only for a player holder',()=>{
  const c=load(),all=holder({courtFees:true,bathsSpring:true,gardensAqueduct:true,bankReserve:true});
  let a=agg();c.nbCity(a,{done:['court','baths','gardens','cbank']},all,()=>0);
  assert.equal(a.up.goods,-0.5,'Court Fees take away the Courthouse’s goods');
  assert.equal(a.up.timber,-0.5,'the hot spring halves the Baths’ timber');
  assert.equal(a.add.food,1,'the aqueduct adds a food a day');
  assert(Math.abs(a.prosper-0.01)<1e-9,'the gold reserve adds 1% to the economy');
  c.nbCity(a,{done:['cbank']},all,()=>0);assert(Math.abs(a.prosper-0.01)<1e-9,'and only once');
  a=agg();c.nbCity(a,{done:['market']},all,()=>0);
  assert.deepEqual([a.up.goods,a.up.timber,a.add.food,a.prosper],[0,0,0,0],'no building, no boost');
  a=agg();c.nbCity(a,{done:['court','gardens']},{id:'npc',npc:true,n:{policies:{courtFees:true}}},()=>0);
  assert.deepEqual([a.up.goods,a.add.food],[0,0],'a computer-run holder has no policies here');
});

test('an Observatory speeds up space projects by 10%, 15% under the Dark-Sky Law',()=>{
  const c=load(),n={policies:{}};
  works(c);assert.equal(c.bHours(n,'lunar'),96);
  works(c,'observ');assert.equal(c.bHours(n,'lunar'),86.4);assert.equal(c.bHours(n,'spaceport'),21.6);assert.equal(c.bHours(n,'market'),3);
  n.policies.obsDarkSky=true;assert.equal(c.bHours(n,'lunar'),81.6);
});

test('a Central Bank halves a forgery’s premium and penalty, holograms take a further quarter',()=>{
  const c=load(),n={hit:true,policies:{}};
  works(c);assert.deepEqual([c.cuCounterfeit('me',n,0).risk,c.cuCounterfeit('me',n,0).penalty,c.cuCfPct(n)],[0.04,8,4]);
  works(c,'cbank');assert.deepEqual([c.cuCounterfeit('me',n,0).risk,c.cuCounterfeit('me',n,0).penalty,c.cuCfPct(n)],[0.02,4,2]);
  n.policies.bankHolograms=true;assert.deepEqual([c.cuCounterfeit('me',n,0).risk,c.cuCounterfeit('me',n,0).penalty,c.cuCfPct(n)],[0.015,3,1.5]);
  n.policies.counterIntel=true;assert.equal(c.cuCfPct(n),0.8);
  assert.equal(c.cuCounterfeit('me',{policies:{}},0),null,'no forgery, nothing to halve');
  assert.match(c.nbCfNote(n),/Central Bank halves them, and holographic banknotes/);
});

/* the Intelligence Bureau's last blocks ask for a Central Bank, Observatory or Diplomata upgraded, so they take the
   five city upgrades (ugx), each doing its own thing */
test('the Central Bank, Observatory and Diplomata take city upgrades, and the best one a nation holds counts',()=>{
  const c=load();
  for(const k of ['cbank','observ'])assert.equal(c.BUILDINGS[k].ugx,1,k);
  assert.match(source,/diplo:\{n:'Diplomata',c:'soc',one:1,ugx:1,/,'the Diplomata too');
  let a=agg();c.nbCity(a,{done:['cbank','observ'],ug:{cbank:2,observ:1}},holder(),()=>0);
  assert.deepEqual({...a.nbUg},{cbank:2,observ:1});
  c.nbCity(a,{done:['observ'],ug:{observ:4}},holder(),()=>0);c.nbCity(a,{done:['observ']},holder(),()=>0);
  assert.equal(a.nbUg.observ,4,'a second Observatory counts only if it is better');
  a=agg();c.nbCity(a,{done:['court']},holder(),()=>0);assert.equal(a.nbUg,undefined,'none held, none recorded');
  /* bldAgg has counted the Diplomata's +3% once; its upgrades add their share of it */
  for(const order of [[2,5],[5,2]]){
    a={...agg(),mig:0.03};for(const u of order)c.nbCity(a,{done:['diplo'],ug:{diplo:u}},holder(),()=>0);
    assert(Math.abs(a.mig-0.06)<1e-9,`gold doubles it to +6% (${order})`);}
  a={...agg(),mig:0.03};c.nbCity(a,{done:['diplo'],ug:{diplo:1}},holder(),()=>0);assert(Math.abs(a.mig-0.033)<1e-9,'grey adds a tenth');
  a={...agg(),mig:0.03};c.nbCity(a,{done:['diplo']},holder(),()=>0);assert.equal(a.mig,0.03,'unupgraded, as before');
});

test('Observatory upgrades speed space projects further: 10% up to 20%, 15% up to 30% under the Dark-Sky Law',()=>{
  const c=load(),n={policies:{}};
  c.agg={has:new Set(['observ']),nbUg:{observ:0}};assert.equal(c.bHours(n,'lunar'),86.4,'none fitted, as before');
  c.agg.nbUg.observ=1;assert.equal(c.bHours(n,'lunar'),85.4);
  c.agg.nbUg.observ=5;assert.equal(c.bHours(n,'lunar'),76.8);assert.equal(c.bHours(n,'market'),3);
  n.policies.obsDarkSky=true;assert.equal(c.bHours(n,'lunar'),67.2);
  assert.equal(c.nbUgLine('observ',2,{}),'space projects build 12.5% faster');
  assert.equal(c.nbUgLine('observ',5,{obsDarkSky:true}),'space projects build 30% faster');
  assert.equal(c.nbUgLine('diplo',1),'immigration +3.3%');assert.equal(c.nbUgLine('diplo',5),'immigration +6%');
  assert.equal(c.nbUgLine('court',3),'','other buildings keep the usual words');
});

test('each Central Bank upgrade lets 5 points less of a forgery through: a quarter at gold, as the currency job reckons',()=>{
  const c=load(),n={hit:true,policies:{}};
  assert.deepEqual([0,1,2,3,4,5].map(g=>c.nbBankLeft(g)),[0.5,0.45,0.4,0.35,0.3,0.25]);
  c.agg={has:new Set(['cbank']),nbUg:{cbank:5}};
  assert.deepEqual([c.cuCounterfeit('me',n,0).risk,c.cuCounterfeit('me',n,0).penalty,c.cuCfPct(n)],[0.01,2,1]);
  assert.match(c.nbCfNote(n),/Central Bank lets only 25% of them through\./);
  n.policies.bankHolograms=true;assert.equal(c.cuCounterfeit('me',n,0).penalty,1.5);
  assert.equal(c.nbUgLine('cbank',5,n.policies),'forged notes do 18.8% of their damage');
  assert.equal(c.nbUgLine('cbank',1,{}),'forged notes do 45% of their damage');
  for(const holo of [false,true])for(let g=0;g<=5;g++){
    c.agg.nbUg.cbank=g;n.policies.bankHolograms=holo;
    assert(Math.abs(c.nbForgeryMult(n)-E.forgeryMult({bank:true,holo,ug:g}))<1e-12,`the game and the job agree at ${g}${holo?' with holograms':''}`);}
});

test('the catalogue names the boosts a building has',()=>{
  const c=load();
  assert.equal(c.bldTop('court',{policies:{}}),'<p>top</p>');
  assert.match(c.bldTop('court',{policies:{courtFees:true}}),/Boosted by <b>Court Fees<\/b>: uses no goods\./);
  assert.equal(c.bldTop('baths',{policies:{courtFees:true}}),'<p>top</p>');
});

test('twenty edicts, numbered after every older one, each needing its building working',()=>{
  const c=load(),is=c.NB_ISSUES;
  assert.equal(is.length,20);
  assert.deepEqual([...is.map(x=>x.no)],Array.from({length:20},(_,i)=>1893+i),'they take the next numbers');
  assert(is.every(x=>c.ISSUE_BY_ID[x.id]===x&&c.ISSUES_RANDOM.includes(x)),'they are drawn at random');
  assert(source.indexOf("ISSUES.push({id:FD_ID")<source.indexOf(START),'the founding edict keeps its number');
  assert.equal(new Set(is.map(x=>x.id)).size,20);assert.equal(new Set(is.map(x=>x.t)).size,20);
  for(const k of KEYS){
    const mine=is.filter(x=>String(x.req).includes(`'${k}'`));
    assert(mine.length>=2,k+' has edicts');
    works(c);assert(mine.every(x=>!x.req({policies:{}})),k+' edicts wait for the building');
    works(c,k);assert(mine.every(x=>x.req({policies:{}})),k+' edicts arrive once it works');
  }
});

test('the edicts use only real scales, budget lines, laws and placeholders, and grant every boost',()=>{
  const c=load(),granted=new Map();
  for(const is of c.NB_ISSUES){
    assert.equal(is.o.length,3,is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    for(const txt of [is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z]+)\}/g))assert(PLACEHOLDERS.has(m[1]),is.id+' uses {'+m[1]+'}');
      assert(!/'/.test(txt),is.id+' uses typographic apostrophes');
    }
    for(const o of is.o){
      assert(/^“/.test(o.t),is.id+' options open with a quotation');
      assert(/^([a-z0-9{]|Sterling )/.test(o.fx),is.id+' outcomes continue a sentence');
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const bk of Object.keys(v))assert(BUDGET_KEYS.includes(bk),is.id+' budget '+bk);continue;}
        if(k==='p'){for(const [pk,pv] of Object.entries(v)){assert(c.NB_BOOST[pk]||new RegExp('\\b'+pk+":\\['").test(source),is.id+' law '+pk);if(pv&&c.NB_BOOST[pk])granted.set(pk,(granted.get(pk)||0)+1);}continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
  }
  assert.deepEqual([...granted.keys()].sort(),Object.keys(c.NB_BOOST).sort(),'every boost comes from an edict');
  assert([...granted.values()].every(v=>v===1));
  for(const [k,b] of Object.entries(c.NB_BOOST)){assert(KEYS.includes(b.k));assert.deepEqual([...c.POLICIES[k]],[b.n,b.d]);}
});

test('the currency job: a Central Bank halves the daily move and the forgery penalty',()=>{
  const DAY=E.DAY,now=Date.UTC(2026,10,10),day=Math.floor(now/DAY);
  const bank={k:'cbank',s:now-3*DAY,d:now-2*DAY},rec=extra=>({s:{},policies:{},budget:{},hist:[],pop:20,popAt:now-DAY,founded:now-100*DAY,cities:[],...extra});
  assert.equal(E.hasCentralBank(rec({cities:[{c:1,b:[bank]}]}),now),true);
  assert.equal(E.hasCentralBank(rec({cities:[{c:1,b:[{...bank,d:now+DAY}]}]}),now),false,'not while it is being built');
  assert.equal(E.hasCentralBank(rec({cities:'x'}),now),false);
  const plain=E.indicators('a',rec(),now,{counterfeit:now+DAY}),banked=E.indicators('a',rec({cities:[{c:1,b:[bank]}]}),now,{counterfeit:now+DAY});
  const holo=E.indicators('a',rec({cities:[{c:1,b:[bank]}],policies:{bankHolograms:true}}),now,{counterfeit:now+DAY});
  assert.deepEqual([plain.counterfeit,banked.counterfeit,holo.counterfeit],[8,4,3]);
  assert.equal(E.indicators('npc',{s:[],pol:[],pop:10,room:1.5},now,{npc:true,npcPop:1,npcEpoch:now-DAY}).bank,false);
  /* the bank's city upgrades, read as the game reads them: ug, or an upgrade under way once its time is up */
  const ups=(...b)=>E.centralBankUps(rec({cities:[{c:1,b}]}),now);
  assert.equal(ups(bank),0);assert.equal(ups({...bank,ug:3}),3);
  assert.equal(ups({...bank,ug:3,uu:{u:4,s:now-DAY,d:now-1}}),4,'a fourth fitted when its time is up');
  assert.equal(ups({...bank,ug:3,uu:{u:4,s:now-DAY,d:now+DAY}}),3,'not before');
  assert.equal(ups({...bank,ug:3,uu:{u:5,s:now-DAY,d:now-1}}),3,'an upgrade may not skip a block');
  assert.equal(ups({...bank,ug:9}),0,'nonsense counts for nothing');
  assert.equal(ups({...bank,ug:5,d:now+DAY},{...bank,ug:2}),2,'the best finished bank');
  const gold=E.indicators('a',rec({cities:[{c:1,b:[{...bank,ug:5}]}]}),now,{counterfeit:now+DAY});
  const goldHolo=E.indicators('a',rec({cities:[{c:1,b:[{...bank,ug:5}]}],policies:{bankHolograms:true}}),now,{counterfeit:now+DAY});
  assert.deepEqual([gold.counterfeit,goldHolo.counterfeit],[2,1.5],'a gold bank lets a quarter through');
  const prev={S:20,P:50,t:2,vv:0,n:10,hv:[1],hp:[50],hd:day-1,w:0,le:{}};
  const S0=E.stepNation('a',prev,plain,day).S,S1=E.stepNation('a',prev,banked,day).S;
  assert(S0>20,'strength rises toward its level');
  assert(Math.abs((S1-20)-(S0-20)/2)<1e-3,'with a Central Bank it moves half as far');
});
