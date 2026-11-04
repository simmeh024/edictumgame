// Fifty edicts about workers’ rights and fifty about sport: the game's section evaluated on its own.
// Run with: node --test test/edicts-work-sport.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── fifty edicts about workers',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const TOPICS=JSON.parse(source.match(/const ISSUE_TOPICS = (\[.*?\]\]);/)[1].replace(/'/g,'"')).map(([k])=>k);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']);
const CABINET=/\{(FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/;
const OLDER=2106;

function load(){
  const ctx={ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[]};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>source.indexOf('const MUS_ISSUES=[')&&b>a,'the section follows the museum’s');
  vm.runInContext(source.slice(a,b)+'\nthis.W=WRK_ISSUES;this.S=SPT_ISSUES;',ctx);
  return ctx;
}

test('fifty of each, numbered after every older edict, with ids and titles of their own',()=>{
  const c=load(),all=[...c.W,...c.S];
  assert.equal(c.W.length,50);assert.equal(c.S.length,50);
  assert.deepEqual(all.map(x=>x.no),Array.from({length:100},(_,i)=>OLDER+1+i));
  assert.equal(new Set(all.map(x=>x.id)).size,100);assert.equal(new Set(all.map(x=>x.t)).size,100);
  for(const x of all){
    assert.equal(c.ISSUE_BY_ID[x.id],x);
    assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id+' is a new id');
    assert.equal(source.split(`t:'${x.t}'`).length,2,x.t+' is a new title');
    assert(c.ISSUES_RANDOM.includes(x)&&!x.fo&&!x.req&&!x.nbx,x.id+' is drawn at random, with no condition');
  }
  assert(c.W.every(x=>/^wrk-[a-z-]+$/.test(x.id))&&c.S.every(x=>/^spt-[a-z-]+$/.test(x.id)));
  assert(/'WRK_ISSUES','SPT_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'their text is cached with the other edicts');
});

test('the edicts use only real topics, scales, budget lines, laws and placeholders, in the house style',()=>{
  const c=load();let opts=0,cab=0;
  for(const is of [...c.W,...c.S]){
    assert(TOPICS.includes(is.c),is.id+' topic');
    assert.equal(is.o.length,3,is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    for(const txt of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z:]+)\}/g))assert(PLACEHOLDERS.has(m[1]),is.id+' uses {'+m[1]+'}');
      assert(!/['"]/.test(txt),is.id+' uses typographic quotes and apostrophes');
    }
    for(const o of is.o){
      opts++;if(CABINET.test(o.t))cab++;
      assert(/^“.+” says |^“.+,” says /.test(o.t),is.id+' options are quotations with a speaker');
      assert(Object.keys(o.e).length,is.id+' every option changes something');
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv>0&&bv<=2,is.id+' budget '+bk);continue;}
        if(k==='p'){for(const [pk,pv] of Object.entries(v)){assert(source.includes(pk+":['"),is.id+' law '+pk);assert.equal(pv,1,is.id+' grants '+pk);}continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
  }
  assert(cab/opts>=0.12&&cab/opts<=0.2,'about one option in six is a minister’s: '+cab+' of '+opts);
});
