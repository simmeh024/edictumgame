// A hundred and fifty edicts about beauty contests, fireworks, sport and scandal: the game's section evaluated on its own.
// Run with: node --test test/edicts-spectacle.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── a hundred and fifty edicts: beauty contests, fireworks, sport and scandal',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const TOPICS=JSON.parse(source.match(/const ISSUE_TOPICS = (\[.*?\]\]);/)[1].replace(/'/g,'"')).map(([k])=>k);
const PLACEHOLDERS=new Set(['N','D','C','Cs','L','CAP','A','As','SPORT','DISH','LANG','FIN','DEF','FOR','INT','WRK','HEA','CUL']);
const CABINET=/\{(FIN|DEF|FOR|INT|WRK|HEA|CUL)\}/;
/* every edict before this section, the fourteen Mission Control letters (2257–2270) last */
const OLDER=2270;
const SETS={pgt:37,fwk:37,spo:38,scd:38};

function load(){
  const ctx={ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[]};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>0&&b>a,'the section is there');
  assert(a>source.indexOf('for(let k=0;k<MC_N;k++)'),'after the Mission Control letters, so no number moves');
  assert(b<=source.indexOf('/* ───────── the browser tab'),'before the browser tab’s section, which its own test cuts to boot');
  assert.equal(source.indexOf('ISSUES.push(',b),-1,'no edict is added after this section');
  /* read back as JSON, so the arrays belong to this realm and compare with deepEqual */
  vm.runInContext(source.slice(a,b)+'\nthis.J=JSON.stringify({X:SHOW_ISSUES,R:SHOW_ISSUES.map(is=>ISSUES_RANDOM.includes(is)&&ISSUE_BY_ID[is.id]===is)});',ctx);
  return JSON.parse(ctx.J);
}

test('a hundred and fifty, numbered after every older edict, with ids and titles of their own',()=>{
  const c=load(),all=c.X;
  assert.equal(all.length,150);
  for(const [p,k] of Object.entries(SETS))assert.equal(all.filter(x=>x.id.startsWith(p+'-')).length,k,p);
  assert.deepEqual(all.map(x=>x.no),Array.from({length:150},(_,i)=>OLDER+1+i));
  assert.equal(new Set(all.map(x=>x.id)).size,150);assert.equal(new Set(all.map(x=>x.t)).size,150);
  all.forEach((x,i)=>{
    assert(/^(pgt|fwk|spo|scd)-[a-z-]+$/.test(x.id),x.id);
    assert.equal(source.split(`{id:'${x.id}',`).length,2,x.id+' is a new id');
    assert.equal(source.split(`t:'${x.t}'`).length,2,x.t+' is a new title');
    assert(c.R[i]&&!x.fo&&!x.req&&!x.nbx,x.id+' is drawn at random, with no condition');
  });
  assert(/'SHOW_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'their text is cached with the other edicts');
  assert(source.includes('Rule on over 2,400 edicts'),'the front page counts them');
});

test('the edicts use only real topics, scales, budget lines, laws and placeholders, in the house style',()=>{
  const c=load();let opts=0,cab=0;
  for(const is of c.X){
    assert(TOPICS.includes(is.c),is.id+' topic');
    assert.equal(is.o.length,3,is.id);
    assert(!/\{/.test(is.t),is.id+' has a plain title');
    let here=0;
    for(const txt of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of txt.matchAll(/\{([A-Za-z:]+)\}/g))assert(PLACEHOLDERS.has(m[1]),is.id+' uses {'+m[1]+'}');
      assert(!/['"]/.test(txt),is.id+' uses typographic quotes and apostrophes');
    }
    for(const o of is.o){
      opts++;if(CABINET.test(o.t)){cab++;here++;}
      assert(/^“.+” says |^“.+,” says /.test(o.t),is.id+' options are quotations with a speaker');
      assert(o.fx&&!/[.!]$/.test(o.fx),is.id+' has an outcome without a full stop');
      assert(Object.keys(o.e).length,is.id+' every option changes something');
      for(const [k,v] of Object.entries(o.e)){
        if(k==='b'){for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Number.isInteger(bv)&&bv>0&&bv<=2,is.id+' budget '+bk);continue;}
        if(k==='p'){for(const [pk,pv] of Object.entries(v)){assert(source.includes(pk+":['"),is.id+' law '+pk);assert.equal(pv,1,is.id+' grants '+pk);}continue;}
        assert(STAT_KEYS.includes(k),is.id+' scale '+k);assert(Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' moves '+k+' a little');
      }
    }
    assert(here<=1,is.id+' has one minister at most');
  }
  assert(cab/opts>=0.12&&cab/opts<=0.2,'about one option in six is a minister’s: '+cab+' of '+opts);
});
