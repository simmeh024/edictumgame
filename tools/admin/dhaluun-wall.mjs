// Adds the wall and the Dispatch article together; a preview is the default.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
export const EVENT='dhaluun-cloudspine-v1';
export const HEADLINE='Behind Dhaluun’s new wall, preparations for something';
export const ARTICLE='A huge stone wall, with battlements and watchtowers, now runs along Dhaluun’s entire border, including its recently expanded western frontier. Sources say the empire is preparing for something, but none could say what. No purpose has been confirmed, and officials in Ombaraash have offered no explanation.';
function checkEvent(snapshot){
  if(!snapshot.exists)throw new Error('Dhaluun’s original Cloudspine event must be active first.');
  const d=snapshot.data();
  if(d.v!==1||d.reg!=='cloudspine'||d.by!=='npc-cloudspine-dhaluun'||!Number.isFinite(d.t)||!Array.isArray(d.land)||d.land.length!==120)throw new Error('Unexpected Dhaluun event; no wall was written.');
  return d;
}
export async function runWall(db,{apply=false}={}){
  const ref=db.doc('worldEvents/'+EVENT),d=checkEvent(await ref.get());
  if(d.wall)return {status:'already-applied',id:EVENT,headline:d.wall.h};
  if(!apply)return {status:'plan',id:EVENT,perimeter:'all current Dhaluun border edges',defence:'Great Wall: 12%',headline:HEADLINE,article:ARTICLE};
  return db.runTransaction(async tx=>{
    const current=checkEvent(await tx.get(ref));
    if(current.wall)return {status:'already-applied',id:EVENT,headline:current.wall.h};
    const wall={v:1,t:Math.max(Date.now(),current.t),h:HEADLINE,b:ARTICLE};
    tx.update(ref,{wall});
    tx.create(db.doc('adminAudit/dhaluun-wall-v1'),{action:'dhaluun_wall',actor:'admin-tool',outcome:'completed',at:FieldValue.serverTimestamp(),event:EVENT,headline:HEADLINE});
    return {status:'applied',id:EVENT,headline:HEADLINE};
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:null;
  if(!project)throw new Error('Usage: node tools/admin/dhaluun-wall.mjs --project PROJECT [--apply]');
  if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the existing project service account.');
  initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});
  console.log(JSON.stringify(await runWall(getFirestore(),{apply:args.includes('--apply')}),null,2));
}
