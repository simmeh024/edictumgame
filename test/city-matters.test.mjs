// A city's matters. 87 since 2026-11-20; round two (2026-11-28, from The Wandering Isles' suggestion) put them on a
// clock of their own, with up to two waiting and the city council deciding one left for two days; an answer's mood
// now holds for a day and fades over two, and answers add up (past ±10 at half, ±15 at most). Answers can also change
// the city's output, build speed or defence for a while, bring a sequel, need a building, or be a gamble; some matters
// come only to the coast, the hills, the capital or in wartime; and every eight to twelve days the whole nation gets one.
// The game's own code, evaluated piece by piece.
// Run with: node --test test/city-matters.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,HOUR=36e5,V2=Date.UTC(2026,10,28),NOW=V2+40*DAY;
const BLD=new Set([...cut('const BUILDINGS={','\n};').matchAll(/^ {2}([a-z]+):\{n:'/gm)].map(m=>m[1]));

/* a small map: every cell lowland, cell 5 on the coast, cell 7 in the hills */
const COAST=new Set([5]),T=new Uint8Array(100).fill(2);T[7]=3;
function load(extra={}){
  const ctx={DAY,console,Map,Set,WeakMap,
    myId:()=>'me',territory:()=>({list:[{id:'me'}]}),cityList:n=>n.cities,cellOf:l=>Number.isInteger(l)?l:-1,
    MAP:{T,nbr:new Int32Array(600).fill(-1)},isCoastal:c=>COAST.has(c),NORM_HOOKS:[],COMMIT_HOOKS:[],VS:[],
    vsAdd:(k,f)=>{ctx.VS.push([k,f]);return f;},document:{addEventListener(){}},S:{},
    esc:s=>String(s),c3Until:t=>'T'+t,c3When:t=>'at T'+t,fmtDate:t=>'D'+t,list:a=>a.join(', '),
    costText:c=>Object.entries(c).map(([r,v])=>v+' '+r).join(', '),lacking:(c,st)=>Object.entries(c).filter(([r,v])=>(st[r]||0)<v).map(([r,v])=>v-(st[r]||0)+' '+r),
    cityLabel:(n,c)=>c.nm||'Capital',BUILDINGS:Object.fromEntries([...BLD].map(k=>[k,{n:k}])),...extra};
  vm.createContext(ctx);
  vm.runInContext([line('function hash(str)'),line('function rng(seed)'),line('const clamp ='),line('const RES='),cut('const STATS = {','\n};')+'\n};',
    cut('const CX_EVENTS=[','const CX_LETTERS'),cut('function cxCityExtras(','function cxUps('),
    cut('/* ── city matters, round two','function cxBuildRoad(')].join('\n')+
    '\nthis.G={RES,STATS,CX_EVENTS,CX_NATION_EVENTS,CX_BY,cxCityExtras,cxArr,cxEvState,cxNwState,cxNwArr,cxPick,cxRipples,cxRipV,cxCouncilOpt,cxWarAt,cxTags,cxPool,cxAnswer,cxOptHint,cxNextAt,cxChClean,cxEvCard};',ctx);
  return ctx;
}
const ctx=load(),G=ctx.G,EV=G.CX_EVENTS,NW=G.CX_NATION_EVENTS;
const nation=(recs,o={})=>Object.assign({name:'Testland',founded:NOW-60*DAY,loc:0,cities:recs.map(r=>Object.assign({c:0,nm:'',t:NOW-30*DAY,b:[]},r))},o);
const ctOf=(n,id,done=[])=>{const rec=n.cities.find(c=>c.id===id);return {id,fid:'me',active:true,hi:0,c:rec.c,nm:rec.nm||'Capital',rec,fn:n,done};};
const arrivals=(n,id,from,to)=>G.cxArr(id,n.cities.find(c=>c.id===id),to).filter(x=>x.a>=from);
const stock=()=>({food:99,timber:99,iron:99,oil:99,goods:99});
/* a game with the answer's own surroundings stubbed: answering commits the nation it is given */
function answering(n){
  const out={saved:null};
  const c=load({S:{nation:n},cxHeld:id=>ctOf(c.S.nation,id),stockNow:x=>Object.assign({},x.stock),stockLimit:(x,r,v)=>v,roundStock:s=>s,applyEffects(){},
    clone:o=>JSON.parse(JSON.stringify(o)),ensureCities:x=>x,commit:x=>{out.saved=x;c.S.nation=x;},render(){},toast(t){out.toast=t;},Date:{now:()=>NOW,UTC:Date.UTC}});
  out.G=c.G;return out;
}

test('the matters are written the same way: the place named, two or three answers, figures in range',()=>{
  const good=new Set(Object.keys(G.STATS).filter(k=>G.STATS[k].g===1)),keys=new Set();
  const outcome=(e,o)=>{
    assert(o.r&&o.r.length<=110,`${e.k}: “${o.r}” fits a toast`);
    assert(Number.isInteger(o.m||0)&&Math.abs(o.m||0)<=8,`${e.k}: mood within ±8`);
    if(o.g)for(const [r,v] of Object.entries(o.g)){assert(G.RES.includes(r));assert(Number.isInteger(v)&&v>0&&v<=15,`${e.k}: ${r} ${v} is a small amount`);}
    if(o.x){assert(['out','bld','def'].includes(o.x.f),`${e.k}: output, build speed or defence`);assert(Number.isInteger(o.x.v)&&o.x.v&&Math.abs(o.x.v)<=15,`${e.k}: by up to 15%`);assert([24,48,72].includes(o.x.h),`${e.k}: for one to three days`);}
  };
  for(const [list,nw] of [[EV,false],[NW,true]])for(const e of list){
    assert(/^[a-z0-9]{1,16}$/.test(e.k)&&!keys.has(e.k),`${e.k}: a key of its own`);keys.add(e.k);
    assert.match(e.t,nw?/\{N\}/:/\{C\}/,`${e.k}: the title names the ${nw?'nation':'city'}`);
    assert(!/\{[CN]\}/.test(e.b+e.o.map(o=>o.r+(o.f?o.f.r:'')).join('')),`${e.k}: only the title is filled in`);
    assert(e.b&&e.b.length<=140,`${e.k}: a short body`);
    assert(e.o.length>=2&&e.o.length<=3,`${e.k}: two or three answers`);
    assert(!e.w||['coast','hills','cap','war'].includes(e.w),`${e.k}: a place it comes to`);
    assert(!(nw&&(e.w||e.sq)),`${e.k}: the nation's matters come anywhere, and are no sequels`);
    for(const o of e.o){
      assert(o.l&&o.l.length<=24,`${e.k}: “${o.l}” fits a button`);
      if(o.c)for(const [r,v] of Object.entries(o.c)){assert(G.RES.includes(r));assert(Number.isInteger(v)&&v>0&&v<=15,`${e.k}: costs ${r} ${v}`);}
      if(o.s)for(const [k,v] of Object.entries(o.s))assert(good.has(k)&&v===1,`${e.k}: ${k} is a small lift for the nation`);
      if(o.b){assert(BLD.has(o.b),`${e.k}: ${o.b} is a building`);assert(!nw,'the nation has no buildings of its own');}
      if(o.p!==undefined){assert(o.p>0&&o.p<1,`${e.k}: a gamble's odds`);assert(o.f&&o.f.r,`${e.k}: and what happens otherwise`);outcome(e,o.f);}
      else assert(!o.f,`${e.k}: no “otherwise” without a gamble`);
      if(o.n)assert(EV.some(x=>x.k===o.n&&x.sq),`${e.k}: ${o.n} is a sequel`);
      outcome(e,o);
    }
    assert(G.cxCouncilOpt(e)>=0,`${e.k}: the council can answer it: an answer that costs nothing and needs no building`);
  }
  assert.equal(EV.filter(e=>!e.sq&&!e.w).length,87,'the 87 matters every city may bring');
  for(const s of EV.filter(e=>e.sq))assert(EV.some(e=>e.o.some(o=>o.n===s.k)),`${s.k} is brought by an answer`);
  assert(EV.filter(e=>e.sq).length>=10&&NW.length>=10,'sequels, and matters for the nation');
  assert(EV.flatMap(e=>e.o).filter(o=>o.b).length>=15,'answers a building opens');
  assert(EV.concat(NW).flatMap(e=>e.o).filter(o=>o.p).length>=12,'gambles');
  for(const w of ['coast','hills','cap','war'])assert(EV.filter(e=>e.w===w).length>=3,`matters for ${w}`);
});

test('the free answer is no longer always the bad one',()=>{
  const ev=o=>o.p?o.p*(o.m||0)+(1-o.p)*(o.f.m||0):(o.m||0);
  const free=EV.filter(e=>!e.sq&&!e.w).map(e=>e.o[G.cxCouncilOpt(e)]),neg=free.filter(o=>ev(o)<0);
  assert(neg.length<free.length/2,`only ${neg.length} of ${free.length} free answers cost mood`);
  assert(free.some(o=>o.n)&&free.some(o=>o.p)&&free.some(o=>o.x),'some carry a catch instead: a sequel, a gamble, a slower city');
});

test('matters come on their own clock, one to three days apart, from the record’s anchor',()=>{
  const n=nation([{id:'cap',ne:NOW-10*DAY,en:5}]);
  const A=arrivals(n,'cap',0,NOW+30*DAY);
  assert.equal(A[0].a,NOW-10*DAY,'the first at the anchor');assert.equal(A[0].p,5,'at the record’s place in the order');
  for(let i=1;i<A.length;i++){const g=A[i].a-A[i-1].a;assert(g>=DAY&&g<3*DAY,'one to three days apart');assert.equal(A[i].p,A[i-1].p+1);}
  /* answering changes nothing about when the next comes */
  const before=JSON.stringify(arrivals(n,'cap',NOW,NOW+20*DAY)),rec=Object.assign({},n.cities[0],{ch:[{a:A[3].a,k:'fire',o:0,t:A[3].a+HOUR,v:6}]});
  assert.equal(JSON.stringify(G.cxArr('cap',rec,NOW+20*DAY).filter(x=>x.a>=NOW)),before);
  /* a city with no anchor yet: a day or two after it was founded */
  const m=nation([{id:'c1',t:NOW}]);const a0=arrivals(m,'c1',0,NOW+5*DAY)[0].a;assert(a0>=NOW+DAY&&a0<NOW+2*DAY);
});

test('up to two wait; one left two days is decided by the council, which takes the free answer that does least',()=>{
  const n=nation([{id:'cap',ne:NOW-10*DAY}]),A=arrivals(n,'cap',NOW-10*DAY,NOW+1);
  const S=G.cxEvState('me',n,n.cities[0],NOW),live=A.filter(x=>x.a>NOW-2*DAY);
  assert.deepEqual(S.wait.map(w=>w.a),live.map(x=>x.a),'the ones from the last two days wait');assert(S.wait.length<=2);
  for(const w of S.wait)assert.equal(w.due,w.a+2*DAY);
  const dec=S.ans.filter(e=>e.w);assert(dec.length>=1,'older ones were decided');
  const ev=q=>q.p?q.p*(q.m||0)+(1-q.p)*(q.f.m||0):(q.m||0);
  for(const e of dec){const M=G.CX_BY.get(e.k),o=M.o[e.o];assert(!o.c&&!o.b,'without spending anything');assert.equal(e.t,e.a+2*DAY,'two days after it came');
    for(const [i,x] of M.o.entries())if(!x.c&&!x.b&&i!==e.o)assert(ev(x)>=ev(o),`${M.k}: the council picked the free answer that does least`);}
  /* an answer on the record is no longer waiting, nor decided */
  if(S.wait.length){const w=S.wait[0],rec=Object.assign({},n.cities[0],{ch:[{a:w.a,k:w.k,o:0,t:NOW,v:3}]});n.cities[0]=rec;
    assert(!G.cxEvState('me',n,rec,NOW).wait.some(x=>x.a===w.a));}
  /* before round two, nothing was decided for anyone */
  const old=nation([{id:'cap',ne:V2-20*DAY}]);
  assert(!G.cxEvState('me',old,old.cities[0],V2+HOUR).ans.some(e=>e.w&&e.t<V2),'no council answers from before the change');
});

test('an answer’s mood holds for a day, then fades to nothing over two',()=>{
  const e={t:NOW,v:6};
  assert.equal(G.cxRipV(e,NOW),6);assert.equal(G.cxRipV(e,NOW+23*HOUR),6);
  assert.equal(G.cxRipV(e,NOW+48*HOUR),3,'halfway through the fade');
  assert.equal(G.cxRipV(e,NOW+72*HOUR),0);assert.equal(G.cxRipV(e,NOW-HOUR),0,'not before it was given');
});

test('answers add up: a weaker one on top of a fading stronger one is worth giving; past ±10 counts half, ±15 at most',()=>{
  /* a record with answers but no matters due (its clocks far ahead) */
  const mk=ch=>ctOf(nation([{id:'cap',ne:NOW+30*DAY,ch}],{wne:NOW+30*DAY}),'cap');
  const ra=G.cxRipples(mk([{a:1,k:'fire',o:0,t:NOW-36*HOUR,v:8}]),NOW),rb=G.cxRipples(mk([{a:2,k:'statue',o:0,t:NOW-HOUR,v:5},{a:1,k:'fire',o:0,t:NOW-36*HOUR,v:8}]),NOW);
  assert.equal(ra.sum,6,'the +8 from a day and a half ago is at 6');
  assert(rb.sum>ra.sum,'answering the +5 matter adds to it, where it used to replace it');
  assert.equal(rb.raw,11);assert.equal(rb.sum,11,'10, and half of the 1 past it, rounded');
  assert.equal(rb.list.length,2,'one line each in the mood’s breakdown');
  const big=G.cxRipples(mk([1,2,3,4].map(i=>({a:i,k:'fire',o:0,t:NOW-i*HOUR,v:8}))),NOW);
  assert.equal(big.raw,32);assert.equal(big.sum,15,'never past 15');assert.equal(big.soft,-17);
  assert.equal(G.cxRipples(mk([1,2].map(i=>({a:i,k:'fire',o:1,t:NOW-i*HOUR,v:-8}))),NOW).sum,-13,'the same below −10');
  /* a record from before: its flat bonus counts in full until it runs out */
  const n=nation([{id:'cap',ne:NOW+30*DAY,mb:{v:8,u:NOW+DAY}}],{wne:NOW+30*DAY});
  assert.equal(G.cxRipples(ctOf(n,'cap'),NOW).sum,8);assert.equal(G.cxRipples(ctOf(n,'cap'),NOW+DAY+1).sum,0);
});

test('answers change output, build speed or defence while they last',()=>{
  const n=nation([{id:'cap',ne:NOW+30*DAY,ch:[{a:1,k:'fire',o:0,t:NOW-HOUR,v:6},{a:2,k:'lamps',o:0,t:NOW-2*HOUR,v:5},{a:3,k:'bridge',o:1,g:0,t:NOW-3*HOUR,v:-6}]}],{wne:NOW+30*DAY}),ct=ctOf(n,'cap');
  const r=G.cxRipples(ct,NOW);
  assert.equal(r.fx.bld,10,'the fire rebuilt properly: builders in practice');assert.equal(r.fx.def,10,'lit streets');assert.equal(r.fx.out,-10,'a bridge that gave way');
  assert.equal(G.cxRipples(ct,NOW+49*HOUR).fx.bld,0,'two days later, over');
  assert.match(source,/ct\.mk=cxBand\(m\.v\)\[2\]\*\(my&&my\.tr==='steward'\?1\.1:1\)\*\(1\+o\)/,'output counts in the city’s multiplier');
  assert.match(cut('function cxBuildK(','function cxHours('),/cxRipples\(ct,Date\.now\(\)\)\.fx\.bld/,'build speed in build times');
  assert.match(cut('function cxDefAt(','BATTLE_MODS.push'),/cxRipples\(ct,now\)\.fx\.def/,'defence in battle');
});

test('the nation’s matters: every eight to twelve days, and their mood reaches every city',()=>{
  const n=nation([{id:'cap',ne:NOW+30*DAY},{id:'c1',c:3,ne:NOW+30*DAY}],{wne:NOW-HOUR,wen:2});
  const A=G.cxNwArr('me',n,NOW+100*DAY);for(let i=1;i<A.length;i++){const g=A[i].a-A[i-1].a;assert(g>=8*DAY&&g<12*DAY,'eight to twelve days apart');}
  const S=G.cxNwState('me',n,NOW);assert.equal(S.wait.length,1);assert(NW.includes(S.wait[0].ev));assert.equal(S.wait[0].due,NOW-HOUR+3*DAY,'three days to answer');
  assert(G.cxNwState('me',n,NOW+3*DAY).ans.some(e=>e.w),'three days on, the government decided it');
  const m=Object.assign({},n,{wch:[{a:NOW-HOUR,k:S.wait[0].k,o:0,t:NOW,v:6}]});
  for(const id of ['cap','c1'])assert.equal(G.cxRipples(ctOf(m,id),NOW+HOUR).sum,6,`${id} feels it`);
  /* a nation already there: its first a day to three after round two began */
  const f=nation([{id:'cap'}],{founded:NOW-100*DAY}),a0=G.cxNwArr('me',f,V2+10*DAY)[0].a;assert(a0>=V2+DAY&&a0<V2+3*DAY);
});

test('a city goes through every matter it may bring before any comes round again',()=>{
  const n=nation([{id:'c1',c:3,ne:NOW,en:0}],{loc:99}),rec=n.cities[0],L=G.cxPool(G.cxTags(n,rec)).length;
  const ks=G.cxArr('c1',rec,NOW+400*DAY).slice(0,L).map(x=>G.cxPick('me',n,'c1',x.a));
  assert.equal(new Set(ks).size,L,`${L} arrivals, ${L} different matters`);
  assert(!ks.some(k=>G.CX_BY.get(k).w),'a lowland city that is not the capital gets none of the coast’s, hills’ or capital’s');
});

test('matters that fit the place: the coast, the hills, the capital, and wartime',()=>{
  const n=nation([{id:'cap',c:0},{id:'sea',c:5},{id:'hill',c:7}]);
  assert.equal(G.cxTags(n,n.cities[0]),'cap,');assert.equal(G.cxTags(n,n.cities[1]),'coast,');assert.equal(G.cxTags(n,n.cities[2]),'hills,');
  const has=(c,w)=>G.cxPool(G.cxTags(n,c)).some(i=>EV[i].w===w);
  assert(has(n.cities[0],'cap')&&!has(n.cities[0],'coast'));assert(has(n.cities[1],'coast')&&!has(n.cities[1],'cap'));assert(has(n.cities[2],'hills'));
  for(const c of n.cities)assert(!has(c,'war'),'matters of war never come in turn');
  /* at war: from the record's wars, peace and history */
  const w={wars:{x:{t:NOW-5*DAY}},peace:{},wh:[{w:'y',a:NOW-40*DAY,b:NOW-30*DAY}]};
  assert(G.cxWarAt(w,NOW));assert(!G.cxWarAt(w,NOW-10*DAY));assert(G.cxWarAt(w,NOW-35*DAY));
  assert(!G.cxWarAt({wars:{x:{t:NOW-5*DAY}},peace:{x:NOW-DAY}},NOW),'made peace since');
  const at=nation([{id:'cap',ne:NOW-90*DAY}],{wars:{x:{t:NOW-90*DAY}}}),ks=G.cxArr('cap',at.cities[0],NOW).map(x=>G.cxPick('me',at,'cap',x.a));
  const war=ks.filter(k=>G.CX_BY.get(k).w==='war').length;assert(war>=ks.length/6&&war<=ks.length/2,`in wartime about one in three is a matter of war (${war} of ${ks.length})`);
  const peace=nation([{id:'cap',ne:NOW-90*DAY}]);
  assert(!G.cxArr('cap',peace.cities[0],NOW).some(x=>G.CX_BY.get(G.cxPick('me',peace,'cap',x.a)).w==='war'),'and never in peacetime');
});

test('two cities never have the same matter waiting at once',()=>{
  const recs=Array.from({length:33},(_,i)=>({id:i?'c'+i:'cap',c:i?10+i:0,ne:NOW-HOUR,en:i%3}));
  const n=nation(recs),ks=n.cities.flatMap(c=>G.cxEvState('me',n,c,NOW).wait.map(w=>w.k));
  assert.equal(ks.length,33);assert.equal(new Set(ks).size,33,'33 cities, 33 different matters');
  /* and over two months of a busy nation, matters close in time differ between cities */
  const m=nation(Array.from({length:12},(_,i)=>({id:'k'+i,c:20+i,ne:NOW-60*DAY+i*7*HOUR}))),all=[];
  for(const c of m.cities)for(const x of G.cxArr(c.id,c,NOW))if(x.a>=NOW-58*DAY)all.push([c.id,x.a,G.cxPick('me',m,c.id,x.a)]);
  const clash=all.filter(([id,a,k])=>all.some(([id2,a2,k2])=>id2!==id&&k2===k&&Math.abs(a2-a)<2*DAY));
  assert(clash.length<=2,`${clash.length} of ${all.length} matters overlap another city’s`);
});

test('a sequel: the answer plants it, and the city’s first matter a day or more later brings it',()=>{
  /* the record makes the waiting matter the stopped clock, whose second answer brings the tea rooms */
  const n=nation([{id:'cap',ne:NOW-HOUR,sq:[{k:'clock',a:NOW-HOUR}]}]);n.stock=stock();
  const A=answering(n),w=A.G.cxEvState('me',n,n.cities[0],NOW).wait[0];assert.equal(w.k,'clock');
  A.G.cxAnswer('cap',w.a,1,'clock');const rec=A.saved.cities[0];
  assert.equal(rec.ch[0].o,1);const sq=rec.sq.find(s=>s.k==='teatime');assert(sq,'the tea rooms are coming');
  assert(sq.a>=NOW+DAY,'a day or more later');assert.equal(A.G.cxPick('me',A.saved,'cap',sq.a),'teatime');
  assert.equal(A.G.cxNextAt('cap',rec,NOW+DAY)>sq.a,true,'and a second sequel would take the arrival after');
});

test('answering: what it costs and brings, a day’s +1, and a stale click does nothing',()=>{
  const n=nation([{id:'cap',ne:NOW-HOUR,en:0}]);n.stock=stock();
  const A=answering(n),g=A.G,w=g.cxEvState('me',n,n.cities[0],NOW).wait[0],o=w.ev.o.findIndex(x=>!x.b&&!x.p);
  g.cxAnswer('cap',w.a,o,'not-this-one');assert.equal(A.saved,null,'a click on a matter since replaced is not applied');
  g.cxAnswer('cap',w.a+1,o,w.k);assert.equal(A.saved,null,'nor one on a matter no longer waiting');
  g.cxAnswer('cap',w.a,o,w.k);assert(A.saved);
  const e=A.saved.cities[0].ch[0],O=w.ev.o[o];assert.equal(e.v,Math.max(-12,Math.min(12,(O.m||0)+1)),'its mood, +1 for answering within a day');
  for(const r of g.RES)assert.equal(A.saved.stock[r],99-3*((O.c&&O.c[r])||0)+((O.g&&O.g[r])||0),`${r}: three times the list price, since 28 November`);
  assert(!g.cxEvState('me',A.saved,A.saved.cities[0],NOW).wait.some(x=>x.a===w.a),'and it no longer waits');
  assert.match(A.toast,/Answered within a day: mood \+1\./);
});

test('a save writes down what the councils decided, once, and moves an old anchor on without changing a thing',()=>{
  const c=load({Date:{now:()=>NOW,UTC:Date.UTC}}),g=c.G,hook=c.COMMIT_HOOKS[0];
  const n=nation([{id:'cap',ne:NOW-40*DAY,en:3}],{wne:NOW-60*DAY}),before=g.cxEvState('me',n,n.cities[0],NOW);
  const later=x=>x.a>NOW-6*DAY,future=g.cxArr('cap',n.cities[0],NOW+20*DAY).filter(later).map(x=>[x.a,x.p,g.cxPick('me',n,'cap',x.a)]);
  const m=JSON.parse(JSON.stringify(n)),out=hook(m,n,NOW),rec=m.cities[0];
  assert(rec.ch.length&&rec.ch.every(e=>e.w===1),'the council’s answers on the record');
  assert.deepEqual(rec.ch.map(e=>e.a).sort(),before.ans.filter(e=>e.w&&e.t>NOW-6*DAY).map(e=>e.a).sort());
  assert(out.length===1&&/While you were away/.test(out[0]),'told once');assert.equal(hook(m,m,NOW+1000).length,0,'and not again');
  assert(rec.ne>NOW-40*DAY&&rec.ne<=NOW-14*DAY,'the anchor moved on');assert(m.wne>NOW-60*DAY,'the nation’s too');
  assert.deepEqual(g.cxArr('cap',rec,NOW+20*DAY).filter(later).map(x=>[x.a,x.p,g.cxPick('me',m,'cap',x.a)]),future,'the same arrivals, places and matters');
  assert.deepEqual(g.cxEvState('me',m,rec,NOW).ans.map(e=>[e.a,e.v]),before.ans.map(e=>[e.a,e.v]),'the same answers counted');
});

test('the record keeps the chronicle and the sequels, cleaned',()=>{
  const ch=Array.from({length:14},(_,i)=>({a:NOW-i*DAY,k:'fire',o:0,t:NOW-i*DAY+HOUR,v:6,q:1}));
  const e=G.cxCityExtras({ch:ch.concat([{a:1,k:'BAD!',o:0,t:1,v:1},{a:2,k:'fire',o:7,t:1,v:1}]),sq:[{k:'bunting',a:NOW},{k:'x y',a:1}]});
  assert.equal(e.ch.length,10,'the newest ten');assert.deepEqual({...e.ch[0]},{a:NOW,k:'fire',o:0,t:NOW+HOUR,v:6,q:1});
  assert.deepEqual(e.sq.map(s=>({...s})),[{k:'bunting',a:NOW}]);
  assert.equal(G.cxChClean([{a:1,k:'fire',o:0,t:1,v:99}])[0].v,12,'a mood out of range is held in');
  assert.equal(G.cxCityExtras({en:12,ne:5}).en,12);
});

test('the cards carry the arrival and the matter, and an answer a building opens shows only with it',()=>{
  const n=nation([{id:'cap',ne:NOW-HOUR}]),ev=G.CX_BY.get('flood'),w={a:NOW-HOUR,k:'flood',ev,due:NOW-HOUR+2*DAY};
  const h=G.cxEvCard(ctOf(n,'cap',[]),w,stock(),NOW,{id:'cx-matter'});
  assert.match(h,/id="cx-matter"/);assert.match(h,/data-act="cx-ev" data-id="cap" data-a="\d+" data-i="0" data-k="flood"/);
  assert(!/Send the nurses/.test(h),'no Hospital, no nurses');assert.match(h,/Answer by T\d+ for mood \+1/);
  assert.match(h,/the city council decides at T\d+: “Let the city cope”/);
  const h2=G.cxEvCard(ctOf(n,'cap',['hospital']),w,stock(),NOW);assert.match(h2,/Because of its hospital/);assert.match(h2,/Send the nurses/);
  assert.equal(G.cxOptHint(G.CX_BY.get('bridge').o[1]),'70% chance: no change; otherwise mood −6, output −10% for 2 days');
  assert.match(G.cxOptHint(G.CX_BY.get('flood').o[0]),/^Costs 30 food, 24 timber · /,'the price shown is three times the list');
  const poor=G.cxEvCard(ctOf(n,'cap',[]),w,{food:20,timber:99,iron:99,oil:99,goods:99},NOW);assert.match(poor,/data-i="0" data-k="flood" disabled/,'and an answer the stockpile cannot pay is greyed out');
  assert.match(source,/<details class="cx-inbox" id="cx-inbox"\$\{S\.cxInboxOpen\?' open':''\}>/,'the inbox starts folded');
  assert.match(source,/if\(a==='cx-ev'\)\{cxAnswer\(id,\+el\.dataset\.a,\+el\.dataset\.i,el\.dataset\.k\);return;\}/);
  assert.match(source,/if\(a==='cx-nw'\)\{cxNwAnswer\(\+el\.dataset\.a,\+el\.dataset\.i,el\.dataset\.k\);return;\}/);
});
