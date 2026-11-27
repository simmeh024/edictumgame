// Landing parties and colonies (2026-11-27, game/edictum.html "landing parties and colonies"): the rules table, the
// records as the game keeps them, a colony's land, reach and upkeep, the harbour's landing reach, the hostile landing's
// count against the sixteen hexes a day, the beach defences' prices, the colonial edicts (the last added) and when they
// come, the map's acceptance of a landing on an abandoned coast, the referee's two new requests and the war letter,
// and the admins' figures (functions/stats-more.js).
// Run with: npm run test:fx
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rowMore, moreSummary} from '../functions/stats-more.js';
import {warLetter} from '../functions/mail-core.js';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>'));
const SEC=(()=>{const a=code.indexOf('/* ───────── landing parties and colonies (27 November 2026)'),b=code.indexOf('/* ───────── the World Assembly Council',a);assert.ok(a>0&&b>a,'the section, which the Council’s follows');return code.slice(a,b);})();
const J=v=>JSON.parse(JSON.stringify(v));
const DAY=864e5,NOW=Date.UTC(2026,10,27,12);

/* the section run on a small hex grid (axial: W columns, H rows), with the rest of the game stubbed */
function load(over={}){
  const W=40,H=12,N=W*H,nbr=new Int32Array(N*6).fill(-1),dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
  for(let r=0;r<H;r++)for(let q=0;q<W;q++)dirs.forEach(([dq,dr],d)=>{const x=q+dq,y=r+dr;if(x>=0&&x<W&&y>=0&&y<H)nbr[(r*W+q)*6+d]=y*W+x;});
  const ax=c=>[c%W,Math.floor(c/W)],hexDist=(a,b)=>{const [q1,r1]=ax(a),[q2,r2]=ax(b),dq=q1-q2,dr=r1-r2;return (Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))/2;};
  const ringMemo=new Map(),ringCells=(c,R)=>{const key=c*8+R;let v=ringMemo.get(key);if(v)return v;v=[[c,0]];const seen=new Set([c]);let f=[c];for(let d=1;d<=R;d++){const nx=[];for(const a of f)for(let e=0;e<6;e++){const nb=nbr[a*6+e];if(nb<0||seen.has(nb))continue;seen.add(nb);nx.push(nb);v.push([nb,d]);}f=nx;}ringMemo.set(key,v);return v;};
  const landPatches=(T,j)=>{const own=new Set(),id=new Map();for(let c=0;c<N;c++)if(T.owner[c]===j)own.add(c);let k=0;for(const c of own){if(id.has(c))continue;const st=[c];id.set(c,k);while(st.length){const x=st.pop();for(let d=0;d<6;d++){const y=nbr[x*6+d];if(y>=0&&own.has(y)&&!id.has(y)){id.set(y,k);st.push(y);}}}k++;}return id;};
  const stub=()=>{},wrap=()=>function(){return '';};
  const ctx={Math,Object,Number,String,Array,Set,Map,WeakMap,JSON,Promise,Date:class extends Date{static now(){return NOW;}},isFinite,
    MAP:{N,nbr,T:new Uint8Array(N).fill(2),comp:new Int32Array(N).fill(-1),comps:[],cx:new Float64Array(N),cy:new Float64Array(N)},DAY,RES:['food','timber','iron','oil','goods'],
    CELL_RES:{food:new Float64Array(N).fill(2),timber:new Float64Array(N).fill(1),iron:new Float64Array(N).fill(.5),oil:new Float64Array(N)},
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),num0:v=>Number(v)||0,hexDist,ringCells,landPatches,cityList:n=>(n&&n.cities)||[],esc:s=>String(s),
    NORM_HOOKS:[],inReach:()=>false,landCredits:()=>5,frontier:T=>T._fr||new Map(),conqCap:()=>'',BATTLE_MODS:[],FIX_EPOCH:0,fmtDur:ms=>Math.round(ms/60000)+' min',
    BUILDINGS:{},MILESTONES:[{p:10,b:['dockyard']}],DC_GLYPH:{},DC_GEO:{},BLD_ICO:{},NOTIF_SOURCES:[],NOTIF_K:{},warNotice:()=>'',mpMapToolbar:()=>'',
    MAP_PANEL_TOP:[],MAP_PANEL:[],MAP_CLICK:[],MAP_TIP:[],MAP_CONTROLS:[],MAP_LEGEND:[],MAP_LAYERS:[],document:{addEventListener:stub},tick:stub,
    ISSUES:[],ISSUE_BY_ID:{},fill:(t)=>t,syncInbox:n=>n,edictTopicBadge:()=>'',logLine:()=>'',ST_LOG:{},DSP_LOG:{},ACH:[],achDef(...a){ctx.ACH.push(a);},aT:()=>0,HELP_EXT:[],stDeep:()=>'',window:{},
    S:{nation:null},myId:()=>'me',dsHarbours:()=>[],dsDock:()=>false,pol:n=>(n&&n.policies)||{},rsKnows:(n,id)=>!!(n&&n.techs&&n.techs.includes(id)),cityState:()=>({all:[],byCell:new Map()}),
    issLast:n=>new Map((n.seen||[]).map(id=>[id,1])),deskN:a=>a.length,EDICT_KEEP:10,clone:v=>JSON.parse(JSON.stringify(v)),OBS:false,territory:()=>null,
    ...over};
  ctx.globalThis=ctx;vm.createContext(ctx);
  vm.runInContext(SEC.replace(/^const /gm,'var ').replace(/^let /gm,'var ')+'\nthis.X={LND_RULES,LND_TY,LND_AB,LND_ISSUES,lndCleanV,lndCleanC,lndGeo,lndActive,lndSlots,lndFar,lndCost,lndUpkeepOf,lndBdfCost,lndHarbours,lndDue,lndReserved,lndSourceCol,lndLandingAt,lndBdfLv,lndAway,lndThreats,lndThreatCard,lndDigIn};',ctx);
  return {ctx,X:ctx.X,W,N,cell:(q,r)=>r*W+q};
}

test('the rules: 24 hexes of sea from a Harbour, up to 60; hostile landings 30, announced 12 to 24 hours ahead, two hexes, a day ashore',()=>{
  const {X}=load(),R=X.LND_RULES;
  assert.equal(R.reach,24);assert.equal(R.max,60);assert.equal(R.ug,4);assert.equal(R.navy,12);
  assert.equal(R.hReach,30);assert.equal(R.hMin,12*3600000);assert.equal(R.hMax,24*3600000);assert.equal(R.hHex,2);assert.equal(R.hWin,DAY);assert.equal(R.hDef,1.5);
  assert.equal(R.beach,3);assert.equal(R.slots,3);assert.equal(R.colReach,8);assert.equal(R.bat,6);assert.equal(R.away,14*DAY);
  assert.deepEqual(J(R.bdf.map(b=>b.m)),[1.3,1.6,2],'three levels of beach defences');
  assert.deepEqual(Object.keys(X.LND_TY),['t','s','g']);
  assert.equal(X.LND_AB,'~abandoned');
});

test('a voyage and a colony as the game keeps them: bad ones dropped, fields bounded, kept public',()=>{
  const {X,ctx}=load();
  const v={id:'labc',k:'p',c:10,h:3,d:22,s:NOW,a:NOW+2*3600e3,st:'sea',cl:[10,11,11,12,13],ty:'s',nm:' New  <b>Haven</b> ',p:{timber:53,food:37,junk:9}};
  const o=X.lndCleanV(v);
  assert.deepEqual(J(o.cl),[10,11,12],'at most three hexes, no repeats');
  assert.equal(o.nm,'New bHaven/b','no markup');assert.equal(o.ty,'s');assert.deepEqual(J(o.p),{timber:53,food:37});
  assert.equal(X.lndCleanV({...v,id:'bad id!'}),null);assert.equal(X.lndCleanV({...v,a:v.s-1}),null);assert.equal(X.lndCleanV({...v,a:v.s+4*DAY}),null,'never more than three days at sea');
  const h=X.lndCleanV({...v,k:'h',w:'uid-2',wn:'Foeland',cl:[10,11,12],won:5});
  assert.equal(h.k,'h');assert.deepEqual(J(h.cl),[10,11],'a hostile landing makes for two hexes');assert.equal(h.won,2);assert.equal(h.ty,undefined);
  assert.equal(X.lndCleanV({...v,k:'h'}),null,'a hostile landing names its enemy');
  const C=X.lndCleanC({id:'labc',c:10,t:NOW,ty:'x',h:3,d:99,nm:'Fort',sh:NOW,rl:2,pv:1,hs:1});
  assert.deepEqual(J(C),{id:'labc',c:10,t:NOW,ty:'t',h:3,d:65,nm:'Fort',sh:NOW,rl:2,pv:1,hs:1});
  const n={},d={lnd:[v,{id:'x'}],cln:[C],bdf:{labc:{lv:2,t:NOW},old:{lv:1,t:NOW-9*DAY},bad:{lv:7,t:NOW}},lnr:['l1','no way']};
  for(const f of ctx.NORM_HOOKS)f(n,d);
  assert.equal(n.lnd.length,1);assert.equal(n.cln.length,1);assert.deepEqual(J(n.bdf),{labc:{lv:2,t:NOW}});assert.deepEqual(J(n.lnr),['l1']);
  /* the public half: none of the fields is in the shim's private list */
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8'),nx=shim.slice(shim.indexOf('var NX_KEYS'),shim.indexOf('forEach(function (k) { NX_KEYS[k] = 1; })'));
  for(const k of ['lnd','cln','bdf','lnr'])assert.ok(!nx.includes(`'${k}'`),k+' stays public');
});

test('a colony is the land joined to its landing hex apart from the capital\'s; it opens the next once it has a city',()=>{
  const {X,cell,N}=load(),owner=new Int16Array(N).fill(-1),cap=cell(2,5);
  for(const c of [cap,cell(3,5),cell(2,6)])owner[c]=0;
  const col=cell(20,5);for(const c of [col,cell(21,5),cell(20,6)])owner[c]=0;
  const n={cln:[{id:'l1',c:col,t:NOW,ty:'t',h:cap,d:20,nm:'Port'}],cities:[]};
  const T={list:[{id:'me',n,cap}],owner,byId:{me:0},count:[6]};
  let G=X.lndGeo(T,0);
  assert.equal(G.cols[0].cells.length,3);assert.ok(!G.cols[0].joined);assert.equal(X.lndActive(G).length,1);assert.equal(X.lndSlots(G),1,'one colony, no city: no second yet');
  n.cities=[{id:'c1',c:cell(21,5),nm:'Portside'}];T.list[0]={...T.list[0]};G=X.lndGeo({...T},0);
  assert.equal(X.lndSlots(G),2,'a city in the colony opens the second');
  /* grown into the homeland: no longer a colony */
  const T2={...T,owner:owner.slice()};for(let q=3;q<=20;q++)T2.owner[cell(q,5)]=0;
  G=X.lndGeo(T2,0);assert.ok(G.cols[0].joined);assert.equal(X.lndActive(G).length,0);
});

test('claim reach: within eight hexes of a colony\'s landing hex, as well as the capital\'s and the cities\'',()=>{
  const {ctx,cell}=load(),col=cell(30,5),x={n:{cln:[{id:'l1',c:col,t:NOW,ty:'t',h:0,d:30}]}};
  assert.ok(ctx.inReach(x,cell(37,5)),'eight hexes off');assert.ok(!ctx.inReach(x,cell(39,5)),'nine is too far');
  assert.ok(!ctx.inReach({n:{}},cell(31,5)),'no colony, no reach');
});

test('a Harbour\'s landing reach: 24, 4 a block (20 for a Grand Port), 12 with a navy, research, never past 60',()=>{
  const H=[{c:1,nm:'A',u:0},{c:2,nm:'B',u:3},{c:3,nm:'C',u:5,t2:true}];
  let {X}=load({dsHarbours:()=>H});
  assert.deepEqual(J(X.lndHarbours({}).map(h=>h.reach)),[24,36,44]);
  ({X}=load({dsHarbours:()=>H}));assert.deepEqual(J(X.lndHarbours({policies:{navalFleet:1}}).map(h=>h.reach)),[36,48,56]);
  ({X}=load({dsHarbours:()=>H,dsDock:()=>true}));assert.deepEqual(J(X.lndHarbours({techs:['t-overseas-trade','t-trade-cartography','t-shipbuilding','w-amphibious-operations']}).map(h=>h.reach)),[47,59,60],'a dockyard is a navy too; research adds 11; 60 at most');
});

test('what a colony costs a day: more the larger and further, a settlement a quarter less, a garrison iron and oil too',()=>{
  const {X}=load(),K=(ty,h,d)=>({col:{ty,d},cells:Array(h).fill(0)});
  const t=X.lndUpkeepOf(K('t',10,30)),s=X.lndUpkeepOf(K('s',10,30)),g=X.lndUpkeepOf(K('g',10,30)),far=X.lndUpkeepOf(K('t',10,60));
  assert.ok(Math.abs(t.food-7)<1e-9&&Math.abs(t.goods-4)<1e-9,'(2+0.15×10)×2 food, (1+0.1×10)×2 goods');
  assert.ok(Math.abs(s.food-t.food*0.75)<1e-9);assert.equal(t.iron,undefined);assert.ok(g.iron>0&&g.oil>0);assert.ok(far.food>t.food);
  assert.equal(X.lndFar(10),1);assert.equal(X.lndFar(16),1);assert.equal(X.lndFar(17),0.85);assert.equal(X.lndFar(40),0.85);assert.equal(X.lndFar(41),0.7);
  const c20=X.lndCost(20,'p','t'),c60=X.lndCost(60,'p','g');assert.deepEqual(J(c20),{timber:50,food:35,goods:30});assert.ok(c60.iron===20&&c60.oil===10&&c60.timber===110);
  const h=X.lndCost(30,'h');assert.ok(h.iron>30&&h.oil>20,'a hostile landing costs more the further it sails');
});

test('beach defences: each level costs what its price is above the levels already bought',()=>{
  const {X}=load(),B=X.LND_RULES.bdf;
  for(let to=1;to<=3;to++){let sum={};for(let k=1;k<=to;k++)for(const [r,v] of Object.entries(X.lndBdfCost(k-1,k)))sum[r]=(sum[r]||0)+v;assert.deepEqual(sum,J(B[to-1].cost));}
  assert.deepEqual(J(X.lndBdfCost(1,3)),Object.fromEntries(Object.entries(J(B[2].cost)).map(([r,v])=>[r,v-(B[0].cost[r]||0)]).filter(([,v])=>v>0)));
});

test('land taken in a hostile landing counts twice towards the sixteen hexes a day',()=>{
  const {ctx}=load(),v={id:'h1',k:'h',c:5,h:1,d:20,s:NOW-20*3600e3,a:NOW-3600e3,st:'sea',cl:[5,6],w:'foe'};
  const conq=[];for(let k=0;k<13;k++)conq.push({c:100+k,t:NOW-k*60000,d:'foe'});
  assert.equal(ctx.conqCap({conq,lnd:[v]},NOW),'','thirteen hexes');
  conq.push({c:5,t:NOW-30*60000,d:'foe'},{c:6,t:NOW-20*60000,d:'foe'});
  assert.match(ctx.conqCap({conq,lnd:[v]},NOW),/counts twice/,'fifteen hexes, two of them from the landing: seventeen');
});

test('battle: the defenders hold a landing\'s beaches half as strong again, more behind defences; an attack from a far colony is weaker',()=>{
  const {ctx,cell,N}=load(),owner=new Int16Array(N).fill(-1),now=NOW;
  const v={id:'h1',k:'h',c:cell(10,5),h:cell(1,5),d:28,s:now-13*3600e3,a:now-3600e3,st:'sea',cl:[cell(10,5)],w:'foe'};
  const A={id:'me',n:{lnd:[v]},cap:cell(1,5)},B={id:'foe',n:{bdf:{h1:{lv:2,t:now-3600e3}}},cap:cell(30,5)};
  owner[cell(10,5)]=1;const T={list:[A,B],owner,byId:{me:0,foe:1}};
  const m=ctx.BATTLE_MODS[0](T,cell(10,5),0,1);
  assert.equal(m.def,1.5*1.6);assert.equal(m.att,0.85,'28 hexes of sea');assert.match(m.note,/guns on the shore/);
  /* an attack from a colony 45 hexes away, with no land of the homeland near */
  const col=cell(20,8);owner.fill(-1);owner[cell(1,5)]=0;owner[col]=0;owner[cell(21,8)]=0;owner[cell(22,8)]=1;
  A.n={cln:[{id:'l1',c:col,t:now,ty:'g',h:cell(1,5),d:45,nm:'Fort'}]};
  const m2=ctx.BATTLE_MODS[0]({list:[A,B],owner,byId:{me:0,foe:1}},cell(22,8),0,1);assert.equal(m2.att,0.7);assert.match(m2.note,/Fort, 45 hexes across the sea/);
});

test('the colonial edicts: nine, never drawn at random, the last added; each comes once, at its moment, dated then',()=>{
  const {X}=load(),L=X.LND_ISSUES;
  assert.equal(L.length,9);assert.equal(new Set(L.map(x=>x.id)).size,9);
  for(const is of L){assert.ok(is.fo===1&&is.nbx===false&&is.lnd,is.id);assert.equal(is.o.length,3,is.id);for(const o of is.o)assert.ok(o.t&&o.h&&o.e&&o.fx,is.id);
    assert.ok(!/\{(COLONY|COAST|LFOE)\}/.test(is.t),is.id+': no placeholder in the title');}
  const pushes=[...code.matchAll(/ISSUES\.push\(/g)].map(m=>m.index);
  /* the last edicts added but one: the World Assembly Council's (council.test.mjs) came after them */
  assert.equal(pushes[pushes.length-2],code.indexOf('for(const is of LND_ISSUES){is.fo=1;ISSUES.push(is)')+'for(const is of LND_ISSUES){is.fo=1;'.length,'added after every older edict');
  assert.equal(pushes[pushes.length-1],code.indexOf('for(const is of WAC_ISSUES){is.fo=1;ISSUES.push(is)')+'for(const is of WAC_ISSUES){is.fo=1;'.length,'then only the Council’s');
  assert.match(readFileSync(new URL('../scripts/split-content.mjs',import.meta.url),'utf8'),/'LND_ISSUES'/);
  const pinned=readFileSync(new URL('./edict-order.txt',import.meta.url),'utf8').trim().split(/\r?\n/);
  assert.deepEqual(pinned.slice(-21,-12),J(L.map(x=>x.id)),'pinned in edict-order.txt, before the Council’s twelve');
  /* when they come */
  const t0=NOW-10*DAY,n={founded:NOW-30*DAY,inbox:[],cln:[{id:'l1',c:5,t:t0,ty:'t',h:1,d:20,nm:'Port'}],seen:[]};
  const due=()=>X.lndDue(n,NOW);
  assert.deepEqual(J(due()),[{id:'lnd-first-boats',at:t0+2*3600e3}]);
  n.seen=['lnd-first-boats'];assert.deepEqual(J(due()),[{id:'lnd-governor',at:t0+2*DAY}]);
  n.seen.push('lnd-governor','lnd-charter');assert.deepEqual(J(due()),[{id:'lnd-port',at:t0+DAY}],'a trading post\'s');
  n.inbox=[{id:'lnd-port'}];assert.equal(due()[0].id,'lnd-homesick','one on the desk is not sent again');
  const n2={founded:NOW-30*DAY,inbox:[],lnr:['h9'],tlf:{'lnd:rep':NOW-DAY},seen:[]};assert.deepEqual(J(X.lndDue(n2,NOW)),[{id:'lnd-beaches-held',at:NOW-DAY}]);
});

test('a landing on an abandoned coast is taken without a war, and only from the nation the referee sealed it against',()=>{
  const at=code.indexOf("if(e.w==='~abandoned'){if(e.d!==vid)continue;}");
  assert.ok(at>code.indexOf('function territory(')&&at<code.indexOf('function landMoved(')||at>0,'territory() takes it');
  assert.match(code,/else if\(!warCovers\(e\.src,vid,e\.t\)&&!\(e\.w&&\(warCovers\(e\.src,e\.w,e\.t\)\|\|warCovers\(e\.w,vid,e\.t\)\)\)\)continue;/,'every other conquest still needs its war');
  /* the referee seals it with the same marker */
  const fn=readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
  assert.match(fn,/LND_AB = '~abandoned'/);assert.match(fn,/if \(data\.op === 'abandon'\)/);assert.match(fn,/if \(data\.op === 'landing'\)/);
  assert.match(fn,/now - last < LND_AWAY\) return \{ ok: false, why: 'active'/,'fourteen days unplayed, by the server\'s time of the last save');
  assert.match(fn,/w\.g !== 'c' \|\| w\.offA\) return \{ ok: false, why: 'war' \}[\s\S]{0,200}at - now < LND_NOTICE_MIN/,'a hostile landing only in a war of conquest, announced 12 to 24 hours ahead');
  const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8');assert.match(shim,/landing: function \(d\)/);assert.match(shim,/abandon: function \(d\)/);
});

test('the defender\'s war letter for a landing on its way',()=>{
  const L=warLetter({site:'https://edictumgame.com'},{to:'a@b.c',kind:'landing',by:'Foeland',nation:'Homeland',capital:'Saltmarsh',at:NOW+13*3600e3,tok:'t'});
  assert.equal(L.subject,'Foeland is sending a landing party');assert.match(L.html,/Saltmarsh/);assert.match(L.text,/Dig in on the beaches/);
  assert.equal(warLetter({site:'x'},{to:'a',kind:'siege',by:'F',capital:'C',tok:'t'}).subject,'F has laid siege to C','sieges as before');
});

test('the admins\' figures: colonies by kind, landings sent, won and seen off',()=>{
  const now=NOW,r=(id,x)=>({id,reg:'meridian',t:now-DAY,founded:now-9*DAY,f:[],f2:[],pol:[],ach:[],dd:null,...rowMore(x,now)});
  const a=r('a',{cln:[{id:'1',c:1,ty:'t',d:40},{id:'2',c:2,ty:'g',d:10,hs:1}],lnd:[{st:'sea'}],tly:{'lnd:v':3,'lnd:hv':1,'lnd:h':1,'lnd:ab':1}});
  const b=r('b',{tly:{'lnd:rep':2,'lnd:bd':1}}),c=r('c',{});
  assert.deepEqual(a.lnd,{c:2,ty:[1,0,0],hs:1,v:3,hv:1,h:1,rep:0,ab:1,bd:0,far:40,sea:1});assert.equal(c.lnd,null);
  const M=moreSummary({rows:[a,b,c],at:now},{health:[],bugs:[],tickets:[],posts:[],alliances:[]},'',now).content.lnd;
  assert.deepEqual(M,{nations:1,colonies:2,ty:[1,0,0],beach:1,sent:3,hostile:1,won:1,repelled:2,abandoned:1,dug:1,far:40,sea:1});
  assert.match(SEC,/stDeep=\(f=>function\(M\)\{return f\.apply\(this,arguments\)\+stLanding\(M\);\}\)\(stDeep\);/);
});

test('harbour claims across the water: 16 hexes, 20 with a navy; the Shore Battery, a coastal defence building',()=>{
  assert.match(code,/const MP_CLAIM_REACH=16,MP_NAVY_REACH=20;\nfunction mpHarbourReach\(n\)\{return pol\(n\)\.navalFleet\?MP_NAVY_REACH:MP_CLAIM_REACH;\}/);
  assert.match(code,/your harbours reach 20 hexes across water to claim land, not 16/);
  const {ctx}=load();const B=ctx.BUILDINGS.shorebat;
  assert.ok(B&&B.c==='def'&&B.need==='coast'&&B.icon==='shorebat'&&B.cost.iron>0&&B.h>0&&B.up.iron===1);
  assert.ok(ctx.DC_GLYPH.shorebat&&ctx.BLD_ICO.shorebat&&ctx.DC_GEO.shorebat==='coast');
  assert.ok(ctx.MILESTONES[0].b.includes('shorebat'),'unlocked with the Naval Dockyard');
});

test('the defender: a landing on its way, on the map\'s panel, and beach defences bought against it, level by level',()=>{
  const me={id:'me',me:true,n:null},foe={id:'foe',n:{name:'Grimsund',lnd:[{id:'h9',k:'h',c:7,h:1,d:20,s:NOW-3600e3,a:NOW+11*3600e3,st:'sea',cl:[7,8],w:'me',wn:'Homeland'}]}};
  const other={id:'x',n:{name:'Elsewhere',lnd:[{id:'h8',k:'h',c:9,h:1,d:20,s:NOW,a:NOW+12*3600e3,st:'sea',cl:[9],w:'someone'}]}};
  let saved=null;const toasts=[];
  const nation={name:'Homeland',stock:{food:500,timber:500,iron:500,oil:500,goods:500},log:[]};
  const {X,ctx}=load({allNations:()=>[me,foe,other],stockNow:n=>({...n.stock}),lacking:(c,st)=>Object.keys(c).filter(r=>st[r]<c[r]),costText:c=>Object.entries(c).map(([r,v])=>v+' '+r).join(', '),list:a=>a.join(' and '),
    roundStock:st=>st,commit:n=>{saved=n;ctx.S.nation=n;},render:()=>{},toast:t=>toasts.push(t),placePhrase:()=>'on the coast of Saltreach',landName:()=>'Saltreach',fmtTime:t=>'at '+t,dsBump:()=>{}});
  ctx.S.nation=nation;me.n=nation;
  const th=X.lndThreats(NOW);assert.equal(th.length,1,'only the landing aimed at this nation');assert.equal(th[0].v.id,'h9');
  const card=X.lndThreatCard(th[0],NOW);assert.match(card,/A landing is coming/);assert.match(card,/Grimsund/);assert.match(card,/data-act="lnd-dig" data-id="h9" data-lv="1"/);assert.match(card,/50% the stronger/);
  X.lndDigIn('h9',2);assert.ok(saved,'saved');assert.equal(saved.bdf.h9.lv,2);assert.equal(saved.log[0].k,'lndbd');
  const B=X.LND_RULES.bdf;for(const r of Object.keys(B[1].cost))assert.equal(saved.stock[r],500-B[1].cost[r],'paid level two at once: '+r);
  const before=JSON.parse(JSON.stringify(saved.stock));X.lndDigIn('h9',3);assert.equal(saved.bdf.h9.lv,3);
  for(const r of Object.keys(B[2].cost))assert.equal(saved.stock[r],before[r]-(B[2].cost[r]-(B[1].cost[r]||0)),'level three for the difference: '+r);
  assert.match(X.lndThreatCard(th[0],NOW),/as ready as they can be/);assert.equal(X.lndBdfLv(saved,'h9'),3);
  X.lndDigIn('h8',1);assert.equal(saved.bdf.h8,undefined,'never against a landing on someone else');
});
