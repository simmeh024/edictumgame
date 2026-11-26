import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {decodeNation} from './dhaluun-event.mjs';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
export const EVENT='dhaluun-cloudspine-v1',AUDIT='dhaluun-north-v1';
export const HEADLINE='Haalesh cabinet invites Dhaluun advisers; oversight committee dissolved before their arrival';
export const ARTICLE='Haalesh’s ministers have sold their support to Dhaluun, handing imperial advisers sweeping powers. A National Continuity Council has replaced parliament, suspended elections and censored independent papers. Public contracts now go to cabinet relatives. Haalesh has joined The Pact of Eternal Snows alongside Dhaluun and Kethavaar. Officials called the payments “administrative reassurance”. Asked who was now advising whom, the council declined to comment.';
export async function planNorth(rows,base){
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.request().url()==='https://edictum.invalid/'?r.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):r.abort());await page.goto('https://edictum.invalid/');
  await page.evaluate(()=>{localStorage.setItem('statehood.nation.v1',JSON.stringify({name:'Planner',reg:'cloudspine'}));window.EDICTUM_PROBE=g=>window.G=g;});
  const html=fs.readFileSync(new URL('../../game/edictum.html',import.meta.url),'utf8'),script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
  await page.addScriptTag({content:script.replace("if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});",'/* Plan only: no connection or nation saves. */')});
  return await page.evaluate(({rows,base,h,b})=>{
   const P=window.EDICTUM_PROBE;P.dhaluun.load(rows);P.dhaluunWall.install(base);const T=G.territory(),i=T.byId[base.by],old=P.dhaluunWall.cities(base.by),north=P.dhaluunNorth.plan(),haalesh={v:1,t:north.t,h,b};
   P.dhaluunWall.install({...base,north,haalesh});const A=G.territory(),CS=P.dhaluunWall.cityState(A),city=CS.all.find(c=>c.id===north.city.id&&c.fid===base.by);
   if(A.count[i]-T.count[i]!==north.land.length||!city?.active)throw new Error('The expansion or settlement was not applied correctly.');
   for(let c=0;c<T.owner.length;c++)if(T.owner[c]>=0&&T.owner[c]!==i&&A.list[A.owner[c]]?.id!==T.list[T.owner[c]].id)throw new Error('Another nation’s border would change.');
   const after=P.dhaluunWall.cities(base.by);for(const c of old)if(!after.some(x=>x.id===c.id&&x.c===c.c&&x.nm===c.nm))throw new Error('An existing imperial city moved.');
   const gov=G.NPX().findNation(P.dhaluunRegime.spec.id),bloc=G.ALX().politics().of.get(gov.id);
   if(P.dhaluunRegime.category(gov.n.s)!=='Corrupt Dictatorship'||bloc?.id!=='bloc-snows')throw new Error('Haalesh’s government or pact is incorrect: '+JSON.stringify({category:P.dhaluunRegime.category(gov.n.s),pact:bloc?.name,active:!!P.dhaluunRegime.active(),blocs:P.dhaluunRegime.blocs()}));
   const incident=P.dhaluun.index().all.filter(e=>e.op.id===north.scandal.id);if(incident.length!==1||!incident[0].ok||incident[0].ex)throw new Error('The planted scandal is not a single successful operation.');
   const n=structuredClone(G.S.world[north.scandal.tg]);G.S.uid=north.scandal.tg;G.S.nation=n;P.dhaluunNorth.apply(n);
   if(!n.inbox.some(e=>e.id===north.scandal.is)||!n.cvIn.includes(incident[0].key))throw new Error('The scandal could not reach Kesara’s edict desk.');
   const count=n.inbox.length;P.dhaluunNorth.apply(n);if(n.inbox.length!==count)throw new Error('The scandal would be delivered twice.');
   return {north,haalesh,before:T.count[i],after:A.count[i],city:city.nm,category:'Corrupt Dictatorship',pact:bloc.name};
  },{rows,base,h:HEADLINE,b:ARTICLE});
 }finally{await browser.close();}
}
export async function runNorth(db,{apply=false,planner=planNorth}={}){
 const ref=db.doc('worldEvents/'+EVENT),saved=await ref.get();if(!saved.exists)throw new Error('The original Dhaluun event is missing.');
 const base=saved.data();if(base.north&&base.haalesh)return {status:'already-applied',id:AUDIT};if(base.north||base.haalesh)throw new Error('Partial escalation already exists; no changes were made.');
 const ns=await db.collection('nations').where('reg','==','cloudspine').get(),mods=ns.empty?[]:await db.getAll(...ns.docs.map(d=>db.doc('mod/'+d.id)));
 const hidden=new Map(mods.map(d=>[d.id,d.get('hidden')===true])),rows=ns.docs.map(d=>({id:d.id,n:decodeNation(d),hidden:hidden.get(d.id)}));
 const plan=await planner(rows,base),summary={id:AUDIT,hexes:plan.north.land.length,before:plan.before,after:plan.after,city:plan.city,target:plan.north.scandal.tn,scandal:'success, undetected',government:plan.category,pact:plan.pact,headline:HEADLINE};
 if(!apply)return {status:'plan',...summary};
 return db.runTransaction(async tx=>{
  const current=await tx.get(ref);if(current.get('north')&&current.get('haalesh'))return {status:'already-applied',id:AUDIT};
  const currentN=await tx.get(db.collection('nations').where('reg','==','cloudspine')),currentMods=currentN.empty?[]:await tx.getAll(...currentN.docs.map(d=>db.doc('mod/'+d.id))),root=await tx.get(db.doc('assemblyRegions/cloudspine'));
  if(!current.updateTime.isEqual(saved.updateTime)||currentN.size!==ns.size||currentN.docs.some(d=>!ns.docs.some(n=>n.id===d.id&&n.updateTime.isEqual(d.updateTime)))||currentMods.some(d=>hidden.get(d.id)!==(d.get('hidden')===true)))throw new Error('Cloudspine changed during planning. Run the tool again.');
  const t=Date.now();tx.update(ref,{north:{...plan.north,t},haalesh:{...plan.haalesh,t}});
  tx.set(db.doc('assemblyRegions/cloudspine'),{haalesh:{v:1,t},rev:(root.get('rev')||0)+1,at:t},{merge:true});
  tx.create(db.doc('adminAudit/'+AUDIT),{action:'dhaluun_north_and_haalesh',actor:'admin-tool',outcome:'completed',at:FieldValue.serverTimestamp(),...summary,t});
  return {status:'applied',...summary,t};
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:null;
 if(!project)throw new Error('Usage: node tools/admin/dhaluun-north.mjs --project PROJECT [--apply]');
 if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS.');
 initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});console.log(JSON.stringify(await runNorth(getFirestore(),{apply:args.includes('--apply')}),null,2));
}
