// Twenty-five edicts across all ten topics: the game's section evaluated on its own, with the conditions it calls
// stubbed so that each can be switched on and off. Run with: node --test test/edicts-mix.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── twenty-five edicts across all ten topics',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const TOPICS=JSON.parse(source.match(/const ISSUE_TOPICS = (\[.*?\]\]);/)[1].replace(/'/g,'"')).map(([k])=>k);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']),NB_PLACEHOLDERS=new Set(['NB','NBD','NBL','NBCAP']);
const CABINET=/\{(FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/;
/* every edict before these: the older catalogue, the later buildings, the hundred for the newer systems and the eight letters */
const OLDER=2020;
/* the names that hide an edict outside the Meridian Reach (regionIssueOk) */
const MERIDIAN=new RegExp('\\b('+[...source.slice(source.indexOf('const NPCS_MER = ['),source.indexOf('];',source.indexOf('const NPCS_MER = ['))).matchAll(/(?:name|demonym|capital):'([^']+)'/g)].map(m=>m[1])
  .concat(['Iron Compact','Meridian','Lucantan','Brennoch','Ilsund']).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')');

/* the section in a context of its own; on holds the conditions that hold, as 'coast', 'nb' or 'crown' */
function load(){
  const on=new Set(),ctx={on,ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],NB_RE:/\{NB(D|L|CAP)?\}/,
    geo:(n,t)=>on.has(t),hasNb:()=>on.has('nb'),leader:(n,g)=>on.has(g)};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>0&&b>a,'the section is where the tests expect it');
  vm.runInContext(source.slice(a,b)+'\nthis.MIX_ISSUES=MIX_ISSUES;',ctx);
  return ctx;
}
const needs=is=>[...String(is.req||'').matchAll(/geo\(n,'(\w+)'\)|hasNb\(n\)|leader\(n,'(\w+)'\)/g)].map(m=>m[1]||m[2]||'nb');

test('twenty-five edicts, numbered after every older one and after the letters, with ids and titles of their own',()=>{
  const c=load(),is=c.MIX_ISSUES;
  assert.equal(is.length,25);
  assert.deepEqual([...is.map(x=>x.no)],Array.from({length:25},(_,i)=>OLDER+1+i),'they take the next numbers');
  assert(source.indexOf('for(let k=0;k<WS_N;k++)')<source.indexOf(START),'the letters from Willow Street keep their numbers');
  assert(source.indexOf('const ISSUES_RANDOM=ISSUES.filter')<source.indexOf(START),'the random pool exists before they join it');
  assert.equal(new Set(is.map(x=>x.id)).size,25);assert.equal(new Set(is.map(x=>x.t)).size,25);
  for(const x of is){
    assert.equal(c.ISSUE_BY_ID[x.id],x);
    assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id+' is a new id');
    assert.equal(source.split(`t:'${x.t}'`).length,2,x.t+' is a new title');
    assert(c.ISSUES_RANDOM.includes(x)&&!x.fo,x.id+' is drawn at random');
  }
  assert(/'MIX_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'their text is cached with the other edicts');
});

test('every topic has its share, and the smallest topics the most',()=>{
  const c=load(),by=k=>c.MIX_ISSUES.filter(x=>x.c===k).length;
  for(const k of TOPICS)assert(by(k)>=1,k+' has an edict');
  assert.equal(TOPICS.reduce((a,k)=>a+by(k),0),25,'every edict has one of the ten topics');
  assert.equal(by('tech'),4);assert.equal(by('welfare'),4);
});

test('each gated edict waits for its condition, pairs with a neighbour only when it names one, and comes up as often as its kind',()=>{
  const c=load();
  for(const x of c.MIX_ISSUES){
    const keys=needs(x),names=/\{NB(D|L|CAP)?\}/.test([x.t,x.q,...x.o.flatMap(o=>[o.t,o.fx])].join(' '));
    assert.equal(x.nbx,names,x.id+(names?' is paired with a neighbour':' needs no neighbour'));
    if(names)assert(keys.includes('nb'),x.id+' names a neighbour only where there is one');
    assert.equal(x.w,keys.some(k=>k!=='crown')?3:undefined,x.id+' weight');
    if(!x.req)continue;
    assert(keys.length,x.id+' asks for something the test knows');
    c.on.clear();assert.equal(!!x.req({}),false,x.id+' waits while nothing holds');
    for(const k of keys)c.on.add(k);assert.equal(!!x.req({}),true,x.id+' arrives once '+keys.join(' and ')+' holds');
  }
  assert.deepEqual([...c.MIX_ISSUES.filter(x=>x.req).map(x=>x.id)],['mix-nomads','mix-royal-licence','mix-spy-whale','mix-borrowed-view']);
});

test('the edicts use only real scales, budget lines, laws and placeholders, in the house style',()=>{
  const c=load();let opts=0,cab=0;
  for(const is of c.MIX_ISSUES){
    assert.equal(is.o.length,3,is.id);
    assert(/^mix-[a-z-]+$/.test(is.id),is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    for(const txt of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z:]+)\}/g))assert(PLACEHOLDERS.has(m[1])||(NB_PLACEHOLDERS.has(m[1])&&is.nbx),is.id+' uses {'+m[1]+'}');
      assert(!/['"]/.test(txt),is.id+' uses typographic quotes and apostrophes');
      assert(!MERIDIAN.test(txt),is.id+' names no Meridian nation, people or city');
    }
    for(const o of is.o){
      opts++;if(CABINET.test(o.t))cab++;
      assert(/^“.+” says |^“.+,” says /.test(o.t),is.id+' options are quotations with a speaker');
      assert(/^[a-z0-9{]/.test(o.fx),is.id+' outcomes continue a sentence: '+o.fx);
      assert(Object.keys(o.e).length,is.id+' every option changes something');
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv>0&&bv<=2,is.id+' budget '+bk);continue;}
        if(k==='p'){for(const [pk,pv] of Object.entries(v)){assert(new RegExp('\\b'+pk+":\\['").test(source),is.id+' law '+pk);assert.equal(pv,1,is.id+' grants '+pk);}continue;}
        if(k==='nb'){assert(is.nbx&&Number.isInteger(v)&&v&&Math.abs(v)<=10,is.id+' goodwill');continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
  }
  assert(cab/opts>=0.12&&cab/opts<=0.2,'about one option in six is a minister’s: '+cab+' of '+opts);
});
