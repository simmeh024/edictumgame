import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {decodeNation} from './dhaluun-event.mjs';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
export const EVENT='dhaluun-customs-v1',BY='npc-cloudspine-dhaluun',REGION='cloudspine',AGREEMENT='Western Dhaluun Free Trade Agreement',DAY=864e5;
export const MESSAGE='To the signatories of the Western Dhaluun Free Trade Agreement:\n\nHis Imperial Loftiness has reviewed your arrangements. Several trade routes have been suspended pending clarification of the word “Free.”\n\nConsider this your first customs notice.\n\n— The Throne of All Heights';
/* A shared route consumes a place for both members, so nobody has more than two disrupted routes. */
export function chooseRoutes(active,members){
  const ids=new Set(members),counts=new Map(members.map(id=>[id,0])),chosen=new Map();
  const eligible=active.filter(d=>!d.sus&&d.fa>0&&d.fb>0&&(ids.has(d.a)||ids.has(d.b)));
  const candidates=id=>eligible.filter(d=>d.a===id||d.b===id).sort((a,b)=>{
    const rank=d=>{const other=d.a===id?d.b:d.a;return other===BY?0:other.startsWith('npc-')?1:ids.has(other)?2:3;};
    return rank(a)-rank(b)||a.t-b.t||a.id.localeCompare(b.id);
  });
  const order=members.slice().sort((a,b)=>candidates(a).length-candidates(b).length||a.localeCompare(b));
  for(let round=0;round<2;round++)for(const id of order){
    if(counts.get(id)>=2)continue;
    const d=candidates(id).find(d=>!chosen.has(d.id)&&[d.a,d.b].every(u=>!ids.has(u)||counts.get(u)<2));if(!d)continue;
    chosen.set(d.id,{id:d.id,a:d.a,b:d.b,dt:d.t});for(const u of [d.a,d.b])if(ids.has(u))counts.set(u,counts.get(u)+1);
  }
  return {routes:[...chosen.values()],counts:Object.fromEntries(counts)};
}
export async function planCustoms(rows,members,base,alliances,{now=Date.now()}={}){
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());
    await page.goto('https://edictum.invalid/');
    await page.evaluate(now=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Planner',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>{window.G=g;};Date.now=()=>now;},now);
    const html=fs.readFileSync(new URL('../../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
    const boot="if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});";
    if(!script.includes(boot))throw new Error('The game boot marker changed.');
    await page.addScriptTag({content:script.replace(boot,'/* Planning only: no connections or saves. */')});
    const active=await page.evaluate(({rows,base,alliances})=>{
      window.EDICTUM_PROBE.dhaluun.load(rows);window.EDICTUM_PROBE.dhaluunWall.install(base);
      const X=G.ALX(),AL=X.AL;AL.docs=new Map(alliances.map(a=>[a.id,X.alNorm(a.id,a.d)]));AL.reg='cloudspine';AL.ready=true;AL.rev++;
      return G.NPX().economy().active.map(d=>({id:d.id,a:d.a,b:d.b,t:d.t,sus:!!d.sus,fa:d.fa,fb:d.fb}));
    },{rows,base,alliances});
    const chosen=chooseRoutes(active,members);
    if(!chosen.routes.length)throw new Error('No active trade routes can be disrupted.');
    const aid=alliances.find(a=>a.d.name===AGREEMENT)?.id;
    const event={v:1,reg:REGION,by:BY,aid,t:now,u:now+DAY,factor:0.5,...chosen};
    await page.evaluate(event=>{
      const C=window.EDICTUM_PROBE.customs,before=C.economy(),old=new Map(before.active.map(d=>[d.id,{bk:d.bk,a:d.a,b:d.b}]));C.install(event);
      if(!C.active())throw new Error('The trade disruption plan was rejected by the client.');
      for(const d of C.economy().active){const prev=old.get(d.id);if(!prev)throw new Error('A route changed during validation.');
        const factor=event.routes.some(r=>r.id===d.id)?0.5:1;if(Math.abs(d.bk-prev.bk*factor)>1e-9)throw new Error('The plan does not halve exactly the selected trade routes.');}
    },event);
    return event;
  }finally{await browser.close();}
}
export async function runCustoms(db,{apply=false,planner=planCustoms}={}){
  const eventRef=db.doc('worldEvents/'+EVENT);if((await eventRef.get()).exists)return {status:'already-applied',id:EVENT};
  const aq=await db.collection('alliances').where('name','==',AGREEMENT).get();
  if(aq.size!==1)throw new Error('Expected exactly one '+AGREEMENT+'.');
  const alliance=aq.docs[0];if(alliance.get('reg')!==REGION)throw new Error('The agreement is outside Cloudspine.');
  const members=Object.keys(alliance.get('mem')||{}).filter(id=>!id.startsWith('npc-'));
  if(!members.length)throw new Error('The agreement has no player members.');
  const ns=await db.collection('nations').where('reg','==',REGION).get(),mods=ns.empty?[]:await db.getAll(...ns.docs.map(d=>db.doc('mod/'+d.id)));
  const hidden=new Map(mods.map(d=>[d.id,d.get('hidden')===true]));
  const rows=ns.docs.map(d=>({id:d.id,n:decodeNation(d),hidden:hidden.get(d.id)}));
  const bases=await db.doc('worldEvents/dhaluun-cloudspine-v1').get();if(!bases.exists)throw new Error('The original Dhaluun event is missing.');
  const alliances=await db.collection('alliances').where('reg','==',REGION).get();
  const plan={...await planner(rows,members,bases.data(),alliances.docs.map(d=>({id:d.id,d:d.data()}))),aid:alliance.id};
  const summary={id:EVENT,alliance:AGREEMENT,players:members.map(id=>({id,name:rows.find(x=>x.id===id)?.n.name||id,routes:plan.counts[id]})),routes:plan.routes.length,reduction:'50%',duration:'24 hours',message:MESSAGE};
  if(!apply)return {status:'plan',...summary};
  return db.runTransaction(async tx=>{
    const previous=await tx.get(eventRef);if(previous.exists)return {status:'already-applied',id:EVENT};
    const currentA=await tx.get(alliance.ref),currentN=await tx.get(db.collection('nations').where('reg','==',REGION));
    if(!currentA.exists||!currentA.updateTime.isEqual(alliance.updateTime)||currentN.size!==ns.size||currentN.docs.some(d=>!ns.docs.some(n=>n.id===d.id&&n.updateTime.isEqual(d.updateTime))))throw new Error('The agreement or its trade routes changed during planning. Run the tool again.');
    const t=Date.now(),event={...plan,t,u:t+DAY};
    tx.create(eventRef,event);
    tx.create(db.doc('alliances/'+alliance.id+'/chat/'+EVENT),{a:BY,nm:'Dhaluun',x:MESSAGE,t});
    tx.create(db.doc('adminAudit/'+EVENT),{action:'dhaluun_customs',actor:'admin-tool',outcome:'completed',at:FieldValue.serverTimestamp(),event:EVENT,aid:alliance.id,routes:event.routes.length,players:members.length,until:event.u});
    return {status:'applied',...summary,starts:t,ends:event.u};
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:null;
  if(!project)throw new Error('Usage: node tools/admin/dhaluun-customs.mjs --project PROJECT [--apply]');
  if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS.');
  initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});
  console.log(JSON.stringify(await runCustoms(getFirestore(),{apply:args.includes('--apply')}),null,2));
}
