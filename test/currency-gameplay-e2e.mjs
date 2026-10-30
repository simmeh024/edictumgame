// Connected currency gameplay on two browsers, including a phone. Emulator data only.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {counterfeitsOf} from '../jobs/fx/engine.mjs';
import {OUT,PROJECT,FS_HOST,check,finish,until,player,open,found,nav,text,localNation,nationDoc,restGet,clearEmulators,errors} from './lib.mjs';
const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),DAY=864e5;
const noScroll=p=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
await clearEmulators();
/* ── currency gameplay: fixed contracts, policy reports, counterfeit checks and national prose ── */
const C = await player('FX-C'), D = await player('FX-D', {vp:{width:390,height:844},dark:true});
const uidC=await open(C);await found(C,'Coinland');
const uidD=await open(D);await found(D,'Noteland');
for(const p of [C,D])await p.evaluate(()=>{const n=G.clone(G.S.nation);n.founded=Date.now()-10*864e5;delete n.policies.counterIntel;G.commit(n);G.render();});
for(const [p,id] of [[C,uidC],[D,uidD]])if(!await until(async()=>{const d=await nationDoc(id),n=await localNation(p);return d?.rec.founded<Date.now()-9*DAY&&!n?._dirty;},20000))throw Error('Currency fixture age did not finish saving before reload');
await until(async()=>!!(await nationDoc(uidD))?.rec);
await until(()=>C.evaluate(id=>!!G.S.world[id],uidD));

execFileSync(process.execPath,[path.join(ROOT,'jobs/fx/run.mjs'),'--project',PROJECT,'--region','meridian'],{env:{...process.env,FIRESTORE_EMULATOR_HOST:FS_HOST},encoding:'utf8'});
// Publish known strengths in the emulator; the resource quote must ignore nominal denomination.
const published=await restGet('fx/meridian'), rated=JSON.parse(published.body.fields.j.stringValue);
rated.n[uidC]={...rated.n['npc-vellmark'],s:80,v:0.01};rated.n[uidD]={...rated.n['npc-vellmark'],s:20,v:900};
const patch=await fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/fx/meridian?updateMask.fieldPaths=j`,{method:'PATCH',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({fields:{j:{stringValue:JSON.stringify(rated)}}})});
check('gameplay rate fixtures are published only to the emulator',patch.ok);
for(const p of [C,D]){await p.evaluate(()=>localStorage.removeItem('edictum.fx.v1'));await open(p);await nav(p,'exchange');}
check('the Bureau links to resource trade and Intelligence',!!(await C.$('.cu-connections [data-v="trade"]'))&&!!(await C.$('.cu-connections [data-v="intel"]')));
await nav(C,'trade');await C.selectOption('#tr-w',uidD);
check('a strong currency buys the same imports with fewer exports despite a low nominal value',/5\.8% fewer exports/.test(await text(C,'#deal-preview')),await text(C,'#deal-preview'));
await C.selectOption('#tr-gr','goods');await C.selectOption('#tr-rr','timber');await C.fill('#tr-ga','2');await C.fill('#tr-ra','1');await C.click('#deal-form button[type="submit"]');
check('a player can negotiate a fixed resource offer',await until(async()=>(await localNation(C)).deals?.some(d=>d.w===uidD&&d.g[1]===2&&d.r[1]===1)),JSON.stringify((await localNation(C)).deals));
await nav(D,'trade');
check('the other player receives the offered quantities',await until(async()=>!!(await D.$('[data-act="tr-accept"]'))));
await D.click('[data-act="tr-accept"]');
check('both sides retain mirrored quantities when the deal is accepted',await until(async()=>{const a=await nationDoc(uidC),b=await nationDoc(uidD);return a?.rec.deals?.some(x=>x.w===uidD&&x.g[1]===2&&x.r[1]===1)&&b?.rec.deals?.some(x=>x.w===uidC&&x.a&&x.g[1]===1&&x.r[1]===2);}),JSON.stringify({a:(await nationDoc(uidC))?.rec.deals,b:(await nationDoc(uidD))?.rec.deals}));

await C.evaluate(()=>{const n=G.clone(G.S.nation);n.policies.centralBankIndependence=true;n.s.wealth=Math.max(1,n.s.wealth-10);G.commit(n);G.render();});
await nav(C,'exchange');
check('the Bureau explains the policy confidence and income trade-off',/monetary credibility \+/.test(await text(C,'.cu-connections'))&&/income per person −/.test(await text(C,'.cu-connections')));
check('policy reports are saved in the private half only',await until(async()=>{const d=await nationDoc(uidC);return d?.rec.cuJournal?.length&&!d.shared.cuJournal;}));
await nav(C,'nation');const ownProse=await text(C,'.overview > p:last-child');
check('the nation overview has a separate currency paragraph grounded in its institutions',(await C.$$('.overview > p')).length===4&&/Coinlander Crown/.test(ownProse)&&/independent central bank/.test(ownProse),ownProse);
await C.locator('.overview').screenshot({path:path.join(OUT,'currency-overview-1280.png')});
await nav(D,'region');await D.click(`[data-act="visit"][data-id="${uidC}"]`);
check('visiting that nation shows the same distinctive currency paragraph',await until(async()=>await text(D,'.overview > p:last-child')===ownProse));
await nav(D,'nation');const otherProse=await text(D,'.overview > p:last-child');
check('another nation has its own currency story',otherProse!==ownProse&&/Notelander Crown/.test(otherProse));

await nav(C,'intel');await C.selectOption('#cv-tg',uidD);await C.click('[data-act="cv-k"][data-k="c"]');
check('counterfeiting is offered with explicit cost, duration and limits',/24 hours/.test(await text(C,'.cv-fx'))&&/do not stack/.test(await text(C,'.cv-fx'))&&(await C.$$('.cv-k')).length===5);
check('the operation displays its real resource cost',/10 timber/.test(await text(C,'.cv-odds'))&&/22 goods/.test(await text(C,'.cv-odds')));
await C.evaluate(()=>G.commit(G.clone(G.S.nation)));
const beforeCounterfeit=await localNation(C);
await C.click('[data-act="cv-launch"]');
check('launching counterfeiting creates a real operation and report',await until(async()=>{const n=await localNation(C);return n.cov?.[0].k==='c'&&/Counterfeit currency/.test(await text(C,'#cv-result'));}));
const afterCounterfeit=await localNation(C);
check('it spends the printed resource cost',Math.abs(beforeCounterfeit.stock.goods-afterCounterfeit.stock.goods-22)<0.1&&Math.abs(beforeCounterfeit.stock.timber-afterCounterfeit.stock.timber-10)<0.1,JSON.stringify({before:beforeCounterfeit.stock,after:afterCounterfeit.stock,op:afterCounterfeit.cov[0]}));
check('the new operation survives a reload',await until(async()=> (await nationDoc(uidC))?.rec.cov?.[0].k==='c'));
await open(C);await nav(C,'intel');
check('reloaded operation stays a counterfeit operation',/Counterfeit currency/.test(await text(C,'.reps')));

// A deterministic successful incident exercises the victim's view, even if the UI launch failed.
const attackAt=Date.now()-60000, forged={id:'counterfeit',k:'c',tg:uidD,tn:'Noteland',t:attackAt,rg:'meridian',p:0.9,x:0.3};
const victim=await localNation(D),attacker=await localNation(C);
while(!counterfeitsOf(new Map([[uidC,{...attacker,cov:[forged]}],[uidD,victim]]),Date.now(),'meridian').has(uidD))forged.id+='a';
await C.evaluate(op=>{const n=G.clone(G.S.nation);n.cov=[op,{...op,id:op.id+'b'}];G.commit(n);G.render();},forged);
// The victim learns of it from the attacker's next save, which a busy runner can delay past the default wait,
// and the Bureau shows it on its next draw: wait for the save, then revisit the page as it arrives.
check('the victim sees a bounded 4% verification premium when the operation reaches the region',
  await until(async()=>(await nationDoc(uidC))?.rec.cov?.some(o=>o.id===forged.id),20000)
  &&await until(async()=>{await nav(D,'exchange');return /Verification adds 4%/.test(await text(D,'.cu-connections'));},20000));
await nav(D,'trade');await D.selectOption('#tr-w',uidC);
check('currency trouble affects new trade quotes visibly',/counterfeit checks/.test(await text(D,'#deal-preview')));
check('existing resource contract quantities survive the incident',(await localNation(D)).deals.some(x=>x.w===uidC&&x.g[1]===1&&x.r[1]===2));
await D.evaluate(()=>{const n=G.clone(G.S.nation);n.policies.counterIntel=true;G.commit(n);G.render();});await nav(D,'exchange');
check('Counter-Intelligence immediately halves the live verification premium',/Verification adds 2%/.test(await text(D,'.cu-connections'))&&/reduced by 4 points/.test(await text(D,'.cu-connections')));
check('the connected Bureau fits a phone without sideways scroll',(await noScroll(D))<=0);
await D.screenshot({path:path.join(OUT,'currency-gameplay-390.png'),fullPage:true});
await D.locator('.cu-connections').screenshot({path:path.join(OUT,'currency-connections-390.png')});
await C.screenshot({path:path.join(OUT,'currency-intelligence-1280.png'),fullPage:true});

await C.evaluate(()=>{const n=G.clone(G.S.nation);n.cov=n.cov.map(o=>({...o,t:Date.now()-864e5-1}));G.commit(n);G.render();});
check('the currency hold disappears after 24 hours without a target stat reset',await until(async()=>{await nav(D,'exchange');return !/Counterfeit alert/.test(await text(D,'.cu-connections'));}));
await open(C);await nav(C,'exchange');
check('policy signals survive loading the saved private half',/Recent policy signals/.test(await text(C,'.cu-connections'))&&/monetary credibility \+/.test(await text(C,'.cu-connections')));
await C.screenshot({path:path.join(OUT,'currency-policy-1280.png'),fullPage:true});
await C.ctx.close();await D.ctx.close();

check('no page errors',!errors.length,errors.join(' | '));
await finish();
