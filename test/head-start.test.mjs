// The head start: days back paying land credits, and nations founded before it paid back once, as the save hooks run them.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function fn(name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  let i=source.indexOf('{',start),depth=0;
  for(;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)break;}
  return source.slice(start,i+1);
}
const line=start=>{const i=source.indexOf(start);assert.ok(i>=0,start);return source.slice(i,source.indexOf('\n',i));};
const NOW=new Date(2026,10,7,12,0,0).getTime(),DAY=864e5,BASE=10;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),eq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);
function headStart(){
  const start=source.indexOf('/* ───────── a head start:'),end=source.indexOf('/* opening the game on a new day is enough',start);
  assert.ok(start>0&&end>start);
  const ctx=vm.createContext({COMMIT_HOOKS:[],NORM_HOOKS:[],DAY,FOUND_CREDITS:7,landEarned:()=>BASE,earnedAt:()=>BASE,
    TUT_LISTS:[{k:'charter',c:'c',bonus:{lc:3}},{k:'first',c:'f',bonus:{lc:2}}],
    stockNow:n=>({...n.stock}),stockLimit:(n,r,v)=>Math.min(400,v),roundStock:s=>({...s}),num0:v=>Number.isFinite(v)?v:0});
  vm.runInContext([fn('list'),line('const tutLcOf='),line('const tutChOf='),line('const DD_GIFT='),line('const DD_WEEK='),line('const ddwOf='),
    fn('ddDay'),line('const ddLater='),line('const stkDays='),source.slice(start,end),
    'this.T={earned:n=>landEarned(n),at:n=>earnedAt(n,5),ddDay,hsOwed};'].join('\n'),ctx);
  return {...ctx.T,
    save(n,old,now=NOW){const out=[];for(const h of ctx.COMMIT_HOOKS){const m=h(n,old,now);if(m)out.push(...m);}return out;},
    reload(n){const d=JSON.parse(JSON.stringify(n)),o={...d};delete o.hst;delete o.wbk;for(const h of ctx.NORM_HOOKS)h(o,d);return o;}};
}
const nation=over=>({name:'Startland',founded:NOW-3600e3,stock:{goods:20},...over});
const step=(H,n,now)=>{const old=structuredClone(n),m=structuredClone(n);return [m,H.save(m,old,now)];};

test('a new nation counts its founding day as day one, without a note',()=>{
  const H=headStart(),n=nation();
  eq(H.save(n,null),[]);assert.equal(n.hst,1);eq(n.wbk,{n:1,d:H.ddDay(NOW)});
  assert.equal(H.earned(n),BASE);
  let [m,notes]=step(H,n,NOW+60e3);eq(notes,[],'a second save the same day pays nothing');
});

test('the second and third days back pay two land credits each, once, and never more',()=>{
  const H=headStart();let n=nation();H.save(n,null);
  let [m,notes]=step(H,n,NOW+DAY);
  eq(notes,['Welcome back to Startland: your second day brings 2 land credits. Spend them on the map.']);
  assert.equal(m.wbk.n,2);assert.equal(H.earned(m),BASE+2);assert.equal(H.at(m),BASE+2);
  [m,notes]=step(H,m,NOW+DAY+3600e3);eq(notes,[],'the same day again');
  m=H.reload(m);[m,notes]=step(H,m,NOW+5*DAY);assert.match(notes[0],/your third day brings 2 land credits/);
  assert.equal(H.earned(m),BASE+4);
  [m,notes]=step(H,m,NOW+6*DAY);eq(notes,[]);assert.equal(m.wbk.n,3);assert.equal(H.earned(m),BASE+4);
  m=H.reload(m);assert.equal(H.earned(m),BASE+4,'kept on reload');
});

test('a device whose date is behind does not count as a new day',()=>{
  const H=headStart();let n=nation();H.save(n,null,NOW+DAY);
  const [m,notes]=step(H,n,NOW);eq(notes,[]);eq(m.wbk,{n:1,d:H.ddDay(NOW+DAY)});
});

test('a nation founded before the head start is paid it back once, with one note',()=>{
  const H=headStart(),founded=NOW-10*DAY; // 28 October: its first week ran into the desk's first days (from 30 October)
  const old=nation({name:'Oldland',founded,fdc:1,ddc:5,stk:{n:4,d:H.ddDay(NOW-DAY)},tut:{lc:['settle','city','ruler','issue'],ch:'c'}});
  const n=structuredClone(old),notes=H.save(n,old);
  eq(notes,['A bigger head start, paid back to Oldland: +16 land credits (4 from the larger founding grant, 3 for the finished charter, '+
    '5 more for desks cleared in your first week, and 4 for coming back on a second and a third day), and 6 goods for the charter steps you had done. Spend them on the map.']);
  assert.equal(n.hst,1);assert.equal(n.ddw,5);eq(n.wbk,{n:3,d:H.ddDay(NOW)});assert.equal(n.stock.goods,26);
  assert.equal(H.earned(n),BASE+4,'the days back (the desks, founding and charter credits are counted by their own wrappers)');
  let [m,again]=step(H,n,NOW+60e3);eq(again,[]);assert.equal(m.stock.goods,26,'the goods are paid once');
  m=H.reload(m);[m,again]=step(H,m,NOW+DAY);eq(again,[]);assert.equal(m.hst,1);assert.equal(H.earned(m),BASE+4);
});

test('the back pay counts only what the record shows',()=>{
  const H=headStart();
  /* founded before the desk existed: its first week had no desk to clear */
  let o=H.hsOwed({},nation({founded:new Date(2026,9,20).getTime(),ddc:10}),NOW);assert.equal(o.dd,0);
  /* never more first-week desks than desks cleared, nor than days in the week */
  o=H.hsOwed({},nation({founded:NOW-2.5*DAY,ddc:9}),NOW);assert.equal(o.dd,3);
  o=H.hsOwed({},nation({founded:NOW-12*DAY,ddc:2}),NOW);assert.equal(o.dd,2);
  /* founded today and nothing else known: day one, nothing owed for days back */
  o=H.hsOwed({},nation(),NOW);assert.equal(o.days,1);assert.equal(o.wb,0);
  /* founded yesterday: today is the second day */
  o=H.hsOwed({},nation({founded:NOW-DAY}),NOW);assert.equal(o.days,2);assert.equal(o.wb,2);
  /* a nation without the old founding grant is told about it by the first-land note, not this one */
  o=H.hsOwed({},nation({fdc:undefined}),NOW);assert.equal(o.fd,0);
  /* the goods are for the charter's steps only (the first city paid its own goods) */
  o=H.hsOwed({},nation({tut:{lc:['settle','city','charter','ruler','culture','flag','cust','issue','land']}}),NOW);assert.equal(o.goods,18);
  /* desks already paid double this save count against the most a week holds */
  o=H.hsOwed({ddw:7},nation({founded:NOW-6*DAY,ddc:6}),NOW);assert.equal(o.dd,1);
});

test('a new nation is not mistaken for the one it replaced',()=>{
  const H=headStart(),prev=nation({name:'Gone',founded:NOW-40*DAY,fdc:1,ddc:9,stk:{n:9,d:'2026-11-01'}});
  const n=nation({name:'Fresh'});eq(H.save(n,prev),[]);eq(n.wbk,{n:1,d:H.ddDay(NOW)});assert.equal(n.ddw,undefined);
});

test('nothing is owed when nothing was earned, and a lost day count never pays twice',()=>{
  const H=headStart(),old=nation({fdc:undefined});const n=structuredClone(old);
  eq(H.save(n,old),[]);assert.equal(n.hst,1);
  const lost=nation({hst:1});eq(H.save(lost,structuredClone(lost),NOW+DAY),[]);eq(lost.wbk,{n:3,d:H.ddDay(NOW+DAY)});
  assert.equal(H.earned(lost),BASE+4,'counted as paid');
});

test('saved markers are kept only within their bounds',()=>{
  const H=headStart();
  eq(H.reload({hst:1,wbk:{n:2,d:'2026-11-07'}}),{hst:1,wbk:{n:2,d:'2026-11-07'}});
  for(const bad of [{hst:2},{hst:'1'},{wbk:{n:0,d:'2026-11-07'}},{wbk:{n:4,d:'2026-11-07'}},{wbk:{n:1.5,d:'2026-11-07'}},{wbk:{n:2,d:'today'}},{wbk:[2]}]){
    const o=H.reload(bad);assert.equal(o.hst,undefined,JSON.stringify(bad));assert.equal(o.wbk,undefined,JSON.stringify(bad));}
});
