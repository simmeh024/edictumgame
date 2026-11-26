import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {armExile,runExileTimer,EVENT,EXILE_THREAT,EXILE_SATISFIED} from '../functions/haalesh-exile.js';
import {settleAssemblyRegion} from '../functions/civic.js';
import {assemblyEngine} from '../functions/assembly-engine.js';
import {createExileWorld} from '../functions/exile-world.js';
import {EXILE_ID} from '../functions/exile-npc.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url)),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
const project=process.env.GCLOUD_PROJECT||'demo-edictum';initializeApp({projectId:project});const db=getFirestore(),auth=getAuth(),DAY=864e5,HOUR=3600e3,ROOT='assemblyRegions/cloudspine';
async function player(){
 const email='exile-'+crypto.randomUUID()+'@example.test',password='test-only-password',u=await auth.createUser({email,password,emailVerified:true}),uid=u.uid;
 await db.doc('nations/'+uid).set({v:1,reg:'cloudspine',name:'Petitioner '+uid,pop:10,army:1,cl:0,rev:1,updatedAt:Date.now(),ts:new Date(),j:JSON.stringify({reg:'cloudspine',name:'Petitioner '+uid,pop:10,s:{civil:50,econ:50,pol:50},claims:[]})});
 const saved=await db.doc('nations/'+uid).get();await db.doc('accountIdentity/'+uid).set({nationAt:Date.now()-20*DAY,nationGeneration:saved.createTime.toMillis()});
 const r=await fetch('http://'+(process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9099')+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}),b=await r.json();assert.ok(r.ok,JSON.stringify(b));return {uid,token:b.idToken};
}
async function call(p,service,data){const r=await fetch('http://'+(process.env.FUNCTIONS_EMULATOR_HOST||'127.0.0.1:5001')+'/'+project+'/europe-west1/'+service,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+p.token},body:JSON.stringify({data})}),b=await r.json();if(b.error)throw new Error(JSON.stringify(b.error));return b.result;}
async function reset(){
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'These destructive fixtures run only on emulators.');
 const event=await db.doc('worldEvents/'+EVENT).get();if(event.get('debate'))await db.recursiveDelete(db.doc('cb/cloudspine/posts/'+event.get('debate')));
 await db.recursiveDelete(db.doc(ROOT));
 await db.recursiveDelete(db.doc('cb/cloudspine'));
 for(const p of ['worldEvents/'+EVENT,'serverEvents/'+EVENT,'rchat/cloudspine/chat/'+EVENT,'rchat/cloudspine/chat/'+EVENT+'-result',...['armed','published','result'].map(k=>'adminAudit/'+EVENT+'-'+k)])await db.doc(p).delete();
}
test('the real server clock publishes without a player online, honours rejection and passage, and creates the native NPC only after the protected count',async()=>{
 const actual=Date.now(),E=assemblyEngine('cloudspine',[]),current=E.cycle(actual),publishAt=E.t0(current-3)+HOUR,armedAt=publishAt-25*HOUR;
 const seed=createExileWorld({rows:[],dhaluun:null},{now:armedAt}),base=seed.baseline();base.t=armedAt-DAY;base.haalesh={v:1,t:armedAt,h:'Purchased cabinet',b:'The ministers invited Dhaluun’s advisers.'};
 for(const vote of [-1,1]){
  await reset();const p=await player();await db.doc('worldEvents/dhaluun-cloudspine-v1').set(base);const c=E.cycle(publishAt);
  await db.doc(ROOT).set({rev:1,haalesh:{v:1,t:armedAt}});
  await db.doc(ROOT+'/cycles/'+c).set({c,k:'existing-player-vote',ti:'Existing trade vote',tx:'Keep the existing vote.',cat:'trade',g:0,by:p.uid,bn:'Player',w:'s',lt:armedAt});
  await db.doc(ROOT+'/cycles/'+(c+1)).set({c:c+1,k:'reserved-condemnation',ti:'Reserved condemnation',tx:'Keep the existing reservation.',cat:'condemn',tg:'npc-cloudspine-dhaluun',tn:'Dhaluun',g:0,by:'npc-cloudspine-saaveri',bn:'Saaveri',w:'n',lt:armedAt});
  await armExile(db,{publishAt,now:armedAt,apply:true});await runExileTimer(db,{now:publishAt-1,settle:settleAssemblyRegion});assert.equal((await db.doc('worldEvents/'+EVENT).get()).exists,false);
  await runExileTimer(db,{now:publishAt,settle:settleAssemblyRegion});const event=(await db.doc('worldEvents/'+EVENT).get()).data();assert.equal(event.phase,'published');assert.equal(event.c,c+2);assert.equal(event.nation,undefined);assert.equal((await db.doc(ROOT+'/cycles/'+(c+1)).get()).get('k'),'reserved-condemnation');
  const saved=await db.doc('nations/'+p.uid).get(),generation=saved.createTime.toMillis();
  await db.doc(ROOT+'/actors/'+p.uid).set({generation,record:{r:'cloudspine',e:[],s:[],v:[{c:event.c,k:EVENT,v:vote,t:event.opens+1000}]},at:event.opens+1000});
  const before=saved.updateTime.toMillis();
  // A normal client may close the count, but only the server clock executes the land allocation.
  if(vote<0){await call(p,'civic',{op:'state'});assert.ok((await db.doc(ROOT+'/cycles/'+event.c).get()).get('f'));}
  assert.equal((await db.doc('worldEvents/'+EVENT).get()).get('nation'),undefined);
  await runExileTimer(db,{now:actual,settle:settleAssemblyRegion});const result=(await db.doc('worldEvents/'+EVENT).get()).data(),reaction=await db.doc('rchat/cloudspine/chat/'+EVENT+'-result').get();
  assert.ok((await db.doc(ROOT+'/cycles/'+event.c).get()).get('f'),'the server closes the count with no player request');
  assert.equal(result.phase,vote>0?'passed':'rejected');assert.equal(reaction.get('x'),vote>0?EXILE_THREAT:EXILE_SATISFIED);assert.equal((await db.doc('nations/'+p.uid).get()).updateTime.toMillis(),before,'the clock never rewrites the player nation');
  if(vote<0){assert.equal(result.nation,undefined);assert.equal((await db.doc(ROOT).get()).get('haalesh').exile,undefined);}
  else{assert.equal(result.nation.id,EXILE_ID);assert.equal(result.nation.land.length,7);assert.equal((await db.doc(ROOT).get()).get('haalesh').exile.id,EXILE_ID);
   const {aid}=await call(p,'civic',{op:'alFound',name:'Friends of Refuge '+crypto.randomUUID().slice(0,6)});assert.equal((await call(p,'civic',{op:'alInvite',aid,id:EXILE_ID})).joined,true,'the new country is recognised by the native NPC alliance service');
  }
  const first=reaction.get('t');await runExileTimer(db,{now:actual+60000,settle:settleAssemblyRegion});assert.equal((await reaction.ref.get()).get('t'),first);assert.equal((await db.doc('adminAudit/'+EVENT+'-result').get()).get('passed'),vote>0);
 }
});
