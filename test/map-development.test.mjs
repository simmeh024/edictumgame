import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),NOW=1800000000000,DAY=864e5;
function fixture(){
 const W=24,H=9,N=W*H,nbr=new Int32Array(N*6).fill(-1),T=new Uint8Array(N).fill(2),comp=new Int32Array(N),dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
 for(let r=0;r<H;r++)for(let q=0;q<W;q++)dirs.forEach(([dq,dr],d)=>{const x=q+dq,y=r+dr;if(x>=0&&x<W&&y>=0&&y<H)nbr[(r*W+q)*6+d]=y*W+x;});
 const n={reg:'meridian',s:{wealth:50,sci:50},cities:[],policies:{}},world={byId:{me:0},list:[{id:'me',me:true,n,pop:10}],owner:new Int16Array(N).fill(0),isCap:new Uint8Array(N),occ:new Uint8Array(N)};
 class FixedDate extends Date{static now(){return NOW;}}
 const ctx=vm.createContext({MAP:{N,nbr,T,comp},RECL:{sig:'one'},S:{nation:n},REG:{id:'meridian'},REG_BY_ID:{meridian:{}},CITY_DISTRICT:2,YEAR_MS:2*DAY,DAY,Date:FixedDate,
  CELL_RES:{food:new Float64Array(N).fill(2),timber:new Float64Array(N).fill(1),iron:new Float64Array(N).fill(.5),oil:new Float64Array(N).fill(.1)},
  NORM_HOOKS:[],RES:['food','timber','iron','oil','goods'],BUILDINGS:{farm:{},harbour:{},rail:{}},BIOME:new Uint8Array(N).fill(1),PAINT_COL:[],paintOf:()=>0,hash:()=>1,
  myId:()=> 'me',landWait:()=>'',landWaitMsg:()=>'still loading',landOffMsg:()=>'offline',pol:n=>n.policies||{},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),cityList:n=>n.cities||[],npcCities:()=>[],cityLabel:(n,c)=>c.nm||'Capital',
  freeCell:(t,c)=>Number.isInteger(c)&&c>=0&&c<N&&T[c]>=2&&t.owner[c]===-1&&!t.isCap[c]&&!t.protected?.has(c),
  cityState:()=>{throw Error('Population must not recurse into cityState');}});
 vm.runInContext(src.slice(src.indexOf('const ringMemo='),src.indexOf('function cityList('))+'\n'+src.match(/function isCoastal\(c\)\{[^\n]+/)[0]+'\n'+src.slice(src.indexOf('const CP_BLD='),src.indexOf('let cpM={')),ctx);
 vm.runInContext(src.match(/^const RES_POL = .*;/m)[0],ctx);
 vm.runInContext(src.slice(src.indexOf('const MP_CITY_GROW='),src.indexOf('function mpDraft('))+'\nthis.radius=mpRadius;this.types=MP_TYPES;this.clearSea=()=>MP_SEA_CACHE.clear();',ctx);
 vm.runInContext(src.slice(src.indexOf('function mpForestGlyphVisible('),src.indexOf("MAP_LAYERS.push({stage:'land',kinds:['main','visit'],draw:M=>{",src.indexOf('function mpLandscape('))),ctx);
 return {ctx,n,world,cell:(q,r)=>r*W+q};
}
const city=(c,more={})=>({c,id:'c'+c,nm:'City '+c,cap:false,fid:'me',hi:0,active:true,npc:false,fn:{cities:[]},done:[],prog:[],dist:[],...more});
const route=(ctx,path,k='road',id='one')=>({id,k,a:path[0],b:path.at(-1),path,t:NOW-DAY,d:NOW-DAY+(path.length-1)*ctx.types[k].mins*60000,reg:'meridian'});
test('city production reach grows at two million residents and never exceeds three',()=>{
 const {ctx}=fixture();assert.equal(ctx.radius(0),2);assert.equal(ctx.radius(1.999999),2);assert.equal(ctx.radius(2),3);assert.equal(ctx.radius(1e9),3);
});
test('overlapping city districts assign each held hex once to its closest city',()=>{
 const {ctx,world,cell}=fixture(),a=city(cell(4,4)),b=city(cell(7,4));ctx.mpAssignDistricts([a,b],world,()=>3);
 assert.ok(a.dist.length>19);assert.equal(new Set(a.dist.concat(b.dist)).size,a.dist.length+b.dist.length);
 assert.ok(a.dist.includes(a.c));assert.ok(b.dist.includes(b.c));assert.ok(!a.dist.includes(b.c));
 world.owner[cell(5,4)]=1;ctx.mpAssignDistricts([a,b],world,()=>3);assert.ok(!a.dist.includes(cell(5,4))&&!b.dist.includes(cell(5,4)));
});
test('extra production land cannot inflate population and recursively grow its own catchment',()=>{
 const {ctx,world,cell}=fixture(),all=[city(cell(4,4),{cap:true}),city(cell(8,4))];ctx.mpAssignDistricts(all,world,()=>2);for(const ct of all)ct.popDist=ct.dist.slice();
 const before=ctx.mpCityPopulations(world,all,NOW);ctx.mpAssignDistricts(all,world,()=>3);const after=ctx.mpCityPopulations(world,all,NOW);
 for(const ct of all)assert.equal(before.get(ct),after.get(ct));
 assert.ok(Math.abs([...before.values()].reduce((s,v)=>s+v,0)-ctx.cpUrban(world.list[0].n,2,'me')/100*10)<1e-9);
});
test('land transport follows owned land and respects its maximum path length',()=>{
 const {ctx,world,cell}=fixture(),a=cell(1,4),b=cell(7,4),path=ctx.mpLandPath(world,0,a,b);
 assert.ok(path);assert.equal(path[0],a);assert.equal(path.at(-1),b);assert.equal(ctx.mpLandPath(world,0,a,b,3),null);
 world.owner[b]=1;assert.equal(ctx.mpLandPath(world,0,a,b),null);
 world.owner.fill(-1);world.owner[a]=0;world.owner[b]=0;assert.equal(ctx.mpLandPath(world,0,a,b),null);
});
test('harbour reach uses water-only routes and includes fourteen steps but excludes fifteen',()=>{
 const {ctx,world,cell}=fixture(),a=cell(1,4),four=cell(15,4),five=cell(16,4);ctx.MAP.T.fill(0);ctx.MAP.T[a]=2;ctx.MAP.T[four]=2;ctx.MAP.T[five]=2;
 const reach=ctx.mpSeaReach(a);assert.equal(reach.get(four).length-1,14);assert.ok(!reach.has(five));
 for(const [end,path] of reach){assert.equal(ctx.MAP.T[end]>=2,true);assert.ok(path.slice(1,-1).every(c=>ctx.MAP.T[c]<2));}
 world.owner.fill(-1);
});
function coastFixture(){
 const f=fixture(),{ctx,n,world,cell}=f,a=cell(1,4),b=cell(5,4);ctx.MAP.T.fill(0);ctx.MAP.T[a]=2;ctx.MAP.T[b]=2;ctx.MAP.comp[b]=1;world.owner.fill(-1);world.owner[a]=0;n.cities=[{id:'cap',c:a,nm:'Port',b:[{k:'harbour',d:NOW+1}]}];return {...f,a,b};
}
test('only completed, held coastal harbours unlock free island shores',()=>{
 const {ctx,n,world,a,b}=coastFixture();assert.equal(ctx.mpHarbourFrontier(world).size,0);n.cities[0].b[0].d=NOW;
 assert.ok(ctx.mpHarbourFrontier(world).has(b));world.owner[b]=1;assert.ok(!ctx.mpHarbourFrontier(world).has(b));world.owner[b]=-1;world.protected=new Set([b]);assert.ok(!ctx.mpHarbourFrontier(world).has(b));
 world.protected.clear();world.owner[a]=1;assert.equal(ctx.mpHarbourFrontier(world).size,0);
});
test('a harbour reaches across a bay to the far shore of its own landmass',()=>{
 const {ctx,n,world,b}=coastFixture();ctx.MAP.comp[b]=0;n.cities[0].b[0].d=NOW;
 assert.ok(ctx.mpHarbourFrontier(world).has(b));assert.equal(ctx.mpClaimSequence(world,[b]).blocked.length,0);
});
test('a navy stretches harbour reach from 14 hexes of water route to 16',()=>{
 const {ctx,n,world,cell}=fixture(),a=cell(1,4),six=cell(17,4),seven=cell(18,4);ctx.MAP.T.fill(0);for(const c of [a,six,seven])ctx.MAP.T[c]=2;
 world.owner.fill(-1);world.owner[a]=0;n.cities=[{id:'cap',c:a,nm:'Port',b:[{k:'harbour',d:NOW}]}];
 assert.equal(ctx.mpHarbourReach(n),14);assert.ok(!ctx.mpHarbourFrontier(world).has(six));
 n.policies.navalFleet=1;assert.equal(ctx.mpHarbourReach(n),16);
 const fr=ctx.mpHarbourFrontier(world);assert.ok(fr.has(six));assert.equal(fr.get(six).path.length-1,16);assert.ok(!fr.has(seven));
});
test('shores that already touch your land are claimed the ordinary way, not by harbour',()=>{
 const {ctx,n,world,b,cell}=coastFixture();n.cities[0].b[0].d=NOW;world.owner[cell(5,3)]=0;ctx.MAP.T[cell(5,3)]=2;
 assert.ok(!ctx.mpHarbourFrontier(world).has(b));
});
test('a captured harbour works for its current holder and stops when the city is lost',()=>{
 const {ctx,n,world,a,b}=coastFixture();world.list.push({id:'other',n:{reg:'meridian',cities:n.cities},pop:1});n.cities=[];world.occ[a]=1;world.list[1].n.cities[0].b[0].d=NOW;
 assert.ok(ctx.mpHarbourFrontier(world).has(b));world.owner[a]=1;assert.equal(ctx.mpHarbourFrontier(world).size,0);
});
test('island claims keep normal credit costs and require a valid harbour',()=>{
 const {ctx,n,world,b}=coastFixture();assert.equal(ctx.mpClaimSequence(world,[b]).blocked.length,1);n.cities[0].b[0].d=NOW;
 const p=ctx.mpClaimSequence(world,[b,b]);assert.equal(p.cost,1);assert.equal(p.blocked.length,0);world.isCap[b]=1;assert.equal(ctx.mpClaimSequence(world,[b]).blocked.length,1);
});
test('expansion plans validate step order, ownership, duplicates and already-held land',()=>{
 const {ctx,world,cell}=fixture(),a=cell(2,4),b=cell(3,4),c=cell(4,4);world.owner.fill(-1);world.owner[a]=0;
 let p=ctx.mpClaimSequence(world,[a,b,b,c]);assert.equal(p.cost,2);assert.equal(p.blocked.length,0);
 p=ctx.mpClaimSequence(world,[c,b]);assert.equal(p.blocked.length,1);world.owner[b]=1;assert.equal(ctx.mpClaimSequence(world,[b,c]).blocked.length,2);
});
test('claim application is atomic when a saved plan is stale or unaffordable',()=>{
 const {ctx,n,world,cell}=fixture(),a=cell(2,4),b=cell(3,4),c=cell(4,4);world.owner.fill(-1);world.owner[a]=0;world.owner[c]=1;n.claims=[];n.mapPlan={cells:[b,c],reg:'meridian'};let commits=0,credits=5;
 Object.assign(ctx,{territory:()=>world,landCredits:()=>credits,clone:structuredClone,commit:x=>{ctx.S.nation=x;commits++;},render:()=>{},toast:()=>{}});
 vm.runInContext(src.slice(src.indexOf('function writeClaims('),src.indexOf('function claimBlock(')),ctx);
 assert.equal(ctx.writeClaims([b,c],'',false,true),false);assert.equal(commits,0);assert.equal(n.claims.length,0);assert.ok(n.mapPlan);
 world.owner[c]=-1;credits=1;assert.equal(ctx.writeClaims([b,c],'',false,true),false);assert.equal(commits,0);
 credits=2;assert.equal(ctx.writeClaims([b,c],'',false,true),true);assert.equal(commits,1);assert.equal(ctx.S.nation.claims.length,2);assert.equal(ctx.S.nation.mapPlan,undefined);
});
test('a full claim record cannot silently discard existing territory',()=>{
 const {ctx,n,world,cell}=fixture(),a=cell(2,4),b=cell(3,4);world.owner.fill(-1);world.owner[a]=0;let commits=0;
 Object.assign(ctx,{territory:()=>world,landCredits:()=>5,render:()=>{},commit:()=>commits++});
 vm.runInContext(src.slice(src.indexOf('function writeClaims('),src.indexOf('function claimBlock(')),ctx);
 const max=vm.runInContext('CLAIM_MAX',ctx);assert.equal(max,3000);n.claims=Array.from({length:max},()=>({c:a,t:1}));
 assert.equal(ctx.writeClaims([b],'',false,true),false);assert.equal(commits,0);assert.equal(n.claims.length,max);
 assert.match(ctx.S.mapMsg,/land record is full: a nation keeps at most 3,000 claims/);
});
test('no claim is written before the other nations’ land is known (landWait)',()=>{
 const {ctx,n,world,cell}=fixture(),a=cell(2,4),b=cell(3,4);world.owner.fill(-1);world.owner[a]=0;n.claims=[];let commits=0;
 Object.assign(ctx,{territory:()=>world,landCredits:()=>5,clone:structuredClone,commit:x=>{ctx.S.nation=x;commits++;},render:()=>{},toast:()=>{}});
 vm.runInContext(src.slice(src.indexOf('function writeClaims('),src.indexOf('function claimBlock(')),ctx);
 ctx.landWait=()=>'wait';assert.equal(ctx.writeClaims([b],''),false);assert.equal(commits,0);assert.equal(ctx.S.mapMsg,'still loading');
 ctx.landWait=()=>'off';ctx.S.mapMsg='';assert.equal(ctx.writeClaims([b],'',true),false);assert.equal(ctx.S.mapMsg,'','automatic spending says nothing');
 assert.equal(ctx.writeClaims([b],''),false);assert.equal(ctx.S.mapMsg,'offline');assert.equal(commits,0);
 ctx.landWait=()=>'';assert.equal(ctx.writeClaims([b],''),true);assert.equal(commits,1);
});
test('a record past the old 600 claims still takes new land, as far as its room and credits go',()=>{
 const {ctx,n,world,cell}=fixture(),a=cell(2,4),b=cell(3,4),c=cell(4,4);world.owner.fill(-1);world.owner[a]=0;let commits=0,credits=2;
 Object.assign(ctx,{territory:()=>world,landCredits:()=>credits,clone:structuredClone,commit:x=>{ctx.S.nation=x;commits++;},render:()=>{},toast:()=>{}});
 vm.runInContext(src.slice(src.indexOf('function writeClaims('),src.indexOf('function claimBlock(')),ctx);
 const max=vm.runInContext('CLAIM_MAX',ctx);
 n.claims=Array.from({length:max-1},()=>({c:a,t:1}));                                     // room for one more
 assert.equal(ctx.writeClaims([b,c],'',false),false);assert.equal(commits,0);assert.match(ctx.S.mapMsg,/room for 1 more hex: a nation keeps at most 3,000/);
 credits=1;n.claims=Array.from({length:600},()=>({c:a,t:1}));                           // the old limit, which refused this
 assert.equal(ctx.writeClaims([b,c],'',false),false);assert.equal(commits,0);assert.match(ctx.S.mapMsg,/takes 2 land credits, and you have 1/);
 assert.equal(ctx.writeClaims([b],'',false),true);assert.equal(commits,1);assert.equal(ctx.S.nation.claims.length,601);
});
test('transport normalization rejects loops, invalid steps, instant completion and wrong regions',()=>{
 const {ctx,n,world,cell}=fixture(),path=ctx.mpLandPath(world,0,cell(2,4),cell(5,4)),good=route(ctx,[...path]);
 assert.ok(ctx.mpRouteShape(good));for(const bad of [{...good,d:good.t},{...good,path:[good.a,good.b]},{...good,path:[good.a,good.a,good.b]},{...good,k:'unknown'}])assert.equal(ctx.mpRouteShape(bad),null);
 const out={reg:'meridian'};ctx.NORM_HOOKS[0](out,{infra:[good,{...good,id:'dup'},{...good,id:'else',reg:'other'}],mapPlan:{reg:'meridian',cells:[2,2,-1,999999,3]}});
 assert.equal(out.infra.length,1);assert.deepEqual([...out.mapPlan.cells],[2,3]);
});
function networkFixture(){
 const f=fixture(),{ctx,n,world,cell}=f,a=city(cell(2,4),{done:['rail','harbour']}),b=city(cell(5,4),{done:[]}),all=[a,b];ctx.mpAssignDistricts(all,world,()=>2);n.infra=[];return {...f,a,b,all,agg:()=>[{add:{food:0,timber:0,iron:0,oil:0},army:0}]};
}
test('only the strongest active connection boosts each city, with bounded supply',()=>{
 const {ctx,n,world,a,b,all,agg}=networkFixture(),path=[...ctx.mpLandPath(world,0,a.c,b.c)];n.infra=[route(ctx,path,'road'),route(ctx,path,'rail','rail')];const A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
 assert.equal(a.transportBonus,.1);assert.equal(b.transportBonus,.1);assert.equal(A[0].transportArmy,.04);
 assert.ok(Math.abs(A[0].add.food-(a.dist.length+b.dist.length)*2*.1)<1e-8);
});
test('unfinished, cut or prerequisite-less routes give no production or supply bonus',()=>{
 const {ctx,n,world,a,b,all,agg}=networkFixture(),path=[...ctx.mpLandPath(world,0,a.c,b.c)],r=route(ctx,path,'rail');
 for(const kind of ['unfinished','cut','no station']){world.owner.fill(0);a.done=['rail'];n.infra=[{...r}];if(kind==='unfinished')n.infra[0].d=NOW+60000;if(kind==='cut')world.owner[path[1]]=1;if(kind==='no station')a.done=[];
   const A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
   /* a cut route keeps the stretch still joined to its far city; the origin's own hex is the only part joined to it */
   if(kind==='cut'){assert.equal(ctx.mpRouteStatus(n.infra[0],world,0,new Map(all.map(c=>[c.c,c])),NOW),'Partly cut');assert.equal(b.transportBonus,.1);assert.equal(a.transportBonus,.1);continue;}
   assert.equal(A[0].add.food,0,kind);assert.equal(A[0].transportArmy,0,kind);}
});
function lineFixture(){
 const f=fixture(),{ctx,n,world,cell}=f,a=city(cell(2,4)),m=city(cell(8,4)),b=city(cell(14,4)),all=[a,m,b];ctx.mpAssignDistricts(all,world,()=>2);
 const path=[];for(let q=2;q<=14;q++)path.push(cell(q,4));n.infra=[route(ctx,path)];
 return {...f,a,m,b,all,path,agg:()=>[{add:{food:0,timber:0,iron:0,oil:0},army:0}]};
}
test('a city the road passes through is on the road, not only its two ends',()=>{
 const {ctx,world,a,m,b,all,agg}=lineFixture(),A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
 for(const ct of [a,m,b])assert.equal(ct.transportBonus,.04,ct.nm);assert.equal(A[0].transportArmy,.06);
});
test('road hexes that no city works yield ten percent more, counted once',()=>{
 const {ctx,n,world,all,path,agg}=lineFixture(),worked=new Set(all.flatMap(c=>c.dist)),free=path.filter(c=>!worked.has(c));assert.ok(free.length>0);
 const base=all.reduce((s,c)=>s+c.dist.length,0)*2*.04,A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
 assert.ok(Math.abs(A[0].add.food-(base+free.length*2*.1))<1e-8);
 n.infra.push({...n.infra[0],id:'two',k:'rail',d:NOW-1});all.forEach(c=>c.done=['rail']);const B=agg();ctx.mpNetworkBonuses(world,all,B,NOW);
 assert.ok(Math.abs(B[0].add.food-(base/.04*.1+free.length*2*.1))<1e-8,'a second route over the same hexes adds no more hex yield');
});
test('a partly cut road keeps working up to the break from each end',()=>{
 const {ctx,n,world,a,m,b,all,path}=lineFixture();world.owner[path[3]]=1;
 assert.deepEqual([...ctx.mpLiveCells(n.infra[0],world,0)],path.slice(0,3).concat(path.slice(4)));
 ctx.mpNetworkBonuses(world,all,[{add:{},army:0}],NOW);for(const ct of [a,m,b])assert.equal(ct.transportBonus,.04,ct.nm);
 world.owner[path[9]]=1;ctx.mpNetworkBonuses(world,all,[{add:{},army:0}],NOW);assert.equal(m.transportBonus,undefined,'cut off from both ends');assert.equal(a.transportBonus,.04);assert.equal(b.transportBonus,.04);
});
test('military transport supply is capped at six percent regardless of network size',()=>{
 const {ctx,n,world,cell}=fixture(),all=[2,4,6,8].map(q=>city(cell(q,4))),A=[{add:{food:0,timber:0,iron:0,oil:0},army:0}];ctx.mpAssignDistricts(all,world,()=>2);
 n.infra=all.slice(1).map((ct,i)=>route(ctx,[...ctx.mpLandPath(world,0,all[0].c,ct.c)],'road','r'+i));ctx.mpNetworkBonuses(world,all,A,NOW);assert.equal(A[0].transportArmy,.06);
});
test('transport improves actual completed building output as well as worked land',()=>{
 const {ctx,n,world,a,b,all,agg}=networkFixture();a.buildOutput={goods:5,food:2};n.infra=[route(ctx,[...ctx.mpLandPath(world,0,a.c,b.c)])];const A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
 assert.equal(A[0].add.goods,.2);assert.ok(Math.abs(A[0].add.food-((a.dist.length+b.dist.length)*2+2)*.04)<1e-8);
});
test('transport respects the land output lost to forest protection and fossil phase-out',()=>{
 const {ctx,n,world,a,b,all,agg}=networkFixture();n.policies={forestProtection:1,fossilPhaseOut:1};n.infra=[route(ctx,[...ctx.mpLandPath(world,0,a.c,b.c)])];const A=agg();ctx.mpNetworkBonuses(world,all,A,NOW);
 const count=a.dist.length+b.dist.length;assert.ok(Math.abs(A[0].add.timber-count*.65*.04)<1e-8);assert.ok(Math.abs(A[0].add.oil-count*.1*.5*.04)<1e-8);
});
test('policy landscapes reflect the correct biome without changing terrain or resource yields',()=>{
 const {ctx,n,cell}=fixture(),c=cell(4,4),terrain=ctx.MAP.T[c],food=ctx.CELL_RES.food[c];n.policies={forestProtection:true,rewilding:true,fossilPhaseOut:true};ctx.BIOME[c]=2;
 assert.ok(ctx.mpLandscape(n,c).includes('protected groves'));assert.ok(ctx.mpLandscape(n,c).includes('renewable energy transition'));ctx.BIOME[c]=3;assert.ok(!ctx.mpLandscape(n,c).includes('protected groves'));assert.equal(ctx.MAP.T[c],terrain);assert.equal(ctx.CELL_RES.food[c],food);
 n.policies={clearFelling:1};assert.equal(ctx.mpForestGlyphVisible(n,c),false);n.policies={};assert.equal(ctx.mpForestGlyphVisible(n,c),true);assert.ok(ctx.mpLandscape(n,c,true).includes('industrial development'));n.policies.emissions=1;assert.ok(!ctx.mpLandscape(n,c,true).includes('industrial development'));
});

// Jumping the map to a hex (My nation, Show on the map, a test's click on a hex) while a zoom was still gliding: the
// glide's remaining frames wrote its own destination over the view just set, so the map ended up somewhere else.
test('jumping the main map to a hex ends a glide still running on it',()=>{
 const line=start=>{const at=src.indexOf(start);assert.ok(at>=0,start);return src.slice(at,src.indexOf('\n',at));},cancelled=[];
 const ctx=vm.createContext({S:{},MAP:{cx:[0,10,20],cy:[0,5,9]},NEAR_Z:6,cancelAnimationFrame:id=>cancelled.push(id)});
 vm.runInContext([line('const MAP_GLIDES={};'),line('function mapGlideStop('),line('function centerMain('),'this.X={MAP_GLIDES,centerMain};'].join('\n'),ctx);
 ctx.X.MAP_GLIDES.main={raf:7};ctx.X.MAP_GLIDES.mini={raf:9};
 ctx.X.centerMain(2,5);
 assert.deepEqual(cancelled,[7],'the glide’s next frame is cancelled');assert.equal(ctx.X.MAP_GLIDES.main,undefined);assert.ok(ctx.X.MAP_GLIDES.mini,'another map’s glide is left alone');
 assert.deepEqual({...ctx.S.mapViews.main},{z:5,cx:20,cy:9});
 ctx.X.centerMain(1);assert.equal(ctx.S.mapViews.main.z,6);assert.deepEqual(cancelled,[7],'nothing to stop the second time');
});
