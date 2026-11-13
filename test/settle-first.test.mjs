// Settling first: the quick choices, the card every unsettled nation sees, the founding funnel and the kept draft.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const DAY=86400000;
function section(store={}){
  const start=source.indexOf('/* ───────── settling first'),end=source.indexOf('/* ───────── seven more buildings',start);
  assert.ok(start>0&&end>start);
  const sent=[],hooks=[];
  const ctx=vm.createContext({S:{nation:null},OBS:'',DAY,FD_ID:'fd-settle',FD_KIND:['By the sea','On farmland','In the hills'],COMMIT_HOOKS:hooks,
    localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}},
    window:{edictumStat:(name,p)=>sent.push([name,p])},document:{addEventListener(){}},
    esc:s=>String(s),cellOf:l=>l?l.c:-1,territory:()=>({}),fdSites:()=>[11,-1,33],landName:c=>'Isle '+c,
    issueView:()=>'<h1>x</h1><p class="issue-q">Q</p>',nationView:()=>'NATION',issuesView:()=>'DESK',go:v=>{},mapTabs:()=>'<div class="stabs">TABS</div>',prvT2:()=>'States',prvLow:s=>s.toLowerCase(),prvOnRec:n=>!!n.prov,
    ffbCard:()=>'FFB',VIEWS_EXT:{customise:()=>'CZ'},tutDevGet:()=>'',tutMark:()=>{},tutRebuild:()=>{},pgEligible:()=>false,tutRow:()=>'ROW',navBadges:()=>({}),TUT_CAP0:'Port Alder',REGION:'Testland',tutCapCity:n=>n.cities?.[0],
    TUT_LISTS:[{k:'welcome',tasks:[{k:'city'},{k:'leader'}]},{k:'charter',tasks:[{k:'charter'},{k:'flag'}]}],tutTasks:L=>L.tasks,tutCur:n=>({k:'welcome'}),
    tutState:(n,L)=>[{k:'city',ok:n.capital!=='Port Alder',lock:''},{k:'leader',ok:true,lock:''}]});
  vm.runInContext(source.slice(start,end)+';this.T={TL:TUT_LISTS,pgEligible:(...a)=>pgEligible(...a),tutRow:(...a)=>tutRow(...a),go:v=>go(v),mapTabs:()=>mapTabs("map"),fdCard,ffbCard:()=>ffbCard(),navBadges:()=>navBadges(),issueView:(...a)=>issueView(...a),nationView:(...a)=>nationView(...a),issuesView:(...a)=>issuesView(...a)};',ctx);
  return {T:ctx.T,S:ctx.S,sent,hooks,store};
}
const nation=o=>({name:'Testoria',capital:'Port Test',founded:1e12,inbox:[],...o});

test('an unsettled nation sees the card on its Nation page and desk, a settled one does not',()=>{
  const {T,S}=section();
  S.nation=nation({loc:null});
  for(const h of [T.nationView({}),T.issuesView({})]){assert.match(h,/Place your capital/);assert.match(h,/data-act="fd-pick" data-o="0"/);assert.match(h,/data-act="fd-own"/);}
  assert.doesNotMatch(T.fdCard(S.nation),/data-o="1"/,'a choice with no free place is left out');
  assert.match(T.fdCard(S.nation),/Settle by the sea<\/b><span>Coast of Isle 11 · trade and tourism/);
  S.nation=nation({loc:{c:5}});
  assert.equal(T.nationView({}),'NATION');assert.equal(T.issuesView({}),'DESK');
  assert.equal(T.fdCard(nation({loc:null,npc:1})),'');
});

test('the edict shows the three choices above the speeches',()=>{
  const {T,S}=section();S.nation=nation({loc:null});S.openIssue='fd-settle';
  const h=T.issueView({});assert.ok(h.indexOf('fd-quick')>0&&h.indexOf('fd-quick')<h.indexOf('issue-q'));
  S.openIssue='other';assert.doesNotMatch(T.issueView({}),/fd-quick/);
});

test('the funnel sends each step once, with hours only, and only in the first week',()=>{
  const {sent,hooks}=section(),run=(n,old,now)=>hooks.forEach(h=>h(n,old,now));
  const t0=1e12,a=nation({loc:null}),b=nation({loc:{c:5}}),c=nation({loc:{c:5},claims:[{c:6}]}),d=nation({loc:{c:5},claims:[{c:6}],cities:[{b:[{k:'farm'}]}]});
  run(a,null,t0);run(a,null,t0+1);run(b,a,t0+3600000);run(c,b,t0+2*3600000);run(d,c,t0+3*3600000);run(d,d,t0+DAY+5);run(d,d,t0+DAY+9);
  assert.deepEqual([...sent.map(x=>x[0])],['nation_founded','capital_settled','first_claim','first_building','returned_next_day']);
  assert.equal(sent[1][1].hours_since_founding,1);assert.deepEqual([...Object.keys(sent[1][1])],["hours_since_founding"]);
  const late=section();late.hooks.forEach(h=>h(b,a,t0+8*DAY));assert.equal(late.sent.length,0);
});

test('the founding draft is kept in localStorage, so closing the browser keeps it',()=>{
  assert.match(source,/localStorage\.setItem\(DRAFT_SS/);assert.match(source,/localStorage\.getItem\(DRAFT_SS\)/);
  assert.doesNotMatch(source,/sessionStorage\.setItem\(DRAFT_SS/);
});

test('the statistics hook sends numbers only, and only when allowed',()=>{
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');
  assert.match(shim,/window\.edictumStat = function \(name, p\) \{\n    if \(!GA\.on/);
  assert.match(shim,/typeof p\[k\] === 'number'/);
});

test('a started first building brings a box that points to the naming task, until the capital has a name',()=>{
  const {T,S}=section();
  S.nation=nation({loc:{c:5},cities:[{id:'c1'}],capital:'Port Alder'});
  assert.equal(T.ffbCard(),'FFB','no box before the first building is started');
  S.nation.ffb={k:'saw',s:1,d:2};
  const h=T.ffbCard();assert.match(h,/Name your first city/);assert.match(h,/data-act="tut-go" data-v="nation" data-to="tut-h-welcome"/);
  S.nation.capital='Estport';assert.equal(T.ffbCard(),'FFB');
});

test('new open tasks put a (!) on Nation until the Nation page is opened (a redraw does not count)',()=>{
  const store={},{T,S}=section(store);S.nation=nation({seed:7,loc:{c:5},capital:'Port Alder'});S.view='map';
  assert.equal(T.navBadges().nation.length,1,'the open, unlocked task is new');
  T.nationView({});assert.equal(T.navBadges().nation,undefined,'the page a visit opens on counts');
  for(const k of Object.keys(store))delete store[k];
  T.nationView({});assert.equal(T.navBadges().nation.length,1,'a redraw of the page does not');
  T.go('nation');assert.equal(T.navBadges().nation,undefined,'opening the page does');
});

test('the map tabs reach the cities and the states, which can be switched on there',()=>{
  const {T,S}=section();S.nation=nation({loc:{c:5}});
  let h=T.mapTabs();assert.match(h,/data-v="cities">Cities</);assert.match(h,/data-act="fd-prv-on"[^>]*>\+ States</);
  S.nation.prov={on:1};h=T.mapTabs();assert.match(h,/data-v="provinces">States</);assert.doesNotMatch(h,/fd-prv-on/);
});

test('Customise is open from the start, and Finish your charter waits at the end of the list for the others',()=>{
  const {T,S}=section();
  assert.equal(T.pgEligible({},'charter'),true);assert.equal(T.pgEligible({},'map'),false);
  assert.deepEqual([...T.TL[1].tasks.map(s=>s.k)],['flag','portrait','cust','charter'],'Customise your leader (after Name your leader where the list has it), Customise your nation, then the charter, come last');
  const n=nation({capital:'Port Alder'});
  assert.equal(T.tutRow(n,{k:'charter',ok:false}),'','hidden while the naming task is open');
  n.capital='Estport';assert.equal(T.tutRow(n,{k:'charter',ok:false}),'ROW','shown once the others are done');
});
