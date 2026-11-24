import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {HEADLINE,ARTICLE} from '../tools/admin/dhaluun-wall.mjs';
test('the real game builds the full wall with its defence bonus and prints the sourced Dispatch article',async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());
    await page.goto('https://edictum.invalid/');
    await page.evaluate(()=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Planner',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>{window.G=g;};});
    const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
    await page.addScriptTag({content:script.replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Isolated test: no connection or saves. */')});
    const result=await page.evaluate(({headline,article})=>{
      const P=window.EDICTUM_PROBE,D=P.dhaluun,W=P.dhaluunWall;D.load([]);const event=D.plan();W.install(event);
      const before=G.territory(),i=before.byId[event.by],oldDef=W.defence(before,i,before.list[i].cap),oldCount=Array.from(before.count);
      const wall={v:1,t:Date.now(),h:headline,b:article};W.install({...event,wall});const T=G.territory(),CS=W.cityState(T),geo=W.geometry(T,i);
      let expected=0;for(let c=0;c<G.MAP.N;c++)if(T.owner[c]===i)for(let d=0;d<6;d++){const nb=G.MAP.nbr[c*6+d];if(nb<0||T.owner[nb]!==i)expected++;}
      const now=Date.now(),DS=G.DSP(),E=DS.dspBuild(DS.dspNoOf(now),now);
      const visible=[E.lead,...E.second,...E.brief,...E.secs.flatMap(s=>s.st)].filter(Boolean),report=visible.filter(s=>s.h===headline);
      window.wallFixture={T,i};
      return {wall:CS.agg[i].wall,ratio:W.defence(T,i,T.list[i].cap)/oldDef,edges:geo.lines.length,expected,oldCount,count:Array.from(T.count),reports:report.length,body:report[0]?.b,allReports:E.all.filter(s=>s.h===headline).length};
    },{headline:HEADLINE,article:ARTICLE});
    assert.equal(result.wall,true);assert.ok(Math.abs(result.ratio-1.12)<1e-9);assert.equal(result.edges,result.expected);assert.ok(result.edges>16);assert.deepEqual(result.count,result.oldCount);
    assert.equal(result.reports,1);assert.equal(result.allReports,1);assert.equal(result.body,ARTICLE);
    await page.evaluate(()=>{
      const {T,i}=window.wallFixture,W=window.EDICTUM_PROBE.dhaluunWall,M=G.MAP,cells=[];for(let c=0;c<M.N;c++)if(T.owner[c]===i)cells.push(c);
      const xs=cells.map(c=>M.cx[c]),ys=cells.map(c=>M.cy[c]),x0=Math.min(...xs)-25,y0=Math.min(...ys)-25,x1=Math.max(...xs)+25,y1=Math.max(...ys)+25,s=Math.min(1100/(x1-x0),760/(y1-y0));
      const cv=document.createElement('canvas');cv.id='wall-map';cv.width=1200;cv.height=820;document.body.replaceChildren(cv);const g=cv.getContext('2d');g.fillStyle='#dce8ed';g.fillRect(0,0,cv.width,cv.height);g.setTransform(s,0,0,s,40-x0*s,30-y0*s);
      for(let c=0;c<M.N;c++){if(M.T[c]<2||M.cx[c]<x0||M.cx[c]>x1||M.cy[c]<y0||M.cy[c]>y1)continue;g.beginPath();for(let k=0;k<6;k++){const a=(60*k-30)*Math.PI/180,x=M.cx[c]+Math.cos(a)*10,y=M.cy[c]+Math.sin(a)*10;k?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fillStyle=T.owner[c]===i?'#b9677a':T.owner[c]>=0?'#bec9bc':'#e5dfc9';g.fill();}
      W.draw({g,T,s,col:{sheet:'#f9f5e9',ink:'#2e2924',accent:'#6b1e3a',stamp:'#a3987a',down:'#ab3434'}});
      g.setTransform(1,0,0,1,0,0);g.fillStyle='#2e2924';g.font='bold 22px Georgia';g.fillText('Dhaluun — the Great Border Wall',30,795);
    });
    fs.mkdirSync(new URL('./out/',import.meta.url),{recursive:true});await page.locator('#wall-map').screenshot({path:fileURLToPath(new URL('./out/dhaluun-wall-map.png',import.meta.url))});
    await page.addStyleTag({content:html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'))});
    await page.evaluate(()=>{G.S.nation=G.normalize({name:'Dispatch Reader',reg:'cloudspine',founded:Date.now(),pop:5,popAt:Date.now(),updatedAt:Date.now()});G.S.view='dispatch';document.body.innerHTML='<div id="app">'+G.DSP().dspView(Date.now())+'</div>';});
    const headline=page.getByText(HEADLINE,{exact:true}).first();await headline.waitFor({state:'visible'});
    assert.ok(await page.getByText(ARTICLE,{exact:true}).first().isVisible());
    const report=await headline.evaluate(e=>{const a=e.closest('article')||e.parentElement;const r=a.getBoundingClientRect();return {x:Math.max(0,r.x-12),y:Math.max(0,r.y+scrollY-12),width:Math.min(innerWidth-24,r.width+24),height:r.height+24};});
    await page.screenshot({path:fileURLToPath(new URL('./out/dhaluun-wall-dispatch.png',import.meta.url)),clip:report});
    console.log(`Dhaluun: ${result.edges} exterior wall segments; defence multiplier ${result.ratio}; one Dispatch report.`);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
