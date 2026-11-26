import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {HEADLINE,ARTICLE} from '../tools/admin/dhaluun-north.mjs';
test('the real map gains a connected northern corridor and city, Kesara receives one successful scandal, and Haalesh changes government and joins the existing pact',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());await page.goto('https://edictum.invalid/');
  await page.evaluate(()=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Tester',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>window.G=g;window.testNow=Date.now();Date.now=()=>window.testNow;});
  const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
  await page.addScriptTag({content:script.replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Offline event integration. */')});
  const result=await page.evaluate(({h,b})=>{
   const P=window.EDICTUM_PROBE,D=P.dhaluun,W=P.dhaluunWall,N=P.dhaluunNorth,R=P.dhaluunRegime;D.load([]);const base=D.plan();base.t-=60000;W.install(base);
   const initial=G.territory(),di=initial.byId[base.by],cap=initial.list[di].cap,M=G.MAP;
   let anchor=-1,best=Infinity;for(let c=0;c<M.N;c++){if(initial.owner[c]!==-1||M.T[c]<2)continue;const score=Math.abs(M.cx[c]-M.cx[cap])+Math.abs(M.cy[c]-(M.cy[cap]-300));if(score<best){best=score;anchor=c;}}
   const now=Date.now(),rows=[{id:'test-kesara',n:{name:'Kesara',capital:'Morbridge',reg:'cloudspine',loc:G.locOf(anchor),founded:now-20*864e5,popAt:now,updatedAt:now,pop:10,claims:[],inbox:[]}}];D.load(rows);W.install(base);
   const T=G.territory(),oldCities=W.cities(base.by).map(c=>({id:c.id,c:c.c,nm:c.nm})),original=G.NPX().findNation(R.spec.id).n,north=N.plan(),haalesh={v:1,t:north.t,h,b};W.install({...base,north,haalesh});
   const A=G.territory(),CS=W.cityState(A),city=CS.all.find(c=>c.id===north.city.id),g=G.NPX().findNation(R.spec.id).n,pact=G.ALX().politics().of.get(R.spec.id);
   let unchanged=true;for(let c=0;c<T.owner.length;c++)if(T.owner[c]>=0&&T.owner[c]!==di&&A.list[A.owner[c]]?.id!==T.list[T.owner[c]].id)unchanged=false;
   const reached=new Set();for(let c=0;c<T.owner.length;c++)if(T.owner[c]===di)reached.add(c);let grow=true;while(grow){grow=false;for(const c of north.land)if(!reached.has(c)&&Array.from(M.nbrFlat.slice(c*6,c*6+6)).some(n=>reached.has(n))){reached.add(c);grow=true;}}
   const history=N.at(north.t-1),historic={count:history.T.count[di],city:history.cities.some(c=>c.id===north.city.id),government:R.form(original,north.t-1).s},ops=D.index().all.filter(e=>e.op.id===north.scandal.id);
   G.S.uid='test-kesara';const n=structuredClone(G.S.world['test-kesara']);G.S.nation=n;const pending=N.pending(n).length;N.apply(n);const delivered=n.inbox.filter(e=>e.id===north.scandal.is).length,second=N.apply(n),pendingAfter=N.pending(n).length;
   const DS=G.DSP(),edition=DS.dspBuild(DS.dspNoOf(now),now),stories=edition.all.filter(s=>s.h===h);
   window.northFixture={base,north,haalesh};
   return {added:A.count[di]-T.count[di],planned:north.land.length,free:north.land.every(c=>T.owner[c]===-1),connected:north.land.every(c=>reached.has(c)),northmost:Math.min(...north.land.map(c=>M.cy[c])),anchorY:M.cy[north.anchor.c],unchanged,city:{name:city.nm,active:city.active,done:city.done},sameCities:oldCities.every(c=>W.cities(base.by).some(a=>a.id===c.id&&a.c===c.c&&a.nm===c.nm)),historic,original:original.s,category:R.category(g.s),corrupt:g.s.corrupt,policies:g.policies,pact:{id:pact.id,members:pact.members},ops:ops.map(e=>({ok:e.ok,ex:e.ex,tg:e.op.tg})),pending,delivered,second,pendingAfter,stories:stories.map(s=>({h:s.h,b:s.b}))};
  },{h:HEADLINE,b:ARTICLE});
  assert.ok(result.added>0);assert.equal(result.added,result.planned);assert.equal(result.free,true);assert.equal(result.connected,true);assert.equal(result.unchanged,true);assert.equal(result.northmost,result.anchorY);assert.equal(result.sameCities,true);
  assert.equal(result.city.name,'Imperial Survey Station No. 1');assert.equal(result.city.active,true);assert.deepEqual(result.city.done,['market','barracks','warehouse']);assert.equal(result.historic.city,false);assert.equal(result.historic.count,188);assert.deepEqual(result.historic.government,result.original);
  assert.equal(result.category,'Corrupt Dictatorship');assert.equal(result.corrupt,88);assert.equal(result.policies.noElections,1);assert.equal(result.policies.censorship,1);assert.equal(result.policies.unionRecognition,undefined);
  assert.equal(result.pact.id,'bloc-snows');assert.deepEqual(result.pact.members,['npc-cloudspine-dhaluun','npc-cloudspine-kethavaar','npc-cloudspine-haalesh']);assert.deepEqual(result.ops,[{ok:true,ex:false,tg:'test-kesara'}]);assert.equal(result.pending,1);assert.equal(result.delivered,1);assert.deepEqual(result.second,[]);assert.equal(result.pendingAfter,0);assert.deepEqual(result.stories,[{h:HEADLINE,b:ARTICLE}]);
  await page.addStyleTag({content:html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'))});
  await page.evaluate(()=>{G.S.nation=G.normalize({name:'Reader',reg:'cloudspine',pop:5,founded:Date.now()});document.getElementById('app').style.display='none';const main=document.createElement('main');main.id='north-report';main.innerHTML=G.DSP().dspView(Date.now());document.body.append(main);});
  const title=page.getByText(HEADLINE,{exact:true}).first();await title.waitFor({state:'visible'});assert.ok(await page.getByText(ARTICLE,{exact:true}).first().isVisible());
  await title.evaluate(e=>(e.closest('article')||e.parentElement).setAttribute('data-north-report','true'));await page.locator('[data-north-report]').screenshot({path:'test/out/haalesh-purchased-cabinet.png'});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
