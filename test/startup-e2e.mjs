// Startup, update-cache reuse and saved themes, on the built site with the local emulators.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BASE,OUT,browser,player,open,ready,found,nav,until,check,finish,localNation,clearEmulators} from './lib.mjs';
await clearEmulators();
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','public');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const core=html.match(/<script src="(\/assets\/game\.[^"]+)"/)[1],content=html.match(/\/assets\/content\.[a-f0-9]+\.js/)[0];
check('critical content and code are preloaded before the Firebase SDK',html.indexOf('href="'+core+'"')<html.indexOf('firebase-app-compat.js')&&html.indexOf('href="'+content+'"')<html.indexOf('firebase-app-compat.js'));
const A=await player('startup-desktop');await A.ctx.unrouteAll();
await open(A);await found(A,'Quickland');
await until(async()=>{const n=await localNation(A);return n?._rev>0&&!n._dirty;},15000);
await A.evaluate(()=>localStorage.setItem('statehood.theme','dark'));

// Hold the real game download to inspect the page before the game can apply any preferences.
let release;const gate=new Promise(r=>release=r);
const hold=async route=>{await gate;await route.continue();};await A.route(/\/assets\/game\./,hold);
const loading=A.reload({waitUntil:'domcontentloaded'});
await A.waitForSelector('html.ed-back[data-theme="dark"]');
check('a returning dark-theme player has the right background before game execution',await A.evaluate(()=>getComputedStyle(document.body).backgroundColor==='rgb(12, 22, 21)'));
check('a genuinely slow download still reveals useful loading feedback',await until(()=>A.isVisible('.boot'))&&!(await A.isVisible('.home-static')));
await A.screenshot({path:path.join(OUT,'startup-dark-loading.png')});
release();await loading;await A.waitForSelector('.layout');await ready(A);await A.unroute(/\/assets\/game\./,hold);
check('the actual game replaces the loader and clears its startup state',!(await A.$('.boot'))&&await A.evaluate(()=>!document.documentElement.classList.contains('ed-boot-pending')));
await nav(A,'settings');await A.click('[data-act="theme"][data-v="auto"]');
check('Automatic theme still follows a light system after early dark preference',await A.evaluate(()=>!document.documentElement.hasAttribute('data-theme')&&getComputedStyle(document.body).backgroundColor==='rgb(232, 238, 235)'));

// Use real browser caching: Playwright request interception disables the HTTP cache.
await A.ctx.unrouteAll();await A.reload();await A.waitForSelector('.layout');await ready(A);
const update=readFileSync(path.join(root,core.slice(1)),'utf8')+'\nwindow.__edictum.updateProbe=true;';
const updateURL='/assets/game.'+createHash('sha256').update(update).digest('hex').slice(0,10)+'.js';
const updateFile=path.join(root,updateURL.slice(1)),updatePage=path.join(root,'startup-update.html');
try{
  writeFileSync(updateFile,update);writeFileSync(updatePage,html.replaceAll(core,updateURL));
  await A.goto(BASE+'/startup-update');await A.waitForSelector('.layout');await ready(A);
  const timing=await A.evaluate(()=>{
    const list=performance.getEntriesByType('resource'),story=list.find(x=>/\/assets\/content\./.test(x.name)),code=list.find(x=>/\/assets\/game\./.test(x.name));
    return {storyBytes:story?.transferSize,codeBytes:code?.transferSize,updated:window.__edictum.updateProbe===true};
  });
  check('a simulated code-only update loads the new code',timing.updated&&timing.codeBytes>0,JSON.stringify(timing));
  check('the unchanged story catalog is reused from the browser cache',timing.storyBytes===0,JSON.stringify(timing));
}finally{unlinkSync(updateFile);unlinkSync(updatePage);}

const B=await player('startup-phone',{vp:{width:390,height:844},dark:true,storageState:await A.ctx.storageState({indexedDB:true})});
await B.addInitScript(()=>localStorage.setItem('statehood.theme','light'));
await open(B);await B.waitForSelector('.layout');
check('a saved light theme also wins over a dark system on a phone',await B.evaluate(()=>document.documentElement.dataset.theme==='light'&&getComputedStyle(document.body).backgroundColor==='rgb(232, 238, 235)'));
check('the phone layout stays within the viewport',await B.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await nav(B,'settings');await B.click('[data-act="theme"][data-v="auto"]');
check('Automatic theme can return to the dark system on the same phone session',await B.evaluate(()=>!document.documentElement.hasAttribute('data-theme')&&getComputedStyle(document.body).backgroundColor==='rgb(12, 22, 21)'));

const F=await player('startup-download-failure',{storageState:await A.ctx.storageState({indexedDB:true})});
await F.route(/\/assets\/content\./,r=>r.abort());await open(F);
check('a missing content download gives a visible retry message without a partial game',await until(()=>F.isVisible('.boot [role="alert"]'))&&/could not be downloaded/.test(await F.locator('.boot').textContent())&&!(await F.$('.layout')));
check('a failed content download preserves the local nation',(await localNation(F)).name==='Quickland');

const noJS=await browser.newContext({javaScriptEnabled:false});const page=await noJS.newPage();await page.goto(BASE);
check('without JavaScript, the game keeps a visible explanation and legal links',await page.isVisible('noscript .boot-load')&&!!(await page.$('a[href="/privacy"]')));
await noJS.close();await finish();
