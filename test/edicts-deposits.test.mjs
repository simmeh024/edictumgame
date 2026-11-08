// Thirty edicts that find iron, oil or timber near a city: one answer each carries dep, which geoAfter turns into a
// deposit on the city with fewest of that kind (n.dep), and nbCity counts as land yield, multiplied by the city's buildings.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── thirty edicts that find iron, oil or timber',END='/* ───────── the browser tab';

function game(){
  const ctx=vm.createContext({
    ISSUES:Array.from({length:100},(_,i)=>({id:'x'+i})),ISSUE_BY_ID:{},ISSUES_RANDOM:[],NORM_HOOKS:[],
    BUILDINGS:{mine:{res:{iron:[1,0]}},oilwell:{res:{oil:[1.5,0]}},school:{}},CX_LV:[1,1.2],
    nbCity:(a)=>{a.base=true;},geoAfter:()=>[],cityLabel:(n,c)=>c.nm,resName:r=>r
  });
  const a=source.indexOf(START),b=source.indexOf(END,a);
  assert.ok(a>0&&b>a,'the section sits just before the browser tab');
  vm.runInContext(source.slice(a,b)+'\nthis.DEP=DEP_ISSUES;',ctx);
  return ctx;
}
const nation=()=>({cities:[{id:'c1',nm:'Port',c:5},{id:'c0',nm:'Capital',c:1,cap:true}]});

test('thirty edicts, ten of each kind, numbered after the rest, with one keeping answer each',()=>{
  const G=game(),D=G.DEP;
  assert.equal(D.length,30);assert.equal(new Set(D.map(i=>i.id)).size,30);
  for(const r of ['iron','oil','timber'])assert.equal(D.filter(i=>i.o.some(o=>o.e.dep===r)).length,10,r);
  for(const is of D){
    assert.equal(is.o.length,3);assert.equal(is.o.filter(o=>o.e.dep).length,1,is.id);
    assert.ok(is.nr&&G.ISSUE_BY_ID[is.id]===is&&G.ISSUES_RANDOM.includes(is));
    assert.equal(is.req({cities:[]}),false);assert.equal(is.req(nation()),true);
    assert.ok(!/['"]/.test(is.t+is.q+is.o.map(o=>o.t+o.fx).join('')),'typographic quotes only: '+is.id);
  }
  assert.equal(D[0].no,101);assert.equal(D[29].no,130);
  assert.match(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8'),/'DEP_ISSUES'/);
});

test('the find goes to the capital first, then the city with fewest, at most two of a kind',()=>{
  const G=game(),n=nation(),opt={e:{dep:'oil'}};
  const notes=[];for(let i=0;i<5;i++)notes.push(...G.geoAfter(n,opt,{},0));
  assert.deepEqual(JSON.parse(JSON.stringify(n.dep)),{c0:{oil:2},c1:{oil:2}});
  assert.match(notes[0][1],/near Capital: \+5 oil/);assert.match(notes[1][1],/near Port/);
  assert.match(notes[4][1],/already has 2/);
  assert.equal(G.geoAfter({cities:[]},opt,{},0)[0][1],'You have no city to give it to yet.');
  assert.equal(G.geoAfter(nation(),{e:{econ:1}},{},0).length,0);
});

test('a deposit yields like land, multiplied by the city’s own buildings, and survives a save only for real cities',()=>{
  const G=game(),n={...nation(),dep:{c0:{iron:1,timber:2}}};
  const a={add:{iron:0,oil:0,timber:0}};
  G.nbCity(a,{rec:{id:'c0'},done:['mine','school'],ug:{mine:1},mk:1},{n},null);
  assert.ok(a.base);assert.equal(a.add.iron,3+3*1.2);assert.equal(a.add.timber,6);
  const b={add:{iron:0,oil:0,timber:0}};G.nbCity(b,{rec:{id:'c0'},done:[]},{n,npc:true},null);assert.equal(b.add.iron,0);
  const m=nation();G.NORM_HOOKS[0](m,{dep:{c0:{iron:9,oil:-1},gone:{iron:1},c1:'x'}});
  assert.deepEqual(JSON.parse(JSON.stringify(m.dep)),{c0:{iron:2}});
  const e=nation();G.NORM_HOOKS[0](e,{});assert.equal(e.dep,undefined);
  assert.equal(G.depOf(n,{rec:{id:'c0'}}).timber,2);
});

test('an oil deposit lets a city build Oil Wells',()=>{
  assert.ok(source.includes("if(B.need==='oil'&&!ct.dist.some(c=>CELL_RES.oil[c]>0)&&!depOf(n,ct).oil)"));
});
