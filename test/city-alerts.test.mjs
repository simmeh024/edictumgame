// Cities that need the player, told in the bell: a matter waiting (one notice per city, one for them all past three),
// empty blocks with idle builders, cities without a mayor and room for a new city, each naming the city, the tab and
// the spot on the page a click opens. The game's own code, evaluated piece by piece.
// Run with: node --test test/city-alerts.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),deq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);
const NOW=1_800_000_000_000;

/* a city as the Cities page sees it: ev (a matter's title) due, free blocks with no work under way, a mayor or none */
const city=(id,nm,o={})=>({id,nm,active:true,fid:'me',hi:0,c:0,prog:o.busy?[{k:'farm'}]:[],done:new Array(o.used??4).fill('farm'),rec:{my:o.mayor?{nm:'A. Mayor'}:null},ev:o.ev||null,n:o.n??4});

function load(cities,{guided=false,free=0,site=true}={}){
  const ctx={S:{nation:{id:'me',loc:5,cities:cities.map(c=>({id:c.id}))}},OBS:'',
    myId:()=>'me',cellOf:l=>l,pgGuided:()=>guided,
    myCityStates:()=>({T:{byId:{me:0},list:[{id:'me'}]},mine:cities}),maxCities:()=>cities.length+free,MAX_CITIES:33,cityList:n=>n.cities,nvxCitySite:()=>site,
    cxOk:ct=>ct.active,cxEvDue:ct=>ct.ev?{t:ct.ev}:null,cxFill:(t,ct)=>t.replace(/\{C\}/g,ct.nm),blkOf:ct=>({n:ct.n}),blkUsed:ct=>ct.done.length+ct.prog.length,
    cxCityExtras:r=>({my:r&&r.my}),CSS:{escape:s=>s}};
  vm.createContext(ctx);
  vm.runInContext([line('function list(a)'),cut('function cxTodoList(','function cxTodo('),
    cut('const CA={memo:null};','notifItems=(f=>'),line('function caTarget(')].join('\n')+'\nthis.CA=CA;',ctx);
  return ctx;
}

test('a matter in each city is its own notice, opening that city’s People tab at the matter',()=>{
  const G=load([city('c1','Xen City',{ev:'The river floods part of {C}'}),city('c2','Dray')]);
  const it=G.caItems(G.S.nation,NOW).filter(x=>x.k==='cxev');
  deq(it,[{k:'cxev',kl:'Xen City',txt:'The river floods part of Xen City. A matter waits for your answer.',cx:'c1',tab:'ppl',at:'ev',c:1}]);
  assert.equal(G.caTarget('c1','ppl','ev'),'#cx-matter');
});

test('past three matters, one notice names them all and counts each',()=>{
  const cs=['Ash','Birch','Cedar','Dale','Elm'].map((nm,i)=>city('c'+i,nm,{ev:'{C} wants a statue'}));
  const it=load(cs).caItems({},NOW);
  const G=load(cs),ev=G.caItems(G.S.nation,NOW).filter(x=>x.k==='cxev');
  assert.equal(ev.length,1);
  assert.equal(ev[0].c,5,'the menu counts five matters');
  assert.equal(ev[0].txt,'5 cities have matters waiting for your answer: Ash, Birch, Cedar, and 2 more.');
  assert.equal(ev[0].cx,'c0');
  deq(it,[],'another nation than the player’s tells nothing');
  const three=load(cs.slice(0,3));assert.equal(three.caItems(three.S.nation,NOW).filter(x=>x.k==='cxev').length,3,'three still go one by one');
});

test('idle builders, a missing mayor and room for a city are reminders, each with where to go',()=>{
  const G=load([city('c1','Dray',{used:3,mayor:true}),city('c2','Jeager',{used:2,mayor:true}),city('c3','Holm',{used:4,busy:false})],{free:1});
  const r=G.caItems(G.S.nation,NOW);
  assert(r.every(x=>x.k==='cxtodo'),'no matter, so only reminders');
  deq(r.map(x=>[x.txt,x.cx,x.tab,x.at||'']),[
    ['Dray and Jeager have empty blocks and idle builders.','c1','build',''],
    ['Holm has no mayor. Candidates are waiting to be appointed.','c3','ppl','mayor'],
    ['You can found a new city. A site is free on your land.','new','new','']]);
  assert.equal(G.caTarget('c3','ppl','mayor'),'#cx-mayor');
  assert.equal(G.caTarget('new','new',''),'#cx-new');
  assert.equal(G.caTarget('c1','build',''),'#city-c1','the Build tab opens with the city in view');
});

test('one city with free blocks is named with how many; a busy one or a full one is not',()=>{
  const G=load([city('c1','Dray',{used:3,mayor:true}),city('c2','Jeager',{used:1,busy:true,mayor:true}),city('c3','Holm',{used:4,mayor:true})]);
  deq(G.caItems(G.S.nation,NOW).map(x=>x.txt),['Dray has an empty block and idle builders. Choose what to build.']);
  const H=load([city('c1','Dray',{used:1,mayor:true})]);
  deq(H.caItems(H.S.nation,NOW).map(x=>x.txt),['Dray has 3 empty blocks and idle builders. Choose what to build.']);
});

test('room for a city only counts when a site is free',()=>{
  const G=load([city('c1','Dray',{mayor:true})],{free:2,site:false});
  deq(G.caItems(G.S.nation,NOW),[]);
  const H=load([city('c1','Dray',{mayor:true})],{free:2});
  deq(H.caItems(H.S.nation,NOW).map(x=>x.txt),['You can found 2 new cities. Sites are free on your land.']);
});

test('during the first guided steps only matters are told, and a nation not yet on the map hears nothing',()=>{
  const cs=[city('c1','Dray',{used:1,ev:'{C} asks for a festival'})];
  const G=load(cs,{guided:true});
  deq(G.caItems(G.S.nation,NOW).map(x=>x.k),['cxev']);
  const H=load(cs);H.S.nation.loc=-1;
  deq(H.caItems(H.S.nation,NOW),[]);
  const O=load(cs);O.OBS='terra';
  deq(O.caItems(O.S.nation,NOW),[],'an admin observing another region sees no reminders');
});

test('the Cities page and the bell read the same list',()=>{
  assert.match(cut('function cxTodo(','function cxItem('),/cxTodoList\(T,mine,now,canFound\)/);
  assert.match(source,/<section class="cx-sec cx-ev" id="cx-matter">/);
  assert.equal((source.match(/<section class="cx-sec" id="cx-mayor">/g)||[]).length,2,'with or without a mayor');
  assert.match(source,/\['city','City reminders: empty blocks, mayors, room for a city',\['cxtodo'\]\]/,'reminders can be left out of the bell');
});
