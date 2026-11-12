// A hundred edicts in twenty chains of five: numbered after every older edict, only each chain's first drawn at random,
// every option of steps one to four leading on to the next step, and the house rules for effects and wording.
// Run with: node --test test/edicts-chains.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── a hundred edicts in twenty chains of five',END='\n/* ───────── ';
const STAT_KEYS=JSON.parse(source.match(/const STAT_KEYS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
const BUDGET_KEYS=[...source.slice(source.indexOf('const BUDGET = ['),source.indexOf('];',source.indexOf('const BUDGET = ['))).matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
const OLDER=2456,MINISTERS=/\{(FIN|INT|FOR|DEF|CUL|WRK|HEA)\}/;

function load(){
  const ctx={ISSUES:new Array(OLDER).fill(null).map((x,i)=>({id:'old'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],geo:()=>true};
  vm.createContext(ctx);
  const a=source.indexOf(START),b=source.indexOf(END,a+START.length);
  assert(a>source.indexOf('for(const is of BRD_ISSUES)'),'after the border edicts, so no number moves');
  assert(b<=source.indexOf('/* ───────── the browser tab'),'before the browser tab’s section');
  assert.equal(source.indexOf('ISSUES.push(',b),-1,'no edict is added after this section');
  vm.runInContext(source.slice(a,b)+'\nthis.J=JSON.stringify({X:CHN_ISSUES,R:CHN_ISSUES.map(is=>ISSUES_RANDOM.includes(is)),Q:CHN_ISSUES.map(is=>is.req?String(is.req):"")});',ctx);
  return JSON.parse(ctx.J);
}
const chainOf=is=>is.id.match(/^ch-([a-z]+)-([1-5])$/);

test('a hundred edicts, numbered after every older one, in twenty chains of five',()=>{
  const c=load();
  assert.equal(c.X.length,100);
  assert.deepEqual(c.X.map(x=>x.no),Array.from({length:100},(x,i)=>OLDER+1+i));
  const chains={};
  for(const is of c.X){const m=chainOf(is);assert(m,is.id);(chains[m[1]]=chains[m[1]]||[]).push(+m[2]);}
  assert.equal(Object.keys(chains).length,20);
  for(const [k,steps] of Object.entries(chains))assert.deepEqual(steps,[1,2,3,4,5],k+' in order');
  assert(/'CHN_ISSUES'/.test(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8')),'the content split carries them');
  assert(source.includes('Rule on over 2,500 edicts'),'the front page counts them');
});

test('only the first of each chain is drawn at random; every option of steps one to four leads on',()=>{
  const c=load();
  c.X.forEach((is,i)=>{
    const step=+chainOf(is)[2],next=is.id.replace(/\d$/,String(step+1));
    if(step===1){assert(c.R[i]&&!is.fo&&is.w===2.5,is.id+' is a starter');}
    else{assert(!c.R[i]&&is.fo===1&&is.w==null&&!c.Q[i],is.id+' comes only as a follow-up, with no condition');}
    assert.equal(is.o.length,3,is.id);
    for(const o of is.o){
      if(step<5){assert.equal(o.nx,next,is.id+' leads on');assert(o.nxh>=3&&o.nxh<=10,is.id+' within the day');}
      else assert.equal(o.nx,undefined,is.id+' ends the chain');
    }
  });
  const conds=c.Q.filter(Boolean);
  assert.deepEqual(conds.map(q=>q.match(/geo\(n,'([a-z]+)'\)/)[1]).sort(),['coast','coast','forest','mountain'],'four starters ask for land');
});

test('effects use the game’s own keys, in the house sizes',()=>{
  const c=load(),known=['monarchy','gambling','emissions'];
  for(const k of known)assert(source.includes(k+':['),k+' is a law');
  for(const is of c.X)for(const o of is.o)for(const [k,v] of Object.entries(o.e)){
    if(k==='b')for(const [bk,bv] of Object.entries(v))assert(BUDGET_KEYS.includes(bk)&&Math.abs(bv)<=2,is.id+' budget '+bk);
    else if(k==='p')for(const [pk,pv] of Object.entries(v))assert(known.includes(pk)&&(pv===0||pv===1),is.id+' law '+pk);
    else assert(STAT_KEYS.includes(k)&&Number.isInteger(v)&&v!==0&&Math.abs(v)<=4,is.id+' '+k);
  }
});

test('wording: unique ids and titles, known placeholders, typographic quotes, ministers in about one option in six',()=>{
  const c=load(),PH=new Set(['N','D','C','Cs','CAP','A','FIN','INT','FOR','DEF','CUL','WRK','HEA']);
  for(const is of c.X){
    assert.equal(source.split(`{id:'${is.id}',`).length,2,is.id);
    assert.equal(source.split(`t:'${is.t}'`).length,2,is.t);
    for(const t of [is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])]){
      for(const m of t.matchAll(/\{([A-Za-z]+)\}/g))assert(PH.has(m[1]),is.id+' {'+m[1]+'}');
      assert(!/["']/.test(t),is.id+' typographic quotes');
    }
    for(const o of is.o)assert(/^“/.test(o.t)&&/ (says|suggests) /.test(o.t),is.id+' a speaker for every option');
  }
  const opts=c.X.flatMap(is=>is.o),share=opts.filter(o=>MINISTERS.test(o.t)).length/opts.length;
  assert(share>0.1&&share<0.2,'ministers speak in '+Math.round(share*100)+'% of options');
});
