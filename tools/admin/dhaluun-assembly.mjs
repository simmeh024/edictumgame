import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assemblyEngine} from '../../functions/assembly-engine.js';
import {cbCounted} from '../../functions/board.js';
import {DH_ASM_EVENT as EVENT,DH_ASM_REG as REG,DH_ASM_BY as BY,DH_ASM_ANNOUNCEMENT as ANNOUNCEMENT,dhaluunMotion,dhAsmT0} from '../../functions/dhaluun-assembly.js';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
export async function runCondemnation(db,{apply=false,now=Date.now()}={}){
  const eventRef=db.doc('worldEvents/'+EVENT),root=db.doc('assemblyRegions/'+REG),c=assemblyEngine(REG,[]).cycle(now);
  return db.runTransaction(async tx=>{
    const previous=await tx.get(eventRef);if(previous.exists)return {status:'already-applied',...previous.data()};
    const [customs,meta,current,next,board]=await tx.getAll(db.doc('worldEvents/dhaluun-customs-v1'),root,db.doc(root.path+'/cycles/'+c),db.doc(root.path+'/cycles/'+(c+1)),db.doc('cb/'+REG));
    if(!customs.exists)throw new Error('Dhaluun’s customs incident has not been published.');
    if(!current.exists||current.get('f'))throw new Error('The region must have a current protected vote before scheduling this motion.');
    if(next.exists)throw new Error('The next vote is already scheduled; nothing was replaced.');
    const L=dhaluunMotion(c+1,now),starts=dhAsmT0(c+1),ends=dhAsmT0(c+2);
    const result={id:EVENT,reg:REG,cycle:L.c,by:BY,title:L.ti,starts,ends,debate:L.dt,response:'after the vote closes'};
    if(!apply)return {status:'plan',...result,announcement:ANNOUNCEMENT,text:L.tx};
    if(assemblyEngine(REG,[]).cycle(Date.now())!==c)throw new Error('The Assembly cycle changed. Preview again.');
    tx.create(eventRef,{...result,v:1,t:now});
    tx.create(db.doc(root.path+'/cycles/'+L.c),L);
    tx.set(root,{rev:(meta.get('rev')||0)+1,at:now},{merge:true});
    const when=t=>new Date(t).toISOString().replace('T',' ').slice(0,16)+' UTC';
    tx.create(db.doc('cb/'+REG+'/posts/'+L.dt),{a:BY,nm:'Saaveri',rg:REG,ti:L.ti,tg:'assembly',t:now,la:now,rc:0,
      x:ANNOUNCEMENT+'\n\n'+L.tx+'\n\nTabled by Saaveri. This is scheduled for the next Assembly vote, from '+when(starts)+' to '+when(ends)+'. The current vote continues. Cast your vote on the Assembly page once this motion opens. A condemnation requires two votes for every one against.'});
    tx.set(db.doc('cb/'+REG),cbCounted(board,now,{n:1}));
    tx.create(db.doc('rchat/'+REG+'/chat/'+EVENT),{a:BY,nm:'Saaveri',x:ANNOUNCEMENT,t:now,exp:Timestamp.fromMillis(now+30*864e5)});
    tx.create(db.doc('adminAudit/'+EVENT),{action:'dhaluun_condemnation',actor:'admin-tool',outcome:'completed',at:FieldValue.serverTimestamp(),...result});
    return {status:'applied',...result};
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:null;
  if(!project)throw new Error('Usage: node tools/admin/dhaluun-assembly.mjs --project PROJECT [--apply]');
  if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS.');
  initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});
  console.log(JSON.stringify(await runCondemnation(getFirestore(),{apply:args.includes('--apply')}),null,2));
}
