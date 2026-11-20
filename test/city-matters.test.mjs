// A city's matters: 87 of them since 2026-11-20 (75 added to the first 12), each city going through all of them once,
// in an order of its own, before any comes round again, and no two of a nation's cities bringing the same matter at
// once. The game's own code, evaluated piece by piece.
// Run with: node --test test/city-matters.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,NOW=1_800_000_000_000;

function load(){
  const ctx={DAY,myId:()=>'me',territory:()=>({list:[{id:'me'}]}),cityList:n=>n.cities};
  vm.createContext(ctx);
  vm.runInContext([line('function hash(str)'),line('function rng(seed)'),line('const RES='),cut('const STATS = {','\n};')+'\n};',
    cut('const CX_EVENTS=[','const CX_LETTERS'),cut('function cxCityExtras(','function cxUps('),line('function cxEvAt(ct)'),
    cut('const CX_EV_ORD=new Map();','const cxFill=')].join('\n')+'\nthis.G={RES,STATS,CX_EVENTS,cxCityExtras,cxEvDue,cxEvPos,cxEvAtPos,cxEvOrder};',ctx);
  return ctx.G;
}
const G=load(),EV=G.CX_EVENTS;
/* a nation's cities as the Cities page sees them: rec is the city's record, fn the nation that holds it */
const nation=recs=>({cities:recs.map(r=>Object.assign({t:NOW-10*DAY,ne:NOW-1000},r))});
const ctOf=(n,id)=>({id,fid:'me',active:true,hi:0,rec:n.cities.find(c=>c.id===id),fn:n});
/* answering, as cxAnswer does it: the next matter in two to three days, and the city moved on past the one answered */
const answer=(n,id,now)=>{const ct=ctOf(n,id),p=G.cxEvPos(ct,now);ct.rec.en=p+1;ct.rec.ne=now+2*DAY;return p;};

test('75 matters join the first 12, each with its own key',()=>{
  assert.equal(EV.length,87);
  assert.equal(new Set(EV.map(e=>e.k)).size,87,'no two matters share a key');
  for(const k of ['fire','festival','strike','harvest','bridge','caravan','school','flood','statue','hat','square','choir'])assert(EV.some(e=>e.k===k),`${k} is still there`);
  assert.equal(new Set(EV.map(e=>e.t)).size,87,'no two titles are the same');
});

test('every matter is written the same way: the city named in the title, two answers, figures in range',()=>{
  const good=new Set(Object.keys(G.STATS).filter(k=>G.STATS[k].g===1));
  for(const e of EV){
    assert.match(e.t,/\{C\}/,`${e.k}: the title names the city`);
    assert(!/\{C\}/.test(e.b+e.o.map(o=>o.r).join('')),`${e.k}: only the title is filled in with the city's name`);
    assert(e.b&&e.b.length<=140,`${e.k}: a short body`);
    assert.equal(e.o.length,2,`${e.k}: two answers`);
    for(const o of e.o){
      assert(o.l&&o.l.length<=24,`${e.k}: “${o.l}” fits a button`);
      assert(o.r&&o.r.length<=110,`${e.k}: “${o.r}” fits a toast`);
      assert(Number.isInteger(o.m||0)&&Math.abs(o.m||0)<=8,`${e.k}: mood within ±8`);
      for(const x of [o.c,o.g].filter(Boolean))for(const [r,v] of Object.entries(x)){
        assert(G.RES.includes(r),`${e.k}: ${r} is a resource`);assert(Number.isInteger(v)&&v>0&&v<=15,`${e.k}: ${r} ${v} is a small amount`);}
      if(o.s)for(const [k,v] of Object.entries(o.s))assert(good.has(k)&&v===1,`${e.k}: ${k} is a small lift for the nation`);
    }
  }
});

test('each new matter can be answered from an empty stockpile',()=>{
  for(const e of EV.slice(12))assert(e.o.some(o=>!o.c),`${e.k} has an answer that costs nothing`);
});

test('a city brings every matter once before any comes round again',()=>{
  const n=nation([{id:'cap'}]),seen=[];
  for(let i=0;i<87;i++){const now=NOW+i*3*DAY;n.cities[0].ne=now-1;seen.push(G.cxEvDue(ctOf(n,'cap'),now).k);answer(n,'cap',now);}
  assert.equal(new Set(seen).size,87,'87 answers, 87 different matters');
  assert.equal(n.cities[0].en,87);
  const next=G.cxEvDue(ctOf(n,'cap'),NOW+400*DAY);assert(next&&EV.includes(next),'and then a fresh round starts');
});

test('the order is the city’s own: another city, or the same city id in another nation, goes another way',()=>{
  const run=(fid,cid)=>Array.from({length:10},(_,p)=>G.cxEvAtPos(fid,cid,p)).join();
  assert.notEqual(run('me','cap'),run('me','c1'));
  assert.notEqual(run('me','cap'),run('them','cap'),'every nation’s capital is called cap');
  assert.equal(run('me','cap'),run('me','cap'),'and the same city always goes the same way');
  assert.notEqual(Array.from({length:87},(_,p)=>G.cxEvAtPos('me','cap',p)).join(),Array.from({length:87},(_,p)=>G.cxEvAtPos('me','cap',87+p)).join(),'each round is shuffled afresh');
});

test('two cities never bring the same matter at once: the later one in the list brings the next on its own list',()=>{
  const want=G.cxEvAtPos('me','cap',0);let p=0;while(G.cxEvAtPos('me','c1',p)!==want)p++;
  const n=nation([{id:'cap'},{id:'c1',en:p}]);
  const a=G.cxEvDue(ctOf(n,'cap'),NOW),b=G.cxEvDue(ctOf(n,'c1'),NOW);
  assert.equal(a,EV[want],'the capital, first in the list, keeps its matter');
  assert.notEqual(b,a,'the second city brings another');
  assert.equal(b,EV[G.cxEvAtPos('me','c1',p+1)],'the one after on its own list');
  /* answered, the second city moves on past the one it brought, so the skipped one does not follow straight after */
  assert.equal(answer(n,'c1',NOW),p+1);assert.equal(n.cities[1].en,p+2);
  /* a city whose matter is not due yet holds nothing back */
  const m=nation([{id:'cap',ne:NOW+DAY},{id:'c1',en:p}]);
  assert.equal(G.cxEvDue(ctOf(m,'c1'),NOW),EV[want]);
  assert.equal(G.cxEvDue(ctOf(m,'cap'),NOW),null);
});

test('many cities at once all bring different matters',()=>{
  const recs=Array.from({length:33},(_,i)=>({id:i?'c'+i:'cap',en:i%3}));
  const n=nation(recs),ks=recs.map(r=>G.cxEvDue(ctOf(n,r.id),NOW).k);
  assert.equal(new Set(ks).size,33);
});

test('a record from before starts at the beginning, and the count is kept on save',()=>{
  const n=nation([{id:'cap'}]);
  assert.equal(G.cxEvDue(ctOf(n,'cap'),NOW),EV[G.cxEvAtPos('me','cap',0)]);
  assert.equal(G.cxCityExtras({en:12,ne:5}).en,12);
  for(const bad of [0,-3,1.5,'4',null])assert.equal(G.cxCityExtras({en:bad}).en,undefined,`en ${bad} is not kept`);
  assert.equal(G.cxCityExtras({en:5e9}).en,1e6);
});

test('the answer buttons carry the matter, and an answer to one that has since changed is not applied',()=>{
  assert.match(source,/data-act="cx-ev" data-id="\$\{esc\(ct\.id\)\}" data-i="\$\{i\}" data-k="\$\{esc\(ev\.k\)\}"/);
  assert.match(source,/cxAnswer\(id,\+el\.dataset\.i,el\.dataset\.k\)/);
  const f=cut('function cxAnswer(cid,i,k){','function cxBuildRoad(');
  assert.match(f,/if\(k&&ev\.k!==k\)\{S\.cityMsg=[^\n]*?render\(\);return;\}\n  const pos=cxEvPos\(ct,now\);/);
  assert.match(f,/c\.en=pos\+1;/);
});
