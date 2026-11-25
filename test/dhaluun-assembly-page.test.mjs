import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {assemblyEngine} from '../functions/assembly-engine.js';
import {dhaluunMotion,dhAsmT0,DH_ASM_TEXT} from '../functions/dhaluun-assembly.js';
test('the full condemnation is visible on the next docket, then on the normal voting card, with readable mobile paragraphs',async()=>{
  const now=Date.now(),c=assemblyEngine('cloudspine',[]).cycle(now),L=dhaluunMotion(c+1,now),old={...L,c,k:'current-player-motion',ti:'More Trade, More Good',tx:'Make that money',cat:'trade',tg:'',by:'player-a',bn:'Balbosa',w:'s'},locks=[old,L];
  const payload=t=>{const st=assemblyEngine('cloudspine',[],locks).state(t);return {reg:'cloudspine',c:st.c,t0:st.t0,t1:st.t1,cur:st.cur,locks,recs:[],D:null,V:{...st.V,rows:st.V.rows.map(({n,...r})=>r)},info:[],npc:[],account:{kind:'guest',eligible:false},own:{r:'cloudspine'}};};
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());await page.goto('https://edictum.invalid/');
    await page.evaluate(now=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Tester',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>{window.G=g;};window.testNow=now;Date.now=()=>window.testNow;},now);
    const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
    await page.addScriptTag({content:script.replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Offline Assembly rendering. */')});
    await page.addStyleTag({content:html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'))});
    const current=await page.evaluate(p=>{const P=window.EDICTUM_PROBE,C=P.dhaluunAssembly;P.dhaluun.load([]);C.install(p);document.getElementById('app').style.display='none';const fixture=document.createElement('main');fixture.id='fixture';fixture.style.padding='12px';fixture.innerHTML=C.queue(G.ASMX().asmState(),Date.now());document.body.append(fixture);return G.ASMX().asmState().cur.k;},payload(now));
    assert.equal(current,old.k);const docket=page.locator('.asm-scheduled');assert.equal(await docket.locator('.asm-tx').innerText(),DH_ASM_TEXT);assert.match(await docket.innerText(),/Proposed by Saaveri/);assert.equal(await docket.locator('.asm-tx').evaluate(e=>getComputedStyle(e).whiteSpace),'pre-line');
    await docket.screenshot({path:'test/out/dhaluun-assembly-docket.png'});
    await page.setViewportSize({width:390,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await docket.screenshot({path:'test/out/dhaluun-assembly-mobile.png'});
    const next=dhAsmT0(c+1)+1000;
    await page.evaluate(({p,next})=>{window.testNow=next;const C=window.EDICTUM_PROBE.dhaluunAssembly;C.install(p);document.getElementById('fixture').innerHTML=C.vote(G.ASMX().asmState(),next);},{p:payload(next),next});
    const vote=page.locator('.asm-vote');assert.equal(await vote.locator('.asm-tx').innerText(),DH_ASM_TEXT);assert.match(await vote.innerText(),/Tabled following Dhaluun’s customs sabotage/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
