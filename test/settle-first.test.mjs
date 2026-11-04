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
    issueView:()=>'<h1>x</h1><p class="issue-q">Q</p>',nationView:()=>'NATION',issuesView:()=>'DESK'});
  vm.runInContext(source.slice(start,end)+';this.T={fdCard,issueView:(...a)=>issueView(...a),nationView:(...a)=>nationView(...a),issuesView:(...a)=>issuesView(...a)};',ctx);
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
