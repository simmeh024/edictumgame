// A land credit from population growth is told by a toast: while the game is open, and once on the next visit.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const LAND=section('/* ───────── land credits: a toast when one arrives','/* ───────── keeping small');

/* budgetOf is the identity here: popNow's figure is the budget, so +1 "million" is one more credit */
function game({store=new Map(),view='nation',credits=1,paused=false}={}){
  const toasts=[],localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
  const ctx=vm.createContext({localStorage,toasts,OBS:null,S:{view,mode:''},CORE_HEXES:16,budgetOf:p=>Math.floor(p),popNow:n=>n.pop,cellOf:v=>Number.isInteger(v)?v:-1,
    lcPaused:()=>paused,landCredits:()=>credits,toast:m=>toasts.push(m)});
  vm.runInContext(LAND+'\nthis.check=(n,t)=>lcArrivalCheck(n,t);this.LCT=LCT;',ctx);
  return {check:n=>ctx.check(n,0),toasts,store,ctx};
}
const nation=over=>({name:'Ostravel',seed:'42',loc:5,pop:20,...over});

test('the first look on a device only notes the count: no toast',()=>{
  const g=game(),n=nation();
  assert.equal(g.check(n),0);assert.equal(g.check(n),0);
  assert.deepEqual(g.toasts,[]);
  assert.deepEqual(JSON.parse(g.store.get('edictum.lct')),{42:4});
});

test('a credit grown while the game is open gets a toast with the way to the map, of its own kind',()=>{
  const g=game({credits:1}),n=nation();g.check(n);
  n.pop=21.4;assert.equal(g.check(n),1);
  assert.equal(g.toasts.length,1);
  const t=g.toasts[0];
  assert.equal(t.m,'A land credit has arrived. Ostravel has 1 to spend.');
  assert.equal(t.k,'land');assert.deepEqual({...t.go},{v:'map',l:'Open the map'});
  assert.equal(g.check(n),0,'told once');assert.equal(g.toasts.length,1);
});

test('several at once are told together, with what there is to spend',()=>{
  const g=game({credits:5}),n=nation();g.check(n);
  n.pop=23;g.check(n);
  assert.equal(g.toasts[0].m,'3 land credits have arrived. Ostravel has 5 to spend.');
});

test('on the map page the toast says where to click instead of offering the map',()=>{
  const g=game({view:'map'}),n=nation();g.check(n);
  n.pop=21;g.check(n);
  assert.equal(g.toasts[0].m,'A land credit has arrived. Ostravel has 1 to spend: select a highlighted block next to your borders.');
  assert.equal(g.toasts[0].go,null);
});

test('credits grown since the last visit are told once on the next visit',()=>{
  const store=new Map(),n=nation();
  game({store}).check(n);
  n.pop=22.5;
  const g=game({store,credits:2});
  assert.equal(g.check(n),2);
  assert.equal(g.toasts[0].m,'2 land credits have arrived since your last visit. Ostravel has 2 to spend.');
  assert.equal(g.check(n),0);assert.equal(g.toasts.length,1);
  assert.equal(game({store}).check(n),0,'and not again on the visit after');
});

test('quiet when spent automatically, paused, nothing to spend, not on the map, or for an observer',()=>{
  for(const [why,opts,over] of [['auto',{},{autoLand:true}],['paused',{paused:true},{}],['none left',{credits:0},{}],['unplaced',{},{loc:null}]]){
    const g=game(opts),n=nation(over);g.check(n);n.pop=22;
    assert.equal(g.check(n),0,why);assert.deepEqual(g.toasts,[],why);
  }
  const g=game(),n=nation();g.ctx.OBS='terra';g.check(n);n.pop=22;g.check(n);assert.deepEqual(g.toasts,[]);
});

test('a fall in population lowers the mark, so regaining it is told again',()=>{
  const g=game(),n=nation();g.check(n);
  n.pop=19;g.check(n);assert.deepEqual(g.toasts,[]);
  n.pop=20;g.check(n);assert.equal(g.toasts.length,1);
});

test('the device keeps the last eight nations only, newest last',()=>{
  const store=new Map(),g=game({store});
  for(let i=0;i<10;i++)g.check(nation({seed:'s'+i}));
  const o=JSON.parse(store.get('edictum.lct'));
  assert.deepEqual(Object.keys(o),['s2','s3','s4','s5','s6','s7','s8','s9']);
});

test('a land toast is its own kind, so the first hour does not hold it back',()=>{
  const line=source.match(/function toastKind\(item\)\{[^\n]*\}/);assert.ok(line);
  const ctx=vm.createContext({TOAST_RW:/^Achievements? earned/});vm.runInContext(line[0]+'\nthis.kind=toastKind;',ctx);
  assert.equal(ctx.kind({m:'A land credit has arrived.',links:[],k:'land'}),'land');
  assert.equal(ctx.kind({m:'Achievements earned: x',links:[]}),'rw');
  assert.equal(ctx.kind({m:'Saved.',links:[]}),'');
});
