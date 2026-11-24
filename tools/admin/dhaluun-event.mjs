// Plan by default. Only --apply writes the event and Dhaluun's real region-chat line.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {nationText} from '../../functions/nationtext.js';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
export const EVENT='dhaluun-cloudspine-v1',REGION='cloudspine',MESSAGE='hmm, that did not go to plan.';
export function decodeNation(snapshot){
  const text=nationText(snapshot);if(text===null)throw new Error('Cannot decode nation '+snapshot.id+'. No event was written.');
  const n=JSON.parse(text);if(!n||typeof n!=='object'||Array.isArray(n))throw new Error('Invalid nation '+snapshot.id+'.');
  Object.assign(n,{_ts:snapshot.get('ts')?.toMillis?.()||0,_pop:snapshot.get('pop'),_army:snapshot.get('army'),_cl:snapshot.get('cl'),_rev:snapshot.get('rev')||0,_dirty:false});
  if(snapshot.get('storageV')===1)n.whv=1;
  return n;
}
export async function planEvent(rows,{now=Date.now()}={}){
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  try{
    const page=await browser.newPage();
    await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());
    await page.goto('https://edictum.invalid/');
    await page.evaluate(now=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Planner',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>{window.G=g;};Date.now=()=>now;},now);
    const html=fs.readFileSync(new URL('../../game/edictum.html',import.meta.url),'utf8');
    const script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
    const boot="if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});";
    if(!script.includes(boot))throw new Error('The game boot marker changed; update the event planner.');
    await page.addScriptTag({content:script.replace(boot,'/* The planner never starts the UI, connects, or saves. */')});
    return await page.evaluate(rows=>{
      const api=window.EDICTUM_PROBE.dhaluun;api.load(rows);const before=G.territory(),event=api.plan(),i=before.byId[event.by];
      api.state.data=api.read(event);if(!api.state.data)throw new Error('Invalid event plan.');
      const after=G.territory();
      if(after.count[i]-before.count[i]!==120)throw new Error('The plan does not add exactly 120 hexes.');
      for(let c=0;c<before.owner.length;c++)if(before.owner[c]>=0&&before.owner[c]!==i&&after.list[after.owner[c]]?.id!==before.list[before.owner[c]].id)throw new Error('The plan would move another nation’s border.');
      return {event,before:before.count[i],after:after.count[i]};
    },rows);
  }finally{await browser.close();}
}
export async function runEvent(db,{apply=false}={}){
  const ref=db.doc('worldEvents/'+EVENT),chat=db.doc('rchat/'+REGION+'/chat/'+EVENT);
  if((await ref.get()).exists)return {status:'already-applied',id:EVENT};
  const nations=await db.collection('nations').where('reg','==',REGION).get();
  const mods=nations.empty?[]:await db.getAll(...nations.docs.map(d=>db.doc('mod/'+d.id)));
  const hidden=new Map(mods.map(d=>[d.id,d.get('hidden')===true]));
  const rows=nations.docs.map(d=>({id:d.id,n:decodeNation(d),hidden:hidden.get(d.id)}));
  const plan=await planEvent(rows);
  if(!apply)return {status:'plan',...plan};
  return db.runTransaction(async tx=>{
    const previous=await tx.get(ref);if(previous.exists)return {status:'already-applied',id:EVENT};
    const current=await tx.get(db.collection('nations').where('reg','==',REGION));
    const currentMods=current.empty?[]:await tx.getAll(...current.docs.map(d=>db.doc('mod/'+d.id)));
    if(current.size!==nations.size||current.docs.some(d=>!nations.docs.some(n=>n.id===d.id&&n.updateTime.isEqual(d.updateTime)))||currentMods.some(d=>hidden.get(d.id)!==(d.get('hidden')===true)))throw new Error('Cloudspine changed during planning. Run the tool again.');
    const t=Date.now(),event={...plan.event,t};
    tx.create(ref,event);
    tx.create(chat,{a:event.by,nm:'Dhaluun',x:MESSAGE,t:t+1,exp:Timestamp.fromMillis(t+30*864e5)});
    tx.create(db.collection('adminAudit').doc(),{action:'dhaluun_event',actor:'admin-tool',outcome:'completed',at:FieldValue.serverTimestamp(),event:EVENT,targets:event.targets.length,hexes:120});
    return {status:'applied',id:EVENT,targets:event.targets.length,before:plan.before,after:plan.after};
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:null;
  if(!project)throw new Error('Usage: node tools/admin/dhaluun-event.mjs --project PROJECT [--apply]');
  if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the existing project service account.');
  initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});
  console.log(JSON.stringify(await runEvent(getFirestore(),{apply:args.includes('--apply')}),null,2));
}
