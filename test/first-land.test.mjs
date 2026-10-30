// The first land: founding credits, city credits paid once, and the 7 million city, as the game defines them.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const BASE=10;
function credits(){
  const start=source.indexOf('const FOUND_CREDITS='),end=source.indexOf('/* ── the ceremony ── */',start);
  assert.ok(start>0&&end>start);
  const ctx=vm.createContext({NORM_HOOKS:[],COMMIT_HOOKS:[],MAX_CITIES:14,landEarned:()=>BASE,earnedAt:()=>BASE,cellOf:v=>Number.isInteger(v)?v:-1});
  vm.runInContext(source.slice(start,end)+'\nthis.earned=n=>landEarned(n);this.at=(n,p)=>earnedAt(n,p);',ctx);
  return {
    earned:n=>ctx.earned(n),at:n=>ctx.at(n,5),
    save(n,old){const messages=[];for(const hook of ctx.COMMIT_HOOKS){const m=hook(n,old,Date.now());if(m)messages.push(...m);}return messages;},
    reload(n){const d=JSON.parse(JSON.stringify(n)),out={...d};delete out.fdc;delete out.ctc;for(const h of ctx.NORM_HOOKS)h(out,d);return out;}
  };
}
const CAP=5,city=(c,nm)=>({id:'c'+c,c,nm,b:[]});
const nation=over=>({name:'Firstland',loc:CAP,cities:[city(CAP,'')],...over});

test('a new nation is founded with three land credits, without a note',()=>{
  const r=credits(),n=nation();
  assert.deepEqual(r.save(n,null),[]);
  assert.equal(n.fdc,1);assert.equal(r.earned(n),BASE+3);assert.equal(r.at(n),BASE+3);
  assert.equal(r.earned(r.reload(n)),BASE+3);
});

test('a nation founded earlier gets its three credits once, with a note',()=>{
  const r=credits();let n=nation();
  assert.equal(r.earned(n),BASE);
  const m=r.save(n,nation());
  assert.equal(m.length,1);assert.match(m[0],/founded with 3 land credits, and Firstland has its 3/);
  for(let i=0;i<3;i++){n=r.reload(n);assert.deepEqual(r.save(n,structuredClone(n)),[]);}
  assert.equal(r.earned(n),BASE+3);
});

test('each city founded earns two credits, and founding again after abandoning pays nothing',()=>{
  const r=credits();let n=nation({fdc:1});
  const before=structuredClone(n);n.cities.push(city(9,'Bellmouth'));
  assert.deepEqual(r.save(n,before),['Founding Bellmouth earned 2 land credits. Spend them on the map.']);
  assert.equal(n.ctc,1);assert.equal(r.earned(n),BASE+5);
  let old=structuredClone(n);n.cities=n.cities.filter(c=>c.c!==9);
  assert.deepEqual(r.save(n,old),[]);assert.equal(r.earned(n),BASE+5,'abandoning keeps the credits');
  old=structuredClone(n);n.cities.push(city(12,'Bellmouth Again'));
  assert.deepEqual(r.save(n,old),[],'refounding does not pay twice');assert.equal(n.ctc,1);
  n=r.reload(n);old=structuredClone(n);n.cities.push(city(15,'Seaford'));
  assert.match(r.save(n,old)[0],/Founding Seaford earned 2 land credits/);
  assert.equal(n.ctc,2);assert.equal(r.earned(n),BASE+7);
});

test('cities founded before the change are paid for once, with a note',()=>{
  const r=credits();let n=nation({fdc:1,cities:[city(CAP,''),city(9,'Bellmouth'),city(15,'Seaford')]});
  const m=r.save(n,structuredClone(n));
  assert.equal(m.length,1);assert.match(m[0],/\+4 for the 2 cities Firstland has founded/);
  n=r.reload(n);assert.deepEqual(r.save(n,structuredClone(n)),[]);assert.equal(r.earned(n),BASE+7);
});

test('a capital missing from the city list is not counted as a founded city',()=>{
  const r=credits(),n=nation({fdc:1,cities:[]});
  assert.deepEqual(r.save(n,structuredClone(n)),[]);assert.equal(n.ctc,undefined);
});

test('saved markers are kept only within their bounds',()=>{
  const r=credits();
  assert.deepEqual([r.reload({fdc:1,ctc:3}).fdc,r.reload({fdc:1,ctc:3}).ctc],[1,3]);
  for(const bad of [{fdc:2},{fdc:'1'},{ctc:0},{ctc:-1},{ctc:1.5},{ctc:14},{ctc:'3'}]){const o=r.reload(bad);assert.equal(o.fdc,undefined);assert.equal(o.ctc,undefined);}
});

test('a nation can found its second city at 7 million people',()=>{
  const start=source.indexOf('const MILESTONES='),end=source.indexOf('const fmtPopShort',start),ctx=vm.createContext({});
  vm.runInContext(source.slice(start,end)+'\nthis.M=MILESTONES;',ctx);
  const cities=p=>1+ctx.M.filter(m=>p>=m.p&&m.city).length;
  assert.equal(cities(6.9),1);assert.equal(cities(7),2);assert.equal(cities(8.5),3);
});
