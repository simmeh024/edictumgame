// Fifty edicts for the newest systems: the game's section evaluated on its own, with the systems it reads stubbed so
// that each can be switched on and off. Run with: node --test test/edicts-new-systems.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── fifty edicts for the newest systems',END='/* ───────── the browser tab';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const TOPICS=JSON.parse(source.match(/const ISSUE_TOPICS = (\[.*?\]\]);/)[1].replace(/'/g,'"')).map(([k])=>k);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']);
const CABINET=/\{(FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/;
const OLDER=2206,LAWS=['fixedBenches','diasporaSeats','questionTime','electedMayors','rampartWalks','roadsideInns'];

/* a nation for the stubs: seats, md (mandate), dec (edicts decided), ldr (decided under this leader), stamps, rank,
   and cities whose records carry my, mb, wl (walls), ups (a building's upgrade blocks) and busy (a building being upgraded) */
/* values made in the section's own context have its prototypes: compare them as plain data */
const plain=x=>JSON.parse(JSON.stringify(x));
const nation=(o={})=>Object.assign({policies:{},cities:[],seats:51,md:5,dec:0,ldr:0,stamps:0,rank:0},o);
const city=(o={})=>Object.assign({b:[]},o);
function load(){
  const ctx={
    ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],POLICIES:{},GV_SEAT_MODS:[['upperHouse',0.9,'a senate']],MD_CAP:10,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),pol:n=>(n&&n.policies)||{},
    mdRate:n=>5,mdNow:n=>n.md,mdGain:(n,v)=>{n.md=Math.max(0,Math.min(10,n.md+v));},mdFmt:v=>String(Math.round(v*10)/10),
    cxMood:ct=>({v:ct.base??60,parts:[[5,'Seat of government']]}),geoAfter:()=>[['Land','A hex of new land.']],
    cxCityExtras:c=>c||{},cxWallLv:c=>(c&&c.wl)||0,cxUpMap:c=>(c&&c.ups)||{},cxUpBusy:c=>(c&&c.busy)||null,cxRoadAt:(fn,cell)=>(fn.infra||[]).some(r=>r.a===cell||r.b===cell),
    gvSeatCount:n=>({seats:n.seats}),decisions:n=>n.dec,gvLdr:n=>({e:n.ldr}),cityCount:n=>n.cities.length,ppCount:n=>n.stamps,
    achPoints:n=>n.rank,achRank:p=>({i:p})
  };
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a);
  assert(a>source.indexOf('const CX_EVENTS=[')&&b>a,'the section follows the cities’ own, before the browser tab');
  vm.runInContext(source.slice(a,b)+'\nthis.NS=NS_ISSUES;this.NS_LAW=NS_LAW;this.NS_MOOD=NS_MOOD;',ctx);
  return ctx;
}

test('fifty edicts, numbered after every older one, with ids and titles of their own',()=>{
  const c=load(),is=c.NS;
  assert.equal(is.length,50);
  assert.deepEqual(plain(is.map(x=>x.no)),Array.from({length:50},(_,i)=>OLDER+1+i),'they take the next numbers');
  assert(source.indexOf('const SPT_ISSUES=[')<source.indexOf(START),'the sport edicts keep their numbers');
  assert.equal(new Set(is.map(x=>x.id)).size,50);assert.equal(new Set(is.map(x=>x.t)).size,50);
  for(const x of is){
    assert.equal(c.ISSUE_BY_ID[x.id],x);
    assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id+' is a new id');
    assert.equal(source.split(`t:'${x.t}'`).length,2,x.t+' is a new title');
    assert(c.ISSUES_RANDOM.includes(x)&&!x.fo,x.id+' is drawn at random');
    assert.equal(x.nbx,false,x.id+' needs no neighbour');assert.equal(x.nr,true,x.id+' never goes to a computer-run nation');
    assert.equal(x.w,x.req?2:undefined,x.id+(x.req?' comes up a little more often once its system works':' has the usual weight'));
  }
  assert(/'SPT_ISSUES','NS_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'their text is cached with the other edicts');
});

/* for each edict with a condition: a nation for which it arrives, and the nearest one for which it does not */
const ON={
  'gvp-benches':[{seats:301},{seats:299}],
  'gvp-coalition':[{policies:{proportionalRep:true}},{policies:{proportionalRep:true,sortition:true}}],
  'gvp-senate':[{policies:{upperHouse:true}},{}],
  'gvp-lot':[{policies:{sortition:true}},{policies:{sortition:true,noElections:true}}],
  'gvp-applause':[{policies:{noElections:true}},{policies:{rankedVoting:true}}],
  'gvp-ranked':[{policies:{rankedVoting:true}},{policies:{rankedVoting:true,proportionalRep:true}}],
  'gvp-salamander':[{},{policies:{proportionalRep:true}}],
  'gvp-empty':[{md:1.9},{md:2}],
  'gvp-full':[{md:10,dec:20},{md:10,dec:19},{md:9.9,dec:40}],
  'gvp-question-time':[{seats:101},{seats:99},{seats:501,policies:{noElections:true}}],
  'gvp-briefing':[{brf:{d:1,i:0}},{}],
  'gvp-biography':[{ldr:40},{ldr:39}],
  'cxp-chains':[{cities:[city({my:{tr:'builder'}})]},{cities:[city(),city()]}],
  'cxp-mayor-vote':[{cities:[city({my:{tr:'steward'}})]},{cities:[city()]}],
  'cxp-ribbon':[{cities:[city({my:{}}),city({my:{}})]},{cities:[city({my:{}}),city()]}],
  'cxp-ramparts':[{cities:[city({wl:1})]},{cities:[city()]}],
  'cxp-gate':[{cities:[city({wl:1}),city({wl:2})]},{cities:[city({wl:1}),city({wl:1})]}],
  'cxp-moat':[{cities:[city({wl:3})]},{cities:[city({wl:2})]}],
  'cxp-hum':[{cities:[city({ups:{farm:4}}),city({ups:{mine:5}})]},{cities:[city({ups:{farm:4,mine:4}})]}],
  'cxp-scaffold':[{cities:[city({busy:{k:'farm'}})]},{cities:[city()]}],
  'cxp-sulk':[{cities:[city({mb:{v:-6,u:Date.now()+3600e3}})]},{cities:[city({mb:{v:-6,u:Date.now()-1}}),city({mb:{v:6,u:Date.now()+3600e3}})]}],
  'cxp-road-name':[{infra:[{k:'road',a:1,b:2,d:Date.now()-1}]},{infra:[{k:'road',a:1,b:2,d:Date.now()+3600e3}]}],
  'cxp-inns':[{infra:[{k:'road',a:1,b:2,d:Date.now()-1}]},{}],
  'cxp-mood-table':[{cities:[city(),city(),city()]},{cities:[city(),city()]}],
  'pas-abroad':[{stamps:3},{stamps:2}],
  'pas-pages':[{stamps:8},{stamps:7}],
  'pas-diary':[{stamps:3},{stamps:2}],
  'pas-photo':[{stamps:1},{stamps:0}],
  'pas-stamp-hunter':[{stamps:5},{stamps:4}],
  'pas-commuter':[{stamps:2},{stamps:1}],
  'sts-average':[{dec:30},{dec:29}],
  'sts-axis':[{dec:30},{dec:29}],
  'sts-behind':[{dec:30},{dec:29}],
  'sts-adjusted':[{dec:30},{dec:29}],
  'tzn-half-hour':[{ach:{'law-zones':1}},{ach:{'law-other':1}}],
  'tzn-farmhouse':[{ach:{'law-zones':1}},{}],
  'tzn-train':[{ach:{'law-zones':1}},{}],
  'tzn-new-year':[{ach:{'law-zones':1}},{}],
  'rcr-basket':[{rcp:['abcdefg']},{rcp:[]}],
  'rcr-copycat':[{rcp:['abcdefg','hijklmn']},{rcp:['abcdefg']}],
  'rcr-thanks':[{rcb:{r:'abcdefg'}},{rcp:['abcdefg']}],
  'hon-hall':[{rank:3},{rank:2}],
  'hon-border':[{rank:5},{rank:4}],
  'hon-chase':[{rank:8},{rank:7}],
  'hrl-mural':[{cities:[city(),city(),city(),city(),city()]},{cities:[city(),city(),city(),city()]}],
  'hrl-layers':[{flag:{p:'plain',layers:[{},{}]}},{flag:{p:'plain',layers:[{}]}}]
};
test('each edict waits for its system, and arrives once it works',()=>{
  const c=load(),gated=c.NS.filter(x=>x.req);
  assert.deepEqual(plain(c.NS.filter(x=>!x.req).map(x=>x.id)),['cbd-capitals','cbd-lost-cat','cbd-pinned','cbd-concerned'],'only the Community Board’s edicts arrive for everybody');
  assert.deepEqual(plain(gated.map(x=>x.id).sort()),Object.keys(ON).sort(),'the test knows every condition');
  for(const x of gated){
    const [yes,...no]=ON[x.id];
    assert.equal(!!x.req(nation(yes)),true,x.id+' arrives for '+JSON.stringify(yes));
    for(const o of no)assert.equal(!!x.req(nation(o)),false,x.id+' waits for '+JSON.stringify(o));
  }
  const sys=p=>c.NS.filter(x=>x.id.startsWith(p)).length;
  assert.deepEqual(['gvp-','cxp-','pas-','cbd-','sts-','tzn-','rcr-','hon-','hrl-'].map(sys),[12,12,6,4,4,4,3,3,2]);
});

test('the edicts use only real topics, scales, budget lines, laws and placeholders, in the house style',()=>{
  const c=load();let opts=0,cab=0,md=0;
  for(const is of c.NS){
    assert(TOPICS.includes(is.c),is.id+' topic');
    assert.equal(is.o.length,3,is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    for(const txt of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z:]+)\}/g))assert(PLACEHOLDERS.has(m[1]),is.id+' uses {'+m[1]+'}');
      assert(!/['"]/.test(txt),is.id+' uses typographic quotes and apostrophes');
      assert(!/Meridian|Lucanto|Brennoch|Ilsund|Iron Compact|\{NB/.test(txt),is.id+' names no Meridian nation and no neighbour');
    }
    for(const o of is.o){
      opts++;if(CABINET.test(o.t))cab++;
      assert(/^“.+,” says /.test(o.t),is.id+' options are quotations with a speaker');
      assert(/^[a-z0-9{]|^[A-Z][a-z]+ [A-Z]|^Admiral the cat|^A Concerned Citizen/.test(o.fx),is.id+' outcomes continue a sentence: '+o.fx);
      assert(Object.keys(o.e).some(k=>k!=='md'),is.id+' every option changes the nation');
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv>0&&bv<=2,is.id+' budget '+bk);continue;}
        if(k==='p'){for(const [pk,pv] of Object.entries(v)){assert(c.POLICIES[pk]||source.includes(pk+":['"),is.id+' law '+pk);assert.equal(pv,1,is.id+' grants '+pk);}continue;}
        if(k==='md'){md++;assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=3,is.id+' gives or spends a little mandate');assert(/^(gvp|cxp|sts|hon)-/.test(is.id),is.id+' is about governing');continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
  }
  assert(cab/opts>=0.12&&cab/opts<=0.2,'about one option in six is a minister’s: '+cab+' of '+opts);
  assert(md>=15&&md<=25,'some answers touch the mandate: '+md);
});

test('six new laws, each granted by exactly one option and shown as a law',()=>{
  const c=load(),granted=new Map();
  for(const is of c.NS)for(const o of is.o)for(const pk of Object.keys((o.e&&o.e.p)||{}))granted.set(pk,(granted.get(pk)||0)+1);
  assert.deepEqual(plain(Object.keys(c.NS_LAW).sort()),[...LAWS].sort());
  assert.deepEqual([...granted.keys()].sort(),[...LAWS].sort(),'these edicts grant only their own laws');
  for(const k of LAWS){
    assert.equal(granted.get(k),1,k+' comes from one option');
    assert(Array.isArray(c.POLICIES[k])&&c.POLICIES[k][0]&&/: /.test(c.POLICIES[k][1]),k+' has a name, and a description that says what it does');
    assert(!new RegExp('\\b'+k+'\\b').test(source.slice(0,source.indexOf(START))),k+' is a new law');
  }
});

test('the seat laws change the size of parliament, and Question Time refills the mandate faster',()=>{
  const c=load(),mods=Object.fromEntries(c.GV_SEAT_MODS.map(([k,f])=>[k,f]));
  assert.deepEqual([mods.upperHouse,mods.fixedBenches,mods.diasporaSeats],[0.9,0.8,1.04],'added after the older seat rules, each with a reason');
  assert(c.GV_SEAT_MODS.every(m=>typeof m[2]==='string'&&m[2]));
  assert.equal(c.mdRate(nation()),5);assert.equal(c.mdRate(nation({policies:{questionTime:true}})),5*1.1);
});

test('the city laws lift the mood of the cities they describe, for a player’s cities only',()=>{
  const c=load(),now=Date.now(),ct=(pols,rec,o={})=>Object.assign({c:7,npc:false,rec,fn:{policies:pols,infra:o.infra||[]}},o);
  const all={electedMayors:true,rampartWalks:true,roadsideInns:true},road=[{k:'road',a:7,b:9,d:now-1}];
  let m=c.cxMood(ct(all,city({my:{tr:'builder'},wl:2}),{infra:road}),now);
  assert.equal(m.v,60+3+3+2);assert.deepEqual(plain(m.parts.map(p=>p[0])),[5,3,3,2],'each shown as a part of the mood');
  m=c.cxMood(ct(all,city()),now);assert.equal(m.v,60,'no mayor, no walls, no road: no change');
  m=c.cxMood(ct({},city({my:{},wl:1}),{infra:road}),now);assert.equal(m.v,60,'without the laws nothing changes');
  m=c.cxMood(ct(all,city({my:{}}),{npc:true}),now);assert.equal(m.v,60,'a computer-run city has no laws here');
  m=c.cxMood(ct({electedMayors:true},city({my:{}}),{base:99}),now);assert.equal(m.v,100,'the mood stays within 0–100');
  assert.deepEqual(plain(c.NS_MOOD.map(x=>[x[0],x[1]])),[['electedMayors',3],['rampartWalks',3],['roadsideInns',2]]);
  for(const [k,v] of c.NS_MOOD.map(x=>[x[0],x[1]]))assert(c.POLICIES[k][1].includes('+'+v),k+' says how much');
});

test('an answer that gives or spends mandate does so, and says so among its notes',()=>{
  const c=load(),now=Date.now(),is=c.NS.find(x=>x.id==='gvp-empty');
  let n=nation({md:1}),notes=c.geoAfter(n,is.o[0],{},now,{});
  assert.equal(n.md,4);assert.deepEqual(plain(notes),[['Land','A hex of new land.'],['Mandate','+3 mandate: 4 of 10.']]);
  n=nation({md:10});notes=c.geoAfter(n,is.o[0],{},now,{});assert.deepEqual(plain(notes[1]),['Mandate','Your mandate was already full.']);
  n=nation({md:2});notes=c.geoAfter(n,c.NS.find(x=>x.id==='gvp-full').o[0],{},now,{});assert.equal(n.md,0);assert.deepEqual(plain(notes[1]),['Mandate','−2 mandate: 0 of 10.'],'only what there was to spend');
  n=nation({md:5});notes=c.geoAfter(n,c.NS.find(x=>x.id==='gvp-senate').o[0],{},now,{});assert.equal(n.md,5);assert.equal(notes.length,1,'no mandate, no note');
  n=nation({md:5,npc:true});c.geoAfter(n,is.o[0],{},now,{});assert.equal(n.md,5,'never for a computer-run nation');
});
