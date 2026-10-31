// A hundred edicts for the newer systems and the environment: the game's section evaluated on its own, with the
// conditions it calls stubbed so that each system can be switched on and off. Run with: node --test test/edicts-systems.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── a hundred edicts for the newer systems and the environment',END='/* ───────── Letters from Willow Street';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL','T:eccentric']);
const CABINET=/\{(FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/;
const OLDER=1912;

/* the section in a context of its own; on holds the systems that are working, as keys like 'b:power' or 'geo:coast' */
function load(){
  const on=new Set(),ctx={on,ssn:'',POLICIES:{},RES_POL:{},ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],
    BUILDINGS:{factory:{n:'Factory',up:{oil:1}},power:{n:'Power Station',up:{oil:1,iron:1}},lunar:{h:96},elevator:{h:72},orbital:{h:72},spaceport:{h:24},market:{h:3}},
    nbCity:(a,ct,x)=>{a.base=(a.base||0)+1;},bldTop:()=>'<p>top</p>',bHours:(n,k)=>ctx.BUILDINGS[k].h,esc:s=>String(s),
    nbPol:(n,k)=>!!(n&&n.policies&&n.policies[k]),nbWorks:(n,k)=>on.has('b:'+k),
    pgAvailable:(n,k)=>on.has('pg:'+k),trades:()=>on.has('trades'),cityCount:()=>on.has('cities')?2:0,whHasOwn:()=>on.has('warehouse'),
    inSpace:(n,b)=>on.has('space:'+b),asmMember:()=>on.has('asm'),delegate:()=>on.has('delegate'),gamesHosting:()=>on.has('games'),
    explored:()=>on.has('explored')?1:0,season:()=>ctx.ssn,onRiver:()=>on.has('river'),geo:(n,t)=>on.has('geo:'+t),provinces:()=>on.has('provinces')?3:0,
    cabTrait:(n,t)=>on.has('trait:'+t),leader:(n,g)=>on.has('leader:'+g),mig:(n,t)=>on.has('mig:'+t)};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a);
  assert(a>0&&b>a,'the section is where the tests expect it');
  vm.runInContext(source.slice(a,b)+'\nthis.EV_ISSUES=EV_ISSUES;this.EV_BOOST=EV_BOOST;this.EV_RES=EV_RES;this.evCity=evCity;',ctx);
  return ctx;
}
const agg=()=>({add:{food:0,timber:0,iron:0,oil:0,goods:0},up:{food:0,timber:0,iron:0,oil:0,goods:0},prosper:0});
const holder=(policies={})=>({id:'me',n:{policies}});
const near=(x,y)=>Math.abs(x-y)<1e-9;
/* what an edict's condition asks for, as keys of on (plus a law the nation must hold, and the season) */
function needs(is){
  const r=String(is.req),k=[],add=(re,f)=>{for(const m of r.matchAll(re))k.push(f(m));};
  add(/pgAvailable\(n,'(\w+)'\)/g,m=>'pg:'+m[1]);add(/nbWorks\(n,'(\w+)'\)/g,m=>'b:'+m[1]);add(/inSpace\(n,'(\w+)'\)/g,m=>'space:'+m[1]);
  add(/geo\(n,'(\w+)'\)/g,m=>'geo:'+m[1]);add(/cabTrait\(n,'(\w+)'\)/g,m=>'trait:'+m[1]);add(/leader\(n,'(\w+)'\)/g,m=>'leader:'+m[1]);add(/mig\(n,'(\w+)'\)/g,m=>'mig:'+m[1]);
  for(const [re,key] of [[/trades\(n\)/,'trades'],[/cityCount\(n\)>=2/,'cities'],[/whHasOwn\(n\)/,'warehouse'],[/asmMember\(n\)/,'asm'],[/delegate\(n\)/,'delegate'],
    [/gamesHosting\(n\)/,'games'],[/explored\(n\)>=1/,'explored'],[/onRiver\(n\)/,'river'],[/provinces\(n\)>=2/,'provinces']])if(re.test(r))k.push(key);
  const law=(r.match(/policies\.(\w+)/)||[])[1],season=(r.match(/season\(n\)==='(\w+)'/)||[])[1];
  return {keys:k,law,season};
}

test('a hundred edicts, numbered after every older one, with ids and titles of their own',()=>{
  const c=load(),is=c.EV_ISSUES;
  assert.equal(is.length,100);
  assert.deepEqual([...is.map(x=>x.no)],Array.from({length:100},(_,i)=>OLDER+1+i),'they take the next numbers');
  assert(source.indexOf('const NB_ISSUES=[')<source.indexOf(START),'the later buildings’ edicts keep their numbers');
  assert.equal(new Set(is.map(x=>x.id)).size,100);assert.equal(new Set(is.map(x=>x.t)).size,100);
  for(const x of is){
    assert.equal(c.ISSUE_BY_ID[x.id],x);
    assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id+' is a new id');
    assert.equal(source.split(`t:'${x.t}'`).length,2,x.t+' is a new title');
    assert.equal(c.ISSUES_RANDOM.includes(x),!x.fo,x.id+(x.fo?' arrives only through its chain':' is drawn at random'));
    assert.equal(x.nbx,false,x.id+' needs no neighbour');
  }
  assert.deepEqual([...is.filter(x=>x.fo).map(x=>x.id)].sort(),['eco-spill-2','orb-mars-lichen-2','wea-river-lawyer-2']);
});

test('the follow-ups arrive only through their chains, a few hours later',()=>{
  const c=load(),is=c.EV_ISSUES,targets=new Set();
  for(const x of is)for(const o of x.o)if(o.nx){
    const f=c.ISSUE_BY_ID[o.nx];assert(f&&f.fo&&is.includes(f),x.id+' leads to one of these follow-ups');
    assert(o.nxh>=4&&o.nxh<=12);targets.add(o.nx);
    assert.equal(x.w,x.req&&/geo\(/.test(String(x.req))?3:2.5,x.id+' comes up as often as other chain openers');
  }
  assert.deepEqual([...targets].sort(),[...is.filter(x=>x.fo).map(x=>x.id)].sort(),'every follow-up has an opener');
});

test('each edict waits for its system, and arrives once it works',()=>{
  const c=load();let gated=0;
  for(const x of c.EV_ISSUES){
    if(!x.req)continue;gated++;
    const {keys,law,season}=needs(x),n={policies:{}};
    assert(keys.length||law||season,x.id+' asks for something the test knows');
    c.on.clear();c.ssn='';assert.equal(!!x.req(n),false,x.id+' waits while nothing works');
    for(const k of keys)c.on.add(k);c.ssn=season||'';if(law)n.policies[law]=true;
    assert.equal(!!x.req(n),true,x.id+' arrives once '+[...keys,law,season].filter(Boolean).join(' and ')+' works');
    for(const k of keys){c.on.delete(k);assert.equal(!!x.req(n),false,x.id+' needs '+k);c.on.add(k);}
    if(season){c.ssn=season==='winter'?'summer':'winter';assert.equal(!!x.req(n),false,x.id+' needs '+season);}
  }
  assert(gated>=75,'most of them belong to a system: '+gated);
  const sys=k=>c.EV_ISSUES.filter(x=>x.req&&needs(x).keys.some(q=>q===k||q.startsWith(k+':'))).length;
  assert(sys('pg')>=8&&sys('trades')>=6&&sys('cities')>=5&&sys('warehouse')>=4&&sys('b')>=18&&sys('space')>=6&&sys('asm')>=3,'every newer system has its share');
});

test('the edicts use only real scales, budget lines, laws and placeholders, in the house style',()=>{
  const c=load();let opts=0,cab=0;
  for(const is of c.EV_ISSUES){
    assert.equal(is.o.length,3,is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    assert(['econ','society','rights','gov','welfare','nature','tech','culture','world','weird'].includes(is.c),is.id+' has a topic');
    for(const txt of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z:]+)\}/g))assert(PLACEHOLDERS.has(m[1]),is.id+' uses {'+m[1]+'}');
      assert(!/['"]/.test(txt),is.id+' uses typographic quotes and apostrophes');
      assert(!/Meridian|Lucanto|Brennoch|Ilsund|Iron Compact/.test(txt),is.id+' names no Meridian nation');
    }
    if(/\{T:eccentric\}/.test(is.q))assert(/cabTrait\(n,'eccentric'\)/.test(String(is.req)),is.id+' names a minister it has');
    for(const o of is.o){
      opts++;if(CABINET.test(o.t))cab++;
      assert(/^“/.test(o.t),is.id+' options open with a quotation');
      assert(/^[a-z0-9{]|^Thornwick|^Puffin/.test(o.fx),is.id+' outcomes continue a sentence: '+o.fx);
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv>0&&bv<=2,is.id+' budget '+bk);continue;}
        if(k==='p'){for(const pk of Object.keys(v))assert(c.POLICIES[pk]||new RegExp('\\b'+pk+":\\['").test(source),is.id+' law '+pk);continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
  }
  assert(cab/opts>=0.12&&cab/opts<=0.22,'about one option in six is a minister’s: '+cab+' of '+opts);
});

test('eleven new laws, each granted by exactly one option and shown as a law',()=>{
  const c=load(),granted=new Map();
  for(const is of c.EV_ISSUES)for(const o of is.o)for(const [pk,pv] of Object.entries((o.e&&o.e.p)||{}))if(pv)granted.set(pk,(granted.get(pk)||0)+1);
  const mine=[...Object.keys(c.EV_RES),...Object.keys(c.EV_BOOST),'reusableRockets'];
  assert.equal(mine.length,11);
  for(const k of mine){
    assert.equal(granted.get(k),1,k+' comes from one option');
    assert(Array.isArray(c.POLICIES[k])&&c.POLICIES[k][0]&&c.POLICIES[k][1],k+' has a name and a description');
    assert(!new RegExp('\\b'+k+":\\['").test(source.slice(0,source.indexOf(START))),k+' is a new law');
  }
  for(const [k,[,d,m]] of Object.entries(c.EV_RES)){
    assert.equal(JSON.stringify(c.RES_POL[k]),JSON.stringify(m),k+' changes what the land yields');
    for(const [r,x] of Object.entries(m))assert(new RegExp(r+' output (is )?'+Math.round(Math.abs(x-1)*100)+'% '+(x>1?'higher':'lower'),'i').test(d),k+' says what it does to '+r);
  }
});

test('the building laws change only their own building, and only for a player',()=>{
  const c=load(),all=holder({districtHeating:true,kelpLines:true,nightFlightBan:true,railFreight:true});
  let a=agg();c.nbCity(a,{done:['power','harbour','airport','rail','market']},all,()=>0);
  assert.equal(a.base,1,'the later buildings still run first');
  assert.deepEqual([a.add.food,a.add.goods],[2,0],'heat and kelp add food; the night ban and the railway cancel out');
  a=agg();c.nbCity(a,{done:['rail']},all,()=>0);assert.equal(a.add.goods,1,'freight by rail adds a good a day');
  a=agg();c.nbCity(a,{done:['airport']},all,()=>0);assert.equal(a.add.goods,-1,'the night flight ban takes one away');
  a=agg();c.nbCity(a,{done:['market','farm']},all,()=>0);assert.deepEqual([a.add.food,a.add.goods],[0,0],'no building, no change');
  a=agg();c.nbCity(a,{done:['power','harbour']},{id:'npc',npc:true,n:{policies:{districtHeating:true,kelpLines:true}}},()=>0);
  assert.equal(a.add.food,0,'a computer-run holder has no laws here');
  a=agg();c.nbCity(a,{done:['power']},holder(),()=>0);assert.equal(a.add.food,0,'without the law nothing changes');
});

test('rapeseed boilers halve what each Factory still burns, after a Recycling Works has taken its share',()=>{
  const c=load(),p=holder({rapeseedBoilers:true});
  let a=agg();c.nbCity(a,{done:['factory']},p,()=>0);assert(near(a.up.oil,-0.5)&&near(a.up.food,0.5));
  a=agg();c.nbCity(a,{done:['factory','recycle']},p,()=>0);assert(near(a.up.oil,-0.25),'half of the half left by the Works');
  a=agg();c.nbCity(a,{done:['factory','recycle']},holder({rapeseedBoilers:true,recycleSort:true}),()=>0);assert(near(a.up.oil,-0.2),'half of the 40% left with kerbside sorting');
  a=agg();c.nbCity(a,{done:['power','recycle']},p,()=>0);assert.deepEqual([a.up.oil,a.up.food],[0,0],'Power Stations are not Factories');
});

test('reusable rockets speed up the Orbital Elevator, Orbital Habitats and Lunar Colony while a Space Port works',()=>{
  const c=load(),n={policies:{reusableRockets:true}};
  assert.equal(c.bHours(n,'lunar'),96,'not without a Space Port');
  c.on.add('b:spaceport');
  assert.deepEqual([c.bHours(n,'lunar'),c.bHours(n,'elevator'),c.bHours(n,'orbital')],[91.2,68.4,68.4]);
  assert.deepEqual([c.bHours(n,'spaceport'),c.bHours(n,'market')],[24,3],'nothing else');
  assert.equal(c.bHours({policies:{}},'lunar'),96,'not without the law');
});

test('a building’s card names the law that changes it',()=>{
  const c=load();
  assert.equal(c.bldTop('power',{policies:{}}),'<p>top</p>');
  assert.match(c.bldTop('power',{policies:{districtHeating:true}}),/Boosted by <b>District Heating<\/b>: food \+1 a day from greenhouses\./);
  assert.match(c.bldTop('airport',{policies:{nightFlightBan:true}}),/Limited by <b>Night Flight Ban<\/b>/);
  assert.match(c.bldTop('factory',{policies:{rapeseedBoilers:true}}),/Changed by <b>Rapeseed Boilers<\/b>/);
  assert.equal(c.bldTop('harbour',{policies:{districtHeating:true}}),'<p>top</p>');
});
