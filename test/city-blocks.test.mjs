// City building blocks: the gentler population curve (each block 1.45 times the people of the one before) and the
// milestone blocks on top of it (a city's age, buildings in gold, gold Housing Estates, the titles Town, Great City and
// Metropolis, and the capital's edicts decided). The game's own code, evaluated piece by piece.
// Run with: node --test test/city-blocks.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,YEAR_MS=2*DAY,NOW=1_800_000_000_000;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),deq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);

function load(){
  const ctx={DAY,YEAR_MS,COMMIT_HOOKS:[],BUILDINGS:{farm:{},sawmill:{},market:{},housing:{},mine:{},factory:{},harbour:{},hospital:{},theatre:{},university:{},barracks:{},fortress:{}},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),fmt0:v=>Math.round(v).toLocaleString('en-US'),cap1:s=>s?s[0].toUpperCase()+s.slice(1):s,
    list:a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1],fmtDate:t=>new Date(t).toISOString().slice(0,10),
    decisions:n=>n.dec||0,cpPop:ct=>ct.pop||0,cpDoc:ct=>ct.fn,cellOf:l=>l==null?-1:l,myId:()=>'me',cityLabel:(n,c)=>c.nm,
    c3CleanName:s=>s,CX_TRAITS:{},paidClean:()=>null,esc:s=>s};
  vm.createContext(ctx);
  vm.runInContext([
    cut('const BLK_MAX=','/* a city population, in millions'),
    cut('function blkOf(','function blkUsed('),
    cut('/* city titles: a save that finds','/* the achievement No Vacancies'),
    cut('/* ug: upgrade blocks filled','function cxWallLv(')
  ].join('\n')+'\nthis.BLK_R=BLK_R;this.BLK_NEED=BLK_NEED;this.BLK_MAX=BLK_MAX;this.BLK_TI=BLK_TI;',ctx);
  return ctx;
}
const G=load();vm.runInContext("Date.now=()=>"+NOW,G);
/* a city as cityState builds it: its record (t, ti, b), its founder's record (founded, dec), finished buildings and their upgrades */
const city=(o={})=>{
  const rec={id:o.id||'c1',c:o.c??10,nm:o.nm||'Ashford',t:o.t??NOW-DAY,b:o.b||[]};if(o.ti!=null)rec.ti=o.ti;
  return {id:rec.id,c:rec.c,nm:rec.nm,cap:!!o.cap,fid:'me',fn:{founded:o.founded??NOW-DAY,dec:o.dec||0,blk:o.blk},npc:false,rec,
    done:o.done||[],prog:[],ug:o.ug||{},pop:o.pop||0,active:true,hi:0};
};

test('the curve is gentler: each block needs 1.45 times the people of the one before',()=>{
  assert.equal(G.BLK_R,1.45);
  deq([6,7,8,10,12,15,20,25].map(b=>G.BLK_NEED[b]),[2,2.9,4.2,8.8,19,57,360,2300],'people (millions) for 6, 7, 8, 10, 12, 15, 20 and 25 blocks');
  assert.equal(G.blkBase(0.5,true),6,'a capital has at least six');
  assert.equal(G.blkBase(0.5,false),4,'any other city at least four');
  assert.equal(G.blkBase(1.4,false),5);
  assert.equal(G.blkBase(8.8,true),10,'ten blocks at 8.8 million (13 million on the old curve)');
  assert.equal(G.blkBase(1e6,true),25,'never more than 25');
});

test('age: +1 at 5, 15 and 45 years (10, 30 and 90 days), a capital counting from its nation’s founding',()=>{
  const at=(days,o={})=>G.blkMs(city({t:NOW-days*DAY,...o}),null,NOW).age;
  assert.equal(at(9.9).g,0);assert.equal(at(10).g,1);assert.equal(at(30).g,2);assert.equal(at(90).g,3);assert.equal(at(400).g,3);
  assert.equal(at(12).nx,NOW-12*DAY+30*DAY,'the next block on the day the city turns 15');
  assert.equal(at(95).nx,null,'nothing after 45 years');
  assert.equal(G.blkMs(city({cap:true,t:NOW-DAY,founded:NOW-31*DAY}),null,NOW).age.g,2,'the capital is as old as the nation');
  assert.equal(G.blkMs(city({t:0,founded:NOW-11*DAY}),null,NOW).age.g,1,'a record without a time counts from the founding');
});

test('buildings in gold: +1 for every three, up to +2; gold Housing Estates +1 more',()=>{
  const ms=(done,ug)=>G.blkMs(city({done,ug}),null,NOW);
  const six=['farm','sawmill','market','mine','factory','harbour'],gold=k=>Object.fromEntries(k.map(x=>[x,5]));
  assert.equal(ms(six.slice(0,2),gold(six.slice(0,2))).gold.g,0);
  deq(ms(six.slice(0,3),gold(six.slice(0,3))).gold,{g:1,have:3,nx:6});
  deq(ms(six,gold(six)).gold,{g:2,have:6,nx:null});
  assert.equal(ms(six,{...gold(six.slice(0,5)),harbour:4}).gold.g,1,'a purple building is not gold');
  assert.equal(ms(['housing'],{housing:5}).high.g,1);
  deq(ms(['housing'],{housing:3}).high,{g:0,have:3});
  deq(ms(['farm'],{}).high,{g:0,have:-1},'no Housing Estates');
  assert.equal(ms(['housing','farm','market'],{housing:5,farm:5,market:5}).v,2,'gold housing counts for both');
});

test('titles and edicts decided',()=>{
  assert.equal(G.blkMs(city({ti:2}),null,NOW).ti.g,2);
  assert.equal(G.blkMs(city({ti:2}),null,NOW).ti.nx.n,'Metropolis');
  assert.equal(G.blkMs(city({ti:9}),null,NOW).ti.g,3,'never more than three');
  assert.equal(G.blkMs(city({ti:'2'}),null,NOW).ti.g,0);
  const dec=(d,cap=true)=>{const ct=city({cap,dec:d});return G.blkMs(ct,ct.fn,NOW).dec;};
  assert.equal(dec(249).g,0);deq(dec(250),{g:1,have:250,nx:500});assert.equal(dec(1999).g,3);deq(dec(5000),{g:4,have:5000,nx:null});
  assert.equal(dec(5000,false),null,'edicts count for the capital only');
});

test('a city’s blocks: the curve, the edicts’ bonus and the milestones, never more than 25',()=>{
  const ct=city({cap:true,pop:2.9,t:NOW-DAY,founded:NOW-11*DAY,dec:300,ti:1,blk:{all:1,cap:1}});
  const b=G.blkOf(ct);
  assert.equal(b.base,7);assert.equal(b.add,2);assert.equal(b.ms.v,3,'5 years, 250 edicts and the title Town');assert.equal(b.n,12);
  deq(G.blkMsGot(b.ms),['5 years standing','the title Town','250 edicts decided']);
  assert.equal(G.blkOf(city({cap:true,pop:5000,founded:NOW-100*DAY,dec:3000,ti:3})).n,25);
  const npc=Object.assign(city({pop:2.9,ti:3}),{npc:true});assert.equal(G.blkOf(npc).n,7,'computer-run cities get the curve only');
  const rows=G.blkMsRows(ct,b.ms);
  deq(rows.map(r=>r.slice(1)),[[1,3],[0,2],[0,1],[1,3],[1,4]],'age, gold, high-rise flats, titles, edicts: given and at most');
  assert.match(rows[0][0],/^Age: \+1 at 5, 15 and 45 years \(10, 30 and 90 days\)\. Ashford is 5 years old; the next block comes on /);
  assert.match(rows[3][0],/Next: Great City, with at least 10 buildings\.$/);
});

test('a title comes when a finished building stands on every block, one step a save',()=>{
  const fin=k=>k.map(x=>({k:x,s:NOW-2*DAY,d:NOW-DAY})),six=['farm','sawmill','market','mine','factory','harbour'];
  const run=(rec,ct,o={})=>{
    const n={name:'Eternia',loc:5,cities:[rec]},T={byId:{me:o.hi??0}};
    G.cityState=()=>({all:[ct]});G.territory=()=>T;
    return {due:G.blkTiDue(n,T,NOW),toasts:G.COMMIT_HOOKS[0](n,null,NOW),rec};
  };
  /* a capital of six blocks, all six built: Town */
  let ct=city({cap:true,pop:1,b:fin(six),done:six}),r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,1);deq(r.toasts,['Ashford is now a Town: a finished building stands on every block, and the title adds one more.']);
  /* with the Town's block still empty, nothing more */
  ct=city({cap:true,pop:1,b:fin(six),done:six,ti:1});r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,1);deq(r.toasts,[]);
  /* five buildings on a city of five blocks: full, but a Town needs six */
  const five=six.slice(0,5);ct=city({pop:1.4,b:fin(five),done:five});r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,undefined);
  /* a building still going up does not count */
  ct=city({cap:true,pop:1,b:fin(five).concat({k:'harbour',s:NOW,d:NOW+DAY}),done:five});ct.prog=[ct.rec.b[5]];r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,undefined);
  /* a city someone else holds earns nothing */
  ct=city({cap:true,pop:1,b:fin(six),done:six});ct.hi=3;r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,undefined);
  /* Great City needs ten buildings on every block */
  const ten=Object.keys(G.BUILDINGS).slice(0,10);
  ct=city({cap:true,pop:4.2,ti:1,b:fin(ten.slice(0,9)),done:ten.slice(0,9)});r=run(structuredClone(ct.rec),ct);
  assert.equal(G.blkOf(ct).n,9);assert.equal(r.rec.ti,1,'nine on nine blocks is not enough');
  ct=city({cap:true,pop:4.2,ti:1,blk:{cap:1},b:fin(ten),done:ten});r=run(structuredClone(ct.rec),ct);
  assert.equal(r.rec.ti,2);assert.match(r.toasts[0],/is now a Great City/);
});

test('the title is kept on the city record, 1 to 3',()=>{
  assert.equal(G.cxCityExtras({ti:2}).ti,2);
  assert.equal(G.cxCityExtras({ti:5}).ti,3);
  for(const v of [0,-1,'2',1.5,null])assert.equal(G.cxCityExtras({ti:v}).ti,undefined,String(v));
});

test('the page says so: the Help entry, the Housing Estates and the card',()=>{
  assert.match(line("  housing:{n:'Housing Estates'"),/Upgraded to gold, its high-rise flats give the city one more building block\./);
  assert.match(cut('function blkHelp(','/* ───────── helpers for issue conditions'),/Cities earn more blocks with milestones too/);
  assert.match(cut('function blkCard(','function cpCardPop('),/data-keep="blkMx"/);
  assert.match(source,/k==='blkMx'\)S\[k\]=d\.open/,'the open details survive a redraw');
});
