// Exercise the actual tutorial and Google reward hooks in save order, including normalization on reload.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0);
  let i=source.indexOf('{',start),depth=0;
  for(;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)break;}
  return source.slice(start,i+1);
}
function rewards(){
  const first=source.indexOf('const FIRST_STEPS=['),end=source.indexOf('];',first)+2;
  const collect=source.indexOf('function tutLcNow('),colEnd=source.indexOf('/* the credits:',collect);
  const google=source.indexOf('COMMIT_HOOKS.push((n,old,now)=>{\n  if(!S.google||n.glk'),glEnd=source.indexOf('function glCheck(',google);
  assert.ok(first>0&&collect>0&&google>0);
  const ctx=vm.createContext({S:{google:true},COMMIT_HOOKS:[],NEXT_STEPS:[],CU_STEPS:[],TUT_GS:'mrba',TUT_V:24,
    decisions:n=>n.dec||0,cellOf:v=>Number.isInteger(v)?v:-1,nextState:()=>[],tutFresh:()=>false,tutSoc:()=>null,
    stockNow:n=>({...n.stock}),roundStock:s=>({...s}),num0:v=>+v||0,stockCap:()=>400,STOCK_CAP:400,GL_CREDITS:5,GL_GIFT:{iron:5,timber:5,goods:5}});
  vm.runInContext(fn('stockLimit')+'\n'+source.slice(first,end)+'\n'+fn('stepsState')+'\n'+fn('tutNorm')+'\n'+
    source.match(/const tutLcIds=.*;/)[0]+'\n'+source.match(/const tutLcOf=.*;/)[0]+'\n'+
    source.slice(collect,colEnd)+'\n'+source.slice(google,glEnd)+'\nthis.normalize=tutNorm;',ctx);
  return {
    save(n){const old=structuredClone(n),messages=[];for(const hook of ctx.COMMIT_HOOKS){const m=hook(n,old,Date.now());if(m)messages.push(...m);}return messages;},
    reload(n){const copy=JSON.parse(JSON.stringify(n)),t=ctx.normalize(copy.tut);if(t)copy.tut=t;else delete copy.tut;return copy;}
  };
}
const nation=over=>({name:'Togetherland',seed:'one',glk:1,stock:{food:60,timber:45,iron:25,oil:10,goods:40},...over});

test('an already linked nation never repeats the ordinary one-credit Google tutorial toast',()=>{
  const r=rewards();let n=nation();
  for(let i=0;i<20;i++){
    assert.deepEqual(r.save(n),[]);
    assert.ok(!n.tut?.lc?.includes('google'));
    n=r.reload(n); // the next save may come from a reload or another device
  }
  assert.equal(n.glk,1);
  assert.equal(n.stock.goods,40);
});

test('linking still pays its dedicated reward once and remains paid after reloading',()=>{
  const r=rewards();let n=nation({glk:undefined});
  const first=r.save(n);
  assert.equal(first.length,1);assert.match(first[0],/Google account\. \+5 land credits/);
  assert.equal(n.glk,1);
  assert.deepEqual(n.stock,{food:60,timber:50,iron:30,oil:10,goods:45});
  for(let i=0;i<5;i++){n=r.reload(n);assert.deepEqual(r.save(n),[]);}
  assert.equal(n.stock.goods,45);
});

test('ordinary steps still earn their credits once, including on a linked nation',()=>{
  const r=rewards();let n=nation({dec:1,loc:3});
  assert.match(r.save(n)[0],/earned 2 land credits/);
  assert.deepEqual([...n.tut.lc],['issue','settle']);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
  n.deals=[{id:'trade'}];assert.match(r.save(n)[0],/Propose a trade\. \+1 land credit/);
  n=r.reload(n);assert.deepEqual(r.save(n),[]);
});

test('a legacy generic Google marker is safely removed without replaying either reward',()=>{
  const r=rewards();let n=r.reload(nation({tut:{lc:['google','settle']},loc:3}));
  assert.deepEqual([...n.tut.lc],['settle']);
  assert.deepEqual(r.save(n),[]);assert.equal(n.stock.goods,40);
});
