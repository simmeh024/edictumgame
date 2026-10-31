// Real UI and private/shared saves on desktop and phone. All fixture writes target local emulators.
import {BASE,OUT,PROJECT,FS_HOST,check,finish,until,player,open,nav,text,localNation,nationDoc,restGet,establish,clearEmulators,errors} from './lib.mjs';
if(!PROJECT.startsWith('demo-'))throw Error('This suite requires a demo emulator project');
await clearEmulators();
const settle=p=>p.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
const A=await player('map development desktop'),uid=await open(A);
await A.waitForSelector('#d-name');await A.fill('#d-name','Coastland');
const coast=await A.evaluate(()=>{
 const T=G.territory(),M=G.MAP,D=G.MD;
 for(let c=0;c<M.N;c++){
  if(M.T[c]<2||T.owner[c]>=0||M.coast[c]!==0||D.pickProblem(c,T))continue;
  const land=D.ringCells(c,3).filter(([v])=>M.T[v]>=2&&T.owner[v]<0);if(land.length<20)continue;
  const shores=[...D.mpSeaReach(c)].filter(([b,path])=>path.length===5&&M.comp[b]!==M.comp[c]&&T.owner[b]===-1&&!D.ringCells(b,2).some(([v])=>T.isCap[v]));if(!shores.length)continue;
  const preview=G.territory({id:'draft',loc:G.locOf(c),n:{...G.S.draft,name:'Preview',founded:Date.now(),claims:[],cities:[]},pop:5});
  for(const [b] of shores)if(preview.owner[b]===-1){
    G.S.draft.loc=G.locOf(c);G.render();return {cap:c,island:b};
  }
 }return null;
});
if(!coast)throw Error('No suitable free coastal fixture found');
await A.click('#found-btn');await A.waitForSelector('.layout');await establish(A);
const saved=async(p=A)=>{if(!await until(async()=>{const n=await localNation(p);return n?._rev>0&&!n._dirty;},15000))throw Error('Save did not settle: '+JSON.stringify(errors));};
await saved();
async function patchDoc(doc,change){
 const raw=await restGet(doc);if(raw.status!==200)throw Error('Missing fixture '+doc);
 const fields=raw.body.fields,record=JSON.parse(fields.j.stringValue);change(record);fields.j={stringValue:JSON.stringify(record)};
 if(doc.startsWith('nations/')){fields.pop={doubleValue:record.pop};fields.rev={integerValue:String(Number(fields.rev.integerValue)+1)};fields.t={integerValue:String(Date.now())};}
 const r=await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${doc}`,{method:'PATCH',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({fields})});
 if(!r.ok)throw Error('Could not seed emulator fixture '+r.status);
}
await A.goto('about:blank');
await patchDoc('nationx/'+uid,n=>{n.lcb=30;n.freq=1440;});
await patchDoc('nations/'+uid,n=>{
 const now=Date.now();n.pop=2.5;n.popAt=now;n.updatedAt=now;
 n.cities[0].b=['farm','harbour','rail'].map(k=>({k,s:now-2*864e5,d:now-864e5,a:1}));n.stock={food:250,timber:250,iron:250,oil:250,goods:250};n.stockAt=now;
 n.policies={...n.policies,forestProtection:1,fossilPhaseOut:1,industrialStrategy:1};
});
await open(A);await A.waitForSelector('.layout');await until(async()=>(await localNation(A)).pop<3);
const cityFacts=p=>p.evaluate(()=>{const T=G.territory(),CS=G.MD.cityState(T),ct=CS.all.find(c=>c.fid===G.myId()&&c.cap);return {radius:ct.radius,worked:ct.dist.length,pop:G.MD.cpPop(ct,T),calc:ct.population,food:CS.agg[T.byId[G.myId()]].add.food,owned:[...ct.dist],unique:new Set(CS.all.flatMap(c=>c.dist)).size,total:CS.all.reduce((s,c)=>s+c.dist.length,0)};});
const small=await cityFacts(A);
check('small existing cities retain their two-hex production reach',small.radius===2&&small.worked>0,JSON.stringify(small));
check('population allocation agrees with the actual city population display',Math.abs(small.pop-small.calc)<1e-3); // Cached catchments refresh per 1,000 national residents.
await A.goto('about:blank');await patchDoc('nations/'+uid,n=>{n.pop=30;n.popAt=Date.now();n.updatedAt=Date.now();});
await open(A);await A.waitForSelector('.layout');await until(async()=>(await localNation(A)).pop>29);
const large=await cityFacts(A);
check('growing the city expands its real production catchment to three hexes',large.radius===3&&large.worked>small.worked,JSON.stringify({small:small.worked,large:large.worked}));
check('production buildings really use the newly worked land',large.food>small.food);
check('overlapping production districts never double-count a hex',large.unique===large.total);
await A.evaluate(()=>{G.commit(G.clone(G.S.nation));G.render();});await saved();await nav(A,'cities');
check('city cards explain their population-based production reach',/3-hex reach/.test(await text(A,'.mp-influence')));
await nav(A,'map');
check('map tools expose expansion, transport and optional visual layers',await A.locator('.mp-map-toolbar').count()===1&&await A.locator('[data-mp-opt]').count()===3);
const clickCell=async(p,c)=>{
 await p.evaluate(c=>{G.MD.centerMain(c,5);G.render();},c);const cv=p.locator('canvas[data-map="main"]');await cv.scrollIntoViewIfNeeded();
 const pos=await p.evaluate(c=>{const cv=document.querySelector('canvas[data-map="main"]'),v=G.MD.viewOf('main',cv),s=G.MD.mapScale(cv,v);return {x:cv.clientWidth/2+(G.MAP.cx[c]-v.cx)*s,y:cv.clientHeight/2+(G.MAP.cy[c]-v.cy)*s};},c);
 await cv.click({position:pos});
};
const plan=await A.evaluate(cap=>{
 const T=G.territory(),a=[];for(const c of G.MD.claimFrontier(T)){if(G.MAP.comp[c]!==G.MAP.comp[cap])continue;const p=G.MD.mpClaimSequence(T,a.concat(c));if(!p.blocked.length&&p.cost===a.length+1)a.push(c);if(a.length===3)break;}return a;
},coast.cap);
if(plan.length!==3)throw Error('Need three free expansion steps');
const beforePlan=(await localNation(A)).claims.length;
await A.click('.mp-map-toolbar [data-v="plan"]');for(const c of plan)await clickCell(A,c);
check('map selections build an ordered three-hex plan with a yield preview',await A.locator('.mp-steps li').count()===3&&/Base yield per day/.test(await text(A,'.mp-tool')));
check('previewing a plan claims no land and spends no credits',(await localNation(A)).claims.length===beforePlan);
await A.click('[data-act="mp-save"]');await saved();
check('saved expansion plans stay in the private half',!!(await nationDoc(uid)).rec.mapPlan&&!(await nationDoc(uid)).shared.mapPlan);
await open(A);await nav(A,'map');await A.click('.mp-map-toolbar [data-v="plan"]');
check('saved plans restore after reload',await A.locator('.mp-steps li').count()===3);
const B=await player('map development phone',{vp:{width:390,height:844},dark:true,storageState:await A.ctx.storageState({indexedDB:true})});await open(B);await B.waitForSelector('.layout');await nav(B,'map');await B.click('.mp-map-toolbar [data-v="plan"]');
check('another device restores the private plan',await B.locator('.mp-steps li').count()===3);
check('planner fits the phone without sideways scrolling',await B.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await B.evaluate(()=>window.scrollTo(0,0));await settle(B);await B.screenshot({path:OUT+'/map-planner-390.png'});await B.locator('.mp-tool').screenshot({path:OUT+'/map-planner-panel-390.png'});await B.ctx.close();
await A.click('[data-act="mp-apply"]');await saved();
check('applying a plan claims the selected hexes exactly once',await A.evaluate(plan=>{const T=G.territory(),hi=T.byId[G.myId()];return plan.every(c=>T.owner[c]===hi)&&G.S.nation.claims.filter(e=>plan.includes(e.c)).length===plan.length;},plan));
check('applied plans clear their private saved draft',!(await localNation(A)).mapPlan);
await A.click('.mp-map-toolbar [data-act="mp-mode"][data-v=""]');
const island=await A.evaluate(()=>{const T=G.territory();return [...G.MD.mpHarbourFrontier(T)].find(([c,e])=>e.path.length===5)?.[0]??null;});
if(island==null)throw Error('Harbour fixture has no free four-step shore: '+JSON.stringify(await A.evaluate(coast=>{const T=G.territory();return {coast,targetOwner:T.owner[coast.island],cities:G.S.nation.cities,shores:[...G.MD.mpHarbourFrontier(T)].map(([c,e])=>[c,e.path.length-1])};},coast)));
check('a completed harbour exposes four-step island annexation',island!=null);
await A.click('.mp-map-toolbar [data-v="plan"]');await clickCell(A,island);
check('an island shore can start a one-credit plan',await A.locator('.mp-steps li').count()===1&&/Claim plan \(1 credit\)/.test(await text(A,'[data-act="mp-apply"]')));
await A.click('[data-act="mp-apply"]');await saved();
check('island annexation actually changes ownership',await A.evaluate(c=>{const T=G.territory();return T.owner[c]===T.byId[G.myId()];},island));
await A.click('.mp-map-toolbar [data-act="mp-mode"][data-v=""]');await A.click('.mp-map-toolbar [data-v="transport"]');
const dest=await A.evaluate(()=>{const T=G.territory(),D=G.MD,ct=D.cityState(T).byCell.get(G.S.nation.cities[0].c);return ct.dist.find(c=>c!==ct.c&&!D.mpRoutePreview(T,'road',ct.c,c).why);});
await A.selectOption('#mp-net-from',String(coast.cap));await A.selectOption('#mp-net-to',String(dest));
check('transport preview shows real construction cost and benefit',/Materials/.test(await text(A,'.mp-tool'))&&/Local production/.test(await text(A,'.mp-tool')));
const beforeBuild=await localNation(A),preview=await A.evaluate(dest=>{const p=G.MD.mpRoutePreview(G.territory(),'road',G.S.nation.cities[0].c,dest);return {cost:p.cost,steps:p.steps};},dest);
await A.click('[data-act="mp-net-build"]');await saved();const afterBuild=await localNation(A);
// the first road also finishes the tutorial's "Link two cities by road" in the same save: its gift is not part of the cost
const tutGift=await A.evaluate(([a,b])=>{const was=new Set((a.tut&&a.tut.lc)||[]),now=(b.tut&&b.tut.lc)||[],g={};
  for(const L of G.TUTL.lists)for(const s of L.tasks)if(!was.has(s.k)&&now.includes(s.k))for(const [r,v] of Object.entries(s.gift||{}))g[r]=(g[r]||0)+v;return g;},[beforeBuild,afterBuild]);
check('building a road spends the quoted resources once',Object.entries(preview.cost).every(([r,v])=>Math.abs(beforeBuild.stock[r]-afterBuild.stock[r]+(tutGift[r]||0)-v)<.2),JSON.stringify({before:beforeBuild.stock,after:afterBuild.stock,cost:preview.cost,tutGift}));
check('transport connections persist in the shared half',!!(await nationDoc(uid)).shared.infra?.length);
check('unfinished transport gives no early production bonus',await A.evaluate(()=>{const T=G.territory();return !(G.MD.cityState(T).byCell.get(G.S.nation.cities[0].c).transportBonus);}));
await open(A);await nav(A,'map');await A.click('.mp-map-toolbar [data-v="transport"]');
check('a road survives normalization and reload',/Under construction/.test(await text(A,'.mp-net-list')));
await A.click('[data-act="mp-net-remove"]');
check('removing a paid connection asks before discarding it',await A.locator('[data-act="mp-net-remove-confirm"]').count()===1&&(await localNation(A)).infra.length===1);await A.click('[data-act="mp-net-keep"]');
await saved();await A.goto('about:blank');await patchDoc('nations/'+uid,n=>{for(const r of n.infra){const duration=r.d-r.t;r.t=Date.now()-duration-60000;r.d=r.t+duration;}n.updatedAt=Date.now();});
await open(A);await nav(A,'map');await A.click('.mp-map-toolbar [data-v="transport"]');
check('completed transport supplies its actual bounded production and army bonus',await until(()=>A.evaluate(()=>{const T=G.territory(),CS=G.MD.cityState(T),ct=CS.byCell.get(G.S.nation.cities[0].c),a=CS.agg[T.byId[G.myId()]];return ct.transportBonus===.04&&a.transportArmy===.02;}),15000),JSON.stringify((await localNation(A)).infra));
check('completed connection status updates on the map',await until(async()=>/Active/.test(await text(A,'.mp-net-list'))));
await A.selectOption('#mp-net-kind','rail');await A.selectOption('#mp-net-from',String(coast.cap));await A.selectOption('#mp-net-to',String(dest));await A.click('[data-act="mp-net-build"]');await saved();
check('a completed railway station enables a real railway build',(await localNation(A)).infra.some(r=>r.k==='rail'));
await A.selectOption('#mp-net-kind','sea');await A.selectOption('#mp-net-from',String(coast.cap));await A.selectOption('#mp-net-to',String(island));
check('harbour annexation can be connected by a real shipping route',await A.locator('[data-act="mp-net-build"]:not([disabled])').count()===1);await A.click('[data-act="mp-net-build"]');await saved();
check('shipping route uses at most four water-route steps',(await localNation(A)).infra.some(r=>r.k==='sea'&&r.path.length<=5));
await A.check('[data-mp-opt="influence"]');await A.evaluate(c=>{G.MD.centerMain(c,18);G.render();},coast.cap);await settle(A);await A.screenshot({path:OUT+'/map-networks-1280.png',fullPage:true});
await A.locator('canvas[data-map="main"]').screenshot({path:OUT+'/map-network-detail.png'});
check('map options retain the policy and infrastructure visual layers',await A.locator('[data-mp-opt="landscape"]:checked').count()===1&&await A.locator('[data-mp-opt="networks"]:checked').count()===1);
await nav(A,'nation');await nav(A,'map');check('leaving the map ends tool mode without changing saved preferences',await A.evaluate(()=>!G.S.mpMode)&&await A.locator('[data-mp-opt="influence"]:checked').count()===1);
await A.ctx.close();check('no page errors',!errors.length,errors.join(' | '));await finish();
