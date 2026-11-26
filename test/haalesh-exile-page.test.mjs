import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {assemblyEngine} from '../functions/assembly-engine.js';
import {dhaluunMotion} from '../functions/dhaluun-assembly.js';
import {EXILE_TITLE,EXILE_TEXT,EVENT} from '../functions/haalesh-exile.js';

test('the exile request shares the docket, explains its consequences on mobile, and creates its native country only after passage',async()=>{
 const now=Date.now(),E=assemblyEngine('cloudspine',[]),c=E.cycle(now),L={c:c+2,k:EVENT,ti:EXILE_TITLE,tx:EXILE_TEXT,cat:'exilepetition',g:0,by:'npc-cloudspine-saaveri',bn:'Saaveri',w:'n',lt:now},old={...L,c,k:'current-player-motion',ti:'Current player motion',cat:'trade'},locks=[old,dhaluunMotion(c+1,now),L];
 const payload=t=>{const st=assemblyEngine('cloudspine',[],locks).state(t);return {reg:'cloudspine',c:st.c,t0:st.t0,t1:st.t1,cur:st.cur,locks,recs:[],D:null,V:{...st.V,rows:st.V.rows.map(({n,...r})=>r)},info:[],npc:[],account:{kind:'guest',eligible:false},own:{r:'cloudspine'}};};
 const event={v:1,reg:'cloudspine',phase:'published',t:now,c:L.c,opens:E.t0(L.c),ends:E.t0(L.c+1)},browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());await page.goto('https://edictum.invalid/');
  await page.evaluate(now=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Tester',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>{window.G=g;};window.testNow=now;Date.now=()=>window.testNow;},now);
  const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
  await page.addScriptTag({content:script.replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Offline exile rendering. */')});
  await page.addStyleTag({content:html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'))});
  assert.equal(await page.evaluate(({p,event})=>{const P=window.EDICTUM_PROBE;P.dhaluun.load([]);P.exile.install(event);P.dhaluunAssembly.install(p);document.getElementById('app').style.display='none';const main=document.createElement('main');main.id='fixture';main.style.padding='12px';main.innerHTML=P.dhaluunAssembly.queue(G.ASMX().asmState(),Date.now());document.body.append(main);return G.ASMX().asmState().cur.k;},{p:payload(now),event}),old.k);
  const docket=page.locator('.asm-scheduled');assert.equal(await docket.count(),2);assert.match(await docket.nth(0).innerText(),/Condemnation of Dhaluun/);assert.equal(await docket.nth(1).locator('.asm-tx').innerText(),EXILE_TEXT);
  assert.equal(await page.evaluate(()=>window.EDICTUM_PROBE.exile.snapshot().ids.includes('npc-cloudspine-free-haalesh')),false);
  await page.setViewportSize({width:390,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await docket.nth(1).screenshot({path:'test/out/haalesh-exile-docket-mobile.png'});
  const voting=E.t0(L.c)+1000;
  await page.evaluate(({p,voting})=>{window.testNow=voting;const C=window.EDICTUM_PROBE.dhaluunAssembly;C.install(p);document.getElementById('fixture').innerHTML=C.vote(G.ASMX().asmState(),voting);},{p:payload(voting),voting});
  const vote=page.locator('.asm-vote');assert.equal(await vote.locator('.asm-tx').innerText(),EXILE_TEXT);assert.match(await vote.innerText(),/seven|7/);assert.doesNotMatch(await vote.innerText(),/Mild/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await vote.screenshot({path:'test/out/haalesh-exile-vote-mobile.png'});
  const result=await page.evaluate(({event,at})=>{window.testNow=at;const X=window.EDICTUM_PROBE.exile;X.install({...event,phase:'rejected'});const absent=!X.snapshot().ids.includes(X.spec.id);const nation={...X.plan(),t:at};X.install({...event,phase:'passed',nation});const s=X.snapshot();return {absent,id:X.spec.id,count:s.owner.filter(o=>s.ids[o]===X.spec.id).length,city:s.cities.find(c=>c.fid===X.spec.id)};},{event,at:event.ends+1000});
  assert.equal(result.absent,true);assert.equal(result.count,7);assert.equal(result.city.nm,'Refuge');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
