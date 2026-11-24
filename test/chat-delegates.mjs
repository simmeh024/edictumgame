// Browser check of the actual chat renderer and asynchronous seat updates, without live services.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const source=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const fn=name=>{
  const at=source.indexOf('\nfunction '+name+'(');assert.ok(at>=0,name);
  const first=source.slice(at+1,source.indexOf('\n',at+1));if(first.endsWith('}'))return first;
  const end=source.indexOf('\n}',at);
  return source.slice(at+1,end+2);
};
const line=name=>source.match(new RegExp('^const '+name+'=[^\\n]+','m'))[0];
const helper=source.slice(source.indexOf('const CHAT_DEL_COLORS='),source.indexOf('function portalOk('));
const css=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const output=new URL('./out/',import.meta.url);fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch();
try {
  for(const [theme,width] of [['light',780],['dark',390]]) {
    const page=await browser.newPage({viewport:{width,height:800},colorScheme:theme});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(`<style>${css}\nbody{padding:20px} #fixture{max-width:370px;margin:auto} ol{padding:0;list-style:none}</style><div id="fixture"><h2>Delegate seats · ${theme}</h2><ol id="lines"></ol><div id="private"></div><textarea aria-label="Chat draft">Keep this draft and focus.</textarea></div>`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.addScriptTag({content:`
      const S={uid:'viewer',db:{},mode:'world'},REG={id:'meridian'},REG_BY_ID={meridian:{name:'Meridian Reach'},frostmarch:{name:'Frostmarch'}};
      const NPC_SET=new Set(),OBS=false,RGC={nc:'',menu:'',goto:''},RGC_RX=[],RGC_TEXT=1000;
      const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      const isOffice=()=>false,dmIsGroup=()=>false,myId=()=>S.uid,isStaff=id=>id==='staff',isModId=()=>false,isAmbId=id=>id==='amb';
      const fmtDate=()=> '24 Nov',fmtTime=()=> '14:32',rgcNames=()=>false,rgcBadges=()=>'',rgwBadges=()=>'',rgwFlag=()=>'',flagSVG=()=>'',uiLang=()=> 'en';
      const rgcAllyOn=()=>null,rgcWrite=()=>false,dmBlocked=()=>false,rgcAmb=()=>false,rgcRolePill=()=>'',rgcRxs=()=>'',rgcBody=m=>'<p class="rgc-x">'+esc(m.x)+'</p>';
      window.reply={chair:'meridian',foreign:'frostmarch',amb:'meridian',staff:'meridian',regular:''};
      window.claude={use:async()=>({request:async({ids})=>({badges:Object.fromEntries(ids.map(id=>[id,window.reply[id]||'']))})})};
      ${line('STAFF_PILL')}\n${line('MOD_PILL')}\n${line('AMB_PILL')}\n${line('rgcRoleIc')}
      ${helper}\n${fn('rgwFrom')}\n${fn('rgcLine')}
      const people=new Map([['chair',{id:'chair',n:{name:'The Very Long Republic of Aldmere and Islands',flag:{}}}]]);
      const examples=[
        {id:'one',a:'chair',nm:'Aldmere',x:'Region chat: the new resolution is ready.'},
        {id:'two',a:'foreign',nm:'Brimvik',w:true,rg:'frostmarch',x:'World / Français: hello from Frostmarch.'},
        {id:'three',a:'amb',nm:'Ambassador Nation',w:true,rg:'meridian',x:'Ambassadors: the delegate seat and globe appear together.'},
        {id:'four',a:'staff',nm:'Staff Nation',ally:true,x:'Alliance: the seat and staff shield appear together.'},
        {id:'five',a:'regular',nm:'A Regular Nation',x:'A member without the chair has no seat icon.'}
      ];
      document.querySelector('#lines').innerHTML=examples.map(m=>rgcLine({...m,t:Date.now()},false,people,'viewer',false,new Map())).join('');
      document.querySelector('#private').innerHTML='<p>Private / group letter '+chatDelegateBadge('foreign')+'</p>';
      window.refreshSeats=()=>{CHAT_DEL.cache.clear();chatDelegatePaint();};
    `});
    await page.waitForFunction(()=>document.querySelectorAll('.chat-delegate').length===5);
    assert.equal(await page.locator('[data-id="five"] .chat-delegate').count(),0);
    assert.equal(await page.locator('[data-id="three"] .staff-pill.amb').count(),1);
    assert.equal(await page.locator('[data-id="four"] .staff-pill').count(),1);
    const seat=await page.locator('[data-id="one"] .chat-delegate').boundingBox();
    const name=await page.locator('[data-id="one"] .rgc-nm').boundingBox();
    const heading=await page.locator('[data-id="one"] .rgc-lw').boundingBox();
    assert.ok(seat.width===18&&seat.x>=name.x+name.width-1&&seat.x+seat.width<=heading.x+heading.width+1,'seat stays fully visible beside a long name');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
    await page.locator('textarea').focus();
    await page.screenshot({path:fileURLToPath(new URL(`chat-delegates-${theme}.png`,output)),fullPage:true});
    await page.evaluate(()=>{window.reply.chair='';window.reply.regular='meridian';window.refreshSeats();});
    await page.waitForFunction(()=>!document.querySelector('[data-id="one"] .chat-delegate')&&!!document.querySelector('[data-id="five"] .chat-delegate'));
    assert.equal(await page.locator('textarea').inputValue(),'Keep this draft and focus.');
    assert.equal(await page.locator('textarea').evaluate(e=>document.activeElement===e),true,'refresh preserves composer focus');
    assert.deepEqual(errors,[]);
    console.log(`ok ${theme} ${width}px: live seats, regional colours, role badges, long names, office change, draft and focus`);
    await page.close();
  }
}finally{await browser.close();}
