import {test,after} from 'node:test';
import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,deleteDoc,setLogLevel} from 'firebase/firestore';
setLogLevel('error');
const env=await initializeTestEnvironment({projectId:'demo-dhaluun-rules',firestore:{rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
after(()=>env.cleanup());
test('NPC event state is publicly readable but cannot be forged, even by a browser admin',async()=>{
  const path='worldEvents/dhaluun-cloudspine-v1';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),{v:1,reg:'cloudspine'}));
  for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('player'),env.authenticatedContext('staff',{admin:true})]){
    const ref=doc(ctx.firestore(),path);await assertSucceeds(getDoc(ref));await assertFails(setDoc(ref,{v:1,reg:'meridian'}));await assertFails(deleteDoc(ref));
  }
});
